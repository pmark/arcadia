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

Show read-only current-day Intelligence usage and coding-agent availability:

```sh
pnpm arcadia intelligence usage --workspace "$WORKSPACE" --json
```

Arcadia aggregates token and cost data recorded by completed jobs and exposes a provider-neutral coding-agent availability snapshot. Codex account windows come from the local Codex app-server protocol. Claude Code 5-hour/7-day account limits are refreshed from Claude Code's local OAuth credentials when available; its context data still comes from the status-line JSON payload, captured by:

```sh
scripts/claude-code-statusline.sh
```

Configure that script as Claude Code's `statusLine.command`. The script writes the latest payload to `~/.arcadia/telemetry/claude-code.json`; override the location with `ARCADIA_CLAUDE_USAGE_PATH`. Arcadia also retains the most recently reported normalized provider snapshots in `~/.arcadia/telemetry/coding-agent-usage.json` (override with `ARCADIA_CODING_AGENT_USAGE_CACHE_PATH`). If a live read is temporarily unavailable, the CLI and Intelligence screen show that retained value as a **Last reported snapshot**. Missing or unsupported provider fields remain explicitly unknown.

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

Arcadia processes `.txt` requests and media files matched by enabled Workflows oldest first. Workflow files remain pending until two observations show their size and modification time unchanged for at least 30 seconds and `--run-safe` is passed. Successful and empty files move to `<ingress-root>/iCloudIdeas/Done/`; failed files move to `<ingress-root>/iCloudIdeas/Failed/`. Each moved file gets a readable JSON sidecar, and every non-empty processed request gets an ingress Log. Files placed in `Attachments/<request-basename>/` are recorded as ready Artifacts.

Watch mode is intentionally not implemented. For periodic processing, configure macOS `launchd` to run `arcadia ingress process` on an interval. See `docs/APPLE_INGEST.md` for the macOS Quick Action and iPhone/iPad Shortcut flow.

Install and maintain that periodic macOS service through Arcadia rather than hand-editing a LaunchAgent:

```sh
pnpm arcadia ingress service install --workspace "$WORKSPACE"
pnpm arcadia ingress service status --workspace "$WORKSPACE"
pnpm arcadia ingress service doctor --workspace "$WORKSPACE"
pnpm arcadia ingress service uninstall --workspace "$WORKSPACE"
```

The service uses the iCloud Drive `ArcadiaIngress` root by default, checks every 60 seconds, waits 30 seconds for Workflow media to stabilize, and passes `--run-safe` so only Workflows explicitly marked safe can execute. Standard output is discarded because Arcadia retains Run evidence; errors go to `~/Library/Logs/Arcadia/ingress-iCloudIdeas.err.log`.

## Deterministic Workflows

```sh
pnpm arcadia workflow list --workspace "$WORKSPACE" --json
pnpm arcadia workflow show thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow match './Thundertonk practice 2026 July 16.m4a' --source iCloudIdeas --workspace "$WORKSPACE" --json
pnpm arcadia workflow validate thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow add ./workflow.json --workspace "$WORKSPACE" --json
pnpm arcadia workflow enable thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow disable thundertonk-practice --workspace "$WORKSPACE" --json
pnpm arcadia workflow run thundertonk-practice './Thundertonk practice 2026 July 16.m4a' --workspace "$WORKSPACE" --dry-run --json
pnpm arcadia workflow runs --workspace "$WORKSPACE" --json
pnpm arcadia workflow run-info show <run-id> --workspace "$WORKSPACE" --json
```

Workflow definitions are JSON files in `config/workflows/`; workspace definitions override built-ins with the same stable ID. Executables and argument arrays are stored separately, and `{input}` must be one complete argument. A successful Run preserves raw stdout/stderr Logs and a JSON Run manifest below `artifacts/workflow-runs/<run-id>/`.

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

## Manage Artifacts And Expected Outcomes

An Action's `expected_artifact` is the concrete "done" signal — the thing
that should exist when the Action is finished. It matters beyond
description: coding-agent planning preparation refuses to run without one
(`work plan` requires `expectedArtifact` to be set on the Action before a
managed Codex/Claude planning packet can be created), and it is what tells
you and any reviewing agent whether a Run actually finished the job or just
did *something*.

Set or change it after capture, without re-writing the whole Action:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --expected-artifact "Published status report at reports/2026-07-status.md" \
  --json
```

Use `--expected-artifact none` to clear it (for example, if an Action turns
out to be exploratory and has no single deliverable).

**Example scenario:** you `capture` "Investigate why the nightly sync job
is slow" with no expected artifact. A day into investigating, you realize
the real deliverable is a short root-cause writeup. `work update
--expected-artifact "Root-cause writeup for nightly sync slowness"` turns
that vague Action into one that can pass through planning preparation,
without losing its history or requiring you to re-capture it.

Create an Artifact directly — for a deliverable that already exists (a
document you wrote by hand, a design doc from a call), or to link a
Milestone/Action to a piece of evidence before Arcadia produces one itself:

```sh
pnpm arcadia artifact create \
  --workspace "$WORKSPACE" \
  --title "Nightly sync root-cause writeup" \
  --type document \
  --status ready \
  --path reports/nightly-sync-root-cause.md \
  --project proj_example \
  --work-item work_example \
  --json
```

`--project` and `--work-item` are both optional, but if given they must
refer to Actions/Projects that already exist — Arcadia validates the link
rather than silently dropping it. `--status` defaults to `planned`; omit
`--path` for an Artifact that is expected but not produced yet (planning
packets do this automatically for the Action's `expected_artifact`).

**Example scenario:** during a dogfood session you manually write a
decision memo in Obsidian before Arcadia has any orchestrator to produce
one. `artifact create --path <vault path> --work-item <id>` registers that
memo as the Action's real output, so `artifact list` and the Dashboard
reflect what actually happened instead of showing the Action as artifact-less.

## Clarify Actions

Capture is not clarify. `capture` routes an Action into a queue and writes a
placeholder next action — usually *"Clarify the desired outcome or approve a
Codex execution path."* — but nobody has yet decided what to actually do. The
`next_action` column can't record that, because it is `NOT NULL` and always
holds *some* string. So `clarification_status` is the field that carries GTD's
"clarify" step: it, not the text, is the source of truth for whether an Action
has a real next action.

Every Action captured from now on lands as `unclarified`. The three states:

| Status | Meaning |
| ------ | ------- |
| `unclarified` | No concrete next action has been named yet. The `next_action` text is a placeholder — listings mark it `— (pending clarification)`. |
| `question_open` | Someone looked, and something is missing. `gap_type` says what kind, `open_question` holds the single question whose answer unblocks it. |
| `clarified` | A real, physically doable next action is recorded, with `clarification_source` for what justified it and `confidence` for how far to trust it. |

A `NULL` status is a fourth, distinct case: the Action predates clarification
or was never evaluated. That is deliberately *not* the same as `unclarified`,
which asserts that the Action is known to lack a next action.

Why the field matters beyond bookkeeping: it is what makes "which Actions are
actually ready to work?" answerable without reading every row by eye, and it is
the input any later automation gates on — a policy like *"a clarified Action
with high confidence and effort ≤ short may dispatch without a per-instance
Decision"* is expressible only because these columns exist.

Record a gap and the one question that unblocks it:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --clarification-status question_open \
  --gap-type missing-decision \
  --question "Should the nightly sync retry on partial failure, or fail the whole run?" \
  --confidence medium \
  --json
```

`--gap-type` takes exactly one of the rubric's four kinds, because each one
implies a different question:

| Gap type | The Action is blocked because… | What the question should ask for |
| -------- | ------------------------------ | -------------------------------- |
| `missing-decision` | a choice hasn't been made | the decision, plus the 2–4 criteria that matter |
| `missing-external-input` | you're waiting on someone or something outside | who/what, plus a draft of the ask |
| `missing-definition` | it's a problem label, not an action | a proposed decomposition into 2–5 subtasks, as a proposal to approve |
| `missing-success-criteria` | the action is clear but "done" is not | what finished looks like, specific to this Action |

Record a resolved clarification once the answer arrives:

```sh
pnpm arcadia work update work_example \
  --workspace "$WORKSPACE" \
  --clarification-status clarified \
  --next-action "Add a per-batch retry to the nightly sync and log partial failures" \
  --source "Decision review_0007; docs/plans/nightly-sync.md" \
  --confidence high \
  --gap-type none \
  --question none \
  --json
```

`--source` records *what justified* the next action — an Action detail, a
linked doc, a resolved Decision — so a later reader can tell a considered call
from a guess. `--confidence` is `high`, `medium`, or `low`; it is a coarse
label on an Action, distinct from the `0–1` confidence score on a Decision.
Every one of these flags takes `none` to clear it, which is how an Action that
was `question_open` sheds its stale gap when it becomes `clarified`.

**Example scenario:** you capture "Fix the flaky checkout test" on a walk. It
lands `unclarified`, and `work list` shows its next action as pending, so it
never looks ready. Reviewing the queue later you realize you can't name a fix
until you know whether flakiness is a timing issue or a fixture issue —
`--gap-type missing-definition --question "Which of the three failing
assertions fails in isolation?"` puts that question on the record instead of
letting the Action rot in the queue looking actionable. When you find the
answer, `--clarification-status clarified --next-action …` promotes it, and the
`[GAP …]` prefixes an earlier dogfood pass had to jam into the next-action text
are no longer needed.

## Plan Work

```sh
pnpm arcadia work plan work_example \
  --workspace "$WORKSPACE" \
  --agent-profile claude_planning \
  --json
```

The plan records each step, executor type, command label, and whether the step is safe to run. Omit `--agent-profile` to use the workspace default (Codex by default). A managed planning Decision is permanently bound to the profile used when its packet was created.

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

Explicitly approved coding-agent steps can be run through configured profiles:

```sh
pnpm arcadia work run work_example \
  --workspace "$WORKSPACE" \
  --plan plan_example \
  --allow-codex-planning \
  --agent-profile codex_planning \
  --json
```

`--allow-codex-build` is separate from `--allow-codex-planning`. Arcadia refuses `danger-full-access` profiles in managed runs.

The built-in managed profiles are `codex_planning`, `codex_build`, `claude_planning`, and `claude_build`. The `codex` wording in the two allow flags is retained as a compatibility name for coding-agent work.

For a generic approved implementation Decision, choose a built-in review executor directly:

```sh
pnpm arcadia review approve review_example \
  --workspace "$WORKSPACE" \
  --execute \
  --executor claude-code \
  --json
```

The other built-in review executors are `codex` and `gemini`. Custom CLI adapters such as OpenCode or Aider can be configured in `config/arcadia.json` or the target repository's `.arcadia/executors.json`.

## Review A Run

```sh
pnpm arcadia run show run_example \
  --workspace "$WORKSPACE" \
  --json
```

This includes run status, plan steps, step outcomes, mission log path, linked artifacts, and the compact `needsOperator` compatibility list.

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

## Time, Scale, And Reports

Give a ledger entry a coarse size so Arcadia can reason about time cost.
Sizes are `quick` (≤15m), `short` (≤1h), `session` (1–3h), and `project`
(multi-session). Use `none` to clear one.

```sh
pnpm arcadia orientation entry update oentry_example --workspace "$WORKSPACE" --effort session
pnpm arcadia work update work_example --workspace "$WORKSPACE" --effort short
```

Say what today actually holds, then ask what fits a real gap. Both the fit
query and the packet's plan are deterministic — no model call.

```sh
pnpm arcadia orientation capacity set --workspace "$WORKSPACE" \
  --note "one client session + ~1h of fragments; evening gone" \
  --session-blocks 1 --fragment-minutes 60
pnpm arcadia orientation fits --workspace "$WORKSPACE" --minutes 20
pnpm arcadia orientation timeline --workspace "$WORKSPACE"
```

Log real work you already did. `--at` is a local clock time and is optional;
so is linking the block to a ledger entry.

```sh
pnpm arcadia time log --workspace "$WORKSPACE" \
  --minutes 90 --description "Nav and contact form on the practice site" \
  --at 09:00 --entry oentry_example
pnpm arcadia time list --workspace "$WORKSPACE" --days 7
```

Read the story back. `activity` shows the raw interaction log Arcadia keeps
for free; the reports compose it into what moved, where the time went, and
what is becoming urgent.

```sh
pnpm arcadia activity --workspace "$WORKSPACE" --days 7
pnpm arcadia report daily --workspace "$WORKSPACE"
pnpm arcadia report weekly --workspace "$WORKSPACE"
```

The same natural-language reply loop understands all of it — sizes, capacity,
and time already spent:

```sh
pnpm arcadia orientation reply "the disposal's a whole afternoon" --workspace "$WORKSPACE"
pnpm arcadia orientation reply "today I have one client session and about an hour of gaps" --workspace "$WORKSPACE"
pnpm arcadia orientation reply "I spent about an hour on the car mirror this morning" --workspace "$WORKSPACE"
pnpm arcadia orientation reply "I have 20 minutes, what fits?" --workspace "$WORKSPACE"
```
