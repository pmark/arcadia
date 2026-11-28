---
arcadia: v1
type: decision
id: "0306"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-27-940d258b
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-27 940d258b
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 4782fc53d19fdea037e4cd17eb1daafa49e0fe45932e1b259b58cc96ebaa54a6
options:
  - label: Authorize one worker Claude usage diagnostic 4782fc53d19fdea037e4cd17eb1daafa49e0fe45932e1b259b58cc96ebaa54a6
    consequence: "Authorizes only the worker grant with SHA-256 4782fc53d19fdea037e4cd17eb1daafa49e0fe45932e1b259b58cc96ebaa54a6: nonce 940d258b-9b4f-4dd1-a680-6213c9052b06, expiring 2026-11-28T00:09:03.238Z, policy revision 205 epoch 107, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-6-standby-test-pins-20261127
updated: 2026-11-28
---

# Decision 0306: Authorize one START card worker Claude usage diagnostic 2026-11-27 940d258b

## Options

- **Authorize one worker Claude usage diagnostic 4782fc53d19fdea037e4cd17eb1daafa49e0fe45932e1b259b58cc96ebaa54a6** (recommended): Authorizes only the worker grant with SHA-256 4782fc53d19fdea037e4cd17eb1daafa49e0fe45932e1b259b58cc96ebaa54a6: nonce 940d258b-9b4f-4dd1-a680-6213c9052b06, expiring 2026-11-28T00:09:03.238Z, policy revision 205 epoch 107, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-6-standby-pins-20261127b run 20261127T235854Z-49045: the card's one Haiku renewal of 2026-11-27 succeeded, so the bound worker (release 515f6508cb1a13d386f9a26f243a6b99b8d8b611, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-27-940d258b.
