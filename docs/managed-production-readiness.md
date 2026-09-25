# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document and asserts nothing on its own. Every line reads
from `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, `MISSION_LOG.md`, the live worker log, and the live
`arcadia advance queue`, `arcadia production status` and
`arcadia production capacity` output. When those disagree with this file, they
are right and this file is stale. "Refreshing this document" at the bottom says
how to re-derive it.

Last derived: **2026-09-25** (updated same day, twice more — see the two
notes below). This derivation also restored the dispatch guarantee
that `arcadia go` works only on the critical path (see "What this derivation
changed"). Arcadia's own target is now `NORTH_STAR.md` at the repository
root, and its gates are the critical path below.

**Update at 2026-09-25T22:07Z:** all three code blockers below have landed
and settled (`name-failing-preservation-check-and-bound-retries`,
`honor-policy-providers-at-launch`, `refuse-packets-without-validation-commands`
are all `status: done` in the Plan; Issues #611, #559, #572 are all closed).
`current_action` is not yet the operator rehearsal step — an ungated
governance bug-fix, `fix-decision-approve-missing-commit` (filed
2026-09-25, not held behind the proof), sits ahead of it in the queue.

**Update at 2026-09-25T22:49Z: a second lane opened, and it is now the
critical path to *concurrent* production specifically.** Decision 0071
(ratified 2026-09-25, `b898c3b4`) superseded Decision 0023 and adopted
ready-set admission with pipelining. Three Actions were filed and queued
(`add-ready-set-admission-and-pipelining-actions-2026-09-25`,
settled `85fdc8b8`) and then promoted to the top of the queue, ahead of
`fix-decision-approve-missing-commit`:
`resolve-cross-plan-dependency-ids` (ready now, no dependency),
`admit-ready-set-across-repositories` (depends on the first), and
`pipeline-independent-actions-while-pr-unmerged` (depends on the second, plus
the two existing Decision-0070 held Actions below). The first two are **not**
gated by `prove-two-action-unattended-production` — cross-repository
concurrency was already built and switched off by default
(`docs/proposals/portfolio-parallel-execution.md` §2), so raising it needs no
proof run. Only same-repository pipelining (the third Action, and Decision
0066 generally) stays behind the proof. The tables below reflect both lanes;
live signals (`production status`, worker log) were re-walked at 23:00Z for
this update.

---

## Executive summary

**Two lanes now, not one.** Lane A earns the *unattended* claim: 0 blocking
code Actions on the original list, 1 ungated governance fix, then 1 operator
step, then 1 proof run. Lane B earns the *concurrent* claim, and needs no
proof: 2 code Actions, ready or one dependency away, now queued ahead of
Lane A's governance fix. A third Action pipelines same-repository work but
stays behind the proof, same as Lane A.

**Lane A: 0 blocking code Actions on the original list, 1 ungated
governance fix, then 1 operator step, then 1 proof run.** It was 7 code
Actions two days ago. All three remaining blockers landed:

| Done since 2026-09-24 | Defect | Evidence |
| --- | --- | --- |
| `release-committed-admissions-on-session-end` | #610 | PR #619. `production status` changed from "2 committed Action(s) finishing" to "Idle". |
| `withhold-worker-lifecycle-from-sessions` | #611 (part) | PR #624 |
| `stop-killing-busy-workers` | #617 | No `Recovered hung worker:` line since the fix. #617 closed. |
| `preserve-candidates-across-base-advance` | #539 | PR #622. Completion settled this derivation, after re-running its preservation tests on `main`: 50 passed, 7 skipped. |
| `name-failing-preservation-check-and-bound-retries` | #611 (rest) | Completed; evidence in `MISSION_LOG.md` 2026-09-25. |
| `honor-policy-providers-at-launch` | #559 | PR #646. Completed; evidence in `MISSION_LOG.md` 2026-09-25. |
| `refuse-packets-without-validation-commands` | #572 | PR #647, closed Issue #572. Completed; evidence in `MISSION_LOG.md` 2026-09-25. |

**What remains, in dispatch order (both lanes, as currently queued):**

| # | Action | Lane | Defect / Decision | Why it blocks |
| --- | --- | --- | --- | --- |
| 1 | `resolve-cross-plan-dependency-ids` ← **pointer's queue successor** | B (concurrent) | Decision 0071 | No dependency; unknown `depends_on` ids must block instead of counting as satisfied before the ready set can safely span repositories. |
| 2 | `admit-ready-set-across-repositories` | B (concurrent) | Decision 0071 | Depends on #1. Retires the settlement-advanced `current_action` pointer for a scheduler-derived one; this is what actually turns on cross-repository concurrency. |
| 3 | `fix-decision-approve-missing-commit` ← **current `current_action`** | A (unattended) | #645 | `arcadia decision approve` leaves an uncommitted Decision file write, an ungated governance bug filed 2026-09-25. |
| 4 | **Operator:** reverse Decision 0057's deferral and start the rehearsal | A (unattended) | — | The three original code blockers are done; nothing else blocks entry 6 below except entry 3 landing first. |
| 5 | `pipeline-independent-actions-while-pr-unmerged` | B (concurrent), gated by A | Decision 0071 + Decision 0070 | Depends on #2 above, plus the two existing Decision-0070 held Actions in the table below, which are themselves held behind entry 6's proof. |

After table entry 3 lands, Decision 0057/0061's revival trigger is met ("the
operator begins the live rehearsal on whichever configured provider has capacity
… after the further managed-production defects are fixed"). The operator
reverses the deferral (`arcadia decision reverse`) and runs
`prove-two-action-unattended-production` per its runbook (critical-path entry
6 below). That run earns the unattended claim and, through the Decision-0070
held Actions, eventually unblocks table entry 5 — same-repository pipelining.
Table entries 1 and 2 do not wait for any of that; they are queued ahead of
entry 3 and dispatch first.

---

## What this derivation changed

**The critical path had been silently abandoned, and nothing reported it.**
Settling `activate-mc-site-tooling-plan-2026-09-25` activated the
mission-control-site tooling Plan. As a documented side effect, it returned
this Plan to `draft`, which drops a draft Plan's Actions from the queue. When
that Plan finished, cross-Plan Go chose `agent-ask-execution-queue`, the Plan
whose eligible Action ranked highest among those still queued. The bootstrap
Plan was no longer a candidate. The pointer landed on
`make-a-natural-language-agent-ask-propose-the-concrete-canonical-effect-when-the`,
which is useful work but off the path.

Governance writes, all on `main`:

- **`gate-dispatch-to-production-critical-path-2026-09-25`** (`c8196b7f`). It
  adds `prove-two-action-unattended-production` to `depends_on` for every open
  Action in this Plan that was not already held behind it. Titles, acceptance
  and references were restated verbatim; only `depends_on` changed. The
  directly gated Actions are `add-segment-queue-arrange`,
  `settle-commit-survives-gitignored-asks`,
  `serialize-decision-deferral-pointer-write`,
  `treat-blocked-status-as-undispatchable`, `defect-bounded-triage-loop`,
  `page-runs-this-push-list`, `renumber-duplicate-decision-files` and
  `generate-operator-scripts-for-runs-approvals`. Their dependents follow
  transitively. They stay ordered but ineligible until the proof is done.
- **`reactivate-bootstrap-production-plan-2026-09-25`** (`bf99dd99`). This Plan
  is active again, at the top of the queue, pointing at blocker 1 with
  `claude-sonnet-5` at high effort. `agent-ask-execution-queue` returned to
  `draft` with no Action state changed. Its in-flight PR #637 is untouched and
  can still merge; its completion must use the
  `plan/agent-ask-execution-queue#<action>` form.
- **`complete-preserve-candidates-across-base-advance-2026-09-25`**
  (`e7ffb59f`). This records the completion that #622 had shipped but no one
  had settled.
- **`file-per-project-north-star-2026-09-25`** (`21efe458`). It files
  `support-per-project-north-star`, held behind the proof like every other
  off-path Action.

**Why this holds after the three blockers land.** Completion settlement reports
`planComplete` only when every remaining Action is done or deferred
(`selectNextAfterCompletion`, `src/ask/settlement.ts`). The held Actions stay
`open`, so the Plan cannot complete. Go then reports the unmet dependency on the
deferred proof, which is exactly the operator step, instead of switching to
another Plan.

**Two ways this can still be undone, both by an explicit operator act:**

1. **Activating another Plan with `--activate`.** That is how it happened today.
   Before activating, weigh the cost that settlement displays: "Returned Plan
   bootstrap-managed-production-to-build-flight-deck to draft".
2. **Settling the pending Ask `enable-parallel-plan-dispatch-per-repository`**
   (`.arcadia/asks/`, filed 2026-09-25, unsettled). It asks for a second live
   Session per repository. Decision 0066 already answered that question: wait
   until the proof and the #505/#507/#549-class fixes have landed. Settling it
   now would reopen that answer.

---

## The gates

Gates 1–6 are Lane A: they earn the *unattended* claim for one repository.
Decision 0071 adds a parallel gate for Lane B, the *concurrent* claim, that
does not sit behind gate 5.

| Gate | State |
| --- | --- |
| 1 — The board is the surface | ✅ closed 2026-09-20 |
| 2 — Work reaches an agent with no operator | ✅ closed 2026-09-22 |
| 3 — A finished Session lands with no operator | 🟡 **#610, #539, #611 all fixed and closed; provisional until the proof run passes through this gate.** |
| 4 — It keeps going without help | 🟡 **#617 and #559 both fixed and closed; provisional until the proof run passes through this gate.** |
| 5 — Proof | ⬜ `prove-two-action-unattended-production` is deferred and revives once the ungated `fix-decision-approve-missing-commit` lands and the operator reverses Decision 0057. `prove-multi-provider-production-recovery` and `run-managed-production-live-soak` are blocked on it. |
| 6 — The operator surface | ⬜ Off the critical path, held behind the proof. |
| **B — Cross-repository concurrency** (Decision 0071) | ⬜ **Not gated by 5.** `resolve-cross-plan-dependency-ids` is ready now; `admit-ready-set-across-repositories` depends only on it. Closes when settlement stops writing `current_action` and the tick admits from the ready set across repositories. |
| **B′ — Same-repository pipelining** (Decision 0071 + 0070) | ⬜ Gated by gate B *and* gate 5, through the two existing Decision-0070 held Actions (`settle-squash-merged-completion-drafts`, `sweep-merged-completions-before-dispatch`), which depend on `prove-two-action-unattended-production`. |

A gate is closed when the live system does what the gate says, not when its
Actions are marked done. Gates 3 and 4 were once marked closed on status alone,
and the first real runs reopened them. Treat them as provisional until the
proof run passes through them.

---

## The critical path, in order

**Lane B (concurrent) now dispatches first**, because it was promoted to the
top of the queue on 2026-09-25 and carries no dependency on the proof:

B1. `resolve-cross-plan-dependency-ids` ← **top of queue, ready now**
B2. `admit-ready-set-across-repositories` — depends on B1; this is where
    cross-repository concurrency actually turns on
B3. `pipeline-independent-actions-while-pr-unmerged` — depends on B2 *and*
    Lane A's proof (through the Decision-0070 held Actions), so it cannot
    dispatch until Lane A reaches entry 6

**Lane A (unattended)** is next in queue order after B1–B2, and is what
`current_action` still points at:

1. ~~`name-failing-preservation-check-and-bound-retries` (#611)~~ — done.
2. ~~`honor-policy-providers-at-launch` (#559)~~ — done.
3. ~~`refuse-packets-without-validation-commands` (#572)~~ — done.
4. `fix-decision-approve-missing-commit` (#645) ← **current `current_action`**.
   Ungated governance bug filed 2026-09-25.
5. **Operator:** reverse Decision 0057's deferral and start the rehearsal on a
   provider with capacity. Read "Rehearsal hazards" first.
6. `prove-two-action-unattended-production`, where **the unattended claim is
   earned**, and where Lane B3 (pipelining) becomes dispatchable.

Then, for continuous production rather than the claim itself:
`prove-multi-provider-production-recovery`, then
`run-managed-production-live-soak` (operator-granted scope).

B1, B2 and entry 4 are each an ordinary `claude-sonnet-5` session at high
effort.

### Rehearsal hazards to know before entry 5

- **#608:** while the standing policy is Off, the worker fast-forwards every
  DB-active Project's checkout to `origin/main` on each tick. A `git reset --hard`
  on the fixture is silently undone. Reset through the remote, or stop the
  worker while resetting.
- **#609:** `production activate`'s `--expect-revision` flag does not match the
  preview's `expectedRevision` field name.
- **The fixture is mid-state.** `zero-prompt-rehearsal/write-rehearsal-marker`'s
  last Session (`session_5c1a2543cae24319a6`) is `needs_input`, with a
  resumable candidate. `production status` still lists two `committed`
  admissions for the fixture. They no longer count toward concurrency (#610),
  but the listing has not caught up.
- **Capacity gating is off** (`codingAgent.capacityGateEnabled: false`), so
  "admitted" is an operator choice, not observed headroom.

### What is *not* on the critical path

Everything else. Every open Action in this Plan other than B1, B2,
`fix-decision-approve-missing-commit`, and B3 (which is on a critical path but
not dispatchable yet) depends on the proof, directly or transitively, or is
operator-only (`prove-zero-prompt-production-loop`, whose only dependent is
`harden-zero-prompt-production-loop`). Other Plans' ready Actions are
`waiting_for_pointer`: dispatch never selects them while this Plan is active
and incomplete.

---

## Concurrency

This section used to say concurrency waits on the proof, full stop. Decision
0071 splits that into two claims:

- **Cross-repository concurrency (Decision 0071, supersedes 0023).** Does
  *not* wait on the proof. `resolve-cross-plan-dependency-ids` and
  `admit-ready-set-across-repositories` (Lane B1/B2 above) turn this on:
  the production tick already runs independent repositories side by side
  when `maxConcurrentSessions` is raised
  (`docs/proposals/portfolio-parallel-execution.md` §2); what was missing was
  unknown-dependency safety and retiring the settlement-advanced pointer, and
  that is exactly what B1/B2 build.
- **Same-repository concurrency (Decision 0066).** Still approved as written:
  same-repository concurrent Sessions wait until
  `prove-two-action-unattended-production` and the #505/#507/#549-class fixes
  have landed. `serialize-decision-deferral-pointer-write` (#505) is now held
  behind the proof. That matches 0066, which sequences those fixes after the
  proof and before a second lane, not before the first lane. Decision 0071's
  pipelining (Lane B3) is a narrower case than 0066 — one repository, one live
  Session, a second *unmerged candidate* rather than a second live
  Session — and it is gated by the proof through the Decision-0070 held
  Actions, not by 0066 directly. 0066's own trigger (a second live Session in
  one repository) is unchanged and still unmet.

---

## Live state at derivation

| Signal | Reading (2026-09-25 ~23:00Z) |
| --- | --- |
| Managed production | **Inactive · Idle** (policy revision 15, epoch 12, revoked 2026-09-24T16:15Z). No Session has launched since 2026-09-24. |
| Worker | Running. No `Recovered hung worker:` line since 2026-09-24T21Z. |
| Pointer (`current_action`) | Still `bootstrap-managed-production-to-build-flight-deck` / `fix-decision-approve-missing-commit`. Reordering the queue does not move the pointer; only dispatch or completion does. |
| Ready in the active Plan, in queue order | `resolve-cross-plan-dependency-ids` (Lane B1, new top), then `fix-decision-approve-missing-commit` (Lane A), then the operator rehearsal step. `admit-ready-set-across-repositories` and `pipeline-independent-actions-while-pr-unmerged` are queued but not yet ready (unmet `depends_on`). |
| Open Decisions | 0041, 0052. Neither concerns production readiness. Decision 0071 (ready-set admission with pipelining) is approved, not open. |
| Open escalation | `private-practice-now/calibrate-river-specialty-prompt-chain` (`planning_required`). Unrelated to the Arcadia lane. |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 111 (each `- id:` paired with the `status:` line that follows it) |
| Done | 85 |
| Open | 25 |
| Deferred | 1 (`prove-two-action-unattended-production`) |
| **On the critical path, code, Lane A** | **1** (`fix-decision-approve-missing-commit`, ready, `current_action`) |
| **On the critical path, code, Lane B** | **3** (`resolve-cross-plan-dependency-ids` ready; `admit-ready-set-across-repositories` one dependency away; `pipeline-independent-actions-while-pr-unmerged` gated by both lanes) |
| **On the critical path, operator** | **1** (reverse the deferral and start the rehearsal) |
| **On the critical path, proof** | **1** |
| Unfinished, off the critical path | 21, all held behind the proof or operator-only |

---

## Refreshing this document

Run these, then update the summary, gates, critical path and scoreboard:

```bash
grep -E "^(active_plan|current_action):" PROJECT.md   # is the bootstrap Plan still active?
mise exec -- pnpm arcadia advance queue --json         # ready set: only critical-path Actions?
mise exec -- pnpm arcadia production status
mise exec -- pnpm arcadia production capacity
grep -l "^status: open" docs/decisions/*.md
tail -80 MISSION_LOG.md
grep -E "Launched Session|Reconciled Session|Recovered hung worker|Escalated" <workspace>/.arcadia/worker.log | tail -30
gh issue list --label bug --state open
```

**Check the active Plan first.** Today's main correction was not about the code
at all. The Plan had been deactivated, and every other signal still looked
healthy. **Read the worker log, not only the Plan.** The 2026-09-24 correction
came from `Launched Session` / `Reconciled Session` lines that no Plan status
showed. Count Actions by pairing each `- id:` with the `status:` line that
follows it. A whole-file `status:` grep overcounts, because acceptance-criteria
text quotes status values.

An Action's truth is its `status:` in the Plan. A gate's truth is whether the
live system does what the gate says. **Refresh this document whenever a
critical-path Action completes, a live run happens, a Plan is activated, or a
new blocker is found.**
