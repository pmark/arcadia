# Using Arcadia Codex Skills

These examples show how to use the local Codex skills for real Arcadia work. The skills are personal Codex configuration stored under `/Users/pmark/.codex/skills/`, not repository source.

## Skills

- `arcadia-dogfood-workflow`: use when managing Arcadia development through `.arcadia-workspace/`.
- `arcadia-workspace-operator`: use when inspecting or operating any Arcadia workspace.
- `arcadia-development-loop`: use when changing Arcadia code while keeping the work tracked through dogfooding.

Codex should still prefer deterministic Arcadia CLI commands over inference.

## Daily Dogfood Startup

Use this when starting an Arcadia work session.

Prompt:

```text
Use the arcadia-dogfood-workflow skill. Initialize or refresh the dogfood workspace, then tell me the current milestone, next action, work classification, required artifacts, open queues, and any Requires Review items.
```

Expected commands:

```sh
pnpm arcadia dogfood init
pnpm arcadia status --workspace .arcadia-workspace --json
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia queue --workspace .arcadia-workspace --json
```

Good output should answer:

- Current milestone
- Next action
- Work classification
- Required artifacts
- Requires Review count and items
- Whether `.arcadia-workspace/` is still Git-ignored

## Create A New Arcadia Development Work Item

Use this when you have an idea but do not want Codex to implement it immediately.

Prompt:

```text
Use the arcadia-dogfood-workflow skill. Create a dogfood ask for: Add a command that lists stale projects with no open next action. Do not implement yet. Report the work item, plan, artifacts, and whether it requires review.
```

Expected command:

```sh
pnpm arcadia dogfood ask "Add a command that lists stale projects with no open next action." --json
```

Good output should include:

- Ask id
- Work item id
- Plan id
- Queue
- Work classification
- Prompt packet or artifact paths
- Requires Review status

## Implement An Arcadia Feature

Use this when Codex should both track and implement the work.

Prompt:

```text
Use the arcadia-development-loop skill. Track this through dogfooding and then implement it: Add `arcadia project stale --workspace <path>` to list active projects that have no open next action. Keep the change small and add tests.
```

Expected commands:

```sh
pnpm arcadia dogfood init
pnpm arcadia dogfood ask "Add arcadia project stale --workspace <path> to list active projects that have no open next action." --json
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
- Work classification
- Required artifacts

## Get Workspace Status

Use this for any Arcadia workspace, not just the dogfood workspace.

Prompt:

```text
Use the arcadia-workspace-operator skill. Inspect `/path/to/workspace` and summarize project goals, current milestones, next actions, queued work, artifacts, mission logs, and Requires Review items. Do not modify anything.
```

Expected commands:

```sh
pnpm arcadia status --workspace /path/to/workspace --json
pnpm arcadia project list --workspace /path/to/workspace --json
pnpm arcadia queue --workspace /path/to/workspace --json
pnpm arcadia run list --workspace /path/to/workspace --json
```

Use this exact dogfood variant for Arcadia itself:

```text
Use the arcadia-workspace-operator skill. Inspect the Arcadia dogfood workspace and summarize project goals, current milestones, next actions, queued work, artifacts, mission logs, and Requires Review items. Do not modify anything.
```

## Update A Project Goal

Use this when the outcome changes but the project mission remains stable.

Prompt:

```text
Use the arcadia-workspace-operator skill. In the Arcadia dogfood workspace, update the Arcadia project goal to: Use Arcadia every day for planning and reviewing Arcadia development until the dogfood loop is boringly reliable. Then show the project detail.
```

Expected commands:

```sh
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia project update <project-id> --workspace .arcadia-workspace --goal "Use Arcadia every day for planning and reviewing Arcadia development until the dogfood loop is boringly reliable." --json
pnpm arcadia project show <project-id> --workspace .arcadia-workspace --json
```

Good output should confirm:

- Mission
- Goal
- Status
- Current milestone
- Next action
- Required artifacts

## Review Requires Review Items

Use this when you want decisions, approvals, or blocked human review surfaced cleanly.

Prompt:

```text
Use the arcadia-dogfood-workflow skill. Show only Arcadia dogfood items that require review. For each item, include the project, milestone, reason, next action, artifact path if any, and the exact command I can run next.
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
Use the arcadia-workspace-operator skill. Generate a deterministic status report for the Arcadia dogfood workspace, then summarize where it was written and the most important next action.
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
Use the arcadia-workspace-operator skill. Create a weekly review for the Arcadia dogfood workspace for this week. Summarize completed work, mission logs, blocked work, Requires Review items, and the top three next actions.
```

Expected command:

```sh
pnpm arcadia review weekly --workspace .arcadia-workspace --json
```

Good output should separate:

- Completed work
- Mission logs
- Blocked work
- Requires Review
- Suggested next actions

## Turn A Vague Idea Into A Better Ask

Use this when the idea needs sharpening before implementation.

Prompt:

```text
Use the arcadia-dogfood-workflow skill. I have a vague idea: Arcadia should be better at telling me what to do next. Convert that into one concrete dogfood ask, issue it, and report the resulting work item and expected artifact. Do not implement.
```

Expected behavior:

1. Rewrite the vague idea into a concrete request.
2. Run `pnpm arcadia dogfood ask "<concrete request>" --json`.
3. Report the ask id, work item id, plan id, next action, and required artifact.

## Continue Existing Arcadia Work

Use this when returning after context loss or a break.

Prompt:

```text
Use the arcadia-development-loop skill. Continue the highest-value Arcadia work already represented in the dogfood workspace. Inspect status and queues first, pick the next action, tell me what you selected and why, then implement only that scoped task.
```

Expected commands:

```sh
pnpm arcadia dogfood init
pnpm arcadia status --workspace .arcadia-workspace --json
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia queue --workspace .arcadia-workspace --json
git status --short
```

Codex should explain the selected task before editing files.

## Audit The Dogfood Workspace

Use this to verify the dogfooding setup itself.

Prompt:

```text
Use the arcadia-dogfood-workflow skill. Audit whether Arcadia dogfooding is set up correctly. Verify `.arcadia-workspace/` is ignored, the Arcadia project is Active, the mission and goal are present, there is an active milestone, there is an open next action, and dogfood ask works without Discord, iCloud, servers, or external services.
```

Expected commands:

```sh
git check-ignore -v .arcadia-workspace/
pnpm arcadia dogfood init --json
pnpm arcadia project list --workspace .arcadia-workspace --json
pnpm arcadia dogfood ask "Create a small audit work item to verify dogfood ask routing." --json
```

Good output should classify every requirement as:

- Proven
- Missing
- Incomplete
- Not checked

## Fast Phrases

Use these as shorthand prompts:

```text
Use arcadia-dogfood-workflow. Start my Arcadia day.
```

```text
Use arcadia-dogfood-workflow. Create a dogfood ask for: <request>. Do not implement.
```

```text
Use arcadia-development-loop. Track and implement: <request>.
```

```text
Use arcadia-workspace-operator. Show status for <workspace>. Do not modify anything.
```

```text
Use arcadia-workspace-operator. Update the goal for <project> in <workspace> to: <goal>.
```

```text
Use arcadia-dogfood-workflow. Show Requires Review items only.
```

## What To Expect From Codex

A good Codex response should be command-grounded. It should not guess workspace state when the CLI can inspect it.

For Arcadia work, expect every substantial response to identify:

- Current milestone
- Next action
- Work classification
- Required artifacts

For implementation work, expect:

- Dogfood ask created or referenced
- Files changed
- Tests run
- Remaining Requires Review items or blockers

