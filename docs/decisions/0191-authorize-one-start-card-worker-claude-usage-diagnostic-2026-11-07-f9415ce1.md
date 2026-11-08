---
arcadia: v1
type: decision
id: "0191"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-07-f9415ce1
project: arcadia
status: approved
question: Authorize one START card worker Claude usage diagnostic 2026-11-07 f9415ce1
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic c1cda417bee508c658be986215b3d450c67c714e066d0b07d1776342cdfc9784
options:
  - label: Authorize one worker Claude usage diagnostic c1cda417bee508c658be986215b3d450c67c714e066d0b07d1776342cdfc9784
    consequence: "Authorizes only the worker grant with SHA-256 c1cda417bee508c658be986215b3d450c67c714e066d0b07d1776342cdfc9784: nonce f9415ce1-ecd1-4318-b78e-b2735b41c036, expiring 2026-11-07T22:21:20.586Z, policy revision 107 epoch 58, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107
updated: 2026-11-07
answer: Authorize one worker Claude usage diagnostic c1cda417bee508c658be986215b3d450c67c714e066d0b07d1776342cdfc9784
decided: 2026-11-07
---

# Decision 0191: Authorize one START card worker Claude usage diagnostic 2026-11-07 f9415ce1

## Options

- **Authorize one worker Claude usage diagnostic c1cda417bee508c658be986215b3d450c67c714e066d0b07d1776342cdfc9784** (recommended): Authorizes only the worker grant with SHA-256 c1cda417bee508c658be986215b3d450c67c714e066d0b07d1776342cdfc9784: nonce f9415ce1-ecd1-4318-b78e-b2735b41c036, expiring 2026-11-07T22:21:20.586Z, policy revision 107 epoch 58, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-record-run-b2-20261107c run 20261107T221232Z-95164: the card's one Haiku renewal of 2026-11-07 succeeded, so the bound worker (release f3d2ae5ed327c3e23bbdac43278b79da10f8e979, handler 319c90143d8e4da4f96840d0aee7a173c27d11fce910a46406f9baaf8df8df7a) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-07-f9415ce1.
