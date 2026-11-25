---
arcadia: v1
type: decision
id: "0293"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-25-ef19f0e3
project: arcadia
status: approved
question: Authorize one START card worker Claude usage diagnostic 2026-11-25 ef19f0e3
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic a1eda85116808c948141edcd08f3cec3361f8922c8bceda6ace7ba81dd4196b5
options:
  - label: Authorize one worker Claude usage diagnostic a1eda85116808c948141edcd08f3cec3361f8922c8bceda6ace7ba81dd4196b5
    consequence: "Authorizes only the worker grant with SHA-256 a1eda85116808c948141edcd08f3cec3361f8922c8bceda6ace7ba81dd4196b5: nonce ef19f0e3-d55c-4fe9-91f4-d0c78ec4d726, expiring 2026-11-25T20:03:26.760Z, policy revision 185 epoch 97, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-2-standby-test-pins-20261123
updated: 2026-11-25
answer: Authorize one worker Claude usage diagnostic a1eda85116808c948141edcd08f3cec3361f8922c8bceda6ace7ba81dd4196b5
decided: 2026-11-25
---

# Decision 0293: Authorize one START card worker Claude usage diagnostic 2026-11-25 ef19f0e3

## Options

- **Authorize one worker Claude usage diagnostic a1eda85116808c948141edcd08f3cec3361f8922c8bceda6ace7ba81dd4196b5** (recommended): Authorizes only the worker grant with SHA-256 a1eda85116808c948141edcd08f3cec3361f8922c8bceda6ace7ba81dd4196b5: nonce ef19f0e3-d55c-4fe9-91f4-d0c78ec4d726, expiring 2026-11-25T20:03:26.760Z, policy revision 185 epoch 97, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-2-standby-pins-20261125b run 20261125T195721Z-96349: the card's one Haiku renewal of 2026-11-25 succeeded, so the bound worker (release bf409c0f338cc35359faa71eb7fd30c35c56c3b8, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-25-ef19f0e3.
