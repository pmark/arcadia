# Decision-Gated Codex Planning Runs

Date: 2026-06-27

Current Milestone: make the daily-use planning path reliable from capture through validated Artifact.

Next Action: implement the test-first vertical slice defined in this plan, beginning with the canonical browser test and the planning authorization policy.

Responsibility: Codex.

Required Artifact: `docs/mission-control/decision-gated-planning-run-plan.md`

## Mission

Make Codex planning packets first-class, Decision-gated Runs.

The canonical acceptance request is:

> Prepare a plan for adding Pinterest publishing to Rebuster.

This plan is implementation-ready. Names such as `work_items`, `review_items`, `execution_plans`, `execution_runs`, `codex_invocations`, and `mission_logs` are retained below only as compatibility names for the existing schema and APIs. User-facing behavior uses Action, Decision, Run, Artifact, Log, Responsibility, and Validation.

## Decision Summary

Implement one protected planning path:

```text
Mission Control / ask
  -> Action + plan + immutable packet Artifact + packet invocation
  -> open planning approval Decision
  -> atomic Decision approval + pending Run
  -> existing worker claims Run
  -> Action-plan runner executes the approved packet
  -> deterministic planning Validation
  -> final planning Artifact + Validation Artifact + Log
  -> completed Run + final acceptance Decision
     OR requires-review/failed Run + explicit recovery
```

The initial planning Decision is the only authority to create the first planning Run. `--allow-codex-planning` remains accepted for CLI compatibility but ceases to be an authorization token. The runner itself verifies the persisted Decision, exact plan, exact packet invocation, packet Artifact, packet digest, and Run before starting a provider process.

The worker remains the queue consumer. For a planning approval Decision it dispatches the existing Action-plan runner, not `executeApprovedReview`. The generic review executor remains available for legacy review execution and receives only the terminal-status, Artifact-linking, and Log corrections required by the trust contract.

No provider command is returned as a user action. Provider commands remain diagnostic metadata inside `codex_invocations`.

## 1. Confirmed Current State And Breakpoints

### Current authoritative flow

| Stage | Current implementation | Confirmed behavior |
| --- | --- | --- |
| Capture | Dashboard `POST /api/ask` -> CLI `ask` -> `runAskCommand` | Creates the Rebuster Action, active Milestone link, plan, expected Artifact row, packet files, packet/critique Artifacts, invocation, and ask request. |
| Interpretation | Intake -> intent registry fallback -> stewardship | Resolves Rebuster and its Milestone, but the exact canonical wording can produce malformed `Pinterest a plan plan` text. |
| Initial Decision | `runAskCommand` | Creates no Decision for a normal `Plan First` result. Decisions are currently created only for clarification, unsafe/setup conditions, and failed planning Validation. |
| Attention | `buildDashboardSnapshot` | Synthesizes a packet card from `codex_invocations`; the card is not backed by a Decision and is absent from `/review`. |
| Approval | packet Attention action | Renders raw `codex exec` or `arcadia work run ... --allow-codex-planning` text. It records no approval. |
| Managed planning execution | `runWorkRunCommand` -> `executePlan` | The allow flag is sufficient; pending approval gates and Decisions are not checked. |
| Planning Validation | `validatePlanningArtifact` via `executeCodexStep` | Correctly distinguishes passed, failed, and not-run Validation. Failed content produces a Decision and a `requires_review` Run. |
| Final plan | invocation `final_message_path` | The file exists, but no final `planning_artifact` row is attached to the Run. The expected Artifact remains planned and pathless. |
| Log | Action-plan runner | Writes and attaches a Log for completed, requires-review, and failed Runs. |
| Generic review worker | `claimNextPendingRun` -> `executeApprovedReview` | Unconditionally marks the Run completed after a normal return, even for non-zero executor exit or failed Validation. It does not attach the execution Artifact or create a Log. |
| Retry | none | Repeating a command can overwrite invocation outputs or create an untracked attempt. There is no explicit retry contract. |
| Run detail | CLI `run show` and `/runs/[id]` | The repository returns Action-plan steps, Artifacts, and Log, but the page is shaped around review-worker output and omits important Action-plan evidence and recovery actions. |
| Phone layout | dashboard cards | Long provider commands and paths produce horizontal overflow at 390 pixels. |
| Safe status report | deterministic skill exists | The exact natural-language request routes to Back Burner; the lower-level structured path can execute it, but the report is not linked as a produced Artifact. |

### Exact trust breakpoints

1. `resolvedIntentForStewardship` creates a Codex planning plan with `approvalGates: []` and `workClassification: "codex"`.
2. The normal packet branch in `runAskCommand` creates no `review_items` row and returns `decisionId: null`.
3. `listPendingCodexPackets` turns every `packet_created` invocation into a pseudo-review card and exposes `codex_invocations.command`.
4. `runWorkRunCommand` passes booleans into `executePlan`; `executePlan` does not require a persisted Decision.
5. `executePlan` creates the Run only after execution, so it cannot represent approval, queued, and running states for the same attempt.
6. `executeCodexStep` creates only the Validation Artifact. It never creates or updates a final planning Artifact.
7. `executeCodexStep` throws on non-zero process exit after writing output files, leaving those diagnostics outside `run_artifacts`.
8. The worker marks every non-throwing generic executor result completed without considering `exitStatus` or Validation results.
9. `createReviewExecutionRun` does not atomically decide the Decision, so repeated approval requests can queue duplicate Runs.
10. Existing schemas have no direct Decision-to-packet/invocation link and no Run retry lineage.

## 2. Chosen Architecture

### 2.1 Decision types

Use existing `review_items.resolved_intent` as the compatibility discriminator. Do not add a new top-level Decision model or status enum.

| Internal `resolved_intent` value | User-facing purpose | Approval behavior |
| --- | --- | --- |
| `CodexPlanningRunApproval` | Approve the exact packet and plan for one planning attempt | Atomically approve and queue one Run. |
| `CodexPlanningArtifactAcceptance` | Accept a validated final plan | Mark the final Artifact ready and complete the Action; never invoke an executor. |
| `CodexPlanningRetryApproval` | Approve a new attempt after a failed or requires-review Run | Clone a new invocation/output location and queue a new Run linked to the prior Run. |
| `codex_planning_artifact_validation` | Existing failed-content recovery Decision | Retain as a compatibility alias; route it to revise/retry recovery, never generic implementation execution. |

All other Decision shapes preserve their current handlers.

### 2.2 Packet identity and approval scope

At packet creation:

- Create the prompt packet Artifact and `codex_invocations` row as today.
- Compute SHA-256 from the exact packet bytes after the file is closed.
- Create the ask request.
- Create one open `CodexPlanningRunApproval` Decision in the same database transaction as the invocation, packet Artifact, critique Artifact, and ask request.
- Link the Decision directly to the ask request, Action, plan, Project, packet Artifact, and packet invocation.
- Store this normalized context in `context_json`:

```json
{
  "schemaVersion": 1,
  "packetSha256": "<lowercase hex>",
  "interpretation": "Prepare a Pinterest publishing plan for Rebuster.",
  "expectedArtifact": "Pinterest publishing plan for Rebuster with ordered phases, risks/open questions, approval requirements, and recommended next action.",
  "safetyBoundaries": [
    "No publishing",
    "No deployment",
    "No credential use",
    "No spending",
    "No messaging",
    "No merging",
    "No destructive actions"
  ],
  "responsibility": "needs_mark"
}
```

Approval authorizes only the linked plan and the exact packet digest. It does not authorize a regenerated packet, a different plan, build execution, publication, credentials, or any other approval gate.

If the packet file is missing or its digest differs at approval time, approval returns a stable conflict and leaves the Decision open. If it changes after queueing, the worker terminates the Run as failed without starting the provider, records not-run Validation, writes a Log, blocks the Action, and exposes a regenerate/review recovery action.

### 2.3 Atomic approval and duplicate handling

Add `queueApprovedPlanningRun(db, input)` as the single transaction used by CLI and dashboard approval:

1. Load the Decision by ID or slug.
2. Require `CodexPlanningRunApproval` or `CodexPlanningRetryApproval`.
3. Require complete and mutually consistent Action, plan, Project, packet Artifact, and invocation links.
4. Verify the plan belongs to the Action, the invocation belongs to the same Action/plan, the packet Artifact path equals the invocation prompt path, and the packet digest matches.
5. Conditionally change `open` or `deferred` to `approved`.
6. Create one `pending_execution` Run with one pending Run step for the protected plan step.
7. Link the Run to the approving Decision; for retry, also link it to the prior Run.
8. Update the Action to `in_progress`, queue `work_queue`, Responsibility Codex, and Next Action `Wait for the approved planning Run, then review its Validation and Artifact.`
9. Commit, then return the Run ID.

Duplicate policy:

- Repeating approval for an approved planning Decision returns HTTP/CLI success with the existing Run ID and does not create or invoke anything.
- Concurrent approval is protected by the transaction and a partial unique index on `execution_runs.review_item_id`.
- Rejected Decisions return conflict and never queue.
- Deferred Decisions may be approved.
- `--no-execute` records approval without a Run. A later approval with execution, or protected `work run`, queues the one permitted Run.

### 2.4 Runner-level authorization

Introduce a pure `authorizePlanningRun` policy plus a repository-backed wrapper. The Action-plan runner must call it immediately before changing the invocation to running or spawning the provider.

Authorization requires:

- a planning plan step;
- a `running` Run linked to the same Action and plan;
- a linked approved planning or retry Decision;
- the Decision linked to the same packet Artifact and invocation;
- matching packet path and SHA-256;
- invocation status `packet_created`;
- no other Run linked to that attempt invocation;
- repository path present and valid;
- every approval gate applicable to the planning step approved or resolved.

Any missing condition refuses process execution. The check lives in the execution layer, not only in `work.ts`, `review.ts`, the worker, or the dashboard route.

Compatibility behavior:

- `work run` for deterministic plans remains synchronous.
- `work run ... --allow-codex-planning` remains a valid command-line shape, but the flag means “dispatch an already approved planning plan.” It is never sufficient authorization.
- For an approved planning Decision with no Run, `work run` calls `queueApprovedPlanningRun` and returns the pending Run.
- For an already queued or terminal Run, it returns the existing Run idempotently.
- Without a matching approved Decision, it exits non-zero with `Planning execution requires an approved Decision for this Action, plan, and packet.` No Run or Log is created because execution did not begin.
- `--allow-codex-build` and existing generic Decision execution remain outside this vertical slice, except that they cannot reuse a planning Decision.

### 2.5 Worker dispatch and Run ownership

Extract one testable `runWorkerIteration` and one `executeClaimedRun` dispatcher.

When `execution_runs.review_item_id` resolves to a planning or retry Decision:

- claim changes the existing Run from `pending_execution` to `running`;
- set its pending Run step to `running`;
- call the Action-plan runner with the existing Run ID, plan ID, Decision ID, and attempt invocation ID;
- the Action-plan runner owns Run-step, plan, invocation, Artifact, Action, and Log finalization;
- the worker logs the result but does not overwrite the returned terminal status.

For legacy generic review execution:

- continue calling `executeApprovedReview`;
- reduce executor and Validation results using the same truthful outcome rules;
- attach its `review_execution` Artifact to the Run;
- write and attach a Log before setting a terminal status;
- never mark completed if the executor failed, timed out, was unavailable, or any configured Validation command was non-zero or unavailable.

The Action-plan runner is the sole owner of planning state transitions. The worker owns only claim, dispatch, orphan recovery, and worker diagnostics.

### 2.6 Truthful outcome reduction

Use one pure reducer for planning outcomes:

| Executor outcome | Planning Validation | Run | Invocation | Action | Final Artifact |
| --- | --- | --- | --- | --- | --- |
| exit 0 | passed, warnings allowed | `completed` | `completed` | Needs Mark, `in_progress` | `drafted`; acceptance Decision open |
| exit 0 | failed content | `requires_review` | `completed` | Needs Mark, `in_progress` | `drafted`; Validation recovery Decision open |
| exit 0 | not run/unavailable | `failed` | `failed` | Blocked | `drafted` only if a file exists |
| non-zero, signal, timeout, spawn error | not run | `failed` | `failed` | Blocked | diagnostic/partial Artifact only if a file exists |

A Run is never completed merely because the provider process returned. Planning Validation is mandatory.

For generic review execution, completed requires executor exit 0 and all configured Validation commands present and exit 0. A non-zero executor result is failed. Missing or failed Validation is `requires_review`, with Needs Mark Responsibility and a follow-up Decision.

### 2.7 Final planning Artifact and acceptance

After any attempt that produced a non-empty final plan file:

- Upsert one `planning_artifact` by Action plus exact path.
- On the first produced attempt, convert the existing pathless `expected_artifact` row into this produced Artifact by extending `updateArtifact` to update title and type as well as path/status. This prevents a completed flow from leaving a duplicate pathless expectation.
- On later retry attempts, create a new drafted `planning_artifact`; never repoint or overwrite an earlier attempt Artifact.
- Attach the attempt's planning Artifact and Validation Artifact through `run_artifacts`.
- Keep the planning Artifact `drafted` until final acceptance.

After passed Validation, create exactly one open `CodexPlanningArtifactAcceptance` Decision linked to the Action, plan, Project, final planning Artifact, packet invocation, and Run ID in context. The completed Run remains completed because execution and Validation succeeded; the Action remains Needs Mark until the operator accepts the plan.

Acceptance outcomes:

- Approve: Artifact -> `ready`; Action -> `done`; Next Action -> `Plan accepted; choose the next implementation Action when ready.`
- Reject: Artifact remains `drafted`; Action remains Needs Mark; Next Action -> `Revise or retry the planning Run.`
- Defer: Artifact remains `drafted`; Action remains Needs Mark; Decision stays actionable as deferred.

Final acceptance never invokes an executor and never changes the historical Run result.

### 2.8 Failure evidence and Log invariant

Before any Run becomes `completed`, `requires_review`, or `failed`:

- persist every available output or diagnostic file as an Artifact;
- attach final/partial plan and Validation Artifacts to the Run;
- create one Log describing executor result, Validation result, blockers, Artifact impact, and exact Next Action;
- attach the Log to `execution_runs.mission_log_id`;
- then persist the terminal Run status.

If normal Log rendering fails, create and attach a minimal emergency Log containing the Run ID, failure, available evidence, and `Retry Log finalization` Next Action, then mark the Run failed. If even the emergency Log cannot be persisted, leave the Run nonterminal with a `finalization_failed` summary and let the worker retry finalization; do not publish any terminal status. A terminal Run without a Log is a test failure and an Attention invariant violation.

### 2.9 Retry and immutable history

Add `arcadia run retry <run-id>` and dashboard `POST /api/run-action` with `{ action: "retry" }`.

The retry request:

- accepts only `failed` or `requires_review` managed planning Runs;
- is idempotent: returns the existing open retry Decision for that Run if present;
- creates no Run and invokes nothing;
- creates a `CodexPlanningRetryApproval` Decision linked to the same Action, plan, Project, packet Artifact, and original packet invocation;
- records `priorRunId`, the original packet digest, failure evidence, and recommended correction in context.

Approving retry:

- creates a new `codex_invocations` attempt row with a new ID and new JSONL/final/Validation paths;
- reuses the approved immutable prompt path and digest;
- creates a new Run with `retry_of_run_id` pointing to the failed Run;
- leaves the original Run, invocation, Artifacts, Validation sidecar, and Log unchanged;
- executes only through the worker and the same authorization policy.

Retry is refused if the packet digest changed, the Action/plan links no longer match, final acceptance already completed the Action, or the source Run is not a recoverable planning Run.

### 2.10 Orphan recovery

Retain PID-based recovery, but make it deterministic and attempt-safe:

- only `running` Runs with a dead PID are candidates;
- if the linked invocation is still `packet_created`, return the same Run to `pending_execution`;
- if invocation status is `running`, do not blindly rerun because the provider may have outlived the worker; mark the Run failed with `orphaned_execution_state`, persist available diagnostics, and require a retry Decision;
- repeated recovery performs no additional mutation;
- never delete or overwrite attempt files.

## 3. Rejected Alternatives

| Alternative | Reason rejected |
| --- | --- |
| Keep the packet card and make its raw command clickable | Still bypasses persisted approval, managed Run state, Validation, Artifact linkage, and Log creation. |
| Treat `--allow-codex-planning` as approval | A process-local flag is not durable, auditable, packet-specific authorization. |
| Send the planning Decision through `executeApprovedReview` | That executor builds a new implementation packet, runs project Validation commands, and has different Artifact/Log semantics. It would not execute the packet the operator reviewed. |
| Execute synchronously inside the dashboard API route | Removes observable queued/running states, ties long execution to HTTP lifetime, and duplicates worker behavior. |
| Add a new agent framework, queue service, or scheduler | Existing worker, SQLite queue, Action plan, packet builder, and validator are sufficient. |
| Unify every executor into one engine | Too broad. Only planning dispatch uses the Action-plan runner; generic review execution receives narrowly required truth fixes. |
| Store all new links only in `context_json` | Packet and retry identity are authorization data and require indexed foreign-key links. Context remains for immutable evidence and presentation fields. |
| Reuse the same invocation and output paths for retry | Overwrites failed evidence and makes attempt history untrustworthy. |
| Mark the Action done immediately after passed Validation | A valid plan still requires an explicit final acceptance Decision under the acceptance scenario. |
| Add new Run or Decision statuses | Existing `pending_execution`, `running`, `completed`, `requires_review`, `failed`, and Decision statuses express the required lifecycle. |

## 4. Complete State-Transition Contract

`Decision` below means the relevant `review_items` row. `Packet invocation` is the capture-time `codex_invocations` row; retry attempts receive separate invocation rows.

| Event | Action | Initial/retry Decision | Plan / step | Run / step | Invocation | Artifact and Validation | Log |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canonical capture | `open`; queue `needs_mark`; Responsibility Needs Mark; clean Next Action to review Decision | open `CodexPlanningRunApproval` | `planned` / `pending` | none | `packet_created` | expected planned; packet drafted; critique ready/drafted | none |
| Initial Decision deferred | unchanged Needs Mark | `deferred` | unchanged | none | unchanged | unchanged | none |
| Initial Decision rejected | `open`; Needs Mark; Next Action revise or archive | `rejected` | `planned` / `pending` | none | `packet_created` | unchanged | none |
| Approval without execute | unchanged Needs Mark | `approved` | unchanged | none | unchanged | unchanged | none |
| Approval and queue | `in_progress`; queue `work_queue`; Responsibility Codex | `approved` | `planned` / `pending` | `pending_execution` / `pending` | `packet_created` | unchanged | none |
| Worker claim | unchanged Codex | approved | `running` / `running` | `running` / `running` | changes to `running` immediately before spawn | unchanged | none |
| Provider exit 0, Validation passed | `in_progress`; queue `needs_mark`; Responsibility Needs Mark | approved; acceptance Decision open | `completed` / `completed` | `completed` / `completed` | `completed`, linked to Run | final plan drafted; Validation ready; both linked | created and linked before terminal status |
| Final acceptance approved | `done`; accepted Next Action | acceptance Decision `approved` | unchanged completed | unchanged completed | unchanged | final plan `ready` | unchanged |
| Final acceptance rejected/deferred | stays `in_progress`, Needs Mark | `rejected` or `deferred` | unchanged | unchanged completed | unchanged | final plan drafted | unchanged |
| Provider exit 0, Validation failed | `in_progress`; queue `needs_mark`; Responsibility Needs Mark | approval approved; recovery Decision open | `requires_review` / `requires_review` | `requires_review` / `requires_review` | `completed`, linked to Run | final plan drafted; Validation drafted with failure codes | created and linked |
| Provider exit 0, Validation unavailable | `blocked`; queue/Responsibility Blocked | approval approved | `failed` / `failed` | `failed` / `failed` | `failed`, linked to Run | available plan drafted; not-run Validation drafted | created and linked |
| Provider non-zero/spawn failure | `blocked`; queue/Responsibility Blocked | approval approved | `failed` / `failed` | `failed` / `failed` | `failed`, linked to Run | executor diagnostic and non-empty partial output drafted; not-run Validation drafted | created and linked |
| Retry requested | existing failed/review state remains until approval | open `CodexPlanningRetryApproval` | original status retained until new attempt starts | original immutable; no new Run yet | original immutable | original immutable | original immutable |
| Retry approved and queued | `in_progress`; Codex | retry Decision approved | reset plan/target step to `planned`/`pending` for new attempt | new `pending_execution` Run with `retry_of_run_id` | new `packet_created` attempt with new output paths | no new result Artifacts yet | none for new attempt |
| Retry terminal | same outcome matrix as first attempt | retry approved; acceptance/recovery Decision created as applicable | reflects newest attempt; earlier Run remains authoritative for its attempt | new terminal Run; prior Run unchanged | new terminal invocation; prior unchanged | attempt-specific Artifacts | one new linked Log |

Project lifecycle status and Milestone status do not change in this mission. The Action remains linked to the resolved current Milestone throughout.

## 5. Public CLI, API, Dashboard, And Adapter Behavior

### CLI

- `ask` response for the canonical request returns non-null `reviewItemId` and `decisionId`, plus the same Action, plan, packet invocation, and Artifact paths as today.
- Human output says `Decision created` and shows Project, Milestone, interpretation, expected Artifact, safety boundaries, Responsibility Needs Mark, and Decision slug.
- `review show`, `review`, and JSON include packet Artifact and invocation IDs as additive fields.
- `review approve <id>` retains its current default-to-execute behavior. Planning Decisions queue the Action-plan Run; generic Decisions retain current dispatch.
- `review approve <id> --no-execute` records approval only.
- `work run ... --allow-codex-planning` is retained but cannot bypass Decision approval and queues rather than directly spawning protected planning work.
- `run show` includes both Run engines' steps, Artifacts, Log, failure/review reason, approving Decision, final acceptance/recovery Decision, invocation ID, and retry lineage.
- Add `run retry <id>`; it creates or returns a retry Decision, not a Run.
- Keep legacy JSON field names. Add canonical aliases only where the existing response already follows that compatibility pattern.

### Dashboard APIs

- Keep `POST /api/ask`, `POST /api/review-action`, `GET /api/snapshot`, `GET /api/runs/[id]`, and `/api/file/[...path]`.
- `POST /api/review-action` continues to spawn the CLI. Planning approval returns the queued Run ID and the page navigates to `/runs/[id]`.
- Add `POST /api/run-action` only for retry creation. It calls `arcadia run retry <id> --json`.
- No dashboard route may call a provider binary or `executePlan` directly.
- Duplicate approval returns the existing Run ID with 200. Invalid state or digest mismatch returns 409. Missing identifiers return 400/404 consistently.

### Mission Control and `/review`

- Build packet approval cards from actual actionable Decisions, not standalone `packet_created` invocations.
- Suppress the synthetic packet Attention item whenever a linked planning Decision exists.
- For legacy orphan packets without Decisions, show `Regenerate packet to create an approval Decision`; never show a provider command.
- Attention and `/review` use one normalized Decision view model and show identical:
  - interpretation;
  - Project, Outcome, and Milestone;
  - expected Artifact;
  - packet link;
  - safety boundaries;
  - Responsibility;
  - Decision status;
  - Next Action.
- Initial action labels are `View Packet`, `Approve & Run`, `Reject`, and `Defer`.
- Final action labels are `View Plan`, `View Validation`, `View Log`, `Accept Plan`, `Reject`, and `Defer`.
- Failed/requires-review Run actions are `View Run`, evidence links, and `Request Retry` or `Revise`.
- Remove command rendering from planning Attention. `DashboardAttentionAction.kind = "command"` remains for unrelated compatibility cards but cannot contain provider commands.

### Run detail and 390-pixel layout

- Normalize Action-plan and review-worker Runs in the API before rendering.
- Always display status, summary, approving Decision, steps, failure/review reason, invocation, final/partial Artifacts, Validation evidence, Log, retry lineage, follow-up Decision, Responsibility, and Next Action when available.
- Links use `/runs/[id]` and `/api/file`; do not display a CLI command where navigation is possible.
- Apply `min-w-0` at every grid/flex ancestor containing paths, `max-w-full` to code/pre blocks, and `overflow-wrap:anywhere` or `break-all` to paths and IDs.
- Horizontally scrolling regions are allowed only for executor log contents, never for the document body. At a 390-pixel viewport assert `document.documentElement.scrollWidth <= window.innerWidth`.

### File ingress and Discord

- Continue delegating to `runAskCommand`; neither adapter gets independent approval state.
- Return/format the same Decision slug and linked packet evidence produced by `ask`.
- Adapter approval routes through `review approve`; no adapter may invoke a provider directly.
- Existing sidecars and correlation records receive additive Decision/Run IDs.

## 6. Schema And Migration

An additive migration is required.

### `review_items`

Add:

```sql
artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL
codex_invocation_id TEXT REFERENCES codex_invocations(id) ON DELETE SET NULL
```

Add indexes on both columns. Extend `CreateReviewItemInput`, row mapping, select SQL, and packet JSON with nullable compatibility fields.

Use `artifact_id` for the packet Artifact on approval/retry Decisions and the final plan Artifact on acceptance Decisions. Use `codex_invocation_id` for the exact approved packet/attempt identity.

### `execution_runs`

Add:

```sql
retry_of_run_id TEXT REFERENCES execution_runs(id) ON DELETE SET NULL
```

Add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_runs_review_item_id_unique
ON execution_runs(review_item_id)
WHERE review_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_execution_runs_retry_of_run_id
ON execution_runs(retry_of_run_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_artifacts_run_artifact_unique
ON run_artifacts(run_id, artifact_id);
```

Before creating the unique indexes, migration code must detect duplicate non-null `review_item_id` values and duplicate Run/Artifact pairs. Preserve the earliest Run Decision link and earliest Run/Artifact link, set later duplicate Run Decision links to null, delete only duplicate join rows, and write migration diagnostics to stderr; do not delete Runs or Artifacts.

### No other schema changes

- Do not rename legacy tables or columns.
- Do not add statuses.
- Do not add a packet table; packet Artifact plus invocation is the first-class packet identity.
- Do not persist provider command as approval data.
- Keep SHA-256 and presentation evidence in versioned Decision `context_json`; the foreign keys provide identity and the digest protects packet bytes.

Existing `packet_created` planning invocations without a linked Decision are grandfathered as inspectable legacy records but are not executable. The dashboard and CLI instruct the operator to regenerate the packet, which creates the required Decision. Do not silently manufacture approval or mark a legacy packet approved.

## 7. Test-First Implementation Sequence

Each step is independently verifiable and must land with its tests passing.

### Step 1: Install the real E2E harness and write the eight failing acceptance tests

Files:

- `playwright.config.ts`
- `tests/e2e/mission-control.spec.ts`
- `tests/e2e/fixtures/workspace.ts`
- `tests/e2e/fixtures/fake-planning-executor.cjs`
- `tests/e2e/fixtures/processes.ts`
- `package.json`

Add Playwright as a dev dependency and `test:e2e`. Build a disposable workspace fixture, real temporary Rebuster Git repository, fake local executable, worker child process, and production-built Next.js server. The fake executable supports success, invalid-plan, non-zero, timeout, and partial-output modes selected by environment variable. Write tests in the exact order listed in section 8.

Verification: the tests fail for the documented current breakpoints, never invoke real Codex, and always clean up.

### Step 2: Fix deterministic interpretation and status-report routing

Files:

- `src/intake/index.ts`
- `src/commands/ask.ts`
- `config/defaults/intent-registry.json`
- `src/execution/runner.ts`
- `tests/intake.test.ts`
- `tests/phase3.test.ts`

Normalize `Prepare a plan for adding <subject> to <project>` so the action/purpose is `Pinterest publishing`, not `Pinterest a plan`. Add a deterministic status-report intent for the exact weekly request, mapped to `generate_status_report`. Have dashboard `runAsk` pass `--run-safe`; restrict automatic execution to plans whose steps are all deterministic and safe. Make `generate_status_report` create/update and return a ready produced Artifact.

Verification: parsing and status-report integration tests pass; planning capture creates no Run before approval.

### Step 3: Add schema links and repository invariants

Files:

- `database/schema.sql`
- `src/db/schema.ts`
- `src/domain/types.ts`
- `src/db/repositories.ts`
- `tests/phase0.test.ts`

Add the columns/indexes in section 6, atomic compare-and-set Decision updates, lookup by Decision/invocation, queued plan Run creation with pending steps, unique run-by-Decision lookup, retry lineage, idempotent Run-Artifact linking, and final Artifact upsert/conversion.

Verification: migration from a pre-change fixture, fresh schema, duplicate approval race, Artifact idempotency, and retry lineage repository tests pass.

### Step 4: Create the planning Decision during capture

Files:

- `src/commands/ask.ts`
- `src/codex/packets.ts`
- `src/commands/review.ts`
- `tests/mission-control.integration.test.ts`
- `tests/stewardship-quality.integration.test.ts`

Create the packet, digest, invocation, packet Artifact, critique Artifact, ask request, and linked Decision as one logical operation. If file creation succeeds but the database transaction fails, remove only the newly created packet directory. Set the Action to Needs Mark. Return Decision IDs and consistent evidence.

Verification: exact canonical capture creates one and only one linked Decision and clean wording; missing repo still creates only the setup Decision and no packet.

### Step 5: Add atomic approval and runner authorization

Files:

- `src/commands/review.ts`
- `src/commands/work.ts`
- `src/execution/runner.ts`
- new `src/execution/planningAuthorization.ts`
- `tests/planning-authorization.test.ts`
- `tests/mission-control.integration.test.ts`

Implement `queueApprovedPlanningRun` and the authorization truth table. Route planning approval and protected `work run` through it. Reject missing, stale, mismatched, rejected, modified, or cross-plan approval before process execution.

Verification: no public or direct runner entry can increment the fake executor counter without approved matching Decision; duplicate approval returns one Run.

### Step 6: Make the worker dispatch planning Runs through the Action-plan runner

Files:

- `src/commands/worker.ts`
- `src/execution/runner.ts`
- `src/execution/reviewExecutor.ts`
- `tests/worker-execution.integration.test.ts`

Extract one-iteration worker helpers. Teach the dispatcher to recognize planning Decisions and execute the existing queued Run. Add explicit Run-step updates and outcome reducer. Correct generic review-worker status, Artifact attachment, and Log behavior.

Verification: exit/Validation matrix passes; every terminal Run has a Log; orphan recovery is idempotent.

### Step 7: Persist final and diagnostic Artifacts plus acceptance/recovery Decisions

Files:

- `src/execution/runner.ts`
- `src/db/repositories.ts`
- `src/commands/review.ts`
- `src/commands/run.ts`
- `tests/planning-artifact-workflow.test.ts`
- `tests/worker-execution.integration.test.ts`

Create/attach final, partial, diagnostic, and Validation Artifacts before terminal finalization. Create acceptance Decision on passed Validation and recovery Decision on failed content. Implement final acceptance handlers and `run retry`.

Verification: Artifact/Log linkage, acceptance behavior, immutable retry, and non-zero executor tests pass.

### Step 8: Make Mission Control authoritative and phone-safe

Files:

- `src/dashboard/snapshot.ts`
- `apps/dashboard/lib/types.ts`
- `apps/dashboard/lib/arcadia-cli.ts`
- `apps/dashboard/app/api/review-action/route.ts`
- new `apps/dashboard/app/api/run-action/route.ts`
- `apps/dashboard/components/dashboard-ui.tsx`
- `apps/dashboard/app/review/page.tsx`
- `apps/dashboard/app/runs/[id]/page.tsx`
- `tests/dashboard-snapshot.test.ts`
- `tests/dashboard-routes.integration.test.ts`

Use Decision-backed cards, remove provider commands, normalize Run evidence, add retry and final acceptance actions, suppress duplicate packet/Run/blocked cards, and fix wrapping.

Verification: snapshot/route tests and all browser tests pass at desktop and 390x844.

### Step 9: Preserve adapter parity and update documentation

Files:

- `src/commands/ingress.ts`
- relevant files under `apps/discord-bot`
- `tests/ingress.test.ts`
- `tests/discord-bot.test.ts`
- `apps/dashboard/README.md`

Propagate Decision/Run IDs and shared evidence. Update the README to state that Mission Control queues managed Runs through persisted Decisions.

Verification: file and Discord adapter contract tests pass with no provider invocation outside the worker.

### Step 10: Add CI and run full Validation

Files:

- `.github/workflows/ci.yml`

Run fast and E2E jobs from section 10. Do not merge until local and CI Validation pass.

## 8. Exact Tests, Fixtures, And Observable Behavior

These eight browser/process tests are added first.

### 1. `canonical dashboard capture completes as a Decision-gated validated planning Run`

- Browser submits the exact canonical request on `/` at 390x844.
- Assert clean interpretation, Rebuster, current Milestone, expected Artifact, boundaries, and Needs Mark in Attention and `/review`.
- Assert one linked open Decision and zero Runs/provider invocations before approval.
- Click `Approve & Run`; observe pending/running and then completed.
- Assert approved Decision predates invocation `running`.
- Assert passed Validation, completed Run, drafted final planning Artifact, linked Log, and open final acceptance Decision.
- Accept the plan; assert Artifact ready and Action done.
- Assert plan, Validation, and Log open through `/api/file`.

### 2. `planning approval cannot be bypassed`

- Capture canonical request but do not approve.
- Attempt CLI `work run <action> --plan <plan> --allow-codex-planning`.
- Call the runner authorization wrapper directly in an integration assertion.
- Assert stable refusal, no Run, unchanged invocation, zero fake-executor calls, and no provider command in Attention or `/review`.
- Reject and defer variants also remain non-executable.

### 3. `failed planning Validation cannot be marked complete`

- Fake executor exits 0 and writes a plan missing ordered phases/approval boundaries.
- Approve through the browser.
- Assert Run/step `requires_review`, invocation completed, Action Needs Mark, final Artifact drafted, failed Validation Artifact, open recovery Decision, and linked Log.
- Assert no completed label appears in Attention or Run detail.

### 4. `final planning Artifact and Log are linked`

- Complete the valid canonical Run.
- Query SQLite: final Artifact has Project and Action IDs; final and Validation Artifacts are in `run_artifacts`; Run has `mission_log_id`.
- Open Latest Artifacts, Project detail, Attention, and Run detail.
- Assert the same title/path is discoverable and every file link returns 200.
- Assert no pathless `expected_artifact` remains for the produced result.

### 5. `failed and Needs Mark Runs agree in Attention and Run detail`

- Run two isolated fixtures: invalid plan and non-zero executor.
- Assert invalid plan is Needs Mark/`requires_review`; executor failure is Blocked/`failed`.
- Assert status, reason, evidence, Responsibility, and Next Action match between snapshot, Attention, `/runs`, and `/runs/[id]`.
- Assert one authoritative recovery card per Run and no contradictory duplicates.
- Assert no horizontal document overflow at 390 pixels.

### 6. `ambiguous Pinterest input remains recoverable in Back Burner`

- Submit `Maybe we should do something with Pinterest for Rebuster.` on `/capture`.
- Assert one ask request and one active Back Burner item.
- Assert no Action, Decision, plan, Run, invocation, provider call, execution Artifact, or Log.
- Assert exact input, confidence/reason, Promote, and Archive are visible.

### 7. `exact status-report request uses Autonomous deterministic execution`

- Submit `Generate this week's Arcadia project status report.` on `/`.
- Assert Autonomous Action and completed deterministic Run; no Decision, approval gate, Codex invocation, or fake-executor call.
- Assert `reports/status.md` exists as a ready Artifact linked to Action, Project, and Run.
- Assert a linked Log and openable report.
- In a missing-output fixture, assert failed Run and Blocked Action rather than completion.

### 8. `non-zero planning executor exit remains failed and recoverable`

- Fake executable writes stderr and non-empty partial final output, then exits 9.
- Approve in the browser and wait for terminal state.
- Assert failed Run/step/invocation, Blocked Action, not-run Validation, diagnostic/partial Artifact, and Log.
- Click `Request Retry`; assert only an open retry Decision is created.
- Approve retry in success mode; assert a new Run and invocation with `retry_of_run_id`, new output paths, and untouched original evidence.

### Supporting integration tests

Add:

- `canonical ask creates one linked planning Decision`
- `planning Decision approval queues only its originating plan`
- `duplicate planning approval returns the existing Run`
- `modified packet digest prevents provider invocation`
- `worker outcome follows executor and Validation matrix`
- `every terminal Run has a Log`
- `planning output creates and attaches a final Artifact idempotently`
- `final acceptance completes the Action without execution`
- `retry creates an immutable linked attempt`
- `status-report skill creates a produced Artifact`
- `dashboard snapshot emits one authoritative recovery item`
- `run detail API normalizes both Run engines`
- `file ingress preserves canonical Decision linkage`
- `Discord request preserves canonical Decision identity`
- `orphaned planning Run recovery is idempotent`

### Unit tests

Add:

- exact `Prepare a plan for adding...` subject extraction;
- exact weekly status-report resolution;
- planning authorization truth table;
- Run outcome reducer matrix;
- final Artifact upsert/idempotency;
- initial/final/retry Decision handler dispatch;
- Attention does not expose provider commands;
- Run detail normalizer for both engines;
- duplicate approval compare-and-set;
- path wrapping component/static guard.

### Deterministic fixture design

Each E2E test gets a unique temporary root containing:

- initialized Arcadia workspace;
- SQLite database created by production initialization;
- Rebuster Project, alias, Outcome, active Milestone, and metadata;
- temporary Git repository as `repo_path`;
- harmless `node -e` Validation command where project Validation is needed;
- fake executable directory prepended to child-process `PATH`;
- invocation counter and mode file inside the fixture root;
- dashboard, worker, and fake-executor log files.

The fake executable:

- is a real child process;
- reads the packet on stdin;
- records PID, cwd, arguments, packet digest, start/end timestamps, and mode;
- writes deterministic JSONL/stdout and final output;
- never reads credentials or the user's home Arcadia workspace;
- never contacts a network service.

Do not mock the CLI, SQLite, filesystem, validator, snapshot, worker, or executor process boundary in the eight E2E tests.

## 9. Failure, Idempotency, And Process Cleanup

### Failure handling

- Packet creation failure rolls back database rows and removes only its new packet directory.
- Database failure after process completion leaves files for diagnostics; finalization retries by invocation/path idempotency.
- Missing packet or digest mismatch never starts the provider.
- Missing final output makes Validation not run and the Run failed.
- Validator exceptions are Validation unavailable and fail the Run.
- Non-zero exit, signal, timeout, or spawn error fails the Run.
- A Log or mandatory Artifact-linking failure prevents completed status.
- Dashboard/API failures do not mutate approval state outside the CLI transaction.

### Idempotency keys

- One planning approval Decision per capture-time packet invocation.
- One initial Run per approval Decision, enforced by index.
- One final acceptance Decision per Run/final Artifact, enforced by repository lookup before insert.
- One retry Decision per recoverable source Run while open/deferred.
- One attempt invocation per approved retry Decision.
- One Run-Artifact link per Run and Artifact, enforced by the `(run_id, artifact_id)` unique index after migration deduplication.
- Final Artifact upsert key is Action plus exact normalized workspace-relative path.
- Log finalization first checks `execution_runs.mission_log_id`.

### Process cleanup

Playwright global setup starts the production dashboard and per-suite worker with explicit workspace and environment. Teardown:

1. sends SIGTERM to worker, dashboard, and any tracked fake executor process group;
2. waits up to five seconds;
3. sends SIGKILL only to still-live fixture-owned PIDs;
4. closes SQLite handles;
5. verifies ports are closed and no fixture PID remains;
6. preserves fixture files only on failure;
7. removes successful fixture roots.

Every test has a 60-second timeout; process polling uses bounded intervals and fails with the current SQLite rows plus dashboard/worker/fake-executor log tails. The E2E job has a 15-minute timeout. Tests must not use blocking waits or depend on wall-clock ordering without polling persisted status.

## 10. Rollout And CI

### Rollout order

1. Land schema migration and read compatibility.
2. Land Decision creation and display while provider execution remains blocked.
3. Land approval queueing, authorization, and worker dispatch together.
4. Land final Artifact/Log/acceptance and retry.
5. Remove packet provider commands from all user-facing surfaces in the same release that enables approval.
6. Enable E2E CI as required, not optional.

There is no feature flag. The secure default after migration is that legacy planning packets without Decisions cannot execute. The recovery is packet regeneration, not implicit approval.

### CI workflow

Add `.github/workflows/ci.yml` with:

```text
fast:
  pnpm install --frozen-lockfile
  pnpm test
  pnpm build
  pnpm dashboard:build

e2e:
  pnpm install --frozen-lockfile
  pnpm exec playwright install --with-deps chromium
  pnpm dashboard:build
  pnpm test:e2e
```

Requirements:

- Node 20 or the repository's newer supported version;
- no real Codex executable or external credentials in E2E environment;
- Chromium only initially;
- Playwright trace, screenshot, video, disposable workspace, SQLite database, dashboard log, worker log, and fake-executor log uploaded only on failure;
- redact environment values and exclude secrets;
- hard test/job timeouts;
- fail on leaked child processes or teardown errors;
- never resolve the user's normal Arcadia workspace.

## 11. Acceptance Criteria

1. The exact canonical request resolves Rebuster and its current Milestone and produces `Pinterest publishing plan for Rebuster...` without malformed wording.
2. Capture creates one persisted open Decision linked by foreign keys to Action, plan, Project, packet Artifact, and packet invocation.
3. Attention and `/review` show the same interpretation, expected Artifact, boundaries, Responsibility, Decision, and actions.
4. No user-facing planning surface presents a provider command as an approval or execution path.
5. Provider execution cannot start without a matching approved persisted Decision and unchanged packet digest.
6. `work run`, dashboard APIs, direct runner calls, duplicate clicks, and adapters cannot bypass or duplicate approval.
7. Approval queues one Run and the worker dispatches it through the Action-plan runner.
8. Completed requires provider success and passed planning Validation. Failed/unavailable Validation cannot complete.
9. Non-zero executor exit, timeout, signal, or spawn error produces a failed Run and Blocked Action.
10. Every terminal Run has a linked Log and all available final/partial/diagnostic and Validation Artifacts.
11. A valid final plan is a real `planning_artifact` linked to Action, Project, and Run and remains drafted until final acceptance.
12. Passed Validation leaves an obvious final acceptance Decision; failure leaves an obvious recovery action.
13. Retry creates a new Decision, invocation, Run, files, Artifacts, and Log linked to but not mutating the failed attempt.
14. Attention and Run detail agree on status, evidence, Responsibility, and Next Action.
15. Exact status-report ingress executes Autonomous and produces a linked report Artifact and Log.
16. Ambiguous Pinterest input remains safely recoverable in Back Burner.
17. Mission Control has no horizontal document overflow at 390 pixels.
18. Existing CLI command shapes, legacy JSON fields, file ingress, Discord delegation, and non-planning executor behavior remain compatible except where unsafe planning execution is deliberately refused.

## 12. Definition Of Done

The Mission is done only when:

- all implementation steps are complete;
- all eight E2E tests pass locally and in CI;
- `pnpm test`, `pnpm build`, and `pnpm dashboard:build` pass;
- no E2E path invokes real Codex or an external service;
- the schema migration succeeds on a pre-change workspace and a fresh workspace;
- the canonical 390x844 browser flow completes from capture through final acceptance;
- approval bypass probes produce zero provider invocations;
- every terminal Run in the acceptance fixtures has a Log;
- failed execution and failed/unavailable Validation never appear completed;
- final and diagnostic Artifacts are openable from Mission Control;
- retry preserves original evidence;
- adapters expose the same authoritative Decision;
- documentation describes Mission Control as a managed Decision-to-Run surface; and
- manual inspection finds no raw provider command on Attention, `/review`, or Run recovery surfaces.
