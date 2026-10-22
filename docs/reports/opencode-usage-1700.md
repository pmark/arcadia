# OpenCode observed usage — Issue #1700

The operator asked to solve OpenCode usage, starting in Hacker mode and considering an in-session export if no public quota API or CLI existed. No governed Action exists for this direct request. The active Plan, queue, runtime and production policy were not changed. Production remains Off; this change supplies diagnostic accounting, not admission authority.

## Result and executable QA

The shared helper accepts exactly one explicit local source:

```sh
node --import tsx src/cli.ts provider-usage --opencode-session ses_EXPLICIT_ID --json > usage.json
node --import tsx src/cli.ts provider-usage --opencode-export /absolute/path/existing-export.json --json > usage.json
```

Choose an existing session you intend to inspect or an existing export file. Do not launch a model to obtain usage. Session collection requires OpenCode on PATH, Python 3 and a Unix PTY (macOS/Linux); otherwise use an explicit export file. Neither operation discovers a session or falls back. Omit both options to verify no OpenCode collection. Supplying both produces a validation refusal. The command is read-only/no-record, preserving the existing CLI classification.

Inspect `data.providers[2].sessionUsage` in JSON output. A valid export has observation `local_export`; account observation stays `unsupported`, account windows stay empty, and accountQuota/accountBinding remain null/unknown. Each deduplicated step retains provider/model, hashed identifiers, separate numeric token buckets and OpenCode-reported model cost. Unknown fields, transcript content, tools, paths, errors and credentials are not emitted. No transcript intermediate is written. A redirected output file contains the safe usage projection. Check `observation`/`outcome`; CLI success alone does not establish a usable reading.

Coverage counts distinguish complete accounting of the exported assistant messages from partial observed metered usage. Failed, unfinished or unmetered turns make coverage partial, and observed amounts are a lower bound. `complete` does not prove the session ended. No metered steps is unavailable. Invalid metrics, conflicting duplicate steps, malformed/truncated JSON, oversized input and future source timestamps refuse all step output. Duplicate identical parts are counted once. No message totals are added to step totals; reasoning/cache buckets and absent total remain explicit.

The collector drains sanitized export output in memory through a PTY, with an 8 MiB limit and a 15-second export deadline. Failure kills the child process group and reaps the exporter. CLI stderr and exceptions are not echoed. File import bounds reads, requires a regular file and passes through the same reducer. Session-update and latest assistant-completion timestamps are separate; collection time is not source completion.

## Evidence and corrections

Read-only research on installed OpenCode 1.16.2 found local `stats` and sanitized JSON export, not a public Go remaining-quota command. The initial sandbox stats attempt failed on `PRAGMA wal_checkpoint(PASSIVE)`; the same documented CLI read succeeded through ordinary host permission. No raw database access or credential fallback was used. Aggregate CLI model cost was $4.11, not proof of billed spend or subscription use.

The initial pipe-backed sanitized export exited zero but truncated JSON at byte 65,536. PTY stdout returned a complete 257,801-byte JSON document. The implementation has a regression for that failure and does not accept exit zero as evidence of complete JSON. Raw or sanitized transcript bytes were never saved as probe intermediates.

The first strict implementation refused the selected session because it had 51 completed assistant messages, including four error messages without metered steps. The corrected output retains 47 verified step records, marks coverage partial, and counts four unmetered/error messages. It does not assign zero usage to those failures. A second rejected assumption was that session.updated must follow every assistant completion: this export's latest completion was 25,755 ms later. Both timestamps are now reported independently and tested. A CLI test initially used a synthetic timestamp ahead of the current wall clock; its fixture was changed to historical time, preserving the future-source guard.

The final live check used the same selected existing session and the implemented shared helper: exit 0, observation local_export, outcome partial_coverage, 47 steps, 51 assistant / 47 metered / 4 unmetered / 4 error / 0 incomplete messages. No additional sessions were scanned. The PATH-resolved CLI in the candidate was `/opt/homebrew/bin/opencode`, reporting 1.18.31; the earlier research CLI was `/Users/pmark/.opencode/bin/opencode`, reporting 1.16.2. Both versions were observed; this agent performed no installation, restart or runtime change. The output records the collector's actual version, not the earlier research version.

Private local receipts (outside the repository): `/private/tmp/arcadia-opencode-usage-research-implemented.json`, `arcadia-opencode-usage-research-strict-refusal.json`, `arcadia-opencode-usage-research-timestamp-refusal.json`, and the research report/receipts with the same prefix. These contain safe usage/diagnostic projections, not transcripts. Initial static research did not require a model session.

## Validation and boundary

- `pnpm exec vitest run tests/opencode-usage.test.ts tests/provider-usage.test.ts tests/activity-no-record-commands.test.ts`: exit 0, 40 tests passed. Synthetic fixtures cover 47 steps, mixed coverage, duplicates/conflicts, zero model cost, missing/invalid/nonfinite/negative metrics, truncation, privacy filtering, explicit-source failure/no fallback, no default collection, PTY export and descendant cleanup on deadline and oversized output.
- `pnpm exec tsc --noEmit`: exit 0.
- Touched-file `pnpm exec eslint` for the four source files and two test files: exit 0.
- `git diff --check`: exit 0.
- Mandated pre-edit `arcadia work monitor --no-pull-requests`: exit 0; unrelated retained dirty branches were preserved. The Lead supplied fresh isolated candidate custody at base 0f59a305c. Sole product writer: this implementer; no children. Actual inherited Codex model/effort unavailable; brief model labels were not runtime evidence.

Public source boundaries: the [CLI documentation](https://opencode.ai/docs/cli/) describes stats/export/run; version-pinned [export source](https://raw.githubusercontent.com/anomalyco/opencode/v1.16.2/packages/opencode/src/cli/cmd/export.ts) preserves numeric usage while sanitizing transcript fields, and [step schema](https://raw.githubusercontent.com/anomalyco/opencode/v1.16.2/packages/core/src/v1/session.ts) defines the token buckets. [Go documentation](https://opencode.ai/v2/docs/console/go/) directs current allowance tracking to Console. The separate [Console budget API](https://opencode.ai/v2/docs/console/api/budgets/) reads configured monthly member budgets/spend, not verified Go rolling subscription capacity. No authenticated API request or credential read was performed. Account allowance remains unknown; this change cannot enable unattended production admission by itself.

Independent current-head review, push, PR handoff, required CI and any further production decisions belong to the Lead. No self-acceptance or governed completion is claimed.
