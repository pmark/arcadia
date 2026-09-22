---
arcadia: v1
type: decision
id: "0064"
slug: resolve-how-to-handle-prove-zero-prompt-production-loop-being-dispatched-to
project: arcadia
status: open
question: Resolve how to handle prove-zero-prompt-production-loop being dispatched to coding agents when its own runbook forbids a coding agent from running it.
gap_type: missing-decision
recommendation: "Implement the #453 dispatch-vocabulary fix now (new scoped Action)"
options:
  - label: "Implement the #453 dispatch-vocabulary fix now (new scoped Action)"
    consequence: A new Action is filed to give managed-documents an operator-only responsibility/scope so resolveDispatch excludes runbook-restricted Actions; this session works that instead of the blocked current_action. prove-zero-prompt-production-loop stays open and can still re-dispatch to an agent until the fix ships and current_action moves past it.
    recommended: true
  - label: Defer prove-zero-prompt-production-loop until the operator runs the runbook by hand
    consequence: "Matches the Decision 0057/0061 precedent: set status: deferred with trigger \"operator runs docs/reports/prove-zero-prompt-production-loop-runbook.md in a plain terminal\", stopping re-dispatch to agents. The milestone rehearsal makes no progress until the operator schedules that terminal session themselves."
    recommended: false
  - label: Leave dispatch as-is
    consequence: "No governance change. The next arcadia go dispatches this same Action to another agent session, which hits the identical wall Issue #453 and this session both hit — another session spent with zero progress on the Action."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-22
---

# Decision 0064: Resolve how to handle prove-zero-prompt-production-loop being dispatched to coding agents when its own runbook forbids a coding agent from running it.

## Options

- **Implement the #453 dispatch-vocabulary fix now (new scoped Action)** (recommended): A new Action is filed to give managed-documents an operator-only responsibility/scope so resolveDispatch excludes runbook-restricted Actions; this session works that instead of the blocked current_action. prove-zero-prompt-production-loop stays open and can still re-dispatch to an agent until the fix ships and current_action moves past it.
- **Defer prove-zero-prompt-production-loop until the operator runs the runbook by hand**: Matches the Decision 0057/0061 precedent: set status: deferred with trigger "operator runs docs/reports/prove-zero-prompt-production-loop-runbook.md in a plain terminal", stopping re-dispatch to agents. The milestone rehearsal makes no progress until the operator schedules that terminal session themselves.
- **Leave dispatch as-is**: No governance change. The next arcadia go dispatches this same Action to another agent session, which hits the identical wall Issue #453 and this session both hit — another session spent with zero progress on the Action.

## Rationale

Issue #453 (open, filed 2026-09-21) documents that this Action, though Ready per its plan status/dependencies, cannot be completed by the session Go opens for it: docs/reports/prove-zero-prompt-production-loop-runbook.md explicitly says the rehearsal must run in a plain operator terminal, because an agent stepping around the go-launcher sandbox boundary would invalidate the very proof under test. This session (2026-09-22) confirmed the same block first-hand after Arcadia Go dispatched it. Decision 0057/0061 already set this precedent for the sibling Action prove-two-action-unattended-production: status: deferred to stop it re-dispatching while blocked. Nothing equivalent protects this Action, so every future arcadia go burns a session here for zero progress until this is answered.

Proposed by Agent Ask decide-prove-zero-prompt-dispatch-mismatch-2026-09-22.
