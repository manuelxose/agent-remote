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

## Control-plane commands

Use `/help` for the registry-generated list. The first-contact restriction allows only `/help`, `/init`, `/status`, and `/whoami` before initialization. Initialize with `/init [name]`, select an agent with `/claude`, `/codex`, or `/copilot`, then send ordinary text. `/chats`, `/chat <name|id>`, `/rename`, and `/close` manage owner-scoped logical chats. `/model` exposes configured aliases, `/workspace` and `/workspaces` enforce approved roots, and `/running`, `/cancel`, `/retry`, and `/reset confirm` manage execution state.
