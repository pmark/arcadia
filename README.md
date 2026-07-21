# Arcadia

Arcadia is a local-first project operating system for people juggling multiple creative, technical, and entrepreneurial efforts at the same time.

For normal daily use, service expectations, and the local Today page, start with [`START_HERE.md`](START_HERE.md).

Arcadia Core is the open source CLI, schema, and reporting engine. Your Arcadia workspace is private operational data.

Before changing user-facing terminology, data models, CLI commands, dashboard labels, or documentation, read `docs/arcadia-semantics.md` and use Arcadia's canonical terms consistently.

Phase 0 is intentionally small: initialize a workspace, create projects, assign responsibility, view queues, record mission logs, and generate Markdown status reports. Phase 2 adds a single-Action execution loop: capture intent, plan work, run deterministic safe steps, and review run records. Phase 3 adds deterministic natural-language intent resolution with `arcadia ask`.

## Principles

- Local first whenever possible.
- Use the simplest solution that works.
- Favor deterministic workflows over clever automation.
- Use scripts before AI.
- Use local AI before expensive frontier models.
- Involve humans only where judgment is genuinely required.
- Avoid over-engineering.
- Optimize for sustained progress rather than perfect planning.

## Requirements

- Node.js 20 or newer
- pnpm
- A terminal

SQLite is embedded through `better-sqlite3`; no separate database server is required.

## Development Setup

Install dependencies:

```sh
pnpm install
```

Build the CLI:

```sh
pnpm build
```

Run tests:

```sh
pnpm test
```

Show CLI help:

```sh
pnpm arcadia --help
```

## Discord Awareness Bot

Arcadia includes a lightweight Discord adapter in `apps/discord-bot`.

The bot can show concise status, submit requests through `arcadia ask`, optionally run deterministic safe request steps, show Requires Review Decisions, list recent runs, inspect a single run, show observed Codex Companion tasks, and post meaningful execution notifications including Discord-origin safe completions and Codex task transitions. It does not approve work, review artifacts, publish, deploy, run Codex from Discord, or spend money.

See `apps/discord-bot/README.md` for environment variables, slash command registration, local run commands, and notification deduplication behavior.

## Codex Companion

Arcadia can observe Codex Cloud tasks and local Codex goals as a thin coordination layer:

```sh
pnpm arcadia codex list --workspace ./tmp/demo-workspace --active-only
pnpm arcadia codex associate <task-id-or-source-id> --workspace ./tmp/demo-workspace --project <project-id>
```

Codex remains responsible for implementation work and task lifecycle. Arcadia stores lightweight project association, Discord visibility, notification state, and completion mission logs.

## Dashboard

Arcadia includes a local mobile-first dashboard adapter in `apps/dashboard`.

The dashboard is read-only. It shows project status, current milestones, Requires Review Decisions, recent runs, and recent artifacts through `arcadia dashboard snapshot --json`. It does not edit projects, approve work, start runs, or run AI.

See `apps/dashboard/README.md` for environment variables and local network usage.

## Arcadia Intelligence (v0.1)

Arcadia Intelligence is a generic, local, SQLite-backed structured generation
service. Companion apps submit a structured generation request with their own
JSON Schema; Arcadia does not know anything about the requesting app's domain.
See `docs/intelligence/V0_1_SCOPE.md` for the exact scope and boundaries.

Start the API and its in-process worker together (the worker polls the same
workspace database for queued jobs):

```sh
pnpm arcadia intelligence serve --workspace ./tmp/demo-workspace --port 4710
```

Text and cloud image routes expect a [LiteLLM proxy](https://docs.litellm.ai/docs/proxy/quick_start)
running locally (default `http://127.0.0.1:4000`). Local image generation and
editing can run through the loopback ComfyUI backend; the Codex CLI route also
remains available. Requests never name a LiteLLM route, ComfyUI workflow,
Codex command, provider, or model directly — they choose a `capability`
(what work is needed), `execution` (local vs. cloud preference), and
`profile` (optimization target), and Arcadia resolves that deterministically
to exactly one configured route. See `docs/intelligence/ROUTING.md` for the
full routing model, failure codes, and configuration reference. Configure
the underlying LiteLLM endpoint and route registry with:

- `ARCADIA_LITELLM_BASE_URL` — LiteLLM proxy URL (default `http://127.0.0.1:4000`)
- `ARCADIA_LITELLM_LOCAL_TEXT_ROUTE` — local text route/alias (default `arcadia-default`)
- `ARCADIA_LITELLM_CLOUD_TEXT_ROUTE` — cloud text route/alias (unset = disabled)
- `ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE` — cloud image route/alias (unset = disabled)
- `ARCADIA_LITELLM_API_KEY` — optional bearer token forwarded to the proxy
- `ARCADIA_CODEX_IMAGE_ROUTE` — enables the local Codex CLI image route when set, for example `codex-cli`
- `ARCADIA_CODEX_CLI_COMMAND` — Codex command (default `codex`)
- `ARCADIA_CODEX_CLI_ARGS` — JSON array of args (default runs `codex exec` in the isolated job workspace)
- `ARCADIA_CODEX_CLI_TIMEOUT_MS` — Codex image job timeout (default `120000`)
- `ARCADIA_COMFYUI_IMAGE_ROUTE` — enables local ComfyUI image routes, for example `comfyui`
- `ARCADIA_COMFYUI_BASE_URL` — ComfyUI API (default `http://127.0.0.1:8188`)
- `ARCADIA_COMFYUI_WORKFLOW_DIR` — generated API workflow directory
- `ARCADIA_COMFYUI_TIMEOUT_MS` — ComfyUI job timeout (default `900000`)

If LiteLLM is unreachable, or a request's capability/execution/profile has no
configured route, jobs end up `blocked` with a typed error code (not
silently retried against a paid fallback or a different location — v0.1
never escalates). `GET /api/intelligence/health` reports LiteLLM reachability
and the enabled route registry without submitting a job.

### Image generation

Submitting `capability: "image.generate"` with a string `input.prompt` and
optionally `input.n` routes the job through the configured image route:

- `execution: "local-required"` or `"local-preferred"` plus `profile:
  "quality"` resolves to the local ComfyUI route when
  `ARCADIA_COMFYUI_IMAGE_ROUTE` is set. `image.edit` uses the same route and
  requires `input.referenceImages` with a local image path.
- `execution: "cloud-required"`, `profile: "quality"`, and
  `executionPolicy.allowPaidUsage: true` resolves to the configured cloud
  image route when `ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE` is set.

The job's `result` is never a provider URL or inline base64 — both are
unsuitable as a durable, portable reference (provider URLs can expire or be
credential-sensitive; base64 bloats job rows and HTTP responses). Instead
Arcadia downloads, decodes, or collects the generated bytes, verifies the
image MIME type and dimensions, hashes and stores them under the workspace's
`artifacts/` directory, and returns a JSON manifest:

```json
{
  "artifacts": [
    {
      "id": "iart_...",
      "kind": "image",
      "uri": "/api/intelligence/artifacts/iart_...",
      "mimeType": "image/png",
      "sha256": "...",
      "byteSize": 12345,
      "dimensions": { "width": 1024, "height": 1024 }
    }
  ],
  "generation": { "requestedCount": 1, "returnedCount": 1 }
}
```

This manifest is still validated against the companion app's own
`outputContract.jsonSchema`, like any other job result. Fetch the bytes with
`GET {baseUrl}{uri}` or `ArcadiaIntelligenceClient.getArtifact(uri)`.
For local backend runs, the isolated job workspace is preserved at
`.arcadia/intelligence/jobs/<job-id>/` with `request.json`,
the submitted ComfyUI workflow JSON, and execution evidence. Generated bytes
are stored through the durable Artifact store.
Run one local image job without starting the HTTP server:

```sh
pnpm arcadia intelligence smoke-image --workspace ./tmp/demo-workspace --json
```

API: `POST /api/intelligence/jobs`, `GET /api/intelligence/jobs/:jobId`,
`POST /api/intelligence/jobs/:jobId/retry`, `GET /api/intelligence/health`,
`GET /api/intelligence/artifacts/:artifactId`.
A generic TypeScript client (`ArcadiaIntelligenceClient`) with `submit`,
`getJob`, `retry`, `waitForCompletion`, and `getArtifact` is published as a
public package subpath, `@pmark/arcadia/intelligence/client`, alongside the request/job
contracts at `@pmark/arcadia/intelligence/contracts`. These are the only two
supported import paths for companion apps such as Rebuster; see
`docs/intelligence/PNPM_LINK.md` for the local `pnpm link` workflow.

The Dashboard Intelligence screen includes a read-only current-day usage and
coding-agent-availability summary. It aggregates durable job usage, reads
Codex account windows from the local app-server protocol, and reads Claude
Code context and subscription windows from its configured status-line payload.
The latest normalized provider snapshot is retained locally so a transient
provider read or page refresh does not make a previously reported quota vanish.
Profile selection avoids providers that explicitly report an exhausted limit;
missing telemetry remains eligible and is labeled unknown. Publishing and
automatic external fallbacks remain excluded.
See
`docs/intelligence/CODEX_IMAGE_EXECUTOR.md` for the local Codex image design.

## Planning Artifacts

- [Universal Capture-to-Artifact program](docs/plans/universal-capture-to-artifact/README.md) defines the modular path from arbitrary capture through interpretation, safe execution, Artifact delivery, and Obsidian handoff, with implementation-ready Milestones and agent prompts.
- [Arcadia Intelligence Gateway plan](docs/plans/arcadia-intelligence-gateway/README.md) is a larger, not-yet-implemented design for a policy-aware Intelligence Gateway. The implemented v0.1 service above is an intentionally narrower slice and does not follow this plan's budgets/quotas/artifact scope.

## Quick Start

Initialize a private workspace:

```sh
pnpm arcadia init ./tmp/demo-workspace
```

Workspace commands use `ARCADIA_WORKSPACE` when it is set; otherwise they default to the current directory. Passing `--workspace <path>` always takes precedence.

Initialize a workspace that manages Arcadia itself as an ordinary project:

```sh
pnpm arcadia init ./tmp/arcadia-workspace --profile arcadia
```

Create a project:

```sh
pnpm arcadia project create --workspace ./tmp/demo-workspace
```

Add a manually assigned Action:

```sh
pnpm arcadia inbox add --workspace ./tmp/demo-workspace
```

Import a manually assigned Action from a script:

```sh
pnpm arcadia inbox import --workspace ./tmp/demo-workspace --title "Run local check" --input "Run local check" --queue work_queue --responsibility autonomous --next-action "Run the script" --json
```

Capture executable intent:

```sh
pnpm arcadia capture --workspace ./tmp/demo-workspace --text "Generate status report" --json
```

Resolve natural-language intent into an auditable Action and plan:

```sh
pnpm arcadia ask --workspace ./tmp/demo-workspace "Create a new blog site named MartianRover Field Notes." --json
```

Process Apple Shortcut ingress files:

```sh
pnpm arcadia ingress process --workspace ./tmp/demo-workspace --source iCloudIdeas --json
pnpm arcadia ingress process --workspace ./tmp/demo-workspace --source iCloudIdeas --run-safe --json
pnpm arcadia ingress process --workspace ./tmp/demo-workspace --source iCloudIdeas --dry-run
```

See [Apple Platform Ingest](docs/APPLE_INGEST.md) for a macOS clipboard/file helper, Finder Quick Action setup, an iPhone/iPad Share Sheet Shortcut, and the iCloud Drive folder configuration.

Discover, validate, and run configured deterministic Workflows:

```sh
pnpm arcadia workflow list --workspace ./tmp/demo-workspace --json
pnpm arcadia workflow match './Thundertonk practice 2026 July 16.m4a' --source iCloudIdeas --workspace ./tmp/demo-workspace --json
pnpm arcadia workflow validate thundertonk-practice --workspace ./tmp/demo-workspace --json
pnpm arcadia workflow run thundertonk-practice './Thundertonk practice 2026 July 16.m4a' --workspace ./tmp/demo-workspace --dry-run --json
pnpm arcadia workflow runs --workspace ./tmp/demo-workspace --json
```

View queues:

```sh
pnpm arcadia queue --workspace ./tmp/demo-workspace
```

List and update Actions:

```sh
pnpm arcadia work list --workspace ./tmp/demo-workspace
pnpm arcadia work update --workspace ./tmp/demo-workspace <work-id> --status in_progress --json
pnpm arcadia work done --workspace ./tmp/demo-workspace <work-id> --json
pnpm arcadia work plan --workspace ./tmp/demo-workspace <work-id> --json
pnpm arcadia work run --workspace ./tmp/demo-workspace <work-id> --json
pnpm arcadia run show --workspace ./tmp/demo-workspace <run-id> --json
```

Update project and milestone state:

```sh
pnpm arcadia project update --workspace ./tmp/demo-workspace <project-id> --status paused --json
pnpm arcadia milestone create --workspace ./tmp/demo-workspace <project-id> --title "Next milestone" --json
pnpm arcadia milestone complete --workspace ./tmp/demo-workspace <milestone-id> --json
```

List and update artifacts:

```sh
pnpm arcadia artifact list --workspace ./tmp/demo-workspace --json
pnpm arcadia artifact update --workspace ./tmp/demo-workspace <artifact-id> --status ready --path artifacts/output.md --json
```

Create a mission log:

```sh
pnpm arcadia log create --workspace ./tmp/demo-workspace
```

Generate status:

```sh
pnpm arcadia status --workspace ./tmp/demo-workspace
pnpm arcadia report status --workspace ./tmp/demo-workspace
```

Read the dashboard snapshot without regenerating reports:

```sh
pnpm arcadia dashboard snapshot --workspace ./tmp/demo-workspace --json
```

Generate a deterministic weekly review:

```sh
pnpm arcadia review weekly --workspace ./tmp/demo-workspace
pnpm arcadia review weekly --workspace ./tmp/demo-workspace --since 2026-06-03 --until 2026-06-09 --json
```

Run the non-interactive smoke path:

```sh
pnpm smoke
```

## Commands

- `arcadia init <workspace> [--profile arcadia]` creates workspace folders, `config/arcadia.json`, `database/arcadia.sqlite3`, and applies the initial schema. The optional `arcadia` profile seeds Arcadia as a normal project in that workspace.
- `arcadia status [--workspace <path>]` prints a concise summary and writes `reports/status.md`.
- `arcadia ask [--workspace <path>] <request> [--project <project-id>] [--milestone <milestone-id>] [--agent-profile <name>] [--run-safe]` resolves natural-language intent into an auditable Action and workflow plan.
- `arcadia ingress process --workspace <path> [--source iCloudIdeas] [--ingress-root <path>] [--run-safe] [--dry-run]` processes local text request files from `<ingress-root>/<source>/In/` (default: `~/ArcadiaIngress`).
- `arcadia capture --workspace <path> --text <intent> [--project <project-id>] [--milestone <milestone-id>] [--expected-artifact <artifact>]` captures natural-language intent as a structured Action.
- `arcadia project create --workspace <path>` interactively creates one project, milestone, initial Action, and optional artifact record.
- `arcadia project list --workspace <path>` lists projects with status, milestone, next action, and responsibility.
- `arcadia project import --workspace <path> --name <name> --mission <mission> --milestone <milestone> --next-action <action> --responsibility <responsibility> [--outcome <outcome>]` creates a project, active milestone, and initial Action without prompts. `--goal` and `--classification` remain compatibility aliases.
- `arcadia project update --workspace <path> <project-id> --status <status>` updates project status.
- `arcadia project metadata --workspace <path> <project-id> [--alias <alias>] [--repo-path <path>] [--status-summary <summary>] [--validation-command <command>]` upserts deterministic project metadata for request routing and Codex packet context.
- `arcadia inbox add --workspace <path>` interactively adds a manually assigned Action.
- `arcadia inbox import --workspace <path> --title <title> --input <text> --queue <queue> --responsibility <responsibility> --next-action <action>` adds a manually assigned Action without prompts. `--classification` remains a compatibility alias.
- `arcadia queue --workspace <path>` shows Inbox, Work Queue, Requires Review, and Blocked items.
- `arcadia dashboard snapshot --workspace <path>` emits the read-only dashboard snapshot.
- `arcadia work list --workspace <path>` lists Actions.
- `arcadia work update --workspace <path> <work-id> [--queue <queue>] [--responsibility <responsibility>] [--next-action <action>] [--status <status>]` updates an Action. `--classification` remains a compatibility alias.
- `arcadia work done --workspace <path> <work-id>` marks an Action complete.
- `arcadia work plan --workspace <path> <work-id> [--agent-profile <name>]` creates an observable workflow plan for an Action and binds any managed planning packet to the selected coding agent.
- `arcadia work run --workspace <path> <work-id> [--plan <plan-id>] [--allow-codex-planning] [--allow-codex-build] [--agent-profile <name>]` runs deterministic safe steps by default. The planning allow flag only dispatches an already approved packet-specific Decision; it is not authorization by itself.
- `arcadia run list --workspace <path> [--limit <n>]` lists recent runs.
- `arcadia run show --workspace <path> <run-id>` shows the run audit trail and Requires Review Decisions.
- `arcadia run retry --workspace <path> <run-id>` creates or returns an immutable retry Decision for a failed or Requires Review managed planning Run.
- `arcadia milestone list --workspace <path> [--status <status>] [--limit <n>]` lists milestones.
- `arcadia milestone create --workspace <path> <project-id> --title <title>` creates a milestone.
- `arcadia milestone complete --workspace <path> <milestone-id>` marks a milestone complete.
- `arcadia artifact list --workspace <path>` lists artifacts.
- `arcadia artifact update --workspace <path> <artifact-id> [--status <status>] [--path <path>]` updates artifact status or path.
- `arcadia log create --workspace <path>` records a mission log in SQLite and writes Markdown under `mission_logs/YYYY/MM/`.
- `arcadia report status --workspace <path>` writes the full Markdown status report.
- `arcadia review weekly --workspace <path> [--since <YYYY-MM-DD>] [--until <YYYY-MM-DD>]` writes a deterministic weekly review to `reports/weekly/YYYY-MM-DD.md`. If dates are omitted, Arcadia uses the seven calendar days ending today.
- `arcadia intelligence serve --workspace <path> [--port <number>]` starts the Arcadia Intelligence v0.1 API and its in-process worker in the foreground (default port 4710). See [Arcadia Intelligence (v0.1)](#arcadia-intelligence-v01) above.
- `arcadia intelligence smoke-image --workspace <path> [--prompt <text>] [--route <name>] [--json]` submits and runs one local image-generation smoke job through the normal Intelligence lifecycle.

## Local File Ingress

Apple Shortcuts can hand work to Arcadia by writing a plain text file into:

```text
~/ArcadiaIngress/iCloudIdeas/In/YYYYMMDD-HHMMSS.txt
```

The file contents are the natural-language request. Process pending files once:

```sh
pnpm arcadia ingress process --workspace "$WORKSPACE" --source iCloudIdeas
```

Run deterministic safe steps immediately for matching requests:

```sh
pnpm arcadia ingress process --workspace "$WORKSPACE" --source iCloudIdeas --run-safe
```

Preview pending files without moving files or executing work:

```sh
pnpm arcadia ingress process --workspace "$WORKSPACE" --source iCloudIdeas --dry-run
```

Processed files move to `~/ArcadiaIngress/iCloudIdeas/Done/` with a `.response.json` sidecar. Failed files move to `~/ArcadiaIngress/iCloudIdeas/Failed/` with a `.error.json` sidecar. Arcadia records an ingress mission log for every non-empty processed request.

Watch mode is intentionally not implemented. For periodic processing, configure macOS `launchd` to run the `ingress process` command on an interval.

For Share Sheet capture from macOS, iPhone, and iPad—including copied files and clipboard contents—see [Apple Platform Ingest](docs/APPLE_INGEST.md).

## Workspace Data

`arcadia init` creates:

- `projects/`
- `mission_logs/`
- `artifacts/`
- `skills/`
- `prompts/`
- `config/`
- `database/`
- `reports/`
- `inbox/`

Phase 3 also creates inspectable registries in `config/`:

- `intent-registry.json`
- `template-registry.json`
- `coding-agent-profiles.json`

### Coding-agent profiles

Arcadia ships managed CLI profiles for Codex and Claude Code:

- `codex_planning` and `codex_build`
- `claude_planning` and `claude_build`

Codex remains the default. Set the `defaults.planning` and `defaults.build` names in `config/coding-agent-profiles.json` to change a workspace default, or pass `--agent-profile` when creating an Ask or planning packet. Claude planning uses Claude Code's `plan` permission mode; Claude build uses `acceptEdits`. Arcadia still refuses `danger-full-access` profiles and never lets a later Run switch away from the profile approved with its packet.

The profile contract is deliberately CLI-neutral: command, arguments, purpose, sandbox level, and provider adapter. Additional local systems such as Gemini CLI or OpenCode can be added as profiles, with a small output adapter only when their result format requires one. Legacy database and Responsibility names containing `codex` remain compatibility fields; they identify coding-agent work, not a requirement to use OpenAI's CLI.

Approved generic review execution also supports the built-in `codex`, `claude-code`, and `gemini` executors through `arcadia review approve <id> --execute --executor <name>`. Custom Aider/OpenCode-style executors can be declared in `config/arcadia.json` or a repository's `.arcadia/executors.json`.

SQLite is authoritative. Markdown files are generated narrative artifacts.

For copy-paste examples of common workflows, see [docs/COMMANDS.md](docs/COMMANDS.md). For Phase 2 scope and behavior, see [docs/PHASE_2.md](docs/PHASE_2.md). For Phase 3 scope and behavior, see [docs/phase-3-natural-language-intent.md](docs/phase-3-natural-language-intent.md).

Keep private workspaces separate from Arcadia Core. Do not commit personal workspace data unless you intentionally choose to.

## Current Boundaries

Arcadia Core does not include cloud sync, authentication, AI classification, unapproved coding-agent dispatch, a plugin marketplace, advanced scheduling, or local model integration.

## License

Arcadia Core is licensed under the MPL-2.0 license.
