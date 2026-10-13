# Prepared PR TLDR Fast Text Cloud choice — 2026-10-13

Operator-directed [Issue #1380](https://github.com/pmark/arcadia/issues/1380). Candidate `codex/pr-tldr-fast-cloud` at `/Users/pmark/.codex/worktrees/pr-tldr-fast-cloud/arcadia`, base `02a8a72b08d463384f9e40dd2efc80b615864dec`. Sole implementer depth 1 under Lead depth 0; complete generated brief `/tmp/arcadia-pr-tldr-fast-cloud-brief.json`. Actual inherited model/effort metrics are unavailable; supplied heavy builder identity is freshly resolved for commits.

## Authority gate — unapproved paid choice

This is a prepared, reviewable candidate, not an approved paid operation. Lead reports that automatic host approval review rejected settling the paid Decision because choosing the model did not explicitly approve the exact paid-spend scope. No Decision was settled or answered. No paid/live inference, provider launch, runtime restart, global policy or configuration change was performed by the implementer. Important paid authority remains an operator boundary even if code review and CI pass.

The validated input remains unchanged at `.arcadia/asks/agent-ask-record-pr-tldr-fast-cloud-choice-2026-10-13.yaml` (raw-file SHA-256 `3cbbe06d35ec0332429cd3ee8c134762d4efb9038b87b009bccb0a9d65442cfc`). It is committed as an **unapproved draft**, not as approved governance. Registered preview proposal `agentask_0026d1745c689bf839`, capture `713438b3`, fingerprint `0026d1745c689bf83997a6f8541dacdfe85c3ff14569a573d26aa8f168bcfcbb` establishes registration only. The proposed scope is paid Fast Text Cloud for explicit PR Generate TLDR requests, cached reuse, at most one retry, and one bounded validation summary; it excludes background generation, automatic fallback, other paid capabilities and global settings. Exact operator acceptance and the governed/host approval path remain required before merge, delivery or live paid validation.

## Prepared request and preserved invariants

`buildPrSummaryRequest` now selects the existing Intelligence offering through `text.generate`, `cloud-required`, explicit `executionTarget: cloud`, profile `fast`, and request-scoped `allowPaidUsage: true`. `maxRetries: 1` is unchanged. The app pins no provider or model. Lead's existing live alias inspection reports `arcadia-cloud-text` mapped to `openai/gpt-6-luna` with medium reasoning; that global mapping was not changed or independently exercised by this candidate.

The new durable idempotency namespace is `pr-tldr-v2-fast-cloud-<sourceRevision>`, and in-process source-cache keys carry the same policy prefix. Local v1 jobs are neither reused, reset, deleted nor retried. The title/body revision still hashes the exact shipped v1 JSON field order and version; it is independent of execution policy. Audio preparation still checks fresh title/body revision and exact summary-job ID before speech, with existing speech route/settings untouched.

Only explicit Generate/Retry buttons create a summary request. Their label names **Fast Text Cloud**, with a brief paid-charge disclosure before generation. Loading an existing matching TLDR remains GET-only. The default PR list still performs zero automatic summary/source generation. There is no new model fallback, background request, timeout or retry-limit change. `START_HERE.md` describes this as conditional on scoped approval and delivery.

## Deterministic validation

All Intelligence clients/provider work in tests is mocked. No test calls a live cloud provider.

```sh
node_modules/.bin/vitest run apps/dashboard/lib/pull-request-summary.test.ts apps/dashboard/lib/pull-request-audio.test.ts apps/dashboard/app/api/pull-requests/summary/route.test.ts apps/dashboard/app/api/pull-requests/audio/route.test.ts apps/dashboard/components/pull-request-audio.test.tsx apps/dashboard/app/admin/pull-requests/page.test.tsx
```

6 files / 35 tests, exit 0. These cover existing registry resolution to Fast Text Cloud, required paid allowance, no fallback when cloud is absent, unchanged source hash, refusal to look up/retry legacy local keys, cloud cache reload and repeated idempotent key reuse, explicit POST generation, GET-only loading, zero automatic card source reads, paid UI label, stale title/body and summary-job audio pins, and independent PR control keys.

Touched-source/test ESLint and core `node_modules/.bin/tsc -p tsconfig.json` exited 0. Dashboard `node_modules/.bin/next build` exited 0 (15.5-second compile; type/static checks passed). Ledger and whitespace checks exited 0. No full local suite was required for this scoped request/UI/cache change; required CI and independent review remain Lead responsibilities. Live paid generation, latency and output quality are **not verified**, pending exact paid-scope acceptance. Default routing configuration, provider choice and reasoning settings were not altered. No OpenAI documentation lookup was performed, as instructed.

## Retrieval and later QA

Read the complete brief and pending Ask, current Project/context policy and `delegation-policy-records` Action only to rule out overlap; reused previously loaded Constitution/AGENTS, operator-directed, learning, preservation, identity, PR, role/guardrail and Ask registration guidance. Targeted Notes To Self lookup covered TLDR/Intelligence/paid/cloud/idempotency. Relevant code retrieval covered summary builder/cache, existing Fast Text Cloud request-form contract, default registry/route resolver and audio pin guards. Lead completed the native work monitor before edits: 134 working copies, no PR-path overlap. No Plan/Action/queue or other live checkout was edited.

After exact approval and authorized delivery, operator/end-user QA is the same: open `/admin/pull-requests`, verify default cards do not automatically load/generate summaries, choose **Load TLDR / Listen**, then explicitly choose **Generate TLDR · Fast Text Cloud** for one bounded approved validation summary. Confirm a fast-cloud job, matched-source summary, and cached repeat GET with no new generation. Play should retain fresh source/job pin checks and the existing speech behavior. A source edit must invalidate old playback pins. Do not carry out these paid steps while the scope remains unapproved.

One bounded discovery command used a missing optional shell glob for Intelligence test paths; it failed that search branch without product/test impact. Subsequent reads used explicit known source paths. No failing test/build receipt occurred in this slice. Next safe move: Lead's independent review, ready PR/required CI, then exact paid-preview operator choice; no automatic merge or live paid proof at this boundary.
