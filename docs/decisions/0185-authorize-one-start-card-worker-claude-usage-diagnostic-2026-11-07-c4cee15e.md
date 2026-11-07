---
arcadia: v1
type: decision
id: "0185"
slug: authorize-one-start-card-worker-claude-usage-diagnostic-2026-11-07-c4cee15e
project: arcadia
status: open
question: Authorize one START card worker Claude usage diagnostic 2026-11-07 c4cee15e
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Authorize one worker Claude usage diagnostic 3c76e94468a8bd6f911ff6c924a186b4deff0bd99c6a0a147109e05e3c2a1e7a
options:
  - label: Authorize one worker Claude usage diagnostic 3c76e94468a8bd6f911ff6c924a186b4deff0bd99c6a0a147109e05e3c2a1e7a
    consequence: "Authorizes only the worker grant with SHA-256 3c76e94468a8bd6f911ff6c924a186b4deff0bd99c6a0a147109e05e3c2a1e7a: nonce c4cee15e-1d89-487b-8c97-e65855c71231, expiring 2026-11-07T15:02:58.060Z, policy revision 101 epoch 55, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry."
    recommended: true
  - label: Do not authorize the check
    consequence: "No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling)."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107
updated: 2026-11-07
---

# Decision 0185: Authorize one START card worker Claude usage diagnostic 2026-11-07 c4cee15e

## Options

- **Authorize one worker Claude usage diagnostic 3c76e94468a8bd6f911ff6c924a186b4deff0bd99c6a0a147109e05e3c2a1e7a** (recommended): Authorizes only the worker grant with SHA-256 3c76e94468a8bd6f911ff6c924a186b4deff0bd99c6a0a147109e05e3c2a1e7a: nonce c4cee15e-1d89-487b-8c97-e65855c71231, expiring 2026-11-07T15:02:58.060Z, policy revision 101 epoch 55, the fixed usage endpoint and a 30000 ms deadline; one check by the bound worker, no refresh, no retry.
- **Do not authorize the check**: No usage check runs; this press's sequence and card stay consumed, and a new card may run at once (Decision 0162: no calendar-day ceiling).

## Rationale

Mechanical record under Decisions 0141, 0143 and 0161 for START card start-run-record-run-b1-20261107a run 20261107T145509Z-75901: the card's one Haiku renewal of 2026-11-07 succeeded, so the bound worker (release 323c520d1ae5d4c778695be34093cb2eee4faa19, handler 3fd5b765215e685293993a29dfe2c4ea2270f250c1d7db284bcf72eab685e413) may run exactly one usage check. No retry, no second nonce, no START by this record.

Proposed by Agent Ask start-run-signin-2026-11-07-c4cee15e.
