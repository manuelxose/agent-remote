# agent-remote architecture

## System shape

```text
Messaging Channel -> Conversation Core -> Router -> Agent Runtime -> Agent
        ^                                                        |
        +---------------- Channel response ---------------------+
```

The local process hosts the gateway, worker, in-memory event bus, routing configuration, and registered adapters. Channels translate transport concerns; the core owns conversation semantics; runtimes enforce trust policies; agents integrate with local or future chatbot behavior.

## Package boundaries

```text
apps/gateway       composition root / message ingress and egress
apps/worker        composition root / event and execution worker
packages/core      domain contracts and errors
packages/conversations conversation lifecycle/context assembly
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

The in-memory conversation store keys state by `(channel, conversationId)`, so two channels can use the same provider-local ID without sharing state. The gateway fails with `GatewayConfigurationError` when a route names an unregistered runtime or agent.

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

Conversation session mappings use a collision-free JSON tuple of channel, conversation ID, adapter ID, and canonical approved workspace root. The default JSON path is `data/developer-agent-sessions.json`; trusted runtime setup may supply another store/path. Each value stores only the native session ID; agent and workspace identity remain in the lookup key. Agent or workspace changes therefore start a new native session, and same-session turns are serialized.

Unavailable CLIs produce structured `executable-missing` diagnostics without installation or fallback. Adapter, workspace, malformed-output, timeout, cancellation, non-zero-exit, output-limit, and execution failures remain stable runtime failure states and are surfaced as safe gateway responses.

### Untrusted chatbot zone

The chatbot runtime receives only a `ToolRegistry` containing explicit allowlisted tools. It has no shell, arbitrary filesystem, git, or developer-agent adapters. The constructor rejects a registry that exposes developer capabilities, and the package has no import path to those adapters.

The chatbot runtime remains unable to import developer adapters by design; WhatsApp/core/chatbot boundary tests enforce that separation.

## Routing

Routes are keyed by a stable channel conversation key, for example `whatsapp-group-claude`, and contain `runtime`, `agent`, and optional `tenant`. The route resolver validates the configuration at lookup time. This supports V1 one-conversation-per-agent mappings and future `talkaris-support` tenant routes without changing channel code.

## Events

`EventBus` is the broker abstraction. V1 uses `InMemoryEventBus`; its contract is suitable for a later Redis Streams, NATS, or Kafka implementation. Events include `MessageReceived`, `RouteResolved`, `AgentExecutionStarted`, `ToolExecutionRequested`, `ApprovalRequested`, `AgentExecutionCompleted`, `AgentExecutionFailed`, and `MessageSent`. Placeholder adapters do not synthesize tool or approval events yet; concrete adapters will publish those through the same bus.

## Future extensions

Talkaris plugs in by implementing `ConversationAgent` in `integrations/talkaris`, registering it with the chatbot runtime, and adding a route with `runtime: chatbot`, `agent: talkaris`, and `tenant: talkaris`. Neither the WhatsApp adapter nor core changes.

Telegram or Web Chat plugs in by implementing `Channel` in a separate channel package and registering a channel key. The conversation, router, runtimes, and agents remain unchanged.

## WhatsApp transport

The WhatsApp adapter uses Baileys behind a transport-only `WhatsAppChannel`. It owns local multi-file auth persistence, QR notification, reconnect and shutdown state, allowlist checks, message translation, response delivery, and a sanitized health snapshot. The gateway composition helper supplies `Gateway.handle` as the inbound callback and exposes the channel health object to the application.

## Intentionally not implemented

Production-grade credential storage, distributed events, long-lived interactive CLI processes, and multi-tenant scheduling are deferred until their concrete requirements exist. Developer-agent CLI execution and JSON session persistence are implemented as trusted local runtime capabilities. WhatsApp account authentication remains local to the configured auth directory.
