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

## Review Fix Round 3

### Changes

- Hardened `WorkspacePolicy.assertPath` against approved-root and candidate-path symlink escapes by canonicalizing the longest existing ancestor with `realpathSync.native`, then appending non-existing suffix components.
- Preserved synchronous policy behavior, existing workspace containment checks, and valid new paths beneath approved roots.
- Added a temporary-directory symlink regression test with explicit permission-based skip handling.

### Verification

- Red: the symlink regression failed with the prior lexical-only containment check.
- Focused: `npm run build && node --test --experimental-strip-types test/security.test.ts test/developer-agent-process.test.ts test/adapters.test.ts` — 24 passing.
- Full: `npm test` — 58 passing.
- `git diff --check` — passed.

## Review Fix Round 4

### Changes

- Replaced `existsSync`-following path inspection with `lstatSync` component inspection.
- Existing components and symlinks are resolved with `realpathSync.native`; unresolved symlink targets fail closed as `WorkspaceAccessError` instead of becoming non-existing suffixes.
- Ordinary new paths and symlinks resolving inside approved roots remain accepted.
- Added a dangling-symlink regression proving policy rejection occurs before `outside/created.txt` can be written.

### Verification

- Red: the dangling-symlink test failed because the prior `existsSync` walk treated the dangling link as an ordinary missing suffix.
- Focused: `npm run build && node --test --experimental-strip-types test/security.test.ts test/developer-agent-process.test.ts test/adapters.test.ts` — 25 passing.
- Full: `npm test` — 59 passing.
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
