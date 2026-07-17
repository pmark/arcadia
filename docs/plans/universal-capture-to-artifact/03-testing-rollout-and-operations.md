# Testing, Rollout, And Operations

## Validation Strategy

The program must be testable without iCloud, Google Drive, Obsidian, Discord, paid providers, or cloud credentials. External integrations use temporary directories, fake servers, fixture executables, and disabled-by-default live tests.

## Test Layers

### Contract Tests

- Capture Envelope validation and version rejection.
- Capture Receipt stable JSON fields.
- Interpretation, Projected Action, policy result, delivery result, and Obsidian handoff schemas.
- CLI and HTTP adapter envelopes.
- Workflow definition origin and effective configuration.

### Unit Tests

- content hashing and idempotency keys;
- MIME/content-kind inspection;
- path-template expansion and traversal rejection;
- confidence thresholds and capability gates;
- collision policies;
- Action argument materialization without shell interpolation;
- Obsidian frontmatter rendering and escaping;
- receipt aggregation and recovery messages.

### Temporary-Workspace Integration Tests

- submit/show/list text capture;
- duplicate capture submission;
- folder stability observation and atomic claim;
- Capture → Inspection → Interpretation dry-run;
- authorized fake Workflow Run;
- Decision-gated unsafe Action with zero executor calls;
- verified multi-target delivery;
- Obsidian temporary-vault handoff;
- local HTTP Artifact retrieval and authorization failure;
- crash/restart recovery for claimed Capture and running Action.

### End-To-End Fixture Workflows

Maintain a small deterministic suite:

1. Random thought: `Pinterest might help Rebuster.`
2. Explicit command: `Fix MIDI Opener loop desynchronization.`
3. Question: `What should I focus on today?`
4. URL capture with retrieval success and failure fixtures.
5. PDF/image fixture with extracted text.
6. Voice fixture with precomputed transcript adapter.
7. Thundertonk fake rehearsal output plus optional real local `rehearsal` dry-run.
8. Multi-target delivery to temporary iCloud/Google Drive equivalents.
9. Obsidian note and attachments in a temporary vault.
10. Unsafe publication/message Action that must create a Decision.

### Optional Live Tests

Live tests require explicit environment variables and are skipped by default. They may verify:

- Google Drive Desktop root availability;
- iCloud Drive copy and synchronization visibility;
- a configured Obsidian vault target;
- local OCR/transcription tools;
- local LiteLLM health;
- authenticated LAN Artifact access.

Live tests must use a dedicated Arcadia test subdirectory, deterministic filenames, and non-destructive cleanup instructions. They must never target a vault root, Drive root, home directory, or production content directory for recursive deletion.

## Golden Capture Corpus

Store sanitized fixtures with expected routing characteristics, not brittle complete AI prose. Each case should record:

- raw input and attachments;
- expected content kind;
- expected Project candidates;
- expected intent category;
- whether an Action is appropriate;
- required capability gates;
- acceptable confidence range;
- expected delivery/vault behavior;
- correction history when a real routing mistake motivated the case.

Add every dogfooding misinterpretation to the corpus before changing routing rules.

## Required Safety Cases

| Case | Required result |
| --- | --- |
| Duplicate adapter event | Original receipt returned; no duplicate Action or delivery. |
| Partial/synchronizing file | Pending; no inspection or execution. |
| Unsupported binary | Preserved and visible; no invented interpretation. |
| High-confidence request to publish | Decision required despite confidence. |
| Workflow includes shell fragment | Validation failure or blocked policy. |
| Executable not allowlisted | Blocked before process spawn. |
| Successful exit without expected Artifact | Run failed with recovery Action. |
| Same destination/same hash | Reused successfully. |
| Same destination/different hash | Fail or version according to explicit policy; never silent overwrite. |
| Missing Drive/vault root | Fail closed; do not create lookalike root. |
| Path traversal in template | Validation failure. |
| AI output fails schema | Invalid result; no authorized Action. |
| Worker dies after claim | Lease/stale-claim recovery without duplicate execution. |
| Raw Log contains secret-like fixture | Redaction policy prevents exposure in human views. |

## Performance Budgets

Initial local targets, to be measured rather than assumed:

- Text capture receipt: under 250 ms without interpretation.
- File capture receipt after atomic preservation: bounded primarily by file copy/hash; progress visible for large files.
- Deterministic interpretation: under 500 ms for normal text.
- Receipt/status read: under 200 ms for typical workspace size.
- Dashboard snapshot: retain existing performance expectations and avoid loading binary content.
- No unbounded recursive directory scanning in capture, delivery, or vault logic.

## Rollout Stages

### Stage A: Shadow Capture

Persist Capture Envelopes and receipts while existing `ask` and ingress behavior remains authoritative. Compare records; do not execute from the new pipeline.

### Stage B: Interpretation Shadowing

Generate Interpretations and projected Actions but do not create Actions or Decisions. Review golden-corpus differences.

### Stage C: Decision-Only Policy

Policy may create Decisions and Back Burner items, but automatic execution remains disabled globally.

### Stage D: Allowlisted Automatic Actions

Enable only read-only validation and selected reversible local transforms. Expand based on dogfooding evidence.

### Stage E: Delivery And Handoff

Enable delivery targets individually. Start with workspace, then test iCloud/Google Drive, then Obsidian. HTTP LAN/deployed access remains separately gated.

### Stage F: Workflow Packs

Enable M12-M18 one at a time, each with its own fixtures and rollback switch.

## Feature Controls

Recommended controls:

- capture pipeline enabled;
- interpretation enabled;
- AI interpretation enabled and allowed execution targets;
- automatic Action creation enabled;
- automatic Workflow execution enabled;
- delivery target enablement per sink;
- Obsidian handoff enabled per vault;
- local HTTP enabled and bind address;
- notification adapter enablement.

Defaults remain capture-only until the relevant Milestone is validated.

## Operational Visibility

Operators must be able to inspect:

- captures by status/source/type/date;
- duplicate relationships;
- Inspection and Interpretation provenance;
- projected Actions and policy explanations;
- open Decisions;
- running/stale/failed/retryable Runs;
- Artifact hashes and missing-file diagnostics;
- delivery attempts and target health;
- Obsidian handoff state;
- worker/service health.

## Recovery Rules

- Never instruct the operator to rerun blindly; name the failed stage and evidence.
- Retry from the earliest failed stage, not from capture, unless the source is corrupt.
- Preserve failed Run directories and raw Logs.
- Make stale locks/leases inspectable before recovery.
- Separate “retry same immutable inputs” from “create a revised attempt.”
- A corrected Project/intent selection creates durable feedback; it does not rewrite history invisibly.

## Milestone Handoff Template

Every implementation turn ends with:

```text
Milestone:
Outcome achieved:
Implementation summary:
Compatibility preserved:
Validation run:
Artifacts created:
Known limitations:
Decisions required:
Next Action:
Recommended next prompt:
```

## Repository Validation

For production code changes:

```sh
pnpm exec vitest run <focused-tests>
pnpm build
pnpm test
git diff --check
```

For documentation-only changes:

```sh
git diff --check
```

If the full suite has a suspected unrelated timing failure, rerun the exact failing tests in isolation, report both results, and do not conceal the initial failure.
