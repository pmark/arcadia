# Install Arcadia and Recover a Stalled Project

> This document is addressed to the coding agent doing the installation. The
> operator should be able to give you this file and the path to an existing
> project, then let you perform the technical setup.

## Your assignment

Install Arcadia on the operator's machine, create its private local workspace,
connect one existing project repository, and leave that repository with an
evidence-based path from its current state to a defined release.

Do not stop at "Arcadia runs." The first useful outcome is that the operator can
ask what remains and receive one honest answer grounded in checked-in project
documents.

## Why Arcadia exists

AI makes it unusually easy to start building and unusually easy to lose the
thread. A person can produce a large amount of code, plans, chat transcripts,
mockups, and partially working features without gaining a trustworthy answer to
four basic questions:

1. What works now?
2. What is the intended release?
3. What remains between the two?
4. What is the one next Action, and who can perform it?

That is the problem Arcadia is built to solve. It is a local-first execution
system for ongoing creative and software Projects. It gives coding agents a
durable control layer: a Mission, Outcome, Milestone, ordered Actions,
acceptance criteria, Decisions, Artifacts, and a Log. The authoritative plan
lives in the project repository, where the operator and every future agent can
read it. Private operational state lives in a separate local Arcadia workspace.

Arcadia is not valuable because it can generate more work. It is valuable when
it makes existing work legible, identifies missing proof, refuses to hide
uncertainty, and turns a vague continuation request into one dispatchable
Action.

## Who Arcadia is for

Arcadia is for a person who:

- builds with Codex, Claude Code, Claude Cowork, or another coding agent;
- has one or more Git repositories containing real but incompletely delivered
  work;
- no longer trusts chat history, a task list, or memory to describe the current
  state;
- needs an agent to audit what exists, define an observable release, and
  preserve the path between them; or
- juggles enough Projects that choosing and resuming work has become its own
  recurring job.

The operator does not need to understand Node.js, pnpm, SQLite, or Arcadia's
internal architecture. You do. Handle those details and report only decisions
that require human judgment.

Arcadia is not currently a hosted service or a polished one-click desktop
application. The supported path in this repository is a source installation
driven from a terminal by a technically capable coding agent. The CLI and its
SQLite database are enough for the first useful outcome; the Dashboard,
Discord adapter, Obsidian projection, background worker, and Intelligence
routes are optional and should not be installed during this first pass.

## What success looks like

At the end of this procedure:

- the Arcadia CLI builds and runs from a local clone;
- the operator has one private workspace outside the Arcadia source tree;
- the target repository is registered in that workspace;
- the target repository contains Arcadia's agent policy and governed control
  documents;
- the repository audit distinguishes observed facts, inferences, missing proof,
  and open questions;
- "release" has observable acceptance criteria;
- every unfinished Action is ordered by real dependencies, not by a hopeful
  checklist;
- exactly one current Action is either dispatchable or blocked by one precise
  operator question; and
- `arcadia docket` and `arcadia next` agree about that state.

## Safety before installation

1. Confirm the machine is macOS or Linux with Git and a POSIX-compatible shell.
   This is the verified installation path. Do not imply native Windows support
   without separately proving it.
2. Confirm the operator has authorized local installation and changes to the
   target repository.
3. Inspect the target repository's status before writing. Preserve existing
   changes. Do not overwrite another session's work or begin edits on a shared
   `main` branch.
4. Do not copy the operator's private Arcadia workspace into the open source
   Arcadia repository or into the target project repository.
5. Installation does not authorize deployment, publishing, merging, credential
   use, spending, deletion, production access, or outbound messages.

## Part 1: Install Arcadia Core

Arcadia pins its supported Node.js version in `mise.toml` and its pnpm version
in `package.json`. Do not substitute arbitrary global Node or pnpm versions.

### 1. Install `mise` if it is absent

First run:

```sh
mise --version
```

Arcadia requires `mise` 2026.8.6 or newer. If it is missing or older, install
or update it using the official [`mise` installation
instructions](https://mise.jdx.dev/getting-started). On macOS and Linux, the
official installer is:

```sh
curl https://mise.run | sh
```

If that installs `mise` outside the current `PATH`, use the path printed by the
installer, commonly `~/.local/bin/mise`, for the remaining commands. Do not
modify the operator's shell startup files unless asked.

### 2. Clone and build Arcadia

Choose durable paths appropriate for the machine. The following defaults are
examples; keep the source checkout and private workspace separate.

```sh
ARCADIA_SOURCE="$HOME/arcadia"
ARCADIA_WORKSPACE="$HOME/ArcadiaWorkspace"

git clone https://github.com/pmark/arcadia.git "$ARCADIA_SOURCE"
cd "$ARCADIA_SOURCE"
mise trust
mise install
mise exec -- corepack enable pnpm
mise exec -- pnpm install
mise exec -- pnpm build
mise exec -- pnpm arcadia --help
```

If the Arcadia repository already exists, do not clone over it. Inspect its
branch and working-copy state, update it only with the operator's authorization,
and run the remaining commands from that checkout.

The minimum installation is successful when the build exits zero and the last
command prints `Local-first project operating system CLI`. No external database
server is needed; Arcadia embeds SQLite.

### 3. Create the private workspace

Before changing user-level Arcadia configuration, check whether this machine
already has a configured workspace:

```sh
cd "$ARCADIA_SOURCE"
mise exec -- pnpm arcadia config get defaultWorkspace
```

If a real workspace is already configured, do not replace it. Ask the operator
whether to reuse it. On a clean installation, initialize and select the new
workspace:

```sh
mise exec -- pnpm arcadia init "$ARCADIA_WORKSPACE" --json
mise exec -- pnpm arcadia config set defaultWorkspace "$ARCADIA_WORKSPACE" --json
mise exec -- pnpm arcadia workspace resolve --json
mise exec -- pnpm arcadia status
```

Verify that `workspace resolve` reports the intended absolute path. The
workspace will contain the private SQLite database, configuration, generated
reports, and operational Artifacts. It is not the Arcadia source checkout and
should not be committed to Git.

## Part 2: Connect a stalled existing project

The example below is a video production pipeline assembled with Claude Cowork.
Adapt the quoted content to the actual Project, but preserve the shape: Mission,
Outcome, current Milestone, next Action, Responsibility, and expected Artifact.

Set the repository path and inspect it before Arcadia writes anything:

```sh
PROJECT_REPO="/absolute/path/to/video-production-pipeline"

git -C "$PROJECT_REPO" status --short --branch
```

If the directory is not a Git repository, stop and ask whether the operator
wants it placed under version control. Arcadia's durable governance model
depends on checked-in documents; do not silently initialize or publish a
repository.

### 1. Import an explicit audit Project

Run this from the Arcadia source checkout:

```sh
cd "$ARCADIA_SOURCE"
mise exec -- pnpm arcadia project import \
  --workspace "$ARCADIA_WORKSPACE" \
  --name "Video Production Pipeline" \
  --mission "Turn raw footage into finished videos through a repeatable production pipeline." \
  --outcome "A releasable pipeline with a documented path from its current state to version 1." \
  --milestone "Audit the current state and define the path to release." \
  --next-action "Audit the repository and replace this bootstrap Action with the smallest verified release milestone." \
  --responsibility codex \
  --status active \
  --expected-artifact "A checked-in current-state audit and governed release plan." \
  --json
```

Retain `data.project.id` from the JSON output and assign that exact value below;
do not substitute the name or slug where the command asks for an id.

```sh
PROJECT_ID="paste-data.project.id-here"
```

### 2. Link the repository and adopt the Arcadia context

```sh
mise exec -- pnpm arcadia project metadata "$PROJECT_ID" \
  --workspace "$ARCADIA_WORKSPACE" \
  --repo-path "$PROJECT_REPO" \
  --status-summary "Existing project awaiting release audit." \
  --json

mise exec -- pnpm arcadia project setup-context "$PROJECT_ID" \
  --workspace "$ARCADIA_WORKSPACE" \
  --json
```

`setup-context` should report the files it created. At minimum, expect
`CONSTITUTION.md`, `AGENTS.md`, `CLAUDE.md`, `.arcadia/` context policy files,
`PROJECT.md`, a bootstrap plan under `docs/plans/`, and the agent continuation
protocol. Existing unowned content must not be overwritten.

Now ask the repository—not chat history—what is current:

```sh
mise exec -- pnpm arcadia docket --repo "$PROJECT_REPO"
```

For the explicit import above, this should resolve the audit Action as
dispatchable. Any refusal is useful: it names the exact document and field that
must be repaired.

## Part 3: Perform the first release audit

Change into the target repository. Read its `AGENTS.md`, `CONSTITUTION.md`,
`.arcadia/AGENT_CONTEXT_POLICY.md`, `.arcadia/repo-context.md`, and
`.arcadia/context-policy.json` before broad exploration. Obey any pre-existing
repository instructions that are more specific.

The audit is evidence gathering, not a rewrite. Use the smallest set of reads
and deterministic commands that can establish the following:

### Intended release

Define version 1 in observable terms. Describe what a user can do, on which
surface, with which inputs and outputs. "Complete," "production ready," and
"finish the pipeline" are not acceptance criteria.

### Current state

Inventory what can be proved from the repository:

- entry points and runnable surfaces;
- implemented stages of the pipeline;
- build, test, lint, and validation commands;
- existing docs, plans, assets, and release configuration;
- known failures or missing dependencies;
- uncommitted or unmerged work; and
- the strongest Artifact that currently demonstrates real behavior.

Run safe deterministic checks when available. Record command, result, date, and
environment. Do not label code as working merely because files exist.

### Release gap

Compare the intended release with the proven current state. Turn each material
gap into one of these:

- an Action with an observable completion condition;
- a Decision when operator judgment is required;
- an external blocker with a concrete ask; or
- an explicit deferral with the condition that would reactivate it.

Order Actions using actual `depends_on` relationships. Find the vital few that
deliver most of the release value and sequence those first. Do not create a
large speculative backlog.

### Governed documents

Replace the bootstrap wording with project-specific truth. Update:

- `PROJECT.md` with the real Mission, Outcome, Milestone, `active_plan`, and
  `current_action`;
- the active plan under `docs/plans/` with clarified Actions, acceptance
  criteria, dependencies, Responsibility, expected Artifacts, Token Impact, and
  Token Budget;
- `docs/decisions/` for every question whose answer changes the plan; and
- `MISSION_LOG.md` with what was inspected, what the evidence showed, what
  remains uncertain, and what happens next.

Use Arcadia's canonical vocabulary: Domain, Project, Mission, Outcome,
Milestone, Action, Artifact, Decision, and Log. Preserve `Run` for a concrete
execution attempt.

The bootstrap plan is scaffolding, not evidence. It may be rewritten or
replaced after the audit, but the repository must finish with exactly one
active plan and exactly one current Action.

## Part 4: Validate and hand off

Validate the checked-in state before telling the operator the Project is under
control:

```sh
cd "$ARCADIA_SOURCE"

mise exec -- pnpm arcadia docket --repo "$PROJECT_REPO"
mise exec -- pnpm arcadia docs sync --workspace "$ARCADIA_WORKSPACE" --project "$PROJECT_ID"
mise exec -- pnpm arcadia docs sync --workspace "$ARCADIA_WORKSPACE" --project "$PROJECT_ID" --apply
mise exec -- pnpm arcadia next --workspace "$ARCADIA_WORKSPACE" --project "$PROJECT_ID"
```

The first `docs sync` is a dry run. Inspect it before using `--apply`. The final
`next` result must be one of:

1. one dispatchable Action with observable acceptance criteria;
2. one precise operator question; or
3. concrete blockers naming their file, field, and remedy.

Do not hand back a generic "needs more planning" conclusion. If the audit is
too large, divide it until the current Action is small enough for one working
session.

Commit the Arcadia context, audit, plan, Decisions, and Log on the target
repository's dedicated branch. Follow that repository's rules for pushing and
opening a pull request. Do not merge without explicit authority.

## Report to the operator

Keep the final report short. State:

- where Arcadia source was installed;
- where the private workspace lives;
- which project repository was connected;
- the current Milestone;
- the current Action and Responsibility;
- the strongest proof of present behavior;
- the largest release gap;
- any Decision the operator must make; and
- the exact command or link they use to resume.

The operator should not need to understand the installation to use the result.
They should be able to ask a coding agent to read the target repository and run
`arcadia docket`, then continue from the one governed Action.

## Troubleshooting the minimal path

### `mise: command not found`

Use the absolute `mise` path printed by its installer, commonly
`~/.local/bin/mise`, or open a new shell after installation. Do not edit shell
startup files without permission.

### The wrong Node or pnpm version runs

Run commands through `mise exec --` from the Arcadia source checkout. Re-run
`mise install` and `mise exec -- corepack enable pnpm`.

### `better-sqlite3` fails to load

From the Arcadia source checkout, run:

```sh
mise exec -- pnpm install
mise exec -- pnpm rebuild better-sqlite3
mise exec -- pnpm build
```

Do not install a separate SQLite server.

### Arcadia resolves the wrong workspace

```sh
mise exec -- pnpm arcadia workspace resolve --json
```

An explicit `--workspace` wins over the `ARCADIA_WORKSPACE` environment
variable and the configured `defaultWorkspace`. Do not overwrite a real
existing default merely to make one command pass.

### `project setup-context` cannot find the repository

Confirm that `project metadata "$PROJECT_ID" --repo-path <absolute-path>`
succeeded and that `PROJECT_ID` contains the exact id returned by `project
import`.

### `arcadia docket` refuses dispatch

Read the refusal literally. Repair the named control-document field. Do not
pick unrelated work or loosen the rule: an incomplete pointer, missing
acceptance criterion, unanswered Decision, or vague next Action is the work to
fix.

## After the first useful outcome

Only after the stalled project has a truthful release path should you consider
the optional Dashboard, Discord adapter, Obsidian projection, background
worker, or Intelligence service. Their setup is documented elsewhere in this
repository. Installing them first adds surface area without proving Arcadia's
core value.
