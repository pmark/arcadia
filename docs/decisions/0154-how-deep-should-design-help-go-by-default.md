---
arcadia: v1
type: decision
id: "0154"
slug: how-deep-should-design-help-go-by-default
project: arcadia
status: approved
question: How deep should design help go by default?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Quick by default
options:
  - label: Quick by default
    consequence: A quick consultation by default, with a sustained design brief only when asked for. Low friction; records only what someone asked to keep.
    recommended: true
  - label: Always a full brief
    consequence: Every design request keeps a full brief. One uniform procedure, but heavy for one-off questions and it records material nobody asked to keep.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
answer: Quick by default
decided: 2026-10-31
---

# Decision 0154: How deep should design help go by default?

## Options

- **Quick by default** (recommended): A quick consultation by default, with a sustained design brief only when asked for. Low friction; records only what someone asked to keep.
- **Always a full brief**: Every design request keeps a full brief. One uniform procedure, but heavy for one-off questions and it records material nobody asked to keep.

## Rationale

Gates add-design-route-to-consultation and create-portable-design-facilitation-skill. Source: docs/design/agent-naming-and-design-help/README.md, section 10, converged after four reviews. Opened by Action open-naming-and-design-help-decisions; answering it unblocks the Actions gated on it.

Proposed by Agent Ask decision-design-help-depth-2026-10-31.
