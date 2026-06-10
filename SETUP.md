# SETUP.md

# Arcadia Setup

This document describes the intended setup path for getting Arcadia running locally.

Arcadia is split into two parts:

1. **Arcadia Core**  
   The open source engine, CLI, schemas, templates, and workflows.

2. **Arcadia Workspace**  
   A private local workspace containing your projects, mission logs, artifacts, custom skills, prompts, and operational database.

The goal is to keep Arcadia Core reusable while allowing each person to run their own private operating system for creative and technical work.

## Requirements

Arcadia is intended to run locally.

Recommended tools:

- Node.js 20 or newer
- pnpm
- Git
- SQLite
- A terminal
- Optional: Codex or another coding agent
- Optional: a local AI model runtime

## Install Arcadia

Once Arcadia is published as a package, the preferred setup command should be:

`pnpx create-arcadia@latest`

This should guide you through creating a new workspace.

Expected prompts:

1. Workspace name
2. Workspace location
3. Whether to initialize Git
4. Whether to create a starter SQLite database
5. Whether to create sample projects
6. Whether to install example skills
7. Whether to generate initial status reports

Example:

`pnpx create-arcadia@latest ~/ArcadiaWorkspace`

## Development Setup

Until the package exists, clone the repository manually:

`git clone https://github.com/your-username/arcadia-core.git`

`cd arcadia-core`

Install dependencies:

`pnpm install`

Run tests:

`pnpm test`

Run the CLI locally:

`pnpm arcadia --help`

Run the Phase 0 smoke test:

`pnpm smoke`

## Create a Workspace

A workspace is where your actual operating state lives.

Example:

`pnpm arcadia init ~/ArcadiaWorkspace`

This should create:

- `projects/`
- `mission_logs/`
- `artifacts/`
- `skills/`
- `prompts/`
- `config/`
- `database/`
- `reports/`
- `inbox/`

Arcadia Core should remain generic.

Your workspace can contain private information.

## Initialize the Database

Arcadia uses SQLite as the operational source of truth.

In Phase 0, database initialization is folded into workspace initialization:

`pnpm arcadia init ~/ArcadiaWorkspace`

This should create:

`~/ArcadiaWorkspace/database/arcadia.sqlite3`

The database should track:

- Projects
- Milestones
- Work items
- Mission logs
- Artifacts
- Queues
- Work classifications

There is no separate `db init` command in Phase 0.

## Verify Installation

Run:

`pnpm arcadia status --workspace ~/ArcadiaWorkspace`

A fresh workspace should show:

- No active projects
- Empty Inbox
- Empty Work Queue
- Empty Needs Mark queue
- Empty Blocked queue
- No mission logs yet
- No artifacts scheduled yet

## Create Your First Project

Example:

`pnpm arcadia project create --workspace ~/ArcadiaWorkspace`

The command should ask:

1. Project name
2. Mission
3. Initial status
4. Current milestone
5. Next action
6. Expected artifact
7. Work classification

A project should always answer:

- Why does this project exist?
- What is the current status?
- What milestone is active?
- What is the next concrete action?
- What artifact should be produced?
- What requires human input?

## Add Work to the Inbox

Example:

`pnpm arcadia inbox add --workspace ~/ArcadiaWorkspace`

Script-friendly example:

`pnpm arcadia inbox import --workspace ~/ArcadiaWorkspace --title "Run local check" --input "Run local check" --queue work_queue --classification autonomous --next-action "Run the script" --json`

Phase 2 intent capture example:

`pnpm arcadia capture --workspace ~/ArcadiaWorkspace --text "Generate status report" --json`

The command should accept raw input such as:

- A project idea
- A feature request
- A note
- A possible artifact
- A task
- A decision
- A question

Arcadia should classify the input into one of:

- Inbox
- Work Queue
- Needs Mark
- Blocked

And one work class:

- Autonomous
- Codex
- Needs Mark
- Blocked

## Execute Safe Work

Use the Phase 2 execution loop for one work item at a time:

`pnpm arcadia work plan --workspace ~/ArcadiaWorkspace <work-id> --json`

`pnpm arcadia work run --workspace ~/ArcadiaWorkspace <work-id> --plan <plan-id> --json`

`pnpm arcadia run show --workspace ~/ArcadiaWorkspace <run-id> --json`

Arcadia runs deterministic safe steps automatically. Anything requiring Mark, Codex, publication approval, destructive changes, or missing information pauses as Needs Mark.

For copy-paste examples of common actions, see `docs/COMMANDS.md`.

## Update Work

List work:

`pnpm arcadia work list --workspace ~/ArcadiaWorkspace`

Move or edit work:

`pnpm arcadia work update --workspace ~/ArcadiaWorkspace <work-id> --queue work_queue --classification codex --next-action "Implement the next slice" --status in_progress --json`

Complete work:

`pnpm arcadia work done --workspace ~/ArcadiaWorkspace <work-id> --json`

## Update Project, Milestone, and Artifact State

Update a project status:

`pnpm arcadia project update --workspace ~/ArcadiaWorkspace <project-id> --status paused --json`

Create and complete milestones:

`pnpm arcadia milestone create --workspace ~/ArcadiaWorkspace <project-id> --title "Next milestone" --json`

`pnpm arcadia milestone complete --workspace ~/ArcadiaWorkspace <milestone-id> --json`

List and update artifacts:

`pnpm arcadia artifact list --workspace ~/ArcadiaWorkspace --json`

`pnpm arcadia artifact update --workspace ~/ArcadiaWorkspace <artifact-id> --status ready --path artifacts/output.md --json`

## Generate a Status Report

Run:

`pnpm arcadia report status --workspace ~/ArcadiaWorkspace`

This should generate a Markdown report showing:

- Active projects
- Current milestones
- Next actions
- Work items grouped by queue
- Work items grouped by classification
- Blocked work
- Recently completed work
- Recent mission logs
- Artifacts grouped by status
- Projects with no open next action

Expected output location:

`~/ArcadiaWorkspace/reports/status.md`

## Generate a Weekly Review

Run:

`pnpm arcadia review weekly --workspace ~/ArcadiaWorkspace`

Arcadia uses the last seven calendar days by default and writes:

`~/ArcadiaWorkspace/reports/weekly/YYYY-MM-DD.md`

Use an explicit inclusive date window when a script or review ritual needs a stable range:

`pnpm arcadia review weekly --workspace ~/ArcadiaWorkspace --since 2026-06-03 --until 2026-06-09 --json`

The weekly review is generated from SQLite only. It includes completed work, mission logs created during the window, blocked work, Needs Mark items, active Codex/autonomous work, artifact changes or upcoming artifacts, projects without open next actions, and deterministic suggested next actions.

## Generate a Mission Log

Mission logs record meaningful progress.

Example:

`pnpm arcadia log create --workspace ~/ArcadiaWorkspace`

A mission log should include:

- Date
- Project
- Milestone
- Work performed
- Result
- Blockers
- Next action
- Artifact impact

Expected output location:

`~/ArcadiaWorkspace/mission_logs/YYYY/MM/YYYY-MM-DD-project-name.md`

## Generate an Artifact Draft

Artifacts are outputs that demonstrate progress.

Example:

`pnpm arcadia artifact draft --workspace ~/ArcadiaWorkspace`

Possible artifact types:

- Weekly update
- Project report
- Blog draft
- Implementation summary
- Experiment result
- Release notes
- Demo notes

Expected output location:

`~/ArcadiaWorkspace/artifacts/drafts/`

## Codex Workflow

Arcadia should only send work to Codex when implementation is required.

Good Codex work:

- Add a CLI command
- Modify a repository
- Write tests
- Implement a feature
- Refactor code
- Fix a bug

Bad Codex work:

- Brainstorming
- Personal decisions
- Taste-based choices
- Credentialed work
- Publishing without approval

Expected command:

`pnpm arcadia codex dispatch --workspace ~/ArcadiaWorkspace`

This should gather Codex-ready work items and produce implementation requests.

Arcadia should not assume Codex has completed work until results are recorded.

## Spec Kit Workflow

Arcadia uses lightweight Spec Kit style workflows only for implementation-ready features.

Lean path:

1. Specify
2. Plan
3. Tasks
4. Implement

Careful path:

1. Specify
2. Clarify
3. Plan
4. Tasks
5. Analyze
6. Implement

Create a new feature spec:

`pnpm arcadia spec create --workspace ~/ArcadiaWorkspace`

A feature spec should be created only when there is a concrete implementation target.

Good examples:

- Add the Needs Mark queue
- Add SQLite persistence
- Generate weekly mission summaries
- Add project status reporting

Bad examples:

- Think about Arcadia
- Brainstorm possible future systems
- Capture a vague idea
- Write a personal reminder

## Local AI Integration

Local AI is optional.

The first version of Arcadia should work without local AI.

Eventually, local models may help with:

- Classifying inbox items
- Summarizing mission logs
- Suggesting work classifications
- Drafting status summaries
- Reducing token usage before using frontier models

Arcadia should remain usable even if no local model is installed.

## Environment Configuration

Workspace-specific configuration should live in:

`~/ArcadiaWorkspace/config/`

Secrets should never be committed.

Phase 0 writes:

- `config/arcadia.json`

Future versions may add model, agent, and environment configuration files. Secrets should never be committed.

If environment files are introduced later, a safe example should be committed as `.env.example`.

## Git Setup

Arcadia Core should be a public repository.

Arcadia Workspace may be private.

Recommended workspace Git behavior:

- Commit project metadata
- Commit mission logs if desired
- Commit artifact drafts if desired
- Do not commit secrets
- Do not commit private credentials
- Do not commit local model files
- Do not commit generated database files unless intentionally desired

## Phase 0 Success Criteria

Arcadia is considered bootstrapped when it can:

1. Initialize a workspace.
2. Create a project.
3. Track a milestone.
4. Record a next action.
5. Classify work.
6. Surface Needs Mark items.
7. Identify Codex-ready work.
8. Generate a mission log.
9. Generate a Markdown status report.
10. Accept a new project request and turn it into actionable work.

## First Real Test

After setup, create one real project.

Example:

`pnpm arcadia project create --workspace ~/ArcadiaWorkspace`

Then run:

`pnpm arcadia status --workspace ~/ArcadiaWorkspace`

Then add one work item:

`pnpm arcadia inbox add --workspace ~/ArcadiaWorkspace`

Then generate a report:

`pnpm arcadia report status --workspace ~/ArcadiaWorkspace`

If Arcadia can show the project, milestone, next action, queue placement, and required human input, the system is working.

## What Not To Build First

Do not build these during bootstrap:

- Web dashboard
- Background daemon
- Multi-user support
- Cloud sync
- Plugin marketplace
- Complex scheduling
- Advanced analytics
- Full agent orchestration
- Mobile app
- Authentication

Those may become useful later.

They are not required for Arcadia to become useful.

## The Bootstrap Goal

The first working version of Arcadia should make it possible to say:

“I have an idea. Turn it into a project, identify the next action, route the work, and tell me what needs my input.”

That is enough for Phase 0.
