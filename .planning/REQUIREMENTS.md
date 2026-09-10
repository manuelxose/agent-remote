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
