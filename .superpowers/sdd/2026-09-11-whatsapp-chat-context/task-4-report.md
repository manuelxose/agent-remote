# Task 4 report — persistent WhatsApp chat history

## Delivered

- Added `ApplicationConfig.historyPath`, defaulting to `data/whatsapp-history.jsonl`, with `AGENT_REMOTE_HISTORY_PATH` override support.
- Composed one `JsonHistoryStore` for both WhatsApp history ingestion and control-plane `/chat` queries, loading it before the channel socket starts.
- Added operational tests for both path resolution and channel-to-control-plane history visibility.
- Documented the configuration, `0600` local history file handling, bounded sync coverage, and metadata-only attachment import behavior in the README, WhatsApp guide, and `.env.example`.

## Verification

- RED: `npm run build && node --test --experimental-strip-types test/operational.test.ts` failed with the missing `historyPath` and absent history provider.
- GREEN: the focused operational suite passed: 20 passed, 0 failed.
- Full: `npm test` passed: 193 passed, 0 failed, 2 skipped (unavailable Claude and Copilot CLI smoke tests).

## Concern

- Live WhatsApp Web history coverage remains provider-controlled and was not exercised; the docs state that imported history is not a complete archive.

## Review remediation

- `gatewayFixture` now writes history only to its own temporary directory.
- Existing JSONL history files are chmodded to `0600` during successful load; permission errors still reject the load.
- The operational composition test persists a synced message, restarts the application, and verifies the reloaded transcript reaches the control-plane runtime prompt.
- RED: the new existing-file permission test failed with mode `0644` before the load fix.
- Focused: `npm run build && node --test --experimental-strip-types test/operational.test.ts test/conversations-history.test.ts` passed 32/32.
- Full: `npm test` passed 194, failed 0, skipped 2 unavailable Claude/Copilot CLI smoke tests.
