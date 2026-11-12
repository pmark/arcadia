---
arcadia: v1
type: decision
id: "0224"
slug: d2-may-one-day-approval-cover-an-ordered-list-of-already-accepted-plans
project: arcadia
status: open
question: "D2: May one day approval cover an ordered list of already-accepted Plans?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A
options:
  - label: A
    consequence: One bounded day authorization names an ordered set of already-accepted Plans and their immutable envelopes. Production moves through them in your order, one press a day. Automatic chaining stops at scope drift, expiry, STOP or an exhausted allowance. A new Plan still needs your acceptance. The transition must be built and proved; Decision 0122 alone does not do it. Grants no START.
    recommended: true
  - label: B
    consequence: Authorize a single run spanning the same explicit multi-Plan scope. Fewer transitions, but more scheduler and activation work and a stronger composition proof before live use. Grants no START.
    recommended: false
  - label: C
    consequence: "Retain the current single-Plan route: Rowan presses a fresh card per Plan under the day grant. Same-Plan independent work continues, but each Plan boundary waits for a scoped approval and loses idle minutes. No new authority; no option renews a day grant or accepts a Plan. Grants no START."
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-12
---

# Decision 0224: D2: May one day approval cover an ordered list of already-accepted Plans?

## Options

- **A** (recommended): One bounded day authorization names an ordered set of already-accepted Plans and their immutable envelopes. Production moves through them in your order, one press a day. Automatic chaining stops at scope drift, expiry, STOP or an exhausted allowance. A new Plan still needs your acceptance. The transition must be built and proved; Decision 0122 alone does not do it. Grants no START.
- **B**: Authorize a single run spanning the same explicit multi-Plan scope. Fewer transitions, but more scheduler and activation work and a stronger composition proof before live use. Grants no START.
- **C**: Retain the current single-Plan route: Rowan presses a fresh card per Plan under the day grant. Same-Plan independent work continues, but each Plan boundary waits for a scoped approval and loses idle minutes. No new authority; no option renews a day grant or accepts a Plan. Grants no START.

## Rationale

Production idled at each Plan boundary because one START covers one Plan and no fallback exists (Decision 0122 preference store is unbuilt; Decision 0116 already names the next Plan). Sources: agentask_93d0170cd186a88db7 and agentask_b99a3e8db0ae4c862f. Codex base supersedes. This decision grants no START and preserves Constitution gates: a new Plan still needs operator acceptance, and fresh per-Plan cards, pre-mortems, pins and grants remain required.

Proposed by Agent Ask decision-d2-plan-boundaries-day-grant-20261112.
