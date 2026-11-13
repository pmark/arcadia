# Production 24/7 rules

Operator direction 2026-11-12: production is never idle. Arcadia starts every
session. Operator decisions D1 to D6 are pending. Rules marked "Pending D<n>"
are targets, not authority, and describe intended behaviour, not present fact.

This page grants no authority and changes no gate. Spend, credentials, deletion,
publication, Plan acceptance, the day grant or each START press, and merges on
authority paths stay with the operator. Sources: the rules proposal
(agentask_93d0170cd186a88db7) and the independent Codex review
(agentask_b99a3e8db0ae4c862f), whose corrected wording this page uses.

Each rule gives the corrected wording, what it prevents, and how it is checked
today and what is still pending.

## 1. Ready floor

- **Rule:** keep a supply of ready, worker-mergeable Actions. The floor of six
  across two Plans is an uncalibrated target, not a guarantee. Prove two
  worthwhile independent Actions in one accepted, granted scope first, and
  prepare one accepted fallback Plan next. Grow supply from observed throughput
  and restocking lead time. Count approved supply separately from proposals. No
  filler work to satisfy a number.
- **Prevents:** production idling because one START covered one Plan and nothing
  else was ready.
- **Today:** the keeper restocks through Asks. Nothing counts the supply yet.
- **Pending:** a read-only ready-work command with reasons, and a timer alarm
  below the floor (needs code, housekeeping item 2).

## 2. Ready is proven, not claimed

- **Rule:** separate scope and grant eligibility, expected candidate paths,
  dependencies and holds, and runnable validation prerequisites. A bug-fix
  regression may fail on main by design; require a characterized baseline, not
  every named test green before the fix. Record actual test execution and skip
  counts, runtime revision and expiry. Final candidate evidence still gates
  completion. An unrelated proposal that mentions an Action does not gate it.
- **Prevents:** Actions entering a card they cannot finish (for example #2517
  and #2519).
- **Today:** the operator's pre-mortem and the replay before each press.
- **Pending:** a ready-reason report and recorded test counts (needs code).

## 3. Fallback across Plans

- **Rule (target, Pending D2):** when the active Plan has no runnable Action,
  production should move to the next accepted Plan in a scope-safe way. Reuse
  the existing Decisions 0048 and 0116, and eventually 0122. The missing work is
  accepted supply plus that transition. A preference record approves no new Plan
  and changes no grant. A preference selection alone is not admission.
- **Prevents:** "No Plan is eligible" ending the day.
- **Today:** not possible without a new press for each Plan.
- **Pending D2:** code (housekeeping item 7).

## 4. Park one, keep going

- **Rule (target, Pending D1):** a showstopper should park only its own Action,
  with an Issue and a revival trigger. The run should then take the next ready
  Action. Parking is never completion and never edits acceptance criteria. Keep
  the existing held-candidate path, and extend it only to named Action-local
  failures. Shared sign-in, authority, STOP, storage or custody failures still
  stop the affected scope. Dependents of a parked Action never launch. Never
  report a run with parked work as all merged.
- **Prevents:** one held Action idling the whole run.
- **Today:** the operator sets an Action aside by a Plan amendment only.
- **Pending D1:** code (housekeeping item 6).

## 5. Environment parity

- **Rule:** the worker's pre-acceptance environment must have the capabilities
  the test needs under its confinement, not CI's full privileges. Check the
  canary once per relevant revision or capability, not every minute. A known gap
  refuses the Action or marks the card partial. It never silently drops an
  Action from a whole-Plan claim, and it never turns a NO-GO into a pass.
- **Prevents:** tests that pass on the host and fail in the worker (#2517,
  #2519, #2515).
- **Today:** the operator acts on the replay's finding instead of pressing past
  it.
- **Pending:** a parity canary at card build, and the environment fixes. #2521
  must prove owned-port access AND denial of unrelated host services. #2521 and
  #2515 need operator merge (needs code).

## 6. Fix in parallel, never by hand-merge

- **Rule:** prepare fixes in disjoint candidates while blocked. Do not merge
  under Decision 0182 C inside a run window, even between Actions. No one merges
  a live worker candidate through GitHub by hand. Preserve the freeze until a
  separately authorized integration path is proved.
- **Prevents:** the base drift that forced production Off on 11-11 (#1929).
- **Today:** holds by procedure.
- **Pending:** a merge guard that refuses a worker-candidate PR while Active
  (needs code).

## 7. Arcadia starts every session

- **Rule (target, Pending D3 and D5):** coordinator, Signal, helper and keeper
  sessions should be started, replaced and stopped by an Arcadia verb, on the
  timer or at a custodian's request. Keep the target and list coverage for each
  role: implementer, planner, researcher, plan-critic, independent reviewer, QA,
  keeper, Rowan and Signal. Launch, replace, stop and provider support are
  separate columns. Reviewer and QA stay independent Sessions under Decision
  0114. A process that started is not proof of a delivered prompt, the right
  model, or continued operation. A paste-ready prompt handed to the operator is
  a defect and gets an Issue.
- **Prevents:** the operator starting sessions by hand (for example the 3 h
  14 min Rowan gap).
- **Today:** the keeper start brief and the operator's own launches.
- **Pending:** keeper activation wiring (Decision 0190), coordinator relay
  (Decision 0191 gates 6, 9, 10 and 11), and helper start (D3 and code).

## 8. Handoffs never block

- **Rule:** the predecessor keeps custody only while it is alive and safely able
  to act. "It continues" cannot recover a dead or exhausted host. Target
  requirements: bounded no-accept cleanup; verified watchers; atomic custody
  acceptance; a stop or fence for stale writers; a governed absent-custodian
  recovery route; and renewal never overlapping a START.
- **Prevents:** a gap in coordination while a successor is missing.
- **Today:** holds by procedure. The predecessor continues until accepted.
- **Pending:** the relay launches at 60% context and the timer alarms when no
  accept comes within 10 minutes (needs code).

## 9. No silent stall

- **Rule:** measure authorized service duty separately from production Active.
  Never infer permission from "24/7 on". An explicit STOP or expired authority is
  a visible hold, not an invitation to restart. No heartbeat or "blocker routed"
  event erases an open idle episode. Twenty minutes without a merge, admission or
  routed blocker pages once. So do an empty ready list, a missing custodian (10
  minutes) and a lapsed keeper heartbeat (10 minutes).
- **Prevents:** silent stalls of the kind that ran for about 15 hours on 11-11.
- **Today:** the existing momentum alarm runs only inside a run window.
- **Pending D6:** the keeper's duty while Off (0190 says stop at Off), plus wider
  timer alarms (needs code).

## 10. Idle is measured and owned

- **Rule:** record each idle episode with its minutes, cause, owner and next
  event. Reuse the idle-front read and the digests. Deduplicate one incident per
  root episode. An episode over 60 minutes routes an investigation. It does not
  authorize new sessions or a retry. Delivery and acknowledgment are distinct.
- **Prevents:** the same stall recurring unexamined.
- **Today:** `arcadia production idle-front` already computes minutes by cause.
- **Pending:** digest reporting and the stop-the-line Issue (small code).

## 11. The operator's authority does not erode

- **Rule:** these stay with the operator: the day grant or each START press;
  spend; credentials; deletion and publication; any merge that touches an
  authority path or carries a Decision; accepting a new Plan; widening what the
  worker may merge. A session that Arcadia starts gains no authority, and
  approvals never cross sessions. Durable Decisions can be re-resolved by a
  successor. Chat-only approval cannot be copied into its capsule.
- **Prevents:** speed bought by weakening gates.
- **Today:** the existing gates, unchanged. Review rejects any housekeeping PR
  that relaxes one without a Decision.
- **Pending:** none. This rule is already in force.
- **NOT IN FORCE:** a transcript-verified approval route is drafted in
  docs/design/transcript-verified-operator-approvals.md and is NOT in force until
  Decision 0229 is recorded; until then the rule above is the only rule.

## Holds today

- By procedure alone: rules 6, 8 and 11. Rule 5 holds because the operator acts
  on the replay's finding instead of pressing past it.
- Rule 1 holds only by keeper restocking, and nothing counts it yet.
- Rules 2, 3, 4, 7, 9 and 10 and the checks behind 1, 5 and 6 need code.

## Open decisions

- D1: who may park a showstopped Action.
- D2: whether one day grant may cover an ordered list of accepted Plans.
- D3: whether Arcadia may start helper sessions.
- D4: who accepts Asks that restock the ready list.
- D5: launch enablement: bootstrap, probe budget and transport.
- D6: supervision while Off and after a coordinator replacement.

Until a Decision is recorded, the code is not authorized to act on a pending
choice.
