---
arcadia: v1
type: decision
id: "0186"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-07-c51f33fc
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-07 c51f33fc
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 9630ca4550e824c856d12d77eac9c9184d1c85a3cc119326fe3950135409049f
options:
  - label: Authorize one worker Claude usage diagnostic 9630ca4550e824c856d12d77eac9c9184d1c85a3cc119326fe3950135409049f
    consequence: "Authorizes only the worker grant with SHA-256 9630ca4550e824c856d12d77eac9c9184d1c85a3cc119326fe3950135409049f: nonce c51f33fc-8e56-4597-ad73-34511af18717, expiring 2026-11-07T16:32:05.189Z, policy revision 103 epoch 56, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107
updated: 2026-11-07
---

# Decision 0186: Authorize one START card worker Claude usage diagnostic 2026-11-07 c51f33fc

## Options

- **Authorize one worker Claude usage diagnostic 9630ca4550e824c856d12d77eac9c9184d1c85a3cc119326fe3950135409049f** (recommended): Authorizes only the worker grant with SHA-256 9630ca4550e824c856d12d77eac9c9184d1c85a3cc119326fe3950135409049f: nonce c51f33fc-8e56-4597-ad73-34511af18717, expiring 2026-11-07T16:32:05.189Z, policy revision 103 epoch 56, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-record-run-b2-20261107a run 20261107T162407Z-12372: the card's one Haiku renewal of 2026-11-07 succeeded, so the bound worker (release a5b24895144530ed7848c5aadae2c45b3b35df30, handler 319c90143d8e4da4f96840d0aee7a173c27d11fce910a46406f9baaf8df8df7a) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-07-c51f33fc.
