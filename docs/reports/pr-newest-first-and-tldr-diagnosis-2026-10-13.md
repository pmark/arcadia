# Newest-first PR display and TLDR diagnosis — 2026-10-13

Operator-directed [Issue #1377](https://github.com/pmark/arcadia/issues/1377). Candidate `codex/pr-newest-first` at `/Users/pmark/.codex/worktrees/pr-newest-first/arcadia`, base `d65388513c911a447ce362763264c6c075ce5a4f`. Sole implementer depth 1 under Lead depth 0; generated brief `/tmp/arcadia-pr-newest-first-brief.json`. The actual inherited runtime model and effort are unavailable; heavy Codex builder identity is the explicitly supplied identity. No further delegation or edits in primary/other live candidates.

## Display change

The Dashboard renders a sorted copy of its PR array by descending valid creation timestamp. Missing/invalid creation dates fall back to valid update dates; PRs with neither valid date appear last. Equal timestamps use repository then PR number for a deterministic tie. Repository/PR/update revision control keys remain unchanged. The cached/API snapshot is not mutated, and rich CLI readiness ordering remains untouched. No source, details, speech, summary generation or refresh request behavior changed.

The page render regression failed before wiring the sorter: the newest title appeared at HTML position 3435, after the older title at 2067. It passes after wiring. Pure behavioral tests prove older PRs with recent CI activity stay below newer-created PRs, frozen input remains unchanged, missing/invalid dates have defined fallback, undated PRs sort last and equal timestamps have stable ordering. Existing independent details/audio key regression passes.

Validation: `node_modules/.bin/vitest run apps/dashboard/app/admin/pull-requests/page.test.tsx apps/dashboard/lib/pull-request-order.test.ts apps/dashboard/components/pull-request-audio.test.tsx apps/dashboard/components/pull-request-details.test.tsx` — 4 files / 17 tests, exit 0. Touched-file ESLint and core `node_modules/.bin/tsc -p tsconfig.json` exited 0. Dashboard `node_modules/.bin/next build` exited 0 (27.7-second compile; type/static checks passed). Ledger and whitespace checks exited 0. No full suite was required locally for this Dashboard-only change; required CI remains Lead's responsibility.

## Reported TLDR job: diagnosis only

Lead verified job `ijob_364d4657f41543b982`, blocked with `retryCount: 0`. It ran from 1:20:34.318 PM to 1:21:34.502 PM PDT on October 13 (source timestamps `2026-10-13T20:20:34.318Z` to `2026-10-13T20:21:34.502Z`), 60.184 seconds. Its `LITELLM_UNAVAILABLE` error identifies an aborted `arcadia-local-text` transport request at the 60-second deadline.

The checked-in summary request uses `execution: local-required`, `profile: standard`, `allowPaidUsage: false`, `maxRetries: 1`. Lead's live route inspection confirmed that this path maps to local Qwen2.5-Coder 14B 4-bit, not GPT-6 Luna. oMLX 0.7 reported one loaded 14B model, resident 8,724,968,944 bytes, with no active or waiting jobs; the older 1.5B model remained unloaded. Observed aggregate prefill/generation rates were about 24.5/3.2 tokens per second. These rates suggest possible latency pressure, but do not prove this attempt's exact underlying cause.

Intelligence health returned 200, proxy reachable, with queued/active counts zero. Existing available local routes included `localfast/standard.codex` and the LiteLLM default. This observation does not authorize changing the selected route. Bounded proxy logs had an earlier memory-guard HTTP 500 at 12:31:40 PM PDT (19:31:40 UTC), and a success HTTP 200 at 1:08:54 PM PDT (20:08:54 UTC); neither identifies a response in the reported 1:20:34–1:21:34 PM attempt window. The earlier memory-guard incident is not claimed as the cause of this job. Current backend health is not described as down.

The verified failure is the 60-second abort; why this attempt did not return within that window remains unresolved. No model, route, execution policy, paid usage, retry budget or timeout was changed by this implementation. The implementer made no provider launch or inference request. Any later bounded retry by Lead is separate runtime evidence; this section describes the originally reported attempt before such a retry.

## Retrieval and QA

Reused the already loaded Constitution/AGENTS, operator-directed work, learning, preservation, identity, PR and role/guardrail guidance. Read the complete current role brief, context policy, Project pointer and exact `delegation-policy-records` Action to rule out overlap, page/key regression and canonical guide. Targeted Notes To Self lookup covered PRs, sorting/dates and TLDR; focused Vitest/dependency bridge instructions were already retrieved. Lead completed the work monitor before edits: 133 working copies with no PR-path overlap. No governed Plan/Action/queue changes are claimed.

Operator procedure is the end-user procedure: after authorized delivery, open `/admin/pull-requests` on the existing managed Dashboard. The most recently created PR should appear first even when an older PR has newer CI/update activity. Details and summary/audio stay explicit controls, and an ordinary refresh preserves the underlying inventory order/state. Missing creation dates use the visible record's update date. Independent review, required CI and authorized delivery remain Lead responsibilities.
