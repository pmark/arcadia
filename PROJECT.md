---
arcadia: v1
type: project
slug: arcadia
name: Arcadia
status: active
goal: Turn stated outcomes into clarified, routed, executable work without the operator holding the whole portfolio in their head.
outcome: The operator states a desired outcome; Arcadia clarifies it, routes it to the right Project, drives coding agents, and reports back — asking for a decision only when one is genuinely needed.
milestone: Every software Project always exposes a stable proof surface and a governed path from candidate demo through QA-verified release
active_plan: demo-first-delivery
updated: 2026-08-15
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
`docs/plans/narrative-digests.md`. That plan is now complete: the composer
narrates one Project's bounded window through the unpaid local-preferred
route, the export projects it into Obsidian as an explicitly AI-narrated
Record, and the Discord bot's digest scheduler composes, exports, and posts
every active Project's digest plus one collective portfolio roll-up on the
daily, weekly, and monthly cadences without being asked.

Cadence windows are calendar-aligned, local, and always the period that has
already finished — the plan's `digest-window-boundaries` question, answered in
`src/digests/schedule.ts`. The once-per-subject-per-period guard is the stored
`(scope, period, window)` row itself rather than a separate schedule ledger,
so a missed tick self-catches-up and a composed-but-undelivered digest comes
back for retry instead of being lost. One Project's failure costs that
Project's digest and nothing else.

With that milestone reached, the pointer moved to `demo-first-delivery`,
already drafted from operator direction on 2026-08-01 under approved Decision
0007. The configured operator QA queue is complete. While advancing Private
Practice Now, the operator then explicitly prioritized the missing independent
pull-request QA responsibility as a must-have. Decision 0018 inserted and
completed `establish-minimal-pr-qa`: `arcadia qa pr` now freezes a GitHub head
revision, gathers deterministic evidence, runs one independent read-only
structured review, and persists its QA report Artifact and Decision. Its first
real Candidate, Arcadia PR #54, correctly returned Needs follow-up rather than
Pass for contradictory CI evidence. The pointer now resumes at
`build-demo-hero-vertical-slice`. This was an evidence-driven sequencing
change, not priority inferred from queue order.

The Agent Queue is documented in `docs/plans/agent-advance-queue.md`. It is a
projection, not a second work pointer: managed documents still decide what is
dispatchable, and provider limits still gate packet selection. Provider-budget
admission is deferred until Claude Code and Codex both expose comparable fresh
daily and weekly capacity windows.

## Links

- `docs/COMMANDS.md` — the operator-facing command guide
- `docs/plans/` — one file per initiative, each a managed document
- `CONSTITUTION.md`, `OPERATOR_CONTEXT.md` — standing constraints and context
