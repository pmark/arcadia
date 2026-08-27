---
arcadia: v1
type: decision
id: "0036"
slug: prioritize-operator-attention-board
project: arcadia
status: approved
question: Should the operator attention board move ahead of accepted-plan promotion and the other queued Arcadia product work?
gap_type: missing-decision
recommendation: Yes. Make the minimal Needs you board the current Action now; preserve promote-accepted-plan and Ask active sessions as queued work, and reconsider their relative order after the board's core interaction is proven.
confidence: high
plan: idea-to-managed-build
action: build-operator-attention-board
updated: 2026-08-27
answer: Yes. The minimal Needs you operator attention board is Arcadia's current Action ahead of promote-accepted-plan and the other queued product work. It must make urgency, temporal trigger, relevance, significance, operator attention cost, token impact, recommendation, evidence, choices, and immediate consequences legible. This authorizes the documentation-only priority change and its local integration; it does not authorize implementation Runs, push, deployment, publication, credentials, spending, production access, or outbound messaging.
decided: 2026-08-27
---

# Decision 0036: Prioritize Operator Attention Board

## Context

Arcadia already planned a blocking-question filter and a later plan-approval
surface, but the operator identified the larger product requirement: one
minimal, powerful surface that spends operator attention deliberately across
Decisions, blockers, questions, approvals, and other judgment that can change
what happens next.

The board must communicate urgency, temporal trigger, relevance to the current
Outcome and release path, significance measured by what the item unlocks, and
cost effectiveness in both operator minutes and model-token impact. Generic
approval controls and a flat review queue do not meet that requirement.

## Resolution

Approved on operator direction, 2026-08-27. Promote the existing first Review
slice into `build-operator-attention-board` and make it the current Action in
`idea-to-managed-build`. Preserve `promote-accepted-plan`, the prepared-plan
approval surface, Ask active sessions, and the remaining governed work; this is
a priority change, not a cancellation.

The 80/20 first slice reuses the current Review data and dispatch-readiness
resolver. It delivers the ranked `Needs you` board and the typed Decision brief
before adding scoring customization, analytics, drag-and-drop, Kanban views, or
general workflow abstractions.

This Decision authorizes the documentation-only priority change and its local
integration. It does not authorize an implementation Run, push, deployment,
publication, credentials, spending, production access, or outbound messaging.

## Revisit trigger

After the core interaction is proven in normal operator use, choose whether
`promote-accepted-plan`, `build-plan-approval-surface`, or Ask active sessions
is the next highest-leverage Action. Do not infer that order from backlog
position.
