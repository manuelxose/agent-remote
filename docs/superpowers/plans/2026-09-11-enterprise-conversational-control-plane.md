# Enterprise Conversational Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current WhatsApp-only one-number command path into a durable, channel-neutral conversational control plane for Claude, Codex, and future agents.

**Architecture:** Add a `packages/control-plane` package that owns command metadata, authorization, managed-session state, persistence, idempotency, queueing, cancellation, and channel-neutral results. Keep `apps/gateway/src/application.ts` as a composition root, keep WhatsApp as transport/rendering, and preserve the existing developer runtime/provider session boundary.

**Tech Stack:** TypeScript `NodeNext`, Node standard-library JSON persistence and child-process APIs, existing Baileys adapter, existing Node test runner, existing fake adapters/runners.

**Spec:** `docs/superpowers/specs/2026-09-11-enterprise-conversational-control-plane-design.md`

## Global Constraints

- No database server is required for the local MVP.
- No command/control package may import Baileys or WhatsApp implementations.
- No provider process may spawn before authorization, initialization, agent, model, and workspace checks succeed.
- No arbitrary shell command or untrusted provider model argument may be exposed.
- Existing developer-agent and chatbot capability boundaries remain enforced.
- Existing tests and provider/WhatsApp smoke coverage must not be reduced.
- Durable writes use a versioned format, serialized atomic temp-file/rename writes, and fail-closed corruption handling.
- Non-trivial logic leaves a focused runnable test.

## File Map

- Create `packages/control-plane/src/index.ts`: channel-neutral command definitions, parser, managed-session types, state machine, authorization policy, dispatcher, queue, and result types.
- Create `packages/control-plane/src/persistence.ts`: repository interfaces, in-memory fakes, and versioned atomic JSON implementation.
- Modify `packages/core/src/index.ts`: extend neutral response/execution contracts without adding channel dependencies.
- Modify `packages/conversations/src/index.ts`: preserve transport conversation support and add durable managed-conversation repository types/adapters where shared contracts belong.
- Modify `runtime/developer-agent/src/contracts.ts` and `index.ts`: explicit model/cancellation/session-binding seams with backward-compatible runtime behavior.
- Modify `developer-agents/claude/src/index.ts` and `codex/src/index.ts`: pass validated configured models through fixed argv options.
- Modify `apps/gateway/src/application.ts`, `apps/gateway/src/whatsapp.ts`, and `apps/gateway/src/doctor.ts`: compose and report the control plane; remove transitional command logic.
- Modify `channels/whatsapp/src/lifecycle.ts` only if needed for response rendering/chunking or lifecycle intake control; do not add command semantics.
- Create focused `test/control-plane.test.ts`, `test/control-plane-persistence.test.ts`, and extend existing runtime/adapter/operational/boundary tests.
- Modify `README.md`, `docs/architecture.md`, `docs/whatsapp.md`, `.env.example`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, and `.planning/STATE.md`.
- Create `.planning/phases/05-enterprise-conversational-control-plane/05-01-PLAN.md` and `VERIFICATION.md`.

### Task 1: Neutral Contracts and Durable Managed Conversation State

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/conversations/src/index.ts`
- Create: `packages/control-plane/src/persistence.ts`
- Create: `test/control-plane-persistence.test.ts`

**Interfaces:**
- Produce `ManagedConversation`, `ConversationState`, `ConversationRepository`, `ProviderSessionRepository`, `IdempotencyRepository`, and `JsonControlPlaneStore`.
- `ConversationRepository` exposes `get(id)`, `findByExternal(channel, externalConversationId)`, `listByOwner(ownerId)`, `save(conversation)`, and `delete(id)`.
- `ProviderSessionRepository` exposes `get(logicalSessionId, agent, workspace)`, `set(...)`, and `list(logicalSessionId)`.
- `IdempotencyRepository` exposes `has(messageId)`, `record(messageId, metadata)`, and bounded pruning.
- `JsonControlPlaneStore` accepts a file path, loads lazily, validates `{version, conversations, providerSessions, idempotency}`, and writes atomically.

- [ ] **Step 1: Write failing persistence tests** for creation/listing by owner, restart restoration, atomic replacement, independent provider bindings, idempotent duplicate records, and malformed JSON rejection.
- [ ] **Step 2: Run the focused persistence test** with `npm run build && node --test --experimental-strip-types test/control-plane-persistence.test.ts`; confirm the new interfaces/behavior fail.
- [ ] **Step 3: Implement the smallest typed state model** and JSON store using `mkdir`, same-directory `${path}.tmp`, `writeFile`, and `rename`; validate version and every record before mutating in-memory state.
- [ ] **Step 4: Run the focused persistence test** and confirm PASS, including a second store instance restoring the first instance’s state.
- [ ] **Step 5: Run `npm run build`** and fix only type errors introduced by this task.
- [ ] **Step 6: Commit** with `git add packages/core packages/conversations packages/control-plane test/control-plane-persistence.test.ts && git commit -m "feat: add durable control-plane state"`.

### Task 2: Registry, State Machine, Authorization, and Dispatcher

**Files:**
- Create: `packages/control-plane/src/index.ts`
- Create: `test/control-plane.test.ts`
- Modify: `packages/events/src/index.ts` if the existing event union needs neutral lifecycle names.

**Interfaces:**
- `CommandResult = { text: string; status?: "success" | "warning" | "error"; metadata?: Record<string,string>; actions?: CommandAction[] }`.
- `CommandContext` contains `message`, `identity`, `session`, repositories, runtime registry, workspace/model policies, `send`, and `signal`.
- `CommandDefinition` contains `name`, `aliases`, `description`, `usage`, `category`, `requiresInitialization`, `requiredRole`, `states`, and `execute(context,args)`.
- `CommandRegistry` exposes `register`, `get`, `parse`, `help`, and `definitions`.
- `ControlPlane.handle(message, identity): Promise<CommandResult>` classifies slash commands versus ordinary text and returns a neutral result.

- [ ] **Step 1: Write failing tests** for registry-generated `/help`, `/help claude`, unknown/malformed commands, pre-init allowlist, `/init [name]`, READY_NO_AGENT ordinary text, agent selection, `/agent`, `/status`, `/whoami`, `/chats`, `/chat`, `/rename`, `/close`, `/reset`, `/history`, `/health`, `/version`, and role denial.
- [ ] **Step 2: Add tests** for explicit state transitions, owner-scoped chat listing/selection, approved workspace aliases, model aliases, and events named for command receipt/completion/rejection and state changes.
- [ ] **Step 3: Run the focused test** and confirm it fails before implementation.
- [ ] **Step 4: Implement parser and registry metadata** with one source of truth for help text; parse the first whitespace-delimited token case-insensitively, preserve the remainder as args, reject unknown slash commands, and never forward them to a runtime.
- [ ] **Step 5: Implement centralized state/authorization checks** so pre-init commands are exactly `/help`, `/init`, `/status`, `/whoami`; ordinary text before init requests `/init`; initialized sessions without an active agent request `/claude`, `/codex`, or `/copilot`.
- [ ] **Step 6: Implement session commands** against the repository, including owner-safe `/chat` selection and close-without-delete semantics.
- [ ] **Step 7: Implement neutral help/status/history/system output** without raw stderr, secrets, or channel-specific formatting.
- [ ] **Step 8: Run the focused test** and confirm PASS.
- [ ] **Step 9: Run `npm run build && npm test`** to detect compatibility regressions before integration.
- [ ] **Step 10: Commit** with `git add packages/control-plane packages/events test/control-plane.test.ts && git commit -m "feat: add channel-neutral command control plane"`.

### Task 3: Execution Queue, Idempotency, Cancellation, Models, and Runtime Seams

**Files:**
- Modify: `packages/control-plane/src/index.ts`
- Modify: `runtime/developer-agent/src/contracts.ts`
- Modify: `runtime/developer-agent/src/index.ts`
- Modify: `developer-agents/claude/src/index.ts`
- Modify: `developer-agents/codex/src/index.ts`
- Extend: `test/developer-agent-runtime.test.ts`, `test/developer-agent-process.test.ts`, `test/adapters.test.ts`, `test/control-plane.test.ts`

**Interfaces:**
- `ExecutionQueue` is keyed by `logicalSessionId`, has configurable `maxDepth`, reports `{position, active}`, and accepts `run(task, signal)`.
- `ControlPlane.cancel(logicalSessionId): Promise<CommandResult>` aborts the active task and waits for the runtime result.
- `ModelPolicy.resolve(agent, alias)` returns `{alias, providerModel}` or a deterministic unavailable error.
- `DeveloperAgentRequest` gains `model?: string`; adapters receive only resolved provider model values.
- Runtime/provider binding updates return native session IDs without exposing them in normal user output.

- [ ] **Step 1: Write failing tests** for concurrent different-session execution, sequential same-session execution, queue positions/overflow, duplicate message suppression, cancellation that reaches the fake runner signal, and cancellation isolation between sessions.
- [ ] **Step 2: Write failing adapter tests** asserting Claude and Codex receive explicit model argv options and no model fallback occurs when policy validation fails.
- [ ] **Step 3: Run focused runtime/adapter/control-plane tests** and confirm failure.
- [ ] **Step 4: Implement the per-logical-session queue** with a bounded pending array, active controller, completion cleanup, and deterministic queue acknowledgements; do not add a second process queue.
- [ ] **Step 5: Connect `AbortSignal` through the existing runtime runner** and make `/cancel` wait for the actual termination result.
- [ ] **Step 6: Implement configured alias resolution**; require configured underlying IDs, allow only configured aliases, and make unavailable/invalid models return actionable errors.
- [ ] **Step 7: Add Claude/Codex fixed argv model options** using the already-validated value while preserving typed prompt boundaries and resume semantics.
- [ ] **Step 8: Run focused tests, `npm run build`, and `npm test`; fix regressions caused by the new request field or queue behavior.
- [ ] **Step 9: Commit** with `git add packages/control-plane runtime/developer-agent developer-agents test && git commit -m "feat: add isolated execution control and model policy"`.

### Task 4: Composition Root and WhatsApp Adapter Integration

**Files:**
- Modify: `apps/gateway/src/application.ts`
- Modify: `apps/gateway/src/whatsapp.ts`
- Modify: `apps/gateway/src/doctor.ts`
- Modify: `apps/gateway/src/main.ts` if shutdown/intake wiring requires it.
- Modify: `channels/whatsapp/src/lifecycle.ts` only for neutral response chunking/intake stop support.
- Extend: `test/operational.test.ts`, `test/whatsapp-gateway.test.ts`, `test/whatsapp-channel.test.ts`, `test/boundaries.test.ts`

**Interfaces:**
- The WhatsApp callback translates payload to core `Message`, invokes `ControlPlane.handle`, and sends the returned neutral result.
- `createApplication` wires durable control-plane state, role/model/workspace policy, existing router/runtime/adapters, and the WhatsApp channel.
- `AgentRemoteApplication` exposes `start`, `stop`, control-plane health, and runtime diagnostics without exposing command internals through WhatsApp.

- [ ] **Step 1: Add failing integration/boundary tests** proving `/init` persists, pre-init ordinary messages do not call the runtime, `/claude` selects, following text uses Claude, `/codex` switches, following text uses Codex, and switching back resumes Claude’s binding.
- [ ] **Step 2: Add tests** proving unauthorized messages are rejected before control-plane dispatch, unknown commands do not reach providers, and WhatsApp source files contain no command/product imports.
- [ ] **Step 3: Refactor application composition** to remove `initializedConversations`, `parseOneNumberCommand`, `oneNumberCommandAction`, and inline command responses; create one control plane and inject it into the channel callback.
- [ ] **Step 4: Preserve route compatibility** for existing configured conversations while making managed sessions the source of active agent/workspace state; ensure route failures remain safe diagnostics.
- [ ] **Step 5: Add config parsing** for control-plane persistence path, queue depth, role mappings, model aliases/IDs, and response limits with startup validation.
- [ ] **Step 6: Extend doctor** with Gateway, WhatsApp, persistence/conversation store, provider executable/model, workspace roots, session store, Graphify, and configuration checks; unavailable providers are not PASS.
- [ ] **Step 7: Implement graceful intake stop/drain/abort** through the application lifecycle and safe channel-size response chunking.
- [ ] **Step 8: Run focused integration tests, `npm run build`, and `npm test`; fix all implementation-caused failures.
- [ ] **Step 9: Commit** with `git add apps channels packages runtime developer-agents test && git commit -m "feat: compose control plane into gateway"`.

### Task 5: Documentation, GSD Artifacts, Graphify, and Complete Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/whatsapp.md`
- Modify: `.env.example`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/STATE.md`
- Create: `.planning/phases/05-enterprise-conversational-control-plane/05-01-PLAN.md`
- Create: `.planning/phases/05-enterprise-conversational-control-plane/VERIFICATION.md`

- [ ] **Step 1: Document** every command, state, role, model alias configuration, workspace restrictions, persistence/restart behavior, queue/cancel semantics, safe output, and how a future channel calls the same control plane.
- [ ] **Step 2: Update GSD requirements/roadmap/state** with Phase 5 scope, completed plan, verification totals, environmental `UNVERIFIED` items, and next phase status.
- [ ] **Step 3: Run `npm run build`** and record the exact result.
- [ ] **Step 4: Run `npm test`** and record pass/fail/skip totals; fix unexpected failures before proceeding.
- [ ] **Step 5: Run `npm run doctor`** using the local configuration and record each PASS/WARN/FAIL truthfully.
- [ ] **Step 6: Run `graphify update .`** from the repository root and verify the refreshed graph exists; inspect boundaries with focused Graphify queries.
- [ ] **Step 7: Execute the real WhatsApp/provider scenario** from the spec where credentials and CLIs are available, including restart and a second independent conversation; record unavailable environmental dependencies as `UNVERIFIED`.
- [ ] **Step 8: Inspect `git diff --check`, boundary imports, and the final diff** for duplicate command systems, secret leakage, unsafe path/model handling, and accidental unrelated changes.
- [ ] **Step 9: Commit** documentation and GSD artifacts with `git add README.md docs .env.example .planning && git commit -m "docs: record Phase 5 control plane"`.

## Coverage Check

- Architectural separation: Tasks 2 and 4.
- First-contact restriction and authorization: Task 2 plus Task 4 integration tests.
- Registry-generated help and all command domains: Task 2.
- Multiple chats, state machine, restart/corruption persistence: Tasks 1 and 2.
- Agent switching/session continuity: Tasks 3 and 4.
- Explicit model policy: Tasks 3 and 4.
- Queue/cancellation/idempotency: Task 3.
- Workspace security/roles: Tasks 2–4.
- Events/observability/health/doctor/shutdown/chunking: Tasks 2, 3, and 4.
- Telegram/Talkaris readiness and chatbot isolation: Tasks 2 and 4 boundary tests.
- Documentation/GSD/Graphify/real acceptance: Task 5.

