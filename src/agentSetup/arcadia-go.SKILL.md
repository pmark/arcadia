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
step 2. That phrase is the continuation
prompt, not permission to invoke the mutable CLI command directly.

## Workflow

Steps below run in this order. Preservation (step 4) is deliberately last: it
requests protected preservation of finished work, so it cannot run before any
work has happened — running it right after `go` is a guaranteed
`VALIDATION_ERROR`, not a valid shortcut.

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
   subsequent commands and run the fixed `brief` launcher there (step 2).
   Do not stop at printing the broker JSON. If the active environment cannot
   write the returned worktree, report that exact environment mismatch once;
   do not request repeated Git or filesystem escalations.
2. If the request is `arcadia advance` in an already prepared worktree, set
   the command tool's working directory to that worktree.

   Before running any dependency-needing command in this worktree — including
   the launcher below — check whether `node_modules` exists. If missing, run:

   ```sh
   node scripts/bridge-worktree-deps.mjs
   ```

   This symlinks the main checkout's installed dependencies into the worktree.
   Skipping this step surfaces later as a raw
   `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'` with no pointer
   back to this fix — do not treat that error as a code defect.

   Then run the combined fixed launcher, which resolves the advance
   reconciliation, the read-only work-monitor preflight, and the next
   dispatch-brief resolution in one process invocation:

   ```sh
   __ARCADIA_CODEX_BRIEF_BROKER__
   # Claude Code uses: __ARCADIA_CLAUDE_BRIEF_BROKER__
   # opencode uses: __ARCADIA_OPENCODE_BRIEF_BROKER__
   ```

   Never run mutable `arcadia advance`, `arcadia work monitor`, or
   `arcadia next` directly, and never pass an argument to the protected
   launcher. It resolves the Project from the worktree's own managed Project
   document, so it needs no `--project` disambiguation even when this machine
   has more than one active Project. Report any preservation blocker
   `data.workMonitor` finds; do not ask for approval to run this read-only
   preflight.

   Then, in your own next chat reply, paste `data.dispatchBrief` verbatim (a
   fenced code block is fine) as the session's opening brief, before doing
   anything else. Running the command is not enough by itself: the operator
   reads the chat, not the raw tool-call transcript, so a summary like
   "dispatch brief confirmed" does not satisfy this step — the literal brief
   text must appear in a message the operator sees.

   If the environment exposes a session-title tool (Claude Code Remote's
   `set_session_title`), call it now with `data.sessionTitles.working` — for
   example `🔨🔵 BMPB stop-dumping-rationale` — so the session is
   distinguishable even when a session list shows only its first ~20
   characters. Retitle from the same map as the session's state changes:
   `pr` once its pull request is open and in the CodeRabbit loop, `waiting`
   when it stops at a picker or operator question, `blocked` on a recorded
   external blocker, and `done` once the Action is complete or its PR merged.
   Skip this silently where no such tool exists.
3. Inspect the selected Action and its local implementation boundaries using
   ordinary read-only commands (`git status`, `rg`, and targeted file reads)
   without asking for approval. Read-only discovery is already authorized by a
   request to continue Arcadia work. Ask only when a later action needs an
   approval boundary that the repository or provider has not already granted.
4. Read the returned `preservation` readiness. A manual `go` handoff normally
   has `session: null`: this is not stale state and does not require a planning
   packet, a managed Session, or production activation. The host binds its
   existing worktree reservation to the current Action and configured checks;
   the same protected preservation launcher handles the manual candidate.
   Never ask the operator to prepare a planning packet merely because the
   Session is null. Missing validation commands or an old worker are concrete
   configuration/runtime defects: diagnose and repair within existing authority,
   and report the exact remaining defect instead of inventing an approval.

   After the declared objective checks are ready — i.e. once the work this
   session set out to do is done, not right after `go` — request protected
   preservation:

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

## Standalone launchers

`brief` (step 2) is the normal path and the only one this workflow calls. Its
three constituent read-only operations remain installed and independently
callable for manual troubleshooting or other automation that needs only one of
them — never invoke these as part of the numbered workflow above:

```sh
__ARCADIA_CODEX_ADVANCE_BROKER__      # advance reconciliation alone
__ARCADIA_CODEX_WORK_MONITOR_BROKER__ # work-monitor preflight alone
# Claude Code uses: __ARCADIA_CLAUDE_ADVANCE_BROKER__ / __ARCADIA_CLAUDE_WORK_MONITOR_BROKER__
# opencode uses: __ARCADIA_OPENCODE_ADVANCE_BROKER__ / __ARCADIA_OPENCODE_WORK_MONITOR_BROKER__
```

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
- A prepared worktree's `mise.toml` is pre-trusted by the host broker at
  preparation time, before the worktree is ever handed to a sandboxed agent —
  provided the host itself can resolve a `mise` executable (its fixed
  launch-agent paths, or `PATH`). When the config exists and a `mise` binary
  is found but the trust call itself fails, preparation fails closed and
  removes the worktree rather than handing over one that will only fail later
  inside the sandbox; when no `mise` binary is found at all, preparation
  proceeds untrusted, same as before this fix. If a mise-wrapped command still
  fails with `mise ERROR ... Operation not permitted` on a worktree prepared
  after this fix, that means the host had no resolvable `mise` — install one
  where the host process can find it, or retry under `dangerouslyDisableSandbox`
  for that single command as the named exception, not a pattern to repeat
  going forward.
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
or discards work. Every launcher accepts no public arguments. `advance`,
`work-monitor`, and `brief` emit read-only results. `go` and `preserve` submit
fixed requests for either provider and read only host-protected responses.
