# Task 2 Report: Bounded Agent Message Registry

## RED

Added `test/whatsapp-agent-registry.test.ts` before production implementation and ran:

```text
npm run build && node --test --experimental-strip-types test/whatsapp-agent-registry.test.ts
```

The build passed, then the test failed because the required compiled module did not exist:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../dist/channels/whatsapp/src/agent-registry.js
tests 1
pass 0
fail 1
```

This is the expected missing-registry RED failure.

## GREEN

Implemented the smallest bounded registry in `channels/whatsapp/src/agent-registry.ts`:

- `Map<string, AgentGeneratedMessageMetadata>` keyed by exact WhatsApp message ID.
- Positive `maxEntries` and `ttlMs` validation.
- TTL pruning on `remember`, `get`, `has`, and `snapshot`.
- Oldest-entry eviction at fixed capacity.
- Defensive cloning of metadata and nested `origin` objects on write/read.
- No text, prompts, provider JSON, or Baileys objects stored.

Integrated it into `WhatsAppChannel` while preserving the separate native `replyContexts` store. Successful Baileys send IDs are recorded with conversation, `MessageOrigin`, exact `replyTo.messageId`, and creation time. The public `agentMessageRegistry()` method returns metadata-only snapshots. Self-message suppression now checks the registry, preserving acceptance of untracked manual `fromMe` prompts in one-number mode.

## Verification

Focused command:

```text
npm run build && node --test --experimental-strip-types test/whatsapp-agent-registry.test.ts test/realtime-whatsapp.test.ts test/whatsapp-channel.test.ts test/whatsapp-translation.test.ts
```

Result: 21 tests passed, 0 failed.

Full command:

```text
npm test
```

Result: 152 tests, 150 passed, 0 failed, 2 skipped.

Also ran `graphify update .`; the code graph refreshed successfully.

## Commit scope

Committed source and test changes only. Graphify-generated files remain as worktree changes from the required refresh and were not included in the task commit.

## Round 1 Fix

Addressed the review finding by requiring finite positive `maxEntries` and `ttlMs` values. Added focused tests covering `NaN`, positive infinity, zero, and negative bounds, plus defensive metadata cloning.

Focused verification:

```text
npm run build && node --test --experimental-strip-types test/whatsapp-agent-registry.test.ts test/realtime-whatsapp.test.ts test/whatsapp-channel.test.ts test/whatsapp-translation.test.ts
```

Result: build passed; 23 tests passed, 0 failed.

Full verification:

```text
npm test
```

Result: 154 tests, 152 passed, 0 failed, 2 skipped.
