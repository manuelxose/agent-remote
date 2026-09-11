# WhatsApp Chat Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Import available WhatsApp history locally and let an authorized user ask the active agent questions about any imported chat with \`/chat <name|id> <question>\`.

**Architecture:** Reuse the existing WhatsApp translator and control-plane command registry. Add a dependency-free JSONL history repository that stores normalized messages and chat metadata, subscribe to Baileys \`messaging-history.set\` plus live message upserts, and inject a bounded, untrusted transcript only for explicit \`/chat\` questions. Preserve \`/chat <name|id>\` as managed-session selection.

**Tech Stack:** TypeScript, Node.js standard library (\`fs/promises\`, \`readline\`), Baileys event map, existing Node test runner, existing JSON persistence patterns.

**Spec:** \`docs/superpowers/specs/2026-09-11-whatsapp-chat-context-design.md\`

## Global Constraints

- Import history visible to the linked WhatsApp account; never claim completeness when WhatsApp supplied partial history.
- Store text and metadata locally; do not download media binaries.
- Do not add a dependency in v1.
- Require an explicit \`/chat\` question; ordinary messages never search other chats.
- Scope queries to the authorized owner/operator and WhatsApp channel.
- Treat imported transcript content as untrusted reference data.
- Bound retrieval by message count and characters and report coverage.
- Keep local history files under \`data/\`, mode 0600, ignored by Git and diagnostics.
- Add a focused runnable test for every non-trivial behavior, and run \`npm test\` before integration.

## File Map

- Create \`packages/conversations/src/history.ts\`: channel-neutral history records, query result types, in-memory store, JSONL store.
- Modify \`packages/conversations/src/index.ts\`: export history contracts and stores.
- Modify \`channels/whatsapp/src/lifecycle.ts\`: ingest history-sync and live messages through an optional store callback without routing imports.
- Modify \`channels/whatsapp/src/index.ts\`: export history-related channel types if needed.
- Modify \`apps/gateway/src/application.ts\`: compose the JSONL store and pass it to the channel/control plane.
- Modify \`packages/control-plane/src/index.ts\`: resolve \`/chat\` target, format bounded transcript, and queue cross-chat questions.
- Modify \`packages/core/src/index.ts\` only if a shared context type is required; avoid changing it otherwise.
- Modify \`test/conversations-history.test.ts\`: repository behavior and retrieval limits.
- Modify \`test/whatsapp-channel.test.ts\`: history event ingestion and no-routing behavior.
- Modify \`test/control-plane.test.ts\`: command parsing, ambiguity, prompt construction, and preserved session selection.
- Modify \`test/operational.test.ts\`: application composition and persistence smoke coverage.
- Modify \`README.md\` and \`docs/whatsapp.md\`: command syntax, import limitations, local data handling, and no-media-download scope.

### Task 1: Add the dependency-free history repository

**Files:**
- Create: \`packages/conversations/src/history.ts\`
- Modify: \`packages/conversations/src/index.ts\`
- Create: \`test/conversations-history.test.ts\`

**Interfaces:**

~~~ts
export interface HistoryChat {
  channel: string;
  conversationId: string;
  displayName: string;
  kind: "private" | "group" | "unknown";
  updatedAt: string;
}

export interface HistoryQueryLimits {
  maxMessages: number;
  maxCharacters: number;
}

export interface HistoryQueryResult {
  chat: HistoryChat;
  messages: Message[];
  importedMessageCount: number;
  oldestAvailableAt?: Date;
  newestAvailableAt?: Date;
  truncated: boolean;
}

export interface HistoryStore {
  upsertChat(chat: HistoryChat): Promise<void>;
  upsertMessage(message: Message): Promise<void>;
  listChats(channel: string, query?: string, limit?: number): Promise<HistoryChat[]>;
  query(channel: string, conversationId: string, question: string, limits: HistoryQueryLimits): Promise<HistoryQueryResult | undefined>;
}
~~~

- [ ] **Step 1: Write the failing tests** for deduplication, case-insensitive partial matching, chronological query results, lexical matches plus recent messages, character/message caps, and missing-chat results.

~~~ts
test("JSON history store deduplicates messages and resolves partial chat names", async () => {
  const store = new InMemoryHistoryStore();
  await store.upsertChat({ channel: "whatsapp", conversationId: "chat-1", displayName: "Viaje familiar", kind: "private", updatedAt: "2026-01-01T00:00:00.000Z" });
  await store.upsertMessage(message("m-1", "chat-1", "Hotel confirmado"));
  await store.upsertMessage(message("m-1", "chat-1", "duplicado"));
  assert.deepEqual((await store.listChats("whatsapp", "viaje"))[0].conversationId, "chat-1");
  const result = await store.query("whatsapp", "chat-1", "hotel", { maxMessages: 10, maxCharacters: 1000 });
  assert.equal(result?.importedMessageCount, 1);
  assert.equal(result?.messages[0].text, "Hotel confirmado");
});

test("history query returns lexical matches and recent messages within both limits", async () => {
  const store = new InMemoryHistoryStore();
  for (let index = 0; index < 5; index++) await store.upsertMessage(message(\`m-\${index}\`, "chat-1", index === 1 ? "pedido precio 20" : \`nota \${index}\`));
  const result = await store.query("whatsapp", "chat-1", "precio", { maxMessages: 3, maxCharacters: 30 });
  assert.equal(result?.messages.length, 3);
  assert.equal(result?.truncated, true);
  assert.ok(result?.messages.some(item => item.text.includes("precio")));
});
~~~

- [ ] **Step 2: Run the focused test and verify it fails for the missing store.**

Run: \`npm run build && node --test --experimental-strip-types test/conversations-history.test.ts\`

Expected: FAIL because the new history store exports and behavior do not exist yet.

- [ ] **Step 3: Implement the smallest store**.

Use an in-memory \`Map\` keyed by \`channel\\u0000conversationId\\u0000messageId\` for tests and a chat map keyed by channel/conversation. Query by lower-cased question tokens, include matching messages and newest messages, sort by \`receivedAt\`, and stop at both limits. For the JSON implementation, load JSONL once, append one record per new message/chat, serialize writes through a promise queue, create parent directories, and use \`chmod(path, 0o600)\` after creation. Skip malformed records while retaining valid records.

~~~ts
export class InMemoryHistoryStore implements HistoryStore { /* same contract, no persistence */ }
export class JsonHistoryStore extends InMemoryHistoryStore {
  constructor(readonly path: string) { super(); }
}
~~~

Add one \`ponytail:\` comment at the linear lexical scan that names the SQLite/index upgrade ceiling.

- [ ] **Step 4: Run the focused test and verify it passes.**

Run: \`npm run build && node --test --experimental-strip-types test/conversations-history.test.ts\`

Expected: all history-store tests pass.

- [ ] **Step 5: Commit the repository slice.**

~~~bash
git add packages/conversations/src/history.ts packages/conversations/src/index.ts test/conversations-history.test.ts
git commit -m "feat: add local WhatsApp history store"
~~~

### Task 2: Import Baileys history and live messages

**Files:**
- Modify: \`channels/whatsapp/src/lifecycle.ts\`
- Modify: \`channels/whatsapp/src/index.ts\` only for exports
- Modify: \`test/whatsapp-channel.test.ts\`

**Interfaces:**

~~~ts
export interface WhatsAppHistorySink {
  upsertChat(chat: HistoryChat): Promise<void>;
  upsertMessage(message: Message): Promise<void>;
}

export interface WhatsAppChannelOptions {
  // existing properties...
  historySink?: WhatsAppHistorySink;
}
~~~

- [ ] **Step 1: Write failing channel tests** that emit \`messaging-history.set\` with private/group chat metadata and messages, then assert the sink receives normalized records; emit the same live message twice and assert one stored message; assert history ingestion does not call \`onMessage\`.

~~~ts
test("imports history batches without routing them", async () => {
  const imported: Message[] = [];
  const events = fakeEvents();
  const channel = new WhatsAppChannel({ config: testConfig(), onMessage: async () => { throw new Error("must not route history"); }, historySink: { upsertChat: async () => {}, upsertMessage: async message => imported.push(message) }, loadAuthState: fakeAuth, createSocket: () => fakeSocket(events) });
  await channel.start();
  events.emit("messaging-history.set", { chats: [{ id: "chat-1", name: "Viaje" }], contacts: [], messages: [rawMessage("history-1", "chat-1", "hotel")], isLatest: true });
  await flush();
  assert.equal(imported[0].text, "hotel");
});
~~~

- [ ] **Step 2: Run the focused test and verify the expected failure.**

Run: \`npm run build && node --test --experimental-strip-types test/whatsapp-channel.test.ts\`

Expected: FAIL because the socket does not subscribe to \`messaging-history.set\` and no history sink exists.

- [ ] **Step 3: Implement passive ingestion**.

Subscribe and remove the \`messaging-history.set\` listener with the existing lifecycle listener pattern. Convert \`chat.id\`, \`chat.name\`/subject, and group/private suffix into \`HistoryChat\`. Translate history messages with self-message allowance, send valid normalized messages to the sink, and never call \`onMessage\`. Send live normalized messages to the sink after authorization but before \`onMessage\`; sink failures log a safe \`whatsapp_history_persistence_failed\` event and must not prevent live routing. Keep the current tracked-outbound and authorization behavior intact.

- [ ] **Step 4: Run focused channel tests and the full suite.**

Run: \`npm test\`

Expected: existing tests plus history tests pass with zero failures.

- [ ] **Step 5: Commit the channel slice.**

~~~bash
git add channels/whatsapp/src/lifecycle.ts channels/whatsapp/src/index.ts test/whatsapp-channel.test.ts
git commit -m "feat: import WhatsApp history events"
~~~

### Task 3: Add \`/chat <source> <question>\` to the control plane

**Files:**
- Modify: \`packages/control-plane/src/index.ts\`
- Modify: \`test/control-plane.test.ts\`

**Interfaces:**

~~~ts
export interface HistoryContextProvider {
  listChats(channel: string, query?: string, limit?: number): Promise<HistoryChat[]>;
  query(channel: string, conversationId: string, question: string, limits: HistoryQueryLimits): Promise<HistoryQueryResult | undefined>;
}

export interface ControlPlaneOptions {
  // existing properties...
  history?: HistoryContextProvider;
  historyLimits?: HistoryQueryLimits;
}
~~~

- [ ] **Step 1: Write failing tests** for \`/chat viaje planifica...\`, ambiguous sources producing no runtime call, unknown source, no-question \`/chat\` preserving managed session selection, and transcript prompt safety/limits.

~~~ts
test("chat question uses another WhatsApp chat as bounded reference context", async () => {
  const calls: string[] = [];
  const control = createControl({ history: fakeHistory("chat-viaje", "Viaje", "Hotel el viernes"), onPrompt: prompt => calls.push(prompt) });
  await control.handle(message("init", "/init"), owner);
  await control.handle(message("agent", "/codex"), owner);
  const result = await control.handle(message("question", "/chat viaje planifica el viaje"), owner);
  assert.equal(result.status, "success");
  assert.match(calls[0], /Referenced WhatsApp chat: Viaje/);
  assert.match(calls[0], /Hotel el viernes/);
  assert.match(calls[0], /untrusted reference data/i);
});

test("ambiguous chat query never reaches the runtime", async () => {
  const calls: string[] = [];
  const control = createControl({ history: fakeHistoryMatches(["Viaje Ana", "Viaje Trabajo"]), onPrompt: prompt => calls.push(prompt) });
  const result = await control.handle(message("ambiguous", "/chat viaje planifica"), owner);
  assert.equal(result.status, "warning");
  assert.equal(calls.length, 0);
});
~~~

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: \`npm run build && node --test --experimental-strip-types test/control-plane.test.ts\`

Expected: FAIL because \`/chat\` currently only selects managed sessions and has no history provider.

- [ ] **Step 3: Implement the minimal command branch**.

Keep \`/chat <name|id>\` selection exactly as it is when no question is present. For a question, resolve the source via \`listChats\`; require one match, fetch bounded history, and create a synthetic provider prompt with stable section labels and untrusted-data instructions. Execute it through the current managed session using the existing queue, origin, reply reference, and failure handling. If history is absent, return an error before queueing. Extend \`/chat\` with no args to list up to 30 imported chats only when \`history\` is configured. Preserve owner/operator checks and command idempotency.

- [ ] **Step 4: Run focused and full tests.**

Run: \`npm test\`

Expected: all tests pass and no existing managed-chat selection behavior changes.

- [ ] **Step 5: Commit the control-plane slice.**

~~~bash
git add packages/control-plane/src/index.ts test/control-plane.test.ts
git commit -m "feat: query imported chats from WhatsApp"
~~~

### Task 4: Compose persistence, docs, and integration coverage

**Files:**
- Modify: \`apps/gateway/src/application.ts\`
- Modify: \`test/operational.test.ts\`
- Modify: \`README.md\`
- Modify: \`docs/whatsapp.md\`

**Interfaces:**

~~~ts
const history = new JsonHistoryStore(
  resolveFrom(cwd, env.AGENT_REMOTE_HISTORY_PATH ?? "data/whatsapp-history.jsonl")
);

// Pass the same history instance to createWhatsAppGateway and ControlPlane.
~~~

- [ ] **Step 1: Write failing composition tests** for the default history path, optional \`AGENT_REMOTE_HISTORY_PATH\`, and one application instance sharing the same history repository between WhatsApp ingestion and control-plane queries.

~~~ts
test("application composes one persistent history repository", async () => {
  const config = loadApplicationConfig({ ...testEnv(), AGENT_REMOTE_HISTORY_PATH: "data/test-history.jsonl" }, cwd);
  const app = createApplication(config, testDependencies());
  assert.match(app.controlPlane.registry.help(), /\\/chat/);
  await app.stop();
});
~~~

- [ ] **Step 2: Run the focused test and verify failure.**

Run: \`npm run build && node --test --experimental-strip-types test/operational.test.ts\`

Expected: FAIL because application configuration and composition do not expose a history repository.

- [ ] **Step 3: Implement composition and documentation**.

Add \`historyPath\` to \`ApplicationConfig\`, parse the env override, instantiate one \`JsonHistoryStore\`, pass it as the channel \`historySink\` and control-plane \`history\` provider, and load it before socket start. Update \`.env.example\` if present, README, and WhatsApp docs with examples, explicit import coverage limits, 0600 local file handling, and the fact that attachment binaries are not downloaded.

- [ ] **Step 4: Run build, focused integration tests, and full tests.**

Run: \`npm test\`

Expected: zero failures; existing doctor and route tests remain green.

- [ ] **Step 5: Commit composition and docs.**

~~~bash
git add apps/gateway/src/application.ts test/operational.test.ts README.md docs/whatsapp.md .env.example
git commit -m "feat: compose persistent WhatsApp chat context"
~~~

### Task 5: Verify, refresh project knowledge, integrate, push, and deploy locally

**Files:**
- Modify: \`.planning/STATE.md\` and the relevant phase verification artifact only if the project workflow requires recording this feature.
- Generated local-only: \`graphify-out/\` (do not stage ignored Graphify output).

- [ ] **Step 1: Run the complete verification commands from the feature worktree.**

~~~bash
npm test
npm run doctor
git diff --check
~~~

Record exact counts and distinguish optional Copilot/live WhatsApp limitations from implementation failures.

- [ ] **Step 2: Refresh Graphify after code changes.**

~~~bash
graphify update .
~~~

Do not index \`.env\`, WhatsApp auth, local history data, \`data/\`, \`dist/\`, or dependencies.

- [ ] **Step 3: Run the real local smoke check** with a temporary history file and the already configured linked WhatsApp account. Confirm startup, \`whatsapp_connected\`, history event handling if Baileys emits it, and no response is emitted merely by import. Do not print message contents or credentials.

- [ ] **Step 4: Review the complete diff and verify the worktree**.

~~~bash
git status --short
git log --oneline --decorate -8
git diff main...HEAD --stat
git diff main...HEAD --check
~~~

- [ ] **Step 5: Merge and push only after verification evidence.**

~~~bash
git checkout main
git merge --no-ff feat/whatsapp-chat-context -m "merge: add WhatsApp chat context queries"
git push origin main
~~~

- [ ] **Step 6: Deploy locally by rebuilding and restarting the gateway** while preserving \`.env\`, \`data/whatsapp-auth\`, and local history files. Confirm exactly one gateway process, \`agent-remote started\`, and \`whatsapp_connected\`.

- [ ] **Step 7: Verify final Git and runtime state.**

~~~bash
git status --porcelain
git rev-parse main
git rev-parse origin/main
pgrep -af 'node dist/apps/gateway/src/main.js'
~~~

Expected: clean tree, equal local/remote revisions, and one active gateway process.
