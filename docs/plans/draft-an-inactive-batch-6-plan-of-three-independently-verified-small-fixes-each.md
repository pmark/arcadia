---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-6-plan-of-three-independently-verified-small-fixes-each
project: arcadia
status: draft
milestone: Draft an inactive batch 6 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-13
actions:
  - id: stabilize-coordinator-relay-pid-record-wait
    title: The coordinator-relay pid-record test waits on the press record instead of a fixed 45 ms timer.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The coordinator-relay pid-record test waits on the press record instead of a fixed 45 ms timer.
    expected_artifact: Evidence satisfying Agent Ask stabilize-coordinator-relay-pid-record-wait
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-6-redraft-20261113
    why: "The test reads the press record for the child pid on a fixed 45 ms window and CI runs failed with expected undefined."
    acceptance_criteria:
      - A failing-first deterministic test delays the pid write past the old fixed window and fails against the current wait, and the fix waits on the record rather than a timer.
      - The startPressInProgressIn assertions stay unchanged, and pnpm vitest run tests/coordinator-relay.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2575", "tests/coordinator-relay.test.ts"]
  - id: dashboard-live-listen-on-free-port
    title: The dashboard-live test listens on a free port instead of a random port that another test in the shard can hold.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The dashboard-live test listens on a free port instead of a random port that another test in the shard can hold.
    expected_artifact: Evidence satisfying Agent Ask dashboard-live-listen-on-free-port
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-6-redraft-20261113
    why: "tests/dashboard-live.test.ts picks a random port in 40000 to 60000 that another test in the same shard can hold, giving EADDRINUSE."
    acceptance_criteria:
      - A failing-first test that holds the port the old random choice would pick shows the check still runs on a different free port.
      - Existing assertions stay unchanged, and pnpm vitest run tests/dashboard-live.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2504", "tests/dashboard-live.test.ts"]
  - id: bound-start-run-term-forwarding-wait
    title: The start-run executor TERM forwarding test waits for a readiness signal instead of a timing-sensitive delay.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The start-run executor TERM forwarding test waits for a readiness signal instead of a timing-sensitive delay.
    expected_artifact: Evidence satisfying Agent Ask bound-start-run-term-forwarding-wait
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-6-redraft-20261113
    why: "The TERM forwarding test in tests/start-run-executor.test.ts is timing-sensitive and failed once in CI."
    acceptance_criteria:
      - A failing-first deterministic test delays stage startup and shows the current timing wait fails; the fix waits for a readiness signal; the first implementation step confirms the exact stage readiness signal.
      - The TERM forwarding assertion stays unchanged, and pnpm vitest run tests/start-run-executor.test.ts passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2026", "tests/start-run-executor.test.ts"]
questions: []
decisions: []
---

# Draft an inactive batch 6 Plan of three independently verified small fixes, each with a failing-first test, for operator ratification.

Created as an inactive draft from accepted Agent Ask ellis-batch-6-redraft-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
