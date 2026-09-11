# Requirements: agent-remote foundation

## Core

- CORE-01: Define channel-neutral contracts for messages, conversations, context, routes, execution, agents, runtimes, responses, and channels.
- CORE-02: Support the execution flow `conversation -> route -> runtime -> agent -> response`.
- CORE-03: Keep core free of WhatsApp and agent-product dependencies.

## Routing and events

- ROUTE-01: Resolve routes from configuration by channel conversation key.
- ROUTE-02: Support runtime/agent/tenant fields for developer and future chatbot routes.
- EVENT-01: Define and publish the required internal event types behind an EventBus abstraction.

## Security

- SEC-01: Developer runtime may use approved local capabilities restricted to workspace roots.
- SEC-02: Chatbot runtime cannot invoke shell, arbitrary filesystem, git, or developer-agent adapters.
- SEC-03: Chatbot tools are explicitly allowlisted.

## Adapters and docs

- ADAPTER-01: WhatsApp adapter only translates channel messages and knows no agent products.
- ADAPTER-02: Claude, Codex, Copilot, and Talkaris seams are independently registerable.
- DOC-01: Document boundaries, dependency directions, trust zones, and extension paths.
- TEST-01: Compile the project and test route resolution plus chatbot capability isolation.

## WhatsApp channel adapter

- WHATSAPP-01: Connect locally through Baileys with QR/pairing startup flow.
- WHATSAPP-02: Persist and restore WhatsApp authentication state across process restarts.
- WHATSAPP-03: Translate authorized inbound messages into the core `Message` model, including sender, conversation, group, text, timestamp, and basic attachment metadata.
- WHATSAPP-04: Reject and log unauthorized senders/chats before routing using validated allowlist configuration.
- WHATSAPP-05: Route inbound messages through the gateway and deliver `AgentResponse` to the originating conversation.
- WHATSAPP-06: Expose reconnect, graceful shutdown, structured logging, and sanitized health state without agent-specific code in the WhatsApp package.

## Enterprise conversational control plane

- CTRL-01: Commands are defined in a central channel-neutral registry and return channel-neutral results.
- CTRL-02: Initialization, authorization, state transitions, unknown-command rejection, and help generation occur before provider execution.
- CTRL-03: Control-plane packages do not import WhatsApp/Baileys and preserve the chatbot/developer capability boundary.
- SESSION-01: Multiple owner-scoped logical chats support init, list, select, rename, close, reset, and restart persistence.
- SESSION-02: Provider bindings remain isolated by logical chat, agent, and approved workspace; closing a chat does not delete unrelated sessions.
- EXEC-01: Each logical chat has a bounded sequential queue, while different chats may execute concurrently.
- EXEC-02: Cancellation uses the existing AbortSignal/process termination path; duplicate message IDs are idempotently ignored.
- MODEL-01: Claude Sonnet and Codex Luna aliases resolve only to explicitly configured and validated provider model identifiers.
- SECURITY-04: Owner/operator/viewer policies, configured workspace aliases, approved-root enforcement, and no arbitrary shell/model arguments are applied.
- OPS-01: Atomic persistence, corruption diagnostics, structured lifecycle events, safe output, graceful shutdown, and doctor/health checks are exposed.
- TEST-02: Fake-provider unit/integration tests cover state, persistence, queues, cancellation, idempotency, authorization, model/workspace policy, and cross-channel boundaries.
- DOC-02: Commands, configuration, restart behavior, security boundaries, future channel reuse, and Phase 5 verification are documented.
