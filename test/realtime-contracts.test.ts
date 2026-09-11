import { strict as assert } from "node:assert";
import { test } from "node:test";
import { calculateLatencies, executionEventTypes, type AgentExecutionEvent } from "../dist/runtime/developer-agent/src/contracts.js";
import { NodeDeveloperProcessRunner } from "../dist/runtime/developer-agent/src/process.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

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
