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
- `AGENT_REMOTE_HISTORY_PATH`: imported WhatsApp chat metadata and message text, default `data/whatsapp-history.jsonl`.
- `AGENT_REMOTE_CONTROL_PLANE_PATH`: versioned managed-chat, binding, selection, and idempotency state (default `data/control-plane.json`).
- `AGENT_REMOTE_TIMEOUT_MS` and `AGENT_REMOTE_MAX_OUTPUT_BYTES`: execution limits.
- `AGENT_REMOTE_MAX_QUEUE_DEPTH`: bounded pending executions per logical chat.
- `AGENT_REMOTE_CLAUDE_MODEL` and `AGENT_REMOTE_CODEX_MODEL`: optional underlying provider model identifiers for the `sonnet` and `luna` aliases; when absent, the CLI default model is used.
- `AGENT_REMOTE_CLAUDE_MODELS` and `AGENT_REMOTE_CODEX_MODELS`: optional JSON alias maps for `/model`, for example `{"fast":"codex-mini-latest","quality":"gpt-5.6-luna"}`. Use `/model` to list aliases and `/model fast` to select one for the active chat.
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

After pairing, the first ordinary message in an authorized chat initializes it automatically with Codex. `/init [name]` remains available when an explicit chat name is wanted. Managed chats, agents, workspaces, provider sessions, queues, and state are controlled by the central command registry.

WhatsApp Web history sync imports available chat metadata and message text into `AGENT_REMOTE_HISTORY_PATH`. Use `/chat` to list imported chats, then `/chat <name-or-id> <question>` to reference a bounded excerpt. This is not a full archive: WhatsApp controls the synced coverage, so older chats and messages may be absent. Attachment descriptors may be retained as metadata, but attachment binaries are never downloaded. The local JSONL file is created and enforced as mode `0600`; keep it under `data/` and never commit it.

## Provider behavior

The application checks and caches provider availability at runtime and invokes the installed executables through their existing adapters with direct argv, bounded output, timeouts, approved workspaces, and persisted native sessions. Claude and Codex stream incremental output when their JSONL protocols provide it; Copilot remains completion-only. It does not install missing CLIs.

Normal messages from authorized chats are automatically initialized and forwarded as prompts; `/claude` and `/codex` can still explicitly select the agent. Accepted prompts set composing presence but do not receive an immediate WhatsApp acknowledgement. Provider streaming stays internal and WhatsApp sends one final correlated reply by default; a positive `AGENT_REMOTE_PROGRESS_AFTER_MS` can send one delayed `AGENT_REMOTE_PROGRESS_TEXT` reply before the final response. The quoted context cache is bounded by TTL/capacity and falls back to an ordinary send when unavailable. Because Baileys sends through that account, WhatsApp will display them as sent by that account; making them appear from another person requires a separate WhatsApp account/auth session. `/cancel` aborts provider work, pauses presence, and suppresses streaming partial/final delivery. Provider failures return a short WhatsApp-safe message; detailed stderr and lifecycle diagnostics remain in logs.

Send `/workspace` from an authorized WhatsApp chat to see the effective workspace path. It is the same local project directory used by this gateway and the provider CLI; the command does not expose file contents.

The command set includes `/help`, `/init [name]`, `/chats`, `/chat`, `/rename`, `/close`, `/claude`, `/codex`, `/copilot`, `/agent`, `/model`, `/workspace`, `/workspaces`, `/status`, `/running`, `/cancel`, `/retry`, `/reset confirm`, `/history`, `/doctor`, `/health`, `/version`, and `/whoami`. Before initialization, only `/help`, `/init`, `/status`, and `/whoami` work. After `/claude` or `/codex`, ordinary messages continue in that provider's isolated session. Retry prompts are retained only in memory and are omitted from durable control-plane state.

Only one gateway process may use the WhatsApp auth directory at a time. A second `npm start` exits with the existing process ID instead of creating a competing WhatsApp session.

## Restart and troubleshooting

Stop with `Ctrl-C` or `SIGTERM`; the gateway closes the socket cleanly. Start it again without deleting `WHATSAPP_AUTH_PATH`, then send another message. Managed conversation state remains in `AGENT_REMOTE_CONTROL_PLANE_PATH`; native provider session mappings remain in `AGENT_REMOTE_SESSION_PATH` and are keyed by channel, logical conversation, agent, and canonical workspace. Both stores use atomic JSON replacement.

If startup fails, run `npm run doctor`. Check the auth path, owner/chat allowlists, route key spelling, approved workspace roots, and that the provider executable is on `PATH`. Never paste auth files or provider credentials into logs or Git.

Talkaris remains a future chatbot-runtime extension. It is intentionally not connected to the developer-agent process runtime.

## Single-number WhatsApp presentation

Agent Remote uses one WhatsApp account: a generated reply is a transport message with `fromMe`, while `MessageOrigin` identifies the logical agent and execution for correlation. The normal transport experience is composing presence and one quoted final reply; optional delayed progress is controlled by `AGENT_REMOTE_PROGRESS_AFTER_MS`, and `/cancel` stops provider work without producing a streaming partial/final reply. Exact successful WhatsApp send IDs are held in a finite TTL/capacity registry, not inferred from response text.

WhatsApp cannot natively show a same-account agent as a second, left-side sender. The optional presentation companion augments only local Web/Desktop DOM nodes for registered exact IDs; it is opt-in and best-effort. It does not affect the official mobile client, protocol traffic, or sender identity. See [WhatsApp operations](docs/whatsapp.md) for setup, token handling, and extension warnings.
