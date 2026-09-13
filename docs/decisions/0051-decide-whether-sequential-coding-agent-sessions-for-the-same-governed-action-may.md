---
arcadia: v1
type: decision
id: "0051"
slug: decide-whether-sequential-coding-agent-sessions-for-the-same-governed-action-may
project: arcadia
status: open
question: Decide whether sequential coding-agent Sessions for the same governed Action may continue in one host-owned candidate worktree, refining the one-session-one-branch-one-worktree rule in docs/working-copy-safety.md and AGENTS.md.
gap_type: missing-decision
recommendation: Adopt candidate continuation
options:
  - label: Adopt candidate continuation
    consequence: The rule becomes "at most one live execution per candidate; sequential Sessions for the same Action reuse it after proven terminal exit and a repository-lease handoff". Next, three existing Actions get amended (refuse-to-orphan resumes by default for the same Action, reconcile-session-exits hands over the lease and records a resumable incomplete outcome, prove-two-action adds a split-session run). No new Actions, lease type or pointer change; agents still get no Git writes.
    recommended: true
  - label: Keep one worktree per Session
    consequence: The current rule stands. refuse-to-orphan keeps report-and-choose, so every Action that needs a second Session stops for an operator choice (or a fresh worktree). The proposal is closed as rejected; the unattended proof must fit each Action into one Session.
    recommended: false
  - label: Defer until the zero-prompt proof runs
    consequence: "Nothing changes now. Trigger: the first prove-zero-prompt-production-loop run where one Action needs a second Session. refuse-to-orphan may be implemented as report-and-choose in the meantime and later amended."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-13
---

# Decision 0051: Decide whether sequential coding-agent Sessions for the same governed Action may continue in one host-owned candidate worktree, refining the one-session-one-branch-one-worktree rule in docs/working-copy-safety.md and AGENTS.md.

## Options

- **Adopt candidate continuation** (recommended): The rule becomes "at most one live execution per candidate; sequential Sessions for the same Action reuse it after proven terminal exit and a repository-lease handoff". Next, three existing Actions get amended (refuse-to-orphan resumes by default for the same Action, reconcile-session-exits hands over the lease and records a resumable incomplete outcome, prove-two-action adds a split-session run). No new Actions, lease type or pointer change; agents still get no Git writes.
- **Keep one worktree per Session**: The current rule stands. refuse-to-orphan keeps report-and-choose, so every Action that needs a second Session stops for an operator choice (or a fresh worktree). The proposal is closed as rejected; the unattended proof must fit each Action into one Session.
- **Defer until the zero-prompt proof runs**: Nothing changes now. Trigger: the first prove-zero-prompt-production-loop run where one Action needs a second Session. refuse-to-orphan may be implemented as report-and-choose in the meantime and later amended.

## Rationale

docs/proposals/host-owned-agent-workspace-contract.md (PR #230) proposes that Arcadia owns all Git and worktree lifecycle while agents only edit and validate the prepared candidate. Today a multi-session Action needs manual worktree preparation between sessions, and the open Action refuse-to-orphan-an-uncommitted-candidate would make go refuse rather than resume. Loosening a Way rule is the operator's judgment, so it needs a ratified Decision before the plan amendments that implement it.

Proposed by Agent Ask host-owned-candidate-continuation-2026-09-13. This Decision remains open until the operator answers it.
