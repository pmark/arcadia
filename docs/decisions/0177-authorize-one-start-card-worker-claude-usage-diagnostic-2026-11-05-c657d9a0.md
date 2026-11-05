---
arcadia: v1
type: decision
id: "0177"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-05-c657d9a0
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-05 c657d9a0
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic f385b933e374ee91ab5b9442d8cbe0e842983ba56cf77dece3d40010aa260ff4
options:
  - label: Authorize one worker Claude usage diagnostic f385b933e374ee91ab5b9442d8cbe0e842983ba56cf77dece3d40010aa260ff4
    consequence: "Authorizes only the worker grant with SHA-256 f385b933e374ee91ab5b9442d8cbe0e842983ba56cf77dece3d40010aa260ff4: nonce c657d9a0-e3db-4252-8a60-5b1e1f4b7daa, expiring 2026-11-05T20:11:06.355Z, policy revision 95 epoch 52, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-05
---

# Decision 0177: Authorize one START card worker Claude usage diagnostic 2026-11-05 c657d9a0

## Options

- **Authorize one worker Claude usage diagnostic f385b933e374ee91ab5b9442d8cbe0e842983ba56cf77dece3d40010aa260ff4** (recommended): Authorizes only the worker grant with SHA-256 f385b933e374ee91ab5b9442d8cbe0e842983ba56cf77dece3d40010aa260ff4: nonce c657d9a0-e3db-4252-8a60-5b1e1f4b7daa, expiring 2026-11-05T20:11:06.355Z, policy revision 95 epoch 52, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-unattended-20261105c run 20261105T200333Z-74107: the card's one Haiku renewal of 2026-11-05 succeeded, so the bound worker (release 8a1c4e44c8692c18464eb0e6d01e44b03b6b9779, handler 9d5486ede9e80649be8d6e547538d11aa274a0b7c90059546a3e18ca99b31ea1) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-05-c657d9a0.
