# Graph Report - phase-5-control-plane  (2026-09-11)

## Corpus Check
- 78 files · ~41,288 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 779 nodes · 1270 edges · 75 communities (46 shown, 21 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6a304f41`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lifecycle.ts
- EventBus
- developer-agent-runtime.test.ts
- application.ts
- compilerOptions
- JsonDeveloperSessionStore
- ToolRegistry
- Developer-agent runtime design
- Phase 4 Verification
- agent-remote architecture
- whatsapp-gateway.test.ts
- agent-remote architecture design
- WhatsApp Channel Adapter Design
- package.json
- agent-remote
- whatsapp-channel.test.ts
- Global Constraints
- Global Constraints
- Global Constraints
- Phase 4 Plan 01 Summary
- Requirements: agent-remote foundation
- State
- Local WhatsApp gateway
- Phase 1 Verification
- Roadmap
- node:fs/promises
- runtimes.test.ts
- 01-01-PLAN.md
- node-path.d.ts
- adapters.test.ts
- Task 3 Report
- core/src/index.ts
- developer-agent-smoke.test.ts
- Critical Issues
- agent-remote
- Global Constraints
- qrcode-terminal.d.ts
- JsonControlPlaneStore
- Tasks
- Phase 4 Plan 02 Summary
- ControlPlane
- copilot/src/index.ts
- Enterprise Conversational Control Plane Design
- doctor.ts
- security/src/index.ts
- WhatsAppChannel
- contracts.ts
- control-plane.test.ts
- control-plane/src/index.ts
- ConversationAgent
- DeveloperAgentRuntime
- Phase 5 Verification: Enterprise Conversational Control Plane
- CommandRegistry
- developer-agent/src/index.ts
- persistence.ts
- ControlPlaneRepositories
- AgentResponse
- SilentBaileysLogger
- main.ts
- ConversationRepository
- IdempotencyRepository
- translate.ts
- whatsapp.ts
- config.ts
- ProviderSessionRepository
- WhatsAppEvents
- ModelPolicy

## God Nodes (most connected - your core abstractions)
1. `ControlPlane` - 38 edges
2. `createApplication()` - 29 edges
3. `JsonControlPlaneStore` - 28 edges
4. `WhatsAppChannel` - 24 edges
5. `InMemoryControlPlaneStore` - 23 edges
6. `EventBus` - 20 edges
7. `Message` - 18 edges
8. `AgentResponse` - 15 edges
9. `ConversationAgent` - 14 edges
10. `WorkspacePolicy` - 14 edges

## Surprising Connections (you probably didn't know these)
- `defaults()` --indirect_call--> `resolveDeveloperExecutable()`  [INFERRED]
  apps/gateway/src/doctor.ts → runtime/developer-agent/src/process.ts
- `ApplicationConfig` --references--> `Route`  [EXTRACTED]
  apps/gateway/src/application.ts → packages/core/src/index.ts
- `AgentRemoteApplication` --references--> `ControlPlane`  [EXTRACTED]
  apps/gateway/src/application.ts → packages/control-plane/src/index.ts
- `AgentRemoteApplication` --references--> `Route`  [EXTRACTED]
  apps/gateway/src/application.ts → packages/core/src/index.ts
- `AgentRemoteApplication` --references--> `DeveloperAgentRuntime`  [EXTRACTED]
  apps/gateway/src/application.ts → runtime/developer-agent/src/index.ts

## Import Cycles
- None detected.

## Communities (75 total, 21 thin omitted)

### Community 0 - "lifecycle.ts"
Cohesion: 0.17
Nodes (13): authorizeWhatsAppMessage(), WhatsAppConfig, defaultLogger, InvalidWhatsAppPayloadError, isCoreMessage(), isSelfSentPayload(), UnauthorizedWhatsAppMessageError, WhatsAppAuthState (+5 more)

### Community 1 - "EventBus"
Cohesion: 0.18
Nodes (8): Worker, DomainEvent, DomainEventType, EventBus, EventHandler, eventTypes, InMemoryEventBus, forbiddenTools

### Community 3 - "application.ts"
Cohesion: 0.15
Nodes (18): AgentRemoteApplication, createAgent(), createApplication(), execFile, isMessage(), loadApplicationConfig(), loadRoutes(), localOperations() (+10 more)

### Community 4 - "compilerOptions"
Cohesion: 0.10
Nodes (19): apps/**/*.ts, channels/**/*.ts, config/**/*.ts, developer-agents/**/*.ts, integrations/**/*.ts, packages/**/*.ts, runtime/**/*.ts, types/**/*.d.ts (+11 more)

### Community 5 - "JsonDeveloperSessionStore"
Cohesion: 0.13
Nodes (6): DeveloperSessionState, DeveloperSessionStateError, DeveloperSessionStore, InMemoryDeveloperSessionStore, isSessionMap(), JsonDeveloperSessionStore

### Community 6 - "ToolRegistry"
Cohesion: 0.14
Nodes (6): AllowlistedToolRegistry, DeveloperCapabilityError, ToolHandler, ToolNotAllowedError, ToolRegistry, ChatbotRuntime

### Community 7 - "Developer-agent runtime design"
Cohesion: 0.12
Nodes (15): Adapters, Architecture, Availability, Claude, Codex, Contracts, Copilot, Developer-agent runtime design (+7 more)

### Community 8 - "Phase 4 Verification"
Cohesion: 0.33
Nodes (5): Evidence, Implemented acceptance coverage, Phase 4 Verification, Remaining real gates, Result

### Community 9 - "agent-remote architecture"
Cohesion: 0.14
Nodes (13): agent-remote architecture, Control-plane state and policy, Core contracts, Events, Future extensions, Intentionally not implemented, Package boundaries, Routing (+5 more)

### Community 11 - "agent-remote architecture design"
Cohesion: 0.20
Nodes (9): agent-remote architecture design, Chosen approach, Error handling and events, Extension points, Goal, Message flow, Runtime and trust boundaries, V1 scope exclusions (+1 more)

### Community 12 - "WhatsApp Channel Adapter Design"
Cohesion: 0.20
Nodes (9): Authentication and lifecycle, Boundary, Data flow, Goal, Health, Message translation, Security, Verification (+1 more)

### Community 13 - "package.json"
Cohesion: 0.14
Nodes (13): dependencies, qrcode-terminal, @whiskeysockets/baileys, name, private, scripts, build, doctor (+5 more)

### Community 14 - "agent-remote"
Cohesion: 0.20
Nodes (9): Active, agent-remote, Core Value, Evolution, Key Decisions, Out of Scope, Requirements, Validated (+1 more)

### Community 16 - "Global Constraints"
Cohesion: 0.22
Nodes (8): Developer-agent Runtime Implementation Plan, Final verification checklist, Global Constraints, Task 1: Define developer-agent contracts and persistent session storage, Task 2: Implement the direct process runner and executable availability lookup, Task 3: Implement Claude, Codex, and Copilot adapters, Task 4: Integrate adapters, workspace policy, session isolation, lifecycle events, and gateway output, Task 5: Document configuration, run full verification, and refresh project knowledge

### Community 17 - "Global Constraints"
Cohesion: 0.22
Nodes (8): Global Constraints, Plan Self-Review, Task 1: Extend channel-neutral message metadata, Task 2: Add validated WhatsApp configuration and pure translation, Task 3: Implement the Baileys lifecycle adapter, Task 4: Wire the gateway composition and document operation, Task 5: Refresh project knowledge and verify the complete contract, WhatsApp Channel Adapter Implementation Plan

### Community 18 - "Global Constraints"
Cohesion: 0.25
Nodes (7): agent-remote Foundation Implementation Plan, Global Constraints, Task 1: TypeScript workspace and core contracts, Task 2: Router, configuration, and event bus, Task 3: Security capabilities and separated runtimes, Task 4: Channel and agent adapter seams, Task 5: Documentation and boundary verification

### Community 19 - "Phase 4 Plan 01 Summary"
Cohesion: 0.40
Nodes (4): Delivered, Pending external acceptance, Phase 4 Plan 01 Summary, Verification

### Community 20 - "Requirements: agent-remote foundation"
Cohesion: 0.25
Nodes (7): Adapters and docs, Core, Enterprise conversational control plane, Requirements: agent-remote foundation, Routing and events, Security, WhatsApp channel adapter

### Community 21 - "State"
Cohesion: 0.29
Nodes (6): Current Position, Decisions, Next Action, State, Status, Verification

### Community 22 - "Local WhatsApp gateway"
Cohesion: 0.33
Nodes (5): Configuration, Control-plane commands, Local WhatsApp gateway, Message boundary, Startup and shutdown

### Community 23 - "Phase 1 Verification"
Cohesion: 0.40
Nodes (4): Acceptance coverage, Evidence, Phase 1 Verification, Result

### Community 25 - "Roadmap"
Cohesion: 0.29
Nodes (6): Phase 1: Architectural foundation — Complete, Phase 2: Local WhatsApp channel adapter — Complete, Phase 3: Developer-agent runtime — Complete, Phase 4: Operational Integration & Real WhatsApp Acceptance — Complete, Phase 5: Enterprise Conversational Control Plane — Complete, Roadmap

### Community 36 - "Task 3 Report"
Cohesion: 0.11
Nodes (17): Changes, Changes, Changes, Changes, Changes, Concerns, Review Fix Round 1, Review Fix Round 2 (+9 more)

### Community 37 - "core/src/index.ts"
Cohesion: 0.11
Nodes (18): GatewayConfigurationError, GatewayDependencies, talkarisAgent, ConversationStore, createConversationContext(), InMemoryConversationStore, AgentRuntime, AgentType (+10 more)

### Community 39 - "Critical Issues"
Cohesion: 0.09
Nodes (22): CR-01: Foreign external sessions are returned to the caller, CR-02: `/init` can take over another owner’s chat and cannot reactivate closed chats, CR-03: Queued executions never finalize managed state, CR-04: Cancellation can start a queued task after cancelling the active task, CR-05: Idempotency is racy and consumes messages rejected for queue overflow, CR-06: A malformed slash message can reach the provider, CR-07: Role configuration can promote viewers to owners and ordinary prompts have no role gate, CR-08: An invalid default workspace is persisted as malformed control-plane state (+14 more)

### Community 40 - "agent-remote"
Cohesion: 0.25
Nodes (7): agent-remote, Configuration, Doctor and startup, Install, Provider behavior, Restart and troubleshooting, WhatsApp pairing

### Community 41 - "Global Constraints"
Cohesion: 0.33
Nodes (5): Global Constraints, Phase 4: Operational Integration & Real WhatsApp Acceptance, Task 1: Operational configuration and application composition, Task 2: Doctor, lifecycle diagnostics, and unknown-route UX, Task 3: Documentation and real provider readiness

### Community 44 - "JsonControlPlaneStore"
Cohesion: 0.08
Nodes (6): clone(), InMemoryControlPlaneStore, JsonControlPlaneStore, persistedConversation(), providerKey(), selectionKey()

### Community 45 - "Tasks"
Cohesion: 0.25
Nodes (7): Phase 4 Plan 02: One-number WhatsApp Self-Chat, Task 1: Configuration and translation, Task 2: Outbound echo suppression, Task 3: Local operation and acceptance, Task 4: Automatic one-number initialization, Task 5: Single-instance safety and command feedback, Tasks

### Community 46 - "Phase 4 Plan 02 Summary"
Cohesion: 0.40
Nodes (4): Delivered, Phase 4 Plan 02 Summary, Remaining manual acceptance, Verification

### Community 47 - "ControlPlane"
Cohesion: 0.14
Nodes (4): ConfiguredModelPolicy, ControlPlane, roleAtLeast(), Message

### Community 48 - "copilot/src/index.ts"
Cohesion: 0.12
Nodes (13): claudeAdapter, createClaudeAdapter(), Resolver, codexAdapter, createCodexAdapter(), Resolver, copilotAdapter, createCopilotAdapter() (+5 more)

### Community 49 - "Enterprise Conversational Control Plane Design"
Cohesion: 0.14
Nodes (13): Architecture, Authorization and security, Command registry, Context, Enterprise Conversational Control Plane Design, Events and safe output, Execution, queues, and cancellation, Goals (+5 more)

### Community 50 - "doctor.ts"
Cohesion: 0.24
Nodes (11): ApplicationConfig, controlPlaneStateCheck(), defaults(), DoctorCheck, DoctorDependencies, DoctorStatus, execFile, exists() (+3 more)

### Community 51 - "security/src/index.ts"
Cohesion: 0.29
Nodes (4): canonicalizeExistingAncestor(), createRestrictedDeveloperCapabilities(), LocalDeveloperOperations, WorkspaceAccessError

### Community 52 - "WhatsAppChannel"
Cohesion: 0.22
Nodes (4): chunkText(), disconnectStatusCode(), messageIdFromPayload(), WhatsAppChannel

### Community 53 - "contracts.ts"
Cohesion: 0.20
Nodes (10): WorkspacePolicy, DeveloperAgentAvailability, DeveloperAgentFailureReason, DeveloperAgentProcessMetadata, DeveloperAgentRequest, DeveloperAgentResult, DeveloperExecutionContext, DeveloperProcessError (+2 more)

### Community 55 - "control-plane/src/index.ts"
Cohesion: 0.14
Nodes (14): CommandAction, CommandCategory, CommandContext, CommandDefinition, CommandResult, CommandStatus, ControlPlaneIdentity, ControlPlaneOptions (+6 more)

### Community 58 - "DeveloperAgentRuntime"
Cohesion: 0.44
Nodes (3): ConversationContext, DeveloperAgentRuntime, createDeveloperSessionKey()

### Community 59 - "Phase 5 Verification: Enterprise Conversational Control Plane"
Cohesion: 0.29
Nodes (6): Automated verification, Conclusion, Doctor, Graphify, Phase 5 Verification: Enterprise Conversational Control Plane, Real acceptance

### Community 61 - "developer-agent/src/index.ts"
Cohesion: 0.18
Nodes (6): DeveloperCapabilities, DeveloperProcessRunner, DeveloperAgentRuntimeOptions, ResolvedDeveloperAgentRuntimeOptions, RuntimeFailureReason, NodeDeveloperProcessRunner

### Community 62 - "persistence.ts"
Cohesion: 0.33
Nodes (7): ControlPlaneStateError, IdempotencyRecord, isIdempotencyRecord(), isManagedConversation(), isPersistedState(), isRecord(), PersistedState

### Community 66 - "main.ts"
Cohesion: 0.47
Nodes (4): loadEnvironment(), acquireProcessLock(), isProcessAlive(), env

### Community 69 - "translate.ts"
Cohesion: 0.27
Nodes (13): attachmentKinds, extractAttachments(), extractText(), isNonConversation(), numberValue(), objectValue(), RawMessageKey, RawWhatsAppMessage (+5 more)

### Community 70 - "whatsapp.ts"
Cohesion: 0.24
Nodes (8): Gateway, createWhatsAppGateway(), isCoreMessage(), WhatsAppGatewayApplication, WhatsAppGatewayOptions, WhatsAppAuthLoader, WhatsAppLogger, WhatsAppSocketFactory

### Community 71 - "config.ts"
Cohesion: 0.39
Nodes (6): parseBoolean(), parseList(), parsePositiveInteger(), parseWhatsAppConfig(), WhatsAppAuthorization, WhatsAppConfigurationError

## Knowledge Gaps
- **238 isolated node(s):** `DoctorStatus`, `DoctorCheck`, `env`, `defaultLogger`, `RawMessageKey` (+233 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 413 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `JsonControlPlaneStore` connect `JsonControlPlaneStore` to `doctor.ts`, `application.ts`, `persistence.ts`, `control-plane/src/index.ts`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `ControlPlane` connect `ControlPlane` to `EventBus`, `application.ts`, `ControlPlaneRepositories`, `control-plane/src/index.ts`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `InMemoryControlPlaneStore` connect `JsonControlPlaneStore` to `ControlPlaneRepositories`, `ControlPlane`, `persistence.ts`, `control-plane/src/index.ts`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `createApplication()` (e.g. with `printQr()` and `.drain()`) actually correct?**
  _`createApplication()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DoctorStatus`, `DoctorCheck`, `env` to the rest of the system?**
  _238 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `application.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14855072463768115 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._