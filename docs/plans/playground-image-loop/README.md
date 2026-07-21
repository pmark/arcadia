# Playground Image Loop — Specification Set

Specs for a bounded image-generation **Loop** (generate → evaluate → feedback),
its Discord subscriber, an admin view, and an optional Asset Library. Produced by
a grounding pass over the Arcadia repo; the plan was written without repo access,
so **read the findings/conflicts doc first** — it changes vocabulary and scope in
several places.

**These are specifications only. Nothing here is implemented.**

## Documents

| # | Doc | Purpose |
|---|---|---|
| 00 | [Findings & Conflicts](./00-findings-and-conflicts.md) | What already exists (per-area REUSABLE/EXTEND/MISSING verdicts), where the plan conflicts with the codebase, consolidated open questions, build order. **Start here.** |
| 01 | [Phase 1 — Bounded Loop Primitive + Image Consumer](./01-phase-1-bounded-loop-primitive.md) | The durable Loop, backed by `intelligence_jobs`; events seam + `submitLoopFeedback`. |
| 02 | [Phase 1b — Discord Subscriber](./02-phase-1b-discord-subscriber.md) | Per-iteration embeds/attachments, reply→command/feedback, allowlist, reactions. |
| 03 | [Phase 2 — Admin Page](./03-phase-2-admin-page.md) | Loop views, merged into the existing `/admin/intelligence` surface. |
| 04 | [Phase 3 — Asset Library](./04-phase-3-asset-library.md) | Content-addressed R2 store + promotion. **Recommended: DEFER.** |

## Headline conflicts (see 00 for all)

- **C1 — "run" collides with the canonical Run.** Rename the primitive to a
  **Loop** (`playground_loops` / `playground_loop_iterations`); `runId` → `loopId`.
- **C2 — "typed domain events" already exists.** Reuse the generic `events` table
  (`source_module="playground"`); it is a log, not pub/sub, so subscribers poll a
  cursor.
- **C3 — "any authenticated source" overstates reality.** No auth layer exists;
  `source` is an ingress label, not a principal.
- **C5 — image "evaluation" may need vision, which is unreachable.** No multimodal
  transport, no vision route. Decide text-only vs a vision prerequisite before
  scoping Phase 1.
- **C9/C10 — "Asset" is a third artifact noun with a missing first hop.** Needs a
  vocabulary decision and an `intelligence_job_artifact → domain Artifact`
  promotion that does not exist today.

## Recommended disposition

Decide **Q1 (evaluation = vision?)** first → build **Phase 1** → **merge Phase 2**
into the existing admin surface (can land beside/ before 1b) → build **Phase 1b**
→ **defer Phase 3**. No phase cut; Phase 2 merged, Phase 3 deferred, and a
vision-transport prerequisite split out of Phase 1 only if evaluation needs vision.
