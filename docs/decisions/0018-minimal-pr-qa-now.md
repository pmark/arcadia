---
arcadia: v1
type: decision
id: "0018"
slug: minimal-pr-qa-now
project: arcadia
plan: demo-first-delivery
status: approved
question: Should Arcadia interrupt the demo-first sequence to build the minimally essential independent pull-request QA capability now that Private Practice Now needs it?
gap_type: missing-decision
recommendation: Yes. Add one CLI-first PR QA path that freezes a GitHub revision, gathers deterministic evidence, runs one independent read-only structured review, and persists a QA report Artifact plus a revision-bound Decision; defer UI, browser proof, repair, release, and merge automation.
confidence: high
decided: 2026-08-15
answer: "Minimal independent pull-request QA is a must-have now and takes priority because the need arose naturally while advancing Private Practice Now. Arcadia will add a CLI-first qa pr command that binds review to an immutable GitHub head SHA, captures the pull-request body, complete patch, changed files, merge state, and check conclusions, invokes the least-cost compliant read-only coding-agent reviewer in a separate execution with a strict structured-output schema, revalidates the head SHA after review, and persists a QA report Artifact and decided pass, fail, or needs-follow-up Decision. Pass is impossible when required evidence is missing, checks are failing or pending, duplicate checks conflict, the revision changes, or the reviewer reports a material finding. The command never edits the Candidate, posts to GitHub, approves release, or merges. Dashboard and Discord surfaces, local validation reruns, browser proof, automatic repair, managed execution_runs integration, and release automation are deferred until this first path reviews PR 54 successfully and a second real Project Candidate demonstrates which addition is actually needed."
updated: 2026-08-15
---

# Minimal pull-request QA now

## Context

Private Practice Now made the missing responsibility concrete. The operator
expected “Arcadia QA” to review Arcadia PR #54, but the existing QA queue only
lists checked-in Candidates and records a human sign-off. The broader
`establish-arcadia-qa` Action is correctly designed for deployed Candidates,
browser evidence, and release readiness, but its dependencies make it too late
for the immediate pull-request need.

This is a sequencing correction, not a second QA system. The first slice uses
the same Artifact and Decision contracts and becomes a prerequisite for the
broader QA Action.

## Decision

Build one command:

```sh
arcadia qa pr https://github.com/owner/repository/pull/123
```

For one immutable head revision it:

1. resolves the configured Project and repository;
2. captures GitHub metadata, check conclusions, changed files, body, and the
   complete exact-base/head patch deterministically;
3. establishes readable host controls for Codex auth, the Project Git control
   file, and GitHub network access, then requires the reviewer sandbox to read
   its evidence while denying those exact controls before invoking one
   separately executed coding-agent reviewer selected through Arcadia's
   existing provider-adapter policy;
4. exhaustively validates the structured verdict and requires exactly one
   pass, fail, or not-checked result for each of seven fixed review criteria;
5. re-reads the complete mutable pull-request snapshot and refuses Pass if it
   changed; and
6. persists a Markdown QA report Artifact and a decided, revision-bound
   Decision in the Arcadia workspace. A repeat may use the canonical cache hint
   only when it matches that independent Decision context, its Artifact, the PR
   source and evidence fingerprint, and every persisted file hash.

Deterministic evidence constrains the verdict. A model cannot turn failed,
pending, contradictory, stale, or absent required evidence into Pass. The QA
Decision is evidence for the operator; it is not merge or release authority.

## Pareto boundary

Version one deliberately does not:

- add a Dashboard or Discord surface;
- check out or modify the Candidate;
- execute commands copied from a pull-request body;
- rerun local validation or browser automation;
- diagnose or repair failures;
- post a GitHub review or comment;
- create a managed `execution_runs` row; or
- merge, deploy, release, or otherwise mutate an external system.

Those deferrals expire only from evidence:

- Add Dashboard or Discord delivery when the CLI report is trustworthy but
  hard to reach during a real review.
- Add local validation or browser proof when GitHub evidence is insufficient
  for a second real Candidate.
- Add managed Run integration when QA history cannot be operated reliably from
  the Artifact and Decision receipts.
- Add GitHub posting only when the operator repeatedly needs the same report in
  the pull-request conversation.

## Consequences

- Arcadia can independently review PR #54 without claiming the operator did QA.
- Every verdict names its exact revision and becomes stale when that revision
  changes.
- One bounded model call performs judgment; evidence collection, gating,
  sandbox preflight, persistence, and repeat protection remain deterministic.
- The current demo hero pauses for this explicitly chosen prerequisite and
  resumes after the minimal PR-QA Action is accepted.
