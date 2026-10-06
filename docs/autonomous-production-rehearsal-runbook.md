# Autonomous production rehearsal runbook

Status: written 2026-10-06 after five live rehearsal runs (2026-10-04 to
2026-10-06). It records only what was proven live or is stated as a gap. When a
step here disagrees with the code or a newer receipt, the code and the receipt
win and this file gets fixed. Authority never comes from this file: Decisions,
the Constitution and the operator do.

Read this before any critical-path production work, together with
`docs/managed-production-readiness.md` (current answer and per-run candidate
sections) and `docs/notes-to-self.md` (friction by command and symptom).

## 1. The standard this runbook aims at: minimum viable autonomous production

Name the next result honestly: **installed-host unattended local-integration
proof**, not general production autonomy. It is met when one rehearsal run, on
the installed host, shows all of the following with evidence:

1. The installed broker revision equals `origin/main` and production is
   Inactive before the run (`arcadia go-broker status`, `arcadia production
   status`).
2. The operator presses one one-shot G7 Grant for exactly the three fixture
   Actions. After that press **no operator step occurs** until G8: no merge,
   no rerun, no settle, no Ask.
3. Each Action is admitted by the worker tick, built by the coding agent,
   preserved as a draft PR whose body carries the host-rendered Operator QA plan
   and validation evidence, readied and pushed (settled head) by the tick, and
   judged by both independent reviewers (code review and QA) on the exact head.
4. Both verdicts PASS on the first attempt. A rerun is an operator-attention
   event: it is allowed once under standing permission (section 3) but a run that
   needs one has not met this criterion.
5. The worker integrates each candidate by local fast-forward (never a GitHub
   merge or base push) and admits the next Action without an operator step.
6. G8 proves terminal Off with zero live admissions and Sessions, and every
   fixture candidate is integrated, preserved or empty.
7. The same result repeats cleanly once more; only then escalate one dimension
   at a time (more Actions, then another Project or provider, then longer
   windows).

Proof ladder, never skip a rung: current exact source installed and inactive,
fresh one-shot Grant (operator press), one serial three-Action run, terminal Off
and reconciliation, a clean repeat, then one escalation.

**Where the five runs stand:** in run 5, criteria 1, 3 (through Action 1), 5
(for Action 1) and 6 were met. Criteria 2 and 4 were not (QA needed one rerun,
run by the release manager) and Action 2 stopped at QA (open Issue #987), so the
standard has not been met yet.

### Learning: shorten the loop first

Runs 1 to 5 each found one orchestration defect, and each cost a 2 to 4 hour
repair loop (fix, review, merge, reinstall, reset, G6, operator press, watch),
although a trivial Action takes about 6 minutes live. Most of those defects
were reproducible offline. So:

- **Measure the loop, per defect:** loop cost (wall time and operator attention
  per live run), time to detect (G7 press to the first visible symptom) and
  time to fix (symptom to the fix installed). Record them in the run's retro.
- **The trigger:** two consecutive live runs that each find a new defect a
  local reproduction could have found means stop and build the cheap
  experiment first, before the next live run.
- **The live run is the integration check, not the debugger.** Reproduce and
  fix defects offline; a live run should confirm what the offline harness
  already passed.
- **The cheap experiment must call the same lifecycle code.** A harness that
  reimplements the tick, preservation, review or settlement proves only
  itself. `pnpm fast-rehearsal` (`tests/fast-rehearsal/README.md`) runs the
  real worker tick and settlement with only tmux, GitHub, the reviewer models
  and the coding agent faked, in about a minute.

## 2. What the five runs proved, and what each blocker cost

Fixture: `pmark/arcadia-three-action-rehearsal-20261004` (Project
`three-action-rehearsal`, Plan `autonomous-three-action-rehearsal`, Actions
`write-start-marker` then `transform-start-marker` then `verify-final-rehearsal`).

| Run (G7 granted) | Stopped at | Cause | Fix | Evidence |
| --- | --- | --- | --- | --- |
| 1 (2026-10-04) | Action 1 code review | One-line patch cannot exercise five criteria; reviewer returned `needs-follow-up` (zero findings) | Bounded `not-applicable` per-file classifier, naming anchor, Tests criterion (#934, #935, #936) | PR #1 preserved; G8 Off r31 |
| 2 (2026-10-05 15:17Z) | Action 1 QA | A stale pending run-1 completion proposal silently gated the amended Action for 33 minutes (`advance` said `decision`); then the host PR body had no Operator QA plan | Reset handles proposals by state (#968, run-3 reset); host-rendered Operator QA plan in preserved PR bodies (#969) | PR #2; G8 Off r33 |
| 3 (2026-10-05 18:47Z) | Action 1 QA | Attempt 1 failed a nondeterministic HIGH "Approval boundaries" (candidate's own settlement commit); the rerun returned NEEDS-FOLLOW-UP ("Tests and evidence" failed, "Correctness" not checked: no validation command or output in the body) | Validation evidence section and settlement-commit note in the PR body (#974) | PR #3; QA reports in the workspace `artifacts/qa/...`; G8 Off r35 |
| 4 (2026-10-05 22:00Z) | Action 1 readiness and integration (PR #4 never left draft) | The agent's drafted Agent Ask stayed untracked and unarchived; the worker's preservation committed it on top of the settle commit; the integration guard refused in a silent 3-second loop for about 3 hours | Settle archives the canonical draft (#983, Issue #981); the archive half proven live in run 5; one deduped log line and one `terminal_candidate_not_integrable` escalation in `production status` (tested, **not yet seen live**) | PR #4; G8 Off r37 |
| 5 (2026-10-06 03:22Z) | Action 2 QA | Action 1 **integrated autonomously** (first time). QA first failed Step 4 wording (Issue #986), passed on the one rerun. Action 2's PR is judged against a stale GitHub base (Issue #987) | Open | PRs #5 (integrated locally) and #6; G8 Off r39 (`runs/20261006T033451Z-43195`) |

Merged enablers that every run depends on: remote preservation (#922),
tick-driven PR readiness and both reviews (#924), G1/G6/G7/G8 runbook scripts
(#926, #932), peer-watch contract (#938), agent Identity blocks (#941),
experiment-workspace guard (#943), activity-leak fix and inline-required mode
(#948, #950), rehearsal freeze window (#952), G8 settled-descendant
reconciliation (#955), run-2 to run-5 script pairs (#959, #970, #973, #985),
`arcadia ping` (#975).

Observed timings (a trivial one-line Action, installed host, from the receipts
and logs; they will be larger for real work): G7 script run 79 to 126 seconds
(runs 2 to 5), after which production reads `Active`; admission to draft PR 40
to 180 seconds; draft to readied with the settled head about 1.3 minutes; both
verdicts within about 3 minutes of readiness; run 5's Action 1 took about 6.3
minutes from its admission to Action 2's admission (an upper bound for
integration), **including** one QA rerun. CI on a PR: 5 to 15
minutes (runner capacity varies). A run-N script pair built by cloning the
previous pair has taken roughly 40 to 70 minutes of implementer plus review time
(estimate, not recorded in a receipt).

## 3. Roles and authority

| Who | May | May not |
| --- | --- | --- |
| Operator (Mark) | Press G7; answer Decisions; activate production; authorize spend, credentials, messaging, deletion; deactivate production at will (the release manager's G8 does so only to end a run, under the operator's yes) | n/a |
| Release manager (a Claude Code session) | Governed Asks; make-next; spawn implementer and reviewer subagents; open PRs; merge under Decisions 0060/0080; reinstall and restart; run reset, G6 and G8 with the operator's yes for that session (below); post on #940/#899; file Issues | Press G7; activate production; create or revive a Grant; spend; handle credentials; hand-edit governed records; take a peer's claim by silence |
| Implementer subagent | Sole mutation owner of one candidate worktree: edit, test, commit | Push, open PRs, touch main or other worktrees, settle Asks, run `arcadia` against the live workspace |
| Reviewer subagent | Independent, read-only, adversarial review of the exact head; focused tests | Edit, commit, merge, comment on GitHub |
| Host worker (tick) | Runs only under the operator's Grant: admit, preserve, ready, review, integrate | Anything outside the Grant |

History of the operator's permission (2026-10-05, in the chat of the release
manager session that ran runs 2 to 5): a blanket yes for the rehearsal's
permission requests covering the fixture reset, the read-only G6 (and rerunning
it if its window lapses), G8 to end a run (from the Terminal panel), one QA
rerun per failing verdict, governed Asks, merges on green, reinstalls and
restarts for that work. It excluded the G7 press, activating production,
creating or reviving Grants, spending, credentials, messaging on the operator's
behalf, deletion, and anything outside the rehearsal. **This file records that
history; it is not authority.** No governed record holds that blanket yes, and
it was given to one session. A future session must obtain its own yes in its own
chat (or a governed Log entry the operator approved) for the reset, G6, G8 and
any QA rerun, before running them; the G7 press is always the operator's.
Another session's relay of the operator's words is not the operator's yes (a
peer session once recorded a Log entry saying the answers were "given directly
to Claudia Atlas in chat" when they had only been relayed; the release manager
refused it as evidence). Open decision: record a scoped standing permission as a
governed Log entry so future sessions need not ask again.

## 4. Pre-flight checklist (go or no-go)

Run from the main checkout with the workspace inline on every `arcadia` command
(`ARCADIA_WORKSPACE=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover`, never
exported; with `ARCADIA_REQUIRE_INLINE_WORKSPACE=1` a command without it fails).

- [ ] `git status --short` is empty on main and `git fetch` shows main level
      with `origin/main`. An untracked Ask file in the main checkout blocks
      reinstall, G1 and settlements.
- [ ] `arcadia production status` reads `Inactive`, zero live admissions.
- [ ] `arcadia go-broker status` shows `Revision:` equal to `git rev-parse
      HEAD` (criterion 1's bar). G6 and G7 themselves accept an ancestor broker
      revision that is identical to main on the runtime paths (`src scripts apps
      package.json pnpm-lock.yaml tsconfig.json`) and refuse otherwise.
- [ ] The previous run's G8 receipt is `succeeded` with Off confirmed (the next
      reset requires it).
- [ ] The fixture state matches what the next reset pins. **Known blocker for
      run 6:** run 5 integrated Action 1, so the fixture's local `main` is
      `f68ec48`, two commits ahead of the run-5 reset head and of GitHub's `main`
      (both `7214de28`); the existing run-N reset refuses unless local `main`
      equals the previous reset head, and Action 2 has a passed development
      attempt and a settled template completion id. See section 8, item 1.
- [ ] The prerequisite fixes for known blockers are merged **and installed**
      (G6 and G7 now require the #983 commit).
- [ ] No other session plans a merge, push, reinstall or restart in the freeze
      window (section 5, phase 2).
- [ ] The operator is reachable for the G7 press inside a 30-minute window.

## 5. The exact procedure

### Phase 0: orient (5 minutes)

1. Read `PROJECT.md` `current_action`, `arcadia advance queue --json` (check
   `orderValid` and `unpositionedCount`), `arcadia production status`,
   `arcadia go-broker status` against `git rev-parse origin/main`, the open PRs
   (`gh api 'repos/pmark/arcadia/pulls?state=open'`), and the last run's
   `runs/*/receipt.json`.
2. State the first unmet gate in one sentence with its evidence.

### Phase 1: land every fix and the next run's scripts (governed, parallel)

For each change (one Action per session; one mutation owner per candidate):

1. Draft one `action` Ask with `arcadia agent-ask draft '<json>'` (observable
   acceptance criteria; a unique `request_id`). Settle it with
   `arcadia agent-ask settle --proposal <id> --request-id settle-<id>
   --disposition accepted --responsibility agent --top`, then again with
   `--preview <fingerprint> --apply`. Push main (governed commits are pushed).
2. Point the pointer at the Action: `arcadia advance queue make-next --action
   arcadia/<action> --revision <queue revision> --request-id <id>` then `--preview
   <fp> --apply`. Launch its candidate with `~/.local/bin/arcadia-go-broker-<agent>`
   (never hand-create worktrees). Repeat steps 1 and 2 for the next Action.
3. Hand each candidate to **one implementer subagent** (Opus, high effort) with:
   the exact worktree, the Action's criteria, the live facts it may not query,
   the hard rules (commit identity, no push, no live commands, no hand-edited
   governed files) and a request for its own read-only reviewer.
4. When it reports, settle the **completion** Ask inside the candidate (draft
   with `arcadia agent-ask draft`, then settle as above, so the archived Ask is
   committed by the settle itself), `git push`, and open the PR with REST
   (`gh api repos/pmark/arcadia/pulls -f title=... -f head=... -f base=main -F
   body=@file`; `gh pr create` hit GraphQL rate limits). The PR body needs the
   operator QA plan (see `docs/agent-guidance/arcadia-repository.md`).
5. Start an **independent** read-only reviewer on the exact head (a separate
   subagent with an adversarial authority and safety focus) and watch CI. Record
   each review round as a PR comment. A push resets proof; a delta commit needs a
   delta review.
6. Merge on green only: independent review of the current head with no unresolved
   blocking finding, all required jobs green on that head, merge state clean
   (Decision 0060 as amended by 0080); `gh pr merge --squash --subject "<title>
   (#N)"`. A job cancelled with "not acquired by Runner" or with no log is GitHub
   runner capacity: rerun the failed jobs once (`gh api -X POST
   repos/pmark/arcadia/actions/runs/<run>/rerun-failed-jobs`); a failing job is
   fixed, not rerun. When two PRs settle governed files and the second conflicts,
   do not hand-merge: take main's governed files and redo the settlement.
7. Make the next run's G6 and G7 **require** the newest prerequisite commit
   (`REQUIRED_COMMITS` in the preflight and grant scripts) so documentation is
   not the only enforcement.
8. Run `pnpm fast-rehearsal` before any live run (and after any change to the
   tick, preservation, the review steps or settlement): unsandboxed, from the
   checkout that will be installed. It must pass. It prints per-phase timings
   and every error; its expected failures (`it.fails`) name the open gaps it
   reproduces (Issue #987 and the stalls listed in its README). A fix that
   closes one flips that marker, which the fix's change updates.

### Phase 2: merge window, freeze and the single reinstall

The freeze window is defined in `docs/agent-guidance/rehearsal-freeze-window.md`:
it covers the time production is Active (through G8) and permits merges on
origin while the main checkout is not fast-forwarded across runtime commits.
This runbook is **deliberately stricter**: it also stops merges from the install
through G8 (a merge moves `origin/main` away from the installed revision, so
criterion 1 would fail, and between G6 and the press it voids G6), and it adds a
stricter stretch from G6 to the G7 press.

1. Announce on #940 and #899 (and message live sessions): production Off, merge
   what is lawfully ready now, and **merges close at a stated UTC clock time at
   least 20 minutes ahead**. Double-check the clock time (one announcement was
   posted with the wrong time and needed a correction).
2. At the announced time merges stop. As the **first step of the freeze**, install
   once: `ARCADIA_WORKSPACE=<abs> artifacts/generated/operator-scripts/recover-arcadia-host-services.sh run`;
   confirm `arcadia go-broker status` shows `Revision:` equal to main and that
   `git status` is clean. (Installing before the announced time lets a late merge
   leave the broker stale against main; installing inside the freeze, before the
   reset and G6, does not void anything.)
3. From the install until G8: no merges, no queue moves, no fixture docs-sync
   or settlement, no main pushes across runtime commits, no service restarts
   other than G8's. **Exception: the run's own scripts** (the reset, which runs
   docs sync and may settle-reject a pending fixture proposal; G6; the operator's
   G7 press; G8). From G6 until the G7 press, additionally **no pushes to main
   at all (not even governed docs-only settles)**: G6's receipt binds the exact
   main head and the installed broker revision, so a main push, a reinstall, a
   reset, a recover or any G8 voids it (G7's `next_after.voided_by` lists them).

### Phase 3: reset, G6, ping (back to back, inside the freeze)

1. Reset the fixture (this session needs the operator's yes in its own chat for
   it, section 3): `ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004
   artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-run<N>-<date>.sh run`.
   It amends only `write-start-marker`'s `next_action` (runs 2 to 5; run 6 must
   also amend Action 2 and 3, section 8 item 1) (a new requirement input
   revision; a passed development attempt for an unchanged input is never
   relaunched), names a fresh unused completion request id (the packet template's
   `complete-<action>-<date>` collides on a same-day rerun), asks the agent to
   leave `git status` clean after settling, handles earlier proposals by state,
   and pushes one commit without force after full validation. Expect a receipt
   with the new fixture head.
2. Immediately run G6: `.../preflight-three-action-rehearsal-run<N>-<date>.sh run`
   (read-only). It must print `READY`. Its window is **30 minutes from its
   finish time**.
3. Tell the operator right away, in the chat and with `arcadia ping "<what to
   press and the UTC deadline>" --kind attention --link <url> --agent "<name>"`
   (success means queued, not delivered): the exact button
   (`grant-production-three-action-rehearsal-run<N>-<date>`, on `/runs` or
   `/actions`), **not G8**, the deadline (G6 finish + 30 minutes) and a safer
   "press by" 5 minutes earlier. Convert the deadline to local time and check
   the arithmetic.

### Phase 4: the operator presses G7

The G7 script (hermetic replay plus activation) takes about 80 to 125 seconds;
production then reads `Active`. If G7 refuses because main or the broker moved, rerun G6 (with
the operator's yes for this session) and ask again. The `/actions` page isolates the single next action
and shows what voids a G6.

### Phase 5: watch with a watchdog (not a change-only watcher)

A run that is stuck produces no state changes: run 4's silent refusal loop went
unnoticed for about 3 hours because the watcher only fired on change. Use a
watcher that exits on any change **or** after 10 minutes with production Active
and no change, printing the worker log's distinct recent lines (Appendix A).
Re-arm it after every event, and run it as a notifying background task.

Expected sequence per Action (about 6 minutes for a trivial Action): production
`Active · Building (1 admitted)`, a new candidate branch and a draft PR on the
fixture, the PR readied with the settled head, `awaiting_independent_verdicts`
in `production status`, both verdicts, then integration (the fixture's **local**
`main` fast-forwards) and the next Action admitted.

### Phase 6: verdicts and stuck states

- **Check the PR body** once: it must contain `### Validation evidence`, the
  corrected plan preamble and the completion-settlement line.
- A **failed verdict never integrates.** Read the report (workspace
  `artifacts/qa/pull-requests/<repo>/<PR>/<sha>/attempts/*/qa-report.md` and
  `artifacts/code-review/...`). With the operator's yes for this session, one
  rerun per failing verdict is allowed: `arcadia qa pr <PR url> --rerun`; record both
  verdicts and do not rerun a second time. File every genuine finding as an
  Issue with a revival trigger.
- **Active with no admitted work:** run `arcadia advance --repo
  /Users/pmark/tmp/arcadia-three-action-rehearsal` (the fixture clone). `Transition:
  decision` means a pending Agent Ask for the old input gates the Action;
  `launch` with no admission means read the worker log
  (`~/Library/Logs/arcadia-services-*/worker.out.log`, ignoring repeated
  lines), `production_launch_blockers`, `production_operator_escalations` and
  `production capacity` (read-only `sqlite3 -readonly` on the workspace
  database only).
- If the run cannot progress, stop it: G8 (next phase). Do not improvise a
  bypass, a manual merge, a mid-run `agent-ask settle` of a fixture proposal or
  an edit of the fixture (each breaks the freeze and criterion 2); fix the cause
  after G8, through the next reset.

### Phase 7: terminal Off (G8)

Run `.../restore-terminal-off-three-action-rehearsal-run<N>-<date>.sh run` **from
the operator's Terminal panel or `/runs`**. A plain non-interactive shell
refuses with "launch this action through /runs or from an interactive host
terminal" and changes nothing. Expect `TERMINAL OFF PROVEN: Inactive at revision
<n>, zero live admissions and Sessions before and after the reviewed restart;
every fixture candidate is integrated, preserved or empty.` **Before G8, copy the worker log** (`~/Library/Logs/arcadia-services-*/worker.out.log`)
into the evidence folder: G8's restart recreates it (run 5's log after G8 held
nothing from runs 1 to 5). G8 restarts host
services (a reviewed restart), so nothing else may run during it. An accidental
G8 press before G7 is harmless but voids the G6 receipt (it reinstalls the
broker): rerun G6.

### Phase 8: close out

1. After G8 proves Off, post "WINDOW OPEN" on #940 and #899 with the outcome
   (the freeze ended with G8).
2. Capture evidence: the G6/G7/G8 and reset receipts under
   `artifacts/generated/operator-scripts/runs/`, the PRs on the fixture, the QA
   and code-review reports, and the escalation text if any.
3. File an Issue per defect (symptom, mechanism, fix options, acceptance,
   revival trigger); never lose discovered work.
4. Update the memory or retro notes; add friction to `docs/notes-to-self.md`.

## 6. Failure catalog (symptom, cause, action)

| Symptom | Cause | What to do |
| --- | --- | --- |
| Reviewer `needs-follow-up`, criteria `not-checked`, zero findings | A trivial patch cannot exercise the criteria | Fixed (#934-#936); if it returns, run a read-only smoke against the exact patch before touching prompts |
| Escalation `attempt_retry_not_authorized`, nothing launches | A passed development attempt exists for an unchanged requirement input | Reset the fixture (amend `next_action`); a new fixture is blocked by G1's fixed slug and path |
| `Active · No admitted work`, no log, `advance` says `decision` | A pending Agent Ask for the old input gates the Action (run 2) | Run-3 and later resets reject that exact proposal by state. Do **not** do it mid-run (freeze, criterion 2); in run 2 it was done to unblock a run that had already stalled, which is why it appears here |
| QA FAIL "Operator QA plan" missing | Host PR body had no QA plan | Fixed (#969) |
| QA FAIL "Tests and evidence", no validation output | PR body gave an exit code without a command or output | Fixed (#974) |
| QA FAIL HIGH "Approval boundaries" on the candidate's own settle commit | Reviewer nondeterminism about the governed completion settlement | The body now states it (#974); one rerun allowed; record both verdicts |
| Worker log repeats "differs from its exact canonical completion settlement" every 3 s | An unarchived Ask draft was committed by preservation on top of the settle commit | Fixed (#983: settle archives the draft, proven live in run 5; one deduped log line and a `terminal_candidate_not_integrable` escalation, tested but not yet seen live); the brief asks for a clean tree |
| QA FAIL Step 4 says source inspection proves a check passes | Plan wording (Issue #986) | One rerun passed it; the wording fix is open |
| QA FAIL "wrong base and changed-file set" on Action 2 | The PR's GitHub base is stale after Action 1 integrated locally (Issue #987) | Open design choice (section 8) |
| Agent writes the template completion id and settlement stalls | `complete-<action>-<date>` already settled on a same-day rerun | The amended `next_action` names a fresh id; the reset refuses if it is used |
| G7 refuses "different main" | A governed settle commit or reinstall moved main or the broker after G6, or a G8 ran | Freeze (phase 2); rerun G6 |
| G6 invalid after an accidental G8 | G8 reinstalled the broker | Rerun G6; keep the buttons separate in the ping |
| `gh pr create` or a merge fails with GraphQL rate limits | Secondary rate limit | Use REST (`gh api`); check `gh api rate_limit` |
| CI jobs cancelled, no logs | Runner capacity | Rerun failed jobs once |
| `ps`, `sed -i`, `date` behave differently | macOS BSD tools | `sed -i ''`; compare times in UTC |
| Uninlined `arcadia` command writes a live activity row | Exported or default workspace | Inline the workspace on each command; inline-required mode (#950) |
| Reset or G6 refuses on a dirty main | An untracked Ask file or doc in the main checkout | Move the draft aside; keep main clean |
| A peer says "the operator said yes" | Relay, not authorization | Ask the operator in the chat that runs the script |

## 7. Operational gotchas

- `gh`, `git push`, the `arcadia` workspace database and the broker need the
  unsandboxed shell; scratch files go in the session scratchpad, not `/tmp`.
- Operator scripts are one-shot or refusing-form-only; read the descriptor
  (`artifacts/generated/operator-scripts/<id>.json`) for what each refuses.
- `artifacts/generated` is gitignored: pairs are tracked with `git add -f`.
- Hash-pinned guidance (`docs/agent-guidance/*`) needs its index re-pinned;
  `AGENTS.md` is generated from `docs/agents-context.md`.
- Settlement races: 20 or more parallel worktrees race on `PROJECT.md` and the
  Plan; the recovery is redoing the settlement against fresh main, never a hand
  merge.
- Read the database only with `sqlite3 -readonly`; never write it.
- Subagent economics: implementers and independent reviewers on Opus 5.5 high,
  read-only research on a cheaper model, polling and waiting with no model at
  all (shell watchers).

## 8. Gaps between today and a minimum viable production standard

1. **Fixture state for run 6 and #987 (both block a three-Action run).** (a) Run
   5 left the fixture's local `main` at `f68ec48` (Action 1 integrated). The
   reset must treat that without resetting away work and without a base push:
   either a fresh fixture (G1 parameterised for slug, path and repository) or a
   reviewed reset that moves the fixture clone's **local** `main` back to GitHub's
   `main` (the run-5 reset head `7214de28`) and starts the new run from there.
   That loses nothing: `f68ec48` stays on the run-5 candidate branch and PR #5,
   and it pushes no base. Say in the descriptor which head the new line starts
   from. Either way the reset must also amend Action 2's (and 3's) `next_action` (Action 2 has a
   passed development attempt at input `6bf8f08dbb3e`) and name fresh completion
   ids for every Action (`complete-transform-start-marker-2026-10-05` is already
   settled). (b) **#987, serial Actions (blocking criterion 5 for Action 2 and 3).** After
   Action 1 integrates locally, GitHub's `main` lags, so Action 2's PR diff and
   the host QA plan disagree about the base. Options: stack the PR on the previous
   candidate branch; render the plan against the GitHub base and teach scope
   checks about earlier integrated Actions; or authorize a base push after each
   integration (a Grant or Decision change, today forbidden). Pick one, then
   prove it in a run.
   [docs/qa-plan-consistency-replay.md](qa-plan-consistency-replay.md) reproduces this
   mismatch offline in seconds from run 5's preserved PR #6; its expected-failure
   test must flip with the fix (the doc says which fixes flip it unaided).
2. **#986** (plan Step 4 wording), **#984** (review follow-ups of #983),
   **#976** (hook-manager side effect of the plan's checkout step and test gaps):
   small, but each can fail a verdict. (Issues #972 and #981 were fixed by #974 and
   #983 and are closed.)
3. **First-attempt verdict pass (criterion 4):** no run has had both verdicts
   pass on the first attempt. Reviewer variance on the plan wording is the known
   cause; keep wording factual and bounded, and measure the pass rate over runs.
4. **The cost of a run:** each rehearsal cost about an hour to build its script
   pairs by cloning the previous run's. Propose one parameterised pair (run id,
   previous heads) instead of copies, so a new run is a reviewed one-line
   change.
5. **Visibility:** `production status` now names a terminal integration refusal
   (#983; tested, not yet seen live); a stuck candidate in other states and the dashboard rendering of
   escalations are still generic.
6. **Stalls reproduced offline, not yet seen live** (the fast harness's expected
   failures, `tests/fast-rehearsal/README.md`): an agent that leaves an extra
   file or commit after settling (Issue #994), or dies after its settlement
   commit and before the settlement is recorded (#995), leaves its Action
   preserved but held by a pending-Ask operator gate: a previewed, unsettled
   `complete` Ask makes the tick skip every launch, and `production status`
   never shows it (#997, the shared root cause; the same mechanism as run 2's
   stall, #968). The harness also reproduces #987's precondition. Next step:
   fix #997 and flip the markers.
7. **After criteria 1 to 6 hold in one run and repeat cleanly (criterion 7):**
   escalate exactly one dimension, in the order of section 1, with a fresh Grant.

## Appendix A: the no-progress watcher

Run as a notifying background command; it exits on a change or when nothing has
changed for `STALE_SECS` while production is Active.

```bash
#!/bin/bash
cd /Users/pmark/Dev/MR/Arcadia/arcadia || exit 1
W=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover
FIX=pmark/arcadia-three-action-rehearsal-20261004
STALE=${STALE_SECS:-600}
LOG=$(ls -t "$HOME"/Library/Logs/arcadia-services-*/worker.out.log | head -1)
snap() {
  ARCADIA_WORKSPACE=$W arcadia production status 2>&1 \
    | grep -E "Active|Inactive|three-action-rehearsal/|Alerts|stall|escalat" \
    | grep -v -E "Observed|Projects:|Plans:|Actions in scope|covers|Intent|Saved configuration" | cut -c1-110
  gh api "repos/$FIX/pulls?state=all&per_page=10" \
    --jq '.[]|"PR #\(.number) \(.state) draft=\(.draft) \(.head.sha[0:8])"'
  gh api "repos/$FIX/branches?per_page=30" --jq '.[]|"br \(.name) \(.commit.sha[0:8])"'
}
prev=$(snap); echo "BASELINE $(date -u +%T)Z"; echo "$prev"; last=$(date +%s)
while true; do
  sleep 60; cur=$(snap)
  if [ "$cur" != "$prev" ]; then echo "CHANGE $(date -u +%T)Z"; diff <(echo "$prev") <(echo "$cur"); exit 0; fi
  if echo "$cur" | grep -q Active && [ $(( $(date +%s) - last )) -ge "$STALE" ]; then
    echo "STALE $(date -u +%T)Z: no change while production is Active"
    tail -40 "$LOG" | cut -c1-300 | awk '!s[substr($0,26)]++' | tail -6; exit 0
  fi
done
```

## Appendix B: sources checked for this document

Receipts under `artifacts/generated/operator-scripts/runs/` (G8: run 1
`20261005T043958Z-2548` (r31), run 2
`20261005T160050Z-46759`, run 3 `20261005T194025Z-26232`, run 4
`20261006T011557Z-3871`, run 5 `20261006T033451Z-43195`); the fixture PRs #1 to
#6 on `pmark/arcadia-three-action-rehearsal-20261004`; Issues #899, #940, #968,
#972, #976, #981, #984, #986, #987; the per-run sections of
`docs/managed-production-readiness.md`; and the worker log
(`~/Library/Logs/arcadia-services-*/worker.out.log`).
