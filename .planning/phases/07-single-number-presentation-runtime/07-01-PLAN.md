# Single-Number Presentation Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured logical origin metadata, bounded Agent Remote message correlation, final-only WhatsApp delivery, and an opt-in Web/Desktop presentation companion while preserving one WhatsApp account and the existing provider runtime.

**Architecture:** Keep transport-neutral origin and participant contracts in `packages/core`; keep the exact WhatsApp message-ID registry and Baileys integration inside `channels/whatsapp`; expose only sanitized registry metadata through an authenticated loopback bridge; let a Manifest V3 content script augment matching official Web/Desktop DOM nodes without touching protocol traffic. Provider streaming remains internal, while WhatsApp sends one final correlated reply plus optional delayed progress.

**Tech Stack:** TypeScript, Node.js built-in `http`, Node test runner, TypeScript compiler, Baileys `7.0.0-rc14`, Manifest V3 browser extension APIs, existing in-memory event/session/runtime abstractions.

**Spec:** `docs/superpowers/specs/2026-09-11-single-number-presentation-runtime-design.md`

## Global Constraints

- Exactly one WhatsApp account and phone number; no second participant, SIM, Business identity, or human account.
- Do not spoof `fromMe`, forge inbound protocol messages, intercept WhatsApp encryption/network traffic, or modify WhatsApp databases.
- Baileys types remain inside `channels/whatsapp`; provider JSON remains inside provider adapters; core/control-plane stay transport-agnostic.
- Registry memory is bounded by fixed capacity and TTL; never match messages by response text or store prompts unnecessarily.
- Default WhatsApp behavior is composing presence plus one final reply; progress is disabled unless a positive threshold is configured.
- Use only existing dependencies and Node/browser platform APIs; do not add a package for HTTP, WebSocket, DOM observation, or UUIDs.
- Every non-trivial behavior gets a focused runnable Node test, written and observed failing before production code.
- Official mobile WhatsApp behavior remains unchanged and must be reported as not controllable for left-side agent rendering.
- Never expose provider prompts, response bodies, credentials, auth state, QR values, or bridge tokens in logs, DOM, or diagnostics.

### Task 1: Add transport-neutral logical identity and message origin

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `test/core.test.ts`
- Modify: `test/realtime-contracts.test.ts`
- Modify: `packages/control-plane/src/index.ts`

**Interfaces:**
- Produces `LogicalParticipantKind`, `LogicalParticipant`, and `MessageOrigin` from `packages/core/src/index.ts`.
- `Message` gains optional `origin?: MessageOrigin`.
- `OutboundMessage` gains optional `origin?: MessageOrigin`; Agent Remote execution responses will populate it before delivery.
- `MessageReference` remains unchanged and is still the only channel correlation type.

- [ ] **Step 1: Write the failing contract tests**

Add the following assertions to `test/core.test.ts` or the focused realtime contract file:

```ts
import type { MessageOrigin, OutboundMessage } from "../dist/packages/core/src/index.js";

test("outbound agent messages carry structured origin metadata", () => {
  const origin: MessageOrigin = {
    type: "agent",
    agentId: "claude",
    executionId: "exec-a",
    logicalSessionId: "session-a"
  };
  const response: OutboundMessage = { text: "clean response", origin };
  assert.equal(response.origin?.type, "agent");
  assert.equal(response.origin?.agentId, "claude");
  assert.equal(response.origin?.executionId, "exec-a");
  assert.equal(response.origin?.logicalSessionId, "session-a");
});
```

Add a compile-time/runtime shape assertion that a human inbound message can omit origin and that the allowed values are exactly `human`, `agent`, and `system`.

- [ ] **Step 2: Run the focused tests and verify the intended failure**

Run:

```bash
npm run build && node --test --experimental-strip-types test/core.test.ts test/realtime-contracts.test.ts
```

Expected: TypeScript fails because `MessageOrigin` is not exported and `OutboundMessage` has no `origin` field.

- [ ] **Step 3: Implement the minimum core contracts**

In `packages/core/src/index.ts`, add:

```ts
export type LogicalParticipantKind = "human" | "agent" | "system";

export interface LogicalParticipant {
  id: string;
  kind: LogicalParticipantKind;
  displayName: string;
}

export interface MessageOrigin {
  type: LogicalParticipantKind;
  agentId?: string;
  executionId?: string;
  logicalSessionId?: string;
}
```

Add `origin?: MessageOrigin` to `Message` and `OutboundMessage`. In the control plane’s provider execution completion path, create:

```ts
const origin: MessageOrigin = {
  type: "agent",
  agentId: current.agent,
  executionId: message.id,
  logicalSessionId: current.logicalSessionId
};
```

Return the final response with `{ ...response, origin, replyTo: reference }`, preserving any existing response fields and exact triggering reference.

- [ ] **Step 4: Run the focused tests and the boundary checks**

Run:

```bash
npm run build && node --test --experimental-strip-types test/core.test.ts test/realtime-contracts.test.ts test/boundaries.test.ts
```

Expected: PASS, with no channel/provider imports added to `packages/core`.

- [ ] **Step 5: Commit the contract change**

```bash
git add packages/core/src/index.ts packages/control-plane/src/index.ts test/core.test.ts test/realtime-contracts.test.ts
git commit -m "feat: add structured logical message origins"
```

### Task 2: Replace ID-only tracking with a bounded Agent Message Registry

**Files:**
- Create: `channels/whatsapp/src/agent-registry.ts`
- Modify: `channels/whatsapp/src/lifecycle.ts`
- Modify: `channels/whatsapp/src/index.ts`
- Modify: `test/realtime-whatsapp.test.ts`
- Create: `test/whatsapp-agent-registry.test.ts`

**Interfaces:**
- `AgentGeneratedMessageMetadata` contains `whatsappMessageId`, `conversationId`, `origin`, optional `replyToMessageId`, and `createdAt`.
- `AgentMessageRegistry` exposes `remember(metadata)`, `get(messageId, conversationId?)`, `has(messageId)`, `snapshot()`, and `prune()`.
- Constructor options are `{ maxEntries: number; ttlMs: number; now?: () => number }`.
- `WhatsAppChannel` owns one registry and records successful Baileys send IDs; the registry remains independent of Baileys types.

- [ ] **Step 1: Write failing registry tests**

Create `test/whatsapp-agent-registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and verify they fail for the missing registry**

Run:

```bash
npm run build && node --test --experimental-strip-types test/whatsapp-agent-registry.test.ts
```

Expected: module import or class-not-found failure.

- [ ] **Step 3: Implement the bounded registry**

Use a `Map<string, AgentGeneratedMessageMetadata>` keyed by `whatsappMessageId`. On every `remember`, `get`, `has`, and `snapshot`, delete entries where `now() - createdAt >= ttlMs`; then evict `map.keys().next().value` until `size <= maxEntries`. Reject non-positive capacity/TTL in the constructor. Clone returned metadata objects so callers cannot mutate registry state. Do not store text, prompts, provider JSON, or Baileys objects.

- [ ] **Step 4: Integrate the registry with WhatsApp sends**

In `channels/whatsapp/src/lifecycle.ts`:

1. Replace the `outboundMessageIds` map with `AgentMessageRegistry`, retaining its `has()` behavior for self-message suppression.
2. After each successful `socket.sendMessage`, extract the returned message ID.
3. When `response.origin` exists, call `remember` with the response origin, conversation ID, exact `response.replyTo?.messageId`, and `Date.now()`.
4. Keep reply-context storage separate because native quote construction needs the original Baileys quoted object.
5. Expose a read-only `agentMessageRegistry()` snapshot method for the gateway presentation bridge; it returns metadata only.

Add `AgentGeneratedMessageMetadata` and `AgentMessageRegistry` exports from `channels/whatsapp/src/index.ts`. Keep all Baileys imports in the lifecycle/translation files.

- [ ] **Step 5: Add integration tests for exact IDs and wrong-message protection**

Extend `test/realtime-whatsapp.test.ts` with a fake socket whose `sendMessage` returns `{ key: { id: "wa-agent-a" } }`. Assert that the snapshot contains `wa-agent-a`, `agentId: "claude"`, `executionId`, `logicalSessionId`, and `replyToMessageId`, and that `has("wa-human-a")` is false. Add a self-chat test proving a tracked response ID is suppressed while an untracked `fromMe` prompt is accepted when self-messages are enabled.

- [ ] **Step 6: Run focused WhatsApp tests and commit**

```bash
npm run build && node --test --experimental-strip-types test/whatsapp-agent-registry.test.ts test/realtime-whatsapp.test.ts test/whatsapp-channel.test.ts test/whatsapp-translation.test.ts
git add channels/whatsapp/src test/whatsapp-agent-registry.test.ts test/realtime-whatsapp.test.ts
git commit -m "feat: correlate generated WhatsApp messages by metadata"
```

Expected: all focused tests pass.

### Task 3: Make WhatsApp delivery final-only by default with delayed progress

**Files:**
- Modify: `packages/control-plane/src/delivery.ts`
- Modify: `packages/control-plane/src/index.ts`
- Modify: `apps/gateway/src/application.ts`
- Modify: `apps/gateway/src/doctor.ts`
- Modify: `channels/whatsapp/src/config.ts`
- Modify: `.env.example`
- Modify: `test/realtime-control-plane.test.ts`
- Modify: `test/realtime-benchmark.test.ts`
- Modify: `test/operational.test.ts`

**Interfaces:**
- `StreamingDeliveryPolicy` becomes `{ progressAfterMs: number; progressText: string; maxMessagesPerExecution: number }`.
- `StreamDelivery.push(delta)` buffers provider output and never sends a delta directly.
- `StreamDelivery.complete(finalText)` sends exactly one final message unless one progress message was already sent.
- `StreamDelivery.fail()` cancels timers and sends nothing.
- `StreamDelivery` accepts an optional `onProgress` callback or uses the configured `progressText`; progress is sent once after the positive threshold and carries the original `replyTo` reference.

- [ ] **Step 1: Write failing delivery tests**

Add tests that establish the new default:

```ts
test("short execution sends one final response after streamed deltas", async () => {
  const sent: OutboundMessage[] = [];
  const delivery = new StreamDelivery(
    { progressAfterMs: 0, progressText: "Sigo trabajando…", maxMessagesPerExecution: 2 },
    message => { sent.push(message); },
    { channel: "whatsapp", conversationId: "chat-a", messageId: "incoming-a" }
  );
  await delivery.push("Hola ");
  await delivery.push("de nuevo");
  await delivery.complete("Hola de nuevo");
  assert.deepEqual(sent.map(message => message.text), ["Hola de nuevo"]);
  assert.equal(sent[0]?.replyTo?.messageId, "incoming-a");
});

test("long execution emits at most one delayed progress message", async () => {
  const sent: OutboundMessage[] = [];
  const delivery = new StreamDelivery(
    { progressAfterMs: 5, progressText: "Sigo trabajando…", maxMessagesPerExecution: 2 },
    message => { sent.push(message); },
    { channel: "whatsapp", conversationId: "chat-a", messageId: "incoming-a" }
  );
  await delivery.push("partial");
  await new Promise(resolve => setTimeout(resolve, 10));
  await delivery.complete("final");
  assert.deepEqual(sent.map(message => message.text), ["Sigo trabajando…", "final"]);
});
```

- [ ] **Step 2: Run focused tests and verify the old aggregator behavior fails**

```bash
npm run build && node --test --experimental-strip-types test/realtime-control-plane.test.ts
```

Expected: the short-turn test observes an intermediate message or the delayed-progress test cannot construct the new policy.

- [ ] **Step 3: Implement final-only aggregation**

Remove the character/interval flush behavior from `StreamDelivery`. Retain the internal buffer only for provider deltas and use the final result supplied to `complete` as the authoritative response. Schedule one timer only when `progressAfterMs > 0`; the timer sends `progressText` once and marks `progressSent`. Clear it in `complete` and `fail`. Enforce `maxMessagesPerExecution >= 1` and never send more than one progress plus one final.

- [ ] **Step 4: Add configuration and control-plane wiring**

Parse `AGENT_REMOTE_PROGRESS_AFTER_MS` as a non-negative integer, defaulting to `0`. Parse `AGENT_REMOTE_PROGRESS_TEXT`, defaulting to `Sigo trabajando…`. Keep `AGENT_REMOTE_STREAM_MIN_CHARS` and `AGENT_REMOTE_STREAM_MAX_INTERVAL_MS` out of the active WhatsApp policy; remove them from `.env.example` and diagnostics. Update `doctor` to print progress threshold and maximum message count without provider output or secrets.

In `ControlPlane`, pass `MessageOrigin` from Task 1 into the final `OutboundMessage`. Ensure the event observer can only trigger the configured delayed progress callback and cannot send raw `assistant.delta` text directly to WhatsApp. Preserve `markExecutionTransportReply` for first progress/final delivery telemetry.

- [ ] **Step 5: Verify presence lifecycle and failure cleanup**

Extend tests to assert `composing` occurs after acceptance, `paused` occurs for success/failure/cancellation, no processing acknowledgement is sent, and `StreamDelivery.fail()` sends no progress/final message. Assert concurrent executions retain distinct `replyTo` references and origins.

- [ ] **Step 6: Run runtime, control-plane, operational, and benchmark tests and commit**

```bash
npm run build && node --test --experimental-strip-types test/realtime-control-plane.test.ts test/realtime-benchmark.test.ts test/operational.test.ts test/control-plane.test.ts test/developer-agent-streaming.test.ts test/developer-agent-sessions.test.ts
git add packages/control-plane/src apps/gateway/src channels/whatsapp/src/config.ts .env.example test/realtime-control-plane.test.ts test/realtime-benchmark.test.ts test/operational.test.ts
git commit -m "fix: deliver WhatsApp executions as final replies"
```

Expected: focused tests pass and benchmark output contains measured cold/warm telemetry rather than fabricated constants.

### Task 4: Add the authenticated local Web/Desktop presentation companion

**Files:**
- Create: `apps/gateway/src/presentation-bridge.ts`
- Create: `presentation/whatsapp-companion/manifest.json`
- Create: `presentation/whatsapp-companion/src/protocol.ts`
- Create: `presentation/whatsapp-companion/src/locator.ts`
- Create: `presentation/whatsapp-companion/src/augment.ts`
- Create: `presentation/whatsapp-companion/src/content.ts`
- Create: `presentation/whatsapp-companion/README.md`
- Create: `test/whatsapp-companion.test.ts`
- Modify: `apps/gateway/src/application.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- `PresentationRegistryReader.snapshot(): AgentGeneratedMessageMetadata[]`.
- `createPresentationBridge({ host: "127.0.0.1", port, token, readRegistry, allowedOrigin }): { start(): Promise<void>; stop(): Promise<void>; address(): string }`.
- `WhatsAppMessageLocator.findByMessageId(id: string): HTMLElement | undefined`.
- `applyAgentPresentation(element, metadata): void` adds stable data attributes and an accessible logical-agent label without changing message text.
- `syncAgentPresentation(root, entries, locator): number` transforms only exact registry IDs and returns the number updated.

- [ ] **Step 1: Write failing pure companion tests**

Create `test/whatsapp-companion.test.ts` using small fake `HTMLElement`-compatible objects or a DOM-free adapter boundary:

```ts
test("companion augments only an exact registered agent message", () => {
  const human = fakeMessageElement("wa-human-a");
  const agent = fakeMessageElement("wa-agent-a");
  const entries = [metadata("wa-agent-a", "claude", "chat-a")];
  const updated = syncAgentPresentation(fakeRoot([human, agent]), entries, locatorFor([human, agent]));
  assert.equal(updated, 1);
  assert.equal(agent.dataset.agentRemoteOrigin, "agent");
  assert.equal(agent.dataset.agentId, "claude");
  assert.equal(human.dataset.agentRemoteOrigin, undefined);
});

test("conversation mismatch prevents visual transformation", () => {
  const agent = fakeMessageElement("wa-agent-a");
  const updated = syncAgentPresentation(fakeRoot([agent]), [metadata("wa-agent-a", "claude", "other-chat")], locatorFor([agent]));
  assert.equal(updated, 0);
  assert.equal(agent.dataset.agentRemoteOrigin, undefined);
});
```

Add tests for dynamic insertion, repeat sync/re-render, no text mutation, and no transformation when the locator cannot find an exact ID.

- [ ] **Step 2: Run the tests and verify missing companion modules fail**

```bash
npm run build && node --test --experimental-strip-types test/whatsapp-companion.test.ts
```

Expected: module-not-found or missing-export failure.

- [ ] **Step 3: Implement the DOM-safe locator and augmentation boundary**

Implement `WhatsAppMessageLocator` with these ordered strategies:

1. Exact `[data-id="<id>"]` lookup using `CSS.escape` where available.
2. Scan elements carrying `data-id` and compare the normalized ID exactly.
3. Inspect stable `aria-label`/`data-testid` message metadata only when it contains the exact ID.
4. Return `undefined` on ambiguity; never choose by text, position, timestamp, or obfuscated class name.

`applyAgentPresentation` sets `data-agent-remote-origin="agent"`, `data-agent-id`, and an accessible label such as `Claude`. It applies a namespaced CSS class defined by the companion stylesheet and leaves the actual WhatsApp text unchanged. `syncAgentPresentation` requires both exact message ID and conversation ID before applying it; repeated calls are idempotent.

- [ ] **Step 4: Implement the loopback bridge**

Use Node’s built-in `http.createServer`. Accept only `GET /registry`, require an `x-agent-remote-token` header equal to the configured token, require the `Origin` header to equal `https://web.whatsapp.com`, and bind only to `127.0.0.1`. Return a bounded JSON snapshot of registry metadata with `Cache-Control: no-store`; reject all other methods/routes with `404`/`405`. Do not expose arbitrary filesystem, command, provider, prompt, response, or auth operations. Shut the server down during gateway stop.

Add a source Manifest V3 file with only the `https://web.whatsapp.com/*` content-script match and no broad permissions. Compile companion TypeScript under `dist/presentation/whatsapp-companion`, and add a small Node build-copy step if needed so the load-unpacked directory contains `manifest.json` and compiled `src/content.js`. The content script polls the bridge with the configured port/token, uses `MutationObserver`, and calls `syncAgentPresentation` after each response and DOM mutation. Poll/bridge errors disable augmentation for that cycle and never affect WhatsApp.

- [ ] **Step 5: Wire startup/shutdown and document operator setup**

Add optional configuration `AGENT_REMOTE_PRESENTATION_ENABLED=false`, `AGENT_REMOTE_PRESENTATION_PORT=8765`, and a required `AGENT_REMOTE_PRESENTATION_TOKEN` when enabled. The application passes `channel.agentMessageRegistry` to the bridge. `doctor` reports the bridge as disabled, enabled/listening, or invalid configuration without printing the token. The companion README explains load-unpacked setup, token configuration, Web/Desktop-only behavior, Code Verify warnings, and the fact that mobile remains unchanged.

- [ ] **Step 6: Run companion/build/security tests and commit**

```bash
npm run build && node --test --experimental-strip-types test/whatsapp-companion.test.ts test/operational.test.ts test/boundaries.test.ts
git add apps/gateway/src/presentation-bridge.ts presentation/whatsapp-companion package.json tsconfig.json apps/gateway/src/application.ts test/whatsapp-companion.test.ts test/operational.test.ts test/boundaries.test.ts
git commit -m "feat: add opt-in WhatsApp presentation companion"
```

Expected: tests pass, the companion has no Baileys/provider imports, and the bridge binds only to loopback.

### Task 5: Update architecture, WhatsApp documentation, and GSD phase state

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/whatsapp.md`
- Modify: `.env.example`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Create: `.planning/phases/07-single-number-presentation-runtime/07-01-PLAN.md`
- Create: `.planning/phases/07-single-number-presentation-runtime/07-01-SUMMARY.md`
- Create: `.planning/phases/07-single-number-presentation-runtime/VERIFICATION.md`
- Modify: `README.md`

**Interfaces:**
- Documentation must state the transport sender identity versus logical participant identity.
- Documentation must state that protocol-native agent-left rendering is impossible under one account, while Web/Desktop augmentation is opt-in and best-effort.
- GSD artifacts must distinguish automated PASS from live WhatsApp UNVERIFIED or PASS and include actual test counts.

- [ ] **Step 1: Write failing documentation checks**

Add a small assertion to `test/operational.test.ts` or a new `test/documentation.test.ts` that reads the four public docs and asserts they contain the exact phrases `one WhatsApp account`, `fromMe`, `MessageOrigin`, `reply`, `presentation companion`, and `mobile`.

- [ ] **Step 2: Run the documentation check before updates**

```bash
npm run build && node --test --experimental-strip-types test/documentation.test.ts
```

Expected: failure for at least the new origin/companion terminology.

- [ ] **Step 3: Update the documentation and GSD artifacts**

Document the final data flow, provider/runtime boundaries, registry limits, presence/final-only policy, bridge security, setup commands, official-client limitations, and fallback behavior. Add Phase 7 to `ROADMAP.md` with requirements and verification criteria. Set `STATE.md` to the active Phase 7 implementation until verification completes, then record the final test count, build status, Graphify refresh result, live acceptance result, and unresolved official-client limitation. Copy the executed plan into `07-01-PLAN.md`, write `07-01-SUMMARY.md` only after implementation, and write `VERIFICATION.md` from command output rather than estimates.

- [ ] **Step 4: Run documentation and full deterministic tests**

```bash
npm run build && node --test --experimental-strip-types test/documentation.test.ts
npm test
```

Expected: documentation check and full suite pass with zero failures.

- [ ] **Step 5: Commit documentation and phase state**

```bash
git add docs README.md .env.example .planning/ROADMAP.md .planning/STATE.md .planning/phases/07-single-number-presentation-runtime
git commit -m "docs: record single-number presentation phase"
```

### Task 6: Run measured verification and the real WhatsApp acceptance procedure

**Files:**
- Modify: `.planning/phases/07-single-number-presentation-runtime/VERIFICATION.md`
- Modify: `.planning/STATE.md`
- Modify: `docs/whatsapp.md`
- Create: `.planning/phases/07-single-number-presentation-runtime/07-01-SUMMARY.md`

**Interfaces:**
- Verification consumes the built gateway, configured auth session, provider registry diagnostics, registry snapshot, telemetry snapshot, and test output.
- It produces a truthful acceptance matrix and measured cold/warm latency table.

This task is the Live WhatsApp acceptance gate; automated fakes cannot mark it complete.

- [ ] **Step 1: Run the complete automated verification**

```bash
npm run build
npm test
npm run doctor
graphify update .
git status --short
```

Record the exact exit codes, test/pass/fail/skip counts, doctor provider availability, and Graphify node/edge counts. Do not replace unavailable-provider or live-session results with mocks.

- [ ] **Step 2: Measure cold and warm provider/runtime spans**

Run the existing benchmark test and, where the configured CLI is available, run one cold Claude turn, one warm Claude turn, one cold Codex turn, and one warm Codex turn. Record `routingLatencyMs`, `queueLatencyMs`, `providerStartupLatencyMs`, `timeToFirstOutputMs`, `timeToFirstReplyMs`, `executionDurationMs`, `deliveryLatencyMs`, and `totalLatencyMs`. If a provider cannot run, record `UNVERIFIED` with the doctor reason.

- [ ] **Step 3: Run live acceptance without creating a second gateway**

Use the existing configured gateway process that owns the auth lock. From the authorized official WhatsApp client, send:

```text
/claude
Hola
¿Recuerdas lo que te acabo de decir?
/codex
Hola
/running
/cancel
```

Verify one receipt per inbound message, selected provider, composing then paused presence, no standalone processing acknowledgement, exact quoted trigger for each response, Claude session reuse, provider switching, `/running` visibility, and real process cancellation. Test one additional chat and one group fixture to confirm isolation. Do not interrupt or replace an already-running gateway without operator direction.

- [ ] **Step 4: Verify presentation per client layer**

Record:

```text
SINGLE ACCOUNT: PASS
Protocol-native agent-left rendering: IMPOSSIBLE WITH EVIDENCE
Web/Desktop enhanced agent-left rendering: PASS or NOT IMPLEMENTED
Mobile official client agent-left rendering: NOT CONTROLLABLE WITH EVIDENCE
```

If the companion cannot locate a message safely, record `NOT IMPLEMENTED` for that client version and prove the real WhatsApp message remains unchanged.

- [ ] **Step 5: Write summary and final verification artifacts**

Populate `07-01-SUMMARY.md` with changed files, root cause, selected architecture, test evidence, latency evidence, live acceptance evidence, and external limitations. Populate `VERIFICATION.md` with command output-derived results and mark the phase complete only when automated checks pass and live status is explicitly recorded.

- [ ] **Step 6: Commit final evidence**

```bash
git add .planning/STATE.md .planning/phases/07-single-number-presentation-runtime/07-01-SUMMARY.md .planning/phases/07-single-number-presentation-runtime/VERIFICATION.md docs/whatsapp.md
git commit -m "verify: record single-number presentation runtime"
```

## Self-review checklist

- [ ] Every spec goal maps to Tasks 1–6.
- [ ] One-number, no-spoofing, boundary, security, bounded-memory, final-only delivery, mobile, and live-verification constraints are explicit.
- [ ] All new interfaces are named with file locations and consumed/produced relationships.
- [ ] Every production behavior begins with a failing test and a focused command.
- [ ] No step relies on response-text matching, fake participants, network interception, or an unbounded registry.
- [ ] Live acceptance is separated from mocked tests and does not start a competing gateway.
