---
arcadia: v1
type: decision
id: "0212"
slug: decide-how-far-the-operator-s-2026-11-09-parallel-work-standing-order-reaches
project: arcadia
status: approved
question: "Decide how far the operator's 2026-11-09 parallel-work standing order reaches: whether to widen Decision 0066's one-Session-per-repository limit now, and whether more than one coordinator Lead may hold separate Actions at once."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. Record the order now and keep the gates: parallel helpers inside each Lead today; widen 0066 and the cap only through the existing proof Plans"
options:
  - label: "A. Record the order now and keep the gates: parallel helpers inside each Lead today; widen 0066 and the cap only through the existing proof Plans"
    consequence: "Coordinators fan out independent work to parallel helpers from now on, which needs no new authority. The production cap and same-repository Sessions stay as they are until the remaining proof lands: Rowan makes the cross-repository route (the three open bootstrap Actions, then the live prove-concurrent-ready-set-admission run under a rehearsal exception the operator grants) the next production Plan after part 2. Lowest risk; roughly 4-6 Actions plus two operator inputs before the cap can lift, and same-repository or multi-Lead work later still."
    recommended: true
  - label: "B. Widen now for Leads only: several Rowan Leads may each hold a separate, independent Action in its own worktree and branch, with production still at cap 1"
    consequence: Rowan plans the work for several Leads, each holding a separate independent Action in its own worktree, branch and PR, with merges serial under the existing gate and production still at cap 1. It needs a revisit of Decision 0066's one-Session rule, a scheduler-written current_action pointer and a touches-based independence check, none of which exists, so it is roughly 8-10 Actions away; a wrong independence judgement could produce conflicting merges that CI and review catch rather than prevent.
    recommended: false
  - label: C. Retire Decision 0066's deferral and raise the production cap now
    consequence: "Fastest route to parallel unattended production, but it skips the proofs 0066 required, on a path whose single-lane run has just found several real defects (#2270, #2324, #2284); concurrent failures would be harder to diagnose and could stall or corrupt more than one Action at once. Not recommended until the proofs land."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-09
answer: "A. Record the order now and keep the gates: parallel helpers inside each Lead today; widen 0066 and the cap only through the existing proof Plans"
decided: 2026-11-09
---

# Decision 0212: Decide how far the operator's 2026-11-09 parallel-work standing order reaches: whether to widen Decision 0066's one-Session-per-repository limit now, and whether more than one coordinator Lead may hold separate Actions at once.

## Options

- **A. Record the order now and keep the gates: parallel helpers inside each Lead today; widen 0066 and the cap only through the existing proof Plans** (recommended): Coordinators fan out independent work to parallel helpers from now on, which needs no new authority. The production cap and same-repository Sessions stay as they are until the remaining proof lands: Rowan makes the cross-repository route (the three open bootstrap Actions, then the live prove-concurrent-ready-set-admission run under a rehearsal exception the operator grants) the next production Plan after part 2. Lowest risk; roughly 4-6 Actions plus two operator inputs before the cap can lift, and same-repository or multi-Lead work later still.
- **B. Widen now for Leads only: several Rowan Leads may each hold a separate, independent Action in its own worktree and branch, with production still at cap 1**: Rowan plans the work for several Leads, each holding a separate independent Action in its own worktree, branch and PR, with merges serial under the existing gate and production still at cap 1. It needs a revisit of Decision 0066's one-Session rule, a scheduler-written current_action pointer and a touches-based independence check, none of which exists, so it is roughly 8-10 Actions away; a wrong independence judgement could produce conflicting merges that CI and review catch rather than prevent.
- **C. Retire Decision 0066's deferral and raise the production cap now**: Fastest route to parallel unattended production, but it skips the proofs 0066 required, on a path whose single-lane run has just found several real defects (#2270, #2324, #2284); concurrent failures would be harder to diagnose and could stall or corrupt more than one Action at once. Not recommended until the proofs land.

## Rationale

Operator standing order, 2026-11-09, verbatim as relayed by Signal 3 from the operator's chat: "It should be a standing order that workers always work in parallel when possible. That means that Rowan Leads should delegate work to properly identified agents who may work in parallel, and multiple Rowan Leads should also be able to work concurrently on separate, independent actions. Divide and conquer FTW!" Allowed today without a Decision: a coordinator delegating independent work to parallel, properly identified helpers in separate worktrees, within existing merge gates. State found 2026-11-09 (read-only research, not every point re-verified): prove-two-action-unattended-production is done (MISSION_LOG.md:1258, 2026-10-01). The cap stays 1 until prove-concurrent-ready-set-admission is also done (src/production/policy.ts:70, 1411); it is open and depends on open Actions admit-ready-set-across-repositories, soak-ready-set-admission-with-fixture-provider and prove-literal-split-browser-and-ledger, all in the bootstrap Plan, and needs a rehearsal exception and two repositories. Decision 0071 already approved that cross-repository route. Same-repository concurrency or several Leads on one Plan also needs a revisit of 0066, a scheduler-written current_action (0071, not built), and an independence check: no code reads a touches field today, and part 2's pins declare none.

Proposed by Agent Ask decide-parallel-work-standing-order-20261109.
