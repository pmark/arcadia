# Arcadia Command Guide

This guide shows the most common command paths for daily use.

All examples use:

```sh
WORKSPACE=./tmp/demo-workspace
```

## Initialize A Workspace

```sh
pnpm arcadia init "$WORKSPACE"
```

## Capture Intent

Use `capture` when you have natural-language intent and want Arcadia to structure it as an Action.

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --text "Generate status report" \
  --json
```

Safe known Actions are placed in `work_queue` as `autonomous`. Ambiguous Actions are placed in `requires_review`.

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --text "Improve Rebuster candidate review flow" \
  --json
```

## Ask Natural Language

Use `ask` when you want Arcadia to resolve a natural-language request through Phase 3 intent registries, create an audit record, create an Action, and create a workflow plan.

```sh
pnpm arcadia ask \
  --workspace "$WORKSPACE" \
  "Create a new blog site named MartianRover Field Notes." \
  --json
```

When a request needs Codex, Arcadia writes a prompt packet under `prompts/codex/<invocation-id>/` and records the invocation. It does not invoke Codex, deploy, publish, use credentials, or make unsafe changes by default.

## Codex Companion

Use `codex list` to observe current Codex Cloud tasks and local Codex goals, then show the Arcadia snapshot:

```sh
pnpm arcadia codex list \
  --workspace "$WORKSPACE" \
  --active-only \
  --json
```

Associate an observed Codex task with an Arcadia project:

```sh
pnpm arcadia codex associate ctask_example \
  --workspace "$WORKSPACE" \
  --project proj_example \
  --milestone ms_example \
  --json
```

You can pass either the Arcadia task id, such as `ctask_example`, or the Codex source id, such as a local thread id or cloud task id.

Refresh the snapshot without relying on the list command output:

```sh
pnpm arcadia codex sync \
  --workspace "$WORKSPACE" \
  --source all \
  --json
```

Arcadia only observes Codex state. Codex remains responsible for implementation work, task execution, and goal lifecycle. When an associated Codex task transitions to a successful terminal status, Arcadia writes a mission log and links it to the observed task.

## Arcadia Intelligence

Start the local Intelligence API and in-process worker:

```sh
pnpm arcadia intelligence serve \
  --workspace "$WORKSPACE" \
  --port 4710
```

Run one local Codex image-generation smoke job through the normal
Intelligence lifecycle:

```sh
ARCADIA_CODEX_IMAGE_ROUTE=codex-cli \
pnpm arcadia intelligence smoke-image \
  --workspace "$WORKSPACE" \
  --prompt "a simple black square centered on a white background" \
  --json
```

The smoke command returns the terminal job, artifact URIs, and the isolated
job workspace path under `.arcadia/intelligence/jobs/`.

Run deterministic safe steps immediately:

```sh
pnpm arcadia ask \
  --workspace "$WORKSPACE" \
  "Prepare a weekly Martian Rover Labs update from recent mission logs." \
  --run-safe \
  --json
```

## Process Local Ingress Files

Apple Shortcuts can create Arcadia requests by writing plain text files to the default local root:

```text
~/ArcadiaIngress/iCloudIdeas/In/YYYYMMDD-HHMMSS.txt
```

The file contents are treated as the natural-language request. To share the folder with iPhone and iPad, use the iCloud Drive root when processing pending files:

```sh
pnpm arcadia ingress process \
  --workspace "$WORKSPACE" \
  --source iCloudIdeas \
  --ingress-root "$HOME/Library/Mobile Documents/com~apple~CloudDocs/ArcadiaIngress"
```

Run deterministic safe steps for matching requests:

```sh
pnpm arcadia ingress process \
  --workspace "$WORKSPACE" \
  --source iCloudIdeas \
  --run-safe
```

Preview pending files without moving files or executing work:

```sh
pnpm arcadia ingress process \
  --workspace "$WORKSPACE" \
  --source iCloudIdeas \
  --dry-run
```

Arcadia processes `.txt` files oldest first. Successful and empty files move to `<ingress-root>/iCloudIdeas/Done/`; failed files move to `<ingress-root>/iCloudIdeas/Failed/`. Each moved file gets a readable JSON sidecar, and every non-empty processed request gets an ingress Log. Files placed in `Attachments/<request-basename>/` are recorded as ready Artifacts.

Watch mode is intentionally not implemented. For periodic processing, configure macOS `launchd` to run `arcadia ingress process` on an interval. See `docs/APPLE_INGEST.md` for the macOS Quick Action and iPhone/iPad Shortcut flow.

Attach captured work to project context when known:

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --project proj_example \
  --milestone ms_example \
  --text "Write specification for the next review flow" \
  --expected-artifact "Review flow specification" \
  --json
```

## Plan Work

```sh
pnpm arcadia work plan work_example \
  --workspace "$WORKSPACE" \
  --json
```

The plan records each step, executor type, command label, and whether the step is safe to run.

## Run Safe Work

Run the latest plan for an Action:

```sh
pnpm arcadia work run work_example \
  --workspace "$WORKSPACE" \
  --json
```

Run a specific plan:

```sh
pnpm arcadia work run work_example \
  --workspace "$WORKSPACE" \
  --plan plan_example \
  --json
```

Arcadia executes only deterministic safe steps. Codex, publishing, destructive, unclear, or review-required steps pause as `requires_review`.

Explicitly approved Codex steps can be run through configured coding-agent profiles:

```sh
pnpm arcadia work run work_example \
  --workspace "$WORKSPACE" \
  --plan plan_example \
  --allow-codex-planning \
  --agent-profile codex_planning \
  --json
```

`--allow-codex-build` is separate from `--allow-codex-planning`. Arcadia refuses `danger-full-access` profiles in managed runs.

## Review A Run

```sh
pnpm arcadia run show run_example \
  --workspace "$WORKSPACE" \
  --json
```

This includes run status, plan steps, step outcomes, mission log path, linked artifacts, and the compact `needsMark` compatibility list.

## Common Execution Loop

```sh
capture_json="$(pnpm arcadia capture --workspace "$WORKSPACE" --text "Generate status report" --json)"
work_id="$(printf '%s' "$capture_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.workItem.id))')"

plan_json="$(pnpm arcadia work plan "$work_id" --workspace "$WORKSPACE" --json)"
plan_id="$(printf '%s' "$plan_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.plan.id))')"

run_json="$(pnpm arcadia work run "$work_id" --workspace "$WORKSPACE" --plan "$plan_id" --json)"
run_id="$(printf '%s' "$run_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).data.run.id))')"

pnpm arcadia run show "$run_id" --workspace "$WORKSPACE" --json
```

## Existing Daily Commands

```sh
pnpm arcadia project list --workspace "$WORKSPACE"
pnpm arcadia queue --workspace "$WORKSPACE"
pnpm arcadia dashboard snapshot --workspace "$WORKSPACE" --json
pnpm arcadia work list --workspace "$WORKSPACE"
pnpm arcadia report status --workspace "$WORKSPACE"
pnpm arcadia review weekly --workspace "$WORKSPACE"
pnpm arcadia artifact list --workspace "$WORKSPACE" --json
```

Update an Action manually:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --queue work_queue \
  --responsibility autonomous \
  --next-action "Run the deterministic skill" \
  --status in_progress \
  --json
```

Mark an Action done:

```sh
pnpm arcadia work done work_example --workspace "$WORKSPACE" --json
```
