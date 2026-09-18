---
arcadia: v1
type: decision
id: "0057"
slug: should-prove-two-action-unattended-production-be-deferred-until-the-next-live
project: arcadia
status: approved
question: Should prove-two-action-unattended-production be deferred until the next live rehearsal uses --provider opencode-cli, or stay dispatchable?
gap_type: missing-decision
recommendation: Defer until the next opencode-cli live rehearsal
options:
  - label: Defer until the next opencode-cli live rehearsal
    consequence: The proof stops being dispatched to coding agents. It revives when the operator begins the live rehearsal with --provider opencode-cli, after the further managed-production defects are fixed.
    recommended: true
    effect: defer
  - label: Keep it dispatchable
    consequence: Arcadia keeps dispatching the proof to coding agents, which cannot run its operator-only rehearsal, so it re-dispatches.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
action: prove-two-action-unattended-production
updated: 2026-09-18
answer: Defer until the next opencode-cli live rehearsal
decided: 2026-09-17
---

# Decision 0057: Should prove-two-action-unattended-production be deferred until the next live rehearsal uses --provider opencode-cli, or stay dispatchable?

## Options

- **Defer until the next opencode-cli live rehearsal** (recommended): The proof stops being dispatched to coding agents. It revives when the operator begins the live rehearsal with --provider opencode-cli, after the further managed-production defects are fixed.
- **Keep it dispatchable**: Arcadia keeps dispatching the proof to coding agents, which cannot run its operator-only rehearsal, so it re-dispatches.

## Rationale

The operator ended the two-action rehearsal for now: managed production is Off (revision 4, epoch 3, revoked 2026-09-17) and the operator will re-run the proof with --provider opencode-cli after further managed-production defects are fixed. The Action stays agent/open/clarified, so Arcadia Go will keep dispatching a proof whose rehearsal the runbook restricts to the operator own terminal. Deferring parks that dispatch against a named trigger: the operator next live rehearsal using --provider opencode-cli. See PR #287 for the corrected runbook and the --agent-profile build-packet fix.

Proposed by Agent Ask defer-prove-two-action-unattended-production-2026-09-17.
Answered ["Defer until the next opencode-cli live rehearsal"] on 2026-09-17.

`action:` and the deferral option's `effect: defer` make the answer executable:
`arcadia decision approve 0057 --project arcadia --answer "Defer until the next opencode-cli live rehearsal"`
parks the Action in its Plan and advances the pointer to the next eligible Action
in the explicit queue. Until that command runs, dispatch resolution already treats
an approved `defer` Decision as parking its Action, so the pointer no longer
selects it (Issue #310).
