# State

## Current Position

Phase 6 — Real-Time Conversational Runtime (complete)

## Status

The Phase 5 control plane is implemented: central command registry, explicit state, owner-scoped managed chats, atomic versioned JSON state, bounded per-chat queues, cancellation, idempotency, explicit model policy, application composition, docs, and tests. Deterministic verification is complete; unavailable Claude/Copilot CLIs and live WhatsApp credentials are recorded as UNVERIFIED in the phase verification artifact.

Phase 6 design is approved and recorded in `docs/superpowers/specs/2026-09-11-real-time-conversational-runtime-design.md`; implementation follows the executable plan in `docs/superpowers/plans/2026-09-11-real-time-conversational-runtime.md`. The phase is complete locally with streaming contracts, managed sessions, correlated bounded WhatsApp delivery, telemetry, diagnostics, documentation, tests, and a refreshed Graphify graph. Codex smoke passed; Claude/Copilot Phase 6 provider execution and live WhatsApp streaming remain explicitly unverified.

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
- Automatic initialization: `/init` returns the one-number command menu; `/claude <prompt>` and `/codex <prompt>` dispatch isolated route overrides in the same WhatsApp conversation.
- Conversation scoping: only conversations initialized with `/init` can dispatch `/claude`, `/codex`, or `/workspace`; other chats are ignored before the gateway is called.
- Single-instance protection: a local lock rejects a second gateway process before it can compete for the WhatsApp auth session; bare `/claude` and `/codex` return usage instead of being silently ignored.
- WhatsApp stability fix: duplicate gateway processes were stopped; `fromMe` self-messages are now allowlisted in explicit one-number mode even when Baileys supplies only an `@lid` identity. Status `440` was traced to concurrent sessions, not authentication loss.
- Phase 5 design approved and committed as `a66d1ff`; implementation plan is recorded in `docs/superpowers/plans/2026-09-11-enterprise-conversational-control-plane.md`.
- Managed control-plane state uses `data/control-plane.json`; native provider sessions remain independently stored in `data/developer-agent-sessions.json`.
- Phase 5 verification: `npm run build` passes; `npm test` reports 127 tests, 125 passed, 0 failed, 2 skipped; authorized chats and initialization-required commands auto-initialize, one-number identities are stable across Baileys LIDs, provider model IDs are shown directly, normal WhatsApp sends are used, and immediate execution acknowledgements remain enabled; the deep review's 17 findings were remediated; provider-default model fallback was hardened; `graphify update .` refreshed 798 nodes, 1295 edges, and 70 communities.
- Local doctor with explicit configuration reports truthful PASS/WARN/FAIL results; Codex smoke is available, while Claude, Copilot, and live WhatsApp acceptance are UNVERIFIED because the required local executables/auth state are unavailable in this worktree.
- Phase 6 verification: `npm test` reports 143 tests, 141 passed, 0 failed, 2 skipped; Codex smoke completed; the doctor reports streaming/reply-cache policy and a truthful Copilot executable failure; Graphify refreshed to 950 nodes, 1559 edges, and 79 communities. Synthetic cold/warm benchmark output and live-verification limitations are recorded in `.planning/phases/06-real-time-conversational-runtime/VERIFICATION.md`.

## Next Action

Use the phase verification artifact for future live WhatsApp/provider acceptance or begin the next milestone.
