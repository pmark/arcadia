# Agent Orientation

Critical, non-obvious context for agentic work in this repo. Read this after
`AGENTS.md` and `docs/arcadia-semantics.md`, before touching the database,
the Intelligence service, or the Discord bot. Everything here was verified
against the code; when it drifts, fix it in the same change.

Canonical vocabulary lives in [`arcadia-semantics.md`](./arcadia-semantics.md)
(Domain, Project, Mission, Outcome, Milestone, Action, Artifact, Decision, Log).
"**Run**" is reserved for a concrete execution attempt (`execution_runs`) — do
not reuse it for other loops/processes.

## Repo shape

- pnpm monorepo (`pnpm-workspace.yaml`). Root package `@pmark/arcadia` is the
  **CLI** (`src/cli.ts`, ~75 KB, Commander-based) plus the Intelligence service.
- `apps/dashboard` — Next.js admin UI. **Mostly shells out to the CLI** via
  `lib/arcadia-cli`; API routes run `nodejs` runtime, `dynamic = "force-dynamic"`.
- `apps/discord-bot` — separate app; **shells to the CLI**, never touches the DB.
- `apps/discord-bot-reference` — older reference implementation, not the live bot.
- Build: `pnpm build` (`tsc` + the discord-bot build). Run CLI in dev with
  `pnpm arcadia …` (`tsx src/cli.ts`). ESM throughout; imports use `.js`
  specifiers even for `.ts` sources.

## Database: two sources, migrations win

The **effective schema is `database/schema.sql` PLUS the migrations in
`src/db/schema.ts`** — not either alone.

- `applyInitialSchema(db)` execs `database/schema.sql` (the baseline,
  `PRAGMA user_version = 8`), then calls `applyMigrations(db)`.
- `applyMigrations()` runs a list of **idempotent `ensure*` functions**
  (guarded by `CREATE TABLE IF NOT EXISTS` / `PRAGMA table_info`) that add newer
  tables and columns. Some tables exist **only** in the migrations, not in
  `schema.sql` (e.g. `intelligence_jobs`, `intelligence_job_artifacts`); some are
  defined in both (kept idempotent).
- **To add/alter a table or column: add an `ensure*` migration in
  `src/db/schema.ts` and register it in `applyMigrations()`.** Editing only
  `schema.sql` will not migrate existing databases. Follow the additive,
  compatibility-preserving style already there (see
  `ensureIntelligenceJobArtifactAudioColumns` for the column-add pattern).
- Conventions: TEXT ids from `createId("<prefix>")` (`src/utils/id.ts`), ISO
  timestamps from `nowIso()` (`src/utils/time.ts`), `TEXT status CHECK (...)`
  enums, `created_at`/`updated_at`, cascade FKs.

## Two different "Artifact" concepts — do not conflate

| Concept | Table | What it is |
|---|---|---|
| Domain **Artifact** (canonical) | `artifacts` | Referable work output/input: `title`, `artifact_type`, `status` (`planned`/`drafted`/`ready`/`published`), `path`. Created via `coreApi.attachArtifact`. |
| Intelligence **job artifact** | `intelligence_job_artifacts` | Generated **binary blob** (image/audio): `sha256`, `byte_size`, `relative_path`, dims/audio meta. Written by `IntelligenceArtifactStore` (`src/intelligence/artifacts/store.ts`). |

Blob bytes live under the workspace at
`artifacts/intelligence/<jobId>/<intelligenceArtifactId>.<ext>` (sha256-hashed,
atomic writes) and are served at `GET /api/intelligence/artifacts/:id`
(HTTP Range-aware, for mobile Safari audio). **Nothing links a job artifact to a
domain Artifact** — there is no promote/attach hop today.

## Arcadia Intelligence service (`src/intelligence/`)

A generic, local, SQLite-backed structured-generation service. Scope is
deliberately narrow — read `docs/intelligence/V0_1_SCOPE.md` and `ROUTING.md`
before extending it.

- **Routing is a deterministic lookup, not a policy engine.**
  `resolveIntelligenceRoute()` maps `(capability, execution, profile[, executionTarget])`
  → exactly one route or a typed failure. **No automatic fallback, escalation,
  or provider/model selection.** `local-preferred` never silently goes cloud.
- Route registry: `src/intelligence/config/defaults.ts` (`buildDefaultRoutes` /
  `loadIntelligenceConfig`), configured from `ARCADIA_LITELLM_*` /
  `ARCADIA_COMFYUI_*` / `ARCADIA_CODEX_*` / `ARCADIA_SPEECH_*` env vars. Executors:
  `litellm` | `codex-cli` | `comfyui` | `speech`.
- **Everything routes through one local LiteLLM proxy** (default
  `http://127.0.0.1:4000`) — never a direct backend URL. Speech and images have
  dedicated executors but still resolve via the registry. (LiteLLM sits in front
  of a local model server; see `docs/intelligence/`.)
- **Worker model:** `IntelligenceWorker` (`jobs/worker.ts`) is one in-process
  dispatcher with independent, bounded `p-queue` resource pools. Cloud text,
  cloud image, Codex CLI, local LiteLLM, ComfyUI, and local/cloud speech can
  progress concurrently without one long image job blocking every route.
  Defaults are conservative for local executors and configurable with
  `ARCADIA_INTELLIGENCE_*_CONCURRENCY` variables. Claims remain durable in
  SQLite: active jobs renew their leases, and an opaque claim token fences a
  stale/reclaimed attempt from committing. There is **no job cancellation**
  (ComfyUI has no interrupt hook wired).
- **Jobs are durable + idempotent:** `intelligence_jobs`, keyed by
  `idempotency_key` (unique), status `queued → running → {completed | failed |
  blocked}`, one retry max.
- **The HTTP API is unauthenticated** (local `node:http`, `api/server.ts`):
  `POST /api/intelligence/jobs`, `GET …/:id`, `POST …/:id/retry`,
  `GET …/health`, `GET …/artifacts/:id`. **Arcadia has no auth/identity layer at
  all** — it is local-first, single-operator. "Source" is an ingress **label**
  (`sourceIngress`/`ingress_source`), not an authenticated principal.
- **Vision is typed but unreachable.** `vision.analyze` is in the capability enum
  but has no configured route **and** the LiteLLM transport (`litellm/httpClient.ts`
  `generateStructured`) sends **string content only** — no `image_url`/multimodal
  parts. A model cannot "look at" an image today without a new transport path.
- **Public contract surface:** import companion-app types from
  `src/intelligence/contracts.ts` (re-exports `types.ts`); never deep-import
  internals. `scripts/verify-intelligence-package-exports.mjs` guards the boundary.

## Events: a log, not a bus

- Generic append-only `events` table + `coreApi.emitEvent(EmitEventInput)`
  (`src/capabilities/coreApi.ts`): `event_type`, `source_module`, entity FKs,
  `payload_json`. Indexed by `source_module` / `created_at`.
- Capability-local variant precedent: `rebuster_events` (CHECK-constrained
  event-type enum, own columns).
- **There is no in-process pub/sub or delivery.** "Subscribers" (e.g. the Discord
  poller) read with a **cursor** and diff. This is why downtime-tolerance is
  cheap — a cursor that only advances on success re-delivers after an outage.

## Error conventions (two layers, no shared registry)

- **CLI layer:** closed `ArcadiaErrorCode` union + `ArcadiaError`
  (`code`, `exitCode` 1/2/3, `details`) in `src/cli/errors.ts`; factories +
  `normalizeError()`.
- **Intelligence layer:** `UPPER_SNAKE_CASE` string codes on typed `Error`
  subclasses (`ComfyUiExecutionBlockedError`, `SpeechGenerationError`, …),
  surfaced as `job.error.{code, message}`. **Rule: `blocked` = environmental /
  unavailable (retryable); `failed` = execution / validation error (terminal).**
- New modules define their own local codes (`<MODULE>_*`); there is no global
  enum to register in.

## CLI conventions

- JSON envelope: `CommandSuccess<TData> { ok: true; command; data; artifacts; warnings }`
  / `CommandFailure` (`src/cli/response.ts`), built with `createSuccess` /
  `createFailure`. Every machine-facing command supports `--json`.
- The dashboard and Discord bot both consume this envelope by shelling out —
  keep it stable. Command groups are registered in `src/cli.ts` (see the
  `intelligence` group for the pattern).

## Discord bot (`apps/discord-bot/`)

- **Boundary: bot → CLI (`arcadia … --json`) → DB.** The bot has no DB handle;
  preserve this.
- **Inbound:** `messageCreate` → `cli.ask(content, { sourceIngress: "discord.message" })`;
  slash commands via `interactionCreate`. **Authorization is guild + channel
  only** — there is no per-user allowlist yet.
- **Outbound:** `startNotificationPoller` polls CLI snapshots, diffs against a
  **state file**, and `channel.send({ content })` to one configured channel.
  Content is **plain strings** — no embeds, attachments, reactions, or threads
  today. Reply→parent mapping is a state file (`recordReviewMessage`).

## Tests

- Vitest. **`pnpm test`** = `vitest run`; Node env, 20 s timeout.
- Intelligence unit/integration: `test/intelligence/*.test.ts`. Broader flows:
  `tests/*.test.ts`. Playwright e2e: `tests/e2e` (excluded from vitest).
- Conventions: temp-workspace SQLite integration tests; **live/networked tests
  are separated** as `*.e2e.test.ts` / `live*.test.ts` and are not part of the
  default deterministic run. Plain `node:http` servers are spun up inside tests
  rather than adding a web framework.
- **Worktree gotcha:** running vitest inside a `.claude/worktrees/*` checkout
  needs the parent `node_modules` bridged (worktrees don't get their own install).

## When extending any of this

Prefer deterministic before AI, local AI before frontier (per `AGENTS.md`).
Additive, compatibility-preserving contracts. Keep the CLI JSON envelope and
existing adapters stable. Update `START_HERE.md` for any user-facing flow change
and `arcadia-semantics.md` before introducing new user-facing nouns.
