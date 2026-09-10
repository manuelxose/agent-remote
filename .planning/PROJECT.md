# agent-remote

## What This Is

A local TypeScript foundation for routing messages from WhatsApp conversations to isolated developer-agent runtimes, with a future-safe chatbot runtime boundary.

## Core Value

Keep channel transport independent from agent execution while making unsafe capability crossing structurally difficult.

## Requirements

### Validated

(None yet — initial foundation.)

### Active

- [ ] Configuration routes conversations to developer agents and future chatbot tenants.
- [ ] Core contracts support channel-neutral conversation -> route -> runtime -> agent -> response flow.
- [ ] Developer and chatbot runtimes enforce separate capabilities.
- [ ] Event and channel abstractions permit future transport/broker replacements.
- [ ] Tests and documentation prove the boundaries.

### Out of Scope

- WhatsApp provider credentials or production transport integration — V1 proves the adapter seam locally.
- Talkaris business logic — only a registration placeholder is required.
- Persistent storage, distributed brokers, and multi-tenant execution — future runtime concerns.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Minimal npm TypeScript workspace monorepo | Keeps package boundaries explicit without framework complexity | Pending |
| `developer-agent` and `chatbot` are separate runtime types | Prevents customer-facing code from inheriting shell capabilities | Pending |
| In-memory event bus behind an interface | Local V1 simplicity with broker replacement seam | Pending |
| Route key includes channel conversation identity | Supports one WhatsApp conversation per agent and future channel adapters | Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

---
*Last updated: 2026-09-10 after initialization*
