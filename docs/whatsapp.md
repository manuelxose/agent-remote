# Local WhatsApp gateway

The gateway uses Baileys as a local WhatsApp Web transport. The adapter stores the multi-file authentication state on disk and reloads it at startup, so a still-valid session does not need another QR scan.

## Configuration

Set these environment variables before constructing the gateway:

```text
WHATSAPP_AUTH_PATH=/absolute/path/to/whatsapp-auth
WHATSAPP_ALLOWED_USERS=15551234567@s.whatsapp.net,another-user@s.whatsapp.net
WHATSAPP_ALLOWED_CHATS=group-id@g.us,chat-id@s.whatsapp.net
```

Optional reconnect tuning variables are `WHATSAPP_RECONNECT_BASE_DELAY_MS` and `WHATSAPP_RECONNECT_MAX_DELAY_MS`. Values must be positive integers, and the maximum must be at least the base delay.

`WHATSAPP_REPLY_CONTEXT_TTL_MS` and `WHATSAPP_REPLY_CONTEXT_MAX_ENTRIES` bound the minimal message-key cache used for native quoted replies. Missing, expired, or mismatched references safely fall back to an ordinary send.

The adapter fails closed when both allowlists are empty. A configured user list filters senders; a configured chat list matches either the conversation ID or group ID. If both are configured, both must match. Rejections happen before the gateway callback and are logged as structured events without message text, attachments, QR values, or authentication data.

## Startup and shutdown

The gateway composition helper returns the `Gateway` and `WhatsAppChannel`; the application composition root also wires the channel-neutral control plane:

```ts
const { gateway, channel } = createWhatsAppGateway(dependencies, {
  onQr: qr => renderQrForOperator(qr)
});

await channel.start();
const health = channel.health();
await channel.stop();
```

The `onQr` callback is the only QR delivery path. The adapter does not print QR contents. The callback can render it in a local terminal or expose it through an operator-only UI.

Health snapshots contain only lifecycle status, transition time, reconnect attempt, and a sanitized disconnect status code. Possible statuses are `stopped`, `connecting`, `qr`, `connected`, `reconnecting`, `logged_out`, and `failed`.

## Message boundary

Incoming messages are translated to the channel-neutral core `Message` model. The adapter supplies sender ID, conversation ID, optional group ID, text/caption, timestamp, and basic attachment descriptors. It ignores self-sent messages, broadcast/status traffic, unsupported textless payloads, and Baileys request-ID replay traffic. The application callback passes the translated message to the channel-neutral control plane and sends its `CommandResult` or agent result through WhatsApp. Future Telegram/Web adapters can invoke the same control-plane entry point with their own core `Message` values.

Accepted prompts set composing presence and receive a correlated acknowledgement. Claude/Codex deltas are aggregated using `AGENT_REMOTE_STREAM_MIN_CHARS`, `AGENT_REMOTE_STREAM_MAX_INTERVAL_MS`, and `AGENT_REMOTE_STREAM_MAX_MESSAGES`; each emitted chunk and the final remainder retain the original quoted reference. Presence returns to paused when execution terminates.

## Control-plane commands

Use `/help` for the registry-generated list. Authorized ordinary messages automatically initialize their chat with Codex; `/init [name]` remains available for explicit naming, and `/claude`, `/codex`, or `/copilot` select an agent. `/chats`, `/chat <name|id>`, `/rename`, and `/close` manage owner-scoped logical chats. `/model` exposes configured provider model IDs, `/workspace` and `/workspaces` enforce approved roots, and `/running`, `/cancel`, `/retry`, and `/reset confirm` manage execution state.

## One-account identity and delivery

The gateway uses one WhatsApp account. Agent Remote replies are transport messages from that account (`fromMe`), even when their logical `MessageOrigin` says that Claude, Codex, or another configured agent produced them. The logical origin is runtime metadata, not an attempt to spoof a sender or manufacture an inbound participant.

Each final or delayed-progress reply retains the exact incoming-message `reply` reference when its bounded quoted context remains available. Successful outbound sends are correlated by their exact WhatsApp message ID in a TTL- and capacity-bounded registry; text is never used as a key. The normal visible lifecycle is composing presence followed by one final reply and paused presence. `AGENT_REMOTE_PROGRESS_AFTER_MS=0` disables progress; a positive threshold allows at most the configured bounded progress/final messages. `/cancel` cancels the execution and pauses presence without sending a partial/final delivery through the streaming helper.

## Optional Web/Desktop presentation companion

Protocol-native left-side agent rendering is impossible under one WhatsApp account. WhatsApp Web/Desktop and mobile derive the sender layout from the real account and transport; linked devices and LID metadata do not create a second participant. Therefore the official **mobile** client remains unchanged and cannot be made to render Agent Remote as an incoming agent.

The opt-in presentation companion is a best-effort local Web/Desktop augmentation only. Set `AGENT_REMOTE_PRESENTATION_ENABLED=true`, choose `AGENT_REMOTE_PRESENTATION_PORT` (default `8765`), and set a private `AGENT_REMOTE_PRESENTATION_TOKEN`; put the same port/token in the companion source, run `npm run build`, then load `dist/presentation/whatsapp-companion` unpacked in Chromium. It polls only the loopback registry for exact IDs and can stop augmenting safely when the bridge or DOM changes. It neither sends WhatsApp messages nor reads local files, calls providers, alters encryption/network traffic, or affects mobile. WhatsApp may display Code Verify or extension warnings because the DOM is modified; review those warnings before use.
