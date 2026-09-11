import test from "node:test";
import assert from "node:assert/strict";
import { AgentMessageRegistry } from "../dist/channels/whatsapp/src/agent-registry.js";

test("registry returns exact metadata and prunes expired entries", () => {
  let now = 1000;
  const registry = new AgentMessageRegistry({ maxEntries: 2, ttlMs: 100, now: () => now });
  registry.remember({
    whatsappMessageId: "wa-a",
    conversationId: "chat-a",
    origin: { type: "agent", agentId: "claude", executionId: "exec-a", logicalSessionId: "session-a" },
    replyToMessageId: "incoming-a",
    createdAt: now
  });
  assert.equal(registry.get("wa-a", "chat-a")?.origin.agentId, "claude");
  assert.equal(registry.get("wa-a", "chat-b"), undefined);
  now = 1101;
  assert.equal(registry.get("wa-a", "chat-a"), undefined);
  assert.equal(registry.snapshot().length, 0);
});

test("registry evicts the oldest entry at fixed capacity", () => {
  let now = 0;
  const registry = new AgentMessageRegistry({ maxEntries: 2, ttlMs: 10_000, now: () => now });
  for (const id of ["wa-a", "wa-b", "wa-c"]) registry.remember({
    whatsappMessageId: id,
    conversationId: "chat-a",
    origin: { type: "agent", agentId: "codex" },
    createdAt: now++
  });
  assert.equal(registry.has("wa-a"), false);
  assert.equal(registry.snapshot().length, 2);
});
