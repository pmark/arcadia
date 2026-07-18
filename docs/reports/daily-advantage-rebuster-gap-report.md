# Daily Advantage Rebuster Golden-Path Report

Date: 2026-07-18

Current Milestone: make one existing SQLite Action usable from Today through accepted planning Artifact.

Next Action: use the live Today recommendation; maintain the selector rules as Action data quality improves.

Responsibility: Codex for implementation; Mark for each Decision.

Required Artifacts: this report, `START_HERE.md`, `tests/daily-advantage-loop.test.ts`, and the packet, Validation, planning Artifact, and Log produced by each approved Run.

## Verdict

The Daily Advantage golden path is implemented and usable. Today deterministically selects one eligible existing Action from SQLite, explains why it matters and why it is ready, and exposes one **Prepare Planning Decision** control. Preparation reuses the Action, creates or reuses one packet-bound Decision, and stops with no Run and no Codex process. Review approval then uses the existing managed worker, validator, Artifact/Log recording, and acceptance path.

No schema, dependency, service, agent framework, or second truth store was added. SQLite remains operational truth and Markdown/files remain durable evidence.

## Rebuster Scenarios

Permanent fixture: prepare an **Eyes on the Prize layout remediation plan with regression-test acceptance criteria** for the real vertically reversed answer-layout defect. The fixture recreates the scenario in a disposable workspace and empty repository; it never modifies Rebuster.

Live Today recommendation at verification time:

- Project: Rebuster
- Milestone: Pinterest publishing support
- Action: Define Pinterest posting support boundaries.
- Expected Artifact: Pinterest implementation plan
- Action ID: `work_3f20b649b5604551ab`

The live recommendation was inspected read-only. No real Decision or Codex Run was created during verification.

## End-to-End State Transitions

| Stage | SQLite truth | Durable evidence | Today/user state |
| --- | --- | --- | --- |
| Identify | Read active Project/Milestone and eligible Actions; exclude blocked, incomplete, build-oriented, prepared, or running work | None | One recommendation names Action, expected Artifact, why it matters, and why now |
| Prepare | Reuse Action; create/reuse one plan, planning step, invocation, packet/critique Artifacts, and open Decision | Prompt, metadata, output placeholders, critique | Card becomes Decision Ready; no Run exists |
| Approve | Atomically approve exact packet digest and create one pending Run | Existing packet remains immutable | Review shows the approved/queued transition |
| Execute | Worker claims Run and invokes the approved read-only planning profile | JSONL and final output | Runs exposes current state |
| Validate | Reduce output to completed, requires review, or failed | Validation JSON and diagnostics | Failed Validation never appears complete |
| Record | Link planning and Validation Artifacts plus one Markdown Log to Run | Plan, Validation, Log | Run detail opens all evidence |
| Accept/update | Approve acceptance Decision; mark final Artifact ready and original Action done | Evidence remains immutable | Completed Action leaves eligibility; next eligible Action may appear |

## Actual Implementation Path

1. `selectDailyAdvantage` reads existing tables only (`src/dashboard/dailyAdvantage.ts`).
2. Eligibility requires an open Codex Action in the Work Queue, active Project and Milestone, expected Artifact, configured repository, exactly one `codex_planning` step, and no active planning packet, Decision, planned workflow, or managed Run.
3. Candidates order by `created_at DESC, id ASC`. The rationale explicitly says this is the newest eligible Action; it does not invent business priority.
4. An existing open/deferred Decision created by existing-Action preparation is pinned before another candidate, preventing recommendation churn.
5. `buildDashboardSnapshot` includes the read-only recommendation (`src/dashboard/snapshot.ts`).
6. Today renders the card and calls `POST /api/daily-advantage` only when the user clicks Prepare (`apps/dashboard/app/page.tsx`, `apps/dashboard/app/api/daily-advantage/route.ts`).
7. The route verifies the posted Action is still the selected recommendation, then delegates to the existing CLI adapter and `work plan <action-id>`.
8. `runWorkPlanCommand` transactionally prepares the Action through the shared packet/Decision helper (`src/commands/work.ts`, `src/execution/planningPreparation.ts`).
9. Review, authorization, worker, runner, Validation, Artifact/Log, retry, and acceptance paths continue unchanged.

## Reused Components

| Component | Status and reuse |
| --- | --- |
| SQLite schema/repositories | Existing operational truth; unchanged |
| `planStepsForWorkItem` | Existing deterministic guard distinguishing planning from build work |
| Packet generator and coding-agent registry | Existing bounded read-only planning packet |
| Packet/Decision persistence | Shared by Ask and existing-Action preparation |
| Planning authorization | Existing digest/link validation and one-Run-per-Decision invariant |
| Managed worker and runner | Existing execution engine |
| Validator, Artifact links, and Markdown Log writer | Existing durable evidence path |
| Review, Runs, and acceptance UI | Existing downstream user loop |
| Dashboard snapshot/CLI adapter | Existing read/mutation boundary |

## Previously Broken or Missing Transitions

| Transition | Prior classification | Current status |
| --- | --- | --- |
| Existing Action → packet-bound Decision | Disconnected | Implemented and tested |
| Candidate Actions → one explained recommendation | Incomplete | Implemented and tested with stable ordering/read-only assertions |
| Today recommendation → controlled preparation | Missing | Implemented through one CLI-backed API route and card |
| Prepared recommendation → Review | Missing | Implemented; prepared Decision stays pinned with Open Review |
| Ask/existing-Action packet persistence | Duplication risk | Resolved by one bounded helper |

No broken transition remains in the chosen golden path. Historical orphan packets and failed Runs remain visible as old workspace data; this slice does not rewrite or delete them.

## Highest-Leverage Implementation Slice

Completed slice: **one deterministic, evidence-based Daily Advantage card backed by idempotent existing-Action preparation.**

Its user-visible improvement is direct: the operator no longer searches CLI lists or copies an Action ID. Today recommends one safe planning Artifact, and one click creates the exact Decision that the existing managed loop can execute.

## Acceptance Criteria and Evidence

1. Same SQLite state always selects the same eligible Action — deterministic snapshot test passes.
2. Loading Today is read-only — row-count assertions cover plans, Decisions, invocations, Runs, and Artifacts.
3. Card includes Project, Milestone, Action, expected Artifact, why it matters, and why now — snapshot and browser tests pass.
4. Ineligible Actions are excluded — blocked/completed/missing-context/active packet/active Run and non-planning paths are covered by eligibility and preparation tests.
5. Prepare verifies the still-current Action — API route compares posted and selected Action IDs.
6. Prepare creates/reuses one plan, invocation, packet Artifact, critique Artifact, and open Decision for the same Action — integration assertions pass.
7. Prepare creates zero Runs and does not invoke Codex — SQLite and fake-executor assertions pass.
8. Repeated preparation returns the same identities — idempotency test passes.
9. Prepared Decision remains on Today with Open Review — snapshot and browser assertions pass.
10. Approval creates one managed Run; worker executes; Validation and Log/Artifacts persist; acceptance marks the original Action done — full browser/worker fixture passes.
11. New Ask behavior remains intact — existing request-driven regression and browser tests pass.
12. Live Today page renders the real Rebuster recommendation — verified through the in-app browser against the running managed service.

## Verification Results

All mutation/execution verification uses disposable workspaces and a fake planning executor. No real Codex execution, credentials, publishing, deployment, spending, messaging, merging, or destructive Rebuster change occurred.

| Check | Result |
| --- | --- |
| Full Vitest suite | 38 files passed, 2 skipped; 401 tests passed, 2 skipped; 0 failed |
| Full Playwright suite | 9/9 passed, including the Today full-loop fixture |
| Daily Advantage + snapshot focused tests | 21/21 passed |
| New Today full-loop browser fixture | 1/1 passed |
| Dashboard production build | Passed; `/api/daily-advantage` compiled |
| Core and dashboard type-checks | Passed |
| Live managed services | Restarted successfully with Node 25; Today and snapshot healthy |
| Live in-app browser | Today heading, navigation, real Rebuster recommendation, rationale, expected Artifact, and Prepare control visible |

## Risks and Assumptions

- “Value” is bounded to readiness plus recency; Arcadia does not invent business priority. Mark can change Action data or finish/defer Decisions to influence the next recommendation.
- Existing historical planning packets without Decisions are excluded instead of silently repaired.
- Build-oriented Actions are excluded because Daily Advantage currently prepares read-only planning only.
- The current native SQLite install requires Node 25.6.1; the managed restart and operator fallback pin that runtime.
- The live workspace contains historical failed Runs and orphan packet records. They remain visible but do not block the selected eligible Action.

## Explicit Non-Goals

- Automatically approving a Decision or running Codex from Today.
- Repairing, deleting, or migrating historical workspace rows.
- Running against or modifying the real Rebuster repository during verification.
- Publishing, deployment, credentials, spending, messaging, merging, or destructive actions.
- A scheduler, generic agent framework, graph model, plugin, microservice, or second state store.
- Replacing SQLite truth or Markdown reports and Logs.
