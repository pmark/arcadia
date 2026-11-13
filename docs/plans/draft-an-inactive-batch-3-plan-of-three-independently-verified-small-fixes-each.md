---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-3-plan-of-three-independently-verified-small-fixes-each
project: arcadia
status: draft
milestone: Draft an inactive batch 3 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-13
actions:
  - id: fix-tmux-long-brief-fixture-atomic-write
    title: The tmux long-brief fixture writes its JSON output atomically so the test never reads a partial file.
    status: open
    responsibility: agent
    effort: session
    next_action: The tmux long-brief fixture writes its JSON output atomically so the test never reads a partial file.
    expected_artifact: Evidence satisfying Agent Ask fix-tmux-long-brief-fixture-atomic-write
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-3-redraft-20261113
    acceptance_criteria:
      - A failing-first regression test shows the fixture output can be observed before its JSON write completes.
      - The fixture writes to a sibling temporary path and renames it into place only after the write completes.
      - The exact 64 KiB brief assertion and cleanup checks are unchanged.
      - pnpm vitest run tests/system-tmux-long-command.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2314"]
  - id: contain-dashboard-file-routes-by-real-path
    title: The dashboard file routes refuse a symlink whose real target lies outside the permitted root.
    status: open
    responsibility: agent
    effort: session
    next_action: The dashboard file routes refuse a symlink whose real target lies outside the permitted root.
    expected_artifact: Evidence satisfying Agent Ask contain-dashboard-file-routes-by-real-path
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-3-redraft-20261113
    acceptance_criteria:
      - A failing-first regression test shows a symlink inside the permitted root pointing outside it is refused with 400 by both file routes.
      - Both routes compare the canonical real path of the target against the real root before stat or readFile.
      - Existing in-root file reads still return their content.
      - The dashboard route tests pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1442"]
  - id: bound-agent-ask-complete-teardown-retry
    title: The Agent Ask complete suite teardown retries a transient ENOTEMPTY instead of failing the shard.
    status: open
    responsibility: agent
    effort: session
    next_action: The Agent Ask complete suite teardown retries a transient ENOTEMPTY instead of failing the shard.
    expected_artifact: Evidence satisfying Agent Ask bound-agent-ask-complete-teardown-retry
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-3-redraft-20261113
    acceptance_criteria:
      - A failing-first regression test shows a transient ENOTEMPTY during teardown is retried with a bounded count.
      - The afterEach still fails on any error other than a transient ENOTEMPTY.
      - No assertion in the suite changes.
      - pnpm vitest run tests/agent-ask-complete.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1329"]
questions: []
decisions: []
---

# Draft an inactive batch 3 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.

Created as an inactive draft from accepted Agent Ask ellis-batch-3-redraft-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
