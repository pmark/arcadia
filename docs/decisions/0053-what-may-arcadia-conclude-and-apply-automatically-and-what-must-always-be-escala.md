---
arcadia: v1
type: decision
id: "0053"
slug: what-may-arcadia-conclude-and-apply-automatically-and-what-must-always-be-escala
project: arcadia
status: approved
question: What may Arcadia conclude and apply automatically, and what must always be escalated to the operator?
gap_type: missing-decision
recommendation: Auto-apply obvious, escalate judgment
options:
  - label: Auto-apply obvious, escalate judgment
    consequence: A conclusion that is reversible, has exactly one defensible answer, sits inside existing authority, and crosses no gate is settled automatically with its reasoning recorded and becomes a candidate Action for arcadia go. Anything with two materially different reasonable options, anything irreversible or outward-facing (merge, deploy, publish, spend, credentials, production, messaging), or anything a mistake would hide still escalates to you as one ranked choice with consequences and a recommendation.
    recommended: true
  - label: Auto-apply inert mechanics only
    consequence: Only pointer moves, formatting, telemetry and other inert mechanics auto-apply; every document, behaviour, or acceptance-criteria change still waits for your answer. Safer, but most concluded questions stay in the queue.
    recommended: false
  - label: Escalate everything (status quo)
    consequence: Every open question keeps waiting for a manual answer; nothing auto-resolves, and loose ends accumulate in Waiting on you.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-16
answer: Auto-apply obvious, escalate judgment
decided: 2026-09-16
---

# Decision 0053: What may Arcadia conclude and apply automatically, and what must always be escalated to the operator?

## Options

- **Auto-apply obvious, escalate judgment** (recommended): A conclusion that is reversible, has exactly one defensible answer, sits inside existing authority, and crosses no gate is settled automatically with its reasoning recorded and becomes a candidate Action for arcadia go. Anything with two materially different reasonable options, anything irreversible or outward-facing (merge, deploy, publish, spend, credentials, production, messaging), or anything a mistake would hide still escalates to you as one ranked choice with consequences and a recommendation.
- **Auto-apply inert mechanics only**: Only pointer moves, formatting, telemetry and other inert mechanics auto-apply; every document, behaviour, or acceptance-criteria change still waits for your answer. Safer, but most concluded questions stay in the queue.
- **Escalate everything (status quo)**: Every open question keeps waiting for a manual answer; nothing auto-resolves, and loose ends accumulate in Waiting on you.

## Rationale

Open proposals and Decisions currently wait uniformly for a human regardless of whether exactly one defensible, reversible answer exists, so operator attention is spent on mechanical questions and forward progress stalls. Arcadia already separates mechanics from judgment for work via the Constitution's three-question gate; applying the same gate to decisions would auto-resolve the obvious and interrupt only where judgment changes the outcome. This Decision grants the standing policy that governs that triage.

Proposed by Agent Ask auto-adjudication-policy-2026-09-16.
