---
arcadia: v1
type: decision
id: "0261"
slug: may-arcadia-fast-forward-publish-to-origin-main-the-arcadia-controller-s
project: arcadia
status: open
question: May Arcadia fast-forward publish to origin main the Arcadia Controller's governance-record-only commits (auto-settle and pointer commits) whenever five conditions checked each time hold, so local main never drifts into base_not_synced?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Publish governance-only controller commits, checked each time
options:
  - label: A. Publish governance-only controller commits, checked each time
    consequence: "Arcadia publishes a controller commit range from local main to origin main only when ALL of these hold, checked each time: (C1) every commit in the range is authored and committed by the Arcadia Controller identity; (C2) every changed path in the range is a governance record: .arcadia/, PROJECT.md, MISSION_LOG.md or docs/plans/ (docs/decisions files keep their existing publication routes); (C3) origin main is an ancestor of local main, and the push is a plain fast-forward with no force, re-checking origin immediately before pushing as src/production/startRunSignIn.ts does; (C4) no per-run or activation START card is pinned and unpressed, so a publish can never void a card you are about to press; (C5) a receipt records the range, origin's head before and after, and each check's result. Any condition that fails or cannot be read leaves the commits local (nothing is pushed, rewritten or merged) and sends exactly one ping naming the condition; you decide only that case. Consequence: settle commits reach main within one tick, so local and origin no longer diverge, and nothing waits for a person. Risk: a wrongly classified path is published without review, bounded by the controller-identity and path checks, fast-forward only and the pinned-card guard."
    recommended: true
  - label: B. Settle through a PR branch
    consequence: "Controller commits go to a branch and merge under the governed-record exception. Consequence: reviewed, but every settle waits for a CI cycle of about 15 minutes, and a night can stall on it."
    recommended: false
  - label: C. No change
    consequence: "Rowan pushes stray settle commits by hand at the 8 PM checklist. Consequence: base_not_synced stalls continue whenever no Rowan is awake."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-18
---

# Decision 0261: May Arcadia fast-forward publish to origin main the Arcadia Controller's governance-record-only commits (auto-settle and pointer commits) whenever five conditions checked each time hold, so local main never drifts into base_not_synced?

## Options

- **A. Publish governance-only controller commits, checked each time** (recommended): Arcadia publishes a controller commit range from local main to origin main only when ALL of these hold, checked each time: (C1) every commit in the range is authored and committed by the Arcadia Controller identity; (C2) every changed path in the range is a governance record: .arcadia/, PROJECT.md, MISSION_LOG.md or docs/plans/ (docs/decisions files keep their existing publication routes); (C3) origin main is an ancestor of local main, and the push is a plain fast-forward with no force, re-checking origin immediately before pushing as src/production/startRunSignIn.ts does; (C4) no per-run or activation START card is pinned and unpressed, so a publish can never void a card you are about to press; (C5) a receipt records the range, origin's head before and after, and each check's result. Any condition that fails or cannot be read leaves the commits local (nothing is pushed, rewritten or merged) and sends exactly one ping naming the condition; you decide only that case. Consequence: settle commits reach main within one tick, so local and origin no longer diverge, and nothing waits for a person. Risk: a wrongly classified path is published without review, bounded by the controller-identity and path checks, fast-forward only and the pinned-card guard.
- **B. Settle through a PR branch**: Controller commits go to a branch and merge under the governed-record exception. Consequence: reviewed, but every settle waits for a CI cycle of about 15 minutes, and a night can stall on it.
- **C. No change**: Rowan pushes stray settle commits by hand at the 8 PM checklist. Consequence: base_not_synced stalls continue whenever no Rowan is awake.

## Rationale

The operator chose G-A in Signal 14's chat on 2026-11-18. Basis, from Mira and Issue #2802: no code publishes 'chore(arcadia): settle auto-settle-…' commits; src/git/pointerReconcile.ts:324 keeps only point-at and reconcile commits, so a later divergence reads as base_not_synced and stalls the worker. START sign-ins already publish their two Decision-record commits by checked fast-forward (src/production/startRunSignIn.ts, controller identity, an exact path check and an origin re-check before the push). This extends the same shape to the controller's other governance commits. It is a publication rule, so it is an operator Decision, not just an Action. It is implemented by Action publish-governance-record-commits-fast-forward. This draft grants nothing; only the operator's answer recorded through the governed route can.

Proposed by Agent Ask ellis-decision-publish-controller-commits-20261118.
