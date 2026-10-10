---
arcadia: v1
type: decision
id: "0112"
slug: decide-the-name-and-semantics-of-the-governed-role-every-session-starts-in-on
project: arcadia
status: approved
question: Decide the name and semantics of the governed role every Session starts in, on the smallest model, before it delegates, including how it relates to the attempt-lineage roles.
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: "Lead (Action Lead): holds the Action's development attempt (attempt_role development), does the routine work itself, requests delegates only for hard sub-problems, then integrates and settles"
options:
  - label: "Lead (Action Lead): holds the Action's development attempt (attempt_role development), does the routine work itself, requests delegates only for hard sub-problems, then integrates and settles"
    consequence: The light model does most of the edits itself rather than only delegating. That is the cheapest per Action, but quality on hard Actions depends on the Lead choosing to delegate in time. Exactly one agent mutates, which matches today's brief and lineage, and the name clashes with nothing in Arcadia.
    recommended: true
  - label: "Coordinator: holds no attempt (attempt_role null); never edits, divides the work, requests one implementer delegate that holds the Action's development attempt, and integrates the result"
    consequence: The smallest model never writes code. A single implementer delegate per Action keeps one mutation owner, so lineage still holds. The extra cost is one more model context per Action (the delegate's cold start and handoff), not one per edit. The light Coordinator's tokens drop and the implementer's rise.
    recommended: false
  - label: "Dispatcher: the same semantics as Coordinator"
    consequence: The same costs as Coordinator, and the name clashes with Arcadia's existing dispatch vocabulary (dispatch journal, arcadia next), so readers would confuse the two.
    recommended: false
  - label: "Foreman: the same semantics as Lead, under a different name"
    consequence: The behavior is identical to Lead and the name clashes with nothing, but it is not a familiar software-engineering title, so it needs more explaining.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: "Lead (Action Lead): holds the Action's development attempt (attempt_role development), does the routine work itself, requests delegates only for hard sub-problems, then integrates and settles"
decided: 2026-10-09
---

# Decision 0112: Decide the name and semantics of the governed role every Session starts in, on the smallest model, before it delegates, including how it relates to the attempt-lineage roles.

## Options

- **Lead (Action Lead): holds the Action's development attempt (attempt_role development), does the routine work itself, requests delegates only for hard sub-problems, then integrates and settles** (recommended): The light model does most of the edits itself rather than only delegating. That is the cheapest per Action, but quality on hard Actions depends on the Lead choosing to delegate in time. Exactly one agent mutates, which matches today's brief and lineage, and the name clashes with nothing in Arcadia.
- **Coordinator: holds no attempt (attempt_role null); never edits, divides the work, requests one implementer delegate that holds the Action's development attempt, and integrates the result**: The smallest model never writes code. A single implementer delegate per Action keeps one mutation owner, so lineage still holds. The extra cost is one more model context per Action (the delegate's cold start and handoff), not one per edit. The light Coordinator's tokens drop and the implementer's rise.
- **Dispatcher: the same semantics as Coordinator**: The same costs as Coordinator, and the name clashes with Arcadia's existing dispatch vocabulary (dispatch journal, arcadia next), so readers would confuse the two.
- **Foreman: the same semantics as Lead, under a different name**: The behavior is identical to Lead and the name clashes with nothing, but it is not a familiar software-engineering title, so it needs more explaining.

## Rationale

The operator asked for an explicitly named semantic role for the lightweight agent that starts each Session. The name sets what that role may do and which attempt-lineage role (planner, critique, development, code-review, qa) it holds. Names already in use: dispatch (dispatch journal), steward (src/stewardship) and Brief supervisor (src/briefSupervisor.ts). Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-session-start-role-name-2026-10-09-r2.
