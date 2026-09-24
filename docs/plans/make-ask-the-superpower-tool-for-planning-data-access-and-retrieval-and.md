---
arcadia: v1
type: plan
slug: make-ask-the-superpower-tool-for-planning-data-access-and-retrieval-and
project: arcadia
status: draft
milestone: "Make Ask the superpower tool for planning, data access and retrieval, and reporting: anything the operator asks is captured, classified, routed to the right Project, turned into governed work or an answer, and always traceable, so no Action or other entity is ever lost after an Ask. \"Ask Arcadia\" and \"Ask an agent\" are the complement of the managed production system."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-09-24
actions:
  - id: align-ask-superpower-outcome
    title: Run the Outcome Alignment Interview for Ask as the planning, retrieval, and reporting complement to managed production, and record the ratified Outcome and scoped capability list.
    status: open
    responsibility: agent
    effort: session
    next_action: Run the Outcome Alignment Interview for Ask as the planning, retrieval, and reporting complement to managed production, and record the ratified Outcome and scoped capability list.
    expected_artifact: Evidence satisfying Agent Ask align-ask-superpower-outcome
    clarification: clarified
    confidence: high
    source: Agent Ask ask-superpower-plan-2026-09-23
    acceptance_criteria:
      - An Outcome statement for Ask covering planning, data access/retrieval, and reporting is recorded and ratified by the operator.
      - The capability list names which Ask requests become governed work, which return answers or reports, and which surface Ask Arcadia versus Ask an agent handles.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/589", "https://github.com/pmark/arcadia/issues/591", "docs/planning-process.md"]
  - id: trace-every-ask-to-its-outcome
    title: Record the capture id on every entity an Ask produces and give one read command and dashboard view that shows an Ask's full trail.
    status: open
    responsibility: agent
    effort: session
    next_action: Record the capture id on every entity an Ask produces and give one read command and dashboard view that shows an Ask's full trail.
    expected_artifact: Evidence satisfying Agent Ask trace-every-ask-to-its-outcome
    clarification: clarified
    confidence: high
    source: Agent Ask ask-superpower-plan-2026-09-23
    acceptance_criteria:
      - Every ask request, Back Burner item, Action, Decision, and review item created from an Ask records its capture id.
      - One command given a capture or request id prints the capture, classification and reason, routed Project, and every resulting entity with its current status.
      - The dashboard Ask receipt links to that trail.
    depends_on: [align-ask-superpower-outcome]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/589", "https://github.com/pmark/arcadia/issues/591", "docs/planning-process.md"]
  - id: route-execution-shaped-asks-to-planning
    title: Classify imperative, execution-shaped Asks as work for their resolved Project instead of shelving them as Ideas when an incidental hedge word appears.
    status: open
    responsibility: agent
    effort: session
    next_action: Classify imperative, execution-shaped Asks as work for their resolved Project instead of shelving them as Ideas when an incidental hedge word appears.
    expected_artifact: Evidence satisfying Agent Ask route-execution-shaped-asks-to-planning
    clarification: clarified
    confidence: high
    source: Agent Ask ask-superpower-plan-2026-09-23
    acceptance_criteria:
      - The input from capture_20e52d3f-15bc-4d17-8769-0e576b653126 is classified as an execution request for the Arcadia Project in a regression test.
      - Hedge words shelve an Ask only when they govern the request itself, with tests for both cases.
    depends_on: [align-ask-superpower-outcome]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/589", "https://github.com/pmark/arcadia/issues/591", "docs/planning-process.md"]
questions: []
decisions: []
---

# Make Ask the superpower tool for planning, data access and retrieval, and reporting: anything the operator asks is captured, classified, routed to the right Project, turned into governed work or an answer, and always traceable, so no Action or other entity is ever lost after an Ask. "Ask Arcadia" and "Ask an agent" are the complement of the managed production system.

Created as an inactive draft from accepted Agent Ask ask-superpower-plan-2026-09-23; creation changed no pointer. Current activation is recorded in frontmatter.
