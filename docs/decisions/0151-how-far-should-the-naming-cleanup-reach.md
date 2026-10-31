---
arcadia: v1
type: decision
id: "0151"
slug: how-far-should-the-naming-cleanup-reach
project: arcadia
status: approved
question: How far should the naming cleanup reach?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Display and guidance only
options:
  - label: Display and guidance only
    consequence: Correct the vocabulary and peer coverage in guidance and generated text; signatures, identity keys, flags and legacy JSON stay exactly as they are.
    recommended: true
  - label: Also rename APIs and JSON
    consequence: Also rename exported APIs and JSON fields. Needs a consumer inventory and a compatibility plan first, and can break tools outside this repository.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
answer: Display and guidance only
decided: 2026-10-31
---

# Decision 0151: How far should the naming cleanup reach?

## Options

- **Display and guidance only** (recommended): Correct the vocabulary and peer coverage in guidance and generated text; signatures, identity keys, flags and legacy JSON stay exactly as they are.
- **Also rename APIs and JSON**: Also rename exported APIs and JSON fields. Needs a consumer inventory and a compatibility plan first, and can break tools outside this repository.

## Rationale

Gates standardize-agent-naming-vocabulary. Source: docs/design/agent-naming-and-design-help/README.md, section 10, converged after four reviews. Opened by Action open-naming-and-design-help-decisions; answering it unblocks the Actions gated on it.

Proposed by Agent Ask decision-naming-migration-scope-2026-10-31.
