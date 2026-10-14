# Session ledger rows

One JSON object per file: `<YYYYMMDDTHHMMZ>-<session_id>.json`, same row schema
as the frozen `../session-ledger.jsonl` (see `src/reports/sessionLedger.ts`).
The file name's `session_id` must equal the row's, and ids are unique across
the legacy file and this directory. `pnpm check:session-ledger` validates both.
