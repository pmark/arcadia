---
name: arcadia-go
description: Safely finish a completed coding-agent worktree, fast-forward it into the local base branch, retire only clean merged agent state, prepare a fresh isolated Codex or Claude Code worktree, and continue the repository-governed Arcadia action. Use when the user says "arcadia go" or "arcadia advance", asks to finish or clean up the current task and start the next one, encounters a branch-already-used-by-worktree error, or wants a reliable cross-agent continuation handoff.
---

# Arcadia Go

<!-- ARCADIA_MANAGED_SKILL -->

Use Arcadia's installed protected `go` broker. Do not reproduce its Git logic
by hand and do not invoke the mutable `arcadia go` launcher for this workflow.

If the request is exactly `arcadia advance` in a prepared worktree, skip the
handoff steps below and begin at step 7. That phrase is the continuation
prompt, not permission to invoke the mutable CLI command directly.

## Workflow

1. Resolve and preserve the current Git worktree root before any cleanup.
2. Identify the active coding agent as `codex` or `claude`.
3. Set the command tool's working directory to that exact completed worktree
   root. Do not express the directory change as a compound shell command.
4. Run the matching provider executable with no arguments:

   ```sh
   __ARCADIA_CODEX_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_BROKER__
   ```

5. The broker performs the canonical read-only preview and identical apply
   internally, revalidating state before mutation. Never pass `--apply`,
   `--agent`, `--repo`, `--source`, `--launch`, or any other argument.
6. If the broker refuses, report its exact blocker and remedy. Do not commit,
   stash, reset, force, switch, merge, delete, or reinterpret the refusal.
7. Use the returned `nextWorktree.path`, `nextWorktree.branch`, and launch
   command when this session performed the handoff. If handing off to a
   genuinely new session/process, that session's opening prompt is `arcadia
   advance`; its installed skill begins here. In either case, set the command
   tool's working directory to the prepared worktree and run:

   ```sh
   __ARCADIA_CODEX_ADVANCE_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_ADVANCE_BROKER__
   ```

   Never run mutable `arcadia advance` directly and never pass an argument to
   either protected launcher.
8. Before changing code, run the matching fixed read-only work-monitor launcher
   from that prepared worktree:

   ```sh
   __ARCADIA_CODEX_WORK_MONITOR_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_WORK_MONITOR_BROKER__
   ```

   It runs only `arcadia work monitor --no-pull-requests` against the resolved
   local workspace. Report any preservation blocker it finds; do not ask for
   approval to run this read-only preflight.
9. Inspect the selected Action and its local implementation boundaries using
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
- In Claude Code, exit a Claude-managed source worktree before invoking the
  broker if its isolation policy blocks access to the retained checkout. Then
  either enter the returned worktree and continue this session with `arcadia
  advance`, or start the returned separate process. Do not do both.
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

The protected launchers and their canonical Arcadia implementations fail closed for
dirty, detached, divergent, non-agent-owned, or non-dispatchable state. They
may fast-forward only and may remove only the named clean source worktree and
its merged agent branch. They never stage, commit, force-merge, reset, push,
open a pull request, deploy, launch a coding-agent process, or discard work.
Each protected launcher accepts no public arguments. The `go` launcher emits
only the final apply result or refusal as JSON; `advance` and `work-monitor`
emit their canonical read-only results or refusal as JSON.
