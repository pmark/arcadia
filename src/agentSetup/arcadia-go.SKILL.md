---
name: arcadia-go
description: Safely finish a completed coding-agent worktree, fast-forward it into the local base branch, retire only clean merged agent state, prepare a fresh isolated Codex or Claude Code worktree, and continue the repository-governed Arcadia action. Use when the user says "arcadia go" or "arcadia advance", asks to finish or clean up the current task and start the next one, encounters a branch-already-used-by-worktree error, or wants a reliable cross-agent continuation handoff.
---

# Arcadia Go

<!-- ARCADIA_MANAGED_SKILL -->

Arcadia Go reconciliation is a **host-controller** operation. It fetches,
updates shared Git metadata, and creates or retires worktrees, so it must never
run inside a Codex or Claude Code sandbox. Do not reproduce its Git logic by
hand or invoke the mutable `arcadia go` launcher from this task. For every
provider, the fixed `go` launcher always submits a request to the host worker; it
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
   # opencode uses: __ARCADIA_OPENCODE_GO_BROKER__
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
2. Read the returned `preservation` readiness. A manual `go` handoff normally
   has `session: null`: this is not stale state and does not require a planning
   packet, a managed Session, or production activation. The host binds its
   existing worktree reservation to the current Action and configured checks;
   the same protected preservation launcher handles the manual candidate.
   Never ask the operator to prepare a planning packet merely because the
   Session is null. Missing validation commands or an old worker are concrete
   configuration/runtime defects: diagnose and repair within existing authority,
   and report the exact remaining defect instead of inventing an approval.

   After the declared objective checks are ready, request protected preservation:

   ```sh
   __ARCADIA_CODEX_PRESERVE_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_PRESERVE_BROKER__
   # opencode uses: __ARCADIA_OPENCODE_PRESERVE_BROKER__
   ```

   The launcher submits a request only. The existing host worker validates an
   immutable candidate snapshot in a restricted sandbox and preserves that exact
   tree. Manual handoffs are preserved locally only; this does not authorize
   remote publication, a managed Run, or Action completion. Never supply a passing assertion or write an evidence file as authority.
   An unavailable host worker is a named stop; never run Git mutation or weaken
   the sandbox to bypass it. Preservation does not accept, integrate, complete,
   or advance the Action. Retain the receipt and any LOCAL ONLY recovery action.
3. If the request is `arcadia advance` in an already prepared worktree, set
   the command tool's working directory to that worktree and run:

   ```sh
   __ARCADIA_CODEX_ADVANCE_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_ADVANCE_BROKER__
   # opencode uses: __ARCADIA_OPENCODE_ADVANCE_BROKER__
   ```

   Never run mutable `arcadia advance` directly and never pass an argument to
   either protected launcher.

   Once the broker succeeds, run `pnpm arcadia next` from that worktree — a
   read-only noun command, not a protected launcher. Then, in your own next
   chat reply, paste that command's full stdout verbatim (a fenced code
   block is fine) as the session's opening brief, before doing anything
   else. Running the command is not enough by itself: the operator reads
   the chat, not the raw tool-call transcript, so a summary like "dispatch
   brief confirmed" does not satisfy this step — the literal brief text
   must appear in a message the operator sees.

   That brief names the resolved `active_plan` and `current_action`. If the
   environment exposes a session-title tool (Claude Code Remote's
   `set_session_title`), call it now with `<active_plan>: <current_action>`
   so the session is identifiable in a session list instead of carrying a
   generic default like "Arcadia Go". Skip this silently where no such tool
   exists.
4. Before changing code, run the matching fixed read-only work-monitor launcher
   from that prepared worktree:

   ```sh
   __ARCADIA_CODEX_WORK_MONITOR_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_WORK_MONITOR_BROKER__
   # opencode uses: __ARCADIA_OPENCODE_WORK_MONITOR_BROKER__
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
  `~/.codex/worktrees`, `~/.claude/worktrees`, and `~/.opencode/worktrees`
  roots. It preserves other
  roots, keeps interactive profiles on-request, and keeps
  `arcadia-unattended` explicitly unattended; `go-broker status` names any
  present profile whose roots or guardrails are missing.
- Never start from remote `origin/main` when the broker reports a newer local
  base. The prepared worktree deliberately starts from the updated local base.

## Safety contract

The host controller and prepared-worktree brokers fail closed for dirty,
detached, source-divergent, non-agent-owned, or non-dispatchable state. A base
that is both ahead and behind its remote is reconciled only by the host, only
when its local-only commits are recognized Arcadia-generated governance writes,
history has one complete merge base, and the computed tree is conflict-free.
The host snapshots only the configured upstream into an isolated ref, rejects
custom merge drivers, verifies that the merged governance tree is dispatchable,
by creating one unreferenced auditable two-parent candidate and checking it in
a temporary checkout, rechecks every pinned ref, and advances the base with
hooks disabled. Only then may it return a prepared/resumed
worktree. Rewritten, unrelated, conflicting, unrecognized, missing-observation,
or prepublication racing history refuses without a manual Git remedy. Only the host controller may fetch, reconcile, or
create/remove a worktree; it may remove only the named clean source worktree
and its merged agent branch. It never stages arbitrary files, force-merges,
resets, pushes, opens a pull request, deploys, launches a coding-agent process,
or discards work. Every launcher accepts no public arguments. `advance` and
`work-monitor` emit read-only results. `go` and `preserve` submit fixed
requests for either provider and read only host-protected responses.
