# Graph Report - developer-agent-runtime  (2026-09-10)

## Corpus Check
- 57 files · ~22,467 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 471 nodes · 671 edges · 39 communities (23 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `22fb0c3a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- lifecycle.ts
- developer-agent/src/index.ts
- developer-agent-runtime.test.ts
- contracts.ts
- compilerOptions
- JsonDeveloperSessionStore
- ToolRegistry
- Developer-agent runtime design
- translate.ts
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
- SilentBaileysLogger
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
- gateway/src/index.ts
- developer-agent-smoke.test.ts

## God Nodes (most connected - your core abstractions)
1. `WhatsAppChannel` - 20 edges
2. `EventBus` - 16 edges
3. `Developer-agent runtime design` - 12 edges
4. `translateWhatsAppMessage()` - 11 edges
5. `ConversationAgent` - 11 edges
6. `compilerOptions` - 10 edges
7. `agent-remote architecture` - 10 edges
8. `Message` - 9 edges
9. `ConversationContext` - 9 edges
10. `AgentResponse` - 9 edges

## Surprising Connections (you probably didn't know these)
- `GatewayDependencies` --references--> `AgentRuntime`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/core/src/index.ts
- `GatewayDependencies` --references--> `ConversationAgent`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/core/src/index.ts
- `GatewayDependencies` --references--> `EventBus`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/events/src/index.ts
- `Worker` --references--> `EventBus`  [EXTRACTED]
  apps/worker/src/index.ts → packages/events/src/index.ts
- `WhatsAppChannel` --implements--> `Channel`  [EXTRACTED]
  channels/whatsapp/src/lifecycle.ts → packages/core/src/index.ts

## Import Cycles
- None detected.

## Communities (39 total, 10 thin omitted)

### Community 0 - "lifecycle.ts"
Cohesion: 0.07
Nodes (27): Gateway, createWhatsAppGateway(), WhatsAppGatewayApplication, WhatsAppGatewayOptions, authorizeWhatsAppMessage(), parseList(), parsePositiveInteger(), parseWhatsAppConfig() (+19 more)

### Community 1 - "developer-agent/src/index.ts"
Cohesion: 0.09
Nodes (23): Worker, talkarisAgent, AgentResponse, AgentRuntime, AgentType, ConversationAgent, ConversationContext, Metadata (+15 more)

### Community 3 - "contracts.ts"
Cohesion: 0.06
Nodes (25): claudeAdapter, Resolver, codexAdapter, Resolver, copilotAdapter, Resolver, SessionIdFactory, canonicalizeExistingAncestor() (+17 more)

### Community 4 - "compilerOptions"
Cohesion: 0.10
Nodes (19): apps/**/*.ts, channels/**/*.ts, config/**/*.ts, developer-agents/**/*.ts, integrations/**/*.ts, packages/**/*.ts, runtime/**/*.ts, types/**/*.d.ts (+11 more)

### Community 5 - "JsonDeveloperSessionStore"
Cohesion: 0.15
Nodes (6): DeveloperSessionState, DeveloperSessionStateError, DeveloperSessionStore, InMemoryDeveloperSessionStore, isSessionMap(), JsonDeveloperSessionStore

### Community 6 - "ToolRegistry"
Cohesion: 0.15
Nodes (5): AllowlistedToolRegistry, DeveloperCapabilityError, ToolHandler, ToolNotAllowedError, ToolRegistry

### Community 7 - "Developer-agent runtime design"
Cohesion: 0.12
Nodes (15): Adapters, Architecture, Availability, Claude, Codex, Contracts, Copilot, Developer-agent runtime design (+7 more)

### Community 8 - "translate.ts"
Cohesion: 0.27
Nodes (13): attachmentKinds, extractAttachments(), extractText(), isNonConversation(), numberValue(), objectValue(), RawMessageKey, RawWhatsAppMessage (+5 more)

### Community 9 - "agent-remote architecture"
Cohesion: 0.15
Nodes (12): agent-remote architecture, Core contracts, Events, Future extensions, Intentionally not implemented, Package boundaries, Routing, System shape (+4 more)

### Community 11 - "agent-remote architecture design"
Cohesion: 0.20
Nodes (9): agent-remote architecture design, Chosen approach, Error handling and events, Extension points, Goal, Message flow, Runtime and trust boundaries, V1 scope exclusions (+1 more)

### Community 12 - "WhatsApp Channel Adapter Design"
Cohesion: 0.20
Nodes (9): Authentication and lifecycle, Boundary, Data flow, Goal, Health, Message translation, Security, Verification (+1 more)

### Community 13 - "package.json"
Cohesion: 0.20
Nodes (9): dependencies, @whiskeysockets/baileys, name, private, scripts, build, test, type (+1 more)

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

### Community 20 - "Requirements: agent-remote foundation"
Cohesion: 0.29
Nodes (6): Adapters and docs, Core, Requirements: agent-remote foundation, Routing and events, Security, WhatsApp channel adapter

### Community 21 - "State"
Cohesion: 0.29
Nodes (6): Current Position, Decisions, Next Action, State, Status, Verification

### Community 22 - "Local WhatsApp gateway"
Cohesion: 0.40
Nodes (4): Configuration, Local WhatsApp gateway, Message boundary, Startup and shutdown

### Community 23 - "Phase 1 Verification"
Cohesion: 0.40
Nodes (4): Acceptance coverage, Evidence, Phase 1 Verification, Result

### Community 25 - "Roadmap"
Cohesion: 0.50
Nodes (3): Phase 1: Architectural foundation — Complete, Phase 2: Local WhatsApp channel adapter — Complete, Roadmap

### Community 36 - "Task 3 Report"
Cohesion: 0.11
Nodes (17): Changes, Changes, Changes, Changes, Changes, Concerns, Review Fix Round 1, Review Fix Round 2 (+9 more)

### Community 37 - "gateway/src/index.ts"
Cohesion: 0.13
Nodes (13): GatewayConfigurationError, GatewayDependencies, ConversationStore, createConversationContext(), InMemoryConversationStore, Channel, Conversation, ExecutionContext (+5 more)

## Knowledge Gaps
- **153 isolated node(s):** `defaultLogger`, `RawMessageKey`, `RawWhatsAppMessage`, `attachmentKinds`, `Resolver` (+148 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 278 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AgentResponse` connect `developer-agent/src/index.ts` to `lifecycle.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `EventBus` connect `developer-agent/src/index.ts` to `contracts.ts`, `gateway/src/index.ts`, `ToolRegistry`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `WhatsAppChannel` connect `lifecycle.ts` to `gateway/src/index.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `defaultLogger`, `RawMessageKey`, `RawWhatsAppMessage` to the rest of the system?**
  _153 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `lifecycle.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07402597402597402 - nodes in this community are weakly interconnected._
- **Should `developer-agent/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `contracts.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0611764705882353 - nodes in this community are weakly interconnected._