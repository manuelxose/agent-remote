import { execFile as nodeExecFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { isAbsolute, resolve } from "node:path";
import qrcode from "qrcode-terminal";
import type { ConversationAgent, Message, Route } from "../../../packages/core/src/index.js";
import { InMemoryConversationStore, JsonHistoryStore, historySearchMatches, normalizeHistorySearch, parseWhatsAppExport, type HistoryChat } from "../../../packages/conversations/src/index.js";
import { ConfiguredModelPolicy, ControlPlane, JsonControlPlaneStore, type Role } from "../../../packages/control-plane/src/index.js";
import { InMemoryEventBus } from "../../../packages/events/src/index.js";
import { ConfigurationRouter } from "../../../packages/routing/src/index.js";
import { createRestrictedDeveloperCapabilities, WorkspacePolicy, type LocalDeveloperOperations } from "../../../packages/security/src/index.js";
import { createClaudeAdapter } from "../../../developer-agents/claude/src/index.js";
import { createCodexAdapter } from "../../../developer-agents/codex/src/index.js";
import { createCopilotAdapter } from "../../../developer-agents/copilot/src/index.js";
import { DeveloperAgentRuntime } from "../../../runtime/developer-agent/src/index.js";
import { JsonDeveloperSessionStore } from "../../../runtime/developer-agent/src/sessions.js";
import { createWhatsAppGateway, type WhatsAppGatewayApplication, type WhatsAppGatewayOptions } from "./whatsapp.js";
import { formatOperationalError } from "./doctor.js";
import { parseWhatsAppImportCommand, translateWhatsAppMessage, type WhatsAppChannel, type WhatsAppImportFile, type WhatsAppImportRequest } from "../../../channels/whatsapp/src/index.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";
import { StreamDelivery, type StreamingDeliveryPolicy } from "../../../packages/control-plane/src/delivery.js";
import { createPresentationBridge, type PresentationBridge } from "./presentation-bridge.js";

const execFile = promisify(nodeExecFile);

export interface ApplicationConfig {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  routesPath: string;
  routes: Readonly<Record<string, Route>>;
  workspaceRoots: readonly string[];
  defaultWorkspaceRoot: string;
  workspaceAliases: Readonly<Record<string, string>>;
  sessionPath: string;
  historyPath: string;
  timeoutMs: number;
  maxOutputBytes: number;
  controlPlanePath: string;
  maxQueueDepth: number;
  rateLimitPerMinute: number;
  claudeModels: Readonly<Record<string, string>>;
  codexModels: Readonly<Record<string, string>>;
  claudeModel?: string;
  codexModel?: string;
  streamingDelivery: StreamingDeliveryPolicy;
  presentation: PresentationConfig;
}

export interface PresentationConfig {
  enabled: boolean;
  port: number;
  token?: string;
  error?: string;
}

export interface AgentRemoteApplication extends WhatsAppGatewayApplication {
  readonly routes: Readonly<Record<string, Route>>;
  readonly runtime: DeveloperAgentRuntime;
  readonly controlPlane: ControlPlane;
  readonly presentationBridge?: PresentationBridge;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ApplicationDependencies {
  runtime?: DeveloperAgentRuntime;
  whatsapp?: Pick<WhatsAppGatewayOptions, "onQr" | "logger" | "loadAuthState" | "createSocket">;
}

export function loadRoutes(path: string): Record<string, Route> {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read routes file ${path}`, { cause: error });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Routes file must contain an object");
  const routes: Record<string, Route> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid route ${key}`);
    const route = value as Record<string, unknown>;
    if (typeof route.id !== "string" || typeof route.agent !== "string" || (route.runtime !== "developer-agent" && route.runtime !== "chatbot")) {
      throw new Error(`Invalid route ${key}: id, runtime, and agent are required`);
    }
    if (route.workspaceRoot !== undefined && typeof route.workspaceRoot !== "string") throw new Error(`Invalid workspaceRoot for route ${key}`);
    routes[key] = {
      id: route.id,
      runtime: route.runtime,
      agent: route.agent,
      ...(typeof route.tenant === "string" ? { tenant: route.tenant } : {}),
      ...(typeof route.workspaceRoot === "string" ? { workspaceRoot: route.workspaceRoot } : {})
    };
  }
  return routes;
}

export function loadApplicationConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd()
): ApplicationConfig {
  const routesPath = resolveFrom(cwd, env.AGENT_REMOTE_ROUTES_PATH ?? "config/routes.json");
  const routes = loadRoutes(routesPath);
  const configuredRoots = parseList(env.AGENT_REMOTE_WORKSPACE_ROOTS);
  const routeRoots = Object.values(routes).flatMap(route => route.workspaceRoot ? [route.workspaceRoot] : []);
  const workspaceAliases = parseObject(env.AGENT_REMOTE_WORKSPACE_ALIASES);
  const claudeModel = optionalValue(env.AGENT_REMOTE_CLAUDE_MODEL);
  const codexModel = optionalValue(env.AGENT_REMOTE_CODEX_MODEL);
  const claudeModels = { ...parseObject(env.AGENT_REMOTE_CLAUDE_MODELS, "Claude model aliases"), ...(claudeModel ? { sonnet: claudeModel } : {}) };
  const codexModels = { ...parseObject(env.AGENT_REMOTE_CODEX_MODELS, "Codex model aliases"), ...(codexModel ? { luna: codexModel } : {}) };
  const presentation = parsePresentationConfig(env);
  const workspaceRoots = unique([...configuredRoots, ...routeRoots].map(root => resolveFrom(cwd, root)));
  if (workspaceRoots.length === 0) throw new Error("AGENT_REMOTE_WORKSPACE_ROOTS is required when routes have no workspaceRoot");
  const workspacePolicy = new WorkspacePolicy(workspaceRoots);
  const defaultWorkspaceRoot = workspacePolicy.assertPath(resolveFrom(cwd, env.AGENT_REMOTE_DEFAULT_WORKSPACE ?? workspaceRoots[0]));
  const resolvedWorkspaceAliases = Object.fromEntries(Object.entries(workspaceAliases).map(([alias, path]) => [alias, workspacePolicy.assertPath(resolveFrom(cwd, path))]));
  return {
    cwd,
    env,
    routesPath,
    routes,
    workspaceRoots,
    defaultWorkspaceRoot,
    workspaceAliases: resolvedWorkspaceAliases,
    sessionPath: resolveFrom(cwd, env.AGENT_REMOTE_SESSION_PATH ?? "data/developer-agent-sessions.json"),
    historyPath: resolveFrom(cwd, env.AGENT_REMOTE_HISTORY_PATH ?? "data/whatsapp-history.jsonl"),
    timeoutMs: positiveInteger(env.AGENT_REMOTE_TIMEOUT_MS, 120_000),
    maxOutputBytes: positiveInteger(env.AGENT_REMOTE_MAX_OUTPUT_BYTES, 64 * 1024),
    controlPlanePath: resolveFrom(cwd, env.AGENT_REMOTE_CONTROL_PLANE_PATH ?? "data/control-plane.json"),
    maxQueueDepth: positiveInteger(env.AGENT_REMOTE_MAX_QUEUE_DEPTH, 8),
    rateLimitPerMinute: positiveInteger(env.AGENT_REMOTE_RATE_LIMIT_PER_MINUTE, 60),
    claudeModels,
    codexModels,
    claudeModel,
    codexModel,
    streamingDelivery: {
      progressAfterMs: nonNegativeInteger(env.AGENT_REMOTE_PROGRESS_AFTER_MS, 0),
      progressText: optionalValue(env.AGENT_REMOTE_PROGRESS_TEXT) ?? "Sigo trabajando…",
      maxMessagesPerExecution: positiveInteger(env.AGENT_REMOTE_STREAM_MAX_MESSAGES, 2)
    },
    presentation
  };
}

export function createApplication(config: ApplicationConfig, dependencies: ApplicationDependencies = {}): AgentRemoteApplication {
  const events = new InMemoryEventBus();
  const history = new JsonHistoryStore(config.historyPath);
  const capabilities = createRestrictedDeveloperCapabilities(config.workspaceRoots, localOperations());
  const runtime = dependencies.runtime ?? new DeveloperAgentRuntime(capabilities, {
    adapters: {
      claude: createClaudeAdapter(() => resolveDeveloperExecutable("claude", config.env.AGENT_REMOTE_CLAUDE_EXECUTABLE)),
      codex: createCodexAdapter(() => resolveDeveloperExecutable("codex", config.env.AGENT_REMOTE_CODEX_EXECUTABLE)),
      copilot: createCopilotAdapter(() => resolveDeveloperExecutable("copilot", config.env.AGENT_REMOTE_COPILOT_EXECUTABLE))
    },
    sessions: new JsonDeveloperSessionStore(config.sessionPath),
    defaultWorkspaceRoot: config.defaultWorkspaceRoot,
    events,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: config.maxOutputBytes
  });
  const agents = Object.fromEntries(["claude", "codex", "copilot"].map(id => [id, createAgent(id)]));
  const deliveries = new Map<string, StreamDelivery>();
  let controlPlane!: ControlPlane;
  controlPlane = new ControlPlane({
    repositories: new JsonControlPlaneStore(config.controlPlanePath),
    agents,
    runtimes: { "developer-agent": runtime },
    workspacePolicy: capabilities.policy,
    workspaceAliases: config.workspaceAliases,
    defaultWorkspace: config.defaultWorkspaceRoot,
    modelPolicy: new ConfiguredModelPolicy({ claude: config.claudeModels, codex: config.codexModels }),
    maxQueueDepth: config.maxQueueDepth,
    rateLimitPerMinute: config.rateLimitPerMinute,
    history,
    resetProviderSession: (session, agent) => runtime.resetSession(session.channel, session.logicalSessionId, agent, session.workspace),
    onExecutionResponse: async (session, response) => {
      const executionId = response.metadata?.executionId;
      const delivery = executionId ? deliveries.get(executionId) : undefined;
      if (delivery) {
        await delivery.complete(response.text, response.origin);
        deliveries.delete(executionId!);
      } else await whatsapp.channel.send(session.externalConversationId, response);
      if (executionId) controlPlane.markExecutionTransportReply(executionId, true);
    },
    onExecutionAccepted: async (session, message) => {
      await whatsapp.channel.setPresence(session.externalConversationId, "composing");
    },
    onExecutionEvent: async (session, _message, event) => {
      if (event.type === "assistant.delta" && typeof event.payload?.text === "string") {
        let delivery = deliveries.get(event.executionId);
        if (!delivery) {
          delivery = new StreamDelivery(config.streamingDelivery, async value => {
            controlPlane.markExecutionTransportReply(event.executionId);
            await whatsapp.channel.send(session.externalConversationId, value);
          }, event.replyTo);
          deliveries.set(event.executionId, delivery);
        }
        await delivery.push(event.payload.text);
      }
      if (["execution.failed", "execution.cancelled"].includes(event.type)) {
        await deliveries.get(event.executionId)?.fail();
        deliveries.delete(event.executionId);
      }
      if (["execution.completed", "execution.failed", "execution.cancelled"].includes(event.type)) await whatsapp.channel.setPresence(session.externalConversationId, "paused");
    },
    version: "phase-6",
    diagnostics: () => "Run the gateway doctor command for provider and persistence diagnostics.",
    runtimeDiagnostics: async () => {
      const providers = await runtime.providerHealth();
      const providerSummary = Object.entries(providers).map(([id, availability]) => `${id}=${availability.available ? "available" : availability.reason}`).join(", ");
      return `Providers: ${providerSummary || "none"}\nSessions: ${runtime.sessionHealth().length}\nStreaming: ${config.streamingDelivery.progressAfterMs} ms progress / ${config.streamingDelivery.maxMessagesPerExecution} messages`;
    }
  });
  let whatsapp!: WhatsAppGatewayApplication;
  const pendingImportSelections = new Map<string, { candidates: HistoryChat[]; expiresAt: number; mode?: "more" | "full" }>();
  const importSelectionTtlMs = 5 * 60_000;
  const historyPageSize = 50;
  const completeImport = async (selected: HistoryChat, message: Message, channel: WhatsAppChannel, mode?: "more" | "full"): Promise<void> => {
    const result = await history.query("whatsapp", selected.conversationId, "", { maxMessages: 1, maxCharacters: mode ? 100_000 : 1 });
    if (!mode && result?.importedMessageCount) {
      await channel.send(message.conversationId, { text: `Conversation imported: ${selected.displayName}. You can ask about it with /chat "${selected.displayName}" <question>.`, replyTo: message.replyReference });
      return;
    }
    const fallbackAnchor = result?.messages[0] ? { id: result.messages[0].id, timestamp: result.messages[0].receivedAt.getTime(), fromMe: false } : undefined;
    if (mode) {
      let batches = 0;
      let downloaded = 0;
      let complete = false;
      let emptyPage = false;
      let timedOut = false;
      while (mode === "full" || batches === 0) {
        const page = await channel.requestChatHistoryPage(selected.conversationId, historyPageSize, batches === 0 ? fallbackAnchor : undefined);
        if (!page.requested) break;
        batches++;
        if (page.messageCount === undefined) {
          timedOut = true;
          break;
        }
        downloaded += page.messageCount;
        if (page.messageCount === 0) {
          emptyPage = true;
          break;
        }
        if (page.messageCount < historyPageSize) {
          complete = true;
          break;
        }
        if (batches >= 100) break;
      }
      const updated = await history.query("whatsapp", selected.conversationId, "", { maxMessages: 1, maxCharacters: 1 });
      if (!batches) {
        await channel.send(message.conversationId, { text: "No se pudo solicitar más historial de " + selected.displayName + ": WhatsApp no tiene un mensaje de referencia disponible en este dispositivo.", replyTo: message.replyReference });
        return;
      }
      const imported = updated?.importedMessageCount ?? result?.importedMessageCount ?? 0;
      const suffix = complete
        ? " WhatsApp ha entregado un bloque final; no se han recibido más mensajes en esta descarga."
        : emptyPage
          ? " WhatsApp no entregó mensajes adicionales en esta solicitud; no puedo confirmar que no haya más. Reintenta /import " + selected.displayName + " más."
          : timedOut
            ? " WhatsApp no confirmó el bloque solicitado; no puedo confirmar que no haya más. Reintenta /import " + selected.displayName + " más."
            : " La descarga puede continuar con otro /import ... más.";
      const text = mode === "full"
        ? "Historial completo solicitado para " + selected.displayName + ": " + imported + " mensajes disponibles (" + downloaded + " nuevos en " + batches + " bloques)." + suffix
        : "Historial ampliado para " + selected.displayName + ": " + imported + " mensajes disponibles (" + downloaded + " nuevos).";
      await channel.send(message.conversationId, { text, replyTo: message.replyReference });
      return;
    }
    if (await channel.requestChatHistory(selected.conversationId)) {
      await channel.send(message.conversationId, { text: `Import requested for ${selected.displayName}. Wait a moment, then ask with /chat "${selected.displayName}" <question>.`, replyTo: message.replyReference });
      return;
    }
    await channel.send(message.conversationId, { text: `Conversation found: ${selected.displayName}, but WhatsApp has not delivered its messages to this linked device yet.`, replyTo: message.replyReference });
  };
  whatsapp = createWhatsAppGateway({
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter(config.routes),
    runtimes: { "developer-agent": runtime },
    agents,
    events
  }, {
    env: config.env,
    historySink: history,
    ...dependencies.whatsapp,
    onQr: dependencies.whatsapp?.onQr ?? printQr,
    onMessage: async (message, channel) => {
      if (message.text.trim().startsWith("/")) pendingImportSelections.delete(message.conversationId);
      const result = await controlPlane.handle(message, { id: resolveWhatsAppIdentity(config.env, message.senderId), role: resolveWhatsAppRole(config.env, message.senderId) });
      const delivery = result.metadata?.executionId ? deliveries.get(result.metadata.executionId) : undefined;
      if (delivery && result.metadata?.executionId) {
        await delivery.complete(result.text, result.origin);
        deliveries.delete(result.metadata.executionId);
      } else await channel.send(message.conversationId, result);
      if (result.metadata?.executionId) controlPlane.markExecutionTransportReply(result.metadata.executionId, true);
    },
    onImportSelection: async (message, channel) => {
      const pending = pendingImportSelections.get(message.conversationId);
      if (!pending) return false;
      if (Date.now() > pending.expiresAt) {
        pendingImportSelections.delete(message.conversationId);
        await channel.send(message.conversationId, { text: "The import selection expired. Send /import <name> again.", replyTo: message.replyReference });
        return true;
      }
      const value = message.text.trim();
      let selected: HistoryChat | undefined;
      if (/^\d+$/.test(value)) {
        const index = Number(value) - 1;
        selected = Number.isInteger(index) ? pending.candidates[index] : undefined;
        if (!selected) {
          await channel.send(message.conversationId, { text: `Choose a number from 1 to ${pending.candidates.length}.`, replyTo: message.replyReference });
          return true;
        }
      } else {
        const normalized = normalizeHistorySearch(value);
        const matches = pending.candidates.filter(chat => normalizeHistorySearch(chat.displayName) === normalized || normalizeHistorySearch(chat.conversationId) === normalized);
        if (matches.length !== 1) {
          await channel.send(message.conversationId, { text: `Reply with a number from 1 to ${pending.candidates.length}, or the full chat name/ID.`, replyTo: message.replyReference });
          return true;
        }
        selected = matches[0];
      }
      pendingImportSelections.delete(message.conversationId);
      await completeImport(selected, message, channel, pending.mode);
      return true;
    },
    onImportFile: async (file: WhatsAppImportFile, channel) => {
      if (resolveWhatsAppRole(config.env, file.message.senderId) === "viewer") {
        await channel.send(file.message.conversationId, { text: "You are not authorized to import chat history.", replyTo: file.message.replyReference });
        return;
      }
      const request = parseWhatsAppImportCommand(file.message.text);
      const fallbackName = file.fileName.replace(/\.[^.]+$/, "").trim() || "WhatsApp export";
      const name = request?.name || fallbackName;
      try {
        const imported = parseWhatsAppExport(name, file.data);
        await history.importChat(imported.chat, imported.messages);
        await channel.send(file.message.conversationId, { text: `Imported ${imported.messages.length} messages from ${imported.chat.displayName}. Ask about it with /chat "${imported.chat.displayName}" <question>.`, replyTo: file.message.replyReference });
      } catch (error) {
        await channel.send(file.message.conversationId, { text: `Unable to import chat: ${error instanceof Error ? error.message : "invalid export"}`, replyTo: file.message.replyReference });
      }
    },
    onImportRequest: async (request: WhatsAppImportRequest, channel) => {
      for (const chat of channel.knownChats()) await history.upsertChat(chat);
      const chats = await history.listChats("whatsapp", request.name, 1000);
      if (!request.name) {
        await channel.send(request.message.conversationId, { text: chats.length ? `Available chats:\n${chats.map(chat => `${chat.displayName} (${chat.conversationId})`).join("\n")}` : "Use /importar <name> to choose a WhatsApp conversation.", replyTo: request.message.replyReference });
        return;
      }
      const source = normalizeHistorySearch(request.name);
      const partial = chats.filter(chat => historySearchMatches(chat.displayName, request.name!) || normalizeHistorySearch(chat.conversationId).includes(source));
      const exact = partial.filter(chat => normalizeHistorySearch(chat.displayName) === source || normalizeHistorySearch(chat.conversationId) === source);
      if (exact.length !== 1) {
        const candidates = exact.length ? exact : partial;
        if (candidates.length) pendingImportSelections.set(request.message.conversationId, { candidates, expiresAt: Date.now() + importSelectionTtlMs, ...(request.mode ? { mode: request.mode } : {}) });
        await channel.send(request.message.conversationId, {
          text: candidates.length
            ? `Choose the conversation by full name or ID:\n${candidates.map((chat, index) => `${index + 1}. ${chat.displayName} (${chat.conversationId})`).join("\n")}`
            : `Conversation not found in the WhatsApp history received by this device: ${request.name}`,
          replyTo: request.message.replyReference
        });
        return;
     }
     const selected = exact[0];
      await completeImport(selected, request.message, channel, request.mode);
    },
    onImportError: async (message, _error, channel) => {
      await channel.send(message.conversationId, { text: "Unable to download the attached export. Try sending the .txt file again.", replyTo: message.replyReference });
    },
    onError: async (error, payload, channel) => {
      const message = messageFromPayload(payload);
      if (message) await channel.send(message.conversationId, { text: formatOperationalError(error, message.conversationId) });
    }
  });
  if (config.presentation.error) throw new Error(config.presentation.error);
  const presentationBridge = config.presentation.enabled
    ? createPresentationBridge({
      host: "127.0.0.1",
      port: config.presentation.port,
      token: config.presentation.token!,
      readRegistry: () => whatsapp.channel.agentMessageRegistry(),
      allowedOrigin: "https://web.whatsapp.com"
    })
    : undefined;
  return {
    ...whatsapp,
    routes: config.routes,
    runtime,
    controlPlane,
    presentationBridge,
    start: async () => { await controlPlane.load(); await history.listChats("whatsapp", undefined, 0); await whatsapp.channel.start(); await presentationBridge?.start(); },
    stop: async () => { await presentationBridge?.stop(); controlPlane.stopAccepting(); await controlPlane.drain(config.timeoutMs); await runtime.close(); await whatsapp.channel.stop(); }
  };
}

export function formatWorkspaceCommand(
  conversationId: string,
  routes: Readonly<Record<string, Route>>,
  defaultWorkspaceRoot: string
): string {
  return routes[`whatsapp-${conversationId}`]?.workspaceRoot ?? defaultWorkspaceRoot;
}

export function loadEnvironment(cwd = process.cwd(), source: Readonly<Record<string, string | undefined>> = process.env): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  try {
    for (const line of readFileSync(resolve(cwd, ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {}
  return { ...values, ...source };
}

function localOperations(): LocalDeveloperOperations {
  return {
    shell: async () => { throw new Error("Shell capabilities are not exposed through WhatsApp"); },
    readFile: path => readFile(path, "utf8"),
    writeFile: (path, contents) => writeFile(path, contents, "utf8"),
    git: async (args, cwd) => (await execFile("git", [...args], { cwd })).stdout
  };
}

function createAgent(id: string): ConversationAgent {
  return { id, type: "developer-agent", handleMessage: async () => { throw new Error("The runtime owns developer-agent execution"); } };
}

function parseList(value: string | undefined): string[] {
  return value?.split(",").map(item => item.trim()).filter(Boolean) ?? [];
}

function parseObject(value: string | undefined, label = "Object configuration"): Record<string, string> {
  if (!value?.trim()) return {};
  let data: unknown;
  try { data = JSON.parse(value); } catch (error) { throw new Error(`Invalid JSON object configuration: ${value}`, { cause: error }); }
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.entries(data).some(([key, item]) => !key || typeof item !== "string" || !item.trim())) throw new Error(`${label} must be a JSON object of non-empty strings`);
  return data as Record<string, string>;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer configuration value: ${value}`);
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid non-negative integer configuration value: ${value}`);
  return parsed;
}

function resolveFrom(cwd: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function printQr(qr: string): void {
  console.log("WhatsApp QR — abre WhatsApp > Dispositivos vinculados > Vincular un dispositivo:");
  qrcode.generate(qr, { small: true });
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parsePresentationConfig(env: Readonly<Record<string, string | undefined>>): PresentationConfig {
  const rawEnabled = env.AGENT_REMOTE_PRESENTATION_ENABLED?.trim().toLowerCase();
  if (rawEnabled !== undefined && rawEnabled !== "" && rawEnabled !== "true" && rawEnabled !== "false") {
    return { enabled: false, port: 8765, error: "AGENT_REMOTE_PRESENTATION_ENABLED must be true or false" };
  }
  const enabled = rawEnabled === "true";
  const rawPort = env.AGENT_REMOTE_PRESENTATION_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 8765;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { enabled, port: 8765, error: "AGENT_REMOTE_PRESENTATION_PORT must be an integer from 1 to 65535" };
  }
  const token = optionalValue(env.AGENT_REMOTE_PRESENTATION_TOKEN);
  if (enabled && !token) return { enabled, port, error: "AGENT_REMOTE_PRESENTATION_TOKEN is required when presentation is enabled" };
  return { enabled, port, ...(token ? { token } : {}) };
}

export function resolveWhatsAppRole(env: Readonly<Record<string, string | undefined>>, senderId: string): Role {
  const owners = parseList(env.AGENT_REMOTE_OWNER_IDS);
  const operators = parseList(env.AGENT_REMOTE_OPERATOR_IDS);
  const viewers = parseList(env.AGENT_REMOTE_VIEWER_IDS);
  if (viewers.includes(senderId)) return "viewer";
  if (operators.includes(senderId)) return "operator";
  if (owners.includes(senderId)) return "owner";
  if (env.WHATSAPP_ALLOW_SELF_MESSAGES?.trim().toLowerCase() === "true") return "owner";
  if (parseList(env.WHATSAPP_ALLOWED_USERS).includes(senderId)) return "owner";
  return "viewer";
}

export function resolveWhatsAppIdentity(env: Readonly<Record<string, string | undefined>>, senderId: string): string {
  const allowlistedUsers = parseList(env.WHATSAPP_ALLOWED_USERS);
  const phoneIdentity = allowlistedUsers.filter(value => value.endsWith("@s.whatsapp.net"));
  return env.WHATSAPP_ALLOW_SELF_MESSAGES?.trim().toLowerCase() === "true" && phoneIdentity.length === 1
    ? phoneIdentity[0]
    : senderId;
}

function messageFromPayload(payload: unknown): Message | undefined {
  if (isMessage(payload)) return payload;
  return translateWhatsAppMessage(payload) ?? undefined;
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<Message>;
  return typeof message.id === "string" && typeof message.conversationId === "string" && typeof message.channel === "string"
    && typeof message.senderId === "string" && typeof message.text === "string" && message.receivedAt instanceof Date;
}
