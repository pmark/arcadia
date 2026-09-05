---
arcadia: v1
type: plan
slug: create-one-inactive-plan-for-on-demand-evidence-based-adversarial-review-of-a-se
project: arcadia
status: draft
milestone: Create one inactive plan for on-demand, evidence-based adversarial review of a selected PR, Action, Artifact, or plan.
token_impact: medium
token_budget: Deterministic management; one bounded coding-agent implementation pass after activation.
updated: 2026-09-05
actions:
  - id: define-independent-review-contract
    title: Define the read-only review request, evidence packet, verdict, finding, and recommended-next-move contract for selected Arcadia objects.
    status: open
    responsibility: agent
    effort: session
    next_action: Define the read-only review request, evidence packet, verdict, finding, and recommended-next-move contract for selected Arcadia objects.
    expected_artifact: Evidence satisfying Agent Ask define-independent-review-contract
    clarification: clarified
    confidence: high
    source: Agent Ask independent-review-contract-plan-2026-09-05
    acceptance_criteria:
      - A review request identifies one canonical target and records its evidence sources.
      - Output has an executive summary, thumbs-up/down verdict, evidence, findings, and exactly one recommended next Action.
      - The contract states that review cannot alter repository, governance, execution, or external state.
      - The plan names its activation trigger and defers implementation until it fires.
    depends_on: []
    decisions: []
    references: [docs/proposals/complete-managed-action-from-evidence.md, docs/mission-control-view/11-existing-surfaces-audit.md]
questions: []
decisions: []
---

# Create one inactive plan for on-demand, evidence-based adversarial review of a selected PR, Action, Artifact, or plan.

Created from accepted Agent Ask independent-review-contract-plan-2026-09-05. This draft is not active and changes no pointer.
