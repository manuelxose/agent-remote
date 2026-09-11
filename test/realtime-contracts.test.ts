import { strict as assert } from "node:assert";
import { test } from "node:test";
import { calculateLatencies, executionEventTypes, type AgentExecutionEvent } from "../dist/runtime/developer-agent/src/contracts.js";
import { NodeDeveloperProcessRunner } from "../dist/runtime/developer-agent/src/process.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";
import type { OutboundMessage } from "../dist/packages/core/src/index.js";

test("immediate agent responses retain origin, reply reference, and metadata", async () => {
  const agent = { id: "claude", type: "developer-agent" as const, async handleMessage() { throw new Error("runtime owns execution"); } };
  const runtime = { type: "developer-agent" as const, async execute() { return { text: "clean response", metadata: { preserved: "yes" } }; } };
  const { ControlPlane, InMemoryControlPlaneStore } = await import("../dist/packages/control-plane/src/index.js");
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { claude: agent }, runtimes: { "developer-agent": runtime },
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root
  });
  const identity = { id: "owner", role: "owner" as const };
  const reference = { channel: "test", conversationId: "immediate-chat", messageId: "trigger-origin", senderId: "owner" };
  const message = (id: string, text: string) => ({ id, channel: "test", conversationId: "immediate-chat", senderId: "owner", text, receivedAt: new Date(), ...(id === "exec-immediate" ? { replyReference: reference } : {}) });
  await control.handle(message("init-immediate", "/init"), identity);
  await control.handle(message("agent-immediate", "/claude"), identity);
  const response = await control.handle(message("exec-immediate", "hello"), identity) as OutboundMessage;
  assert.equal(response.text, "clean response");
  assert.deepEqual(response.metadata, { preserved: "yes", executionId: "exec-immediate" });
  assert.deepEqual(response.replyTo, reference);
  assert.deepEqual(response.origin, { type: "agent", agentId: "claude", executionId: "exec-immediate", logicalSessionId: response.origin?.logicalSessionId });
});

test("control-plane agent responses carry execution origin before delivery", async () => {
  const delivered: Array<{ text: string; origin?: { type: string; agentId?: string; executionId?: string; logicalSessionId?: string }; replyTo?: unknown; metadata?: Record<string, string> }> = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const agent = { id: "claude", type: "developer-agent" as const, async handleMessage() { throw new Error("runtime owns execution"); } };
  const runtime = { type: "developer-agent" as const, async execute(context: any) {
    if (context.message.id === "first-origin") await gate;
    return { text: "clean response", metadata: { preserved: "yes" } };
  } };
  const { ControlPlane, InMemoryControlPlaneStore } = await import("../dist/packages/control-plane/src/index.js");
  const control = new ControlPlane({
    repositories: new InMemoryControlPlaneStore(), agents: { claude: agent }, runtimes: { "developer-agent": runtime },
    workspacePolicy: new WorkspacePolicy([root]), defaultWorkspace: root,
    onExecutionResponse: async (_session, response) => { delivered.push(response); }, maxQueueDepth: 1
  });
  const identity = { id: "owner", role: "owner" as const };
  const message = (id: string, text: string) => ({ id, channel: "test", conversationId: "origin-chat", senderId: "owner", text, receivedAt: new Date(), ...(id === "exec-origin" ? { replyReference: { channel: "test", conversationId: "origin-chat", messageId: "trigger-origin", senderId: "owner" } } : {}) });
  await control.handle(message("init-origin", "/init"), identity);
  await control.handle(message("agent-origin", "/claude"), identity);
  const first = control.handle(message("first-origin", "hello"), identity);
  await new Promise(resolve => setImmediate(resolve));
  assert.match((await control.handle(message("exec-origin", "second"), identity)).text, /Queued/);
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered[0]?.text, "clean response");
  assert.deepEqual(delivered[0]?.metadata, { preserved: "yes", executionId: "exec-origin" });
  assert.deepEqual(delivered[0]?.replyTo, { channel: "test", conversationId: "origin-chat", messageId: "trigger-origin", senderId: "owner" });
  assert.equal(delivered[0]?.origin?.type, "agent");
  assert.equal(delivered[0]?.origin?.agentId, "claude");
  assert.equal(delivered[0]?.origin?.executionId, "exec-origin");
  assert.equal(typeof delivered[0]?.origin?.logicalSessionId, "string");
});

const root = process.cwd();

test("neutral execution events expose only provider-independent event types", () => {
  assert.deepEqual(executionEventTypes, [
    "execution.accepted", "execution.started", "provider.started", "assistant.delta",
    "assistant.message", "tool.started", "tool.progress", "tool.completed",
    "execution.completed", "execution.failed", "execution.cancelled"
  ]);
  const event: AgentExecutionEvent = {
    type: "assistant.delta",
    occurredAt: new Date(),
    executionId: "execution-1",
    correlationId: "message-1",
    logicalSessionId: "logical-1",
    payload: { text: "hello" }
  };
  assert.equal(event.payload?.text, "hello");
});

test("latency calculation leaves incomplete measurements undefined", () => {
  const latencies = calculateLatencies({
    messageReceivedAt: 100,
    routingCompletedAt: 125,
    executionAcceptedAt: 140,
    firstProviderOutputAt: 210,
    finalReplyAt: 300
  });
  assert.equal(latencies.routingLatencyMs, 25);
  assert.equal(latencies.timeToFirstOutputMs, 110);
  assert.equal(latencies.totalLatencyMs, 200);
  assert.equal(latencies.queueLatencyMs, undefined);
});

test("process runner forwards stdout chunks before process completion", async () => {
  const chunks: string[] = [];
  let completed = false;
  const runner = new NodeDeveloperProcessRunner(new WorkspacePolicy([root]));
  const result = await runner.run({
    executable: process.execPath,
    argv: ["-e", "process.stdout.write('first'); setTimeout(() => process.stdout.write('second'), 20)"],
    workingDirectory: root,
    timeoutMs: 1000
  }, {
    onStdout: chunk => {
      chunks.push(chunk.toString());
      assert.equal(completed, false);
    }
  });
  completed = true;
  assert.equal(result.stdout, "firstsecond");
  assert.equal(chunks.join(""), "firstsecond");
});
