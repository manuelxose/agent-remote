# Chat Resolution and Import Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Make `/chat` resolve any imported WhatsApp chat by exact normalized name before partial matches, report genuine ambiguities, and allow importing a WhatsApp `.txt` export attached to `/importar`.

**Architecture:** Keep resolution in the control plane and persistence in the conversations package. Add a deterministic WhatsApp export parser and one atomic `HistoryStore` import operation. The WhatsApp channel downloads document media only for the `/importar` command and hands the bytes to the application callback; imported messages never enter the live AI routing path.

**Tech Stack:** TypeScript, Node.js standard library (`crypto`, `Buffer`), Baileys document download, existing JSONL/in-memory history stores, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-14-chat-resolution-and-import-design.md`

## Global Constraints

- Preserve existing authorization and initialization behavior for normal AI messages.
- Never silently choose among multiple exact matches or any partial-only chat match.
- Do not add dependencies or re-pair WhatsApp automatically.
- Reject oversized/malformed imports before persistence and keep imported data out of `onMessage`.
- Use `apply_patch` for edits and leave one focused runnable test per non-trivial behavior.

## Task 1: Make chat matching deterministic

1. Add case/diacritic-insensitive normalization for chat names and IDs in the conversations matching path.
2. Update control-plane history lookup to prefer exact normalized display-name or conversation-ID matches over partial matches; never silently select a partial-only candidate.
3. Return a bounded, readable candidate list for partial or duplicate matches, including stable conversation IDs and the command form to retry.
4. Add tests for exact-vs-partial (`Silvia` vs `Regalo Silvia`), accents/case, duplicate names, IDs, and no-match behavior.
5. Run the focused control-plane/conversations tests.

## Task 2: Add safe, atomic WhatsApp export parsing

1. Implement a standard-library parser for common WhatsApp text-export line formats, continuation lines, sender text, timestamps, and group chats as one conversation.
2. Generate deterministic imported conversation/message IDs so re-importing the same file is idempotent.
3. Enforce bounded input size/message count and reject files with no parseable messages.
4. Add an atomic `importChat` operation to the history-store contract and both JSONL and in-memory stores, rolling back in-memory state if persistence fails.
5. Add parser and persistence tests for normal exports, continuations, malformed input, size limits, and repeated imports.
6. Run the focused conversations tests.

## Task 3: Wire direct `/importar` and export fallback through WhatsApp

1. Detect `/importar [nombre opcional]` and `/import [nombre opcional]` in the WhatsApp lifecycle without routing them to the AI.
2. Preserve contact/chat names and message anchors from WhatsApp history events for direct lookup and on-demand history requests.
3. Download an attached document through Baileys as the export fallback and invoke the application callback with sender/message metadata, filename, MIME type, and bytes.
4. Resolve exact direct imports, request available history, atomically persist, and acknowledge the result from the gateway application.
5. Add channel/application tests covering direct callback invocation, aliases, contact names, export fallback, authorization, and failure acknowledgement.
6. Run the full test suite and production build.

## Task 4: Ship and verify runtime

1. Run Graphify update from the project root and inspect the final diff/status.
2. Commit the implementation and documentation with a focused message.
3. Push `main` to `origin`.
4. Restart the local gateway in the existing `agent-remote` tmux session, preserving the current WhatsApp auth directory.
5. Verify health/build/test results and report the commit, push, and runtime status without claiming WhatsApp connection success unless logs confirm it.
