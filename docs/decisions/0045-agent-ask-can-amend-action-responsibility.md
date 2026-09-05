---
arcadia: v1
type: decision
id: "0045"
slug: agent-ask-can-amend-action-responsibility
project: arcadia
status: approved
question: Should an Agent Ask amendment be able to change an existing Action's `responsibility`, when the operator explicitly directs it?
gap_type: missing-decision
recommendation: "Yes: allow settleAgentAsk's action-amendment intent to change responsibility, but only when the operator has explicitly directed it in that live session (not as a silent side effect of an unrelated amendment)."
confidence: high
updated: 2026-09-04
answer: Yes — an Agent Ask action-amendment intent may change responsibility when the operator explicitly directs it in the live session. Ratified so open-way-sync-pull-requests can be reclassified from requires_review to agent.
decided: 2026-09-04
---

# Decision 0045: Agent Ask Can Amend Action Responsibility

## Context

Should an Agent Ask amendment be able to change an existing Action's `responsibility`, when the operator explicitly directs it?

## Resolution

Open.
