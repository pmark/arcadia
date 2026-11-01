---
arcadia: v1
type: decision
id: "0152"
slug: should-the-lead-s-mutation-rules-stay-transport-specific
project: arcadia
status: approved
question: Should the Lead's mutation rules stay transport-specific?
gap_type: missing-decision
gate_question: resists_reversal
recommendation: State the native-app exception
options:
  - label: State the native-app exception
    consequence: "Keep today's rules: the native-app Lead writes no product code and the implementer is sole writer; briefs state which contract applies. No authority change."
    recommended: true
  - label: Harmonize across transports
    consequence: Make one mutation rule for the Lead on every transport. This is an authority change that needs new guidance and proof before agents rely on it.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
answer: State the native-app exception
decided: 2026-10-31
---

# Decision 0152: Should the Lead's mutation rules stay transport-specific?

## Options

- **State the native-app exception** (recommended): Keep today's rules: the native-app Lead writes no product code and the implementer is sole writer; briefs state which contract applies. No authority change.
- **Harmonize across transports**: Make one mutation rule for the Lead on every transport. This is an authority change that needs new guidance and proof before agents rely on it.

## Rationale

Gates standardize-agent-naming-vocabulary. Source: docs/design/agent-naming-and-design-help/README.md, section 10, converged after four reviews. Opened by Action open-naming-and-design-help-decisions; answering it unblocks the Actions gated on it.

Proposed by Agent Ask decision-naming-lead-scope-2026-10-31.
