---
arcadia: v1
type: decision
id: "0236"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-14-6bf1995f
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-14 6bf1995f
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 662b2b1c62ddc2e8f7c82a88438ce3cadbea069c214e20223a852b131177c9b0
options:
  - label: Authorize one worker Claude usage diagnostic 662b2b1c62ddc2e8f7c82a88438ce3cadbea069c214e20223a852b131177c9b0
    consequence: "Authorizes only the worker grant with SHA-256 662b2b1c62ddc2e8f7c82a88438ce3cadbea069c214e20223a852b131177c9b0: nonce 6bf1995f-4ce6-4556-9fce-4e5bb9ce158f, expiring 2026-11-15T07:33:42.825Z, policy revision 131 epoch 70, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261113-part-3
updated: 2026-11-15
---

# Decision 0236: Authorize one START card worker Claude usage diagnostic 2026-11-14 6bf1995f

## Options

- **Authorize one worker Claude usage diagnostic 662b2b1c62ddc2e8f7c82a88438ce3cadbea069c214e20223a852b131177c9b0** (recommended): Authorizes only the worker grant with SHA-256 662b2b1c62ddc2e8f7c82a88438ce3cadbea069c214e20223a852b131177c9b0: nonce 6bf1995f-4ce6-4556-9fce-4e5bb9ce158f, expiring 2026-11-15T07:33:42.825Z, policy revision 131 epoch 70, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-plan3-pins-7-9-20261115a run 20261115T072533Z-78505: the card's one Haiku renewal of 2026-11-14 succeeded, so the bound worker (release 3acd79c31895d280a1d42bae643690b6e273c8fb, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-14-6bf1995f.
