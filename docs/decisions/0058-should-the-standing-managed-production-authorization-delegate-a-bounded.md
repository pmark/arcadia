---
arcadia: v1
type: decision
id: "0058"
slug: should-the-standing-managed-production-authorization-delegate-a-bounded
project: arcadia
status: open
question: Should the standing managed-production authorization delegate a bounded candidate-integration transition, so a finished and validated Session candidate can be merged into the governed base branch without a per-Action operator merge?
gap_type: missing-decision
recommendation: Delegate bounded candidate integration under a named, expiring grant
options:
  - label: Delegate bounded candidate integration under a named, expiring grant
    consequence: A finished, validated Session candidate is merged into the governed base branch automatically and the next dependent Action launches with no operator merge. Integration is limited to the grant's exact Project, Plan, Action, agent-owned branch and expiry; any conflict, out-of-scope candidate, non-agent branch or divergent base stops it and preserves the work. Production stays revocable during the run.
    recommended: true
  - label: Keep merge an operator/PR boundary
    consequence: preserve-on-exit-and-integrate narrows to automatic preservation on Session exit plus the existing operator/PR handoff. Every Action still needs one operator merge before the next dependent Action can launch.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-17
---

# Decision 0058: Should the standing managed-production authorization delegate a bounded candidate-integration transition, so a finished and validated Session candidate can be merged into the governed base branch without a per-Action operator merge?

## Options

- **Delegate bounded candidate integration under a named, expiring grant** (recommended): A finished, validated Session candidate is merged into the governed base branch automatically and the next dependent Action launches with no operator merge. Integration is limited to the grant's exact Project, Plan, Action, agent-owned branch and expiry; any conflict, out-of-scope candidate, non-agent branch or divergent base stops it and preserves the work. Production stays revocable during the run.
- **Keep merge an operator/PR boundary**: preserve-on-exit-and-integrate narrows to automatic preservation on Session exit plus the existing operator/PR handoff. Every Action still needs one operator merge before the next dependent Action can launch.

## Rationale

preserve-on-exit-and-integrate closes the A-to-B seam. Today the worker reconciles a finished Session and defers one tick 'for its merge to land' (src/production/tick.ts:154-166; tests/production-tick.test.ts:222-225), so the next dependent Action waits for an operator merge - the babysitting this work exists to remove. The production policy delegates only validation, acceptance and pointer transitions and deliberately keeps merge a separate explicit stop (src/production/policy.ts:32-39, :73-80). Delegating integration therefore needs an explicit authority record rather than an acceptance criterion. Exact proposed scope: Project arcadia; Plan bootstrap-managed-production-to-build-flight-deck; the Actions the grant names; only the agent-owned branch created by the grant's own Session for that Action; only a fast-forward or clean merge into that Project's governed base branch; stop and report on any conflict, non-agent-owned branch, divergent base, or candidate outside the grant scope; the grant carries an explicit expiry and is revoked by deactivating production. Merge, deploy, publish, spend, credentials, messaging and destructive operations remain separate gates. If declined, preserve-on-exit-and-integrate narrows to preservation plus the existing operator/PR handoff.

Proposed by Agent Ask authorize-bounded-candidate-integration-2026-09-17. This Decision remains open until the operator answers it.
