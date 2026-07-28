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
