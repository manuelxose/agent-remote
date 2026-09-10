# agent-remote architecture design

## Goal

Provide a local, configuration-driven messaging and agent orchestration foundation for controlling Claude Code, Codex CLI, and GitHub Copilot CLI from separate WhatsApp conversations. The design must keep channel transport independent from agent products and preserve a future path for customer-facing, multi-tenant chatbots.

## Chosen approach

Use a small TypeScript workspace monorepo with dependency direction enforced by package boundaries:

`channel -> gateway -> conversations -> routing -> runtime -> agent`

The core domain owns messages, conversations, routes, execution context, responses, and interfaces only. Adapters depend inward on those contracts. No framework, database, queue, or external paid backend is needed for V1.

## Runtime and trust boundaries

`developer-agent` is a trusted local runtime. It may expose shell, filesystem, and git capabilities, but only through an injected capability object restricted to approved workspace roots. Claude, Codex, and Copilot adapters implement the same `ConversationAgent` contract and know nothing about WhatsApp.

`chatbot` is an untrusted/customer-facing runtime. It receives only an explicitly allowlisted `ToolRegistry`; it has no shell, arbitrary filesystem, git, or developer-agent adapter dependency. Tenant identity is part of route/context metadata now so a future Talkaris route can be added without changing channel or core contracts.

The type-level boundary is reinforced by separate packages: chatbot-runtime imports core/tools contracts, while developer-runtime imports core/developer capability contracts. The chatbot runtime constructor accepts only allowlisted tools and rejects developer capabilities at runtime as defense in depth.

## Message flow

1. A `Channel` translates a transport payload into a domain `Message` and submits it to the gateway.
2. The conversation service loads or creates a `Conversation` and produces `ConversationContext`.
3. The `Router` resolves a config route by channel/conversation key.
4. The selected `AgentRuntime` validates the route type and invokes the registered `ConversationAgent`.
5. The runtime emits execution/tool/approval events and returns an `AgentResponse`.
6. The gateway asks the originating `Channel` to send the response.

WhatsApp code stops at translation and delivery. It does not import agent adapters, runtimes, or Talkaris.

## Extension points

- `Channel`: Telegram or Web Chat add a transport adapter and channel registration only.
- `ConversationAgent`: future Talkaris business logic can be registered as `talkaris` in chatbot runtime without changing WhatsApp or core.
- `AgentRuntime`: additional isolated runtime policies can be added behind the interface.
- `EventBus`: the V1 in-memory implementation can later be replaced by Redis Streams, NATS, or Kafka.
- `ToolRegistry`: chatbot tools remain explicit and allowlisted per tenant/route.

## Error handling and events

Routing rejects missing or mismatched routes before execution. Runtime failures emit `AgentExecutionFailed` and return an error response suitable for the channel. Events use a stable envelope with event name, timestamp, and correlation identifiers. Event delivery is in-memory and awaited in V1.

## V1 scope exclusions

No WhatsApp provider integration, CLI process execution, Talkaris business logic, persistence, distributed event broker, multi-tenant orchestration, or customer-facing chatbot behavior is implemented here. The adapters are placeholders proving the seams and security boundary.

## Verification

- TypeScript compilation covers every workspace.
- Router unit tests cover developer routes, chatbot/tenant routes, and unknown routes.
- Runtime tests prove a chatbot receives no developer shell capability and cannot invoke one.
- Boundary checks ensure core has no WhatsApp imports and WhatsApp has no agent-product imports.
