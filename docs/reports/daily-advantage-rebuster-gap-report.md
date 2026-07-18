# Daily Advantage Rebuster Golden-Path Gap Report

Date: 2026-07-18

Current Milestone: connect one existing SQLite Action to Arcadia's managed planning loop without executing it.

Next Action: select and explain one eligible Daily Advantage Action in the Today page, then invoke the preparation operation already implemented here.

Responsibility: Codex.

Required Artifacts: this report, `tests/daily-advantage-loop.test.ts`, and the durable packet/Decision records created by `work plan`.

## Verdict

The highest-impact broken transition found in the audit is now implemented and tested: `arcadia work plan <action-id>` can prepare one eligible Action already stored in SQLite as one packet-bound planning Decision. It preserves the Action ID, writes the prompt and stewardship Artifacts, records a `packet_created` Codex invocation, moves the Action to Needs Mark, and stops with zero Runs and no Codex process (`src/commands/work.ts`, `src/execution/planningPreparation.ts`). Repeating the command returns the same plan, invocation, packet Artifact, and Decision.

The complete Daily Advantage product loop is not finished. Arcadia still exposes many candidate Actions but does not deterministically select and explain one recommendation, and the Today page has no Daily Advantage card or Prepare control. The already-tested downstream path—Decision approval, managed Run, Codex planning, Validation, durable Artifacts and Log, acceptance, and Action completion—can now be reused once that thin selection/UI handoff exists.

## Chosen Permanent Rebuster Scenario

Prepare a bounded remediation plan for the real Rebuster video-layout defect where **“Eyes on the Prize”** is split and vertically reversed.

Expected Artifact: **Eyes on the Prize layout remediation plan with regression-test acceptance criteria.**

This is valuable because it is user-visible and concrete, while a read-only planning pass can locate the layout path, propose a regression fixture, and define Validation without changing Rebuster. The live Arcadia workspace contains this scenario as Rebuster Action `work_f7a9aa480e1446c8ac`. The permanent test fixture recreates its shape in a disposable workspace and empty repository; it never opens or modifies the live Rebuster checkout (`tests/daily-advantage-loop.test.ts:192-231`).

## Expected End-to-End State Transitions

| Stage | SQLite operational truth | Durable Markdown/files | User-visible state |
| --- | --- | --- | --- |
| Identify | Read Project, Milestone, open Actions, expected Artifacts, Decisions, Runs, and Logs; select one eligible Action deterministically | None | One Daily Advantage recommendation states what, why now, and expected Artifact |
| Prepare | Reuse the Action; create/reuse one plan, planning step, invocation, packet Artifact, critique Artifact, and open Decision | Prompt, metadata, output placeholders, critique | Action becomes Needs Mark; exact packet and safety boundaries are reviewable |
| Approve | Atomically approve the Decision and create exactly one `pending_execution` Run | No new report required | Review shows the queued Run; duplicate approval returns the same Run |
| Execute | Worker claims the Run and authorizes the Action, plan, invocation, and packet digest before Codex starts | Executor JSONL and final planning output | Running state is visible; no provider command is an approval mechanism |
| Validate | Validator reduces result to `completed`, `requires_review`, or `failed` | Validation JSON and retained diagnostics | Failure cannot appear complete; retry needs a new Decision |
| Record | Link final planning and Validation Artifacts to the Run; link one Markdown Log | Final plan, Validation sidecar, Log | Run detail opens all retained evidence |
| Accept/update | Acceptance marks final Artifact ready and original Action done | Evidence remains immutable | Project summary advances past the completed Action |

## Actual Implementation Path

### Identification

Implemented but incomplete:

- SQLite already stores Project, Milestone, Action, Artifact, Decision, Run, and Log truth (`database/schema.sql`).
- Weekly review queries candidate gaps, Needs Mark/blocked Actions, Codex/Autonomous Actions, and unfinished Artifacts (`src/db/repositories.ts`, `buildSuggestedNextActions`).
- Dashboard snapshots expose Projects, Attention, Runs, and Artifacts (`src/dashboard/snapshot.ts`).

Missing:

- The candidate builder returns an unranked list and does not explain comparative value.
- The candidate type has no expected Artifact or readiness evidence (`src/domain/types.ts`, `SuggestedNextAction`).
- The Today page—currently labeled Mission Control—has no Daily Advantage recommendation or preparation control (`apps/dashboard/app/page.tsx`).

### Existing-Action preparation

Implemented and tested:

1. `work plan` loads the original Action in one SQLite transaction, rejects completed, blocked, missing-context, or already-underway cases, and detects a single protected `codex_planning` step (`src/commands/work.ts:142-220`).
2. It reuses an unprepared single-step planning plan when safe, otherwise creates one.
3. Existing packet generation writes the prompt, metadata, critique, JSONL target, and final-output placeholder (`src/codex/packets.ts`).
4. A shared helper records one `packet_created` invocation, prompt Artifact, critique Artifact, packet digest, and linked `CodexPlanningRunApproval` Decision (`src/execution/planningPreparation.ts:35-128`).
5. The original Action becomes open/Needs Mark with an explicit review Next Action. No new Action or Run is created.
6. A repeated call finds the valid open/deferred Decision and returns the same identities. A pending/running managed Run is rejected rather than duplicated (`src/commands/work.ts`).

The previously disconnected transition was that `work plan` created only the plan while `work run` correctly refused without a packet and approval. `tests/daily-advantage-loop.test.ts` now proves the corrected transition and its refusal cases.

### Request-driven preparation

Still implemented and regression-tested: dashboard `POST /api/ask` delegates to `runAskCommand`, which creates a new Action and uses the same shared packet/Decision helper (`src/commands/ask.ts`). This path remains appropriate for new human requests. Daily Advantage preparation does not replay an existing Action through Ask and therefore does not duplicate SQLite state.

### Approval through state update

Implemented and tested for managed planning:

- Packet binding and one-Run-per-Decision authorization are enforced by `src/execution/planningAuthorization.ts`.
- Review approval atomically queues the immutable Run; the worker dispatches it through the Action-plan runner.
- The runner persists terminal state, Artifacts, Validation, and one Markdown Log and creates acceptance or recovery Decisions (`src/execution/runner.ts`).
- Plan acceptance marks the Artifact ready and original Action done (`src/commands/review.ts`).
- Browser/worker tests exercise approval, bypass refusal, Validation failure, evidence linkage, retry, and Action completion (`tests/e2e/mission-control.spec.ts`).

## Reusable Components

| Component | Verified status | Decision |
| --- | --- | --- |
| SQLite repositories/schema | Implemented, tested | Preserve as operational truth; no migration needed |
| Markdown packet, reports, and Logs | Implemented, tested | Preserve as durable evidence |
| Weekly-review candidate queries | Implemented, incomplete selector | Reuse rather than add a new model |
| Intake and stewardship | Implemented, tested | Keep for new requests |
| `createCodexPacket` and profiles | Implemented, tested | Reused unchanged |
| Shared packet/Decision persistence | Implemented in this slice, tested through both entry paths | Keep narrow; it is not an agent framework |
| Planning authorization and queueing | Implemented, tested | Reuse unchanged |
| Worker, runner, validator, Artifact/Log writers | Implemented, tested | Reuse unchanged |
| Review, Run detail, retry, and acceptance UI | Implemented, browser-tested | Reuse for the prepared Decision |

## Broken, Missing, Duplicated, or Disconnected Transitions

| Rank | Transition | Classification | Current status / smallest correction |
| --- | --- | --- | --- |
| P0 | Existing Action → packet-bound planning Decision | Previously disconnected | **Implemented and tested** by this slice |
| P1 | Candidate Actions → one explained Daily Advantage | Incomplete | Add one deterministic read-model selector using existing SQLite queries and stable tie-breakers |
| P1 | Recommendation → user-controlled preparation | Missing | Add one Today card and narrow CLI-backed Prepare route; no persistence until clicked |
| P2 | Ask and existing-Action packet persistence | Previously duplicated risk | **Resolved** with one bounded shared helper |
| P2 | Installed Node/native SQLite ABI | Operational mismatch | Pin or document a consistent runtime; current dependency install is verified with Node 25.6.1 |
| P2 | Dashboard dev-server first request | Operationally intermittent | One root request returned 500 with a transient webpack module error, then root and snapshot returned 200 without intervention |

## Implemented First Slice and Acceptance

The first slice is: **prepare an existing eligible Codex-planning Action as one idempotent, packet-bound Decision and stop before execution.** It creates a user-visible Review item with exact context and an existing Approve/Reject/Defer flow, without schema or service changes.

Verified automated acceptance criteria:

1. One eligible fixture Action creates one planned `codex_planning` step.
2. The operation creates exactly one `packet_created` invocation, packet Artifact, critique Artifact, and open planning Decision.
3. Decision links include the original Action, Project, plan, invocation, packet Artifact, SHA-256, expected Artifact, approval scope, and safety boundaries.
4. The original Action—not a copy—becomes open/Needs Mark with a review Next Action.
5. Before approval, SQLite has exactly one Action, one plan, one invocation, one Decision, three Artifacts, and zero Runs; final output says Codex has not been invoked.
6. Repeating preparation returns the same identities and row counts.
7. Completed, blocked, missing Project/repository/expected Artifact, and pending/running cases fail with precise reasons.
8. Existing request-driven, phase-3, CLI-response, packet-gating, and recovery tests remain green.

Manual acceptance criteria:

1. Run `pnpm arcadia work plan <ACTION_ID>` for an eligible Action in the configured workspace.
2. Open <http://127.0.0.1:3020/review> and verify the original scenario, expected Artifact, repository boundary, packet, and approval controls.
3. Confirm Runs has no new entry and the packet final-output placeholder says Codex has not been invoked.
4. Approval must create exactly one queued Run; completion and acceptance must expose Artifacts, Validation, and Log and mark that original Action done.

## Highest-Leverage Next Slice

Add a deterministic read-only Daily Advantage selector plus one Today card. Eligibility should use existing Action state: open, active Project/Milestone, Codex/work queue, expected Artifact present, repository configured, unblocked, and no active preparation or Run. Ordering and tie-breakers must be explicit; “why now” must be derived from stored evidence, not invented priority. The card should call the existing preparation operation only after the user clicks Prepare.

This is the smallest remaining user-visible slice because it removes the need to discover and copy an Action ID while reusing every preparation and downstream component now in place.

Acceptance for that next slice:

- The same SQLite snapshot always selects the same one eligible Action.
- Ineligible/underway Actions are excluded with testable reasons.
- The Today card names the Action, Project, Milestone, expected Artifact, and concise evidence-based rationale.
- Loading Today is read-only; clicking Prepare creates/reuses the one Decision and refreshes Review state.
- Automated snapshot/route tests and one manual browser pass verify the behavior.

## Verification Results

All verification was local and used disposable workspaces/fake executors. No real Codex execution, credentials, publishing, deployment, spending, external messaging, or destructive Rebuster change occurred.

| Command | Result |
| --- | --- |
| `pnpm vitest run tests/daily-advantage-loop.test.ts` | 5/5 passed |
| `pnpm vitest run tests/decision-gated-planning.test.ts tests/phase3.test.ts tests/cli-response.test.ts` | 96/96 passed |
| `pnpm test` | 400 passed, 2 skipped; zero failures |
| `pnpm test:e2e` | 8/8 passed |
| `pnpm build` | Passed |
| `pnpm dashboard:build` | Passed; 14 static pages generated and all dynamic/API routes compiled |
| Runtime checks | Managed Node-25 restart passed; four services loaded with `RunAtLoad` and `KeepAlive`; Today root and `/api/snapshot` returned 200 |

## Risks, Assumptions, and Explicit Non-Goals

Risks and assumptions:

- Selection quality requires explicit rules; creation time alone is not business value.
- Idempotency intentionally reuses one valid open/deferred packet Decision. Changed/missing packet evidence fails closed rather than silently regenerating.
- A managed Run is only as available as the local worker, but preparation itself does not depend on Codex execution.
- The current installation requires Node 25.6.1 for the installed `better-sqlite3` ABI. A managed restart inherited Node 24 and failed closed; the documented fallback now pins the verified Node path.
- Historical workspace data includes old Actions/Decisions and is not cleaned by this slice.

Explicit non-goals:

- Running Codex against Rebuster, fixing the layout bug, or generating media.
- Implementing the selector, Today card, or later milestones in this slice.
- Publishing, deployment, credentials, spending, external messaging, merging, or destructive changes.
- A generic agent framework, graph model, plugin, microservice, scheduler, or second state store.
- Replacing SQLite operational truth or Markdown reports and Logs.
- Broad terminology, schema, dashboard, worker, or execution-engine refactoring.
