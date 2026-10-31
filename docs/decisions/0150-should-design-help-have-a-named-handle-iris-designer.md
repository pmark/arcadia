---
arcadia: v1
type: decision
id: "0150"
slug: should-design-help-have-a-named-handle-iris-designer
project: arcadia
status: open
question: Should design help have a named handle, Iris — Designer?
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Optional Iris handle
options:
  - label: Optional Iris handle
    consequence: Add Iris — Designer as an optional persona on the planner Role, invoked mainly by function; asking for design help works with or without the name. Revives Decision 0068's deferral for this one persona.
    recommended: true
  - label: Function only
    consequence: Design help is requested by function and field specialization, with no named handle. Same capability; Decision 0068's deferral stands.
    recommended: false
  - label: New registered Role
    consequence: Add an eighth registered Role for design. Changes the role taxonomy and authority (Decisions 0100 and 0114); not recommended.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
---

# Decision 0150: Should design help have a named handle, Iris — Designer?

## Options

- **Optional Iris handle** (recommended): Add Iris — Designer as an optional persona on the planner Role, invoked mainly by function; asking for design help works with or without the name. Revives Decision 0068's deferral for this one persona.
- **Function only**: Design help is requested by function and field specialization, with no named handle. Same capability; Decision 0068's deferral stands.
- **New registered Role**: Add an eighth registered Role for design. Changes the role taxonomy and authority (Decisions 0100 and 0114); not recommended.

## Rationale

Gates create-portable-design-facilitation-skill. Revives Decision 0068's deferral of named content personas, whose trigger was a concrete task needing a named persona. Source: docs/design/agent-naming-and-design-help/README.md, section 10, converged after four reviews. Opened by Action open-naming-and-design-help-decisions; answering it unblocks the Actions gated on it.

Proposed by Agent Ask decision-naming-iris-designer-handle-2026-10-31.
