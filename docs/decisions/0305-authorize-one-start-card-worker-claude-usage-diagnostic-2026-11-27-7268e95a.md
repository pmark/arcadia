---
arcadia: v1
type: decision
id: "0305"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-27-7268e95a
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-27 7268e95a
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic fd20af7effffd363d8092cea06d6821004adda52b7f9581cf3c630a7518f2681
options:
  - label: Authorize one worker Claude usage diagnostic fd20af7effffd363d8092cea06d6821004adda52b7f9581cf3c630a7518f2681
    consequence: "Authorizes only the worker grant with SHA-256 fd20af7effffd363d8092cea06d6821004adda52b7f9581cf3c630a7518f2681: nonce 7268e95a-4561-4a75-878f-6fefb910cd6c, expiring 2026-11-27T15:07:52.852Z, policy revision 203 epoch 106, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-5-standby-test-pins-20261126
updated: 2026-11-27
---

# Decision 0305: Authorize one START card worker Claude usage diagnostic 2026-11-27 7268e95a

## Options

- **Authorize one worker Claude usage diagnostic fd20af7effffd363d8092cea06d6821004adda52b7f9581cf3c630a7518f2681** (recommended): Authorizes only the worker grant with SHA-256 fd20af7effffd363d8092cea06d6821004adda52b7f9581cf3c630a7518f2681: nonce 7268e95a-4561-4a75-878f-6fefb910cd6c, expiring 2026-11-27T15:07:52.852Z, policy revision 203 epoch 106, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-6-standby-pins-20261127a run 20261127T145934Z-72215: the card's one Haiku renewal of 2026-11-27 succeeded, so the bound worker (release 559ad9bbaaf5c1027c4b296d346e3f0f7596dc0e, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-27-7268e95a.
