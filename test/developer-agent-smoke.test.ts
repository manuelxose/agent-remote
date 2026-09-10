import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClaudeAdapter } from "../dist/developer-agents/claude/src/index.js";
import { createCodexAdapter } from "../dist/developer-agents/codex/src/index.js";
import { createCopilotAdapter } from "../dist/developer-agents/copilot/src/index.js";
import { InMemoryEventBus } from "../dist/packages/events/src/index.js";
import { NodeDeveloperProcessRunner } from "../dist/runtime/developer-agent/src/process.js";
import { WorkspacePolicy } from "../dist/packages/security/src/index.js";

const adapters = [createClaudeAdapter(), createCodexAdapter(), createCopilotAdapter()];

for (const adapter of adapters) {
  const availability = await adapter.getAvailability();
  const reason = availability.available ? undefined : `${availability.executable}: ${availability.reason}`;

  test(`installed CLI smoke: ${adapter.id}`, { skip: reason }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), `developer-agent-smoke-${adapter.id}-`));
    try {
      const policy = new WorkspacePolicy([workspace]);
      const result = await adapter.execute({
        prompt: "Reply with the single word OK.",
        conversationId: `smoke-${adapter.id}`,
        timeoutMs: 10_000,
        maxOutputBytes: 8 * 1024
      }, {
        correlationId: `smoke-${adapter.id}`,
        conversationId: `smoke-${adapter.id}`,
        workingDirectory: workspace,
        workspacePolicy: policy,
        signal: new AbortController().signal,
        events: new InMemoryEventBus(),
        processRunner: new NodeDeveloperProcessRunner(policy)
      });

      assert.notEqual(result.reason, "unavailable");
      console.log(`${adapter.id}: ${result.status}${result.status === "failed" ? ` (${result.reason})` : ""}`);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
}
