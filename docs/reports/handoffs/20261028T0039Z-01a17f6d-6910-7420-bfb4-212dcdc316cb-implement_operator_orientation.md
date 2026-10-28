# Operator Go orientation — implementer hand-back

2026-10-28 UTC. Author self-report for Rowan; independent current-head PR review,
governed completion, publication and acceptance remain the parent's work.

## Assignment and custody

- Project: Arcadia. Milestone: Make Arcadia Go orient one caller truthfully
  before authorized work.
- Plan: `make-arcadia-go-orient-one-caller-truthfully-before-authorized-work`.
- Action: `project-go-orientation-for-the-operator`, open/clarified/agent at the
  verified source base. Native named source assignment from Rowan `/root`.
- Writer: `/root/implement_operator_orientation`, implementer, depth 1.
  Native-context evidence ID:
  `01a17f6d-6910-7420-bfb4-212dcdc316cb-implement_operator_orientation`.
  This composite identifies native helper evidence, not a canonical Session,
  claim, admission, model binding or governed attempt. Actual model/effort and
  token usage are unavailable; the role brief's model is a recommendation.
- Exclusive candidate:
  `/Users/pmark/.codex/worktrees/go-operator-orientation/arcadia`, branch
  `codex/go-operator-orientation-20261027`.
- Base and current committed HEAD before parent preservation:
  `ec08741392ebe71dfd06391453440dccdba70d71` (merged PR #1834).
  This hand-back describes an uncommitted candidate; the parent must bind the
  actual preserved source revision before completion/review.
- Parent verified the main checkpoint from `d1b8e6d2bd70f6b79fdf0e7e9ee197d44b3b9770`
  to that base, refreshed the exact Action and queue (revision 287, valid order,
  zero unpositioned, orientation selected and pointer-authorized), and ran work
  monitor before edits. Candidate dependencies were bridged, not installed.
- Parent's production observation was Inactive/Idle, revision 83/epoch 46,
  zero live admissions at `2026-10-28T00:21:53.133Z`. No START, installation,
  service restart, provider/credential probe, spending, reset or scope grant.
- Intake: [Issue #1835](https://github.com/pmark/arcadia/issues/1835).

## Result and acceptance evidence

The new `go-context` CLI observer and two thin dashboard GET routes serve the
existing `runNextReadOnlyCommand` resolution without the caller-repository option.
The operator sees selected Project work, not an assignment inferred from the
server's checkout. The command is activity-exempt; its database opens are
read-only. The portfolio summary projects the same registry rows and applies no
second readiness or selection rule.

1. **Resolution and ownership:** `src/commands/goContext.ts` lists every configured
   Project in stable slug/id order and invokes the existing dispatch/operator-gate
   resolver. Each row retains source/time, selected Plan/Action, dispatchable
   verdict, question/blockers/remedies, canonical unexpired claims and active
   Sessions. Missing legacy ownership tables are explicitly unknown. No provider
   liveness is inferred from a stored Session. Metadata errors stay on their row
   with message/code/source/remedy.
2. **Read-only proof:** `tests/go-context.test.ts` uses real read-only SQLite,
   constructor tracking (including before attempted opens), a writable-adapter
   spy, filesystem-mutation and child-process spies, deterministic repeated reads,
   and before/after all-table and repository hashes. Error cases also assert no
   writable opens, mutation/process calls or changed rows/files.
   `tests/go-context-route.test.ts` invokes actual GET handlers through the real
   dashboard CLI subprocess adapter. Success, unknown-Project refusal,
   missing-root evidence and portfolio responses leave every database table,
   workspace file (including WAL/new files), repository file/Git metadata,
   refs/status and worktree inventory unchanged. These complementary tests do
   not claim the direct unit spies instrument the separate subprocess.
3. **Workspace consumption:** the workspace now fetches
   `/api/projects/{id}/go-context`, preserves its read gate and last-good/error
   behavior, and displays the observer's time. It no longer invokes the journaled
   continuation GET. That older route's PUT and existing launch/preflight paths
   are unchanged. The existing workspace Playwright suite passed with only
   route/DTO/error-text fixture mechanics updated; Plan/Action selection,
   refusal, stale/malformed/HTML failure, single-flight read, keyboard and phone
   behavior retain their intent. `/api/go-context` serves the portfolio.
4. **Discovery completeness:** `src/docs/discover.ts` now preserves I/O failures
   with exact message, operation, code, source and relative path. The shared
   canonical dispatch resolver fails closed on unreadable evidence, including
   repository root/docs/decisions traversal failures that the old control-path
   filter could miss. A directory/stat failure may hide a control record and
   unreadable Markdown cannot be classified by frontmatter. Supporting-document
   parse errors retain the existing nonblocking policy. Explicitly excluded
   dependency/build directories are skipped before stat. Fixtures cover missing
   and non-directory roots, unset paths, duplicate repository registrations,
   inactive registry rows, injected readdir/stat/read failures, a readable selected
   Plan with unreadable sibling evidence, exact errors and shared dispatch refusal.

This addresses the orientation Action's discovery concern retained from
`agentask_0c62dc0a9245204aeb`. Its separate receipt-transition and source/adoption/live
concerns remain outside this Action and are not claimed fixed. The separate
bounded-continuation scope proposal remains unchosen.

## Validation receipts

All commands ran in the exclusive candidate. Raw logs are named below under
`/tmp/`; the parent retains/publicizes them through its normal evidence path.

| Command/check | Result | Receipt |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 | `go-operator-orientation-tsc-first.log` |
| Initial focused observer/dispatch/workspace tests after fixture correction | 5 files, 71 passed | `go-operator-orientation-focused-r1.log` |
| Shared docs-sync, experiment guard and dispatch-journal regressions | 3 files, 130 passed; their accompanying new observer fixture initially failed, corrected below | `go-operator-orientation-regressions.log` |
| Final observer/actual route/activity/workspace focused tests | 4 files, 27 passed, including observer 13/13 | `go-operator-orientation-focused-final.log` |
| Full `pnpm build` (one full lint, core tsc/artifacts and Discord build) | exit 0 | `go-operator-orientation-build.log` |
| `pnpm dashboard:build` | exit 0, compiled and type validity passed | `go-operator-orientation-dashboard-build.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/workspace-go.spec.ts` | 1 passed, 10.6 s | `go-operator-orientation-e2e.log` |
| Touched-file lint and final lint delta | exit 0 | `go-operator-orientation-lint-focused.log`, `go-operator-orientation-lint-final-delta.log` |
| `node --import tsx scripts/check-agent-guidance.ts` | exit 0, no budget problems | `go-operator-orientation-guidance.log` |
| `git diff --check` | exit 0 | final local check |
| Parent independent deterministic replay (not generic PR review) | 2 files, 14 passed, 7.33 s | `rowan-orientation-parent-replay.log` |

The standalone early dashboard `tsc --noEmit --listFiles` returned exit 2 before
core package artifacts were built, with missing built exports and other diagnostics
in existing dashboard tests. It is retained separately in
`/tmp/go-operator-orientation-dashboard-type-files.log`, not relabelled passing.
No unrelated type repair was made. The subsequent actual dashboard build passed
its own validity stage. The early file listing includes the existing next/Session
graph via other routes, but not the new `commands/goContext.ts`; the new routes
keep execution behind the existing CLI shellout and a local DTO. This is not a
claim that the entire dashboard has no pre-existing runtime-module reachability.
The build retains existing review-focus/database import.meta warnings and a
Next ESLint-plugin detection warning.

Canonical unmodified `node scripts/fast-rehearsal.mjs` returned exit 0:
26 files, 102 passing tests plus one expected failure, 45 scenarios. Wall time
371182 ms (6m11s) exceeds the five-minute warning target. Its report contains
69 recorded errors and **two UNEXPECTED lifecycle classifications** for the
deliberately injected `session-probe-wall` EROFS log/launch condition already
owned by [Issue #1322](https://github.com/pmark/arcadia/issues/1322). No harness
repair or zero-unexpected/performance claim is made here.

- Log: `/tmp/go-operator-orientation-fast-rehearsal.log`.
- Full report:
  `/var/folders/cm/0dn1wl093f52lr7h5d7xpdn40000gn/T/arcadia-fast-rehearsal-report-bTtsnB/report.json`.
- Exact report SHA-256:
  `5072410555421b88e69632faa6277873cd2dd5afbc0a8cb35a9a15ea8274e976`.
- Mixed validator evidence is labelled by the harness as `unsandboxed, seatbelt`;
  it is offline lifecycle proof with simulated providers, not a live run.

## Failures and learning retained

- Initial sandbox focused-test startup: exit 1 before any source test,
  `EPERM ... mkdir '<candidate>/node_modules/.vite-temp'`. Same supported command
  succeeded via ordinary approved host execution. Original
  `/tmp/go-operator-orientation-focused-first.log` retained; the parent appended
  this recurrence to existing lesson `lesson_fecbe5de2f13192ffb76`, without a
  duplicate lesson or sandbox/dependency change.
- First host focused run: 60 passed/4 failed because the new active-Plan fixture
  omitted required `recommended_model`. Canonical parser confirmed that exact
  field error. Fixture-only correction; no readiness rule changed. Original
  `/tmp/go-operator-orientation-focused-host.log` retained.
- A later new Decision fixture omitted required `slug`, producing one failure
  with 142 other tests passing. Fixture-only correction; the final observer
  suite passed all 13 tests. Original regression log retained. Parent retained
  reusable fixture learning in `/tmp/rowan-orientation-fixture-learning.json`.
- A Python shell edit in the new candidate failed `PermissionError: [Errno 1]
  Operation not permitted: 'tests/go-context.test.ts'`; the exact repair succeeded
  via ordinary host approval. Supported apply_patch edits otherwise succeeded.
  No permission profile or trust configuration was changed. Parent retained the
  related fresh-candidate mise trust failure as
  `lesson_7a5b3f5d69b939d63f89`.
- Sandbox `ps` inspection was refused; no alternate process-control route or
  destructive recovery was attempted. Owned build/test sessions completed through
  their returned command handles.

## Operator QA, proof limits and next move

`START_HERE.md` contains executable source-only QA and the separate authorized
adoption/live-proof steps. The local test server used an ephemeral loopback port
and was stopped by the fixture; no current phone/LAN/live demo reachability is
claimed. Test screenshots are in ignored Playwright output. Source proof is
separate from installation, adoption and actual live-provider evidence.

Instruction paths, source byte sizes and retrieved sections are retained in
`docs/reports/go-operator-orientation-20261027-instructions.json`. Source sizes
are not effective-context telemetry. The parent's retained learning search found
no matches for its exact query; that does not imply absence of related lessons.

The implementer has made no commit, push, settlement, PR/comment, merge,
installation or activation. After this report and final diff check, sole-writer
custody returns to Rowan for preservation, exact revision binding, canonical
completion, PR publication, independent current-head review and required CI.
Only that supported delivery path may determine acceptance; do not infer it
from this self-report. Resume this same writer only for a named finite repair.

## Rowan preservation checkpoint

Main fetched and both checkpoint listings rechecked before preservation: no change beyond `ec08741392ebe71dfd06391453440dccdba70d71`. The implementer released sole-writer custody; all owned checks are terminal. Parent replay passed 14/14. Issue1322 recurrence retained at https://github.com/pmark/arcadia/issues/1322#issuecomment-6457500309. The native helper ledger uses its explicit composite context ID to avoid duplicating the coordinator chat row; its legacy schema role `driver` denotes implementer, not a new registered role. Source revision and completion receipts follow in canonical Git/Agent Ask records.
