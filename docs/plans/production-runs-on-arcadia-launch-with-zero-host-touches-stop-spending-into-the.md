---
arcadia: v1
type: plan
slug: production-runs-on-arcadia-launch-with-zero-host-touches-stop-spending-into-the
project: arcadia
status: draft
milestone: "Production runs on Arcadia launch with zero host touches, stop spending into the same environment wall, name every stall with a one-click fix, and cannot be stranded by a Plan change under an Active scope: Actions A12, A3, A5 and A6 of the first supervised run plan are implemented and merged to main, one Action per merged PR, each with its regression test and a passing fast-rehearsal."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-12
actions:
  - id: stop-spending-into-an-environment-wall
    title: "Implement a Session capability preflight and a no-diff stop: before a coding Session is admitted, check that the sandbox can perform the Action's required workspace write, host validation and preservation; and extend the existing repair budget (recordRepairAttempt and maxRepairAttemptsPerAction in the production tick) so a first attempt that ends with no diff and a named environment blocker is counted and raises one named operator blocker instead of relaunching into the same wall. Record tokens per attempt next to the Action."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement a Session capability preflight and a no-diff stop: before a coding Session is admitted, check that the sandbox can perform the Action's required workspace write, host validation and preservation; and extend the existing repair budget (recordRepairAttempt and maxRepairAttemptsPerAction in the production tick) so a first attempt that ends with no diff and a named environment blocker is counted and raises one named operator blocker instead of relaunching into the same wall. Record tokens per attempt next to the Action."
    expected_artifact: Evidence satisfying Agent Ask stop-spending-into-an-environment-wall
    clarification: clarified
    confidence: high
    source: Agent Ask plan-production-run-hardening-batch-2026-10-12
    why: "The first Session spent about 11.1M input tokens in 9 minutes and produced no code; the repair budget counted only resumed Sessions, so nothing stopped a second attempt into the same environment wall."
    acceptance_criteria:
      - A Session whose sandbox cannot write the workspace database, run host validation or produce a preservation receipt is refused before launch with a named remedy and spends no tokens.
      - An attempt that exits incomplete_resumable with no diff and a recorded environment blocker is counted by the repair budget on the first occurrence, raises exactly one named blocker, and is not relaunched automatically.
      - "A replay of the 2026-10-12 00:40Z Session (no diff, workspace write denied, sandbox test refusals) yields one named blocker and no second launch."
      - Tokens per attempt are recorded and visible on the Action.
      - Focused tests for the preflight and the repair-budget path exist and the production tick tests and pnpm fast-rehearsal pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "https://github.com/pmark/arcadia/issues/1286", "docs/reports/first-supervised-production-run-learnings-2026-10-11.md"]
  - id: name-every-production-stall-with-a-one-click-fix
    title: "Implement named operator escalation for every refusal class that today waits silently: extend production_operator_escalations in the production tick so run approval, artifact validation and artifact acceptance waits are escalated after a bounded number of ticks, each naming the exact gate and its one-click resolution on the to-do and production pages, and sending exactly one Discord ping."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement named operator escalation for every refusal class that today waits silently: extend production_operator_escalations in the production tick so run approval, artifact validation and artifact acceptance waits are escalated after a bounded number of ticks, each naming the exact gate and its one-click resolution on the to-do and production pages, and sending exactly one Discord ping."
    expected_artifact: Evidence satisfying Agent Ask name-every-production-stall-with-a-one-click-fix
    clarification: clarified
    confidence: high
    source: Agent Ask plan-production-run-hardening-batch-2026-10-12
    why: "The first stall was visible only as a generic not-ready alert after ten minutes, with the real cause in a worker log on disk."
    acceptance_criteria:
      - "A replay of the 2026-10-11 21:10Z worker log lines produces a named escalation with a one-click resolution within three minutes and exactly one ping."
      - The escalation extends the existing production_operator_escalations mechanism; no parallel detector exists.
      - Each escalation names the gate class, the Action, and a resolution button that needs no copied text.
      - Focused tests exist and the production tick tests and pnpm fast-rehearsal pass.
    depends_on: [stop-spending-into-an-environment-wall]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/first-supervised-production-run-learnings-2026-10-11.md"]
  - id: declare-action-route-and-fix-the-approval-check
    title: "Implement an explicit execution field on Plan Actions (build or plan-run), validated when a Plan is created or amended and shown in the production preview with the expected operator touches per Action, replacing the keyword match on Action prose; and fix the artifact validator so an approval-contradiction is judged per sentence, with a golden test of the planner's standard phrasing (Issue #1277)."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement an explicit execution field on Plan Actions (build or plan-run), validated when a Plan is created or amended and shown in the production preview with the expected operator touches per Action, replacing the keyword match on Action prose; and fix the artifact validator so an approval-contradiction is judged per sentence, with a golden test of the planner's standard phrasing (Issue #1277)."
    expected_artifact: Evidence satisfying Agent Ask declare-action-route-and-fix-the-approval-check
    clarification: clarified
    confidence: high
    source: Agent Ask plan-production-run-hardening-batch-2026-10-12
    why: "Routing by keywords in prose sent the bug Plan's Actions to extra Decisions, and the validator rejected a correct artifact, so an Action took four operator touches before any code."
    acceptance_criteria:
      - "An Action with execution: build routes to a build packet regardless of its wording; an Action with execution: plan-run routes to a plan run; an Action with neither keeps today's behaviour and the preview says so."
      - The production preview lists each Action's route and the operator touches it expects.
      - "The artifact sentence pair quoted in Issue #1277 (a statement that the run itself needs no approval followed by one that the later implementation needs a separate approved goal) passes the validator, and a sentence saying the implementation needs no approval still fails it."
      - Focused tests exist and pnpm fast-rehearsal passes.
    depends_on: [name-every-production-stall-with-a-one-click-fix]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1277", "https://github.com/pmark/arcadia/issues/1284"]
  - id: refuse-plan-changes-inside-an-active-production-scope
    title: "Implement a scope-drift guard: activating, pausing or re-pointing a Plan whose Actions an Active production policy covers is refused with a named remedy (press STOP first), and a mismatch between the Project pointer and an Active policy's scope raises a red alert with its one-click remedy."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement a scope-drift guard: activating, pausing or re-pointing a Plan whose Actions an Active production policy covers is refused with a named remedy (press STOP first), and a mismatch between the Project pointer and an Active policy's scope raises a red alert with its one-click remedy."
    expected_artifact: Evidence satisfying Agent Ask refuse-plan-changes-inside-an-active-production-scope
    clarification: clarified
    confidence: high
    source: Agent Ask plan-production-run-hardening-batch-2026-10-12
    why: "On 2026-10-11 another session activated a different Plan under an Active production scope and returned the run's Plan to draft; the run stranded and was discovered only from a worker log."
    acceptance_criteria:
      - Applying an activation or pause that changes the current Plan of a Project covered by an Active policy scope is refused before any document is written, naming STOP as the remedy.
      - A pointer that leaves an Active policy's scope raises a red alert naming the mismatch, with a one-click remedy.
      - With production Inactive the existing activation behaviour is unchanged.
      - Focused tests exist and pnpm fast-rehearsal passes.
    depends_on: [declare-action-route-and-fix-the-approval-check]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/first-supervised-production-run-learnings-2026-10-11.md"]
questions: []
decisions: []
---

# Production runs on Arcadia launch with zero host touches, stop spending into the same environment wall, name every stall with a one-click fix, and cannot be stranded by a Plan change under an Active scope: Actions A12, A3, A5 and A6 of the first supervised run plan are implemented and merged to main, one Action per merged PR, each with its regression test and a passing fast-rehearsal.

Created as an inactive draft from accepted Agent Ask plan-production-run-hardening-batch-2026-10-12; creation changed no pointer. Current activation is recorded in frontmatter.
