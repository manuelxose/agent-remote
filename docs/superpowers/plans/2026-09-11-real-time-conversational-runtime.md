# Real-Time Conversational Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agent Remote conversational path stream provider output, preserve logical/provider/external session identity, and send bounded native-correlated WhatsApp replies with observable lifecycle and latency behavior.

**Architecture:** Keep the existing Phase 5 control plane and trusted runtime, adding neutral message references/outbound envelopes, a provider-neutral streaming observer, cached provider registry, and a logical persistent session supervisor. Claude and Codex remain resumable one-shot CLI strategies; WhatsApp alone translates `replyTo` into Baileys quoted context.

**Tech Stack:** TypeScript, Node.js child-process streams, `node:test`, existing in-memory/JSON repositories and event bus, Baileys adapter, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-real-time-conversational-runtime-design.md`

## Global Constraints

- Do not import Baileys outside `channels/whatsapp`.
- Do not pass user text through a shell command; continue using executable plus argv arrays.
- Keep provider-specific JSON parsing inside `developer-agents/*`.
- Keep `externalConversationId`, `logicalSessionId`, and `providerSessionId` distinct.
- Keep output, queue, reply-context, and session registries bounded.
- Preserve Phase 5 allowlists, roles, workspace validation, persistence, and chatbot isolation.
- Never log prompt contents, credentials, QR values, or raw provider stderr.
- Do not claim live WhatsApp/Claude/Copilot verification when credentials or executables are absent.
- Every non-trivial behavior change gets a focused `node:test` regression test and a runnable verification command.

---

### Task 1: Add neutral correlation, execution-event, and streaming process contracts

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `runtime/developer-agent/src/contracts.ts`
- Modify: `runtime/developer-agent/src/process.ts`
- Modify: `packages/events/src/index.ts`
- Create: `test/realtime-contracts.test.ts`
- Modify: `test/developer-agent-process.test.ts`

**Interfaces:**
- Consumes: existing `Message`, `AgentResponse`, `DeveloperProcessRunner`, and `DomainEvent` contracts.
- Produces: `MessageReference`, `OutboundMessage`, provider-neutral `AgentExecutionEvent`, `AgentExecutionObserver`, `AgentExecutionRequest`, `AgentExecutionResult`, and a process-runner stdout observer compatible with existing fake runners.

- [ ] **Step 1: Write failing contract and streaming-runner tests**

Add tests that assert:

```ts
const reference = { channel: "whatsapp", conversationId: "chat@g.us", messageId: "m1", senderId: "u1" };
assert.deepEqual({ text: "ok", replyTo: reference }, { text: "ok", replyTo: reference });

const chunks: string[] = [];
await runner.run({ executable: process.execPath, argv: ["-e", "process.stdout.write('a'); setTimeout(() => process.stdout.write('b'), 10)"], workingDirectory: root }, {
  onStdout: chunk => chunks.push(chunk.toString())
});
assert.equal(chunks.join(""), "ab");
```

Also assert execution event names are limited to the normalized set and latency records calculate only available timestamp differences.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run build && node --test --experimental-strip-types test/realtime-contracts.test.ts test/developer-agent-process.test.ts`

Expected: FAIL because the neutral reply/event types and streaming callback do not exist.

- [ ] **Step 3: Add the smallest neutral contracts**

In core, add:

```ts
export interface MessageReference { channel: string; conversationId: string; messageId: string; senderId?: string; }
export interface OutboundMessage { text: string; replyTo?: MessageReference; metadata?: Metadata; }
```

Add `replyReference?: MessageReference` to `Message`, make `AgentResponse` structurally compatible with `OutboundMessage`, and extend `Channel.send` to accept the neutral envelope without any transport type.

In developer-agent contracts, add a discriminated `AgentExecutionEvent` with `type`, `occurredAt`, `executionId`, `correlationId`, and safe payload fields for accepted/started/provider-started/delta/message/tool/progress/completed/failed/cancelled. Add `AgentExecutionObserver.onEvent`, `AgentExecutionRequest` identity fields, and `AgentExecutionResult` with status, text, provider session ID, and safe failure metadata.

Make the new process observer parameter optional:

```ts
export interface DeveloperProcessObserver {
  onStdout?(chunk: Buffer): void | Promise<void>;
  onStderr?(chunk: Buffer): void | Promise<void>;
}
export interface DeveloperProcessRunner {
  run(spec: DeveloperProcessSpec, observer?: DeveloperProcessObserver): Promise<DeveloperProcessResult>;
}
```

Keep existing callers valid.

- [ ] **Step 4: Implement incremental callbacks in the Node runner**

Call `observer.onStdout` and `observer.onStderr` from the existing child stream data handlers, awaiting callbacks through a serialized promise chain so chunk order is stable without unbounded buffering. Keep the existing byte caps, termination behavior, direct spawn, process-group termination, and final result. Observer failures must terminate the run as `execution-failed` rather than escape as unhandled promises.

- [ ] **Step 5: Add internal latency calculation and event-bus names**

Extend `packages/events/src/index.ts` with the normalized runtime event names and preserve old Phase 5 names. Add a small pure `LatencySnapshot`/`calculateLatencies` helper in the runtime contracts or a focused runtime file; it must return `undefined` for a derived value whose endpoints are missing and never fabricate timestamps.

- [ ] **Step 6: Run focused tests and build**

Run: `npm run build && node --test --experimental-strip-types test/realtime-contracts.test.ts test/developer-agent-process.test.ts`

Expected: PASS with the existing process tests unchanged.

- [ ] **Step 7: Commit the contract boundary**

Run:

```bash
git add packages/core/src/index.ts runtime/developer-agent/src/contracts.ts runtime/developer-agent/src/process.ts packages/events/src/index.ts test/realtime-contracts.test.ts test/developer-agent-process.test.ts
git commit -m "feat: add neutral realtime execution contracts"
```

### Task 2: Implement provider registry, logical sessions, and incremental provider adapters

**Files:**
- Modify: `runtime/developer-agent/src/contracts.ts`
- Create: `runtime/developer-agent/src/registry.ts`
- Create: `runtime/developer-agent/src/execution-session.ts`
- Modify: `runtime/developer-agent/src/index.ts`
- Modify: `runtime/developer-agent/src/sessions.ts`
- Modify: `developer-agents/claude/src/index.ts`
- Modify: `developer-agents/codex/src/index.ts`
- Modify: `developer-agents/copilot/src/index.ts`
- Create: `test/developer-agent-streaming.test.ts`
- Modify: `test/adapters.test.ts`
- Modify: `test/developer-agent-runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 execution contracts and existing adapter argv/session behavior.
- Produces: cached `ProviderRegistry`, `AgentExecutionSession`, `AgentSessionSupervisor`, adapter streaming translation, explicit provider session health, and runtime `closeAll`/health/cancel methods.

- [ ] **Step 1: Write failing registry/session/streaming tests**

Test these observable behaviors with fake resolvers/runners:

```ts
const registry = new ProviderRegistry({ codex: adapter, claude: otherAdapter });
await registry.load();
assert.equal(resolveCalls, 2);
await registry.get("codex");
await registry.get("codex");
assert.equal(resolveCalls, 2);

const session = await supervisor.getOrCreate("logical-1", "codex", root);
assert.equal(await supervisor.getOrCreate("logical-1", "codex", root), session);
const events: AgentExecutionEvent[] = [];
const resultPromise = session.execute(request, { onEvent: event => events.push(event) });
runner.emitStdout('{"type":"item.delta","text":"first"}\n');
assert.equal(events.some(event => event.type === "assistant.delta"), true);
assert.equal(completed, false);
```

Add adapter tests proving Claude/Codex emit normalized deltas before the runner promise completes, preserve `--resume`/native IDs, and turn malformed stream lines into a bounded invalid-output failure. Keep Copilot completion-only if its output has no safe incremental protocol.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run build && node --test --experimental-strip-types test/developer-agent-streaming.test.ts test/adapters.test.ts test/developer-agent-runtime.test.ts`

Expected: FAIL because registry/session/observer APIs are absent and adapters still parse only final output.

- [ ] **Step 3: Add the provider registry with startup discovery caching**

Create a registry that accepts adapters, stores `DeveloperAgentAvailability` after one `getAvailability()` call per provider, exposes `get(provider)`, `health()`, and `refresh(provider?)`, and returns safe unavailable records. `DeveloperAgentRuntime` loads it lazily once before first execution and exposes `refreshProviderHealth` for explicit refresh; it must not call the resolver on every message.

- [ ] **Step 4: Add a resumable logical execution session and supervisor**

Implement one session per tuple `(logicalSessionId, provider, canonicalWorkspace)`. The session delegates to the provider adapter, holds the currently active execution controller, forwards observer events, tracks provider session ID through the existing `DeveloperSessionStore`, and maps cancellation to the active execution's `AbortController`. `close()` cancels active work and marks the session closed. The supervisor uses a bounded map, returns the same session for repeated keys, closes/removes individual sessions, and closes all sessions idempotently.

Do not keep a child process alive; the session remains persistent while provider-native resume carries conversational continuity.

- [ ] **Step 5: Stream Claude output inside its adapter**

Use the Claude stream-oriented JSON output option supported by the installed/current CLI contract, while retaining the existing JSON result compatibility fallback if a fake/provider reports non-stream output. Parse newline-delimited structured records as callbacks arrive, emit `assistant.delta`/`assistant.message` for text-bearing records, capture the final result/session ID, and return bounded `invalid-output` for malformed records. Keep argv arrays and `--resume`.

- [ ] **Step 6: Stream Codex JSONL inside its adapter**

Parse each JSONL record from the observer as it arrives. Capture `thread.started` immediately, emit deltas from agent-message/item update records, emit an assistant message for completed agent-message items, and retain the final text/session ID. Do not split/parse the whole stdout after close except as a compatibility fallback for runners that do not provide observers. Preserve `exec --json`, resume, model, sandbox, and prompt argv boundaries.

- [ ] **Step 7: Preserve Copilot behind the same session contract**

Keep its UUID/session-ID argv and safe completion parsing. Emit provider-started and assistant-message/completed events around its final output; use no speculative Copilot streaming protocol.

- [ ] **Step 8: Integrate runtime queues with sessions and lifecycle**

Replace the runtime's adapter-per-turn lookup with registry/session lookup while preserving canonical workspace queue keys and Phase 5 response/error semantics. Add `cancel(correlationId or executionId)`, `health()`, and `close()` methods. Ensure every execution publishes one terminal normalized event and that session persistence errors cannot publish duplicate terminal events.

- [ ] **Step 9: Run focused and full runtime tests**

Run: `npm run build && node --test --experimental-strip-types test/developer-agent-streaming.test.ts test/adapters.test.ts test/developer-agent-runtime.test.ts test/developer-agent-sessions.test.ts`

Expected: PASS, including existing session isolation/restart/cancellation tests.

- [ ] **Step 10: Commit provider/session work**

Run:

```bash
git add runtime/developer-agent/src developer-agents/claude/src/index.ts developer-agents/codex/src/index.ts developer-agents/copilot/src/index.ts test/developer-agent-streaming.test.ts test/adapters.test.ts test/developer-agent-runtime.test.ts
git commit -m "feat: add resumable streaming provider sessions"
```

### Task 3: Carry correlation through the control plane and add delivery/metrics policy

**Files:**
- Modify: `packages/control-plane/src/index.ts`
- Modify: `packages/control-plane/src/persistence.ts`
- Create: `packages/control-plane/src/telemetry.ts`
- Create: `packages/control-plane/src/delivery.ts`
- Modify: `test/control-plane.test.ts`
- Create: `test/realtime-control-plane.test.ts`

**Interfaces:**
- Consumes: core outbound envelopes, runtime observer/session lifecycle, Phase 5 repositories and queue.
- Produces: correlated `CommandResult`, an execution telemetry record, bounded streaming delivery callback, diagnostics snapshot, and safe shutdown hooks.

- [ ] **Step 1: Write failing control-plane integration tests**

Create a fake runtime that calls `observer.onEvent({ type: "assistant.delta", ... })`, waits on a release promise, then completes. Assert:

```ts
const accepted = control.handle(incoming, owner);
await waitForOutbound();
assert.equal(outbound[0].replyTo?.messageId, incoming.id);
assert.equal(completed, false);
release();
await accepted;
assert.equal(outbound.at(-1)?.replyTo?.messageId, incoming.id);
```

Also test same-session serialization, separate-session parallelism, queue overflow claim release, cancellation of active plus queued work, and timestamp/latency fields. Assert no prompt/provider stderr appears in event payloads.

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm run build && node --test --experimental-strip-types test/realtime-control-plane.test.ts test/control-plane.test.ts`

Expected: FAIL because command results have no reply envelope and runtime execution has no observer/delivery path.

- [ ] **Step 3: Make command and execution responses correlated**

Add `replyTo?: MessageReference` to `CommandResult` and derive it from the inbound message at the dispatcher boundary. Ensure immediate acknowledgements, queue-position responses, command errors, retry responses, and final responses all reference the triggering message. Preserve `metadata` as safe strings and avoid storing raw prompt text by default.

- [ ] **Step 4: Add execution telemetry**

Create a pure `ExecutionTelemetry` object containing the required timestamp fields and identity fields. Record message receipt at `handle`, queue entry/admission, accepted acknowledgement, execution start, provider start, first provider output, first transport reply, completion, and final reply. Use `calculateLatencies()` from Task 1; publish safe structured events with `executionId`, `correlationId`, logical/external IDs, provider/agent/workspace/model, queue position, and bounded reason.

- [ ] **Step 5: Add deterministic streaming delivery aggregation**

Implement:

```ts
export interface StreamingDeliveryPolicy { minChars: number; maxIntervalMs: number; maxMessagesPerExecution: number; }
export interface StreamDelivery { push(delta: string): Promise<void>; complete(finalText: string): Promise<void>; fail(): Promise<void>; }
```

Buffer deltas, flush on threshold or interval, never exceed the message cap, preserve the original `replyTo`, and send only a final message for short/no-delta executions. Delivery failures become safe telemetry and do not reject provider execution. Use configurable defaults from application config.

- [ ] **Step 6: Wire runtime observer and cancellation through the queue**

Pass an observer from `ControlPlane.executePrompt` to the runtime/session. Use one terminal finalizer for immediate and queued tasks. The queue must reject new work while cancelling, reject/drain pending tasks before aborting active work, never start a pending task during cancellation, and expose active execution/queue health. `/cancel` must call the runtime/session cancellation path and wait for termination.

- [ ] **Step 7: Add safe diagnostics**

Extend `/status` and `/running` to report active logical chat count, running/queued counts, provider availability/capabilities/session count, current provider/workspace/model, elapsed time, and first-output timing. Do not include prompt text, auth data, or raw provider diagnostics.

- [ ] **Step 8: Run focused control-plane tests and build**

Run: `npm run build && node --test --experimental-strip-types test/realtime-control-plane.test.ts test/control-plane.test.ts test/control-plane-persistence.test.ts`

Expected: PASS with existing Phase 5 state/persistence behavior intact.

- [ ] **Step 9: Commit control-plane work**

Run:

```bash
git add packages/control-plane/src packages/control-plane/src/telemetry.ts packages/control-plane/src/delivery.ts test/control-plane.test.ts test/realtime-control-plane.test.ts
git commit -m "feat: correlate and observe control-plane executions"
```

### Task 4: Implement native WhatsApp reply correlation, presence, and gateway wiring

**Files:**
- Modify: `channels/whatsapp/src/translate.ts`
- Modify: `channels/whatsapp/src/lifecycle.ts`
- Modify: `channels/whatsapp/src/config.ts`
- Modify: `apps/gateway/src/application.ts`
- Modify: `apps/gateway/src/whatsapp.ts`
- Modify: `test/whatsapp-channel.test.ts`
- Modify: `test/whatsapp-translation.test.ts`
- Modify: `test/whatsapp-gateway.test.ts`
- Create: `test/realtime-whatsapp.test.ts`

**Interfaces:**
- Consumes: Task 3 `OutboundMessage`, inbound `MessageReference`, streaming delivery, and telemetry callbacks.
- Produces: Baileys-only bounded reply-context cache, native quoted send, presence updates, and correlated end-to-end channel delivery.

- [ ] **Step 1: Write failing WhatsApp correlation tests**

Cover recent reply, expiry, unknown ID fallback, chunks, groups/participant identity, self-sent input, reconnect cache behavior, and presence. Assert Baileys receives:

```ts
await socket.sendMessage("chat@g.us", { text: "answer" }, { quoted: originalMinimalMessage });
```

and receives no quoted option after TTL eviction. Assert every chunk of one response carries the same reply reference when context exists.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run build && node --test --experimental-strip-types test/realtime-whatsapp.test.ts test/whatsapp-channel.test.ts test/whatsapp-gateway.test.ts`

Expected: FAIL because `Channel.send` ignores reply references and does not support native presence/quoted options.

- [ ] **Step 3: Capture minimal inbound reply context**

When translating/receiving a raw WhatsApp message, create `replyReference` from channel, remote JID, message ID, and sender. Store only the minimal Baileys key/message context required by `quoted`, with configurable capacity/TTL. Prune on insert/access, cap entries, and clear or safely retain only valid entries across reconnect according to tests. Never store message text unnecessarily.

- [ ] **Step 4: Render outbound envelopes natively**

Change `WhatsAppChannel.send` to accept `OutboundMessage`. For each chunk, look up `replyTo.messageId` in the bounded cache and call Baileys `sendMessage(conversationId, { text: chunk }, quoted ? { quoted } : undefined)`. If the reference channel/conversation does not match or the context is missing, send normally. Track returned outbound IDs for echo suppression exactly as before.

- [ ] **Step 5: Add presence support**

Extend the narrow socket seam with optional `sendPresenceUpdate` and add `setPresence(conversationId, "composing" | "paused" | "available")`. Treat unsupported presence or disconnected sockets as a safe no-op/diagnostic; never make provider execution fail because presence failed.

- [ ] **Step 6: Wire application acknowledgement/progress/final paths**

Pass `replyTo` from the incoming `Message` into control-plane command results and runtime delivery. On accepted work, set composing immediately; send the acknowledgement only when policy says it is useful, with the original reference. Stream aggregated deltas/final output through `channel.send` and return presence to paused/available in `finally`. Ensure queued responses use the original queued message reference, not the `/running` or later command reference.

- [ ] **Step 7: Run WhatsApp and integration tests**

Run: `npm run build && node --test --experimental-strip-types test/realtime-whatsapp.test.ts test/whatsapp-channel.test.ts test/whatsapp-translation.test.ts test/whatsapp-gateway.test.ts`

Expected: PASS, including all existing authorization, reconnect, self-message, chunking, and boundary tests.

- [ ] **Step 8: Commit WhatsApp integration**

Run:

```bash
git add channels/whatsapp/src apps/gateway/src/application.ts apps/gateway/src/whatsapp.ts test/whatsapp-channel.test.ts test/whatsapp-translation.test.ts test/whatsapp-gateway.test.ts test/realtime-whatsapp.test.ts
git commit -m "feat: deliver correlated streaming WhatsApp replies"
```

### Task 5: Complete shutdown, diagnostics, documentation, benchmarks, and phase verification

**Files:**
- Modify: `apps/gateway/src/application.ts`
- Modify: `apps/gateway/src/doctor.ts`
- Modify: `.env.example`
- Modify: `docs/architecture.md`
- Modify: `docs/whatsapp.md`
- Modify: `README.md`
- Create: `test/realtime-shutdown.test.ts`
- Create: `test/realtime-benchmark.test.ts`
- Create: `.planning/phases/06-real-time-conversational-runtime/06-01-PLAN.md`
- Create: `.planning/phases/06-real-time-conversational-runtime/VERIFICATION.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`

**Interfaces:**
- Consumes: completed runtime/control-plane/channel lifecycle APIs and truthful provider discovery.
- Produces: idempotent application shutdown, config-backed delivery limits, benchmark evidence, updated docs/GSD artifacts, Graphify refresh evidence, and explicit live-verification status.

- [ ] **Step 1: Write failing shutdown/config/benchmark tests**

Test that application stop calls `stopAccepting`, drains within the configured timeout, cancels remaining active work, closes all provider sessions, persists state, and stops WhatsApp. Test repeated `stop()` is harmless. Test delivery and reply-cache settings reject invalid values and benchmark output reports actual routing/first-output/final timings without claiming a threshold it did not measure.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm run build && node --test --experimental-strip-types test/realtime-shutdown.test.ts test/realtime-benchmark.test.ts`

Expected: FAIL until application wiring, configuration, and benchmark hooks are complete.

- [ ] **Step 3: Wire lifecycle and configuration**

Add positive-integer settings for reply-context TTL/capacity, stream minimum characters, stream flush interval, maximum streamed messages, and drain timeout. Construct one provider registry/supervisor per application. Implement shutdown ordering from the spec and retain the existing lock/channel behavior. Make provider/session close errors bounded and non-fatal after logging.

- [ ] **Step 4: Update doctor and diagnostics**

Report cached provider availability/capabilities, managed state/session paths, stream policy, queue limits, and whether live WhatsApp auth exists. Keep PASS/WARN/FAIL truthful: unavailable Claude/Copilot and absent WhatsApp auth are warnings/unverified, never synthetic success.

- [ ] **Step 5: Add benchmark/smoke evidence**

Use deterministic fake provider and channel clocks/hooks to print measured routing latency, provider startup, first provider output, first transport reply, final output, and cold versus warm execution. Keep this as a runnable Node test/script with no fake hard-coded timings in the report.

- [ ] **Step 6: Update documentation and GSD artifacts**

Document the three identity types, reply correlation fallback, session strategy per provider, stream policy, cancellation/shutdown semantics, diagnostics, config keys, and the explicit distinction between `VERIFIED AUTOMATICALLY`, `VERIFIED LOCALLY`, and `NOT LIVE-VERIFIED`. Add the Phase 6 plan/checklist and verification record; update Roadmap/State only with observed results.

- [ ] **Step 7: Run complete verification**

Run sequentially:

```bash
npm run build
npm test
npm run doctor
git diff --check
graphify update .
```

Then run the focused integration/benchmark tests and inspect boundary imports. Run Codex smoke if available. Attempt live WhatsApp only if configured auth exists; record `NOT LIVE-VERIFIED` otherwise. Fix implementation-caused failures before marking the phase complete.

- [ ] **Step 8: Commit final implementation and artifacts**

Run:

```bash
git add apps/gateway/src .env.example docs/architecture.md docs/whatsapp.md README.md test/realtime-shutdown.test.ts test/realtime-benchmark.test.ts .planning/phases/06-real-time-conversational-runtime .planning/ROADMAP.md .planning/STATE.md graphify-out
git commit -m "feat: complete real-time conversational runtime"
```

Record the final commit SHA and exact verification counts in the Phase 6 `VERIFICATION.md` and final handoff.

