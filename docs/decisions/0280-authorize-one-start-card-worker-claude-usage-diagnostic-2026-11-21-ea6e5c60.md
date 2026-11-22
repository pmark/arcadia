---
arcadia: v1
type: decision
id: "0280"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-21-ea6e5c60
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-21 ea6e5c60
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic db0fc8b24c5d426935c786c6d95d0bccea818c9dd965ef6b45b93079295aa5c8
options:
  - label: Authorize one worker Claude usage diagnostic db0fc8b24c5d426935c786c6d95d0bccea818c9dd965ef6b45b93079295aa5c8
    consequence: "Authorizes only the worker grant with SHA-256 db0fc8b24c5d426935c786c6d95d0bccea818c9dd965ef6b45b93079295aa5c8: nonce ea6e5c60-42ae-465f-902b-e1799f0d6cb9, expiring 2026-11-22T04:29:42.653Z, policy revision 173 epoch 91, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-22
---

# Decision 0280: Authorize one START card worker Claude usage diagnostic 2026-11-21 ea6e5c60

## Options

- **Authorize one worker Claude usage diagnostic db0fc8b24c5d426935c786c6d95d0bccea818c9dd965ef6b45b93079295aa5c8** (recommended): Authorizes only the worker grant with SHA-256 db0fc8b24c5d426935c786c6d95d0bccea818c9dd965ef6b45b93079295aa5c8: nonce ea6e5c60-42ae-465f-902b-e1799f0d6cb9, expiring 2026-11-22T04:29:42.653Z, policy revision 173 epoch 91, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-plan-f-verify-20261122a run 20261122T042201Z-31554: the card's one Haiku renewal of 2026-11-21 succeeded, so the bound worker (release d5c60155b511b0360804190c1cdb67892408dfc2, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-21-ea6e5c60.
