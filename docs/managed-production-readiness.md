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

Last derived: **2026-09-25** (updated same day after the third blocker landed
— see the note below). This derivation also restored the dispatch guarantee
that `arcadia go` works only on the critical path (see "What this derivation
changed"). Arcadia's own target is now `NORTH_STAR.md` at the repository
root, and its gates are the critical path below.

**Update at 2026-09-25T22:07Z:** all three code blockers below have landed
and settled (`name-failing-preservation-check-and-bound-retries`,
`honor-policy-providers-at-launch`, `refuse-packets-without-validation-commands`
are all `status: done` in the Plan; Issues #611, #559, #572 are all closed).
`current_action` is not yet the operator rehearsal step — an ungated
governance bug-fix, `fix-decision-approve-missing-commit` (filed
2026-09-25, not held behind the proof), sits ahead of it in the queue. The
tables below are updated to reflect this; live signals (`production status`,
worker log) were not fully re-walked, so treat "Live state at derivation"
below as the older 16:45Z snapshot unless re-checked.

---

## Executive summary

**Distance: 0 blocking code Actions on the original list, 1 ungated
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

**What remains, in dispatch order:**

| # | Action | Defect | Why it blocks |
| --- | --- | --- | --- |
| 1 | `fix-decision-approve-missing-commit` ← **pointer** | #645 | `arcadia decision approve` leaves an uncommitted Decision file write, an ungated governance bug filed 2026-09-25 that sits ahead of the operator step in queue order. |
| 2 | **Operator:** reverse Decision 0057's deferral and start the rehearsal | — | The three original code blockers are done; nothing else blocks entry 5 below except this ungated fix landing first. |

After the ungated fix lands, Decision 0057/0061's revival trigger is met ("the
operator begins the live rehearsal on whichever configured provider has capacity
… after the further managed-production defects are fixed"). The operator
reverses the deferral (`arcadia decision reverse`) and runs
`prove-two-action-unattended-production` per its runbook. That run earns the
unattended claim.

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

| Gate | State |
| --- | --- |
| 1 — The board is the surface | ✅ closed 2026-09-20 |
| 2 — Work reaches an agent with no operator | ✅ closed 2026-09-22 |
| 3 — A finished Session lands with no operator | 🟡 **#610, #539, #611 all fixed and closed; provisional until the proof run passes through this gate.** |
| 4 — It keeps going without help | 🟡 **#617 and #559 both fixed and closed; provisional until the proof run passes through this gate.** |
| 5 — Proof | ⬜ `prove-two-action-unattended-production` is deferred and revives once the ungated `fix-decision-approve-missing-commit` lands and the operator reverses Decision 0057. `prove-multi-provider-production-recovery` and `run-managed-production-live-soak` are blocked on it. |
| 6 — The operator surface | ⬜ Off the critical path, held behind the proof. |

A gate is closed when the live system does what the gate says, not when its
Actions are marked done. Gates 3 and 4 were once marked closed on status alone,
and the first real runs reopened them. Treat them as provisional until the
proof run passes through them.

---

## The critical path, in order

1. ~~`name-failing-preservation-check-and-bound-retries` (#611)~~ — done.
2. ~~`honor-policy-providers-at-launch` (#559)~~ — done.
3. ~~`refuse-packets-without-validation-commands` (#572)~~ — done.
4. `fix-decision-approve-missing-commit` (#645) ← **pointer**. Ungated
   governance bug filed 2026-09-25, ahead of the operator step in queue order.
5. **Operator:** reverse Decision 0057's deferral and start the rehearsal on a
   provider with capacity. Read "Rehearsal hazards" first.
6. `prove-two-action-unattended-production`, where **the unattended claim is
   earned**

Then, for continuous production rather than the claim itself:
`prove-multi-provider-production-recovery`, then
`run-managed-production-live-soak` (operator-granted scope).

Entry 4 is an ordinary `claude-sonnet-5` session at high effort.

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

Everything else. Every open Action in this Plan other than the three blockers
depends on the proof, directly or transitively, or is operator-only
(`prove-zero-prompt-production-loop`, whose only dependent is
`harden-zero-prompt-production-loop`). Other Plans' ready Actions are
`waiting_for_pointer`: dispatch never selects them while this Plan is active
and incomplete.

---

## Concurrency

**Decision 0066** is approved: same-repository concurrent Sessions wait until
`prove-two-action-unattended-production` and the #505/#507/#549-class fixes
have landed. `serialize-decision-deferral-pointer-write` (#505) is now held
behind the proof. That matches 0066, which sequences those fixes after the
proof and before a second lane, not before the first lane.

---

## Live state at derivation

| Signal | Reading (2026-09-25 ~16:45Z) |
| --- | --- |
| Managed production | **Inactive · Idle** (policy revision 15, epoch 12, revoked 2026-09-24T16:15Z). No Session has launched since 2026-09-24. |
| Worker | Running. No `Recovered hung worker:` line since 2026-09-24T21Z. |
| Pointer | `bootstrap-managed-production-to-build-flight-deck` / `fix-decision-approve-missing-commit` (updated 2026-09-25T22:07Z; the three original blockers are done) |
| Ready in the active Plan | `fix-decision-approve-missing-commit`, then the operator rehearsal step |
| Open Decisions | 0041, 0052. Neither concerns production readiness. |
| Open escalation | `private-practice-now/calibrate-river-specialty-prompt-chain` (`planning_required`). Unrelated to the Arcadia lane. |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 108 (each `- id:` paired with the `status:` line that follows it) |
| Done | 85 |
| Open | 22 |
| Deferred | 1 (`prove-two-action-unattended-production`) |
| **On the critical path, code** | **1** (`fix-decision-approve-missing-commit`, ready, pointer) |
| **On the critical path, operator** | **1** (reverse the deferral and start the rehearsal) |
| **On the critical path, proof** | **1** |
| Unfinished, off the critical path | 20, all held behind the proof or operator-only |

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
