# Arcadia roadmap and work intake

This page is the captured list of features we want, so plan time is spent on prioritization. It holds **order and rules only**. Each Action's status lives in its Plan, so this page never needs a status edit, and it is changed only when a Plan is added, reordered or retired.

## Goal

The operator plans each day in the Arcadia Workspace, and production runs it unattended overnight. The operator is asked only about what is decisive: queue approval, Decisions, authority merges, spend and credentials.

## Plan order (operator direction, 2026-11-18: "A: F, then G"; not a Decision)

1. **F**, `draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production`: keep the loop alive.
2. **G**, `draft-an-inactive-plan-of-four-bounded-actions-that-make-the-arcadia-workspace`: the Workspace planning surface. It is the first Plan started from F's Plan queue.
3. **H**, `draft-an-inactive-plan-of-seven-bounded-actions-that-host-the-coordinators`: hosted coordinators, the relay and timer-launched helpers.
4. **Later.** Each item has a revival trigger:
   - Creating Plans in the Workspace: when G is done.
   - Per-project queues and concurrency: when the two concurrency proofs named in Decisions 0066 and 0071 are done.
   - Curating the draft-Plan backlog: when G's picker ships, as its first real use.

## Capability map (owner Plan#Action; status lives there)

| Capability | Owner |
|---|---|
| Timer presses the next card | F#run-successor-press-from-a-current-timer-release, F#prove-the-timer-runs-the-successor-press-live |
| Merges to main don't kill the loop | F#retry-successor-press-when-main-moves, F#refuse-agent-merges-while-a-card-is-pinned |
| Red candidates repaired | F#wire-mechanical-repair-into-production, F#repair-red-candidates-with-a-bounded-session |
| Fewer red candidates | F pre-pr block (P1–P5) |
| Serial hand-off doesn't stall | F hand-off block (M1–M3) |
| Pointer integrity | F#reconcile-current-action-after-a-base-merge, F#keep-pointer-commits-mergeable-across-a-date-change |
| Next approved Plan starts automatically | F#queue-approved-plans-and-start-the-next |
| Decision ids never collide | F#allocate-decision-numbers-on-main-and-refuse-duplicates |
| "Done" means proven and wired in | Proposed: F gap amendment (proof per met criterion); pending the operator's pick |
| Card readiness known at noon | Proposed: F gap amendment (noon check); pending the operator's pick |
| Rowan handoff without the operator | F#accept-registration-after-a-recorded-stand-down, then H's relay Actions |
| Timer-launched helpers | H#launch-helpers-from-the-timer and the Actions after it |
| Plan picker, queue controls, settle, pause, a clean feed | G, all four Actions |

## Open Decisions that shape this roadmap

- In-run merges overnight (draft `ellis-decision-in-run-merges-20261118`).
- Publishing controller settle commits (menu question G).
- Judging authority by the files an Action changes, so derived cards can run work. Not drafted yet; without it the standing grant derives nothing.

Decided, with a later governed step still to come: Decision 0246 (answer A, 2026-11-16) renews Decision 0191 once two automatic handoffs are on record. The renewal itself is that later step.

## Intake: where a newly found bug or task goes

Capture first (`arcadia learn` or an Issue), then classify by urgency. Use the most specific class that fits.

| Class | Test | Where it goes | Who decides |
|---|---|---|---|
| **U0 stop-the-line** | Production can't run tonight, data or authority is at risk, or main is red | Fixed now: a hand fix in the gap, or the top of the active Plan with `--top` and ordering edges so it runs next. Follows the stop-the-line rule in docs/agent-guidance/hacker-recovery.md | Rowan acts; Signal tells the operator |
| **U1 next night** | It stalls nights or costs a hand fix on most batches | Top of the active Plan's remaining queue, right after the in-flight batch | Operator approves the queue change (0241 E) in the noon menu |
| **U2 this Plan** | It belongs to the active Plan's goal but doesn't stall nights | End of the active Plan, before its gap Actions | Operator approves in the noon menu |
| **U3 backlog** | Everything else | A later Plan, or the backlog Plan the picker can queue, with a revival trigger | No approval needed to record it; queueing needs one |

**How to insert:**
1. Write the Actions as a plan-intent Agent Ask that targets the active Plan.
2. Queue order is the Plan file's remaining Actions in dependency order (`src/dispatch/actionOrder.ts`), and `--before` cannot anchor inside the active Plan. So you place new Actions by adding **ordering-only dependencies**, labelled as such in the rationale, and settle with `--top`.
3. Before sending, simulate the resulting order with `dependencyOrderedActionIds` and write the order into the Ask's rationale.
4. Freeze the bytes and send the path and sha256. The settler settles only the sha the operator approved.

## The daily rhythm

This section describes the working rhythm; it grants nothing. Press, merge and Plan authority come only from recorded Decisions (START presses: the operator's press or the standing grant, Decision 0241) and the operator.

**Operator direction (2026-11-18, not yet a Decision):** keep the Plans for the **next 48 hours** ready at all times, so daily planning is prioritization, not heavy planning work. Each morning by 7:30 AM the planner reports which Plans and Actions are ready for tonight and tomorrow night, and which are not and why, ranked by how many unattended hours each would add. The report is refreshed whenever a bug is inserted.

- **8 AM:** digest.
- **Noon:** the operator answers the one-line menu (placement, scope, Decisions).
- **Afternoon gap:** settle amendments and run host steps.
- **7:30 PM:** freeze on main.
- **8 PM:** card minted; replay and preflight.
- **8:15 PM:** pre-mortem.
- **8:30 PM:** ping with the exact card title.
- **9 PM:** press, by whoever holds press authority that night.
