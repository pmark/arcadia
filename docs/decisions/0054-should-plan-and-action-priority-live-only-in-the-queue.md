---
arcadia: v1
type: decision
id: "0054"
slug: should-plan-and-action-priority-live-only-in-the-queue
project: arcadia
status: open
question: Should plan and Action priority live only in the queue?
gap_type: missing-decision
recommendation: Priority lives in the queue
options:
  - label: Priority lives in the queue
    consequence: Priority-only questions are closed as superseded as soon as they are written; priority requests route to advance queue moves (top/before/after); no priority-only Decision opens again. Any genuine dependency, acceptance, or capability question still escalates normally under 0053.
    recommended: true
  - label: Keep priority Decisions
    consequence: Priority questions keep accumulating in Waiting on you and must be re-answered whenever they go stale, even though the queue already determines dispatch order.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-16
---

# Decision 0054: Should plan and Action priority live only in the queue?

## Options

- **Priority lives in the queue** (recommended): Priority-only questions are closed as superseded as soon as they are written; priority requests route to advance queue moves (top/before/after); no priority-only Decision opens again. Any genuine dependency, acceptance, or capability question still escalates normally under 0053.
- **Keep priority Decisions**: Priority questions keep accumulating in Waiting on you and must be re-answered whenever they go stale, even though the queue already determines dispatch order.

## Rationale

A priority Decision carries no reviving trigger, so it binds today to a past ordering the moment it is written; the live queue already re-derives priority at every dispatch, so such a Decision is structurally stale and spends operator attention without changing what happens next. Arcadia's own deferral rule ("If not now, then when?") requires a named trigger for anything postponed, and a priority choice has none. Encoding priority in the queue keeps it continuously correct instead of periodically re-litigated. This is the guardrail companion to Decision 0053: 0053 says auto-apply the obvious and escalate judgment; this says priority is never judgment, it is queue state.

Proposed by Agent Ask priority-is-queue-derived-2026-09-16-v2. This Decision remains open until the operator answers it.
