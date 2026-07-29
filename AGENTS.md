# AGENTS

Arcadia exists to maintain momentum across creative projects with minimal cognitive overhead.

Prefer deterministic workflows.
Prefer local scripts before AI.
Prefer local AI before frontier models.
Use Codex only when code changes are required.

Always identify:
- Current milestone
- Next action
- Work classification
- Required artifacts

## The 80/20 rule

The Pareto principle holds that roughly 80% of consequences come from 20% of
causes. Treat it as a standing instruction, not an observation: **find the 20%
and do that first.**

In practice, for any piece of work:

- **Name the vital few before starting.** Which small part of this delivers most
  of the value? Say so explicitly, and sequence it first — not because the rest
  is worthless, but because the rest is what gets cut when time runs out, and
  that should be a deliberate choice rather than an accident of ordering.
- **Prefer the change that reuses what exists.** The cheapest 80% is usually
  already built and merely unreachable — a report that is not scoped, a field
  that is parsed but never read. Extending something proven beats introducing
  something new, and it is the difference between an afternoon and a milestone.
- **Say when the expensive 20% of value is not worth its 80% of cost.** Deferring
  is a real answer. Recommend it plainly, and record what was deferred and why,
  so the decision survives the conversation.
- **Do not gold-plate the tail.** Exhaustive coverage of rare cases is the
  classic 80% of effort buying 20% of value. Handle the common path well, fail
  loudly and legibly on the rest.

This rule is subordinate to the constitution's approval boundaries. Safety,
approval gates, and truthful reporting are never the 80% to be trimmed — a
shortcut through an approval boundary is not a Pareto optimization, it is a
violation.

## Orientation

Before working on the database, the Intelligence service, or the Discord bot, read:

`docs/AGENT_ORIENTATION.md`

It captures the non-obvious, verified architecture context that most often trips up a cold start: the two schema sources (migrations in `src/db/schema.ts` win), the two distinct "Artifact" concepts, how Intelligence routing/workers/errors behave, that events are a log (not a bus) and there is no auth layer, and how the CLI-shellout boundary works for the dashboard and Discord bot.

## Managed Documentation

`CLAUDE.md` explains how the managed documentation system works: the work
pointer, plan document anatomy, which fields are enforced and where, and the
rule that checked-in documentation is authoritative. Read it before writing or
changing a `PROJECT.md`, a plan under `docs/plans/`, or a Decision.

## Arcadia Semantics

Before changing user-facing terminology, data models, CLI commands, dashboard labels, or documentation, read:

`docs/arcadia-semantics.md`

Use Arcadia’s canonical terms consistently:
Domain, Project, Mission, Outcome, Milestone, Action, Artifact, Decision, Log.

## Operator Guide

`START_HERE.md` is the canonical brief guide for normal Arcadia use. Any change to a user-facing flow, CLI command named there, dashboard address, or managed service behavior must update that file in the same change.
