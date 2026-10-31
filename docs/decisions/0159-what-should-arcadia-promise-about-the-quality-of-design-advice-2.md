---
arcadia: v1
type: decision
id: "0159"
slug: what-should-arcadia-promise-about-the-quality-of-design-advice-2
project: arcadia
status: open
question: What should Arcadia promise about the quality of design advice?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Reviewed guides first, never limited
options:
  - label: Reviewed guides first, never limited
    consequence: "Reviewed field guides are the main value: an answer claims conformance only within a reviewed guide's scope. In any field without one, design help still works, with visible provenance and disclosed exploratory advice. Every answer states which mode it is in, so the operator can tell checked advice from exploratory advice. Its value grows as reviewed guides are written; who writes and reviews them is still open."
    recommended: true
  - label: Visible provenance only
    consequence: Every answer shows its guide, sources, confidence and gaps, with no conformance claims even where a reviewed guide exists. Simpler; makes no use of reviewed guides as a mark of quality.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
---

# Decision 0159: What should Arcadia promise about the quality of design advice?

## Options

- **Reviewed guides first, never limited** (recommended): Reviewed field guides are the main value: an answer claims conformance only within a reviewed guide's scope. In any field without one, design help still works, with visible provenance and disclosed exploratory advice. Every answer states which mode it is in, so the operator can tell checked advice from exploratory advice. Its value grows as reviewed guides are written; who writes and reviews them is still open.
- **Visible provenance only**: Every answer shows its guide, sources, confidence and gaps, with no conformance claims even where a reviewed guide exists. Simpler; makes no use of reviewed guides as a mark of quality.

## Rationale

Supersedes Decision 0155, whose options did not include the operator's answer given in Claude Code on 2026-10-31. The recommended option is that answer, with refinements the operator accepted. Gates add-design-route-to-consultation and create-portable-design-facilitation-skill in Plan unify-how-arcadia-agents-identify-themselves-and-their-teammates-and-make.

Proposed by Agent Ask decision-design-advice-assurance-hybrid-2026-10-31.
