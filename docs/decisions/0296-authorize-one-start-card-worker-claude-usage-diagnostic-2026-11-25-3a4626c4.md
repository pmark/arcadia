---
arcadia: v1
type: decision
id: "0296"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-25-3a4626c4
project: arcadia
status: approved
question: Authorize one START card worker Claude usage diagnostic 2026-11-25 3a4626c4
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 89c009541ad796b3a610803a0d37461c25d96b255a35b4a831235fb2e67a3d56
options:
  - label: Authorize one worker Claude usage diagnostic 89c009541ad796b3a610803a0d37461c25d96b255a35b4a831235fb2e67a3d56
    consequence: "Authorizes only the worker grant with SHA-256 89c009541ad796b3a610803a0d37461c25d96b255a35b4a831235fb2e67a3d56: nonce 3a4626c4-778d-48ac-9f0c-45b07531d868, expiring 2026-11-26T05:00:09.040Z, policy revision 191 epoch 100, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-3-standby-test-pins-20261125
updated: 2026-11-25
answer: Authorize one worker Claude usage diagnostic 89c009541ad796b3a610803a0d37461c25d96b255a35b4a831235fb2e67a3d56
decided: 2026-11-25
---

# Decision 0296: Authorize one START card worker Claude usage diagnostic 2026-11-25 3a4626c4

## Options

- **Authorize one worker Claude usage diagnostic 89c009541ad796b3a610803a0d37461c25d96b255a35b4a831235fb2e67a3d56** (recommended): Authorizes only the worker grant with SHA-256 89c009541ad796b3a610803a0d37461c25d96b255a35b4a831235fb2e67a3d56: nonce 3a4626c4-778d-48ac-9f0c-45b07531d868, expiring 2026-11-26T05:00:09.040Z, policy revision 191 epoch 100, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-3-standby-pins-20261125b run 20261126T045159Z-81479: the card's one Haiku renewal of 2026-11-25 succeeded, so the bound worker (release 52487a0c413b61780707a5a27833a59fda37aa23, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-25-3a4626c4.
