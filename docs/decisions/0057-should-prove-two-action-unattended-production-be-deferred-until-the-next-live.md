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
updated: 2026-09-30
answer: Keep it dispatchable
decided: 2026-09-30
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

## Reopened 2026-09-29

The deferral above stands as history: the trigger named an `opencode-cli` live
rehearsal. The operator chose `codex-cli` for the v5 rehearsal instead, and it
ran Actions A and B end to end unattended on 2026-09-29, both reconciled
`accepted_completion`. That is the reason this Decision is reopened. It is not
proof: the remaining live stages (split one Action across two Sessions, turn Off
mid-work, restart the worker) have not run, and the proof stays provisional
until they pass. Reversal receipt `decisionrev_9d65c3d96118420caa`.
