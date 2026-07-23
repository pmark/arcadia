# Universal Capture-to-Artifact Program

## Executive Summary

Arcadia should accept arbitrary material from Mark's mind and devices, preserve it, understand it as far as evidence allows, project useful Actions, execute explicitly safe high-confidence work, and deliver durable Artifacts through immediately accessible destinations. Every capture should leave a receipt. Every interpretation should be inspectable. Every automated Action should be policy-authorized. Every result should be recoverable and attributable.

The desired operating loop is:

```text
Capture
  -> Preserve source and issue receipt
  -> Inspect and normalize deterministically
  -> Interpret intent and Project context
  -> Project candidate Actions
  -> Apply automation policy
  -> Execute allowlisted safe Actions or create Decisions
  -> Validate and record Artifacts
  -> Deliver to configured targets
  -> Hand off to Obsidian for later curation
  -> Report status, links, and recovery guidance
```

This program is deliberately modular. Capture, interpretation, execution, delivery, and Obsidian curation are separate responsibilities joined by versioned contracts. A failure in one stage must not erase or hide evidence from an earlier stage.

## Mission

Maintain momentum across arbitrary creative and software work with minimal cognitive overhead by turning unstructured input into safe, visible, useful progress.

## Outcome

Mark can send Arcadia text, clipboard contents, URLs, files, images, audio, or explicit commands from any supported surface and quickly receive:

- an immutable source Artifact and capture receipt;
- Arcadia's interpretation, confidence, and Project attribution;
- projected Actions and any required Decisions;
- automatically completed high-confidence safe Actions;
- immediately accessible result Artifacts through local paths, iCloud Drive, Google Drive, or HTTP URLs;
- a durable Obsidian handoff positioned for later second-brain organization;
- complete Logs and recovery guidance.

## Product Principles

1. Preserve before interpreting.
2. Deterministic extraction and routing precede AI.
3. Local AI precedes paid or frontier execution when it can satisfy the contract.
4. Unknown input is captured safely; it is never discarded merely because it cannot be classified.
5. Confidence alone never authorizes a dangerous capability.
6. Automatic execution requires both high confidence and an allowlisted safe Action.
7. External publication, deployment, messages, credentials, production data, financial activity, destructive operations, and merges require explicit Decisions.
8. Every write is idempotent or collision-safe.
9. SQLite is authoritative for Arcadia state; files are durable Artifacts and delivery copies.
10. Obsidian consumes Arcadia handoffs after processing. Obsidian does not become Arcadia's execution database.
11. Delivery destinations are reusable sinks, not hardcoded workflow behavior.
12. Every Milestone is independently useful, testable, and reversible.

## Existing Foundations To Reuse

This is an integration program, not a greenfield rewrite. Existing foundations include:

- `arcadia ask`, deterministic Intake, stewardship, Project routing, Actions, Decisions, approval gates, and Back Burner capture;
- the iCloud-compatible ingress folder contract and Apple helper scripts;
- workflow definitions, matching, direct argv execution, Run manifests, Logs, retries, and the Thundertonk practice workflow;
- core Artifacts, Logs, execution Runs, events, and dashboard snapshots;
- the durable Arcadia Intelligence job service, route policy, output validation, local LiteLLM path, Codex executors, and artifact HTTP route;
- capability modules for Blogging and Rebuster;
- CLI JSON response envelopes used by adapters;
- worker and service infrastructure.

The program must not create parallel versions of these concepts. Where two existing implementations overlap, the relevant Milestone must document and test the compatibility boundary before consolidation.

## Program Milestones

| Milestone | Name | Independently useful result |
| --- | --- | --- |
| M0 | Ground Truth And Contracts | A verified system map, versioned contracts, and explicit Decisions before schema or API work. |
| M1 | Durable Capture Envelope And Receipt | Every supported input can be preserved and inspected without interpretation or execution. |
| M2 | Workflow Registry And Operator Control | Workflows can be created, copied, edited, validated, enabled, disabled, matched, and dry-run safely. |
| M3 | Universal Ingress And Claiming | All adapters submit the same capture contract with stable-file detection and idempotent claiming. |
| M4 | Deterministic Inspection And Normalization | MIME, hashes, metadata, text, OCR/transcript hooks, and canonical source representations are available. |
| M5 | Interpretation And Action Projection | Arcadia proposes Project attribution, intent, and Actions with evidence and confidence but executes nothing. |
| M6 | Automation Policy And Decisions | Each projected Action becomes auto-authorized, Decision-gated, deferred, or blocked predictably. |
| M7 | Safe Orchestration And Recovery | Authorized deterministic workflows execute with durable steps, Logs, retries, and restart-safe recovery. |
| M8 | Artifact Delivery Broker | Local, iCloud Drive, and Google Drive delivery use one verified, idempotent sink contract. |
| M9 | HTTP Artifact Access | Approved local or deployed HTTP delivery produces stable, access-controlled Artifact URLs. |
| M10 | Obsidian Vault Handoff | Arcadia stages structured Markdown and attachments into configured vault locations without curating the vault. |
| M11 | Receipts, Dashboard, Digest, And Recovery | Mark can immediately see what happened, what needs a Decision, Artifact links, and recovery Actions. |
| M12 | Quick Thought And Idea Workflow | Random thoughts become durable Ideas, Back Burner items, or Actions without over-interpreting them. |
| M13 | Voice Thought And Meeting Workflow | Speech becomes transcript, summary, candidate Decisions and Actions, and a vault handoff. |
| M14 | URL, Research, And Arbitrary File Workflow | Shared URLs and files become preserved, classified research or Project Artifacts with useful extracts. |
| M15 | Project Command And Software Release Workflow | Explicit repository commands and releases route to deterministic checks or Decision-gated Codex work. |
| M16 | Analytics And Field Notes Workflow | Approved data retrieval becomes normalized analysis, evidence, briefs, and reviewable content Artifacts. |
| M17 | Rebuster Creative Production Workflow | Rebus Ideas progress through candidates, overlap review, strict specs, and gated publication preparation. |
| M18 | Portfolio Pulse And Weekly Review Workflow | Runs, Logs, Decisions, Milestones, and Artifacts become daily and weekly momentum reports. |

M12 through M18 are independent workflow packs. They should not be delivered as one large release. The existing Thundertonk practice workflow remains the reference media-processing workflow and a regression fixture for M2, M3, M7, and M8.

## Dependency Order

```text
M0
 -> M1
 -> M2 and M3
 -> M4
 -> M5
 -> M6
 -> M7
 -> M8
 -> M9 and M10
 -> M11
 -> M12-M18 independently
```

M2 may proceed alongside M3 after M1 because operator control and ingress normalization touch different boundaries. M9 and M10 may proceed independently after the delivery contract in M8. Domain workflow packs require only the foundation Milestones they actually use, but none may bypass M6 for automatic execution.

## Definition Of Program Success

The program succeeds when all of the following are true:

- Every capture has a stable ID, source provenance, content hash, lifecycle status, and receipt.
- The source remains recoverable even if inspection, interpretation, execution, or delivery fails.
- Arcadia can explain why a Project, intent, Workflow, and Action were selected.
- Ambiguous thoughts remain safely captured rather than becoming invented work.
- Safe deterministic Actions can complete automatically from ingress.
- Unsafe or uncertain Actions create useful Decisions with evidence and recommendations.
- Results are verified and accessible through configured delivery targets.
- Obsidian receives complete handoffs without becoming coupled to Arcadia internals.
- Duplicate capture, Run, and delivery attempts do not create duplicate work or corrupt existing Artifacts.
- Dashboard and CLI views expose pending, running, completed, failed, retryable, and blocked states.
- The complete test suite can run without cloud credentials or paid model access.

## Documents

1. [Architecture And Safety](01-architecture-and-safety.md)
2. [Milestone Implementation Guide](02-milestone-implementation-guide.md)
3. [Testing, Rollout, And Operations](03-testing-rollout-and-operations.md)
4. [Agentic Development Prompts](04-agentic-development-prompts.md)
5. [Ground Truth And Migration Map](05-ground-truth-and-migration-map.md)

## Current Milestone

M1: Durable Capture Envelope And Receipt. M0 is complete in the Ground Truth And Migration Map.

## Next Action

Run the M1 planning-and-implementation prompt from the prompt library. The agent must first reconcile this plan with the dirty worktree and current capture/workflow implementation, then implement only the durable Capture Envelope and receipt slice.

## Responsibility

Codex for M0 and M1 implementation. Requires Review only for the explicit Decisions listed in the architecture document or if repository evidence contradicts the assumptions above.

## Required Artifacts

- This plan package.
- Versioned Capture Envelope and receipt contracts.
- M1 schema/repository/CLI implementation and tests.
- An updated Log identifying the next Milestone after validation.
