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
resolves against instead of being re-decided per Action.

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

### Automatic production conflict recovery

Production-managed work must not stop merely because its pull request becomes
behind, `DIRTY`, blocked, or red. After every push, and before every production
handoff, inspect the pull request's merge state, required checks, review state,
and branch protection requirements. Anything within the candidate's authority
that prevents merging — including conflicts, build failures, test failures,
lint failures, CodeRabbit findings, stale generated artifacts, or failed
required checks — is part of the work and must be resolved before handoff. The
agent must automatically:

1. fetch the current base branch;
2. merge that base into the candidate branch, preserving both the candidate
   change and the newer base change;
3. resolve textual conflicts deterministically, then run the affected tests,
   lint, `git diff --check`, and the repository's required build/check commands;
4. commit the reconciliation on the candidate branch and push it; and
5. rerun the complete CodeRabbit loop and required checks against the new head
   before handoff, repeating the repair/push/review cycle until the PR is
   mergeable or the three-round CodeRabbit repair cap is reached. If required
   checks remain red at that cap, stop the automatic cycle and report the exact
   unresolved checks and recovery attempted as a concrete blocker.

Do not leave a PR in a conflicted, failing, or otherwise non-mergeable state
with a narrative status report or ask the operator to perform these routine
steps. If a failure is genuinely outside the candidate's authority — for
example, unavailable credentials, a required external service, a product
decision, or an approval gate — preserve the candidate, record the exact
failure and the smallest draft ask, and report that concrete blocker. This rule
never authorizes merging the PR, bypassing branch protection, weakening tests,
falsifying checks, or crossing any approval gate; automatic recovery ends with
a clean, reviewed, mergeable PR ready for the operator's normal merge decision.

## Claude Code specifics

- `@AGENTS.md` above is a Claude Code import. Codex ignores it and reads
  `AGENTS.md` directly, which is why the shared rules live there rather than
  here. Do not move shared rules into this file — Codex would never see them.
- Prefer the dedicated file and search tools over shell equivalents, and run
  independent tool calls in one batch.
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

