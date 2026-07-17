# Milestone Implementation Guide

## Common Milestone Contract

Every Milestone must satisfy the following before it is marked complete:

1. Re-read `AGENTS.md` and `docs/arcadia-semantics.md`.
2. Inspect the current implementation and dirty worktree; preserve unrelated changes.
3. State the current Milestone, next Action, Responsibility, and required Artifacts.
4. Confirm the smallest vertical slice and explicit non-goals.
5. Prefer an additive, compatibility-preserving contract.
6. Add deterministic unit tests and at least one temporary-workspace integration test.
7. Preserve stable CLI JSON envelopes and existing adapters.
8. Validate failure, retry, idempotency, and collision behavior—not only success.
9. Update operator documentation and the next Milestone handoff.
10. Run focused tests, `pnpm build`, and the full suite when production code changes.

No Milestone may silently expand into Dashboard redesign, remote multi-user infrastructure, arbitrary command execution, automatic publishing, or a new AI framework.

## M0: Ground Truth And Contracts

### Objective

Reconcile this program with the actual repository and freeze the first versioned contracts before implementation.

### Scope

- Map current ingress, `ask`, Intake, stewardship, Workflows, Runs, Intelligence jobs, Artifacts, HTTP routes, Dashboard, and workers.
- Identify overlapping records and choose reuse or compatibility adapters.
- Finalize Capture Envelope v1 and Capture Receipt v1.
- Write an additive migration plan and command naming proposal.
- Record unresolved Decisions without blocking M1 unnecessarily.

### Non-Goals

- No schema, CLI, worker, Dashboard, or execution changes.
- No new AI calls.

### Required Artifacts

- Ground-truth report linked from this package.
- Approved contract examples and migration map.
- M1 implementation task list.

### Acceptance And Validation

- Every proposed field has an owner and lifecycle.
- No new user-facing primary term conflicts with Arcadia semantics.
- Existing adapters have an explicit compatibility path.
- Documentation links resolve; `git diff --check` passes.

### Responsibility

Codex. Needs Mark only for decisions that materially alter capture retention, privacy, or public contracts.

## M1: Durable Capture Envelope And Receipt

### Objective

Accept and preserve one text capture through a versioned, adapter-neutral contract and return a durable receipt. Do not interpret or execute it.

### Smallest Vertical Slice

```text
arcadia capture submit --text "Pinterest might help Rebuster" --json
  -> captures table row
  -> source text Artifact when required by storage policy
  -> Capture Receipt JSON
  -> capture show <id>
```

### Scope

- Add Capture Envelope/attachment validation.
- Add additive capture and capture-artifact linkage migrations through the appropriate core or capability migration path.
- Add repository create/get/list functions with idempotency.
- Add CLI submit/show/list commands with JSON envelopes.
- Preserve raw source and record hash/provenance.
- Add adapter-neutral receipt assembly.

### Non-Goals

- No Project routing, intent classification, Action projection, Workflow matching, AI, automatic execution, external delivery, or Dashboard UI.
- Do not replace `arcadia ask`; compatibility comes later.

### Likely Files

- `src/capture/types.ts`, `validation.ts`, `repository.ts`, `service.ts`.
- capability migration or `database/schema.sql` only if the ground-truth decision requires core ownership.
- `src/commands/capture.ts`, `src/cli.ts`, workspace paths, tests, and docs.

### Failure And Recovery

- Invalid envelope: reject before persistence.
- Duplicate idempotency key: return original capture and `created: false`.
- Artifact write failure: no successful preserved status; retain recoverable diagnostic evidence.
- Database failure after file write: clean only the exact unreferenced temporary file or leave a documented recovery candidate.

### Acceptance And Validation

- Same idempotency key returns the same capture ID.
- Different capture events with identical content are representable without duplicating bytes unnecessarily.
- Receipt exposes stable source Artifact references and status.
- Tests prove text success, validation failure, duplicate submission, missing workspace, and interrupted artifact write behavior.

### Responsibility

Codex.

## M2: Workflow Registry And Operator Control

### Objective

Give Mark complete, inspectable control over enabled workflows without expanding execution power.

### Scope

- Version the Workflow definition contract and separate match, Action steps, outputs, policy, and delivery targets.
- Preserve v1 Thundertonk definitions through migration or compatibility loading.
- Show definition origin: built-in, workspace override, or Project override.
- Support list/show/match/validate/copy/create/enable/disable/dry-run.
- Add a non-interactive scaffold command that creates a disabled definition by default.
- Validate executable allowlists, placeholders, output contracts, delivery references, and unsafe capabilities.

### Non-Goals

- No generic shell fragments, remote command service, arbitrary executable discovery, or automatic activation.
- No graphical editor yet.

### Required Artifacts

- JSON Schema or equivalent deterministic validator.
- Example definitions for no-op/text transform and Thundertonk.
- CLI contract documentation and migration tests.

### Acceptance And Validation

- Creating a workflow never executes it.
- Invalid definitions identify exact fields.
- Workspace overrides do not modify built-ins.
- Dry-run materializes argv, working directory, outputs, policy, and delivery plan without writes.
- Existing Thundertonk tests remain green and preserve exact MP3 filenames.

### Responsibility

Codex. Needs Mark only for the initial executable allowlist policy.

## M3: Universal Ingress And Claiming

### Objective

Make CLI, Apple Shortcuts, watched folders, Discord, and future HTTP adapters submit the same Capture Envelope and receive the same receipt.

### Scope

- Add an adapter interface around the M1 capture service.
- Convert existing `.txt` and direct-file ingress into Capture submissions while preserving folder compatibility.
- Keep stable size/mtime observation, atomic claims, Done/Failed retention, and sidecars.
- Make sidecars serialize Capture Receipts.
- Add source adapter metadata without letting adapters authorize work.

### Non-Goals

- No interpretation or execution from capture submission itself.
- Do not require a permanently running daemon; periodic workers remain supported.

### Acceptance And Validation

- The same fixture submitted through CLI and folder ingress produces contract-equivalent captures.
- Partial files remain pending.
- Concurrent claims do not duplicate captures.
- Crash recovery identifies stale claims safely.
- Existing Apple Shortcut behavior remains compatible.

### Responsibility

Codex.

## M4: Deterministic Inspection And Normalization

### Objective

Derive observable facts and normalized representations without inferring intent.

### Scope

- Inspector registry keyed by content kind/MIME.
- File hashes, size, dates, media metadata, safe text extraction, URL canonicalization, and attachment enumeration.
- Optional OCR/transcription adapters represented with explicit method/provenance.
- Inspector versioning and reproducible Inspection Results.
- Limits for file size, recursion, timeouts, archive expansion, and malformed input.

### Non-Goals

- No Project routing, summarization presented as fact, or Action creation.
- No required cloud OCR/transcription.

### Acceptance And Validation

- Text, URL, PDF fixture, image fixture, and audio metadata fixture produce stable results.
- Unsupported content remains preserved with `inspection_unsupported`, not failed capture.
- Extractor timeout and malformed files produce typed diagnostics.
- Sensitive raw data is not copied into Logs.

### Responsibility

Codex. Needs Mark for choosing installed OCR/transcription tools after deterministic metadata support lands.

## M5: Interpretation And Action Projection

### Objective

Propose meaning, Project attribution, and candidate Actions without executing or mutating Project state.

### Scope

- Extend existing Intake/stewardship rather than creating a parallel router.
- Deterministic rules first; Intelligence jobs only when configured and necessary.
- Produce versioned Interpretation and Projected Action records with evidence and confidence.
- Distinguish idea, thought, command, question, reference, meeting, and unknown.
- Add `capture interpret`, `capture show`, and dry-run projection views.
- Build a golden fixture corpus from real Arcadia, MIDI Opener, Rebuster, Field Notes, band, and ambiguous thoughts.

### Non-Goals

- No Action creation, Workflows, external delivery, or automatic execution.
- No fallback to frontier AI when policy disallows it.

### Acceptance And Validation

- “Pinterest might help Rebuster” remains an Idea/thought, not an invented command.
- “Fix MIDI Opener loop desynchronization” projects a repository Action.
- “What should I focus on today?” remains a question/status request.
- Each candidate includes evidence and method provenance.
- Low confidence results preserve the capture and explain uncertainty.

### Responsibility

Codex. Needs Mark to review the golden corpus and correction UX before policy automation.

## M6: Automation Policy And Decisions

### Objective

Convert projected Actions into predictable authorization outcomes.

### Scope

- Implement policy evaluation separate from interpretation and execution.
- Evaluate required capabilities, confidence, reversibility, Workflow safety, Project policy, and approval gates.
- Produce `authorized`, `needs_decision`, `deferred`, or `blocked` outcomes.
- Reuse core Decisions and approval gates.
- Add policy dry-run/explain command and correction path.

### Non-Goals

- No execution implementation.
- Confidence must not override capability gates.

### Acceptance And Validation

- Read-only validation can authorize at high confidence.
- Message sending, publication, deployment, credentials, production data, money, destructive writes, and merge always require Decisions by default.
- Unknown executable or hidden shell fragment is blocked.
- Policy version and evidence are persisted.
- Tests prove the executor is never invoked during policy evaluation.

### Responsibility

Codex for implementation; Needs Mark to approve initial thresholds and capability defaults.

## M7: Safe Orchestration And Recovery

### Objective

Execute authorized Actions through durable, restart-safe Runs with complete evidence.

### Scope

- Reconcile workflow Runs with existing execution Runs without opportunistic schema renames.
- Execute direct executable + argv arrays only.
- Durable step states, timeouts, stdout/stderr Logs, exit status, expected-output validation, and retry linkage.
- Worker leases/stale-run recovery using existing worker patterns.
- Idempotent completed-result reuse where Workflow contracts permit it.
- Recommended recovery Action for every failure class.

### Non-Goals

- No remotely exposed arbitrary executor.
- No auto-retry of non-idempotent or externally consequential Actions.

### Acceptance And Validation

- Kill-and-restart fixture recovers or fails deterministically.
- Successful exit without expected outputs is failure.
- Duplicate worker cannot execute the same claimed Action.
- Raw Logs remain available while status shows cleaned progress.
- Thundertonk remains a passing real-output-shape regression.

### Responsibility

Codex.

## M8: Artifact Delivery Broker

### Objective

Deliver verified Artifacts through reusable local, iCloud Drive, and Google Drive sinks.

### Scope

- Delivery target config and effective-origin inspection.
- Sink registry with workspace, iCloud, and Google Drive Desktop implementations.
- Path templates, atomic copy, hash/size verification, collision policy, and delivery records.
- Retry without duplicate directories or files.
- Per-Workflow and per-Project target references.

### Non-Goals

- No Google Drive API requirement.
- No public URLs; HTTP is M9.

### Acceptance And Validation

- Same hash reuses destination; different hash follows fail/version policy.
- Missing sync root fails rather than creating an unsynchronized lookalike.
- Multiple delivery targets can succeed/fail independently with a composite receipt.
- Temporary filesystem tests require no cloud account.
- Optional live tests are explicitly enabled and never destructive.

### Responsibility

Codex. Needs Mark to confirm real target roots and collision preferences.

## M9: HTTP Artifact Access

### Objective

Return immediately usable HTTP URLs for authorized Artifacts on the MacBook Air and, later, a deployed system.

### Scope

- Generalize the existing Intelligence artifact route or add a compatible core Artifact route.
- Localhost-only default, MIME-safe streaming, range support where needed, stable IDs, and access logging.
- Configurable LAN exposure with authentication and explicit startup state.
- Define deployed adapter contract without requiring deployment in the first slice.

### Non-Goals

- No public unauthenticated file server.
- No remote write/upload API in the first slice.

### Acceptance And Validation

- Artifact URLs survive process restart because IDs resolve from SQLite.
- Path traversal and arbitrary local file reads are impossible.
- Unauthorized LAN requests fail closed.
- Missing files return typed errors and recovery guidance.

### Responsibility

Codex. Needs Mark before LAN exposure or deployed hosting.

## M10: Obsidian Vault Handoff

### Objective

Position complete, deterministic handoff packages in one or more configured Obsidian vaults after Arcadia processing.

### Scope

- Vault target configuration with root validation and path templates.
- Markdown renderer with stable frontmatter and links to source/result Artifacts.
- Attachment copy/link policy, hash verification, collision handling, and handoff manifest.
- Project-specific vault and folder selection.
- Retry and correction commands.

### Non-Goals

- No automatic reorganization of existing vault notes.
- No backlink graph curation, taxonomy migration, or deletion.
- Obsidian files do not become authoritative execution state.

### Acceptance And Validation

- A completed capture produces one note and verified attachments in a temporary vault fixture.
- Repeated handoff is idempotent.
- Existing different-content note follows configured collision policy.
- Frontmatter round-trips and contains stable Arcadia IDs.
- Missing vault root fails closed.

### Responsibility

Codex after Needs Mark supplies vault roots and copy/link policy.

## M11: Receipts, Dashboard, Digest, And Recovery

### Objective

Make the system understandable at a glance from CLI, sidecar, Dashboard, and optional notification adapters.

### Scope

- Unified receipt renderer and status timeline.
- Dashboard capture inbox, interpretations, Decisions, Runs, deliveries, and Artifact links.
- Daily capture digest and failure/retry queue.
- Correction actions for Project/intent routing that become future evidence.
- Notification adapter contract; sending remains policy-gated where applicable.

### Non-Goals

- No Dashboard-owned state or hidden mutation path.
- No noisy notification for every internal step.

### Acceptance And Validation

- Refreshing the Dashboard reconstructs state from SQLite.
- Every failed capture shows a recovery Action.
- Digest is deterministic from a fixed database fixture.
- Adapter JSON contracts remain stable.

### Responsibility

Codex. Needs Mark to choose notification defaults.

## M12: Quick Thought And Idea Workflow

### Objective

Turn arbitrary thoughts into appropriately modest progress without over-classifying them.

### Behavior

- Preserve text and context.
- Interpret Idea/thought/question/command.
- Route clear Project references.
- Create Back Burner item, Idea Artifact, or projected Action according to evidence.
- Deliver an Obsidian handoff and receipt.

### Acceptance Examples

- “Pinterest might help Rebuster” becomes an Idea or Back Burner item.
- “Should Rebuster try Pinterest?” remains a question/Idea, not a posting Action.
- “Implement Rebuster Pinterest publishing” projects gated build and publication Actions.

### Responsibility

Codex; no new gates beyond M6.

## M13: Voice Thought And Meeting Workflow

### Objective

Convert speech into preserved audio, transcript, summary, candidate Decisions, Actions, and Obsidian notes.

### Safety And Scope

- Local transcription preferred; cloud transcription requires configured policy.
- Speaker/identity inference is never asserted without evidence.
- Transcript and summary are separate Artifacts.
- Meetings create candidate Actions with responsibility, never silent commitments.

### Acceptance

- A fixture audio/transcript path works without cloud access.
- Failed transcription leaves preserved audio and retry guidance.
- Obsidian note links audio, transcript, and projected Actions.

## M14: URL, Research, And Arbitrary File Workflow

### Objective

Turn shared URLs, PDFs, screenshots, documents, CSVs, and photos into useful research/reference Artifacts.

### Safety And Scope

- Preserve original, canonicalize URL, inspect metadata, extract text/OCR where configured.
- Separate source facts, extracted text, and generated summary.
- Respect file limits, retrieval policy, authentication, and copyright-safe excerpting in delivered summaries.
- Route to reference, research Action, or Project Artifact.

### Acceptance

- URL, PDF, image, and unknown-binary fixtures have predictable outcomes.
- Retrieval failure does not lose the shared URL.
- Unknown file remains captured and accessible.

## M15: Project Command And Software Release Workflow

### Objective

Route explicit software work to the correct repository, validation commands, Codex packet, release process, and Artifacts.

### Behavior

- Reuse Project metadata and coding-agent profiles.
- Deterministic validation may run automatically when allowlisted.
- Code changes, merges, releases, and App Store submission remain gated.
- MIDI Opener release notes use the existing release workflow/skill behavior and produce localized metadata evidence.

### Acceptance

- MIDI Opener bug-fix, release-note, and repository-validation golden requests route distinctly.
- Missing repository metadata blocks with a useful setup Action.
- No merge, push, or publication occurs without authorization.

## M16: Analytics And Field Notes Workflow

### Objective

Turn approved PostHog and Apple Analytics inputs into normalized datasets, evidence, analysis, charts, and Field Notes content packages.

### Safety And Scope

- Credentials and production data require Decisions.
- Raw, normalized, analyzed, and editorial Artifacts remain distinct.
- Deterministic normalization and comparison precede AI interpretation.
- Publication remains gated.

### Acceptance

- Fixture data runs entirely offline.
- Provenance connects every claim/chart to dataset versions.
- Missing credentials produce a Decision, not a failed destructive Run.

## M17: Rebuster Creative Production Workflow

### Objective

Progress rebus Ideas through candidates, overlap review, strict specifications, production Artifacts, and publication preparation.

### Safety And Scope

- Rebuster retains ownership of domain state; Arcadia orchestrates Actions, Decisions, Logs, and Artifacts through the existing capability contract.
- Candidate generation, overlap validation, and spec generation are separate steps.
- Social publication and messages remain gated.

### Acceptance

- Existing Rebuster bridge contract remains valid.
- Candidate and strict-spec fixtures are idempotent and inspectable.
- An overlap conflict creates a Decision with evidence.

## M18: Portfolio Pulse And Weekly Review Workflow

### Objective

Turn recent Captures, Actions, Runs, Logs, Decisions, Milestones, and Artifacts into daily focus and weekly momentum reports.

### Scope

- Deterministic aggregation first.
- Optional AI narrative is a derived Artifact with provenance.
- Produce Project and portfolio views plus Obsidian daily/weekly notes.
- Identify blockers, stale Decisions, failed deliveries, and the most useful next Action.

### Acceptance

- Fixed database fixture yields stable report sections and counts.
- Report links every claim to source records.
- No portfolio-wide Action execution is triggered by generating the report.

### Responsibility

Codex. Needs Mark only for report prioritization preferences after dogfooding.
