import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ExecutionTelemetry } from "../dist/packages/control-plane/src/telemetry.js";

async function measure(label: string) {
  const telemetry = new ExecutionTelemetry({
    executionId: label,
    correlationId: label,
    logicalSessionId: `logical-${label}`,
    externalConversationId: "benchmark",
    provider: "fake",
    agent: "fake",
    workspace: process.cwd()
  });
  telemetry.mark("messageReceivedAt");
  telemetry.mark("routingCompletedAt");
  telemetry.mark("queueEnteredAt");
  telemetry.mark("executionAcceptedAt");
  telemetry.mark("executionStartedAt");
  await new Promise<void>(resolve => setImmediate(resolve));
  telemetry.mark("providerStartedAt");
  telemetry.mark("firstProviderOutputAt");
  await new Promise<void>(resolve => setImmediate(resolve));
  telemetry.mark("executionCompletedAt");
  telemetry.mark("finalReplyAt");
  const snapshot = telemetry.snapshot();
  console.log(`realtime benchmark ${label}: ${JSON.stringify(snapshot.latencies)}`);
  return snapshot;
}

test("realtime benchmark reports measured cold and warm latency spans", async () => {
  const cold = await measure("cold");
  const warm = await measure("warm");
  for (const snapshot of [cold, warm]) {
    assert.equal(typeof snapshot.latencies.timeToFirstOutputMs, "number");
    assert.equal(typeof snapshot.latencies.executionDurationMs, "number");
    assert.equal(typeof snapshot.latencies.totalLatencyMs, "number");
  }
});
