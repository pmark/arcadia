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

Use `capture` when you have natural-language intent and want Arcadia to structure it as work.

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --text "Generate status report" \
  --json
```

Safe known work is placed in `work_queue` as `autonomous`. Ambiguous work is placed in `needs_mark`.

```sh
pnpm arcadia capture \
  --workspace "$WORKSPACE" \
  --text "Improve Rebuster candidate review flow" \
  --json
```

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

Run the latest plan for a work item:

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

Arcadia executes only deterministic safe steps. Codex, publishing, destructive, unclear, or Mark-required steps pause as `needs_mark`.

## Review A Run

```sh
pnpm arcadia run show run_example \
  --workspace "$WORKSPACE" \
  --json
```

This includes run status, plan steps, step outcomes, mission log path, linked artifacts, and the compact `needsMark` list.

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
pnpm arcadia work list --workspace "$WORKSPACE"
pnpm arcadia report status --workspace "$WORKSPACE"
pnpm arcadia review weekly --workspace "$WORKSPACE"
pnpm arcadia artifact list --workspace "$WORKSPACE" --json
```

Update work manually:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --queue work_queue \
  --classification autonomous \
  --next-action "Run the deterministic skill" \
  --status in_progress \
  --json
```

Mark work done:

```sh
pnpm arcadia work done work_example --workspace "$WORKSPACE" --json
```

