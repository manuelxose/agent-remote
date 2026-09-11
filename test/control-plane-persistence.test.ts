import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ControlPlaneStateError, JsonControlPlaneStore, type ManagedConversation } from "../dist/packages/control-plane/src/index.js";

function conversation(id: string): ManagedConversation {
  const now = new Date().toISOString();
  return { logicalSessionId: id, channel: "test", externalConversationId: id, ownerId: "owner", displayName: id, workspace: process.cwd(), providerSessionIds: {}, createdAt: now, updatedAt: now, lastActivityAt: now, status: "READY_NO_AGENT" };
}

test("control-plane JSON state restores conversations, selections, bindings, and idempotency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-control-plane-"));
  const path = join(directory, "state.json");
  const first = new JsonControlPlaneStore(path);
  await first.save(conversation("chat-1"));
  await first.setSelection("owner", "test", "chat-1");
  await first.setProviderSession("chat-1", "claude", process.cwd(), "native-1");
  await first.record({ messageId: "message-1", recordedAt: new Date().toISOString(), correlationId: "message-1", ownerId: "owner" });

  const restored = new JsonControlPlaneStore(path);
  assert.equal((await restored.get("chat-1"))?.displayName, "chat-1");
  assert.equal(await restored.getSelection("owner", "test"), "chat-1");
  assert.equal(await restored.getProviderSession("chat-1", "claude", process.cwd()), "native-1");
  assert.equal(await restored.has("message-1"), true);
});

test("corrupt control-plane JSON fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-control-plane-"));
  const path = join(directory, "state.json");
  await writeFile(path, "{not-json", "utf8");
  await assert.rejects(() => new JsonControlPlaneStore(path).load(), (error: unknown) => error instanceof ControlPlaneStateError && /Malformed/.test(error.message));
});

test("control-plane writes a complete valid envelope atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-control-plane-"));
  const path = join(directory, "state.json");
  const store = new JsonControlPlaneStore(path);
  await store.save(conversation("chat-atomic"));
  const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  assert.equal(state.version, 1);
  assert.ok(state.conversations);
});

test("reset removes the durable provider binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-control-plane-"));
  const store = new JsonControlPlaneStore(join(directory, "state.json"));
  await store.setProviderSession("chat-1", "claude", process.cwd(), "native-1");
  await store.deleteProviderSession("chat-1", "claude", process.cwd());
  assert.equal(await store.getProviderSession("chat-1", "claude", process.cwd()), undefined);
});
