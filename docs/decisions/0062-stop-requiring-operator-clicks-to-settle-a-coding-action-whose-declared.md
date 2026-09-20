---
arcadia: v1
type: decision
id: "0062"
slug: stop-requiring-operator-clicks-to-settle-a-coding-action-whose-declared
project: arcadia
status: open
question: Stop requiring operator clicks to settle a coding Action whose declared acceptance criteria have deterministic evidence, while retaining hard gates for external or irreversible authority.
gap_type: missing-decision
recommendation: Automate proven completion
options:
  - label: Automate proven completion
    consequence: An agent may settle completion evidence automatically after the Action criteria, candidate snapshot, and deterministic checks pass; operator actions remain only for genuine authority boundaries.
    recommended: true
  - label: Keep click-to-complete
    consequence: Every completed Action continues to require an operator settlement click, including proof-only completion with no new judgment.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-20
---

# Decision 0062: Stop requiring operator clicks to settle a coding Action whose declared acceptance criteria have deterministic evidence, while retaining hard gates for external or irreversible authority.

## Options

- **Automate proven completion** (recommended): An agent may settle completion evidence automatically after the Action criteria, candidate snapshot, and deterministic checks pass; operator actions remain only for genuine authority boundaries.
- **Keep click-to-complete**: Every completed Action continues to require an operator settlement click, including proof-only completion with no new judgment.

## Rationale

The verified worker recovery Action required repeated operator-script retries solely to supply CLI settlement fields and fingerprints. The operator reports this as rubber-stamping that diverts attention from managed-production readiness. The vital change is to make proof-based completion automatic after validation and candidate preservation; deploy, publish, merge outside existing policy, credentials, spending, messaging, deletion, and genuinely choiceful Decisions remain gated.

Proposed by Agent Ask decide-proof-based-agent-completion-2026-09-20.
