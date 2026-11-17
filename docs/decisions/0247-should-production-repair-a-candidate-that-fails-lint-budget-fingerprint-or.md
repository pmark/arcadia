---
arcadia: v1
type: decision
id: "0247"
slug: should-production-repair-a-candidate-that-fails-lint-budget-fingerprint-or
project: arcadia
status: open
question: Should production repair a candidate that fails lint, budget, fingerprint or notes-cap checks or whose reviewed head moved, instead of parking it?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Park and ping once
options:
  - label: A. Park and ping once
    consequence: "Consequence: a failed card waits for a human fix; no new authority; safest. Mira's recommendation for a first try."
    recommended: true
  - label: B. One bounded automatic repair round
    consequence: "Consequence: more runs finish unattended; changes the repair-budget design and needs its own review; risk of spend on a bad candidate."
    recommended: false
  - label: E. Diagnose, then repair by software-engineering best practice, ping only on operator-attention criteria
    consequence: "The operator's own option, not printed in Mira's report. His exact confirmed words: \"Do not bother the operator with problems that coding agents should be able to fix, unless the problem fits the criteria for operator attention. However, I think this condition calls for special handling rather than a pure brute force strategy. Let's employ other strategies as dictated by software engineering best practices.\" Confirmed paraphrase: production diagnoses a red candidate (deterministic fixes first, then a coding-agent repair Session producing a new reviewed head) and pings only when the operator-attention criteria are met. It becomes a designed Action (lint, budget, fingerprint and notes-cap repair; review of a fixed head without review_head_moved) with its own review. Not brute-force retries; no spend, credential or merge exception is granted."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-replace-the-daily-start
updated: 2026-11-17
---

# Decision 0247: Should production repair a candidate that fails lint, budget, fingerprint or notes-cap checks or whose reviewed head moved, instead of parking it?

## Options

- **A. Park and ping once** (recommended): Consequence: a failed card waits for a human fix; no new authority; safest. Mira's recommendation for a first try.
- **B. One bounded automatic repair round**: Consequence: more runs finish unattended; changes the repair-budget design and needs its own review; risk of spend on a bad candidate.
- **E. Diagnose, then repair by software-engineering best practice, ping only on operator-attention criteria**: The operator's own option, not printed in Mira's report. His exact confirmed words: "Do not bother the operator with problems that coding agents should be able to fix, unless the problem fits the criteria for operator attention. However, I think this condition calls for special handling rather than a pure brute force strategy. Let's employ other strategies as dictated by software engineering best practices." Confirmed paraphrase: production diagnoses a red candidate (deterministic fixes first, then a coding-agent repair Session producing a new reviewed head) and pings only when the operator-attention criteria are met. It becomes a designed Action (lint, budget, fingerprint and notes-cap repair; review of a fixed head without review_head_moved) with its own review. Not brute-force retries; no spend, credential or merge exception is granted.

## Rationale

The operator answered E, not one of Mira's printed options. Source: the operator's answer, given by picker in Signal 13's chat (session local_d6b861a8-20f6-433d-a67f-4d3255bbaee7, 2026-11-16, about 1:20 PM Pacific) and verified by Signal 13, who holds that transcript. Evidence report: Mira, 'Can we start unattended production through the Workspace today?', 2026-11-16 (sha256 311403a154f5d9007932974361b9612fad65e8676933eadcb7ca131420f20c6f). Proposed by Claudia Mason under Rowan 19 to record the already-given answer; this draft grants nothing, only the answer recorded through arcadia decision approve does. Evidence: lint and budget failures and review_head_moved after hand-pushed fixes currently park the card and raise noise alerts; one alert was seen about 130,052 times (alert re-fire is a separate defect proposed alongside). Merge, spend, credentials and approval gates are unchanged; the repair Action needs its own independent review before it can be queued, and queue placement is the operator's under Decision 0241 E.

Proposed by Agent Ask claudia-mira-d1-auto-repair-red-candidate-20261116.
