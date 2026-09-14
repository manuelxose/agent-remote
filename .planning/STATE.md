# State

## Current Position

Phase 7 — Single-Number Presentation Runtime (Tasks 1–5 complete; Task 6 final verification pending)

## Status

The Phase 5 control plane is implemented: central command registry, explicit state, owner-scoped managed chats, atomic versioned JSON state, bounded per-chat queues, cancellation, idempotency, explicit model policy, application composition, docs, and tests. Deterministic verification is complete; unavailable Claude/Copilot CLIs and live WhatsApp credentials are recorded as UNVERIFIED in the phase verification artifact.

Phase 6 design is approved and recorded in `docs/superpowers/specs/2026-09-11-real-time-conversational-runtime-design.md`; implementation follows the executable plan in `docs/superpowers/plans/2026-09-11-real-time-conversational-runtime.md`. The phase is complete locally with streaming contracts, managed sessions, correlated bounded WhatsApp delivery, telemetry, diagnostics, documentation, tests, and a refreshed Graphify graph. Codex smoke passed; Claude/Copilot Phase 6 provider execution and live WhatsApp streaming remain explicitly unverified.

Phase 7 design is approved and recorded in `docs/superpowers/specs/2026-09-11-single-number-presentation-runtime-design.md`; implementation followed `docs/superpowers/plans/2026-09-11-single-number-presentation-runtime.md`. Tasks 1–5 implemented structured logical origins, bounded exact-ID WhatsApp correlation, final-only delivery, and the opt-in local Web/Desktop presentation companion. Task 6 final verification remains pending. Live WhatsApp and Web/Desktop acceptance are explicitly UNVERIFIED in this worktree; official mobile agent-left rendering remains not controllable under one account.

## Decisions

- New project at `/home/manuelxose/workspace/agent-remote`.
- Minimal npm TypeScript workspace monorepo.
- Two runtime trust zones: developer-agent and chatbot.
- Local in-memory event bus behind an interface.

## Verification

- `npm run build`: passes.
- `npm test`: 85 tests, 83 passed, 0 failed, 2 skipped; Claude and Copilot skipped as unavailable, and installed Codex smoke completed successfully with the bounded 60-second limit.
- `graphify update .`: completed successfully; graph refreshed to 474 nodes and 677 edges.
- Static tests confirm core and WhatsApp dependency boundaries.
- Runtime tests confirm chatbot allowlisting, developer workspace restrictions, collision-free tuple keys, and canonical equivalent-path queue serialization.
- Baileys channel tests cover translation, attachment metadata, allowlists, QR handling, auth persistence, reconnect, logout, shutdown, health, and gateway response delivery.
- Full verification confirms session isolation/restart persistence, approved workspace rejection before spawn, typed argv boundaries, observable process failure states, gateway response delivery, and chatbot/WhatsApp/core boundaries.
- Phase 4 automated verification: `npm test` reports 99 tests, 97 passed, 0 failed, 2 skipped; Codex and Claude Code are available, Copilot is unavailable on this machine.
- Real WhatsApp verification: `whatsapp_connected` observed after pairing and again after restart without a new QR. Baileys LID messages now use `participantAlt` for phone-based allowlist matching.
- Claude verification: Windows Claude Code `2.1.68` at `/mnt/c/Users/Admin/.local/bin/claude.exe` completed the real JSON adapter smoke; the WindowsApps desktop executable is intentionally not used as a CLI.
- One-number verification: `WHATSAPP_ALLOW_SELF_MESSAGES=true` accepts manual `fromMe` prompts while suppressing tracked gateway response IDs; focused and full channel tests pass.
- Chat resolution/import feature: exact normalized chat names and IDs resolve first; partial-only matches require confirmation; WhatsApp `.txt` exports can be attached to `/importar [name]` and are atomically indexed without AI routing. Final verification on 2026-09-14: `npm test` reports 211 tests, 209 passed, 0 failed, 2 skipped; the running local gateway reports `whatsapp_connected`.
- History pagination correction: Baileys on-demand history requests are capped at 50 messages per page; `/import <name> más` and `/import <name> completo` now use that limit, continue after short non-empty pages, and never claim that the archive is exhausted from page size alone. Final verification on 2026-09-14: `npm test` reports 223 tests, 221 passed, 0 failed, 2 skipped.
- Automatic initialization: `/init` returns the one-number command menu; `/claude <prompt>` and `/codex <prompt>` dispatch isolated route overrides in the same WhatsApp conversation.
- Conversation scoping: only conversations initialized with `/init` can dispatch `/claude`, `/codex`, or `/workspace`; other chats are ignored before the gateway is called.
- Single-instance protection: a local lock rejects a second gateway process before it can compete for the WhatsApp auth session; bare `/claude` and `/codex` return usage instead of being silently ignored.
- WhatsApp stability fix: duplicate gateway processes were stopped; `fromMe` self-messages are now allowlisted in explicit one-number mode even when Baileys supplies only an `@lid` identity. Status `440` was traced to concurrent sessions, not authentication loss.
- Phase 5 design approved and committed as `a66d1ff`; implementation plan is recorded in `docs/superpowers/plans/2026-09-11-enterprise-conversational-control-plane.md`.
- Managed control-plane state uses `data/control-plane.json`; native provider sessions remain independently stored in `data/developer-agent-sessions.json`.
- Phase 5 verification: `npm run build` passes; `npm test` reports 127 tests, 125 passed, 0 failed, 2 skipped; authorized chats and initialization-required commands auto-initialize, one-number identities are stable across Baileys LIDs, provider model IDs are shown directly, normal WhatsApp sends are used, and immediate execution acknowledgements remain enabled; the deep review's 17 findings were remediated; provider-default model fallback was hardened; `graphify update .` refreshed 798 nodes, 1295 edges, and 70 communities.
- Local doctor with explicit configuration reports truthful PASS/WARN/FAIL results; Codex smoke is available, while Claude, Copilot, and live WhatsApp acceptance are UNVERIFIED because the required local executables/auth state are unavailable in this worktree.
- Phase 6 verification: `npm test` reports 144 tests, 142 passed, 0 failed, 2 skipped; Codex smoke completed; the doctor reports streaming/reply-cache policy and a truthful Copilot executable failure; Graphify refreshed to 950 nodes, 1559 edges, and 79 communities. Synthetic cold/warm benchmark output and live-verification limitations are recorded in `.planning/phases/06-real-time-conversational-runtime/VERIFICATION.md`.
- Phase 7 deterministic verification recorded to date: `npm run build` passed; `npm test` reports 169 tests, 167 passed, 0 failed, 2 skipped. Full-suite durations are run-specific; `VERIFICATION.md` is the authoritative record for its command run. The measured deterministic benchmark is cold 5 ms and warm 1 ms; Phase 7 makes no comparative live latency claim because provider/transport measurements were not run. The existing Graphify snapshot contains 1081 nodes; Task 5 changed documentation only, so `graphify update .` was intentionally not rerun. Live WhatsApp and Web/Desktop companion acceptance are UNVERIFIED because no configured gateway/auth session was exercised; mobile protocol-native agent-left rendering is impossible with one WhatsApp account.

## Next Action

Complete Task 6 in `.planning/phases/07-single-number-presentation-runtime/07-01-PLAN.md`: run final measured automated verification and the manual live WhatsApp/provider and Web/Desktop companion acceptance before treating Phase 7 or those client layers as accepted.
