---
arcadia: v1
type: decision
id: "0189"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-07-8f82e42c
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-07 8f82e42c
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 35b6c3ae2a26e968a6b51bd245eaf649e0eed8aee1d174f597c9caaa4cdc63c0
options:
  - label: Authorize one worker Claude usage diagnostic 35b6c3ae2a26e968a6b51bd245eaf649e0eed8aee1d174f597c9caaa4cdc63c0
    consequence: "Authorizes only the worker grant with SHA-256 35b6c3ae2a26e968a6b51bd245eaf649e0eed8aee1d174f597c9caaa4cdc63c0: nonce 8f82e42c-4935-4c9f-bcef-a225e4ce8964, expiring 2026-11-07T19:56:49.341Z, policy revision 105 epoch 57, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107
updated: 2026-11-07
---

# Decision 0189: Authorize one START card worker Claude usage diagnostic 2026-11-07 8f82e42c

## Options

- **Authorize one worker Claude usage diagnostic 35b6c3ae2a26e968a6b51bd245eaf649e0eed8aee1d174f597c9caaa4cdc63c0** (recommended): Authorizes only the worker grant with SHA-256 35b6c3ae2a26e968a6b51bd245eaf649e0eed8aee1d174f597c9caaa4cdc63c0: nonce 8f82e42c-4935-4c9f-bcef-a225e4ce8964, expiring 2026-11-07T19:56:49.341Z, policy revision 105 epoch 57, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-record-run-b2-20261107b run 20261107T194842Z-60234: the card's one Haiku renewal of 2026-11-07 succeeded, so the bound worker (release 1c838c15b5c518d0552b4e235d1709f84954907e, handler 319c90143d8e4da4f96840d0aee7a173c27d11fce910a46406f9baaf8df8df7a) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-07-8f82e42c.
