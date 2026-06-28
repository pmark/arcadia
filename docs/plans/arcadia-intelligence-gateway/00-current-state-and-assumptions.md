# Current State And Assumptions

## Confirmed Repository Findings

Arcadia is a TypeScript CLI and local workspace system. `package.json` defines Node 20+, `pnpm`, `tsx`, `typescript`, `vitest`, `commander`, and `better-sqlite3`. SQLite is embedded; there is no database server.

`database/schema.sql` contains the baseline schema. `src/db/schema.ts` applies the baseline plus compatibility migrations when a database opens. Capability-specific migrations exist through `src/capabilities/migrations.ts` and `capability_migrations`.

Core records already include Projects, Milestones, Actions through `work_items`, Artifacts, Logs through `mission_logs`, Decisions through `review_items`, approval gates, execution plans, execution runs, Codex invocation metadata, observed Codex tasks, capability migrations, and events.

The public semantic terms are defined in `docs/arcadia-semantics.md`: Domain, Project, Mission, Outcome, Milestone, Action, Artifact, Decision, and Log. Existing internal compatibility names include `work_items`, `work_classification`, `review_items`, `mission_logs`, and `prompt_packet_path`.

## Existing Architecture Patterns

SQLite access is centralized through `src/db/connection.ts` and repository functions in `src/db/repositories.ts`. Commands usually resolve the workspace, call repositories through `withDatabase`, then return a `CommandSuccess` JSON envelope.

CLI commands are implemented with Commander in `src/cli.ts`, with command logic in `src/commands/*`. Human output and JSON output share the same command result shape through `src/cli/response.ts`.

Workspace configuration is local. `src/workspace/initWorkspace.ts` creates `config/arcadia.json`, registries under `config/`, `database/arcadia.sqlite3`, `artifacts/`, `prompts/`, `reports/`, and related folders. User-level default workspace config lives outside the workspace in the platform config directory.

Execution is plan/run based. `src/execution/skills.ts` defines deterministic, Codex planning/build, and Mark executor types. `src/execution/runner.ts` runs only deterministic safe steps by default. Codex steps require explicit allow flags and have packet/provenance records.

Dashboard data is a read-only snapshot from `src/dashboard/snapshot.ts`. The Next.js dashboard calls CLI JSON through `apps/dashboard/lib/arcadia-cli.ts`; it does not own an independent write path.

Tests use Vitest, temporary workspaces, direct command functions, repository helpers, fake HTTP servers where needed, and snapshot-style assertions for dashboard shape.

## Existing Capability And Integration Patterns

`src/capabilities/core.ts` defines capability modules with migrations, commands, permissions, artifact types, dashboard surfaces, and optional MCP metadata. `src/capabilities/coreApi.ts` lets modules create Actions, Artifacts, Decisions, Logs, approval gates, and events without owning core tables directly.

The Rebuster capability is a useful boundary example. `src/capabilities/rebuster/module.ts` adds only bridge tables and states explicitly that Rebuster owns creative state. `docs/rebuster-arcadia-contract.md` documents that Arcadia stores configuration, external event snapshots, and Decisions, not Rebuster's domain records.

The blogging capability shows capability-local tables linked to core Artifacts, Decisions, and Logs.

## Existing AI, Provider, Budget, And Routing Code

Confirmed: there is no LiteLLM integration, OpenAI SDK integration, Ollama integration, provider key manager, provider budget table, token accounting table, or generic AI request abstraction.

Confirmed: Arcadia has Codex-related coordination but treats Codex as a special executor path. `codex_invocations` stores prompt packet paths and status. `src/execution/reviewExecutor.ts` can execute approved review work through configured local tools such as Codex, Claude Code, or Gemini, but this is command execution for approved implementation reviews, not an always-available API provider.

Confirmed: `config/defaults/operator-context.md` says deterministic local scripts first, local automation second, Codex only for code changes or reviewable plans.

## Where The Intelligence Gateway Fits

The gateway should fit as a built-in capability module, likely `src/capabilities/intelligence/*`, with capability migrations for Intelligence Request metadata and provenance. It should use the core API to attach Artifacts, append Logs, emit events, and create Decisions or approval gates.

Policy and routing should live in a focused module under the capability or `src/intelligence/*` only if shared broadly. The first version should not alter the general `execution_plans` executor enum unless the Action execution loop must directly schedule intelligence steps.

CLI entry points should follow existing command conventions under `src/commands/intelligence.ts` and be registered in `src/cli.ts`.

Dashboard visibility should extend `buildDashboardSnapshot` with intelligence-specific health, budget, blocked request, and recent request summaries.

## Assumptions

- The first implementation can use capability migrations instead of editing the core baseline schema first.
- Local LiteLLM Proxy will be installed and operated outside Arcadia unless a later Decision approves a bundled dev environment.
- Usage and cost data may be unavailable from some providers; Arcadia should store nullable usage fields and LiteLLM response metadata when present.
- The first companion-app caller can be simulated through CLI/API contract tests; direct Rebuster code changes are out of scope.
