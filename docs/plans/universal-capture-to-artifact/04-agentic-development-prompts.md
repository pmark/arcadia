# Agentic Development Prompts

## How To Use This Library

For each development turn, copy the Base Prompt and append exactly one Milestone Prompt. Do not combine Milestones merely to save turns. The agent should finish and validate the smallest useful vertical slice, then provide a handoff and recommended next prompt.

The full recommended initial prompt appears at the end of this document.

## Base Prompt

```text
Continue developing Arcadia in:

/Users/pmark/Dev/MR/Arcadia/arcadia

Use the Universal Capture-to-Artifact program as the implementation contract:

docs/plans/universal-capture-to-artifact/README.md
docs/plans/universal-capture-to-artifact/01-architecture-and-safety.md
docs/plans/universal-capture-to-artifact/02-milestone-implementation-guide.md
docs/plans/universal-capture-to-artifact/03-testing-rollout-and-operations.md
docs/plans/universal-capture-to-artifact/05-ground-truth-and-migration-map.md

Before making changes:

1. Read AGENTS.md and docs/arcadia-semantics.md completely.
2. Read the program documents above and the selected Milestone section completely.
3. Inspect the current branch and git status. Preserve all unrelated and pre-existing changes, including untracked Apple Shortcut/plist artifacts. Do not stage or commit unless explicitly asked.
4. Inspect the actual ingress, capture, ask/Intake/stewardship, workflow, execution, Intelligence, Artifact, database, CLI response, worker, Dashboard, tests, and documentation surfaces relevant to this Milestone.
5. Identify the current Milestone, next Action, Responsibility, and required Artifacts.
6. Present a concise implementation plan, then implement and validate the smallest useful end-to-end slice. Do not stop at a design document unless implementation is genuinely blocked.

Architecture and safety rules:

- Preserve source content before interpretation.
- Prefer deterministic local behavior, then configured local AI, then explicitly allowed frontier execution.
- Reuse existing Arcadia concepts and services. Do not introduce parallel Capture, Action, Decision, Run, Artifact, Log, Intelligence job, or workflow systems.
- Keep SQLite authoritative and files as durable Artifacts/delivery copies.
- Preserve existing CLI JSON envelopes and adapter compatibility.
- Never store executable shell fragments when executable + argv is sufficient.
- Never expose a general-purpose remote arbitrary command executor.
- Confidence does not bypass capability gates.
- Publication, deployment, sending messages, credentials, production data, financial activity, destructive operations, overwrite-with-different-content, and merge to main require explicit Decisions by default.
- Every write and retry must be idempotent or collision-safe.
- Preserve raw Logs as Artifacts while exposing cleaned status.
- Do not make Obsidian authoritative for Arcadia execution state.
- Add focused deterministic tests and temporary-workspace integration coverage.
- Live cloud/vault tests must be skipped by default and explicitly enabled.
- Run focused tests, pnpm build, pnpm test, and git diff --check for production changes.

At handoff, report:

- Milestone and outcome achieved;
- implementation summary and compatibility preserved;
- validation commands/results;
- Artifacts created;
- known limitations and Decisions required;
- exact next Action and recommended next prompt.
```

## M0 Prompt: Ground Truth And Contracts

```text
Selected Milestone: M0 — Ground Truth And Contracts.

Audit and, if repository changes require it, update the existing documentation-only ground-truth report. Reconcile the proposed Capture Envelope, Capture Receipt, Inspection Result, Interpretation, Projected Action, delivery, and Obsidian contracts with the repository as it exists now. Identify exactly which existing records/services are reused, which need additive fields/tables, and which need compatibility adapters. Maintain:

- docs/plans/universal-capture-to-artifact/05-ground-truth-and-migration-map.md;
- versioned contract examples sufficient for M1 implementation;
- a dependency-ordered M1 task list with likely files and tests;
- explicit Decisions that truly block M1, if any.

Do not change production code, schema, CLI, or tests. Validate links and git diff --check. Do not rewrite old planning documents opportunistically; note superseded assumptions precisely.
```

## M1 Prompt: Durable Capture Envelope And Receipt

```text
Selected Milestone: M1 — Durable Capture Envelope And Receipt.

Implement the smallest end-to-end text-capture slice described in M1. A caller must be able to submit arbitrary text through a versioned adapter-neutral Capture Envelope, persist it idempotently, receive a durable Capture Receipt, and inspect/list it through CLI JSON. Preserve the source and provenance. Do not interpret, route to a Project, create Actions, invoke AI, match or execute Workflows, deliver externally, or add Dashboard UI.

First reconcile M1 against the existing `capture` command and schema so compatibility is explicit. Prefer additive migrations and commands; preserve existing `arcadia capture --text` behavior unless a tested compatibility alias is safer. Add envelope/receipt types, deterministic validation, repository/service functions, idempotency, CLI commands, focused unit tests, and a temporary-workspace integration test. Include failure cases for invalid input, duplicate idempotency key, missing workspace, and source Artifact write failure where applicable.

The completed slice must be useful even with all later Milestones disabled: every accepted input has a stable ID, status, source evidence, and receipt.
```

## M2 Prompt: Workflow Registry And Operator Control

```text
Selected Milestone: M2 — Workflow Registry And Operator Control.

Evolve the current workflow-definition and CLI implementation into a complete operator-controlled registry without expanding execution privileges. Add versioned validation, definition origin, built-in/workspace/Project precedence, safe copy/create scaffolding, enable/disable, match, validate, and dry-run behavior. Newly scaffolded workflows must be disabled. Preserve v1 Thundertonk behavior and exact collected MP3 filenames.

Do not add a remote executor, shell fragments, automatic activation, or Dashboard editor. Tests must prove definition migration/compatibility, invalid field diagnostics, precedence, no execution during creation/validation/dry-run, and safe materialization of executable + argv.
```

## M3 Prompt: Universal Ingress And Claiming

```text
Selected Milestone: M3 — Universal Ingress And Claiming.

Route existing CLI, Apple helper, and folder ingress through the M1 Capture service while preserving the existing folder contract, Done/Failed retention, sidecars, stable size/mtime observation, and atomic claims. Sidecars should expose the common Capture Receipt. Adapters may supply hints but may not authorize Actions.

Do not add interpretation or execution to capture submission. Add concurrency, duplicate, partial-copy, stale-claim, and compatibility tests. Preserve existing Shortcut/plist artifacts and document any required Shortcut update separately.
```

## M4 Prompt: Deterministic Inspection And Normalization

```text
Selected Milestone: M4 — Deterministic Inspection And Normalization.

Implement an inspector registry and the smallest useful inspectors for text, URLs, and generic files. Produce versioned Inspection Results containing only observable facts, extractor versions, hashes, metadata, normalized representations, warnings, and provenance. Preserve unsupported content and report `inspection_unsupported` rather than failing capture.

Do not infer intent or Project. Do not require cloud services. Add explicit limits, timeouts, malformed-input tests, and fixtures. If OCR/transcription adapters are introduced, keep them disabled and represent any AI call through existing Intelligence jobs.
```

## M5 Prompt: Interpretation And Action Projection

```text
Selected Milestone: M5 — Interpretation And Action Projection.

Extend existing Intake and stewardship so a preserved/inspected Capture can produce a versioned Interpretation and projected Actions with evidence, confidence, Project candidates, method provenance, and dry-run visibility. Execute nothing and mutate no Project/Action state.

Build a golden corpus from real scenarios including ambiguous Rebuster thoughts, explicit MIDI Opener commands, status questions, Field Notes requests, and unknown content. Deterministic rules run first. Optional AI uses existing Intelligence jobs and validated structured output. Low-confidence input remains safely captured.
```

## M6 Prompt: Automation Policy And Decisions

```text
Selected Milestone: M6 — Automation Policy And Decisions.

Implement a standalone, explainable policy evaluator for projected Actions. Return authorized, needs_decision, deferred, or blocked based on capability risk, confidence, reversibility, Workflow declaration, Project policy, and approval gates. Reuse core Decisions and approval gates.

Do not execute Actions. Prove with tests that policy evaluation never invokes an executor and that high confidence cannot bypass publication, deployment, messages, credentials, production data, money, destructive operations, overwrite collisions, or merge gates. Add a dry-run/explain command and persist policy version/evidence.
```

## M7 Prompt: Safe Orchestration And Recovery

```text
Selected Milestone: M7 — Safe Orchestration And Recovery.

Execute only policy-authorized Actions through direct executable + argv Workflows. Reconcile current workflow Runs and core execution Runs with compatibility-preserving links. Add durable steps, timeouts, raw stdout/stderr Logs, progress summaries, expected-output validation, retry lineage, worker claims/leases, stale recovery, and idempotent completed-result reuse where the Workflow permits it.

No remote arbitrary executor and no automatic retry for consequential/non-idempotent Actions. Include crash/restart, duplicate worker, timeout, missing output, collision, and Thundertonk regression tests.
```

## M8 Prompt: Artifact Delivery Broker

```text
Selected Milestone: M8 — Artifact Delivery Broker.

Extract delivery from individual Workflows into a reusable target/sink contract. Implement workspace, temporary iCloud-equivalent, and temporary Google-Drive-equivalent sinks with path templates, atomic copy, SHA-256/size verification, delivery records, retry, and collision policies. Real sync roots remain configuration and optional live tests.

Preserve the Thundertonk destination behavior through the new broker. Never create a missing real sync root. Test multi-target partial failure and composite receipts without requiring cloud accounts.
```

## M9 Prompt: HTTP Artifact Access

```text
Selected Milestone: M9 — HTTP Artifact Access.

Provide stable HTTP access to authorized core Artifacts by reusing or generalizing the existing Intelligence Artifact route. Default to localhost, stream MIME safely, prevent path traversal/arbitrary file reads, persist stable IDs, and log access. Add an explicit authenticated LAN configuration path but do not enable it by default or deploy anything.

Test restart stability, range behavior where relevant, authorization failure, missing files, malformed IDs, and traversal attempts.
```

## M10 Prompt: Obsidian Vault Handoff

```text
Selected Milestone: M10 — Obsidian Vault Handoff.

Implement a delivery adapter that writes versioned Obsidian handoff packages to configured vault roots. Render deterministic Markdown/frontmatter linking Capture, Project, Actions, Decisions, Runs, and Artifacts. Support configured attachment copy/link behavior, hash verification, collision policy, retry, and a handoff manifest.

Do not curate, reorganize, retag, backlink-rewrite, or delete existing vault content. Do not make vault files authoritative. Use temporary vault fixtures; keep real vault tests optional and disabled.
```

## M11 Prompt: Receipts, Dashboard, Digest, And Recovery

```text
Selected Milestone: M11 — Receipts, Dashboard, Digest, And Recovery.

Add unified receipt/status rendering to CLI, sidecars, and the read-only Dashboard. Show Capture lifecycle, interpretation evidence, policy, Decisions, Runs, delivery results, Artifact links, and recovery Actions. Add a deterministic daily digest and correction path for routing errors.

The Dashboard must reconstruct state from SQLite and use existing write APIs for any operator action. Do not introduce hidden client state or notification spam. Add snapshot, refresh, digest fixture, and adapter-contract tests.
```

## M12 Prompt: Quick Thought And Idea Workflow

```text
Selected Milestone: M12 — Quick Thought And Idea Workflow.

Implement the first general-purpose Workflow pack for arbitrary text. Correctly distinguish thought, idea, question, and command; associate clear Projects; create Back Burner/Idea Artifacts or projected Actions according to evidence; deliver a receipt and optional Obsidian handoff. Use the real ambiguous examples in the golden corpus.

Do not turn speculative language into commands. Prove the distinction between “Pinterest might help Rebuster,” “Should Rebuster try Pinterest?”, and “Implement Rebuster Pinterest publishing.”
```

## M13 Prompt: Voice Thought And Meeting Workflow

```text
Selected Milestone: M13 — Voice Thought And Meeting Workflow.

Implement preserved-audio -> transcript -> summary -> projected Decisions/Actions -> delivery/handoff using a fixture transcript adapter first. Keep transcript and summary separate Artifacts with provenance. Prefer configured local transcription; keep cloud transcription gated and optional.

Do not infer speakers or commitments without evidence. Failed transcription must leave audio accessible with retry guidance. Test voice thought and multi-speaker meeting fixtures.
```

## M14 Prompt: URL, Research, And Arbitrary File Workflow

```text
Selected Milestone: M14 — URL, Research, And Arbitrary File Workflow.

Implement shared URL and file processing using M4 inspectors and M5 interpretation. Preserve sources, separate extracted facts from generated summaries, route reference/research/Project Artifacts, and deliver useful receipts and Obsidian handoffs. Start with URL, PDF, image, and unknown-binary fixtures.

Respect retrieval policy, authentication boundaries, size limits, and copyright-safe delivered excerpts. Retrieval or extraction failure must not lose the original URL/file.
```

## M15 Prompt: Project Command And Software Release Workflow

```text
Selected Milestone: M15 — Project Command And Software Release Workflow.

Implement explicit software command routing through Project repository metadata, allowlisted validation, existing coding-agent profiles, and Decision-gated Codex planning/build. Add the MIDI Opener release-note flow as the first release specialization, reusing the established localization/validation behavior.

No merge, push, release submission, deployment, or publication without explicit authorization. Test missing repository setup, validation-only, bug-fix planning, and release-note cases.
```

## M16 Prompt: Analytics And Field Notes Workflow

```text
Selected Milestone: M16 — Analytics And Field Notes Workflow.

Implement an offline fixture-first pipeline for PostHog/Apple Analytics-shaped data: raw dataset -> deterministic normalization -> comparisons/charts -> evidence package -> Field Notes brief/draft -> delivery/handoff. Keep raw, normalized, analysis, and editorial Artifacts distinct and provenance-linked.

Credentials and production-data access require Decisions. Publication remains gated. Do not require live APIs for the default tests.
```

## M17 Prompt: Rebuster Creative Production Workflow

```text
Selected Milestone: M17 — Rebuster Creative Production Workflow.

Extend the existing Rebuster capability contract to orchestrate Idea -> candidates -> overlap review -> strict specification -> production Artifacts -> publication preparation. Rebuster continues to own domain state; Arcadia owns Actions, Decisions, Runs, Logs, and Artifact delivery.

Keep candidate generation, overlap validation, and spec generation separate and testable. Conflicts create Decisions with evidence. Social posting and messages remain gated.
```

## M18 Prompt: Portfolio Pulse And Weekly Review Workflow

```text
Selected Milestone: M18 — Portfolio Pulse And Weekly Review Workflow.

Implement deterministic daily/weekly aggregation across Captures, Projects, Milestones, Actions, Decisions, Runs, Logs, deliveries, and Artifacts. Produce Project and portfolio reports plus optional Obsidian notes. Optional AI narrative is a separate provenance-linked Artifact.

Identify blockers, stale Decisions, failures, and the most useful next Action without executing portfolio work. Test against a fixed workspace database fixture and link every report claim to source records.
```

## Recommended Initial Prompt

Use this prompt for the first implementation turn:

```text
Continue developing Arcadia in:

/Users/pmark/Dev/MR/Arcadia/arcadia

Selected Milestone: M1 — Durable Capture Envelope And Receipt.

Use these documents as the implementation contract:

- docs/plans/universal-capture-to-artifact/README.md
- docs/plans/universal-capture-to-artifact/01-architecture-and-safety.md
- docs/plans/universal-capture-to-artifact/02-milestone-implementation-guide.md
- docs/plans/universal-capture-to-artifact/03-testing-rollout-and-operations.md
- docs/plans/universal-capture-to-artifact/05-ground-truth-and-migration-map.md

Before making changes:

1. Read AGENTS.md and docs/arcadia-semantics.md completely.
2. Read the program documents above, especially M1, completely.
3. Inspect the current branch and git status. Preserve all unrelated and pre-existing changes, including untracked Apple Shortcut/plist artifacts. Do not stage or commit unless explicitly asked.
4. Inspect the actual capture command, ingress, ask/Intake/stewardship, database migrations/repositories, Artifact storage, CLI response envelopes, tests, and documentation.
5. Reconcile the proposed M1 contracts with current code before editing. Reuse existing concepts and preserve compatibility.
6. Identify the current Milestone, next Action, Responsibility, and required Artifacts.
7. Present a concise implementation plan, then implement and validate the smallest useful end-to-end slice. Do not stop at a design document unless implementation is genuinely blocked.

Implement only this vertical slice:

- accept arbitrary text through a versioned adapter-neutral Capture Envelope;
- validate and persist it idempotently;
- preserve source evidence and provenance;
- return a durable Capture Receipt;
- allow CLI JSON submit/show/list inspection;
- add focused unit tests and a temporary-workspace integration test.

Explicit non-goals:

- no Project routing or intent classification;
- no Action creation or Back Burner behavior from the new pipeline;
- no Workflow matching or execution;
- no AI calls;
- no external delivery or Obsidian write;
- no Dashboard redesign;
- no replacement of `arcadia ask` in this Milestone.

Safety and compatibility requirements:

- preserve source before any future interpretation;
- use additive migrations and stable CLI JSON envelopes;
- same idempotency key returns the original Capture and receipt;
- failed persistence never claims successful preservation;
- raw binary content is an Artifact, not a SQLite blob;
- keep SQLite authoritative;
- do not create a parallel Action, Decision, Run, Artifact, Log, Intelligence, or Workflow system.

Validation must cover:

- successful text capture;
- invalid envelope;
- duplicate idempotency key;
- missing workspace;
- source Artifact/persistence failure where applicable;
- focused tests, pnpm build, pnpm test, and git diff --check.

At handoff report the achieved Outcome, compatibility preserved, exact validation results, Artifacts created, limitations, Decisions required, and the recommended M2 or M3 prompt.
```
