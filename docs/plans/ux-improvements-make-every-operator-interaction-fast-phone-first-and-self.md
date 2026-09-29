---
arcadia: v1
type: plan
slug: ux-improvements-make-every-operator-interaction-fast-phone-first-and-self
project: arcadia
status: draft
milestone: "UX improvements: make every operator interaction fast, phone-first, and self-updating, so the operator never waits on or hunts through a page."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
recommended_model: claude-sonnet-5
recommended_reasoning_effort: high
updated: 2026-09-29
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
questions: []
decisions: []
---

# UX improvements: make every operator interaction fast, phone-first, and self-updating, so the operator never waits on or hunts through a page.

Created as an inactive draft from accepted Agent Ask plan-ux-improvements-2026-09-29; creation changed no pointer. Current activation is recorded in frontmatter.
