---
arcadia: v1
type: plan
slug: one-stop-never-ends-the-card-20261126
project: arcadia
status: draft
milestone: One stop never ends the card 20261126
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-26
actions:
  - id: wire-night-breaker-into-tick
    title: The production tick evaluates the existing night breaker on every pass and turns production Off with one page when it trips.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The production tick evaluates the existing night breaker on every pass and turns production Off with one page when it trips.
    expected_artifact: Evidence satisfying Agent Ask wire-night-breaker-into-tick
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-one-stop-never-ends-the-card-20261126
    why: "evaluateNightBreaker and findRepeatedCause (src/production/parkAndContinue.ts:180,202) have no caller (#3047), so letting work continue past a stopped Action would have no bound; the bound goes in first."
    acceptance_criteria:
      - A fixture test drives the tick with three parks for one project inside a rolling 24 hours and shows exactly one Off receipt and one attention ping naming the trip kind parks; with two parks it records neither.
      - A fixture test shows two parks with the same cause turn production Off through findRepeatedCause, and that sign-in, capacity and outage holds never count as parks.
      - "src/production/parkAndContinue.ts gains an importer under src/production/ that the tick calls, and no breaker limit changes: BREAKER_PARK_LIMIT 3, merge limits 3 and 6, lane token ceiling 40000000, Claude five-hour 70 percent."
      - tests/park-and-continue.test.ts and the existing tick tests pass in the required CI jobs on the pull request head.
    depends_on: []
    decisions: []
    references: ["src/production/tick.ts", "src/production/parkAndContinue.ts", "src/production/capacityPreAdmission.ts", "docs/decisions/0181-decide-what-unattended-production-does-after-attempt-3-s-clean-run-re-deciding.md", "docs/decisions/0187-decide-what-unattended-production-does-after-a-delegated-batch-fails-under-the.md"]
  - id: continue-past-a-stopped-action
    title: An in-scope Action stopped as terminal_candidate_not_integrable, or gated only on its own pending completion Ask, is parked with a receipt and admission moves on to the next Action that does not depend on it.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: An in-scope Action stopped as terminal_candidate_not_integrable, or gated only on its own pending completion Ask, is parked with a receipt and admission moves on to the next Action that does not depend on it.
    expected_artifact: Evidence satisfying Agent Ask continue-past-a-stopped-action
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-one-stop-never-ends-the-card-20261126
    why: "On 2026-11-25 card B, Action 6 stopped this way and independent Actions 7 and 8 were never admitted, ending the card at 2 of 5 (#3107); Plan F park-and-continue promised admission continues."
    acceptance_criteria:
      - "A failing-first fixture test reproduces card B: three in-scope Actions, the first stopped as terminal_candidate_not_integrable; before the change the second is never admitted, after it the second and third are admitted while the first keeps its escalation and preserved candidate."
      - The same holds for operator_gate_pending when its only gating item is the stopped Action's own pending completion Ask, while an operator_gate_pending that names an unanswered Decision still stops as today; a test shows both.
      - Each such park writes one receipt (action, condition, cause) through recordFailedCondition and counts toward the night breaker, and an Action that depends on the parked one is not admitted; a test shows both.
      - "The global stops listed at src/production/terminalCandidates.ts:53-64 (sign-in, authority, STOP, storage, custody, environment wall) are unchanged, and the pull request body states 'Loosens a gate: yes, narrowly' and cites Decisions 0181, 0187 and 0223."
    depends_on: [wire-night-breaker-into-tick]
    decisions: []
    references: ["src/scheduling/scheduler.ts", "src/production/terminalCandidates.ts", "src/production/tick.ts", "src/production/parkAndContinue.ts", "docs/decisions/0223-d1-who-may-park-a-showstopped-action-during-an-unattended-production-run.md"]
  - id: end-the-card-when-every-pin-is-merged-or-parked
    title: A per-card run whose every pinned Action is merged or parked records scope complete with merged and parked counts, and the host timer turns production Off for it.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A per-card run whose every pinned Action is merged or parked records scope complete with merged and parked counts, and the host timer turns production Off for it.
    expected_artifact: Evidence satisfying Agent Ask end-the-card-when-every-pin-is-merged-or-parked
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-one-stop-never-ends-the-card-20261126
    why: "announceScopeComplete (src/production/tick.ts:1243-1279) needs every in-scope Action done and only the successor path issues the Off (successorPress.ts:104), so a park or a per-card run still needs a coordinator Off (#3048)."
    acceptance_criteria:
      - A fixture test shows a scope with two merged Actions and one parked Action records managed_production.scope_complete once per policy revision with merged 2 and parked 1, and the ping text names both counts.
      - A fixture test shows the host timer issues exactly one scope-complete Off with a receipt for a per-card run at that revision, and none while a pinned Action is running or is neither merged nor parked.
      - "A test shows arcadia start-run day-evidence reports scopeComplete with the merged and parked counts for that run instead of null (#2942)."
      - "The successor path's existing scope-complete Off (src/production/successorPress.ts:104) is unchanged and its tests pass in the required CI jobs on the pull request head."
    depends_on: [continue-past-a-stopped-action]
    decisions: []
    references: ["src/production/tick.ts", "src/production/successorPress.ts", "src/production/policy.ts", "src/commands/productionLiveness.ts", "docs/decisions/0282-what-makes-a-batch-failed-and-a-night-clean.md"]
questions: []
decisions: []
---

# One stop never ends the card 20261126

Created as an inactive draft from accepted Agent Ask ellis-plan-one-stop-never-ends-the-card-20261126; creation changed no pointer. Current activation is recorded in frontmatter.
