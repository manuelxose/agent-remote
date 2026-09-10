# Developer-agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe local runtime that invokes Claude Code, Codex CLI, and GitHub Copilot CLI with isolated, persisted sessions per conversation.

**Architecture:** Keep WhatsApp and `packages/core` channel-neutral. The developer runtime owns a typed adapter registry, a direct child-process runner, approved-workspace validation, and a JSON session store; each vendor adapter owns only its executable lookup, argv construction, session handling, and output parsing.

**Tech Stack:** TypeScript, Node.js `child_process`/`fs`, Node test runner, existing `WorkspacePolicy` and `EventBus`, no new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-10-developer-agent-runtime-design.md`

## Global Constraints

- Never invoke a shell or accept an arbitrary command string from WhatsApp.
- Developer agents may operate only inside configured workspace roots.
- Do not automatically install agents or fake availability.
- Store only conversation-to-native-session mappings in `data/developer-agent-sessions.json` by default.
- Preserve separate state for each `(channel, conversationId)` and never cross agent/workspace mappings.
- Emit `AgentExecutionStarted` and exactly one terminal `AgentExecutionCompleted` or `AgentExecutionFailed` event per attempt.
- Keep chatbot runtime and WhatsApp transport free of developer-agent imports/product knowledge.
- Use the standard library and existing dependencies; do not add a CLI SDK.
- Every non-trivial execution/security/persistence branch must have a runnable test.

---

### Task 1: Define developer-agent contracts and persistent session storage

**Files:**
- Create: `runtime/developer-agent/src/contracts.ts`
- Create: `runtime/developer-agent/src/sessions.ts`
- Modify: `packages/core/src/index.ts: Route`
- Test: `test/developer-agent-sessions.test.ts`

**Interfaces:**
- Consumes: `WorkspacePolicy` from `packages/security`, `EventBus` from `packages/events`, and existing `Route`/`AgentResponse` contracts.
- Produces: `DeveloperAgentAdapter`, `DeveloperAgentRequest`, `DeveloperExecutionContext`, `DeveloperAgentResult`, `DeveloperAgentAvailability`, `DeveloperProcessRunner`, `DeveloperProcessSpec`, `DeveloperProcessResult`, `DeveloperSessionState`, `DeveloperSessionStore`, `InMemoryDeveloperSessionStore`, and `JsonDeveloperSessionStore`.

- [ ] **Step 1: Write failing contract/session tests**

  Add tests that assert:

  ```ts
  const store = new InMemoryDeveloperSessionStore();
  await store.set("whatsapp:conversation-a", {
    agentId: "claude",
    nativeSessionId: "session-a",
    workspaceRoot: "/approved/workspace",
    updatedAt: "2026-09-10T00:00:00.000Z"
  });
  assert.deepEqual(await store.get("whatsapp:conversation-a"), expected);
  assert.equal(await store.get("whatsapp:conversation-b"), undefined);
  ```

  Also assert that `JsonDeveloperSessionStore` reloads the mapping in a new instance, writes a valid JSON object, rejects malformed JSON with a named error, and keeps keys containing `:` isolated.

- [ ] **Step 2: Run the focused tests and confirm they fail**

  Run: `npm run build && node --test --experimental-strip-types test/developer-agent-sessions.test.ts`

  Expected: FAIL because the new contracts and store are not defined.

- [ ] **Step 3: Add the minimal typed contracts**

  Define the adapter interface with the requested shape plus a structured availability method:

  ```ts
  export interface DeveloperAgentAdapter {
    readonly id: string;
    isAvailable(): Promise<boolean>;
    getAvailability(): Promise<DeveloperAgentAvailability>;
    execute(request: DeveloperAgentRequest, context: DeveloperExecutionContext): Promise<DeveloperAgentResult>;
  }
  ```

  `DeveloperAgentRequest` must contain `prompt`, `conversationId`, optional `sessionId`, `timeoutMs`, and `maxOutputBytes`; it must not contain an executable, argv, or shell command. `DeveloperExecutionContext` must contain `correlationId`, validated `workingDirectory`, `WorkspacePolicy`, `AbortSignal`, `EventBus`, and `DeveloperProcessRunner`.

  `DeveloperSessionStore` must expose `load(): Promise<void>`, `get(key)`, and `set(key, state)`. `load()` is idempotent so the runtime can safely call it before each serialized turn; the in-memory implementation is a no-op.

  Model `DeveloperAgentResult` as `status: "completed" | "failed"`, with success text/session ID or a stable failure reason (`unavailable`, `workspace-rejected`, `timeout`, `cancelled`, `exit-nonzero`, `output-limit`, `invalid-output`, `execution-failed`) and bounded process metadata.

- [ ] **Step 4: Implement in-memory and atomic JSON session stores**

  Use the key `${channel}:${conversationId}`. `JsonDeveloperSessionStore.load()` reads an absent file as empty, parses an object of `DeveloperSessionState`, and throws `DeveloperSessionStateError` for malformed data. `set()` creates the parent directory, writes `${path}.tmp` in the same directory, then renames it over the target. Do not persist prompts, stdout, stderr, credentials, or arbitrary metadata.

  Use a small in-process per-conversation lock and document its ceiling at the queue declaration: `// ponytail: in-process queue; use distributed per-conversation locks if the runtime becomes multi-process.`

- [ ] **Step 5: Add trusted workspace selection to `Route` and preserve existing callers**

  Add optional `workspaceRoot?: string` to `Route`. Existing route JSON and tests remain valid. The gateway will later copy this trusted configuration value into `ExecutionContext`; no message field will be used.

- [ ] **Step 6: Run the focused tests and commit**

  Run: `npm run build && node --test --experimental-strip-types test/developer-agent-sessions.test.ts`

  Expected: PASS.

  Commit: `git add runtime/developer-agent packages/core/src/index.ts packages/conversations/src/index.ts test/developer-agent-sessions.test.ts && git commit -m "feat: add developer-agent contracts and session store"`

### Task 2: Implement the direct process runner and executable availability lookup

**Files:**
- Create: `runtime/developer-agent/src/process.ts`
- Modify: `runtime/developer-agent/src/contracts.ts`
- Test: `test/developer-agent-process.test.ts`

**Interfaces:**
- Consumes: `DeveloperProcessRunner`, `DeveloperProcessSpec`, and `DeveloperProcessResult` from Task 1.
- Produces: `NodeDeveloperProcessRunner`, `resolveDeveloperExecutable`, and `DeveloperProcessError`.

- [ ] **Step 1: Write failing fake-runner-independent process tests**

  Test the exported argument-safe lookup and the real runner using a known Node executable with a fixed `-e` script:

  ```ts
  const result = await new NodeDeveloperProcessRunner().run({
    executable: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    cwd: approvedRoot,
    timeoutMs: 1000,
    maxOutputBytes: 100
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "");
  ```

  Add tests for stderr capture, non-zero exit, timeout, an already-aborted signal, stdout cap/truncation, and rejection when `cwd` is outside the approved root. Use a temporary directory under a test-approved root and clean it up in the test.

- [ ] **Step 2: Run focused tests and confirm failure**

  Run: `npm run build && node --test --experimental-strip-types test/developer-agent-process.test.ts`

  Expected: FAIL because the runner is not defined.

- [ ] **Step 3: Implement direct process execution**

  Use `spawn(executable, args, { cwd })`, never `{ shell: true }`. Accumulate stdout/stderr as byte-limited `Buffer` chunks, kill the child once either stream exceeds `maxOutputBytes`, and resolve exactly once with exit code, signal, duration, and termination reason. Wire `AbortSignal` to child termination and clear timeout/listeners on completion.

  The runner receives a validated directory from the runtime but still rejects a missing/invalid cwd before spawn. It must not execute lookup commands through the shell.

- [ ] **Step 4: Implement platform-native executable lookup**

  `resolveDeveloperExecutable(name)` calls `execFile("where.exe", [name])` on Windows and `execFile("which", [name])` elsewhere. Return the first non-empty path; return `undefined` on `ENOENT` or non-zero lookup. `NodeDeveloperProcessRunner` and adapters must pass executable and args as separate values.

- [ ] **Step 5: Run focused tests and commit**

  Run: `npm run build && node --test --experimental-strip-types test/developer-agent-process.test.ts`

  Expected: PASS.

  Commit: `git add runtime/developer-agent/src/contracts.ts runtime/developer-agent/src/process.ts test/developer-agent-process.test.ts && git commit -m "feat: add safe developer-agent process runner"`

### Task 3: Implement Claude, Codex, and Copilot adapters

**Files:**
- Modify: `developer-agents/claude/src/index.ts`
- Modify: `developer-agents/codex/src/index.ts`
- Modify: `developer-agents/copilot/src/index.ts`
- Test: `test/adapters.test.ts`

**Interfaces:**
- Consumes: `DeveloperAgentAdapter`, request/context/result contracts, `resolveDeveloperExecutable`, and injected fake `DeveloperProcessRunner`.
- Produces: `claudeAdapter`, `codexAdapter`, and `copilotAdapter`.

- [ ] **Step 1: Replace placeholder tests with adapter contract tests**

  Build one fake runner that records `{ executable, args, cwd }` and returns representative vendor output. Assert each adapter:

  - reports `false` and `executable-missing` when lookup returns no path;
  - uses its own fixed executable and argv;
  - passes the prompt as one typed value, not interpolated flags;
  - uses a stored session ID on the second request;
  - extracts native session ID and final response text;
  - returns `invalid-output` for malformed vendor output.

  Use exact examples from the supported CLIs: Claude print/JSON mode with `--resume`, Codex `exec` JSON mode and `exec resume`, and Copilot prompt/silent mode with exact `--session-id`/resume behavior.

- [ ] **Step 2: Run adapter tests and confirm the old placeholders fail the new expectations**

  Run: `npm run build && node --test --experimental-strip-types test/adapters.test.ts`

  Expected: FAIL because the current exports return placeholder text and do not implement adapter execution.

- [ ] **Step 3: Implement Claude adapter**

  Resolve `claude` once per availability call. Build initial argv as fixed print mode plus JSON output and the prompt; build resumed argv with the stored native session ID. Parse the documented JSON result, preserving its returned session ID and final text. Convert missing executable into a structured unavailable result; never add `--dangerously-skip-permissions`.

- [ ] **Step 4: Implement Codex adapter**

  Resolve `codex`. Build non-interactive `exec` JSON argv with the validated cwd/workspace sandbox flags; build resumed argv with `exec resume <sessionId>`. Parse JSONL/event output for the thread ID and final assistant message. Keep all permission/sandbox flags in this adapter and do not accept them from `DeveloperAgentRequest`.

- [ ] **Step 5: Implement Copilot adapter**

  Resolve `copilot`. Generate a UUID for a new session and pass it as the exact session ID; use that same ID for later turns, with prompt/silent flags. Parse the final response while retaining the session ID. Do not use broad permission-bypass flags.

- [ ] **Step 6: Run adapter tests and commit**

  Run: `npm run build && node --test --experimental-strip-types test/adapters.test.ts`

  Expected: PASS, including the existing assertion that the three IDs are registered independently of WhatsApp.

  Commit: `git add developer-agents test/adapters.test.ts && git commit -m "feat: implement Claude Codex and Copilot adapters"`

### Task 4: Integrate adapters, workspace policy, session isolation, lifecycle events, and gateway output

**Files:**
- Modify: `runtime/developer-agent/src/index.ts`
- Modify: `apps/gateway/src/index.ts`
- Modify: `test/runtimes.test.ts`
- Modify: `test/gateway.test.ts`
- Modify: `test/whatsapp-gateway.test.ts`
- Create: `test/developer-agent-runtime.test.ts`

**Interfaces:**
- Consumes: adapter exports from Task 3, session stores from Task 1, process runner from Task 2, existing `Gateway`, `WorkspacePolicy`, and `EventBus`.
- Produces: `DeveloperAgentRuntime` constructor options for adapter registry, session store, process runner, default workspace root, timeout, and output cap; `getAvailability()` for clear diagnostics.

- [ ] **Step 1: Write failing runtime tests**

  Use three fake adapters and a fake process runner to prove:

  ```ts
  const state = new InMemoryDeveloperSessionStore();
  const runtime = new DeveloperAgentRuntime(capabilities, {
    adapters: { claude: claudeAdapter, codex: codexAdapter, copilot: copilotAdapter },
    sessions: state,
    defaultWorkspaceRoot: approvedRoot,
    runner: fakeRunner,
    events
  });
  ```

  Send conversation A to Claude, B to Codex, and C to Copilot; assert each adapter receives only its own session ID and that a second A turn resumes Claude’s session. Create a second runtime with the same JSON store and assert A resumes after restart. Assert an agent/workspace mismatch starts a new session.

  Add tests for start/completed and start/failed event sequences, missing adapter configuration, unavailable adapter response metadata, timeout/cancellation propagation, and workspace rejection before the fake runner is called.

- [ ] **Step 2: Run focused runtime tests and confirm failure**

  Run: `npm run build && node --test --experimental-strip-types test/developer-agent-runtime.test.ts test/runtimes.test.ts`

  Expected: FAIL because the current runtime invokes placeholder `handleMessage` methods and has no session/adapter integration.

- [ ] **Step 3: Implement runtime orchestration**

  Look up the adapter by `agent.id`; resolve the trusted workspace from `context.execution.workspaceRoot`, route `workspaceRoot`, or the runtime default, then call `capabilities.policy.assertPath`. Load the session by `${context.message.channel}:${context.conversation.id}` and resume only when agent ID and workspace match.

  Serialize turns per conversation with a small in-process promise queue so two WhatsApp messages cannot overwrite a session mapping. Different conversation keys may run concurrently. Emit `AgentExecutionStarted` before adapter execution and exactly one terminal event after it. On success, persist the returned session ID and return `{ text, metadata }`. On structured adapter failure, return a safe human-readable error response with stable metadata and publish `AgentExecutionFailed`; do not expose credentials or unlimited stderr.

  Update the existing developer-runtime test to inject a fake adapter. The runtime must not fall back to `ConversationAgent.handleMessage` for configured developer routes; an unregistered adapter is a configuration failure.

- [ ] **Step 4: Pass trusted route workspace into execution context**

  In `Gateway.handle`, set `execution.workspaceRoot` from the resolved route’s optional `workspaceRoot`. Never copy arbitrary fields from the inbound payload. Existing routes without a workspace continue to use the runtime default or receive a clear workspace configuration failure.

- [ ] **Step 5: Verify gateway response pipeline**

  Update the gateway tests to inject a developer runtime with a fake adapter and assert adapter text reaches `channel.send`, while `MessageReceived`, `RouteResolved`, `AgentExecutionStarted`, `AgentExecutionCompleted`, and `MessageSent` occur in order. Assert unavailable CLI responses are clean and structured rather than faked success.

- [ ] **Step 6: Run all runtime/gateway tests and commit**

  Run: `npm run build && node --test --experimental-strip-types test/developer-agent-runtime.test.ts test/runtimes.test.ts test/gateway.test.ts test/whatsapp-gateway.test.ts`

  Expected: PASS.

  Commit: `git add runtime/developer-agent/src/index.ts apps/gateway/src/index.ts packages/events/src/index.ts test/developer-agent-runtime.test.ts test/runtimes.test.ts test/gateway.test.ts test/whatsapp-gateway.test.ts && git commit -m "feat: integrate isolated developer-agent runtime"`

### Task 5: Document configuration, run full verification, and refresh project knowledge

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/whatsapp.md` if runtime wiring/configuration is documented there
- Modify: `.planning/STATE.md` and `.planning/ROADMAP.md` only through the repository’s existing GSD workflow/state format
- Create: `test/developer-agent-smoke.test.ts`

**Interfaces:**
- Consumes: completed runtime, adapters, tests, and the approved design spec.
- Produces: documentation showing trusted workspace/session configuration and truthful availability diagnostics.

- [ ] **Step 1: Update architecture documentation**

  Replace the statement that CLI process spawning and persistent conversation storage are deferred. Document the adapter registry, direct argv-only process boundary, default session JSON path, approved workspace roots, failure states, and the fact that chatbot runtime remains unable to import developer adapters.

- [ ] **Step 2: Add gated installed-CLI smoke checks**

  Call each adapter’s `getAvailability()` first. When unavailable, mark that agent’s test skipped with the executable name/reason; never assert success. When available, run only a minimal non-destructive prompt in a temporary approved workspace with a short timeout and bounded output. Do not make the full test suite depend on external credentials or all three CLIs.

- [ ] **Step 3: Run the full verification loop**

  Run in order:

  ```bash
  npm run build
  npm test
  graphify update .
  ```

  Inspect the focused failures if any, fix implementation-caused failures, then rerun the complete command. Confirm `git diff --check` is clean and no WhatsApp/core/chatbot boundary test regressed.

- [ ] **Step 4: Update GSD state and commit**

  Record the completed runtime phase, verification counts, unavailable installed-CLI status, and any deliberate limitations in the existing `.planning` artifacts. Commit the docs, tests, planning state, and Graphify refresh with:

  `git add docs .planning graphify-out test && git commit -m "docs: record developer-agent runtime verification"`

## Final verification checklist

- [ ] Claude adapter executes through the real CLI when `claude` is installed.
- [ ] Codex adapter executes through the real CLI when `codex` is installed.
- [ ] Copilot adapter executes through the real CLI when `copilot` is installed.
- [ ] Missing CLI produces a structured unavailable result with no installation attempt.
- [ ] Conversation A/B/C session mappings remain isolated and survive runtime restart.
- [ ] Workspace roots reject outside paths before any process spawn.
- [ ] No WhatsApp-originated arbitrary command string reaches an adapter or child process.
- [ ] Timeout, cancellation, output caps, stderr, exit code, and lifecycle events are observable.
- [ ] Successful output reaches the existing gateway/channel response pipeline.
- [ ] `npm test`, `npm run build`, and Graphify refresh complete successfully.
