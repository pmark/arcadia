---
arcadia: v1
type: plan
slug: nights-never-run-empty-20261126
project: arcadia
status: draft
milestone: Nights never run empty 20261126
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-26
actions:
  - id: wire-the-8am-overnight-report
    title: A read-only overnight report for the last night, delivered once each morning, re-verifies every worker merge, states the empty nights in the last seven, and the night-silence page runs in the liveness check.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A read-only overnight report for the last night, delivered once each morning, re-verifies every worker merge, states the empty nights in the last seven, and the night-silence page runs in the liveness check.
    expected_artifact: Evidence satisfying Agent Ask wire-the-8am-overnight-report
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-nights-never-run-empty-20261126
    why: "overnightVerify.ts (renderOvernightReport :145, decideNightSilence :198) has no caller at a558014ca, so Milestone 8's report never runs and Milestone 7's measure is kept by hand (playbook B5, #2939)."
    acceptance_criteria:
      - "A read-only command registered in src/cli.ts prints the overnight report for a named night, first line heartbeat age, and a fixture of the night of 2026-11-24 lists the worker merges #3060 to #3063, each re-read from GitHub."
      - The liveness check calls decideNightSilence, and a fixture test shows exactly one page after N hours Active with no merge and no park, and none before N hours.
      - The report states the night's worker-merge count and how many of the last seven nights (9 PM to 8 AM Pacific) had none, and a test shows a week with two empty nights.
      - Morning delivery reuses the existing digest or ping path with no new channel and sends at most one report per morning, and a test shows the dedupe.
    depends_on: []
    decisions: []
    references: ["src/production/overnightVerify.ts", "src/commands/productionLiveness.ts", "src/cli.ts", "src/digests/composer.ts"]
  - id: refuse-a-done-action-that-adds-an-unwired-module
    title: A completion that adds a src module with no importer outside tests is refused with a named reason, so a library-only change cannot be recorded as done.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A completion that adds a src module with no importer outside tests is refused with a named reason, so a library-only change cannot be recorded as done.
    expected_artifact: Evidence satisfying Agent Ask refuse-a-done-action-that-adds-an-unwired-module
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-nights-never-run-empty-20261126
    why: "Plan F's park-and-continue and verify-overnight-merges-at-8am settled as done while their modules had no caller (#3047, #3107), so Milestones 6 and 8 read as built when they were not (playbook B11)."
    acceptance_criteria:
      - A failing-first fixture test shows a candidate that adds a module under src/ imported only by tests/ is refused at completion with a named reason, and the same candidate with an importer under src/, scripts/ or apps/ passes.
      - A test shows candidates that add only tests/ or docs/ files are unaffected.
      - The refusal text names the module and the missing wiring, and a test asserts the text.
    depends_on: []
    decisions: []
    references: ["src/ask/settlement.ts", "src/sessions/completionValidation.ts"]
  - id: record-the-approved-plan-queue
    title: A checked-in per-Project record lists, in order, the Plans the operator approved for production; a read-only command prints each one's readiness; and START card derivation accepts the queue's first ready Plan under an open standing grant.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A checked-in per-Project record lists, in order, the Plans the operator approved for production; a read-only command prints each one's readiness; and START card derivation accepts the queue's first ready Plan under an open standing grant.
    expected_artifact: Evidence satisfying Agent Ask record-the-approved-plan-queue
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-nights-never-run-empty-20261126
    why: "Milestone 7 needs a Plan finishing mid-night to hand over to the next approved Plan, and today nothing records which Plans are approved, so each Plan change costs an operator card (#2774, playbook B17)."
    acceptance_criteria:
      - A parser for the record (its path under docs/ named in the pull request) accepts an ordered list of existing Plan slugs and refuses a duplicate, an unknown slug or a complete Plan, with a test for each.
      - A read-only command prints each queued Plan as ready or not ready with the first reason (an unanswered Decision, an Action without observable acceptance, a path the deriver stops at), and a fixture shows one ready and two not-ready Plans.
      - Under an open grant, src/operatorActions/startRunDerive.ts accepts only the grant's pinned Plan or the first ready queued Plan at the same origin main revision, and any other Plan refuses with a named code; tests show each case.
      - The pull request adds no queue entry and changes no grant end condition, and its body says which Plans enter the queue stays the operator's decision.
    depends_on: []
    decisions: []
    references: ["src/operatorActions/startRunDerive.ts", "src/commands/startRun.ts", "src/cli.ts", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md"]
  - id: start-the-next-queued-plan-at-scope-complete
    title: When the standing grant's Plan reaches scope complete with every pin merged or parked, the host timer activates the next ready queued Plan and presses its first derived card under the same grant, with no operator step.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: When the standing grant's Plan reaches scope complete with every pin merged or parked, the host timer activates the next ready queued Plan and presses its first derived card under the same grant, with no operator step.
    expected_artifact: Evidence satisfying Agent Ask start-the-next-queued-plan-at-scope-complete
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-nights-never-run-empty-20261126
    why: "North Star gate 3: nights 2026-11-22 and 11-23 had no worker merge, and a Plan finishing mid-night still ends the night today."
    acceptance_criteria:
      - "A fixture test shows: grant open, Plan P1 at scope complete, Plan P2 first ready in the queue record; the timer activates P2 through the existing plan-activation path and presses one derived card, recording a receipt for each step."
      - Fixture tests show no activation when the queue is empty, the next Plan is not ready, the grant has ended, or a failed batch is open under Decision 0282 A; each records one named skip reason and at most one ping.
      - A replay of the two-Plan fixture through the rehearsal harness passes with only the provider launch stubbed, as Decision 0288 rule 1 requires before live use.
      - Each activation passes the same preflight and replay the per-card press uses, and the grant's caps and end conditions are unchanged; a test shows a capped grant stops.
    depends_on: [record-the-approved-plan-queue]
    decisions: []
    references: ["src/production/successorPress.ts", "src/operatorActions/startRunDayGrant.ts", "src/commands/productionSuccessor.ts", "docs/decisions/0288-standing-production-rules-no-operator-press-is-the-first-live-test-of-a-path.md"]
questions: []
decisions: []
---

# Nights never run empty 20261126

Created as an inactive draft from accepted Agent Ask ellis-plan-nights-never-run-empty-20261126; creation changed no pointer. Current activation is recorded in frontmatter.
