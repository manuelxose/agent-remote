# Roadmap

## Phase 1: Architectural foundation — Complete

Build the minimal TypeScript workspace, domain contracts, configuration router, event abstraction, separated runtimes, placeholder adapters, tests, and architecture documentation.

Requirements: CORE-01, CORE-02, CORE-03, ROUTE-01, ROUTE-02, EVENT-01, SEC-01, SEC-02, SEC-03, ADAPTER-01, ADAPTER-02, DOC-01, TEST-01.

Success criteria:

1. `npm test` and `npm run build` pass.
2. Route tests demonstrate WhatsApp conversation mappings and a future tenant route.
3. Chatbot runtime tests demonstrate developer shell capabilities are unavailable.
4. Static boundary checks find no WhatsApp dependency in core and no product-specific logic in WhatsApp.
5. Architecture docs explain future Talkaris, Telegram, and Web Chat extension points.

Verification: 18 tests passing; TypeScript build passing; Graphify refreshed.

## Phase 2: Local WhatsApp channel adapter — Complete

Implement the local Baileys transport boundary with persisted authentication, restart-compatible reconnect, allowlist enforcement, channel-neutral message translation, gateway routing, response delivery, lifecycle health, and operational documentation.

Requirements: WHATSAPP-01, WHATSAPP-02, WHATSAPP-03, WHATSAPP-04, WHATSAPP-05, WHATSAPP-06.

Success criteria:

1. Baileys authentication state persists locally and is reloaded after restart.
2. Incoming authorized messages become core `Message` values with sender, chat, group, text, timestamp, and attachment metadata.
3. Unauthorized messages are rejected and logged before gateway routing.
4. Gateway execution sends a mock response to the originating WhatsApp conversation.
5. QR, reconnect, shutdown, and health behavior are exposed without logging authentication secrets.
6. Every WhatsApp source file remains free of agent/product-specific imports.
