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

Verification: `npm run build` passes; `npm test` reports 85 tests, 83 passed, 0 failed, and 2 skipped (Claude/Copilot unavailable); `graphify update .` refreshed 474 nodes and 677 edges. The installed Codex smoke invocation reached the real CLI and completed successfully within the configured 60-second bound.

## Phase 4: Operational Integration & Real WhatsApp Acceptance — Complete

Connect the existing runtime and Baileys channel through one executable composition root, configuration-backed route loading, operational doctor/start commands, safe unknown-route diagnostics, and real provider/WhatsApp acceptance.

Requirements: WHATSAPP-01, WHATSAPP-02, WHATSAPP-03, WHATSAPP-04, WHATSAPP-05, WHATSAPP-06, SEC-01, ADAPTER-02, DOC-01, TEST-01.

Success criteria:

1. `npm start` constructs the existing router, runtimes, adapters, persistent sessions, workspace policy, and WhatsApp lifecycle.
2. `npm run doctor` reports actionable PASS/WARN/FAIL checks and truthful CLI availability.
3. Routes and approved workspaces are loaded from ignored/local configuration without recompilation or hardcoded real IDs.
4. Unknown authorized conversations receive their ID and route-key guidance; runtime failures remain concise.
5. Automated composition/configuration/doctor/startup tests pass without reducing existing coverage.
6. Real WhatsApp pairing, provider E2E, and restart recovery are recorded with actual evidence; unavailable providers remain explicitly unavailable.

Plans:

- [x] 04-01-PLAN.md — composition root, operational CLI, configuration, tests, and acceptance procedure

## Phase 5: Enterprise Conversational Control Plane — Complete

Build a durable, channel-neutral command and session control plane for managed
Claude, Codex, and future agent conversations. Preserve the WhatsApp transport
boundary, developer/chatbot trust zones, approved workspace policy, native
provider sessions, and local database-free operation.

Requirements: CTRL-01, CTRL-02, CTRL-03, SESSION-01, SESSION-02, EXEC-01, EXEC-02, MODEL-01, SECURITY-04, OPS-01, TEST-02, DOC-02.

Success criteria:

1. Registry-generated help, pre-init restrictions, deterministic unknown-command handling, and explicit state transitions work through a channel-neutral dispatcher.
2. Multiple owner-scoped managed chats, active agents, workspaces, provider bindings, and idempotency state survive restart through atomic versioned JSON.
3. Per-chat queues, real AbortSignal cancellation, bounded overflow, agent switching, and Claude/Codex session continuity are tested with fake runtimes.
4. Configured model aliases pass explicit provider model options; workspace and role policy reject unsafe requests before provider spawn.
5. Application composition, doctor, docs, Graphify, full tests, and available real WhatsApp/provider acceptance are recorded.

Plans:

- [x] 05-01-PLAN.md — control-plane implementation, integration, documentation, and verification

Verification: `.planning/phases/05-enterprise-conversational-control-plane/VERIFICATION.md`.

## Phase 6: Real-Time Conversational Runtime — Complete

Evolve the Phase 5 control plane into a streaming, session-oriented runtime
with transport-neutral reply correlation, provider capability caching, bounded
delivery, explicit lifecycle supervision, latency telemetry, and native
WhatsApp quoted replies.

Requirements: REALTIME-01, REALTIME-02, REALTIME-03, SESSION-03, EXEC-03,
WHATSAPP-07, OPS-02, TEST-03, DOC-03.

Success criteria:

1. Inbound message references survive the control-plane/runtime path and are rendered as native WhatsApp quotes with bounded TTL/capacity fallback.
2. Claude/Codex adapters translate incremental provider output before process completion; Copilot remains compatible behind the same session boundary.
3. Provider discovery is cached, logical sessions are isolated/reused/reset/closed deliberately, same-session turns serialize, and cancellation reaches the actual process.
4. Streaming delivery is aggregated/bounded, presence is safe, latency timestamps/derived metrics and diagnostics are exposed, and shutdown closes sessions without orphan work.
5. Build, complete tests, benchmark evidence, documentation, Graphify, and truthful live-verification status are recorded.

Plans:

- [x] 06-01-PLAN.md — neutral contracts, streaming sessions, control-plane delivery, WhatsApp correlation, lifecycle, tests, docs, and verification

Verification: `.planning/phases/06-real-time-conversational-runtime/VERIFICATION.md`.

## Phase 7: Single-Number Presentation Runtime — Planned
Requirements: IDENTITY-01, IDENTITY-02, DELIVERY-01, PRESENTATION-01, PRESENTATION-02, SECURITY-05, OPS-02, TEST-03, DOC-03.
- [ ] 07-01-PLAN.md — structured message origins, bounded registry, final-only WhatsApp delivery, opt-in Web/Desktop companion, documentation, and live verification
Verification: `.planning/phases/07-single-number-presentation-runtime/VERIFICATION.md`.
