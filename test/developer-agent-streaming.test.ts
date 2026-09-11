import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createCodexAdapter } from "../dist/developer-agents/codex/src/index.js";
import { createClaudeAdapter } from "../dist/developer-agents/claude/src/index.js";
import { DeveloperAgentSessionSupervisor } from "../dist/runtime/developer-agent/src/execution-session.js";
import { ProviderRegistry } from "../dist/runtime/developer-agent/src/registry.js";
import { DeveloperAgentRuntime } from "../dist/runtime/developer-agent/src/index.js";
import { InMemoryDeveloperSessionStore } from "../dist/runtime/developer-agent/src/sessions.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

const root = process.cwd();

function context() {
  return {
    correlationId: "correlation-1",
    conversationId: "external-chat",
    logicalSessionId: "logical-1",
    executionId: "execution-1",
    workingDirectory: root,
    workspacePolicy: new WorkspacePolicy([root]),
    signal: new AbortController().signal,
    events: new InMemoryEventBus(),
    processRunner: { async run() { return { stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 1 }; } }
  };
}

test("provider registry caches executable discovery until explicit refresh", async () => {
  let resolves = 0;
  const adapter = createCodexAdapter(async () => { resolves++; return "/bin/codex"; });
  const registry = new ProviderRegistry({ codex: adapter });
  await registry.load();
  assert.equal((await registry.get("codex"))?.availability.available, true);
  assert.equal((await registry.get("codex"))?.availability.available, true);
  assert.equal(resolves, 1);
  await registry.refresh("codex");
  assert.equal(resolves, 2);
});

test("logical provider sessions are reused and close cancels active work", async () => {
  let aborted = false;
  let started!: () => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const adapter = {
    id: "codex",
    async isAvailable() { return true; },
    async getAvailability() { return { available: true as const, executable: "codex" }; },
    async execute(request: any, execution: any) {
      started();
      execution.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      return { status: "completed" as const, text: request.prompt, sessionId: "thread-1" };
    }
  };
  const supervisor = new DeveloperAgentSessionSupervisor({
    adapters: { codex: adapter },
    capabilities: { policy: new WorkspacePolicy([root]) } as any,
    sessions: new InMemoryDeveloperSessionStore(),
    runner: context().processRunner,
    events: new InMemoryEventBus()
  });
  const first = await supervisor.getOrCreate("logical-1", "codex", root);
  const second = await supervisor.getOrCreate("logical-1", "codex", root);
  assert.equal(first, second);
  const running = first.execute({ ...context(), signal: undefined, prompt: "wait" }, { onEvent() {} });
  await startedPromise;
  await first.cancel("execution-1");
  await running;
  assert.equal(aborted, true);
  await supervisor.closeAll();
  assert.equal(first.health().status, "closed");
});

test("Codex translates an incremental JSONL agent message before completion", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const events: any[] = [];
  const adapter = createCodexAdapter(async () => "/bin/codex");
  const runner = {
    async run(_spec: any, observer: any) {
      await observer.onStdout(Buffer.from(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }) + "\n"));
      await observer.onStdout(Buffer.from(JSON.stringify({ type: "item.delta", item: { type: "agent_message", text: "first" } }) + "\n"));
      await gate;
      await observer.onStdout(Buffer.from(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "first" } }) + "\n"));
      return { stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 2 };
    }
  };
  const resultPromise = adapter.execute({ ...context(), prompt: "prompt" }, { ...context(), processRunner: runner, observer: { onEvent: event => events.push(event) } } as any);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.some(event => event.type === "assistant.delta" && event.payload.text === "first"), true);
  release();
  const result = await resultPromise;
  assert.equal(result.status, "completed");
  assert.equal((result as any).text, "first");
});

test("Claude uses stream JSON and forwards a text delta before completion", async () => {
  const observed: any[] = [];
  const adapter = createClaudeAdapter(async () => "/bin/claude");
  const runner = {
    async run(spec: any, observer: any) {
      assert.equal(spec.argv.includes("stream-json"), true);
      assert.equal(spec.argv.includes("--verbose"), true);
      await observer.onStdout(Buffer.from(JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "first" } }) + "\n"));
      await observer.onStdout(Buffer.from(JSON.stringify({ type: "result", session_id: "session-1", result: "first" }) + "\n"));
      return { stdout: "", stderr: "", exitCode: 0, signal: null, durationMs: 2 };
    }
  };
  const result = await adapter.execute({ ...context(), prompt: "prompt" }, { ...context(), processRunner: runner, observer: { onEvent: event => observed.push(event) } } as any);
  assert.equal(result.status, "completed");
  assert.equal(observed.some(event => event.type === "assistant.delta" && event.payload.text === "first"), true);
});

test("developer runtime forwards observer events through a resumable session", async () => {
  const observed: any[] = [];
  const adapter = {
    id: "codex",
    async isAvailable() { return true; },
    async getAvailability() { return { available: true as const, executable: "codex" }; },
    async execute(request: any, execution: any) {
      await execution.observer?.onEvent({ type: "assistant.delta", occurredAt: new Date(), executionId: request.executionId, correlationId: request.correlationId, logicalSessionId: request.logicalSessionId, payload: { text: "delta" } });
      return { status: "completed" as const, text: "delta", sessionId: "thread-1" };
    }
  };
  const runtime = new DeveloperAgentRuntime({ policy: new WorkspacePolicy([root]) } as any, {
    adapters: { codex: adapter },
    sessions: new InMemoryDeveloperSessionStore(),
    defaultWorkspaceRoot: root,
    runner: context().processRunner,
    events: new InMemoryEventBus()
  });
  const execution = { ...context(), observer: { onEvent: (event: any) => observed.push(event) } };
  const result = await (runtime as any).executeStreaming({
    message: { id: "message-1", conversationId: "external-chat", channel: "whatsapp", senderId: "user", text: "prompt", receivedAt: new Date() },
    conversation: { id: "logical-1", channel: "whatsapp", participantIds: ["user"], metadata: {} },
    route: { id: "route-1", runtime: "developer-agent", agent: "codex", workspaceRoot: root },
    execution: execution
  }, { id: "codex", type: "developer-agent" }, { onEvent: event => observed.push(event) });
  assert.equal(result.text, "delta");
  assert.equal(observed.some(event => event.payload?.text === "delta"), true);
});
