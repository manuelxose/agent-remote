import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DeveloperAgentRuntime } from "../dist/runtime/developer-agent/src/index.js";
import { NodeDeveloperProcessRunner } from "../dist/runtime/developer-agent/src/process.js";
import { InMemoryDeveloperSessionStore, JsonDeveloperSessionStore } from "../dist/runtime/developer-agent/src/sessions.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

const root = process.cwd();
const capabilities = {
  policy: new WorkspacePolicy([root]),
  shell: async () => "ok",
  readFile: async () => "content",
  writeFile: async () => undefined,
  git: async () => "clean"
};

function context(conversationId: string, agent: string, workspaceRoot = root, channel = "whatsapp") {
  return {
    message: { id: `message-${conversationId}`, conversationId, channel, senderId: "user", text: `prompt-${conversationId}`, receivedAt: new Date(0) },
    conversation: { id: conversationId, channel: "whatsapp", participantIds: ["user"], metadata: {} },
    route: { id: `route-${conversationId}`, runtime: "developer-agent" as const, agent, workspaceRoot },
    execution: { correlationId: `correlation-${conversationId}`, conversationId, workspaceRoot }
  };
}

function agent(id: string) {
  return { id, type: "developer-agent" as const, async handleMessage() { throw new Error("developer adapter route must not use handleMessage"); } };
}

function fakeAdapter(id: string, options: { available?: boolean; result?: "completed" | "failed"; reason?: string; wait?: Promise<void> } = {}) {
  const calls: Array<{ request: any; context: any }> = [];
  return {
    adapter: {
      id,
      async isAvailable() { return options.available ?? true; },
      async getAvailability() { return options.available === false ? { available: false as const, reason: "executable-missing" as const, executable: id } : { available: true as const, executable: id }; },
      async execute(request: any, execution: any) {
        calls.push({ request, context: execution });
        await options.wait;
        if (options.result === "failed") return { status: "failed" as const, reason: options.reason ?? "exit-nonzero", stderr: "secret stderr" };
        return { status: "completed" as const, text: `${id}:${request.sessionId ?? "new"}`, sessionId: `${id}-session-${calls.length}` };
      }
    },
    calls
  };
}

function fakeRunner() {
  const calls: unknown[] = [];
  return { calls, async run(spec: unknown) { calls.push(spec); return { stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 1 }; } };
}

test("developer runtime keeps native sessions isolated by conversation, agent, and workspace", async () => {
  const claude = fakeAdapter("claude");
  const codex = fakeAdapter("codex");
  const copilot = fakeAdapter("copilot");
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: claude.adapter, codex: codex.adapter, copilot: copilot.adapter },
    sessions: new InMemoryDeveloperSessionStore(),
    defaultWorkspaceRoot: root,
    runner: fakeRunner(),
    events: new InMemoryEventBus()
  });

  await runtime.execute(context("a", "claude"), agent("claude"));
  await runtime.execute(context("b", "codex"), agent("codex"));
  await runtime.execute(context("c", "copilot"), agent("copilot"));
  await runtime.execute(context("a", "claude"), agent("claude"));
  await runtime.execute(context("a", "claude", join(root, "runtime")), agent("claude"));
  await runtime.execute(context("a", "codex"), agent("codex"));

  assert.equal(claude.calls[0].request.sessionId, undefined);
  assert.equal(claude.calls[1].request.sessionId, "claude-session-1");
  assert.equal(claude.calls[2].request.sessionId, undefined);
  assert.equal(codex.calls[0].request.sessionId, undefined);
  assert.equal(codex.calls[1].request.sessionId, undefined);
  assert.equal(copilot.calls[0].request.sessionId, undefined);
});

test("developer runtime keeps collision-prone channel and conversation tuples independent", async () => {
  const claude = fakeAdapter("claude");
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: claude.adapter },
    sessions: new InMemoryDeveloperSessionStore(),
    defaultWorkspaceRoot: root,
    runner: fakeRunner(),
    events: new InMemoryEventBus()
  });

  await runtime.execute(context("c", "claude", root, "a:b"), agent("claude"));
  await runtime.execute(context("b:c", "claude", root, "a"), agent("claude"));
  await runtime.execute(context("c", "claude", root, "a:b"), agent("claude"));
  await runtime.execute(context("b:c", "claude", root, "a"), agent("claude"));

  assert.equal(claude.calls[2].request.sessionId, "claude-session-1");
  assert.equal(claude.calls[3].request.sessionId, "claude-session-2");
});

test("developer runtime reloads a persisted native session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-runtime-"));
  try {
    const first = fakeAdapter("claude");
    const store = new JsonDeveloperSessionStore(join(directory, "sessions.json"));
    const options = { adapters: { claude: first.adapter }, sessions: store, defaultWorkspaceRoot: root, runner: fakeRunner(), events: new InMemoryEventBus() };
    await new DeveloperAgentRuntime(capabilities, options).execute(context("restart", "claude"), agent("claude"));

    const resumed = fakeAdapter("claude");
    await new DeveloperAgentRuntime(capabilities, { ...options, adapters: { claude: resumed.adapter } }).execute(context("restart", "claude"), agent("claude"));

    assert.equal(resumed.calls[0].request.sessionId, "claude-session-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("developer runtime serializes one conversation without blocking another", async () => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const claude = fakeAdapter("claude", { wait: waiting });
  const codex = fakeAdapter("codex");
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: claude.adapter, codex: codex.adapter }, sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: root, runner: fakeRunner(), events: new InMemoryEventBus()
  });

  const first = runtime.execute(context("same", "claude"), agent("claude"));
  const second = runtime.execute(context("same", "claude"), agent("claude"));
  await runtime.execute(context("other", "codex"), agent("codex"));
  assert.equal(codex.calls.length, 1);
  assert.equal(claude.calls.length, 1);
  release();
  await Promise.all([first, second]);

  assert.equal(claude.calls.length, 2);
  assert.equal(claude.calls[1].request.sessionId, "claude-session-1");
});

test("developer runtime publishes one terminal event and returns safe adapter failures", async () => {
  const events = new InMemoryEventBus();
  const observed: string[] = [];
  for (const type of ["AgentExecutionStarted", "AgentExecutionCompleted", "AgentExecutionFailed"] as const) events.subscribe(type, event => observed.push(event.type));
  const successful = fakeAdapter("claude");
  const failed = fakeAdapter("codex", { result: "failed" });
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: successful.adapter, codex: failed.adapter }, sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: root, runner: fakeRunner(), events
  });

  await runtime.execute(context("success", "claude"), agent("claude"));
  const response = await runtime.execute(context("failure", "codex"), agent("codex"));

  assert.deepEqual(observed, ["AgentExecutionStarted", "AgentExecutionCompleted", "AgentExecutionStarted", "AgentExecutionFailed"]);
  assert.match(response.text, /unable to complete/i);
  assert.deepEqual(response.metadata, { agent: "codex", reason: "exit-nonzero" });
  assert.equal(response.text.includes("secret stderr"), false);
});

test("developer runtime ignores a started handler failure", async () => {
  const events = new InMemoryEventBus();
  const observed: string[] = [];
  events.subscribe("AgentExecutionStarted", () => { throw new Error("started handler failed"); });
  events.subscribe("AgentExecutionCompleted", event => { observed.push(event.type); });
  events.subscribe("AgentExecutionFailed", event => { observed.push(event.type); });
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: fakeAdapter("claude").adapter }, sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: root, runner: fakeRunner(), events
  });

  const response = await runtime.execute(context("started-handler", "claude"), agent("claude"));

  assert.equal(response.text, "claude:new");
  assert.deepEqual(observed, ["AgentExecutionCompleted"]);
});

test("developer runtime ignores a completed handler failure without publishing failed", async () => {
  const events = new InMemoryEventBus();
  const observed: string[] = [];
  for (const type of ["AgentExecutionStarted", "AgentExecutionCompleted", "AgentExecutionFailed"] as const) events.subscribe(type, event => { observed.push(event.type); });
  events.subscribe("AgentExecutionCompleted", () => { throw new Error("completed handler failed"); });
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: fakeAdapter("claude").adapter }, sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: root, runner: fakeRunner(), events
  });

  const response = await runtime.execute(context("completed-handler", "claude"), agent("claude"));

  assert.equal(response.text, "claude:new");
  assert.deepEqual(observed, ["AgentExecutionStarted", "AgentExecutionCompleted"]);
});

test("developer runtime emits one failed event for a session persistence error", async () => {
  const events = new InMemoryEventBus();
  const observed: string[] = [];
  for (const type of ["AgentExecutionStarted", "AgentExecutionCompleted", "AgentExecutionFailed"] as const) events.subscribe(type, event => { observed.push(event.type); });
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: fakeAdapter("claude").adapter },
    sessions: { async load() {}, async get() { return undefined; }, async set() { throw new Error("session write failed"); } },
    defaultWorkspaceRoot: root,
    runner: fakeRunner(),
    events
  });

  const response = await runtime.execute(context("session-error", "claude"), agent("claude"));

  assert.deepEqual(response.metadata, { agent: "claude", reason: "execution-failed" });
  assert.deepEqual(observed, ["AgentExecutionStarted", "AgentExecutionFailed"]);
});

test("developer runtime creates production session and runner defaults when omitted", () => {
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: fakeAdapter("claude").adapter }, defaultWorkspaceRoot: root
  });
  const options = (runtime as any).options;

  assert.ok(options.sessions instanceof JsonDeveloperSessionStore);
  assert.equal(options.sessions.path, "data/developer-agent-sessions.json");
  assert.ok(options.runner instanceof NodeDeveloperProcessRunner);
});

test("developer runtime reports an adapter ID mismatch as unconfigured", async () => {
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: fakeAdapter("codex").adapter }, defaultWorkspaceRoot: root
  });

  assert.deepEqual(await runtime.getAvailability("claude"), { available: false, reason: "adapter-not-configured", executable: "claude" });
});

test("developer runtime reports missing and unavailable adapters with stable diagnostics", async () => {
  const unavailable = fakeAdapter("claude", { available: false });
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: unavailable.adapter }, sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: root, runner: fakeRunner(), events: new InMemoryEventBus()
  });

  assert.deepEqual(await runtime.getAvailability("claude"), { available: false, reason: "executable-missing", executable: "claude" });
  assert.deepEqual((await runtime.execute(context("unavailable", "claude"), agent("claude"))).metadata, { agent: "claude", reason: "unavailable" });
  assert.deepEqual((await runtime.execute(context("missing", "codex"), agent("codex"))).metadata, { agent: "codex", reason: "adapter-not-configured" });
});

test("developer runtime rejects untrusted workspaces before adapter execution and forwards cancellation", async () => {
  const adapter = fakeAdapter("claude");
  const cancelled = fakeAdapter("codex", { result: "failed", reason: "cancelled" });
  const runner = fakeRunner();
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: adapter.adapter, codex: cancelled.adapter }, sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: root, runner, events: new InMemoryEventBus()
  });

  const rejected = await runtime.execute(context("rejected", "claude", "/not-approved"), agent("claude"));
  const cancellation = await runtime.execute(context("cancelled", "codex"), agent("codex"));

  assert.deepEqual(rejected.metadata, { agent: "claude", reason: "workspace-rejected" });
  assert.deepEqual(cancellation.metadata, { agent: "codex", reason: "cancelled" });
  assert.equal(adapter.calls.length, 0);
  assert.equal(runner.calls.length, 0);
});

test("developer runtime passes an aborting trusted execution signal to a waiting adapter", async () => {
  let entered!: () => void;
  let release!: () => void;
  let observedSignal: AbortSignal | undefined;
  const enteredAdapter = new Promise<void>(resolve => { entered = resolve; });
  const releaseAdapter = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: {
      claude: {
        id: "claude",
        async isAvailable() { return true; },
        async getAvailability() { return { available: true, executable: "claude" }; },
        async execute(_request, execution) {
          observedSignal = execution.signal;
          entered();
          await releaseAdapter;
          return { status: "failed" as const, reason: "cancelled" as const };
        }
      }
    },
    sessions: new InMemoryDeveloperSessionStore(), defaultWorkspaceRoot: root, runner: fakeRunner(), events: new InMemoryEventBus()
  });
  const execution = context("aborting", "claude");
  execution.execution.signal = controller.signal;

  const response = runtime.execute(execution, agent("claude"));
  await enteredAdapter;
  controller.abort();
  release();

  assert.deepEqual((await response).metadata, { agent: "claude", reason: "cancelled" });
  assert.equal(observedSignal, controller.signal);
  assert.equal(observedSignal?.aborted, true);
});
