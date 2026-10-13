---
arcadia: v1
type: decision
id: "0126"
slug: record-the-operator-choice-to-permit-paid-fast-text-cloud-generation-only-for
project: arcadia
status: open
question: Record the operator choice to permit paid Fast Text Cloud generation only for explicitly requested PR TLDRs through Arcadia Intelligence.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Use Fast Text Cloud for explicit PR TLDR generation
options:
  - label: Use Fast Text Cloud for explicit PR TLDR generation
    consequence: PR Generate TLDR selects text.generate cloud-required fast and permits the existing paid cloud route for that request, with one retry and cached result reuse. One bounded validation summary is included; no global policy/model change or background generation.
    recommended: true
  - label: Retain local PR TLDR generation
    consequence: PR summaries retain the local standard model and current timeout/capacity limitations.
    recommended: false
confidence: high
plan: every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a
updated: 2026-10-13
---

# Decision 0126: Record the operator choice to permit paid Fast Text Cloud generation only for explicitly requested PR TLDRs through Arcadia Intelligence.

## Options

- **Use Fast Text Cloud for explicit PR TLDR generation** (recommended): PR Generate TLDR selects text.generate cloud-required fast and permits the existing paid cloud route for that request, with one retry and cached result reuse. One bounded validation summary is included; no global policy/model change or background generation.
- **Retain local PR TLDR generation**: PR summaries retain the local standard model and current timeout/capacity limitations.

## Rationale

The operator said: You should use the Fast Text Cloud model. This records that selected cloud/spend boundary; no other capability, paid route, background generation, automatic fallback, timeout, retry limit or Project pointer is authorized.

Proposed by Agent Ask record-pr-tldr-fast-cloud-choice-2026-10-13.
