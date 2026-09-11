# Phase 7 verification

## Deterministic checks — PASS

| Command | Result |
| --- | --- |
| `npm run build` | Exit 0. |
| `node --test --experimental-strip-types test/documentation.test.ts` | Exit 0; 1 test passed, 0 failed. |
| `npm test` | Exit 0; 169 tests total, 167 passed, 0 failed, 2 skipped. |
| `npm run doctor` with the existing project environment | Exit 1 because the optional Copilot CLI is unavailable; configuration, Claude CLI, Codex CLI, Graphify, and presentation-disabled checks passed. |
| `graphify update .` | Exit 0; 1106 nodes, 1765 edges, 99 communities. |

The fresh benchmark printed by `npm test` was:

```text
realtime benchmark cold: {"routingLatencyMs":0,"queueLatencyMs":0,"providerStartupLatencyMs":5,"timeToFirstOutputMs":5,"executionDurationMs":5,"deliveryLatencyMs":0,"totalLatencyMs":5}
realtime benchmark warm: {"routingLatencyMs":0,"queueLatencyMs":0,"providerStartupLatencyMs":0,"timeToFirstOutputMs":0,"executionDurationMs":1,"deliveryLatencyMs":0,"totalLatencyMs":1}
```

These deterministic values are the after-run evidence. The earlier Task 3 report recorded only that cold/warm spans were measured, not their numeric values; no valid numeric baseline can be reconstructed. Phase 7 therefore makes no before/after improvement claim and does not represent these values as real provider or WhatsApp transport latency.

## Static/runtime boundaries — PASS

- One-account transport sender remains `fromMe`; logical `MessageOrigin` remains transport-neutral.
- Successful sends are correlated by exact WhatsApp IDs in a bounded registry; replies use native context when retained and otherwise safely fall back.
- Default delivery is composing + final reply + paused; delayed progress requires a positive threshold, and cancellation/failure suppresses delivery.
- The optional bridge is loopback-only, origin- and token-gated, `GET /registry` only, no-store, and exposes a bounded sanitized snapshot.

## Graphify — PASS

The final `graphify update .` completed with 1106 nodes, 1765 edges, and 99 communities. Generated graph files remain expected workspace changes.

## Live WhatsApp/client acceptance — UNVERIFIED

Automated tests cannot replace the required paired-client check. No configured gateway/auth session was used in this worktree, so the following remain unverified:

- `/claude`, plain prompt/session reuse, provider switching with `/codex`, `/running`, and real `/cancel`.
- One receipt per inbound message, composing then paused presence, no standalone acknowledgement, and exact quoted reply targets.
- Web/Desktop companion augmentation against the current official DOM and safe fallback when a node is not found.

Manual acceptance must use the existing gateway process that owns the auth lock; do not start or replace a running gateway. Send `/claude`, a prompt, a follow-up, `/codex`, `/running`, and `/cancel`, then verify the listed behavior and one additional chat/group isolation fixture.

## Official-client limitation — NOT CONTROLLABLE

With one WhatsApp account, normal gateway sends stay `fromMe`. Neither linked devices nor LID/phone metadata create a second protocol participant; protocol-native agent-left rendering is therefore impossible. The opt-in Web/Desktop presentation companion is only a best-effort local DOM augmentation. Official mobile WhatsApp remains unchanged and cannot render Agent Remote as an incoming/left-side agent.

## Client-layer matrix

- `SINGLE ACCOUNT`: PASS — one configured WhatsApp transport is preserved.
- `Protocol-native agent-left rendering`: IMPOSSIBLE WITH EVIDENCE — one account cannot create a second sender participant.
- `Web/Desktop enhanced agent-left rendering`: UNVERIFIED — companion boundary is implemented and tested, but not loaded against a paired official client.
- `Mobile official client agent-left rendering`: NOT CONTROLLABLE WITH EVIDENCE — the mobile client receives the same `fromMe` transport and is outside the companion boundary.
