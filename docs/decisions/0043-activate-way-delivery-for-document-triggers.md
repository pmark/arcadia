---
arcadia: v1
type: decision
id: "0043"
slug: activate-way-delivery-for-document-triggers
project: arcadia
status: approved
question: Should Arcadia's work pointer move from agent-ask-execution-queue to way-delivery so evaluate-document-triggers becomes dispatchable, while the Ask queue milestone is left mid-flight?
gap_type: missing-decision
recommendation: Yes. Activate way-delivery at evaluate-document-triggers. The pointer was parked on dogfood-agent-managed-queue, which is requires_review and cannot be dispatched, so nothing was startable in Arcadia. The triggers Action is clarified, codex-owned, session-sized, zero-model, and makes nine already-declared deferrals evaluable, giving the continuation protocol's firing-trigger rule something to read for the first time.
confidence: high
plan: way-delivery
action: evaluate-document-triggers
updated: 2026-09-01
answer: "Approved by the operator on 2026-09-01: activate way-delivery and set current_action to evaluate-document-triggers. agent-ask-execution-queue keeps status active and retains its two newly queued Ask-quality Actions plus the open dogfood question; it is paused, not superseded. Decision 0042's answer still stands — arcadia-ask-active-sessions reactivates at build-guided-understanding-session once the agent-managed-queue proof is accepted."
decided: 2026-09-01
---

# Decision 0043: Activate Way Delivery For Document Triggers

## Context

Should Arcadia's work pointer move from agent-ask-execution-queue to way-delivery so evaluate-document-triggers becomes dispatchable, while the Ask queue milestone is left mid-flight?

## Resolution

Open.
