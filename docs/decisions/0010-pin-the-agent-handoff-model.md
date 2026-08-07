---
arcadia: v1
type: decision
id: "0010"
slug: pin-the-agent-handoff-model
project: arcadia
status: approved
question: When arcadia go prepares the next agent worktree, how should it choose which model and reasoning effort that session launches with?
gap_type: missing-decision
recommendation: Resolve the model from an explicit --model flag, else the plan's recommended_model, and refuse to launch an agent session when neither resolves, rather than launching unpinned against whatever the invoking shell already defaults to. Reasoning effort follows the same precedence but stays optional.
confidence: high
decided: 2026-08-07
answer: "arcadia go --apply --agent <x> resolves the launch model as --model if given, else the active plan's recommended_model, and refuses with a named remedy if neither resolves — it never launches an agent session against an unstated default. Reasoning effort follows identical precedence (--effort, else recommended_reasoning_effort) but is optional throughout: its absence omits the flag and lets the agent CLI use its own default. Both fields are free-form strings in plan frontmatter, validated by the downstream agent CLI rather than by Arcadia. The model check runs after the fast-forward integration, deliberately, so a plan's own recommendation is read from its state after the merge that may have just introduced it — refusing to launch an agent session is therefore independent of, and never undoes, an already-completed retirement of the finished worktree."
updated: 2026-08-07
---

# Decision 0010: Pin the agent handoff model

## Context

`arcadia go --apply --agent <x>` (Decision 0009) prepares a fresh worktree and
prints a launch command — `claude "arcadia advance"` or
`codex -C <path> "arcadia advance"`. Neither ever carried a model or
reasoning-effort flag. Whatever the invoking shell's `claude`/`codex` already
defaulted to is what launched, silently, with no record of what was chosen or
why.

This surfaced directly: an operator asked `arcadia go` to hand off to a new
session and, immediately after, asked which model and effort level would be
used. The honest answer at that moment was that the tool did not choose one at
all, and the plan being handed off did not declare a preference either — only
one plan across the calling project used `recommended_model`/
`recommended_reasoning_effort` in frontmatter, and nothing in Arcadia read
either field for any purpose. The convention existed in exactly one document
and was decorative everywhere else.

The operator's response: this should be part of how `arcadia go` works, not
something they have to notice and ask about per handoff.

## Decision

`recommended_model` and `recommended_reasoning_effort` become real, parsed
`PlanDoc` fields — free-form strings, unvalidated by Arcadia itself, since the
downstream agent CLI is the actual authority on what values it accepts and
that vocabulary already differs by agent and will keep changing.

At `--apply --agent <x>` time, Arcadia resolves:

- **model** = `--model` if given, else the plan's `recommended_model`, else
  refuse. This mirrors the project's existing fail-closed posture for dirty,
  detached, divergent, non-agent-owned, or non-dispatchable state (Decision
  0009): an unresolved model is exactly that kind of unsafe-to-proceed
  condition, not a case for a silent convenient default.
- **effort** = `--effort` if given, else `recommended_reasoning_effort`, else
  omitted. Effort is real but secondary — a session with no stated effort
  preference is not unsafe the way an unpinned model choice is, so its absence
  does not block.

The resolved values are threaded into an agent-specific launch command, kept
in one function so a third agent only adds one branch rather than touching
every caller:

- **claude**: `--model <model>` and, when present, `--effort <level>` — both
  first-class flags on the `claude` CLI.
- **codex**: `-m <model>` and, when present, `-c model_reasoning_effort=<level>`
  — codex has a dedicated model flag but exposes reasoning effort only through
  its general `-c key=value` TOML override.

### Why the check runs after the fast-forward, not before

`arcadia go` already reads the plan twice: once from the source worktree to
validate it is dispatchable at all, and again from the base branch after a
fast-forward, because the merge itself may change what the plan says. A
`recommended_model` line is exactly the kind of change that could arrive in
the very commits being integrated — it did, for the project that prompted this
decision. Resolving the model against the pre-merge plan would be reading
stale state by construction.

This means an unresolved model is discovered only after the source worktree
has already been fast-forwarded, retired, and its branch deleted. That is not
a partial failure to roll back. Decision 0009 already treats "reconcile the
finished worktree" and "prepare the next agent worktree" as two independent,
separately valid outcomes — the existing fallback message
(`Start a fresh coding-agent session from <base> and prompt: arcadia advance`)
already describes a complete, successful `go` with no next-agent worktree
prepared at all. A missing model produces the same shape of outcome, not a
new one, and the refusal's message says explicitly that nothing needs to be
undone.

## Consequences

- Every future session `arcadia go` hands off with `--agent` now launches with
  a stated, recorded model choice, or the command refuses and says exactly
  what to add and where.
- A plan without a `recommended_model` cannot silently hand off to whatever
  the operator's shell happens to default to; the operator must decide once,
  in the plan or on the command line, rather than being asked to remember to
  specify it every time.
- `--model`/`--effort` on the command line make one-off overrides free without
  editing the plan, matching how the operator actually resolved this the first
  time it came up.
- Reasoning effort remains genuinely optional. Making it block equally would
  overstate its safety weight relative to the model choice itself.

## Revisit triggers

- A third agent CLI's model or effort flag shape does not fit the existing
  two-branch `buildLaunchCommand` cleanly.
- An agent CLI starts validating model/effort strings in a way Arcadia should
  pre-check rather than pass through and let fail downstream.
- Reasoning effort turns out to matter enough for cost or quality that its
  absence should also block, not merely omit a flag.
