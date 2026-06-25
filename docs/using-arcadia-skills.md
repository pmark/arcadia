# Using Arcadia Codex Skills

These examples show how to use the local Codex skills for real Arcadia work. The skills are personal Codex configuration stored under `/Users/pmark/.codex/skills/`, not repository source.

## Skills

- `arcadia-dogfood-workflow`: use only when explicitly managing the repo-local `.arcadia-workspace/` compatibility workflow.
- `arcadia-workspace-operator`: use when inspecting or operating any Arcadia workspace.
- `arcadia-development-loop`: use when explicitly asked to change Arcadia code while keeping the work tracked through an Arcadia workspace.

Codex should still prefer deterministic Arcadia CLI commands over inference.

## Daily Arcadia Workspace Startup

Use this when starting an Arcadia work session.

Prompt:

```text
Use the arcadia-workspace-operator skill. Initialize or refresh `.arcadia-workspace` with the Arcadia profile, then tell me the current milestone, next action, responsibility, required artifacts, open queues, and any Requires Review Decisions.
```

Expected commands:

```sh
pnpm arcadia init .arcadia-workspace --profile arcadia
pnpm arcadia status --workspace .arcadia-workspace --json
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia queue --workspace .arcadia-workspace --json
```

Good output should answer:

- Current milestone
- Next action
- Responsibility
- Required artifacts
- Requires Review count and items
- Whether `.arcadia-workspace/` is still Git-ignored

## Create A New Arcadia Development Action

Use this when you have an idea but do not want Codex to implement it immediately.

Prompt:

```text
Use the arcadia-workspace-operator skill. In `.arcadia-workspace`, create an ask for: Add a command that lists stale projects with no open next action. Do not implement yet. Report the Action, plan, artifacts, and whether it requires review.
```

Expected command:

```sh
pnpm arcadia ask --workspace .arcadia-workspace "Add a command that lists stale projects with no open next action." --json
```

Good output should include:

- Ask id
- Action id
- Plan id
- Queue
- Responsibility
- Prompt packet or artifact paths
- Requires Review status

## Implement An Arcadia Feature

Use this when Codex should both track and implement the work.

Prompt:

```text
Use the arcadia-development-loop skill. Track this through `.arcadia-workspace` and then implement it: Add `arcadia project stale --workspace <path>` to list active projects that have no open next action. Keep the change small and add tests.
```

Expected commands:

```sh
pnpm arcadia init .arcadia-workspace --profile arcadia
pnpm arcadia ask --workspace .arcadia-workspace "Add arcadia project stale --workspace <path> to list active projects that have no open next action." --json
git status --short
pnpm test
pnpm build
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia queue --workspace .arcadia-workspace --json
```

Good final report should include:

- Commands added or changed
- Files modified
- Tests performed and results
- Current milestone
- Next action
- Responsibility
- Required artifacts

## Get Workspace Status

Use this for any Arcadia workspace, not just `.arcadia-workspace`.

Prompt:

```text
Use the arcadia-workspace-operator skill. Inspect `/path/to/workspace` and summarize project outcomes, current milestones, next actions, queued Actions, artifacts, mission logs, and Requires Review Decisions. Do not modify anything.
```

Expected commands:

```sh
pnpm arcadia status --workspace /path/to/workspace --json
pnpm arcadia project list --workspace /path/to/workspace --json
pnpm arcadia queue --workspace /path/to/workspace --json
pnpm arcadia run list --workspace /path/to/workspace --json
```

For Arcadia itself, point the same workflow at `.arcadia-workspace` or any other workspace initialized with `--profile arcadia`:

```text
Use the arcadia-workspace-operator skill. Inspect `.arcadia-workspace` and summarize project outcomes, current milestones, next actions, queued Actions, artifacts, mission logs, and Requires Review Decisions. Do not modify anything.
```

## Update A Project Outcome

Use this when the outcome changes but the project mission remains stable.

Prompt:

```text
Use the arcadia-workspace-operator skill. In `.arcadia-workspace`, update the Arcadia project outcome to: Manage Arcadia development through the same workspace model used for every other project. Then show the project detail.
```

Expected commands:

```sh
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia project update <project-id> --workspace .arcadia-workspace --outcome "Manage Arcadia development through the same workspace model used for every other project." --json
pnpm arcadia project show <project-id> --workspace .arcadia-workspace --json
```

Good output should confirm:

- Mission
- Outcome
- Status
- Current milestone
- Next action
- Required artifacts

## Review Requires Review Decisions

Use this when you want decisions, approvals, or blocked human review surfaced cleanly.

Prompt:

```text
Use the arcadia-workspace-operator skill. Show only Arcadia Decisions in `.arcadia-workspace` that require review. For each Decision, include the project, milestone, reason, next action, artifact path if any, and the exact command I can run next.
```

Expected commands:

```sh
pnpm arcadia queue --workspace .arcadia-workspace --json
pnpm arcadia run list --workspace .arcadia-workspace --json
```

User-facing output should say `Requires Review`, not `needs_mark`.

## Generate A Status Report Artifact

Use this when you want a Markdown status artifact written into the workspace.

Prompt:

```text
Use the arcadia-workspace-operator skill. Generate a deterministic status report for `.arcadia-workspace`, then summarize where it was written and the most important next action.
```

Expected command:

```sh
pnpm arcadia report status --workspace .arcadia-workspace --json
```

Expected artifact:

```text
.arcadia-workspace/reports/status.md
```

## Prepare A Weekly Review

Use this when reviewing recent work and deciding what to do next.

Prompt:

```text
Use the arcadia-workspace-operator skill. Create a weekly review for `.arcadia-workspace` for this week. Summarize completed Actions, mission logs, blocked Actions, Requires Review Decisions, and the top three next actions.
```

Expected command:

```sh
pnpm arcadia review weekly --workspace .arcadia-workspace --json
```

Good output should separate:

- Completed Actions
- Mission logs
- Blocked Actions
- Requires Review
- Suggested next actions

## Turn A Vague Idea Into A Better Ask

Use this when the idea needs sharpening before implementation.

Prompt:

```text
Use the arcadia-workspace-operator skill. I have a vague idea: Arcadia should be better at telling me what to do next. Convert that into one concrete ask in `.arcadia-workspace`, issue it, and report the resulting Action and expected artifact. Do not implement.
```

Expected behavior:

1. Rewrite the vague idea into a concrete request.
2. Run `pnpm arcadia ask --workspace .arcadia-workspace "<concrete request>" --json`.
3. Report the ask id, Action id, plan id, next action, and required artifact.

## Continue Existing Arcadia Work

Use this when returning after context loss or a break.

Prompt:

```text
Use the arcadia-development-loop skill. Continue the highest-value Arcadia work already represented in `.arcadia-workspace`. Inspect status and queues first, pick the next action, tell me what you selected and why, then implement only that scoped task.
```

Expected commands:

```sh
pnpm arcadia init .arcadia-workspace --profile arcadia
pnpm arcadia status --workspace .arcadia-workspace --json
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia queue --workspace .arcadia-workspace --json
git status --short
```

Codex should explain the selected task before editing files.

## Audit The Repo-Local Compatibility Workspace

Use this only to verify the repo-local compatibility shortcuts.

Prompt:

```text
Use the arcadia-dogfood-workflow skill. Audit whether the `.arcadia-workspace/` compatibility workflow is set up correctly. Verify `.arcadia-workspace/` is ignored, the Arcadia project is Active, the mission and outcome are present, there is an active milestone, there is an open next action, and the compatibility ask shortcut works without Discord, iCloud, servers, or external services.
```

Expected commands:

```sh
git check-ignore -v .arcadia-workspace/
pnpm arcadia dogfood init --json
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia dogfood ask "Create a small audit Action to verify dogfood ask routing." --json
```

Good output should classify every requirement as:

- Proven
- Missing
- Incomplete
- Not checked

## Fast Phrases

Use these as shorthand prompts:

```text
Use arcadia-workspace-operator. Start my Arcadia day in .arcadia-workspace.
```

```text
Use arcadia-workspace-operator. Create an ask in .arcadia-workspace for: <request>. Do not implement.
```

```text
Use arcadia-development-loop. Track and implement: <request>.
```

```text
Use arcadia-workspace-operator. Show status for <workspace>. Do not modify anything.
```

```text
Use arcadia-workspace-operator. Update the outcome for <project> in <workspace> to: <outcome>.
```

```text
Use arcadia-workspace-operator. Show Requires Review Decisions in <workspace> only.
```

## What To Expect From Codex

A good Codex response should be command-grounded. It should not guess workspace state when the CLI can inspect it.

For Arcadia work, expect every substantial response to identify:

- Current milestone
- Next action
- Responsibility
- Required artifacts

For implementation work, expect:

- Workspace ask created or referenced
- Files changed
- Tests run
- Remaining Requires Review Decisions or blockers
