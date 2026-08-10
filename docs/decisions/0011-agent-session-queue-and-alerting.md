---
arcadia: v1
type: decision
id: "0011"
slug: agent-session-queue-and-alerting
project: arcadia
status: deferred
question: Should arcadia go queue the coding-agent session it prepares for supervised, monitored execution with Discord alerting instead of printing a manual launch command, and if so, on what infrastructure?
gap_type: missing-decision
recommendation: Do not build a new job queue, worker daemon, or Discord bot — all three already exist and are running. Add one new, coarser-grained record kind (an "agent session," distinct from the existing step-wise ExecutionRun) that arcadia go creates instead of only printing a launch command, supervised by a small extension to the existing worker daemon, alerted through the Discord bot's existing message-sending code extended to this new kind. The existing ExecutionRun/executePlan model is a genuine mismatch for this and should not be reused directly.
confidence: medium
updated: 2026-08-09
---

> **Superseded by [Decision 0012](0012-the-session-primitive.md), 2026-08-09.**
> 0012 names the Session primitive this Decision discovered from the queuing
> direction and states this Decision's queue as one consumer of it, not the
> reason it exists. The four operator answers below (2026-08-07) were carried
> into 0012's "Supersedes Decision 0011" section unchanged and remain the
> live specification for how `arcadia go --queue` should behave. This file is
> kept for that history; do not treat it as an independent open Decision.

# Decision 0011: Agent-session queue and Discord alerting for `arcadia go`

## Context

The operator asked for `arcadia go` to safely schedule the session it hands
off, monitored, with Discord alerts on activity needing input. Read on its own
that sounds like three systems to build: a job queue, an execution monitor,
and a Discord integration.

Before proposing anything, I read what already exists rather than assume a
green field, the same discipline this project already applies to itself
(Decisions 0009 and 0010 both turned out smaller than their first framing).
All three systems the request describes are already built and, for two of
them, already running on this machine right now:

- **`arcadia worker`** (`src/commands/worker.ts`) is a background daemon with
  `start`/`stop`/`status`/`install` — the last of which registers it as a
  macOS `launchd` service that starts on login. It polls every two seconds,
  claims one pending `ExecutionRun` at a time (`claimNextPendingRun`), runs it,
  and recovers orphaned runs left behind by a killed process (`listOrphanedRuns`
  — this exact recovery path fired during the test run for Decision 0010:
  `Recovered orphaned run ...; PID 999999 is gone`).
- **The Discord bot** (`apps/discord-bot`) is a separate long-running process —
  two of them are running on this machine as of this writing. Its
  `notifications/poller.ts` watches `ExecutionRun` state and already sends
  distinct messages for completion (`runCompletedMessage`), failure
  (`runFailedMessage`), and — critically — **`requires_review`**
  (`runRequiresReviewMessage`), which is functionally identical to "activity
  that needs your input."
- **A multi-project agent queue model already exists** (`src/dispatch/queue.ts`),
  with entry states `ready | running | attention` computed from the same
  `resolveDispatch`/`resolveReadySet` functions `go` itself already calls.

`arcadia go` is connected to none of this. `--apply --agent <x>` prepares a
git worktree and prints a shell command
(`cd <path> && claude --model ... "arcadia advance"`) that the operator must
run themselves, in their own terminal, watched by nothing. That gap — one
missing connection, not three missing systems — is the actual scope of this
decision.

### Why the existing `ExecutionRun` model does not simply fit

The natural first instinct is: make `go` create an `ExecutionRun` and let the
existing worker and Discord bot pick it up unchanged. I checked
`executePlan` (`src/execution/runner.ts:106`) closely enough to find this does
not fit, and would be dishonest to propose as free:

`executePlan` runs a **pre-planned `ExecutionPlanSummary`** — a fixed sequence
of typed `steps` (`codex_planning`, `codex_build`, …), each individually gated
by an explicit authorization flag, with "protected planning" steps additionally
requiring an approved Decision naming the run, decision, and packet before
that step may execute at all. It is built for short, structured, individually
authorized codex invocations inside a known plan — not for launching one
open-ended `claude "arcadia advance"` session that runs autonomously for an
unbounded time, making its own sequence of edits, test runs, and commits until
it decides the action's acceptance criteria are met.

Forcing a `go` handoff through `executePlan` would mean either fabricating a
fake single-step "plan" around an execution shape the step model was never
meant to describe, or weakening the per-step authorization checks that exist
specifically to keep planning execution bounded. Neither is the smallest
correct change; both quietly erode a safety property that model exists to
hold.

### The worker is serial, not parallel

`worker.ts`'s poll loop claims and runs one pending run at a time (`spawnSync`
inside `executePlan` blocks the tick until that run finishes). Queuing
multiple `go` handoffs would run them one after another, not concurrently.
For one operator interleaving PPN and Arcadia work, that is very likely the
right default and not a limitation worth solving preemptively — but it is a
real constraint this decision should state rather than let surprise anyone
later.

## Decision (proposed)

Add a new record kind, distinct from `ExecutionRun`: an **agent session** —
coarse-grained, one row per `go`-prepared handoff, holding what `go` already
knows at the moment it prepares the worktree (agent, model, effort, branch,
path, action id, plan path, started-at) plus a lifecycle the worker can update
from the outside (`queued → running → completed | failed | needs_input`).

1. **`arcadia go --apply --agent <x>` gains a `--queue` flag** (name open to
   revision). With it, `go` writes an agent-session record instead of only
   printing the manual launch command; without it, today's behavior — print
   and let the operator run it themselves — is unchanged. `--queue` should not
   become the default until it has been used successfully at least once.
2. **A small addition to `arcadia worker`**, not a new daemon, claims pending
   agent sessions the same way it claims pending `ExecutionRun`s, and launches
   the already-fully-formed command `go` recorded — the exact
   `buildLaunchCommand` output from Decision 0010, unchanged. The worker does
   not need to understand coding-agent semantics beyond "run this command,
   record when it exits, and record its exit code."
3. **"Needs your input" is a genuine open question**, not a solved mapping.
   `requires_review` on an `ExecutionRun` means a specific typed step result.
   An autonomous `claude "arcadia advance"` session has no equivalent typed
   signal today — it either finishes, is killed, or is still running. The
   nearest honest proxy is process exit combined with whether the session's
   final message (already parsed elsewhere — see
   `isUninvokedFinalMessage`/`finalMessageFromExecution` in
   `codingAgents/adapters.ts`) reads as a stopping point requiring the
   operator, versus a clean completion. This needs the operator's input on
   how much precision is worth building versus accepting "session exited,
   here is its last message" as good enough for a first version.
4. **Discord alerting reuses the bot's existing message-composition and
   send-plumbing**, extended with one new message function for agent-session
   state, parallel to `runCompletedMessage`/`runFailedMessage`
   /`runRequiresReviewMessage`. The poller already knows how to watch a table
   and message on state transitions; it needs a second table to watch, not a
   new watching mechanism.

## What this explicitly does not do

- **No new daemon, queue engine, or bot.** All three already exist; this adds
  one connection and one new lightweight record kind.
- **No change to `ExecutionRun`/`executePlan`'s step-authorization model.**
  That system's safety property (bounded, individually authorized planning
  steps) is doing real work and should not be diluted to accommodate a
  differently-shaped execution kind.
- **No parallel execution.** Sessions queued this way run one at a time,
  inheriting the existing worker's serial claim loop, until there is a
  specific reason to want otherwise.
- **No change to the unqueued path.** `go --apply --agent <x>` without
  `--queue` keeps printing the manual command exactly as Decision 0010 left
  it.

## Open questions — answered by the operator, 2026-08-07

**1. Opt-in `--queue` first.** Queuing does not become the default until it has
been used successfully and `go` can guarantee the worker daemon is present.
Questions 1 and 3 turned out to be the same question: the failure mode of
default-queuing is that `go` silently depends on a daemon that may not be
running. Opt-in defers that coupling until answer 3 removes it.

**2. Exit plus final message for v1, with a better signal named for v2.**
Accepted as good enough to ship, but it is not the best available option, and
the better one is nearly free:

| Signal | Needs agent cooperation | Precision |
| --- | --- | --- |
| Idle/timeout detection | No | Poor — a long test run is indistinguishable from being stuck |
| Process exit + final message | No | Fair — **chosen for v1** |
| Exit-code convention | Yes; neither CLI does this today | Good, unavailable |
| Sentinel file (`.arcadia-needs-input`) | Yes, via prompt instruction | Good, agent-agnostic |
| **Dispatch-state diff** | No | **Best — planned for v2** |

Dispatch-state diff: after a session exits, re-run `resolveDispatch` on the
repository. If it now resolves to an **open Decision** rather than a
dispatchable Action, that *is* the needs-input signal. This requires no new
signalling machinery — `resolveDispatch` already computes it and already
returns `operatorQuestion` — and it is semantically exact: the agent did not
"get stuck," it recorded a question as a document and stopped, which is the
correct behavior. Ship exit-plus-message first because it needs nothing;
add this immediately after because it costs almost nothing.

**3. `go` offers to install the worker daemon.** When `--queue` is requested
and the daemon is not installed or not running, `go` offers to run
`arcadia worker install` rather than refusing with instructions. The operator's
stated requirement is that it Just Work. This is the answer that eventually
allows question 1's default to flip.

**4. Discord is a notification system first.** Alerts must be readable and
useful on their own. Beyond that, a small fixed set of reply commands — one or
two, not a conversational surface — so the most common response can be given
from the phone and momentum is not lost waiting for the operator to reach a
terminal. Which one or two commands are the most common is itself an open
question that should be answered by observing real alerts rather than guessed
at now.

## Consequences if approved

- `arcadia go` becomes a real entry point into supervised, alerted execution,
  not just a git-and-dispatch tool that happens to print a command.
- The operator can queue a handoff and walk away, learning from Discord when
  it finishes or needs them, without keeping a terminal open.
- The three systems this reuses (`worker`, the Discord bot, the queue-state
  model) get their first consumer outside the planning/`ExecutionRun` path
  they were built for, which is a real test of whether their boundaries hold
  up to a second, differently-shaped use.

## Revisit triggers

- The needs-input signal proves too imprecise to be worth alerting on, and a
  typed signal from the agent session turns out to be necessary rather than a
  refinement.
- Serial execution becomes a real bottleneck (multiple sessions genuinely
  need to run concurrently), which the current worker model does not support
  and would need its own decision to change.
- A third execution shape appears that neither `ExecutionRun` nor the proposed
  agent-session kind fits, suggesting the split itself needs reconsidering.
