# Arcadia repository procedures

These details apply only inside the Arcadia source repository. Read the indexed
sections before their operations; the root bootstrap also binds.

## Plan-amendment operator actions must use the shared runner

In this Arcadia repository, for a generated operator action that settles an Agent Ask with `intent: plan`
and a non-empty `target_ref` (an existing Plan), **use the shared
`arcadia-plan-amendment-v1` runner**. Read
[`docs/operator-plan-amendments.md`](../operator-plan-amendments.md) before
preparing the button. Put pinned inputs and the immutable allowed-effect
envelope in `planAmendment`; generate the executable with
`planAmendmentLauncher(id)` from `src/operatorActions/libraryContract.ts`.
Do not embed settlement commands, parsing, preview fingerprints, extra commands,
or retry logic. Do not clear or forge operator execution context to bypass a
refusal. Broader amendments that the runner cannot represent need a capability
proposal, not a bespoke operator script.

Run `mise exec -- pnpm check:operator-scripts` before publishing any library
entry. CI and `/runs` share that contract check, and the canonical settlement
path refuses a Plan-amendment operator process outside the shared runner.
Other Agent Ask operator actions must declare `agentAsk.proposal`, `intent`,
and `targetRef`; declaring draft-Plan creation cannot authorize amending an
existing Plan. These checks preserve the existing operator approval boundary.
They do not govern ordinary candidate completion evidence or grant an agent
permission to run an approval button.
Legacy entries retire from that check only through the exact-hash manifest in
[`operator-actions.md`](operator-actions.md#retiring-a-library-entry).

<!-- Everything outside the markers above is this repository's own and is never regenerated. -->

The operating principles that used to live here — the 80/20 rule, YAGNI,
divide and conquer, "nothing is ever lost", "if not now, then when?",
make it real, and token economy
— now live in the indexed shared procedural homes under
`docs/agent-guidance/`. Essential constraints remain in `docs/agents-context.md`;
setup regenerates that compact region and installs its referenced procedures.

## Orientation

Before the first tool call for an Action's implementation, repair, validation,
or handoff, use a targeted `rg` lookup in
[`docs/notes-to-self.md`](../notes-to-self.md) for its commands, subsystem,
and known failure symptoms. Read the matching entries and their relevant
evidence before trying commands or repeating an experiment. Repeat that lookup
when a new failure appears. Use the indexed answers instead of rediscovering
paths, flags, workspace boundaries, or recovery procedures.

Log every friction event in the session's evidence report as it occurs: the
operation, observed failure or wasted work, exact evidence, recovery outcome,
and prevention. Link repeated instances to the existing incident rather than
duplicating its explanation. Preserve failed receipts. Separate a verified cause
from a hypothesis, and correct earlier advice when new evidence disproves it.
Canonical Project Log entries and any follow-up work still go through Agent Asks.
Before handoff, add or correct reusable prevention advice in Notes To Self,
following its entry, capacity, and expiry rules; do not fill that hot cache
with every transient incident. Share the exact changed paths with the receiving
session so the lessons ship with the reviewed work. Never change files pinned
by another live operator action without coordinating its refreshed validation.

Optimize cost, speed, and quality together: reuse current receipts and verified
commands, batch independent bounded reads, and run deterministic readiness and
focused checks before model review. Use the least-cost configured model and
effort that meets the Action's requirements; escalate only for a named unmet
requirement or observed failure, preserving immutable packet bindings. Do not
repeat an unchanged failed operation or expand testing without a new reason.
Turn recurring friction into a source fix or meaningful regression check under
the existing governed scope, then retire the workaround when the fix is proved.

Before working on the database, the Intelligence service, or the Discord bot, read:

`docs/AGENT_ORIENTATION.md`

It captures the non-obvious, verified architecture context that most often trips up a cold start: the two schema sources (migrations in `src/db/schema.ts` win), the two distinct "Artifact" concepts, how Intelligence routing/workers/errors behave, that events are a log (not a bus) and there is no auth layer, and how the CLI-shellout boundary works for the dashboard and Discord bot.

## Managed Documentation

[`docs/managed-documents.md`](../managed-documents.md) explains how the
managed documentation system works: the work pointer, plan document anatomy,
which fields are enforced and where, and the rule that checked-in documentation
is authoritative. Read it before writing or changing a `PROJECT.md`, a plan
under `docs/plans/`, or a Decision.

## Arcadia Semantics

Before changing user-facing terminology, data models, CLI commands, dashboard labels, or documentation, read:

`docs/arcadia-semantics.md`

Use Arcadia’s canonical terms consistently:
Domain, Project, Mission, Outcome, Milestone, Action, Artifact, Decision, Log.

## Model Selection

Before pinning `recommended_model`/`recommended_reasoning_effort` on a Plan
Action, or adding/changing an Intelligence capability route's profile, read:

[`docs/model-selection.md`](../model-selection.md)

It names the two places a model gets chosen — the coding-agent Action
handoff and the Intelligence route registry — with pinned model IDs, default
effort, and the boundary each tier is for. Spend in ascending order per the
Constitution's Economy section; this document is the reference that check
resolves against instead of being re-decided per Action. Sessions start on the
light tier (`sessionStartTier`) and the plan's tier is the escalation target.

## Agent Git Identity

Read `docs/agent-guidance/git-identity.md` before every commit or posted comment.

## Operator Guide

`START_HERE.md` is the canonical brief guide for normal Arcadia use. Any change to a user-facing flow, CLI command named there, dashboard address, or managed service behavior must update that file in the same change.

## PR QA Plan

Every PR created at a stopping point must contain an operator-facing QA plan.
The plan is an Artifact, not a vague invitation to "test it": it tells a
person exactly where to go, what to do, and what should happen.

For each runnable surface changed by the PR, state:

- the service or application, its start/recovery command when applicable, and
  the exact URL including host, port, and route;
- whether the target is local-only, LAN/phone-reachable, remote, missing, or
  currently unreachable — never imply a demo is available without evidence;
- the expected change relative to the prior behavior; and
- numbered operator steps with observable expected results.

Include a separate end-user procedure whenever it differs from the operator
procedure. Otherwise say explicitly that the operator procedure is the
end-user procedure. If no runnable target exists, say why and name the
strongest available proof Artifact and the condition that will make a runnable
test possible. The PR template and
`docs/operator-demo-and-release-contract.md` define the required format.

## Working-Copy Safety

Before code changes, run `pnpm arcadia work monitor --no-pull-requests` and
inspect the intended working directory. A candidate worktree has at most one
live coding session; do not begin agent code changes on `main` or in a checkout
another live session is using. Sequential sessions for the same governed Action
may continue in its candidate after the prior session is proven terminal
(Decision 0051).

Before stopping, leave changed code merged or on a pushed branch with a draft
or ready PR. If commit, push, or PR creation is not authorized, report the exact
repository, worktree, branch, dirty paths, and recovery action; never silently
leave uncommitted work on `main` or a detached HEAD. These rules do not broaden
approval authority. See `docs/working-copy-safety.md`.

`arcadia decision approve` (and the other `decision` writers) commit to the
Project's configured repository, the primary checkout, not the worktree they
are run from (#1122). Until that is fixed, and only for this bug, this is a
narrow exception to AGENTS.md Preservation:
1. Run `git fetch` and confirm the primary checkout is clean and on `main`.
2. Run the writer, then confirm `git log origin/main..main` shows only the
   decision commit.
3. Push it with `git push origin HEAD:refs/heads/<branch>` and open its PR.
4. Once the push is confirmed, return the primary checkout with
   `git reset --keep origin/main`.

Never do this when the primary checkout holds any other unpushed commit or
dirty file.

### Automatic production conflict recovery

Production-managed work must not stop merely because its pull request becomes
behind, `DIRTY`, blocked, or red. After every push, and before every production
handoff, inspect the pull request's merge state, required checks, review state,
and branch protection requirements. Anything within the candidate's authority
that prevents merging — including conflicts, build failures, test failures,
lint failures, review findings, stale generated artifacts, or failed
required checks — is part of the work and must be resolved before handoff. The
agent must automatically:

1. fetch the current base branch;
2. merge that base into the candidate branch, preserving both the candidate
   change and the newer base change;
3. resolve textual conflicts deterministically, then run the affected tests,
   lint, `git diff --check`, and the repository's required build/check commands;
4. commit the reconciliation on the candidate branch and push it; and
5. rerun the independent review of the delta and the required checks against
   the new head before handoff, repeating the repair/push/review cycle until
   the PR is mergeable or the three-round review cap is reached (unless
   significant defects keep appearing). If required checks remain red, or a
   blocking review finding remains unresolved, at that cap, stop the automatic
   cycle and report the exact unresolved checks or finding and the recovery
   attempted as a concrete blocker; never merge past it.

Do not leave a PR in a conflicted, failing, or otherwise non-mergeable state
with a narrative status report or ask the operator to perform these routine
steps. If a failure is genuinely outside the candidate's authority — for
example, unavailable credentials, a required external service, a product
decision, or an approval gate — preserve the candidate, record the exact
failure and the smallest draft ask, and report that concrete blocker. This rule
never authorizes merging the PR, bypassing branch protection, weakening tests,
falsifying checks, or crossing any approval gate; automatic recovery ends with
a clean, reviewed, mergeable PR ready for the operator's normal merge decision.

## Experiment workspaces

Decision 0082 permits disposable experiment workspaces beside the exclusive live
`martianrover` workspace, so agents can exercise Asks, queue and pointer moves,
settlement, docs sync and Project import without contending on the live queue.
They are the one bounded exception to "resolve the configured workspace", and
the bound is Decision 0082's: the trial window runs 14 days from 2026-10-04,
**until 2026-10-18**, and stops earlier at the stop condition — any leak-check
change, or any write to `martianrover` attributable to the experiment. After
either, create no experiment workspace and use none until a new Decision
extends it. Decision 0099 narrows the stop condition: a coding provider's own
trust entry for the experiment's temporary folder (Codex persists
`[projects."<path>"] trust_level = "trusted"` in `~/.codex/config.toml`) is
reported, not a stop. Every other leak-check change still stops experiments.
`martianrover` stays the sole authority for every real Project; findings return
through ordinary Agent Asks there, and no experiment result changes governed state.

- **Create** fresh: `arcadia init --profile experiment
  /Users/pmark/Dev/MR/Arcadia/workspaces/exp-<agent>-<yyyymmdd>`. It refuses the
  name `martianrover` and any existing workspace or database, never seeds the
  Arcadia Project, and writes `experiment: { enabled: true, allowedRepoRoot:
  "projects" }` into its `config/arcadia.json`.
- **Address it only inline**: `ARCADIA_WORKSPACE=<exp> arcadia <command>` or
  `--workspace <exp>` on that one command. Never `export` it in a shell and never
  make it the default (`config set defaultWorkspace` refuses): the four live
  launchd services follow the user config default, and the restart script
  follows `ARCADIA_WORKSPACE`. **A command run with no inline workspace is a
  command against the live workspace**: it resolves the user config default
  (`martianrover`) and, like every recorded command, writes an
  `activity_events` row there. The commands classified `exempt` in
  `COMMAND_CLASSIFICATION` (they read no workspace state: `init`, `config get
  defaultWorkspace`, `identity resolve|roster`, `workspace
  resolve|guard|leak-check`, `audit host-preview`, `agent-ask contract`, `pr
  code-review`, `tidy list|undo`, `triggers`, `docket`, `plans` and
  `operator-task *`) record nothing and open no workspace database to do so;
  `tests/activity-no-record-commands.test.ts` fails when one does.
- **Make a forgotten inline fail: `ARCADIA_REQUIRE_INLINE_WORKSPACE=1`.** It
  fails closed: any non-empty value other than `0`, `false`, `no` or `off` (any
  case) turns it on, a typo included; unset or empty is off. With it on, workspace resolution
  (`src/workspace/resolve.ts`, which the CLI, the activity recorder, the guard,
  the broker and the transports all use) accepts only `--workspace`, an
  `ARCADIA_WORKSPACE` value or an initialized workspace at or above the working
  directory. A command that would fall back to the user config default or the
  `.arcadia-workspace` marker fails with `INLINE_WORKSPACE_REQUIRED` and its
  `remedy`, and the recorder skips that row instead of writing it there
  (`dogfood *` is the exception: it targets `.arcadia-workspace` by command
  name, not by fallback).
  `arcadia workspace resolve` reports `inlineWorkspaceRequired` and any refused
  fallback; `workspace guard` fails closed. Commands that resolve nothing
  (help, version, `identity resolve`, `init`, `config get defaultWorkspace`)
  are unaffected, and so is `workspace leak-check`, which reads the user config
  default read-only on purpose. **Who sets it:** you, for your own shell.
  Arcadia's launcher sets it for no Session, because no launch environment pins
  `ARCADIA_WORKSPACE` and a Session's commands (`work monitor`, settlement)
  rely on the user config default; its `env -u` boundary also strips a value
  the tmux server or the launcher's shell would hand down, so a launched
  Session never inherits yours. The launchd services and operator scripts
  never set it, so their behaviour is unchanged. **How a native session turns
  it on:** `export ARCADIA_REQUIRE_INLINE_WORKSPACE=1` in a persistent shell,
  or start the agent CLI with it (`ARCADIA_REQUIRE_INLINE_WORKSPACE=1 claude`,
  `… codex`, `… opencode`) when its tool shells keep no exports between calls;
  then name every workspace inline, the live one included. Exporting the mode
  is fine; exporting `ARCADIA_WORKSPACE` is not. The mode cannot tell an inline
  `ARCADIA_WORKSPACE` from an exported one, so an exported value still
  resolves, and the G1/G6/G7/G8 rehearsal scripts still refuse it themselves.
  Do not run those operator scripts with the mode on: they resolve the live
  workspace from the user config on purpose, so the G6 preflight's workspace
  check fails closed with a misleading "did not resolve from user config"
  message. The test suite starts with the mode off (`vitest.config.ts`).
- **Register only disposable fixtures** under `<exp>/projects/`, and give them
  no Git remote. Registration (Project metadata, `blog configure-site
  --content-repo-path`, `rebuster configure --repo-path`) refuses any other path,
  a symlink that resolves outside, and any repository the live workspace has
  registered. Nothing enforces "no remote": that is the agent's obligation.
- **The guard prevents accidents, not malice.** Anyone who can write
  `<exp>/config/arcadia.json` can delete its `experiment` key and the workspace
  becomes ordinary; the leak check, not the guard, is what shows the boundary
  held.
- **The guard is allow-by-default** (`src/workspace/experimentGuard.ts`). While
  an experiment workspace is resolved it refuses only: production activate and
  reactivate (Grants), `production capacity attest`, `go-broker install|ensure`
  and their Codex/Claude trust writes, `worker start|stop|install|uninstall`,
  `ingress service install|uninstall|run`, ingress writes to the shared iCloud
  folder, `qa restart|refresh`, `scripts/services.sh restart|stop`, `schedule
  github link`, `pr decline-finding`, `way propagate`, `push-unpushed --apply`,
  delivery receipts (`agent-ask notification-sent`, `digest mark-posted`,
  `orientation packet mark-sent`), the Discord bot, `config set
  defaultWorkspace` and the `/runs` operator runner. Each refusal
  (`EXPERIMENT_WORKSPACE_REFUSED`) names the reason and the supported
  alternative. Read-only commands, `gh` reads, local Git, tests and everything
  else inside the experiment are never refused. A new CLI command fails
  `tests/experiment-workspace-guard.test.ts` until it is classified allowed,
  guarded or exempt in `COMMAND_CLASSIFICATION`.
- **Leak check every session**: `arcadia workspace leak-check --record
  <before.json>` before, `arcadia workspace leak-check --baseline <before.json>`
  after. It compares the live Project count and queue revision (read-only, no
  activity row), hashes of the user config, `~/.codex/config.toml`,
  `~/.claude/settings.json`, the trusted-folder list in `~/.claude.json` and
  `~/.arcadia/telemetry/capacity-receipts.json`, the live `production_policy`
  row with its receipt and admission counts, the go-broker release manifests,
  launchers and managed skills, and the `com.arcadia.*` launch agents. Any change
  exits with `WORKSPACE_LEAK_DETECTED`; attribute it (another agent may have
  settled in the live workspace) before calling it a leak, and stop the trial if
  it is one. It also records two **attributed** fields that never fail the check
  by themselves: `liveActivity` (the live `activity_events` row count and newest
  row, read-only) and `liveRefs` (the live repository's heads, remotes, tags and
  `refs/codex/*` by name and target; the live workspace's registered Arcadia
  repository, or `--live-repo <path>`). Other agents and the operator move both
  constantly, so `data.attributed` and the human output list each change for
  you to attribute: a new row whose command you ran uninlined, or a ref your
  session created, is your leak. A snapshot that could not read the live database (for example a
  sandboxed read-only open) exits with `LEAK_CHECK_UNVERIFIABLE` and never
  passes: rerun it where the database is readable.
- **Measure contention** from `activity_events.error_code` (`SQLITE_BUSY*`,
  `QUEUE_REVISION_CONFLICT`, `STALE_PREVIEW_FINGERPRINT`, `DIRTY_CHECKOUT`, or
  the CLI code): `sqlite3 'file:<exp>/database/arcadia.sqlite3?mode=ro&immutable=1'
  "SELECT command, error_code, COUNT(*) FROM activity_events WHERE outcome =
  'error' GROUP BY 1, 2 ORDER BY 3 DESC"`. A plain `mode=ro` (or `-readonly`)
  open fails with error 14 on a fresh experiment database that has no `-shm`
  file yet; `immutable=1` reads it without creating one. `immutable=1` skips
  locking and the WAL, so use it only on a quiescent experiment database, never
  to read the live one (`workspace leak-check` reads it read-only and records
  nothing).
- **Rollback** only when the operator says so: confirm a clean leak check and that
  no launch agent, user config or trust entry names the workspace, then remove
  its directory.

## Fixture standing launch (Decision 0100)

Only once Decision 0100 is answered. `arcadia session launch --fixture-standing
--agent-identity <name> --preview-fingerprint <hash> ...` mints Decision 0096's
one-shot authorization without the terminal confirmation. It refuses with a named
code (nothing launched, nothing minted) unless all hold:

- Decision 0100 is answered "Standing fixture launch, with merge on green" or
  "Standing fixture launch, you merge" on `main` of github.com/pmark/arcadia
  itself, fetched with `gh api` (hardcoded host, repository and path). `gh` runs
  from an absolute, realpath-resolved system path (`/opt/homebrew/bin`,
  `/usr/local/bin` or `/usr/bin`; never PATH; refused under the home or a temp
  directory or if group/world-writable) with the passwd-entry HOME and
  `GH_CONFIG_DIR`, a fixed PATH and no token variables, so it uses the
  operator's stored `gh` login. The returned `sha` must equal the git blob hash
  of the returned content and is recorded. The Decision is verified at launch
  only: a later revert of the answer does not revoke an already-minted 24-hour
  authorization (the exit re-checks the window and remotes). No local ref,
  working tree, workspace database or user config is consulted, and any
  fetch/parse failure refuses (`fixture_standing_decision_unanswered`,
  `fixture_standing_decision_unverifiable`);
- today (UTC) is on or before 2026-10-18 (`fixture_standing_expired`);
- every Git remote's effective fetch and push target is in
  `FIXTURE_REMOTE_ALLOWLIST` (`src/sessions/fixtureStandingLaunch.ts`, today
  `pmark/arcadia-three-action-rehearsal-20261004`) and no `url.*.insteadOf` or
  `pushInsteadOf` rewrite exists in any config scope; or the workspace is an
  experiment workspace, the repository is inside its allowed root and has no
  remote or only allowlisted ones. Arcadia's own repository and any other Project
  are refused (`fixture_standing_not_a_fixture`);
- `--agent-identity` is given (`fixture_standing_agent_identity_required`) and the
  shell is not inside an Arcadia Session (`operator_launch_inside_session`).

The exit re-checks the window and the remotes before the push and again before
the pull request, and pins every `gh` call to the fixture with `--repo`; a mint's
24-hour TTL can outlive 2026-10-18, and a refused exit pushes and opens nothing
(the receipt says why).

The mint records `source: fixture_standing`, the Decision id and answer, the
agent and the fixture basis in the `authorization_minted` event and, at exit, in
the receipt. Exit authority is unchanged: validate, commit, push, one draft PR on
accepted completion, never a merge. Merging a fixture PR on green is a separate
authority: it needs the answer "with merge on green" plus an independent review
of the head finding nothing blocking and every check passing. Raising the
flag does not extend the expiry; a later date needs a new Decision.

## Claude Code specifics

- `@AGENTS.md` above is a Claude Code import. Codex ignores it and reads
  `AGENTS.md` directly, which is why the shared rules live there rather than
  here. Do not move shared rules into this file — Codex would never see them.
- Prefer the dedicated file and search tools over shell equivalents, and run
  independent tool calls in one batch.
- In the sandboxed shell, `gh` (TLS/keychain) and `git push` (credential
  store) fail. Run them unsandboxed on the first attempt rather than
  re-diagnosing; a sandboxed `$TMPDIR` also differs from the unsandboxed one,
  so pass scratch files by absolute path.
- AGENTS.md's session-naming rule applies here through the
  `set_session_title` tool (Claude Code Remote's session-title MCP call):
  call it with the brief broker's `data.sessionTitles.working` instead of
  leaving the default "Arcadia Go" title, and again with the matching
  `sessionTitles` entry whenever the session's state changes.
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
  changes the author. Add `--role critic` when this session is posting
  adversarial feedback rather than building — a code review finding or a plan
  critique/refinement — and sign the posted comment (a GitHub PR review
  reply) with the resolved `signature`; leave `--role` off (it defaults to
  `builder`) for ordinary commits, including a commit that fixes a finding
  someone else raised.
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

