import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ControlPlane, InMemoryControlPlaneStore } from "../dist/packages/control-plane/src/index.js";
import { StreamDelivery, type StreamingDeliveryPolicy } from "../dist/packages/control-plane/src/delivery.js";
import { ExecutionTelemetry } from "../dist/packages/control-plane/src/telemetry.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

const root = process.cwd();
const message = (id: string, text: string, conversationId = "chat-1") => ({ id, channel: "test", conversationId, senderId: "owner", text, receivedAt: new Date() });

test("stream delivery aggregates deltas and preserves the triggering reply reference", async () => {
  const sent: any[] = [];
  const policy: StreamingDeliveryPolicy = { minChars: 8, maxIntervalMs: 1000, maxMessagesPerExecution: 3 };
  const delivery = new StreamDelivery(policy, value => { sent.push(value); }, { channel: "test", conversationId: "chat-1", messageId: "input-1" });
  await delivery.push("hello");
  await delivery.push(" world");
  await delivery.complete("hello world!");
  assert.deepEqual(sent.map(item => item.text), ["hello world", "!"]);
  assert.equal(sent.every(item => item.replyTo.messageId === "input-1"), true);
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
  assert.equal(streamed[0].replyTo.messageId, "prompt");
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
