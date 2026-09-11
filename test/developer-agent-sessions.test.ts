import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createDeveloperSessionKey,
  DeveloperSessionStateError,
  InMemoryDeveloperSessionStore,
  JsonDeveloperSessionStore
} from "../dist/runtime/developer-agent/src/sessions.js";

const expected = {
  nativeSessionId: "session-a"
};

test("in-memory session store isolates channel and conversation keys", async () => {
  const store = new InMemoryDeveloperSessionStore();

  await store.set("whatsapp:conversation-a", expected);

  assert.deepEqual(await store.get("whatsapp:conversation-a"), expected);
  assert.equal(await store.get("whatsapp:conversation-b"), undefined);
});

test("JSON session store reloads persisted mappings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions.json");

  try {
    const first = new JsonDeveloperSessionStore(path);
    await first.load();
    await first.set("whatsapp:conversation-a", expected);

    const second = new JsonDeveloperSessionStore(path);
    await second.load();

    assert.deepEqual(await second.get("whatsapp:conversation-a"), expected);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { "whatsapp:conversation-a": expected });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON session store rejects malformed JSON with a named error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions.json");

  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{not-json", "utf8");

    await assert.rejects(
      () => new JsonDeveloperSessionStore(path).load(),
      error => error instanceof DeveloperSessionStateError && error.name === "DeveloperSessionStateError"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session keys keep tuple components containing colons isolated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions.json");

  try {
    const store = new JsonDeveloperSessionStore(path);
    await store.load();
    const first = createDeveloperSessionKey("a:b", "c", "claude", "/approved/workspace");
    const second = createDeveloperSessionKey("a", "b:c", "claude", "/approved/workspace");
    assert.notEqual(first, second);
    await store.set(first, expected);

    assert.deepEqual(await store.get(first), expected);
    assert.equal(await store.get(second), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON session store preserves concurrent writes for different conversations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions.json");
  const second = { nativeSessionId: "session-b" };

  try {
    const store = new JsonDeveloperSessionStore(path);
    await Promise.all([
      store.set("whatsapp:conversation-a", expected),
      store.set("whatsapp:conversation-b", second)
    ]);

    const reloaded = new JsonDeveloperSessionStore(path);
    await reloaded.load();
    assert.deepEqual(await reloaded.get("whatsapp:conversation-a"), expected);
    assert.deepEqual(await reloaded.get("whatsapp:conversation-b"), second);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON session store does not retain a mapping when rename fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions");
  const persisted = { nativeSessionId: "persisted-session" };

  try {
    await writeFile(path, "{}\n", "utf8");
    const store = new JsonDeveloperSessionStore(path);
    await store.load();
    await rm(path, { force: true });
    await mkdir(path);
    await assert.rejects(() => store.set("whatsapp:unpersisted", expected));
    assert.equal(await store.get("whatsapp:unpersisted"), undefined);

    await rm(path, { recursive: true, force: true });
    await store.set("whatsapp:persisted", persisted);

    const reloaded = new JsonDeveloperSessionStore(path);
    await reloaded.load();
    assert.equal(await reloaded.get("whatsapp:unpersisted"), undefined);
    assert.deepEqual(await reloaded.get("whatsapp:persisted"), persisted);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON session store rejects legacy metadata-shaped records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions.json");

  try {
    await writeFile(path, JSON.stringify({ key: { ...expected, agentId: "claude", workspaceRoot: "/approved", updatedAt: "now" } }), "utf8");
    await assert.rejects(() => new JsonDeveloperSessionStore(path).load(), DeveloperSessionStateError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
