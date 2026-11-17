---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-four-bounded-actions-that-make-the-arcadia-workspace
project: arcadia
status: draft
milestone: "Draft an inactive Plan of four bounded Actions that make the Arcadia Workspace the operator's planning surface: a smart picker over existing Plans that organizes, curates, archives, annotates, requests changes and queues them, plus settle, pause and resume and a clean feed in the same place"
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-17
actions:
  - id: workspace-plan-picker-list
    title: The Workspace shows every Project's Plans in one picker that the operator can filter, group and sort by status, progress, staleness and Project, with likely duplicates and fully-done-but-unclosed Plans flagged, read-only and computed without a model.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The Workspace shows every Project's Plans in one picker that the operator can filter, group and sort by status, progress, staleness and Project, with likely duplicates and fully-done-but-unclosed Plans flagged, read-only and computed without a model.
    expected_artifact: Evidence satisfying Agent Ask workspace-plan-picker-list
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-g-review-findings-20261117
    why: "Fifty-three not-yet-active Arcadia Plans in one unsorted list, some done and some duplicated, make choosing work a chat task today."
    acceptance_criteria:
      - A picker route under /workspace lists Plans across all registered Projects, with filters for status (draft, proposed, active, complete, superseded), Project and progress, and sorts by last update, progress and queue position. A component test covers each filter and sort.
      - A Plan whose Actions are all done or deferred while its status is draft or proposed is flagged 'done but not closed'. A test uses guard-against-paid-usage and record-run-unattended-test-pins-20261107.
      - Likely duplicates are flagged by a deterministic text-similarity rule over title and milestone, with the rule and threshold in one named function and its unit test. A fixture built from Arcadia's Plans shows the rule flags the pair let-the-operator-change-what-production-queues-from-the-production-project and ask-queues-approved-work-or-admits-bounded-independent-sessions-without, and the pair add-the-missing-plans-project-dashboard-route-that-lists-one-project-s-plans and i-can-see-every-project-s-plans-and-actions-understand-what-is-selected-and. The same fixture shows guard-against-paid-usage and record-run-unattended-test-pins-20261107 are not flagged as duplicates of each other. The test prints each flagged pair's score.
      - The proposed status is displayed and filtered rather than dropped, and nextPlanSelector either handles it or names it in a test as excluded from selection.
      - The picker's first paint makes no model call and no CLI call per Plan. A test asserts a single /api/plans read, and a phone-width screenshot is attached to the PR.
    depends_on: []
    decisions: []
    references: ["apps/dashboard/components/workspace/workspace-view.tsx", "apps/dashboard/components/workspace/routes/route-views.tsx", "apps/dashboard/app/api/plans/route.ts", "apps/dashboard/components/plans-list.tsx", "src/plans/nextPlanSelector.ts", "src/commands/plans.ts"]
  - id: workspace-plan-picker-actions
    title: Each Plan in the picker offers Queue next, Archive, Annotate and Request change. Each composes a governed Agent Ask preview (or calls the existing Plan-queue Ask) that shows its consequence before submission, and the Plan page lists the Asks that target it as its annotations and change history.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Each Plan in the picker offers Queue next, Archive, Annotate and Request change. Each composes a governed Agent Ask preview (or calls the existing Plan-queue Ask) that shows its consequence before submission, and the Plan page lists the Asks that target it as its annotations and change history.
    expected_artifact: Evidence satisfying Agent Ask workspace-plan-picker-actions
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-g-review-findings-20261117
    why: "The operator wants to curate, archive, annotate, request changes and prioritize existing Plans from the Workspace; today each is a sentence typed into the generic Ask box and carried by Rowan."
    acceptance_criteria:
      - Queue next composes the Plan-queue Ask defined by Action queue-approved-plans-and-start-the-next and shows the resulting order before submission. Its settlement still needs the operator's approval, and a test shows the button alone changes no queue.
      - Archive composes a Plan status change to superseded or complete with a required reason. Archived Plans are hidden by default, shown under a filter, and can be restored by the same route. Tests cover archive, filter and restore previews.
      - Annotate records free text as an Ask whose project is the Plan's Project and whose target_ref is plan/<slug>. The Plan page lists every Ask matching both that Project and that slug, newest first, with its state (previewed, pending, settled). A test shows an annotation appearing without any new store, and a test with two Projects that share a Plan slug shows each page lists only its own Project's Asks.
      - Request change composes a Plan-amendment Ask preview, carrying the Plan's Project and targeting plan/<slug>, from the operator's words and shows the preview's effects before submission.
      - Every action shows its consequence in one sentence before it runs, and none settles its own Ask. A test asserts no route under the picker calls agent-ask settle --apply.
      - Preview proposal agentask_47c04d11c94047bc95 is recorded as absorbed by this Plan, with its receipt id cited in this Action's completion evidence, and Action production-card-queue-controls in Plan let-the-operator-change-what-production-queues-from-the-production-project records through a governed amendment which part is delivered here.
    depends_on: [workspace-plan-picker-list]
    decisions: []
    references: ["apps/dashboard/components/workspace/workspace-ask.tsx", "apps/dashboard/app/api/ask", "apps/dashboard/lib/arcadia-cli.ts", "src/ask/agentAsk.ts", "src/operatorActions/planQueue.ts", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md"]
  - id: workspace-settle-pause-and-resume
    title: From the Workspace the operator can settle pending Agent Asks and answer Decisions, including those created by the picker, and pause or resume production with the existing governed panel, without visiting /runs, /todo or /actions.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: From the Workspace the operator can settle pending Agent Asks and answer Decisions, including those created by the picker, and pause or resume production with the existing governed panel, without visiting /runs, /todo or /actions.
    expected_artifact: Evidence satisfying Agent Ask workspace-settle-pause-and-resume
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-next-batch-g-workspace-plan-picker-20261117
    why: "Settlement and pause/resume exist but live on other pages; the Workspace cannot complete a picker action or stop production."
    acceptance_criteria:
      - The Workspace shows pending Agent Asks and open Decisions with their lettered options and consequences, and settling or answering goes through POST /api/approvals unchanged. A test covers one Ask and one Decision.
      - The production pause and resume panel is mounted in the Workspace with the same reactivate-preview binding and 409-on-drift behavior. The recorded reason names the Workspace instead of the hardcoded 'Switched off from the Runs dashboard.' A route test asserts both.
      - Production status (state, current Plan and Action, last merge, red alerts) is visible on the Workspace without leaving it, read from the existing status route.
      - A walkthrough recorded in the PR shows queue next, settle, pause and resume done entirely inside /workspace on 127.0.0.1, with a screenshot of each step.
    depends_on: [workspace-plan-picker-actions]
    decisions: []
    references: ["apps/dashboard/components/production-control-panel.tsx", "apps/dashboard/app/api/production-control/route.ts", "apps/dashboard/app/api/approvals/route.ts", "apps/dashboard/components/approval-queue.tsx", "apps/dashboard/components/workspace/sky/system-status.tsx"]
  - id: clear-consumed-cards-from-the-workspace-feed
    title: "The Workspace feed shows only items the operator can still act on: operator-script cards that were pressed, superseded, voided or expired leave the 'Your move' list and stay findable under a history filter."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "The Workspace feed shows only items the operator can still act on: operator-script cards that were pressed, superseded, voided or expired leave the 'Your move' list and stay findable under a history filter."
    expected_artifact: Evidence satisfying Agent Ask clear-consumed-cards-from-the-workspace-feed
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-next-batch-g-workspace-plan-picker-20261117
    why: "About twenty consumed START and activation cards sit above live Decisions in today's feed, which buries what needs the operator."
    acceptance_criteria:
      - A pure function classifies each operator-script item as actionable, pressed, superseded, voided or expired from its receipts and expiry. Fixture tests cover each state with recorded cards, including start-run-standing-plan-e-press-successor-prove-20261117a (voided) and ...20261117b (pressed).
      - "'Your move' lists only actionable items; the others appear under a history filter with their end state and time in the operator's local zone. A test asserts the live feed fixture drops from about twenty run items to the actionable ones."
      - No card file, receipt or Decision is deleted or rewritten; the change is display-only. A test asserts the operator-script library is byte-identical before and after rendering.
    depends_on: []
    decisions: []
    references: ["apps/dashboard/app/workspace/feed/page.tsx", "apps/dashboard/components/workspace/feed", "src/operatorActions/libraryContract.ts", "docs/agent-guidance/operator-actions.md"]
questions: []
decisions: []
---

# Draft an inactive Plan of four bounded Actions that make the Arcadia Workspace the operator's planning surface: a smart picker over existing Plans that organizes, curates, archives, annotates, requests changes and queues them, plus settle, pause and resume and a clean feed in the same place

Created as an inactive draft from accepted Agent Ask ellis-next-batch-g-workspace-plan-picker-20261117; creation changed no pointer. Current activation is recorded in frontmatter.
