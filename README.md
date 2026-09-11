# agent-remote

Local conversational control plane for isolated Claude, Codex, and Copilot developer-agent conversations. WhatsApp is the first transport; command semantics, durable managed chats, authorization, queues, and model/workspace policy are channel-neutral.

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
- `AGENT_REMOTE_WORKSPACE_ALIASES`: optional JSON object mapping safe names to paths under the approved workspace roots.
- `AGENT_REMOTE_SESSION_PATH`: persistent provider session map.
- `AGENT_REMOTE_CONTROL_PLANE_PATH`: versioned managed-chat, binding, selection, and idempotency state (default `data/control-plane.json`).
- `AGENT_REMOTE_TIMEOUT_MS` and `AGENT_REMOTE_MAX_OUTPUT_BYTES`: execution limits.
- `AGENT_REMOTE_MAX_QUEUE_DEPTH`: bounded pending executions per logical chat.
- `AGENT_REMOTE_CLAUDE_MODEL` and `AGENT_REMOTE_CODEX_MODEL`: optional underlying provider model identifiers for the `sonnet` and `luna` aliases; when absent, the CLI default model is used.
- `AGENT_REMOTE_OWNER_IDS`, `AGENT_REMOTE_OPERATOR_IDS`, and `AGENT_REMOTE_VIEWER_IDS`: optional role mappings; allowlisted users default to owners.
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

`doctor` reports `PASS`, `WARN`, or `FAIL` for configuration, routes, WhatsApp, persistence, approved workspaces, Graphify, provider executables, and configured models. Missing CLIs or models are never reported as ready.

## WhatsApp pairing

1. Start `npm start`.
2. Open WhatsApp → Linked devices → Link a device.
3. Scan the terminal QR.
4. Wait for `whatsapp_connected`.

Baileys persists credentials under `WHATSAPP_AUTH_PATH`; later restarts reuse them and should not require pairing again. The account must be in `WHATSAPP_ALLOWED_USERS` and the chat must have a route. An authorized but unmapped chat receives its conversation ID and the required route key in the response.

After pairing, an authorized chat is initialized with `/init [name]`. Managed chats, agents, workspaces, provider sessions, queues, and state are controlled by the central command registry.

## Provider behavior

The application checks the installed provider executables at runtime and invokes them through their existing adapters with direct argv, bounded output, timeouts, approved workspaces, and persisted native sessions. It does not install missing CLIs.

Normal messages are forwarded as prompts after `/init` and explicit agent selection. Provider failures return a short WhatsApp-safe message; detailed stderr and lifecycle diagnostics remain in logs.

Send `/workspace` from an authorized WhatsApp chat to see the effective workspace path. It is the same local project directory used by this gateway and the provider CLI; the command does not expose file contents.

The command set includes `/help`, `/init [name]`, `/chats`, `/chat`, `/rename`, `/close`, `/claude`, `/codex`, `/copilot`, `/agent`, `/model`, `/workspace`, `/workspaces`, `/status`, `/running`, `/cancel`, `/retry`, `/reset confirm`, `/history`, `/doctor`, `/health`, `/version`, and `/whoami`. Before initialization, only `/help`, `/init`, `/status`, and `/whoami` work. After `/claude` or `/codex`, ordinary messages continue in that provider's isolated session. Retry prompts are retained only in memory and are omitted from durable control-plane state.

Only one gateway process may use the WhatsApp auth directory at a time. A second `npm start` exits with the existing process ID instead of creating a competing WhatsApp session.

## Restart and troubleshooting

Stop with `Ctrl-C` or `SIGTERM`; the gateway closes the socket cleanly. Start it again without deleting `WHATSAPP_AUTH_PATH`, then send another message. Managed conversation state remains in `AGENT_REMOTE_CONTROL_PLANE_PATH`; native provider session mappings remain in `AGENT_REMOTE_SESSION_PATH` and are keyed by channel, logical conversation, agent, and canonical workspace. Both stores use atomic JSON replacement.

If startup fails, run `npm run doctor`. Check the auth path, owner/chat allowlists, route key spelling, approved workspace roots, and that the provider executable is on `PATH`. Never paste auth files or provider credentials into logs or Git.

Talkaris remains a future chatbot-runtime extension. It is intentionally not connected to the developer-agent process runtime.
