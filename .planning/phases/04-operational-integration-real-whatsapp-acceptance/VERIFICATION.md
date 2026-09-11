# Phase 4 Verification

## Result

Automated integration and one-number self-chat mode are complete; WhatsApp pairing and restart recovery are verified. Routed provider acceptance is pending local route IDs and the manual WhatsApp acceptance step.

## Evidence

- `npm run build` — passes.
- `npm test` — 99 tests, 97 passed, 0 failed, 2 skipped; the two skips are the existing environment-dependent Claude/Copilot smoke checks when no override is exported to the test process.
- `node --test --experimental-strip-types test/operational.test.ts` — 4 passed, 0 failed.
- `npm run doctor` with the local configuration — routes, workspace roots, Graphify, Claude Code `2.1.68`, and Codex CLI pass; auth/session paths warn before first start; Copilot fails truthfully as unavailable.
- Codex CLI verification — `codex-cli 0.154.0`; `codex exec --help` exposes `--json` and `--sandbox`, matching the existing adapter contract.
- `graphify update .` — refreshed 529 nodes, 806 edges, and 44 communities.
- Startup failure verification — `npm start` without approved workspace configuration exits 1 with an actionable error.
- Real WhatsApp pairing — `whatsapp_connected` observed after QR pairing and after a restart using persisted auth state; no second QR was required.
- Real WhatsApp LID compatibility — a `177970694115489@lid` sender with `participantAlt=34673426433@s.whatsapp.net` now passes the configured owner allowlist.
- Claude Code integration — `npm run doctor` reports Claude Code `2.1.68` from the configured WSL path, and the adapter smoke completes through `/mnt/c/Users/Admin/.local/bin/claude.exe`; Copilot remains unavailable.
- One-number self-chat — focused tests prove manual `fromMe` prompts are authorized and tracked gateway response IDs are ignored to prevent loops; local `.env` enables the mode.
- Automatic initialization — focused gateway/operational tests prove `/init`, `/claude <prompt>`, and `/codex <prompt>` dispatch isolated agent routes without physical chat IDs.
- Conversation scoping — focused operational tests prove agent and workspace commands are ignored until `/init` initializes that exact conversation.
- Single-instance protection — a second `npm start` exits with the active PID before opening another WhatsApp session.
- WhatsApp stability — duplicate running gateways were identified as the source of repeated status `440` session replacement; after stopping them, one restarted gateway reported `whatsapp_connected`. A self-message arriving as `278386962370655@lid` now passes explicit one-number authorization.

## Implemented acceptance coverage

- One composition root wires configuration, route resolution, workspace policy, event bus, conversations, persistent sessions, three developer adapters, runtime, gateway, and WhatsApp lifecycle.
- `start` and `doctor` scripts are available from `package.json`.
- Route IDs and workspace roots are loaded from local configuration; real IDs are not hardcoded.
- Terminal QR rendering uses `qrcode-terminal`; Baileys auth persistence and reconnect remain in the existing channel.
- Unknown authorized conversations receive a route-key diagnostic; runtime failures remain concise.
- `.env`, `data/`, auth state, and sessions are ignored by Git.

## Remaining real gates

- Configure the owner WhatsApp JID and three real conversation IDs/workspaces locally.
- Send `/init` and `/workspace` from the paired account and record both responses.
- Confirm a second, uninitialized chat receives no agent request.
- Do not launch a second gateway process; the lock now rejects it with the existing PID.
- Send one `/claude <prompt>` and one `/codex <prompt>` from the same WhatsApp account, then verify the separate route/session responses.
- Claude Code and Codex are available for routed E2E; Copilot is not installed, so Copilot WhatsApp E2E cannot be claimed.
