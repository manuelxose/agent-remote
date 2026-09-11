import { execFile as nodeExecFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { isAbsolute, resolve } from "node:path";
import qrcode from "qrcode-terminal";
import type { ConversationAgent, Message, Route } from "../../../packages/core/src/index.js";
import { InMemoryConversationStore } from "../../../packages/conversations/src/index.js";
import { InMemoryEventBus } from "../../../packages/events/src/index.js";
import { ConfigurationRouter } from "../../../packages/routing/src/index.js";
import { createRestrictedDeveloperCapabilities, type LocalDeveloperOperations } from "../../../packages/security/src/index.js";
import { createClaudeAdapter } from "../../../developer-agents/claude/src/index.js";
import { createCodexAdapter } from "../../../developer-agents/codex/src/index.js";
import { createCopilotAdapter } from "../../../developer-agents/copilot/src/index.js";
import { DeveloperAgentRuntime } from "../../../runtime/developer-agent/src/index.js";
import { JsonDeveloperSessionStore } from "../../../runtime/developer-agent/src/sessions.js";
import { createWhatsAppGateway, type WhatsAppGatewayApplication } from "./whatsapp.js";
import { formatOperationalError } from "./doctor.js";
import { translateWhatsAppMessage } from "../../../channels/whatsapp/src/index.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";

const execFile = promisify(nodeExecFile);

export interface ApplicationConfig {
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  routesPath: string;
  routes: Readonly<Record<string, Route>>;
  workspaceRoots: readonly string[];
  defaultWorkspaceRoot: string;
  sessionPath: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface AgentRemoteApplication extends WhatsAppGatewayApplication {
  readonly routes: Readonly<Record<string, Route>>;
  readonly runtime: DeveloperAgentRuntime;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type OneNumberCommand =
  | { kind: "init" }
  | { kind: "agent"; agent: "claude" | "codex"; prompt: string };

export type OneNumberCommandAction = "initialize" | "workspace" | "agent" | "usage" | "ignore";

export function parseOneNumberCommand(text: string): OneNumberCommand | undefined {
  const command = text.trim();
  if (/^\/init$/i.test(command)) return { kind: "init" };
  const match = command.match(/^\/(claude|codex)(?:\s+(.+))$/is);
  if (!match) return undefined;
  return { kind: "agent", agent: match[1].toLowerCase() as "claude" | "codex", prompt: match[2].trim() };
}

export function oneNumberCommandAction(
  conversationId: string,
  text: string,
  initializedConversations: ReadonlySet<string>
): OneNumberCommandAction {
  const command = text.trim();
  if (/^\/init$/i.test(command)) return "initialize";
  if (!initializedConversations.has(conversationId)) return "ignore";
  if (/^\/workspace$/i.test(command)) return "workspace";
  if (/^\/(claude|codex)$/i.test(command)) return "usage";
  return parseOneNumberCommand(command)?.kind === "agent" ? "agent" : "ignore";
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
  const workspaceRoots = unique([...configuredRoots, ...routeRoots].map(root => resolveFrom(cwd, root)));
  if (workspaceRoots.length === 0) throw new Error("AGENT_REMOTE_WORKSPACE_ROOTS is required when routes have no workspaceRoot");
  const defaultWorkspaceRoot = resolveFrom(cwd, env.AGENT_REMOTE_DEFAULT_WORKSPACE ?? workspaceRoots[0]);
  return {
    cwd,
    env,
    routesPath,
    routes,
    workspaceRoots,
    defaultWorkspaceRoot,
    sessionPath: resolveFrom(cwd, env.AGENT_REMOTE_SESSION_PATH ?? "data/developer-agent-sessions.json"),
    timeoutMs: positiveInteger(env.AGENT_REMOTE_TIMEOUT_MS, 120_000),
    maxOutputBytes: positiveInteger(env.AGENT_REMOTE_MAX_OUTPUT_BYTES, 64 * 1024)
  };
}

export function createApplication(config: ApplicationConfig): AgentRemoteApplication {
  const events = new InMemoryEventBus();
  const initializedConversations = new Set<string>();
  const capabilities = createRestrictedDeveloperCapabilities(config.workspaceRoots, localOperations());
  const runtime = new DeveloperAgentRuntime(capabilities, {
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
  const whatsapp = createWhatsAppGateway({
    conversations: new InMemoryConversationStore(),
    router: new ConfigurationRouter(config.routes),
    runtimes: { "developer-agent": runtime },
    agents,
    events
  }, {
    env: config.env,
    onQr: printQr,
    onCommand: async (payload, channel, gateway) => {
      const message = messageFromPayload(payload);
      if (!message) return false;
      const action = oneNumberCommandAction(message.conversationId, message.text, initializedConversations);
      if (action === "ignore") return true;
      if (action === "initialize") {
        initializedConversations.add(message.conversationId);
        await channel.send(message.conversationId, { text: "✅ One-number mode ready.\n\n/claude <prompt> — Claude Code\n/codex <prompt> — Codex\n/workspace — show workspace" });
        return true;
      }
      if (action === "workspace") {
        await channel.send(message.conversationId, { text: `Workspace: ${formatWorkspaceCommand(message.conversationId, config.routes, config.defaultWorkspaceRoot)}` });
        return true;
      }
      if (action === "usage") {
        await channel.send(message.conversationId, { text: "Uso: /claude <prompt> o /codex <prompt>" });
        return true;
      }
      const command = parseOneNumberCommand(message.text);
      if (!command || command.kind !== "agent") return true;
      await gateway.handle({ ...message, text: command.prompt }, {
        id: `whatsapp-one-number-${command.agent}`,
        runtime: "developer-agent",
        agent: command.agent,
        workspaceRoot: config.defaultWorkspaceRoot
      });
      return true;
    },
    onError: async (error, payload, channel) => {
      const message = messageFromPayload(payload);
      if (message) await channel.send(message.conversationId, { text: formatOperationalError(error, message.conversationId) });
    }
  });
  return {
    ...whatsapp,
    routes: config.routes,
    runtime,
    start: () => whatsapp.channel.start(),
    stop: () => whatsapp.channel.stop()
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

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer configuration value: ${value}`);
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

function messageFromPayload(payload: unknown): Message | undefined {
  if (isMessage(payload)) return payload;
  return translateWhatsAppMessage(payload) ?? undefined;
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<Message>;
  return typeof message.id === "string"
    && typeof message.conversationId === "string"
    && typeof message.channel === "string"
    && typeof message.senderId === "string"
    && typeof message.text === "string"
    && message.receivedAt instanceof Date;
}
