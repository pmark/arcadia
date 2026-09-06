---
arcadia: v1
type: reference
slug: agent-continuation-protocol
project: arcadia
updated: 2026-08-16
---
<!-- ARCADIA_CONTEXT_START -->
# Agent Continuation Protocol

How a coding agent starts work, how it behaves while working, and what it owes
before it stops. This is the canonical copy for every repository on the Arcadia
Way; adopting repositories receive it through `arcadia project setup-context`
rather than writing their own.

The operative rules also appear in [`AGENTS.md`](../AGENTS.md), which every
coding agent loads automatically. That duplication is deliberate and bounded:
`AGENTS.md` carries the rules an agent must follow without being told to read
anything, and this file carries the same rules with the reasoning behind them.
When the two disagree, `AGENTS.md` is what actually reached the agent — fix
this file to match it, in the same change.

## Starting: resolve, never infer

```sh
pnpm arcadia next --project <slug>
```

That command is the whole startup procedure. It resolves the authoritative work
pointer and returns exactly one of three answers: dispatchable, one operator
question, or blockers naming a file and a field.

Resolution order:

1. Read the repository instructions and the Arcadia context policy.
2. Read `PROJECT.md`, and the continuation brief for its `current_action` if the
   repository keeps one.
3. Open the plan named by `active_plan`.
4. Locate the Action named by `current_action`.
5. Read that Action's references, dependencies, and required Decisions.
6. Inspect the worktree and preserve changes that are not part of the Action.
7. Execute until the acceptance criteria pass or a genuine authority boundary is
   reached.

**Never infer priority** from recent commits, source-code activity, backlog
order, or whichever task looks easiest. Those are the four things this protocol
exists to rule out.

Some repositories name the read-only view differently — `arcadia docket` where
`arcadia next` is used here. The command differs; the resolution does not. A
noun command reads state and never mutates it.

## A current Action is executable only when

- it exists exactly once in the active plan;
- its status is anything but `done`;
- its clarification is `clarified`;
- its responsibility is `autonomous` or `agent`;
- its `next_action` begins with a concrete verb; and
- its acceptance criteria define observable completion.

**`open` is executable.** An Action does not have to be `in_progress` to be
picked up, and dispatch does not require it — `src/docs/dispatch.ts` refuses
only `done`. This is stated because a repository's local protocol once required
`in_progress`, which no check enforced, and read strictly it made every
freshly-selected Action unexecutable. Two coding agents independently stopped on
that ambiguity rather than guess, which is the right instinct and a cost worth
not paying twice.

If any condition fails, **repairing the control documents is the immediate
work** — not an obstacle to it. Do not route around a refusal by editing the
database, picking a different Action, or loosening the rule that produced it.

If the repair would choose between materially different milestones, record one
open Decision and ask the operator exactly one highest-leverage question.

## While working

- Continue through safe implementation, tests, and documentation without waiting
  for routine confirmation.
- Do not deploy, publish, merge, spend, use credentials, destroy data, or change
  strategic direction without the required authority.
- Do not discard or overwrite unexplained worktree changes.
- Treat source documents and Decision records as constraints, not suggestions.
- Keep uncertainty visible. An assumption you made silently is one the operator
  cannot correct.

## Before stopping

Do one of these three, and update `PROJECT.md`, the active plan, affected
Decisions, and `MISSION_LOG.md` wherever their authoritative state changed:

- Complete the Action, validate it, record the result, and explicitly select the
  next one.
- Record one precise operator question required for review.
- Record a concrete external blocker and the draft ask needed to resolve it.

Leave changed code merged or on a pushed branch with a draft or ready pull
request. If commit, push, or PR creation is not authorized, report the exact
repository, worktree, branch, dirty paths, and recovery action. Never silently
leave uncommitted work on a default branch or a detached HEAD.

### When a milestone completes

A merged pull request, a ratified Decision, or a plan reaching its stated
milestone is itself a stopping condition — not a point to log and continue past.
Before starting the next batch:

- **Open or update a pull request now.** Every significant stopping point gets a
  reviewable surface the moment it is reached. Do this without being asked, and
  do not defer it until the plan closes out; a milestone reached mid-plan still
  gets a PR opened or updated now.
- **Say whether to continue in this session or start a new one**, with the
  reason: context volume, a clean boundary between unrelated work, or a
  long-running session worth resetting.
- **Say which model and effort level the next batch needs**, sized to that work
  rather than defaulted to whatever is already running.

### Ending a stopping point with choices

A report that ends in prose hands the operator one more job: read it, work out
what could happen next, and decide which of those to ask for. That job is the
agent's, and doing it badly is how momentum dies at exactly the moment there is
the most to show for the work.

So every stopping point ends with one of two explicit handoffs: an opened or
updated pull request for completed work, or the actual live choices presented
as an actionable picker. A narrative report, a bare status update, and an
`OK to go` line alone are invalid terminals.

Use the host's native picker when it is available. Otherwise, present a
plainly labelled numbered selection prompt. A single live next action still
requires a one-option picker; never make the operator infer that they should
reply "continue".

- **Each option states its consequence.** Selecting is only cheap when the cost
  of each option is already on screen; otherwise the operator has to reconstruct
  it, which is the work the picker was supposed to remove. If a consequence
  cannot be stated, that option has not been thought through and is not ready to
  be offered.
- **Only live options appear.** A settled question re-asked is a decision taken
  twice at full price — the same failure "If not now, then when?" names for
  deferrals without triggers.
- **Ending the session is a legitimate option, and sometimes the right one.**
  Say so plainly when it is: context volume, a clean boundary between unrelated
  work, or a long session worth resetting. Say what opens the next one, which is
  almost always `arcadia go` — the pointer already resolves what comes next, so
  naming a specific task in its place is guessing ahead of the document that
  actually knows. Name a different opening move only when it genuinely differs,
  and say why.
- **Size the next batch** — model and effort for the work being chosen, not for
  the work just finished.

The pull request and picker cover every stopping point. The former is the
actionable handoff for delivered code; the latter makes the next required
operator or agent move explicit. Between them there is no stopping point where
the operator is left to derive what to do unaided.

This applies in every message, in every repository on the Arcadia Way — not
only after a milestone.
<!-- ARCADIA_CONTEXT_END -->
