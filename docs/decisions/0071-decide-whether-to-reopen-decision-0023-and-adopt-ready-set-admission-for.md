---
arcadia: v1
type: decision
id: "0071"
slug: decide-whether-to-reopen-decision-0023-and-adopt-ready-set-admission-for
project: arcadia
status: approved
question: Decide whether to reopen Decision 0023 and adopt ready-set admission for managed production. Under ready-set admission, the worker admits Actions from the portfolio's ready set in canonicalOrder, and a completion settlement records evidence and releases its claim without choosing the next Action or writing current_action. current_action becomes a derived projection that only the scheduler writes. An independent Action may start in a repository whose previous candidate is still unmerged, up to a per-repository review limit, so the operator moves forward as fast as they can afford.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Adopt ready-set admission with pipelining
options:
  - label: Adopt ready-set admission with pipelining
    consequence: "0023 is superseded. The worker admits from the ready set in queue order. Settlement records evidence and releases its claim, and stops choosing the next Action. current_action becomes a scheduler-written projection. An independent Action whose declared touches: paths do not overlap may start while the previous PR in its repository is unmerged, up to a review limit. Before pipelining ships, two things must land: unknown dependencies must block, and Decision 0070's held Actions must be built so that governance files leave every PR. Decision 0070's host settler becomes current_action's only writer. One live Session per repository stays in force under Decision 0066."
    recommended: true
  - label: Adopt ready-set admission without pipelining
    consequence: "The pointer becomes a derived projection, and settlement stops choosing the next Action, which removes the #505/#507 race class. 0023's rule against dispatching while another agent's branch is unmerged stays in force, so a repository waits for each PR to merge before its next Action starts. That is simpler to reason about, but a single-repository operator gains no speed."
    recommended: false
  - label: Keep Decision 0023 as written
    consequence: "current_action stays a stored pointer that settlement advances. Parallelism is limited to different repositories through maxConcurrentSessions, and each repository waits for its PR to merge before the next Action. The #505/#507 fixes remain necessary as separate work, and proposal steps 3 and 5 are dropped."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-25
answer: Adopt ready-set admission with pipelining
decided: 2026-09-25
---

# Decision 0071: Decide whether to reopen Decision 0023 and adopt ready-set admission for managed production. Under ready-set admission, the worker admits Actions from the portfolio's ready set in canonicalOrder, and a completion settlement records evidence and releases its claim without choosing the next Action or writing current_action. current_action becomes a derived projection that only the scheduler writes. An independent Action may start in a repository whose previous candidate is still unmerged, up to a per-repository review limit, so the operator moves forward as fast as they can afford.

## Options

- **Adopt ready-set admission with pipelining** (recommended): 0023 is superseded. The worker admits from the ready set in queue order. Settlement records evidence and releases its claim, and stops choosing the next Action. current_action becomes a scheduler-written projection. An independent Action whose declared touches: paths do not overlap may start while the previous PR in its repository is unmerged, up to a review limit. Before pipelining ships, two things must land: unknown dependencies must block, and Decision 0070's held Actions must be built so that governance files leave every PR. Decision 0070's host settler becomes current_action's only writer. One live Session per repository stays in force under Decision 0066.
- **Adopt ready-set admission without pipelining**: The pointer becomes a derived projection, and settlement stops choosing the next Action, which removes the #505/#507 race class. 0023's rule against dispatching while another agent's branch is unmerged stays in force, so a repository waits for each PR to merge before its next Action starts. That is simpler to reason about, but a single-repository operator gains no speed.
- **Keep Decision 0023 as written**: current_action stays a stored pointer that settlement advances. Parallelism is limited to different repositories through maxConcurrentSessions, and each repository waits for its PR to merge before the next Action. The #505/#507 fixes remain necessary as separate work, and proposal steps 3 and 5 are dropped.

## Rationale

Decision 0023 (2026-08-17) rejected a derived pointer because ordering the ready set would need 'an ordering heuristic standing in for the operator's judgment'. Decision 0054 has since made the explicit queue the only record of priority, and canonicalOrder (src/scheduling/order.ts) is a total order the operator controls, so that objection no longer holds. Reopening the Decision affects two things. First, settlement's selectNextAfterCompletion and its current_action write (src/ask/settlement.ts) are the source of the #505/#507 race class and of the scheduler's hold-while-unmerged rule. Second, 0023's refusal to dispatch while another agent's branch is unmerged is what prevents pipelining: the next independent Action cannot run while the previous PR waits for review. That is the main speed limit for an operator with one repository. Dependencies stay safe: readiness is read from the base branch, so an Action starts only after its dependencies have merged. Two live Sessions in one repository remain deferred by Decision 0066; this Decision does not change that. This fits Decision 0070, under which completions settle after merge, serially, on main, so the host settler is already the natural single writer of the projection. The design is in docs/proposals/portfolio-parallel-execution.md (PR #648). This choice needs a Decision because it replaces a ratified governance model: a reasonable operator could prefer the simpler one-pointer mental model over the speed gain.

Proposed by Agent Ask reopen-0023-ready-set-admission-2026-09-25.
