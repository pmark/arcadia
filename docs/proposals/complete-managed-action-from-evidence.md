---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia provide a previewable completion transition that records accepted revision-bound evidence, marks one managed Action done, and resolves the next governed Action, question, blocker, or completed Plan without redispatching finished work?
---

# Complete a managed Action from evidence

## Why this Project needs it

The Flight Deck board Action has a committed implementation, passing fixture
tests, and a successful dashboard production build. Its accepted Agent Ask
settlement amended the Action's evidence and references but intentionally
preserved its `open` status and current pointer. No supported `advance` or
Agent Ask contract field can make the managed completion transition.

## What we would build locally

A direct document edit or a local completion command. This proposal exists to
avoid both: completion must remain previewable, operator-settled, evidence
bound, and written by Arcadia's canonical managed-document writer.

## Smallest implementation

Extend the existing settlement and canonical writer path. Bind the exact
Project/Plan/Action, Candidate revision, acceptance criteria and evidence to the
preview; changed evidence or documents invalidate it. Operator settlement can
authorize one transition. Automatic settlement requires a separately approved
production policy that explicitly delegates mechanical acceptance.

Completion and next-state resolution form one recoverable transition. Select
the next governed Action even when it needs judgment or an external input;
report that stop instead of leaving a done Action dispatchable. A finished Plan
must report completion or an explicitly authorized Plan handoff. Never choose
an inactive Plan from queue order alone.

Required refusal tests cover missing/failed/skipped validation, stale revision,
unresolved blocking review, absent authority, and replay/crash recovery without
duplicate Logs or skipped Actions. Implement this in the production bootstrap's
`advance-approved-production-work` Action before enabling unattended admission.
