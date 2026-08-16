---
arcadia: v1
type: decision
id: "0019"
slug: streamline-pr-qa-before-expansion
project: arcadia
plan: demo-first-delivery
status: approved
question: Should Arcadia streamline the minimal pull-request QA path now, and which larger development-orchestration capabilities should remain deferred?
gap_type: missing-decision
recommendation: Yes. Refuse deterministically unready pull requests before any model-bearing work, remove the proven CI test race, document the one-pass workflow, and preserve the broader Arcadia-led development vision with evidence-based reactivation triggers.
confidence: high
decided: 2026-08-15
answer: "Arcadia will immediately add a zero-token readiness gate before independent pull-request judgment, prevent the repository-local dogfood workspace from contaminating workspace-resolution tests, and document the normal one-pass QA sequence. Arcadia's north star is an operator-facing development control plane that captures intent, plans governed Actions, selects and orchestrates configured coding agents, gathers deterministic proof, invokes independent QA once evidence is ready, and asks or notifies the operator only for genuine questions, feedback, approval, credentials, consequential actions, or irreducibly human product judgment. Automatic QA invocation and Arcadia Now or Discord delivery reactivate when a QA-ready Candidate waits unnoticed or a real review requires manual CLI relay. Claim-to-proof manifests, local validation, and browser proof reactivate when a second real Candidate has a material claim that green CI cannot substantiate. Managed Run integration reactivates when Artifact and Decision receipts no longer make QA history operable. GitHub posting reactivates after the operator must manually copy the same QA result into a pull request twice. Patch chunking or staged review reactivates when a complete patch cannot fit the selected reviewer's bounded context or exceeds a configured token budget. Predictive or exact token telemetry reactivates when executor usage is reliably available and two real QA reviews need cost comparison. Automatic repair, merge, deployment, release, and outbound messaging remain separately approval-gated even after their triggers fire."
updated: 2026-08-15
---

# Streamline pull-request QA before expansion

## Context

Dogfooding Arcadia PR #55 converted five trust failures into executable guards,
but the process audit found two avoidable sources of repeated work. Arcadia can
currently spend a model call even when deterministic GitHub evidence already
makes Pass impossible, and a test that assumes the repository root has no local
workspace can race with the dogfood suite's intentional `.arcadia-workspace`.

The operator also stated the longer-term destination explicitly: normal
development should be driven through direct Arcadia interaction, with Arcadia
orchestrating configured coding agents and involving the operator only when
their judgment or authority is genuinely required.

## Decision

Do the smallest high-leverage hardening now:

1. refuse deterministically unready pull requests before any reviewer work;
2. isolate the workspace-precedence regression from repository-local state;
3. standardize one model-bearing review only after the Candidate is ready; and
4. preserve the orchestration vision and every excluded increment with a
   condition that can visibly reactivate it.

The detailed north star and staged boundary live in
[`../arcadia-development-orchestration-vision.md`](../arcadia-development-orchestration-vision.md).

## Consequences

- Routine waiting and obvious CI failures consume no reviewer tokens.
- A refusal is not mislabeled as a QA Decision; the operator receives a remedy
  and retries when the evidence changes.
- Ready Candidates retain the complete exact-revision review and hardened
  receipts delivered by Decision 0018.
- Later capabilities do not compete with current PPN delivery until their
  observable triggers fire.
