---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia give a cloud coding-agent session (no reachable operator workspace) a documented, deterministic path for setup, orientation, and completing its assigned Action — instead of leaving each of those to session-by-session judgment calls?
---

# Cloud session friction running "arcadia go"

## Why this project needs it

A 2026-09-04 cloud session ran `arcadia go` against this repository — Arcadia's
own — starting from a fresh container with no prior state. It hit four
distinct friction points before it could do anything useful, none of them
about the assigned Action itself. Each cost real time re-deriving something
that should have been either automatic or written down once.

### 1. The pinned toolchain silently wasn't there

`mise.toml` pins Node 22.23.1 and `CLAUDE.md` documents that `postinstall`
runs `mise exec -- pnpm rebuild better-sqlite3` and that `pnpm arcadia` always
runs under `mise exec --`. The container had no `mise` binary at all — only a
bare Node 22.22.2 and pnpm 11.7.0 preinstalled at `/opt/node22`. Every `mise
exec --`-wrapped path failed with `sh: 1: mise: not found`, including
`pnpm arcadia work monitor` (the very first command
`docs/managed-documents.md` and Working-Copy Safety both say to run) and the
`postinstall` rebuild step.

Nothing detected or reported this gap; it just failed opaquely, once per
wrapped command, until traced back to "mise is not installed here." The
session worked around it by calling `npx tsx src/cli.ts ...` directly and
manually confirming `better-sqlite3` loaded under the container's actual Node
(it did — same ABI line — but that was luck, not a checked invariant).

### 2. No command said "you have no workspace, here is what still works"

Nearly every `arcadia` command needs a workspace, and the workspace is
explicitly "the operator's private operational data" that "lives outside this
repository" — genuinely unreachable from a fresh cloud container, not a setup
step the session skipped. Discovering *which* commands work without one
(`docket`, `agent-ask contract`, `plans`, `triggers`) took reading `--help`
output and source, one command at a time, until `docket` was found to be the
one that actually answers "what is `current_action` and is it dispatchable"
without a database. That command exists and is exactly the right tool; it is
just not where `docs/managed-documents.md`'s "Start every session here"
section points a workspace-less session, and nothing names it as the
fallback.

### 3. Completing the assigned Action required a judgment call the docs don't resolve

AGENTS.md is emphatic that Action status, `current_action`/`active_plan`
pointers, and results are governance state that must never be hand-edited —
"Writing those by hand is fabricating a record of something nobody decided."
That rule is stated globally, with no carve-out visible in the text for the
one case that actually happened: a session executing its own already-assigned,
already-authorized `current_action`, finding the work already done, and
needing to record that and advance the pointer, with no reachable workspace to
run `arcadia work done` through.

The session resolved this by inference — noticing that `arcadia work done`
itself never writes to the checked-in plan file (only the database), that
`docs/managed-documents.md` calls checked-in documentation authoritative, and
that every prior completed Action in `PROJECT.md`'s narrative shows exactly
this hand-written pattern — and concluded the Agent Ask rule is scoped to
*proposing new work*, not *recording completion of the work you were already
dispatched to do*. That reasoning might be right, but it took real effort to
reach and a differently-cautious session could easily have refused to touch
the pointer at all, leaving a fully-implemented Action stuck open indefinitely
in every cloud session that resolves it.

### 4. No signal for "the code is already done, only the record is stale"

The assigned Action, `accept-upstream-proposals`, turned out to already be
fully implemented and merged to `main` (commit `1b8e3b0`) before the session
even started — `PROJECT.md` was simply stale. Confirming that required
grepping git history for related files and diffing a commit by hand; nothing
in `docket`, `next`, or the plan document itself flags "this Action's
acceptance criteria may already be satisfied by code already on this branch,"
which is exactly the kind of check `resolveDispatch`/`arcadia next --ready`
already does *when a workspace is reachable*.

## Round 2: implementing `adopt-operator-task-ledger`

The same "arcadia go" cloud session continued into a second Action
immediately after the first PR merged. Two more friction points, both new:

### 5. Two pointers must be moved by hand, and nothing checks they agree

Completing an Action and advancing to the next one means editing
`current_action` in *two* places: the plan document's own frontmatter
(`docs/plans/<slug>.md`) and `PROJECT.md`'s frontmatter. This session updated
only `PROJECT.md` on the first pass, then ran `arcadia docket` to verify the
new pointer — and `docket` still reported the *old*, now-done Action, because
it resolves through the plan document's `current_action`, not `PROJECT.md`'s
alone. The mistake was only caught because `docket` was run as a check after
editing, not because anything flagged the mismatch directly. A repository
with two authoritative-sounding pointers that must be kept in lockstep by
hand, with no command that either updates both atomically or warns when they
disagree, is a defect waiting to ship a stale pointer into `main`.

### 6. Confirming "how PPN did it" costs a second repository clone

Several Decisions (0025, 0028) promote a capability by name from Private
Practice Now's shim (`scripts/arcadia.mjs`) and say to copy a specific piece
of its design "exactly." The Decision documents summarize the shape in prose,
but getting the actual field names, validation order, and CLI ergonomics
right required adding and cloning the PPN repository as a second source and
reading its script directly — a multi-step, multi-minute detour (`add_repo`,
a full clone with a generous timeout, `register_repo_root`) that a session
without that tool access, or under tighter time pressure, would likely skip
and reimplement from prose alone, probably drifting from the thing it was
told to copy "exactly."

## What we would build locally

A CLAUDE.md/AGENTS.md section (or a bootstrap script) telling every cloud
session, up front: which commands work without a workspace, how to detect and
route around a missing `mise`, and the exact procedure for recording an
Action's completion in checked-in documents when no workspace is reachable —
duplicating logic that plainly belongs in `arcadia` itself (a `--workspace
none` / offline mode of `next`, a `mise` presence check with a documented
fallback, a `docket --explain-gap`-style check against `HEAD`). Building any
of that here is the local reimplementation this proposal exists to avoid.

## Round 3: found why mise is missing, and fixed it at the session-infra layer

A later cloud session, asked specifically to run `arcadia go` and log
friction, reproduced friction point 1 above from an even colder start: the
container had no `node_modules` at all, not just no `mise` — a genuinely
fresh clone, not a warm one missing one tool.

Two things were new this time:

### 7. `mise.run` is blocked by this environment's own egress policy

`curl -fsSL https://mise.run` returned HTTP 403. The agent proxy's status
endpoint (`$HTTPS_PROXY/__agentproxy/status`) confirmed it plainly:
`recentRelayFailures` recorded `"kind": "connect_rejected", "detail": "gateway
answered 403 to CONNECT (policy denial or upstream failure)", "host":
"mise.run:443"`. This upgrades friction point 1 from "the container happens
not to have mise" to "this class of cloud session cannot install mise through
its documented method, ever, under the current egress policy." Any future fix
has to route around mise entirely for this surface rather than trying harder
to install it.

### 8. `pnpm install` itself fails its exit code on a fresh clone, even though the dependencies it fetched are fine

Running plain `pnpm install` (no mise) on the fresh clone worked all the way
through fetching and building every package — including `better-sqlite3`,
whose `prebuild-install` step found a prebuilt binary matching the
container's Node 22.22.2 ABI and loaded successfully with no rebuild needed —
and then failed its overall exit code solely because the top-level
`postinstall` script (`mise exec -- pnpm rebuild better-sqlite3`) hit `sh: 1:
mise: not found`. Any automation that gates on `pnpm install`'s exit status
(a CI step, a session hook, a human's `&&`) sees total failure for a checkout
that is actually 100% usable.

### The fix: a Claude Code SessionStart hook, not another documentation section

Both `AGENTS.md`'s "Asking Arcadia to change Project state" (governance state
must go through an Agent Ask) and "Asking for a capability the Way does not
have" (file a proposal, don't reimplement Arcadia locally) were considered and
found not to apply here: nothing about this fix touches `PROJECT.md`, a plan,
or a Decision, and nothing about it reimplements any `arcadia` command or
governance logic. It is ordinary repository infrastructure scoped to one
coding-agent vendor's session lifecycle, exactly the kind of thing
`CLAUDE.md`'s own "Claude Code specifics" section already carves out as
vendor-specific and out of `AGENTS.md`'s shared-rules scope.

`.claude/hooks/session-start.sh`, registered in `.claude/settings.json` as a
`SessionStart` hook and gated on `CLAUDE_CODE_REMOTE=true` (so it never runs
on the operator's own Mac, which has real `mise`), shims a `mise` binary onto
`PATH` that understands the one invocation shape this repository's scripts
actually use — `mise exec -- <command...>` — and simply execs the command
directly, then runs `pnpm install`. It does not try `mise.run` again and does
not try to match the pinned Node version exactly; it trusts the
already-verified fact that the container's preinstalled Node/pnpm satisfy
what mise would have activated closely enough for this repository's own
tooling to work.

Validated end to end from a reset state (`node_modules` and the shim removed,
then the hook run exactly as Claude Code on the web would run it):
`pnpm install` completes with exit 0 including the postinstall rebuild step,
`better-sqlite3` loads, `pnpm arcadia docket --repo .` runs successfully
end to end (previously always failed with `mise: not found`), a sampled test
file passes under `vitest`, and `tsc --noEmit` reports no errors.

### 9. `.gitignore` blanket-excluded `.claude/`, which would have silently thrown this fix away

`.gitignore` ignored `.claude` outright, filed under a "# Operating system
files" heading next to `.DS_Store` — clearly a generic template line from
before this repository had any real Claude Code project configuration to
track, not a deliberate decision to keep `.claude/settings.json` or hooks out
of version control. Writing the hook files above did not even show them as
untracked; `git status` was silent about them until this was found and fixed.
A session that built exactly this fix and committed without checking
`git status --short --ignored` would have shipped a no-op commit: the hook
would work for the rest of that one session (already on disk) and then vanish
the moment the container was reclaimed, with nothing in the merged PR to show
it had ever existed. Changed to `.claude/*` with explicit `!.claude/settings.json`
and `!.claude/hooks` negations — narrow enough that personal/local Claude
Code state under `.claude/` stays ignored by default, but the two paths that
are genuinely project configuration are tracked. (The negation had to target
`.claude/*`, not `.claude`, plus the directory itself: git does not descend
into an ignored directory to evaluate negation patterns for files inside it —
`!.claude/settings.json` alone was silently ineffective on the first attempt.)

This closes friction points 1, 7, and 8 for every future Claude Code cloud
session against this repository, without changing anything about how the
operator's own machine or Codex's environment works. It does not address
friction points 2–6 above, or the open question this proposal exists to ask —
Arcadia itself still has no offline/workspace-less mode, no built-in `mise`
presence check, and no first-class way to record an already-authorized
Action's completion from a session with no reachable workspace. Those remain
open.
