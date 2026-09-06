---
name: arcadia-go
description: Safely finish a completed coding-agent worktree, fast-forward it into the local base branch, retire only clean merged agent state, prepare a fresh isolated Codex or Claude Code worktree, and continue the repository-governed Arcadia action. Use when the user says "arcadia go", asks to finish or clean up the current task and start the next one, encounters a branch-already-used-by-worktree error, or wants a reliable cross-agent continuation handoff.
---

# Arcadia Go

<!-- ARCADIA_MANAGED_SKILL -->

Use Arcadia's installed protected `go` broker. Do not reproduce its Git logic
by hand and do not invoke the mutable `arcadia go` launcher for this workflow.

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
   command. If handing off to a genuinely new session/process, that session's
   opening prompt is exactly `arcadia advance`. If this session is continuing,
   run `arcadia advance` yourself in the prepared worktree; do not invoke this
   skill a second time.

## Agent handoff

- In Codex Desktop, prefer the native task-creation tool when available and
  explicitly requested by this invocation. Point it at the prepared worktree
  and use `arcadia advance`. Otherwise run the returned Codex command or open
  that path with `codex app` and report the prompt.
- In Claude Code, exit a Claude-managed source worktree before invoking the
  broker if its isolation policy blocks access to the retained checkout. Then
  either enter the returned worktree and continue this session with `arcadia
  advance`, or start the returned separate process. Do not do both.
- After entering a prepared worktree, check whether `node_modules` exists. If
  missing, use that repository's dependency-bridge command or documented
  symlink rather than improvising a per-worktree dependency install.
- Never start from remote `origin/main` when the broker reports a newer local
  base. The prepared worktree deliberately starts from the updated local base.

## Safety contract

The protected broker and canonical `arcadia go` implementation fail closed for
dirty, detached, divergent, non-agent-owned, or non-dispatchable state. They
may fast-forward only and may remove only the named clean source worktree and
its merged agent branch. They never stage, commit, force-merge, reset, push,
open a pull request, deploy, launch a coding-agent process, or discard work.
The broker accepts no public arguments and emits only the final apply result or
refusal as JSON.
