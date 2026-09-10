# agent-remote Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compiling TypeScript workspace that proves channel-neutral routing into isolated developer-agent and chatbot runtimes.

**Architecture:** Keep domain contracts in `packages/core`; route configuration and event delivery sit behind small interfaces; runtime packages own capabilities and invoke registered agents. WhatsApp and product adapters are thin composition seams and never depend on each other.

**Tech Stack:** TypeScript, Node.js built-ins, npm workspaces, Node test runner, YAML-like JSON configuration (no runtime framework or new dependency).

**Spec:** `docs/superpowers/specs/2026-09-10-agent-remote-design.md`

## Global Constraints

- Keep core free of WhatsApp, Claude, Codex, Copilot, and Talkaris imports.
- Keep chatbot runtime free of shell, filesystem, git, and developer-agent adapters.
- Restrict developer capabilities to approved workspace roots.
- Use an in-memory event bus behind an interface.
- Do not implement provider transport, CLI spawning, persistence, or Talkaris business logic.
- Leave one runnable check for non-trivial logic.

---

### Task 1: TypeScript workspace and core contracts

**Files:**
- Create: `package.json`, `tsconfig.json`, `packages/*/package.json` and package `tsconfig.json` files.
- Create: `packages/core/src/index.ts`.
- Test: `packages/core/src/core.test.ts`.

**Interfaces:**
- Produce `Message`, `Conversation`, `ConversationContext`, `AgentResponse`, `ConversationAgent`, `AgentRuntime`, `Channel`, `Route`, `ExecutionContext`, `RuntimeType`, and `AgentType` exports.

- [ ] Write the failing compile/test contract using `node:test` and a minimal agent/context object.
- [ ] Run `npm test --workspace @agent-remote/core`; expect failure before implementation.
- [ ] Implement the contracts and package build configuration with no external dependencies.
- [ ] Run the focused test and `npm run build`; expect pass.
- [ ] Commit `feat: add core orchestration contracts`.

### Task 2: Router, configuration, and event bus

**Files:**
- Create: `packages/routing/src/index.ts`, `packages/routing/src/router.test.ts`.
- Create: `packages/events/src/index.ts`, `packages/events/src/events.test.ts`.
- Create: `config/routes.json`.

**Interfaces:**
- `RouteResolver.resolve(channel: string, conversationId: string): Route`.
- `ConfigurationRouter(routes: Record<string, Route>)` resolves `channel-conversationId` and throws `RouteNotFoundError` for missing routes.
- `EventBus.publish(event: DomainEvent): Promise<void>` and `subscribe(type, handler): () => void`.

- [ ] Write tests for Claude/Codex/Copilot WhatsApp mappings, future Talkaris tenant mapping, unknown route, and all required event names.
- [ ] Run focused routing/events tests; expect failure.
- [ ] Implement lookup and validation with immutable event envelopes and awaited in-memory handlers.
- [ ] Run focused tests and build; expect pass.
- [ ] Commit `feat: add configuration routing and events`.

### Task 3: Security capabilities and separated runtimes

**Files:**
- Create: `packages/security/src/index.ts`.
- Create: `runtime/developer-agent/src/index.ts`, `runtime/developer-agent/src/runtime.test.ts`.
- Create: `runtime/chatbot/src/index.ts`, `runtime/chatbot/src/runtime.test.ts`.
- Create: `packages/tools/src/index.ts`.

**Interfaces:**
- `DeveloperCapabilities` exposes `shell`, `readFile`, `writeFile`, and `git` only through approved workspace roots.
- `ToolRegistry` exposes `has(name)` and `invoke(name, input)` for explicitly allowlisted chatbot tools.
- `DeveloperAgentRuntime` accepts developer capabilities and agent registry.
- `ChatbotRuntime` accepts only `ToolRegistry` and agent registry; it must reject developer capability-shaped values and never import developer runtime.

- [ ] Write a chatbot test that executes an allowlisted tool and verifies shell is unavailable; write a developer test for root restriction.
- [ ] Run focused runtime tests; expect failure.
- [ ] Implement minimal runtime dispatch, event emission, and capability enforcement.
- [ ] Run focused tests and build; expect pass.
- [ ] Commit `feat: enforce runtime capability boundaries`.

### Task 4: Channel and agent adapter seams

**Files:**
- Create: `channels/whatsapp/src/index.ts`, `channels/whatsapp/src/whatsapp.test.ts`.
- Create: `developer-agents/claude/src/index.ts`, `developer-agents/codex/src/index.ts`, `developer-agents/copilot/src/index.ts`.
- Create: `integrations/talkaris/src/index.ts`.
- Create: `apps/gateway/src/index.ts`, `apps/worker/src/index.ts`.

**Interfaces:**
- `WhatsAppChannel` implements `Channel` and maps transport payloads to `Message`/`AgentResponse` without product imports.
- Each developer adapter implements `ConversationAgent` and returns a placeholder response.
- `TalkarisAgent` implements `ConversationAgent` but returns an explicit not-configured response and contains no business logic.

- [ ] Write adapter tests for channel-neutral translation and placeholder registration.
- [ ] Run focused adapter tests; expect failure.
- [ ] Implement only translation/registration seams and a composition-root example of the full flow.
- [ ] Run focused tests and build; expect pass.
- [ ] Commit `feat: add channel and agent adapter seams`.

### Task 5: Documentation and boundary verification

**Files:**
- Modify: `docs/architecture.md` if implementation names differ from the design.
- Create: `test/boundaries.test.ts`.
- Modify: `.planning/STATE.md` and `.planning/ROADMAP.md` with verified Phase 1 status.

- [ ] Add static tests that core source has no forbidden channel/product imports and WhatsApp source has no product imports.
- [ ] Run full `npm test` and `npm run build`; fix implementation-caused failures.
- [ ] Run `graphify update .` after material code changes.
- [ ] Update GSD state with verification evidence.
- [ ] Commit `test: verify architecture boundaries`.
