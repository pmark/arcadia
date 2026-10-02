---
arcadia: v1
type: plan
slug: i-can-see-every-project-s-plans-and-actions-understand-what-is-selected-and
project: arcadia
status: draft
milestone: I can see every Project's Plans and Actions, understand what is selected and what is actually running, and identify what needs me.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-02
actions:
  - id: define-flight-deck-tree-data-contract
    title: Establish a read-only Project → Plan → Action tree data contract derived only from existing canonical records.
    status: open
    responsibility: autonomous
    effort: session
    next_action: Establish a read-only Project → Plan → Action tree data contract derived only from existing canonical records.
    expected_artifact: apps/dashboard/lib/flight-deck-tree.ts (typed read-only contract + builder) and its unit tests
    clarification: clarified
    confidence: high
    source: Agent Ask plan-flight-deck-execution-tree-2026-10-01
    acceptance_criteria:
      - A typed, read-only tree contract and its builder exist, deriving Plan status, done/open counts, Action status, dependencies, blocker, selected pointer, live Sessions, needs-operator state, and Action/Run/approval/Issue links only from existing canonical records.
      - Selected is the canonical current_action at its actual Plan scope, and Running is derived independently from live Session records, so one Action may be selected without running and several Actions may be running at once.
      - The contract carries a refreshed-at timestamp and explicit stale and conflicting flags, and introduces no stored status field, table, or scheduler.
      - Unit tests cover simultaneous Sessions, a selected-but-blocked Action, completed work awaiting integration, and a pointer/Session conflict.
    depends_on: []
    decisions: []
    references: ["apps/dashboard/app/flight-deck/page.tsx", "apps/dashboard/lib/flight-deck.ts", "apps/dashboard/lib/work-queue-types.ts", "apps/dashboard/components/plans-list.tsx", "docs/decisions/0077-choose-where-flight-deck-evidence-and-the-production-on-off-control-belong-in.md"]
  - id: build-flight-deck-execution-tree
    title: Build the expandable Project → Plan → Action tree on Flight Deck using existing Flight Deck components.
    status: open
    responsibility: autonomous
    effort: session
    next_action: Build the expandable Project → Plan → Action tree on Flight Deck using existing Flight Deck components.
    expected_artifact: Expandable Project → Plan → Action tree on /flight-deck with Selected, Running, and Needs operator indicators, filters, and refreshed/stale/conflict display
    clarification: clarified
    confidence: high
    source: Agent Ask plan-flight-deck-execution-tree-2026-10-01
    acceptance_criteria:
      - /flight-deck renders an expandable Project → Plan → Action tree from the data contract using existing dashboard components, with no new write path.
      - Each Action row shows status, dependencies, and blocker, plus distinctly labeled Selected, Running, and Needs operator indicators, and links to its existing Action, Run, approval, and GitHub Issue where they exist.
      - The view shows the last refreshed time and renders stale or conflicting state explicitly rather than hiding it.
      - The default view shows active work, and filters reveal completed and inactive Plans.
    depends_on: [define-flight-deck-tree-data-contract]
    decisions: []
    references: ["apps/dashboard/app/flight-deck/page.tsx", "apps/dashboard/lib/flight-deck.ts", "apps/dashboard/lib/work-queue-types.ts", "apps/dashboard/components/plans-list.tsx", "docs/decisions/0077-choose-where-flight-deck-evidence-and-the-production-on-off-control-belong-in.md", "apps/dashboard/components/dashboard-ui.tsx"]
  - id: validate-flight-deck-tree-on-real-state
    title: Validate the Flight Deck tree against real Arcadia and PPN state.
    status: open
    responsibility: autonomous
    effort: session
    next_action: Validate the Flight Deck tree against real Arcadia and PPN state.
    expected_artifact: Validation Artifact under artifacts/ with screenshots of the live tree against real Arcadia and PPN state
    clarification: clarified
    confidence: high
    source: Agent Ask plan-flight-deck-execution-tree-2026-10-01
    acceptance_criteria:
      - A validation Artifact with screenshots of the live tree against real Arcadia and PPN state shows simultaneous running Sessions, a selected-but-blocked Action, and completed work awaiting integration, each labeled correctly.
      - The Artifact confirms from the tree alone what is running, what is next, and what needs the operator, without opening any Session.
      - Every discrepancy between the tree and canonical records found during validation is fixed or filed as a GitHub Issue linked from the Artifact.
    depends_on: [build-flight-deck-execution-tree]
    decisions: []
    references: ["apps/dashboard/app/flight-deck/page.tsx", "apps/dashboard/lib/flight-deck.ts", "apps/dashboard/lib/work-queue-types.ts", "apps/dashboard/components/plans-list.tsx", "docs/decisions/0077-choose-where-flight-deck-evidence-and-the-production-on-off-control-belong-in.md"]
questions: []
decisions: []
---

# I can see every Project's Plans and Actions, understand what is selected and what is actually running, and identify what needs me.

Created as an inactive draft from accepted Agent Ask plan-flight-deck-execution-tree-2026-10-01; creation changed no pointer. Current activation is recorded in frontmatter.
