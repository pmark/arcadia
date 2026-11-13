---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-4-plan-of-three-independently-verified-small-fixes-each
project: arcadia
status: draft
milestone: Draft an inactive batch 4 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-13
actions:
  - id: queue-arrange-keeps-hidden-positions
    title: Queue order mutations refuse, rather than silently delete, explicit position rows for Actions the queue does not project.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Queue order mutations preserve, rather than silently delete, explicit position rows for Actions the queue does not project.
    expected_artifact: Evidence satisfying Agent Ask queue-arrange-keeps-hidden-positions
    clarification: clarified
    confidence: high
    source: Agent Ask amend-action-1022-preserve-rows-20261113
    acceptance_criteria:
      - A move that would drop a position row for an Action the queue does not project keeps that row, with a failing-first regression test proving the row survives the rewrite and the move still succeeds.
      - Existing action-order, dispatch, scheduling-order, advance-queue, action-settle, decision-deferral and plan-activation tests still pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1022"]
  - id: tidy-detached-worktree-ahead-count
    title: Tidy reports a detached worktree's real unmerged commit count instead of 0 unmerged commits.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Tidy reports a detached worktree's real unmerged commit count instead of 0 unmerged commits.
    expected_artifact: Evidence satisfying Agent Ask tidy-detached-worktree-ahead-count
    clarification: clarified
    confidence: high
    source: Agent Ask amend-batch-4-issue-references-20261113b
    acceptance_criteria:
      - A detached worktree with two unmerged commits is reported as 2 unmerged commits, never 0.
      - tests/tidy-command.test.ts and tests/tidy-conservation.test.ts pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1827"]
  - id: dashboard-noemit-test-typings
    title: The dashboard noEmit typecheck passes by repairing four existing test files' typings, without weakening the production type check.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The dashboard noEmit typecheck passes by repairing four existing test files' typings, without weakening the production type check.
    expected_artifact: Evidence satisfying Agent Ask dashboard-noemit-test-typings
    clarification: clarified
    confidence: high
    source: Agent Ask amend-batch-4-issue-references-20261113b
    acceptance_criteria:
      - node node_modules/typescript/bin/tsc -p apps/dashboard/tsconfig.json --noEmit exits 0 on the candidate.
      - The affected dashboard tests still pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1395"]
questions: []
decisions: []
---

# Draft an inactive batch 4 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.

Created as an inactive draft from accepted Agent Ask ellis-batch-4-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
