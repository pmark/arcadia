---
arcadia: v1
type: decision
id: "0134"
slug: confirm-recording-the-operator-s-prior-2026-10-21-instruction-reported-in
project: arcadia
status: approved
question: Confirm recording the operator's prior 2026-10-21 instruction, reported in PR1654 as "100%, no reserve", as a standing 0% reserve for included provider-capacity windows. Supersede only Decision0111's numeric20% floor and Decision0130's resulting80% Claude admission ceiling; do not reopen percentage selection.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Confirm the recorded 2026-10-21 no-reserve instruction
options:
  - label: Confirm the recorded 2026-10-21 no-reserve instruction
    consequence: Record0% reserve for included provider windows; admit only with fresh valid unexhausted windows below100%. Supersede only the conflicting numeric20/80 clauses of0111/0130. Preserve all other gates and historical records; no activation, credential probe, paid fallback or pause/Resume implementation is approved.
    recommended: true
  - label: Defer confirmation
    consequence: Do not change or infer the intended threshold. Keep productionOff and futureSTART blocked on this reconciliation; independently authorized diagnostics and Off runtime proof may continue. Retrieve the original human turn or record the operator's correction later.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-10-24
answer: Confirm the recorded 2026-10-21 no-reserve instruction
decided: 2026-10-24
---

# Decision 0134: Confirm recording the operator's prior 2026-10-21 instruction, reported in PR1654 as "100%, no reserve", as a standing 0% reserve for included provider-capacity windows. Supersede only Decision0111's numeric20% floor and Decision0130's resulting80% Claude admission ceiling; do not reopen percentage selection.

## Options

- **Confirm the recorded 2026-10-21 no-reserve instruction** (recommended): Record0% reserve for included provider windows; admit only with fresh valid unexhausted windows below100%. Supersede only the conflicting numeric20/80 clauses of0111/0130. Preserve all other gates and historical records; no activation, credential probe, paid fallback or pause/Resume implementation is approved.
- **Defer confirmation**: Do not change or infer the intended threshold. Keep productionOff and futureSTART blocked on this reconciliation; independently authorized diagnostics and Off runtime proof may continue. Retrieve the original human turn or record the operator's correction later.

## Rationale

PR1654 merged a 20-to-0 reserve change, but checked-in Decisions0111/0130 still state20/80. The direct Claude Remote Control human turn is not readable with available tools, so the exact prior instruction needs one narrow confirmation before START. Keep historical answers intact and append a superseding record; do not fabricate operator-presence proof. This records the standing baseline, not a temporary reserve-release grant. Preserve Decision0110 for future applicable proof-gated reserve operations, all credential authority, freshness, unknown/reset/exhaustion refusals, no paid credits/fallback, and all scope/concurrency/time/attempt/review gates. Pending pause-and-Resume remains separate and deferred.

Proposed by Agent Ask record-pr1654-no-reserve-supersession-20261024.
