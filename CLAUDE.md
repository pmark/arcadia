# CLAUDE.md

@AGENTS.md

Everything governing work in this repository is vendor-neutral and lives in the
files above and below. This file exists only to load them, because Claude Code
reads `CLAUDE.md` automatically and does not read `AGENTS.md`.

Read these before working:

| File | For |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Standing preferences — imported above, so it is already in context |
| [`CONSTITUTION.md`](CONSTITUTION.md) | The constraints that outrank convenience |
| [`docs/managed-documents.md`](docs/managed-documents.md) | How the work pointer, plan documents, and enforced fields work |
| [`OPERATOR_CONTEXT.md`](OPERATOR_CONTEXT.md) | Who this is for and what they want |
| [`START_HERE.md`](START_HERE.md) | Normal daily operation |

`arcadia next` prints the Constitution in its dispatch brief, so the standing
constraints arrive with the objective rather than depending on this file.

## Claude Code specifics

- `@AGENTS.md` above is a Claude Code import. Codex ignores it and reads
  `AGENTS.md` directly, which is why the shared rules live there rather than
  here. Do not move shared rules into this file — Codex would never see them.
- Prefer the dedicated file and search tools over shell equivalents, and run
  independent tool calls in one batch.
- AGENTS.md's session-naming rule applies here through the
  `set_session_title` tool (Claude Code Remote's session-title MCP call):
  call it with the resolved `active_plan: current_action` instead of
  leaving the default "Arcadia Go" title.
- AGENTS.md's agent Git identity rule (below) applies to this session too.
  Claude Code's own default attribution — a plain `Co-Authored-By: Claude
  <model> <version>` trailer with the commit authored as the operator — is
  superseded here: resolve `arcadia identity resolve --agent claude --tier
  <light|standard|heavy>` (light for Haiku, standard for Sonnet, heavy for
  Opus — whatever this session's active model is, including after `/fast` or
  a mid-session model switch) and prefix its printed `GIT_AUTHOR_NAME=…
  GIT_AUTHOR_EMAIL=… GIT_COMMITTER_NAME=… GIT_COMMITTER_EMAIL=…` onto every
  `git commit`, so `git log` names the agent and tier instead of the
  operator. Use those four environment variables, not `git -c user.*` — Git
  resolves `author.*`/`committer.*` config and any already-exported
  `GIT_AUTHOR_*`/`GIT_COMMITTER_*` (for instance, left over from an Arcadia
  launch whose tier no longer matches a since-switched model) ahead of
  `user.*`, so a `-c user.*` override can silently lose; re-exporting the
  same four variables on the commit itself outranks all of that. Still close
  the commit body and PR description with the
  attribution lines this session's own system reminder specifies — that
  trailer and the commit author are two different things, and this rule only
  changes the author.
- This repository pins Node 22.23.1 in `mise.toml`; Corepack activates pnpm
  11.7.0 from `package.json`.
  `better-sqlite3` fails to load when dependencies were built under another
  Node ABI. `postinstall` now runs `mise exec -- pnpm rebuild better-sqlite3`
  automatically after every `pnpm install`, and `pnpm arcadia` runs under
  `mise exec --` so it always executes with the pinned Node regardless of
  which `node`/`pnpm` an ambient shell would otherwise resolve. `pnpm test`
  and `pnpm build` are not wrapped that way; run them as
  `mise exec -- pnpm test` / `mise exec -- pnpm build` if the ambient shell's
  `node` is not already the mise-pinned one.
- `package.json` deliberately carries no `engines.node`. It used to, and pnpm's
  own preflight check compared it against whatever Node the *ambient* `pnpm`
  process happened to be running under — not the Node any command actually
  executed with, since `mise exec --` re-resolves that regardless. The result
  was a `[WARN] Unsupported engine` line on every single invocation that never
  reflected a real problem and never went away, because `mise.toml` (the
  version that is actually enforced) and `package.json` (the version pnpm was
  comparing against) were two names for one fact. If a command fails with a
  Node-version-shaped error, it is a real failure — investigate it — not this
  warning, because this warning no longer exists.
- `pnpm-workspace.yaml` sets `verifyDepsBeforeRun: false`, and it used to be
  `warn`. pnpm's default is `install`: before running any script it checks
  dependency freshness and, if unsatisfied, shells out to `pnpm install` —
  which asks to **remove the modules directory** first. An agent worktree
  bridges `node_modules` from the main checkout, so pnpm reads that bridge as
  out of sync and a bare `pnpm arcadia` offered to purge the dependency tree
  *every* checkout shares; `warn` dropped that action but kept the diagnosis.
  The diagnosis turned out not to be trustworthy either. In a worktree it is a
  false positive by construction, because the bridged workspace-state file
  names the main checkout's project roots; in the main checkout it is a false
  positive whenever a worktree ran `pnpm install` last, because the bridge
  symlinks that state file and the worktree's install rewrites the main
  checkout's copy. It also prints to **stdout**, so it corrupts `--json` output
  and breaks automation. The one true positive it might catch — a manifest
  edited without an install — is already caught by CI's
  `pnpm install --frozen-lockfile` and by a clear runtime module error. Same
  reasoning that removed `engines.node` above: a preflight that never reflects
  a real problem is noise.
