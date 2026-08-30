---
arcadia: v1
type: reference
slug: operating-model
project: arcadia
updated: 2026-08-07
---

# How Arcadia Works

Arcadia is a local-first operating system for one person running several
projects with coding agents.

It is not a project manager, an agent framework, or a wrapper around a chat
box. It exists for one problem:

> **A coding agent is capable within a session and amnesiac between them. You
> are the only thing carrying context across that gap — and you are running
> more projects than you can hold in your head.**

Most time lost to agent-assisted development is not spent coding. It is spent
re-establishing what was already decided: which branch, which plan, what was
tried, what it depends on, why the last attempt was abandoned. Arcadia's job is
to make *what should happen next here, and why* a durable fact on disk instead
of something you re-explain every morning.

## The commitment that shapes everything else

**Plans live in your projects. Arcadia aggregates them; it does not own them.**

A project's governance — its `PROJECT.md`, its plans, its decisions, its log —
lives in that project's own repository, versioned with the code it governs.
Arcadia reads them. It never becomes the master copy.

This is a real constraint with real consequences, and it is worth being
explicit about the trade:

| | Plans in Arcadia (rejected) | Plans in the project (chosen) |
|---|---|---|
| Where an agent finds context | A separate system it must query | The repo it is already working in |
| What happens if Arcadia is gone | Your plans are stranded | Your repos are complete and portable |
| Reviewing a plan change | A second review surface | The same pull request as the code |
| Cost | — | Arcadia must go read N repositories |

The last row is the price. Arcadia pays it so that **any project remains fully
understandable without Arcadia installed** — including by an agent that has
never heard of Arcadia. A plan that only makes sense inside a tool is a plan
you cannot hand to anyone.

## The unit of work is a session

A session is one bounded stretch of agent work: it starts from a clean
worktree and a named next action, and it ends with commits, some documents, and
a clearer idea of what comes next.

That last part matters more than it sounds. **Doing the work is what reveals
the next work.** In practice you rarely plan first and execute second. You
execute, and in executing you discover the thing that should be built, or the
decision that has to be made before anything else is safe. Arcadia is built for
that order, not against it.

So a session's real output is two things:

1. **Commits** — what changed.
2. **A recorded next state** — a decision that was reached, a question that
   blocks progress, or an action that is now ready.

The second is what makes the next session cheap.

## The loop

```
   ┌──────────────────────────────────────────────┐
   │                                              │
   │   1. Arcadia resolves ONE next action        │
   │      from the project's own documents        │
   │                     ↓                        │
   │   2. arcadia go prepares an isolated         │
   │      worktree, pinned to a model             │
   │                     ↓                        │
   │   3. Arcadia records and launches one        │
   │      reattachable Session in that worktree   │
   │                     ↓                        │
   │   4. The agent works and records what it     │
   │      learned beside its commits              │
   │                     ↓                        │
   │   5. Arcadia reconciles the exited Session;  │
   │      you review its exact Candidate          │
   │                     ↓                        │
   │   6. arcadia go retires the finished         │
   │      worktree and resolves what's next ──────┼──┐
   │                                              │  │
   └──────────────────────────────────────────────┘  │
                          ▲                          │
                          └──────────────────────────┘
```

Step 1 is deliberately singular. Arcadia refuses to dispatch when a repository
resolves zero or several dispatchable actions, because "what should I work on"
is exactly the question you do not want an agent guessing at.

Step 5 is deliberately evidence-bound and may use GitHub. Arcadia does not
replace independent QA or your review of a consequential Candidate — it
connects the exact Session, revision, proof, and resulting Decision. Pull
requests remain the familiar delivery and review surface.

## Attention is the scarce resource

Arcadia's model of your day is not a task list. It is a short answer to: **where
does this need a human?**

Every project resolves to one of a few states:

- **ready** — one dispatchable action, nothing blocking. An agent can start.
- **running** — a session is in progress.
- **attention** — something needs *you*, specifically.

Attention has a precise meaning here. It is not "a job failed." It is: the
repository now resolves to an **open Decision** rather than an action. An agent
hit something requiring judgment, wrote that question down as a document, and
stopped. That is success, not failure — the alternative is an agent guessing at
a decision that was yours to make.

Because those questions live in the project's files, this state is computed,
not reported. There is no separate queue to keep in sync with reality.

## What documents you actually write

Four kinds, and the discipline is in keeping them distinct:

| Document | Answers | Lives in |
|---|---|---|
| **Project** | What is this, what is the current milestone, what is the one next action | Project repo root |
| **Plan** | What is the sequence of actions, and what does "done" mean for each | Project repo |
| **Decision** | What was chosen, why, what it rules out, and what it makes possible | Project repo |
| **Log** | What actually happened, including what went wrong | Project repo |

A **Decision** is the one you will write most, and usually *during* other work
rather than before it. It is the record of a judgment call — including the ones
where the honest answer is "this needs the operator." A Decision that names an
open question is not an unfinished Decision; it is a complete record of a
question that has to reach a human.

Arcadia validates all four against a schema. A malformed plan does not silently
misroute work — it refuses to dispatch and tells you which field, in which
file, to fix. Broken governance *is* the work when it happens.

## Fail closed, always

Arcadia will not:

- reconcile a dirty, detached, or divergent worktree
- fast-forward anything that is not a strict fast-forward
- delete a branch that is not both agent-owned and fully merged
- launch an agent session without an explicitly pinned model
- dispatch when a repository resolves zero or several actions
- push, open a pull request, deploy, or spend money on your behalf

Every one of these is a refusal with a named remedy, not an attempt to be
helpful. **A refusal is the safety contract working, not an error to route
around** — and that principle is the difference between a tool you can leave
running and one you have to watch.

## What Arcadia does not do

Being clear about this is part of the design:

- **It does not review your code.** Pull requests do that.
- **It does not own your plans.** Your repositories do.
- **It does not manage a team.** It is built for one person with many projects.
- **It does not replace your agent.** Codex and Claude Code do the work;
  Arcadia decides what work, prepares where, and records what happened.
- **It does not run in the cloud.** Local-first, with local models preferred
  over paid ones by default.

## Getting started

```sh
pnpm arcadia init ~/my-workspace       # create a workspace
pnpm arcadia project add               # register a repository
pnpm arcadia docket                    # what matters right now (read-only)
pnpm arcadia go --repo /path/to/project --agent claude   # preview a handoff
```

`docket` and `attention` are read-only and safe to run anytime. `go` without
`--apply` is always a preview that changes nothing.

For daily use, see [`START_HERE.md`](../START_HERE.md). For the full command
surface, see [`docs/COMMANDS.md`](COMMANDS.md). For the vocabulary these
documents use precisely, see
[`docs/arcadia-semantics.md`](arcadia-semantics.md).

## Implementation status

This document describes the operating model. Not all of it is built, and it
would be dishonest to imply otherwise:

| Capability | Status |
|---|---|
| Workspace, projects, queues, logs, status reports | Implemented |
| Document schema, validation, dispatch resolution | Implemented |
| `arcadia go` — worktree reconciliation and handoff | Implemented |
| Model pinning on handoff | Implemented (Decision 0010) |
| Background worker daemon | Implemented |
| Discord notifications on run state | Implemented |
| Local file ingress | Implemented |
| Natural-language intent (`arcadia ask`) | Implemented |
| Accepted planning Artifact to one managed build Action and packet | **Implemented** for the explicit `project prepare` workflow |
| Thin Session receipt and opt-in tmux launch from `go` | **Planned next** after Decision 0012 is resolved |
| Post-exit Session reconciliation into Action or Decision state | **Planned** after tmux launch dogfood (Decision 0012) |
| Worker-queued coding-agent Sessions | **Triggered** after one real tmux-backed Session and a second unattended-launch need |
| Discord alerting on Session completion or attention state | **Triggered** after a real state waits unnoticed or requires manual relay |
| Cross-project attention view as a live surface | **Partial** — state is computed; the surface is not built |
| Unified context across repos, ingress, and reports | **Not designed** — open direction, deliberately unscoped |

Decisions are recorded in [`docs/decisions/`](decisions/). A Decision with
status `open` is a real question awaiting an answer, not a placeholder.
