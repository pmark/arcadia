---
arcadia: v1
type: decision
id: "0061"
slug: retarget-decision-0057-s-reactivation-trigger-so-prove-two-action-unattended
project: arcadia
status: approved
question: Retarget Decision 0057's reactivation trigger so prove-two-action-unattended-production no longer waits on opencode specifically.
gap_type: missing-decision
recommendation: Retarget the trigger to any configured provider with capacity
options:
  - label: Retarget the trigger to any configured provider with capacity
    consequence: prove-two-action-unattended-production revives when the operator begins the live rehearsal on whichever configured provider has capacity -- claude-code-cli or codex-cli today, opencode-cli when it returns -- and only after the managed-production defects are fixed. The three dependent Actions stop being hostage to one provider's outage and unblock as soon as that work lands. The rehearsal then runs on a provider proven to work, rather than the one that has been failing for days. The second condition is unchanged, so nothing revives today and no dispatch loop returns.
    recommended: true
  - label: Keep Decision 0057 exactly as written
    consequence: The proof waits for opencode specifically. Three Actions stay blocked at least another day, and longer if opencode's outage continues -- it has already been broken across several sessions with an unexplained server error. The critical-path work is unaffected either way, so the cost is a delayed proof and three cards stuck in Blocked, not stalled development.
    recommended: false
  - label: Un-defer prove-two-action-unattended-production now, with no trigger
    consequence: "The Action returns to the queue immediately and the three dependents unblock at once. It also restores exactly the failure 0057 was created to stop: Arcadia Go dispatches the proof to a coding agent, whose runbook restricts the rehearsal to the operator's own terminal, so the agent cannot run it and the Action re-dispatches every cycle -- burning a session each time while the defects it depends on are still unfixed."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-20
answer: Retarget the trigger to any configured provider with capacity
decided: 2026-09-20
---

# Decision 0061: Retarget Decision 0057's reactivation trigger so prove-two-action-unattended-production no longer waits on opencode specifically.

## Options

- **Retarget the trigger to any configured provider with capacity** (recommended): prove-two-action-unattended-production revives when the operator begins the live rehearsal on whichever configured provider has capacity -- claude-code-cli or codex-cli today, opencode-cli when it returns -- and only after the managed-production defects are fixed. The three dependent Actions stop being hostage to one provider's outage and unblock as soon as that work lands. The rehearsal then runs on a provider proven to work, rather than the one that has been failing for days. The second condition is unchanged, so nothing revives today and no dispatch loop returns.
- **Keep Decision 0057 exactly as written**: The proof waits for opencode specifically. Three Actions stay blocked at least another day, and longer if opencode's outage continues -- it has already been broken across several sessions with an unexplained server error. The critical-path work is unaffected either way, so the cost is a delayed proof and three cards stuck in Blocked, not stalled development.
- **Un-defer prove-two-action-unattended-production now, with no trigger**: The Action returns to the queue immediately and the three dependents unblock at once. It also restores exactly the failure 0057 was created to stop: Arcadia Go dispatches the proof to a coding agent, whose runbook restricts the rehearsal to the operator's own terminal, so the agent cannot run it and the Action re-dispatches every cycle -- burning a session each time while the defects it depends on are still unfixed.

## Rationale

Decision 0057 (2026-09-18) deferred prove-two-action-unattended-production with the trigger: it 'revives when the operator begins the live rehearsal with --provider opencode-cli, after the further managed-production defects are fixed.' opencode was named because at that moment Codex and Claude were both credit-exhausted and opencode was the only route left. That situation has inverted: as of 2026-09-20 Claude and Codex both have capacity and opencode is unavailable for about another day, returning 'Unexpected server error' for every opencode-go model. The provider was never the point. 0057's rationale is about WHO runs the rehearsal, not which model does: the proof's runbook restricts it to the operator's own terminal, so Arcadia Go kept dispatching it to coding agents that cannot run it. Deferring parked that dispatch. Naming one provider in the trigger was incidental, and it now means three Actions -- expose-bootstrap-production-controls, prove-multi-provider-production-recovery and freeze-production-runtime-and-handoff-flight-deck -- stay blocked on a provider outage rather than on anything about the work. Note what this does NOT unblock: 0057's second condition, 'after the further managed-production defects are fixed', is unmet and is not affected by this Decision. Those defects are the critical path in docs/managed-production-readiness.md, and four of them are ready to start right now (verify-worker-recovery-before-success, fix-packet-lifecycle-latest-planning-decision, approval-must-apply-or-refuse, make-go-total-across-plans). No provider choice gates any of them. This Decision only removes the opencode dependency from the trigger; it does not revive the Action today and grants no execution, spend or merge authority.

Proposed by Agent Ask retarget-0057-trigger-off-opencode-2026-09-20. The operator approved this Decision on 2026-09-20, answering: Retarget the trigger to any configured provider with capacity.

Decision 0057's reactivation trigger is therefore read as: prove-two-action-unattended-production revives when the operator begins the live rehearsal on whichever configured provider has capacity -- claude-code-cli or codex-cli today, opencode-cli when it returns -- and only after the further managed-production defects are fixed. That second condition is unchanged by this answer.
