import assert from "node:assert/strict";
import test from "node:test";
import type { Message } from "../packages/core/src/index.js";
import { InMemoryHistoryStore } from "../dist/packages/conversations/src/index.js";

function message(id: string, conversationId: string, text: string, receivedAt = "2026-01-01T00:00:00.000Z"): Message {
  return {
    id,
    conversationId,
    channel: "whatsapp",
    senderId: "sender-1",
    text,
    receivedAt: new Date(receivedAt)
  };
}

test("history store deduplicates messages and resolves case-insensitive partial chat names", async () => {
  const store = new InMemoryHistoryStore();
  await store.upsertChat({
    channel: "whatsapp",
    conversationId: "chat-1",
    displayName: "Viaje familiar",
    kind: "private",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await store.upsertMessage(message("m-1", "chat-1", "Hotel confirmado"));
  await store.upsertMessage(message("m-1", "chat-1", "duplicado"));

  assert.equal((await store.listChats("whatsapp", "VIAJE"))[0]?.conversationId, "chat-1");
  const result = await store.query("whatsapp", "chat-1", "hotel", { maxMessages: 10, maxCharacters: 1000 });
  assert.equal(result?.importedMessageCount, 1);
  assert.equal(result?.messages[0]?.text, "Hotel confirmado");
});

test("history query returns messages in chronological order with available time bounds", async () => {
  const store = new InMemoryHistoryStore();
  await store.upsertChat({
    channel: "whatsapp",
    conversationId: "chat-1",
    displayName: "Chat",
    kind: "unknown",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await store.upsertMessage(message("m-2", "chat-1", "second", "2026-01-01T00:02:00.000Z"));
  await store.upsertMessage(message("m-1", "chat-1", "first", "2026-01-01T00:01:00.000Z"));

  const result = await store.query("whatsapp", "chat-1", "", { maxMessages: 10, maxCharacters: 1000 });
  assert.deepEqual(result?.messages.map(item => item.id), ["m-1", "m-2"]);
  assert.equal(result?.oldestAvailableAt?.toISOString(), "2026-01-01T00:01:00.000Z");
  assert.equal(result?.newestAvailableAt?.toISOString(), "2026-01-01T00:02:00.000Z");
});

test("history query keeps lexical matches and recent messages within message and character caps", async () => {
  const store = new InMemoryHistoryStore();
  for (let index = 0; index < 5; index++) {
    await store.upsertMessage(message(
      `m-${index}`,
      "chat-1",
      index === 1 ? "pedido precio 20" : `nota ${index}`,
      `2026-01-01T00:0${index}:00.000Z`
    ));
  }

  const result = await store.query("whatsapp", "chat-1", "precio", { maxMessages: 3, maxCharacters: 30 });
  assert.equal(result?.messages.length, 3);
  assert.equal(result?.truncated, true);
  assert.ok(result?.messages.some(item => item.text.includes("precio")));
  assert.ok(result?.messages.some(item => item.id === "m-4"));
  assert.ok(result?.messages.reduce((total, item) => total + item.text.length, 0) <= 30);
});

test("history query returns no result for a missing chat", async () => {
  const store = new InMemoryHistoryStore();

  assert.equal(await store.query("whatsapp", "missing", "question", { maxMessages: 10, maxCharacters: 1000 }), undefined);
});
