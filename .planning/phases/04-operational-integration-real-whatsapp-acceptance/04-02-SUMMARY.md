# Phase 4 Plan 02 Summary

## Delivered

- Added `WHATSAPP_ALLOW_SELF_MESSAGES` with a secure default of `false`.
- Enabled one-number mode in the ignored local `.env`.
- Self-sent manual prompts remain subject to the configured WhatsApp allowlist.
- Gateway-generated Baileys message IDs are tracked and ignored when echoed back, preventing response loops.
- `/init` initializes the one-number command menu, while `/claude <prompt>` and `/codex <prompt>` select isolated route/session keys in the same chat.
- Initialization is scoped by conversation: uninitialized chats are ignored before any agent request is created.
- A local process lock prevents a second gateway from competing for the same WhatsApp auth directory.
- Bare `/claude` and `/codex` commands now return usage instructions.
- Self-message authorization accepts Baileys `fromMe` payloads in opt-in mode without requiring a phone-number match when only an `@lid` is available.
- Documented self-chat operation and preserved the existing default behavior for deployments that do not opt in.

## Verification

- Focused WhatsApp translation/channel tests: 14 passed, 0 failed.
- Full `npm test`: 99 tests, 97 passed, 0 failed, 2 skipped.
- `npm run doctor`: configuration, routes, workspace roots, Claude Code 2.1.68, Codex 0.154.0, and Graphify pass; Copilot remains unavailable.
- `graphify update .`: completed successfully.
- Gateway restarted with persisted WhatsApp auth and reported `whatsapp_connected` after the command changes.
- Duplicate gateway processes causing status `440` were stopped; one gateway process is now active.
- A second `npm start` was verified to exit with the active gateway PID instead of opening a competing session.

## Remaining manual acceptance

Send `/workspace`, then one Claude prompt and one Codex prompt from the same linked WhatsApp account. Configure the resulting conversation IDs as separate local routes and verify both responses.
