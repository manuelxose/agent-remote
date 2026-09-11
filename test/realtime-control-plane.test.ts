import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ControlPlane, InMemoryControlPlaneStore } from "../dist/packages/control-plane/src/index.js";
import { StreamDelivery, type StreamingDeliveryPolicy } from "../dist/packages/control-plane/src/delivery.js";
import { ExecutionTelemetry } from "../dist/packages/control-plane/src/telemetry.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

const root = process.cwd();
const message = (id: string, text: string, conversationId = "chat-1") => ({ id, channel: "test", conversationId, senderId: "owner", text, receivedAt: new Date() });

test("short execution sends one final response after streamed deltas", async () => {
  const sent: any[] = [];
  const policy: StreamingDeliveryPolicy = { progressAfterMs: 0, progressText: "Sigo trabajando…", maxMessagesPerExecution: 2 };
  const delivery = new StreamDelivery(policy, value => { sent.push(value); }, { channel: "test", conversationId: "chat-1", messageId: "input-1" });
  await delivery.push("hello");
  await delivery.push(" world");
  await delivery.complete("hello world!");
  assert.deepEqual(sent.map(item => item.text), ["hello world!"]);
  assert.equal(sent[0]?.replyTo?.messageId, "input-1");
});

test("long execution emits at most one delayed progress message and preserves final origin", async () => {
  const sent: any[] = [];
  const policy: StreamingDeliveryPolicy = { progressAfterMs: 5, progressText: "Sigo trabajando…", maxMessagesPerExecution: 2 };
  const delivery = new StreamDelivery(policy, value => { sent.push(value); }, { channel: "test", conversationId: "chat-1", messageId: "input-1" });
  await delivery.push("partial");
  await new Promise(resolve => setTimeout(resolve, 10));
  await delivery.complete("final", { type: "agent", agentId: "codex", executionId: "exec-1", logicalSessionId: "session-1" });
  assert.deepEqual(sent.map(item => item.text), ["Sigo trabajando…", "final"]);
  assert.equal(sent[0]?.replyTo?.messageId, "input-1");
  assert.deepEqual(sent[1]?.origin, { type: "agent", agentId: "codex", executionId: "exec-1", logicalSessionId: "session-1" });
});

test("failed delivery cancels delayed progress and sends nothing", async () => {
  const sent: any[] = [];
  const delivery = new StreamDelivery(
    { progressAfterMs: 20, progressText: "Sigo trabajando…", maxMessagesPerExecution: 2 },
    value => { sent.push(value); },
    { channel: "test", conversationId: "chat-1", messageId: "input-1" }
  );
  await delivery.push("partial");
  await delivery.fail();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(sent, []);
});

test("delivery requires at least one message slot", () => {
  assert.throws(() => new StreamDelivery(
    { progressAfterMs: 0, progressText: "Sigo trabajando…", maxMessagesPerExecution: 0 },
    () => {}
  ), /maxMessagesPerExecution must be at least 1/);
});

test("execution telemetry records identity and derives only complete latency spans", () => {
  const telemetry = new ExecutionTelemetry({ executionId: "e1", correlationId: "m1", logicalSessionId: "l1", externalConversationId: "chat", provider: "codex", agent: "codex", workspace: root });
  telemetry.mark("messageReceivedAt", 100);
  telemetry.mark("executionStartedAt", 120);
  telemetry.mark("firstProviderOutputAt", 180);
  telemetry.mark("finalReplyAt", 250);
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.executionId, "e1");
  assert.equal(snapshot.latencies.timeToFirstOutputMs, 80);
  assert.equal(snapshot.latencies.executionDurationMs, undefined);
  assert.equal(snapshot.latencies.totalLatencyMs, 150);
});

test("control-plane command and streamed execution results correlate to the inbound message", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const streamed: any[] = [];
  const agent = { id: "codex", type: "developer-agent" as const, async handleMessage() { throw new Error("unused"); } };
  const runtime = {
    type: "developer-agent" as const,
    async execute(context: any) { return { text: `done:${context.message.text}` }; },
    async executeStreaming(context: any, _agent: any, observer: any) {
      await observer.onEvent({ type: "assistant.delta", occurredAt: new Date(), executionId: context.execution.executionId, correlationId: context.execution.correlationId, logicalSessionId: context.conversation.id, payload: { text: "partial" } });
      await gate;
      return { text: "final" };
    }
  };
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { codex: agent }, runtimes: { "developer-agent": runtime },
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root,
    onExecutionEvent: async (_session, _message, event) => { streamed.push(event); }
  } as any);
  const identity = { id: "owner", role: "owner" as const };
  const init = await control.handle(message("init", "/init"), identity);
  assert.equal(init.replyTo?.messageId, "init");
  await control.handle(message("agent", "/codex"), identity);
  const running = control.handle(message("prompt", "hello"), identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(streamed[0].payload.text, "partial");
  assert.deepEqual(streamed[0].replyTo, { channel: "test", conversationId: "chat-1", messageId: "prompt", senderId: "owner" });
  release();
  const result = await running;
  assert.equal(result.replyTo?.messageId, "prompt");
});

test("status exposes safe runtime diagnostics without prompt content", async () => {
  const agent = { id: "codex", type: "developer-agent" as const, async handleMessage() { throw new Error("unused"); } };
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { codex: agent }, runtimes: {},
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root,
    runtimeDiagnostics: async () => "Providers: codex=available; Sessions: 1"
  } as any);
  const result = await control.handle(message("status", "/status"), { id: "owner", role: "owner" });
  assert.match(result.text, /Providers: codex=available/);
  assert.doesNotMatch(result.text, /prompt|secret/i);
});

test("execution telemetry can be marked at the transport boundary", () => {
  const telemetry = new ExecutionTelemetry({ executionId: "e2", correlationId: "m2", logicalSessionId: "l2", externalConversationId: "chat", provider: "codex", agent: "codex", workspace: root });
  telemetry.mark("messageReceivedAt", 100);
  telemetry.mark("executionCompletedAt", 200);
  telemetry.mark("firstTransportReplyAt", 210);
  telemetry.mark("finalReplyAt", 220);
  assert.equal(telemetry.snapshot().latencies.timeToFirstReplyMs, 110);
  assert.equal(telemetry.snapshot().latencies.deliveryLatencyMs, 20);
});
