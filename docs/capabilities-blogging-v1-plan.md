# Arcadia Capability Modules: Blogging v1

## Plan Status (as of 2026-06-24)

This document is the design plan for the first Arcadia capability-module boundary, proven out with a Blogging module. **A first implementation slice already exists on disk, untracked in git:**

- `src/capabilities/core.ts`, `coreApi.ts`, `migrations.ts`, `registry.ts`
- `src/capabilities/blogging/{module,actions,artifacts,repository}.ts`
- `src/commands/blog.ts`
- `tests/blogging-capability.test.ts` (currently passing: 1 file, 1 test)
- `database/schema.sql` already has `capability_migrations` and `events` tables added (`PRAGMA user_version = 7`). Blog-specific tables (`blog_sites`, `blog_ideas`, `blog_posts`, `blog_schedules`) live in `src/capabilities/blogging/module.ts` as module-owned migrations, not in core `schema.sql` — consistent with the contract below.

Before continuing implementation, this plan is being revised. **Do not assume the sections below are final** — see "Open Questions / Revisions Needed" for what's under review, and reconcile the existing code against whatever this doc says after revision.

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

- Migrations are SQL strings/functions applied by Arcadia startup using a `capability_migrations` table with `(module_id, version, migration_id, applied_at)`.
- Commands are deterministic action handlers with typed input/output, required permissions, and approval gates.
- Event handlers are synchronous in-process hooks for core events; v1 can start with `emitEvent` writing to an `events` table and no async bus.
- Permissions classify actions as `autonomous`, `codex`, `needs_mark`, or `blocked`.
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

Required streams:

- `martian_rover`: founder/build-in-public, product strategy, AI-assisted creator workflow.
- `midi_opener`: product updates, tutorials, MIDI education, release notes, SEO posts.
- `rebuster`: puzzle updates, behind-the-scenes, visual puzzle lists, publishing experiments.

Pipeline:

- Idea: create `blog_ideas`, attach `blog_idea` markdown artifact, append mission log.
- Brief: create local brief artifact from deterministic template and project context.
- Draft: scaffold markdown draft artifact; AI use optional, never required.
- Review: create core `review_items` for voice, claims, strategy, and publish readiness.
- Scheduled: update `blog_posts.scheduled_for`; no external scheduling/publishing.
- Published: only after explicit Mark approval and manual/approved publish evidence.
- Logged: append mission log and link final artifact.

Actions:

- `blogging.configure_site`: creates/updates `blog_sites`; blocked if project missing.
- `blogging.create_idea`: autonomous; may use recent mission logs as source.
- `blogging.prepare_schedule`: autonomous; produces `blog_schedule` artifact and review item.
- `blogging.create_brief`: autonomous; creates `blog_brief` artifact.
- `blogging.draft_post`: autonomous for scaffold-only, `needs_mark` for voice approval, `codex` only if repo/content pipeline code changes are required.
- `blogging.mark_review`: creates review item and approval gate.
- `blogging.record_published`: needs Mark; records published URL/date and mission log, but does not deploy or publish.

Artifacts should live under `artifacts/blogging/<site>/<YYYY-MM-DD>-<slug>.md` unless an implementation finds an existing workspace artifact convention that is more specific.

## Safety, UX, and MCP Horizon

Action classification:

- Autonomous: deterministic scheduling, idea organization, brief/draft scaffolds, metadata generation, local artifact writing, dashboard snapshots.
- Codex: code changes, route creation, content pipeline implementation, migrations/tests.
- Needs Mark: voice approval, strategic positioning, publishing approval, sensitive claims, final publish confirmation.
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
4. Generate markdown artifacts for ideas, schedules, briefs, and scaffold drafts.
5. Create review items for schedules/drafts that require Mark approval.
6. Append mission logs for each action.
7. Extend dashboard snapshot with `capabilities.blogging` and render one compact Blogging panel.
8. Add deterministic intake aliases only after CLI behavior is tested:
   - "Prepare next week's MIDI Opener blog schedule."
   - "Draft the next Rebuster update post."
   - "Show blog posts that need my review."
   - "Create a Martian Rover build-in-public post idea from recent mission logs."

Acceptance behavior:

- Preparing next week's MIDI Opener schedule creates a schedule artifact, schedule row, review item, event, and mission log.
- Drafting the next Rebuster update creates or advances a post to `draft`, attaches a markdown artifact, creates review if needed, and logs the action.
- Showing posts needing review reads Blogging rows joined to open core review items.
- Creating a Martian Rover idea from recent logs reads local mission logs, creates an idea artifact, links it to the project/site, emits event, and logs the result.

## Test Plan

Add unit/integration coverage with temporary workspaces:

- Capability migrations are idempotent and recorded once.
- Blogging site config fails cleanly for missing project and succeeds for configured project.
- `create_idea` creates `blog_ideas`, core artifact, event, and mission log.
- `prepare_schedule` creates `blog_schedules`, artifact, review item, approval gate `publication`, and mission log.
- `draft_post` creates/updates `blog_posts` and never publishes.
- Dashboard snapshot includes Blogging status without writing reports.
- Existing tests for ask/review/dashboard still pass.
- CLI JSON envelopes follow existing `CommandSuccess` shape.

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

## Open Questions / Revisions Needed

Raised in review on 2026-06-24, not yet resolved:

1. **Permission enforcement point is unspecified.** The contract lists `permissions` per command, but no code path is named that checks a command's permission before running its handler. Decide: does `CapabilityRuntime.dispatch()` gate this, or the CLI layer, or convention? Check what `src/capabilities/core.ts` and `coreApi.ts` actually do today — the enforcement may or may not already exist in the untracked implementation.
2. **`blogging.draft_post` mixes three permission tiers in one action** (autonomous scaffold / needs_mark voice approval / codex pipeline changes). Either split into separate commands (e.g. `scaffold_draft` vs an explicit voice-approval step) or define how conditional permission escalation works within one command.
3. **`events` table has no consumer.** `emitEvent` writes rows but nothing reads them yet. Decide whether to keep it now (infrastructure-ahead-of-need) or defer until a second module/consumer exists — check whether the existing implementation already leans on it for something.
4. **Migration runner robustness is underspecified.** Ordering against core `schema.sql`, idempotency, and partial-failure/rollback behavior for `CapabilityMigration[]` aren't defined. Inspect `src/capabilities/migrations.ts` (already implemented) against this concern and tighten the contract to match or to require changes.
5. **Cascade delete policy is inconsistent with the "destructive actions need a gate" stance.** `blog_sites`/`blog_posts` cascade-delete from `projects` with no approval gate. Either document why project deletion is already gated upstream, or change to `ON DELETE RESTRICT` plus an explicit archival action.
6. **Hardcoded streams (`martian_rover`, `midi_opener`, `rebuster`) are listed as "required"** in what's supposed to be a minimal, reusable v1 contract. Consider moving these to runtime configuration seeded via `blogging.configure_site` rather than a written module requirement.

Resolve these (and re-validate against the code already in `src/capabilities/` and `src/commands/blog.ts`) before treating this plan as final.
