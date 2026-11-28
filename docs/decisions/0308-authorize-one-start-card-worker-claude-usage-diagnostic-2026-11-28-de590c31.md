---
arcadia: v1
type: decision
id: "0308"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-28-de590c31
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-28 de590c31
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 0606d7955b5444a4ec88c65e612acd553c0ab6c9d0d187fc7a3d4adb4b5e5949
options:
  - label: Authorize one worker Claude usage diagnostic 0606d7955b5444a4ec88c65e612acd553c0ab6c9d0d187fc7a3d4adb4b5e5949
    consequence: "Authorizes only the worker grant with SHA-256 0606d7955b5444a4ec88c65e612acd553c0ab6c9d0d187fc7a3d4adb4b5e5949: nonce de590c31-8bad-4543-9539-f7e34387a04a, expiring 2026-11-28T15:22:05.735Z, policy revision 209 epoch 109, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-7-standby-test-pins-20261127
updated: 2026-11-28
---

# Decision 0308: Authorize one START card worker Claude usage diagnostic 2026-11-28 de590c31

## Options

- **Authorize one worker Claude usage diagnostic 0606d7955b5444a4ec88c65e612acd553c0ab6c9d0d187fc7a3d4adb4b5e5949** (recommended): Authorizes only the worker grant with SHA-256 0606d7955b5444a4ec88c65e612acd553c0ab6c9d0d187fc7a3d4adb4b5e5949: nonce de590c31-8bad-4543-9539-f7e34387a04a, expiring 2026-11-28T15:22:05.735Z, policy revision 209 epoch 109, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-7-standby-pins-20261127b run 20261128T151240Z-56738: the card's one Haiku renewal of 2026-11-28 succeeded, so the bound worker (release 20982a066fcea828caf14a32a50703e6842f1dd8, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-28-de590c31.
