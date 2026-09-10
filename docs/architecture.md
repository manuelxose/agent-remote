# agent-remote architecture

## System shape

```text
Messaging Channel -> Conversation Core -> Router -> Agent Runtime -> Agent
        ^                                                        |
        +---------------- Channel response ---------------------+
```

The local process hosts the gateway, worker, in-memory event bus, routing configuration, and registered adapters. Channels translate transport concerns; the core owns conversation semantics; runtimes enforce trust policies; agents integrate with developer CLIs or future chatbot behavior.

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

The developer-agent runtime can use shell, filesystem, and git, but capabilities are injected and every explicit working-directory/file path is checked against approved workspace roots. The actual local shell executor remains an injected trusted implementation; CLI process execution is deliberately out of V1. The Claude, Codex, and Copilot adapters are intentionally thin placeholders: they implement the agent seam without coupling WhatsApp to a CLI product.

### Untrusted chatbot zone

The chatbot runtime receives only a `ToolRegistry` containing explicit allowlisted tools. It has no shell, arbitrary filesystem, git, or developer-agent adapters. The constructor rejects a registry that exposes developer capabilities, and the package has no import path to those adapters.

## Routing

Routes are keyed by a stable channel conversation key, for example `whatsapp-group-claude`, and contain `runtime`, `agent`, and optional `tenant`. The route resolver validates the configuration at lookup time. This supports V1 one-conversation-per-agent mappings and future `talkaris-support` tenant routes without changing channel code.

## Events

`EventBus` is the broker abstraction. V1 uses `InMemoryEventBus`; its contract is suitable for a later Redis Streams, NATS, or Kafka implementation. Events include `MessageReceived`, `RouteResolved`, `AgentExecutionStarted`, `ToolExecutionRequested`, `ApprovalRequested`, `AgentExecutionCompleted`, `AgentExecutionFailed`, and `MessageSent`. Placeholder adapters do not synthesize tool or approval events yet; concrete adapters will publish those through the same bus.

## Future extensions

Talkaris plugs in by implementing `ConversationAgent` in `integrations/talkaris`, registering it with the chatbot runtime, and adding a route with `runtime: chatbot`, `agent: talkaris`, and `tenant: talkaris`. Neither the WhatsApp adapter nor core changes.

Telegram or Web Chat plugs in by implementing `Channel` in a separate channel package and registering a channel key. The conversation, router, runtimes, and agents remain unchanged.

## Intentionally not implemented

Provider credentials, WhatsApp transport SDKs, CLI process spawning, persistent storage, distributed events, Talkaris business logic, and multi-tenant scheduling are deferred until their concrete requirements exist.
