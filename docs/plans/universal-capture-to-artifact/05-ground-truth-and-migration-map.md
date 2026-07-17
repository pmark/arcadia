# Ground Truth And Migration Map

## Status

Verified against the repository on 2026-07-17. This document completes M0 and is the starting evidence for M1.

## Current System Map

### Existing Capture-Like Surfaces

| Surface | Current responsibility | Preserve |
| --- | --- | --- |
| `arcadia capture --text` | Creates structured executable intent as an Action-oriented record. | Yes, as a compatibility command; it is not the universal Capture Envelope. |
| `arcadia ask` | Resolves natural-language intent, creates ask audit records, Actions/Plans or Decisions/Back Burner items, and may run safe work. | Yes; later consume Capture IDs without replacing the command abruptly. |
| `arcadia ingress process` | Claims `.txt` and configured workflow media files, calls `ask` or Workflow execution, moves sources to Done/Failed, and writes sidecars. | Yes; M3 adapts it to Capture submission and common receipts. |
| Apple helper/Shortcuts | Atomically place request text or files in the ingress contract. | Yes; adapters remain thin and never authorize Actions. |
| Discord adapter | Submits request text and renders Arcadia results. | Yes; M3 maps it to Capture Envelope/Receipt. |
| Arcadia Intelligence API | Accepts durable, idempotent AI jobs with execution constraints and validated outputs. | Yes; this is an AI execution service, not a universal Capture store. |

### Existing Records To Reuse

| Existing record/service | Reuse decision |
| --- | --- |
| `artifacts` | Reuse for preserved source files and derived/delivered outputs. Add capture linkage rather than a second Artifact table. |
| `events` | Reuse for capture lifecycle activity where appropriate; do not make events the authoritative capture row. |
| `ask_requests` | Keep as the audit record for `ask`. Add an optional Capture link in a later compatibility Milestone; do not overload it with arbitrary binary/file capture. |
| `back_burner_items` | Reuse after M5/M6 for speculative thoughts; M1 creates none. |
| `work_items` | Reuse as Actions after policy authorization; M1 creates none. |
| `review_items` and approval gates | Reuse as Decisions/policy gates in M6; M1 creates none. |
| `execution_runs` and workflow Run manifests | Preserve. M7 reconciles linkage and recovery; M1 creates no Run. |
| `intelligence_jobs` | Reuse for optional AI inspection/interpretation jobs in M4/M5; M1 invokes none. |
| CLI `CommandSuccess` envelope | Reuse. Capture Receipt lives inside `data`, with Artifact paths also exposed through the standard top-level `artifacts` array. |
| Dashboard snapshot | Extend only in M11. No M1 Dashboard change. |

## Ownership Decisions

### Capture Is A Core Cross-Cutting Record

Capture is not a Project capability such as Blogging or Rebuster. It is a system-boundary record used before Project attribution exists. Its schema and repository should therefore live in Arcadia core rather than a Project-specific capability module.

Implementation may use the existing additive migration mechanism, but the resulting tables and APIs are core contracts. Do not create a `capture` capability that owns Project-specific state.

### Receipt Is Computed, Not A Mutable Blob

The authoritative state consists of the Capture row and linked Artifacts/events. `CaptureReceiptV1` is assembled from current persisted state. A sidecar may snapshot a receipt for adapter convenience, but the sidecar is not authoritative.

### Source Text Storage

For M1, bounded plain text may be stored in the Capture row for efficient inspection and hashed deterministically. The service must define a maximum UTF-8 byte length. Larger text and all binary content are stored as source Artifacts with database linkage. M1 should choose a conservative configurable or constant limit and test the boundary.

### Capture Status

M1 needs only:

- `received` during the create transaction/service operation;
- `preserved` after all required source evidence is durable;
- `failed` only when a durable failed record is intentionally retained.

Later statuses are introduced additively by the Milestone that owns them. Avoid adding a large speculative status enum that no current code can produce.

## Proposed M1 Schema

Exact SQL belongs to implementation review, but M1 requires the following logical shape:

```text
captures
  id                  primary key
  schema_version      integer, initially 1
  idempotency_key     unique, required
  source_adapter      required
  source_name         required
  external_id         nullable
  content_kind        text, M1 accepts text
  original_name       nullable
  mime_type           nullable
  byte_size           nullable
  sha256              required after preservation
  raw_text            nullable and bounded
  hints_json          required, default {}
  status              received|preserved|failed
  failure_code        nullable
  failure_message     nullable
  created_at          required
  updated_at          required

capture_artifacts
  id                  primary key
  capture_id          foreign key -> captures
  artifact_id         foreign key -> artifacts
  role                source|attachment|derived|result|log|delivery
  created_at          required
  unique(capture_id, artifact_id, role)
```

Indexes:

- unique idempotency key;
- created time for list ordering;
- source adapter plus external ID when supplied;
- capture status;
- capture-artifact lookup.

Do not add Interpretation, projected Action, policy, delivery, or Obsidian tables in M1.

## Proposed M1 Type Ownership

```text
src/capture/types.ts
  CaptureEnvelopeV1
  CaptureAttachmentV1
  CaptureReceiptV1
  CaptureRecord

src/capture/validation.ts
  deterministic envelope validation
  bounded text validation
  normalized idempotency validation

src/capture/repository.ts
  insert/find/list/link Artifact

src/capture/service.ts
  preserve source
  transaction/idempotency coordination
  assemble receipt

src/commands/capture.ts
  preserve existing command behavior
  add submit/show/list command handlers or compatibility surface chosen below
```

## CLI Compatibility Plan

Preferred public shape:

```text
arcadia capture submit --text <text> [--idempotency-key <key>] [--source <name>] [--json]
arcadia capture show <capture-id> [--json]
arcadia capture list [--source <name>] [--status <status>] [--limit <n>] [--json]
```

Existing behavior must remain available:

```text
arcadia capture --text <intent> ...
```

The implementation should first prove whether Commander can safely support a parent action and subcommands without ambiguous parsing. If it can, retain the exact legacy command and document it as Action-oriented capture. If it cannot, add a compatibility alias with regression tests before changing user-facing behavior. Do not silently reinterpret existing `capture --text` calls as source-only capture because adapters may rely on Action creation.

Stable M1 command names inside JSON:

```text
capture.submit
capture.show
capture.list
```

## Idempotency Plan

- Caller-supplied key is preferred when the adapter has a stable external event ID.
- CLI may generate a key when omitted, making each manual submission a distinct capture.
- Folder/Shortcut adapters in M3 derive the key from source identity plus content hash after stable preservation.
- Duplicate insertion races are resolved by the database unique constraint and return the existing record.
- Same text with different generated keys is allowed because repeated thoughts may be distinct meaningful events.

## Artifact Plan

M1 text at or below the storage limit may have no separate file Artifact, but the receipt must expose the Capture itself as durable source evidence. If implementation determines that every Capture must have a file Artifact for uniformity, use a deterministic workspace path and document the additional filesystem/transaction failure modes before coding.

Binary source preservation is deliberately deferred to M3/M4 unless a minimal shared Artifact helper is required to avoid architectural rework. Do not broaden M1 to universal file copying.

## M1 Task Order

1. Add contract types and deterministic validator with fixtures.
2. Add additive schema migration and migration/idempotency tests.
3. Add repository create/find/list functions and duplicate-race behavior.
4. Add service submit/show/list and receipt assembly.
5. Add CLI handlers and Commander compatibility tests.
6. Add temporary-workspace end-to-end test.
7. Update adapter/command docs without claiming routing or execution.
8. Run focused tests, build, full suite, and diff check.

## Required M1 Test Cases

- valid text submission and receipt;
- omitted optional hints;
- invalid schema version;
- empty/oversized text;
- invalid or empty idempotency key;
- duplicate key returns existing Capture and `created: false`;
- same text with different keys creates distinct Captures;
- list ordering and limit validation;
- show missing ID typed failure;
- missing/uninitialized workspace;
- migration idempotency on an existing workspace;
- legacy `arcadia capture --text` behavior unchanged;
- JSON success and failure envelopes.

## M1 Non-Blockers

The following are explicitly deferred and do not require Decisions before implementation:

- Obsidian vault roots;
- Drive/iCloud roots;
- local HTTP bind/authentication;
- OCR/transcription tools;
- interpretation confidence thresholds;
- AI routing/model choices;
- automatic Action policy;
- retention beyond preserving M1 records.

## M1 Blocking Decisions

None identified from current repository evidence. If implementation finds Commander incompatibility or a transaction boundary that would force a breaking change, stop and present the concrete evidence and compatibility options.

## Completion Evidence For M0

- Existing concepts have explicit reuse decisions.
- Capture core ownership is defined.
- M1 schema, type, command, idempotency, and Artifact boundaries are specified.
- Compatibility and test requirements are explicit.
- M1 can begin without external services or user configuration.
