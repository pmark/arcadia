# Managed Documents

How Arcadia's documentation system works, and how to work inside it.

Nothing here is specific to one coding agent. This file used to be `CLAUDE.md`,
which made a vendor-neutral mechanism look like one vendor's instructions; the
managed-document rules bind every agent that works in this repository equally.

Read [`AGENTS.md`](../AGENTS.md) first — it states the standing preferences that
govern every change here. This file explains the mechanism those preferences
operate through.

## The one rule that explains the rest

**Checked-in documentation is authoritative.** When a managed document and the
database disagree about what the work is, the document wins. Arcadia resolves
what to do next by reading the repository, never by inferring priority from
commit history, backlog order, or whichever task looks easiest.

The corollary matters just as much: **incomplete control documentation is the
work, not an obstacle to it.** When Arcadia refuses to dispatch, it names the
file and field to repair. Repairing that is the immediate task. Do not route
around a refusal by editing the database, picking a different Action, or
loosening the rule that produced it.

## Start every session here

```sh
pnpm arcadia next --project arcadia
```

Every command needs a workspace, resolved in this order: `--workspace <path>`,
`ARCADIA_WORKSPACE`, a workspace marker in the current directory, then the
configured `defaultWorkspace`. The workspace is the operator's private
operational data and lives outside this repository.

This resolves the authoritative work pointer and prints the objective, its
acceptance criteria, required Decisions, references, and what you are authorized
to do. It has three complete answers:

| Outcome | What it means |
| --- | --- |
| **Dispatchable** | One Action resolved, nothing blocking, responsibility is `codex` or `autonomous`. Begin. |
| **One operator question** | The Action is `question_open`. Surface that one question. Do not pick a different Action to fill the gap. |
| **Blockers** | Each names a file, a field, and a remedy. Repairing them is the work. |

`arcadia next history` shows how often dispatch has been refused and on which
field — worth a look when a rule seems to be blocking constantly.

## Three kinds of documents

Discovery is by **frontmatter marker, not by path**. A file becomes Arcadia's
business only when it opts in with `arcadia: v1`; everything else is ordinary
prose that no tool parses.

**Managed control documents** carry `arcadia: v1` and a `type`. Four types are
parsed into rows — `project`, `plan`, `decision`, `log` — and their frontmatter
is validated field by field. `PROJECT.md`, `docs/plans/`, and `docs/decisions/`
are dispatch authorities; defects there refuse dispatch.

**Narrative documents** (`architecture`, `strategy`, `reference`, and unmarked
files) are recognized and reported but not turned into rows. Write them freely.

**Supporting records** (`continuation`, `proposal`, `template`, and `review`)
are recognized but governed by their repository-local protocol, so they cannot
block or redirect dispatch. A `plan` with status `dormant` or `proposed` is also
supporting: Arcadia does not evaluate its activation conditions or claim its
ordering authority.

### The pointer chain

```
PROJECT.md          active_plan: <plan-slug>
  └── docs/plans/<plan-slug>.md    current_action: <action-id>
        └── the one Action a coding agent should advance
```

Exactly one Action may be current across the whole project. A second plan
declaring `current_action` is reported as a competing objective rather than
silently losing.

### Where things live

| Path | What |
| --- | --- |
| `PROJECT.md` | The project's identity and both pointers. |
| `docs/plans/<slug>.md` | One file per initiative, each a managed document. |
| `docs/decisions/NNNN-<slug>.md` | One Decision per file; the number is the id. |
| `MISSION_LOG.md` | Narrative history. One row per dated entry. |

## Anatomy of a plan document

Every field below is validated. Getting one wrong produces a blocker naming it.

```yaml
---
arcadia: v1
type: plan
slug: my-initiative          # must match the filename
project: arcadia             # the PROJECT.md slug this belongs to
status: draft                # draft | active | complete | superseded
milestone: What this plan advances
current_action: some-action  # omit unless this is the active plan
token_impact: medium         # none | small | medium | large | xlarge
token_budget: "Routine checks are deterministic; reserve model calls for implementation and one review pass."
updated: 2026-07-28
actions:
  - id: some-action
    title: What to do
    status: open             # open | in_progress | done | blocked
    responsibility: codex    # autonomous | codex | requires_review | blocked
    effort: session          # quick | short | session | project
    next_action: The concrete thing to do first.
    expected_artifact: What existing when this is finished
    clarification: clarified # clarified | question_open | unclarified
    confidence: high         # high | medium | low
    acceptance_criteria:
      - An objective condition that decides when this is done.
    depends_on: []           # ids of Actions in this plan
    decisions: []            # Decision ids that must be answered first
    references: []           # repository paths or URLs
questions:
  - id: open-question
    question: Something the plan cannot answer itself.
    gap_type: missing-decision
decisions: []
---
```

### The fields with teeth

- **`token_impact` and `token_budget`** are required on every plan.
  `token_impact` is relative LLM-token exposure, not time, dollars, or a promise
  of exact consumption: `none` is deterministic-only, `small` is one bounded
  model pass, `medium` is ordinary single-session agentic work, `large` is
  multiple/deep or multimodal agent runs, and `xlarge` is program-scale work
  that should be staged deliberately. `token_budget` names what actually calls
  a model, what stays deterministic, and the guardrail that bounds repeated use.
  Playwright capture, builds, tests, and health checks are `none` unless a model
  interprets their output.

- **`depends_on`** is an ordering claim that is enforced, not decoration.
  Dependency cycles are rejected at parse time, and dispatch is blocked while
  any transitive prerequisite is not `done`. Leave it `[]` rather than inventing
  edges — the graph is only useful if it means something.

- **`acceptance_criteria`** are required on the current Action and are quoted
  **verbatim to the coding agent**, ahead of Arcadia's generated guardrails.
  Write them as the conditions you would actually check at review, not as
  restatements of the title.

- **`clarification: question_open`** means the Action is blocked on one
  question. It must carry a `gap_type` and a `question`, and must **not** carry
  a `next_action` — an Action that cannot say what to do next does not get to
  pretend otherwise.

- **`responsibility`** decides authorization. `requires_review` means a coding
  agent must not implement it; `blocked` means progress depends on something
  outside the repository.

## What is enforced, and where

| Check | Where | When it fires |
| --- | --- | --- |
| Field types, enums, required fields | `src/docs/parse.ts` | Any managed document is read |
| Dangling `depends_on` / `current_action` ids | `src/docs/parse.ts` | Any plan is read |
| Dependency cycles | `src/docs/parse.ts` | Any plan is read |
| Unmet transitive prerequisites | `src/docs/dispatch.ts` | `arcadia next`, `arcadia work plan` |
| Unanswered required Decisions | `src/docs/dispatch.ts` | `arcadia next`, `arcadia work plan` |
| Open clarification question | `src/docs/dispatch.ts` | `arcadia next`, `arcadia work plan` |

Both dispatch paths share one implementation deliberately. If you add a third
way to start work, route it through `resolveActionReadiness` rather than
reimplementing the checks — two implementations drift, and the looser one
becomes the way work gets through.

## Getting documents into Arcadia

```sh
pnpm arcadia docs sync --project arcadia            # dry run; writes nothing
pnpm arcadia docs sync --project arcadia --apply    # persist
pnpm arcadia portfolio                              # the executive view
```

Sync is keyed by `doc_ref` (`plan/<slug>#<action-id>`,
`log/<slug>#<date>--<title-slug>`), so rewording a plan's title updates the
existing row instead of creating a duplicate. It is idempotent: running it twice
changes nothing the second time.

## Rules when you change things

- **Vocabulary is fixed.** Domain, Project, Mission, Outcome, Milestone, Action,
  Artifact, Decision, Log. Read [`docs/arcadia-semantics.md`](arcadia-semantics.md)
  before introducing a user-facing term. "Run" means a concrete execution
  attempt and nothing else.
- **User-facing flows update `START_HERE.md` in the same change.** That includes
  any CLI command it names, dashboard address, or managed service behavior.
- **Schema changes need a migration**, not just an edit to `database/schema.sql`.
  See [`docs/AGENT_ORIENTATION.md`](AGENT_ORIENTATION.md) — it is the
  verified architecture brief for the database, Intelligence, and the Discord
  bot, and it will save you a wrong assumption on a cold start.
- **Approval boundaries are hard stops.** Do not publish, deploy, merge, delete,
  spend money, use credentials, access production data, or send messages without
  an explicit Decision. A more capable model does not change this.

## Where to read next

| File | For |
| --- | --- |
| [`AGENTS.md`](../AGENTS.md) | Standing preferences; what to identify in every report |
| [`CONSTITUTION.md`](../CONSTITUTION.md) | The constraints that outrank convenience |
| [`OPERATOR_CONTEXT.md`](../OPERATOR_CONTEXT.md) | Who this is for and what they want |
| [`START_HERE.md`](../START_HERE.md) | Normal daily operation |
| [`docs/COMMANDS.md`](COMMANDS.md) | The full command guide |
| [`docs/AGENT_ORIENTATION.md`](AGENT_ORIENTATION.md) | Architecture that trips up cold starts |
| [`docs/arcadia-semantics.md`](arcadia-semantics.md) | Canonical vocabulary |
| `docs/plans/` | One file per initiative |
