---
arcadia: v1
type: decision
id: "0023"
slug: work-pointer-under-concurrency
project: arcadia
status: approved
question: When more than one coding agent could work in the same repository at once, is `current_action` still a stored value in `PROJECT.md`, and what prevents two agents from resolving and starting the same Action?
gap_type: missing-decision
recommendation: >-
  Keep `current_action` stored, and make the concurrency limit explicit and
  enforced: one dispatched agent per repository at a time. This is already
  implied by the existing one-session-one-branch-one-worktree rule; state it as
  a dispatch precondition and have dispatch refuse when another agent's branch
  is unmerged. Do not derive the pointer.
confidence: medium
decided: 2026-08-17
answer: >-
  Approved as recommended by the operator on 2026-08-17, immediately after
  Decision 0022 was approved in its strict form. `current_action` remains a
  stored value in the managed documents. The concurrency limit becomes explicit
  and enforced: one dispatched agent per repository at a time, refused when
  another agent's branch is unmerged, using the signal
  `arcadia work monitor` already computes. The refusal is a blocker in the
  existing sense and must name the blocking branch and worktree. Deriving the
  pointer is rejected -- any tiebreak over the ready set is an ordering
  heuristic standing in for the operator's judgment, which the continuation
  protocol forbids. Committed claim records and parallel dispatch within one
  repository are not adopted and stay behind their stated trigger. Parallel
  dispatch in a single repository is therefore an accepted deliberate limit,
  not an oversight. This answer authorizes the rule, not its implementation;
  the enforcement work is a separate Action.
updated: 2026-08-17
---

# The work pointer under concurrency

## Context

`current_action` is a single mutable line in `PROJECT.md` frontmatter. Every
governed thing follows from it: `resolveDispatch` reads it, the executability
test applies to the Action it names, and the continuation protocol forbids
selecting work any other way.

One agent at a time makes this ideal — one value, one authoritative home, no
ambiguity. It is the design working exactly as intended.

Concurrency breaks it in two distinct ways, and they need separating.

**Write contention.** Two agents finishing two Actions both update
`current_action`, the plan's action list, and `MISSION_LOG.md`. Git detects the
conflict, which is better than silent corruption, but resolution is manual and
lands on whoever merges second — in the one file that governs what everyone
does next.

**Read contention, which is worse.** Two agents dispatched minutes apart both
resolve the same `current_action`, both find it executable, and both start it.
Nothing in the current design prevents this. There is no conflict to detect,
because neither has written anything yet. The duplicated work is discovered at
review time, or not at all.

Cloud agents are how this arrives. A container is cheap to start, which makes
starting several the obvious thing to do.

## Why this is not simply a merge problem

It is tempting to treat this as git hygiene. It is not, because the second
failure mode has no write to conflict on. Whatever answers this Decision has to
prevent two actors from *believing* they hold the same Action, not merely stop
them from clobbering each other's records.

## The options

### A. Keep it stored; one dispatched agent per repository, enforced

`current_action` stays exactly as it is. The concurrency limit becomes an
explicit dispatch precondition: an agent may not be dispatched into a repository
that already has an unmerged agent branch.

The appealing part is that this is nearly free, and it is already half-written.
`AGENTS.md` states that one coding session uses one branch and one worktree, and
`arcadia work monitor` already enumerates working copies and unmerged branches
per project — the exact signal a precondition would need. What is missing is
that nothing treats it as a refusal.

**Cost:** no parallel work in one repository, ever. On a forty-project portfolio
that is likely fine; on one large repository with several independent plans it is
a real ceiling.

### B. Keep it stored; add a committed claim record

`current_action` stays, and an agent must commit a claim before starting —
naming the Action, the actor, and a timestamp. Two agents racing produce a git
conflict on the claim rather than duplicated work.

This permits parallel dispatch on distinct Actions and keeps everything in the
repository, which Decision 0022 allows. But a claim has no expiry unless
something revokes it, and a crashed container leaves an Action claimed forever.
That needs a revocation story, and revocation is where this kind of mechanism
usually goes wrong.

### C. Derive the pointer instead of storing it

Remove `current_action` and compute it: take the ready set and pick
deterministically.

Some of this exists — `resolveReadySet` in `src/docs/dispatch.ts` already
enumerates every Action in the active plan that could be dispatched now. But
derivation is not *total*: the ready set can hold several Actions, and nothing
orders them. Making it total needs a tiebreak rule, and any tiebreak rule is an
ordering heuristic standing in for an operator's judgment.

That is the objection, and it is a serious one. The continuation protocol
forbids inferring priority from backlog order precisely because ordering is not
priority. Replacing an operator's explicit choice with a derived one would
reintroduce the thing the protocol exists to rule out, while looking more
rigorous.

Derivation also does not solve read contention on its own: two agents deriving
the same answer simultaneously is the default outcome, not an edge case.

### D. Reduce the contention surface

Keep the pointer but move it, so the frequently-written field is not in the
file every project-level read touches — for instance, the pointer lives only in
the active plan, and `PROJECT.md` names the plan.

This is a real mitigation of write contention and does nothing for read
contention. Worth folding into whichever option wins, not a candidate on its own.

## Recommendation

**A, with D folded in. Reject C. Hold B behind a trigger.**

One dispatched agent per repository at a time, stated as a dispatch precondition
and enforced by refusing when `work monitor` shows another agent's branch
unmerged. This costs almost nothing, reuses a signal that already exists, and
makes an existing implicit rule checkable. It also fails safely: the failure mode
is a refusal to dispatch, which is legible, rather than duplicated work, which is
not.

C is rejected on principle rather than difficulty. A derived pointer trades an
operator decision for an ordering heuristic, and the Way already forbids that
trade.

B is the right answer *if* parallel dispatch within one repository turns out to
be wanted. It should not be built before that is known, because a claim protocol
with a revocation story is substantially more machinery than the problem
currently justifies.

Confidence is `medium`, and the reason is specific: the appetite for parallel
dispatch in a single repository is genuinely unknown, and it is the only thing
that separates A from B. If the answer is "frequently," A is too restrictive and
this Decision should be reopened rather than worked around.

## What approval would settle

- `current_action` remains a stored value in the managed documents.
- Dispatch into a repository with another agent's unmerged branch is refused,
  with the blocking branch and worktree named.
- The refusal is a blocker in the existing sense: it names a file, a field, and a
  remedy.
- Parallel dispatch within one repository is not supported, and that is a
  deliberate limit rather than an oversight.

## Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Committed claim records and parallel dispatch (option B) | The one-agent limit blocks work the operator actually wanted to run in parallel, twice, in the same repository. |
| Move the pointer into the plan only (option D) | A pointer-line merge conflict actually occurs, rather than being anticipated. |
| Revisit derivation (option C) | Action dependencies become complete enough that the ready set is reliably a single Action without a tiebreak rule. |

## What this Decision does not authorize

- It does not authorize any code change; approval is the gate for the dispatch
  precondition.
- It does not decide anything about packaging or distribution.
- It assumes Decision 0022's answer that git is the only coordination channel. If
  0022 is decided otherwise, the options here change and this Decision should be
  redrafted rather than amended.
