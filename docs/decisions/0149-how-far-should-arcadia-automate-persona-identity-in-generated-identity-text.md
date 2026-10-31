---
arcadia: v1
type: decision
id: "0149"
slug: how-far-should-arcadia-automate-persona-identity-in-generated-identity-text
project: arcadia
status: open
question: How far should Arcadia automate persona identity in generated identity text?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Explicit binding only
options:
  - label: Explicit binding only
    consequence: Personas appear only when a brief's Task prose binds one; unknown personas are omitted and existing instance locators are shown. Cheapest truthful fix; no schema change.
    recommended: true
  - label: Structured binding now
    consequence: Fund a structured assignment binding and resolver so personas can be displayed and addressed automatically. Adds schema, API and migration work before the Action can finish.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
---

# Decision 0149: How far should Arcadia automate persona identity in generated identity text?

## Options

- **Explicit binding only** (recommended): Personas appear only when a brief's Task prose binds one; unknown personas are omitted and existing instance locators are shown. Cheapest truthful fix; no schema change.
- **Structured binding now**: Fund a structured assignment binding and resolver so personas can be displayed and addressed automatically. Adds schema, API and migration work before the Action can finish.

## Rationale

Gates render-bound-persona-and-instance-locators. Source: docs/design/agent-naming-and-design-help/README.md, section 10, converged after four reviews. Opened by Action open-naming-and-design-help-decisions; answering it unblocks the Actions gated on it.

Proposed by Agent Ask decision-naming-persona-automation-2026-10-31.
