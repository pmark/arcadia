# Accepted Planning Artifact Obsidian Memory

## Slice

This change implements the first long-term-memory slice: one durable Markdown Record for each planning Artifact whose deterministic Validation passed and whose separate `CodexPlanningArtifactAcceptance` Decision was approved. SQLite remains operational truth, workspace files remain execution evidence, and Obsidian is a one-way projection. No other Artifact, Decision, Log, raw executor output, packet, or runtime file is exported.

## Implementation

- `src/memory/obsidian.ts` loads linked Project, Milestone, Action, Artifact, Run, Validation, Decision, and Log provenance; validates source and destination boundaries; renders the Record; locates an existing Record by stable Artifact ID; and writes atomically by temporary file plus rename.
- `src/commands/review.ts` writes configured memory before the final SQLite acceptance transaction. A write failure leaves the Decision open and the Action unfinished. A vault file written immediately before a later SQLite failure is safely replaced at the same path on retry.
- `src/commands/memory.ts` and `src/cli.ts` provide `arcadia memory sync --workspace <path> [--dry-run] [--json]` for inspection, repair, and backfill. SQLite alone selects approved planning Artifacts; sync never deletes files or infers acceptance from the vault.
- `src/workspace/config.ts` reads the optional workspace memory configuration. Missing or disabled configuration preserves previous behavior.
- `tests/obsidian-memory.test.ts` uses disposable workspaces and vaults for automatic export, provenance/content, negative gates, idempotency, repair, dry-run, invalid configuration, and write-failure semantics.

## Configuration

Workspace `config/arcadia.json` accepts this opt-in shape:

```json
{
  "memory": {
    "enabled": true,
    "obsidianVaultPath": "/absolute/path/to/vault"
  }
}
```

The path must be absolute, exist, and contain `.obsidian/`. The vault and operational workspace may not contain one another. All writes are confined to the resolved vault's `Arcadia/` subtree; `.obsidian/` is never created or modified.

## Record format and retry semantics

Records live at `Arcadia/Records/<project-slug>/<year>/<date>-<artifact-title>--<artifact-id>.md`. YAML frontmatter carries stable IDs, readable Project and Action names, acceptance time, source paths, ready status, and a SHA-256 of canonical accepted Markdown. The body provides Context, the complete copied planning Artifact, Outcome, and Provenance.

Stable Artifact ID is authoritative. Sync searches existing managed Records for that ID before choosing a new path, so title or Project-name changes do not create a second Record. An identical Record is skipped, a stale Record is atomically replaced, and no managed Record is automatically deleted.

## Automatic and manual triggers

Automatic export runs only during approval of `CodexPlanningArtifactAcceptance`, after linked source and Validation evidence are loaded and before the SQLite acceptance transaction. The manual sync queries only already-approved acceptance Decisions. `--dry-run` computes created, updated, skipped, and failed results without filesystem mutations.

## Verification and real-vault result

Focused memory, planning Artifact workflow, Decision-gated planning, and Daily Advantage tests pass (28 tests across 4 files). The complete Vitest suite passes (40 files passed, 2 skipped; 413 tests passed, 2 skipped). TypeScript checking and the Dashboard production build pass. The Mission Control browser suite passes all 9 tests after producing the current Dashboard build.

The Martian Rover workspace was configured for `/Users/pmark/Dev/MR/Arcadia/vaults/Arcadia1`. Dry-run found zero accepted planning Artifacts. The only planning item was open `R17`, a `CodexPlanningRunApproval`, so it was correctly excluded. Real sync exported zero Records and created only `Arcadia/README.md` plus the empty managed `Arcadia/Records/` structure. SHA-256 snapshots confirmed no file outside `Arcadia/` changed.

## Risks, assumptions, and non-goals

The projection intentionally depends on the accepted source Markdown and Validation sidecar remaining present in the operational workspace at export or repair time. A user or independent organizer can delete or alter a Record, but that never mutates SQLite; sync restores canonical generated content when source evidence remains available. Filesystem and SQLite cannot share a distributed transaction, so the design uses write-first ordering, stable identity, and idempotent replay.

Explicit non-goals are bidirectional synchronization, operational state inferred from Markdown, general Obsidian organization, plugins, knowledge graphs, embeddings or retrieval, binary/raw evidence export, and moving the Arcadia database or runtime into the vault.
