# WhatsApp Chat Context Design

## Status

Approved design for implementation. This feature lets the owner ask an agent
about another WhatsApp chat without making that chat an agent conversation.

## Goal

Given a message such as:

```text
/chat viaje planifica el itinerario usando lo que hablamos
/chat pedido qué precio y fecha acordamos
```

the gateway resolves the partial chat name, retrieves the locally imported
history for that WhatsApp conversation, and sends a bounded, clearly labelled
transcript plus the question to the active developer agent in the current
managed chat.

The current chat remains the response destination. The referenced chat is only
the information source. Ordinary messages continue to use only their current
managed session and never search other chats implicitly.

## Scope and decisions

- Import history visible to the linked WhatsApp account from Baileys history
  sync events and ingest new messages as they arrive.
- Make all imported chats addressable by the authorized owner, including
  private chats and groups. The existing inbound allowlist still controls who
  may operate the gateway; the query command is not exposed to unauthorized
  senders.
- Store text, timestamps, sender IDs, conversation IDs, group IDs, and
  attachment descriptors. Do not download or persist media binaries in this
  feature.
- Use local JSONL/JSON persistence and Node standard-library facilities. Do
  not add SQLite, a vector database, or another dependency in v1.
- Keep the existing `/chat <name|id>` managed-session selection when no
  question follows the target. With a question, use `/chat <partial-name>
  <question>` for cross-chat context.
- If the target matches more than one chat, return the matching names/IDs and
  do not invoke an agent. The user can repeat the command with a more specific
  name or ID.
- `/chat` without arguments lists a bounded set of imported chat names and
  IDs, separate from the existing managed-session `/chats` list.
- If no target is provided, list imported chats (or return deterministic usage
  text when that listing is unavailable).
- Imported chat content is untrusted data. The prompt wrapper must instruct the
  provider to treat transcript text as reference material, not executable
  instructions.
- The v1 retrieval ceiling is bounded: lexical matches plus a recent window,
  capped by message count and characters. The response must identify the
  referenced chat and state when only a bounded excerpt was supplied.

Baileys does not guarantee that every historical message is available on every
connection. The implementation reports imported coverage and must not claim
that a chat is complete when WhatsApp supplied only a partial history. The
first implementation consumes all `messaging.history-set` data delivered by
the linked account; on-demand paging through `fetchMessageHistory` is outside
this slice unless the current Baileys socket contract makes it safe to add
without inventing an unreliable cursor protocol.

## Architecture

### WhatsApp channel

Extend the channel boundary to observe two sources:

1. `messaging.history-set` for batches of previously available messages and
   chat metadata.
2. `messages.upsert` for new messages.

Both paths use the existing WhatsApp translation rules. History ingestion may
translate self-sent messages because they are data from the authenticated
account; it must not route those imported messages to the agent or emit
responses.

The channel sends normalized messages and chat metadata to a history store
through a narrow callback/interface. It continues forwarding only authorized
live inbound messages to the control plane.

### Local history store

Add a small channel-neutral history contract with a JSON-backed implementation:

- `upsert(message, displayName?)` deduplicates by `(channel, conversationId,
  messageId)`.
- `upsertChat(chatId, displayName, kind)` records names from history metadata.
- `findChats(query)` performs case-insensitive partial matching over display
  name and ID.
- `query(chatId, question, limits)` returns lexical matches and a recent
  window in chronological order, plus coverage metadata.

Messages are written as append-only records under `data/` with file mode 0600;
chat metadata and any compact index use the same local-only policy. Writes are
serialized, malformed records are skipped with a diagnostic, and a temporary
write is never allowed to replace a healthy store with partial content. The
files remain ignored and are never included in Git, Graphify, or diagnostics.

The retrieval implementation may scan JSONL for v1. This is intentionally a
known `ponytail:` ceiling: it is simple and dependency-free, but should be
replaced by SQLite or an indexed search structure if imported history becomes
large enough that query latency or memory pressure is observable.

### Control plane

Add an optional history-query service to `ControlPlaneOptions` and register the
existing `/chat` command with two behaviors:

- `/chat <name|id>` keeps selecting an owned managed agent chat.
- `/chat <name|id> <question>` resolves an imported WhatsApp chat, builds a
  bounded context prompt, and queues that prompt through the current managed
  agent session.

For the short form, the first whitespace-delimited token is the chat lookup
query. A multi-word display name can be addressed with a stable chat ID or a
quoted name, for example `/chat "Viaje con familia" planifica las fechas`.
The implementation must never silently reinterpret a question as part of the
chat name; unresolved or ambiguous input returns a deterministic explanation.

The target chat is not changed in durable session selection. The execution
metadata records the target chat ID/name for safe telemetry, while the provider
prompt contains only the bounded transcript and user question.

The command is owner/operator-only through the existing command registry. Chat
resolution is scoped to the WhatsApp channel and the authenticated account's
history store. No arbitrary filesystem path, database query, or provider tool
is exposed through the command.

### Prompt format

The generated prompt has four sections:

1. `Referenced WhatsApp chat`: resolved display name and stable ID.
2. `Transcript`: timestamped sender-labelled messages, marked as untrusted
   reference data.
3. `Coverage`: imported message count, oldest/newest available timestamps, and
   whether the excerpt was capped.
4. `User question`: the text after the target name.

The agent is instructed to answer from the supplied transcript, distinguish
facts from uncertainty, and say when the requested information is not present.
The wrapper prevents a message in the referenced chat from changing agent
configuration, workspace, permissions, or command behavior.

## Data flow

```text
WhatsApp history-set ─┐
                      ├─> translator ─> local history store
WhatsApp messages ────┘                         │
                                               │
current `/chat ...` ─> command resolver ─> bounded query
                                               │
                              current managed agent session
                                               │
                                      reply in current chat
```

History import is passive. It never calls the control plane, never selects an
agent, and never sends a WhatsApp response. Only an explicit `/chat` question
causes a provider execution.

## Errors and safety

- Unknown chat: return `Chat not found` and suggest `/chats`/a more specific
  name; do not invoke the provider.
- Ambiguous chat: list bounded matches with display names and IDs; do not guess.
- Missing question: return usage text.
- No imported messages: explain that WhatsApp has not supplied history for the
  target yet; do not fabricate context.
- Store read/write failure: log a safe diagnostic and return a short operator
  error without paths, message contents, credentials, or stack traces.
- Provider failure: use the existing safe execution failure response.
- A target transcript is always treated as untrusted input and bounded before
  it crosses into the provider runtime.
- Existing message authorization and self-message suppression remain unchanged
  for live routing.

## Verification

Add focused tests before implementation code:

- history and chat metadata are imported from `messaging.history-set`;
- new live messages are persisted once and duplicate IDs are ignored;
- self-sent imported messages are stored but never routed to an agent;
- partial, case-insensitive name matching works;
- ambiguous matches produce no provider call;
- `/chat name question` queries the selected source while replying in the
  current managed chat;
- `/chat name` retains existing managed-chat selection behavior;
- context limits, chronological ordering, coverage metadata, and prompt
  injection delimiters are enforced;
- unauthorized senders cannot query imported history;
- malformed local records do not prevent startup or corrupt healthy records;
- build, full test suite, Graphify refresh, and a real history-sync smoke check
  are recorded in the phase verification artifact.

## Non-goals for v1

- Downloading WhatsApp media or attachments.
- Semantic/vector search across every chat.
- Exposing an HTTP history API.
- Automatically feeding all chats into every agent prompt.
- Deleting or modifying messages in WhatsApp.
- Claiming complete history when the linked account did not provide it.
