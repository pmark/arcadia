---
# Draft for the AMC guides collection (src/content/guides). The guides schema
# has no pubDate, draft or tags fields; this file stays unpublished until the
# release manager copies it into mission-control-site. Drafted 2026-10-08.
title: "Harness engineering without an orchestrator"
question: "How do I build a harness for long-running AI coding agents without writing my own orchestrator?"
description: "Arcadia's planned approach to harness engineering: run a standard coding agent unmodified, and make the project's state, tools and instructions the harness, with one input path, one to-do list and a separate grader."
answer: "Arcadia's planned approach treats the harness as the agent's environment rather than a new program: a standard coding agent such as Claude Code, Codex or opencode runs unmodified, and Arcadia supplies its state (a SQLite workspace and checked-in Markdown governance), its tools (a deterministic CLI) and its instructions (checked-in instruction files). Every session starts from a clean isolated worktree and ends with usable artifacts: commits with identity trailers, file handoffs, and receipts that prove completion rather than claim it. Work counts as actionable only after a separate grader confirms it has a done-condition, and everything Arcadia needs from the operator is planned to arrive in one derived to-do list. Much of the substrate exists today; the to-do list, the grader and the written session protocol are an approved, not-yet-active plan."
topic: running-agents
updatedDate: 2026-10-08
order: 7
---

*Most harness advice assumes you will build a new program around the model. Arcadia's plan goes the other way: leave the coding agent alone and make everything around it the harness. This guide separates what exists today from what is planned.*

## The problem: a new engineer every shift

Picture a coding agent three hours into a nine-step piece of work. Its context fills, the session ends, and a fresh session starts. The new one has the repository and nothing else. It does not know which step was half done or which approach already failed. So it guesses, and sometimes it declares the whole thing done.

Anthropic's engineering team describes the same failure in [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), comparing agents to "engineers working in shifts" who arrive with no memory of the last shift. Their remedy is environmental: a feature list that starts out failing, a progress file, git history, and real end-to-end tests, so each session makes incremental progress and leaves clean artifacts for the next.

A companion piece, [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps), adds two more lessons. Models grade their own work too generously, so generation and evaluation belong to separate agents that agree on testable criteria first. And every harness component "encodes an assumption about what the model can't do", so components should be removed when a new model makes them unnecessary.

Arcadia, a local-first project OS for governed AI coding agents, has learned the same lessons the hard way while building itself.

## What exists today and what is planned

Status first, because it matters more than the pitch.

| Piece | Status |
|---|---|
| Isolated worktree per session, working-copy safety, candidate preservation | **Today** |
| Semantic agent Git identity (`arcadia identity resolve`) | **Today** |
| Ask capture envelope: immutable, idempotent intake log | **Today** |
| Agent Ask: two-phase preview and settle for every governed change | **Today** |
| Clarify rubric: one next action, or exactly one question | **Today** |
| Peer-watch trailer grammar, parser and classifier library (reads only, posts nothing; no running watcher yet) | **Today** |
| `arcadia ping send` operator nudge with a link | **Today** |
| Independent review of every pull request before merge | **Today** |
| `arcadia todo`: one derived list of what Arcadia needs from the operator | **Planned** |
| Plan progress as a to-do checklist with schema-tagged JSON | **Planned** |
| Done-condition plus a separate grader before work counts as actionable | **Planned** |
| Ask envelopes for free-text Decision and review replies, plus a coverage report | **Planned** |
| A written "standard harness" procedure and session protocol | **Planned** |
| One-way projection to GitHub Issues/Projects and the Flight Deck Kanban | **Planned, deferred** |
| Registering a new workflow when its instruction file is committed | **Planned, deferred** |

As of 2026-10-08, the planned items live in one governed Plan, *Operator to-do list with Ask-only input*: nine Actions, merged as an inactive draft on 2026-10-08 and on hold until a preservation fix (described below) is settled. None of it is running yet.

## Don't build an orchestrator

The tempting move is to write a supervisor program: a loop that calls the model, parses its output, decides the next step and retries on failure. Arcadia's plan rejects that. A standard harness, meaning Claude Code, Codex or opencode, runs unmodified, with its vendor's own agent loop, tools and context management.

Arcadia is instead the harness's **state, tools and instructions**:

- **State** is a SQLite workspace for runtime facts (who holds which Action, what was captured, which receipts exist) and checked-in Markdown for authority (the Constitution, Plans, Decisions).
- **Tools** are a deterministic CLI. `arcadia go` prepares an isolated worktree for the next governed Action; `arcadia agent-ask preview` registers a change request; `arcadia identity resolve` tells an agent who it is.
- **Instructions** are checked-in files: a small always-loaded bootstrap (`AGENTS.md`) and an index of procedures an agent must read before matching operations.

Arcadia does prepare and launch sessions. What it avoids is replacing the agent loop. When a better coding agent ships, the plan is to swap it in, not to port an orchestrator.

The same idea applies to new workflows. **Planned:** a new workflow is one checked-in instruction file plus existing commands, never new orchestration code. A later, deferred step would register a workflow when its instruction file is committed. Its revival trigger is the arrival of a second scheduled instruction file.

## Every session starts clean and leaves artifacts

**Today**, each session works in its own git worktree on its own branch, never on main and never in another live session's checkout. Before stopping, a session pushes its committed work and opens or updates a pull request. Every commit carries a semantic agent identity, not the operator's:

```sh
arcadia identity resolve --agent claude --tier heavy
# first line of output: Claudia Atlas <claudia.atlas@agents.arcadia.local>
```

Handoffs go to files, never to chat. An agent that needs something, or is stopping partway, writes an Agent Ask: a strict JSON request that Arcadia previews, fingerprints and settles in two phases. The next session finds it from the governed record instead of a conversation that no longer exists.

The rule underneath all of this comes straight from Arcadia's Constitution: **completion is a proven state, not a claim.** A pull request, green CI or a launched process proves nothing by itself. An Action is complete when an Agent Ask of intent `complete` carries a met, failed or skipped verdict for every acceptance criterion, bound to the exact candidate revision.

## One way in, one list out

An operator running several agents across several projects drowns in surfaces: Discord threads, PR comments, dashboard pages, Decisions, review queues.

**Today**, operator requests can already arrive as an Ask (a Discord message, the dashboard, or an iCloud Ingress folder). Each becomes an immutable capture envelope, idempotent by request id and marked as untrusted input. Resubmitting the same id with different content is refused.

**Planned:** nearly all operator input passes through Ask or Ingress, including free-text answers to Decisions and reviews, which today bypass the envelope. A coverage report will state how much input was captured per surface. It will also say plainly that direct chat with coding agents, the largest channel, is not measured.

**Planned:** everything Arcadia needs from the operator appears in one derived list:

```sh
arcadia todo            # blocking items first, then at most five others
arcadia todo --json     # schema "arcadia-todo-v1"
```

It is a read-only view over existing stores, with no new database. Each item names its source and the exact existing command that answers it. An item is *blocking* only when it gates the selected Action; everything else is an alert. Staleness needs positive evidence, so nothing quietly disappears.

The same to-do motif is planned for progress: `arcadia plans --plan <slug>` will print any Plan as a checklist with schema-tagged JSON. Those payloads are meant to be projected one way to GitHub Issues/Projects and the Flight Deck Kanban. Nothing will be read back. Write-back to GitHub is deferred until the operator answers a Decision naming its scope.

## Separate the generator from the grader

Arcadia already has a generator for next actions. **Today**, its clarify step asks a model one question: can you name one concrete, physical next action? The answer is either a next action with an actor, or exactly one question about what is missing.

What it lacks is a definition of done and an independent check. **Planned:**

- A next action counts as actionable only when it states an observable **done-condition**.
- A deterministic lint runs first: a non-empty done-condition, a leading verb, and no file paths or ids that do not appear in the source.
- A **separate grader** then runs as its own instruction file with a different prompt. It never sees the generator's confidence, and it uses a different local model when one is configured.
- If the grader fails the action, the operator gets **exactly one question** in `arcadia todo`, never a vague request for "more context".
- Each verdict is stored as a receipt, and a hand-written golden set of cases becomes the contract any future deterministic grader must pass.

## The session protocol: fake it until you make it

Some of the coordination a long-running system needs is not code yet. Arcadia's plan writes it down as a **session protocol followed by convention today**. Coding agents act as surrogates for the deterministic processes and decision systems that will eventually replace them, and they follow the protocol as if it were enforced.

- **Identity.** One session per Action, using the resolved agent identity in titles, comments and commits.
- **Lease.** Work only from the claim Arcadia gave you. Silence never releases a claim, and a comment asking for release is only a request.
- **States.** An agent reports `working`, `needs_input`, `handed_off` or `done`. Labels like *idle* or *stalled* are a watcher's inferences, never self-declared.
- **Heartbeat.** Commit trailers that the existing peer-watch contract parses and checks when it binds commit evidence (no launcher adds them yet; agents add them by hand):

  ```text
  Arcadia-Agent: claude/heavy
  Arcadia-Action: arcadia/build-operator-todo-list
  ```

- **Inactivity ping.** Before going quiet without a PR or a completion, send the operator one nudge that links to the related Issue:

  ```sh
  arcadia ping send "claude/heavy arcadia/<action> needs_input: <reason>; resume: arcadia go" \
    --kind attention --link <issue-url>
  ```

- **Handoff and receipts.** Handoffs go to a file or an Agent Ask. Completion requires per-criterion evidence, which `arcadia agent-ask settle` already enforces today.

The trailer grammar, the classifier and `arcadia ping send` exist **today**. The written protocol and a test that keeps it consistent with the code are **planned**.

## Trust boundaries: agents must not grade themselves

Here is why this matters, from the week this guide was written (October 2026).

A repair needed to preserve unchanged symlinks from a baseline commit, which until then had been refused outright. The change was reasonable. Independent read-only review found a problem anyway. A validation check could be declared as a symlink, `check.mjs -> judge.mjs`. If the candidate left the link unchanged but edited `judge.mjs` to always exit 0, the check binding recorded the unchanged link and never bound the modified target. The candidate's own code would then report its own success. A disposable reproduction confirmed it.

The fix was not cleverer target resolution. It was a **fail-closed rule**: refuse symlinks in declared executable checks and their dependencies before anything runs. Each later review round found one more path around the rule: first a symlinked ancestor hidden by `..` in a check path, then a symlink whose name differed only by letter case on a case-insensitive filesystem. Fixes for both, also fail-closed, are on the same pull request. Passing CI did not authorize a merge while that finding was open. As of 2026-10-08, the pull request (#1040) is still in review and not merged.

The lesson generalizes. Preservation and check binding exist so the thing being graded cannot quietly rewrite the grader. The planned next-action grader follows the same principle.

## Economy: spend in ascending order

Arcadia's Constitution fixes the order of spending: **deterministic scripts, then local models, then frontier models, then the operator.** Operator attention is the scarcest budget. That is why the to-do list caps what it shows, separates blocking items from alerts, and asks one question instead of five.

The planned grader is local-first and dry-run by default, and it never escalates to a paid model. **Today**, an offline "fast rehearsal" replays Arcadia's real production loop with external services faked, catching harness defects in minutes rather than in a live run.

Following the second Anthropic article, the plan also includes a **harness component-removal review**: when a new model joins the roster, remove one component and test whether it still carries weight. That review is deferred until the first such model change.

## Scale later without building it now

A scalability review of this plan concluded that the seams are right and the data model only needs a few cheap invariants kept from day one:

- **One immutable intake log.** The Ask envelope's fingerprint is never relaxed. An optional actor and Project sit outside it.
- **Derived read models.** Schema-tagged JSON over canonical stores is the API. Projections are one-way.
- **Governance in documents, leases in the database.** Every governed write goes through Agent Ask settlement.
- **The golden set as the grader's contract.** A future deterministic grader must pass it.

The same review produced an explicit **not now** list: no role or tenant tables, no database swap, no HTTP API, no orchestrator or queue service, no assignment UI, no GitHub write-back, and no signed GitHub comments. Each deferral names the condition that revives it.

## What's next

As of 2026-10-08, the Plan is drafted, reviewed and merged as inactive. The next steps are in order:

1. Finish the preservation correction in PR #1040.
2. The operator activates the Plan.
3. Three foundation Actions run in parallel: `arcadia todo`, the written standard-harness procedure, and the Plan-progress checklist.
4. Grading, reply capture, surface changes and stale-item triage follow.
5. The Plan ends with an end-to-end proof. A real operator request travels through Ask, is graded into work with a done-condition, and is started by a fresh session that the operator launches with nothing but `arcadia go`.

Until that proof exists, everything marked *planned* above is a plan. Arcadia is experimental, has no customers, and governs its own development with Claude Code, Codex and opencode. Most of the rules in this guide were written after one of them was broken.
