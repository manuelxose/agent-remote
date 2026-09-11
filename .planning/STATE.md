# State

## Current Position

Phase 4 — Operational Integration & Real WhatsApp Acceptance (implementation, automatic one-number commands, automated verification, and paired gateway)

## Status

Composition root, configuration loader, doctor command, operational scripts, examples, one-number self-chat mode, automatic `/init`/`/claude`/`/codex` commands, and tests are implemented. WhatsApp is paired and reconnects after restart; real routed provider messages remain the final environment-dependent gate.

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

## Next Action

Send `/init` from the paired allowlisted account, then perform one Claude and one Codex command in that same self-chat. Confirm a message in a different chat is ignored. Production-grade credential storage, distributed event delivery, and long-lived interactive CLI processes remain future concerns.
