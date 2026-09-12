import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createApplication, formatWorkspaceCommand, loadApplicationConfig, loadRoutes, resolveWhatsAppIdentity, resolveWhatsAppRole } from "../dist/apps/gateway/src/application.js";
import { formatOperationalError, runDoctor } from "../dist/apps/gateway/src/doctor.js";
import { RouteNotFoundError } from "../dist/packages/routing/src/index.js";
import { acquireProcessLock } from "../dist/apps/gateway/src/lock.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { DeveloperAgentRuntime } from "../dist/runtime/developer-agent/src/index.js";
import { InMemoryDeveloperSessionStore } from "../dist/runtime/developer-agent/src/sessions.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

class FakeEvents {
  private readonly listeners = new Map<string, Set<(value: any) => void>>();
  on(event: string, listener: (value: any) => void): void { const listeners = this.listeners.get(event) ?? new Set(); listeners.add(listener); this.listeners.set(event, listeners); }
  off(event: string, listener: (value: any) => void): void { this.listeners.get(event)?.delete(listener); }
  emit(event: string, value: any): void { for (const listener of this.listeners.get(event) ?? []) listener(value); }
  count(event: string): number { return this.listeners.get(event)?.size ?? 0; }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve));
}

async function waitForHistory(path: string, text: string): Promise<string> {
  for (let index = 0; index < 100; index += 1) {
    try {
      const contents = await readFile(path, "utf8");
      if (contents.includes(text)) return contents;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  return readFile(path, "utf8");
}

async function gatewayFixture(adapter: any) {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-presentation-"));
  const routesPath = join(directory, "routes.json");
  await writeFile(routesPath, "{}");
  const config = loadApplicationConfig({
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_CONTROL_PLANE_PATH: join(directory, "control-plane.json"),
    AGENT_REMOTE_HISTORY_PATH: join(directory, "whatsapp-history.jsonl"),
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "a@s.whatsapp.net,b@s.whatsapp.net"
  }, process.cwd());
  const events = new FakeEvents();
  const sent: any[] = [];
  const messages: any[] = [];
  const messageWaiters = new Set<() => void>();
  const waitForMessages = async (count: number): Promise<void> => {
    if (messages.length >= count) return;
    await new Promise<void>(resolve => {
      const check = () => {
        if (messages.length < count) return;
        messageWaiters.delete(check);
        resolve();
      };
      messageWaiters.add(check);
    });
  };
  const socket = {
    ev: events,
    async sendMessage(...args: any[]) { sent.push(args); messages.push(args); for (const waiter of messageWaiters) waiter(); return { key: { id: `out-${sent.length}` } }; },
    async sendPresenceUpdate(...args: any[]) { sent.push(["presence", ...args]); },
    async end() {}
  };
  const runtime = new DeveloperAgentRuntime({
    policy: new WorkspacePolicy([process.cwd()]), shell: async () => "", readFile: async () => "", writeFile: async () => undefined, git: async () => ""
  }, {
    adapters: { codex: adapter }, sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: process.cwd(), events: new InMemoryEventBus()
  });
  const application = createApplication(config, {
    runtime,
    whatsapp: {
      loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
      createSocket: () => socket,
      logger: { info() {}, warn() {}, error() {} }
    }
  } as any);
  assert.equal(application.runtime, runtime);
  await application.start();
  events.emit("connection.update", { connection: "open" });
  await settle();
  assert.equal(application.channel.health().status, "connected");
  assert.equal(events.count("messages.upsert"), 1);
  return { application, events, sent, waitForMessages };
}

function receive(events: FakeEvents, id: string, text: string, conversationId = "a@s.whatsapp.net"): void {
  events.emit("messages.upsert", { messages: [{ key: { id, remoteJid: conversationId }, message: { conversation: text } }] });
}

test("loads routes and composes the existing developer-agent graph", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-operational-"));
  const routesPath = join(directory, "routes.json");
  await writeFile(routesPath, JSON.stringify({
    "whatsapp-chat": {
      id: "whatsapp-chat",
      runtime: "developer-agent",
      agent: "codex",
      workspaceRoot: process.cwd()
    }
  }));

  const routes = loadRoutes(routesPath);
  const config = loadApplicationConfig({
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  const application = createApplication({ ...config, routes });

  assert.equal(application.channel.id, "whatsapp");
  assert.equal(application.routes["whatsapp-chat"].agent, "codex");
  assert.deepEqual(await application.runtime.getAvailability("codex"), await application.runtime.getAvailability("codex"));
  await application.stop();
  await application.stop();
});

test("loads the default and configured persistent WhatsApp history paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-config-"));
  const routesPath = join(directory, "routes.json");
  await writeFile(routesPath, "{}");
  const env = {
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  };

  assert.equal(loadApplicationConfig(env, directory).historyPath, join(directory, "data", "whatsapp-history.jsonl"));
  assert.equal(loadApplicationConfig({ ...env, AGENT_REMOTE_HISTORY_PATH: "data/imported-history.jsonl" }, directory).historyPath, join(directory, "data", "imported-history.jsonl"));
});

test("application reloads persisted WhatsApp messages for control-plane history queries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-compose-"));
  const routesPath = join(directory, "routes.json");
  await writeFile(routesPath, "{}");
  const events = new FakeEvents();
  const socket = {
    ev: events,
    async sendMessage() { return { key: { id: "out" } }; },
    async sendPresenceUpdate() {},
    async end() {}
  };
  const env = {
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_HISTORY_PATH: "data/imported-history.jsonl",
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  };
  const config = loadApplicationConfig(env, directory);
  const application = createApplication(config, {
    whatsapp: {
      loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
      createSocket: () => socket,
      logger: { info() {}, warn() {}, error() {} }
    }
  } as any);

  try {
    await application.start();
    events.emit("messaging-history.set", {
      chats: [{ id: "source@g.us", subject: "Source chat" }],
      messages: [{ key: { id: "history-message", remoteJid: "source@g.us", participant: "friend@s.whatsapp.net" }, message: { conversation: "saved history message" } }]
    });
    await settle();
    assert.match(await waitForHistory(config.historyPath, "saved history message"), /saved history message/);
  } finally {
    await application.stop();
  }

  const prompts: string[] = [];
  const runtime = new DeveloperAgentRuntime({
    policy: new WorkspacePolicy([process.cwd()]), shell: async () => "", readFile: async () => "", writeFile: async () => undefined, git: async () => ""
  }, {
    adapters: {
      codex: {
        id: "codex",
        async isAvailable() { return true; },
        async getAvailability() { return { available: true as const, executable: "codex" }; },
        async execute(request: any) { prompts.push(request.prompt); return { status: "completed" as const, text: "answer", sessionId: "native-history" }; }
      }
    },
    sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: process.cwd(), events: new InMemoryEventBus()
  });
  const restartedEvents = new FakeEvents();
  const restartedSocket = {
    ev: restartedEvents,
    async sendMessage() { return { key: { id: "out" } }; },
    async sendPresenceUpdate() {},
    async end() {}
  };
  const restarted = createApplication(loadApplicationConfig(env, directory), {
    runtime,
    whatsapp: {
      loadAuthState: async () => ({ state: {} as any, saveCreds: async () => {} }),
      createSocket: () => restartedSocket,
      logger: { info() {}, warn() {}, error() {} }
    }
  } as any);
  try {
    await restarted.start();
    const identity = { id: "owner@s.whatsapp.net", role: "owner" as const };
    const message = (id: string, text: string) => ({ id, channel: "whatsapp", conversationId: "owner@s.whatsapp.net", senderId: "owner@s.whatsapp.net", text, receivedAt: new Date() });
    await restarted.controlPlane.handle(message("history-init", "/init"), identity);
    await restarted.controlPlane.handle(message("history-agent", "/codex"), identity);
    const result = await restarted.controlPlane.handle(message("history-query", "/chat \"Source chat\" what was saved"), identity);
    assert.equal(result.status, undefined);
    assert.match(prompts[0] ?? "", /saved history message/);
  } finally {
    await restarted.stop();
  }
});

test("gateway presents a successful execution without a processing acknowledgement", async () => {
  const adapter = {
    id: "codex",
    async isAvailable() { return true; },
    async getAvailability() { return { available: true as const, executable: "codex" }; },
    async execute(request: any, execution: any) {
      await execution.observer?.onEvent({ type: "assistant.delta", occurredAt: new Date(), executionId: request.executionId, correlationId: request.correlationId, logicalSessionId: request.logicalSessionId, payload: { text: "partial" } });
      return { status: "completed" as const, text: "final", sessionId: "native-a" };
    }
  };
  const { application, events, sent, waitForMessages } = await gatewayFixture(adapter);
  try {
    receive(events, "init-a", "/init");
    await waitForMessages(1);
    receive(events, "agent-a", "/codex");
    await waitForMessages(2);
    receive(events, "prompt-a", "hello");
    await waitForMessages(3);

    const generated = application.channel.agentMessageRegistry().filter(message => message.origin?.executionId === "prompt-a");
    assert.deepEqual(sent.filter(message => message[0] === "presence"), [["presence", "composing", "a@s.whatsapp.net"], ["presence", "paused", "a@s.whatsapp.net"]]);
    assert.equal(sent.some(message => String(message[1]?.text ?? "").includes("Procesando")), false);
    assert.deepEqual(generated.map(message => ({ replyTo: message.replyToMessageId, origin: message.origin })), [{
      replyTo: "prompt-a", origin: { type: "agent", agentId: "codex", executionId: "prompt-a", logicalSessionId: generated[0]?.origin?.logicalSessionId }
    }]);
  } finally {
    await application.stop();
  }
});

test("gateway pauses failed and cancelled runtime executions without delayed delivery", async () => {
  let entered!: () => void;
  const enteredCancellation = new Promise<void>(resolve => { entered = resolve; });
  const adapter = {
    id: "codex",
    async isAvailable() { return true; },
    async getAvailability() { return { available: true as const, executable: "codex" }; },
    async execute(request: any, execution: any) {
      if (request.prompt === "fail") return { status: "failed" as const, reason: "execution-failed" as const };
      entered();
      await new Promise<void>(resolve => execution.signal?.addEventListener("abort", () => resolve(), { once: true }));
      return { status: "failed" as const, reason: "cancelled" as const };
    }
  };
  const { application, events, sent, waitForMessages } = await gatewayFixture(adapter);
  try {
    receive(events, "init-a", "/init");
    await waitForMessages(1);
    receive(events, "agent-a", "/codex");
    await waitForMessages(2);
    receive(events, "fail-a", "fail");
    await waitForMessages(3);
    receive(events, "cancel-a", "cancel");
    await enteredCancellation;
    receive(events, "stop-a", "/cancel");
    await waitForMessages(5);

    const presences = sent.filter(message => message[0] === "presence");
    assert.equal(presences.filter(message => message[1] === "composing").length, 2);
    assert.equal(presences.filter(message => message[1] === "paused").length, 2);
    assert.equal(application.channel.agentMessageRegistry().some(message => message.origin?.executionId === "fail-a" || message.origin?.executionId === "cancel-a"), true);
    assert.equal(sent.some(message => String(message[1]?.text ?? "").includes("Procesando")), false);
  } finally {
    await application.stop();
  }
});

test("gateway keeps concurrent execution reply references and origins distinct", async () => {
  const adapter = {
    id: "codex",
    async isAvailable() { return true; },
    async getAvailability() { return { available: true as const, executable: "codex" }; },
    async execute(request: any) { return { status: "completed" as const, text: `final:${request.prompt}`, sessionId: `native-${request.executionId}` }; }
  };
  const { application, events, waitForMessages } = await gatewayFixture(adapter);
  try {
    receive(events, "init-a", "/init", "a@s.whatsapp.net");
    await waitForMessages(1);
    receive(events, "agent-a", "/codex", "a@s.whatsapp.net");
    await waitForMessages(2);
    receive(events, "init-b", "/init", "b@s.whatsapp.net");
    await waitForMessages(3);
    receive(events, "agent-b", "/codex", "b@s.whatsapp.net");
    await waitForMessages(4);
    receive(events, "prompt-a", "alpha", "a@s.whatsapp.net");
    receive(events, "prompt-b", "beta", "b@s.whatsapp.net");
    await waitForMessages(6);

    const generated = application.channel.agentMessageRegistry().filter(message => message.origin?.executionId === "prompt-a" || message.origin?.executionId === "prompt-b");
    assert.deepEqual(generated.map(message => ({ replyTo: message.replyToMessageId, executionId: message.origin?.executionId, agentId: message.origin?.agentId })).sort((left, right) => left.replyTo.localeCompare(right.replyTo)), [
      { replyTo: "prompt-a", executionId: "prompt-a", agentId: "codex" },
      { replyTo: "prompt-b", executionId: "prompt-b", agentId: "codex" }
    ]);
  } finally {
    await application.stop();
  }
});

test("loads final-only WhatsApp delivery settings", () => {
  const config = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_PROGRESS_AFTER_MS: "250",
    AGENT_REMOTE_PROGRESS_TEXT: "Sigo trabajando…",
    AGENT_REMOTE_STREAM_MAX_MESSAGES: "4",
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  assert.deepEqual(config.streamingDelivery, { progressAfterMs: 250, progressText: "Sigo trabajando…", maxMessagesPerExecution: 4 });
  const defaults = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  assert.deepEqual(defaults.streamingDelivery, { progressAfterMs: 0, progressText: "Sigo trabajando…", maxMessagesPerExecution: 2 });
  assert.throws(() => loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_PROGRESS_AFTER_MS: "-1",
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd()), /non-negative integer/);
});

test("loads opt-in presentation bridge configuration without exposing its token", async () => {
  const disabled = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  const enabled = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net",
    AGENT_REMOTE_PRESENTATION_ENABLED: "true",
    AGENT_REMOTE_PRESENTATION_PORT: "9876",
    AGENT_REMOTE_PRESENTATION_TOKEN: "secret-presentation-token"
  }, process.cwd());
  const invalid = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net",
    AGENT_REMOTE_PRESENTATION_ENABLED: "true"
  }, process.cwd());

  assert.deepEqual(disabled.presentation, { enabled: false, port: 8765 });
  assert.deepEqual(enabled.presentation, { enabled: true, port: 9876, token: "secret-presentation-token" });
  assert.match(invalid.presentation.error ?? "", /token/i);
  const report = await runDoctor(invalid, { resolveExecutable: async () => undefined, readVersion: async () => "" });
  const bridge = report.find(check => check.name === "Presentation bridge");
  assert.equal(bridge?.status, "FAIL");
  assert.doesNotMatch(bridge?.message ?? "", /secret-presentation-token/);
});

test("application control-plane state survives restart without reinitialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-restart-"));
  const routesPath = join(directory, "routes.json");
  const controlPlanePath = join(directory, "control-plane.json");
  await writeFile(routesPath, JSON.stringify({}));
  const env = {
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_CONTROL_PLANE_PATH: controlPlanePath,
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  };
  const first = createApplication(loadApplicationConfig(env, process.cwd()));
  const message = (id: string, text: string) => ({ id, channel: "whatsapp", conversationId: "chat", senderId: "owner@s.whatsapp.net", text, receivedAt: new Date() });
  await first.controlPlane.handle(message("init", "/init backend-api"), { id: "owner@s.whatsapp.net", role: "owner" });
  await first.controlPlane.handle(message("claude", "/claude"), { id: "owner@s.whatsapp.net", role: "owner" });
  await first.stop();
  const second = createApplication(loadApplicationConfig(env, process.cwd()));
  const status = await second.controlPlane.handle(message("status", "/status"), { id: "owner@s.whatsapp.net", role: "owner" });
  assert.match(status.text, /backend-api/);
  assert.match((await second.controlPlane.handle(message("agent", "/agent"), { id: "owner@s.whatsapp.net", role: "owner" })).text, /claude/);
  await second.stop();
});

test("requires approved workspace roots before composing the gateway", () => {
  assert.throws(() => loadApplicationConfig({
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd()), /AGENT_REMOTE_WORKSPACE_ROOTS/);
});

test("one-number self identities receive owner role when self-messages are enabled", () => {
  assert.equal(resolveWhatsAppRole({ WHATSAPP_ALLOW_SELF_MESSAGES: "true", WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net" }, "owner@lid"), "owner");
});

test("one-number self identities use the stable allowlisted identity", () => {
  assert.equal(resolveWhatsAppIdentity({ WHATSAPP_ALLOW_SELF_MESSAGES: "true", WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net" }, "owner@lid"), "owner@s.whatsapp.net");
});

test("one-number self identities retain their phone identity when a LID alias is allowlisted", () => {
  assert.equal(resolveWhatsAppIdentity({
    WHATSAPP_ALLOW_SELF_MESSAGES: "true",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net,owner@lid"
  }, "owner@lid"), "owner@s.whatsapp.net");
});

test("rejects a default workspace outside approved roots", () => {
  assert.throws(() => loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_DEFAULT_WORKSPACE: "/tmp",
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd()), /approved workspace roots/i);
});

test("loads workspace aliases only when they are approved", () => {
  const config = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_WORKSPACE_ALIASES: JSON.stringify({ repo: "." }),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  assert.equal(config.workspaceAliases.repo, process.cwd());
});

test("loads configurable provider model aliases", () => {
  const config = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_CODEX_MODELS: JSON.stringify({ fast: "codex-mini-latest", quality: "gpt-5.6-luna" }),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  assert.deepEqual(config.codexModels, { fast: "codex-mini-latest", quality: "gpt-5.6-luna" });
});

test("doctor reports unavailable providers instead of passing them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-doctor-"));
  const routesPath = join(directory, "routes.json");
  await writeFile(routesPath, JSON.stringify({
    "whatsapp-chat": { id: "whatsapp-chat", runtime: "developer-agent", agent: "codex", workspaceRoot: process.cwd() }
  }));
  const config = loadApplicationConfig({
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());

  const report = await runDoctor(config, {
    resolveExecutable: async () => undefined,
    readVersion: async () => "unavailable"
  });

  assert.equal(report.find(check => check.name === "Claude CLI")?.status, "FAIL");
  assert.equal(report.find(check => check.name === "Codex CLI")?.status, "FAIL");
  assert.match(report.find(check => check.name === "Routes")?.message ?? "", /1 route/);
  assert.match(report.find(check => check.name === "Streaming delivery")?.message ?? "", /0 ms.*2 messages/);
});

test("doctor reports malformed control-plane state as a failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-doctor-state-"));
  const routesPath = join(directory, "routes.json");
  const controlPlanePath = join(directory, "control-plane.json");
  await writeFile(routesPath, JSON.stringify({}));
  await writeFile(controlPlanePath, "{broken", "utf8");
  const config = loadApplicationConfig({
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_CONTROL_PLANE_PATH: controlPlanePath,
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  const report = await runDoctor(config, { resolveExecutable: async () => undefined, readVersion: async () => "" });
  assert.equal(report.find(check => check.name === "Persistence")?.status, "FAIL");
  assert.match(report.find(check => check.name === "Persistence")?.message ?? "", /Malformed/);
});

test("formats unknown conversations without leaking runtime diagnostics", () => {
  const error = new RouteNotFoundError("whatsapp", "120363-test@g.us");
  const message = formatOperationalError(error, "120363-test@g.us");
  assert.match(message, /120363-test@g.us/);
  assert.doesNotMatch(message, /stack|stderr|password/i);
});

test("workspace command reports the route workspace or the configured default", () => {
  const routes = {
    "whatsapp-known": {
      id: "known",
      runtime: "developer-agent" as const,
      agent: "codex",
      workspaceRoot: "/workspace/specific"
    }
  };
  assert.equal(formatWorkspaceCommand("known-chat", routes, "/workspace/default"), "/workspace/default");
  assert.equal(formatWorkspaceCommand("known", routes, "/workspace/default"), "/workspace/specific");
});

test("prevents a second local gateway from using the WhatsApp session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-lock-"));
  const lockPath = join(directory, "gateway.lock");
  const release = await acquireProcessLock(lockPath, process.pid);
  await assert.rejects(() => acquireProcessLock(lockPath, process.pid + 1), /already running/);
  await release();
  const releaseAgain = await acquireProcessLock(lockPath, process.pid + 1);
  await releaseAgain();
});
