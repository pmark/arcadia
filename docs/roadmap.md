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

### Plans A-D and the freeze

Four draft Plans were registered on main by #3114 after "Approve plans A through D". Each is in `docs/plans/<slug>.md` (#3114). The letters are labels. Nothing in the sources puts A-D in an order beyond the admissions below.

- **A**, `one-stop-never-ends-the-card-20261126` (milestone "One stop never ends the card 20261126") (#3114).
- **B**, `production-runs-clean-by-itself-20261126` (milestone "Production runs clean by itself 20261126") (#3114).
- **C**, `nights-never-run-empty-20261126` (milestone "Nights never run empty 20261126") (#3114).
- **D**, `coordinator-and-refusals-recover-without-the-operator-20261126` (milestone "Coordinator and refusals recover without the operator 20261126") (#3114).

#3114 says the Plans are registered as inactive drafts and that nothing is activated or queued.

**Freeze.** The engine is frozen at `a5f041066`. A PR that changes an engine path merges only as a fix for a named failed-night cause, or when it is admitted through the freeze (docs/strategy/current.md, "Phase 1: Freeze and prove" and the admission sections).

**Order stated for A-D** (docs/strategy/current.md, "Admission (Thu 2026-11-26): '1B 2B, sequenced'"):

1. Now: coding sessions build the safety set, starting with "those two fixes": Plan A Action 2 (`continue-past-a-stopped-action`) and Plan B Action 4 (`launch-production-builds-on-the-plan-model-rule`).
2. Once both fixes have merged: production may build these Plans' Actions overnight, after a full rule-1 dress rehearsal, with its clean-run count starting at 0.
3. The night-continuity pieces (Plan C Actions 3 and 4, Plan D Action 3) follow the safety set. Their new press-path code needs an unstubbed rule-1 rehearsal before live use.

**Admitted through the freeze** (docs/strategy/current.md, the admission sections; each admitted PR cites its admission Issue as `Phase-cause: #N`):

| Admission | Admitted | Admission Issue |
|---|---|---|
| "1A 2A" (Wed 2026-11-25) | #3033, #3036, #3006, #3028, #3025, #2980 | Phase-cause Issues named in the verdict |
| "1B 2B, sequenced" (Thu 2026-11-26) | Plan A Actions 1 to 3; Plan B Actions 1 to 4; Plan C Actions 1 to 4; Plan D Actions 2 and 3; Plan D Action 1 (#3080) once its N2 is repaired; #3083 (B12) as reviewed; #2960 (B9) after its rebase | #3116 |
| "Yes, A" on #3122 (Thu 2026-11-26, evening) | the small #3122 fix (`scripts/start-run.sh` only) | #3158 |
| "Pressed, A" on the in-card quiet check (Fri 2026-11-27, afternoon) | the in-card quiet check plus the #3184 fix (`scripts/start-run.sh`, and the dashboard status under `apps/dashboard/`) | #3189 |

Not admitted: the worker-thread fix #3154 waits for the next checkpoint, and every other held engine PR (docs/strategy/current.md, "Pressed, A" section). #3136 is admitted as Plan A Action 2 (docs/strategy/current.md, "Yes, A" section).

**F, G and H.** The text above is unchanged. docs/strategy/current.md does not mention F, G or H, so it does not supersede them.

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
- Gap: the sources do not state how Plans A-D are ordered against F, G and H (docs/strategy/current.md; #3114). Not decided here.
- Gap: the sources do not order A, B, C and D against each other, beyond Plan A Action 2 and Plan B Action 4 coming first (docs/strategy/current.md, "1B 2B, sequenced"). Letters are labels only.
- Gap: the "safety set" that coding sessions build is named only by its start ("starting with those two fixes"). Its other members and their order are not listed (docs/strategy/current.md, "1B 2B, sequenced").
- Gap: the order of the in-card quiet check (#3189) against Plans A-D is not stated. The source says only that it is built after Track 6 card B's run (docs/strategy/current.md, "Pressed, A").

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
