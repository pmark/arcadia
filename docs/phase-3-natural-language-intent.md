# Phase 3: Natural Language Intent

## Summary

Phase 3 makes Arcadia usable from natural language without turning it into a generic agent framework.

The flow is:

```text
Natural language request
  -> deterministic intent resolution
  -> structured work item
  -> execution plan
  -> safe deterministic execution or explicit Codex/Needs Mark handoff
```

SQLite remains authoritative. Markdown and prompt packets are inspectable artifacts. Codex means the `@openai/codex` CLI, invoked through configurable coding-agent profiles when Mark explicitly approves execution.

## Current System Assumptions

- Phase 2 already provides work items, execution plans, execution runs, deterministic skills, mission logs, and run audit display.
- `work run` executes only deterministic safe steps by default.
- Codex and Mark steps pause as `needs_mark`.
- Workspace data lives under local folders created by `arcadia init`.
- `config/*.json` is the right place for inspectable registry files.

## Proposed Phase 3 Scope

- Add `arcadia ask --workspace <path> "<request>" [--project <id>] [--milestone <id>] [--run-safe] [--json]`.
- Add intent, template, and coding-agent profile registries.
- Add ask/audit tables for natural-language requests, approval gates, and Codex invocation packets.
- Generate Codex prompt packets before any Codex execution.
- Support deterministic safe execution with `--run-safe`.

## Non-Goals

- Dashboard.
- Background daemon.
- Generic autonomous agent framework.
- Required local models.
- Required frontier models.
- Hidden prompt behavior.
- Automatic deployment, publication, credential use, spending, destructive changes, merge to main, or outbound messaging.

## Proposed Commands

```sh
arcadia ask --workspace <path> "<request>" [--project <id>] [--milestone <id>] [--run-safe] [--json]
```

Default behavior creates an audit record, work item, execution plan, approval gates, and any required Codex packet. It does not run unsafe steps.

`--run-safe` immediately runs the generated plan through the existing deterministic runner. Codex, Mark, and unsafe steps still pause.

Codex execution flags are explicit:

```sh
arcadia work run <work-id> --workspace <path> --allow-codex-planning --agent-profile codex_planning
arcadia work run <work-id> --workspace <path> --allow-codex-build --agent-profile codex_build
```

## Proposed Registry File Formats

`config/intent-registry.json` contains known intents, aliases, examples, output kind, optional template refs, skill sequence, and approval gates.

`config/template-registry.json` contains known project/artifact templates. The initial template is `astro_field_notes_cloudflare`.

`config/coding-agent-profiles.json` contains configurable agent profiles. The initial profiles use provider `codex-cli`, package `@openai/codex`, command `codex`, and purpose-specific args.

## Proposed Schema Changes

Schema v3 adds:

- `ask_requests`: raw request, resolved intent, registry version, output kind, linked work item, linked plan, prompt packet path, status, timestamps.
- `approval_gates`: gate type, reason, linked work/plan/step, status, timestamps.
- `codex_invocations`: purpose, agent profile, workspace scope, command, prompt path, output paths, status, linked work/plan/step/run, timestamps.

## Intent Resolution Algorithm

1. Normalize request text.
2. Match known intent aliases and examples from the registry.
3. Extract simple slots such as `projectName`, `templateName`, and `deploymentTarget`.
4. Select template refs and skill sequence from the matched intent.
5. Create approval gates from intent and template rules.
6. If no intent matches, fall back to a Codex planning packet.
7. If a request is unsupported and unsafe, create Needs Mark work.

Skill selection order:

1. exact deterministic skill
2. deterministic script
3. local model classifier, only if configured and available
4. Codex planning
5. Codex build
6. Needs Mark

## Codex Invocation Design

Codex is invoked as `@openai/codex` through the `codex` binary, not through Arcadia internals. Scripted use should use `codex exec` with explicit `--cd`, sandbox, JSON, output schema, and final-message output flags.

Arcadia creates prompt packets under:

```text
prompts/codex/<invocation-id>/
  prompt.md
  output.jsonl
  final.md
  metadata.json
```

The first implementation creates packets and database records automatically, and executes Codex only through explicit `work run` allow flags.

## Approval Gate Design

The initial gate types are:

- credentials required
- external deployment
- publication
- destructive filesystem changes
- production data access
- financial action
- merge to main
- sending email or messages

All gates default to `pending`.

## End-To-End Examples

### Flow A: Astro Field Notes Blog

Request:

```sh
arcadia ask --workspace "$WORKSPACE" "Create a new blog site named MartianRover Field Notes." --json
```

Expected result:

- intent `create_astro_blog`
- template `astro_field_notes_cloudflare`
- Codex build packet
- external deployment approval gate
- no deployment

### Flow B: MIDI Opener Analytics

Request:

```sh
arcadia ask --workspace "$WORKSPACE" "I need MIDI Opener app analytics data downloaded from PostHog and Apple's Analytics Report API and processed for the Field Notes blog." --json
```

Expected result:

- intent `process_analytics_data`
- specification step
- Codex planning packet
- credential and production data gates
- no API access

### Flow C: Weekly Martian Rover Labs Update

Request:

```sh
arcadia ask --workspace "$WORKSPACE" "Prepare a weekly Martian Rover Labs update from recent mission logs." --run-safe --json
```

Expected result:

- intent `prepare_blog_update`
- deterministic weekly update draft
- publication approval gate
- no publication

## Implementation Slices

1. Planning artifact and command documentation.
2. Registry defaults, workspace copying, loading, validation, and deterministic resolver.
3. Schema v3 tables and repository helpers.
4. `arcadia ask` command.
5. Approval gate creation and surface in ask output.
6. Codex packet generation and invocation records.
7. Explicit Codex execution flags and configurable profiles.
8. Tests and smoke coverage.

## Acceptance Criteria

- `arcadia ask --workspace <path> "create a new blog site named MartianRover Field Notes"` creates a work item and plan.
- The generated plan uses the Astro Field Notes template metadata when matched.
- If no matching intent exists, Arcadia creates a Codex planning packet.
- Credentialed actions are classified as approval gates and Needs Mark work where appropriate.
- Every ask creates an audit trail.
- Every generated plan is inspectable.
- Every Codex handoff has a visible prompt packet and database record.
- `--run-safe` only executes deterministic safe steps.
- No external deployment happens without approval.

## Risks And Simplifications

- Registry matching is intentionally simple string matching; improve only when real examples demand it.
- Codex execution is deferred behind explicit flags to preserve safety.
- Field Notes and Cloudflare details start as template metadata plus a Codex build packet, not a hidden scaffold system.
- Coding-agent profiles are configurable from the start so Arcadia can later support fallbacks when usage limits are reached.
