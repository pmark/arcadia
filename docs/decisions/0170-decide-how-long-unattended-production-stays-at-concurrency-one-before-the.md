---
arcadia: v1
type: decision
id: "0170"
slug: decide-how-long-unattended-production-stays-at-concurrency-one-before-the
project: arcadia
status: open
question: Decide how long unattended production stays at concurrency one before the operator decides again, and whether supervised parallel development continues meanwhile.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. Time-boxed serial: up to three attempts, then decide again"
options:
  - label: "A. Time-boxed serial: up to three attempts, then decide again"
    consequence: Unattended production stays at concurrency one until one clean run, or until three attempts are used, whichever comes first; Rowan then brings the evidence and the operator decides again, including whether to allow more attempts. Supervised parallel development continues throughout. Rowan records each concurrency concern as an Issue with a named trigger. After a clean run, building Decision 0070 and the concurrency proofs becomes the next work. Unattended parallel waits for up to three runs.
    recommended: true
  - label: B. Minimal safe parallel first
    consequence: Build the smallest unattended parallel path before any more runs. It reaches parallel earliest, but delays live evidence by about six pull requests and rewrites the path behind the only three worker merges so far.
    recommended: false
  - label: "C. No limit: serial until proven"
    consequence: Unattended production stays at concurrency one until a clean run, however many attempts that takes. It has no stopping point, and could cost weeks with no forced re-decision.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-03
---

# Decision 0170: Decide how long unattended production stays at concurrency one before the operator decides again, and whether supervised parallel development continues meanwhile.

## Options

- **A. Time-boxed serial: up to three attempts, then decide again** (recommended): Unattended production stays at concurrency one until one clean run, or until three attempts are used, whichever comes first; Rowan then brings the evidence and the operator decides again, including whether to allow more attempts. Supervised parallel development continues throughout. Rowan records each concurrency concern as an Issue with a named trigger. After a clean run, building Decision 0070 and the concurrency proofs becomes the next work. Unattended parallel waits for up to three runs.
- **B. Minimal safe parallel first**: Build the smallest unattended parallel path before any more runs. It reaches parallel earliest, but delays live evidence by about six pull requests and rewrites the path behind the only three worker merges so far.
- **C. No limit: serial until proven**: Unattended production stays at concurrency one until a clean run, however many attempts that takes. It has no stopping point, and could cost weeks with no forced re-decision.

## Rationale

Operator, 2026-11-03: concurrency is a must eventually, reached by first proving serial work; the operator also doubted an open-ended serial phase, given how slowly unattended production has progressed, and asked that attempts be limited. A plan critic found Decision 0070's work blocks parallelism, not serial runs, and would rewrite the only path that has merged live. An attempt is a START that admits at least one Session, whatever then stops it, including a setup failure, a provider outage or an operator STOP; a START refused before any Session launches does not count. A clean run is one run in which at least three in-scope Actions merge through the worker, with operator touches limited to what first-unattended-run allows: activation and merges of authority-adjacent pull requests. Merges across different attempts do not add up. This Decision adds a limit and changes no other: Decision 0163's own START bounds still apply and the stricter binds, and Decisions 0071, 0097 and 0117 stand. It grants no START, spend or merge: each press stays the operator's.

Proposed by Agent Ask decide-serial-proof-time-box-20261103-r2.
