# Chat Resolution and On-Demand Import Design

## Context

The WhatsApp history index can contain several chats whose names share a
token, such as `Silvia` and `Regalo Silvia`. The current `/chat` flow uses a
partial name query and therefore can select the wrong source or report a
missing source when the desired chat has not been delivered by WhatsApp
history sync. WhatsApp does not expose a safe public API for downloading an
arbitrary old chat by display name; its on-demand history operation requires
an existing message anchor. An exported WhatsApp chat is the reliable
fallback for a chat absent from the index.

## Goals

- Resolve an exact imported display name before considering partial matches.
- Match names and identifiers case-insensitively and accent-insensitively.
- Never select one source silently when multiple imported chats match.
- Present enough stable information for the user to choose the intended
  contact or group.
- Accept an exported WhatsApp text chat as an on-demand import source for any
  private chat or group, preserving the source name and conversation identity.
- Keep imported content on the history path and out of the control-plane
  execution/rate-limit path until the user explicitly asks a question.
- Keep existing managed-chat selection and quoted source syntax compatible.

## Non-goals

- Guessing a chat from a contact name when the name is not present in the
  imported data.
- Re-pairing or unlinking WhatsApp automatically.
- Scraping WhatsApp Web or reading private WhatsApp databases.
- Sending imported transcript contents back to the user unless requested by a
  `/chat` question.
- Replacing the bounded JSONL store with a new database in this change.

## User-facing behavior

### Exact and ambiguous resolution

`/chat Silvia que hemos hablado` first checks an exact imported display name.
It must select `Silvia` even when `Regalo Silvia` also exists. If no exact
match exists, the response lists every partial candidate with a number,
display name, kind, and stable conversation ID, then asks the user to repeat
the command using the full quoted name or ID; a partial-only candidate is
never selected silently. The agent is not invoked while the source is
ambiguous.

Examples:

```text
/chat Silvia que hemos hablado
/chat "Regalo Silvia" resume el pedido
/chat 123456789@s.whatsapp.net resume el chat
```

### Missing source and import

When no indexed chat matches, `/chat` says that the source is not imported
and explains the supported import action:

```text
/importar Silvia
/import Silvia
```

The direct command searches names received through WhatsApp history and
contacts, indexes the exact conversation, and requests on-demand history from
Baileys when a valid message anchor exists. It does not route the command to
the AI. A `.txt` export remains the fallback for a conversation that WhatsApp
has not delivered to the linked device. The parser recognizes the standard
locale-independent shape where each line begins with a date/time prefix
followed by ` - ` and a sender separator (`: `), while preserving
unrecognized lines as continuations of the prior message. It creates or
updates one history chat using the supplied file name as display name. Group
exports remain one chat and do not become separate sender chats. Malformed or
unsupported files return a bounded error without writing partial records.

The existing full WhatsApp history sync remains enabled for chats delivered
by the linked device. Direct import can only fetch a chat that WhatsApp has
identified to the linked device and for which Baileys has a history anchor;
the export fallback exists for an arbitrary absent chat.

## Data flow

```text
WhatsApp message or exported .txt
  -> transport validation
  -> chat resolver / importer
  -> bounded HistoryStore upserts
  -> exact/ambiguous /chat resolution
  -> explicit user question
  -> managed provider execution with bounded transcript
```

Imported messages are never passed to `ControlPlane.handle` as inbound
prompts. The importer must validate file size, line count, dates, sender
fields, and destination channel before persistence. Persistence remains
atomic at the store boundary and retains the existing file permission policy.

## Implementation boundaries

- `packages/control-plane/src/index.ts`: exact-first source resolution,
  normalized matching, and unambiguous candidate formatting.
- `packages/conversations/src/history.ts`: normalized matching support and
  atomic import-oriented upsert behavior if the existing store primitives are
  insufficient.
- `channels/whatsapp/src/translate.ts` and `channels/whatsapp/src/lifecycle.ts`:
  expose only the minimum validated document/text payload needed by the
  importer; never expose Baileys objects to the control plane.
- `apps/gateway/src/application.ts`: register the importer and route its
  result to history persistence, not agent execution.
- `test/control-plane.test.ts`, `test/conversations-history.test.ts`, and
  `test/whatsapp-channel.test.ts`: exact precedence, ambiguity, accents,
  import parsing, malformed input, atomic failure, and no-provider-routing
  coverage.

## Error handling and security

- Exact ties by normalized display name remain ambiguous and require an ID.
- Candidate output is limited to a small number and contains no message text.
- Import files have a fixed byte and line limit; oversized input is rejected
  before persistence.
- Imported transcript text is treated as untrusted reference data by the
  existing history prompt boundary.
- A failed import leaves the previous history file and in-memory index
  unchanged.
- The existing owner, allowlist, rate-limit, and workspace policies remain
  unchanged.

## Verification

- Unit tests prove exact names beat partial names and normalization handles
  accents/case.
- Unit tests prove ambiguous names never execute a provider.
- Import tests prove private and group exports create one source with ordered
  messages, continuations, bounded input, and atomic failure.
- Full `npm test`, `npm run build`, `git diff --check`, and `graphify update .`
  must pass before deployment.
