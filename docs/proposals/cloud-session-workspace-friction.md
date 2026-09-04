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

## What we would build locally

A CLAUDE.md/AGENTS.md section (or a bootstrap script) telling every cloud
session, up front: which commands work without a workspace, how to detect and
route around a missing `mise`, and the exact procedure for recording an
Action's completion in checked-in documents when no workspace is reachable —
duplicating logic that plainly belongs in `arcadia` itself (a `--workspace
none` / offline mode of `next`, a `mise` presence check with a documented
fallback, a `docket --explain-gap`-style check against `HEAD`). Building any
of that here is the local reimplementation this proposal exists to avoid.
