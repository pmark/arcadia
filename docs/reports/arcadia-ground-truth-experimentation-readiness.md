# Arcadia Ground Truth: Experimentation Readiness

## Executive Summary

Arcadia already implements a useful local-first mission-control loop: capture or ask, deterministic intake/stewardship, Action creation, optional workflow plan creation, Requires Review Decisions, Codex packet generation, guarded Codex planning execution, run evidence, Artifact records, Log records, dashboard visibility, Discord ingress, and local file ingress. SQLite is the operational truth, while Markdown and JSON files provide readable artifacts and evidence.

What is missing is not a generic execution platform. The gap is an explicit experimentation layer: Opportunity, Experiment, hypothesis, metric, baseline, evidence snapshot, analysis report, and Decision-to-Project-update semantics are not first-class tables or CLI/dashboard flows. Some adjacent support exists in Back Burner items, work_items, artifacts, review_items, mission_logs, events, Rebuster events, Blogging ideas, ask_feedback, and Intelligence jobs.

Recommended next increment: add a minimal deterministic "experiment brief" slice that reuses existing tables first. It should promote a captured Idea or Back Burner item into one Action, create one Markdown Artifact containing Opportunity, Experiment, hypothesis, metric, baseline, evidence needed, Decision criteria, and Project update target, then create one open Decision to approve or revise that experiment. Avoid a new analytics warehouse, graph, or task system.

## Current Repo Shape

- Root package: TypeScript CLI package `@pmark/arcadia`, Node >=20, `pnpm arcadia` runs `tsx src/cli.ts`; build/test/dashboard scripts are in `package.json:32`.
- CLI: `src/cli.ts` registers commands for init/config/workspace/dogfood/status/ask/capture/back-burner/feedback/project/inbox/ingress/milestone/artifact/queue/report/review/work/run/codex/dashboard/blog/rebuster/intelligence/worker. Command imports show the main command modules at `src/cli.ts:10`.
- SQLite: canonical schema is `database/schema.sql`, loaded by `src/db/schema.ts:22` and applied on every writable open via `src/db/connection.ts:5`.
- Core repositories: `src/db/repositories.ts` is the main persistence layer for Projects, Milestones, Actions, Artifacts, Decisions, Back Burner, approval gates, Codex invocations/tasks, and Runs.
- Dashboard: Next app under `apps/dashboard`. Pages include Mission Control, Capture, Projects, Project detail, Review, Back Burner, Runs, Run detail, Momentum, and Admin Intelligence. The dashboard reads via `/api/snapshot` and also posts ask/review/run/back-burner/feedback/project setup actions.
- Discord adapter: `apps/discord-bot` exists and tests cover slash commands, request ingress, review actions, run status, Codex task visibility, and notifications.
- Intelligence service: `src/intelligence` implements a local v0.1 job service/API with SQLite repository, LiteLLM/Codex routes, artifacts, validation, and HTTP routes.
- Capability modules: `src/capabilities/blogging` and `src/capabilities/rebuster` add module migrations, commands, artifacts, events, and dashboard surfaces.
- Reports/docs/specs: `docs/`, `specs/`, `artifacts/`, `mission_logs/`, and `projects/` contain product docs, audits, plans, and generated/readable artifacts.

## Existing Operational Loop

Implemented loop:

1. Capture/ask input enters through CLI `ask` (`src/cli.ts:394`), CLI `capture` (`src/cli.ts:424`), dashboard ask form (`apps/dashboard/app/page.tsx:31`), mobile capture page (`apps/dashboard/app/capture/page.tsx:21`), local file ingress (`src/commands/ingress.ts:81`), Discord tests, and dogfood shortcuts (`src/cli.ts:289`).
2. `ask` normalizes input, loads deterministic registries, resolves intake, runs stewardship, and either acts, creates a Decision, stores a Back Burner item, or creates Action/Plan/Codex packet records (`src/commands/ask.ts:105`).
3. High-confidence project creation and project updates can execute directly (`src/commands/ask.ts:297`, `src/commands/ask.ts:351`).
4. Low-confidence/non-actionable input is preserved in Back Burner (`src/commands/ask.ts:474`).
5. Clarification or approval needs become open `review_items` Decisions (`src/commands/ask.ts:525`).
6. Concrete Actions create `work_items`, `execution_plans`, approval gates, and optional Codex packets (`src/commands/ask.ts:592`, `src/commands/ask.ts:714`).
7. Review commands list/show/approve/reject/defer/resolve Decisions (`src/commands/review.ts:173`, `src/commands/review.ts:298`).
8. Work plans and runs use deterministic skills by default; Codex planning requires an approved packet-specific Decision (`src/commands/work.ts:144`, `src/execution/planningAuthorization.ts:60`).
9. Runs produce run step evidence, artifacts, planning validation sidecars, follow-up Decisions, and mission logs (`src/execution/runner.ts:100`, `src/execution/runner.ts:548`, `src/execution/runner.ts:894`).
10. Dashboard snapshot aggregates Projects, current Milestones, Decisions, Back Burner, recent Runs, recent Artifacts, activity events, Blogging, and Rebuster (`src/dashboard/snapshot.ts:344`).

Important discrepancy: README says the dashboard is read-only (`README.md:79`), but current dashboard code posts ask/review/run/back-burner/feedback/project setup actions (`apps/dashboard/lib/arcadia-cli.ts:46`, `apps/dashboard/app/api/review-action/route.ts:17`, `apps/dashboard/app/api/projects/[id]/route.ts:18`).

## SQLite Ground Truth

Core tables in `database/schema.sql`:

- `projects`: id/name/slug/mission/goal/status/timestamps (`database/schema.sql:3`). `goal` is still the stored field; repository projections expose `goal AS outcome` (`src/db/repositories.ts:450`).
- `project_metadata`: aliases, repo path, status summary, validation commands (`database/schema.sql:14`).
- `milestones`: project-owned title/status (`database/schema.sql:25`).
- `work_items`: Action-like records with project, milestone, title, raw input, queue, work_classification, next_action, expected_artifact, status (`database/schema.sql:35`).
- `mission_logs`: work performed, result, blockers, next_action, artifact_impact, markdown_path (`database/schema.sql:52`).
- `artifacts`: project/work links, title, artifact_type, status, path (`database/schema.sql:68`).
- `skill_definitions`, `execution_plans`, `execution_plan_steps`, `execution_runs`, `execution_run_steps`, `run_artifacts` implement workflow planning, execution, evidence, and run-artifact linkage (`database/schema.sql:82`, `database/schema.sql:120`, `database/schema.sql:155`).
- `ask_requests`: raw_request, resolved_intent, output_kind, stewardship_json, work/plan/prompt packet links, status (`database/schema.sql:164`).
- `review_items`: Decision-like records with ask/work/plan/project/artifact/Codex links, decision_needed, recommendation, source/proposed action, confidence, missing fields, context_json, decision note, resulting ask (`database/schema.sql:181`).
- `review_feedback` and `ask_feedback`: durable correction/quality feedback (`database/schema.sql:214`, `database/schema.sql:228`).
- `back_burner_items`: original input, ingress source, classification including Idea, confidence, reason, status, suggested next step, promoted Action link (`database/schema.sql:241`).
- `approval_gates`: explicit sensitive-work gates (`database/schema.sql:271`).
- `codex_invocations` and `codex_tasks`: prepared/managed Codex packet runs and observed external Codex tasks/goals (`database/schema.sql:297`, `database/schema.sql:319`).
- `capability_migrations` and `events`: module migration ledger and generic activity/event stream (`database/schema.sql:340`, `database/schema.sql:348`).

Additional tables are created by migrations:

- Compatibility and additive migrations are in `src/db/schema.ts:31`, including Back Burner, ask stewardship, review compatibility, Decision-gated planning, ask feedback, and Intelligence jobs.
- Intelligence jobs and artifacts are created by `ensureIntelligenceJobsTable` and `ensureIntelligenceJobArtifactsTable` (`src/db/schema.ts:200`, `src/db/schema.ts:248`).
- Blogging adds `blog_sites`, `blog_ideas`, `blog_posts`, `blog_schedules` (`src/capabilities/blogging/module.ts:9`).
- Rebuster adds `rebuster_integrations` and `rebuster_events` (`src/capabilities/rebuster/module.ts:9`).

Actively used and tested:

- Project/Milestone/Action/Artifact/Log primitives are created through repository functions (`src/db/repositories.ts:350`, `src/db/repositories.ts:393`, `src/db/repositories.ts:421`, `src/db/repositories.ts:1221`) and covered by Phase 0 tests (`tests/phase0.test.ts:138`).
- Ask/Decision/Back Burner/approval/Codex records are created by `ask` and covered in Phase 3 tests (`tests/phase3.test.ts:139`, `tests/phase3.test.ts:226`, `tests/phase3.test.ts:261`).
- Run and planning authorization records are covered by Decision-gated tests (`tests/decision-gated-planning.test.ts:27`) and planning artifact workflow tests (`tests/planning-artifact-workflow.test.ts:42`).
- Dashboard snapshot reads the above and is tested (`tests/dashboard-snapshot.test.ts:37`).
- Ingress mission logs/sidecars are tested (`tests/ingress.test.ts:29`).

## Markdown / Artifact Ground Truth

- Mission Log Markdown paths are generated under `mission_logs/YYYY/MM/` with date/project slug and duplicate suffix handling (`src/markdown/missionLog.ts:14`), then rendered with Work Performed, Result, Blockers, Next Action, and Artifact Impact (`src/markdown/missionLog.ts:30`).
- Status reports write `reports/status.md` from SQLite state (`src/markdown/statusReport.ts:85`) and include Projects, Milestones, Next Actions, queues, responsibilities, Logs, Artifacts, and counts (`src/markdown/statusReport.ts:16`).
- Weekly reviews write `reports/weekly/<date>.md` from SQLite state (`src/markdown/weeklyReview.ts:14`) and include completed Actions, Logs, blocked Actions, Decisions, active Codex/autonomous Actions, Artifacts, Projects without next Actions, and suggestions (`src/markdown/weeklyReview.ts:26`).
- Deterministic execution artifacts can write specifications and publication packets under `artifacts/specifications` and `artifacts/publication-packets` (`src/markdown/executionArtifacts.ts:8`, `src/markdown/executionArtifacts.ts:34`).
- Codex packets are written to `prompts/codex/<invocationId>/prompt.md`, with output/final/metadata/critique files (`src/codex/packets.ts:51`). Corresponding `artifacts` records are created for prompt packets and critiques (`src/commands/ask.ts:743`).
- Planning validation writes `planning-validation.json` beside the final planning artifact and records a `planning_artifact_validation` Artifact (`src/execution/runner.ts:618`, `src/execution/runner.ts:630`).
- Standalone planning validation reads packet/artifact files and returns machine-readable failures/warnings (`src/commands/artifact.ts:72`, `src/stewardship/artifactValidator.ts:47`).

Artifact limitations:

- Generic Artifact records have type/status/path but no required schema for Opportunity, Experiment, metric, baseline, evidence snapshot, or analysis.
- Artifact paths are stored and surfaced, but Markdown content is mostly convention-specific by writer. Validation exists for planning artifacts only.

## Project Model Ground Truth

Implemented:

- Projects have `name`, `slug`, `mission`, `goal`/Outcome alias, status, and timestamps (`database/schema.sql:3`, `src/db/repositories.ts:246`).
- Project statuses are `active`, `paused`, `incubating`, `completed` (`database/schema.sql:9`).
- Project metadata stores aliases, repo path, status summary, and validation commands (`database/schema.sql:14`).
- `project create` with defaults creates an Incubating Project, initial Milestone, initial Action, metadata, project files, and an initial Log (`src/commands/project.ts:107`).
- `project import` creates a Project, active Milestone, and initial Action without prompts (`src/commands/project.ts:204`).
- `project metadata` and dashboard project setup update repo path and validation commands (`src/commands/project.ts:305`, `apps/dashboard/app/api/projects/[id]/route.ts:18`).
- Dashboard Project detail shows repository, current Milestone, next Action, Responsibility, Outcome, last Artifact, related Runs, Artifacts, activity, and setup warnings (`apps/dashboard/app/projects/[id]/page.tsx:123`).

Compatibility/semantic notes:

- Stored `projects.goal` is exposed as `outcome` in repository selects (`src/db/repositories.ts:450`) and dashboard types (`src/dashboard/snapshot.ts:71`).
- Stored `work_classification` is exposed as Responsibility in many user-facing labels (`src/commands/capture.ts:70`, `src/markdown/statusReport.ts:45`).
- Domain exists as canonical semantics in `docs/arcadia-semantics.md`, but no `domains` table or implemented Domain model was found.
- Mission exists as a real `projects.mission` field. Milestone exists as a real table. Next Action exists as `work_items.next_action` and summary view fields, not as a separate durable object. Decision exists mostly through legacy `review_items`.

## Work / Review / Approval Ground Truth

Implemented:

- Actions are stored in `work_items`, created directly by capture (`src/commands/capture.ts:25`), ask (`src/commands/ask.ts:592`), project creation/import (`src/db/repositories.ts:350`), and Back Burner promotion (`src/commands/backBurner.ts:122`).
- Work planning creates `execution_plans` and `execution_plan_steps` from built-in skills (`src/commands/work.ts:117`, `src/execution/skills.ts:147`).
- Safe deterministic execution supports workspace validation, status report, weekly review, publication packet, weekly update draft, specification artifact, and run Log creation (`src/execution/runner.ts:820`).
- Requires Review Decisions are real persisted records in `review_items`, listable/actionable through CLI and dashboard (`src/commands/review.ts:173`, `apps/dashboard/app/review/page.tsx:17`).
- Decisions can be approved/rejected/deferred; approval can replay intended ask workflows or queue managed planning runs (`src/commands/review.ts:298`).
- Approval gates exist in `approval_gates`, with fixed types such as credentials, deployment, publication, destructive changes, production data, financial action, merge to main, and outbound messages (`database/schema.sql:271`).
- Decision-gated Codex planning stores packet digest and blocks modified packet execution (`src/execution/planningAuthorization.ts:96`, `tests/decision-gated-planning.test.ts:55`).

Partially implemented:

- "Work packet" is not a first-class concept. Codex prompt packets and planning artifacts function as durable Artifacts/execution inputs.
- Review/Decision UX exists, but schema and many routes still use `review_items` and `review` naming.
- Approval gates are created and checked for protected planning authorization (`src/execution/planningAuthorization.ts:124`), but generic gate lifecycle UI beyond Decision workflows is limited.

## Codex / Claude / External Execution Ground Truth

Codex:

- Arcadia can prepare Codex planning/build packets (`src/codex/packets.ts:37`).
- It records Codex invocations in SQLite (`src/db/repositories.ts:1676`) and exposes packet-created attention items in the dashboard (`tests/dashboard-snapshot.test.ts:186`).
- Managed Codex planning execution can spawn configured Codex CLI profiles, refuses danger-full-access profiles, captures output, and validates planning artifacts (`src/execution/runner.ts:287`, `src/execution/runner.ts:298`, `src/execution/runner.ts:404`).
- Codex external task observation reads Codex Cloud via `codex cloud list --json` and local Codex goal databases (`src/codex/observer.ts:21`, `src/codex/observer.ts:68`). It stores associations and completion Logs (`tests/phase3.test.ts:53`).
- Intelligence v0.1 also supports Codex CLI as a local image/text route through `src/intelligence` and tests under `test/intelligence`.

Claude/Gemini:

- Review executor tests mention built-in Claude Code and Gemini adapters (`tests/cli-response.test.ts:896`), and review execution routes pass an executor name (`src/commands/review.ts:89`). The inspected core packet generation is Codex-specific. No Claude-specific planning packet table or Claude task observer was found in schema.

External execution:

- Rebuster bridge can call a local CLI or HTTP API for `create_rebus`, and ingests external Rebuster events into SQLite (`src/capabilities/rebuster/actions.ts:127`, `src/capabilities/rebuster/actions.ts:183`).
- Dashboard shells out to the Arcadia CLI for most mutations rather than directly importing all core command logic (`apps/dashboard/lib/arcadia-cli.ts:15`).

## Telemetry / Health / Analytics Ground Truth

Implemented:

- Generic `events` table stores activity events with source module, project/work/artifact/review links, JSON payload, and timestamp (`database/schema.sql:348`). Capability modules emit events through `createCoreCapabilityApi` (`src/capabilities/coreApi.ts:32`).
- Dashboard snapshot surfaces `activityEvents` and counts (`src/dashboard/snapshot.ts:38`, `src/dashboard/snapshot.ts:254`).
- Intelligence service has `/api/intelligence/health`, checking LiteLLM liveliness and reporting enabled routes (`src/intelligence/api/server.ts:74`, `src/intelligence/api/server.ts:198`).
- Rebuster integration stores `last_health_check_at`, `last_sync_at`, event history, decision-required flags, recommendations, and artifact refs (`src/capabilities/rebuster/module.ts:11`, `src/capabilities/rebuster/module.ts:25`).
- Project metadata stores validation commands and status summary (`database/schema.sql:14`).
- Ask feedback stores up/down quality feedback on Ask responses (`database/schema.sql:228`, `src/db/repositories.ts:1626`).

Not found:

- No generic metrics, baseline, experiment measurement, telemetry time-series, analytics warehouse, or project signal scoring model was found.
- `process_analytics_data` exists as a deterministic intent registry entry for planning credentialed analytics work, but it is not an analytics subsystem (`config/defaults/intent-registry.json:150`).

## Experimentation Readiness

| Concept | Status | Ground truth |
| --- | --- | --- |
| Capture | Implemented | CLI/dashboard/ingress/Discord ask and capture paths exist (`src/commands/ask.ts:105`, `src/commands/capture.ts:25`, `src/commands/ingress.ts:81`). |
| Resolved structured item | Implemented | `ask_requests`, `work_items`, `review_items`, Back Burner records store structured outcomes (`database/schema.sql:164`, `database/schema.sql:35`, `database/schema.sql:181`, `database/schema.sql:241`). |
| Idea | Partially Implemented | Back Burner classification includes `Idea`; Blogging has `blog_ideas` (`database/schema.sql:252`, `src/capabilities/blogging/module.ts:25`). No generic Idea table. |
| Opportunity | Missing | No opportunity table, CLI command, dashboard route, or artifact convention found. |
| Prospect | Missing | No prospect model or flow found. |
| Experiment | Missing | Only incidental text such as "Three.js game/experiment" templates and golden request examples. No generic experiment object. |
| Hypothesis | Missing | No hypothesis field/table/artifact convention found. |
| Metric | Missing | No metric table or metric artifact convention found. Dashboard "Metric" is a UI component for counts, not experiment metrics (`apps/dashboard/app/page.tsx:130`). |
| Baseline | Missing | No baseline model found. |
| Evidence snapshot | Partially Implemented | Runs, run steps, Artifacts, mission logs, Rebuster events, and Intelligence job artifacts provide evidence, but not experiment evidence snapshots (`src/db/repositories.ts:1908`, `src/capabilities/rebuster/module.ts:25`). |
| Analysis report | Partially Implemented | Status/weekly reports and planning artifacts exist, but no experiment analysis report convention (`src/markdown/statusReport.ts:16`, `src/markdown/weeklyReview.ts:26`). |
| Decision | Implemented | `review_items` are operational Decisions with status and decision notes (`database/schema.sql:181`, `src/db/repositories.ts:1260`). |
| Follow-up work item | Implemented | Back Burner promotion creates an Action; review approval can create/replay ask and update work (`src/commands/backBurner.ts:122`, `src/commands/review.ts:298`). |
| Project state update | Partially Implemented | Project mission/status/goal and metadata can be updated (`src/commands/project.ts:245`, `src/commands/project.ts:305`); no experiment-result-specific update flow. |
| Review/approval gate | Implemented | Decisions plus approval gates and planning authorization exist (`database/schema.sql:271`, `src/execution/planningAuthorization.ts:60`). |
| Artifact linkage | Implemented | Artifacts link to Projects/Actions and Runs; Decisions can link to artifacts (`database/schema.sql:68`, `database/schema.sql:155`, `database/schema.sql:188`). |

## Tests and Coverage

Relevant implemented/tested areas:

- `tests/phase0.test.ts`: workspace init; schema; Projects, Milestones, Actions, Artifacts, Logs; queues; runs; status and weekly reports.
- `tests/intake.test.ts`: deterministic intake for review/status/project update/create project/create work/low-confidence capture.
- `tests/phase3.test.ts`: Codex Companion observation; registries; ask audit records; project creation through ask; structured Action/Plan/gates/Codex packet; Back Burner preservation; review approval/replies; golden requests; project metadata; project updates.
- `tests/decision-gated-planning.test.ts`: Codex planning Decision creation, packet digest, duplicate approval idempotence, bypass prevention, migration cleanup, orphan recovery.
- `tests/planning-artifact-workflow.test.ts` and `tests/planning-artifact-validator.test.ts`: planning artifact validation, validation failure Decisions, standalone validation CLI.
- `tests/dashboard-snapshot.test.ts`: dashboard snapshot counts, attention, Back Burner, Artifacts, setup warnings, UI label compatibility.
- `tests/ingress.test.ts`: local file ingress, Done/Failed sidecars, mission logs, dry run, ordering, collision handling.
- `tests/e2e/mission-control.spec.ts`: browser-level mission-control loop, planning approval, validation failure, final artifact/log links, Back Burner recovery, deterministic status reports.
- `tests/discord-bot.test.ts`: Discord adapter request/review/run/Codex task behavior and notifications.
- `test/intelligence/*`: Intelligence service contracts, routing, health, image/text jobs, artifacts, Codex executors, Rebuster scenarios, admin bench.
- `tests/blogging-capability.test.ts` and `tests/rebuster-capability.test.ts`: capability module tables, events, artifacts, Decisions, dashboard snapshots.

Not covered because not implemented:

- Generic Opportunity/Experiment/Hypothesis/Metric/Baseline/Evidence Snapshot/Analysis/Decision-to-project-update loop.
- Experiment-specific artifact validation.
- Experiment dashboard route or CLI commands.
- Metrics ingestion or baseline comparison.

## Recommended Minimal Increment

Outcome:

Create the smallest deterministic Opportunity -> Experiment -> Decision path that fits Arcadia's current architecture and canonical vocabulary.

Expected artifact:

One Markdown Artifact, for example `artifacts/experiments/YYYY-MM-DD-<slug>-experiment-brief.md`, linked to an Action and Project. It should contain:

- Opportunity
- Experiment
- Hypothesis
- Metric
- Baseline or "baseline unknown"
- Evidence to collect
- Decision criteria
- Project update target
- Recommended next Action

Acceptance criteria:

- A captured Back Burner Idea or explicit CLI request can create one Action with expected Artifact "Experiment brief".
- The command writes the experiment brief Markdown and records it in `artifacts`.
- The command creates one open Decision asking Mark to approve, revise, defer, or reject the experiment.
- The Decision links to Project, Action, and Artifact.
- Dashboard snapshot shows the Decision and Artifact without new dashboard primitives.
- Existing status/weekly reports include the Action/Artifact through current report sections.
- Tests prove SQLite rows and Markdown contents are created deterministically.

Likely files to change:

- New command module such as `src/commands/experiment.ts` or a narrowly named `src/commands/opportunity.ts`.
- `src/cli.ts` to register one command.
- `src/markdown/executionArtifacts.ts` or a new small `src/markdown/experimentBrief.ts`.
- `src/db/repositories.ts` only if a helper is needed; prefer existing `createWorkItemWithOptionalArtifact`, `createArtifactRecord`, and `createReviewItem`.
- `tests/experiment-brief.test.ts` or similar.
- Optional: dashboard snapshot mapping only if existing Artifact/Decision surfaces do not show enough context.

Data model changes:

- Prefer no new tables in the first slice. Store operational truth through existing `work_items`, `artifacts`, and `review_items`.
- If a schema change is unavoidable, add one small `experiment_briefs` table with `id`, `project_id`, `work_item_id`, `artifact_id`, `review_item_id`, `opportunity`, `hypothesis`, `metric`, `baseline`, `status`, timestamps. Do not add metrics/event time-series yet.

Tests to add:

- Command creates Action, Artifact, Markdown file, and Decision from explicit input.
- Command can promote a Back Burner Idea into the experiment brief flow.
- Invalid missing Project or empty hypothesis/metric fails before writing.
- Dashboard snapshot includes the created Decision and Artifact via existing surfaces.

What not to build yet:

- No generic task manager.
- No experiment analytics warehouse.
- No graph model.
- No automatic metric collection.
- No AI-first opportunity scoring.
- No new agent execution platform.
- No dashboard-heavy custom experiment UI until the CLI/artifact/Decision loop proves useful.

## Open Questions for Mark

- Should "Opportunity" become a user-facing canonical subterm, or should the first slice phrase it as an Artifact section under Project/Outcome/Action?
- Is the first experiment source primarily Back Burner Ideas, explicit project requests, Rebuster signals, or manual CLI entry?
- What is the minimum acceptable metric/baseline format: free-text Markdown, structured JSON in an Artifact, or future SQLite fields?
- Should approving an experiment Decision update Project status summary automatically, or only create a follow-up Action?
