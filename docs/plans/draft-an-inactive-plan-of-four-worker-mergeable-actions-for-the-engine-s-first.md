---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-four-worker-mergeable-actions-for-the-engine-s-first
project: arcadia
status: active
milestone: "Draft an inactive Plan of four worker-mergeable Actions for the engine's first approved queue: the operator timeline shows who decided what (START presses, worker merges, the operator's recorded interactions and superseded Asks)"
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-24
actions:
  - id: timeline-reads-card-start-presses
    title: The operator timeline shows each START card press from the operator-script library's per-card run receipts, with the card id, run id, who pressed it and its outcome, so a press appears beside the work it started.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-timeline-reads-card-start-presses-3fede8d2a511; no further action.
    expected_artifact: Evidence satisfying Agent Ask timeline-reads-card-start-presses
    clarification: clarified
    confidence: high
    source: Agent Ask rowan31-amend-engine-plan-action1-20261122d
    why: "START presses are the operator's own decisions, and the timeline's script collector reads only one directory level, so card presses never appear."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false (already fixed or different), stop and report instead of changing code: src/timeline/collectors/operatorScripts.ts reads only runs/<entry>/receipt.json (one level, near lines 29-36), and the operator-script library holds per-card receipts one level deeper (inspect the real layout in the MAIN CHECKOUT's operator-script library, /Users/pmark/Dev/MR/Arcadia/arcadia/artifacts/generated/operator-scripts/runs, read-only: it is gitignored, so it is absent from a candidate worktree; if it cannot be read there, use the layout observed on 2026-11-22: runs/<card-id>/<run-id>/receipt.json, nested two levels, each with a mode of run or preflight and a record object, alongside one-level runs/<entry>/receipt.json files, and name the layout you used in the PR)."
      - A failing-first test in a new tests/timeline-card-presses.test.ts builds a temporary repository with a runs/<card>/<run>/receipt.json fixture in the layout found above and shows the collector emits one event per press with source operator-scripts, subjects naming the project and, when the receipt has one, its record.plan (omitted when absent), with the card id in the summary, the run id as evidence, the press outcome in the summary, and an actor whose confidence is low when the receipt does not name who pressed; a malformed receipt is skipped without throwing; the existing one-level receipts still produce exactly the events they do today. Receipts with mode run are presses, whether a START, day-grant or standing-grant card; receipts with mode preflight are skipped and emit no event (so no new event kind is needed); the runs/operator/ directory is skipped.
      - pnpm vitest run tests/timeline-card-presses.test.ts tests/timeline-collectors.test.ts --testTimeout 150000 passes.
      - "Only src/timeline/collectors/operatorScripts.ts and tests/timeline-card-presses.test.ts (new) change. Only the files listed change; every changed agent-own path is worker-merge-safe (isWorkerMergeSafePath, src/production/workerMerge.ts) with no authority class from classifyAuthorityPaths, the agent's own diff is at most 250 lines, so the whole candidate with its completion settlement (about 120 lines, as in #2935) stays under the 400-line blast-radius threshold, and the Session records this; if any other path must change, stop and report. Do not edit docs/notes-to-self.md, tests/helpers/ or tests/fixtures/; capture lessons with arcadia learn."
    depends_on: []
    decisions: []
    references: ["src/timeline/collectors/operatorScripts.ts", "src/timeline/schema.ts", "artifacts/generated/operator-scripts/runs"]
  - id: timeline-reads-worker-merges
    title: The operator timeline shows each production worker merge attempt from production_worker_merges, with the Action, pull request, outcome and refusal code, so merged and parked work is visible beside its decisions.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The operator timeline shows each production worker merge attempt from production_worker_merges, with the Action, pull request, outcome and refusal code, so merged and parked work is visible beside its decisions.
    expected_artifact: Evidence satisfying Agent Ask timeline-reads-worker-merges
    clarification: clarified
    confidence: high
    source: Agent Ask rowan31-plan-first-engine-queue-20261122c
    why: "Who merged what is the first question of the decision log, and no timeline collector reads the worker's merge records today."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false (already fixed or different), stop and report instead of changing code: no file under src/timeline reads production_worker_merges (git grep), and the table's columns (action_key, session_id, pull_request_url, outcome, code, updated_at) are as defined in src/production/workerMerge.ts."
      - A failing-first test in a new tests/timeline-worker-merges.test.ts seeds a temporary workspace database with merged and refused rows and shows collectProduction emits one event per row inside the window, kind production.worker_merge, with subjects naming the project, Action and pull request number parsed from the URL, the outcome and code in the summary, the row as evidence, and the production worker as actor (the table records no other actor); a database without the table yields no event and no error (hasTable guard); events outside the window are excluded.
      - pnpm vitest run tests/timeline-worker-merges.test.ts tests/timeline-collectors.test.ts --testTimeout 150000 passes.
      - "Only src/timeline/collectors/production.ts, tests/timeline-worker-merges.test.ts (new) and src/timeline/classify.ts (one WORK_KIND_BY_EVENT_KIND entry for the production.worker_merge kind) change. Only the files listed change; every changed agent-own path is worker-merge-safe (isWorkerMergeSafePath, src/production/workerMerge.ts) with no authority class from classifyAuthorityPaths, the agent's own diff is at most 250 lines, so the whole candidate with its completion settlement (about 120 lines, as in #2935) stays under the 400-line blast-radius threshold, and the Session records this; if any other path must change, stop and report. Do not edit docs/notes-to-self.md, tests/helpers/ or tests/fixtures/; capture lessons with arcadia learn."
    depends_on: []
    decisions: []
    references: ["src/timeline/collectors/production.ts", "src/timeline/collectors/context.ts", "src/production/workerMerge.ts", "src/timeline/classify.ts"]
  - id: timeline-reads-operator-interactions
    title: The operator timeline shows each recorded operator interaction (what the operator's words unlocked, whether it was required or avoidable, and how long the work waited), so the operator's own decisions appear beside the work they released.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The operator timeline shows each recorded operator interaction (what the operator's words unlocked, whether it was required or avoidable, and how long the work waited), so the operator's own decisions appear beside the work they released.
    expected_artifact: Evidence satisfying Agent Ask timeline-reads-operator-interactions
    clarification: clarified
    confidence: high
    source: Agent Ask rowan31-plan-first-engine-queue-20261122c
    why: "Who decided is the decision log's core question, and operator_interactions holds the operator's recorded words but no timeline collector reads it."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false (already fixed or different), stop and report instead of changing code: no file under src/timeline reads operator_interactions (git grep), and the table's columns (id, at, words, unlocked, necessity, ref, project, waiting_since, recorded_by) are as defined in src/operatorInteractions/store.ts."
      - A failing-first test in a new tests/timeline-operator-interactions.test.ts seeds a temporary workspace database with required and avoidable rows and shows a new collector in src/timeline/collectors/operatorInteractions.ts, registered in defaultCollectors in src/timeline/index.ts, emits one event per row inside the window with the operator as actor, attention false, the project as subject, a summary naming what the words unlocked and the necessity, the words in the detail capped at 200 characters, waiting minutes when waiting_since is set, and the row as evidence; a database without the table yields no event and no error; rows outside the window are excluded.
      - pnpm vitest run tests/timeline-operator-interactions.test.ts tests/timeline-collectors.test.ts --testTimeout 150000 passes.
      - "Only src/timeline/collectors/operatorInteractions.ts (new), src/timeline/index.ts, src/timeline/schema.ts (one TIMELINE_SOURCES entry, operator-interactions), src/timeline/classify.ts (one WORK_KIND_BY_EVENT_KIND entry for the new kind) and tests/timeline-operator-interactions.test.ts (new) change; every changed agent-own path is worker-merge-safe (isWorkerMergeSafePath, src/production/workerMerge.ts) with no authority class from classifyAuthorityPaths, the agent's own diff is at most 250 lines, so the whole candidate with its completion settlement (about 120 lines, as in #2935) stays under the 400-line blast-radius threshold, and the Session records this; if any other path must change, stop and report. Do not edit docs/notes-to-self.md, tests/helpers/ or tests/fixtures/; capture lessons with arcadia learn."
    depends_on: []
    decisions: []
    references: ["src/operatorInteractions/store.ts", "src/timeline/index.ts", "src/timeline/collectors/context.ts", "src/timeline/schema.ts", "src/timeline/classify.ts"]
  - id: timeline-reads-ask-supersessions
    title: The operator timeline shows when one Agent Ask superseded another (old and new request ids and what was replaced), so a changed or withdrawn proposal is visible beside the one that replaced it.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The operator timeline shows when one Agent Ask superseded another (old and new request ids and what was replaced), so a changed or withdrawn proposal is visible beside the one that replaced it.
    expected_artifact: Evidence satisfying Agent Ask timeline-reads-ask-supersessions
    clarification: clarified
    confidence: high
    source: Agent Ask rowan31-plan-first-engine-queue-20261122c
    why: "Superseded proposals are part of who decided what, and the asks collector reads proposals and settlements but not ask_supersessions."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false (already fixed or different), stop and report instead of changing code: src/timeline/collectors/asks.ts reads agent_ask_proposals and agent_ask_settlements but not ask_supersessions, whose columns are defined in src/db/schema.ts (near line 1731)."
      - A failing-first test in a new tests/timeline-ask-supersessions.test.ts seeds a temporary workspace database with an ask_supersessions row and shows the asks collector emits one event inside the window, kind ask.superseded, with subjects naming the new Ask, both request ids and the replaced kind in the summary, and the row as evidence; a database without the table yields no event and no error; the existing proposal and settlement events are unchanged.
      - pnpm vitest run tests/timeline-ask-supersessions.test.ts tests/timeline-collectors.test.ts --testTimeout 150000 passes.
      - "Only src/timeline/collectors/asks.ts, tests/timeline-ask-supersessions.test.ts (new) and src/timeline/classify.ts (one WORK_KIND_BY_EVENT_KIND entry for the ask.superseded kind) change; every changed agent-own path is worker-merge-safe (isWorkerMergeSafePath, src/production/workerMerge.ts) with no authority class from classifyAuthorityPaths, the agent's own diff is at most 250 lines, so the whole candidate with its completion settlement (about 120 lines, as in #2935) stays under the 400-line blast-radius threshold, and the Session records this; if any other path must change, stop and report. Do not edit docs/notes-to-self.md, tests/helpers/ or tests/fixtures/; capture lessons with arcadia learn."
    depends_on: []
    decisions: []
    references: ["src/timeline/collectors/asks.ts", "src/db/schema.ts", "src/timeline/schema.ts", "src/timeline/classify.ts"]
questions: []
decisions: []
current_action: timeline-reads-worker-merges
recommended_model: standard
recommended_reasoning_effort: medium
---

# Draft an inactive Plan of four worker-mergeable Actions for the engine's first approved queue: the operator timeline shows who decided what (START presses, worker merges, the operator's recorded interactions and superseded Asks)

Created as an inactive draft from accepted Agent Ask rowan31-plan-first-engine-queue-20261122c; creation changed no pointer. Current activation is recorded in frontmatter.
