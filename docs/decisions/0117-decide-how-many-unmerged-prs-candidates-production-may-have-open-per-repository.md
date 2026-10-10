---
arcadia: v1
type: decision
id: "0117"
slug: decide-how-many-unmerged-prs-candidates-production-may-have-open-per-repository
project: arcadia
status: open
question: "Decide how many unmerged PRs (candidates) production may have open per repository: 1 or 2."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: 2 unmerged candidates per repository
options:
  - label: 2 unmerged candidates per repository
    consequence: Pipelining is allowed once its prerequisites (reopened 0023, 0070's held Actions, unknown-dependency blocking, implicit shared-file list) land. The operator or the review agent sees up to two PRs per repository; merge lead time is shown beside the backlog so the limit can be lowered if PRs pile up.
    recommended: true
  - label: 1 unmerged candidate per repository
    consequence: One PR at a time per repository. No pipelining; nothing piles up; throughput is bounded by merge lead time.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-10
---

# Decision 0117: Decide how many unmerged PRs (candidates) production may have open per repository: 1 or 2.

## Options

- **2 unmerged candidates per repository** (recommended): Pipelining is allowed once its prerequisites (reopened 0023, 0070's held Actions, unknown-dependency blocking, implicit shared-file list) land. The operator or the review agent sees up to two PRs per repository; merge lead time is shown beside the backlog so the limit can be lowered if PRs pile up.
- **1 unmerged candidate per repository**: One PR at a time per repository. No pipelining; nothing piles up; throughput is bounded by merge lead time.

## Rationale

In the 2026-10-09 /production design session the operator chose this option in chat; this Decision records it for the operator's own answer. A limit of 2 enables pipelining (step 5 of the parallel-execution proposal): the next independent Action, with declared touches disjoint from the unmerged candidate's actual diff, may start before the previous PR merges. It does not reopen Decision 0066 (still one live Session per repository) and depends on the reopened Decision 0023 and Decision 0070's two held Actions.

Proposed by Agent Ask decide-unmerged-candidates-per-repository-2026-10-09.
