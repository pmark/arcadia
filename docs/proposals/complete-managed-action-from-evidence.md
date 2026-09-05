---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia provide a previewable, operator-settled completion transition that marks one managed Action `done`, records supplied validation evidence, and advances the pointer only when the next Action is dispatchable?
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
