# WhatsApp Channel Adapter Design

## Goal

Provide a local Baileys-backed WhatsApp transport adapter for `agent-remote`. It restores local authentication across process restarts, converts incoming WhatsApp messages into the channel-neutral `Message` contract, rejects unauthorized traffic before routing, and sends channel-neutral `AgentResponse` values back to the originating conversation.

## Boundary

The adapter owns only WhatsApp transport concerns:

- Baileys socket creation and event subscriptions.
- Local authentication/session persistence.
- QR/pairing notification through an application callback.
- Reconnection, shutdown, and transport health state.
- WhatsApp payload parsing and response delivery.
- User/chat allowlist enforcement and security-rejection logging.

The adapter does not select agents, invoke runtimes, resolve routes, or contain agent/product logic. The gateway remains responsible for publishing `MessageReceived`, loading conversation state, resolving routes, invoking runtimes, and calling the channel to deliver the resulting response.

## Data flow

```text
Baileys messages.upsert
        |
        v
WhatsAppChannel.receive -> allowlist check -> Message
        |
        v
Gateway.handle -> MessageReceived -> route -> runtime -> AgentResponse
        |
        v
WhatsAppChannel.send -> originating remoteJid
```

The channel startup method accepts an incoming-payload handler. The gateway composition root supplies `gateway.handle`, so unauthorized messages fail inside `receive` and never reach the router.

## Authentication and lifecycle

`WHATSAPP_AUTH_PATH` selects a local directory passed to Baileys' multi-file auth-state helper. Credential updates are persisted immediately. Startup creates one socket and registers `connection.update`, `creds.update`, and `messages.upsert` handlers. Connection closure reconnects after bounded exponential backoff unless Baileys reports an explicit logout. `stop()` cancels pending reconnects, removes listeners where supported, and closes the socket without deleting authentication data.

QR values are delivered only through an `onQr` callback. They are never passed to the structured logger. Restored valid credentials connect without another QR flow.

## Security

Configuration is parsed from environment variables or validated options:

- `WHATSAPP_ALLOWED_USERS`: comma-separated sender IDs.
- `WHATSAPP_ALLOWED_CHATS`: comma-separated conversation or group IDs.
- `WHATSAPP_AUTH_PATH`: local auth directory.

An empty allowlist configuration denies all inbound messages. A configured user list filters sender IDs; a configured chat list filters conversation/group IDs. When both are configured, both filters must pass. Rejections log only event name, sender ID, conversation ID, group ID, and rejection reason. Message text, attachment contents, QR values, credentials, and auth keys are never logged.

## Message translation

The adapter maps:

- `key.id` to `Message.id`.
- `key.remoteJid` to `Message.conversationId`.
- `key.participant` or `key.remoteJid` to `Message.senderId`.
- Group remote JIDs to `Message.groupId`.
- Conversation, extended-text, and media captions to `Message.text`.
- Baileys message timestamps to `Message.receivedAt`.
- Image, video, audio, document, and sticker descriptors to channel-neutral attachment metadata containing only kind, MIME type, filename, and size where available.

Messages sent by the local account are ignored to prevent response loops.

## Health

The channel exposes a snapshot with lifecycle status (`stopped`, `connecting`, `qr`, `connected`, `reconnecting`, `logged_out`, or `failed`), last transition time, reconnect attempt count, and last error code. No credential or QR data is included. The gateway application can expose this snapshot through its normal health endpoint/composition object.

## Verification

Tests use injected socket/auth dependencies and never connect to WhatsApp. They cover message parsing, group identity, attachments, allowlist rejection, QR/connection state transitions, reconnect classification, graceful shutdown, response delivery, gateway routing, and the absence of product-specific imports from the WhatsApp package.
