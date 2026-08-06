---
arcadia: v1
type: decision
id: "0009"
slug: agent-neutral-go-handoff
project: arcadia
status: approved
question: How should one operator command safely finish a coding-agent worktree and begin the next governed Action across Codex and Claude Code?
gap_type: missing-decision
recommendation: Put all Git and dispatch checks in one fail-closed Arcadia command, expose it through one shared Agent Skill, and keep agent-specific session launch as a thin final adapter.
confidence: high
decided: 2026-08-05
answer: "An explicit arcadia go or arcadia-go skill invocation authorizes only a previewed strict local fast-forward of the named clean agent branch, retirement of that fully merged worktree and branch, Arcadia dispatch validation, and preparation of one fresh isolated worktree from the updated local base. Dirty, detached, divergent, non-agent-owned, or non-dispatchable state must refuse without mutation. The workflow never stages, commits, resets, force-merges, pushes, opens a PR, deploys, or discards work. Codex and Claude Code share the same Agent Skills-compatible instructions and call the same Arcadia implementation."
updated: 2026-08-05
---

# Agent-neutral `arcadia go` handoff

## Context

Coding-agent sessions create branches and linked worktrees. A later session
cannot check out a branch that is still attached to an earlier worktree, and
asking the operator to remember which branch to merge, which directory to
remove, and which prompt to paste defeats Arcadia's purpose.

The workflow is safety-sensitive. A prompt-only implementation would let Codex
and Claude Code gradually acquire different rules, and a seemingly helpful
cleanup could discard dirty or divergent work. The invariant belongs in a
deterministic command; skills should only discover and invoke it.

## Decision

`arcadia go` has two phases:

1. Preview the named source worktree, base relationship, governed dispatch,
   and proposed agent handoff without changing state.
2. On explicit `--apply`, perform only the exact previewed safe reconciliation
   and optionally prepare the next isolated Codex or Claude worktree.

Application requires a clean named source branch with an agent-owned prefix,
a clean checked-out base when one exists, strict base-to-source ancestry, and
exactly one dispatchable Arcadia Action. The command uses fast-forward only.
It may remove a linked source worktree or return a primary task checkout to the
base branch, then delete only the fully merged source branch.

`--agent codex` and `--agent claude` create a uniquely named worktree from the
updated **local** base, preserving local governed commits that may not yet be
on `origin/main`. The command prints the exact launch command with
`arcadia advance`; it does not spawn an interactive process implicitly.

One personal Agent Skills-compatible `arcadia-go` skill is the shared
instruction source. Codex discovers it from `~/.codex/skills`; Claude Code
discovers the same directory through its supported personal-skill symlink at
`~/.claude/skills`.

## Consequences

- The operator can say `arcadia go` to either supported agent without manually
  managing Git worktrees.
- Agent differences are limited to the final native task/worktree entry; Git
  safety and Arcadia dispatch cannot drift by provider.
- An unsafe state remains visible and preserved. Refusal is success of the
  safety contract, not a reason for the skill to improvise.
- The workflow does not push. Local-only preservation remains separately
  visible through `arcadia work monitor`.
- Adding another coding agent requires only a thin launch adapter if it can
  enter a prepared Git worktree; the reconciliation contract stays unchanged.

## Revisit triggers

- A coding-agent product exposes a stable session-creation API that can replace
  the printed launch command without weakening isolation.
- A legitimate branch naming convention cannot fit the explicit agent-owned
  prefix allowlist.
- Teams or remote runners require push/PR-based integration rather than this
  single-operator local fast-forward workflow.
