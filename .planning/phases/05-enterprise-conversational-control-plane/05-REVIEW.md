---
phase: 05-enterprise-conversational-control-plane
reviewed: 2026-09-11T13:32:53Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - .env.example
  - apps/gateway/src/application.ts
  - apps/gateway/src/doctor.ts
  - apps/gateway/src/whatsapp.ts
  - channels/whatsapp/src/config.ts
  - channels/whatsapp/src/lifecycle.ts
  - developer-agents/claude/src/index.ts
  - developer-agents/codex/src/index.ts
  - packages/control-plane/src/index.ts
  - packages/control-plane/src/persistence.ts
  - packages/events/src/index.ts
  - runtime/developer-agent/src/contracts.ts
  - runtime/developer-agent/src/index.ts
  - runtime/developer-agent/src/sessions.ts
findings:
  critical: 9
  warning: 8
  info: 0
  total: 17
status: resolved
---

# Phase 5: Code Review Report

**Reviewed:** 2026-09-11T13:32:53Z  
**Depth:** deep  
**Files Reviewed:** 14  
**Status:** issues_found

## Summary

The initial deep review identified 17 findings. All 9 blockers and 8 warnings were addressed in the follow-up hardening pass and covered by adversarial regression tests; the final suite is green.

## Remediation

- Owner/channel scoping, closed-chat reactivation, malformed-command handling, role gates, and default workspace validation were tightened.
- Idempotency now uses an atomic per-store claim/release path, with queue admission releasing rejected claims.
- Queued tasks share the same terminal finalizer as immediate tasks; cancellation drains pending work before allowing another task to start.
- Provider bindings are deleted on reset, persisted prompts are omitted from disk, persistence validation is referential, doctor loads state, and reconnect listeners are generation-scoped.

## Critical Issues

### CR-01: Foreign external sessions are returned to the caller

**Severity:** BLOCKER  
**File:** `packages/control-plane/src/index.ts:403-409`

**Issue:** `resolveSession` checks `external.ownerId` but returns `external` unconditionally at line 409 when the owner does not match and there is no valid owned selection. A user sharing an external conversation can therefore inspect, rename, select, or submit provider prompts to another owner's logical session. This directly breaks owner scoping and can spawn a provider for the wrong identity.

**Fix:** Return `undefined` after the owner check; only return a selected session after verifying both owner and channel, and reject the request before any command or execution path.

### CR-02: `/init` can take over another owner’s chat and cannot reactivate closed chats

**Severity:** BLOCKER  
**File:** `packages/control-plane/src/index.ts:214-229`

**Issue:** `/init` uses `findByExternal`, which returns the first non-closed session without checking `ownerId`, then mutates and saves it. Any authorized participant in a shared WhatsApp group can rename/reselect another owner's chat. Conversely, the repository lookup excludes `CLOSED` sessions, so `/init` creates a new logical session instead of reactivating the closed one, leaving its provider bindings orphaned.

**Fix:** Look up all sessions for the external key and only reuse one owned by the identity; make reactivation explicitly transition the owned closed record to `READY_NO_AGENT` (or add an owner-scoped reactivation method) instead of creating a duplicate.

### CR-03: Queued executions never finalize managed state

**Severity:** BLOCKER  
**File:** `packages/control-plane/src/index.ts:353-400`

**Issue:** Only the `result.started` caller executes the terminal state update at lines 383-400. A queued task runs the provider and optionally sends its response at line 373, but never updates the session to `IDLE`/`ERROR`, records its provider binding, clears/sets `lastError`, or publishes its terminal execution event. After the queue drains, the persisted chat can remain `RUNNING` forever, and queued provider sessions are absent from managed bindings.

**Fix:** Put one completion/failure finalizer around every queue task and invoke it for both immediate and deferred executions. The queue should return the task result to that finalizer rather than making deferred work fire-and-forget.

### CR-04: Cancellation can start a queued task after cancelling the active task

**Severity:** BLOCKER  
**File:** `packages/control-plane/src/index.ts:481-499`

**Issue:** `active.promise` runs its `finally` handler before the promise continuation in `cancel()` resumes. That handler shifts and starts the next pending task at lines 495-498; `cancel()` then removes only the remaining pending items at line 486. Thus `/cancel` can return after the active process is aborted while the next task has already started, despite the method explicitly rejecting the pending queue.

**Fix:** Add a cancellation generation/flag checked by the `finally` path, or detach and reject pending work before awaiting termination, and ensure no next task is started while cancellation is draining the queue.

### CR-05: Idempotency is racy and consumes messages rejected for queue overflow

**Severity:** BLOCKER  
**File:** `packages/control-plane/src/index.ts:157-165, 376-381`

**Issue:** `has()` followed by `record()` is not an atomic repository operation. Two concurrent calls with the same message ID can both pass the check and execute. In addition, the record is written before queue admission; a full queue returns an error at line 377, but a retry with the same message ID is then treated as a duplicate and permanently lost. The repository contract has no claim/insert-if-absent operation.

**Fix:** Add an atomic `claim(messageKey)` operation, keyed at least by channel and external message ID, and claim only after admission succeeds (or explicitly store/replay a durable rejection result).

### CR-06: A malformed slash message can reach the provider

**Severity:** BLOCKER  
**File:** `packages/control-plane/src/index.ts:88-90, 166-186`

**Issue:** `parse()` returns `undefined` for `/` or whitespace-only slash input. Once a chat has an active agent, the non-command branch treats that text as an ordinary prompt and calls `executePrompt`. The design requires malformed slash commands to produce deterministic help and never reach a provider.

**Fix:** Detect `^\s*\/` before the ordinary-text branch; if parsing fails, return the deterministic unknown/malformed-command help response.

### CR-07: Role configuration can promote viewers to owners and ordinary prompts have no role gate

**Severity:** BLOCKER  
**File:** `apps/gateway/src/application.ts:226-233`; `packages/control-plane/src/index.ts:182-186`

**Issue:** When `AGENT_REMOTE_OWNER_IDS` is absent, `WHATSAPP_ALLOWED_USERS` is used as the owners list before viewer/operator overrides are checked. An allowlisted user explicitly placed in `AGENT_REMOTE_VIEWER_IDS` is still returned as `owner`. When only a chat allowlist is configured, any participant accepted by that chat allowlist falls through to `owner`. Separately, ordinary text execution performs no required-role check, so a viewer associated with an initialized session can invoke a provider.

**Fix:** Resolve explicit role override lists first, then apply the allowlist owner default only to identities with no explicit role. Require at least `operator` for ordinary provider execution and reject identities not represented by a configured allowlist/role policy.

### CR-08: An invalid default workspace is persisted as malformed control-plane state

**Severity:** BLOCKER  
**File:** `apps/gateway/src/application.ts:83-103`; `packages/control-plane/src/index.ts:214-221, 412-415`

**Issue:** `loadApplicationConfig` never validates `AGENT_REMOTE_DEFAULT_WORKSPACE` against the approved roots. If it is outside them, `resolveWorkspace()` returns `undefined`; the non-null assertion at line 220 does nothing at runtime, and `/init` saves a conversation without the required `workspace` field. JSON persistence then writes a state file that the next startup rejects as malformed.

**Fix:** Validate the resolved default workspace while loading configuration and fail startup, or make `/init` return an error before constructing/saving the conversation when workspace resolution fails.

### CR-09: Configured workspace aliases are advertised but never loaded

**Severity:** BLOCKER  
**File:** `.env.example:9`; `apps/gateway/src/application.ts:77-103, 122-130`

**Issue:** `AGENT_REMOTE_WORKSPACE_ALIASES` is documented and shown in the example, but `ApplicationConfig` has no alias field, `loadApplicationConfig` never parses it, and `createApplication` never passes aliases to `ControlPlane`. In the real composition root, `/workspace use <alias>` therefore rejects the configured alias and `/workspaces` cannot list it.

**Fix:** Parse and validate the JSON alias map at the configuration boundary, resolve each value through `WorkspacePolicy`, and pass the validated map as `workspaceAliases`.

## Warnings

### WR-01: Stale session clones can overwrite concurrent agent/model/workspace changes

**Severity:** WARNING  
**File:** `packages/control-plane/src/index.ts:250-312, 353-421`

**Issue:** Commands and executions operate on repository-returned clones. Agent/workspace/model commands are allowed while a run is active, but the active or queued clone later calls `touch()` and saves its old snapshot. A completed run can silently revert a newer workspace or agent selection, and queued work can run with stale policy selections.

**Fix:** Serialize state mutations per logical session, disallow selection changes while running, or merge terminal execution fields into the latest repository record instead of saving an old full object.

### WR-02: `/reset` leaves the durable provider binding stale

**Severity:** WARNING  
**File:** `packages/control-plane/src/index.ts:268-273`; `packages/control-plane/src/persistence.ts:39-42, 198-201`

**Issue:** Reset deletes the in-memory `providerSessionIds` entry and asks the runtime to delete its native session, but never removes the corresponding `ProviderSessionRepository` record. The persisted control-plane state continues to advertise the old native session, and the optional runtime `delete` method can make reset a silent no-op for custom stores.

**Fix:** Add an explicit provider-binding delete operation and make reset atomically clear both stores; do not claim success when the runtime store cannot delete.

### WR-03: Doctor reports a corrupt state file as healthy/path-only

**Severity:** WARNING  
**File:** `apps/gateway/src/doctor.ts:33-35`; `packages/control-plane/src/persistence.ts:247-259`

**Issue:** Doctor only checks read/write access to the control-plane path and never loads or validates the JSON envelope. A malformed file therefore reports `PASS` if accessible, while startup later fails closed with `ControlPlaneStateError`; the required actionable corruption diagnostic is not exposed by `/doctor` or `npm run doctor`.

**Fix:** Instantiate/load the control-plane store in the doctor check and report malformed/unreadable state as `FAIL` with the bounded `ControlPlaneStateError` message.

### WR-04: Cross-channel chat selection breaks provider isolation and response routing

**Severity:** WARNING  
**File:** `packages/control-plane/src/index.ts:241-247, 403-409`; `runtime/developer-agent/src/index.ts:66-74`; `apps/gateway/src/application.ts:131-132`

**Issue:** `/chat` searches all owner sessions without restricting the selected session to the current channel. The runtime session key uses `context.message.channel`, while the managed session carries another channel, and the composition callback always sends deferred responses through WhatsApp. A future channel can therefore execute in the wrong native-session namespace and receive/misroute the response on WhatsApp.

**Fix:** Restrict selection/execution to the current channel, or carry an explicit target channel sender/renderer with the execution and derive the native key from the managed session’s channel consistently.

### WR-05: Persistence validation accepts inconsistent or effectively empty records

**Severity:** WARNING  
**File:** `packages/control-plane/src/persistence.ts:275-303`

**Issue:** The “full-shape” validator checks types only. It does not require non-empty IDs, verify that the map key equals `logicalSessionId`, validate provider/session key structure, or ensure selections reference an owned non-closed conversation. Corrupt state with inconsistent identities and dangling selections is exposed instead of failing closed.

**Fix:** Validate non-empty identifier/timestamp fields, key/value consistency, allowed agent/model values, and selection referential ownership before hydration.

### WR-06: Raw user prompts are persisted in the control-plane JSON file

**Severity:** WARNING  
**File:** `packages/control-plane/src/persistence.ts:20-21, 240`; `packages/control-plane/src/index.ts:360-364`

**Issue:** Every prompt is stored as `lastPrompt` to support retry and is written verbatim to the default local JSON state. Prompts can contain credentials or other sensitive material, so the implementation creates a durable plaintext secret sink even though operational output is otherwise sanitized.

**Fix:** Store only a bounded/redacted retry token or opt-in encrypted prompt storage; at minimum do not persist raw prompts by default and document the retry tradeoff.

### WR-07: Reconnecting sockets retain old event listeners

**Severity:** WARNING  
**File:** `channels/whatsapp/src/lifecycle.ts:204-210, 249-264, 319-324`

**Issue:** On an unexpected close, the old socket is dropped from `this.socket` but its listeners are not removed. If it emits delayed `messages.upsert` or another close after reconnect, it can process messages through a dead connection or schedule duplicate reconnects. This undermines channel-level idempotency and can duplicate control-plane intake.

**Fix:** Remove listeners from the closing socket before replacing it, and guard event handlers with the socket instance/generation that created them.

### WR-08: Queue cancellation does not reject new work during `CANCELLING`

**Severity:** WARNING  
**File:** `packages/control-plane/src/index.ts:172-186, 331-339`

**Issue:** The state is set to `CANCELLING`, but ordinary messages do not check that state and can be enqueued while cancellation is awaiting process termination. This compounds CR-04 and can admit work that the caller reasonably expects cancellation to prevent.

**Fix:** Reject ordinary prompts while the session is `CANCELLING`, and only return to `IDLE`/`ERROR` after the queue has completed its cancellation transition.

---

_Reviewed: 2026-09-11T13:32:53Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: deep_
