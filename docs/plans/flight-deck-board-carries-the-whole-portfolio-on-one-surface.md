---
arcadia: v1
type: plan
slug: flight-deck-board-carries-the-whole-portfolio-on-one-surface
project: arcadia
status: active
milestone: Flight Deck board carries the whole portfolio on one surface
token_impact: medium
token_budget: Deterministic management; one bounded coding-agent implementation pass after activation.
recommended_model: claude-sonnet-5
updated: 2026-09-05
actions:
  - id: project-plan-lanes-and-pipeline-columns
    title: Project every object from `advance queue` and `dashboard snapshot` into one swimlane board whose lanes are Plans within a Project and whose columns are Arcadia's dispatch gates — Needs You, Ready to dispatch, Running, Proving, Landed — with objects that name no Plan placed in an explicit unattached lane rather than hidden or invented into one.
    status: open
    responsibility: agent
    effort: session
    next_action: Render every governed object as one swimlane board whose lanes are Plans within a Project and whose columns are Arcadia's dispatch gates, placing objects that name no Plan in an explicit unattached lane.
    expected_artifact: Evidence satisfying Agent Ask project-plan-lanes-and-pipeline-columns
    clarification: clarified
    confidence: high
    source: Agent Ask flight-deck-board-verb-first-2026-09-04
    acceptance_criteria:
      - A route renders lanes grouped by Project then Plan, each lane band naming the Plan and its Milestone.
      - The columns are Needs You, Ready to dispatch, Running, Proving and Landed, in that order.
      - Every Action, Decision, Run and Artifact from the work-queue and snapshot endpoints appears exactly once, in exactly one column.
      - A Decision with no derivable Plan appears in that Project's unattached lane and says so, and no Decision is silently dropped.
      - The column a card lands in is derived from its own state, and the derivation is covered by tests over fixtures.
    depends_on: []
    decisions: []
    references: [apps/dashboard/app/api/work-queue/route.ts, apps/dashboard/app/api/snapshot/route.ts, apps/dashboard/lib/work-queue-types.ts, apps/dashboard/lib/types.ts, apps/dashboard/lib/needs-you.ts, docs/plans/mission-control-view/09-flight-deck-board-build-spec.md]
  - id: open-the-object-detail-rail
    title: Selecting a card opens a rail carrying that object's full record and its relationship chain — Project, Plan, Action, Decision, Artifact — with every edge named, so an operator never reads a Decision without the work it belongs to.
    status: open
    responsibility: agent
    effort: session
    next_action: Open a detail rail on card selection that carries the object's full record and its relationship chain, with every node typed and every edge named.
    expected_artifact: Evidence satisfying Agent Ask open-the-object-detail-rail
    clarification: clarified
    confidence: high
    source: Agent Ask flight-deck-board-verb-first-2026-09-04
    acceptance_criteria:
      - The rail shows the chain Project, Plan, Action, Decision, Artifact with each node labeled by its Arcadia type and each edge labeled with its relation.
      - An Action's rail shows expected Artifact, acceptance criteria, dependencies, required Decisions, token budget, and every blocker with its remedy.
      - A Decision's rail shows the decision needed, options, recommendation and prompt packet path where each exists, and states plainly when the link to an Action could not be derived.
      - The rail closes with Escape and returns focus to the card that opened it.
    depends_on: [project-plan-lanes-and-pipeline-columns]
    decisions: []
    references: [docs/plans/mission-control-view/09-flight-deck-board-build-spec.md]
  - id: carry-the-dispatch-command
    title: Every card that can move carries the exact command that moves it, so the gap between "this is ready" and "a session is running" is one copy rather than a hunt through the CLI.
    status: open
    responsibility: agent
    effort: session
    next_action: Show the exact dispatch command on every card that can move, so reaching a coding session is one copy rather than a hunt through the CLI.
    expected_artifact: Evidence satisfying Agent Ask carry-the-dispatch-command
    clarification: clarified
    confidence: high
    source: Agent Ask flight-deck-board-verb-first-2026-09-04
    acceptance_criteria:
      - A ready Action shows the literal `arcadia go` invocation for its own repositoryRoot, including the agent and the flags that reconcile and launch.
      - A Decision shows the literal `arcadia review` invocation against its own id.
      - Copying works, and where the clipboard is unavailable the command is selected instead so it can still be copied by hand.
      - The board never starts a process itself; process creation stays with the operator's terminal.
    depends_on: [project-plan-lanes-and-pipeline-columns]
    decisions: []
    references: [src/commands/go.ts, apps/dashboard/lib/arcadia-cli.ts]
  - id: focus-the-board-on-active-work
    title: Open the board on the handful of objects that can actually move today, with everything else one click away rather than deleted, so a 54-object portfolio does not read as a 54-object demand.
    status: open
    responsibility: agent
    effort: session
    next_action: Open the board on active-plan work and collapse every dormant lane behind one click, so a 54-object portfolio does not read as a 54-object demand.
    expected_artifact: Evidence satisfying Agent Ask focus-the-board-on-active-work
    clarification: clarified
    confidence: high
    source: Agent Ask flight-deck-board-verb-first-2026-09-04
    acceptance_criteria:
      - Lanes for the active plan are expanded by default and every other lane is collapsed to a labeled row carrying its object count.
      - A Project filter is present and the board opens filtered to the Projects that have an active plan.
      - Expanding, collapsing or filtering never changes any Arcadia state.
      - The visible object count and the portfolio total are both shown, so nothing appears to have been hidden.
    depends_on: [project-plan-lanes-and-pipeline-columns]
    decisions: []
    references: [docs/plans/mission-control-view/09-flight-deck-board-build-spec.md]
questions: []
decisions: []
---

# Flight Deck board carries the whole portfolio on one surface

Created from accepted Agent Ask flight-deck-board-2026-09-04b. Activated
2026-09-05 on operator direction: `way-delivery` reached its milestone, and
this plan is the one Arcadia's own recorded milestone already pointed at
next. `PROJECT.md`'s `active_plan` and `current_action` now point here, at
`project-plan-lanes-and-pipeline-columns` — the only Action in this plan
with no unmet dependency. Activation only; no Action has been implemented
yet.
