---
arcadia: v1
type: plan
slug: intelligence-decisions
project: arcadia
status: draft
milestone: Intelligence decisions
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
recommended_model: claude-sonnet-5
recommended_reasoning_effort: high
updated: 2026-09-29
actions:
  - id: decision-pre-triage
    title: Pre-triage each open Decision as agent-answerable or needs-operator with a recommended option.
    status: open
    responsibility: agent
    effort: session
    next_action: Pre-triage each open Decision as agent-answerable or needs-operator with a recommended option.
    expected_artifact: Evidence satisfying Agent Ask decision-pre-triage
    clarification: clarified
    confidence: high
    source: Agent Ask plan-intelligence-decisions-2026-09-29
    acceptance_criteria:
      - Each open Decision gets a label from a closed set plus a recommended option and one-line reason, computed locally with no frontier model.
      - The output is advisory and never answers, approves, or defers a Decision.
      - The operator surface shows the label so agent-answerable Decisions can be skipped.
    depends_on: []
    decisions: []
    references: []
  - id: finding-triage
    title: Triage each CodeRabbit finding as valid, decline, or needs-human with a reason.
    status: open
    responsibility: agent
    effort: session
    next_action: Triage each CodeRabbit finding as valid, decline, or needs-human with a reason.
    expected_artifact: Evidence satisfying Agent Ask finding-triage
    clarification: clarified
    confidence: high
    source: Agent Ask plan-intelligence-decisions-2026-09-29
    acceptance_criteria:
      - A finding plus its diff yields a label from a closed set and a reason, locally.
      - The label never resolves a thread or pushes a change by itself.
    depends_on: []
    decisions: []
    references: []
  - id: pr-ready-gate
    title: Decide merge-on-green versus operator-required for a PR from its facts as a pure function.
    status: open
    responsibility: agent
    effort: session
    next_action: Decide merge-on-green versus operator-required for a PR from its facts as a pure function.
    expected_artifact: Evidence satisfying Agent Ask pr-ready-gate
    clarification: clarified
    confidence: high
    source: Agent Ask plan-intelligence-decisions-2026-09-29
    acceptance_criteria:
      - Given PR facts (CodeRabbit verdict on head, required checks, merge state, Decision or authority changes) the gate returns merge-on-green or operator-required with the reason.
      - The gate implements the AGENTS.md merge-on-green exclusions and is covered by tests for each exclusion.
    depends_on: []
    decisions: []
    references: []
  - id: model-tier-selection
    title: Recommend a light, standard, or heavy model tier for an Action from its declared scope.
    status: open
    responsibility: agent
    effort: session
    next_action: Recommend a light, standard, or heavy model tier for an Action from its declared scope.
    expected_artifact: Evidence satisfying Agent Ask model-tier-selection
    clarification: clarified
    confidence: high
    source: Agent Ask plan-intelligence-decisions-2026-09-29
    acceptance_criteria:
      - An Action yields a tier recommendation with a reason, deterministic rules first.
      - The recommendation feeds recommended_model on the Plan and never overrides an explicit pin.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
---

# Intelligence decisions

Created as an inactive draft from accepted Agent Ask plan-intelligence-decisions-2026-09-29; creation changed no pointer. Current activation is recorded in frontmatter.
