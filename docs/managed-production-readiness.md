# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document and asserts nothing on its own. Every line reads
from `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, `MISSION_LOG.md`, the live worker log, the workspace
database, the live `arcadia advance queue` and `arcadia production status`
output, and the hermetic rehearsal replay (`tests/rehearsal-two-action.test.ts`).
When those disagree with this file, they are right and this file is stale.
"Refreshing this document" at the bottom says how to re-derive it.

Last derived: **2026-09-27T05:10Z**, against `origin/main` `f670910d` plus the
fixes in the pull request that carries this revision. Arcadia's own target is
`NORTH_STAR.md` at the repository root, and its gates are the critical path
below.

---

## What this derivation found

**Every live rehearsal attempt so far stopped on a defect nobody had seen,
because no test ever ran the pipeline the way the rehearsal does.** Each stage
had unit tests, but the tests that crossed stages fed them state no real
Session produces. The clearest example: every test of "a finished Session
completes and integrates" inserted a passing `execution_runs` row by hand. A
Session launched by the worker never writes one.

This derivation adds a **hermetic replay of the operator's rehearsal**
(`tests/rehearsal-two-action.test.ts`, harness in
`tests/helpers/rehearsalHarness.ts`). It builds the fixture exactly as
`prepare-two-action-rehearsal-2026-09-26.sh` does, through the same command
functions the operator's `pnpm arcadia …` lines call: `project import`,
`project metadata`, `docs sync --apply`, `work plan --agent-profile`,
`review approve --no-execute`, `production preview`/`activate`/`deactivate`.
Then it drives the real `runManagedProductionTick` with the workspace's own
registries, exactly as `arcadia worker` does, including the worker's pre-tick
preservation-request pass.

Only three things are simulated:

- tmux (a launch is recorded, and "exit" is the pane dying);
- the coding agent's keystrokes;
- provider capacity and sign-in.

Preservation validation runs the real Seatbelt validator on the host
(`ARCADIA_PRESERVATION_HOST_TEST=1`); on CI it runs the same declared commands
under the same bindings without Seatbelt. Reconciliation,
integration and settlement run real Git and write real managed documents.

It found four rehearsal-stopping defects. Two are fixed in this pull request,
one is a fixture decision, and one needs the operator:

| # | Defect | Where the live run stops | Status |
| --- | --- | --- | --- |
| 1 (#724) | **A Session that finishes by the brief's own completion protocol is never recognized as complete.** It settles `complete` inside its candidate, as `renderActionBrief` tells it to. Reconciliation read "done" only from the base checkout, and automatic completion needs a Run that guarded Sessions never write. So the exit was classified `incomplete_resumable`, integration waited forever, and the worker relaunched the finished Action every tick. | Step 5: A finishes, B never launches, A relaunches repeatedly | **Fixed here.** `findCandidateSettledCompletion` (`src/sessions/reconciliation.ts`) accepts a completion only when all of these hold: the candidate is clean; its Plan says done; an accepted, applied `complete` settlement for exactly this Action exists; and that settlement's `candidate_revision` is in the candidate's history. A hand-edited `status: done` or a rewritten candidate is refused (unit tests + replay). |
| 2 (#725) | **A Session that dies before changing anything keeps its Action claim.** Reconciliation recorded `missing_evidence` but left the claim live, so every relaunch was refused as "already claimed by a live worktree" and two refusals exhausted the repair budget. This is the #695 class, for the non-resumable case. | Step 3, whenever the agent crashes at start-up (auth, provider outage — both happened on 2026-09-26) | **Fixed here.** Reconciliation releases the claim for `missing_evidence`/`failed_execution` exits with no candidate changes. The worktree reservation row is kept, so `tidy` still protects the worktree. |
| 3 (#726) | **Every fixture declared a validation command that can never pass for A.** v2, v3 and v4 declare `node --test tests/marker.test.mjs`. At A's candidate that file does not exist yet, so host preservation validation fails and A is never integrated (#717 saw this live). At B's candidate, check-binding refuses it anyway, because B creates the file its own check runs. The command is frozen into each fixture's approved build packet, so none of them can be repaired in place. | Step 5: A preserved-refused, never integrated | **Fixture decision.** The replay's fixture commits a self-contained `scripts/check-marker.mjs` at genesis and declares `node scripts/check-marker.mjs`. The prepare script needs the same change and a fresh `-v5` fixture (see the picker in this PR's handoff). |
| 4 (#727) | **A standing-policy Claude Session is launched as the interactive TUI.** `claude --help` documents that the workspace trust dialog is skipped only in non-interactive mode (`-p`). An interactive Session in a fresh `~/.claude/worktrees/…` candidate stops at that dialog (#698). It would then prompt for each edit (the operator's settings set no `acceptEdits`), and it never exits after its turn, so the tick never reconciles it. **No `claude-code-cli` Session has ever been launched by the worker**: the workspace database holds exactly one worker-launched Session, and it was opencode. | Step 3: A launches and hangs | **Needs the operator.** Recorded as an expected failure in the replay, which flips once fixed. The fix changes the permission posture of unattended agents, which is the operator's call, not an agent's. Meanwhile the replay proves the whole two-Action path works on `opencode-cli`, whose adapter already launches headless `opencode run`. |

**What the replay proves now** (14 scenarios, all green, plus the one expected
failure above), mapped to the proof Action's acceptance criteria:

- **Preparation and activation (criterion 1):** import, sync and seed name A
  as dispatchable with one open packet approval. One activation grants both
  Actions, the Decision 0058 integration grant and `packet_approval`. A
  replayed request id is a no-op with a warning.
- **Two dependent Actions from one activation (criteria 2 and 3):**
  - A1 launches on the first tick.
  - A concurrent second execution is refused.
  - A1 is killed mid-edit and reconciled `incomplete_resumable` with its work
    preserved.
  - The worker resumes A2 in the same worktree and branch, and A2 sees A1's
    edit.
  - A2 settles. A is integrated onto the fixture's `main` and the pointer moves.
  - B's packet is prepared and approved under the standing grant.
  - B launches on a fresh candidate from the new base, with no operator step.
  - B completes, and nothing further launches.
  - The brief's full protocol (validate, preserve through the host, settle,
    exit) integrates too.
- **Turn Off mid-work (criterion 4):**
  - Off never kills the live Session and never launches again.
  - The Session's exit is reconciled visibly.
  - Integration is refused while Off.
  - Ticks after a restart launch and reactivate nothing.
  - The Session's finished output is still on its branch.
- **Guards:** a hand-edited `done` is never accepted. A committed but unsettled
  exit resumes, then integrates once settled. A Session that dies with no
  changes relaunches on a fresh candidate. An `origin` the tick fetches from
  never rewinds an integrated, unpushed `main`.
- **Fixture decisions:** without the integration grant, B never launches.
  Without `packet_approval`, B waits on a named approval in `production status`
  and launches the tick after the operator approves it. The v2–v4 validation
  command stops A.

What the replay cannot prove: that a real provider process runs to completion
unattended (defect 4 is exactly that class), real provider capacity, and the
real `arcadia worker` process lifecycle across a restart. Those stay the
operator's live rehearsal. Everything upstream and downstream of the provider
process is now proven.

---

## Executive summary

**Lane A (unattended): no code Actions left in the Plan. Once this PR merges,
one operator decision (defect 4, or choosing opencode) and one fresh fixture
stand between here and the proof run.** Decision 0072 is approved and its
`packet_approval` delegation is merged (#714), so criterion 2 ("B launches
without … launch confirmation in between") is now reachable. The replay shows
it on current code with this PR's two fixes.

**Lane B (concurrent):** unchanged from the prior derivation. The concurrency
gate (`enforce-concurrency-gate-at-admission`) and cross-Plan dependency
resolution have landed. Six Lane B Actions are ready now and need no proof
(`fix-action-intent-target-ref-amendments`, the queue's selected Action;
`release-admission-on-every-launch-failure`, `add-fixture-coding-agent-provider`,
`load-test-workspace-db-contention`, `keep-action-claim-while-candidate-unmerged`,
`limit-sessions-per-provider-account`). Ready-set admission itself waits on
Lane A's proof. §5 "Build map" of
`docs/proposals/portfolio-parallel-execution.md` is still the plan.

---

## Before the next live rehearsal

The standing policy is **Active right now** (revision 20, epoch 15), scoped to
`two-action-rehearsal-v3`. It waits only on v3 A's packet approval
(`review_8029859d4b744913ad`). **Do not approve it.** v3 carries defect 3, and
on `main` without this PR it would also hit defects 1 and 2.

In order:

1. Merge this PR (defects 1 and 2).
2. Resolve defect 4: either authorize the headless Claude launch, or run the
   rehearsal on `opencode-cli`, which the replay proves end to end.
3. Deactivate the v3 grant.
4. Prepare a fresh `-v5` fixture whose validation command is the committed
   `scripts/check-marker.mjs` (defect 3), with `PROVIDER`/`AGENT_PROFILE`
   matching step 2.
5. Follow the generated `next-steps.md`. With `packet_approval` in the
   transitions, A's packet approval is the only operator intervention.

---

## The gates

| Gate | State |
| --- | --- |
| 1 — The board is the surface | ✅ closed 2026-09-20 |
| 2 — Work reaches an agent with no operator | 🟡 Launch is proven hermetically. The Claude launch cannot run unattended (defect 4); opencode can. |
| 3 — A finished Session lands with no operator | 🟡 Proven hermetically with this PR (defect 1 was the gap). Provisional until the proof run. |
| 4 — It keeps going without help | 🟡 Proven hermetically with this PR (defect 2 was the gap), including B's packet approval under Decision 0072. Provisional until the proof run. |
| 5 — Proof | ⬜ `prove-two-action-unattended-production` is deferred. Every code prerequisite is in the Plan or this PR; see "Before the next live rehearsal". |
| 6 — The operator surface | ⬜ Off the critical path, held behind the proof. |
| **B — Cross-repository concurrency** (Decision 0071) | ⬜ The gate is enforced at admission. Ready-set admission waits on gate 5 and `prove-concurrent-ready-set-admission`. |
| **B′ — Same-repository pipelining** (Decisions 0071 + 0070) | ⬜ Gated by B and gate 5. |

A gate is closed when the live system does what the gate says, not when its
Actions are marked done, and not when a hermetic replay passes. Gates 3 and 4
were once marked closed on status alone, and the first real runs reopened them.

---

## The critical path, in order

1. **This PR** — defects 1 and 2, the hermetic replay, this derivation.
2. **Operator:** resolve defect 4 (authorize headless Claude, or choose opencode).
3. **Operator:** deactivate the v3 grant, prepare `-v5`, reverse Decision
   0057's deferral, and run `prove-two-action-unattended-production` per its
   runbook. **This is where the unattended claim is earned.**
4. `prove-multi-provider-production-recovery`, then `run-managed-production-live-soak`.

Lane B continues in parallel on its six ready Actions (see the executive
summary). Each is an ordinary `claude-sonnet-5` session at medium effort.

### Rehearsal hazards still open

- **#608:** while the standing policy is Off, the worker fast-forwards every
  DB-active Project's checkout to `origin/main`. The replay proves this never
  rewinds an integrated, unpushed `main`, but a manual `git reset --hard` on a
  fixture is still silently undone.
- **#609:** `production activate --expect-revision` does not match the preview's
  `expectedRevision` field name. The generated `next-steps.md` already passes it
  correctly.
- **#717:** the preserve broker strips validation failure details to `{}`, so an
  agent cannot diagnose its own refusal. Defect 3's fix removes the known
  trigger. The host-side `validation.json` under `artifacts/preservation/` still
  names the cause.
- **Stale admissions listing.** `production status` still lists
  `zero-prompt-rehearsal` admissions as `committed` and v2 admissions as
  `fenced`. They do not count toward concurrency (#610); only the listing lags.
- **Capacity gating is off** (`codingAgent.capacityGateEnabled: false`), so
  "admitted" is an operator choice, not observed headroom.
- **GitHub board reconciliation fails every tick.** The worker log shows
  `your authentication token is missing required scopes [read:project]`. It
  does not block a fixture rehearsal. Gate 1 needs `gh auth refresh -s read:project`.

---

## Component proof map

Each production stage, the tests that prove it alone, and the replay scenarios
that prove it in combination with its neighbours. A stage with no
combination proof is where the next surprise lives.

| Stage | Code | Proven alone by | Proven in combination by (`rehearsal-two-action.test.ts`) |
| --- | --- | --- | --- |
| Fixture import, metadata, docs sync | `commands/project.ts`, `commands/docs.ts` | `cli-response-contracts`, `docs-sync` | Steps 1-2 |
| Build-packet seeding | `runWorkPlanCommand` | `execution-runner-build-failure`, `policy-permitted-packet-preparation` | Steps 1-2 |
| Activation, replay, scope | `production/policy.ts`, `commands/production.ts` | `managed-production-policy`, `production-fault-matrix` | Steps 1-2 (replay no-op) |
| Scheduling pass, dispatch | `scheduling/`, `docs/dispatch.ts` | `worker-tick`, `advance-queue` | every scenario |
| Admission and concurrency gate | `issueAdmission` | `production-fault-matrix`, `dispatch-admission` | Steps 3-5 (concurrent refusal) |
| Automatic packet preparation | `attemptAutomaticPlanningResolution` | `production-tick` | Steps 3-5 (B's packet) |
| Delegated packet approval | `attemptDelegatedPacketApproval` | `production-tick` (Decision 0072 cases) | Steps 3-5; the "without `packet_approval`" scenario |
| Guarded launch, worktree, claim, brief | `sessions/launch.ts`, `sessions/index.ts`, `actionBrief.ts` | `session-launch`, `launch-preview`, `action-brief` | Steps 3-5; the brief-protocol scenario; the provider scenarios |
| Provider launch command | `buildProviderLaunch` | `session-launch` | the provider scenarios (opencode proven; Claude expected-fail, defect 4) |
| Stall detection | `production/stallDetection.ts` | `production-tick` (stall cases) | not combined (needs real pane output) |
| Agent-initiated preservation | `runPreserveCommand`, preservation transport | `manual-preservation`, `preservation-heartbeat-freshness` | the brief-protocol scenario |
| Host preservation and validation | `preserveSessionCandidate`, Seatbelt validator | `preserve-on-exit-and-integrate` | every completion scenario; the v2-v4 validation command scenario |
| Reconciliation | `sessions/reconciliation.ts` | `session-reconciliation` (5 new cases here) | every exit scenario; the guards |
| Claim release and resumption | `reconcileSessionExit`, `prepareSession` | `session-reconciliation` | the split-session scenario; the dies-before-changes scenario |
| Completion settlement | `ask/settlement.ts` | `agent-ask-settlement`, `agent-ask-complete` | every completion scenario |
| Candidate integration (Decision 0058) | `integrateSessionCandidate` | `preserve-on-exit-and-integrate` | every completion scenario; the "without grant" scenario |
| Base-branch observation | `detectBaseBranchAdvance` | `production-tick` | the `origin` scenario |
| Turn Off, restart | `deactivateProduction`, tick | `managed-production-policy`, `production-fault-matrix` | Step 6 |
| Auto-settle before dispatch | `attemptAutoSettlePendingCompletion` | `auto-settle-before-dispatch`, `production-tick` | not combined (a Session-less path) |

---

## Concurrency

Unchanged in substance since the prior derivation:

- **Cross-repository concurrency (Decision 0071, supersedes 0023)** follows §5
  "Build map" of `docs/proposals/portfolio-parallel-execution.md`.
  `enforce-concurrency-gate-at-admission` has landed. It caps concurrency at 1
  on every admission until both `prove-two-action-unattended-production` and
  `prove-concurrent-ready-set-admission` are done, and `production status`
  reports it ("Concurrency gate: closed — effective cap 1").
  `admit-ready-set-across-repositories` depends on the proof and on Decision
  0070's host settler.
- **Same-repository concurrency (Decision 0066)** still waits until
  `prove-two-action-unattended-production` and the #505/#507/#549-class fixes
  have landed.

---

## Live state at derivation

| Signal | Reading (2026-09-27 ~05:05Z) |
| --- | --- |
| Managed production | **Active · No admitted work.** Revision 20, epoch 15, granted 2026-09-26T19:46Z. Scope: `two-action-rehearsal-v3`, provider `claude-code-cli`, concurrency 1, transitions acceptance, pointer and validation (no `packet_approval`). Integration grant: Decision 0058, expires 2026-09-27T07:44Z. |
| Waiting on the operator | `two-action-rehearsal-v3/write-marker-a` `build_packet_approval_pending` (`review_8029859d4b744913ad`), and the unrelated `private-practice-now/calibrate-river-specialty-prompt-chain` `planning_required`. |
| Worker | Running (PID 3222). No `Launched Session` line since 2026-09-26T05:34Z. Board reconciliation fails every tick on a missing `read:project` scope. |
| Worker-launched Sessions, ever | **One:** `session_f3fce839e9a74ef1bc`, v2 `write-marker-a`, opencode, reconciled `incomplete_resumable` 54 seconds after launch. No Claude Session has ever been launched by the worker. |
| Rehearsal fixtures | v2, v3 and v4 all declare `node --test tests/marker.test.mjs` (defect 3). v4 was prepared 2026-09-26T21:20Z; its A approval `review_686ba07c6f5c49479c` is open. |
| Pointer (`PROJECT.md` at `f670910d`) | `bootstrap-managed-production-to-build-flight-deck` / `rewire-dependents-on-split`. The live queue's selected Action is `fix-action-intent-target-ref-amendments`. |
| Open Decisions | 0041, 0052. Neither concerns production readiness. Decision 0072 is approved ("Delegate packet approval inside the grant scope"). |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 124 (each `- id:` paired with the `status:` line that follows it) |
| Done | 89 |
| Open | 34 |
| Deferred | 1 (`prove-two-action-unattended-production`) |
| **Rehearsal-stopping defects found by the replay** | **4.** Two fixed here; one is a fixture change; one needs the operator. |
| **On the critical path, code, Lane A** | **0** in the Plan, plus this PR |
| **On the critical path, operator** | **2** (resolve defect 4; deactivate v3, prepare v5 and start the rehearsal) |
| **On the critical path, proof, Lane A** | **1** (`prove-two-action-unattended-production`) |
| **Ready now, Lane B** | **6** |

---

## Refreshing this document

Run these, then update the findings, gates, critical path and scoreboard:

```bash
grep -E "^(active_plan|current_action):" PROJECT.md   # is the bootstrap Plan still active?
mise exec -- pnpm arcadia advance queue --json         # ready set: only critical-path Actions?
mise exec -- pnpm arcadia production status
grep -l "^status: open" docs/decisions/*.md
tail -80 MISSION_LOG.md
grep -E "Launched Session|Reconciled Session|Recovered hung worker|Escalated" <workspace>/.arcadia/worker.log | tail -30
gh issue list --label bug --state open
# The hermetic rehearsal replay, with real Seatbelt preservation validation.
# sandbox-exec will not nest inside another Seatbelt sandbox, so run it from a
# plain terminal (CI runs it without the flag, on an unsandboxed validator):
ARCADIA_PRESERVATION_HOST_TEST=1 mise exec -- pnpm exec vitest run tests/rehearsal-two-action.test.ts
```

**Run the replay before every live rehearsal**, and add a scenario for every
live failure it did not predict. A live failure the replay could have caught
is a missing scenario, and adding it is part of the fix.

**Check the active Plan first, then read the worker log, not only the Plan.**
Count Actions by pairing each `- id:` with the `status:` line that follows it.
A whole-file `status:` grep overcounts, because acceptance-criteria text quotes
status values.

An Action's truth is its `status:` in the Plan. A gate's truth is whether the
live system does what the gate says. **Refresh this document whenever a
critical-path Action completes, a live run happens, a Plan is activated, or a
new blocker is found.**
