import assert from "node:assert/strict";
import { appendFile, chmod, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Message } from "../packages/core/src/index.js";
import { InMemoryHistoryStore, JsonHistoryStore } from "../dist/packages/conversations/src/index.js";

class ChmodFailingHistoryStore extends JsonHistoryStore {
  failChmod = true;

  protected override async enforcePermissions(): Promise<void> {
    if (this.failChmod) throw new Error("forced chmod failure");
    await chmod(this.path, 0o600);
  }
}

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

test("history store resolves partial conversation IDs", async () => {
  const store = new InMemoryHistoryStore();
  await store.upsertChat({
    channel: "whatsapp",
    conversationId: "123456789@s.whatsapp.net",
    displayName: "Contacto",
    kind: "private",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });

  assert.equal((await store.listChats("whatsapp", "6789@s.whatsapp.net"))[0]?.displayName, "Contacto");
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

test("history query rejects non-finite message and character limits", async () => {
  const store = new InMemoryHistoryStore();
  await store.upsertMessage(message("m-1", "chat-1", "message"));

  await assert.rejects(() => store.query("whatsapp", "chat-1", "", { maxMessages: Number.NaN, maxCharacters: 10 }), RangeError);
  await assert.rejects(() => store.query("whatsapp", "chat-1", "", { maxMessages: 10, maxCharacters: Number.POSITIVE_INFINITY }), RangeError);
});

test("JSON history reloads, deduplicates, and keeps a 0600 file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-"));
  const path = join(directory, "nested", "history.jsonl");
  try {
    const first = new JsonHistoryStore(path);
    await first.upsertMessage(message("m-1", "chat-1", "original"));
    await first.upsertMessage(message("m-1", "chat-1", "duplicate"));

    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const restored = new JsonHistoryStore(path);
    const result = await restored.query("whatsapp", "chat-1", "original", { maxMessages: 10, maxCharacters: 100 });
    assert.equal(result?.importedMessageCount, 1);
    assert.equal(result?.messages[0]?.text, "original");
    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON history corrects an existing file to 0600 while loading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-"));
  const path = join(directory, "history.jsonl");
  try {
    await appendFile(path, `${JSON.stringify({ type: "message", message: message("m-1", "chat-1", "loaded") })}\n`);
    await chmod(path, 0o644);

    const restored = new JsonHistoryStore(path);
    assert.equal((await restored.listChats("whatsapp"))[0]?.conversationId, "chat-1");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON history skips malformed lines while retaining valid records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-"));
  const path = join(directory, "history.jsonl");
  try {
    const store = new JsonHistoryStore(path);
    await store.upsertMessage(message("m-1", "chat-1", "valid"));
    await appendFile(path, "not-json\n{\"type\":\"message\"}\n", "utf8");

    const restored = new JsonHistoryStore(path);
    const result = await restored.query("whatsapp", "chat-1", "valid", { maxMessages: 10, maxCharacters: 100 });
    assert.equal(result?.importedMessageCount, 1);
    assert.equal(result?.messages[0]?.text, "valid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON history serializes concurrent writes into valid JSONL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-"));
  const path = join(directory, "history.jsonl");
  try {
    const store = new JsonHistoryStore(path);
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.upsertMessage(message(`m-${index}`, "chat-1", `message ${index}`))));

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    assert.equal(lines.length, 21);
    assert.doesNotThrow(() => lines.forEach(line => JSON.parse(line)));
    const restored = new JsonHistoryStore(path);
    assert.equal((await restored.query("whatsapp", "chat-1", "", { maxMessages: 30, maxCharacters: 1000 }))?.importedMessageCount, 20);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON history retries a chat after persistence failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-"));
  const path = join(directory, "history.jsonl");
  const chat = { channel: "whatsapp", conversationId: "chat-1", displayName: "Chat", kind: "private" as const, updatedAt: "2026-01-01T00:00:00.000Z" };
  try {
    const store = new JsonHistoryStore(path);
    await store.listChats("whatsapp");
    await mkdir(path);
    await assert.rejects(() => store.upsertChat(chat));
    await rm(path, { recursive: true });

    await store.upsertChat(chat);
    assert.equal((await new JsonHistoryStore(path).listChats("whatsapp"))[0]?.displayName, "Chat");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON history retries an auto-created chat and message after persistence failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-"));
  const path = join(directory, "history.jsonl");
  try {
    const store = new JsonHistoryStore(path);
    await store.listChats("whatsapp");
    await mkdir(path);
    await assert.rejects(() => store.upsertMessage(message("m-1", "chat-1", "retry me")));
    await rm(path, { recursive: true });

    await store.upsertMessage(message("m-1", "chat-1", "retry me"));
    const lines = (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { type: string });
    assert.deepEqual(lines.map(line => line.type), ["chat", "message"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON history does not duplicate records after a chmod failure and retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-history-"));
  const path = join(directory, "history.jsonl");
  try {
    const store = new ChmodFailingHistoryStore(path);
    await assert.rejects(() => store.upsertMessage(message("m-1", "chat-1", "retry once")), /forced chmod failure/);
    store.failChmod = false;
    await store.upsertMessage(message("m-1", "chat-1", "retry once"));

    const lines = (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { type: string });
    assert.deepEqual(lines.map(line => line.type), ["chat", "message"]);
    const restored = new JsonHistoryStore(path);
    const result = await restored.query("whatsapp", "chat-1", "retry", { maxMessages: 10, maxCharacters: 100 });
    assert.equal(result?.importedMessageCount, 1);
    assert.equal(result?.messages[0]?.text, "retry once");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
