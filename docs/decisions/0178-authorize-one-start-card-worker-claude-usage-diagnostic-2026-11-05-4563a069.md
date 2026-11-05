---
arcadia: v1
type: decision
id: "0178"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-05-4563a069
project: arcadia
status: approved
question: Authorize one START card worker Claude usage diagnostic 2026-11-05 4563a069
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic ffe100db02df925d9a8f13158967f68e9a46b2a2fab65c13c12780423284c5eb
options:
  - label: Authorize one worker Claude usage diagnostic ffe100db02df925d9a8f13158967f68e9a46b2a2fab65c13c12780423284c5eb
    consequence: "Authorizes only the worker grant with SHA-256 ffe100db02df925d9a8f13158967f68e9a46b2a2fab65c13c12780423284c5eb: nonce 4563a069-f297-49db-a489-6e0d496d0cd5, expiring 2026-11-05T21:57:11.226Z, policy revision 95 epoch 52, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-05
answer: Authorize one worker Claude usage diagnostic ffe100db02df925d9a8f13158967f68e9a46b2a2fab65c13c12780423284c5eb
decided: 2026-11-05
---

# Decision 0178: Authorize one START card worker Claude usage diagnostic 2026-11-05 4563a069

## Options

- **Authorize one worker Claude usage diagnostic ffe100db02df925d9a8f13158967f68e9a46b2a2fab65c13c12780423284c5eb** (recommended): Authorizes only the worker grant with SHA-256 ffe100db02df925d9a8f13158967f68e9a46b2a2fab65c13c12780423284c5eb: nonce 4563a069-f297-49db-a489-6e0d496d0cd5, expiring 2026-11-05T21:57:11.226Z, policy revision 95 epoch 52, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-unattended-20261105d run 20261105T214806Z-8540: the card's one Haiku renewal of 2026-11-05 succeeded, so the bound worker (release b69a86f16a3cf95c0bdc777d37b8c4c9c11684c0, handler 3fd5b765215e685293993a29dfe2c4ea2270f250c1d7db284bcf72eab685e413) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-05-4563a069.
