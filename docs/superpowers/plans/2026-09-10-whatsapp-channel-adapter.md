# WhatsApp Channel Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Baileys WhatsApp gateway that translates authorized incoming messages into the core flow and returns agent responses to the originating chat.

**Architecture:** Keep `channels/whatsapp` as a transport-only package. It owns Baileys socket/auth/lifecycle, parsing, allowlists, structured transport logs, and health snapshots. The gateway supplies `gateway.handle` as the incoming callback; existing core events, route resolution, runtime execution, and response delivery remain in the gateway.

**Tech Stack:** TypeScript ESM, Node.js built-ins, Node test runner, `@whiskeysockets/baileys@^7.0.0-rc14`, no QR renderer or agent dependency.

**Spec:** `docs/superpowers/specs/2026-09-10-whatsapp-channel-adapter-design.md`

**Status:** Implemented and verified in the isolated worktree.

## Global Constraints

- Keep the WhatsApp package free of agent/runtime/product imports.
- Persist auth under the validated `WHATSAPP_AUTH_PATH` directory and never log auth state or QR contents.
- Empty allowlist configuration denies all inbound traffic.
- Reject unauthorized messages before the gateway callback is invoked.
- Ignore messages sent by the local account to prevent response loops.
- Use injected socket/auth dependencies in tests; tests never connect to WhatsApp.
- Use the existing `Channel`, `Message`, `AgentResponse`, `Gateway`, and `EventBus` contracts.
- Keep reconnection bounded and stop reconnecting after explicit logout or graceful shutdown.

---

### Task 1: Extend channel-neutral message metadata

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `test/core.test.ts` or create it if absent

**Interfaces:**
- Add `MessageAttachment` with `kind`, optional `mimeType`, `fileName`, and `size`.
- Add optional `Message.groupId` and `Message.attachments` fields.
- Keep the core package free of WhatsApp names and imports.

- [ ] **Step 1: Write the failing contract test**

```ts
test("message supports channel-neutral group and attachment metadata", () => {
  const message: Message = {
    id: "m1", conversationId: "c1", channel: "test", senderId: "u1",
    text: "caption", receivedAt: new Date(0), groupId: "g1",
    attachments: [{ kind: "image", mimeType: "image/png", fileName: "x.png", size: 12 }]
  };
  assert.equal(message.attachments?.[0].kind, "image");
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the fields are missing.**
- [ ] **Step 3: Add the two minimal core interfaces/fields.**
- [ ] **Step 4: Run the focused test and the existing core tests.**
- [ ] **Step 5: Commit `feat: add channel-neutral attachment metadata`.**

### Task 2: Add validated WhatsApp configuration and pure translation

**Files:**
- Modify: `channels/whatsapp/src/index.ts` only for exports if needed
- Create: `channels/whatsapp/src/config.ts`
- Create: `channels/whatsapp/src/translate.ts`
- Create: `test/whatsapp-translation.test.ts`

**Interfaces:**
- `WhatsAppConfig` contains `authPath`, `allowedUsers`, `allowedChats`, and reconnect delay settings.
- `parseWhatsAppConfig(env: NodeJS.ProcessEnv): WhatsAppConfig` trims comma-separated values, rejects an empty auth path, and defaults to deny-all allowlists.
- `translateWhatsAppMessage(message: Readonly<WAMessage>): Message | undefined` returns `undefined` for self-sent, status, broadcast, or unparseable messages.
- `authorizeWhatsAppMessage(message, config): { allowed: true } | { allowed: false; reason: string }` matches a chat allowlist against conversation/group ID and requires every configured filter to pass.

- [ ] **Step 1: Write failing tests for direct text, group sender/group ID, media caption/metadata, missing text, self-sent messages, and allowlist semantics.**

```ts
test("translates a group media message into a channel-neutral Message", () => {
  const result = translateWhatsAppMessage({
    key: { id: "m1", remoteJid: "120@g.us", participant: "u@s.whatsapp.net", fromMe: false },
    messageTimestamp: 1700000000,
    message: { imageMessage: { caption: "see", mimetype: "image/png", fileName: "a.png", fileLength: 9 } }
  } as WAMessage);
  assert.deepEqual(result && { ...result, receivedAt: result.receivedAt.getTime() }, {
    id: "m1", conversationId: "120@g.us", channel: "whatsapp", senderId: "u@s.whatsapp.net",
    groupId: "120@g.us", text: "see", receivedAt: 1700000000000,
    attachments: [{ kind: "image", mimeType: "image/png", fileName: "a.png", size: 9 }]
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm failures are caused by missing translation/config behavior.**
- [ ] **Step 3: Implement direct field extraction and narrow helpers for timestamps, text/captions, JIDs, and attachments.**
- [ ] **Step 4: Implement fail-closed allowlist authorization without logging or routing.**
- [ ] **Step 5: Run focused tests and the existing boundary tests.**
- [ ] **Step 6: Commit `feat: add WhatsApp message translation and policy`.**

### Task 3: Implement the Baileys lifecycle adapter

**Files:**
- Modify: `channels/whatsapp/src/index.ts`
- Create: `channels/whatsapp/src/lifecycle.ts`
- Create: `test/whatsapp-channel.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json` only if Baileys typings require an explicit Node type inclusion

**Interfaces:**
- `WhatsAppChannelOptions` accepts validated config, `onMessage(payload: unknown): Promise<void>`, optional `onQr(qr: string): void`, optional structured logger, and injectable `loadAuthState`/`createSocket` functions.
- `WhatsAppChannel.start(): Promise<void>` initializes auth and one socket; repeated calls are idempotent.
- `WhatsAppChannel.stop(): Promise<void>` cancels reconnect timers and closes the active socket without deleting auth.
- `WhatsAppChannel.health(): WhatsAppHealth` returns status, transition time, reconnect attempt, and sanitized error code only.
- `WhatsAppChannel.receive(payload)` calls translation and authorization, logs rejected IDs/reason, then returns `Message` or throws `InvalidWhatsAppPayloadError`/`UnauthorizedWhatsAppMessageError`.
- `WhatsAppChannel.send(conversationId, response)` calls `socket.sendMessage(conversationId, { text: response.text })` and requires an open socket.

- [ ] **Step 1: Write failing lifecycle tests using a fake event emitter socket and fake auth loader.**

```ts
test("incoming authorized payload reaches the supplied gateway handler", async () => {
  const delivered: unknown[] = [];
  const channel = createTestChannel({ onMessage: async payload => delivered.push(payload) });
  await channel.start();
  fakeSocket.emit("messages.upsert", { messages: [incomingTextMessage()] });
  assert.equal(delivered.length, 1);
});
```

- [ ] **Step 2: Run the focused test and confirm failure because lifecycle methods are absent.**
- [ ] **Step 3: Add the Baileys dependency and implement auth loading, credential persistence, and event wiring.**
- [ ] **Step 4: Implement QR callback and state transitions without passing QR/auth values to the logger.**
- [ ] **Step 5: Implement reconnect-on-transient-close with capped exponential delay, and no reconnect for logout or after `stop()`.**
- [ ] **Step 6: Implement safe shutdown and response delivery.**
- [ ] **Step 7: Run focused lifecycle tests, including rejection-before-callback and no-secret logging assertions.**
- [ ] **Step 8: Commit `feat: add Baileys WhatsApp lifecycle adapter`.**

### Task 4: Wire the gateway composition and document operation

**Files:**
- Modify: `apps/gateway/src/index.ts`
- Create: `apps/gateway/src/whatsapp.ts`
- Modify: `.gitignore` if the auth default needs an explicit local-data ignore
- Modify: `docs/architecture.md`
- Create: `docs/whatsapp.md`
- Modify: `test/gateway.test.ts`

**Interfaces:**
- `createWhatsAppGateway(dependencies, env): { gateway: Gateway; channel: WhatsAppChannel }` constructs the adapter with `onMessage: payload => gateway.handle(payload)`.
- The returned channel health snapshot is directly available to the gateway application.
- Documentation lists environment variables, local auth handling, QR callback behavior, allowlist semantics, and graceful shutdown.

- [ ] **Step 1: Write a failing integration test proving a Baileys-shaped incoming message reaches the router and a mock response is sent to the same conversation.**
- [ ] **Step 2: Run the focused integration test and confirm the composition function is absent.**
- [ ] **Step 3: Implement the smallest composition helper; do not add agent selection or runtime logic to WhatsApp.**
- [ ] **Step 4: Add the operational documentation and ensure auth directories are ignored.**
- [ ] **Step 5: Run the full test suite and build.**
- [ ] **Step 6: Commit `feat: wire WhatsApp channel into gateway`.**

### Task 5: Refresh project knowledge and verify the complete contract

**Files:**
- Modify: `.planning/STATE.md`
- Modify: `.planning/ROADMAP.md` only if the new adapter milestone needs recording
- Modify: `docs/architecture.md` if final names differ from the spec
- Modify: `test/boundaries.test.ts`

- [ ] **Step 1: Add boundary assertions that the WhatsApp source imports only core/channel contracts and Baileys, with no agent/product references.**
- [ ] **Step 2: Run `npm test` and `npm run build` from the isolated worktree; record exact counts and exit status.**
- [ ] **Step 3: Refresh Graphify after code changes.**
- [ ] **Step 4: Update planning state with verified adapter status and remaining provider-operational limitations.**
- [ ] **Step 5: Review the diff for secrets, auth-path mistakes, accidental payload logging, and unrelated changes.**
- [ ] **Step 6: Commit `test: verify WhatsApp adapter boundaries`.**

## Plan Self-Review

- Spec coverage: authentication persistence/restart, QR/pairing, reconnect, shutdown, parsing, attachments, allowlists, rejection logging, health, gateway routing, response delivery, and package boundary tests are covered by Tasks 2–5.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation step remains.
- Type consistency: `onMessage(payload)` feeds the existing `Gateway.handle(payload)`; `Channel.receive` returns the extended core `Message`; `Channel.send` accepts the existing `AgentResponse`; health is adapter-specific and exposed by the composition helper.
