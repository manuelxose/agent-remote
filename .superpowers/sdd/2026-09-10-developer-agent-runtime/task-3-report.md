# Task 3 Report

## Status

Implemented Claude, Codex, and Copilot developer-agent adapters.

## Changes

- Added `claudeAdapter`, `codexAdapter`, and `copilotAdapter` with injectable executable lookup for contract tests.
- Kept vendor commands centralized in their adapter files and passed prompts as single argv values through the typed process runner.
- Added Claude JSON print/resume parsing, Codex JSONL exec/resume parsing with fixed `workspace-write` sandboxing, and Copilot silent prompt mode with exact UUID session IDs.
- Added structured unavailable, workspace, process, and invalid-output results while preserving the existing registration agents.
- Expanded adapter tests for availability, argv safety, session reuse, native session extraction, response parsing, and malformed output.

## Verification

- Red: `npm run build && node --test --experimental-strip-types test/adapters.test.ts` failed because the adapter exports were not defined.
- Focused: `npm run build && node --test --experimental-strip-types test/adapters.test.ts` — 9 passing.
- Full: `npm test` — 54 passing.
- `git diff --check` — passed.

## Review Fix Round 2

### Changes

- Copilot now enables the documented experimental capability with `--experimental` before its fixed `--sandbox` flag; it never attempts an unsandboxed workspace-required run.
- Extended nonzero-exit coverage to Claude, Codex, and Copilot, preserving bounded stderr diagnostics.
- Added a runner-rejection test verifying `execution-failed` diagnostics are capped to the request output limit.

### Verification

- Red: focused tests failed because Copilot omitted `--experimental` from its sandboxed invocation.
- Green focused: `npm run build && node --test --experimental-strip-types test/adapters.test.ts` — 12 passing.
- Full: `npm test` — 57 passing.
- `graphify update .` — completed.

## Concerns

- Real vendor smoke tests remain dependent on locally installed and authenticated CLIs; unit tests use the injected fake runner.

## Review Fix Round 1

### Changes

- Added `--` before Claude and Codex positional prompts; Copilot now uses `--prompt=<prompt>`, exact `--session-id=<id>`, and fixed `--sandbox`.
- Added Claude `--add-dir <validated working directory>` and retained Codex `--sandbox workspace-write`; policy assertion remains before runner invocation.
- Separated runner failures from parser failures: runner rejections return `execution-failed` with bounded diagnostics and parser failures return `invalid-output` with bounded metadata.
- Added tests for adversarial prompt argv, fixed workspace flags, unavailable and workspace rejection branches for every adapter, runner rejection, timeout/cancel/output-limit, and nonzero exit mapping.
- Removed unused placeholder `ConversationAgent` imports and exports; canonical adapter exports remain.

### Verification

- Red: focused adapter tests failed on missing `--`/scope flags, Copilot option shape, and runner rejection classified as `invalid-output`.
- Green focused: `npm run build && node --test --experimental-strip-types test/adapters.test.ts` — 12 passing.
- Full: `npm test` — 57 passing.
- `git diff --check` — passed.
