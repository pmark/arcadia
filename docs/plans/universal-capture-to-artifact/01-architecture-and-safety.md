# Architecture And Safety

## Boundary Model

Arcadia owns orchestration and audit state. Adapters only capture. Inspectors only derive facts. Interpreters only propose meaning. Policy authorizes capabilities. Executors perform already-authorized Actions. Delivery sinks copy verified Artifacts. Obsidian receives curated handoff packages but owns later wiki organization.

```text
Adapter
  -> Capture Service
      -> Capture Repository + immutable source Artifact
      -> Inspector Registry
          -> Interpretation Service
              -> Action Projection
                  -> Automation Policy
                      -> Decision or Orchestrator
                          -> Artifact Registry
                              -> Delivery Broker
                                  -> Local / iCloud / Google Drive / HTTP
                                  -> Obsidian Handoff
```

No downstream component may mutate or delete the original source as a side effect of its own failure.

## Core Contracts

### Capture Envelope v1

The Capture Envelope is the adapter-neutral record for every incoming item.

```ts
interface CaptureEnvelopeV1 {
  schemaVersion: 1;
  id: string;
  idempotencyKey: string;
  receivedAt: string;
  source: {
    adapter: "cli" | "apple_shortcut" | "folder" | "discord" | "http" | "internal";
    sourceName: string;
    device?: string;
    externalId?: string;
  };
  content: {
    kind: "text" | "url" | "file" | "image" | "audio" | "video" | "mixed";
    originalName?: string;
    mimeType?: string;
    byteSize?: number;
    sha256?: string;
    text?: string;
    sourceArtifactPath?: string;
    attachments: CaptureAttachmentV1[];
  };
  hints: {
    project?: string;
    workflow?: string;
    note?: string;
    requestedDeliveryTargets?: string[];
  };
  status: "received" | "preserved" | "inspected" | "interpreted" | "planned" | "running" | "completed" | "failed" | "blocked";
}
```

Rules:

- Adapters may provide hints but may not assert final Project attribution or authorization.
- Raw binary content is stored as an Artifact, never embedded in SQLite.
- Raw text may be stored in SQLite only under documented size and sensitivity limits; otherwise it is an Artifact.
- `idempotencyKey` is adapter-supplied when trustworthy or derived from source identity plus content hash.
- The Capture record is append-oriented. Later stages add linked records rather than rewriting source evidence.

### Capture Receipt v1

Every accepted capture returns a stable receipt even if no other stage runs.

```ts
interface CaptureReceiptV1 {
  captureId: string;
  accepted: boolean;
  duplicateOf?: string;
  status: string;
  sourceArtifacts: ArtifactReferenceV1[];
  interpretationId?: string;
  actionIds: string[];
  decisionIds: string[];
  runIds: string[];
  resultArtifacts: ArtifactReferenceV1[];
  deliveryResults: DeliveryResultV1[];
  statusMessage: string;
  recommendedNextAction?: string;
}
```

The receipt is the stable response surface for CLI JSON, sidecars, Dashboard views, Discord replies, Apple Shortcut notifications, and HTTP callers.

### Inspection Result v1

Inspection records observable facts without assigning intent:

- detected MIME and content kind;
- byte size and SHA-256;
- file metadata;
- safe text extraction;
- OCR or transcript references;
- URL canonicalization and retrieval status;
- warnings, extractor version, and provenance.

An inspector must be deterministic for the same input and configuration. AI transcription or OCR, when used, is represented as an Intelligence job with its own provenance rather than disguised as deterministic inspection.

### Interpretation v1

Interpretation proposes meaning and includes evidence:

```ts
interface CaptureInterpretationV1 {
  id: string;
  captureId: string;
  kind: "idea" | "thought" | "command" | "question" | "reference" | "meeting" | "unknown";
  projectCandidates: ScoredCandidateV1[];
  intentCandidates: ScoredCandidateV1[];
  summary: string;
  evidence: InterpretationEvidenceV1[];
  method: "deterministic" | "local_ai" | "frontier_ai" | "combined";
  confidence: number;
  modelProvenance?: IntelligenceProvenanceV1;
  createdAt: string;
}
```

Interpretation does not create permission. A 0.99 confidence command that sends a message still requires a Decision because the capability is gated.

### Projected Action v1

A projected Action is an inspectable proposal linked to the capture and interpretation. It includes:

- canonical Action title and expected Artifact;
- candidate Project and Milestone;
- Workflow or deterministic skill ID;
- materialized input bindings;
- required capabilities;
- reversibility and side-effect classification;
- confidence and evidence;
- validation criteria;
- proposed delivery targets.

Projected Actions remain proposals until policy marks them `authorized`, `needs_decision`, `deferred`, or `blocked`.

### Delivery Target v1

```ts
interface DeliveryTargetV1 {
  id: string;
  kind: "workspace" | "icloud_drive" | "google_drive" | "local_http" | "deployed_http" | "obsidian_vault";
  enabled: boolean;
  root?: string;
  pathTemplate: string;
  collisionPolicy: "verify_and_reuse" | "fail" | "version";
  verification: "sha256" | "size";
  accessPolicy?: "private_local" | "authenticated" | "public";
}
```

Secrets and access tokens are referenced from environment or system credential storage. They never appear in workflow JSON, receipts, Logs, or prompt packets.

### Obsidian Handoff v1

The handoff is a delivery package, not a second database:

- Markdown note with stable frontmatter;
- links to Capture, Project, Action, Run, and Artifacts;
- copied or linked attachments according to vault configuration;
- deterministic destination template;
- handoff manifest and hash verification;
- no automatic backlink rewriting, taxonomy refactoring, or deletion of existing vault notes.

Suggested frontmatter:

```yaml
arcadia_capture_id: capture_...
arcadia_project_id: proj_...
arcadia_action_ids: [work_...]
arcadia_run_ids: [run_...]
arcadia_status: completed
source_kind: voice
captured_at: 2026-07-17T12:00:00Z
artifact_paths: []
```

## Module Boundaries

Recommended internal boundaries:

- `src/capture/*`: envelope validation, persistence, receipt assembly, attachment preservation.
- `src/inspection/*`: deterministic inspector registry and extractors.
- existing `src/intake/*` and `src/stewardship/*`: interpretation and routing, extended through compatibility-preserving contracts.
- `src/policy/*` or a focused capability module: Action authorization; do not bury policy inside adapters or executors.
- existing `src/workflows/*` and execution infrastructure: Workflow definitions, Runs, and safe execution.
- `src/delivery/*`: sink registry, verified copies, URLs, and delivery records.
- `src/obsidian/*`: vault-specific handoff renderer and delivery adapter.
- existing `src/intelligence/*`: durable AI jobs, routing, validation, and model provenance.

These folder names are recommendations, not permission to duplicate working abstractions. M0 must confirm the final placement.

## Automation Policy

Policy evaluates both epistemic confidence and capability risk.

| Capability | Default disposition |
| --- | --- |
| Preserve, hash, inspect metadata, deduplicate | Autonomous |
| OCR/transcribe using configured local tool | Autonomous when local and content policy allows |
| Create local draft, report, manifest, or Obsidian staging note | Autonomous |
| Route to a Project above configured confidence with no conflicting evidence | Autonomous, with visible correction path |
| Execute allowlisted read-only validation command | Autonomous |
| Execute allowlisted reversible local transformation | Autonomous when Workflow explicitly permits it |
| Ambiguous Project, intent, or Action | Needs Mark Decision or safe Back Burner capture |
| Code or repository mutation | Codex or configured local executor under existing approval policy |
| Credentials or production data | Needs Mark Decision |
| External publication, deployment, messages, social posting | Needs Mark Decision |
| Destructive filesystem operation or overwrite with different content | Needs Mark Decision or blocked |
| Spending, purchasing, financial commitment | Needs Mark Decision |
| Merge to main or release submission | Needs Mark Decision |

Recommended initial confidence behavior:

- `>= 0.95`: may route automatically only when evidence is unambiguous and capability policy allows it.
- `0.75-0.949`: preserve interpretation and request a Decision before consequential Action creation.
- `< 0.75`: capture safely as unknown, thought, or Back Burner; do not manufacture an Action.

These are starting configuration values, not hardcoded universal truths. Real capture fixtures should drive adjustment.

## Idempotency And Collision Safety

Three different identities must remain distinct:

1. Capture identity: prevents the same adapter event or content from creating duplicate capture records.
2. Run identity: preserves every execution attempt while linking retries and reusing completed idempotent results where valid.
3. Delivery identity: prevents repeated copies from duplicating or overwriting destination Artifacts.

Required behavior:

- Same capture idempotency key returns the original receipt.
- Same content from a different meaningful event may create a new capture linked to the same source Artifact hash.
- Retry creates a new immutable Run linked to the prior Run unless a completed result is explicitly reusable.
- Same destination and same hash is success with `reused: true`.
- Same destination and different hash follows configured `fail` or `version`; it never silently overwrites.
- Partial writes use a temporary sibling and atomic rename where the filesystem supports it.

## Provenance

Every derived record must answer:

- Which Capture and source Artifact produced this?
- Which code/config/policy version was used?
- Was the result deterministic, local AI, frontier AI, or human-authored?
- Which Workflow, Action, Run, and step produced it?
- Which validation passed or failed?
- Where was it delivered, with which hash?
- What Decision authorized any gated capability?

Raw stdout/stderr and full machine results remain Log or Artifact evidence even when the UI shows a cleaned summary.

## Configuration Layers

Precedence should be explicit:

```text
built-in safe defaults
  < workspace configuration
  < Project configuration
  < explicit per-capture hints that policy permits
```

Configuration changes are validated before activation. Invalid workspace or Project overrides must fail closed and identify the file and field. Operator-facing commands should show the effective definition and its origin.

## Decisions Needed

The following should be confirmed before their Milestones, not assumed during M1:

1. Exact Obsidian vault roots and whether attachments are copied or linked.
2. Whether local HTTP URLs are LAN-visible or localhost-only by default.
3. Authentication mechanism for LAN or deployed Artifact URLs.
4. Which local OCR and transcription tools are installed and permitted.
5. Project-routing confidence thresholds after a real capture fixture set exists.
6. Whether Google Drive and iCloud delivery roots are global or Project-specific.
7. Retention policy for raw captures, derived text, and failed temporary files.
8. Whether sensitive captures need encryption or redaction before Intelligence processing.

None of these block M1's local durable Capture Envelope and receipt.
