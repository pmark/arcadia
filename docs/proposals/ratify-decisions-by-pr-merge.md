---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia treat the operator's merge of a pull request that adds an approved Decision document as that Decision's ratification, so the operator can decide through a PR merge instead of an Arcadia CLI or UI surface?
---

# Ratify Decisions by pull request merge

## Why this project needs it

The operator wants to make decisions mainly through pull requests. AGENTS.md
already sends a "ready for you" ping for exactly that ("PR lifecycle
notifications"). Answering a Decision, though, still needs Arcadia itself:

1. `agent-ask settle --apply`, to create the open Decision;
2. `decision approve --answer …`, to record the answer.

Both need the operator's workspace. A cloud session cannot reach that
workspace, so every Decision drafted in the cloud comes back to a local
terminal for two commands.

Decision 0074 (the module integration contract) was the first one recorded
the other way:
- the agent wrote an `approved` Decision document carrying the answer the
  operator gave in session;
- it archived the now-superseded Decision Ask unsettled;
- the operator's merge of that PR is the ratification.

That works because checked-in documentation is authoritative and
`arcadia docs sync` ingests the document. But nothing in the Way names this
path, checks it, or distinguishes it from an agent fabricating an answer.

## What we would build locally

Nothing, and this proposal exists so that nothing is built locally. The
tempting local version is a convention in agent instructions: "write the
Decision as approved, and let the merge count". It would have no guard
against an agent merging its own ratification PR, which "Merge on green"
already excludes but does not enforce.

## What Arcadia could do

- **A `ratified_by` field on a Decision** naming the pull request, e.g.
  `ratified_by: pmark/arcadia#NNN`. `docs sync` would accept an `approved`
  Decision carrying it only when both of these hold, and would refuse or flag
  it otherwise:
  - that PR was merged by the operator, not by an agent identity; and
  - that PR's merge added or changed this exact Decision path, with the same
    `answer` and `status` as the document now on the base branch.

  The second check binds the ratification to its content. Without it, a
  Decision could cite an unrelated PR the operator merged, or be edited after
  the merge that ratified it.
- **Settle-on-merge for Decision Asks.** When a merged PR adds a
  `decision`-intent Ask plus the operator's chosen option, Arcadia settles
  and answers it deterministically, the way `attemptAutoSettlePendingCompletion`
  already settles drafted `complete` Asks.
- **Guidance in AGENTS.md** saying when an agent may draft an `approved`
  Decision for merge-ratification: only with an answer the operator gave in
  their own words, and never merged by the agent.

Trigger for revisiting if deferred: a second Decision is ratified by PR merge.
