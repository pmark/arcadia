---
name: arcadia-go
description: Safely finish a completed coding-agent worktree, fast-forward it into the local base branch, retire only clean merged agent state, prepare a fresh isolated Codex or Claude Code worktree, and continue the repository-governed Arcadia action. Use when the user says "arcadia go" or "arcadia advance", asks to finish or clean up the current task and start the next one, encounters a branch-already-used-by-worktree error, or wants a reliable cross-agent continuation handoff.
---

# Arcadia Go

<!-- ARCADIA_MANAGED_SKILL -->

Arcadia Go reconciliation is a **host-controller** operation. It fetches,
updates shared Git metadata, and creates or retires worktrees, so it must never
run inside a Codex or Claude Code sandbox. Do not reproduce its Git logic by
hand or invoke the mutable `arcadia go` launcher from this task. For both
providers, the fixed `go` launcher always submits a request to the host worker; it
does not run Git mutation in the sandbox.

If the request is exactly `arcadia advance` in a prepared worktree, begin at
step 3. That phrase is the continuation
prompt, not permission to invoke the mutable CLI command directly.

## Workflow

1. If the operator says `arcadia go`, run the fixed provider launcher from the
   current Project repository or prepared Session worktree:

   ```sh
   __ARCADIA_CODEX_GO_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_GO_BROKER__
   ```

   This submits only a host-worker request for either provider. The host worker derives
   the source from its heartbeat and runs the canonical preview/apply outside
   the sandbox. Never pass arguments, run mutable `arcadia go` directly, or
   recreate the Git logic by hand. If the worker is unavailable, the refusal is
   the repair action: start the updated worker and rerun the same launcher.
   On success, continue from `data.nextWorktree.path`: use that directory for
   subsequent commands and run the fixed `advance` launcher there (step 3).
   Do not stop at printing the broker JSON. If the active environment cannot
   write the returned worktree, report that exact environment mismatch once;
   do not request repeated Git or filesystem escalations.
2. After the declared objective checks are ready, request protected preservation:

   ```sh
   __ARCADIA_CODEX_PRESERVE_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_PRESERVE_BROKER__
   ```

   The launcher submits a request only. The existing host worker validates an
   immutable candidate snapshot in a restricted sandbox and preserves that exact
   tree. Never supply a passing assertion or write an evidence file as authority.
   An unavailable host worker is a named stop; never run Git mutation or weaken
   the sandbox to bypass it. Preservation does not accept, integrate, complete,
   or advance the Action. Retain the receipt and any LOCAL ONLY recovery action.
3. If the request is `arcadia advance` in an already prepared worktree, set
   the command tool's working directory to that worktree and run:

   ```sh
   __ARCADIA_CODEX_ADVANCE_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_ADVANCE_BROKER__
   ```

   Never run mutable `arcadia advance` directly and never pass an argument to
   either protected launcher.
4. Before changing code, run the matching fixed read-only work-monitor launcher
   from that prepared worktree:

   ```sh
   __ARCADIA_CODEX_WORK_MONITOR_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_WORK_MONITOR_BROKER__
   ```

   It runs only `arcadia work monitor --no-pull-requests` against the resolved
   local workspace. Report any preservation blocker it finds; do not ask for
   approval to run this read-only preflight.
5. Inspect the selected Action and its local implementation boundaries using
   ordinary read-only commands (`git status`, `rg`, and targeted file reads)
   without asking for approval. Read-only discovery is already authorized by a
   request to continue Arcadia work. Ask only when a later action needs an
   approval boundary that the repository or provider has not already granted.

## Agent handoff

- Codex Desktop cannot receive a CLI profile selection from a native task
  creation call. Before creating or continuing a governed Desktop/iPhone-connected
  task, the operator must choose **arcadia-unattended** in the permissions control
  beneath the composer, wait for the environment to refresh, then start the task
  in the prepared worktree with `arcadia advance`. If that exact named profile is
  unavailable, fail closed: do not create the task and give this one remedy:
  `pnpm arcadia go-broker install`, then fully restart Codex Desktop and select
  **arcadia-unattended**. The CLI launch command selects the same profile and
  uses `--ask-for-approval never`; it is the only unattended fallback.
- The fixed provider executables are request-only, including in a host terminal.
  The worker owns the Git-mutating child process and performs canonical preview
  and identical apply outside the coding-agent sandbox. Continue in the returned
  prepared worktree. A request does not authorize merge, deployment, completion,
  or acceptance beyond the existing canonical command's authority checks.
- After entering a prepared worktree, check whether `node_modules` exists. If
  missing, use that repository's dependency-bridge command or documented
  symlink rather than improvising a per-worktree dependency install.
- The protected broker installer configures the default `~/.codex/config.toml`
  and every present named `~/.codex/*.config.toml` profile with the exact
  `~/.codex/worktrees` and `~/.claude/worktrees` roots. It preserves other
  roots, keeps interactive profiles on-request, and keeps
  `arcadia-unattended` explicitly unattended; `go-broker status` names any
  present profile whose roots or guardrails are missing.
- Never start from remote `origin/main` when the broker reports a newer local
  base. The prepared worktree deliberately starts from the updated local base.

## Safety contract

The host controller and prepared-worktree brokers fail closed for dirty,
detached, divergent, non-agent-owned, or non-dispatchable state. Only the host
controller may fast-forward, fetch, or create/remove a worktree; it may remove
only the named clean source worktree and its merged agent branch. It never
stages, commits, force-merges, resets, pushes, opens a pull request, deploys,
launches a coding-agent process, or discards work. Every launcher accepts no
public arguments. `advance` and `work-monitor` emit read-only results. `go`
and `preserve` submit fixed requests for either provider and read only
host-protected responses.
