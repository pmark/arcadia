---
arcadia: v1
type: decision
id: "0303"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-26-a99471ef
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-26 a99471ef
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 85775c502f01c70c07c3ee857d04fb8aab08561078e01df0ae694f90f4340a44
options:
  - label: Authorize one worker Claude usage diagnostic 85775c502f01c70c07c3ee857d04fb8aab08561078e01df0ae694f90f4340a44
    consequence: "Authorizes only the worker grant with SHA-256 85775c502f01c70c07c3ee857d04fb8aab08561078e01df0ae694f90f4340a44: nonce a99471ef-782f-4a09-b36d-16c53c0e53e8, expiring 2026-11-27T01:41:33.380Z, policy revision 199 epoch 104, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: track-4-standby-test-pins-20261126
updated: 2026-11-27
---

# Decision 0303: Authorize one START card worker Claude usage diagnostic 2026-11-26 a99471ef

## Options

- **Authorize one worker Claude usage diagnostic 85775c502f01c70c07c3ee857d04fb8aab08561078e01df0ae694f90f4340a44** (recommended): Authorizes only the worker grant with SHA-256 85775c502f01c70c07c3ee857d04fb8aab08561078e01df0ae694f90f4340a44: nonce a99471ef-782f-4a09-b36d-16c53c0e53e8, expiring 2026-11-27T01:41:33.380Z, policy revision 199 epoch 104, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-track-5-standby-pins-20261126a run 20261127T013318Z-92093: the card's one Haiku renewal of 2026-11-26 succeeded, so the bound worker (release 2378f6b839dc8c974b369cea8222077d4a1aa499, handler 576b7925e416752143f37e0038e7d4881120f4dd3a9ad7a668f7fd1588adf5e5) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-26-a99471ef.
