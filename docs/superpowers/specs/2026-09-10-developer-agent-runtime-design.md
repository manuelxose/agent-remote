# Developer-agent runtime design

Date: 2026-09-10
Status: Approved design, pending implementation plan

## Goal

Provide a safe local runtime for invoking Claude Code, Codex CLI, and GitHub Copilot CLI from channel-neutral typed APIs while preserving one native agent session per channel/conversation/agent/workspace tuple.

## Scope

In scope:

- adapter abstraction for Claude, Codex, and Copilot;
- direct process execution with typed argv arrays;
- working-directory and approved-workspace enforcement;
- timeout, cancellation, stdout/stderr capture, exit status, and output limits;
- execution lifecycle events;
- per-channel/conversation/agent/workspace session mapping with restart persistence;
- truthful CLI availability reporting;
- routing successful output back through the existing gateway response pipeline.

Out of scope:

- installing or updating CLIs;
- arbitrary shell execution from WhatsApp;
- long-lived interactive CLI processes;
- sharing a session between conversations unless a trusted runtime API explicitly supplies that mapping;
- vendor SDK dependencies.

## Architecture

The existing channel-neutral gateway remains the composition boundary:

```text
WhatsApp message
  -> Gateway
  -> route
  -> DeveloperAgentRuntime
  -> WorkspacePolicy
  -> selected DeveloperAgentAdapter
  -> typed process runner
  -> DeveloperAgentResult
  -> AgentResponse
  -> WhatsApp
```

`packages/core` remains free of channel and CLI dependencies. The developer runtime owns adapter registration and command dispatch. WhatsApp only produces a typed `Message`; it never constructs a command, executable, or CLI argument.

The existing generic `AgentRuntime` and chatbot contracts remain compatible. Developer-agent execution is routed through the adapter registry using the route’s agent ID. The runtime rejects routes and adapters from the wrong trust zone.

## Contracts

The developer runtime exposes contracts equivalent to:

```ts
interface DeveloperAgentAdapter {
  readonly id: string;
  isAvailable(): Promise<DeveloperAgentAvailability>;
  execute(
    request: DeveloperAgentRequest,
    context: DeveloperExecutionContext
  ): Promise<DeveloperAgentResult>;
}
```

`DeveloperAgentRequest` contains the user message, conversation ID, optional native session ID, timeout, output limit, and any trusted runtime options. It does not contain a command string or arbitrary executable path.

`DeveloperExecutionContext` contains the validated working directory, approved workspace policy, cancellation signal, correlation ID, event bus, and process-runner dependency. The adapter receives only this typed context.

`DeveloperAgentResult` is a discriminated structured result. Success includes response text, native session ID, stdout, stderr, exit code, duration, and truncation metadata. Failure includes a stable reason such as `unavailable`, `workspace-rejected`, `timeout`, `cancelled`, `exit-nonzero`, `output-limit`, or `invalid-output`, plus safe diagnostics. Vendor raw output remains available in bounded stdout/stderr fields where appropriate.

## Process runner

The runner uses Node’s direct child-process API with an executable and an argv array. It never uses a shell. It:

1. validates the working directory through `WorkspacePolicy`;
2. spawns the executable with the validated `cwd`;
3. captures stdout and stderr independently;
4. terminates the child when either configured stream limit is exceeded;
5. terminates on timeout or `AbortSignal` cancellation;
6. returns exit code, signal, bounded output, duration, and termination reason.

The runner does not interpret WhatsApp text as arguments. The adapter passes the complete prompt as one positional argument or one stdin payload according to its fixed vendor contract.

## Adapters

Each adapter centralizes its own executable name, argv construction, availability probe, session-ID extraction, and response parsing.

### Claude

- executable: `claude` resolved from PATH;
- initial turn: print mode with JSON output;
- resumed turn: print mode with the stored native session ID;
- parse the JSON response and returned session ID;
- do not use permission-bypass flags.

Claude’s documented print mode and `--resume` support are the basis for this adapter: <https://code.claude.com/docs/en/cli-usage>.

### Codex

- executable: `codex` resolved from PATH;
- initial turn: non-interactive `exec` JSON mode;
- resumed turn: `exec resume` with the stored thread/session ID;
- set the working directory and the adapter’s approved workspace sandbox mode;
- parse JSON event output for the thread ID and final assistant message;
- do not use dangerous approval or sandbox bypass flags.

Codex’s current CLI reference and source-level command definitions document non-interactive execution and resume: <https://developers.openai.com/codex/cli/reference> and <https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs>.

### Copilot

- executable: `copilot` resolved from PATH;
- initial turn: non-interactive prompt mode with a generated exact UUID session ID;
- resumed turn: the same exact session ID;
- request silent response output where supported;
- parse the final assistant response and preserve the exact session ID;
- do not use broad permission-bypass flags.

Copilot documents non-interactive prompt mode, exact session IDs, and resume behavior: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference>.

If a vendor CLI version does not support the expected invocation shape or response format, the adapter returns `invalid-output`/`execution-failed` with bounded diagnostics rather than guessing or falling back to another agent.

## Availability

Availability is truthful and side-effect free. The runtime resolves the configured executable using platform-native direct lookup (`which` on POSIX or `where.exe` on Windows) without a shell. A missing executable produces:

```ts
{
  available: false,
  reason: "executable-missing",
  executable: "claude" | "codex" | "copilot"
}
```

No adapter installs, downloads, or substitutes for an unavailable CLI.

## Workspace security

The approved workspace roots are trusted configuration. Every requested working directory is canonicalized and must be the root itself or a descendant of one configured root. Traversal, sibling-prefix paths, and paths outside the roots are rejected before process creation.

The runtime may select a workspace beneath an approved root, but no incoming WhatsApp field can add roots, replace the policy, or select an executable. Adapter-generated flags are fixed code/configuration, not message content.

## Session persistence and isolation

The store is keyed by an unambiguous JSON tuple `[channel, conversationId, agentId, canonicalWorkspaceRoot]` and stores only:

```json
{
  "[\"whatsapp\",\"conversation\",\"codex\",\"/approved/workspace\"]": {
    "nativeSessionId": "vendor-session-id"
  }
}
```

The default path is `data/developer-agent-sessions.json`, configurable through trusted runtime setup. The file is loaded at startup and written after successful execution using a same-directory temporary file and rename. Missing state starts empty. Malformed state fails startup/configuration clearly instead of silently creating cross-session ambiguity.

The runtime canonicalizes the approved workspace root before constructing the tuple and before adding it to the per-session queue. Equivalent approved path forms therefore serialize on the same queue. Agent or workspace changes produce a different key and start a new native session; no redundant agent or workspace metadata is persisted. Legacy metadata-shaped records are malformed and fail clearly rather than being interpreted as a session. Concurrent turns for the same tuple are serialized; different tuples remain independent.

## Events and response pipeline

The runtime emits `AgentExecutionStarted` before spawning and exactly one terminal event afterward: `AgentExecutionCompleted` for success or `AgentExecutionFailed` for any failure. Payloads include correlation ID, conversation ID, adapter ID, workspace, duration, exit code, and stable failure reason. Prompts, tokens, credentials, and unbounded process output are excluded.

On success, the adapter result is converted to the existing `AgentResponse` and returned to `Gateway`, which sends it through the channel and emits `MessageSent`. Unavailable and execution failures stay structured inside the runtime and are surfaced as clean gateway errors/responses according to the existing error pipeline.

## Verification

Unit tests use a fake process runner and temporary directories to verify:

- all three adapters build their own argv and parse successful output;
- missing executables return unavailable without spawning;
- timeout, cancellation, non-zero exit, malformed output, and output limits are reported;
- approved roots accept descendants and reject outside/traversal paths;
- three conversations can independently map to Claude, Codex, and Copilot;
- persisted mappings reload after a new store instance;
- mismatched agent/workspace starts a fresh session;
- events have the required started/completed/failed lifecycle;
- successful output reaches the gateway/channel response pipeline.

When a CLI is installed, optional smoke tests invoke its availability probe and a minimal non-destructive prompt in an approved temporary workspace. Missing CLIs are reported as skipped/unavailable, never treated as passing execution.
