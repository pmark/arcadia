# Arcadia: Start Here

Local browser measurements currently fail closed under `arcadia-unattended`.
The [inactive Docker audit preparation](docs/reports/issue-847-container-route-2026-10-02.md)
has real synthetic Lighthouse and containment evidence. Installation does not
activate it: a separate exact-scope, one-shot Decision/Grant is required.
No Docker socket or broad networking is made available to coding agents.

Installing Arcadia on a new machine, especially to make sense of an existing
AI-built project? Give your coding agent
[`INSTALL_WITH_A_CODING_AGENT.md`](INSTALL_WITH_A_CODING_AGENT.md). It covers
the minimal source installation, private workspace setup, repository adoption,
and first release audit. The hostnames below describe the maintainer's
configured instance; they are not portable installation defaults.

This is the canonical brief operator guide. From an iPhone, iPad, or any device on the tailnet, open **Mission Control** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/> — this is the link that actually works from a phone, verified live rather than assumed. On this Mac only, <http://127.0.0.1:3020/> reaches the same dashboard without going through Tailscale.

To categorize the GitHub backlog and reconcile Issues with governed Actions,
use the repository-owned [Arcadia GitHub Issues skill](.agents/skills/arcadia-github-issues/SKILL.md).
Its [OpenCode/DeepSeek prompt](.agents/skills/arcadia-github-issues/references/opencode-prompt.md)
produces a complete triage report and proposed changes, with bounded validity
checks. Follow the [installation instructions](.agents/skills/arcadia-github-issues/references/installation.md)
for Claude Code, OpenCode and Codex;
triage does not change the Project pointer or apply GitHub updates.

Open **Now** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/now> (on this Mac: <http://127.0.0.1:3020/now>). This is the screen to bookmark. It answers one question — how far away is the single thing that matters, and what is the one next move toward it — and refuses to answer any other. The target, the Project that owns it, and the gates that stand between you and it are declared in `NORTH_STAR.md` at the workspace root; edit that file to change what the screen measures. Below the distance, local Intelligence writes a short, specific account of what actually happened this week from the commit subjects in each Project's repository, followed by the share of the week's commits that landed in the target Project. One action is offered at full size, and one fifteen-minute alternative that is still on the target. The same brief is available in the terminal:

```bash
pnpm arcadia now --narrate
```

Drop `--narrate` for the deterministic pass, which makes no model calls and returns immediately.

The headline is a **Target**, not a claim that it is already true, and the `why:` from `NORTH_STAR.md` is printed with it: the reason defines the target. A gate whose Action is `done` but was split stays *in progress* until every remainder in its `split_into` chain is done, and the next move names the first open remainder.

Open **Flight Deck** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/flight-deck> (on this Mac: <http://127.0.0.1:3020/flight-deck>) for a read-only portfolio board. It groups the existing Work Queue and dashboard snapshot into Project and Plan lanes, with the same five dispatch gates: Needs You, Ready to dispatch, Running, Proving, and Landed. An object whose Plan cannot be derived is shown in that Project's **Unattached** lane rather than being hidden. Refreshing and browsing this board never changes Arcadia state.

For the bounded v6 production trial, use the existing **Grant v6 remaining-stage
rehearsal (split, Off, restart; 24h)** operator action after fixture preparation.
It runs the host-only hermetic replay before activation and refuses on failure
or its five-minute process timeout. The replay log and failure handoff stay with
the action; you do not need a terminal or to paste a receipt. Follow
[`morning-runbook.md`](artifacts/generated/operator-scripts/morning-runbook.md)
for the live split and Off/restart observations.

For the disposable three-Action rehearsal, four operator pairs run in order;
each writes a receipt under its `runs/<timestamp-pid>/` and a failure handoff
when it refuses. **G1** `prepare-three-action-rehearsal-fixture-2026-10-04`
(terminal, with `ARCADIA_REHEARSAL_GITHUB_REPO=<you>/arcadia-three-action-rehearsal-<suffix>`)
first validates the generated fixture with Arcadia's own discovery and docs-sync
code in a scratch directory, then creates or reuses only that private repository
and registers the fixture; a half-registered earlier attempt is reported with its
exact recovery instead. Then run `recover-arcadia-host-services` from a terminal
with `ARCADIA_WORKSPACE` set inline on that one command, exactly:

```sh
ARCADIA_WORKSPACE=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover /Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/recover-arcadia-host-services.sh run
```

Never `export ARCADIA_WORKSPACE`: the workspace would then resolve from the
environment variable instead of user config, and G1, G6, G7 and G8 refuse
(`unset ARCADIA_WORKSPACE` repairs it). Without it the restart falls back to a
workspace that does not exist. **G6** `preflight-three-action-rehearsal-2026-10-04`
only observes and refuses unknown, stale, paid or unavailable evidence. **G7**
`grant-production-three-action-rehearsal-2026-10-04` (one-shot, from `/runs`,
within 30 minutes of a passing G6) replays the hermetic rehearsal, then previews
twice and activates the exact scope. Its always-visible title and effect say that
pressing accepts Decision 0058 for these three fixture Actions only (#925):
readying the PR, pushing the settled head and reviewer spend; the full
acknowledgement is under "What this action does". It never authorizes a GitHub
merge or base push. **G8**
`restore-terminal-off-three-action-rehearsal-2026-10-04` (preferably from a terminal,
since its restart also restarts the dashboard behind `/runs`) restores and
proves terminal Off through the governed Off and the hash-pinned reviewed restart
(`recover-arcadia-host-services`, now published beside it). It turns Off only
G7's own policy with the exact fixture scope; any other Active policy refuses
untouched and needs its own Off (dashboard switch or `arcadia production deactivate`). It
sends no signal itself beyond bounded timeouts (that restart path may SIGTERM Arcadia's own
service processes and rewrites `~/.codex`/`~/.claude` configuration with
backups) and never discards a candidate.

**Running a rehearsal:** start with the consolidated runbook,
[docs/autonomous-production-rehearsal-runbook.md](docs/autonomous-production-rehearsal-runbook.md)
(the standard, the exact steps, the failure catalog and the open gaps). The
per-run sections below are the historical record and the script details.
Before any live run, run `pnpm fast-rehearsal` (unsandboxed; about a minute):
the same lifecycle offline, see [tests/fast-rehearsal/README.md](tests/fast-rehearsal/README.md).

**Rehearsal run 2** reuses fixture `pmark/arcadia-three-action-rehearsal-20261004`.
The 2026-10-04 G6 and G7 are retired from use: G7 is consumed and both require
G1's genesis. Run these in order, each from a terminal unless noted:

1. Merge the run-2 pull request. The G8 reconciliation repair (#955) is
   merged and the existing G8 `restore-terminal-off-three-action-rehearsal-2026-10-04`
   already succeeded for run 1 (run `20261005T043958Z-2548`); the reset
   requires that receipt. This pull request changes runtime paths, so install
   it with step 3 before G6.
2. Reset the fixture, exactly:

   ```sh
   ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004 /Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-2026-10-05.sh run
   ```

   `reset-three-action-rehearsal-fixture-2026-10-05` is one-shot and refuses
   unless run 1's G8 succeeded. It changes only write-start-marker's
   `next_action` and the Plan's `updated:` date, which gives that Action a fresh
   attempt lineage. It validates with Arcadia's own code before its one commit,
   pushes fixture main without force, runs docs sync and records the new
   fixture head. It never touches production, Grants, the other Actions,
   run 1's branch `claude/write-start-marker-20261004T170245861Z` or PR #1. The
   local branch, the GitHub branch and the PR #1 head must all stay at
   `58bcd915…` before and after.
3. If Arcadia main moved on a runtime path since the last install (the
   run-2 pull request itself is such a change), run
   `recover-arcadia-host-services` with `ARCADIA_WORKSPACE` inline (above).
4. Run the run-2 G6 `preflight-three-action-rehearsal-2026-10-05`. It binds the
   reset head recorded in the latest succeeded reset receipt.
5. Within 30 minutes, press the run-2 G7
   `grant-production-three-action-rehearsal-2026-10-05` from `/runs`. It has
   its own request id and cites the operator's #925 answer (Log
   `operator-answers-rehearsal-run2-2026-10-05`).
6. End with the run-2 G8 variant
   `restore-terminal-off-three-action-rehearsal-2026-10-05`. It turns Off only
   the run-2 (or run-1) G7 policy with the exact fixture scope, and otherwise
   behaves exactly as the merged 2026-10-04 G8.

**Rehearsal run 3** reuses the same fixture from run 2's reset head
`0d3d2ced…`. Every 2026-10-04 and 2026-10-05 pair is retired from use. Their
files are unchanged, and their G6 and G7 refuse the run-3 head anyway. Run these
in order:

1. Prerequisite, done by another session: the Operator QA plan fix (PR #969)
   is merged and the broker reinstalled from it. Then merge the run-3 pull
   request. It touches no runtime path, so it needs no reinstall of its own.
2. Reset the fixture from a terminal, exactly:

   ```sh
   ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004 /Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-run3-2026-10-05.sh run
   ```

   `reset-three-action-rehearsal-fixture-run3-2026-10-05` is one-shot. It
   requires run 2's G8 terminal Off (run `20261005T160050Z-46759` or a later
   success). It also requires fixture main at run 2's reset head, and run 1's
   and run 2's branches and PRs #1 and #2 at `58bcd915…` and `7f139037…`,
   before and after. It changes only write-start-marker's `next_action` (and
   the Plan date when run after 2026-10-05). A pending Agent Ask naming that
   Action silently stops dispatch (#968): run 1's pending one stalled run 2.
   The reset refuses on any pending proposal or Decision for the fixture except
   run 2's `complete-write-start-marker-2026-10-05`. The tick accepted that one
   on run 2's candidate branch, so live it no longer gates, and the reset
   leaves it as it is. Were it still pending, the reset would reject it
   through the governed two-phase settle before its commit; a rerun recognizes
   a landed rejection. Either way the gate must then read clear. The new
   `next_action` also tells the agent to record completion under the unused
   request id `complete-write-start-marker-run3-2026-10-05`. The usual
   `complete-<action-id>-<date>` would reuse run 2's settled id on 2026-10-05,
   which discovery skips and preview refuses. The reset refuses if that id is
   already used. A same-day docs sync reopens the record run 2 left `done`,
   as a test proves.
3. If Arcadia main moved on a runtime path since the last install, run
   `recover-arcadia-host-services` with `ARCADIA_WORKSPACE` inline (above).
4. Run the run-3 G6 `preflight-three-action-rehearsal-run3-2026-10-05`. It is
   read-only, binds the run-3 reset head and checks that nothing pending gates
   a fixture Action. **Freeze from here until the G7 press:** nothing may push
   to Arcadia main, reinstall, restart services or run any G8. G7 needs G6's
   `arcadiaHead` and `brokerRevision` to still match. Run 2's G6 had to be
   rerun twice: once after a governed settle commit moved main, once after an
   accidental G8 press reinstalled the broker.
5. Within 30 minutes of that G6, press the run-3 G7
   `grant-production-three-action-rehearsal-run3-2026-10-05` from `/runs`.
6. After the run, run the run-3 G8
   `restore-terminal-off-three-action-rehearsal-run3-2026-10-05` from the
   Terminal panel (or `/runs`). Never use a non-interactive shell: it refuses
   with "launch this action through /runs or from an interactive host
   terminal". It turns Off only the run-3, run-2 or run-1 G7 policy with the
   exact fixture scope.

Run 3 evidence to capture: the live QA reviewer's verdict on the "Operator QA
plan" criterion for the run's pull request, in
`artifacts/qa/pull-requests/.../qa-report.md`. It proves the remainder Action
`verify-operator-qa-plan-with-live-qa`.

**Rehearsal run 4** reuses the same fixture from run 3's reset head
`4375aafe…`. Every 2026-10-04, 2026-10-05 and run-3 pair is retired from use.
Their files are unchanged, and their G6 and G7 refuse the run-4 head anyway. Run
these in order, and nothing else in between:

1. Prerequisite, done by the release manager: the validation-evidence repair
   pull request (`embed-validation-evidence-in-preserved-pr-body`) is merged
   and installed through the governed reinstall. Then merge the run-4 pull
   request. It touches no runtime path, so it needs no reinstall of its own.
2. Reset the fixture from a terminal, exactly:

   ```sh
   ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004 /Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-run4-2026-10-05.sh run
   ```

   `reset-three-action-rehearsal-fixture-run4-2026-10-05` is one-shot. It
   requires run 3's G8 terminal Off (run `20261005T194025Z-26232` or a later
   success) and fixture main at run 3's reset head. Runs 1, 2 and 3's branches
   and PRs #1, #2 and #3 must stay at `58bcd915…`, `7f139037…` and
   `50d1eab8…`, locally and on GitHub, before and after. It changes only
   write-start-marker's `next_action` (and the Plan date when run after
   2026-10-05). The new text names the unused completion request id
   `complete-write-start-marker-run4-2026-10-05`; the reset refuses before any
   settle or commit if that id is already used. It handles run 3's
   `complete-write-start-marker-run3-2026-10-05` as run 3's reset handled run
   2's: live it is accepted, so it is left as it is; a pending one is rejected
   through the governed two-phase settle; any other pending fixture proposal or
   Decision refuses. The gate must then read clear.
3. Run the run-4 G6 `preflight-three-action-rehearsal-run4-2026-10-05`. It is
   read-only and binds the run-4 reset head. **Freeze from here until the G7
   press:** nothing may push to Arcadia main, reinstall, restart services or
   run any G8. G7 needs G6's `arcadiaHead` and `brokerRevision` to still match.
4. Within 30 minutes of that G6, the operator presses the run-4 G7
   `grant-production-three-action-rehearsal-run4-2026-10-05` from `/runs`.
5. After the run, run the run-4 G8
   `restore-terminal-off-three-action-rehearsal-run4-2026-10-05` from the
   Terminal panel (or `/runs`). Never use a non-interactive shell: it refuses
   with "launch this action through /runs or from an interactive host
   terminal". It turns Off only the run-4, run-3, run-2 or run-1 G7 policy
   with the exact fixture scope.

Run 4 evidence to capture: the live QA reviewer's verdicts on the run's pull
request (PR #4), in `artifacts/qa/pull-requests/.../qa-report.md`, especially
the "Operator QA plan", "Tests and evidence" and "Approval boundaries"
criteria.

**Rehearsal run 5** reuses the same fixture from run 4's reset head
`9642005f…`. Run 4 stalled at integration because its agent's drafted complete
Ask was never archived and was committed on top of the settlement (#981).
Every 2026-10-04, 2026-10-05, run-3 and run-4 pair is retired from use. Their
files are unchanged (a test pins their sha256), and their G6 and G7 refuse the
run-5 head anyway. Run these in order, and nothing else in between:

1. Prerequisite, done by the release manager: the stray-Ask archive fix
   (`archive-settled-ask-by-canonical-name`, #981, merged as #983
   `bb83f70c…`) is merged and installed through the governed reinstall. Then
   merge the run-5 pull request. It touches no runtime path, so it needs no
   reinstall of its own. The run-5 G6 and G7 require the #983 commit on main
   (beside #922 and #924) and refuse without it; installing it stays the
   release manager's step, checked by G6's installed-release check.
2. Reset the fixture from a terminal, exactly:

   ```sh
   ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004 /Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-run5-2026-10-06.sh run
   ```

   `reset-three-action-rehearsal-fixture-run5-2026-10-06` is one-shot. It
   requires run 4's reset receipt (`9642005f…` on run 3's `4375aafe…`), run
   4's G8 terminal Off (run `20261006T011557Z-3871` or a later success) and
   fixture main at run 4's reset head. Runs 1, 2, 3 and 4's branches and PRs
   #1 to #4 must stay at `58bcd915…`, `7f139037…`, `50d1eab8…` and
   `79c6bae9…` (run 4's tip includes the worker's preservation commit),
   locally and on GitHub, before and after. It changes only
   write-start-marker's `next_action` and the Plan date: run 4 left
   `updated: 2026-10-05`, so a reset on 2026-10-06 (or later) bumps it, which
   docs sync applies. The new text names the unused completion request id
   `complete-write-start-marker-run5-2026-10-06` (the reset refuses before
   any settle or commit if it is already used) and tells the agent to leave
   `git status` clean after settling, keeping no copy of the Ask file. It
   handles run 4's `complete-write-start-marker-run4-2026-10-05` as run 4's
   reset handled run 3's: live it is accepted, so it is left as it is; a
   pending one is rejected through the governed two-phase settle; any other
   pending fixture proposal or Decision refuses. The gate must then read
   clear.
3. Run the run-5 G6 `preflight-three-action-rehearsal-run5-2026-10-06`. It is
   read-only and binds the run-5 reset head. **Main stays quiet from here
   until the G7 press:** nothing may push to Arcadia main (not even a governed
   settle commit), reinstall, restart services or run any G8. G7 needs G6's
   `arcadiaHead` and `brokerRevision` to still match, and the G6 to be at
   most 30 minutes old.
4. Within 30 minutes of that G6, the operator presses the run-5 G7
   `grant-production-three-action-rehearsal-run5-2026-10-06` from `/runs`.
5. After the run, run the run-5 G8
   `restore-terminal-off-three-action-rehearsal-run5-2026-10-06` from the
   Terminal panel (or `/runs`). Never use a non-interactive shell: it refuses
   with "launch this action through /runs or from an interactive host
   terminal". It turns Off only the run-5, run-4, run-3, run-2 or run-1 G7
   policy with the exact fixture scope.

Run 5 evidence to capture: the live QA reviewer's verdicts on the run's pull
request (PR #5), in `artifacts/qa/pull-requests/.../qa-report.md`: the
"Operator QA plan", "Tests and evidence" and "Approval boundaries" criteria.
If integration is refused, keep the operator escalation that `arcadia
production status` now shows for it (from `archive-settled-ask-by-canonical-name`),
with its exact blocker and remedy text.

Open **Production** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/production>
(on this Mac: <http://127.0.0.1:3020/production>) to drive and monitor
production from one page, at phone width or on the desktop. It follows the
system light or dark theme. From top to bottom:

- **Managed production**: the state Arcadia reports (for example `Inactive ·
  Idle`), desired state, policy revision and epoch, the concurrency the scope
  allows, the worker heartbeat and any launch escalations. **Turn production
  Off…** and **Turn production On…** each show their consequence and wait for
  a confirmation; On first shows exactly what the saved configuration would
  replay, and refuses with the reason if anything drifted. **Pause all** is
  shown disabled with "not available yet": no backend can yet hold every
  launch without revoking the production grant.
- **Sessions**: each live Session with its state (Launching, Running,
  Stalled, or Exited · not reconciled), elapsed time and a live log tail that
  refreshes every 3 seconds; below them, recently finished Sessions with exit
  code, reconciled outcome and pull request. The log is
  `<workspace>/.arcadia/sessions/<session id>.log`, which headless launches
  record; a Session without one says so. Per-Session **Pause** is disabled
  for the same reason as Pause all; use **Copy Reattach** on the Mac.
- **Queue**: every planned Action in queue order. **Batches** groups the ready
  Actions so each batch holds at most one Action per repository (one Session
  lease per repository), so a batch can run side by side; within a repository
  Actions run in queue order. **Queue order** lists everything with a state
  chip and what it waits on. **Launch…** on a ready Action previews first: if
  the Action is not its Project's current pointer, step 1 previews and
  applies that pointer move only when you confirm; the launch preview then
  names the agent and the consequences, and nothing starts until you press
  **Launch Session**. A preview that names a different Action, or is not
  ready, withholds the button.

The page reads `arcadia production status`, `dashboard runs --sessions 8`,
`advance queue` and `schedule status`, and writes only through the existing
production, work-queue and session-launch routes. Work Queue, Runs, Flight
Deck and Path stay available and are linked at the bottom.

Open **Work Queue** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/work-queue>
(on this Mac: <http://127.0.0.1:3020/work-queue>) to see and control the
complete approved Action order. The selected next Action is prominent; every
higher ineligible Action remains in place with its reason, repair, Project,
Outcome or Milestone, Responsibility, dependencies, Decisions, effort, Token
Impact, and acceptance summary.

Flight Deck shows queued Actions and recent evidence, not an exhaustive history.
Cards distinguish operator judgment, agent repair, external blockers and waiting
for the pointer. Completed Runs and draft Artifacts stay in Proving. Landed
means a ready/published Artifact with a recorded location, not Action acceptance
or PR merge. Structural links use managed document references; inferred Plan
mentions are labeled as prose.

Use **Top**, the up/down controls, or **Reorder multiple** to draft a change.
Arcadia shows the exact changed segment before **Apply exact preview** writes
anything. **Make next** separately previews the governed `PROJECT.md` and Plan
pointer transition; queue order alone never grants dispatch authority. Each
applied order change returns a durable receipt and exposes **Undo** while that
receipt is still the current revision. A simultaneous edit is refused and the
page refreshes both choices instead of overwriting either one. Project and
readiness filters only change the view.

If the queue says Actions are unpositioned, choose **Reorder multiple**, arrange
every approved Action, and preview the initial order. Arcadia deliberately does
not infer that first portfolio priority. The same read and mutation contract is
available through `arcadia advance queue`, `reorder`, `arrange`, `make-next`,
and `undo`.

> **Deprecated 2026-10-09:** the `/runs` page is deprecated, replaced by `/production`, `/actions`, `/review` and an upcoming `/todo` page; the operator-script library behind it is unchanged until a replacement is governed.

Open **Runs** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/runs> (on
this Mac: <http://127.0.0.1:3020/runs>). It leads with the buttons you come for:
**To-do** (Accept/Reject for Agent Asks, Approve for Decisions, and any
review items read-only with the command that answers them; the same list as
`arcadia todo --all`, with stale items folded into a collapsed **Stale** group)
loads and opens first, then any **Operator actions** that are running, failed,
or recently added. Everything else is collapsed and loads nothing until you tap
it, so the page opens fast: **Production control**, and **Sessions and runs**.
Operator-action authors must run `mise exec -- pnpm check:operator-scripts`
before publishing a button. CI checks every library entry. `/runs` refuses an
altered Plan-amendment launcher with `PLAN_AMENDMENT_RUNNER_REQUIRED`; repair
its pinned descriptor and regenerate the shared launcher before retrying.
Plan-amendment Operator actions validate a pinned scope with a fresh canonical
preview on every click. A failed click shows its machine-readable reason, the
changed field, and the exact recovery step with a durable receipt. If settlement
committed but publication failed, retrying that same action verifies and publishes
the existing commit without settling twice. It never changes a queue or pointer. The [shared runner contract](docs/operator-plan-amendments.md) documents pinned inputs and safe recovery.

**Test headless Codex, OpenCode and Claude single-Action runs (experiment
fixture)** (`test-headless-provider-single-action`, from `/runs` or the terminal)
tries each coding agent independently, in that order, on its own disposable
experiment-workspace fixture and the light-tier start model, then reports all
three in one receipt: PASS, FAIL or SKIPPED (a missing binary, sign-in or
headless flag skips only that provider, with the reason), the model each used,
the agent part and the host part separately, and, for every failed criterion,
the first error lines from that provider's log (`failureDetails`), so a failure
is diagnosable from `receipt.json` alone. It exits 0 when at least one provider
passes. From a terminal, `--providers codex,claude` picks a subset and
`--model-codex`, `--model-opencode` and `--model-claude` override a model. The
leak check still compares the live workspace before and after; a changed Codex
trust entry is recorded as ruled not a stop condition (2026-10-09), and any
other change is a possible Decision 0082 stop condition to attribute.

Inside Sessions and runs, **Active now** lists every prepared or running agent
Session and every pending or running execution Run across the whole portfolio,
independent of any recent-history limit — a Session that has been running far
longer than everything else never falls off the page just because newer work
finished — above a collapsed **Recent history**. Each Session card shows
its Action, packet, agent/model, host, worktree, native session id, lifecycle
status, and when it was last observed, plus **Copy Reattach** (and **Copy
Resume** for Claude Code Sessions) so you can act from a terminal; a phone-only
visit gets an explicit notice that reattach and resume need a terminal on the
Session's own host instead of a broken button. The page refreshes on its own
cadence, immediately when the tab regains focus or the device reconnects, and
backs off — never faster than once every two minutes — while the snapshot
source is unreachable, always labeling the view as showing the last known
state rather than silently going quiet.

The phone dashboard redesign is an accepted, inactive three-slice Plan; the
new `/actions` and judgment item routes are not live yet. Its
[information architecture](docs/proposals/runs-page-information-architecture.md)
keeps Flight Deck standalone and Production On/Off visible on Runs. The
[accepted Plan](docs/plans/redesign-the-phone-dashboard-into-one-judgment-home-a-complete-operator-script.md)
preserves the build order: judgment home, operator-script flow, then Runs and
navigation. Acceptance changed no queue, pointer or production setting.

The old **Accept the three-slice phone dashboard draft Plan** action is now a
historical handoff: its failed launch remains preserved, and it refuses after
its planning PR closes. Acceptance was recovered through Arcadia using the
operator's approval and a refreshed exact preview. Choose Plan activation and
queue placement before starting the first build slice; do not retry the old
button or reset its failure state.

Open **Path** at <http://arcadia-1.alpine-rattlesnake.ts.net:3020/path> (on this Mac:
<http://127.0.0.1:3020/path>) for the other question Now deliberately refuses: not
"what do I do in the next hour?" but "what is actually left between here and the
target?" Each `NORTH_STAR.md` gate becomes a leg, and under it every Action the
plan documents place before that gate, ordered by the `depends_on` those
documents declare — dependencies first, the gate's own Action last. Finished
steps are kept and collapsed, because a path with sixteen done steps behind it
reads differently from one that has not started; **Show the finished steps**
expands them.

Where nothing is planned, the path says so at full weight rather than leaving a
blank: an operator-owned gate no Action tracks, a gate whose `action:` reference
no plan carries any more, and an Action whose next move is still undecided each
render as a marked gap. That unplanned stretch is usually the real distance to
the target, and every surface that showed it as empty space taught you to read a
short list as a short distance.

The path also follows splits: an Action that was narrowed and marked `done`
brings its open `split_into` remainders onto the path as steps, so a split never
shortens the distance. The target's `why` is shown at the top of the screen.

Every step also says why it is on the route and which planned Action it is: the
Action's own `why:` when its plan declares one, otherwise a derived sentence
("Unblocks …", "Remainder of …", "Completes gate: …") marked *derived*. The step
title opens that Action, and `arcadia path` prints its `plan/<slug>#<action-id>`
reference; a gap whose Action no plan carries has nothing to open and says so.
The Now screen's **Do this now** carries the same reason and link.

Nothing can be added on this screen. It is a projection of `NORTH_STAR.md` and
the plans behind it — to change the path, change those documents. The same view
is in the terminal:

```bash
pnpm arcadia path
```

Under **The finish line**, gates that only you can see are tappable — a real
practitioner agreeing to be the pilot is not something Arcadia can observe, so
you tell it. One tap marks the gate done and the distance falls immediately;
tapping again undoes it. Gates that track an Action are not tappable, because
their status comes from that Action's record and a tap would put the document
and the database into disagreement. The same two verbs work in the terminal:

```bash
pnpm arcadia gate complete pilot-recruited
```

Use `gate reopen <id>` to undo. Both edit only the one `status:` line in
`NORTH_STAR.md` and leave the rest of the file exactly as you wrote it.

Open **System Status** at <http://127.0.0.1:3020/admin/status> when you need a quick readiness check. It shows whether Arcadia is ready for normal operation, image generation, and background processing, with live dependency reachability, worker heartbeats, and Intelligence job counts.

Open **Dispatch Journal** at <http://127.0.0.1:3020/admin/dispatch-journal> to see how often Arcadia refused to dispatch work, and which field in the managed documents blocked it. A field that blocks a large share of resolutions is either a rule worth relaxing or a habit worth fixing. It is read-only, like every other admin surface.

Open **Outstanding PRs** at <http://127.0.0.1:3020/admin/pull-requests> to see every open pull request across configured Project repositories, grouped with its Project, branch, review/check state, and plain-English readiness rating. Each card now includes a deterministic **Briefing**: changed paths, files not named in the PR body, managed pointer or plan changes, governed Decision documents, schema or migration changes, outward-facing paths, branch-order collisions, and the current CI conclusion. Expand the changed-path list when you need the evidence behind a fact. This view is read-only and never approves, merges, comments, or dispatches a PR; if GitHub cannot provide the detail payload, the inventory remains visible and the card says that briefing facts are unavailable.

Open the **QA queue** at <http://127.0.0.1:3020/qa> to test each configured Candidate from one exact procedure. The queue shows the configured revision, target state, validation and evidence freshness; **Test Candidate** opens only that configured target. **Check** runs the live reachability probe without delaying page load; an access-protected target that returns 403 is labelled unverifiable from here, not unhealthy. Above the Candidate cards, a **project strip** shows each configured Project once — the branch its checkout is actually on, its HEAD, how far it has drifted, and what its services report. Updating a checkout is a Project operation, so it lives there rather than repeating on every target card. Each strip offers one primary action for the state it is in: **Check for updates** fetches origin's refs and touches nothing else, **Pull *n* commits** fast-forwards without restarting, and **Restart services** is offered separately — and only when the incoming diff says it is needed. The verdict is computed from the changed paths before you pull, so a lockfile change reads as *install then restart* while a stylesheet reads as *HMR should cover this*; the files behind every verdict are one tap away, and the wording never claims a restart is unnecessary, only that HMR should cover it. **Check** stays available even when the pull is refused, because fetching never touches the working tree. When a checkout is on some other branch or detached, the strip offers **Switch to *base*** — one destination, the Project's own base branch, never a branch picker. Switching leaves the branch it moved away from exactly where it was, and says whether that branch had commits origin does not, so moving away from unmerged work is stated rather than silent. A dirty tree is refused before anything happens, and being ahead of origin is refused too — those stay yours to resolve. Remote targets never offer pull or restart because their deployment workflow owns that authority, and Projects without `scripts/services.sh` say plainly that Arcadia cannot restart them. Record Pass, Fail, or Needs follow-up with an optional note to create a revision-bound Decision. This records QA evidence only—it never merges, deploys, or releases work. Target configuration lives in the workspace at `config/qa-targets.json` — repository paths and LAN hostnames are facts about one machine, so they are not checked in; `config/qa-targets.example.json` documents the shape. Revision, validation, and evidence freshness are computed from each project's checkout rather than typed by hand.

Every Project Detail page at <http://127.0.0.1:3020/projects/{id}> now opens with a **demo hero**: one state — proof unavailable, Candidate failure, ready for your demo, QA failed, release Decision needed, or Stable-only — with exactly one primary next action, resolved from real checks rather than claimed. Below it, each configured Stable and Candidate target gets its own card with URL, environment kind, access state, source revision, health, and last verified time, plus its own **Show Stable** / **Test Candidate** link (works from a phone-reachable Mission Control whenever the target itself is not local-only) and a **Check now** button that runs a live reachability probe and persists the result. Stable/Candidate targets are a projection of the same workspace `config/qa-targets.json` list; a Candidate target reuses its QA queue id so a recorded QA Decision (`arcadia qa record`) is reflected in the hero automatically. Run a check from the command line with:

```sh
pnpm arcadia proof-target check <target-id>
```

For independent pull-request QA, give Arcadia the full GitHub URL:

```sh
pnpm arcadia qa pr https://github.com/owner/repository/pull/123
```

Use one token-efficient sequence: finish the Candidate, publish the complete
operator QA plan in the pull request, mark the pull request ready, wait for all
GitHub checks to complete successfully with an acceptable merge state, then run
Arcadia QA once. A draft, absent checks, any pending or non-success check,
conflicting duplicate checks, or a dirty or blocked merge state returns a
machine-readable not-ready refusal before patch retrieval, reviewer selection,
sandbox preflight, model invocation, QA Artifact creation, or QA Decision
creation. The refusal names every observed blocker and the retry condition; it
uses no reviewer tokens. Use `--rerun` only for a fresh independent judgment of
otherwise unchanged ready evidence, never to bypass readiness.

The repository must belong to a configured Arcadia Project. The command freezes
the current head SHA, reads the pull-request body, changed files, complete patch,
merge state, and GitHub checks, then runs one separately executed read-only
structured review inside an evidence-only, home-denied, network-denied sandbox.
The reviewer receives the exact base/head patch and no repository working copy,
credential-bearing home context, user tools, or configured command arguments. It
first establishes readable host controls for a Codex auth file, the Project's
Git HEAD, and GitHub network access, then requires the same sandbox invocation
to read its evidence while denying those exact controls. An unavailable host
baseline is Needs follow-up rather than being mistaken for sandbox denial. Its verdict must
exhaustively validate and cover Arcadia's seven fixed QA criteria. The command
rechecks the complete mutable evidence snapshot afterward and writes a QA report
Artifact plus a revision-bound Pass, Fail, or Needs-follow-up Decision under the Arcadia
workspace's `artifacts/qa/pull-requests/` directory. A failed, pending,
contradictory, missing, or stale check prevents Pass. Repeating the command for
the same completed revision with unchanged body, base, files, merge state, and
checks returns the existing receipts without another model call. Changed GitHub
evidence automatically creates a preserved new attempt; use `--rerun` only when
a fresh independent judgment of otherwise unchanged evidence is worth the added
token cost. The canonical receipt is only a cache hint: reuse reconstructs the
result from the independently persisted Decision context and cross-checks the
Artifact, Decision status, PR source, evidence fingerprint, paths, and stored
file hashes. Any mismatch creates a fresh review instead of trusting the cache.

`pnpm arcadia qa code-review <pull-request-url>` is the same executor with the
same readiness refusals, sandbox and receipts, judging the patch as code against
six code-review criteria (correctness, failure handling, state and concurrency,
security and authority, compatibility, tests). Its report and Decision live
under `artifacts/code-review/pull-requests/`. For a managed candidate it records
the exact-head code-review verdict the worker needs before it integrates (see
the managed-production section below).

Pull-request QA never runs commands copied from PR prose, edits the Candidate,
posts to GitHub, approves release, merges, deploys, or repairs a finding. It is
evidence for the operator's Decision, not that Decision's external effect.

## The four queues

Every item Arcadia tracks sits in exactly one queue, and the queue says who
owes the next move:

| Queue | Meaning |
| --- | --- |
| **Inbox** | Captured but not yet classified. Nothing acts on it until it leaves. |
| **Work Queue** | Classified and ready to be worked, by Arcadia or a coding agent. |
| **Requires Review** | Waiting on the operator to act, approve, or decide. A coding agent must not advance it. |
| **Blocked** | Waiting on an outside party or an external state change. |

```sh
pnpm arcadia queue --workspace "$WORKSPACE"
```

An Action's Responsibility answers the same question from the other side —
Autonomous, Codex, Requires Review, Blocked. The two vocabularies share
**Requires Review** and **Blocked** and mean the same thing there. They differ
at the front: a queue distinguishes unclassified (Inbox) from ready (Work
Queue), while Responsibility distinguishes who works a ready item (Autonomous
or Codex).

## Start a software Project from an idea

### Astro Field Notes staging demo

Arcadia has one deliberately narrow idea-to-live golden path. Send this shape
through Ask or Discord:

```text
Create a MartianRover Field Notes blog site
```

Arcadia deterministically classifies it as an Astro Field Notes Project,
creates an **Incubating** Project and one scoped proposal Decision, and sends a
Discord notification whose Project-details link is
`/projects/{project-id}`. The Project page is pre-populated with the template,
`$create-astro-site` generator skill, selected coding agent, validation command,
and Cloudflare Workers staging target.

For the live demo:

1. Create an empty GitHub repository. Do not initialize it with a README.
2. Open the Project link from Discord, enter the GitHub HTTPS or SSH URL, choose
   Codex or Claude Code, and save Project Setup.
3. Read the proposal boundary and approve its Decision on the same page.
4. Keep the Arcadia worker and Discord adapter running. The worker initializes
   the configured local repository, attaches the GitHub URL as `origin`, asks
   the selected agent to use `$create-astro-site`, runs `pnpm run build`, and
   runs `wrangler deploy --env staging`. Wrangler creates or updates the
   separate `{project-name}-staging` Worker with static assets from `dist`.
5. Wait for the Discord Artifact notification titled `Live staging URL:` and
   open the HTTPS `workers.dev` link. The same URL is stored on the Project page.

Approval covers only that repository initialization, dependency/network use by
the selected coding agent, the build, one Cloudflare Workers staging deploy, and
the configured Discord notification. It does **not** authorize Git push, a pull
request, merge, production deployment, custom domain, publication, deletion, or
spending. The GitHub URL is attached as provenance/origin; this golden path does
not push to it. Cloudflare staging uses Workers Static Assets and a named
Wrangler `staging` environment rather than Pages or Git integration. The worker
must already have working Cloudflare Wrangler
authentication, and the selected coding agent must have the
`create-astro-site` skill installed. A missing skill, build failure, missing
Wrangler installation, missing Cloudflare authentication, or absent
staging `workers.dev` URL fails the Run legibly and never records a fake live
link.

Next.js and Node generators are not claimed by this path yet. Add the second
stack when its concrete generator skill, build output, and staging contract are
ready to test end to end.

### Explicit planning-first preparation

Use the explicit preparation path when the input is a new software-Project
idea, not an idea to shelve in Back Burner:

```sh
pnpm arcadia project prepare "Teacher Commons" \
  "A calm web app where teachers exchange classroom resources and keep attribution intact." \
  --path /path/to/teacher-commons
```

Omit `--path` to create the repository directory under the Arcadia workspace's
Projects directory. The command classifies the request as **Project Work → Plan
First → Codex**, preserves the idea verbatim, creates an Active Project and its
first Milestone and planning Action, writes the `PROJECT.md` → active plan →
current Action pointer chain, adopts the repository's agent context, and creates
the immutable read-only planning packet plus one Planning Decision.

It invokes no model and starts no Run. Its final `Trigger:` line is the exact
`arcadia review approve <decision>` command that authorizes one read-only
planning Run for that packet. Approval does not authorize implementation,
merge, deployment, release, credentials, spending, production access,
publishing, deletion, or outbound communication. Accepting the resulting
validated planning Artifact now marks the planning Action done, promotes its
smallest concrete implementation goal into exactly one current managed build
Action, and prepares that Action's immutable build packet. Acceptance starts
no implementation Run. Its receipt prints the exact separate
`arcadia work run ... --allow-codex-build --agent-profile ...` trigger that can
start the build after the operator chooses to do so. Re-acceptance reuses the
same Action and packet, while a changed or malformed planning Artifact fails
closed before either managed pointer moves.

Preparation refuses an already registered Project name or repository and any
repository that already carries a `PROJECT.md` or managed plan. It never
replaces another Project's work pointer.

## Normal daily use

1. Read **Today's Advantage**: one ready Action, its expected Artifact, and why it matters now.
2. Click **Prepare Planning Decision**. This creates the bounded planning packet but does not run Codex.
3. Open **Needs you**, inspect the packet, and choose Approve & Run, Reject, or Defer. Each
   choice previews its consequence before it is confirmed, and a Defer is refused
   until it names the trigger condition that will bring it back. Packet and Run
   handoffs use the same two-step interaction: confirmation states what will and
   will not happen, then leaves a receipt with the durable record or guarded
   command. Confirming a handoff alone records no Decision and starts no Run.
4. Use **Runs** to follow approved work and inspect its Artifacts, Validation, and Log.
5. Return to **Needs you** to accept a successful plan; for an explicitly
   prepared software Project, the page renders the original idea, Milestone,
   proposed Actions, Token Impact and Budget, target repository, and judged
   Artifact revision without requiring raw Markdown. Choose exactly one outcome:
   **Approve plan** marks the planning Action done, promotes one current build
   Action, and prepares—but does not run—its packet; **Defer** requires the named
   condition that revives it; or **Send back** requires refinement feedback,
   preserves the current Artifact, and reopens the planning Action for Codex.

Use the collapsed **Focus** control at the top of **Needs you** to choose a
primary Project, an optional secondary Project, and Projects to park for now.
Each completed change saves automatically in the Arcadia workspace, so the
same ranking follows the operator across browsers and devices. The stored
`config/arcadia.json` `reviewFocus` also keeps the visible set bounded.
Use **Search Decisions** above that control to find a Decision by its governed
number, question text, recommendation, or Project. Search includes focused,
parked, lower-priority, and historical items rather than treating the focus
limit as a search boundary. Document-backed items display their governed
number (for example, **Decision 0038**) on the selected card, compact queue
rows, and excluded rows; database-native Decisions retain their `R…` number.
Historical packets and Runs older than 30 days remain behind the history
control unless they belong to a selected current Action. No Review, packet, or
Run is deleted.

For a clarification that looks stale or disconnected, choose **Reassess**.
Arcadia checks the question against the Project's checked-in active plan before
asking for an answer. If the source plan or question no longer governs current
work, the Decision leaves **Needs you** and remains preserved in history with a
receipt explaining why. If the active plan still declares it, Arcadia reports
**Still declared**—not that the question remains semantically valid—and keeps
the Decision visible. Choose **Flag for agent review** to park that Decision
outside **Needs you** in Agent Queue for a later repository-aware assessment;
flagging starts no coding-agent Run. The same transitions are available as
`arcadia review reassess <id>` and `arcadia review flag-agent <id>`.

Before feeding another coding agent, inspect the portfolio **Agent Queue**. It
keeps every approved, unfinished Action in one explicit order, including work
that is blocked, dependency-waiting, operator-owned, or waiting for its
checked-in Project pointer. The terminal projection reports the queue revision,
whether every Action has a position, and the first pointer-authorized eligible
Action:

```sh
pnpm arcadia advance queue --workspace "$WORKSPACE"
```

An item in the attention lane always names the reason and next repair or
Decision. The queue never grants authority: a ready row still passes through
the existing document, responsibility, approval, repository, and provider
availability gates. An unpositioned Action makes the order invalid and leaves
`Next` empty until its position is explicitly approved.

Preview a move, then apply the exact move against the displayed revision:

```sh
pnpm arcadia advance queue reorder --move arcadia/example-action --top \
  --revision 7 --request-id operator-20260901-1 --workspace "$WORKSPACE"
pnpm arcadia advance queue reorder --move arcadia/example-action --top \
  --revision 7 --request-id operator-20260901-1 --apply --workspace "$WORKSPACE"
```

Use `--before <project/action>` or `--after <project/action>` instead of
`--top`. For a complete drag-and-drop style replacement, use `advance queue
arrange --order <project/action...>` with every active Action exactly once.
Every applied mutation returns a receipt; preview and then apply
`advance queue undo --receipt <receipt-id>` to restore the immediately prior
order. Request ids are idempotent, stale revisions are refused, and undo is
refused after the queue has changed again.

Queue order does not override checked-in dispatch truth. To choose a ready
queued Action that is labelled `waiting_for_pointer`, preview the exact Project
and active Plan patch, then apply its fingerprint:

```sh
pnpm arcadia advance queue make-next --action arcadia/example-action \
  --revision 7 --request-id pointer-20260901-1 --workspace "$WORKSPACE"
pnpm arcadia advance queue make-next --action arcadia/example-action \
  --revision 7 --request-id pointer-20260901-1 \
  --preview <sha256-from-preview> --apply --workspace "$WORKSPACE"
```

### Production scheduling and the GitHub board

Under an Active production policy the worker does not wait for `make-next`.
Every tick runs a **scheduling pass** first: it computes each Project's
canonical queue -- scheduling class (`interrupt` > `blocker` > `corrective` >
`planned`), then queue position, with dependencies always honoured -- and
moves the governed pointer to the first ready Action in that order, using the
same preview-then-apply transition as `make-next`. Projects are scanned in
one configured order and the first with runnable work is selected.

```sh
pnpm arcadia schedule status --workspace "$WORKSPACE"
pnpm arcadia schedule prioritize --order private-practice-now arcadia rebuster --workspace "$WORKSPACE"
pnpm arcadia schedule classify --action arcadia/example-action --class corrective --workspace "$WORKSPACE"
pnpm arcadia schedule log --workspace "$WORKSPACE"
```

Each Project can project its queue onto a GitHub Project board: one Issue per
Action, an `Arcadia status` field (`Needs operator`, `Ready`, `Running`,
`Blocked`, `Done`, `Backlog`), an `Arcadia push` field naming what the Project
will get through before it next needs you, and card order equal to queue order.
Link an existing GitHub Project or create one, then reconcile:

```sh
pnpm arcadia schedule github link --project arcadia --owner pmark --create --workspace "$WORKSPACE"
pnpm arcadia schedule reconcile --workspace "$WORKSPACE"            # preview: what the boards say
pnpm arcadia schedule reconcile --apply --workspace "$WORKSPACE"    # apply drags, move pointers, re-project
pnpm arcadia schedule reconcile --apply --project arcadia --workspace "$WORKSPACE"  # one Project only
```

`link` is the only command that changes the board's own structure: it creates
whichever of the `Arcadia status` field and the optional `Arcadia push` field
the board is missing, including a board that has only the status field. Preview and every worker tick only read, and refuse a board
with no status field rather than creating one; a board with no push field simply
carries no push labels. `--project` scopes the whole pass, so a scoped run cannot reorder another
Project's board or move another Project's pointer.

A linked board costs very little to keep synchronized. Arcadia publishes its
own changes immediately, and otherwise reads the board about once a minute to
notice a drag, reusing cached GitHub ids — roughly sixty calls an hour per
board rather than thousands, which matters because the GraphQL limit is shared
with every other `gh` command on the account.

Dragging Ready cards on the board is the one operator input Arcadia reads
back. A drag within one scheduling class is persisted as the new queue
position; a card dragged above a higher class or above its own dependency is
put back in canonical order and the reason is written to `schedule log`. No
Decision is opened for an invalid drag. In the board view, group by `Arcadia
status` and filter out `Backlog` and `Done` to see only the active Milestone;
a second view filtered to `Backlog` is the backlog; a third grouped by `Arcadia
push` and filtered to `Arcadia push:This push,"This push · sequence"` is the
current push. Creating a view is always a click in GitHub's own UI — its API
cannot make one.

`arcadia schedule status` prints the same push: lanes by repository, each
lane's token-point total, the boundary that will stop it, and the named work
after that boundary. The Runs dashboard shows it above its history, and each
card's push label is rewritten by every board projection rather than cached, so
it cannot outlive the Plan it describes.

A coding Run that finds work it was not sent to do records it instead of
doing it:

```sh
pnpm arcadia schedule discover --from arcadia/example-action --kind blocker \
  --title "Fix the migration the Action depends on" \
  --acceptance "The migration applies cleanly" --request-id disc-20260917-1 --workspace "$WORKSPACE"
```

A `blocker` is written into the active Plan, the origin Action is made to
depend on it, and it becomes the next runnable Action. A `corrective` is queued
ahead of remaining planned work without interrupting the current Run. A
`follow_up` goes to the backlog. Discovery stops at depth 2, three corrective
descendants per root Action, or eight correctives per Milestone, and opens a
Decision instead. A ninth failed Run in one Milestone pauses the Project with
a Decision. `schedule resume --project <slug> --reason ...` continues it, and
refuses while that Decision is unanswered — answer it with `arcadia review
approve <id>` or `arcadia review reject <id>` first, because skipping that
judgment is the one thing the pause exists to prevent.
[`docs/github-board-guide.md`](docs/github-board-guide.md) is the
project-manager guide to running production from the board: setup, what each
status means, what dragging can and cannot do, and what Arcadia does when it
finds work mid-build. [`docs/production-scheduling.md`](docs/production-scheduling.md)
has the full rule set and what was deliberately not built.

Apply is refused when the queue revision, Git worktree, managed documents, or
preview fingerprint changed. Arcadia re-resolves dispatch from the edited
documents before recording the receipt and restores both files on failure. A
successful apply commits the two pointer documents on whatever branch it ran
from and never pushes, so the governed pointer is durable and the next
clean-tree-gated command is not blocked by the move. If that commit cannot be
made — for example, no Git identity is configured — the command reports the
failure instead of claiming success, and the pointer documents are left as an
uncommitted working-tree change to commit before the next clean-tree-gated
command.

For software work, use the demo-first handoff contract even while Mission
Control's richer proof surface is still being built:

1. The coding agent supplies a stable runnable demo, or explicitly records why
   the Action has no observable behavior to demonstrate.
2. The operator exercises the candidate first and records product feedback.
3. Before accepting the Action, approving a merge or release, or delivering to
   a client, the operator reads and understands the relevant Log and QA
   evidence. The Log is the audit trail; it is not a substitute for the demo.
4. A candidate does not replace the known-good stakeholder demo until QA and
   release verification have passed.

The Project Detail hero and its state-aware Test/Show action are described
above and live now. A screenshot proof gallery, automatic GitHub/Cloudflare
target discovery, and a release-Decision workflow beyond this configured QA
queue remain specified but unbuilt in `docs/plans/demo-first-delivery.md`; the
demo-first handoff contract above still governs those steps manually until
they exist.

Use the **Ask** box for a new request that is not already an Action in Arcadia.

Deterministic special routes are declared in the operator workspace at
`config/ask-rules.json`. Version 1 rules use one exact, case-insensitive
start-of-message prefix with explicit colon, whitespace, or end boundaries;
they cannot contain regular expressions, code, nested conditions, or hidden
priority. Ask reports the matched rule, route evidence, stripped processing
payload, ordered processors, proposed writes, non-actions, and approval gates
while preserving the submitted message unchanged.

For the first Living Songbook route, point `sourceRef` at the checked-in file
that defines the Project-owned processing contract:

```json
{
  "version": 1,
  "rules": [{
    "id": "songbook",
    "enabled": true,
    "prefix": "songbook",
    "boundaries": ["colon", "whitespace", "end"],
    "destinationProject": "living-songbook",
    "processingProfile": "living-songbook-v1",
    "sourceRef": "docs/ask-processing.md",
    "examples": {
      "matches": ["songbook", "songbook repertoire", "songbook: practice 20"],
      "misses": ["Please update my songbook", "songbooks"]
    }
  }]
}
```

Test a rule through the same matcher and deterministic extractor used by live
Ask. This performs no capture or Project write and supports the standard JSON
envelope:

```sh
pnpm arcadia ask-rule test "songbook: add this source https://example.com/song" --workspace "$WORKSPACE"
pnpm arcadia ask-rule test "songbook plan Living Songbook work" --project arcadia --workspace "$WORKSPACE" --json
```

Routing precedence is explicit `--project`, exact enabled prefix, unambiguous
reply context, extracted Project reference, then the general intent registry.
The receipt retains lower-precedence disagreements as ignored candidates.

### Agent Ask v1

Any coding agent can ask for help, raise a concern or propose work without
interrupting the current Action. Asking is separate from approving or executing.
For capture only, submit a strict JSON proposal directly through the CLI:

```sh
pnpm -s arcadia agent-ask preview '{"agent_ask":"v1","request_id":"agent-help-<unique-id>","project":"arcadia","intent":"proposal","requested_authority":"propose","desired_result":"Request a bounded specialist review.","rationale":"Capture for consideration; keep current work unchanged."}' --json
```

A successful invocation is the whole submission: Arcadia preserves the request
and its capture/proposal receipts in the configured workspace; Project documents
and the queue stay unchanged. Inline input requires no file. A longer request may
instead be supplied from a temporary or ignored JSON file:

```sh
pnpm -s arcadia agent-ask preview --file /tmp/my-ask.json --dir /tmp --json
```

The file contains the same strict proposal envelope. `--dir` permits the external
input directory and does not change the configured workspace. After successful
registration, the input file is disposable; no Git commit, PR or ongoing file
management is required to keep the registered request. If registration fails,
preserve the input until submission or durable handoff succeeds. Save the returned ids and inspect refusals. No Ingress
copy, draft file, settlement or new coding session is required on this path.
If receipt writes are sandbox-denied, request the host's normal permission or
approved host execution for this same command; proceed only if granted. Otherwise
preserve a validated draft in an isolated checkout through the Git/PR handoff.
Before successful registration, local input storage alone is not registered
intake or a remote backup. The detailed
[agent-neutral procedure](docs/agent-guidance/agent-asks.md#ask-freely-without-interrupting-current-work)
covers retry, discovery and preservation boundaries.

A coding agent can hand Project-management intent back to Arcadia without
authoring managed documents or database rows. Prefer compact JSON (accepted as
YAML 1.2); the equivalent strict YAML form is:

```yaml
agent_ask: v1
request_id: agent-example-001
project: arcadia
intent: action
desired_result: Add deterministic validation for Agent Ask envelopes.
rationale: Agents need a reliable handoff into governed Project work.
acceptance:
  - Invalid authority claims are refused before capture.
  - Exact retries return the original receipt.
dependencies: []
requested_authority: propose
```

Save the envelope to a file and preview it:

```sh
ARCADIA_SURFACE=claude pnpm arcadia agent-ask preview --file /absolute/path/agent-ask.yaml --workspace "$WORKSPACE" --json
```

`--file` (for `preview` and `draft`) reads only from the repository or
worktree you run the command in: a relative path resolves from your directory,
not Arcadia's checkout, and a missing file or one that resolves outside that
repository (including through a symlink) is refused. For a file kept
elsewhere, pass `--dir` naming the directory that contains it.

Preview preserves an immutable capture and proposal receipt but performs zero
Project writes and creates no queue entry. `requested_authority` may be
`propose` or `apply_if_approved`; an agent cannot claim that work is approved,
answer its own Decision, or grant execution authority. Exact request-id replay
returns the first receipt, while changed content under that id is refused.

Plain text is available as a deliberately less precise `auto` fallback and
requires an explicit request id:

```sh
ARCADIA_SURFACE=claude pnpm arcadia agent-ask preview \
  "Make Arcadia explain why one Action is next." \
  --request-id agent-natural-001 --project arcadia --workspace "$WORKSPACE" --json
```

The fallback never invents a Project, intent kind, dependency, date, priority,
or approval.

**Asks merged from anywhere wait for your approval by themselves.** A cloud or
phone session can only commit its Ask to `.arcadia/asks/`, because it has no
workspace to preview it in. Once that commit is merged, the managed-production
worker previews the Ask on its next tick, right after it fast-forwards the
Project's base branch. The Ask then waits under **To-do** at the
top of <http://arcadia-1.alpine-rattlesnake.ts.net:3020/runs>, titled with its
`desired_result`, with Accept and Reject. You never need to run an `agent-ask`
command on this Mac. (`/review` is the Decision board; Agent Asks are not
listed there.)

- `complete` Asks are the exception. The worker settles those itself from
  their evidence, so it does not surface them.
- For this file-discovery path, only an Ask committed on the base branch
  surfaces. A file that is untracked or edited locally is not submitted by
  saving it; direct CLI preview above registers intake without that commit.
- An Ask file that will not preview is named in the worker log once per version
  of the file.
- This needs the worker running with an Active production policy that includes
  the Project, because surfacing rides on the worker's own base-branch refresh.

Both `action` and `plan` Asks may carry an `actions` list. Each child accepts
an optional `id`, `desired_result`, `acceptance`, `dependencies`, optional
`references`, and — when amending a Plan — an optional Action `target_ref`.
Dependencies may name an existing Action in the target Plan or an earlier
Action in the same bundle. Top-level `references` are shared by every child.
For an Action amendment, `dependencies` and the merged `references` are
replacement lists: an explicit empty list clears stale values.

With `intent: plan` and no Plan `target_ref`, one settlement creates a complete
non-active draft Plan. Arcadia chooses the managed-document path and a
dependency-safe Action order; the agent supplies the desired results and
observable evidence. At least one complete Action is required:

```yaml
agent_ask: v1
request_id: agent-release-plan-001
project: arcadia
intent: plan
desired_result: Deliver a queue-aware release.
references:
  - docs/release-contract.md
actions:
  - id: build-release-proof
    desired_result: Build release proof.
    acceptance:
      - The release proof exists.
    dependencies: []
    references:
      - tests/release.test.ts
  - desired_result: Publish the release guide.
    acceptance:
      - The release guide exists.
    dependencies:
      - build-release-proof
requested_authority: apply_if_approved
```

`id` is optional and names the Action handle operators type into
`advance queue reorder --move/--before/--after`, `advance queue make-next
--action`, and `depends_on`. It must be a lowercase hyphenated slug of at most
64 characters, and settlement refuses one already used in the active Plan
rather than silently renaming it. Omit it and Arcadia derives a short handle
from the leading clause of `desired_result` — at most six words and 48
characters, never cut mid-word — appending `-2`, `-3`, and so on only to break
a collision.

Settle that proposal with `--responsibility autonomous` or `agent`, but without
a queue placement. The draft remains inactive: Arcadia does not change the
Project pointer, grant dispatch authority, or put its Actions in the execution
queue.

To change an existing Plan, set top-level `target_ref: plan/<slug>`. Children
without a target create Actions; children with `target_ref: action/<id>` amend
the named Action. When the target is active, one approved `--top`, `--before`,
or `--after` moves every unfinished Action in that Plan as one contiguous,
dependency-safe queue segment in the same settlement. Adding an Action to the
active Plan requires both its approved Responsibility and a placement. A draft
Plan can be amended but cannot be queued before activation.

An `action` Ask still supports a smaller ordered bundle in the active Plan,
inserted at one approved boundary while preserving its declared order. Preview
lists every proposed effect, and the settlement receipt and Discord summary
name the affected Plan, every created or amended Action, every queue key, the
changed queue segment and position, and the resulting next eligible Action. To
correct a proposal, reject it and submit corrected content with a new request
id. Both dispositions remain traceable.

Settlement accepts strict proposals for an explicit configured Project. For a
new Action or an active-Plan reprioritization, the operator supplies any
required Responsibility and the approved queue position, previews the exact
managed Plan and portfolio-order effect, then applies only that fingerprint:

```sh
pnpm arcadia agent-ask settle \
  --proposal agent-example-001 --request-id settle-agent-example-001 \
  --disposition accepted --responsibility agent --top --revision 4 \
  --workspace "$WORKSPACE"
pnpm arcadia agent-ask settle \
  --proposal agent-example-001 --request-id settle-agent-example-001 \
  --disposition accepted --responsibility agent --top --revision 4 \
  --preview <sha256-from-preview> --apply --workspace "$WORKSPACE"
```

Apply requires a clean Project worktree, at least one observable acceptance
criterion, valid active-Plan dependencies, a valid existing queue, and the
unchanged preview fingerprint. It writes the canonical Plan or Action effects,
synchronizes the operational projection, assigns explicit contiguous queue
positions, and persists a settlement receipt. Use `--disposition rejected`
without a Responsibility or queue placement to preserve the proposal while
creating no executable work.

To activate an existing draft Plan, preview a `plan` Ask targeting
`plan/<slug>` with no child Actions. Settle it using `--activate`,
`--action <id>`, `--model <model-id>`, optional `--effort high`, and
`--top` (or `--before`/`--after`). Apply requires the same options and
exact preview fingerprint. The writer changes the Project milestone and both
pointers, returns the previous Plan to draft without claiming completion, and
replaces only that Project's queue segment. An ineligible first Action or
unreconciled Project Session refuses activation. Activation starts no process
and grants no merge, deployment, spending or unattended-production authority.
Select a model supported by the agent that will launch the next session.

Sessions start small. Whatever tier the plan names, `arcadia go --launch`,
`session launch`, the dashboard and the production tick start the Session on the
light model of its provider (Codex `gpt-6-luna`, Claude `haiku`, opencode
`opencode-go/glm-5.3-flash`); an explicit `--model` still wins. `arcadia go`
prints `Starts on <model>; escalation model for hard sub-problems: <model>`, and
the Action brief's "Calling in help" section tells the Session how to call in the
plan's tier (a Claude subagent, Codex `spawn_agent`) or, if it cannot, to draft a
proposal Agent Ask for a relaunch at that tier. Change the start tier per
workspace with `{ "sessionStartTier": "standard" }` (or `"plan"` for the old
behavior) in `config/coding-agent-models.json`. Light starts run at low effort
even for a deep Action, which can cost more repair attempts; overriding the start
tier toward heavy raises cost. See `docs/model-selection.md`.

To mark a governed Action done, preview a `complete` Ask targeting
`action/<id>` with `candidate_revision` (the Candidate's exact git sha) and
`evidence`: one entry per declared acceptance criterion, verbatim and in the
plan's own order, each `met`, `failed`, or `skipped`. Settlement refuses any
criterion not `met`, an Action with an unresolved required review Decision, a
`candidate_revision` that no longer matches the repository's HEAD, or an
already-done Action. Apply additionally requires `--operator` — this
transition is operator-only, the same way `operator-task close` is:

```sh
pnpm arcadia agent-ask settle \
  --proposal complete-example-001 --request-id settle-complete-example-001 \
  --disposition accepted --workspace "$WORKSPACE"
pnpm arcadia agent-ask settle \
  --proposal complete-example-001 --request-id settle-complete-example-001 \
  --disposition accepted --preview <sha256-from-preview> --apply --operator \
  --workspace "$WORKSPACE"
```

Applying marks the Action done, appends one Log entry naming the accepted
evidence and Candidate revision, and advances `current_action` to the next
eligible Action in the same Plan — or, if a nearer Action is blocked or still
carries an open question, to that Action instead, so dispatch reports exactly
what it needs. When nothing remains open in the Plan, it reports the Plan
complete rather than inferring a different Plan from queue order. Completion
grants no merge, deployment, spending, Session launch, or unattended-production
authority; it only records evidence the operator already accepted.

Every applied accepted or rejected settlement creates one durable Discord
outbox item. The configured Arcadia Discord bot posts a brief effect summary,
queue position, and resulting next Action, then records the Discord message id.
A `complete` settlement — arcadia-go finishing an Action — posts a shorter ping
instead: one line naming the Action just marked done, followed by up to 5
Actions currently at the front of the Ready lane, read live so the list
reflects the queue at delivery time rather than at settlement time. Preview,
refusal, conflict, and rollback create no ping. Other accepted intents
use the same receipt path and smallest canonical effect:

- `outcome` updates the Project Outcome; `milestone` updates the Project and
  active Plan together.
- `plan` creates a complete non-active draft Plan, amends Actions in a named
  Plan, or reprioritizes the active Plan's unfinished Actions as one segment. A
  targeted Plan Ask with no child Actions or placement retains the concise
  Milestone-amendment behavior.
- `action` with `target_ref` amends that Action's next step, acceptance, and
  explicit dependencies while preserving Responsibility and queue position.
- `decision` creates one open Decision; `auto` and an untargeted
  `project_update` also create one open Decision instead of guessing structure.
- `artifact` creates a planned Project Artifact reference, `log` appends the
  Project Log, and `proposal` preserves accepted evidence without inventing a
  parallel Project record.
- `project_update` currently accepts explicit `target_ref: outcome` (or `goal`)
  and `target_ref: milestone`; other targets become the focused open Decision
  above.
- `complete` marks one Action done from bound Candidate evidence and advances
  the pointer; its apply requires `--operator` in addition to the exact
  preview fingerprint every other intent already requires.

Rejection is supported for every proposal and never creates executable work.

### Quick pings from an agent

When an agent only needs your eyes on something — it added a button to the
Actions page, a page is ready to look at, something odd turned up and nobody is
blocked — it runs `arcadia ping "<message>"` instead of filing an Ask. The bot
posts it to Discord as a short message headed 👀 Take a look, ℹ️ FYI or 🔔 Needs
your attention, with an optional link. A ping is read-only: it approves
nothing, answers nothing, opens no Decision and leaves no durable record beyond
its delivery row. Anything that needs your answer still arrives as a Decision,
a picker or a PR.

An agent can aim a ping at a channel with `--channel <alias>`. It reaches only
channels you list in the bot's `DISCORD_PING_CHANNELS` (for example
`actions=<channel id>,review=<channel id>`; see `apps/discord-bot/README.md`);
an unlisted name still arrives, in the default channel, with a note saying so.
The same message to the same channel inside ten minutes is sent once, and at
most 30 pings queue per hour, so a looping agent cannot flood your phone.

### Where Discord messages land

Set `DISCORD_CATEGORY_CHANNELS` in the bot's `.env` (see
`apps/discord-bot/README.md`) to split the bot's proactive messages across
channels you can mute separately. `alerts` gets production red alerts, CI-blocked
pings, failed runs and blocked work; `briefings` gets the daily orientation
packet and digests; `log` gets routine progress such as settlements, PR-opened
pings and completed work. Anything that needs you (review items, opened
Decisions, PR-ready pings) always stays in the default channel, which is also the
only one that accepts requests. A category you leave unset, or a channel the bot
cannot reach, falls back to the default channel, so nothing is lost.

## Managed production: the standing authorization

Managed production is the switch that lets Arcadia admit and advance approved
work without a new chat or a manual Session launch between Actions. It is a
*permission*, not an activity: **Active** means Arcadia may admit work,
**Building** is an observation about what happens to be running.

It defaults to Inactive, and the switch by itself launches nothing — this
slice persists the authorization and gates admission. Read the current state
with the noun:

```sh
pnpm arcadia production status
```

When managed production hits a Stop the line failure, `production status` lists
it first under `RED ALERTS`, before every other section. The worker tick
detects four triggers with no model call: an admission refused on consecutive
ticks (at least 5 ticks over at least 10 minutes), a Session past its stall
window, a failed reconcile, and a failure repeating until the repair budget is
exhausted. Each distinct failure is one alert (Project, Action, Session id,
trigger, first-seen time, and an evidence file under
`artifacts/generated/red-alerts/`); a repeat updates it, it clears when the
failure resolves, and each new alert posts once to Discord. Alerts only
report: they never change admission, approvals, or credentials.

**Red alert diagnosis is off by default and costs nothing until you turn it
on.** It calls a model, so it is behind an explicit flag in the workspace
`config/arcadia.json`:

```json
"redAlertDiagnosis": { "enabled": true, "issueRepo": "pmark/arcadia", "tokenBudget": 4000 }
```

With it on, the worker starts at most one background diagnosis per open alert
(never a retry). It makes one local-preferred call through the Intelligence
service (LiteLLM route `text.generate`, profile `fast`, paid usage refused; no
coding-agent Session is launched), so the cost is one small local-model call
per alert, capped by `tokenBudget` (default 4000; a prompt over budget makes no
call, and an answer whose reported usage is over budget is discarded). It files
or updates one `bug` Issue in `issueRepo` through `gh`, and drafts a fix Action
Ask under `artifacts/generated/red-alerts/.arcadia/asks/` for you to settle
(`arcadia agent-ask settle --proposal <id>`); it edits no code and merges
nothing. A fix touching the concurrency gate, admission policy, approval
boundaries or credentials is marked `needs_operator` and must stop at an open
pull request. `production status` shows each alert's diagnosis outcome, tokens
used, route and Issue; a diagnosis that exceeds its budget or finds no cause is
recorded on the alert, which stays open. Without `enabled: true` and
`issueRepo`, nothing runs.

Preview exactly what activation would authorize before granting it. The
preview writes nothing and shows the included Projects and Plans, the resulting
ordered Action scope, the permitted providers, the concurrency ceiling, which
mechanical transitions are delegated, and — just as importantly — what
activation does *not* buy:

`--transitions` defaults to `validation,acceptance,pointer`. Adding
`packet_approval` (Decision 0072) lets the worker approve the build packet of
an Action inside the grant's own scope, but only when that approval is the
last thing standing between the Action and launch. Naming it also requires
`--packet-approval-expires-at <iso>` (a strict UTC instant such as
`2026-10-03T00:00:00.000Z`); once that passes, the delegation lapses and packets
wait for the operator again. It is never implied: name it explicitly, or every packet still waits for `arcadia review approve <id>
--no-execute`, which `production status` shows as a
`build_packet_approval_pending` escalation.

```sh
pnpm arcadia production preview \
  --project arcadia \
  --provider claude --provider codex \
  --intent "Finish the bootstrap Plan without a per-Action relay." \
  --concurrency 2
```

Grant it with the same options plus an idempotency key, the authorizing
operator, and the revision the preview showed. A moved policy refuses rather
than overwrites, and replaying a `--request-id` returns the original receipt:

```sh
pnpm arcadia production activate \
  --project arcadia --provider claude \
  --intent "Finish the bootstrap Plan without a per-Action relay." \
  --request-id bootstrap-grant-1 --granted-by "$USER" --expected-revision 0
```

**Remote preservation is opt-in.** Without `--remote-preservation`, managed
preservation stays `LOCAL ONLY`: the candidate commit is kept on this host and
the receipt names the push/draft-PR recovery step. Pass `--remote-preservation`
to both `production preview` and `production activate` to let preservation also
push the candidate branch and open a **draft** pull request for an Action in the
scope. That is all it authorizes on its own: it never marks a pull request
ready for review, never merges, and never pushes the base branch. Marking the
host-created PR ready, pushing a later settled head to it, and running its
reviewers additionally need a current Decision 0058 integration grant naming
the Action; see "Independent
verdicts, run by the tick" below. Merging on GitHub and pushing the base
branch stay outside every grant. The preview, `production status` and the activation receipt each print a
`Remote preservation: on|off` line, and the option is part of the scope
fingerprint, so an activation (or a replayed `--request-id`) that differs from
its preview is refused. No other flag, environment variable or dashboard
control can turn it on.

Switch it Off at any time:

```sh
pnpm arcadia production deactivate --request-id bootstrap-off-1 --reason "Stopping for the day."
```

**Off stops new admissions immediately and fences every reserved-but-unlaunched
Action. Work already committed to a launch keeps running and is reconciled;
nothing is killed and nothing is deleted.** The command prints both lists, so
work that survives the cutoff is named rather than concealed. Off also bumps a
monotonic revision, so a stale worker holding an old view cannot resurrect the
grant it lost.

**Saved configuration is not active permission.** When Off clears an active
scope it also saves, in the same transaction, the exact reviewed configuration
(Projects, Plans, the ordered Action allowlist, providers, concurrency,
delegated mechanics and, when it was granted, remote preservation) in a separate
store with its own revision and fingerprint.
Nothing reads that store as authority: every admission gate still requires
`desiredState: active`, and `production status` shows it under "Saved
configuration (not active permission)". Off does **not** save, and On never
restores, anything time-bound or delegated: a candidate-integration grant, a
rehearsal exception, or the `packet_approval` delegation and its expiry. Each
needs a fresh grant from the CLI. Off does clear remote preservation from the
active policy at once (no candidate is pushed while Off); a reactivation of a
configuration activated with `--remote-preservation` restores it, because it is
part of the fingerprint `reactivate-preview` shows (`Remote preservation: on`),
and never adds it to a configuration that lacked it. A second Off keeps the
first save; an Off from a policy that was never active has nothing to save.

To switch back On, preview first, then reactivate bound to what the preview
showed. Reactivation replays the saved scope verbatim into a **fresh epoch**
with fresh authority, never a revived one. It never re-derives the Action list
from the queue or pointer: if a saved Action is done, blocked, deferred or gone,
its Plan is no longer active, a provider is no longer configured, the saved
scope delegates `packet_approval`, or the policy or saved configuration moved
since the preview, it refuses and names the exact gate (`action_not_open`,
`action_missing`, `plan_not_active`, `provider_unknown`,
`packet_approval_expiry_required`, `policy_revision_moved`,
`configuration_revision_moved`, `configuration_fingerprint_mismatch`,
`already_active`, `saved_actions_empty`, `no_saved_configuration`):

```sh
pnpm arcadia production reactivate-preview
pnpm arcadia production reactivate --request-id bootstrap-on-2 --granted-by "$USER" \
  --expected-revision <n> --expected-configuration-revision <n> --expected-fingerprint <sha>
```

The Runs dashboard On switch does exactly this and answers 409 with the same
code and remedy on a refusal. Effective concurrency stays one until the
concurrency proof gate opens, whatever the saved ceiling says. An Off that
predates this store left nothing to restore: the first On after upgrading
needs one `production preview` and `production activate` from the CLI.

Two states are deliberately distinct from Inactive. `Active · No admitted work`
means the authorization stands but nothing is eligible. `Observation
unavailable` means the policy store could not be read — Arcadia will admit
nothing, and it will not claim a confirmed Off it cannot prove.

Activation delegates mechanics, never judgment. Merging, deploying, publishing,
deleting, spending, credentials, production access, and messaging each still
need their own Decision, and a Plan that is not listed is never activated just
because it is next on screen.

### Sign in claude-code-cli for an unattended worker

An unattended worker has no interactive terminal for `claude auth login`, so
claude-code-cli Sessions need a different sign-in source: a token file the
worker reads at launch and passes into that one Session's environment as
`CLAUDE_CODE_OAUTH_TOKEN`, via a shell that reads the file itself at exec
time. The guarantee is that the value never appears as a literal command-line
argument to any process (so it is never visible in `ps` or a shell history) and
is never injected anywhere but that one claude-code-cli Session — not
`codex-cli`, not `opencode-cli`.

One-time setup, run at your own terminal (never paste the token into a chat
with an agent, and never type it as a literal command-line argument, which a
history-enabled shell would save to disk). `setup-token` only prints the
token; it does not save it anywhere, so pipe its output straight into the
paired operator script, which writes it to the workspace's documented path
with owner-only permissions without the token ever appearing on a command
line:

```sh
claude setup-token | artifacts/generated/operator-scripts/verify-claude-code-token.sh run
```

The worker refuses to use this file, with a named remedy, if it is readable by
group or others, is empty, or is a symlink pointing outside the workspace's
`config/` directory — a misconfigured file is reported, never silently
ignored. The sign-in preflight (`pnpm arcadia production status` and every
launch path) treats a valid file as signed in for claude-code-cli without
shelling out to `claude auth status`.

**Rotation**: run `claude setup-token` again and overwrite the same file the
same way; the next Session launch reads the new value. There is nothing to
restart — the file is read fresh at each launch, never cached.

The same script also backs the `/runs` dashboard's **Verify Claude Code
token** button: clicked from the dashboard (no stdin attached) it only
verifies the file and reports the sign-in preflight's verdict, without ever
printing or handling the token value itself — use it any time to confirm the
current state without touching a terminal.

### Preserve on exit, and integrate only under a separate grant

When a managed-production Session reaches a terminal state, the worker now
preserves its candidate automatically, using the same host-side objective
validation the agent-initiated path uses. It refuses to preserve on a failed,
skipped, or absent check, and it never removes the candidate: a refusal leaves
every file exactly where it was.

Preservation alone still stops before any merge. To have the host fast-forward
a finished, validated candidate onto the governed base branch — so the next
dependent Action launches with no operator merge in between — record Decision
0058's bounded integration grant in the same activation. The grant is
deliberately separate from `--transitions`: it names the authorizing Decision
and an expiry, and it is revoked the moment you switch production Off.

```sh
pnpm arcadia production activate \
  --project arcadia --provider claude \
  --intent "Finish the bootstrap Plan without a per-Action relay." \
  --integration-grant-decision 0058 \
  --integration-grant-expires-at 2026-10-01T00:00:00.000Z \
  --request-id bootstrap-grant-1 --granted-by "$USER" --expected-revision 0
```

Integration is a fast-forward of the Session's own agent-owned branch into the
governed base branch, and nothing else. A conflict, a divergent base, a
non-agent-owned branch, an expired or absent grant, or a candidate outside the
grant's Actions stops integration and preserves all work; with no valid grant
the worker reports the exact `git merge --ff-only` command to run instead.
Deploying, publishing, spending, credentials, messaging, and deletion remain
separate gates.

Even under a valid grant, the worker integrates only a candidate whose current
independent code review and QA verdicts both bind its exact head, its governed
acceptance criteria and its preserved validation evidence. The exit tick
preserves and accepts the candidate, then reports `Integration waits on current
independent verdicts`; a later tick integrates once both verdicts exist. A new
commit on the candidate, an amended criterion or new validation evidence makes
earlier verdicts stale, and the developer's own Session can never supply them.
Two host commands record those verdicts for a managed candidate's PR, each
running a separate read-only reviewer in the evidence-only sandbox:

```sh
pnpm arcadia qa code-review <pull-request-url>   # exact-head code review
pnpm arcadia qa pr <pull-request-url>            # independent QA
```

Each refuses before any reviewer runs unless the PR is ready (not a draft,
checks green), its head is the candidate's ready head, and managed production
is On. The verdict comes only from that reviewer; no flag supplies one. Once
both pass on the same head, the next worker tick integrates the candidate with
no operator merge. A failed verdict never integrates. While a candidate waits,
`arcadia production status` lists an `awaiting_independent_verdicts` (or
`verdict_readiness_failed`) escalation. Its remedy names the command for each
missing verdict and, as the manual fallback, the exact `git merge --ff-only
<head>` command. It clears once the tick integrates.

#### Independent verdicts, run by the tick

When the candidate was preserved behind a host-created draft PR and the active
grant includes both `--remote-preservation` and a current Decision 0058
integration grant naming the Action, no operator step is needed: the worker
tick drives the review itself, at most one side effect per tick, re-deriving
where it stands from GitHub and its receipts each time (so a restarted worker
resumes mid-step, and nothing is done twice). Every step below, including the
push, needs **both** grants (`policyAuthorizesPullRequestReadiness`); with only
`--remote-preservation` the tick touches nothing on GitHub.

1. If a settlement commit landed after preservation, so the PR still shows the
   preserved commit, it pushes exactly the settled head commit to the agent
   branch (a fast-forward, only while the local branch still points at it). A
   PR head that is neither the settled head nor an ancestor of it is a moved
   head: it is never readied or reviewed (`review_head_moved`).
2. It runs `gh pr ready` on the draft, once. A PR a person returns to draft
   afterwards is not readied again (`review_paused_as_draft`); mark it ready
   yourself when it may be reviewed.
3. It polls the PR's checks at most once a minute. Pending checks wait; a failed
   check escalates `required_checks_failed` and no reviewer runs; checks still
   not green an hour after the PR is ready escalate `required_checks_timeout`.
   Polling continues either way, so a GitHub re-run that turns green resumes.
   A `DIRTY` (conflicted) PR escalates at once; a `BLOCKED` merge state is
   treated as waiting while checks run and escalates only once they are green.
   Each check is read by its real shape (a GitHub Actions CheckRun or a commit
   StatusContext); an unrecognised entry blocks by name instead of waiting.
   Only `ADVISORY_CHECK_CONTEXTS` (just `CodeRabbit`, advisory under Decision
   0080) never gates, whatever its state; `arcadia qa pr` applies the same rule.
4. It runs `arcadia qa code-review`, then on a later tick `arcadia qa pr`,
   against that PR, each reviewer bounded to 15 minutes (under the worker's
   30-minute tick ceiling, which the tick re-stamps right before the reviewer
   starts), then fast-forwards the base locally once both pass.

Every step re-reads the policy first, at the current time, and is withheld on
Off, a changed epoch or a lapsed grant; after a reviewer returns, the policy
and the grant's expiry are checked again before the fast-forward, so a
reviewer that finishes after Off or after the grant expired records its
verdict but nothing lands until a later authorized tick. GitHub CLI, push and
reviewer capacity/sandbox/timeout failures retry on later ticks; three
*consecutive* failures on one exact head (any success resets the count, kept in
the workspace database so it survives a worker restart) escalate
`review_budget_exhausted`, and `arcadia production reset-repair-budget
<project/action>` restarts the budget (and the checks deadline) once the cause
is fixed; failures that alternate between steps and so never form a streak are
also capped at nine in all per head. A GitHub rate limit backs off 15 minutes
without spending the budget, and six hours of unbroken rate limiting escalates
`review_rate_limited` (the tick keeps backing off and resumes on its own). A
non-pass verdict is re-run automatically only when its own lineage receipt
records that the reviewer itself was unavailable, which is decided from
deterministic evidence alone (sandbox preflight, the reviewer process's exit or
timeout, a missing or invalid structured verdict, evidence that moved during
the run), never from anything the reviewer model wrote. A reviewer's real non-pass
verdict is never retried automatically and never integrates
(`independent_verdict_failed`): fix the candidate, or after judging the verdict
wrong, rerun that command with `--rerun`. Without both grants the tick does
not touch GitHub, the PR stays a draft, and the escalation's remedy names the
two commands above and why the tick is not running them.

Authority note: whether Decision 0058's integration grant should cover the
push, `gh pr ready` and the reviewer-model spend is an operator question this
change does not settle; until it is answered, activate both grants only if you
accept that reading.

Out of scope: the tick never merges the PR on GitHub and never pushes the base
branch. Integration is the local fast-forward; publishing the base stays an
operator step.

Re-running either command: a plain run on unchanged evidence reuses its earlier
result. `--rerun` is the authorized retry after a failed verdict on the same
head, criteria and evidence; it is refused when a verdict on that exact binding
already passed. A new commit, criterion or evidence is a new binding and needs
no `--rerun`.

Independence is checked against what the host can see: the reviewer's identity
must not be any of the developer's attempt, Session or admission ids, its
working directory must not be inside a developer worktree (compared after
resolving symlinks), and the code-review or QA reviewer's agent binding must
differ from the developer Session's. The host cannot observe process ancestry portably, so the
same provider or model under a different binding is permitted.

Attempt limits: each Action input allows three development attempts, three
planner attempts and five attempts per verdict role. A planner error or a run
that prepared nothing stays live and is resumed without using up an attempt.
When `production status` shows `attempt_limit_exhausted`,
`attempt_retry_not_authorized` or `planner_attempts_exhausted`, repair the
cause; no command resets attempt lineage today, so the only path is a governed
amendment of the Action through an Agent Ask, which gives it a new input
revision. `arcadia production reset-repair-budget` resets the separate launch
repair budget, not attempts.

Upgrade gap: a Session launched before attempt lineage existed has no
development attempt, so the worker never integrates it; it reports
`verdict_readiness_failed` with the merge command, and an operator lands it
after an independent review.

### Provider capacity gates every admission, unless you turn the gate off

Being Active is not enough on its own. Before any Action is admitted, Arcadia
has to be able to *prove* the provider has included allowance left. Read what
each configured provider currently reports:

```sh
pnpm arcadia production capacity
```

Add `--refresh` to re-observe first. Refreshing reads the local Codex app
server and Claude's own usage service under a deadline and a bounded backoff;
it never invokes a model, because paying a frontier model to check a quota is
exactly backwards.

Each provider gets one receipt showing the windows that provider actually
reports (no invented daily or weekly number), how old the observation is, the
account scope, whether the usage is **included**, **paid** or **unknown**,
purchased credits and banked resets kept separate from plan allowance, and the
fields this host simply cannot report. Every receipt is stamped `REAL` or
`SIMULATED`, so a fixture can never be mistaken for evidence about your account.

**Unknown capacity is inadmissible by default.** Unattended admission refuses —
with the reason printed — when capacity is unknown, when the observation is
stale, when included-versus-paid mode cannot be established, when a window is
spent, or when it is inside the reserve margin that keeps an already-admitted Run
able to finish. An elapsed reset time is not renewed allowance: work is
readmitted only after a fresh observation shows the new window. Arcadia never
redeems a banked reset, buys credits, or enables paid fallback to keep busy — if
a banked reset exists, it says so and leaves it alone.

**Or you can state that capacity is not a gate at all.** The evidence is
unreliable by construction: an automatic observation describes one moment, and an
attestation is only your own reading of a dashboard, so neither deserves to *stop*
work. In `<workspace>/config/arcadia.json`:

```json
{
  "codingAgent": {
    "capacityGateEnabled": false
  }
}
```

That exempts **every configured provider**. Admission stops waiting on a receipt,
and a provider with no allowance left is discovered when the work runs rather than
before it is admitted. Add a `provider` name to exempt exactly that one and leave
every other provider fully gated:

```json
{
  "codingAgent": { "provider": "opencode-cli", "capacityGateEnabled": false }
}
```

Either way this is a standing operator choice and never proof of a real limit; it
lasts until the config changes, and it does not relax anything else — no banked
reset is redeemed, no credit is bought, and no paid fallback is enabled.

When one provider is limited and another configured provider is eligible,
selection moves to it under the same capability floors — never to something
weaker, and never by replaying work the first provider already applied.

If a provider cannot be observed automatically on your host, you can record a
bounded attestation. It admits work and it expires; it is labeled attended
everywhere it appears and is never proof of unattended operation:

```sh
pnpm arcadia production capacity attest \
  --provider codex-cli --granted-by "$USER" \
  --window "7d:21:2026-09-12T04:27:37Z" --hours 2 \
  --note "Read from the Codex status line."
```

### Soak the hermetic rehearsal harness

`tests/rehearsal-two-action.test.ts` replays the two-Action rehearsal with no
live grant. To loop it until it is boringly green:

```sh
mise exec -- node --import tsx scripts/soak-rehearsal.ts run
```

Each iteration is a fresh `vitest run`, and the harness builds a throwaway
fixture every time. The loop stops, printing and recording the reason in
`artifacts/generated/soak/rehearsal-soak.json`, on the first of: `--clean-target`
consecutive clean iterations (default 5), `--max-iterations` (default 20),
`--token-budget` (counting `--spent-tokens` you report), a blocking failure that
needs a fix, or the same failure recurring after three fix attempts. Fix the
defect and rerun the same command; the state file carries the count. Every
failing iteration files (or comments on) one `bug` Issue per distinct failure
signature, so an iteration with several failures can touch several Issues, and a
recurring failure updates its existing Issue instead of duplicating it. `--non-blocking <test-name-fragment>` keeps a failure as an Issue
without failing the iteration; `--reset` starts a fresh state.

To refuse a contaminated live fixture, add `--fixture-workspace <dir>
--fixture-repo <path> --action-key <project/action> --request-id <id>`: the loop
exits 2 without running if it finds leftover repair budget, an unsuperseded
handoff, a live claim, or a request_id that already has a receipt.

Before merging any fix the loop produced, run
`mise exec -- node --import tsx scripts/soak-rehearsal.ts guard-merge`. It exits
2 if the branch touches the concurrency gate, admission policy or approval
boundary files; such a pull request stays open for the operator.

## Protect active coding work

The Morning Packet puts **Coding work safety** first whenever an active
Project has uncommitted files, local-only commits, a pushed branch without a
pull request, a detached working copy, or invalid repository configuration.
Inspect the complete read-only snapshot with:

```sh
pnpm arcadia work monitor
pnpm arcadia work monitor --json
```

Preservation and delivery are separate. `UNSAVED` and `LOCAL ONLY` mean work
can still be lost; `PUSHED` means it is backed up, with the report separately
stating whether an open PR was found. Use one branch and worktree per coding session, and leave
every session merged or represented by at least a draft PR. The full recovery
procedure is in `docs/working-copy-safety.md`.

The Morning Packet also carries an **Operator to-do** section: the same
counts `pnpm arcadia todo` prints, then each blocking item (at most five) with
the command that answers it, escalation items first and marked `STOPPED:` so the
packet states what halted production overnight (`arcadia todo` raises an
`escalation:*` item for each stalled production Action), `N more: arcadia todo` for
the rest, and a count line `N Ask questions need one answer: arcadia todo` when your Asks
have raised any. It is built read-only in-process when the packet composes, so it
rides the existing scheduled delivery with no new message or schedule. If the
to-do data cannot be built the section is the line
`to-do unavailable: <reason>` (followed by a line saying Ask questions and Ask-origin
tasks are unavailable) and the packet still composes.

Each newly composed Morning Packet also includes a clearly labelled, bounded
local-AI perspective: one headline and one paragraph explaining what the
recorded work means. If the local model is unavailable, the deterministic
packet still composes and delivers. When workspace memory is enabled, the
same packet is projected into `Arcadia/Records/Orientation/` in Obsidian.
Backfill or verify any durable packet explicitly with:

```sh
pnpm arcadia orientation packet export <packet-id> --workspace "$WORKSPACE"
```

When a coding-agent task is complete and the repository already records its
single next Action, use `arcadia go` to reconcile the finished task before
starting another session. Preview first; the second command performs the
bounded host-controller reconciliation, then retires only a clean, merged
agent worktree and branch:

```sh
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree
pnpm arcadia go --repo /path/to/project --source /path/to/finished-worktree --agent codex --apply
# or: --agent claude, or --agent opencode
```

The command refuses dirty, detached, source-divergent, non-agent-owned, or
non-dispatchable state. When the active Plan is absent, complete, or points at
a finished Action, `go` no longer stops there: it activates the approved Plan
whose earliest eligible Action is highest in the explicit Action queue, makes
that Action current, and continues in the same invocation — seeding a
one-time, reversible FIFO order first when approved legacy Actions have never
been ordered. A genuine queue tie, an inactive Project, or a document defect
still refuses. See Decision 0048. If the checked-out base itself is ahead and behind its
remote, the host controller admits only recognized Arcadia-generated
governance commits, one complete merge base, and a conflict-free result. It
fetches that one upstream into an isolated controller ref, writes one
unreferenced auditable two-parent candidate, verifies its merged governance tree
is dispatchable in a temporary checkout, and rechecks the exact refs before a
hook-suppressed fast-forward.
Unrecognized, rewritten, conflicting, missing-observation, or prepublication
racing history refuses without moving the base and never asks anyone to
improvise a rebase or merge. It never force-merges, resets, or pushes. With `--agent`, it
prepares a uniquely named isolated worktree from the verified updated local
base and prints the exact Codex, Claude Code, or opencode launch command with
`arcadia advance`. Before any Git change, `--agent --apply` refuses unless the
workspace database is writable by the invoking profile and both the
preservation and Go routes carry a fresh worker heartbeat; the refusal names
the missing piece and its remedy, and no worktree is prepared. The personal
`arcadia-go` skill performs the preview/apply
sequence and uses the current agent's native session handoff when available.

A second concurrent session gets a *different* Action, never the same one. Each
prepared worktree claims the Action it was given, so when `current_action` is
already claimed by a live worktree, `--agent --apply` walks the ordered Agent
Queue and claims the next dependency-ready, still-unclaimed entry instead of
refusing. The handoff says so explicitly, and `current_action` is not moved — it
stays a single value naming the first session's Action. When every ready Action
is already claimed, the refusal is the same one as before, naming the worktree
that holds the pointer's Action. Only a claimed Action is walked past: a live
Session, an unreconciled exit, or an unpreserved candidate still refuses,
because those are about the repository rather than about which Action is free.

One unpreserved candidate is handed out instead, exactly once: a worktree `go`
prepared for this Action that was never launched (no Session row, no session
request file, its HEAD still the current local base tip, the live claim its
own) and whose only uncommitted files are Agent Ask drafts in `.arcadia/asks/`.
Because a manual handoff leaves no record of whether its terminal is still
open, `go` also checks the host process table and refuses while any process
has its current directory inside that worktree, or when it cannot tell. `go`
records each draft's sha256 and origin in a receipt (hashes only; the drafts
stay on disk in that worktree) and hands back the *same* worktree and branch;
it never settles, copies, moves, or deletes a draft, including one naming
another Project. The managed tick follows the same rule, and a candidate
either path has handed out is never handed out again by either, unless that
launch failed before any Session existed. Every later attempt, a moved base, a
live process, or a draft changed since its receipt refuses with one
`disposition`: the receipt id, who it was handed out to and when, each draft's
path and sha256, and the single safe next step, which retires the worktree only
after every draft is settled or copied out. Any other dirt still gets the
original refusal, now with `candidateKind`.

For unattended `arcadia-go` skill runs, do not allowlist the general Arcadia
launcher or an `arcadia go` prefix. Install the protected broker from a clean,
reviewed Arcadia commit as an explicit operator action:

```sh
pnpm arcadia go-broker install
```

While managed production is Active (a live rehearsal's freeze window),
`go-broker install` and `go-broker ensure` refuse with
`production_active_freeze`, and they refuse when production status cannot be
read. The release-manager or orchestrator session reinstalls once after the
terminal Off receipt; `ARCADIA_FREEZE_OVERRIDE=<reason>` inline bypasses the
refusal and records the reason. See
`docs/agent-guidance/rehearsal-freeze-window.md`.

The installer copies that exact commit and its resolved local dependency tree,
required `database/schema.sql` baseline into the compiled runtime under a
revision-addressed directory at `~/.local/share/arcadia/go-broker/`, then
atomically points provider-specific
launchers under `~/.local/bin/` at it. Broker status and reinstall validation
refuse any release missing that schema instead of allowing a failure later from
another Project's repository. In the same idempotent operation it installs the
shared skill, writes the narrow Codex rule, migrates the default Codex config
from legacy sandbox settings to the supported named `arcadia-unattended`
permission profile. It grants only the three exact provider worktree roots,
denies `.env` files and command network access, and keeps interactive approval
on-request. The combined `arcadia-brief-broker-<provider>` launcher resolves
dispatch through read-only SQLite connections. It retains operator gates and
the full Constitution brief without schema initialization or dispatch-journal
writes; the host's ordinary `next` command retains its existing journal.
Workspace database and shared Git metadata writes stay on their host paths.
An older installed brief that fails at stage `next` with
`SQLITE_WORKSPACE_WRITE_DENIED` needs the reviewed broker update and reinstall,
not repeated profile selection or a broader database write grant.
The brief launcher answers within 25 seconds with one JSON document on stdout;
a stalled stage returns `BRIEF_DEADLINE_EXCEEDED` naming `stage`,
`correlationId` and a retry-safe `recovery` after stopping its process group.
This takes effect after the reviewed broker reinstall.
Governed CLI launches explicitly select that profile with approvals
disabled. For a Desktop or iPhone-connected task, choose
**arcadia-unattended** in the permissions control beneath the composer and wait
for the environment to refresh before starting `arcadia advance`. Arcadia does
not silently launch a native task under the interactive profile: if the named
profile is missing, run `pnpm arcadia go-broker install`, fully restart Codex
Desktop, and select it. The installer then
updates Claude's exact permission and worktree directories, removes
recognized legacy broad allowances, and enforces the normal sandbox and bypass
guards. Existing unrelated settings are preserved and changed user-owned files
receive timestamped backups. It also records Codex workspace trust
(`[projects."<repo root>"] trust_level = "trusted"`) for each configured
Arcadia Project repository that exists here, so a prepared worktree of a
repository Codex has never opened starts without a trust prompt. It never
trusts the home directory, a shared worktree root, or a parent directory of
another Project; `status` lists any such configured path as `never trusted`.
Verify installation with:

Installing Go adds this named profile without changing Codex's global default.
Ordinary interactive tasks use your existing default; only Go CLI handoffs
select `arcadia-unattended` explicitly. For Desktop Go tasks, select it as above.

```sh
pnpm arcadia go-broker status
```

Installation readiness is separate from runtime readiness: `status` succeeds for
a correct install even before the worker starts. Its named
`preservationTransport` field reports whether the host worker has a fresh
heartbeat for preservation requests. `agentGoTransport` separately reports
whether the go route is serviceable: `READY` when the worker has serviced it
recently, `BUSY` when a go-capable worker is alive but has not run the route
within the window (retry in a few seconds; do not restart it), and `NOT READY`
when no go-capable worker is there (start the updated worker). A fresh heartbeat
alone is never sufficient. `Brief supervisor` reports whether every installed
brief launcher actually ran its internal self-test and answered; `NOT READY`
there makes status `NOT READY` and needs the reviewed broker reinstall. A
release installed before that reinstall ignores the internal self-test marker,
so its status run performs one real read-only brief against the inherited or
default workspace and reports `NOT READY`. The internal
`ARCADIA_BRIEF_CHILD`/`ARCADIA_GO_BROKER_SELFTEST` markers grant no authority. `Workspace trust` reports how many Project
repositories carry Codex trust; a missing one makes status `NOT READY` and is
named in the issues as `codexWorkspaceTrust missing: <repository>`. Rerun
`pnpm arcadia go-broker install` to add it. Install also records Claude Code's
own trust answer for the shared `~/.claude/worktrees` root in `~/.claude.json`
(backing the file up first), so a fresh Claude candidate worktree never stops at
the interactive "trust this folder" dialog; status names a missing one as
`claudeWorkspaceTrust`. A Claude Session the worker launches under a
standing-policy admission runs `claude --print --permission-mode acceptEdits`:
non-interactive, exits after its turn, and never bypasses approvals.

No registry request is part of installation: if local dependencies are absent,
it fails with the `pnpm bridge:worktree` recovery command. Before it reports success, installation also creates and retires one
disposable candidate beneath `~/.codex/worktrees`. The local probe verifies
candidate and source writes, dependency bridging, a temporary SQLite database,
candidate TypeScript and Dashboard builds, Vitest, and syntax-checking the
revision-pinned compiled broker. A refusal identifies the denied operation and
one recovery command; it never asks an agent to loosen sandboxing or enable
network access.

`status` reports a named native Codex permission-profile issue when the shared
configuration is missing a required worktree root, retains a legacy sandbox, or
does not deny command network access.

The installed Codex, Claude, and opencode `go` launchers always submit a bounded request
to the **existing host worker**, including when invoked from a host terminal.
They never reconcile Git in the calling process. The host runs reconciliation
in a child process so heartbeats and Run admission continue during a slow fetch.
The agent-callable `preserve` launcher uses the same request path and never submits validation
assertions. Before a session needs `go` or preservation from a coding-agent
prompt, run the updated worker on the host:

```sh
arcadia worker start --workspace /absolute/path/to/workspace
arcadia go-broker status
```

Go has a five-minute child execution budget and a 30-second response margin.
Timeouts and refusals remove the caller's pending request and report where to
inspect the result before retrying. A `BUSY` worker still accepts a request,
which it services at its next tick within that budget. If an interrupted run
ever leaves the reserved untracked `.arcadia-go-request` behind, delete that
single file and retry — it does not count as candidate work. A tracked file with
that name is always refused.

`status` refuses an incomplete installation, including a missing
`preservationLauncher`. An absent heartbeat reports
`preservationTransport.ready: false` without failing the install check. Actual
agent `go` and preservation requests refuse until the transport is available.
The worker needs current scoped
validation authority. Missing authority or absent checks is a refusal, not an
invitation to enable broader permissions.

From the Project repository or registered candidate worktree, the agent uses
fixed launchers:

```sh
~/.local/bin/arcadia-go-broker-codex
~/.local/bin/arcadia-enroll-broker-codex
~/.local/bin/arcadia-advance-broker-codex
~/.local/bin/arcadia-work-monitor-broker-codex
~/.local/bin/arcadia-preserve-broker-codex
# Claude and opencode use the corresponding -claude and -opencode executables.
```

An unleased helper does not become an owner by running a prompt or by knowing a
worktree path. It asks the host to enroll the work through the fixed request
transport: run the provider's `arcadia-enroll-broker-*` launcher with no
arguments from the Project repository root (a prepared or leased worktree
already has its principal and is refused with `enrollment_source_not_repository`).
`ARCADIA_ENROLLMENT_MODE` chooses `prepare` (the default: a strict `arcadia go`
candidate for the exact current Action) or `managed-launch` (the ordinary
guarded Session launch under the standing production policy). The host
re-resolves the configured workspace and exact checked-in Project, Plan and
Action, the canonical brief, operator gates, packet and its
provider/model/effort, the policy epoch, capacity and any existing claim. The
request carries no command, executable, path or authority.

The durable request id is separate from the one-shot transport nonce and is
bound to the caller, mode, Action and input revision. Managed dispatch supplies
`ARCADIA_ENROLLMENT_REQUEST_ID` and `ARCADIA_ENROLLMENT_CALLER_ID`; otherwise
the runtime's own host-observable session id is used. With neither, enrollment
refuses before writing a request with `enrollment_identity_unavailable`.

Success is the printed receipt, and running the same launcher again proves it:
an exact replay returns the identical receipt (same `enrollmentId`) without a
second worktree, admission or Session. A preparation receipt names
`principal.kind: prepared`, the only candidate the helper may enter
(`principal.worktree`) and its fenced `claim` with `generation`; a managed
receipt names `principal.kind: managed-session` and the `admission` with
`status: committed`. A changed caller, mode, Action or input revision under the
same id refuses with `enrollment_request_changed` before any mutation; a live
request answers `enrollment_in_progress`. Enrollment only ever hands out a
candidate or Session this request created: a claim or lease held by anyone
else (another helper, the production tick, an operator) refuses with
`action_claimed` and is never re-issued to another caller. A request whose
writer died is reconciled only onto positive evidence of its own effect (the
claim `go` recorded on the request inside the claim's own transaction, or the
Session bound to the request's own admission), otherwise retried once its lease
expires; a recovered own effect is handed back on governance identity alone,
even if production has since gone Off. Another caller's pending row blocks the
Action only while its lease is live: once expired with no recoverable effect it
is kept as a `failed` record and the Action is freed. A request that failed with
no own effect is kept as a `failed` record,
so a changed replay still refuses and the exact replay may retry. Off
(`production_off`), a changed epoch (`stale_epoch`), missing capacity
(`capacity_unavailable`) and an unapproved packet (`packet_approval_required`)
refuse a managed launch with no admission, claim or candidate left behind. A
managed launch whose spawn failed settles its admission; enroll again under a
new request id.
Enrollment grants nothing: it adds no ownership beyond the claim `go` or the
guarded launcher already creates, and no completion or production authority.

Native-process adoption is not a shortcut. It refuses with
`native_runtime_not_supervisable` unless a host-registered adapter observes a
stable runtime identity, liveness, terminal outcome and recovery (none is
registered today). The refusal's `supportedRoute` names the managed-launch
route. The fixed-role attempt store gives planner, critique, developer,
exact-head review and independent QA each a distinct bounded attempt ordinal
and request id; only one development attempt per requirement may own
mutations, and any developer of that requirement cannot supply its review or QA
verdict. A changed head, criteria fingerprint or evidence fingerprint
invalidates the dependent verdict. Wiring that store into the existing planner,
review and QA executors is not done yet.

A normal manual `go` handoff has `session: null`. It does not need a managed
planning packet or production activation. The host records a binding from its
active worktree reservation to the current Action, base revision, branch and
Project validation commands. `go` and `advance` report preservation readiness
and name missing configuration. The worker includes these handoffs in its
protected request routes, and the same preservation launcher validates and
commits them locally. Retrying preserves the same candidate commit. A legacy
reservation can acquire its missing binding while its branch HEAD still matches
the base. Changed authority, expired reservations and changed history refuse.
Manual preservation never pushes, opens a PR, completes an Action, or grants
managed-production authority. Those gates remain separate.

A preservation refusal leaves the candidate's index and `git status` unchanged.
If Git is slow, the launcher reports `PRESERVATION_GIT_TIMEOUT`, which names the
Git subcommand, stage, timeout and remedy. Rerun the same launcher unchanged: the
retry reuses the request id, never creates a second commit, and does not count
toward the identical-refusal limit. Ten identical timeouts in a row stop
automatic retries until an operator resolves the cause; a timed-out pull-request
create or edit asks you to check for an existing pull request first. A blocked
candidate `index.lock` reports its own code, `PRESERVATION_INDEX_LOCKED`, never a
timeout: `reason: index_locked` (retryable; the lock is fresh, held open, changed
while it was checked, or a Git process still runs there) means let that process
finish and rerun; an `lsof` warning that kept the answer unknown appears as
`holderProbeWarning`. The held-open check sees only Git's brief lock write and
non-Git holders; a `git commit` waiting on an editor is protected only by the
running-Git-process check, never by the lock's age. `reason:
index_lock_malformed` (not retryable; a directory or symlink) means inspect and
remove it yourself, then rerun. Lock refusals never use up the timeout limit. See [Working-Copy Safety](docs/working-copy-safety.md#preserving-a-candidate-through-the-host-controller).
Installed launchers gain this behavior only after the reviewed **Reinstall the
protected go broker** `/runs` action, and the managed tick only after the host-services
recovery restarts the worker.

For managed Sessions, preservation checks come from host-managed Project `validation_commands`,
frozen in the approved immutable packet. The host executes those checks against
an immutable Git snapshot using macOS Seatbelt, retains the actual results, and
commits that exact tested tree. Candidate changes or changed authority refuse.
The bounded initial path requires `/usr/bin/python3` and `/usr/bin/sandbox-exec`,
regular files totaling at most 64 MiB, and self-contained checks using available
local tools. Source writes, network access, symlinks/submodules and undeclared
checks fail closed. Checks may write temporary output only beneath `$TMPDIR`.

A declared check that needs installed dependencies (`pnpm test`, a binary from
`node_modules/.bin`, a network tool) cannot run in that sandbox. `go`, `advance`
and `go-broker status` refuse it with a named `validation_requires_dependencies`
remedy instead of reporting readiness and then failing, and that remedy names a
self-contained substitute. Arcadia itself declares
`node scripts/preservation-self-check.mjs`, a tracked, dependency-free check of
the immutable tree (required control documents, parseable JSON, no merge-conflict
markers, resolvable relative imports). The full suite and builds remain the
Action-completion and PR-QA gate outside the sandbox; host-side dependency-aware
validation is separate governed work (`preserve-on-exit-and-integrate`).

Passing checks prove those checks passed. Preservation does not accept,
integrate, complete, or advance the Action. Remote preservation (push plus a
draft pull request, never merge) still requires an Active
policy granted with `production activate --remote-preservation`; otherwise the
receipt names the local commit and its exact LOCAL ONLY recovery step. Retries return the preserved commit.

Claimed preservation now runs in a separate host child, so validation and capture
cannot stop the worker's heartbeat. An attempt is bounded to 22 minutes, with
150 seconds per stage and 30 seconds per Git/capture subprocess. Checks retain
their existing two-minute limit. A refusal names its stage, the protected
attempt journal, and any validation receipt. Retain that evidence and retry
through the fixed preservation launcher; never clear a live claim or replace
protected validation with a manual Git commit. A timeout after commit is
recoverable through the existing commit trailer and receipt replay.

The installed `arcadia-unattended` profile currently lacks a demonstrated
loopback/headless browser audit capability. Codex preparation refuses declared
Lighthouse results, rendered audits, headless browser audits, or the explicit
`capability/local-browser-audit` reference before launching them. The host-only
fixture probe `node scripts/probe-local-browser-audit.mjs` measures the actual
named profile without configuration overrides or credentials, retains its
receipt under `artifacts/tmp/local-browser-audit/`, and exits nonzero when any
required capability or denial is unproven. An offline render is not an HTTP
audit. A bounded audit route needs the proposed operator Decision; reinstalling
the unchanged profile is not a fix.

Inactive host preparation now has a fixed synthetic proof command:
`node --import tsx scripts/prove-host-browser-audit.ts` from an ordinary macOS
host terminal. It reuses the host preview, renders mobile and desktop HTTP
fixtures under a dedicated deny-default Seatbelt boundary, verifies network
and synthetic credential denials, and deliberately stalls after Chrome starts
to prove bounded process-group cleanup. Receipts, the exact profile, and
screenshots are retained. This command accepts no arguments and does not audit
a Project, install a profile, activate dispatch, or produce a Lighthouse matrix.
Review `docs/reports/restricted-host-browser-audit-2026-10-01.md` before a
separate source/revision-scoped activation proposal.

From the host, the matching `go` executable performs canonical preview/apply
under its separate authority. Every agent launcher rejects public arguments,
including workspace, repository, command and evidence overrides. The managed
skill requests preservation and keeps mutable `go`, `advance` and Git operations
outside the coding-agent sandbox. The runnable disposable proof and exact QA
steps are in `docs/reports/protected-preservation-qa.md`.

Reinstall after a reviewed Arcadia update to move the broker and managed skill
to the new commit. A healthy repeat install changes nothing.

To opt into Arcadia launching the next Claude Code process, add `--launch`.
This is the only `go` option that authorizes process creation; preview and the
manual command above remain non-launching:

```sh
pnpm arcadia go \
  --repo /path/to/project \
  --source /path/to/finished-worktree \
  --agent claude \
  --apply \
  --launch \
  --workspace "$WORKSPACE"
```

Launch requires the current governed Action's approved, immutable promoted
build packet; matching provider profile, binding, model, and Git base revision;
a clean agent-owned source and isolated target worktree; available `tmux`; and
no prepared or running Session lease for the same repository. Arcadia creates
the worktree itself and wraps Claude Code in tmux—it does not use Claude Code's
worktree-owning tmux mode. A separately admitted repository may hold its own
Session.

**Launches are headless and recorded.** `go --launch`, `arcadia session launch`
and the dashboard's session launch run the provider non-interactively, exactly
as a standing-policy launch does: `claude --print --output-format stream-json
--verbose --permission-mode acceptEdits --settings <per-Session file>
--setting-sources ""`,
`codex exec --json --sandbox workspace-write`, and `opencode run` (which takes
its permissions from your own opencode configuration; Arcadia manages none).
The Claude allow list is Arcadia's own, written per Session (mode 0600) next to
its log: your Project's declared validation commands, exactly as declared, and
`arcadia agent-ask draft`, nothing else. `--setting-sources ""` stops Claude
merging your `~/.claude/settings.json` (and the worktree's own, agent-editable
`.claude/settings.json`) into it, so a headless Claude Session loads no user or
project settings or hooks. Two limits: `acceptEdits` also auto-approves
mkdir/rm/mv/cp/sed in the working directory, and the allow list is not a security
boundary, because validation commands run project code the agent can edit.
Combined output is appended to `<workspace>/.arcadia/sessions/<session-id>.log`,
and the provider's exit code is written to `agent_sessions.exit_status` (visible
as `exit N` in the Session timeline), so a crash is distinguishable from a clean
exit after tmux is gone. The tmux pane streams the same output; the printed
reattach command attaches to it (you can watch, but there is no TUI to type
into). A launch refuses before it reserves anything, naming the reason, when the
provider binary is not on PATH (`provider_binary_missing`), the provider is not
signed in (`provider_not_signed_in`: Claude Code token file or login, `codex
login`), or the installed provider lacks the headless flags
(`permission_posture_missing`). To work in the provider's TUI instead, add
`--interactive` to `go --launch`; that Session is not logged and records no
exit code.

**A confirmed Launch finishes its Session's work without production being
Active (Decision 0096).** Confirming a Launch also authorizes Arcadia, once and
for that one Action, to validate, commit and push the Session's branch when it
exits and, only if the work is reconciled `accepted_completion`, open a DRAFT
pull request. It never merges, readies a PR, integrates or turns production on;
review, repair and merge are a separate step. Only a confirmed Launch carries
this: the dashboard's Launch confirmation, which is a browser-UI action (the
console's Launch Session dialog lists the consequence above its button; the
route refuses the confirmation from anything that is not a browser), or
`arcadia session launch --operator-launch --preview-fingerprint <hash>` typed
`y` at an interactive terminal. A launch without it, from inside an
Arcadia Session (`ARCADIA_SESSION_ID` is set in every Session) or from a
non-interactive shell, carries none and behaves as before (the exit is reconciled
`incomplete_resumable`, nothing is committed or pushed). The authorization is a
row in the workspace database bound to that Session and Action, expires after 24
hours and is used up at the first exit; its mint and use are events
(`operator_launch.authorization_minted` / `_used`, with the commit, PR and
outcome in the use receipt). The exit is handled by the worker's existing tick:
validate, commit and push (state `PUSHED`), reconcile, then on
`accepted_completion` the draft PR through the same preservation path production
uses. A draft PR that fails (GitHub down) is retried on later ticks, at most
three attempts. An incomplete exit keeps its work committed and pushed with no
PR. If the worker is down, a Session that has exited and stays unreconciled for
five minutes is flagged on the dashboard's Session card with the command to run
by hand: `arcadia session reconcile <session-id> --repo <repo>`. That command
only records the exit; it does not commit, push or open a PR (the worker's tick
does), so an authorization whose Session was reconciled that way is closed
unused-and-not-applicable on the next tick and the work stays in its worktree.
Merging is never part of this: even if production is Active with an integration
grant, a candidate preserved under this authorization is not integrated unless
production itself delegates validation for that Action.

**A Session cannot hold the repository lease forever.** The worker tick ends a
live Session's tmux session (only `tmux kill-session`; its worktree and branch
stay) when (1) its wall-clock limit passes — `arcadia session launch
--time-limit-minutes N` for one launch, else the active production scope's
`sessionTimeLimitMs`, else 120 minutes (the default also applies when no policy
is readable or production is Inactive) — or (2) its pane shows a permission
prompt, auth failure or provider limit in its last few pane lines that did not
change for the 20-minute stall deadline (a headless Session's pane is tool
output, so a permission-prompt match is ignored for it). A stop counts only when
tmux confirms the Session is gone; a kill that did not take is logged and retried
next tick. The tick then preserves and reconciles it on the following tick like
any other exit: the Session exit receipt's reason starts `Stopped by Arcadia:`
with the cause, and the lease is released. A Session that is still producing output or Run activity is never
stopped before its limit; a silent Session with no blocking message is only
flagged stalled until the limit. Look at the exit receipt for what to do next
(`arcadia session reconcile <id>` shows it).

**Rollout:** on the first deploy of this build, any live Session older than the
120-minute default (and with no longer override) is stopped on the first tick.

Every provider is launched with an actionable **Action brief** as its prompt,
not session metadata: the Action title and `next_action`, every acceptance
criterion verbatim and in the plan's own order, the candidate worktree and
branch, the repository's standing constraints, and the exact completion
protocol — run the repository's declared validation, request protected
preservation through the provider's fixed launcher
(`arcadia-preserve-broker-codex|claude|opencode`), then settle a `complete`
Agent Ask with `candidate_revision` at the worktree HEAD and one `met` evidence
entry per criterion, verbatim and in order. The brief is read from the
authoritative plan document at launch, so a missing plan, a missing Action, or
an Action with no acceptance criteria refuses the launch and fails the Session
before any process starts.

The command prints the Session id and exact reattach command. The same
read-only receipt is available later:

```sh
pnpm arcadia session show --workspace "$WORKSPACE"
pnpm arcadia session show <session-id> --workspace "$WORKSPACE"
tmux attach-session -t <printed-tmux-name>
```

`session show` reports only stored linkage and whether the named tmux process
is alive. It never captures panes, mirrors transcripts, estimates progress, or
injects input. If tmux has exited, launch a new governed Session through
Arcadia so continuation receives a fresh Action brief and launch checks. A successful process
exit does not complete the Action or approve, merge, deploy, publish, message,
spend, or use credentials; repository reconciliation is a separate governed
transition.

Sessions Arcadia launches commit under a **semantic agent Git identity**, so
`git log` names the platform and model tier instead of you. The name is the
platform plus the tier: Codex is `Cody Swift` / `Cody Mason` / `Cody Atlas`,
Claude is `Claudia Swift` / `Claudia Mason` / `Claudia Atlas`, and OpenCode is
`Owen Swift` / `Owen Mason` / `Owen Atlas`, for light / standard / heavy, each
with a matching local address on `agents.arcadia.local`. Arcadia sets only
`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and
`GIT_COMMITTER_EMAIL` on that one execution — it never reads or writes your
global Git configuration — and a model whose tier cannot be resolved refuses
the launch rather than committing under your name. The same environment
propagates to commits Arcadia itself makes from inside the Session.

The same identities cover an interactive agent session too — a terminal, a
Claude Code or Codex desktop session, anything not started through
`arcadia session launch`. Nothing sets its environment automatically, so the
agent resolves its own identity with `arcadia identity resolve --agent
<codex|claude|opencode> --tier <light|standard|heavy>` and prefixes the
printed `GIT_AUTHOR_NAME=… GIT_AUTHOR_EMAIL=… GIT_COMMITTER_NAME=…
GIT_COMMITTER_EMAIL=…` onto each `git commit` itself, rather than committing
as you.

The identity also carries a role: plain `builder` work (the default) needs no
extra flag, but an agent providing adversarial feedback — a code review
finding, or a plan critique/refinement — adds `--role critic`, which prefixes
a `Critic` title onto the name (e.g. `Critic Claudia Mason`) and signs the
posted comment with the resolved `signature` instead of the builder identity.
See AGENTS.md's "Agent Git Identity" section.

Because every agent posts through your one GitHub login, the signature line is
how you tell them apart. Each prompt and brief Arcadia generates (`go`, the
dispatch brief, enrollment, the launched Session brief, work packets and the
PR reviewer) carries one short Identity block naming the agent's own
signature, its teammates on the other platforms, and — when Session and claim
rows can be read — the partners live on the same Project. `arcadia identity
roster` prints the whole roster; the signature rule itself lives once, in
`docs/agent-guidance/git-identity.md`.

The dashboard exposes the same guarded operation for an explicitly approved
operator request. The route is reachable only where the dashboard is reachable;
the launch request itself must be same-origin, and the server resolves the
repository, executable, arguments, pointer, packet, Decisions, provider binding,
and repository lease. It never accepts a browser-supplied command or path:

```text
GET  http://127.0.0.1:3020/api/projects/<project-id>/session-launch?requestId=<request-id>
POST http://127.0.0.1:3020/api/projects/<project-id>/session-launch
```

The tailnet equivalent is
`http://arcadia-1.alpine-rattlesnake.ts.net:3020/api/projects/<project-id>/session-launch`.
The GET returns a no-process preview and fingerprint. POST it with the same
`requestId` and `previewFingerprint` JSON fields. A cross-origin, malformed,
altered, or stale request is refused; retrying the same request returns the
durable Session receipt instead of starting a second process. The dashboard
service is local/tailnet-reachable, not a public or identity-authenticated API.
Operator QA: start the dashboard with `pnpm dashboard`, fetch the preview URL,
then POST its fingerprint from the dashboard origin and confirm one Session;
repeat the POST and confirm the same Session id. End-user procedure: none—the
route is an operator-only control surface, not an end-user feature.

The CLI beneath this route also accepts `arcadia session launch --standing-policy`
in place of `--preview-fingerprint`: it launches under an Active managed-production
policy's current epoch instead of a fresh operator click, admitting and
committing an epoch-bound receipt and rechecking Off immediately before launch
commitment. Nothing in this repository calls that flag autonomously yet—it
exists for the not-yet-built production worker (`feed-and-supervise-managed-production`)
to use once it exists. Operator QA: with production Active
(`arcadia production activate ...`), run
`pnpm arcadia session launch --repo /path/to/project --request-id <id> --standing-policy --workspace "$WORKSPACE"`
and confirm the printed Admission line; deactivate production
(`arcadia production deactivate ...`) and confirm a fresh request is refused.

Bare `arcadia advance` and `arcadia advance --session <id>` resolve the same
deterministic Project transition used by `go` and the Agent Queue. Its result
is exactly one of launch, plan, Decision, repair, reconcile, wait, or Milestone
completion, with one concrete next step.

Run inside a prepared worktree, it resolves **that worktree's own claimed
Action** and prints it as `Claimed action:`, rather than reading
`current_action`. That is what keeps a session dispatched by the queue-walk
above on its own work: the claim decides, never queue order, so an in-progress
worktree is never reassigned however the queue moves. In the main checkout, or
any worktree holding no claim, the governed pointer is still the answer.
`arcadia agent-ask settle` honors the same claim — a completion written from a
worktree must be about the Action that worktree claims, and settling it is what
releases the claim.

To shelve an idea until a concrete condition is true, use the existing Ask
path with `--back-burner`. For example:

```sh
pnpm arcadia ask "Revisit the compact status view" \
  --back-burner \
  --project proj_example \
  --surface-date 2026-10-01 \
  --source-ref docs/ideas/compact-status.md \
  --tag quick-win experiment
```

See conditions that have fired with
`pnpm arcadia back-burner list --fired yes`. This reports shelf
items only: Arcadia never dispatches or promotes them automatically. Use
`pnpm arcadia back-burner promote <id>` when you explicitly decide an item
should become an Action.

To find out what any Ask became, pass the `capture_…` id from its receipt (or
its request id, or an `ask_…` id) to `pnpm arcadia ask-trail <id>`. It prints
the capture, how the Ask was classified and why, the Project it routed to, and
every Action, Decision, or Back Burner item it produced, including the Action a
shelved item was later promoted to. It only reads. Asks recorded before this
command existed are linked when their text and time match exactly one capture.

To see how much of your input actually reaches Arcadia through Ask or Ingress,
run `pnpm arcadia ask show --coverage` (add `--since 14d` or `--json`). It is
read-only and always says **direct chat: not measured**, so read it as coverage of
the surfaces Arcadia can count (Ingress files, review and Decision replies), not
as the share of everything you tell an agent. Discord messages show a captured
count with no denominator, and agent-written Asks are excluded.

For project-specific, vague, household, date-based, dependency-based, and
predicate-based examples, see the [Back Burner Guide](docs/back-burner-guide.md).

## Narrative digests arrive on their own

The daily Morning Packet leads with a deterministic portfolio stand-up. A
Project appears when it has received a Log in the trailing seven days, has
uncommitted repository work now, or has an unmerged branch with a commit in
that period — regardless of its longer-lived Project status. For each recently
active Project the packet reports **Yesterday** from work landed on its locally
known default branch plus the previous local calendar day's Logs, **Today**
from its latest recorded or open Action, and **Blockers** from current blocked
Actions plus blockers recorded yesterday.

The Discord bot composes and posts narrative digests without being asked. Once
past `ARCADIA_DIGEST_TARGET_TIME` (local, default `07:00`, just after the
Morning Packet), each cadence produces one digest per active Project plus one
collective portfolio roll-up:

| Cadence | Window it narrates |
| --- | --- |
| Daily | Yesterday, local midnight to midnight |
| Weekly | The last completed Monday-to-Monday week |
| Monthly | The last completed calendar month |

Every cadence narrates the period that has **finished**, not the one in
progress — that is the only rule under which each recorded fact lands in
exactly one digest of each cadence. A digest fires at most once per subject
per period, and a bot that was down at the target time composes the same
window on its first tick after restart. One Project's narration failing costs
that Project's digest and nothing else.

Run the same thing by hand at any time:

```sh
pnpm arcadia digest run --workspace <path>
```

It composes and exports everything due that has not been composed yet, and
reports what is awaiting delivery. `ARCADIA_DIGEST_CHECK_INTERVAL_SECONDS`
(default `900`) sets how often the bot checks.

## Compose a Project digest for an explicit window

Use the advanced CLI when you want one narrative digest for boundaries the
cadences do not cover. Supply explicit half-open ISO boundaries:

```sh
pnpm arcadia digest compose \
  --project arcadia \
  --period day \
  --from 2026-07-30T00:00:00.000Z \
  --to 2026-07-31T00:00:00.000Z
```

The command gathers only that Project's Logs, dispatch journal entries, and
Decision activity in `from <= activity < to`, asks the unpaid local-preferred
Intelligence route to narrate those facts, and writes one ready
`narrative_digest` Artifact under the Arcadia workspace. Re-running the same
Project/period/boundary tuple updates the same Artifact. It never writes into
the managed Project repository.

When workspace memory is enabled, project that already-composed Artifact into
Obsidian explicitly:

```sh
pnpm arcadia digest export <digest-id> --workspace <path>
```

The vault Record is clearly labelled AI-narrated, is safe to delete and
recreate, and is not rewritten when the source Artifact has not changed.

## Ingress Artifacts

Open **Ingress** from the menu to view files waiting in the local
`~/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress/iCloudIdeas/In`
folder. Select one or more files, describe the Action you want Arcadia to take, and choose **Describe Action**. Arcadia writes
the description and selected files into the normal ingress queue for processing.
From an iPhone or iPad, the shortest path for a band recording is **Voice
Memos → Share → Save to Files**, then choose
`iCloud Drive/ArcadiaIngress` (or its `iCloudIdeas/In` subfolder). Arcadia
observes both locations and matches any `.m4a` placed there, so the recording
name does not need to contain “Thundertonk” or “practice.” If you prefer a
Share Sheet action for arbitrary files, use **Send
Any Document to Arcadia** and import the signed shortcut from
`scripts/apple/Send Any Document to Arcadia (iPhone-iPad).shortcut`.
On the Mac, import `scripts/apple/Send Any Document to Arcadia (Mac).shortcut`
and enable it as a Finder Quick Action or Share Sheet action; it performs the
same direct copy into `iCloudIdeas/In/`.
If an item is present in iCloud but not local, Ingress labels it accurately and
offers **Download from iCloud** before previewing it.

The **Activity** panel on the Ingress page shows the vital few operator facts:
pending files, files currently being processed, active Workflow Runs, recent
completed or failed sidecars, and the watcher health check. It refreshes every
10 seconds while work is active and every 30 seconds while idle.

Every item is eventually moved out of `In`: active work is claimed in
`Processing`, successful idea captures land in `Done/Ideas`, unmatched files
are preserved in `Done/Unclassified`, and failures land in `Failed`. A Markdown
idea is routed through deterministic Ask/Back Burner handling and, when memory
is enabled, also becomes a managed note under `Arcadia/Ideas/` in Obsidian.
Band-practice `.m4a` files run the configured `/opt/homebrew/bin/rehearsal run
<absolute-recording-path>` Workflow and publish the extracted MP3 Artifacts to
the configured Google Drive Desktop folder. Arcadia asks macOS to launch Google
Drive in the background before starting extraction.
The **Capture** Ask surface accepts text, arbitrary files, or both. Every Send
creates one immutable receipt before routing begins: it names the capture id,
source, time, submitted URLs, and attachment count. File receipts preserve the
original filename, byte size, media type, SHA-256, and outside-repository
storage reference; text extraction and unavailable media processors are shown
as derived results and never replace the original. Retrying the same submitted
request id returns the same receipt, while different content under that id is
refused. File submissions then continue through the identical ingress path.

### Project continuation

Open a Project from **Projects** when you need to work from that repository's
managed documents rather than the portfolio-wide Daily Advantage. The Project
view follows the authoritative `PROJECT.md` → active plan → current Action
pointer; supporting records and dormant/proposed plans cannot redirect it. It
shows the docs-authoritative Milestone, current Action, responsibility,
expected Artifact, source plan, resolved execution profile, and the plan's
T-shirt Token Impact plus its plain-language Token Budget. Deterministic builds,
tests, health checks, Playwright navigation, and screenshot capture consume no
LLM tokens unless a model is asked to interpret their output. **Get to work**
prepares a planning Decision for that exact Action; it never runs code or
deploys. If preparation is refused, the same view names each blocking document
field and its concrete remedy. Open questions and project Decisions can be
answered inline, with the same answer/approval distinction used by Needs you.

The terminal brief resolves the same pointer:

```sh
pnpm arcadia next --project arcadia
```

`next` reaches the repository through the workspace database, so it needs a
workspace on this machine. When you are standing in a project repository — or
in a cloud container, a fresh clone, or CI, where no workspace exists — ask the
repository itself:

```sh
pnpm arcadia docket --repo /path/to/project
```

`docket` reads only that repository's `PROJECT.md` and `docs/plans/`, and
prints the same brief `next` does, including responsibility, clarification, and
acceptance criteria. It takes no `--workspace`, opens no database, and says so
on every run: it reports one repository and never the portfolio. Use `next`
when you want the portfolio's answer, `docket` when you want the project's.

To see one Plan's progress as a to-do list, ask the same repository:

```sh
pnpm arcadia plans --plan <slug> [--all] [--json]
```

It is workspace-free and derived from the Plan document on every call (no
store): a counts line, the current Action, the next five and the blocked ones
with their recorded reason, as `- [x]`/`- [ ]`/`- [!]` items; `--all` lists every
Action. The current Action is PROJECT.md `current_action` for the active Plan,
otherwise the first unfinished Action whose `depends_on` are done. "Done" is the
recorded Action status, not re-proven acceptance, and the order is not the
dispatch queue (`arcadia next` is). `--json` emits `arcadia-plan-progress-v1`,
a one-way view whose statuses are the Plan document's.

Below the `Authorization:` line, the brief prints **Standing constraints**: the
repository's `CONSTITUTION.md`, verbatim. Nothing parses the Constitution, so
printing it here is what makes a dispatched agent read the rules that bind the
Action rather than merely be pointed at the file. It is deterministic and costs
no LLM tokens.

Edit `CONSTITUTION.md` to change what appears — the brief has no second copy to
keep in step. A repository without a `CONSTITUTION.md` simply omits the section;
its absence never blocks dispatch, because foreign repositories Arcadia manages
are not required to adopt one.

### What a repository deferred, and whether it is time yet

The Way says a deferral must name the condition that revives it, and that a
firing trigger outranks `current_action`. Both rules were unreadable: the
conditions lived in prose that no command could evaluate, so a deferral was
remembered only if someone happened to reread the document at the right moment.

```sh
pnpm arcadia triggers --repo /path/to/project
```

Like `docket`, it reads only that repository and takes no `--workspace`, so it
answers in a fresh clone or a container. It reports four states:

- **fired** — the condition is met. Resolve it before dispatching.
- **waiting** — evaluated, not met. A real answer, not a silence.
- **unevaluable** — declared in prose. Reported anyway, so nothing is invisible.
- **untriggered** — deferred while naming no condition at all. `AGENTS.md`
  calls that a rejection; write the condition or close the item.

To make a deferral machine-checkable, move it into `.arcadia/triggers.json`
(`schema: arcadia.triggers.v0`). Each entry names what it `watches`, the plan or
Action it `fires`, and a `condition` of one of two kinds:

- `count` — reads a repository-local JSON file and compares matching records
  against `atLeast`. Files outside the repository are refused.
- `observed` — a person sets `observed: true` when the thing happens. Use it
  for conditions no file can reveal, like a client asking for a guarantee.

Anything else is reported `unevaluable` rather than guessed at.

An Action can also be deferred by an answered Decision rather than by prose. A
Decision that names its Action (`action:`) and offers an option with
`effect: defer` is applied by answering it:

```sh
pnpm arcadia decision approve 0057 --project arcadia \
  --answer "Defer until the next opencode-cli live rehearsal" --dry-run
```

`--dry-run` shows which Action would be parked and where the pointer would land;
drop it to apply, which sets `status: deferred`, advances the pointer to the next
eligible queued Action, and lands one recoverable receipt and commit. A deferred
Action stops dispatching immediately. To revive it once its trigger fires, reverse
the applied deferral with `pnpm arcadia decision reverse 0057 --project arcadia`,
which re-opens the Decision, restores the Action, and puts the pointer back — the
trigger firing alone revives nothing. See `docs/COMMANDS.md` and
`docs/managed-documents.md` for the fields, the reversal, and the commit-failure
recovery.

## Working across many projects without losing the thread

Momentum across several projects at once depends on two things nobody usually
gets for free: the command you run has to answer for the project you are
actually standing in, and the debris every session leaves behind — worktrees,
branches, half-finished checkouts — has to stay legible instead of quietly
turning into either lost work or noise you can no longer trust. Both failed
here in practice before they were fixed: a bare `arcadia docket` run inside a
different project silently answered for Arcadia instead, and 15 worktrees and
54 branches accumulated over weeks with nothing ever surfacing that fact. The
three pieces below are the fix, and they run automatically once installed —
there is nothing to remember to do.

### Running `arcadia` from anywhere

`scripts/arcadia`, symlinked onto your `PATH`, lets `arcadia <command>` run
from any directory and mean **the project you are standing in**:

```sh
cd ~/Dev/PrivatePracticeNow/platform
arcadia docket      # Private Practice Now's docket, not Arcadia's
arcadia next        # resolves the Project from where you are standing
```

Arcadia's CLI has to execute inside Arcadia's own checkout, so the launcher
changes directory to get there — and that would normally destroy the one piece
of context these commands need. It records where you actually were in
`ARCADIA_INVOKED_FROM` first, and the CLI resolves repositories and Projects
from that rather than from wherever the runtime happens to be.

Outside any managed project you get a blocker naming the directory it searched,
never a quietly substituted answer. Pass `--repo` or `--project` to override.

A relative `--repo` is read the same way — `arcadia docket --repo .` means the
directory you are standing in, not the checkout the launcher moved to. Commands
echo the resolved absolute path back, so the answer always names the repository
it actually read.

Install or repair the symlink with:

```sh
ln -sf "$(pwd)/scripts/arcadia" ~/.local/bin/arcadia
```

### Cleaning up worktrees and branches

Agent sessions leave worktrees and branches behind. `arcadia tidy` quarantines
the ones whose work is provably already on the base branch, and reports
everything else without touching it. **Nothing is ever deleted** — retirement
relocates a branch's history and a worktree's files into a recoverable
location under this repository's own `.git` directory, and `arcadia tidy undo
<run>` reverses it byte-for-byte:

```sh
arcadia tidy              # dry run — nothing is changed
arcadia tidy --apply      # quarantines what the dry run listed
arcadia tidy list         # show every quarantined run still recoverable
arcadia tidy undo <run>   # restore exactly what that run quarantined
```

`--apply` also requires the Arcadia workspace (resolved normally, or supplied
with `--workspace`). Before quarantining anything, `tidy` checks live
`prepared` and `running` Session leases and the 24-hour reservation written by
`arcadia go --apply` for a newly prepared handoff. The check and quarantine
share the same database interlock, so a concurrent `go` or `tidy` cannot turn a
stale preview into permission to touch live work. A dry run without workspace
protection is labelled preview-only; apply is refused.

The Git safety rule is: **nothing is quarantined unless its working tree is
clean and every branch change is proven present on the base branch** — or the
worktree is registered but its directory is provably gone (`missing`). Proof
may be literal ancestry, patch equivalence whose net effect is still present,
or a verified merged pull-request commit. Git rechecks dirty state at
quarantine time, and branch quarantine is one atomic `git update-ref --stdin`
transaction that verifies the branch's tip before moving it, so a concurrently
advanced branch survives untouched. A worktree whose path is unreachable right
now — a disconnected or unmounted volume, a permission error — is never
guessed at either way; `tidy` refuses to touch it rather than treat "cannot be
checked" as "safe."

It fetches `origin` first by default. Every worktree in a repository shares one
set of refs, so a `main` nobody has pulled in recently makes every worktree's
ancestry check stale at once — a genuinely merged branch reads as unmerged, not
because anything is wrong, but because the local answer is out of date. Pass
`--no-fetch` to compare against the local branch only.

It also checks GitHub for merged pull requests when `gh` is available. A
squash or rebase merge rewrites history, so a branch merged that way never
becomes an ancestor of the base branch — only the commit GitHub actually
produced does. `tidy` verifies that commit's ancestry rather than trusting
GitHub's "merged" label alone, so a squash-merged branch is correctly retired
instead of sitting forever in "unmerged." Pass `--no-github` to skip this.
Authentication, rate-limit, malformed-response, and remote-resolution failures
disable this proof for the run and are reported as unavailable; they never
produce a merged verdict.

By default every fully merged branch is retired, agent-owned or named by you.
Pass `--exclude-own-branches` to keep the merged branches you named yourself,
since deleting your own ref is your call. Agent-owned branches (`codex/`,
`claude/`, `agent/`, `worktree-` prefixes) are always retired.

Anything genuinely unmerged is never touched, and anything with no remote copy
is called out explicitly as the only copy of that work.

### What stays recoverable

Everything `tidy --apply` touches stays recoverable, not just the branch
content: a quarantined worktree's full file tree — including gitignored files
`git status` never sees, since a quarantine is a plain directory rename, not a
Git operation — and even a detached HEAD's commits that no branch ref
contains.

**A branch** is quarantined by one `git update-ref --stdin` transaction that
verifies its current tip, creates `refs/arcadia/tidy/<run>/heads/<branch>`
pointing at it, and deletes `refs/heads/<branch>` — atomically, so a branch
that moved concurrently is left untouched instead of quarantined at a stale
tip. Its reflog moves with it, so `git reflog show
refs/arcadia/tidy/<run>/heads/<branch>` shows the branch's full history, not
just a "created" line.

Older tidy receipts may name the pre-quarantine recovery tag
`archive/tidy/<sha>` — never `archive/<branch>`. Current tidy does not create
archive tags: the run-scoped quarantine ref above is the authoritative restore
location, and `arcadia tidy undo <run>` is the safe recovery command.

**A worktree** is quarantined by first creating
`refs/arcadia/tidy/<run>/worktrees/<id>` pinned at its HEAD commit — this is
what keeps that commit alive once its admin directory moves out of the
location Git's garbage collector scans for live worktrees, which matters most
for a detached HEAD whose commits nothing else references — and then renaming
both its working directory and its `.git/worktrees/<id>` admin directory into
`.git/arcadia-tidy/quarantine/<run>/<id>/`, verbatim. An already-missing
worktree (its directory is gone, but Git still registers it) has only its
admin directory quarantined this way, instead of being discarded by `git
worktree prune`.

`tidy` proves a branch landed three ways before quarantining it, and reports
which one applied: plain **ancestry**, **patch equivalence** (`git cherry`,
which sees through cherry-picks, rebases, and amended commits with no
network), or a verified **merged pull request** (checking the commit GitHub
actually produced, not just its "merged" label). A branch is only called
unmerged once all three decline it.

### Recovering a tidy run

```sh
arcadia tidy list         # every quarantined run, newest first, with its contents
arcadia tidy undo <run>   # restore exactly what that run quarantined
```

`undo` reads only the run's own manifest — each branch recorded once its ref
transaction commits, each worktree once both its directories are moved — so it
never has to guess or re-derive prior state: every branch is restored to its
exact prior tip with its reflog, and every worktree's directory and admin
directory are renamed back to precisely where they were. A run with nothing
left to restore (everything undone) drops off `tidy list` on its own; a
partially-restored run keeps only whatever failed to restore, so a retry never
re-touches what already came back, and nothing recoverable is ever silently
lost.

### Noticing before it piles up

`arcadia go` now ends by stating the repository's state — extra worktrees and
already-merged branches — and points at `tidy` when there is anything to clear.
It is a local count only, with no fetch and no GitHub call, so it costs nothing
at a session boundary. That check exists because the accumulation that prompted
`tidy` sat unnoticed for weeks: nothing ever put the state in front of anyone.
Together with the cwd-aware launcher above, this is what lets you run many
projects at once without either losing track of which one you are talking to
or quietly accumulating a mess you cannot safely see through.

### Ask an agent for something now

You can tell any agent session, in its chat, to do a piece of work right away,
even when no Plan holds it yet. It starts at once in its own fresh worktree, so
`arcadia go` sessions and the active Plan keep going. Every usual gate still
applies: tests, a PR with a QA plan, independent review, and a Decision before
any approval boundary. Your request covers the work itself, not merging,
deploying, spending, credentials or messaging.

Because no Action exists for it, the agent opens a GitHub Issue quoting your
request and links the PR to it, so the work is visible. A message that arrives over
Discord or Ingress is treated as a signal, not your instruction, until Arcadia can
verify the sender (the bot checks guild and channel only today); once it can, it
will stop at a pull request. Large or unclear requests are
planned first, with open questions put to you as Decisions. This is interim
guidance; a first-class path waits for parallel Plans
(`docs/proposals/operator-directed-work-as-parallel-plans.md`). The procedure is
`docs/agent-guidance/operator-directed-work.md`.

## Answering Decisions

Arcadia separates approval Decisions from clarification Decisions:

- An approval Decision offers **Approve**, **Reject**, and **Defer** because it
  asks whether a proposed action or Run may proceed.
- A clarification Decision shows **Your answer**. Write the answer in your own
  words and choose **Answer & continue**. Arcadia records the information and
  immediately runs clarification again; it either produces the concrete next
  Action or surfaces one focused follow-up question. This does not authorize
  execution. **Get help answering** can generate advice and copy it into the
  answer box as an editable draft.

A concrete next action now needs a stated **done-condition** ("Done when:").
Before `arcadia clarify` records a next action it checks that a done-condition
exists, that the action opens with a verb, and that every file path, Action id,
Decision id and `arcadia` command it names appears in the Action's own text
(title, raw input, expected artifact, the earlier question and your answer). If
any check fails you get exactly one follow-up question naming what is missing,
instead of an action nobody can recognise as finished. An action that passes
those checks is then graded by a separate local grader (concrete verb, a first
step startable in under 15 minutes, an observable done-condition, no invented
facts); only a pass records `clarified`, and a fail gives you exactly one
question. If the grader cannot be reached the Action keeps its state and the
preview says why. The done-condition and the grade are stored together as a
`clarify.grader.verdict` receipt on `--apply`. At the CLI, add `--clarify` to
`review approve <id> --answer <text>` (or `review resolve-reply <reply> --id
<id>`) to re-clarify once as soon as your answer is recorded. For a coding-agent
action that came from an `arcadia ask`, `--apply` also drafts a handoff Agent
Ask into the Project's `.arcadia/asks/`; it waits in `arcadia todo` until you
accept it.

In Discord, reply directly to a clarification notification with the answer in
your own words. Arcadia confirms the Decision id, records the answer, and
continues clarification. Use `defer` to leave the question open or `reject` to
withdraw it. Approval Decisions still require an explicit `approve`, `reject`,
or `defer`; free-form text never grants execution authority.

Mission Control opens each detail view at its own URL. Use the browser Back button to return through the views you opened, or use the in-page **Back** link to return to Mission Control.

Codex remains the default coding agent. Managed planning and build packets can also use Claude Code through the `claude_planning` and `claude_build` profiles, and build packets can use `opencode_build`, which launches the opencode CLI headlessly in the prepared worktree. The provider registry ranks opencode last, so Codex or Claude Code is selected whenever either is available and opencode is used when they are not; opencode has no planning profile. The Dashboard uses the defaults in `config/coding-agent-profiles.json`; advanced CLI use can select a profile per packet with `arcadia ask --agent-profile <name>` or `arcadia work plan --agent-profile <name>`. A Decision stays bound to the profile named in its exact packet.

Managed plan Actions may also declare a vendor-neutral execution profile. For
those Actions, Arcadia uses the replaceable provider mappings in
`config/provider-adapters.json` to choose the least costly available
configuration that satisfies the required capability, reasoning effort, tools,
context, sandbox, and data locality. An explicit `--agent-profile` narrows the
eligible configurations but cannot weaken the Action requirement. If no
configuration qualifies, Arcadia refuses the Run instead of silently choosing a
weaker model. See `docs/agent-execution-policy.md`.

Execution profiles do not change approval authority. A more capable model still
cannot deploy, publish, merge, delete, spend money, use credentials, access
production data, or send messages without the applicable operator Decision.
Arcadia records observed provider usage and limits but does not yet estimate
Action token consumption or schedule from predictive budgets.

The **Intelligence** screen shows recorded current-day usage, live Codex account limits, and the latest Claude Code context and subscription-limit snapshot. Use **Refresh usage** in the usage section to request current data from all configured coding-agent providers; the section also refreshes automatically when its snapshot is stale. Arcadia reads Codex through its local app-server protocol. Claude Code supplies telemetry through `scripts/claude-code-statusline.sh`, configured as the user's Claude status line. Arcadia retains the most recently reported provider snapshot in `~/.arcadia/telemetry/coding-agent-usage.json`, so a transient provider or UI refresh does not erase it; stale values are labelled as the last reported snapshot. Missing provider fields remain explicitly unknown.

Other CLI commands are advanced or compatibility surfaces, not part of normal daily operation unless a current task says otherwise.

## What is waiting on you: `arcadia todo`

```sh
pnpm arcadia todo                      # blocking items, then five others: open Decisions newest first, then the rest oldest first
pnpm arcadia todo --all                # every other item too, stale last
pnpm arcadia todo --stale              # only items with positive evidence they are done
pnpm arcadia todo --project arcadia    # one Project
pnpm arcadia todo --agents             # the in-flight agent work the default view only counts
pnpm arcadia todo --json               # schema arcadia-todo-v1, under `data`
```

The default view has two sections. **Yours** holds everything described below plus
a **Your Asks need one answer (N)** group: the newest five questions your Asks
raised, with the full N always printed (`counts.askQuestions`) and never hidden by
the five-item cap on other items (`--all` lists every one). Each carries the
command that answers it: `arcadia review approve <id> --no-execute` to create it as
work (approving an Ask question never starts an executor, whatever flag or Discord
command is used; running the work is a separate approval), with `reject`, `defer`
and the Discord reply listed beside it. **Agents are doing**
is one count line of in-flight agent work (prepared or running Sessions, pending or
running managed Runs); `--agents` lists them. A line `Back Burner: N incubating
(M new in 7 days)` shows how big the shelf is without making it a to-do. With no
resolvable workspace the output says Ask questions and Ask-origin tasks are
unavailable instead of printing zero.

### Where an Ask goes: `ask.routing.v2`

An Ask that matches no execution pattern is **never** shelved silently. It becomes
a question in `arcadia todo` (Clarify First); only an intake classification of
Idea, or `arcadia ask --back-burner`, puts an Ask in the Back Burner. A reply such
as `yes` that names no Decision also asks which one you meant. Phrasings like "I
should be able to ...", "I want (to be able) to ..." and "it would be good if ..." are
work requests for an operator Ask under this flag (off, or agent-written, they read
as before). Two messages create no question and say why in their
receipt: a whole message that is only `thanks`, `thank you`, `ok`, `okay`, `got it`,
`ack` or emoji (bare `done` is not on the list, because it can be a completion
report), and an exact repeat of a question that is still open within 24 hours.
`arcadia ask show --coverage` counts those as suppressed, apart from Asks that
vanished, and counts the deterministic `recurrence` and `planning` intake flags.
Agent-written Asks (`agent.ask`, `codex.*`) keep the earlier routing.

### What Arcadia heard, and fixing it with one reply

Every `arcadia ask` result, and every Discord reply to an Ask, opens with one line
before any detail:

```
Heard: work (high, rule) -> Action work_1 in Arcadia . wrong? reply type: work|idea|answer|status
```

The type is `work`, `idea`, `answer` or `status`; an Ask Arcadia could not place is
`unclear` (the question it left in `arcadia todo`) and one that created nothing is
`none`. The stewardship detail that used to follow is still available: add
`--verbose` for the text, or `--json`, which always carries all of it.

If the line is wrong, correct it once:

- CLI: `pnpm arcadia ask correct <ask_id> --type <work|idea|answer|status> [--project <slug>]`.
  `--project` alone moves the Ask without changing its type. The `ask_…` id is on
  the receipt (`Ask:`).
- Discord: reply to the receipt message with `type: work`, `project: <slug>`, or
  both (`type: work project: songbook`).

A correction re-routes only through the writers Arcadia already has (the Ask
pipeline, Back Burner promote or archive, review resolve-reply). The record it
replaces is closed (a question is rejected, an idea archived or promoted, an
unstarted Action deferred), linked to the new one as superseded, and never deleted;
the original capture is kept. `pnpm arcadia ask show <id>` displays the link. A
correction never starts an executor: no Run is queued.

`type: answer` is stricter: the Ask is read as the answer to a pending Decision you
name, `arcadia ask correct <ask_id> --type answer --ref <decision id or slug>` or
`type: answer ref: R12` in Discord. Arcadia never picks the Decision for you, and
from Discord the reply is accepted only when `DISCORD_ALLOWED_USER_IDS` is set and
lists you; otherwise it is refused and nothing changes. Only a question can be
answered this way (an Ask question, a clarification, or an ordinary open Decision);
an execution approval or a follow-up Decision such as "Execute approved work" is
refused, and you decide it with `arcadia review approve`. The `task` type arrives with
a later Action.

Corrections stick. Each correction, and each approval of an Ask question, is
remembered in the workspace database (never in a repository). The next time you send
the identical words (compared after trimming, collapsing spaces and ignoring case;
never by similarity), Arcadia skips its patterns and routes them as you corrected,
with no model call and no new question, and the receipt says so:

```
Heard: work (memo 2026-10-08) -> Action work_2 in Living Songbook . wrong? reply type: work|idea|answer|status
```

A memo can only route to work, idea or status. It never answers a Decision, never
applies to an agent-written Ask or to a reply that names a Decision, and never runs
anything. An explicit `--project` on the repeat wins over the remembered Project.
Correct it again and the newest correction wins, including a newer correction to a
type a memo cannot apply, which retires the older memo. A memo also stands down when
the ordinary route for those words is Requires Review or Blocked, and when the words
match a concrete request that needs review and is not safe to execute even though a
missing field routes them to a question (for example "deploy the site to production"
with no Project). So a memo can replace a question about words nothing matched, or a
shelved idea, but never skip a review: a memo on words nothing matched makes only a
Requires Review Action for the operator. Any process able to run the `ask correct` CLI
creates an operator-sourced memo, so that command carries the same trust as the rest
of the CLI. The routing flag below turns memos off together with the rest of the
routing.

Approving an Ask question makes exactly one Action, even if two approvals run at once
or an approval fails part way. A second approval that starts while the first is still
in progress is refused and creates nothing ("run it again" once the first ends); it
does not wait. Run it again after a failed attempt and it picks up the Action the
first attempt made. If you archived, closed, deferred or corrected that Action in
between, the retry refuses and creates nothing; reject the question and send the
request again if the work is still wanted.

To restore the earlier routing, set `"ask": { "routing": { "v2": false } }` in the
workspace's `config/arcadia.json`; the flag defaults to on. A config file that cannot
be read never loses an Ask: the default is used and the receipt carries a warning.

### Is Ask routing getting better? `arcadia ask report` and the golden set

```
pnpm arcadia ask report [--since 7d] [--json]
```

Read-only. Per operator source (agent-written Asks and replies that only record
words behind another write are left out) it prints: the **vanish rate** (target
zero: Asks at least an hour old with no open record that `arcadia todo` lists and no
acted, answered or on-purpose Idea outcome; suppressed Asks are counted apart);
corrected ÷ classified; questions ÷ Asks; Back Burner arrivals (filed on purpose
versus shelved as a fallback); memo hits; Asks flagged `recurrence` (three or more
revive the deferred Schedule capability) and `planning`; and how many corrections
no golden case backs. Vanished Asks are listed by `ask_…` id only; trace one with
`arcadia ask show <id>`. Run it from an Arcadia checkout so it can read the golden
set. When three or more memos share a corrected type and the same first three words,
the report says so: that is a hint for an agent to propose a deterministic rule and
a golden case in a reviewed PR. Nothing is ever generated automatically. The vanish
rate is judged at report time (each Ask where it stands now) and leaves suppressed
Asks out. Corrections are attributed to the source of the Ask that was corrected, so
each source block shows its own memos and how many no golden case backs.

The golden set is `tests/fixtures/ask-golden.jsonl`: one JSON object per line with
`id`, a paraphrased or synthetic `text` (never real Ask text), `expected_type`
(`work`, `idea`, `status`, `unclear` for the Clarify First question, or `answer`),
and optionally `expected_path` (the stewardship's execution path, for example
`Requires Review`), `expected_memo` and seeded `corrections` for memo hit and miss
cases. To add a case, append a line, run `pnpm vitest run tests/ask-golden.test.ts`
and open a PR; the reviewed merge is the approval. The test replays every case
through the pure intake, memo and stewardship functions and also through the real
`arcadia ask`, so CI fails when either routes a known Ask differently. A golden case
backs a correction when it has the same type and opens with the same first three
words. Those words come from real Ask text, so write the case as a paraphrase or
synthetic example that merely begins with the same three generic words (for example
"I want to ..."), and never copy a real Ask, its Project names or its details into the
repository.

`todo` is a read-only view derived on each run: nothing is stored, written or
run. It lists seven sources per Project: **open Decisions**, **pending Agent
Ask proposals**, **open or deferred review items** (these include
ActionClarification questions; items an agent has flagged for agent review wait
on the agent, not you, and are left out but counted: `counts.agentFlaggedHidden`,
printed as `agent-flagged hidden: N` on the counts line when N is above zero), **waiting operator tasks** (the
repo-local ledger `.arcadia/operator-tasks.jsonl`) and **production
escalations** (`production_operator_escalations` rows, read-only), **unclarified
captures** (kind `clarify`) and **Plan Actions that wait on you** (kind
`plan_action`). An item is
*blocking* when `arcadia next` would refuse to dispatch because of it, and
otherwise *other*, using the same gate; a review item is blocking only when it
is linked (by its own or its work item's `plan/<plan>#<action>` reference, Plan
included, since Action ids can repeat across Plans) to the Action that gate
selected, never recomputed. The gate names only that selected Action and the
Decisions that hold it; it does not name any other Action's open question, so a
clarification review item on a not-selected `question_open` Action stays an alert
until that Action is the one `arcadia next` selects (then it is blocking). An operator task is blocking only when its origin is
that Action. A production escalation is always blocking: its row says the
production loop is stalled, even when no Decision or Ask exists. Blocking
escalations are listed first.
Each item shows `key` (`decision:<project>/<id>`, `agent_ask:<project>/<proposal-id>`, `review_item:<project>/<id>`, `operator_task:<project>/<task-id>`, `escalation:<kind>:<project>/<action>`, `clarify:<project>/<work-item-id>` or `plan_action:<project>/<plan>#<action>`, unique across Projects), its own
title, project, created date, source, and the existing command that answers it
(a Decision's `arcadia decision approve ...`, an Agent Ask's settle preview, a
clarification review item's `arcadia review approve <id> --answer "<answer>" --clarify`,
an operator task's `arcadia operator-task show <id> --repo <path>`, with `close --operator` and
`decline` listed after it (closing is the operator's own attestation), an escalation's own `remedy`; with no remedy,
`arcadia production status`; a `clarify` item's `arcadia clarify --work <id> --apply`, with the
dry run `arcadia clarify --work <id>` listed first; a `plan_action`'s Agent Ask preview, which records the answer
to its question or completes the Action once you have done the step).
Every item carries `origin` in `--json` (always present, a string or `null`; the
text view prints it when set). It is one string taken only from a field the source
already records, never synthesized:

| kind | `origin` | source field |
| --- | --- | --- |
| `decision` | `plan:<slug> action:<id>`, whichever it has | the Decision's `plan` and `action` frontmatter; `null` when it names neither |
| `agent_ask` | `request:<request_id>`, then ` via:<source>` | the proposal's `request_id`, and `ingress_source` of the capture envelope its `capture_id` names (omitted when that envelope is not stored) |
| `review_item` | its `resolved_intent`, for example `ActionClarification` | the review item row |
| `review_item` (an Ask question) | `ask:<ask_id>`, then ` via:<source>` | the Ask that raised it, and `ingress_source` of its capture envelope when stored |
| `operator_task` | `action:<id>` or `decision:<id>` | the ledger entry's `origin` |
| `escalation:<kind>` | `action:<id>` | the id part of `production_operator_escalations.action_key` (the kind is already in `kind`) |
| `clarify` | `capture:<capture_id>`, then ` via:<source>` | the work item's `capture_id`, and `ingress_source` of that capture envelope when stored |
| `plan_action` | `question_open` or `requires_review` | why the Action waits |

The shapes differ by kind because each source records different things; the type
is the same everywhere (`string | null`), so a consumer can print it as-is. A
`null` origin means the source records nothing usable (a Decision with neither
`plan` nor `action`), not that the field was left out. The dashboard's read-only
rows show it as received.

A review item also shows, for a
clarification, the Discord reply and Mission Control **Answer & continue** paths
that answer it without `--clarify` (they re-clarify on their own). Any other
review item prints `arcadia review show <id>`: look before you approve, since
approving some kinds authorizes a Run.
A Decision or Agent Ask item also carries what the source records, and nothing
more: `gateQuestion` (the `gate_question`), `options` (every option in order,
each with its `consequence` and whether it is `recommended`) and `evidence` (a
Decision's `evidence` or `references` lines; an Agent Ask's `evidence[]`
entries with their `status` and `note`). A field the source does not record is
left out of the JSON. Their `answerVia` names the one existing dashboard path,
the `/runs` To-do section, which posts to `/api/approvals` (a Decision with
`option`, an Agent Ask with `disposition`); with no workspace there is no
dashboard, so none is listed. A Decision also gets the Discord reply path when
`docs sync` raised a live review item from its document (`doc_ref`
`decision/<slug>`, which is otherwise listed only as the Decision): reply to its
requires-review notification, or run `arcadia review resolve-reply "<answer>" --id
<review id>`; either writes the answer into the Decision document. An Agent Ask
has no Discord reply path, so none is listed.
A Decision's created date is its `updated` field, since Decisions carry no
creation time. A review item raised from a Decision document (`doc_ref`
`decision/<slug>`) is not listed again beside that open Decision; several review
items on one work item show once. An operator task whose origin or `reference`
(`decision/<slug>`, `review_items:<id>`) names a listed Decision or review item
shows only as that item; an escalation whose own gate is a listed Decision
(`Launch of <key> is held by pending Decision 0094: ...`) shows only as that
Decision, which is then marked blocking. A Decision merely cited elsewhere in the
message (an Agent Ask's title, a lapsed-grant note) does not merge anything. A review item whose Project is completed or not listed appears
under Project `unknown` rather than disappearing.

A `clarify` item is a non-done `work_item` whose `clarification_status` is
`unclarified`, which came from a capture (`capture_id`), and which has no open
or deferred review item (that review item would already be its question). It is
always an alert, and its title is the work item's own. A `plan_action` item is an
unfinished Action of the Project's active Plan that `arcadia next --ready` does
not call ready and that waits on you: its `question_open` question (`origin:
question_open`, listed even when the Action has an unmet `depends_on`, since the
question can be answered now), or `requires_review` responsibility with no unmet
dependency in front of it (`origin: requires_review`; only `requires_review`
Actions are held back by unmet dependencies). The readiness code is `arcadia
next`'s own, not a copy. Actions parked by a deferral or an external block, and every Action of a Project in a pause state
(PROJECT.md or its active Plan not `active`) are left out. An Action is shown by
the item that already represents it, not twice: an open Decision it requires or
that names it (`action:`), a review item whose `doc_ref` (or its work item's) is
the Action, or a waiting operator task whose origin is the Action. A `plan_action`
is blocking only when it is the Action `arcadia next` selected; its created date
is its Plan's `updated` date, since an Action carries no creation time.

**Limit:** Decisions raised only on unmerged candidate branches are not listed.
`todo` reads Decision documents as files on disk in each Project's configured
`repo_path` checkout (normally its base branch; it runs no `git` command and does
not look at other branches or worktrees), so a Decision appears once its PR
merges there.

Done when (derived each run, never stored): a Decision is no longer open; an
Agent Ask is settled; a review item is resolved or approved (no longer open or
deferred); an operator task is closed or declined; an `escalation:<kind>` row is
gone, because the production tick clears it once the cause is resolved; a
`clarify` item's work item is clarified, done, or has an open review item; a
`plan_action`'s Action is done, its question is answered (no longer
`question_open`), or it is no longer `requires_review`.

Blocking items come first. Among the others, open Decisions come first, newest
first, so a freshly raised question is not buried; every other item (Agent Asks
and review items) follows oldest first. `--all`, `--stale` and `--json` use the same order, and the
default view shows the first five others.

The counts line shows live totals and what the view hides, for example
`0 blocking · 202 other · stale hidden: 73 (decisions 8, agent asks 194, review items 0, operator tasks 0, escalations 0, clarify 0, plan actions 0)`.
In `--json` these are `counts.byKind` (`decision`, `agent_ask`, `review_item`,
`operator_task`, `escalation`, `clarify`, `plan_action`) and `counts.agentFlaggedHidden`
(the deferred review items an agent flagged for agent review, in the Projects in
scope; none is listed); the schema stays `arcadia-todo-v1` and the change is additive.
The printed answer commands omit `--workspace`: add it when you use a
non-default workspace. The Agent Ask answer contains a
`<settlement-request-id>` placeholder you must fill in before running it.

**Stale** means positive evidence only. An Agent Ask of intent `complete`,
`split` or `action` with a `target_ref` is stale when every Action it targets
exists in a Plan of its Project with status `done`; an Ask naming only absent
Actions is an un-adopted proposal and is never stale. An Ask is also stale when
another unsettled Ask's rationale has an explicit `Supersedes: <proposal ids>`
line naming it, and only when the superseding Ask is in the same Project and not
settled `rejected` (Asks naming each other in a cycle of any length, two or more,
cancel out: no member of the cycle is hidden). A review item is stale
when its work item is done or its `doc_ref` names an answered (approved or
rejected) Decision. An open Decision is
stale when its `action` is done. The default view hides stale items;
`--stale` lists only them, each with a `stale:` reason; `--all` shows every
item, stale last.

Projects whose slug contains `rehearsal`, or whose `repo_path` is under the OS
temp directory or `~/tmp`, are fixtures: their non-blocking items appear only as
one `Fixture Projects collapsed` line (`counts.fixture`). A Project with no
`repo_path` is collapsed the same way, into a `Projects with no repo_path collapsed`
line (`counts.noRepoPath`), because nothing about it can be checked against a
repository. A blocking item (for example a stalled production escalation) is
always listed and counted as blocking, whichever kind of Project it belongs to.
A Project whose `repo_path` is set but unreadable, that fails to read, or whose
repository has no `PROJECT.md`, becomes a `project sources unavailable:` line
and never drops the other Projects. In `--json`, `asOf.workspace` is the
workspace name and `asOf.workspacePath` its path.

When no workspace resolves, `todo` still reads the open Decisions of the
checkout you are standing in, plus that checkout's waiting operator tasks and
Plan Actions, and ends with one `workspace sources unavailable: <remedy>` line,
so a short list is never mistaken for an empty one; Agent Asks, review items,
unclarified captures and production escalations live in the workspace database,
so they are not listed then (and a Plan Action a review item represents is
listed on its own).

## Durable planning memory

An opted-in workspace can project accepted planning Artifacts into an Obsidian vault. SQLite remains operational truth, workspace files remain execution evidence, and synchronization is one-way from Arcadia to the vault. Arcadia exports only after deterministic planning Validation passes and the final `CodexPlanningArtifactAcceptance` Decision is approved; draft plans, initial Run approvals, failed output, and raw executor evidence are not exported.

Final acceptance writes the managed vault Record before marking the Artifact ready, the original Action done, and the Decision approved. If the vault write fails, those SQLite transitions do not occur; fix the reported vault problem and retry acceptance. Historical or changed Records can be inspected and repaired with:

```sh
arcadia memory sync --workspace <path> --dry-run
arcadia memory sync --workspace <path>
```

The command never reads operational state from Obsidian and never deletes vault content. Files under the vault's `Arcadia/Records/` subtree are Arcadia-managed projections, not editable inputs.

## Living-system navigator

A Project that owns a validated `docs/living-system.yaml` can project its
capability map and Action timeline into `Projects/<project-slug>/` in the same
vault. Repository files own durable meaning; managed documents, explicit
`Action: plan-slug#action-id` Mission Log links, and operational receipts own
status and history. Preview is the default:

```sh
arcadia memory system sync --project <project> --workspace <path>
arcadia memory system sync --project <project> --workspace <path> --apply
arcadia memory system sync --all --workspace <path> --json
```

Home, Topic, and episode pages work as plain Markdown. Obsidian adds WikiLinks,
transclusions, optional Markmap panes, and a Canvas split view. Claims show
provenance and freshness; gaps remain visible. Sync never installs plugins or
calls a model. Generated pages are replaceable: preserve or remove only that
Project's generated subtree, then re-run `--apply` to roll back or rebuild it.
Accepted Action transitions attempt a refresh only when vault memory is enabled;
a refresh warning never reverses the accepted transition.

## Automatic local services

After you sign in following a laptop restart, Arcadia's managed launch agents start and keep these services running:

- **Dashboard (core)** — Mission Control, Needs you, Runs, and System Status at port 3020.
- **Managed Run worker (core)** — executes only queued, authorized Runs with the coding agent bound to each packet.
- **Intelligence API and worker (feature-specific)** — structured generation at port 4710. Its durable SQLite queue dispatches cloud, local LiteLLM, Codex CLI, and Claude Code CLI generation through separate bounded pools, so a long image job no longer blocks unrelated requests. The health and admin-capability views advertise a LiteLLM offering only while its model group appears in the proxy's authenticated model inventory; a configured deployment that LiteLLM rejected is therefore unavailable before submission rather than failing as a test job. Local structured-text callers can select Claude Code with `executionTarget: "claude-code"`; the default route uses the installed `claude` CLI and does not authorize paid cloud usage.
- **ComfyUI image backend (feature-specific)** — local FLUX.2 Klein generation/editing at port 8188 when configured.
- **Discord adapter (feature-specific)** — capture, status, notifications, and
  the morning Orientation Packet. That packet opens with a factual narrative
  of recent Project changes, seven-day velocity versus the prior week,
  accumulated blockers/Decisions, and the strongest coding-agent handoff
  opportunity before presenting today's normal orientation slate.

The Dashboard binds to local interfaces for this operator-only workflow, so a
phone can reach it over the LAN or Tailscale. If the Projects card and the
repository's docket ever disagree, refresh the page: the card selects the
most recently updated open Action, while the repository remains authoritative
for the full control record.

The optional iCloud file-ingress job also starts automatically and checks its drop folder once a minute. It is not required for the Today page.

Do not start separate legacy processes manually. Anything outside this list is not part of the normal local service set.

Intelligence defaults to independent cloud, Codex CLI, Claude Code CLI, and local
capacity. Tune the pool limits only when provider quotas or local hardware
require it; the available `ARCADIA_INTELLIGENCE_*_CONCURRENCY` settings are
listed in `docs/intelligence/ROUTING.md`. `GET
/api/intelligence/health` reports each pool's configured concurrency and live
active/waiting counts.

For local image generation, start ComfyUI with `scripts/comfyui/start.sh` before
using Arcadia Intelligence. It is loopback-only; Arcadia stores generated
images as normal Artifacts. See `docs/intelligence/COMFYUI_IMAGE_EXECUTOR.md`.

If Arcadia is unavailable, ask Codex to **check or restart all Arcadia services**. The direct fallback is:

```sh
scripts/services.sh restart
```

`restart` and `stop` refuse while managed production is Active, because they
would unload the worker a live rehearsal depends on; the rehearsal's own
Off-first step restarts after turning production Off. If production status
cannot be read they warn and proceed. `ARCADIA_FREEZE_OVERRIDE=<reason>`
inline bypasses the refusal (see
`docs/agent-guidance/rehearsal-freeze-window.md`).

To watch what the services are doing, follow their logs in one terminal. Every
line is prefixed with its source (`worker.out`, `dashboard.err`, …):

```sh
pnpm logs            # every service, stdout and stderr
pnpm logs worker     # just the worker: admissions, refusals, reconciliations
pnpm logs errors     # every service's stderr
pnpm logs session    # watch the newest live coding-agent Session, read-only
```

`dashboard`, `intelligence`, and `discord` select one service. `session` attaches
read-only to the agent's tmux pane, so you see exactly what the agent sees
without being able to type into it (detach with Ctrl-b d); `pnpm logs session
<name>` picks a specific one. `LOG_LINES=100 pnpm logs` shows more history first.
It only reads; it never starts, stops, or signals a service.

Arcadia pins Node in `mise.toml`, and Corepack activates the pnpm version in
`package.json`. The restart script installs and validates that toolchain, then
writes every managed LaunchAgent to start through `mise exec`; login-shell PATH
state cannot select a different Node ABI.

## Stable demo deployment

The development dashboard (port 3020) runs `next dev` from the primary checkout,
so every restart cold-compiles each page and every merge changes the code under
it. For a demo that must work at any moment there is a second, separate
dashboard: a pre-built release of a **git tag**, served by `next start` on port
**3030**, reading the same `martianrover` workspace. `scripts/services.sh restart`
never touches it.

- **URL:** `http://arcadia-1.alpine-rattlesnake.ts.net:3030` (or
  `http://127.0.0.1:3030` on the Mac). Optionally
  `https://arcadia-1.alpine-rattlesnake.ts.net/` with no port, through
  `tailscale serve`.
- **What serves it:** the `com.arcadia.demo.dashboard` LaunchAgent (KeepAlive)
  runs `next start` from `/Users/pmark/Dev/MR/Arcadia/releases/current`, a
  symlink to the active tag. It sets `ARCADIA_DASHBOARD_CLI=built`, so every
  page shells out to that release's own compiled CLI, never to the moving
  checkout. Demo actions are real writes to the shared workspace.
- **Release tags:** a tag starting with a version number (`v1.2.0`), `rel-` or
  `release-`, case-insensitive; the newest by creation date wins. Cut one from
  green `main` as an annotated tag (the creation date is the tag's own):
  `git tag -a v1.2.0 -m "v1.2.0" && git push origin v1.2.0`. Only tags that are
  ancestors of `origin/main` are deployed, and names with anything beyond
  letters, digits and `. _ + -` are ignored.
- **Nightly:** the `com.arcadia.demo.nightly` LaunchAgent runs
  `scripts/release.sh nightly` at 04:00. It fetches tags, deploys the newest
  release tag if it is not already current, and pings you with the outcome.

```sh
scripts/release.sh list              # built releases and available tags
scripts/release.sh status            # current tag, is :3030 answering, last receipt
scripts/release.sh deploy v1.2.0     # build, smoke-test on :3031, then swap and restart
scripts/release.sh build v1.2.0      # build only, without promoting
scripts/release.sh use v1.1.0        # failover: instant switch to a built tag
scripts/release.sh nightly           # what the 04:00 job runs
scripts/release.sh prune             # keep the newest 3 builds plus current
scripts/release.sh install-plan      # print (never run) the install commands
```

`deploy` builds the tag in its own detached worktree (frozen-lockfile install,
`pnpm build`, `next build`), starts that build on staging port 3031, and
requires `/now`, `/actions`, `/review`, `/projects` and `/api/snapshot` to
answer HTTP 200 within the budget (`ARCADIA_DEMO_SMOKE_BUDGET`, 90 seconds).
Only then does it swap `current` and restart the agent, which takes about two
seconds, and checks that :3030 serves this release's own build (its static
manifest URL, `/now` and `/api/snapshot`). A failed build, a failed smoke
check, a failed restart or a swapped demo that does not answer restores and
re-checks the previous release, exits non-zero and writes a receipt to
`releases/receipts.jsonl`. A build whose tag was later force-moved is rebuilt by
`deploy` and refused by `use`.

**Failover.** If the demo misbehaves, `scripts/release.sh use <tag>` switches to
any tag listed as `built` at once, with no build and no smoke test, and
`scripts/release.sh status` confirms it. `use` refuses a tag that is not built.
`use` also pins the demo: the nightly job stays paused (it will not redeploy the
newest tag over your failover) until the next `scripts/release.sh deploy <tag>`.

**Limits.** A release is older code than the database's newest migration:
additive migrations are harmless, but a destructive migration must ship with a
new release tag. The demo shares the live worker, Intelligence service and
Discord bot, and `/runs` still reads the operator-script library of the primary
checkout.

**Installing needs an operator Decision.** Loading the LaunchAgents, the nightly
job and the Tailscale entry, and cutting a release tag, is a deployment that
CONSTITUTION.md reserves for an explicit Decision. Until it is answered nothing
is installed; `scripts/release.sh install-plan` prints the exact plists and the
`launchctl` and `tailscale` commands for you to run, followed by the undo
commands.

## Compact agent instructions

`arcadia project setup-context --repo <repository>` installs the compact Way
bootstrap and its searchable `docs/agent-guidance/index.json`, preserving
project additions outside generated regions. Agents read indexed procedures
before their operation and search the Project's Notes To Self before commands
or new failures. No procedural manual is automatically imported.

`arcadia way` reports missing/stale resources and instruction delivery problems.
`pnpm check:agent-guidance` in Arcadia checks canonical bytes and defaults at
root and every checked-in nested instruction directory. The generated bootstrap
has an 8 KiB limit, root 12 KiB, project chain 24 KiB and conservative combined
chain 32 KiB, leaving 8 KiB for global instructions. Oversized adopter additions
are reported rather than discarded. Custom provider profiles, fallback names
or extra imports require separate effective-load evidence; passing the default
file audit does not prove agent understanding. See
`docs/reports/issue-880-context-delivery.md` for evidence and fresh-session QA.

### N-neutral dry baseline preparation

`node --import tsx scripts/prepare-rehearsal-dry-baseline.ts <params.json> --reset-date YYYY-MM-DD --output-dir <fresh-staging-directory>` renders `step-01` through `step-NN` (N=2–12), validates the serial chain with Arcadia's document parser and ready-set resolver, and records input, source and output hashes. Rerunning unchanged input resumes the same receipt; drift refuses and preserves the existing stage. Use an empty temporary directory or a dedicated directory in the candidate checkout. The main checkout, live fixture/workspace, operator-script library and symlinked stage entries are refused.

The JSON parameters use schema `arcadia-rehearsal-dry-preparation-v1`, `runId`, `actionCount`, the existing fixture pins (`fixtureRepoPath` and `fixtureGithubRepo`), `requiredCommits` entries (`commit`, `why`), and `preservation` (`resetRunId`, `resetHead`, `terminalOffRunId`, `localMain`). The existing required-commit floor cannot be removed; unfilled bindings refuse. These are supplied bindings, not proof that prerequisite receipts were ratified or commits installed.

This command stages two reviewed documents and a receipt only. Its neutral Action IDs are not yet supported by the existing live rehearsal-chain operator scripts. Applying the baseline requires that adapter and the governed Ask path. Real `SMOKE_DRY=1` review dispatch, first-attempt reviewer receipts and unattended V1 evidence remain separate integration work; this generator makes none of those claims and starts no Session.
