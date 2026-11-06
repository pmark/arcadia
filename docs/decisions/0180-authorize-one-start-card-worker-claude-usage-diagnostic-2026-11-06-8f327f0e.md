---
arcadia: v1
type: decision
id: "0180"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-06-8f327f0e
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-06 8f327f0e
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 35ffc4e028d32b79c0a9410452d56a5aaac413d54779af5b91064210f812b6ef
options:
  - label: Authorize one worker Claude usage diagnostic 35ffc4e028d32b79c0a9410452d56a5aaac413d54779af5b91064210f812b6ef
    consequence: "Authorizes only the worker grant with SHA-256 35ffc4e028d32b79c0a9410452d56a5aaac413d54779af5b91064210f812b6ef: nonce 8f327f0e-7457-4a0f-875a-b33d96202e77, expiring 2026-11-06T12:56:58.732Z, policy revision 97 epoch 53, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: keep-unattended-serial-production-running-overnight-on-three-test-only-actions
updated: 2026-11-06
---

# Decision 0180: Authorize one START card worker Claude usage diagnostic 2026-11-06 8f327f0e

## Options

- **Authorize one worker Claude usage diagnostic 35ffc4e028d32b79c0a9410452d56a5aaac413d54779af5b91064210f812b6ef** (recommended): Authorizes only the worker grant with SHA-256 35ffc4e028d32b79c0a9410452d56a5aaac413d54779af5b91064210f812b6ef: nonce 8f327f0e-7457-4a0f-875a-b33d96202e77, expiring 2026-11-06T12:56:58.732Z, policy revision 97 epoch 53, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-overnight-keep-unattended-20261106g1 run 20261106T124931Z-72613: the card's one Haiku renewal of 2026-11-06 succeeded, so the bound worker (release 0a37231431495819b18d536910076103512ac4fd, handler 3fd5b765215e685293993a29dfe2c4ea2270f250c1d7db284bcf72eab685e413) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-06-8f327f0e.
