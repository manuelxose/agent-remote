# Phase 7 — Single-Number Presentation Runtime summary

## Outcome

Phase 7 preserves one WhatsApp account while adding logical agent identity and local presentation metadata. WhatsApp transport output remains `fromMe`; `MessageOrigin` identifies the logical agent and execution without creating or spoofing a second participant. The channel correlates successful sends by exact message ID in a bounded TTL/capacity registry, keeps the incoming quoted-reply target when available, and never relies on response text.

Ordinary WhatsApp delivery is composing presence plus one final correlated reply. Delayed progress is opt-in by threshold and bounded by the delivery cap. Failure and cancellation pause presence and suppress partial/final streaming delivery; provider cancellation reaches the process abort signal.

The optional presentation companion receives only a bounded sanitized registry snapshot through an authenticated loopback endpoint. It can decorate matching Web/Desktop DOM nodes but cannot alter WhatsApp transport, encryption, sender identity, files, providers, or mobile clients.

## Selected architecture

- Core owns transport-neutral `MessageOrigin`/participant and reply contracts.
- `channels/whatsapp` owns Baileys translation, native quoted context, and the bounded `AgentMessageRegistry`.
- The gateway owns policy, presence, final-only `StreamDelivery`, startup/shutdown, and the loopback bridge.
- The Manifest V3 companion is an opt-in, best-effort Web/Desktop presentation layer. It uses exact registered IDs only; failed bridge or DOM work leaves WhatsApp unchanged.

## Evidence

- `npm run build` passed.
- `node --test --experimental-strip-types test/documentation.test.ts` passed: 1 test, 0 failures.
- `npm test` passed: 169 tests, 167 passed, 0 failed, 2 skipped.
- Fresh deterministic benchmark: cold total latency 5 ms; warm total latency 1 ms. Task 3 previously confirmed measured cold/warm spans but did not preserve numeric baseline output, so Phase 7 reports no synthetic before/after improvement claim and no live-provider/transport measurement.
- The existing Graphify snapshot contains 1081 nodes. Task 5 changed documentation/GSD artifacts only, so it intentionally did not rerun `graphify update .`.

## Client acceptance and limitations

| Layer | Status | Evidence / limitation |
| --- | --- | --- |
| Automated contracts | PASS | Deterministic build and test suite passed. |
| WhatsApp live gateway | UNVERIFIED | This worktree did not exercise a configured paired session, `/claude`, `/codex`, `/running`, `/cancel`, presence, or exact quoted replies. |
| Web/Desktop companion | UNVERIFIED | The extension was not loaded against a paired official client in this worktree. It remains opt-in and best-effort. |
| Official mobile | NOT CONTROLLABLE | One-account `fromMe` transport cannot render a protocol-native second/left-side agent participant. |

For manual acceptance, use the existing gateway that owns the WhatsApp auth lock; do not start a competing gateway. Verify one receipt per input, provider selection/reuse, composing then paused presence, exact quoted replies, `/running`, cancellation, and client-layer fallback behavior.
