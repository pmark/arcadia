---
arcadia: v1
type: decision
id: "0174"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-04-f7699b15
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-04 f7699b15
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic a767e40116ae0f3603c50bb709c5f0eb54e462493bfd671e6f8b44c799c49a15
options:
  - label: Authorize one worker Claude usage diagnostic a767e40116ae0f3603c50bb709c5f0eb54e462493bfd671e6f8b44c799c49a15
    consequence: "Authorizes only the worker grant with SHA-256 a767e40116ae0f3603c50bb709c5f0eb54e462493bfd671e6f8b44c799c49a15: nonce f7699b15-9e1a-497c-9dbb-a8d70b85f236, expiring 2026-11-05T02:03:40.988Z, policy revision 93 epoch 51, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-05
---

# Decision 0174: Authorize one START card worker Claude usage diagnostic 2026-11-04 f7699b15

## Options

- **Authorize one worker Claude usage diagnostic a767e40116ae0f3603c50bb709c5f0eb54e462493bfd671e6f8b44c799c49a15** (recommended): Authorizes only the worker grant with SHA-256 a767e40116ae0f3603c50bb709c5f0eb54e462493bfd671e6f8b44c799c49a15: nonce f7699b15-9e1a-497c-9dbb-a8d70b85f236, expiring 2026-11-05T02:03:40.988Z, policy revision 93 epoch 51, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-unattended-20261105a run 20261105T015617Z-3828: the card's one Haiku renewal of 2026-11-04 succeeded, so the bound worker (release 74956a2cb102ca1a15dee751732050b5814a84da, handler f98d7c1b59c14c8f9e0b6e72517cd249fdefe9304ec08f21a0cceb37f915eb94) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-04-f7699b15.
