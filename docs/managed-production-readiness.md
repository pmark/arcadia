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

Last derived: **2026-09-25** (updated same day, several times more — see the
notes below). This derivation also restored the dispatch guarantee
that `arcadia go` works only on the critical path (see "What this derivation
changed"). Arcadia's own target is now `NORTH_STAR.md` at the repository
root, and its gates are the critical path below.

**Update at 2026-09-25T23:24Z:** table entry 1, `resolve-cross-plan-dependency-ids`,
is code-complete and validated (`pnpm test` scoped to the scheduling suites,
core build, Discord bot build, and the dashboard build all pass; full
`pnpm test` still shows its pre-existing sandbox-only failures — local-port
`EPERM` and CLI-subprocess stderr noise — unrelated to this change).
`canonicalOrder` (`src/scheduling/order.ts`) now resolves a `depends_on` id
against its own Plan first, then as a cross-Plan `plan/<slug>#<action-id>`
reference, and never treats an unresolved id as satisfied. Completion
settles in this Action's own candidate before it pushes, per the Plan's
`complete` intent convention; this note does not re-run the full command
suite above (production status/capacity, worker log, Decision/Issue sweeps),
so table entry 2, `admit-ready-set-across-repositories`, should be confirmed
still gated on nothing else before it is next dispatched.

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

**Update at 2026-09-25T23:30Z: `fix-decision-approve-missing-commit` landed,
so Lane A's last code blocker is gone.** `MISSION_LOG.md` records it complete
(Candidate `37e3f28a`, PR closes #645); `PROJECT.md`'s `current_action` has
already advanced past it to `resolve-cross-plan-dependency-ids` (Lane B1),
confirmed `ready` with no unmet dependency in `arcadia advance queue --json`
(`pointerAuthorized: true`, `selected: true`). **Lane A now has zero open code
Actions.** Decision 0057/0061's revival trigger — "after the further
managed-production defects are fixed" — is met: all three original code
blockers and this ungated fix are done. The only thing standing between here
and gate 5 is the operator step (reverse the Decision 0057 deferral, start the
rehearsal) and then the proof itself. `production status` is unchanged:
**Inactive · Idle**, desired state `inactive` (revision 15, epoch 12), revoked
2026-09-24T16:15Z — nothing has launched since then. `gh issue list` could not
be re-checked this pass (sandbox denied `api.github.com`); the bug list below
is carried over from the prior derivation, not reconfirmed.

**Update at 2026-09-25T23:34Z: Lane B's admission Action now carries a hard
runtime gate, not just a documentation note.** The operator raised a
sequencing concern — building `admit-ready-set-across-repositories` ahead of
the sequential proof is fine, and even helps (it removes the #505/#507 race
class the proof would otherwise have to survive), but actually letting it
admit real concurrent work in production before that proof has run live
inverts the validation order Decision 0066 already set for the same-repository
case. `gate-concurrent-admission-behind-sequential-proof-2026-09-25`
(settled `442df33a`) added a sixth acceptance criterion to
`admit-ready-set-across-repositories`: activating a production policy scope
with `maxConcurrentSessions` above 1 must be refused, citing
`prove-two-action-unattended-production` by id, until that Action is
`status: done`. This changes nothing about what dispatches now — B1 and B2
still queue ahead of the proof and carry no dependency on it — it only stops
the mechanism they build from being switched on for real concurrent work
before the sequential case is proven. See "Concurrency" below.

**Update at 2026-09-25T23:50Z: that gate cited the wrong proof, and now cites
the right one.** `prove-two-action-unattended-production` tests sequential
dependent-Action dispatch in one repository, not concurrent admission — see
"Concurrency" below for the full check. `admit-ready-set-across-repositories`'s
sixth acceptance criterion now also requires a new Action,
`prove-concurrent-ready-set-admission` (queued at position 3, right after the
pipelining bundle), before `maxConcurrentSessions > 1` can be activated.
Filed both as `intent: action`, not `intent: plan` — the first attempt at
this fix used `intent: plan` and its preview showed it would reflow the
*entire* active Plan's queue into one contiguous segment, silently undoing
Lane B's earlier promotion to the top of the queue; that preview was caught
and discarded (`applied: false`) before anything was written.

**Update at 2026-09-26: B2 is now behind the proof, and the concurrency plan
is complete.** The adversarial review
(`docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md`, PR #655)
found two problems:
- The gate held back concurrency but not B2's settlement/pointer change, which
  is the mechanism the sequential proof validates.
- B2's single pointer writer, Decision 0070's host settler, is itself held
  behind the proof.

Settlements `e83cc3b9`, `ad1e05be`, `06b9428f` and `af97f223` made these
changes:
- moved the gate into its own ready-now Action;
- made B2 depend on the proof and the host settler;
- added the Actions for every remaining gap in the design.

§5 "Build map" of `docs/proposals/portfolio-parallel-execution.md` is now the
plan; see "Concurrency" below.

---

## Executive summary

**Two lanes now, not one.** Lane A earns the *unattended* claim: **0 blocking
code Actions left at all** — the ungated governance fix landed too — so all
that remains is 1 operator step, then 1 proof run. Lane B earns the
*concurrent* claim. Eight of its Actions are ready now and need no proof,
including `current_action` (`resolve-cross-plan-dependency-ids`) and the
concurrency gate. Ready-set admission itself (B2) waits on Lane A's proof,
because it retires the pointer that proof validates. **Turning concurrency
on** waits on a fixture soak and two proofs: Lane A's, and a
concurrency-specific one. The full sequence is §5 "Build map" of
`docs/proposals/portfolio-parallel-execution.md`.

**Lane A: 0 blocking code Actions left, period.** It was 7 code Actions four
days ago. All four landed, the last one (the ungated governance fix) since the
prior derivation:

| Done since 2026-09-24 | Defect | Evidence |
| --- | --- | --- |
| `release-committed-admissions-on-session-end` | #610 | PR #619. `production status` changed from "2 committed Action(s) finishing" to "Idle". |
| `withhold-worker-lifecycle-from-sessions` | #611 (part) | PR #624 |
| `stop-killing-busy-workers` | #617 | No `Recovered hung worker:` line since the fix. #617 closed. |
| `preserve-candidates-across-base-advance` | #539 | PR #622. Completion settled this derivation, after re-running its preservation tests on `main`: 50 passed, 7 skipped. |
| `name-failing-preservation-check-and-bound-retries` | #611 (rest) | Completed; evidence in `MISSION_LOG.md` 2026-09-25. |
| `honor-policy-providers-at-launch` | #559 | PR #646. Completed; evidence in `MISSION_LOG.md` 2026-09-25. |
| `refuse-packets-without-validation-commands` | #572 | PR #647, closed Issue #572. Completed; evidence in `MISSION_LOG.md` 2026-09-25. |
| `fix-decision-approve-missing-commit` | #645 | Completed; evidence in `MISSION_LOG.md` 2026-09-25 ("Completed arcadia/fix-decision-approve-missing-commit"). `current_action` has already advanced past it, to `resolve-cross-plan-dependency-ids`. |

**What remains, in dispatch order (both lanes, as currently queued):**

| # | Action | Lane | Defect / Decision | Why it blocks |
| --- | --- | --- | --- | --- |
| 1 | `resolve-cross-plan-dependency-ids` ← **current `current_action`, ready now** | B (concurrent) | Decision 0071 | No dependency; unknown `depends_on` ids must block instead of counting as satisfied before the ready set can safely span repositories. |
| 2 | `admit-ready-set-across-repositories` | B (concurrent) | Decision 0071 | Depends on #1. Retires the settlement-advanced `current_action` pointer for a scheduler-derived one; this is what actually turns on cross-repository concurrency. |
| 3 | **Operator:** reverse Decision 0057's deferral and start the rehearsal | A (unattended) | — | Nothing else blocks this. All four original Lane A code blockers, including the ungated governance fix, are done. |
| 4 | `pipeline-independent-actions-while-pr-unmerged` | B (concurrent), gated by A | Decision 0071 + Decision 0070 | Depends on #2 above, plus the two existing Decision-0070 held Actions in the table below, which are themselves held behind entry 3's proof run. |
| 5 | `prove-concurrent-ready-set-admission` | B (concurrent), gated by A | Decision 0071 | Depends on #2 and entry 3's proof run. Added 2026-09-25: entry 3's proof only tests sequential dispatch, not concurrent admission, so `admit-ready-set-across-repositories`'s `maxConcurrentSessions` gate now requires this proof too. |

Decision 0057/0061's revival trigger is met now ("the operator begins the
live rehearsal on whichever configured provider has capacity … after the
further managed-production defects are fixed") — every defect on that list is
done. The operator can reverse the deferral (`arcadia decision reverse`) at
any time and run `prove-two-action-unattended-production` per its runbook
(critical-path entry 5 below in "The critical path, in order"). That run
earns the unattended claim and, through the Decision-0070 held Actions,
eventually unblocks table entry 4 — same-repository pipelining. Table
entries 1 and 2 do not wait for any of that; `resolve-cross-plan-dependency-ids`
is the pointer's live `current_action` and dispatches on the very next
`arcadia go`.

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
| 5 — Proof | ⬜ `prove-two-action-unattended-production` is deferred. Its revival trigger is now met (`fix-decision-approve-missing-commit` landed) — all it needs is the operator reversing Decision 0057. `prove-multi-provider-production-recovery` and `run-managed-production-live-soak` are blocked on it. |
| 6 — The operator surface | ⬜ Off the critical path, held behind the proof. |
| **B — Cross-repository concurrency** (Decision 0071) | ⬜ **Building is not gated by 5; admitting real concurrent work is gated by 5 *and* a new proof.** `resolve-cross-plan-dependency-ids` is ready now; `admit-ready-set-across-repositories` depends only on it and may be built and merged before either proof. Its acceptance criteria require it to refuse activating `maxConcurrentSessions > 1` until *both* `prove-two-action-unattended-production` and `prove-concurrent-ready-set-admission` are `status: done` — the latter added 2026-09-25 because the former does not actually test concurrent admission (see "Concurrency"). |
| **B′ — Same-repository pipelining** (Decision 0071 + 0070) | ⬜ Gated by gate B *and* gate 5, through the two existing Decision-0070 held Actions (`settle-squash-merged-completion-drafts`, `sweep-merged-completions-before-dispatch`), which depend on `prove-two-action-unattended-production`. |

A gate is closed when the live system does what the gate says, not when its
Actions are marked done. Gates 3 and 4 were once marked closed on status alone,
and the first real runs reopened them. Treat them as provisional until the
proof run passes through them.

---

## The critical path, in order

**Lane B (concurrent) dispatches first.** Its ready Actions sit at the top of
the queue, and eight of them can be built in parallel now:

B1. `resolve-cross-plan-dependency-ids` ← **top of queue, `current_action`**
B0. Also ready now, with no proof needed:
    - `enforce-concurrency-gate-at-admission`;
    - `rewire-dependents-on-split`;
    - `fix-action-intent-target-ref-amendments` (#654);
    - `release-admission-on-every-launch-failure`;
    - `add-fixture-coding-agent-provider`;
    - `load-test-workspace-db-contention`;
    - `keep-action-claim-while-candidate-unmerged` (#549).

    `limit-sessions-per-provider-account` follows the gate.
B2. `admit-ready-set-across-repositories` waits on B1, the gate, the split
    fix, entry 6 below, and Decision 0070's host settler.
B3. The fixture soak, then `prove-concurrent-ready-set-admission`. When both
    are done, the gate lifts and cross-repository concurrency goes live.
B4. `limit-unmerged-candidates-per-repository`, then
    `pipeline-independent-actions-while-pr-unmerged`: single-repository
    speed.

**Lane A (unattended) has no code Actions left.** `current_action` has moved
past all of them, onto B1:

1. ~~`name-failing-preservation-check-and-bound-retries` (#611)~~ — done.
2. ~~`honor-policy-providers-at-launch` (#559)~~ — done.
3. ~~`refuse-packets-without-validation-commands` (#572)~~ — done.
4. ~~`fix-decision-approve-missing-commit` (#645)~~ — done.
5. **Operator:** reverse Decision 0057's deferral and start the rehearsal on a
   provider with capacity. Read "Rehearsal hazards" first. Nothing else blocks
   this step now.
6. `prove-two-action-unattended-production`, where **the unattended claim is
   earned**, and where Lane B3 (pipelining) becomes dispatchable.

Then, for continuous production rather than the claim itself:
`prove-multi-provider-production-recovery`, then
`run-managed-production-live-soak` (operator-granted scope).

Each Lane B code Action is an ordinary `claude-sonnet-5` session: high effort for B1 and B2, medium for the small B0 Actions.

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

Everything else. Every open Action in this Plan other than B1, B2, B3 and B4
(the last two are on a critical path but not dispatchable yet) depends on the
proof, directly or transitively, or is operator-only
(`prove-zero-prompt-production-loop`, whose only dependent is
`harden-zero-prompt-production-loop`). Other Plans' ready Actions are
`waiting_for_pointer`: dispatch never selects them while this Plan is active
and incomplete.

---

## Concurrency

This section used to say concurrency waits on the proof, full stop. Decision
0071 splits that into two claims:

- **Cross-repository concurrency (Decision 0071, supersedes 0023).** The
  full build plan is now §5 "Build map" of
  `docs/proposals/portfolio-parallel-execution.md`, completed 2026-09-26 after
  the adversarial review
  (`docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md`). Three
  things changed from the earlier reading of this section:
  - **B2 no longer merges before the proof.** `admit-ready-set-across-repositories`
    retires the settlement-advanced pointer, which is exactly the mechanism
    `prove-two-action-unattended-production` validates. It now depends on that
    proof and on Decision 0070's host settler, its only permitted pointer
    writer (`ad1e05be`).
  - **The gate is its own Action, built now.** `enforce-concurrency-gate-at-admission`
    caps concurrency at 1 inside `issueAdmission` on every admission until
    *both* `prove-two-action-unattended-production` and
    `prove-concurrent-ready-set-admission` are done. Today nothing stops
    `production activate --concurrency N`.
  - **Nine more Actions fill the gaps** (`06b9428f`, `af97f223`):
    - ready now: #654, full admission rollback, a zero-token fixture provider,
      a multi-writer database load test, #549's claim expiry;
    - behind the gate: per-account provider slots;
    - behind the proof: bounded stall recovery;
    - behind B2: the per-repository review limit and a fixture soak. The live
      concurrency proof now waits on the soak.

  Eight Actions are buildable now, in parallel. Everything that changes
  lease, stall or pointer behaviour waits on the sequential proof. Outside
  the bounded, expiring rehearsal exception that the fixture soak and
  `prove-concurrent-ready-set-admission` themselves run under, no Session
  runs concurrently with another until the fixture soak and both proofs
  pass.
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

| Signal | Reading (2026-09-25 ~23:30Z) |
| --- | --- |
| Managed production | **Inactive · Idle** (policy revision 15, epoch 12, revoked 2026-09-24T16:15Z). No Session has launched since 2026-09-24. Unchanged since the 23:00Z reading. |
| Worker | Running. Recent base-advance lines through 2026-09-25T23:23Z show it ticking; no `Recovered hung worker:` line seen. |
| Pointer (`current_action`) | `bootstrap-managed-production-to-build-flight-deck` / `resolve-cross-plan-dependency-ids` (moved off `fix-decision-approve-missing-commit` once that completed and settled). Reordering the queue does not move the pointer; only dispatch or completion does. |
| Ready in the active Plan, in queue order | `resolve-cross-plan-dependency-ids` (Lane B1, `current_action`, ready, `pointerAuthorized: true`), then the operator rehearsal step (Lane A). `admit-ready-set-across-repositories`, `pipeline-independent-actions-while-pr-unmerged`, and `prove-concurrent-ready-set-admission` are queued but not yet ready (unmet `depends_on`). |
| Open Decisions | 0041, 0052. Neither concerns production readiness. Decisions 0057, 0061 (proof deferral + retargeted trigger) and 0071 (ready-set admission with pipelining) are all approved, not open. |
| Open escalation | `private-practice-now/calibrate-river-specialty-prompt-chain` (`planning_required`). Unrelated to the Arcadia lane. |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 112 (each `- id:` paired with the `status:` line that follows it) |
| Done | 86 |
| Open | 25 |
| Deferred | 1 (`prove-two-action-unattended-production`) |
| **On the critical path, code, Lane A** | **0** — all four landed; `fix-decision-approve-missing-commit` settled and the pointer has moved on |
| **On the critical path, code, Lane B** | **14** (8 ready now in parallel, `resolve-cross-plan-dependency-ids` is `current_action`; 6 wait on the gate, the proof or B2. See the proposal's §5 Build map) |
| **On the critical path, operator** | **1** (reverse the deferral and start the rehearsal — trigger is met, nothing else blocks it) |
| **On the critical path, proof, Lane A** | **1** (`prove-two-action-unattended-production`) |
| **On the critical path, proof, Lane B** | **2** (`soak-ready-set-admission-with-fixture-provider`, simulated at zero token cost; then `prove-concurrent-ready-set-admission`, live) |
| Gated by both lanes, not yet dispatchable | 1 (`pipeline-independent-actions-while-pr-unmerged`) |
| Unfinished, off the critical path | 21, all held behind a proof or operator-only |

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
