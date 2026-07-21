# Playground Image Loop — Findings & Conflict Report

> Grounding pass for the phased plan (bounded loop primitive + image consumer,
> Discord subscriber, admin page, Asset Library). This document is Steps 1 and 2
> of the investigation: what already exists, and where the plan fights the
> existing design. The per-phase specs (`01`–`04`) depend on the verdicts here.
>
> **Nothing in this plan is implemented.** These are specifications only.

Every claim below names a real file, table, or type. Line references were
accurate at the time of writing (schema `PRAGMA user_version = 8`).

---

## Step 1 — Area findings

Legend: **REUSABLE** = exists and can be used as-is · **EXTEND** = exists but
needs additive work · **MISSING** = does not exist.

### 1. Intelligence routing & vision reachability

**Routing skeleton: REUSABLE. Vision path: MISSING.**

- Routing is a deterministic lookup, not a policy engine:
  `resolveIntelligenceRoute()` in [resolveRoute.ts](../../../src/intelligence/routing/resolveRoute.ts)
  maps `(capability, execution, profile[, executionTarget])` → exactly one
  `ResolvedIntelligenceRoute` or a typed failure
  (`route_not_configured` | `route_disabled` | `paid_usage_not_allowed` |
  `local_route_unavailable` | `cloud_route_unavailable`).
- The route registry is built by `buildDefaultRoutes()` /
  `loadIntelligenceConfig()` in [config/defaults.ts](../../../src/intelligence/config/defaults.ts).
  Executors: `"litellm" | "codex-cli" | "comfyui" | "speech"`.
- The worker dispatches routes in [jobs/worker.ts](../../../src/intelligence/jobs/worker.ts)
  (`IntelligenceWorker.runOnce`), one durable SQLite job at a time via a lease.
- **Vision is typed but unreachable.** `vision.analyze` is in
  `INTELLIGENCE_CAPABILITIES` ([types.ts:27](../../../src/intelligence/types.ts))
  but (a) no route is configured for it in `defaults.ts`, and — more
  importantly — (b) the LiteLLM transport `generateStructured()`
  ([litellm/httpClient.ts:107](../../../src/intelligence/litellm/httpClient.ts))
  builds `messages` with **string** `content` only. There is no `image_url` /
  multimodal message part anywhere. Even a correctly configured vision route
  could not pass an image to a VLM today. `V0_1_SCOPE.md` explicitly lists
  vision as "typed but unconfigured … resolve as a typed route_not_configured
  failure rather than executing."

**Consequence for the plan:** if the image consumer's "evaluation rationale"
means a model *looking at* the generated image, that capability does not exist
and is not a small addition — it needs a new multimodal transport path plus a
configured vision route. See conflict **C5**.

### 2. Local ComfyUI executor

**Submit / poll / timeout: REUSABLE. Cancel: MISSING.**

- [comfyui/imageExecutor.ts](../../../src/intelligence/comfyui/imageExecutor.ts)
  `createComfyUiImageExecutor()`:
  - **Submit:** `queuePrompt()` → `POST {baseUrl}/prompt` with the workflow JSON
    (loaded from `comfy.workflowDir`, control nodes `73`/`74`/`9000`), returns
    a `prompt_id`.
  - **Poll:** `waitForHistory()` → `GET /history/{promptId}` every 750 ms until
    `comfy.timeoutMs` (default **900_000 ms**, env `ARCADIA_COMFYUI_TIMEOUT_MS`).
  - **Timeout / failure taxonomy (typed):** `ComfyUiExecutionBlockedError`
    (`COMFYUI_UNAVAILABLE`, `COMFYUI_MODEL_UNAVAILABLE`,
    `COMFYUI_WORKFLOW_UNAVAILABLE`, `COMFYUI_REFERENCE_IMAGE_*`) vs
    `ComfyUiExecutionFailedError` (`COMFYUI_TIMEOUT`, `COMFYUI_NO_OUTPUT`,
    `COMFYUI_PROMPT_REJECTED`, `COMFYUI_EXECUTION_FAILED`, …). The worker maps
    *blocked* → retryable `blockJob`, *failed* → terminal `failJob`.
  - Downloads output bytes (`GET /view`) and persists via the artifact store.
- **Cancel does not exist.** No `/interrupt` call, no cooperative cancel token.
  A ComfyUI generation is a blocking `await` inside the single-job worker; while
  it runs (up to 15 min) the worker processes nothing else. A bounded loop that
  must honor a mid-run **stop** command cannot interrupt an in-flight
  generation — it can only decline to start the *next* iteration. See **C4**.

### 3. Discord ingress

**EXTEND (substantially).** [apps/discord-bot](../../../apps/discord-bot) is a
separate pnpm workspace app that **shells out to the Arcadia CLI** and never
touches the DB directly.

- **Inbound:** `messageCreate` → `cli.ask(content, { sourceIngress: "discord.message", replyReviewId })`
  ([events/messageCreate.ts](../../../apps/discord-bot/src/events/messageCreate.ts));
  slash commands via `interactionCreate`. Authorization is **guild + channel
  only** (`isAllowedMessage`) — there is **no per-user allowlist**.
- **Outbound / push:** `startNotificationPoller()`
  ([notifications/poller.ts](../../../apps/discord-bot/src/notifications/poller.ts))
  polls CLI snapshots (`status`/`review`/`queue`/`runs`/`milestones`/`codex`),
  diffs against a **state file**, and calls `channel.send({ content })` on a
  single configured channel. It records review→messageId mappings for reply
  threading.
- **What is NOT there:** embeds, image **attachments**, **reactions**, real
  **threads**, per-user allowlist, any **events-table** consumer, and any
  direct DB read. Outbound content is plain strings only.

**Consequence:** Phase 1b needs image attachments, embeds, reactions, threaded
reply parsing, a user-ID allowlist, message-ID persistence, and an event-driven
push path. All additive, but it roughly doubles the bot's surface. See **C6–C8**.

### 4. Job / artifact workspace

**Binary storage: REUSABLE. Promote-to-domain-Artifact: MISSING.** There are
**two distinct "artifact" concepts** — do not conflate them:

| Concept | Table | Meaning |
|---|---|---|
| Domain **Artifact** | `artifacts` ([schema.sql:68](../../../database/schema.sql)) | Canonical Arcadia Artifact: `title`, `artifact_type`, `status` (`planned`/`drafted`/`ready`/`published`), `path`. Created via `coreApi.attachArtifact` → `createArtifactRecord`. |
| Intelligence job artifact | `intelligence_job_artifacts` ([src/db/schema.ts:251](../../../src/db/schema.ts)) | Binary blob (`kind` `image`/`audio`), `sha256`, `byte_size`, `relative_path`, dimensions/audio metadata. |

- Binary bytes are written by `IntelligenceArtifactStore`
  ([artifacts/store.ts](../../../src/intelligence/artifacts/store.ts)) under the
  workspace `artifacts/` dir at
  `artifacts/intelligence/<jobId>/<intelligenceArtifactId>.<ext>`, sha256-hashed,
  and served at `GET /api/intelligence/artifacts/:id` (Range-aware).
- The ComfyUI executor already calls `artifactStore.saveImageBytes(...)` per
  generated image. **Generated images are Intelligence artifacts, never domain
  Artifacts.** Nothing links `intelligence_job_artifacts` → `artifacts`.
  `run_artifacts` links `execution_runs` ↔ `artifacts`, a different pipeline.

**Consequence:** Phase 3's "promote-Artifact-to-Asset" presupposes a domain
Artifact, but the loop produces Intelligence artifacts. The missing hop is
image-job-artifact → domain Artifact → Asset. See **C10**.

### 5. Run / job / state-machine pattern

**PATTERN REUSABLE; the loop's specific machine is MISSING.** Arcadia already
models several multi-step processes with status + terminal states, all with the
same shape (`TEXT status CHECK(...)`, ISO `created_at`/`updated_at`, terminal
states, cascade FKs):

- `intelligence_jobs` — `queued → running → {completed | failed | blocked}`,
  lease-based single worker, `idempotency_key` unique, `retry_count`. **Closest
  analog** to a single loop *iteration*.
- `execution_runs` / `execution_plans` / `execution_run_steps` — the canonical
  **Run** (`pending_execution → running → {completed | requires_review |
  needs_mark | failed}`).
- `codex_invocations`, `review_items`, `back_burner_items` — more state machines.

**None model an iterative generate → evaluate → feedback loop** with a bounded
iteration count. That machine must be added — mirroring, not extending, the
`intelligence_jobs` conventions. See **C1** for the naming collision.

### 6. Typed request/response schema conventions

**REUSABLE.** Well-established:

- Public contract surface re-exports from an internal module
  ([contracts.ts](../../../src/intelligence/contracts.ts) → `types.ts`).
- `const` arrays + derived union types
  (`INTELLIGENCE_CAPABILITIES`, `EXECUTION_PREFERENCES`, `INTELLIGENCE_PROFILES`).
- Discriminated-union results: `IntelligenceRouteResolution` is
  `{ ok: true; route } | { ok: false; code; message; … }`.
- Durable job envelope: `IntelligenceJob` with `status`, `result`, `usage`,
  `error: { code; message }`, `retryCount`, timestamps.
- CLI JSON envelope: `CommandSuccess<TData> { ok: true; command; data; artifacts; warnings }`
  / `CommandFailure` ([src/cli/response.ts](../../../src/cli/response.ts)),
  built with `createSuccess()` / `createFailure()`.

### 7. Error taxonomy & error codes

**REUSABLE (two conventions, no single registry).**

- **CLI layer:** a closed `ArcadiaErrorCode` union + `ArcadiaError`
  (`code`, `exitCode` 1/2/3, `details`)
  ([src/cli/errors.ts](../../../src/cli/errors.ts)), with factory functions
  (`validationError`, `workItemNotFound`, …) and `normalizeError()`.
- **Intelligence layer:** `UPPER_SNAKE_CASE` string codes carried on typed
  `Error` subclasses (`ComfyUiExecutionBlockedError`, `CodexTextExecutionFailedError`,
  `SpeechGenerationError`, …), surfaced as `job.error.{ code, message }`. The
  worker's central rule: **blocked** = environmental/unavailable (retryable),
  **failed** = execution/validation error (terminal).

There is **no** shared cross-module error-code enum. New modules define their
own local codes. See consolidated open question **Q7**.

### 8. Test conventions & running the suite

**REUSABLE.** Vitest; `pnpm test` = `vitest run` ([vitest.config.ts](../../../vitest.config.ts),
`environment: "node"`, `testTimeout: 20_000`). Intelligence unit/integration
tests live in [test/intelligence/](../../../test/intelligence); broader flows in
[tests/](../../../tests); Playwright e2e in `tests/e2e` (excluded from vitest).
Conventions observed: `*.integration.test.ts` / `*.e2e.test.ts` suffixes,
temp-workspace SQLite integration tests, plain `node:http` servers spun up inside
tests (see the comment in [api/server.ts:28](../../../src/intelligence/api/server.ts)).
Deterministic-first (per `AGENTS.md`).

---

## Step 2 — Conflicts with the plan

Ordered by how much they should change the plan.

### C1 — "run" / `runId` collides with the canonical Run

The plan's "bounded loop primitive … `feedback(runId, …)`" overloads **Run**,
which `docs/arcadia-semantics.md` reserves for "a concrete execution attempt"
(the `execution_runs` table). The loop is a *process that spawns many
generations*, not one execution attempt.

**Proposed replacement:** name the primitive a **Loop** (instance:
`playground_loops`; each pass: `playground_loop_iterations`; `id` prefix
`createId("playgroundLoop")` / `createId("loopIteration")`). Everywhere the plan
says `runId`, read `loopId`. Each *iteration* MAY itself be backed by one
`intelligence_jobs` row (that is the real "run" of a single generation),
preserving the existing worker/lease machinery. This keeps "Run" meaning what
the semantics doc says and gives the loop its own noun.

### C2 — "emits typed domain events" already exists (twice)

There is a generic append-only `events` table + `coreApi.emitEvent(EmitEventInput)`
([coreApi.ts:44](../../../src/capabilities/coreApi.ts)), **and** a
capability-local precedent `rebuster_events`. The plan should reuse **one** of
these, not invent a third event bus:

- **Reuse the generic `events` table** with `source_module = "playground"` and a
  typed `event_type` string — cheapest, already indexed by `source_module` /
  `created_at`, and a downstream reader can page it with a cursor. **Recommended.**
- Or a capability-local `playground_loop_events` (mirrors `rebuster_events`) if
  you want a CHECK-constrained event-type enum and loop-specific columns.

Critically, `events` is a **log, not a pub/sub** — there is no in-process
delivery/subscription. A "subscriber" (Phase 1b) is a **poller with a cursor**,
exactly like the existing notification poller. That is a feature, not a gap: it
makes "events emitted while Discord is down" survive for free (see **C6**).

### C3 — "feedback from any authenticated source" overstates what exists

Arcadia has **no authentication or identity layer** — it is local-first,
single-operator. The Intelligence HTTP server ([api/server.ts](../../../src/intelligence/api/server.ts))
has **no auth** at all. The real ingress seam already in the code is a
**`source`/`sourceIngress` label**, not a principal: `ask_feedback.source_ingress`,
`back_burner_items.ingress_source`, and `cli.ask(..., { sourceIngress: "discord.message" })`.

**Proposed replacement:** model the seam as a plain service function
`submitLoopFeedback({ loopId, text, source })` where `source` is an **ingress
label** (`"cli" | "discord" | "http" | "admin"`), reachable from the CLI (the
primary local ingress) and optionally HTTP. Drop "authenticated"; there is no
auth to authenticate against. Precedent for the storage shape: `review_feedback`
and `ask_feedback` already persist feedback rows keyed to a parent, with a
source label and a raw reply. Mirror them (`playground_loop_feedback`).

### C4 — "feedback queues for the next iteration" is the *only* option available

Correct by construction, but worth stating: the worker runs one blocking job at
a time and cannot interrupt an in-flight ComfyUI generation (no cancel, **C2 of
area 2**). So feedback and stop commands **cannot** affect the current
iteration; they are read by the loop controller **between** iterations. Design
the loop as a controller that, per iteration: (1) drains new feedback + checks
for a stop request, (2) submits one generation job, (3) awaits it, (4) records
the iteration, (5) decides whether to continue. This fits the existing model
cleanly; the plan's "queues for the next one" is the right and forced behavior.

### C5 — the "image consumer / evaluation rationale" may require vision, which is unreachable

Biggest hidden dependency. If evaluation = a VLM judging the generated image,
that path does not exist (area 1): no vision transport, no configured route,
explicitly out of `V0_1_SCOPE`. Options, in order of preference:

1. **Text-only evaluation** (heuristic or LLM scoring the *prompt*/metadata, not
   the pixels) — reachable today via `text.*` routes. Keeps Phase 1 self-contained.
2. **Add a multimodal transport + vision route** as an explicit prerequisite
   (a "Phase 0.5") before the image consumer — a real extension to
   `litellm/httpClient.ts` (build `image_url` message parts) + a configured
   `vision.analyze` route. Do not bury this inside Phase 1.

**This must be decided before Phase 1 is scoped** (open question **Q1**).

### C6 — "queue and retry while Discord is down" is already the poller's shape

The existing notification poller tracks what it has delivered in a state file and
re-sends on the next tick — downtime-tolerant by design. Reuse that mechanism
against an **events cursor** instead of building a new retry queue. A
notification failure already never fails a run today (the loop and the bot are
separate processes; the bot polls). Preserve that separation.

### C7 — the bot must not read the loop DB directly

Today's boundary is **bot → CLI (JSON) → DB**. Per-iteration embeds need
iteration data *including the image*. Keep the boundary: add CLI commands (e.g.
`arcadia playground loop show <id> --json`, `… events --since <cursor> --json`)
that return iteration records + the artifact's local `relative_path` and/or its
`/api/intelligence/artifacts/:id` URI. The bot (same machine, launchd) attaches
the local file by path. Avoid giving the bot a second DB handle.

### C8 — per-user allowlist / reactions / threads are additive but new

Authorization is guild+channel today. A user-ID allowlist is a config addition
(`DISCORD_ALLOWED_USER_IDS`). Reactions and threaded replies are supported by
`discord.js` but unused; parsing threaded replies into commands/feedback is new
logic. All additive, no conflict — just not free.

### C9 — "Asset" is a third noun next to Artifact and job-artifact

Phase 3 introduces **Asset** (content-addressed R2 blob + manifest). Arcadia's
semantics already make **Artifact** the persisted-output concept, and there is
already an `intelligence_job_artifacts` blob store that is *de facto*
content-addressed (sha256 computed on every save). Three "artifact-ish" nouns is
vocabulary sprawl. Either (a) justify Asset as a genuinely distinct concept
("durable content-addressed distribution blob" vs Artifact = "referable work
output") and say so in `arcadia-semantics.md`, or (b) treat the R2 store as a
*backing/delivery tier* of the existing artifact store rather than a new noun.
Decide before Phase 3 (open question **Q9**).

### C10 — "promote-Artifact-to-Asset" is missing its first hop

There is no code path turning an `intelligence_job_artifact` (what the loop
produces) into a domain `artifacts` row. Phase 3's promote flow silently assumes
one exists. Either promote directly from `intelligence_job_artifacts`, or
specify the `intelligence_job_artifact` → domain `Artifact` hop first (arguably
part of Phase 1: "keep this generation" should mint a domain Artifact).

---

## Consolidated open questions

- **Q1 (blocks Phase 1 scope):** Does "evaluation" look at the image (needs
  vision, **C5**) or only at text/metadata (reachable today)? If vision, is the
  multimodal-transport prerequisite in scope now or deferred?
- **Q2:** Loop vocabulary — accept **Loop / iteration** (`playground_loops` /
  `playground_loop_iterations`) to avoid the Run collision (**C1**)? Or another name?
- **Q3:** Event storage — generic `events` table with `source_module="playground"`,
  or a capability-local `playground_loop_events`? (**C2**)
- **Q4:** Is each iteration backed by a real `intelligence_jobs` row (reuse the
  worker/lease/retry), or does the loop controller call the ComfyUI executor
  directly? (Recommend: one job per iteration.)
- **Q5:** Feedback ingress — CLI-only for Phase 1, or CLI + an HTTP endpoint on
  the Intelligence server? And confirm `source` is an ingress label, not a
  principal (**C3**).
- **Q6:** Stop semantics — is "stop after current iteration" sufficient, or is
  true cancel required (which needs a ComfyUI `/interrupt` integration that does
  not exist, **C4**)?
- **Q7:** Do we introduce a shared error-code registry, or keep per-module codes
  (current convention, **area 7**)? Recommend: per-module, `PLAYGROUND_*` codes.
- **Q8:** Admin page (Phase 2) — extend the **existing** `/admin/intelligence`
  surface (already has request-form/job-panel/recent-history), or a new page?
- **Q9:** Asset vs Artifact vocabulary and R2 dependency (**C9/C10**). Is R2
  (Cloudflare) an accepted new external dependency and backup target?
- **Q10:** Where do the images live for the bot to attach — does the Intelligence
  HTTP server run alongside the bot, or does the bot read `relative_path` off
  local disk? (**C7**)

## Recommended build order & phase disposition

1. **Decide Q1 first.** It determines whether Phase 1 is self-contained or
   carries a vision-transport prerequisite.
2. **Phase 1 — Loop primitive + image consumer.** Build. Backs each iteration
   with an `intelligence_jobs` row; emits events into the reused `events` table;
   exposes `submitLoopFeedback`. **Recommend renaming per C1.**
3. **Phase 2 — Admin views.** **MERGE into the existing `/admin/intelligence`
   surface** rather than a new page (Q8). Low risk; can land *before or beside*
   1b since it only reads Phase 1's schemas. Consider pulling it earlier as the
   primary way to watch a loop.
4. **Phase 1b — Discord subscriber.** After Phase 1. Reuse the poller-with-cursor
   pattern (**C6**), CLI boundary (**C7**), additive auth/reactions/threads (**C8**).
5. **Phase 3 — Asset Library. DEFER.** The plan itself calls it "genuinely
   separable"; the Playground persists to the local workspace (which already
   exists) until then. It is the largest new surface (R2, backups, public URLs)
   and introduces a contested new noun (**C9/C10**). Do not let it block 1/1b/2.

No phase should be *cut*; the recommendation is **merge Phase 2 into the existing
admin surface** and **defer Phase 3**, and to **split a vision-transport
prerequisite out of Phase 1** only if Q1 resolves to "evaluation needs vision."
