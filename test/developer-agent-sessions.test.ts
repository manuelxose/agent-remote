import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DeveloperSessionStateError,
  InMemoryDeveloperSessionStore,
  JsonDeveloperSessionStore
} from "../dist/runtime/developer-agent/src/sessions.js";

const expected = {
  agentId: "claude",
  nativeSessionId: "session-a",
  workspaceRoot: "/approved/workspace",
  updatedAt: "2026-09-10T00:00:00.000Z"
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
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      "whatsapp:conversation-a": expected
    });
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

test("JSON session store keeps keys containing colons isolated", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions.json");

  try {
    const store = new JsonDeveloperSessionStore(path);
    await store.load();
    await store.set("whatsapp:tenant:conversation-a", expected);

    assert.deepEqual(await store.get("whatsapp:tenant:conversation-a"), expected);
    assert.equal(await store.get("whatsapp:tenant:conversation-b"), undefined);
    assert.equal(await store.get("whatsapp:conversation-a"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON session store preserves concurrent writes for different conversations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "developer-agent-sessions-"));
  const path = join(directory, "sessions.json");
  const second = { ...expected, nativeSessionId: "session-b" };

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
