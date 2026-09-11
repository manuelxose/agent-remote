# agent-remote architecture

## System shape

```text
Messaging Channel -> Core Message -> Control Plane -> Agent Runtime -> Agent
        ^                         |                         |
        +------ neutral result --+---- durable state --------+
```

The local process hosts the gateway, worker, in-memory event bus, routing configuration, and registered adapters. Channels translate transport concerns; the core owns conversation semantics; runtimes enforce trust policies; agents integrate with local or future chatbot behavior.

## Package boundaries

```text
apps/gateway       composition root / message ingress and egress
apps/worker        composition root / event and execution worker
packages/core      domain contracts and errors
packages/conversations conversation lifecycle/context assembly
packages/control-plane command registry, state machine, policy, queue, persistence
packages/routing   configuration-driven route resolution
packages/events    event contracts and in-memory bus
packages/agents    agent registry and shared agent contracts
channels/whatsapp  WhatsApp transport adapter only
developer-agents/* Claude/Codex/Copilot adapter seams
runtime/developer-agent trusted local capabilities and runtime
runtime/chatbot    allowlisted-tool runtime with no shell access
security           workspace root validation and capability policy
observability      event/logger seams
integrations/talkaris future registration placeholder only
```

Imports point toward the domain. `packages/core` imports no channel, CLI, or chatbot code. `channels/whatsapp` depends on channel/core contracts only. Developer adapters are reachable only from the developer runtime composition root; chatbot runtime has no developer adapter imports.

Transport conversations and managed logical conversations are distinct. The control plane persists owner, external conversation, logical session, active agent, model alias, workspace, provider bindings, state, and idempotency. The legacy gateway still supports route-based adapter tests; the application composition root uses the control plane for conversational commands.

## Core contracts

The core defines `Message`, `Conversation`, `ConversationContext`, `AgentResponse`, `ConversationAgent`, `AgentRuntime`, `Channel`, `Route`, `ExecutionContext`, and the route/runtime/agent discriminated unions. These contracts carry channel-neutral IDs, metadata, tenant identity, and correlation IDs.

The canonical execution path is:

```text
message -> conversation context -> route -> runtime -> agent -> response
```

## Trust zones

### Trusted local developer zone

The developer-agent runtime can use shell, filesystem, git, and the configured developer-agent adapters. Capabilities are injected and every explicit working-directory/file path is checked against the trusted approved workspace roots configured by the composition root. The adapter registry is keyed by `claude`, `codex`, and `copilot`; the selected adapter resolves its executable from PATH and owns its fixed invocation and output parser.

Developer-agent process execution crosses the boundary through Node's direct child-process API with an executable and typed argv array. It never invokes a shell or turns WhatsApp text into a command string. The runner validates the working directory before spawn, captures bounded stdout/stderr, and reports exit code, signal, timeout, cancellation, output-limit, and lifecycle information.

Conversation session mappings use a collision-free JSON tuple of channel, logical conversation ID, adapter ID, and canonical approved workspace root. The default native-session path is `data/developer-agent-sessions.json`; managed control-plane state defaults to `data/control-plane.json`. Managed writes are versioned and atomic; malformed state fails closed.

Unavailable CLIs produce structured `executable-missing` diagnostics without installation or fallback. Adapter, workspace, malformed-output, timeout, cancellation, non-zero-exit, output-limit, and execution failures remain stable runtime failure states and are surfaced as safe gateway responses.

### Untrusted chatbot zone

The chatbot runtime receives only a `ToolRegistry` containing explicit allowlisted tools. It has no shell, arbitrary filesystem, git, or developer-agent adapters. The constructor rejects a registry that exposes developer capabilities, and the package has no import path to those adapters.

The chatbot runtime remains unable to import developer adapters by design; WhatsApp/core/chatbot boundary tests enforce that separation.

## Routing

Routes are keyed by a stable channel conversation key, for example `whatsapp-group-claude`, and contain `runtime`, `agent`, and optional `tenant`. The route resolver validates the configuration at lookup time. This supports V1 one-conversation-per-agent mappings and future `talkaris-support` tenant routes without changing channel code.

## Events

`EventBus` is the broker abstraction. V1 uses `InMemoryEventBus`; its contract is suitable for a later Redis Streams, NATS, or Kafka implementation. Events include `MessageReceived`, `RouteResolved`, `AgentExecutionStarted`, `ToolExecutionRequested`, `ApprovalRequested`, `AgentExecutionCompleted`, `AgentExecutionFailed`, and `MessageSent`, plus the normalized real-time execution events `execution.accepted`, `execution.started`, `provider.started`, `assistant.delta`, `assistant.message`, `tool.started`, `tool.progress`, `tool.completed`, `execution.completed`, `execution.failed`, and `execution.cancelled`. Provider-specific JSON remains inside its adapter.

## Future extensions

Talkaris plugs in by implementing `ConversationAgent` in `integrations/talkaris`, registering it with the chatbot runtime, and adding a route with `runtime: chatbot`, `agent: talkaris`, and `tenant: talkaris`. Neither the WhatsApp adapter nor core changes.

Telegram or Web Chat plugs in by implementing `Channel` in a separate channel package and registering a channel key. The conversation, router, runtimes, and agents remain unchanged.

## WhatsApp transport

The WhatsApp adapter uses Baileys behind a transport-only `WhatsAppChannel`. It owns local multi-file auth persistence, QR notification, reconnect and shutdown state, allowlist checks, message translation, response delivery, and a sanitized health snapshot. The gateway composition helper can supply the neutral control-plane callback; the adapter has no slash-command, managed-session, or provider-product logic.

## Control-plane state and policy

Commands are registered once with category, usage, initialization requirement, role, and description metadata. The registry generates `/help`, while the state machine enforces pre-init restrictions and explicit agent selection. Roles are `owner`, `operator`, and `viewer`; role mapping is configuration-driven.

Claude's `sonnet` and Codex's `luna` are product aliases. Their underlying model identifiers must be configured explicitly. Adapters receive only the resolved model value through fixed provider argv options. Workspaces resolve through configured aliases or the approved-root policy.

Each logical conversation has an independent bounded queue and abort controller. Duplicate inbound IDs are persisted and ignored. Control-plane lifecycle events include command, state, queue, execution, duplicate, and security events without secrets or provider stderr.

## Real-time execution

Phase 6 keeps three identities separate: the external transport conversation, the durable logical session, and the provider-native session ID. Inbound messages carry a neutral `replyReference`; command results and streamed outbound chunks carry `replyTo`, so a channel can provide native threading without leaking transport types into the runtime.

The developer runtime caches provider availability, supervises bounded logical sessions, serializes turns per logical session, and resumes each provider through its native session mechanism. It does not keep an interactive child process alive. Claude and Codex translate provider stream records into neutral `assistant.delta` and `assistant.message` events; Copilot remains completion-oriented behind the same session interface.

Streaming delivery is bounded by minimum characters, maximum flush interval, and maximum messages per execution. The control plane records safe execution timestamps and derived latency fields, while `/status`, `/running`, and `/doctor` expose provider, session, queue, and delivery-policy diagnostics without prompts, credentials, or raw provider stderr.

Shutdown stops admission, drains and cancels queued work, closes provider sessions, then stops WhatsApp. Provider cancellation is connected to the actual child-process `AbortSignal`.

## Intentionally not implemented

Production-grade credential storage, distributed events, long-lived interactive CLI processes, and multi-tenant scheduling are deferred until their concrete requirements exist. Developer-agent CLI execution and both native-session and managed-control-plane JSON persistence are implemented as trusted local runtime capabilities. WhatsApp account authentication remains local to the configured auth directory.

## Single-number presentation runtime

Agent Remote operates through exactly **one WhatsApp account**. The WhatsApp transport sender for a gateway-generated response is still the account itself (`fromMe: true`); it is not a second contact or a protocol-level participant. `MessageOrigin` is separate, transport-neutral metadata that names the logical participant (`agent`, its `agentId`, and the execution/logical-session identifiers when available). It gives the runtime and optional local presentation a stable meaning without attempting to change WhatsApp identity.

The control plane carries the inbound `replyTo` reference and `MessageOrigin` to the WhatsApp channel. After a successful send, the channel records the exact Baileys message ID, conversation ID, origin, original reply target, and creation time in its `AgentMessageRegistry`. The registry has a finite positive TTL and fixed capacity, prunes expired entries on access, evicts its oldest entry at capacity, and never matches text or retains prompts, provider payloads, credentials, or Baileys objects. Native quoting uses the original inbound message context when it is still available; otherwise delivery safely falls back to an ordinary send.

Provider streaming remains inside the developer runtime. WhatsApp uses composing presence after acceptance and paused presence on completion, failure, or cancellation; ordinary delivery emits one final correlated reply. A delayed progress reply is optional only when `AGENT_REMOTE_PROGRESS_AFTER_MS` is positive, and the configured message cap prevents unbounded output. Failure or cancellation sends no partial/final result through `StreamDelivery`; cancellation reaches the provider child process through its `AbortSignal`.

The presentation companion is not a transport feature. When explicitly enabled, the gateway exposes only the bounded sanitized registry snapshot on `127.0.0.1`; a local Web/Desktop content script can decorate exact matching message nodes. The bridge accepts only `GET /registry`, requires `Origin: https://web.whatsapp.com` and the private `x-agent-remote-token`, sends `Cache-Control: no-store`, and exposes no filesystem, provider, auth, prompt, response, or command operation. It is best-effort: unavailable bridge data or changed DOM leaves the real WhatsApp message untouched. Protocol-native agent-left rendering is impossible with one account, and the official mobile client cannot be augmented.
