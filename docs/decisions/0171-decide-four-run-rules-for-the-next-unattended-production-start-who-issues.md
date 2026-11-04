---
arcadia: v1
type: decision
id: "0171"
slug: decide-four-run-rules-for-the-next-unattended-production-start-who-issues
project: arcadia
status: open
question: "Decide four run rules for the next unattended production START: who issues production Off at scope complete, whether a failed required CI job may be re-run, whether each retry needs a press, and whether three open documentation PRs wait."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Accept all four run rules
options:
  - label: A. Accept all four run rules
    consequence: Rowan issues production Off once the run reports scope complete, and that Off is not an operator touch. Rowan may re-run a failed required CI job once per head when the failure is not attributed to the candidate's change, recording each re-run, and the run can still count as clean. Each retry needs a new operator press, at most three under Decision 0170, with no delegation. PRs 1932, 2027 and 2028 wait until scope complete, so the card does not refuse on a moved main.
    recommended: true
  - label: B. Keep today's rules
    consequence: The operator turns production Off, which is not an allowed touch under the current definition of a clean run, so a clean run could not be recorded without a further ruling. A single unattributed CI failure stops the run, because nothing re-runs it. Retries and the three PRs are decided case by case.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-04
---

# Decision 0171: Decide four run rules for the next unattended production START: who issues production Off at scope complete, whether a failed required CI job may be re-run, whether each retry needs a press, and whether three open documentation PRs wait.

## Options

- **A. Accept all four run rules** (recommended): Rowan issues production Off once the run reports scope complete, and that Off is not an operator touch. Rowan may re-run a failed required CI job once per head when the failure is not attributed to the candidate's change, recording each re-run, and the run can still count as clean. Each retry needs a new operator press, at most three under Decision 0170, with no delegation. PRs 1932, 2027 and 2028 wait until scope complete, so the card does not refuse on a moved main.
- **B. Keep today's rules**: The operator turns production Off, which is not an allowed touch under the current definition of a clean run, so a clean run could not be recorded without a further ruling. A single unattributed CI failure stops the run, because nothing re-runs it. Retries and the three PRs are decided case by case.

## Rationale

The pre-mortem of the next serial START, 2026-11-04, raised these as the questions left for the operator. Rowan recommended accepting all four, and the operator answered in Rowan's chat, 2026-11-04: "Yes, accept all four". They sit beside Decision 0170, whose limits still bind: first-unattended-run's criterion on operator touches is unchanged, and Decisions 0163, 0071, 0097 and 0117 stand. Each failure a re-run clears stays recorded in the run's evidence. This Decision grants no START, spend or merge: each press stays the operator's.

Proposed by Agent Ask decide-serial-start-run-rules-20261104.
