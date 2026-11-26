---
arcadia: v1
type: decision
id: "0295"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-25-f4b9623d
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-25 f4b9623d
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic fee07d660e4adb931fd4dbb67402245593f8cc116bac76b5e915700e9f547415
options:
  - label: Authorize one worker Claude usage diagnostic fee07d660e4adb931fd4dbb67402245593f8cc116bac76b5e915700e9f547415
    consequence: "Authorizes only the worker grant with SHA-256 fee07d660e4adb931fd4dbb67402245593f8cc116bac76b5e915700e9f547415: nonce f4b9623d-0048-497b-bd30-ba86fca25756, expiring 2026-11-26T02:51:03.340Z, policy revision 189 epoch 99, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-2-standby-test-pins-20261123
updated: 2026-11-26
---

# Decision 0295: Authorize one START card worker Claude usage diagnostic 2026-11-25 f4b9623d

## Options

- **Authorize one worker Claude usage diagnostic fee07d660e4adb931fd4dbb67402245593f8cc116bac76b5e915700e9f547415** (recommended): Authorizes only the worker grant with SHA-256 fee07d660e4adb931fd4dbb67402245593f8cc116bac76b5e915700e9f547415: nonce f4b9623d-0048-497b-bd30-ba86fca25756, expiring 2026-11-26T02:51:03.340Z, policy revision 189 epoch 99, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-3-standby-pins-20261125a run 20261126T024306Z-53685: the card's one Haiku renewal of 2026-11-25 succeeded, so the bound worker (release 0c0e025a424716e37f877822dae19de1b360ed25, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-25-f4b9623d.
