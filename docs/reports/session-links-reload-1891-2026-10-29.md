# Session links and reload recovery — #1891

Operator instruction: “Do 1 and 2 in a fresh worktree, and ping me when it’s ready to merge.” Scope: exact Session permalink plus canonical Session recovery when returning to an Action. No governed Action exists for this source request; the selected checklist Action and Plan/queue pointers are unchanged. Leave the PR open for the operator.

Fresh candidate `codex/session-links-reload` at `/Users/pmark/.codex/worktrees/session-links-reload/arcadia`, prepared from `12c2fb4ff2fb8f7be1c67ec83c978027de4b0dee` (merged #1890). Same native chat as the earlier fix; update its existing session-ledger row, rather than creating a duplicate Session id. No managed Session admission claimed.

## Source behavior

- `/sessions/<id>` reads the exact canonical Session without the portfolio recent-history limit; details start expanded and highlighted, with current facts, existing log/PR and a return link using the canonical Project slug.
- The workspace scopes Session lookup to exact Project id, Plan and Action. Active ownership is preferred, otherwise newest preparation time/id. Returning to an Action reads this record again; no browser storage is trusted as Session authority.
- View Session is primary. An active Session withholds Continue. Finished history keeps any otherwise-permitted Continue options collapsed. Missing table, unreadable observation or a mismatched scope is explicit and withholds launch controls. An old selected Action keeps its Session even when Go selects another Action.
- Existing launch routes, duplicate fences, approval gates, production policy and provider behavior are unchanged. New endpoints use `withReadOnlyDatabase` and the existing Session projection. No live launch, shared checkout change, installation or restart.

## Evidence

- Thirty focused tests passed: dashboard reads, new Session observation routes, existing protected Continue route. Exact reads find history excluded by a one-item recent limit; cross-Project/Plan/Action and SQL-like scope inputs do not match; the source database bytes remain unchanged after reads.
- Phone/desktop browser scenarios cover reload, Session page refresh, back navigation, changed Go pointer, finished history and lookup failure; `pnpm exec playwright test tests/e2e/workspace-go.spec.ts` passed all three scenarios; phone screenshots of restored Session and the expanded exact Session page were visually inspected.
- `pnpm build:artifacts`, `pnpm dashboard:build`, `pnpm lint`, preservation self-check (3342 files), session-ledger validation and `git diff --check` passed.
- Main checkpoint before commit remains the preparation revision, with no new governance records.
- Main checkpoint before preparation: only #1890 since the prior cursor; no new governance records. Work monitor found no overlapping dirty candidate; prior learn search returned no matches for the combined lookup terms.

## Instruction retrieval

Reused unchanged instructions loaded in this same chat and listed with byte counts in `docs/reports/continue-feedback-1889-2026-10-29.md`: Constitution, context policies, continuation, operator-directed work, safety, learning, PR/review/identity, native-mail checkpoint, semantics, Arcadia repository guidance and session briefs. Refreshed current Project frontmatter, exact selected Action, index and Notes subsystem/test guidance before work. Newly read principles sections 80/20 and YAGNI (path `docs/agent-guidance/principles.md`). Scope remains two requested improvements. The main checkout and all other worktrees remain untouched.

## Friction

Focused lint initially rejected one unnecessary non-null assertion in the Session page. Removed it; the final repository lint result is recorded on the PR. No gate or check was weakened.

Principles source: 14124 UTF-8 file bytes.

Supplemental same-Project navigation check: a Session appears after an initially empty read; navigate to another Action and back without a full reload. Existing runtime passed at both widths. The regression is retained; no runtime repair was needed. Final three browser scenarios passed (37.3 s). Round 1 independent static review had no blocking findings; the test-only delta receives round 2.

CodeRabbit review findings were independently verified: comment 4419364799 identified the missing window-focus refresh; review 5706771931 noted the browser fixture checked Action but not Plan. Both are fixed. Focus rechecks read-only without discarding nested preview/unknown-receipt state. Failed rechecks retain the prior record and disable further launch controls until a successful retry; unknown request identity survives. Both viewports cover focus recovery, failed refresh/retry and exact Plan/Action fixture matching. Final dashboard build and three browser scenarios passed (38.6 s); focused lint and diff checks passed. Round 3 reviews this bounded runtime/test delta.
