---
arcadia: v1
type: plan
slug: ux-improvements-make-every-operator-interaction-fast-phone-first-and-self
project: arcadia
status: draft
milestone: "UX improvements: make every operator interaction fast, phone-first, and self-updating, so the operator never waits on or hunts through a page."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
recommended_model: standard
recommended_reasoning_effort: high
updated: 2026-10-11
actions:
  - id: lazy-decisions-on-runs
    title: Load Decisions on /runs only when the operator opens them.
    status: open
    responsibility: agent
    effort: session
    next_action: Load Decisions on /runs only when the operator opens them.
    expected_artifact: Evidence satisfying Agent Ask lazy-decisions-on-runs
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-improvements-2026-09-29
    acceptance_criteria:
      - The initial /runs render performs no Decision loading.
      - Opening the Decisions area loads them on demand and shows them.
    depends_on: []
    decisions: []
    references: []
  - id: per-decision-view
    title: Give each Decision its own instantly loading page with its state and answer controls.
    status: open
    responsibility: agent
    effort: session
    next_action: Give each Decision its own instantly loading page with its state and answer controls.
    expected_artifact: Evidence satisfying Agent Ask per-decision-view
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-improvements-2026-09-29
    acceptance_criteria:
      - A Decision has a stable URL that renders only that Decision without loading others.
      - The page shows current state and updates it without a manual reload after the operator answers.
    depends_on: [lazy-decisions-on-runs]
    decisions: []
    references: []
  - id: per-run-view
    title: Give each run its own instantly loading page with live state updates.
    status: open
    responsibility: agent
    effort: session
    next_action: Give each run its own instantly loading page with live state updates.
    expected_artifact: Evidence satisfying Agent Ask per-run-view
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-improvements-2026-09-29
    acceptance_criteria:
      - A run has a stable URL that renders only that run without loading others.
      - State changes for that run appear on the page without a manual reload.
    depends_on: []
    decisions: []
    references: []
  - id: discord-channel-routing
    title: Route Discord notifications to purpose-specific channels instead of only the root Arcadia channel.
    status: open
    responsibility: agent
    effort: session
    next_action: Route Discord notifications to purpose-specific channels instead of only the root Arcadia channel.
    expected_artifact: Evidence satisfying Agent Ask discord-channel-routing
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-improvements-2026-09-29
    acceptance_criteria:
      - Each notification class (PR lifecycle, Decisions, blockers) posts to a configured channel.
      - The operator can tell from the channel whether a PR-opened ping was delivered.
      - Delivery status in receipts reads as queued until sent, not pending indefinitely.
    depends_on: []
    decisions: []
    references: []
  - id: operator-ux-audit
    title: Audit every operator-facing interaction against phone-first speed and clarity and list the fixes.
    status: open
    responsibility: agent
    effort: session
    next_action: Audit every operator-facing interaction against phone-first speed and clarity and list the fixes.
    expected_artifact: Evidence satisfying Agent Ask operator-ux-audit
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-improvements-2026-09-29
    acceptance_criteria:
      - Every operator page, button, and notification is timed or reviewed on a phone-width viewport.
      - Each finding is filed as a governed Action or GitHub Issue.
    depends_on: []
    decisions: []
    references: []
  - id: local-model-session-advisory
    title: Label unmatched or stalled session states with a one-line diagnosis from a closed set using the local model.
    status: open
    responsibility: agent
    effort: session
    next_action: Label unmatched or stalled session states with a one-line diagnosis from a closed set using the local model.
    expected_artifact: Evidence satisfying Agent Ask local-model-session-advisory
    clarification: clarified
    confidence: high
    source: Agent Ask local-model-session-advisory-2026-09-29
    acceptance_criteria:
      - The local model runs only on a state the deterministic classifier could not label, never on every tick.
      - Its output is one label from a closed set plus a one-line reason, logged with the pane excerpt used.
      - Its output is advisory and cannot approve, merge, settle, or change Action state.
    depends_on: []
    decisions: []
    references: []
  - id: dashboard-ask-heard-receipt-and-correction-menu
    title: After a Dashboard Ask submit, show the Heard receipt and a one-tap menu of alternative next steps that re-route the Ask through arcadia ask correct.
    status: open
    responsibility: agent
    effort: session
    next_action: After a Dashboard Ask submit, show the Heard receipt and a one-tap menu of alternative next steps that re-route the Ask through arcadia ask correct.
    expected_artifact: Evidence satisfying Agent Ask dashboard-ask-heard-receipt-and-correction-menu
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-ask-menu-task-option-gated-2026-10-11
    why: "An unmatched Ask must be correctable at the moment of capture, not found later in arcadia todo."
    acceptance_criteria:
      - The Ask capture result shows the Heard line (type, confidence, source, what was created and where) before any other detail.
      - A menu offers every correction type arcadia ask correct accepts at implementation time (work in a chosen Project, idea, status question, answer to a named pending Decision); an operator task option appears only once ask correct accepts a task type (Action ask-do-for-me-operator-tasks). Choosing one calls the same writers as arcadia ask correct and shows the superseding receipt.
      - An answer correction requires an explicit pending Decision reference and is refused otherwise.
      - The menu works with the relationship map absent or failing.
      - Tests cover each correction target and the refusal; type, lint and build pass; a pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: []
    decisions: []
    references: ["src/commands/askCorrect.ts", "src/ask/heard.ts", "src/ask/corrections.ts", "apps/dashboard/app/capture", "docs/plans/operator-to-do-list-with-ask-only-input.md"]
  - id: dashboard-ask-evidence-panel
    title: Show on the Ask capture screen what the Ask created or did not create and where it sits in which Project Plan and queue position.
    status: open
    responsibility: agent
    effort: session
    next_action: Show on the Ask capture screen what the Ask created or did not create and where it sits in which Project Plan and queue position.
    expected_artifact: Evidence satisfying Agent Ask dashboard-ask-evidence-panel
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-dashboard-ask-correction-and-map-2026-10-11
    why: "The operator needs evidence that an Ask became prioritized work, or a plain statement that it did not."
    acceptance_criteria:
      - "The panel shows the ask-trail result for the capture: each Action, Decision or Back Burner item produced, its Project, Plan and queue position, or an explicit statement that nothing was created."
      - An Ask that produced only a question says so and links the open question.
      - Tests cover the produced and not-produced cases; type, lint and build pass; a pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [dashboard-ask-heard-receipt-and-correction-menu]
    decisions: []
    references: ["src/commands/askTrail.ts", "apps/dashboard/lib/arcadia-cli.ts"]
  - id: dashboard-ask-relationship-map
    title: Draw a relationship map of a just-submitted Ask and its connected topics, Projects, Plans, Actions, services, agents and Sessions, after choosing between a Markmap mindmap and a D3 force-directed graph.
    status: open
    responsibility: agent
    effort: session
    next_action: Draw a relationship map of a just-submitted Ask and its connected topics, Projects, Plans, Actions, services, agents and Sessions, after choosing between a Markmap mindmap and a D3 force-directed graph.
    expected_artifact: Evidence satisfying Agent Ask dashboard-ask-relationship-map
    clarification: clarified
    confidence: high
    source: Agent Ask plan-ux-dashboard-ask-correction-and-map-2026-10-11
    why: "The map shows the Ask in context and aids routing; it is secondary to the correction menu."
    acceptance_criteria:
      - A short recorded comparison of Markmap and a D3 force-directed graph, judged on non-hierarchical links, phone legibility and bundle cost, names the chosen renderer.
      - The map renders immediately after submit from deterministic data only, with no model call, and nodes link to their Project, Plan, Action or Session pages.
      - The correction menu stays usable when the map is slow, empty or errors.
      - Tests cover rendering with and without connections; type, lint and build pass; a pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [dashboard-ask-heard-receipt-and-correction-menu]
    decisions: []
    references: ["docs/plans/mission-control-view/03-urgency-and-force-model.md", "apps/dashboard/app/capture"]
questions: []
decisions: []
---

# UX improvements: make every operator interaction fast, phone-first, and self-updating, so the operator never waits on or hunts through a page.

Created as an inactive draft from accepted Agent Ask plan-ux-improvements-2026-09-29; creation changed no pointer. Current activation is recorded in frontmatter.
