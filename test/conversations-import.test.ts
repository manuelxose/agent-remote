import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { InMemoryHistoryStore, JsonHistoryStore, parseWhatsAppExport } from "../dist/packages/conversations/src/index.js";

const exportText = [
  "12/09/2026, 20:10 - Manu: Hemos hablado del viaje",
  "continuación con hotel y vuelos",
  "12/09/2026, 20:11 - Silvia: Perfecto",
  "[12/09/2026, 20:12:00] Manu: Lo miro mañana"
].join("\n");

test("parses WhatsApp exports including continuations and bracket timestamps", () => {
  const result = parseWhatsAppExport("Viaje Silvia", Buffer.from(exportText));

  assert.equal(result.chat.displayName, "Viaje Silvia");
  assert.equal(result.messages.length, 3);
  assert.match(result.messages[0].text, /continuación/);
  assert.equal(result.messages[1].senderId, "Silvia");
  assert.equal(result.chat.kind, "unknown");
});

test("re-importing the same export is idempotent", async () => {
  const store = new InMemoryHistoryStore();
  const first = parseWhatsAppExport("Viaje", Buffer.from(exportText));
  const second = parseWhatsAppExport("Viaje", Buffer.from(exportText));

  await store.importChat(first.chat, first.messages);
  await store.importChat(second.chat, second.messages);

  assert.equal((await store.query("whatsapp", first.chat.conversationId, "", { maxMessages: 20, maxCharacters: 5000 }))?.importedMessageCount, 3);
});

test("rejects exports with no parseable messages", () => {
  assert.throws(() => parseWhatsAppExport("Vacío", Buffer.from("not a WhatsApp export")), /no parseable messages/i);
});

test("persists an imported chat atomically and reloads it", async () => {
  const directory = await mkdtemp(join(process.cwd(), "test-history-import-"));
  const path = join(directory, "history.jsonl");
  try {
    const imported = parseWhatsAppExport("Viaje", Buffer.from(exportText));
    await new JsonHistoryStore(path).importChat(imported.chat, imported.messages);
    const restored = new JsonHistoryStore(path);
    const result = await restored.query("whatsapp", imported.chat.conversationId, "hotel", { maxMessages: 20, maxCharacters: 5000 });
    assert.equal(result?.importedMessageCount, 3);
    assert.equal((await readFile(path, "utf8")).trim().split("\n").length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
