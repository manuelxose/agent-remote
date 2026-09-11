# agent-remote

Local WhatsApp gateway for isolated Claude, Codex, and Copilot developer-agent conversations. Baileys handles transport; the existing channel-neutral gateway, router, workspace policy, process runner, and persistent provider sessions remain the execution path.

## Install

```bash
npm install
cp .env.example .env
cp config/routes.example.json config/routes.json
```

Use an absolute or repository-relative path for `AGENT_REMOTE_WORKSPACE_ROOTS`. Put the WhatsApp account JID in `WHATSAPP_ALLOWED_USERS`; do not commit `.env`, `data/`, or auth state.

## Configuration

`.env` controls:

- `WHATSAPP_AUTH_PATH`: persisted Baileys auth directory.
- `WHATSAPP_ALLOWED_USERS`: comma-separated owner JIDs.
- `WHATSAPP_ALLOWED_CHATS`: optional comma-separated chat/group JIDs.
- `WHATSAPP_ALLOW_SELF_MESSAGES`: set `true` for one-number mode. Manual messages from the linked account remain allowlisted; gateway-generated message IDs are ignored to prevent loops.
- `AGENT_REMOTE_ROUTES_PATH`: JSON route file, default `config/routes.json`.
- `AGENT_REMOTE_WORKSPACE_ROOTS`: comma-separated approved workspace roots.
- `AGENT_REMOTE_DEFAULT_WORKSPACE`: fallback workspace for routes without `workspaceRoot`.
- `AGENT_REMOTE_SESSION_PATH`: persistent provider session map.
- `AGENT_REMOTE_TIMEOUT_MS` and `AGENT_REMOTE_MAX_OUTPUT_BYTES`: execution limits.
- `AGENT_REMOTE_<CLAUDE|CODEX|COPILOT>_EXECUTABLE`: optional absolute executable override, including a `/mnt/c/.../*.exe` path when the gateway runs in WSL.

Route keys use the existing resolver contract: `whatsapp-<conversation-id>`. Each value selects one provider and workspace without recompiling:

```json
{
  "whatsapp-120363...@g.us": {
    "id": "whatsapp-claude",
    "runtime": "developer-agent",
    "agent": "claude",
    "workspaceRoot": "../my-project"
  }
}
```

## Doctor and startup

```bash
npm run doctor
npm start
```

`doctor` reports `PASS`, `WARN`, or `FAIL` for configuration, routes, auth/session paths, approved workspaces, Graphify, and the installed Claude/Codex/Copilot executables. Missing CLIs are never reported as ready.

## WhatsApp pairing

1. Start `npm start`.
2. Open WhatsApp → Linked devices → Link a device.
3. Scan the terminal QR.
4. Wait for `whatsapp_connected`.

Baileys persists credentials under `WHATSAPP_AUTH_PATH`; later restarts reuse them and should not require pairing again. The account must be in `WHATSAPP_ALLOWED_USERS` and the chat must have a route. An authorized but unmapped chat receives its conversation ID and the required route key in the response.

Create three groups containing the linked account and the owner account, then send a message in each. After the first authorized message, use its printed conversation ID to add three route entries for Claude, Codex, and Copilot. Keep each provider, workspace, session, and execution queue separate.

## Provider behavior

The application checks the installed provider executables at runtime and invokes them through their existing adapters with direct argv, bounded output, timeouts, approved workspaces, and persisted native sessions. It does not install missing CLIs.

Normal messages are forwarded as prompts. Provider failures return a short WhatsApp-safe message; detailed stderr and lifecycle diagnostics remain in logs. `/status`-style commands are not required for normal operation.

Send `/workspace` from an authorized WhatsApp chat to see the effective workspace path. It is the same local project directory used by this gateway and the provider CLI; the command does not expose file contents.

With one-number mode enabled, initialize only the chat you want to use with `/init`, then select the provider inline: `/claude <prompt>` or `/codex <prompt>`. The two provider sessions and queues stay isolated even though both commands use the same WhatsApp conversation. Other chats, or this chat after a restart until `/init` is sent again, are ignored before any agent request is created.

Only one gateway process may use the WhatsApp auth directory at a time. A second `npm start` exits with the existing process ID instead of creating a competing WhatsApp session.

## Restart and troubleshooting

Stop with `Ctrl-C` or `SIGTERM`; the gateway closes the socket cleanly. Start it again without deleting `WHATSAPP_AUTH_PATH`, then send another message. Provider session mappings remain in `AGENT_REMOTE_SESSION_PATH` and are keyed by channel, conversation, agent, and canonical workspace.

If startup fails, run `npm run doctor`. Check the auth path, owner/chat allowlists, route key spelling, approved workspace roots, and that the provider executable is on `PATH`. Never paste auth files or provider credentials into logs or Git.

Talkaris remains a future chatbot-runtime extension. It is intentionally not connected to the developer-agent process runtime.
