# Arcadia Working Protocol (v0.1 — DRAFT)

> Status: proposal for review. This codifies how we plan, communicate, and
> ship changes to Arcadia. It is intentionally small and dogfoods Arcadia's
> own model. Redline freely; nothing here is settled until you approve it.

This protocol governs four things: **planning & status**, **collaboration
via pull requests**, **session context discipline**, and **model selection**.
It extends, and must stay consistent with, `CONSTITUTION.md`, `AGENTS.md`,
and `docs/arcadia-semantics.md`.

## 0. Principles (inherited)

- SQLite is the operational source of truth; Markdown stores narrative
  artifacts; Git preserves history (`CONSTITUTION.md`).
- Use local scripts before AI; local AI before frontier models.
- Every unit of work identifies its **Milestone**, **next Action**,
  **Responsibility**, and required **Artifact** (`AGENTS.md`).
- Canonical vocabulary only: Domain, Project, Mission, Outcome, Milestone,
  Action, Artifact, Decision, Log (`docs/arcadia-semantics.md`).

## 1. Planning & status

**Truth in Arcadia, review in Markdown.** A plan is expressed in Arcadia's
model (a Project pursuing an Outcome through Milestones, advanced by Actions,
producing Artifacts, gated by Decisions, recorded in Logs). Because the
workspace SQLite is git-ignored and ephemeral, every plan and its status are
**projected to committed Markdown** under `docs/plans/<slug>.md` so they are
diffable and reviewable in a PR. The Markdown projection is the durable
cross-session context; the CLI is the live driver.

**Plan document format.** Each plan doc carries, in order:

1. `# Title` and `## Executive Summary` (one paragraph + the target loop).
2. `## Status` block (below) — the single most important section for
   cross-session efficiency.
3. Background / rubric / design as needed.
4. `## Milestones` — a table of independently useful, testable, reversible
   Milestones with effort and dependencies.
5. `## Decisions` — open Decisions awaiting judgment, numbered.

**Status block (required, kept current).** Mirrors `AGENTS.md`'s "always
identify" as a fixed header so any session can resume in one read:

```md
## Status
- Milestone: <current milestone, e.g. "Phase 2 — Structured fields">
- Next Action: <one concrete, physically-doable next action>
- Responsibility: Autonomous | Codex | Requires Review | Blocked
- Required Artifact: <what "done" produces, e.g. a PR, a migration, a doc>
- Decisions open: <count + link to the Decisions section, or "none">
- Last Log: <date + one line, or link to the Log>
- Updated: <YYYY-MM-DD>
```

Whoever advances the plan updates the Status block in the same change. A
Milestone is not "done" until its Artifact exists and its validation passes.

## 2. Collaboration via pull requests

- **One shippable unit per PR.** A refactor, a phase, a docs change are
  separate PRs. Small and focused beats large and mixed.
- **Branch naming:** `claude/<short-topic>` (or `<author>/<short-topic>`).
- **Every PR states:** what changed, why, how it was tested (with real
  output), and any risk or follow-up. Link the plan Milestone it advances.
- **CI must be green** before merge; a red check that predates the branch is
  called out explicitly, not silently ignored.
- **Attribution:** Claude-authored PR/issue/review comments end with the
  Claude Code attribution footer.
- **Never open a PR without being asked**; once asked, drive it to a
  mergeable state (CI green, review addressed) rather than leaving it half-done.
- **Communication over volume:** comment on a PR only when a round resolves
  the task, hits a blocker, or raises a question — the diff is the record.

## 3. Session context discipline (token efficiency)

- **Open with the minimum sufficient context:** the plan's Status block, the
  relevant files, and nothing else. The committed Markdown projection is the
  handoff; a session should not re-derive what a prior session established.
- **One session, one focused unit** (a phase or a PR). When a unit is done,
  hand off rather than sprawling.
- **Handoff brief (recorded as a Log / plan Status update):** what shipped,
  what's next (the next Action), open Decisions, and any gotchas. This is
  what the next session reads first.
- **Use subagents for scoped fan-out** — broad searches or parallel
  investigation that only need to return a conclusion, not fill the main
  thread with file dumps. Spawn only when asked or when a task names one.
- **Prefer the smallest step that makes progress;** avoid speculative work
  ahead of an approved Milestone.

## 4. Model selection

Match the model to the task; override per task when judgment says so.

| Task class | Default model | Rationale |
| --- | --- | --- |
| Mechanical edits, mass find/replace, search, formatting | Haiku | Cheap, fast, low-judgment |
| Standard implementation, tests, docs prose | Sonnet | Balanced capability/cost |
| Architecture, risky/wide refactors, migrations, code review, planning | Opus | High judgment, high blast radius |

Subagents pick their tier by the same table (e.g. an Explore fan-out can run
cheaper than the reviewing session). State the model when it isn't the
obvious default, so choices are auditable.

## 5. How this plan itself is managed (worked example)

The clarification-pass work (`docs/plans/clarification-pass.md`) is the first
plan to adopt this protocol: it gains the Status block above, each Phase is a
Milestone shipped as its own PR, and its two open engine/subtask calls are
recorded as Decisions. The operator-agnostic refactor already merged is its
Milestone 0 (data-model hygiene).

## Decisions open

1. Protocol home depth — Arcadia-native truth + Markdown projection (assumed
   here) vs Markdown-only. Confirm or redirect.
2. Whether the Status block should also be emitted by an `arcadia status
   --plan <slug>` command later, so the projection is generated, not hand-kept.
