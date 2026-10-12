# Production simulation: living notes

Status: living document. Owner: whoever runs the Lead role of a simulated or
real production run. Update it in the same PR as the run's last Action, or as a
docs-only PR right after. Tracking Issue: #1284.
First report: `first-supervised-production-run-learnings-2026-10-11.md`.

Purpose: record what works and what rubs when an Arcadia run is supervised as if
it were unattended (Lead owns Plan, queue, scope and merge-on-green; Driver is
the only principal that writes code; Observer is read-only; the operator is
offsite and never touches the host). Each entry is a fact from a real run, with
the evidence, so it can become a source fix, not a memory.

## Standing rules this simulation holds

- The operator never acts on the host. Every operator step is one click on a
  remote surface (a button on /todo, /actions or /review, a PR merge, a
  Discord reply). A host-touching step is a defect to record, not a workaround.
- A blocker must be visible on /todo and resolvable in at most two
  interactions with no copy/paste.
- Merge: independent read-only review (max three rounds, more only when
  significant defects recur) plus all required CI jobs green plus a clean merge
  state. PRs that change authority or the active Plan wait for the operator.
- Spend discipline: models and effort are set before launch; the Driver gets a
  wall-clock and input-token budget and a midpoint stop; one no-diff attempt is
  enough to stop and diagnose.

## Run log

### Run 2026-10-12: production-hardening batch (A12, A3, A5, A6)

Plan `production-runs-on-arcadia-launch-with-zero-host-touches-stop-spending-into-the`.
Roles: Lead = Sonnet 5.5 medium; Driver = Sonnet subagent in an isolated
worktree (operator-directed work, because the Codex Session environment wall
was A12's own subject); reviewers = fresh Sonnet read-only subagents.

| Measure | A12 |
|---|---|
| Operator touches (chat answers + PR merges) | 5 |
| Host touches | 0 |
| Time from "activate the Plan" to first Driver launch | about 3 h (dominated by F13 below) |
| Driver attempts / repair rounds | 1 / 4 (3 review rounds + 2 advisory-bot findings) |
| Driver tokens (subagent total across rounds) | about 240k |
| Wall time, Driver | about 35 min |
| Codex Session spend | 0 |

| Measure | A3 | A5 | A6 |
|---|---|---|---|
| PR | #1293 (merged on green) | #1296 (waits for operator) | #1297 (waits for operator) |
| Driver attempts / repair rounds | 1 / 1 | 1 / 2 | 1 / 3 |
| Independent review rounds | 1 | 3 (2 blocking) | 2 (1 blocking) |
| Driver tokens (subagent total) | about 180k | about 330k | about 590k |
| Real defects the reviewers found before merge | 2 low (hidden deferred items, missing gate tests) | 12 validator bypass classes, route on human-owned Action | unguarded `activateNextPlan`/`activatePlan`, half-finished `go --apply`, status change, fail-open store |
| Outcome | partial slice, `split` still to record | heuristic validator, term-list gaps disclosed | guard covers activation, completion hold, status; no pause path |

Per-session numbers for these Actions are recorded as validated rows in
`session-ledger.jsonl` (same directory; add one row per session, see the header
of `src/reports/sessionLedger.ts`).

Totals for the night: 4 Actions built by Sonnet Drivers in isolated worktrees,
8 PRs opened and merged or queued, 0 host touches, 0 Codex Session spend,
0 Grants. Operator touches: the activation answer and the PR merges.

## What works (keep it)

1. **Two-phase settlement** (`agent-ask settle` preview, then `--apply
   --preview <fingerprint>`) is deterministic and its preview names the exact
   consequence (which Plan returns to draft, queue position, pointer). It made
   the activation consequence visible to the operator before they answered.
2. **`split` is honest.** A `complete` Ask refuses any criterion not `met`, so a
   partly met Action cannot be recorded done by accident. `split` narrows the
   Action to the finished slice and creates a tracked remainder.
3. **Independent read-only review pays for itself.** On A12 four rounds found
   real defects each time: opt-in preflight, vacuous worker-side probe,
   `arcadia go --launch` bypass, an import edge that broke the dashboard build.
   Two further findings from the advisory bot (cached-token double count, a
   silent `session_environment_wall`) were also valid.
4. **Briefs that forbid whole-file reads and name the focused test files** kept
   each Driver at roughly 150k to 250k tokens instead of the first run's 11.1M.
5. **`pnpm fast-rehearsal`** (`node scripts/fast-rehearsal.mjs`, 30 scenarios,
   about 3 min, reads `report.json` for `vitestStatus`) is a cheap deterministic
   gate the Lead can run itself instead of asking a model.
6. **The CI monitor event** wakes the Lead on failure or review comment; no
   polling, and logs are readable per job with `gh api --allow-escape-sequences
   repos/<o>/<r>/actions/jobs/<id>/logs`.
7. **`arcadia identity resolve`** gives a single author/committer env; settle
   commits (made as the operator by default) are re-authored with
   `git commit --amend --reset-author` before the PR.
8. **Reconcile receipts** make a dead Session's exit durable and replayable.

## Friction (fix at the source)

Each item lists the cost it caused and a proposed source fix. "Filed" means an
Issue or PR exists.

| # | Friction | Cost | Proposed fix | Status |
|---|---|---|---|---|
| 1 | A dead Session with an exit receipt stayed `needs_input` and blocked every Plan activation; `session reconcile` is idempotent and never changes status. | about 3 h to first launch, one extra PR | Activation guard ignores ended+receipted Sessions | Fixed in #1288 (F13) |
| 2 | Queue-placing settlement must run in the configured (main) checkout, but the operator's rule is "settle in an isolated worktree". Settlement commits land only on local `main`, which then diverges from `origin/main` (ahead N, behind M) after the PR merges as a merge commit. | extra merge commits on local main each time; risk of squash divergence | Let settlement run against a candidate worktree, or publish the settle commit itself on a branch automatically | Open |
| 3 | After a successful activation apply, `docs sync` failed with a SQLite error and the queue had four unpositioned Actions (`orderValid: false`); repair needed a manual `advance queue arrange` of all 38 keys. | one manual repair; easy to drop another Project's order | Position the activated Plan's Actions inside the apply transaction; make `docs sync` retry the lock | Open |
| 4 | `split` queued the remainder immediately after the finished Action and rewired the next Action to depend on it; the operator had chosen "remainder behind the batch". Fixing that needs a second Plan-amendment settlement. | one more governed PR | Accept `--after` for the remainder and an `--independent` flag that skips dependency rewiring | Open |
| 5 | A `split` preview errors with "creates no Action; Responsibility and queue placement do not apply" when `candidate_revision` is not the main checkout's HEAD; the real message is only visible without placement flags. | two wasted previews | Check the candidate first, or name the revision mismatch before the placement check | Open |
| 6 | `candidate_revision` must equal the main checkout HEAD exactly, and that HEAD is a local merge commit that exists nowhere else. | fragile; any new main commit stales the Ask | Accept any ancestor of HEAD that contains the work | Open |
| 7 | Sandboxed shells fail on `mise` ("failed to ln -sf ... Operation not permitted") so `pnpm` cannot run; every CLI call needed the sandbox disabled, and agents fall back to `node_modules/.bin/*`. Node prints a certificate-trust warning per command. | noise and an approval per command | Run the CLI through `node_modules/.bin/tsx` or the built bin by default in agent briefs; mark the worktree trusted in mise | Open |
| 8 | The dashboard `next build` type-checks `src/` through imports. A new import edge from a dashboard-reachable module to `src/sessions/containerAuditTransport.ts` failed `dashboard` and `e2e` only in CI. | one CI round trip and one repair | Local gate: `cd apps/dashboard && tsc --noEmit --listFiles | rg containerAuditTransport` must be empty; add it to the focused checks list | Briefed; add a script |
| 9 | A draft PR blocks merge and the advisory bot skips review. | silent stall until the Lead noticed | Lead checks `isDraft` as part of merge readiness | Practice |
| 10 | A reviewer or Driver hand-back repeats the long sandbox preamble in every message, inflating the Lead's context. | measurable context growth | Keep sandbox text out of subagent hand-backs; summarize in one line | Open |
| 11 | The first sandbox probe the Driver can do runs in the host worker, so `accessSync(W_OK)` always passes. The Session's own sandbox roots are not readable offline. | A12 criterion 1 only partly met | Provider adapters expose sandbox roots, or a probe runs inside the Session | Remainder Action |
| 12 | Clearing an `environment_wall` blocker is CLI-only (`production reset-repair-budget`). | host touch | A /todo or /actions one-click | Open |
| 14 | After the split and a canonical queue reorder, PROJECT.md `current_action` still names the remainder; the pointer only advances inside a settlement, so the operator's chosen order (A3 first) needs another governed PR (#1295) and the pointer stays wrong until then. | one more PR, a stale pointer that `arcadia go` would follow | Advance the pointer when the explicit queue order changes, or let `queue reorder` stage the pointer change as a settlement | Open |
| 13 | Review comments on the PR and dashboard-reachable code exposed that "tokens per attempt" mixed cached and uncached for Codex (`input_tokens` already includes cached). | wrong cost numbers | Fixed in #1290; keep the unit test | Fixed |
| 15 | The Driver's own claim of acceptance was wrong on A5 and A6: the first drafts passed their own tests while independent adversarial review found bypasses a reviewer could run in minutes. Self-reported test counts are not evidence of the criterion. | 2 and 3 blocking review rounds | Require the Driver to include the reviewer's adversarial strings (or a property list) in the brief for any validator/guard Action; keep independent review mandatory for guards | Practice |
| 16 | Guards written for one entry point (`settle --activate`) missed the other entry points (`activateNextPlan`, `activatePlan`, `arcadia go`, `project_update`). | one blocking round on A6 | A single shared `assertNoActiveScope…` at the lowest write boundary, with a test that enumerates callers | Fixed in #1297 |
| 17 | Fast-rehearsal run from the wrong working directory silently produced no report (exit 124, `jq` error). | wasted 10 min | Print the report path and fail loudly if `report.json` is missing | Open |
| 18 | The adversarial reviewer needs a runnable validator; reading code by hand missed what a 3-line script found. | quality | Give reviewer briefs a read-only way to execute pure functions | Practice |
| 19 | Operator-owned PRs left as drafts (#1291) block merge and review unnoticed. | one stall | Lead checks `isDraft`; `gh pr ready` is allowed when the operator asked for the merge | Practice |
| 20 | `git cherry-pick` and `--reset-author` keep the operator's git identity unless the author env is set; two PRs were closed and republished. | two superseded PRs | `cherry-pick -n` then `commit` with GIT_AUTHOR_*/GIT_COMMITTER_* set; add an identity check to the PR step | Practice |
| 21 | A `split` of an Action in a draft (inactive) Plan fails with "queue anchor not found" because the remainder placement needs a queued anchor. | one Action left unrecorded (A3) | Accept a draft-Plan split without placement, or place the remainder at the Plan top | Open |
| 22 | Remainder Action ids over about 64 characters are refused with a generic "lowercase hyphenated slug" error. | two wasted previews | State the length limit in the message | Open |
| 23 | Subagent worktrees could not write `.git/config`, so `git checkout -B` left the named branch uncreated and the first PR attempt said "no commits". | one stalled PR | Briefs: create the named branch with `git branch -f <name> HEAD` before committing | Practice |
| 24 | A `gh pr checks --watch --fail-fast` watcher exits non-zero when a push restarts CI; the merge state also lags GitHub. | several missed merges | Retry loop with a bounded wait for CLEAN (done in the Lead script); a Replayer/merge card removes it | Practice |
| 25 | A complete or split settlement needs `candidate_revision` equal to the main checkout HEAD, so nine settlements ran sequentially on local main and had to be replayed onto a clean branch for the PR. | one hour of ceremony | Action `settle-from-candidate-and-publish` (resilience Plan) | Open |

## Tool and process notes

- Decide the Driver's route before launch. If the Action's own subject is the
  environment wall (A12), do not launch a Codex Session into it; use a Sonnet
  implementer in an isolated worktree plus independent review and still record
  Lead, Driver and Observer.
- Run `node scripts/bridge-worktree-deps.mjs` in every new worktree first.
- The Lead reads CI state with the PR monitor, not by polling.
- Do not paste logs or whole files into chat; put findings in the PR, #1284 or
  this file.
- Start a fresh Lead session after each merged Action; the repo, #1284 and the
  PR history are the memory.

## Not yet simulated

- A live Observer tailing a real Driver session log and requesting a stop
  through the Lead (needs a small Decision).
- Cached versus uncached token counts straight from a provider session log;
  the numbers above are the harness's subagent totals.
- A real Codex Session through the dashboard Launch, with the capacity gate on.
- The per-Project preference record for the chosen Plan (Decision 0122).

## How to extend this file

Add a run section with the measures table, then move any new friction into the
table above with its cost and proposed fix. When a friction is fixed, change
its Status to the PR that fixed it; do not delete it.
