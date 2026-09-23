---
arcadia: v1
type: decision
id: "0066"
slug: record-when-arcadia-should-widen-beyond-one-coding-agent-session-per-repository
project: arcadia
status: approved
question: Record when Arcadia should widen beyond one coding-agent Session per repository, so the choice made in the 2026-09-23 concurrency strategy session has a durable, revivable record instead of being re-litigated informally.
gap_type: missing-decision
recommendation: Defer same-repository concurrent Sessions until prove-two-action-unattended-production and the queued number-505/507/549-class concurrency-safety fixes have landed
options:
  - label: Defer same-repository concurrent Sessions until prove-two-action-unattended-production and the queued number-505/507/549-class concurrency-safety fixes have landed
    consequence: "Arcadia keeps one Session per repository for now (the existing structural limit). No new concurrency surface is built. The trigger to revisit: the single Arcadia lane has landed prove-two-action-unattended-production cleanly in real operator use, and serialize-decision-deferral-pointer-write, treat-blocked-status-as-undispatchable, and the claim-expiry fix for the 24-hour issue are done. At that point a same-repository secondary lane for independent, low-blast-radius Actions becomes cheap to build safely, because the primitives it would share are no longer known-buggy."
    recommended: true
  - label: Build a same-repository secondary queue lane now, in parallel with the concurrency-safety fixes
    consequence: Same-repository throughput could start sooner, but the new admission lane would share the exact pointer-write and settlement-Next primitives that are currently reported racy, so building on them now risks shipping a second consumer of bugs already scheduled to be fixed out from under it. Rework is likely.
    recommended: false
  - label: Build a ready-set multi-Session scheduler now
    consequence: Highest throughput ambition, largest new build (a scheduler that does not exist today), and the largest exposure to the currently-open concurrency races -- deliberately taken on before the single lane has landed a proof session with zero operator touches. Not recommended while the only Session ever run needed five operator touches to land.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-23
answer: Defer same-repository concurrent Sessions until prove-two-action-unattended-production and the queued number-505/507/549-class concurrency-safety fixes have landed
decided: 2026-09-23
---

# Decision 0066: Record when Arcadia should widen beyond one coding-agent Session per repository, so the choice made in the 2026-09-23 concurrency strategy session has a durable, revivable record instead of being re-litigated informally.

## Options

- **Defer same-repository concurrent Sessions until prove-two-action-unattended-production and the queued number-505/507/549-class concurrency-safety fixes have landed** (recommended): Arcadia keeps one Session per repository for now (the existing structural limit). No new concurrency surface is built. The trigger to revisit: the single Arcadia lane has landed prove-two-action-unattended-production cleanly in real operator use, and serialize-decision-deferral-pointer-write, treat-blocked-status-as-undispatchable, and the claim-expiry fix for the 24-hour issue are done. At that point a same-repository secondary lane for independent, low-blast-radius Actions becomes cheap to build safely, because the primitives it would share are no longer known-buggy.
- **Build a same-repository secondary queue lane now, in parallel with the concurrency-safety fixes**: Same-repository throughput could start sooner, but the new admission lane would share the exact pointer-write and settlement-Next primitives that are currently reported racy, so building on them now risks shipping a second consumer of bugs already scheduled to be fixed out from under it. Rework is likely.
- **Build a ready-set multi-Session scheduler now**: Highest throughput ambition, largest new build (a scheduler that does not exist today), and the largest exposure to the currently-open concurrency races -- deliberately taken on before the single lane has landed a proof session with zero operator touches. Not recommended while the only Session ever run needed five operator touches to land.

## Rationale

Strategy session (2026-09-23) evaluated cross-repo parallelism (A), a same-repo secondary queue (B), a same-repo ready-set multi-Session scheduler (C), stabilize-first (D), and hybrids (E). Evidence gathered live: exactly one managed-production Session has ever landed (session_e7748a398de14978b4, 2h9m, 5 operator touches per the zero-prompt rehearsal); the single existing lane is currently stalled in an indefinite silent retry loop on its pointer Action (Issue #576, filed this session) with zero packet prepared; concurrency-shaped defects #505 (pointer write has no lock), #507 (wrong Next under concurrent settlement), and #549 (24h claim expiry vs unmerged candidate) are open but already queued as ready, unstarted Actions in this same Plan. The Plan already encodes this exact reasoning for provider concurrency: prove-multi-provider-production-recovery defers its dual-provider concurrent soak proof until single-provider single-repository production has run cleanly in real operator use. This Decision extends that logic, explicitly, to session/repository concurrency (Options B and C), so the deferral has a named trigger instead of silently never being asked. The operator, asked directly in the strategy session, scoped this to Arcadia only for now, wants best-effort (not strict 24/7) cadence, and will tolerate rare hiccups caught within a day -- which is why Option D is recommended over continuing to leave the question open, and why the trigger below is phrased as a bar to clear rather than a permanent no.

Proposed by Agent Ask decide-same-repo-session-concurrency-trigger-2026-09-23.
