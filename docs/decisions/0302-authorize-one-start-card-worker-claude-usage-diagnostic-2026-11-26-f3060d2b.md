---
arcadia: v1
type: decision
id: "0302"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-26-f3060d2b
project: arcadia
status: approved
question: Authorize one START card worker Claude usage diagnostic 2026-11-26 f3060d2b
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic bf6cf239f1d65b13a0d08105d3f27c5989aec5b485e96f7103d8b86181545b53
options:
  - label: Authorize one worker Claude usage diagnostic bf6cf239f1d65b13a0d08105d3f27c5989aec5b485e96f7103d8b86181545b53
    consequence: "Authorizes only the worker grant with SHA-256 bf6cf239f1d65b13a0d08105d3f27c5989aec5b485e96f7103d8b86181545b53: nonce f3060d2b-7d44-4ac5-96b1-de28f5bfcdab, expiring 2026-11-26T23:19:18.081Z, policy revision 197 epoch 103, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-4-standby-test-pins-20261126
updated: 2026-11-26
answer: Authorize one worker Claude usage diagnostic bf6cf239f1d65b13a0d08105d3f27c5989aec5b485e96f7103d8b86181545b53
decided: 2026-11-26
---

# Decision 0302: Authorize one START card worker Claude usage diagnostic 2026-11-26 f3060d2b

## Options

- **Authorize one worker Claude usage diagnostic bf6cf239f1d65b13a0d08105d3f27c5989aec5b485e96f7103d8b86181545b53** (recommended): Authorizes only the worker grant with SHA-256 bf6cf239f1d65b13a0d08105d3f27c5989aec5b485e96f7103d8b86181545b53: nonce f3060d2b-7d44-4ac5-96b1-de28f5bfcdab, expiring 2026-11-26T23:19:18.081Z, policy revision 197 epoch 103, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-4-standby-pins-20261126b run 20261126T230916Z-75300: the card's one Haiku renewal of 2026-11-26 succeeded, so the bound worker (release ec2296f9308d3cc951370eebb2acd9590d98b17e, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-26-f3060d2b.
