---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-5-plan-of-three-independently-verified-small-fixes-each
project: arcadia
status: draft
milestone: Draft an inactive batch 5 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-13
actions:
  - id: fix-off-alarm-custodian-liveness-scope
    title: readCustodianLiveness reads the retained configuration when production is not active, so --duty-off-alarm no longer yields a persistent CANNOT JUDGE episode.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: readCustodianLiveness reads the retained configuration when production is not active, so --duty-off-alarm no longer yields a persistent CANNOT JUDGE episode.
    expected_artifact: Evidence satisfying Agent Ask fix-off-alarm-custodian-liveness-scope
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-5-redraft-20261113
    why: "With production Off and --duty-off-alarm on, readCustodianLiveness reads policy.scope, which Off clears, so a spurious CANNOT JUDGE episode stays open for the whole Off period."
    acceptance_criteria:
      - A failing-first test shows an Off-cleared policy scope yields readable custodian liveness instead of a CANNOT JUDGE episode, and a present scope behaves as before.
      - The first implementation step confirms whether readProductionPolicy throws on a cleared scope and the fix handles that path.
      - Existing tests pass unmodified, and pnpm vitest run tests/duty-alarms.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2561", "src/commands/productionMomentum.ts", "tests/duty-alarms.test.ts"]
  - id: quote-flow-indicator-leading-yaml-scalars
    title: yamlScalar quotes values that start with a comma, right bracket or right brace so a settled Plan round-trips.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: yamlScalar quotes values that start with a comma, right bracket or right brace so a settled Plan round-trips.
    expected_artifact: Evidence satisfying Agent Ask quote-flow-indicator-leading-yaml-scalars
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-5-redraft-20261113
    why: "yamlScalar leaves values starting with a comma, right bracket or right brace unquoted, which fail to parse as plain YAML scalars."
    acceptance_criteria:
      - A failing-first test shows values with those leading characters come back quoted and round-trip, and plain values are unchanged.
      - Existing tests pass unmodified, and pnpm vitest run tests/pin-yaml-scalar-quoting.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2562", "src/docs/frontmatter.ts", "tests/pin-yaml-scalar-quoting.test.ts"]
  - id: tidy-detached-count-tolerates-unreadable-head
    title: Tidy reports a named per-worktree verdict for a detached worktree whose head is unreadable instead of aborting the whole run.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Tidy reports a named per-worktree verdict for a detached worktree whose head is unreadable instead of aborting the whole run.
    expected_artifact: Evidence satisfying Agent Ask tidy-detached-count-tolerates-unreadable-head
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-5-redraft-20261113
    why: "countCommits is called unguarded from the detached branch of tidy, so one unreadable head can abort the whole tidy run."
    acceptance_criteria:
      - A failing-first test shows a detached worktree with an unreadable head yields a named per-worktree verdict, the run completes, and other worktrees keep their verdicts.
      - Existing tests pass unmodified, and pnpm vitest run tests/tidy-command.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2567", "src/commands/tidy.ts", "src/git/worktrees.ts", "tests/tidy-command.test.ts"]
questions: []
decisions: []
---

# Draft an inactive batch 5 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.

Created as an inactive draft from accepted Agent Ask ellis-batch-5-redraft-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
