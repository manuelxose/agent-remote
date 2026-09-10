# Roadmap

## Phase 1: Architectural foundation

Build the minimal TypeScript workspace, domain contracts, configuration router, event abstraction, separated runtimes, placeholder adapters, tests, and architecture documentation.

Requirements: CORE-01, CORE-02, CORE-03, ROUTE-01, ROUTE-02, EVENT-01, SEC-01, SEC-02, SEC-03, ADAPTER-01, ADAPTER-02, DOC-01, TEST-01.

Success criteria:

1. `npm test` and `npm run build` pass.
2. Route tests demonstrate WhatsApp conversation mappings and a future tenant route.
3. Chatbot runtime tests demonstrate developer shell capabilities are unavailable.
4. Static boundary checks find no WhatsApp dependency in core and no product-specific logic in WhatsApp.
5. Architecture docs explain future Talkaris, Telegram, and Web Chat extension points.
