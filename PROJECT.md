---
arcadia: v1
type: project
slug: arcadia
name: Arcadia
status: active
goal: Turn stated outcomes into clarified, routed, executable work without the operator holding the whole portfolio in their head.
outcome: The operator states a desired outcome; Arcadia clarifies it, routes it to the right Project, drives coding agents, and reports back — asking for a decision only when one is genuinely needed.
milestone: Arcadia narrates its own recent history automatically, for itself and every Project it manages
active_plan: narrative-digests
updated: 2026-07-31
---

# Arcadia

## Mission

Arcadia is the operator's execution system. It captures raw intent, runs GTD's
clarify step over it with local AI, routes each Action to whoever should do it
(the operator, a coding agent, or an outside party), and surfaces exactly one
question when it cannot proceed without an answer.

The system errs stable and reliable over opportunistic. Approval boundaries are
explicit, automation is observable, and every batch operation previews before it
writes.

## Current State

The clarification loop is complete end to end: `capture` marks new Actions
unclarified, `clarify` evaluates them against the rubric via local Intelligence,
a verdict either names a concrete next action or opens exactly one Decision, and
subtasks exist for decompositions.

Documentation is a first-class input — see
`docs/plans/portfolio-docs-protocol.md`. Conversations with coding agents
produce markdown; `docs sync` turns that markdown into Projects, Milestones,
Actions, Decisions and mission Logs, so the portfolio can be managed at
executive level from `arcadia portfolio`. Vendor-neutral execution profiles let
Arcadia select the least costly compliant coding-agent configuration without
putting provider model names in those plans. That milestone is reached, and its
two remaining increments are deferred against named triggers by Decision 0004.

`docs/plans/dispatch-contract-enforcement.md` closed the gap between what a
coding agent was told and what it is judged on: acceptance criteria are now
compared against a finished Run's Artifact at acceptance, approval rechecks
readiness when the plan document has moved, `arcadia next --ready` computes
the whole ready set instead of only refusing a bad pointer, and the dispatch
journal's tally surfaces in the dashboard snapshot. That plan is complete.

The operator asked for a narrative account of this session and got one, told
by hand. Then asked for it automatically — for Arcadia's own project and every
Project Arcadia manages, not as a one-off. See
`docs/plans/narrative-digests.md`. Structured history now exists (mission-Log
rows, the dispatch journal) to compose from; what doesn't yet exist is the
composer itself, an Obsidian export for AI-narrated (not just deterministic)
records, and a schedule that reaches every Project rather than only the one
being watched. `portfolio-docs-protocol`'s two remaining increments stay
deferred against Decision 0004's named triggers, untouched by this.

## Links

- `docs/COMMANDS.md` — the operator-facing command guide
- `docs/plans/` — one file per initiative, each a managed document
- `CONSTITUTION.md`, `OPERATOR_CONTEXT.md` — standing constraints and context
