# Enterprise Conversational Control Plane Design

## Context

Phase 4 routes WhatsApp messages directly through a gateway and keeps the
one-number command behavior in `apps/gateway/src/application.ts`. Conversation
metadata is in memory, while developer-agent native session IDs already have a
durable JSON store and per-session serialization. Phase 5 must make command
semantics channel-neutral, preserve the developer/chatbot trust boundary, and
support durable managed conversations without requiring a database server.

## Goals

- Provide one command registry and dispatcher reusable by WhatsApp, Telegram,
  Web, and future Talkaris adapters.
- Enforce authorization and initialization before any provider execution.
- Manage multiple owner-scoped logical conversations with durable metadata.
- Provide explicit agent/model/workspace selection, isolated queues, real
  cancellation, idempotency, lifecycle events, and safe operational output.
- Keep `application.ts` as a composition root and keep channel packages free of
  agent-product and command business logic.
- Preserve separate developer-agent and chatbot runtime capabilities.

## Non-goals

- Deep Telegram, Web, or Talkaris implementations.
- A database server, distributed queue, or distributed coordination mechanism.
- Arbitrary shell/exec commands or arbitrary provider model arguments.
- Replacing the existing developer process runner or provider session mechanism
  beyond the smallest cancellation/model seams required by the control plane.

## Architecture

```text
Channel adapter
  → core Message
  → ControlPlane
       ├─ authorization and command registry
       ├─ managed conversation/state repositories
       ├─ model/workspace policy
       ├─ idempotency and per-session execution queue
       └─ AgentRuntime
  → channel-neutral response
  → channel renderer/sender
```

The control plane accepts a channel-neutral `Message` plus channel-independent
identity/context and returns a channel-neutral result. It does not import
Baileys or any WhatsApp implementation. The WhatsApp adapter remains limited to
payload translation, authorization at the transport boundary, lifecycle, and
response rendering. The application composition root wires repositories,
policies, runtimes, adapters, and the channel.

## Managed conversations and state

Managed conversation metadata is separate from the transport-level conversation
contract and contains:

- `logicalSessionId`, `channel`, `externalConversationId`, and `ownerId`;
- display name, approved workspace, active agent, effective model alias;
- provider session bindings, state, failure metadata, and timestamps.

States are explicit: `UNINITIALIZED`, `READY_NO_AGENT`, `IDLE`, `RUNNING`,
`CANCELLING`, `ERROR`, and `CLOSED`. State transitions are centralized in the
control plane rather than scattered boolean checks.

`/init [name]` creates or reactivates the current transport conversation and
starts it in `READY_NO_AGENT`; it never guesses an agent. `/chats` lists only
sessions owned by the authorized identity. `/chat <name|id>` selects an owned
logical session for subsequent control and execution. `/rename` changes the
display name and `/close` deactivates the session without deleting provider
bindings.

## Command registry

The registry owns command name, aliases, description, usage, category,
initialization requirement, required role, supported states, and handler. The
same metadata generates `/help` and `/help <command>`.

The initial domains are session, agents, workspace, execution, and system. The
dispatcher handles `/init`, `/help`, `/chats`, `/chat`, `/rename`, `/close`,
`/reset`, agent selection, `/agent`, `/model`, workspace commands, `/status`,
`/running`, `/cancel`, `/retry`, `/history`, `/doctor`, `/health`, `/version`,
and `/whoami`.

Before initialization, only `/help`, `/init`, `/status`, and `/whoami` work.
Ordinary text requests `/init`; all other commands are rejected according to
their metadata. An initialized session without an agent requests explicit
selection. Unknown or malformed slash commands return deterministic help text
and never reach a provider.

Agent selection changes the active agent without deleting another provider's
session. Ordinary messages execute on the selected agent. The existing
one-number command system is migrated into this registry; no competing command
path remains in the application or WhatsApp package.

## Models and workspaces

Model selection is explicit configuration plus capability validation. Product
aliases such as `sonnet` and `luna` resolve through configured provider-specific
underlying identifiers; no identifier is invented and no global CLI default is
silently inherited. Missing or invalid configuration is a doctor/startup
failure, and unavailable models produce a concise actionable response.

`/model` displays the effective provider and model alias. Model changes, if
configured, accept only administrator-allowlisted aliases. Workspace selection
accepts configured aliases or paths validated by the existing approved-root
policy. A workspace change changes the provider session isolation key and is
persisted per logical session.

## Authorization and security

Authorization is a policy interface with `owner`, `operator`, and `viewer`
roles. Initial WhatsApp allowlisted users map to owner unless an explicit role
configuration overrides them. Authorization occurs before command dispatch and
before conversation creation where possible; no provider process can spawn for
an unauthorized, uninitialized, closed, or invalid-workspace request.

The developer runtime retains restricted workspace capabilities. Chatbot
runtimes remain unable to import or invoke developer adapters, shell, arbitrary
filesystem, or git operations. High-risk operations have a policy extension
point; no slash command maps directly to shell execution.

## Execution, queues, and cancellation

The control plane owns a bounded queue per logical conversation. Different
logical conversations run concurrently, while one conversation is sequential.
Duplicate external message IDs are rejected idempotently before command or
provider execution. Queued messages receive a position acknowledgement and
overflow is rejected without unbounded memory growth.

Each active execution has a correlation ID and `AbortController`. `/cancel`
aborts only the target conversation, waits for the existing runtime/process
termination result, and reports deterministic requested/completed/no-op status.
Shutdown stops intake, drains for a bounded period, then aborts remaining work.

The existing runtime remains responsible for provider invocation, native session
resume, workspace validation, output/time limits, and child-process termination.
The control plane updates managed provider bindings after successful execution;
the developer session store remains independently durable and isolated.

## Persistence

Repository interfaces separate managed conversations, provider-session bindings,
and idempotency even when the local implementation shares one storage backend.
The local implementation uses a versioned JSON envelope with serialized writes,
same-directory temporary files, and atomic rename. Full-shape validation happens
before state is exposed. Corrupt state fails closed with actionable diagnostics
and is visible to `/doctor`; it is never silently replaced.

## Events and safe output

The control plane emits structured events for command receipt/completion/rejection,
conversation changes, agent/model/workspace selection, queue lifecycle,
execution lifecycle, duplicates, and security denial. Events include safe IDs,
correlation IDs, durations, and bounded failure reasons. Provider stderr,
credentials, WhatsApp auth material, and secret environment values are never
sent to channels or written raw to logs. Channel adapters apply size limits and
safe chunking to responses.

## Verification

Fake adapters and process runners provide deterministic unit/integration tests
for command parsing, generated help, pre-init restrictions, state transitions,
authorization, persistence/restart/corruption, model/workspace policy, queue
isolation, cancellation, idempotency, unknown commands, and
Claude→Codex→Claude session continuity. Static boundary tests assert control
packages do not import WhatsApp/Baileys and chatbot code cannot import developer
adapters. Existing provider, WhatsApp, build, doctor, and smoke tests remain.

Final verification runs `npm run build`, `npm test`, Graphify refresh, doctor,
and the real WhatsApp/provider scenario where credentials and CLIs are
available. Environmental gaps are recorded as `UNVERIFIED`, never as success.

