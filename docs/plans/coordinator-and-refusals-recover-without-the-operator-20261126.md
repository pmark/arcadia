---
arcadia: v1
type: plan
slug: coordinator-and-refusals-recover-without-the-operator-20261126
project: arcadia
status: draft
milestone: Coordinator and refusals recover without the operator 20261126
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-26
actions:
  - id: page-when-the-custodian-dies-or-is-unresolvable
    title: The coordinator budget check pages once when the registered custodian dies, stops writing or hits its context limit, and reports an unresolvable custodian on its own row without failing the run.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The coordinator budget check pages once when the registered custodian dies, stops writing or hits its context limit, and reports an unresolvable custodian on its own row without failing the run.
    expected_artifact: Evidence satisfying Agent Ask page-when-the-custodian-dies-or-is-unresolvable
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-coordinator-and-refusals-recover-20261126b
    why: "On 2026-11-22 a dead Rowan stalled the night for 3 h 13 min with no page (#3077); PR #3080 builds this and passed review, but its N2 finding makes every liveness run exit non-zero for an unresolvable custodian."
    acceptance_criteria:
      - A test shows a registered custodian with no title prefix that is silent past the stated bound is paged once, and a context-limit tail pages at the forced level once and deduplicates on the next tick.
      - A test shows a custodian with no transcript path and no session id, or with a non-claude provider, is reported unmeasured on its own row once while the run exits 0 and --json still prints its success data (review N2).
      - A test shows a custodian that writes again after a silence page and later goes silent is paged a second time (review N1).
      - The ping texts, levels and channels stay unchanged, and no renewal, replacement or message to any session is added.
    depends_on: []
    decisions: []
    references: ["src/commands/coordinatorBudget.ts", "src/coordinators/budget.ts", "src/coordinator/generations.ts", "src/production/sessionSignals.ts"]
  - id: set-handoff-lines-in-absolute-tokens
    title: "Coordinator handoff levels use Decision 0284 A's absolute input-token lines: prepare at 200k, due at 260k, forced at 320k and a ceiling at 400k."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Coordinator handoff levels use Decision 0284 A's absolute input-token lines: prepare at 200k, due at 260k, forced at 320k and a ceiling at 400k."
    expected_artifact: Evidence satisfying Agent Ask set-handoff-lines-in-absolute-tokens
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-coordinator-and-refusals-recover-20261126b
    why: "src/coordinators/budget.ts:32 still uses percentages (prepare 50, due 60, forced 75), so a Rowan can pass the 400k ceiling of Decision 0284 before it is told to hand off (playbook B6b)."
    acceptance_criteria:
      - A test shows, for a session with a 1M-token window, no level at 199999 input tokens and the levels prepare at 200000, due at 260000, forced at 320000 and ceiling at 400000.
      - The ping text names the absolute line crossed and the session's token count, and a test asserts it.
      - No other threshold, ping channel or handoff behaviour changes, and the existing coordinator budget tests pass in the required CI jobs on the pull request head.
    depends_on: [page-when-the-custodian-dies-or-is-unresolvable]
    decisions: []
    references: ["src/coordinators/budget.ts", "src/commands/coordinatorBudget.ts", "docs/decisions/0284-the-400k-session-ceiling-record-your-finding-and-replace-decision-0191-s.md"]
  - id: offer-one-tap-retry-after-a-fixed-refusal
    title: After a press under an open grant is refused having consumed nothing, and a pull request citing that refusal's Issue merges with green checks, one 'retry this grant' card is offered whose press re-arms the same grant.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: After a press under an open grant is refused having consumed nothing, and a pull request citing that refusal's Issue merges with green checks, one 'retry this grant' card is offered whose press re-arms the same grant.
    expected_artifact: Evidence satisfying Agent Ask offer-one-tap-retry-after-a-fixed-refusal
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-coordinator-and-refusals-recover-20261126b
    why: "Decision 0289 D approved this on 2026-11-24 and Milestone 5 tests it, but no Action exists; today each fixed refusal costs a new card, a rehearsal, a pre-mortem and a press."
    acceptance_criteria:
      - A fixture test shows a refused press with no allowance or Session consumed, plus a merged pull request with green checks citing its Issue, produces exactly one retry card naming the grant, the refusal and the fix pull request, and one ping.
      - Tests show no retry card when the refusal consumed anything, when no fix has merged, when the grant has ended, or when a second refusal on the same cause followed a fix (Decisions 0181 and 0187 stand).
      - Pressing the card re-runs the full replay and preflight before re-arming, and a test shows a failed preflight leaves the grant unchanged.
      - Nothing retries without the press, and the automatic retry of Decision 0289 option A is not built here.
    depends_on: []
    decisions: []
    references: ["src/production/successorPress.ts", "src/operatorActions/startRunDayGrant.ts", "src/ping/signalPingPolicy.ts", "docs/decisions/0289-may-a-refused-successor-or-per-card-press-that-consumed-nothing-retry-under-the.md"]
questions: []
decisions: []
---

# Coordinator and refusals recover without the operator 20261126

Created as an inactive draft from accepted Agent Ask ellis-plan-coordinator-and-refusals-recover-20261126b; creation changed no pointer. Current activation is recorded in frontmatter.
