# Register agent workspace trust — proof Artifact

Action: `register-agent-workspace-trust`
(plan `bootstrap-managed-production-to-build-flight-deck`).

## What changed

- `go-broker install` now writes Codex workspace trust —
  `[projects."<repo root>"]` / `trust_level = "trusted"` — into
  `~/.codex/config.toml` for every configured Arcadia Project repository
  (`project_metadata.repo_path`), via `planWorkspaceTrust` and
  `setCodexWorkspaceTrust` in `src/agentSetup/goBrokerAgentSetup.ts`.
- `go-broker status` has a new named check, `codexWorkspaceTrust`, beside the
  existing profile, executable and allowlist checks. A missing entry makes
  status `ready: false` and names the repository as
  `codexWorkspaceTrust missing: <repository>`; the human output adds a
  `Workspace trust: N/M Project repositories trusted` line and lists any
  refused path as `never trusted`.

## Why the repository root is enough for Codex

Codex resolves a linked Git worktree to its main checkout before looking up
trust. A prepared worktree under `~/.codex/worktrees/…` therefore inherits the
trust recorded for its Project's repository root, and the shared worktree root
itself never needs — and never gets — trust. The fixture test checks the Git
side of that resolution: the worktree's `--git-common-dir` parent is the
trusted root, and no entry names the worktree path.

## Scoping (what is never trusted)

`planWorkspaceTrust` grants trust only to configured Project paths that are an
existing Git repository root, and refuses:

| Refused path | Reason |
| --- | --- |
| The home directory, or any parent of it | `is the home directory or one of its parents` |
| A shared worktree root (`~/.codex`, `~/.claude`, `~/.opencode` `…/worktrees`), anything inside it, or anything containing it | `is, contains, or lies inside a shared agent worktree root` |
| A directory that contains another configured Project | `is a parent directory of another configured Project repository` |
| A path Git does not report as its own worktree root (`git rev-parse --show-toplevel`) | `is not a Git repository root` |

A refused path is reported by status but does not by itself fail readiness, so
one misconfigured Project cannot block every other Project's dispatch.

## Idempotence

The writer edits only the lines that must change: an existing trusted entry is
left alone (never duplicated, never downgraded), an existing table gains or
corrects its single `trust_level` line, and a missing table is inserted
immediately ahead of the managed `permissions.arcadia-unattended` profile, so
the next install finds it in place and produces identical bytes.

Known limit, pre-existing and not widened here: the managed permission profile
is rewritten at the end of the file, so a table Codex itself appends *after*
that profile moves ahead of it on the next install. Its text is unchanged and
the TOML means the same thing.

## Claude Code's trust gate

Claude Code does **not** get the same install-time treatment, deliberately:

- Its trust is recorded per directory in `~/.claude.json`
  (`projects[<path>].hasTrustDialogAccepted`) and is not resolved through a
  worktree's main checkout. A prepared Claude worktree lives at
  `~/.claude/worktrees/<name>/<repo>`, outside the Project root, so trusting the
  root would not cover it. The only directory that would cover every prepared
  worktree is the shared `~/.claude/worktrees` root, which this Action forbids
  trusting.
- Arcadia's unattended Claude launches do not show the dialog: headless
  `claude --print` runs and Desktop/SDK sessions skip it. Only an interactive
  `claude` TUI opened in a new worktree can ask.
- `~/.claude.json` is rewritten continuously by running Claude sessions, so a
  broker write there would race them.

Trigger to revisit: a managed production launch that starts the interactive
Claude Code TUI in a prepared worktree and is observed stopping at the trust
dialog. The fix then belongs in worktree preparation (trust that one worktree
path when it is created), not in `go-broker install`.

## Evidence

Tests (`tests/go-broker-agent-setup.test.ts`, `go broker workspace trust`):

1. `trusts each configured Project repository at its root`
2. `refuses the home directory, a shared worktree root, and a parent directory`
   — one assertion per refusal, and none of the three appears in the written
   config.
3. `reports the exact missing repository and makes status not ready`
4. `is idempotent and preserves unrelated entries byte-for-byte` — second
   install leaves the config untouched and reports no change; an unrelated
   `untrusted` Project entry and a commented line survive verbatim.
5. `neither duplicates nor downgrades an existing trusted entry`
6. `trusts a repository it has never seen so its prepared worktree resolves to
   a trusted root` — a Git-and-config check on a disposable fixture: a fresh
   repository and a linked worktree under the fixture's `~/.codex/worktrees`, a
   config that did not exist, one install, the worktree's Git common directory
   resolving to the root that now carries the trusted entry, and a status that
   reports ready. It does not execute Codex's own trust lookup.

Live read-only status on the operator's machine, run from this candidate
before any reinstall, named the two Project repositories Codex has never been
told to trust:

```text
codexWorkspaceTrust missing: /Users/pmark/Dev/MR/music/living-songbook
codexWorkspaceTrust missing: /Users/pmark/Dev/MR/sites/martianrover-com2
```

### What is not proven here

The zero-prompt criterion is checked on a disposable fixture only at the
Git-and-config level (Git's worktree-to-root resolution and the written trust
entry); the no-prompt result itself is not proven until a real Codex launch.
A real launch would need either the operator's Codex credentials in a disposable `CODEX_HOME` or a throwaway trust entry
written into the operator's real config; neither is acceptable for an
unattended agent. The operator QA below closes that gap on real repositories.

## Operator QA

Runnable target: local only — the `go-broker` CLI on this Mac and Codex
Desktop. No service URL is involved.

1. After merge, run the `/runs` action **Reinstall the protected go broker from
   the merged main checkout** (`reinstall-go-broker`), or run
   `artifacts/generated/operator-scripts/reinstall-go-broker.sh`.
   Expected: it prints `Protected broker setup: READY` and
   `Workspace trust: 7/7 Project repositories trusted`.
2. `grep -A1 'living-songbook' ~/.codex/config.toml`
   Expected: `trust_level = "trusted"` under that repository's table.
3. Run the reinstall action a second time.
   Expected: the receipt's `install.json` lists no change to
   `~/.codex/config.toml` and creates no new backup of it.
4. Fully restart Codex Desktop, then start an `arcadia go` handoff for a Project
   Codex has not opened before (for example `living-songbook`).
   Expected: Codex opens the prepared worktree with no "trust this folder?"
   prompt and no approval prompt.
