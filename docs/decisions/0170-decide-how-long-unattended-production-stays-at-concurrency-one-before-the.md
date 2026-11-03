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
recommendation: "Time-boxed serial: up to three attempts, then decide again"
options:
  - label: "Time-boxed serial: up to three attempts, then decide again"
    consequence: Unattended production stays at concurrency one until one clean three-Action run, or until three attempts are used, whichever comes first; then Rowan brings the evidence and the operator decides again. Supervised parallel development continues throughout. Each concurrency concern is recorded with a named trigger. Unattended parallel waits for up to three runs, and Decision 0070's build follows the first clean run.
    recommended: true
  - label: Minimal safe parallel first
    consequence: Build the smallest unattended parallel path before any more runs. It reaches parallel earliest, but delays live evidence by about six pull requests and rewrites the path behind the only three worker merges so far.
    recommended: false
  - label: "No limit: serial until proven"
    consequence: Unattended production stays at concurrency one until a clean three-Action run, however many attempts that takes. It has no stopping point, and could cost weeks with no forced re-decision.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-03
---

# Decision 0170: Decide how long unattended production stays at concurrency one before the operator decides again, and whether supervised parallel development continues meanwhile.

## Options

- **Time-boxed serial: up to three attempts, then decide again** (recommended): Unattended production stays at concurrency one until one clean three-Action run, or until three attempts are used, whichever comes first; then Rowan brings the evidence and the operator decides again. Supervised parallel development continues throughout. Each concurrency concern is recorded with a named trigger. Unattended parallel waits for up to three runs, and Decision 0070's build follows the first clean run.
- **Minimal safe parallel first**: Build the smallest unattended parallel path before any more runs. It reaches parallel earliest, but delays live evidence by about six pull requests and rewrites the path behind the only three worker merges so far.
- **No limit: serial until proven**: Unattended production stays at concurrency one until a clean three-Action run, however many attempts that takes. It has no stopping point, and could cost weeks with no forced re-decision.

## Rationale

Operator, 2026-11-03: concurrency is a must eventually, reached by first proving serial work; the operator also doubted an open-ended serial phase, given how slowly unattended production has progressed, and asked that attempts be limited. A plan critic found Decision 0070's work blocks parallelism, not serial runs, and would rewrite the only path that has merged live. An attempt is a START that admits at least one Session; a START refused before any Session launches does not count. A clean run is three Actions merged by the worker with operator touches limited to activation. This Decision grants no START, spend or merge: each press stays the operator's.

Proposed by Agent Ask decide-serial-proof-time-box-20261103.
