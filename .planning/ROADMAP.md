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

## Phase 3: Developer-agent runtime — Complete

Implement the trusted local Claude, Codex, and Copilot adapter runtime with direct argv-only process execution, approved workspace enforcement, bounded output and lifecycle diagnostics, isolated persistent sessions, gateway integration, and truthful availability reporting.

Requirements: SEC-01, SEC-02, ADAPTER-02, DOC-01, TEST-01.

Success criteria:

1. Each installed developer CLI is invoked through its real adapter; unavailable CLIs are skipped with structured executable diagnostics and no installation attempt.
2. Conversation and workspace session mappings remain isolated and survive runtime restart.
3. Workspace roots reject outside paths before process spawn, and WhatsApp input cannot supply arbitrary commands or executables.
4. Timeout, cancellation, output caps, stderr, exit code, and lifecycle events remain observable through safe runtime failures.
5. Successful adapter output reaches the existing gateway/channel response pipeline while chatbot remains unable to import developer adapters.

Verification: `npm run build` passes; `npm test` reports 77 tests, 75 passing, 0 failing, and 2 skipped (Claude/Copilot unavailable); `graphify update .` refreshed 471 nodes and 671 edges. The installed Codex smoke invocation reached the real CLI and timed out at the configured 10-second bound; the smoke test reports this without requiring external credentials for the full suite.
