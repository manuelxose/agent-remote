# Single-Number Presentation and Conversational Runtime Design

## Context

Agent Remote already has a channel-neutral control plane, provider adapters, logical provider sessions, incremental execution events, quoted WhatsApp replies, composing presence, bounded delivery, and latency telemetry. The remaining product gaps are that WhatsApp self-chat renders both human and agent traffic as the same account, message-origin metadata is not a typed domain concept, the outbound registry stores only message IDs, and streaming delivery can emit intermediate chunks during ordinary conversations.

The product constraint remains absolute: exactly one WhatsApp account and phone number. The real WhatsApp session must remain protocol-valid and usable from the official mobile, Web, and Desktop clients.

## Investigation findings

The installed dependency is `@whiskeysockets/baileys@7.0.0-rc14`.

1. Baileys exposes `fromMe`, `remoteJid`, `participant`, `participantAlt`, `remoteJidAlt`, and related LID/phone mappings. These distinguish addressing and transport provenance, but they do not provide a second sender identity for a message sent by the same account.
2. Baileys' normal message generation creates outbound messages with `key.fromMe: true`. `sendMessage` and `relayMessage` can preserve message IDs and quoted context, but neither API can make a same-account message an inbound participant message.
3. In self-chat, the remote conversation is the user's own JID. A linked device is another device for the same account, not another chat participant. LID/phone metadata cannot control how official clients assign left/right sender presentation.
4. WhatsApp documents self-messages as regular chats and linked devices as independent devices sharing one account. A group topology would still need another participant and is therefore outside the constraint.
5. A local Web/Desktop presentation companion is the only controllable way to provide logical agent-left visuals. It must be opt-in, presentation-only, and isolated from encryption, transport interception, WhatsApp databases, and forged inbound traffic. WhatsApp's Code Verify warning and Terms make this an explicit operational risk that must be documented.

## Goals

- Keep human, agent, and system identity separate from WhatsApp transport sender identity.
- Attach structured origin metadata to every Agent Remote outbound response.
- Correlate each generated WhatsApp message using the exact Baileys message ID, with bounded TTL and capacity.
- Preserve exact native quoted replies for every response and intermediate progress message.
- Make ordinary WhatsApp delivery composing-plus-final by default; allow at most one meaningful delayed progress message for long executions.
- Retain provider-neutral streaming internally, provider session reuse, cancellation, bounded concurrency, shutdown cleanup, and telemetry.
- Provide an opt-in Web/Desktop companion that can visually label and reposition correlated agent messages when the official client DOM permits it.
- Leave official mobile behavior unchanged and truthful when the companion is unavailable.

## Non-goals

- A second WhatsApp number, account, SIM, Business identity, or human participant.
- Spoofing `fromMe`, forging inbound protocol messages, patching Signal/encryption, intercepting WhatsApp network traffic, or modifying WhatsApp databases.
- A WhatsApp Web replacement, unofficial WhatsApp client, or account automation beyond the existing Baileys transport.
- Token-by-token WhatsApp delivery.
- A distributed broker, database, external telemetry service, or new runtime dependency.
- Guaranteeing DOM augmentation across every future WhatsApp Web/Desktop release.

## Architecture

### Logical identity and origin

The core package gains transport-neutral concepts:

```ts
type LogicalParticipantKind = "human" | "agent" | "system";

interface LogicalParticipant {
  id: string;
  kind: LogicalParticipantKind;
  displayName: string;
}

interface MessageOrigin {
  type: LogicalParticipantKind;
  agentId?: string;
  executionId?: string;
  logicalSessionId?: string;
}
```

`Message.origin` identifies the logical sender when available. `OutboundMessage.origin` is mandatory for generated agent responses and optional for system responses. `MessageReference` remains the only correlation primitive crossing the channel boundary. No Baileys types enter core or control-plane packages.

### Bounded outbound registry

The WhatsApp adapter owns a registry keyed by the exact returned WhatsApp message ID:

```ts
interface AgentGeneratedMessageMetadata {
  whatsappMessageId: string;
  conversationId: string;
  origin: MessageOrigin;
  replyToMessageId?: string;
  createdAt: number;
}
```

The registry has fixed maximum entries, TTL pruning on reads/writes, deterministic oldest-first eviction, and no prompt or response-text matching. It is an in-memory presentation correlation cache; persistence is not required because the companion can safely fall back when a message is outside the TTL. A send records the returned Baileys message ID immediately after successful delivery.

### Delivery policy

Provider adapters continue emitting `assistant.delta` events. The control plane consumes them through a provider-neutral aggregator. The default WhatsApp policy buffers all deltas and sends one final response with the exact triggering quote. Presence is set to `composing` while execution is active and `paused` after completion, failure, cancellation, or shutdown.

For executions exceeding `AGENT_REMOTE_PROGRESS_AFTER_MS` (default disabled or a conservative configured threshold), the policy may send one concise progress message. Progress is never a stream of provider tokens and is always correlated to the original message. The final response remains the only normal response for short turns.

### Presentation companion

The companion is an opt-in Manifest V3 Web extension/content script plus a loopback bridge:

```text
WhatsAppChannel
  └─ sends message and receives exact message ID
       └─ AgentMessageRegistry
            └─ authenticated loopback bridge
                 └─ companion content script
                      └─ message locator
                           └─ logical agent label + left-side styling
```

The bridge binds only to loopback, uses a per-session random token, restricts CORS/origins, accepts only registry metadata, and exposes no command execution or provider secrets. The content script uses a locator abstraction with message-ID/data-attribute and accessibility/DOM fallback strategies. It uses `MutationObserver` and re-applies presentation after dynamic insertion or virtualization. Human messages are never transformed unless their exact message ID is present in the agent registry.

The companion does not claim to change WhatsApp's server identity. It decorates the local official-client presentation and can report `unsupported` when a locator cannot safely identify a message. Mobile has no companion and continues showing normal same-account self-chat presentation.

### Runtime and provider boundaries

The existing runtime remains the selected implementation boundary:

```text
ControlPlane
  -> AgentSessionSupervisor
    -> LogicalAgentSession
      -> ProviderExecutionStrategy
        -> Claude / Codex / Copilot
```

Claude and Codex continue translating provider-specific stream formats inside their adapters. Executable discovery remains cached. Logical sessions are reused by `(logicalSessionId, provider, workspace)`, same-session turns serialize, different sessions run concurrently within the global limit, cancellation reaches the child process, and shutdown closes all sessions.

## Error handling and security

- A missing registry entry, expired entry, bridge disconnect, or unsupported DOM shape never changes transport behavior; the real WhatsApp message remains intact.
- A mismatched conversation ID or reply ID prevents companion transformation and is logged without message text.
- Registry overflow evicts the oldest entry; TTL pruning prevents unbounded memory.
- Failed provider execution sends a bounded diagnostic response, clears presence, and never leaves an orphan process.
- Bridge authentication failure, malformed metadata, or non-loopback access is rejected.
- Companion warnings must explain that Web/Desktop augmentation is unofficial and may trigger Code Verify warnings; the official mobile client remains supported without augmentation.

## Verification

Automated tests cover origin metadata, exact reply correlation and wrong-reply prevention, registry TTL/capacity, multiple chats/groups/self-chat/LID messages, final-only and delayed-progress delivery, provider streaming/session reuse/provider switching, serialization and cross-session parallelism, cancellation, crashes, reconnect, shutdown, telemetry, and companion message-ID protection, dynamic insertion, re-rendering, virtualization, reconnect, and multi-conversation isolation.

Verification must report separately:

```text
SINGLE ACCOUNT: PASS/FAIL
Protocol-native agent-left rendering: IMPOSSIBLE WITH EVIDENCE or PASS
Web/Desktop enhanced agent-left rendering: PASS or NOT IMPLEMENTED
Mobile official client agent-left rendering: NOT CONTROLLABLE
```

Live WhatsApp acceptance is not replaced by fakes. It requires the configured session and must record `/claude`, `/codex`, provider reuse, composing/presence, exact replies, `/running`, and real cancellation. Latency reports must distinguish measured cold and warm runs and must not invent unavailable provider or transport numbers.
