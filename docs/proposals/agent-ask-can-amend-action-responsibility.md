---
arcadia: v1
type: proposal
project: arcadia
question: Should an Agent Ask amendment be able to change an existing Action's `responsibility`, when the operator explicitly directs it?
---

# Agent Ask amending Action responsibility

## Why this project needs it

`way-delivery#open-way-sync-pull-requests` is the only open Action left in the
plan and the whole project currently has nothing left for a coding agent to
dispatch. Its `responsibility: requires_review` was set when it was written;
the operator has since reviewed it and asked, in a live session, to reclassify
it to `agent` (or `autonomous`) so `arcadia go`/`arcadia next` can dispatch it.

`settleAgentAsk`'s `action` intent explicitly refuses this today:

```
if (input.placement || input.responsibility) throw validationError(
  "Action amendment preserves its existing Responsibility and queue position."
);
```

That refusal is deliberate — Decision 0044's history shows Responsibility is
meant to be set once, at Action creation, not silently drifted by an
amendment. But there is currently no governed path *at all* to correct a
Responsibility that was simply wrong or has become stale, even with an
explicit, current operator instruction behind it. The only way around it today
would be a coding agent hand-editing the plan document's `responsibility:`
field directly, which is exactly the fabricated-record failure mode
`AGENTS.md`'s Agent Ask section exists to prevent.

## What we would build locally

A `settleAgentAsk` code path that special-cases `responsibility` amendment
outside the existing safe-and-narrow `amendAction` helper — reimplementing
part of the governed action-mutation surface inside this repository rather
than asking Arcadia to grow the capability, which is exactly the local-drift
failure mode Decision 0025 exists to prevent.
