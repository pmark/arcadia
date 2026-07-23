# Arcadia Capability Modules: Blogging v1

## Plan Status (as of 2026-06-24)

This document is the design plan for the first Arcadia capability-module boundary, proven out with a Blogging module. **A first implementation slice exists and is committed** (commit `ea05ae1`, "plugin modules and blogging"):

- `src/capabilities/core.ts`, `coreApi.ts`, `migrations.ts`, `registry.ts`
- `src/capabilities/blogging/{module,actions,artifacts,repository}.ts`
- `src/commands/blog.ts`
- `tests/blogging-capability.test.ts` (passing: 1 file, 1 test; full suite `pnpm test` — 16 files, 264 tests, all passing)
- `database/schema.sql` already has `capability_migrations` and `events` tables added (`PRAGMA user_version = 7`). Blog-specific tables (`blog_sites`, `blog_ideas`, `blog_posts`, `blog_schedules`) live in `src/capabilities/blogging/module.ts` as module-owned migrations, not in core `schema.sql` — consistent with the contract below.

All six items raised in the 2026-06-24 review have been resolved against the actual code (see "Resolved Decisions" below; the open-questions list that used to follow has been removed). Two are pure documentation fixes (no behavior change). Four describe behavior that the existing implementation already gets right, once verified against the code rather than assumed from this doc's prior wording. **No production code changed as part of this reconciliation pass** — per Mark's instruction, further implementation (NL intake aliases, events consumer, `create_brief`/`record_published` commands) stays out of scope until this doc is reviewed and signed off again.

Two implementation gaps were found and are tracked below rather than silently assumed complete: `blogging.create_brief` and `blogging.record_published` are declared in `module.ts`'s `commands` list and in this doc's "Actions" section, but have no `actions.ts` function, no CLI command, and no test coverage. The Brief and Published/Logged pipeline stages described below are therefore not yet implemented — only Idea, Draft, and Review are.

## Summary

Current milestone: design the first practical capability module boundary for Arcadia.

Next action: implement a local, modular-monolith capability layer and prove it with Blogging.

Work classification: Codex planning now; Codex build for implementation; Mark approval required before publishing or claims.

Required artifacts: capability contract doc, SQLite migrations, TypeScript core API wrapper, Blogging CLI/dashboard surfaces, test fixtures, visible blog draft/review/mission-log artifacts.

Arcadia Core remains the steward/orchestrator. Capability modules add domain workflows but do not become microservices, generic agents, or direct writers to core tables. Modules may own tables, but they interact with core through constrained APIs that create work items, review items, artifacts, mission logs, approval gates, and events.

## Current-State Assumptions

Verified in repo:

- Core concepts already exist in SQLite and TypeScript: `projects`, `project_metadata`, `milestones`, `work_items`, `review_items`, `artifacts`, `mission_logs`, `execution_*`, `approval_gates`, `ask_requests`, `back_burner_items`, and Codex records in [database/schema.sql](../database/schema.sql).
- Existing repository helpers already cover much of the desired API surface: `getProjectContext`, `createWorkItemWithOptionalArtifact`, `createReviewItem`, `createArtifactRecord`, `createMissionLog`, `createApprovalGate` in [src/db/repositories.ts](../src/db/repositories.ts).
- Intake/router is deterministic and intentionally narrow; unknown or uncertain inputs become review/back-burner rather than automatic execution in [src/intake/index.ts](../src/intake/index.ts) and [src/commands/ask.ts](../src/commands/ask.ts).
- Dashboard snapshots are read-only and already aggregate review/action/artifact/project state in [src/dashboard/snapshot.ts](../src/dashboard/snapshot.ts).
- The dashboard already supports phone-suitable review actions and artifact links in [apps/dashboard/components/dashboard-ui.tsx](../apps/dashboard/components/dashboard-ui.tsx).

Must verify during implementation:

- Whether Arcadia workspace data already contains projects named Martian Rover, MIDI Opener, and Rebuster.
- Whether `project_metadata.repo_path` is configured for each project.
- Where each project's website/blog repo stores content, routes, frontmatter, and drafts.
- Whether any existing blog artifacts or schedules already exist outside Arcadia's DB.
- Whether the dashboard should show Blogging on the home screen or a dedicated `/capabilities/blogging` page first.

## Proposed Architecture

Add a small capability layer inside the existing TypeScript monolith:

- `src/capabilities/core.ts`: defines `CapabilityModule`, `CapabilityRuntime`, `CapabilityCommand`, permissions, dashboard surfaces, and MCP metadata placeholders.
- `src/capabilities/registry.ts`: registers built-in modules in-process; no dynamic package loading for v1.
- `src/capabilities/coreApi.ts`: wraps existing repository helpers into constrained core APIs:
  - `readProjectContext(projectId)`
  - `createWorkItem(input)`
  - `createReviewItem(input)`
  - `attachArtifact(input)`
  - `appendMissionLog(input)`
  - `emitEvent(input)`
  - `createApprovalGate(input)`
  - `registerCapability(module)`
- `src/capabilities/blogging/*`: Blogging module schema, repository, actions, deterministic markdown artifact writers, and dashboard query helpers.
- `src/commands/capability.ts` or `src/commands/blog.ts`: explicit CLI entrypoints before natural-language intake expansion.
- `apps/dashboard/*`: add minimal Blogging snapshot fields and phone-first panels.

Core owns stewardship and audit history. Blogging owns blog-specific planning state. Blogging can create core records only through `CapabilityRuntime.core`, never by arbitrary writes to core tables.

Do not implement MCP in v1. Preserve action/resource names so later MCP adapters can expose stable boundaries such as `arcadia.blog.create_idea`, `arcadia.blog.prepare_schedule`, `arcadia.blog.draft_post`, `arcadia.review.create`, and `arcadia.artifact.attach`.

## Capability Contract v1

Each module exports a boring deterministic object:

```ts
interface CapabilityModule {
  id: string;              // "blogging"
  name: string;            // "Blogging"
  version: string;         // "0.1.0"
  migrations: CapabilityMigration[];
  commands: CapabilityCommand[];
  eventHandlers: CapabilityEventHandler[];
  permissions: CapabilityPermission[];
  artifactTypes: CapabilityArtifactType[];
  dashboardSurfaces: CapabilityDashboardSurface[];
  mcp?: {
    resources?: string[];
    tools?: string[];
  };
}
```

Contract details:

- Migrations are SQL strings applied by Arcadia startup (`src/db/schema.ts: applyInitialSchema` → `applyMigrations` → `applyCapabilityMigrations`, last in the sequence) using a `capability_migrations` table with `(module_id, migration_id, version, applied_at)` as primary key `(module_id, migration_id)`. Core `schema.sql` and the ad-hoc core migrations in `applyMigrations` always run first, so module migrations can assume `projects`, `artifacts`, `review_items`, and `mission_logs` already exist.
- Commands are deterministic action handlers with typed input/output, a declared `permission`, and declared `approvalGates`. The `permission` field is descriptive metadata, not a runtime gate — see "Resolved Decisions" #1 for why that's the correct model for v1.
- Event handlers are synchronous in-process hooks for core events; v1 starts with `emitEvent` writing to an `events` table. `src/dashboard/snapshot.ts`'s `persistedActivityEvents` already reads that table into the dashboard activity feed — see "Resolved Decisions" #3.
- Permissions classify actions as `autonomous`, `codex`, `requires_review`, or `blocked`. In practice (matching the existing `WorkClassification` convention used for core work items), these are labels that route a command's output to the right queue/review surface — they are not checked by a dispatcher before a handler runs.
- Approval gates reuse existing gate types: `publication`, `credentials_required`, `external_deployment`, `destructive_filesystem_changes`, `production_data_access`, `financial_action`, `merge_to_main`, `send_email_or_messages`.
- Artifact types are strings such as `blog_idea`, `blog_brief`, `blog_draft`, `blog_schedule`, `blog_publish_checklist`.
- Dashboard surfaces are query functions, not React plugins, for v1.

Add minimal core tables:

```sql
CREATE TABLE capability_migrations (
  module_id TEXT NOT NULL,
  migration_id TEXT NOT NULL,
  version TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (module_id, migration_id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_module TEXT,
  project_id TEXT,
  work_item_id TEXT,
  artifact_id TEXT,
  review_item_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

## Blogging Module v1

Schema:

```sql
CREATE TABLE blog_sites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  site_url TEXT,
  content_repo_path TEXT,
  content_root TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused','missing_setup')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE blog_ideas (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('captured','briefed','drafted','deferred','archived')),
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (site_id) REFERENCES blog_sites(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

CREATE TABLE blog_posts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  idea_id TEXT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('idea','brief','draft','review','scheduled','published','logged')),
  scheduled_for TEXT,
  published_at TEXT,
  artifact_id TEXT,
  review_item_id TEXT,
  mission_log_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (site_id) REFERENCES blog_sites(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (idea_id) REFERENCES blog_ideas(id) ON DELETE SET NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL,
  FOREIGN KEY (review_item_id) REFERENCES review_items(id) ON DELETE SET NULL,
  FOREIGN KEY (mission_log_id) REFERENCES mission_logs(id) ON DELETE SET NULL
);

CREATE TABLE blog_schedules (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','needs_review','approved','deferred')),
  artifact_id TEXT,
  review_item_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (site_id) REFERENCES blog_sites(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

`blog_sites`/`blog_ideas`/`blog_posts`/`blog_schedules` cascade-delete from `projects`. This matches the existing core convention (`project_metadata` and `milestones` in `database/schema.sql` already cascade from `projects` the same way) and is safe in practice because **Arcadia has no `delete-project` command anywhere in the codebase** — project deletion isn't a reachable action through any CLI/dashboard path today, so there is nothing for a Blogging-specific gate to intercept. If a project-deletion command is ever added, it should get its own approval gate at that single point (e.g. `destructive_filesystem_changes`); Blogging's FKs don't need their own independent gate to inherit that protection. See "Resolved Decisions" #5.

Streams (`martian_rover`, `midi_opener`, `rebuster`) are seed/example data for the three known projects, not a hardcoded constraint: `blog_sites.stream_key` has no `CHECK` constraint and `upsertBlogSite`/`configureBlogSite` accept any caller-supplied `streamKey` (normalized via `normalizeStreamKey` in `repository.ts`). New streams are added simply by calling `blogging.configure_site` with a new key. See "Resolved Decisions" #6.

Pipeline (Idea, Draft, and Review stages are implemented; Brief and Published/Logged are not — see "Plan Status"):

- Idea: create `blog_ideas`, attach `blog_idea` markdown artifact, append mission log. **Implemented** (`createBlogIdeaAction`).
- Brief: create local brief artifact from deterministic template and project context. **Not implemented.** No `createBriefAction`, no CLI command, no `blogBriefMarkdown` template (only the `"brief"` literal exists in `artifacts.ts`'s `artifactKind` union, unused).
- Draft: scaffold markdown draft artifact; AI use optional, never required. **Implemented** (`draftBlogPostAction`) — see action note below.
- Review: create core `review_items` for voice, claims, strategy, and publish readiness. **Implemented** for schedules and drafts (`prepareBlogScheduleAction`, `draftBlogPostAction`).
- Scheduled: update `blog_posts.scheduled_for`; no external scheduling/publishing. **Not implemented.** `blog_posts.stage` allows `'scheduled'` and `blog_schedules` exists, but nothing currently transitions a post's `scheduled_for`/`stage` to `'scheduled'`.
- Published: only after explicit Mark approval and manual/approved publish evidence. **Not implemented** — see `blogging.record_published` below.
- Logged: append mission log and link final artifact. Mission logs are appended at every implemented step; there is no distinct terminal "Logged" stage transition yet.

Actions:

- `blogging.configure_site`: creates/updates `blog_sites`; blocked if project missing. Implemented (`configureBlogSite`).
- `blogging.create_idea`: autonomous; may use recent mission logs as source. Implemented (`createBlogIdeaAction`); the "recent mission logs as source" behavior is just a free-text `source` field today, not an automated mission-log scan — that's NL-intake scope, deliberately deferred.
- `blogging.prepare_schedule`: autonomous; produces `blog_schedule` artifact and review item. Implemented (`prepareBlogScheduleAction`).
- `blogging.create_brief`: autonomous; creates `blog_brief` artifact. **Not implemented** — declared in `module.ts`'s `commands` list only.
- `blogging.draft_post`: autonomous scaffold step that always also opens a review item and a pending `publication` approval gate (matches `prepareBlogScheduleAction`'s pattern exactly). The implementation never branches into a `codex` code-change path — pipeline/content-repo code changes are out of scope for this command entirely and would be filed as an ordinary Codex work item through `coreApi.createWorkItem`, not a tier `draft_post` executes. See "Resolved Decisions" #2.
- `blogging.mark_review`: creates review item and approval gate. Not a separate command in the implementation — `blog.list_review_needed` (`listBlogReviewNeededAction`) reads existing open review items joined to Blogging rows; review-item/gate creation happens inline inside `prepare_schedule` and `draft_post`, not as its own action.
- `blogging.record_published`: needs Mark; records published URL/date and mission log, but does not deploy or publish. **Not implemented** — declared in `module.ts`'s `commands` list only; no action, no CLI command, no test.

Artifacts should live under `artifacts/blogging/<site>/<YYYY-MM-DD>-<slug>.md` unless an implementation finds an existing workspace artifact convention that is more specific.

## Safety, UX, and MCP Horizon

Action classification:

- Autonomous: deterministic scheduling, idea organization, brief/draft scaffolds, metadata generation, local artifact writing, dashboard snapshots.
- Codex: code changes, route creation, content pipeline implementation, migrations/tests.
- Requires Review: voice approval, strategic positioning, publishing approval, sensitive claims, final publish confirmation.
- Blocked: missing project, missing site config, missing repo path/content root, missing credentials, missing strategic decision.

No deployment, publishing, spending, message sending, credential access, destructive filesystem action, or merge without explicit approval gate resolution.

Smallest dashboard surfaces:

- Capability list: `Blogging` with configured/missing setup count.
- Blog status per project: stream, stage counts, next scheduled post.
- Drafts needing review: reuse existing review cards where possible.
- One-tap approve/reject/defer/clarify: reuse current review APIs.
- Artifact links: schedule, brief, draft, publish checklist.
- Phone-first path: add a compact "Blogging" section to the dashboard snapshot before building a complex module UI.

MCP horizon:

- Do not add MCP runtime in v1.
- Keep command handlers pure enough that a future MCP adapter can map tools/resources directly:
  - `arcadia.blog.create_idea`
  - `arcadia.blog.prepare_schedule`
  - `arcadia.blog.draft_post`
  - `arcadia.blog.list_review_needed`
  - `arcadia.review.create`
  - `arcadia.artifact.attach`

## First Implementation Slice

Implement in days, not months:

1. Add capability migration tracking, `events`, and in-process registry.
2. Add Blogging schema and repositories.
3. Add explicit CLI commands:
   - `arcadia blog configure-site <project> --stream <key> ...`
   - `arcadia blog create-idea --site <id> --title ...`
   - `arcadia blog prepare-schedule --site <id> --week <YYYY-MM-DD>`
   - `arcadia blog draft-post --idea <id>`
   - `arcadia blog review`
4. Generate markdown artifacts for ideas, schedules, and scaffold drafts. (Briefs are not yet implemented — see "Plan Status".)
5. Create review items for schedules/drafts that require Mark approval.
6. Append mission logs for each action.
7. Extend dashboard snapshot with `capabilities.blogging` and render one compact Blogging panel.
8. Add deterministic intake aliases only after CLI behavior is tested:
   - "Prepare next week's MIDI Opener blog schedule."
   - "Draft the next Rebuster update post."
   - "Show blog posts that need my review."
   - "Create a Martian Rover build-in-public post idea from recent mission logs."

Steps 1–7 are implemented and covered by `tests/blogging-capability.test.ts`. **Step 8 (intake aliases) is explicitly out of scope until this plan is reconciled and re-approved** — do not wire these up yet, per Mark's standing instruction for this reconciliation pass.

Acceptance behavior:

- Preparing next week's MIDI Opener schedule creates a schedule artifact, schedule row, review item, event, and mission log.
- Drafting the next Rebuster update creates or advances a post to `draft`, attaches a markdown artifact, creates review if needed, and logs the action.
- Showing posts needing review reads Blogging rows joined to open core review items.
- Creating a Martian Rover idea from recent logs reads local mission logs, creates an idea artifact, links it to the project/site, emits event, and logs the result.

## Test Plan

Add unit/integration coverage with temporary workspaces. Current status against `tests/blogging-capability.test.ts` (one test, asserted end-to-end in a single workspace):

- Capability migrations are idempotent and recorded once. **Not directly asserted** (no test reopens a workspace and checks no duplicate insert); `countRows(... "capability_migrations") >= 1` is checked, but idempotency itself relies on `migrations.ts`'s `(module_id, migration_id)` primary key, unverified by this test.
- Blogging site config fails cleanly for missing project and succeeds for configured project. **Partially covered** — success path only; the missing-project failure path is not asserted in this test (though `requireProjectContext`/`configureBlogSite` do throw).
- `create_idea` creates `blog_ideas`, core artifact, event, and mission log. **Covered.**
- `prepare_schedule` creates `blog_schedules`, artifact, review item, approval gate `publication`, and mission log. **Covered** for schedule/artifact/review item/mission log; the approval gate row itself isn't directly asserted (no `approval_gates` row count check), only the review item and event.
- `draft_post` creates/updates `blog_posts` and never publishes. **Covered** for creation; "never publishes" is true by omission (no code path exists to publish) rather than a guarded check.
- Dashboard snapshot includes Blogging status without writing reports. **Covered.**
- Existing tests for ask/review/dashboard still pass. **Covered** — full suite is 16 files / 264 tests, all passing.
- CLI JSON envelopes follow existing `CommandSuccess` shape. **Covered** by construction (`createSuccess` reused from `cli/response.ts`).

Gaps worth closing in a follow-up test pass (not done in this reconciliation, since it's doc-only): missing-project failure path, explicit `approval_gates` row assertions, and a second-run idempotency check for `capability_migrations`.

Run:

```text
pnpm test
pnpm build
pnpm smoke
```

## Risks and Simplifications

Risks:

- Natural-language intake may over-match blog requests if added too early.
- Blog content conventions may differ across Martian Rover, MIDI Opener, and Rebuster repos.
- "Recent mission logs" can produce noisy ideas unless deterministic filters are simple.
- Dashboard scope can expand quickly if module UI is treated as a full CMS.

Simplifications:

- Start with explicit `arcadia blog ...` commands.
- Store module data in SQLite, long-form content in Markdown artifacts.
- No background workers, plugin loading, MCP server, publishing integration, or cross-repo writes in v1.
- Treat generated posts as local drafts and review artifacts, not deployable content.
- Use existing review and approval gates instead of inventing module-specific approval systems.

## Resolved Decisions

Raised in review on 2026-06-24. All six checked against the actual code in `src/capabilities/` and `src/commands/blog.ts` (not assumed from the prior wording of this doc) and resolved on 2026-06-24. No production code changed to resolve any of these — all six were either already correct or are pure documentation fixes.

1. **Permission enforcement point — resolved, no code change needed.** There is no dispatcher anywhere that reads `CapabilityCommand.permission` and gates a handler call (confirmed: `grep` for `.permission` and `dispatch` across `src/` finds only the type declaration and the literal values in `module.ts`; nothing reads them at runtime). That's intentional and matches how the rest of Arcadia already works: `WorkClassification` on core `work_items` (`src/domain/constants.ts`) is the same kind of label — it routes a record to a queue (`queueForWorkClassification`), it doesn't block a function call. Arcadia's actual safety property is structural, not a runtime check: code that performs an `autonomous` action is the only code that exists for that action; code for a `requires_review` action (e.g. actually publishing) is simply never written until Mark approves out-of-band — confirmed system-wide, `approval_gates` rows are only ever inserted with `status: 'pending'` (`createApprovalGate` in `src/db/repositories.ts`) and **no command anywhere in the codebase ever updates an approval gate's status**. `blogging.draft_post` and `blogging.prepare_schedule` follow this exactly: they write local artifacts/DB rows and open a pending gate, and stop — there is no further code path that would need gating. `permission` stays as descriptive/dashboard/future-MCP-routing metadata, as already implemented. No enforcement point needs to be named because none is missing.
2. **`blogging.draft_post`'s three tiers — resolved, doc clarification only.** Reading `draftBlogPostAction` (`src/capabilities/blogging/actions.ts`), the implementation only ever does one thing: write a scaffold artifact, create a review item, and open a pending `publication` gate — the exact same two-step shape as `prepareBlogScheduleAction`. There is no conditional branch into a `codex` code-change path inside this command, and there shouldn't be: pipeline/content-repo code changes are a different kind of work entirely (filed as an ordinary Codex work item via `coreApi.createWorkItem`, same as any other code change), not something `draft_post` itself executes or branches into. The plan's "mixes three permission tiers" framing was inaccurate — updated the "Actions" section above to describe what the command actually does (autonomous scaffold + requires_review gate, no codex branch) rather than implying runtime tier-switching.
3. **`events` table consumer — resolved, a consumer already exists.** `src/dashboard/snapshot.ts`'s `persistedActivityEvents` (called from `buildActivityEvents`) already `SELECT`s from `events` and folds rows into the dashboard's `activityEvents` feed alongside ask/work/review/artifact events. `tests/blogging-capability.test.ts` asserts `blog.idea_created` and `blog.schedule_prepared` show up there. Keep `emitEvent` — it's not infrastructure-ahead-of-need, it's already load-bearing for the one dashboard feed Blogging needs.
4. **Migration runner robustness — resolved, already adequate for v1.** `src/db/schema.ts: applyInitialSchema` runs core `schema.sql`, then `applyMigrations` (core ad-hoc migrations), then `applyCapabilityMigrations` last — so module migrations can always assume core tables exist; ordering is guaranteed by call sequence, not convention. Idempotency: `capability_migrations` has primary key `(module_id, migration_id)`, and `applyModuleMigrations` checks for an existing row before running each migration. Partial failure: each migration's `db.exec(migration.sql)` + the tracking `INSERT` are wrapped in one `db.transaction()`, so a single migration is all-or-nothing — a failure rolls back that migration only (previously-committed migrations in the same module stay applied, which is correct since they're independently idempotent `CREATE TABLE IF NOT EXISTS` statements) and isn't recorded as applied, so it retries on the next startup. This is sufficient for v1's all-additive, all-idempotent migration SQL; revisit only if a future migration needs to be destructive or multi-table-rewrite (like `rebuildTableWithCurrentSchema` in `schema.ts` already does for core tables).
5. **Cascade delete policy — resolved, not actually a gap.** `blog_sites`/`blog_ideas`/`blog_posts` cascading from `projects` matches the existing core convention (`project_metadata`, `milestones` already cascade the same way in `database/schema.sql`), and there is **no `delete-project` command anywhere in Arcadia** — project deletion isn't reachable through any CLI or dashboard path today, so there's no in-product action for a gate to intercept. Added a note in the "Blogging Module v1" section above; no schema change needed. If a project-deletion command is ever built, give *that* command the gate (`destructive_filesystem_changes`) — Blogging's FKs will inherit the protection for free without needing a module-specific gate.
6. **Hardcoded streams — resolved, already runtime-configurable.** `blog_sites.stream_key` has no `CHECK` constraint restricting it, and `upsertBlogSite`/`configureBlogSite` accept any caller-supplied stream key (normalized by `normalizeStreamKey`). `martian_rover`/`midi_opener`/`rebuster` were never enforced in code — they're just the three streams Mark's projects need today. Reworded the "Blogging Module v1" section above from "Required streams" to "Streams (seed data)" to stop the doc overstating a constraint that doesn't exist.

Outstanding, tracked separately from these six (not part of the original review, found during this reconciliation pass — see "Plan Status"): `blogging.create_brief` and `blogging.record_published` are declared in the contract and in `module.ts`'s command list but have no implementation. These are deferred, not blocking, per Mark's instruction not to expand scope in this pass.
