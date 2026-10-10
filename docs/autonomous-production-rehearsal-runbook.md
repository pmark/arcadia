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
4. Both verdicts PASS on the first attempt, or after the tick's own bounded
   reruns of pure reviewer variance. A **variance verdict** is a non-pass
   code-review or QA verdict with no finding other than the deterministic gate's
   refused not-applicable claims and no criterion judged `fail` (every non-pass
   criterion is a refused not-applicable or `not-checked`, and none of those is
   Correctness, Security and authority or (QA) Approval boundaries: a
   `not-checked` or refused not-applicable there stops at once). By the operator's
   2026-10-06 choice (Issue #1018; runs 1, 3, 5 and 6 each stopped on one) the
   tick reruns such a verdict automatically, at most 2 more times (3 attempts in
   total) per verdict kind per exact head, each rerun named once in the worker
   log and `production status` (verdict kind, attempt n of 3, reason); a new head
   restarts the count. A verdict with any real finding or any criterion judged
   `fail` stops at once on `independent_verdict_failed`, as does a third
   variance verdict (its entry says the reruns are spent). An automatic rerun is
   not an operator step, so criterion 2 stands. A rerun the **operator or
   release manager** runs (`--rerun`) is an operator-attention event: allowed
   once under standing permission (section 3), but a run that needs one has not
   met this criterion.
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
  and the coding agent faked, in a few minutes. Before a longer live run,
  the same shape runs there first: the nine-Action chain over simulated hours
  (`long-chain*.test.ts`) is the offline check for the overnight one-press run.

## 2. What the runs proved, and what each blocker cost

Fixture: `pmark/arcadia-three-action-rehearsal-20261004` (Project
`three-action-rehearsal`, Plan `autonomous-three-action-rehearsal`, Actions
`write-start-marker` then `transform-start-marker` then `verify-final-rehearsal`).

| Run (G7 granted) | Stopped at | Cause | Fix | Evidence |
| --- | --- | --- | --- | --- |
| 1 (2026-10-04) | Action 1 code review | One-line patch cannot exercise five criteria; reviewer returned `needs-follow-up` (zero findings) | Bounded `not-applicable` per-file classifier, naming anchor, Tests criterion (#934, #935, #936) | PR #1 preserved; G8 Off r31 |
| 2 (2026-10-05 15:17Z) | Action 1 QA | A stale pending run-1 completion proposal silently gated the amended Action for 33 minutes (`advance` said `decision`); then the host PR body had no Operator QA plan | Reset handles proposals by state (#968, run-3 reset); host-rendered Operator QA plan in preserved PR bodies (#969) | PR #2; G8 Off r33 |
| 3 (2026-10-05 18:47Z) | Action 1 QA | Attempt 1 failed a nondeterministic HIGH "Approval boundaries" (candidate's own settlement commit); the rerun returned NEEDS-FOLLOW-UP ("Tests and evidence" failed, "Correctness" not checked: no validation command or output in the body) | Validation evidence section and settlement-commit note in the PR body (#974) | PR #3; QA reports in the workspace `artifacts/qa/...`; G8 Off r35 |
| 4 (2026-10-05 22:00Z) | Action 1 readiness and integration (PR #4 never left draft) | The agent's drafted Agent Ask stayed untracked and unarchived; the worker's preservation committed it on top of the settle commit; the integration guard refused in a silent 3-second loop for about 3 hours | Settle archives the canonical draft (#983, Issue #981); the archive half proven live in run 5; one deduped log line and one `terminal_candidate_not_integrable` escalation in `production status` (tested, **not yet seen live**) | PR #4; G8 Off r37 |
| 5 (2026-10-06 03:22Z) | Action 2 QA | Action 1 **integrated autonomously** (first time). QA first failed Step 4 wording (Issue #986), passed on the one rerun. Action 2's PR is judged against a stale GitHub base (Issue #987) | #1006 (stacked PRs), #1008 (wording) | PRs #5 (integrated locally) and #6; G8 Off r39 (`runs/20261006T033451Z-43195`) |
| 6 (2026-10-06 15:51Z, N=9) | Action 2 code review | Action 1 integrated with both verdicts PASS on the first attempt (about 4.5 min); Action 2's PR #8 opened **stacked** on Action 1's branch (#987 live-proven). Code review returned NEEDS-FOLLOW-UP twice with no defect: a refused not-applicable on a test file, then Compatibility not-checked. Before that, G7 press 1 refused on an order-sensitive scope comparison and the reset left the queue unpositioned | #1017 (set compare), queue arranged by hand then #1020 (#1015), #1019 (bounded variance reruns, #1018) | PRs #7 (integrated), #8 (preserved); G8 `runs/20261006T160825Z-24828` r41 |
| 7 (2026-10-06 17:42Z, N=9) | Action 1 QA | Real MEDIUM "Managed documents": the fixture PROJECT.md and Plan still said "three-Action" while the reset's Action text said "Action 1 of 9". The variance rerun correctly did not fire | #1023 (N-Action wording plus coherence guard) | PR #9 (preserved); G8 `runs/20261006T175308Z-12860` |

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

**Variance reruns (2026-10-06, recorded from the release manager's chat; the
Agent Ask and its PR hold the decision):** the operator chose that the tick
itself reruns a variance verdict (criterion 4) at most twice more per verdict
kind per exact head. That changes the repair budget, not authority: it spends
only the already-granted reviewer calls, never reruns a verdict with a real
finding or a criterion judged `fail`, and changes nothing about review,
readiness, integration, the Grant or Decision 0058. Until the PR that
implements it is merged and the installed host runs it, the old rule holds (any
non-pass verdict stops the run).

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
      reset binds it by its run directory).
- [ ] The run's parameter file
      (`artifacts/generated/operator-scripts/rehearsal-chain/params/<run-id>.json`,
      section 5 "Start a run from the chain set") is merged on main with no value
      starting `UNFILLED`: its previous-run bindings come from the previous run's
      reset and G8 receipts, its `requiredCommits` name every prerequisite fix.
- [ ] The fixture state matches what the parameter file binds: the reset's
      read-only dry run prints `DRY RUN: no refusal` (it also shows the planned
      local-main move, the Plan diff and every completion id). Run 5's terminal
      state (local `main` `f68ec48`, ahead of GitHub's `7214de28`; Action 2's
      passed attempt; settled template completion ids) is what run 6's file
      binds, so the chain reset handles it (section 8, item 1).
- [ ] The prerequisite fixes for known blockers are merged **and installed**:
      G6 and G7 require every `requiredCommits` entry of the run's parameter file
      (for run 6 and run 7: #922, #924, #983, the #987 stacking fix `26172c74`
      (#1006) and the #997 gate fix `a4a7c184` (#1010); these five are also a
      fixed floor no parameter change can remove; run 7 adds #1017's
      order-independent Grant Action-set comparison, `3c67b0a8`; run 8 adds
      #1019's bounded reruns of a zero-defect reviewer-variance verdict,
      `c26f3a9e`, and #1020's queue arrangement and live capacity read,
      `98b532a1`).
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
7. Make the next run's G6 and G7 **require** the newest prerequisite commit:
   add it to `requiredCommits` in the run's parameter file (see "Start a run
   from the chain set" below), so documentation is not the only enforcement.
   An entry left `UNFILLED` makes G6 and G7 refuse.
8. Run `pnpm fast-rehearsal` before any live run (and after any change to the
   tick, preservation, the review steps or settlement): unsandboxed, from the
   checkout that will be installed. It must pass. It prints per-phase timings
   and every error; its expected failures (`it.fails`) name the open gaps it
   reproduces (the stalls listed in its README). A fix that
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
   docs sync; the chain reset settles no proposal, it refuses on a pending one;
   G6; the operator's G7 press; G8). From G6 until the G7 press, additionally **no pushes to main
   at all (not even governed docs-only settles)**: G6's receipt binds the exact
   main head and the installed broker revision, so a main push, a reinstall, a
   reset, a recover or any G8 voids it (G7's `next_after.voided_by` lists them).

### Start a run from the chain set (from run 6 on)

Runs 6 onward use one parameterised operator script set instead of a cloned
four-script pair per run: the shared implementation
`artifacts/generated/operator-scripts/rehearsal-chain/{reset,preflight,grant,restore-terminal-off}.sh`,
the pure tested module `src/operatorActions/rehearsalChain.ts`, and per run one
reviewed parameter file `rehearsal-chain/params/<run-id>.json` (`run-id` such as
`run6-2026-10-06`). Each run's four `/runs` entries are thin launchers plus
descriptors rendered from that file (ids `reset-rehearsal-chain-fixture-<run-id>`,
`preflight-rehearsal-chain-<run-id>`, `grant-production-rehearsal-chain-<run-id>`,
`restore-terminal-off-rehearsal-chain-<run-id>`), so each G7 stays one-shot per run.
The parameter file holds: the run id and label, the Action count N (3 to 12:
G1's three Actions, then `chain-step-04` onward, each reading its predecessor's
output), the previous run's ids and **bindings** (its reset receipt's run
directory and `newHead`, its G8 receipt's run directory and `fixtureMain`, and
every earlier candidate's branch, tip and pull request from that G8's
`work-reconciliation.jsonl`), and `requiredCommits`. A value starting `UNFILLED`
refuses (the reset needs the bindings; G6 and G7 need everything).

To start a run:

1. Write or fill `rehearsal-chain/params/<run-id>.json` (copy the previous run's
   file; fill the bindings from the previous run's receipts as its `notes` say).
2. Render and check its library entries:
   `node --import tsx scripts/render-rehearsal-chain-operator-scripts.ts`, then
   `pnpm check:operator-scripts` and
   `pnpm exec vitest run tests/rehearsal-chain.test.ts tests/rehearsal-chain-operator-scripts.test.ts`
   (the second unsandboxed). `artifacts/generated` is gitignored: `git add -f`.
3. Review and merge it like any change (Phase 1). A parameter-only change touches
   no runtime path, so it needs no reinstall, but it moves main: land it before
   the freeze.
4. Preview the reset read-only, any time: `ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004
   artifacts/generated/operator-scripts/reset-rehearsal-chain-fixture-<run-id>.sh --dry-run`.
   It prints the planned local-main move, the reset commit's Plan diff, every
   Action's fresh completion id and input revision, the live dry-run docs sync,
   and every refusal; it writes only into a temporary directory (from a
   candidate checkout, add `ARCADIA_REHEARSAL_RECEIPTS_DIR=<main checkout>/artifacts/generated/operator-scripts/runs`).

Run 6 (`run6-2026-10-06`) is the nine-Action chain, run tonight while the
operator sleeps: three batches of three tiny dependent Actions (G1's three, then
`chain-step-04` to `chain-step-09`, each reading its predecessor's output) under
**one** G7 press inside its 12-hour expiry, bound to run 5's receipts and still
starting from `7214de28`. Its G7 descriptor names the nine Actions one press
authorises. Run 7 (`run7-2026-10-06`, N=9) is a clean repeat of it, its file filled
from run 6's receipts: the reset `runs/20261006T141854Z-41044` (`newHead`
`162f5b19`), the terminal Off `runs/20261006T160825Z-24828` (`fixtureMain`
`6fbae8d6`) and one candidate per line of that G8's reconciliation, PR #1 to #8.
Run 6's Action 1 was integrated by local fast-forward and is preserved on PR #7;
Action 2 is preserved on **PR #8, stacked on PR #7's branch**
(`claude/write-start-marker-20261006T155142019Z`). The run-7 reset therefore
plans to move only the clone's local `main` from `6fbae8d6` back to GitHub
`main` `162f5b19`, after proving both candidates are preserved on GitHub, and
pushes only its single reset commit on `162f5b19`. Its candidate check accepts a
pull request whose base is not `main` only when that base is another pinned
candidate's branch and the pinned base tip is an ancestor of the candidate's tip;
an unreadable base or a stack on an unpinned branch refuses. It also reads the
queue and Codex capacity as described in Phase 3. (The three-Action rendering
stays covered by the tests.)

Run 8 (`run8-2026-10-06`, N=9) repeats the nine-Action chain after run 7 stopped
at Action 1's QA on a real MEDIUM "Managed documents" finding (PR #9): the
fixture's `PROJECT.md` outcome said "three dependent Actions" and its Plan was
titled "Autonomous three-Action rehearsal" while Action 1's text said "Action 1
of 9". Its file is filled from run 7's receipts: the reset
`runs/20261006T173810Z-40687` (`newHead` `f478438a`), the terminal Off
`runs/20261006T175308Z-12860` (`fixtureMain` `f478438a`, so run 7 integrated
nothing by local fast-forward and the reset moves no local `main`) and one
candidate per line of that G8's reconciliation, PR #1 to #9 (PR #9 is run 7's
Action 1, preserved at `8e362475`). It requires #1019 (`c26f3a9e`) and #1020
(`98b532a1`) as well. **The fixture-coherence guard** (offline, deterministic):
the reset renders every statement of the chain's size and purpose for N, and
refuses, in the real run and the dry run alike (stage `validate_amendment`, reason
prefixed `fixture coherence:`), any fixture managed document (`PROJECT.md`,
`AGENTS.md`, `CONSTITUTION.md`, the Plan and every Action's text) that still
states another number of Actions or rehearsal size than N, naming the file, line
and text (for example "three-Action", "three dependent Actions", "Action 1 of 3"
or "3 coding Sessions" with N=9). G6 runs the same guard on the fixture head
(check `fixture_coherence`). Action ids and slugs (`chain-step-04`,
`three-action-rehearsal`), the genesis check's marker lines and the Project's
registered name "Three Action Rehearsal" are not counts. Preview with
`ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004
.../reset-rehearsal-chain-fixture-run8-2026-10-06.sh --dry-run` before the real
run: it prints the PROJECT.md diff beside the Plan diff.

### Repeat ONE Action without the chain (single-Action path)

A single-Action run (operator or standing launch, draft pull request, merge on
green) never touches production, so it must not need the chain reset's
terminal-Off receipt. Use the library script `reset-single-action-fixture`
instead: it reopens one Action (default `write-start-marker`, or
`--action <id>`) with the fresh completion id `complete-<action>-<run-tag>` in
one non-force commit on fixture main, removes that Action's own prior artifact,
syncs the Project and positions the Action in the queue. It requires the Arcadia
checkout clean on main and level with origin, the fixture clone clean and level
with GitHub main, no live fixture Session and no pending proposal for the
Action; it reads no production state, Grant or G6/G7/G8 receipt and settles
nothing. Preview, then run (a terminal, `ARCADIA_WORKSPACE` unset):

```sh
artifacts/generated/operator-scripts/reset-single-action-fixture.sh --dry-run --run-tag <run-tag> [--action <id>]
artifacts/generated/operator-scripts/reset-single-action-fixture.sh run --run-tag <run-tag> [--action <id>]
```

Use a new `--run-tag` (lowercase `a-z0-9-`) for every repeat. Tests:
`tests/single-action-fixture-reset.test.ts` (unsandboxed).

### Phase 3: reset, G6, ping (back to back, inside the freeze)

1. Reset the fixture (this session needs the operator's yes in its own chat for
   it, section 3): `ARCADIA_REHEARSAL_GITHUB_REPO=pmark/arcadia-three-action-rehearsal-20261004
   artifacts/generated/operator-scripts/reset-rehearsal-chain-fixture-<run-id>.sh run`
   (runs 2 to 5 used `reset-three-action-rehearsal-fixture-run<N>-<date>.sh`).
   The new line starts from the previous run's reset head on GitHub `main`. If
   the previous run integrated work by local fast-forward, the reset first proves
   that exact local `main` (pinned in the parameter file and recorded by the
   previous G8) is contained in an earlier candidate's remote branch and pull
   request (every pinned candidate identical locally, on GitHub and as its PR
   head), then moves **only the clone's local `main`** back to GitHub `main`
   with a compare-and-swap ref update; otherwise it refuses and moves nothing.
   It then renders the Plan as the N-Action chain (every Action a fresh
   requirement input revision, the fresh completion id
   `complete-<action>-<run-id>` and the clean-tree rule; a passed development
   attempt for an unchanged input is never relaunched) and, from run 8, every
   statement of the chain's size and purpose in the Plan (milestone, title,
   budget, body) and in `PROJECT.md` (goal, outcome, milestone, body; its
   `active_plan`, `current_action` and `status` untouched, its `updated:` date
   the reset date), runs the fixture-coherence guard (run 8 paragraph above),
   validates it with
   Arcadia's own discovery, docs sync and ready set and a read-only live
   dry-run docs sync, **refuses** any pending fixture proposal or open Decision
   gating a chain Action (it settles none: give each its own governed
   disposition first), commits once, pushes without force and runs docs sync.
   **From run 7 it then positions the queue** (Issue #1015). Docs sync reopens
   and creates Actions without giving them a queue position, and one
   unpositioned Action makes the queue's order invalid, so `advance queue
   make-next` refuses every Project (run 6's reset left seven fixture Actions
   unpositioned until a manual arrange). The reset reads `arcadia advance queue
   --json`, refuses unless every chain Action is listed, and runs the governed
   `arcadia advance queue arrange` with every other key in its current relative
   order followed by the chain's Actions in chain order: a preview that must
   equal the planned order, then `--apply` at the same queue revision (the
   request id is fixed by run and revision, so a replay is recognised). It
   refuses unless the queue read back is `orderValid` with `unpositionedCount` 0.
   The arrange needs every approved key, so a non-chain Action still
   unpositioned receives its projected position (listed as `othersUnpositioned`
   in the receipt); no other Project's relative order changes. A rerun after a
   refusal resumes here and recognises an already-arranged queue. Expect a
   receipt with the new fixture head, the starting head, the queue receipt and
   the N Action and completion ids. The dry run reads the queue read-only and
   prints "Step 4" with the arrangement it would make.
2. Immediately run G6: `.../preflight-rehearsal-chain-<run-id>.sh run`
   (read-only). It must print `READY`. Its window is **30 minutes from its
   finish time**. From run 8 it also refuses unless the fixture head passes the
   coherence guard (check `fixture_coherence`). From run 7 it also refuses unless the Action queue is
   `orderValid` with `unpositionedCount` 0 (check `action_queue`; the receipt
   records the queue summary), and its Codex capacity check makes a fresh
   `codex app-server` `account/rateLimits/read` of its own, retried up to three
   times (20 seconds each, 2 seconds apart), and judges only that reading
   (Issue #1016). When no attempt answers, `codex_capacity` refuses naming every
   attempt's failure (a timeout or an exit status) and says no cached
   observation was used, instead of judging a stale cache (run 6's G6 refused
   twice on "past the 15-minute freshness limit" although a direct read took
   about 2 seconds). Its only write is the local coding-agent telemetry cache
   that live reading refreshes.
3. Tell the operator right away, in the chat and with `arcadia ping "<what to
   press and the UTC deadline>" --kind attention --link <url> --agent "<name>"`
   (success means queued, not delivered): the exact button
   (`grant-production-rehearsal-chain-<run-id>`, on `/runs` or `/actions`),
   **not G8**, what one press authorises (its descriptor names all N Actions),
   the deadline (G6 finish + 30 minutes) and a safer "press by" 5 minutes
   earlier. Convert the deadline to local time and check the arithmetic.

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
  `artifacts/code-review/...`). A **variance** verdict (no finding but the
  gate's refused not-applicable claims, no criterion judged `fail`; the report
  says "Refused not-applicable claim" or lists `not-checked` criteria with
  "Ordered findings: None") is rerun by the tick itself, up to 3 attempts per
  verdict kind per head: do nothing, and read the worker log lines "Automatic
  rerun of the independent ..." (it names the criteria and the reviewer summary
  sentence dismissed, and is logged only once the new attempt exists) and the `Now:` text of the
  `awaiting_independent_verdicts` entry. Only when the entry becomes
  `independent_verdict_failed` ("the automatic reruns are spent", or a real
  finding) is the verdict final. With the operator's yes for this session, one
  manual rerun per such final verdict is allowed: `arcadia qa pr <PR url> --rerun`;
  record both verdicts and do not rerun a second time (a variance verdict that
  has spent its reruns stays stopped until a pass or a new head). File every
  genuine finding as an Issue with a revival trigger.
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

Run `.../restore-terminal-off-rehearsal-chain-<run-id>.sh run` (runs 2 to 5:
`restore-terminal-off-three-action-rehearsal-run<N>-<date>.sh`) **from
the operator's Terminal panel or `/runs`**. A plain non-interactive shell
refuses with "launch this action through /runs or from an interactive host
terminal" and changes nothing. It owns only its own run's G7 policy (request id
`grant-production-rehearsal-chain-<run-id>`, the fixture Project and Plan, and
the Actions that G7's receipt recorded) and turns it Off before it checks its
launcher or reads the parameter file, so drift there cannot block the stop.
Expect `TERMINAL OFF PROVEN: Inactive at revision
<n>, zero live admissions and Sessions before and after the reviewed restart;
every fixture candidate is integrated, preserved or empty.` The chain G8 copies
every worker log (`~/Library/Logs/arcadia-services-*/worker.out.log` and
`worker.err.log`) into its run folder's `evidence/worker-logs/` before the
restart, which recreates them (run 5's log after G8 held nothing from runs 1 to
5); with an older G8, copy the log by hand first. Its receipt's `fixtureMain`
and run directory, and its `work-reconciliation.jsonl`, are the next run's
parameter-file bindings. G8 restarts host
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
| Reviewer `needs-follow-up`, criteria `not-checked`, zero findings | A trivial patch cannot exercise the criteria | Fixed (#934-#936); if it returns, run a read-only smoke against the exact patch before touching prompts. A zero-finding non-pass that still appears is **reviewer variance** (runs 1, 3, 5, 6): since Issue #1018 the tick reruns it itself, see the next two rows |
| Worker log "Automatic rerun of the independent <code-review\|qa> ... attempt 2 (or 3) of 3; the previous verdict was reviewer variance only (...)", and `awaiting_independent_verdicts` whose `Now:` says "Automatic rerun n of 3 follows" | The last verdict was a variance verdict: no finding but the gate's refused not-applicable claims, no criterion judged `fail` (live run 6: a HIGH "Refused not-applicable claim" the deterministic checker wrote, then zero findings with Compatibility `not-checked`) | Nothing. One reviewer call per tick; a pass integrates with no operator step. Each rerun is its own lineage attempt whose receipt records `variance`; the bound counts those attempts per verdict kind and exact head, so a restart cannot spend extra calls (proven offline in `tests/fast-rehearsal/serial-verdict-variance.test.ts`, not yet seen live) |
| `[independent_verdict_failed]` saying "the automatic reruns are spent" | Three attempts in a row on the same head were variance verdicts (1 attempt plus 2 reruns) | Read the last report; a pattern of variance on one patch is worth a read-only smoke against its exact patch before touching prompts. Fix the candidate (a new head restarts the count) or, with the operator's yes, one manual `--rerun`. Any other `independent_verdict_failed` (no "reruns are spent") is a real finding or a criterion judged `fail` and was never rerun automatically |
| Escalation `attempt_retry_not_authorized`, nothing launches | A passed development attempt exists for an unchanged requirement input | Reset the fixture (amend `next_action`); a new fixture is blocked by G1's fixed slug and path |
| `Active · No admitted work`, no log, `advance` says `decision` | A pending Agent Ask for the old input gates the Action (run 2) | Run-3 and later resets reject that exact proposal by state. Do **not** do it mid-run (freeze, criterion 2); in run 2 it was done to unblock a run that had already stalled, which is why it appears here. Since #997 `production status` shows such a gate as one `operator_gate_pending` entry (proposal or Decision id, and the exact settle command or the reason it cannot settle), logged once and cleared when the gate is gone (tested, not yet seen live) |
| `production status` shows `operator_gate_pending` | A pending Agent Ask proposal or open Decision names an in-scope Action, so the tick launches nothing for it | Read the entry's remedy: settle or answer it with the command it names, or reject a stale proposal with the `--disposition rejected` command it names (preview, then `--apply --preview`); when it says the candidate already records the Action done, follow its longer route instead of rejecting alone. The tick never settles it itself |
| `terminal_candidate_not_integrable` naming commits after the completion settlement commit | The agent settled, then left an extra file or commit (#994); no continuation is launched for it any more, and the extra work is never integrated | Inspect the extra work; after an independent review an operator may land the settlement commit itself with the remedy's `merge --ff-only <settlement commit>` (the extra commit stays preserved on its branch) |
| Agent died between its settlement commit and the recorded settlement (#995) | `beforeOperationalProjection` window | Recovered by the exit tick: it derives the settlement again at the Candidate revision and records it only when the candidate's HEAD is exactly that settlement (evidence verbatim-covering every criterion), then integrates as usual (tested, not yet seen live). If the Session was reconciled by hand first, it shows as `operator_gate_pending` naming that settlement commit: do not reject the proposal alone; after an independent review land exactly that commit, retire the candidate worktree and then reject the moot proposal, as the remedy says |
| QA FAIL "Operator QA plan" missing | Host PR body had no QA plan | Fixed (#969) |
| QA FAIL "Tests and evidence", no validation output | PR body gave an exit code without a command or output | Fixed (#974) |
| QA FAIL HIGH "Approval boundaries" on the candidate's own settle commit | Reviewer nondeterminism about the governed completion settlement | The body now states it (#974); one rerun allowed; record both verdicts |
| Worker log repeats "differs from its exact canonical completion settlement" every 3 s | An unarchived Ask draft was committed by preservation on top of the settle commit | Fixed (#983: settle archives the draft, proven live in run 5; one deduped log line and a `terminal_candidate_not_integrable` escalation, tested but not yet seen live); the brief asks for a clean tree |
| QA FAIL Step 4 says source inspection proves a check passes | Plan wording (Issue #986) | Fixed by the Issue #986 PR. A criterion where a declared command, a script path, a test file or a several-word code span must pass (no negation governing the pass word) now renders an inspection step limited to what inspection shows. It names the declared-validation step's exit-zero result as the proof for each declared command the criterion says must pass (a bare script path counts as the declared command that runs exactly it), names that step as the run for a test file that must pass, and says the plan offers no direct proof for any other command it names. A read-only smoke of run 5's PR #5 with the new plan passed twice with no findings (evidence in that PR). Known gap: a criterion naming no command ("All tests pass") or a one-word code span (`` `make` passes ``) keeps the old wording, and a veto word anywhere in the clause ("fails", "unless", "non-zero") or conditional or past-tense phrasing ("if `x` passes", "`x` passed in CI") can classify a criterion the wrong way. If it returns, rerun that smoke (real reviewer, `gh` stubbed, temporary workspace) before touching prompts |
| QA FAIL "wrong base and changed-file set" on Action 2 | The PR was opened on GitHub's `main`, which local integration never advances (Issue #987) | Fixed: serial PRs are stacked on the previous candidate's branch (section 8, item 1(b)); the receipt's `prBase` says which base was chosen and why. If the previous branch is gone from the remote, preservation refuses with a `terminal_candidate_not_integrable` escalation naming the branch to push again; nothing is pushed until then |
| `[terminal_candidate_not_integrable]` "The integration grant expired at ..." on a preserved, unreviewed draft PR | A serial chain outran its 12-hour Grant while that Action's agent was working | Nothing more integrates or launches under this Grant. A fresh, unexpired Grant naming the Action (a new activation): the next ticks ready, review and integrate it and the escalation clears (proven offline in `long-chain-grant-expiry.test.ts`, not yet live); or land it by hand after an independent review. Before the fix found by the long-chain harness this showed nothing at all in `production status` |
| `[build_packet_approval_pending]` whose remedy starts "Blocked: the standing policy's packet_approval delegation expired" | The chain reached its next Action after the Grant lapsed | A fresh activation. Approving the packet by hand admits an Action that cannot integrate unattended while the integration grant is lapsed too (the same gap as Issue #1012: admission does not consult the expiry) |
| Agent writes the template completion id and settlement stalls | `complete-<action>-<date>` already settled on a same-day rerun | The amended `next_action` names a fresh id; the reset refuses if it is used |
| G7 refuses "different main" | A governed settle commit or reinstall moved main or the broker after G6, or a G8 ran | Freeze (phase 2); rerun G6 |
| G6 invalid after an accidental G8 | G8 reinstalled the broker | Rerun G6; keep the buttons separate in the ping |
| G6 `action_queue` refused, or `advance queue make-next` says "position every approved Action" | An Action became unpositioned (docs sync reopens or creates Actions without a position; Issue #1015) | The run-7 reset arranges the fixture's Actions; for another Action, a governed `arcadia advance queue arrange` at the current revision keeping every other key's relative order (preview, then `--apply`), then rerun G6 |
| G6 `codex_capacity` refused with "failed on every attempt" naming a timeout or an exit status (Issue #1016) | The host's `codex app-server` did not answer `account/rateLimits/read` in three 20-second attempts | Read the named failure (a timeout under host load, or the exit status of a missing or broken `codex`), fix that, rerun G6; it never judges a cached reading |
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
   settled). **(a) is addressed, not yet run:** the chain reset
   `reset-rehearsal-chain-fixture-run6-2026-10-06` takes the second route. Its
   descriptor says the new line starts from `7214de28`; it verifies `f68ec48` is
   PR #5's tip (and contained in PR #6, Action 2's work, both pinned and checked
   locally, on GitHub and as PR heads), moves only the clone's local `main` back
   by compare-and-swap, amends all three Actions' `next_action` with fresh inputs
   and `complete-<action>-run6-2026-10-06` ids, appends `chain-step-04` to
   `chain-step-09` (run 6 is the nine-Action chain), and pushes one commit on
   `7214de28` without force. Its `--dry-run` shows exactly that against the real
   fixture before anything is written. (b) **#987, serial Actions: decided and implemented: stacked PRs.**
   After Action 1 integrates locally, GitHub's `main` lags by design (no base
   push), so host preservation now opens Action 2's draft PR with its base set
   to the remote candidate branch whose tip is Action 2's launch base (Action
   1's branch), chosen by `selectPullRequestBase`
   (`src/sessions/candidatePreservation.ts`) and recorded on the receipt as
   `prBase`. The PR's GitHub diff, the reviewers' evidence and the host QA plan
   (its Base line names that branch) then describe exactly Action 2's change.
   The first Action, and any candidate launched from the published base, open
   on `main` exactly as before. No base push, merge or force push; the Grant
   and Decision 0058 are unchanged. A deleted or never-pushed previous branch
   refuses the PR (nothing pushed, the candidate kept locally) with one
   `terminal_candidate_not_integrable` escalation naming the branch to push
   again; so does any candidate whose launch base carries local commits that no
   remote branch has (for example an unpushed operator commit on `main`), which
   before opened on `main` with those commits in its diff. An open PR for the
   branch already on a no-longer-valid base is refused the same way (retarget
   it); a closed or merged one is ignored and a new PR opens. A stacked PR
   later retargeted on GitHub, or whose stacked base branch moved, gets no
   verdict until its base is restored; that
   includes GitHub's own retarget to `main` after the previous PR is merged
   there and its branch auto-deleted (restore the branch and retarget back, or
   land by hand), deliberately conservative because the published plan names
   the stacked branch. Do not merge a stacked PR on GitHub: it would land in
   the previous candidate's branch; Arcadia integrates locally. An adopter
   Project whose CI runs only for PRs into `main` reports no checks on a stacked
   PR (a visible `required_checks_timeout`). Proven offline by the fast harness (`tests/fast-rehearsal/`: the
   serial pair, a three-Action chain stacked PR 1 on `main`, PR 2 on candidate
   1, PR 3 on candidate 2, and the deleted, closed, merged, retargeted and
   published-base edge cases) and by the flipped marker in
   [docs/qa-plan-consistency-replay.md](qa-plan-consistency-replay.md). Still to
   prove in a live run: real `gh pr create --base <candidate branch>` and the
   QA reviewer's judgment of a stacked PR.
2. **#986** (plan Step 4 wording), **#984** (review follow-ups of #983),
   **#976** (hook-manager side effect of the plan's checkout step and test gaps):
   small, but each can fail a verdict. (Issues #972 and #981 were fixed by #974 and
   #983 and are closed.)
3. **First-attempt verdict pass (criterion 4):** no run has had both verdicts
   pass on the first attempt. Reviewer variance on the plan wording is the known
   cause; keep wording factual and bounded, and measure the pass rate over runs.
4. **The cost of a run:** each rehearsal cost about an hour to build its script
   pairs by cloning the previous run's. **Addressed by the chain set**
   (section 5, "Start a run from the chain set"): one shared reset, G6, G7 and
   G8 implementation, and per run one reviewed parameter file (run id, N, the
   previous run's receipts and heads, required commits) from which the run's
   launchers and descriptors are rendered and checked. Run 6 (N=9, nine
   Actions under one press) ran; run 7 (N=9 repeat, bindings filled from run
   6's receipts, queue positioning in the reset and a queue and live-capacity
   check in G6, Issues #1015 and #1016) ran and stopped at Action 1's QA on a
   fixture that contradicted itself about its size; run 8 (bindings from run 7's
   receipts, rendered N-Action Project and Plan wording, the coherence guard in
   the reset and G6) is prepared; not yet proven live.
5. **Visibility:** `production status` now names a terminal integration refusal
   (#983) and an operator gate holding a launch (#997; both tested, not yet seen live);
   a stuck candidate in other states and the dashboard rendering of escalations are
   still generic.
6. **Stalls reproduced offline, fixed there, not yet seen live** (the fast
   harness, `tests/fast-rehearsal/README.md`): an agent that leaves an extra
   file or commit after settling (Issue #994) is no longer resumed by a
   continuation that can only refuse "Action is already done"; it stops on one
   `terminal_candidate_not_integrable` entry and the extra work is never
   integrated. An agent that dies after its settlement commit and before the
   settlement is recorded (#995) is recovered by the exit tick, which derives
   the settlement again, records it only when the candidate's HEAD is exactly
   that settlement, and integrates. A pending Agent Ask
   proposal or open Decision that gates an in-scope Action (#997, the mechanism
   of run 2's stall, #968) now shows in `production status` as one
   `operator_gate_pending` entry with its settle command or the reason it
   cannot settle. The harness also proves #987's fix (stacked PRs). Next step:
   watch for these in the next live run.
7. **A nine-Action chain inside one Grant (the overnight one-press run).**
   Proven offline by `tests/fast-rehearsal/long-chain*.test.ts`: nine
   dependent Actions in three batches over 5.4 simulated hours integrate in
   order, each PR stacked on the previous candidate's branch with a consistent
   QA plan, nothing lost, the remote base never pushed, `production status`
   naming the Action building or in review and each base advance. A failed QA
   verdict on Action 5 stops the chain on one visible
   `independent_verdict_failed` entry and admits nothing later. The Grant
   expiring midway was a silent stall (an Action finishing after the expiry
   showed nothing in `production status`), fixed in the same change; its
   escalation and the lapsed packet delegation's remedy now name the expiry.
   Still open: an Action whose packet the delegation approved just before the
   expiry is launched just after it (Issue #1012, an expected failure in the
   harness; revive it before a live chain planned to end within minutes of
   its Grant's expiry), so plan the chain to finish well inside the window, and treat the
   last Action straddling the expiry as the likely stop. Not exercised offline:
   ticks while an agent pane is live (stall detection over a long agent run),
   the real `gh pr create --base` on a deep stack, and reviewer variance over
   nine Actions (criterion 4 compounds: the tick now absorbs up to two reruns
   per verdict kind per head, Issue #1018, so a run stops only on a real
   finding or three variance verdicts in a row; none of this has run live yet).
8. **After criteria 1 to 6 hold in one run and repeat cleanly (criterion 7):**
   escalate exactly one dimension, in the order of section 1, with a fresh Grant.

## 9. Findings ledger and per-run protocol

Every live run and every reviewer pre-flight smoke appends one row here **before its session ends**, pass or fail. The row is the handoff: the next agent starts from this table, section 10 and `docs/notes-to-self.md`, not from chat history. A failure class that has appeared twice must have a deterministic guard (a test, a refusal or a check in G6) before the next live run; the "Prevention" column names it.

| Run or check | Stopped at | Failure class | Detect after G7 | Fix | Prevention now in place |
| --- | --- | --- | --- | --- | --- |
| 1 | A1 code review | reviewer variance (criteria not exercisable) | minutes | #934-#936 | not-applicable classifier |
| 2 | A1 (33 min silent), then QA | stale pending Ask gate; missing QA plan | 33 min | #968, #969 | reset handles proposals by state; host QA plan; #1010 surfaces gates |
| 3 | A1 QA | reviewer variance; missing validation evidence | minutes | #974 | validation evidence in PR body |
| 4 | A1 integration (3 h silent loop) | unarchived Ask committed by preservation | about 3 h | #983 | settle archives the draft; one escalation |
| 5 | A2 QA | stale GitHub base after local integration (#987); plan wording (#986) | minutes | #1006, #1008 | stacked PRs; bounded check wording |
| 6 | A2 code review | reviewer variance (zero findings) | about 2 min after A2 readied | #1019 | automatic bounded rerun of zero-finding verdicts (3 attempts; Correctness, Security, Approval boundaries never variance) |
| 6 (setup) | G7 press 1 | script compared Grant Action lists order-sensitively | 73 s | #1017 | set comparison; e2e test uses the live order |
| 6 (setup) | queue | reset left reopened and new Actions unpositioned | before press | #1020 (#1015) | reset arranges the queue; G6 `action_queue` |
| 6 (setup) | G6 | stale Codex capacity cache | before press | #1020 (#1016) | live capacity read with named failures |
| 7 | A1 QA | fixture documents contradicted the chain size (real finding) | 4 min | #1023 | reset renders N-Action wording; `fixture_coherence` guard in reset and G6 |
| run-8 reviewer smoke (2 QA calls, read-only) | A1 QA, 1 of 2 | real MEDIUM "Managed documents": a done Action keeps its original `next_action`, which the reviewer reads as stale guidance | n/a (offline) | settlement rewrites a completed Action's `next_action` to `Completed via Agent Ask <request_id>; no further action.` (complete and split; supersedes #1033, branch `worktree-done-settlement-unambiguous-20261010`) | `tests/agent-ask-complete.test.ts`, `tests/agent-ask-split.test.ts` (literal request id, block scalars, legacy Actions with no `next_action`) |
| 8 (standing launch, single Action; 2026-10-09) | A1 independent review of fixture PR #10 | product: the host committed a legacy hand-written `.arcadia/asks/complete-write-start-marker-run8-2026-10-06.json` into a preserved candidate and auto-settle and draft-PR publish accepted it (Issue #1177) | 61 s to draft PR, then review | #1163 stops new sessions writing such files; #1177 open for legacy candidates | workaround: reset for a fresh run (`reset-single-action-fixture`, #1179, #1185) instead of continuing a pre-#1163 candidate |
| fixture chain under Decision 0097 (merge-then-next) and 0100 (standing launch) | none: all nine Actions merged (fixture PRs #11 to #19, Plan complete) | n/a | n/a | Claude Haiku and Codex went launch to draft PR in about 80 s; #13 and #14 needed build-packet approvals (since covered by Decision 0119); #15 to #19 needed no operator step | reported by the Single-Action session on 2026-10-10 and confirmed against the fixture PR list; the chain is a loop of single runs, not one G7 press |

**Protocol for every run (append-only):**
1. Before G7: run the reviewer pre-flight smoke (`docs/reports/rehearsal-reviewer-smoke/`) on the rendered Action 1 shape; record its verdicts as a row. Do not ask for the press unless it passed every attempt.
2. After G8: add the run's row (stop point, class, detect time, fix, prevention), the receipts and PRs in section 2, and any new symptom in section 6. File one Issue per defect with a revival trigger.
3. Classify each stop: **setup** (our scripts, fixture or queue), **product** (Arcadia lifecycle), **reviewer variance** (zero-finding verdict) or **real finding** (reviewer correctly found a defect in the candidate or its documents). Setup and real-finding classes need a deterministic guard before the next live run.
4. Update section 10 so it is true for the next agent.

## 10. Handoff: current state and next-run recommendations

**State at 2026-10-10 ~20:30Z** (verify before trusting; the earlier 2026-10-06 handoff is superseded):

- **Direction changed.** Decision 0097 (answered 2026-10-09) chose merge-then-next: each Action's draft PR merges to main under Decisions 0060/0080 before the next launches, so a chain is a loop of reliable single runs and the stacked-base failure class is gone. Decision 0100 (until 2026-10-18) lets an agent mint the one-shot launch for fixture Actions and merge the fixture's own PR on green; Decision 0119 covers fixture build-packet approval. The G7-press chain this runbook describes (sections 4 to 6) is the superseded design. The V1 bar "one G7 press chains two or more Actions with no step between" would need the automated review-and-merge capability 0097 names as its own Plan; it is **not** met and is not being pursued.
- **The fixture is done for now.** All nine Actions merged as fixture PRs #11 to #19 and its Plan is complete. PRs #1 to #10 are open, stale and preserved as evidence (#9 and #10 are the run-8 candidates). Repeat one Action with `reset-single-action-fixture` (section 5, "Repeat ONE Action without the chain"), never the chain reset: run 8's chain reset was consumed, no run-8 terminal Off receipt exists, and the run-9 chain parameter file (draft PR #1178, `terminalOffRunId: UNFILLED`) is parked and should stay so.
- **Production is Off** (`arcadia production status`: Inactive, desired revision 43). The installed broker was at `b2211a1a` while main was well past it; **reinstall before any live run that relies on a later runtime change**, and respect the freeze window.
- **Settlement is unambiguous** (recommendation 1, below): a completed Action's `next_action` reads `Completed via Agent Ask <request_id>; no further action.`

**Why runs failed (unchanged lesson).** Every stop since run 5 was our own setup, now guarded, or an LLM reviewer judging the wording of governed records. Raise the per-verdict pass rate deterministically before any step that multiplies verdicts.

**Recommendations, ranked:**
1. **Done in this change: remove the "done Action keeps its next_action" finding at the source.** Settlement rewrites it. Remaining proof: a dry reviewer smoke on a fresh rendered Action 1 shape (recommendation 2).
2. **Make the reviewer pre-flight smoke a maintained script** (still open): three read-only QA and three code-review calls on a rendered single-Action shape, all PASS, before any step that spends operator attention; `SMOKE_DRY=1` first, and the spend is the operator's. `docs/reports/rehearsal-reviewer-smoke/run8/` is reference code that needs a reset `--dry-run` evidence directory that no longer exists; render the Action 1 shape from the parameter file or from the fixture's current tree instead.
3. **Superseded: "run 8 with N=3".** There is no chain G7 to press. If a chain is wanted again, 0097's merge-then-next Plan comes first.
4. **Largely met: a freshly generated, N-neutral fixture.** The standing-launch fixture ran nine Actions; a new GitHub repository is still the operator's call.
5. **Keep the evidence loop cheap:** Sonnet subagents, one independent review round unless it finds a blocker, `pnpm fast-rehearsal` after any change to the tick, preservation, review steps or settlement, and the no-progress watchdog (Appendix A) during any live run.

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
