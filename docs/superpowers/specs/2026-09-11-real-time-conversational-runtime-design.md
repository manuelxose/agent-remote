# Real-Time Conversational Runtime Design

## Context

Phase 5 introduced a channel-neutral control plane, durable managed
conversations, provider-native session IDs, bounded per-chat queues, and
WhatsApp ingress/egress. The remaining runtime path still buffers provider
stdout until process exit, resolves provider executables per turn, sends
ordinary WhatsApp messages without quoted context, and has no explicit
provider-session lifecycle or latency telemetry.

## Goals

- Preserve the channel-neutral control-plane boundary while carrying reply
  correlation from inbound transport message to every useful outbound message.
- Surface provider output incrementally, before execution completion, through a
  provider-neutral event/observer contract.
- Keep logical conversational sessions durable and isolated while choosing a
  provider-specific execution strategy. The initial strategy is a warm logical
  session plus native provider resume; no provider is forced into a persistent
  process when its CLI does not support one safely.
- Cache provider executable discovery and capabilities at startup, with an
  explicit refresh path.
- Make cancellation, timeouts, queue bounds, provider crash recovery, and
  graceful shutdown explicit and observable.
- Provide bounded WhatsApp presence/progress/final delivery and structured
  latency telemetry without a third-party telemetry dependency.
- Preserve Phase 5 authorization, workspace restrictions, persistence safety,
  chatbot isolation, and provider-specific parsing boundaries.

## Non-goals

- A distributed broker, database, telemetry vendor, or multi-process lock.
- A fake persistent stdin/stdout daemon for Claude or Codex.
- Editing WhatsApp messages in place or emitting one transport message per
  provider token.
- Baileys types or provider JSON in `packages/core`, `packages/control-plane`,
  or the developer runtime's public domain contracts.
- New Telegram, Web, or Discord adapters.

## Architecture

```text
transport payload
  -> channel-neutral Message + MessageReference
  -> ControlPlane
       -> ManagedConversation / bounded queue
       -> AgentSessionSupervisor
            -> provider AgentExecutionSession
                 -> provider adapter + streaming process runner
  -> AgentExecutionEvent observer
  -> StreamingDeliveryPolicy
  -> OutboundMessage { text, replyTo, metadata }
  -> channel adapter (native quoted reply when supported)
```

### Identity model

The runtime keeps three IDs distinct:

- `externalConversationId`: the transport conversation, such as a WhatsApp
  JID.
- `logicalSessionId`: the durable Agent Remote chat selected by the owner.
- `providerSessionId`: the Claude session ID, Codex thread ID, or Copilot
  session ID stored only behind the provider/session boundary.

`MessageReference` is transport-neutral:

```ts
export interface MessageReference {
  channel: string;
  conversationId: string;
  messageId: string;
  senderId?: string;
}
```

Inbound `Message` includes `replyReference?: MessageReference` only when the
transport can supply it. Outbound channel-neutral results use:

```ts
export interface OutboundMessage {
  text: string;
  replyTo?: MessageReference;
  metadata?: Metadata;
}
```

The control plane's command and execution responses expose `replyTo` derived
from the triggering message. The WhatsApp adapter converts it to Baileys'
`quoted` option using a bounded in-memory message-context cache. Cache entries
contain only the minimum key/context needed for quoting, have configurable TTL
and capacity, are pruned on access/insert, and fall back to an ordinary send
when absent or expired.

### Provider/session boundary

The developer runtime adds these provider-neutral concepts:

```ts
export interface AgentExecutionRequest {
  executionId: string;
  correlationId: string;
  logicalSessionId: string;
  prompt: string;
  conversationId: string;
  sessionId?: string;
  model?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface AgentExecutionObserver {
  onEvent(event: AgentExecutionEvent): void | Promise<void>;
}

export interface AgentExecutionSession {
  readonly id: string;
  readonly provider: string;
  readonly logicalSessionId: string;
  execute(request: AgentExecutionRequest, observer: AgentExecutionObserver): Promise<AgentExecutionResult>;
  cancel(executionId: string): Promise<void>;
  close(): Promise<void>;
  health(): AgentExecutionSessionHealth;
}

export interface AgentSessionSupervisor {
  getOrCreate(logicalSessionId: string, provider: string, workspace: string): Promise<AgentExecutionSession>;
  get(id: string): AgentExecutionSession | undefined;
  close(id: string): Promise<void>;
  closeAll(): Promise<void>;
}
```

The exact names may follow existing repository conventions, but the boundary
and responsibilities are fixed. A session owns provider execution strategy,
active cancellation, health, and close behavior. The supervisor owns session
creation, lookup, bounded registry state, and shutdown. Control-plane code only
uses the runtime's public execution/cancellation/lifecycle ports.

The first implementation is a logical persistent session wrapping the existing
one-shot adapters. Claude and Codex resume their stored native session/thread
IDs; Copilot retains its existing session-ID strategy. A later provider may
replace the internals with a persistent process or remote RPC without changing
control-plane contracts.

### Streaming events and delivery

Normalized events include:

```text
execution.accepted
execution.started
provider.started
assistant.delta
assistant.message
tool.started
tool.progress
tool.completed
execution.completed
execution.failed
execution.cancelled
```

Provider adapters parse Claude/Codex/Copilot output and emit these events.
Malformed provider events become bounded `execution.failed` diagnostics;
provider-specific JSON never crosses into the control plane.

The process runner reports stdout chunks as they arrive while retaining bounded
final stdout/stderr for adapter completion and diagnostics. Claude uses its
supported stream-oriented JSON mode when available; Codex consumes JSONL
incrementally from `codex exec --json`; both retain native resume IDs. If a
provider cannot stream, its session emits a completion-only result behind the
same interface.

`StreamingDeliveryPolicy` buffers deltas and flushes at a minimum character
threshold or maximum interval, subject to a maximum message count per
execution. Short work sends only a final response; long work may send a
correlated acknowledgement/progress message plus a correlated final response.
Presence is set to composing at acceptance and returned to paused/available at
completion/cancellation/failure. Transport send errors are logged as bounded
delivery failures and do not crash the provider/session supervisor.

### Lifecycle and concurrency

Each logical session has one serialized execution queue. Different logical
sessions execute concurrently. Queue depth and global provider/session counts
are bounded by configuration. `/cancel` aborts the actual active execution,
rejects/drains queued work, and waits for provider termination before returning.
Provider crashes transition only the affected execution/session to a controlled
failure state and permit a later session recreation/resume attempt.

Gateway shutdown performs this order:

1. stop accepting new control-plane work;
2. stop admitting queued work and drain active work until the configured
   deadline;
3. cancel remaining executions;
4. close all runtime sessions/supervisors;
5. persist control-plane/session state;
6. stop WhatsApp cleanly.

All lifecycle operations are idempotent and no provider process may remain
orphaned after cancellation or forced shutdown.

### Correlation and observability

Every execution carries `correlationId`, `executionId`, `logicalSessionId`,
`externalConversationId`, `incomingMessageId`, `provider`, `agent`,
`workspace`, and `model` where applicable. Runtime and delivery events record
these IDs without prompt contents, credentials, QR data, or raw stderr.

The internal latency record has these timestamps:

```text
messageReceivedAt
routingCompletedAt
queueEnteredAt
executionAcceptedAt
executionStartedAt
providerStartedAt
firstProviderOutputAt
firstTransportReplyAt
executionCompletedAt
finalReplyAt
```

Derived latency fields are computed from present timestamps only. `/status`,
`/running`, or an equivalent diagnostics response exposes safe counts,
provider availability/capabilities, active sessions, queue depth, and current
execution timings.

## Provider strategies

- Claude: cache executable discovery, request stream JSON when supported,
  translate deltas/messages, and resume the stored native session ID.
- Codex: cache executable discovery, parse JSONL line-by-line as stdout
  arrives, translate agent-message deltas/completion, and resume the stored
  thread ID.
- Copilot: preserve fixed UUID session IDs and safe silent invocation; emit a
  completion-only event if equivalent streaming is unavailable.

Installed capability facts are recorded honestly: Codex CLI 0.154.0 is
available in the current environment; Claude and Copilot are unavailable and
cannot receive live CLI verification here.

## Security and failure handling

All existing allowlists, roles, workspace policy, argument-array process
execution, bounded output, and chatbot/developer boundaries remain mandatory.
Failures are categorized as provider unavailable/start-failed/timeout/
cancelled/invalid-output/session-lost, transport send-failed/disconnected,
queue-full/rate-limited, or workspace-rejected. User messages stay concise;
technical events contain only bounded safe metadata.

## Verification

Add deterministic unit tests for normalized reply references, WhatsApp quoting
and eviction/fallback, stream parsing and delivery-before-completion, session
reuse/switch/reset/close, queue serialization/parallelism/overflow,
cancellation, shutdown, metrics, crash recovery, provider capability caching,
and architecture boundaries. Add an integration test covering:

```text
incoming Message -> ControlPlane -> session -> stream delta -> correlated send
```

The integration assertion must prove the first outbound content occurs before
the provider promise completes and the final outbound message references the
incoming message. Run build, the complete test suite, doctor, boundary scans,
Graphify refresh, and the real WhatsApp/provider scenario when credentials and
executables exist. Report unavailable external checks as `UNVERIFIED`.

