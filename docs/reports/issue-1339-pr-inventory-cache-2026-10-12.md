# Issue #1339: pull-request inventory cache evidence

Date: 2026-10-12

Candidate base: `d5b25bcb20319e2043f009beb021210dfd18d1db` (`origin/main`)

Branch: `fix/1339-pr-inventory-cache`

Governance: operator-directed issue work; the active Project pointer and Action were not changed.

## Reproduction and bottleneck

Read-only measurements against <http://arcadia-1.alpine-rattlesnake.ts.net:3020> before this candidate was installed:

| Request | HTTP | TTFB | Total |
| --- | ---: | ---: | ---: |
| `/admin/pull-requests` page shell | 200 | 1.657 s | 1.679 s |
| `/api/pull-requests`, first sample | 200 | 24.720 s | 24.723 s |
| `/api/pull-requests`, immediate repeat | 200 | 18.579 s | 18.580 s |

The direct underlying `pnpm arcadia work prs --json` scan exited 0 in 24.511 s. It scanned 15 Projects and returned 12 open PRs in that sample. The page/API and CLI timings isolate the delay to the GitHub inventory scan rather than route serialization or download time.

The running Dashboard process had its working directory in the primary checkout. The primary HEAD observed by the coordinating session was `a6157e2e65e0643f9e6b6e1fdfecf8d457d4b53d`; `origin/main` and this candidate began at `d5b25bcb20319e2043f009beb021210dfd18d1db`. A Next development server can recompile from a dirty working tree, so that HEAD is source context rather than proof of the exact served bundle. No service was installed or restarted for this issue, and phone-reachable post-fix timing remains an installation-stage check.

## Cache boundary and measured candidate behavior

The API now owns one process-local stale-while-revalidate cache around the existing inventory loader. A cold process still waits for one real scan. Any later page visit receives the most recent inventory immediately and starts one coalesced refresh. The client polls the cheap cache response while that refresh runs, shows checked-at, stale and refreshing state, and keeps prior cards visible. Automatic retry after a failure is cooled down for 30 seconds; the visible Retry action can request a new attempt immediately. Every client request has a 65-second deadline. A new request or unmount aborts the prior request, and request generations prevent an older response from overwriting newer inventory.

A candidate-local benchmark used the real `loadOutstandingPullRequests` loader without serving or installing the candidate:

| Cache operation | Wall time |
| --- | ---: |
| Cold read and real inventory scan | 22.518 s |
| Immediate hot read | 0.008 ms |
| Forced refresh response using cached cards | 2.776 ms |
| Concurrent forced refresh response, coalesced onto the same scan | 0.036 ms |

Both cold and final scans returned 13 PRs in this later sample. The final scan disclosed eight Project exceptions, so the cache response remained marked incomplete/stale. When a refresh has a per-Project error, prior cards are retained only when their normalized repository remains in the current inventory and that repository's scan failed. Retained cards are remapped to current Project metadata and counts are recomputed; a removed repository is not retained, and a recovered scan discards the retained copy. A transport-level failure preserves the entire prior snapshot. Neither cache state nor the inventory's existing readiness label is used to authorize a merge; this page remains read-only.

## User-visible behavior

- A cold visit immediately shows three stable PR-card skeletons and an accessible status message.
- A repeat visit shows cached cards while revalidation runs, with the checked time and stale/refreshing state.
- Refresh failure leaves prior cards on screen, reports the bounded error, and offers Retry.
- Partial scans keep failed-Project cards from the last successful scan and disclose the incomplete scan instead of presenting a false empty portfolio.
- Empty-state copy distinguishes a complete empty scan from incomplete Project scans.

The same cache response contract can be reused by the shared To-Dos PR component when that requirements work is implemented. This change does not implement merge controls, a scheduler, audio changes, or a second operator-work classifier.

## Validation

- Initial focused suite — exit 0; 3 files, 7 tests.
- Post-review focused suite: `pnpm exec vitest run apps/dashboard/lib/pull-request-inventory-client.test.ts apps/dashboard/lib/pull-request-inventory-cache.test.ts apps/dashboard/app/api/pull-requests/route.test.ts apps/dashboard/app/admin/pull-requests/page.test.tsx` — exit 0; 4 files, 12 tests. It covers a never-settling request, unmount cancellation, out-of-order explicit refresh, both repository/Project identity inversions, and recovered-scan cleanup.
- Touched-file `pnpm exec eslint ...` — exit 0.
- `git diff --check` — exit 0.
- `pnpm build` — exit 0.
- `pnpm dashboard:build` — exit 0 after the final partial-scan repair; `/admin/pull-requests` and `/api/pull-requests` built successfully.
- `mise exec -- pnpm fast-rehearsal` — exit 0; 19 files, 72 passed and 1 expected failure, 34 scenarios. The harness reported 5m14s, fourteen seconds over its five-minute target.
- Dashboard import graph: `containerAuditTransport` was absent. `commander/typings/index.d.ts` was present on the candidate base through the pre-existing `src/operatorActions/planAmendment.ts` → `src/cli/errors.ts` / `src/workspace/experimentGuard.ts` graph; this issue added no core-source import edge and did not widen scope to repair that unrelated baseline.

## Friction and repairs

1. The prepared worktree lacked dependency bridges. The first required work monitor failed with missing `tsx`; the documented `node scripts/bridge-worktree-deps.mjs` remedy restored candidate-local links, and the monitor retry exited 0.
2. The first Dashboard build lacked root `dist` package exports used by existing Intelligence imports. `pnpm build` produced candidate-local package output; the retry reached the changed page.
3. That retry found an invalid named helper export from a Next page module. Moving the skeleton to a focused component repaired the framework contract; the next Dashboard build passed.
4. One cache test initially waited for a mocked loader call rather than for the cache's rejected refresh to settle. It now waits for the observable `refreshing: false` state.
5. Independent review round 1 found that a never-settling client fetch could leave the cold skeleton indefinitely and that partial retention used Project ID instead of current repository identity. The bounded request coordinator and normalized current-repository merge close both blockers. The first repair lint run found render-time ref access and a recursive callback; a stable coordinator plus generation-aware polling loop repaired both, and the second lint run exited 0.

No failed command was repeated unchanged, and each named failure used one repair attempt.

## Retrieved instructions

Loaded instruction paths and byte counts: `AGENTS.md` 9,750; `CONSTITUTION.md` 3,320; `PROJECT.md` 31,634; `.arcadia/AGENT_CONTEXT_POLICY.md` 539; `.arcadia/repo-context.md` 703; `.arcadia/context-policy.json` 870; `.agents/skills/arcadia-guardrail/SKILL.md` 5,565; `docs/agent-guidance/index.json` 7,623; `continuation.md` 6,239; `operator-directed-work.md` 4,494; `learning.md` 1,636; `principles.md` 13,789; `pull-requests.md` 17,208; `git-identity.md` 5,248; `docs/working-copy-safety.md` 15,818; `arcadia-repository.md` 30,174; active Plan 14,082; and the merged UX requirements report 30,746.

Targeted Notes To Self reads covered dependency bridging, focused Vitest invocation, fast rehearsal, and the Dashboard import-graph failure mode. The active governed Action, `attach-the-session-probe-result-to-the-reconcile-receipt`, is unrelated and remained untouched.
