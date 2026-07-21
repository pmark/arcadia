# Phase 3 — Arcadia Asset Library

> Depends on nothing in Phases 1–2 at runtime (the plan calls it "genuinely
> separable"). Read conflicts **C9** and **C10** in [00](./00-findings-and-conflicts.md)
> first — they change this phase's vocabulary and its first hop.
> Specification only — not implemented. **Recommended disposition: DEFER.**

## Scope (as proposed)

A content-addressed **Asset** store: bytes in Cloudflare **R2**, a SQLite
manifest where a *logical Asset* is an ordered list of content hashes, a
promote-Artifact-to-Asset flow, a CLI (`put`/`get`/`list`/`restore`), backup sync
to a second target, and a public-URL resolution strategy for site consumption.

## Why DEFER (recommendation)

- The Playground already persists generated images durably to the local
  workspace via `IntelligenceArtifactStore`
  ([artifacts/store.ts](../../../src/intelligence/artifacts/store.ts)) — sha256 is
  already computed on every save. Phases 1/1b/2 do **not** need R2 to function.
- This phase introduces the most new surface area and the only new **external
  dependency** (Cloudflare R2 + a backup target + public URL hosting).
- It introduces a **third "artifact" noun** and a missing promotion hop
  (**C9/C10**) that need vocabulary decisions before any code.

Nothing here should block the earlier phases. The rest of this spec is the shape
if/when it is picked up.

## Non-goals

- Not a general CDN or media-processing pipeline (no transcoding/resizing).
- Not a replacement for the domain `artifacts` table or the Intelligence blob
  store — it is a **distribution/durability tier** beneath them (**C9** option b).
- No public **write** surface; promotion and puts are local-operator actions.

## Reuse vs. add

**Reuse as-is:**
- sha256 hashing + atomic write conventions already in `artifacts/store.ts`
  (`writeFileAtomic`).
- The domain `artifacts` table + `coreApi.attachArtifact` for the *referable*
  work-output side of a promotion.
- `createId()`, `nowIso()`, the CLI envelope + `PLAYGROUND_*`/`ASSET_*` error
  convention.

**Add (all new):**
- An R2 client + bucket config (new external dependency; new env vars).
- `assets` / `asset_versions` manifest tables (content-addressed).
- The `intelligence_job_artifact → domain Artifact → Asset` promotion hop
  (**C10** — currently missing entirely).
- Backup sync to a second target and a public-URL resolver.
- `arcadia asset …` CLI group.

## Vocabulary decision required first (C9)

Pick one before implementing:

- **(a) Asset is a distinct concept** — "durable, content-addressed
  distribution blob," separate from Artifact ("referable work output"). If so,
  add it to [docs/arcadia-semantics.md](../../../docs/arcadia-semantics.md) as a
  first-class term with its relationship to Artifact.
- **(b) Asset is a backing tier** — no new user-facing noun; R2 is where an
  Artifact's bytes can be *durably stored and published*. Simpler vocabulary;
  the manifest becomes "Artifact storage locations," not a new object.

The schema below assumes **(a)** and is the more-work option; **(b)** collapses
`assets` into columns/relations on the existing artifact tables.

## Concrete schema (option a)

```sql
CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,          -- createId("asset")
  name         TEXT NOT NULL,             -- logical, human-facing name
  project_id   TEXT,
  artifact_id  TEXT,                      -- the domain Artifact it was promoted from (C10)
  public_slug  TEXT UNIQUE,              -- for public URL resolution; NULL = private
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE SET NULL
);

-- A logical Asset is an ordered list of content hashes (versions/parts).
CREATE TABLE IF NOT EXISTS asset_versions (
  id           TEXT PRIMARY KEY,          -- createId("assetVersion")
  asset_id     TEXT NOT NULL,
  position     INTEGER NOT NULL,          -- ordered
  sha256       TEXT NOT NULL,             -- content address (== R2 object key)
  byte_size    INTEGER NOT NULL,
  mime_type    TEXT NOT NULL,
  r2_key       TEXT NOT NULL,             -- object key in the primary bucket
  backup_synced_at TEXT,                   -- NULL until mirrored to the backup target
  created_at   TEXT NOT NULL,
  UNIQUE (asset_id, position),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_versions_asset ON asset_versions(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_versions_sha ON asset_versions(sha256);
```

## Promotion flow (fills the C10 gap)

1. `intelligence_job_artifact` (an image the loop kept) → mint a domain
   **Artifact** row (`artifact_type='image'`, `status='ready'`, `path` = local
   relative path) via `coreApi.attachArtifact`.
2. Domain **Artifact** → **Asset**: hash the bytes (already have sha256), `PUT`
   to R2 under `r2_key = sha256`, insert `assets` + `asset_versions`.
3. Optionally assign `public_slug` and sync to the backup target.

Step 1 is the hop the plan omitted. If Q-C10 in Phase 1 is answered "mint a
domain Artifact when an iteration is accepted," step 1 already happened upstream.

## State / lifecycle

Assets are effectively immutable per content hash (content-addressed): a new
version is a new `asset_versions` row, never an in-place mutation.
`backup_synced_at` is the only mutable per-version field. There is no delete in
scope (restore, not delete) — consistent with Arcadia's no-destructive-side-effect
posture.

## Error codes

`ASSET_*` (per-module convention):
`ASSET_NOT_FOUND`, `ASSET_R2_UNAVAILABLE` (blocked/retryable),
`ASSET_UPLOAD_FAILED`, `ASSET_HASH_MISMATCH` (bytes ≠ claimed sha256),
`ASSET_BACKUP_TARGET_UNAVAILABLE`, `ASSET_PUBLIC_SLUG_TAKEN`,
`ASSET_SOURCE_ARTIFACT_NOT_FOUND` (promotion with no domain Artifact — the C10 case).

## Test plan

- **Unit:** content-addressing (same bytes → same `sha256`/`r2_key`; different
  bytes → different); ordered `asset_versions` positions; `public_slug`
  uniqueness.
- **Integration (stub R2):** `put` → `get` round-trips bytes; `restore` rebuilds
  a local file from R2; backup sync sets `backup_synced_at`; `ASSET_HASH_MISMATCH`
  on corrupted bytes.
- **Promotion:** `intelligence_job_artifact` → Artifact → Asset happy path;
  promotion without a source Artifact → `ASSET_SOURCE_ARTIFACT_NOT_FOUND`.
- **Public URL resolver:** private Asset (no slug) is not resolvable; slugged
  Asset resolves to the expected public URL shape.
- No live R2 in the default suite (stub the client, mirror how LiteLLM/ComfyUI
  live tests are separated as `*.e2e.test.ts`).

## Open questions (this phase)

- **Q9:** Asset-as-noun (option a) vs Asset-as-tier (option b)? Update
  `arcadia-semantics.md` accordingly.
- Is Cloudflare R2 an accepted new external dependency, and what is the backup
  target (a second R2 bucket? local? S3)?
- Public URL strategy: custom domain, R2 public bucket, or a Worker in front?
  (Out of the repo today — needs an infra decision.)
- Does "logical assets as ordered hash lists" mean **versions** (v1, v2, …) or
  **multi-part** assets (a set that belongs together)? The schema supports either
  via `position`, but the CLI/UX differs.
- Should promotion be automatic on "accept" (Phase 1 C10) or an explicit
  `arcadia asset promote <artifactId>` step?
