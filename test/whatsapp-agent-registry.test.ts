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

test("registry rejects non-finite, zero, and negative bounds", () => {
  for (const maxEntries of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.throws(() => new AgentMessageRegistry({ maxEntries, ttlMs: 100 }), RangeError);
  }
  for (const ttlMs of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.throws(() => new AgentMessageRegistry({ maxEntries: 1, ttlMs }), RangeError);
  }
});

test("registry clones metadata on write and read", () => {
  const origin = { type: "agent" as const, agentId: "claude" };
  const registry = new AgentMessageRegistry({ maxEntries: 1, ttlMs: 100 });
  registry.remember({ whatsappMessageId: "wa-a", conversationId: "chat-a", origin, createdAt: Date.now() });
  origin.agentId = "mutated";
  const result = registry.get("wa-a");
  assert.equal(result?.origin.agentId, "claude");
  if (result) result.origin.agentId = "mutated-again";
  assert.equal(registry.get("wa-a")?.origin.agentId, "claude");
});
