---
arcadia: v1
type: decision
id: "0046"
slug: how-should-this-project-update-be-applied-set-the-work-pointer-to-let-agent-pres
project: arcadia
status: open
question: "How should this Project update be applied: Set the work pointer to let-agent-preserve-its-candidate."
gap_type: missing-decision
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-12
---

# Decision 0046: How should this Project update be applied: Set the work pointer to let-agent-preserve-its-candidate.

## Rationale

The pointer currently names prove-zero-prompt-production-loop, which is no longer executable: its dependency let-agent-preserve-its-candidate is open. `arcadia next --ready` correctly excludes it from the ready set and suggests a different Action, while plain `arcadia next` still reports it as the current Action with no warning - the same two-code-paths-disagree defect recorded in docs/proposals/validate-governed-documents.md. Left alone, the next `arcadia go` would dispatch an Action whose dependency is unmet and reproduce the 2026-09-11 rehearsal failure.
Of the three ready Actions, let-agent-preserve-its-candidate is chosen because it is the one that unblocks the others in practice. A sandboxed agent worktree lives under ~/.codex/worktrees while the shared Git directory lives in the repository root, outside the arcadia-unattended workspace roots, so no brokered agent session can commit its work in any repository - not only the rehearsal fixture. Until that is fixed, every brokered dispatch produces work that cannot be recorded.

Proposed by Agent Ask point-at-let-agent-preserve-its-candidate-2026-09-12. This Decision remains open until the operator answers it.
