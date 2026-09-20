---
arcadia: v1
type: decision
id: "0056"
slug: should-a-conclusion-create-its-candidate-action-automatically
project: arcadia
status: approved
question: Should a conclusion create its candidate Action automatically?
gap_type: missing-decision
recommendation: Conclusion creates the Action
options:
  - label: Conclusion creates the Action
    consequence: "Every accepted or auto-applied conclusion auto-drafts its candidate Action via Agent Ask, places it in the queue, and leaves arcadia go to dispatch it. Escalations are presented as one ranked menu of live choices with consequences and a recommendation; nothing sits as a passive file, and a single answer unblocks work. Authority is unchanged: approval boundaries and gates still escalate and are never auto-applied."
    recommended: true
  - label: Keep the manual conversion
    consequence: A conclusion stays in Waiting on you until an operator manually converts it into an Action, and open questions remain an unranked list. Progress depends on the operator doing the bookkeeping that Arcadia can already do.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-16
answer: Conclusion creates the Action
decided: 2026-09-16
---

# Decision 0056: Should a conclusion create its candidate Action automatically?

## Options

- **Conclusion creates the Action** (recommended): Every accepted or auto-applied conclusion auto-drafts its candidate Action via Agent Ask, places it in the queue, and leaves arcadia go to dispatch it. Escalations are presented as one ranked menu of live choices with consequences and a recommendation; nothing sits as a passive file, and a single answer unblocks work. Authority is unchanged: approval boundaries and gates still escalate and are never auto-applied.
- **Keep the manual conversion**: A conclusion stays in Waiting on you until an operator manually converts it into an Action, and open questions remain an unranked list. Progress depends on the operator doing the bookkeeping that Arcadia can already do.

## Rationale

The 0053 triage showed strict auto-adjudication resolves almost nothing, because the open queue is gates, Way changes, and acceptance judgments that must escalate. The remaining cost is presentation: a concluded question still needs a human to convert it into work, and open questions sit as passive files. This rule closes that gap without widening authority: any conclusion -- auto-applied under 0053 or answered by the operator -- immediately drafts its candidate Action through Agent Ask and hands it to arcadia go, and every escalation arrives as one ranked menu with consequences and a recommendation instead of an unranked list. Decision 0053 governs what may be concluded; this governs what happens the moment it is.

Proposed by Agent Ask conclusion-creates-candidate-action-2026-09-16.
