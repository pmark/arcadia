# Daily-Use Mission Control Loop Audit

Date: 2026-06-27

Current Milestone: establish a verified baseline for Arcadia's daily-use Mission Control loop.

Next Action: make Codex planning packets first-class, Decision-gated Runs.

Responsibility: Codex.

Required Artifacts:

- `docs/mission-control/daily-use-loop-audit.md`
- `docs/mission-control/daily-use-loop-test-plan.md`

## Executive Verdict

True end-to-end coverage does not exist for the daily-use loop from a phone-facing capture through interpretation, a persisted Decision, approval, managed execution, Validation, Artifact and Log recording, and final Mission Control visibility.

Arcadia has credible pieces of that loop:

- Dashboard and file/Discord adapters delegate to the CLI rather than maintaining independent state.
- `ask` persists requests, resolves Projects deterministically, creates Actions and plans, and safely preserves vague input.
- The Action-plan runner records failed Runs truthfully, writes a Log, creates Validation evidence, blocks the Action, and surfaces it in Attention.
- The dashboard reads SQLite through a generated snapshot and can act on actual `review_items` Decisions.
- A CLI subprocess test strongly covers the lower-level deterministic `capture → work plan → work run → run show` path.

The canonical Pinterest planning path still breaks at the approval boundary. The exact request creates a Codex planning packet and an Action, but no persisted Decision. Mission Control labels the packet as awaiting review while rendering "Approve & Run" as a command string, not an executable control. The displayed command invokes `codex exec` directly, outside Arcadia's managed Run, Validation, Artifact-linking, and Log path.

The most important trust gap is therefore:

> Arcadia can prepare and display a planning packet, but it cannot currently record the operator's approval and carry that same packet through a managed, validated, durable planning Run from Mission Control.

The second critical trust issue is in the separate Decision-triggered worker path: `src/commands/worker.ts` marks a Run `completed` after `executeApprovedReview` returns even when the executor exit status or configured Validation commands failed. The failure remains visible only inside a follow-up Decision and execution metadata.

### Baseline status by confidence

| Status | Current behavior |
| --- | --- |
| Implemented and verified | CLI structured deterministic execution; ambiguous Back Burner preservation; Project/Milestone routing; planning packet generation; Action-plan Validation failure; failure Log and Attention snapshot; Decision defer/recovery |
| Implemented but untested at its real boundary | Long-lived worker claim/execute/finalize loop; rendered dashboard approval-to-Run navigation; real Discord interaction and notification polling; orphaned Run recovery |
| Partially implemented | Canonical planning workflow, safe report ingress, final planning Artifact linkage, Run detail evidence, approval-gate enforcement |
| Missing | Persisted Decision for a Codex planning packet; browser E2E suite; explicit failed-Run retry operation; CI execution |
| Contradictory or unclear | Two execution engines have different terminal-state, Artifact, and Log rules; dashboard documentation says it cannot start Runs while `/review` offers Approve & Execute; Attention calls raw provider command text "Approve & Run" |

## Terminology Used In This Audit

This report follows `docs/arcadia-semantics.md`:

- Action is the user-facing concept implemented as `work_items`.
- Decision is the user-facing concept implemented as `review_items`.
- Responsibility is the user-facing property implemented as `work_classification`.
- Log is the user-facing concept implemented as `mission_logs`.
- Run is a concrete execution attempt implemented as `execution_runs`.
- "Requires Review" is retained when naming the current dashboard view, CLI label, or compatibility value.
- "Requires Review" is the canonical Responsibility value for human work. The current schema still stores `requires_review` and legacy `requires_review`.

The request's "Needs Review" value is not a current canonical Responsibility. Exact implementation names remain in code-path and persistence descriptions where changing them would obscure the evidence.

## Audit Method And Verification

The audit treated executable code, SQLite behavior, and tests as authoritative over older documentation.

Evidence gathered:

- Read the CLI registrations, command handlers, Intake and stewardship resolvers, repositories, schema, both execution engines, Markdown writers, dashboard snapshot/UI/API routes, Discord adapter, file ingress, and relevant tests.
- Exercised all requested inputs in disposable workspaces.
- Used temporary Git repositories and local fixture state only.
- Did not invoke Codex, use credentials, publish, deploy, spend money, or contact an external service.
- Verified the dashboard through its real Next.js server at desktop and 390-pixel phone viewport sizes.
- Verified generated file serving through `/api/file/[...path]`.

Automated verification:

```text
pnpm test
18 test files passed
275 tests passed

pnpm vitest run \
  tests/cli-response.test.ts \
  tests/ingress.test.ts \
  tests/dashboard-snapshot.test.ts \
  tests/discord-bot.test.ts \
  tests/planning-artifact-workflow.test.ts \
  tests/stewardship-quality.integration.test.ts
6 test files passed
132 tests passed

pnpm build
passed

pnpm dashboard:build
passed; 13 pages generated and all API routes compiled
```

No `.github/workflows` files or other CI configuration were found. Passing locally is not currently enforced on pushes or pull requests.

## Actual Implementation Map

### Ingress surfaces

| Surface | Actual path | Persistence boundary | Current limitation |
| --- | --- | --- | --- |
| Mission Control `/` | `apps/dashboard/app/page.tsx` → `POST /api/ask` | CLI `ask` writes the workspace SQLite database | Shows only the result summary before refreshing; no detailed interpretation confirmation |
| Dashboard `/capture` | `apps/dashboard/app/capture/page.tsx` → `POST /api/ask` | Same as Mission Control | Duplicates the home capture behavior; feedback is supported but approval is not |
| Dashboard API | `apps/dashboard/app/api/ask/route.ts` → `apps/dashboard/lib/arcadia-cli.ts#runAsk` | Spawns `tsx src/cli.ts ask ... --json` | No idempotency key; retries create duplicate requests |
| CLI natural-language ingress | `src/cli.ts` command `ask` → `src/commands/ask.ts#runAskCommand` | `ask_requests`, and conditionally Actions, Decisions, plans, packets, Artifacts, or Back Burner items | Exact natural language coverage is pattern-based |
| CLI structured capture | `src/cli.ts` command `capture` → `src/commands/capture.ts#runCaptureCommand` | Creates an Action and optional expected Artifact | Does not perform Intake project resolution or stewardship |
| File drop | `src/commands/ingress.ts#runIngressProcessCommand` | Calls `runAskCommand`, moves the file, writes a sidecar, and writes an additional Log | The processor must be run manually or scheduled outside Arcadia |
| Discord request | `apps/discord-bot/src/commands/request.ts` → `apps/discord-bot/src/arcadia/cli.ts#ask` | Spawns CLI `ask`; records submission correlation in JSON | Tests mock Discord and often mock the CLI boundary; no real Discord E2E |
| Discord reply/Decision commands | `apps/discord-bot/src/events/*` and `src/commands/review.ts` | Operates on `review_items` | Cannot approve a Codex packet that has no Decision |

`/api/ask` is the real current HTTP ingress. There is no independent local API server and no hidden dashboard state store.

### Interpretation and routing

The shared path is:

```text
normalizeAskInput
  → buildIntakeContext from SQLite
  → resolveIntake
  → resolveIntent registry fallback
  → stewardIntent
  → one of:
      direct status/project action
      Back Burner capture
      Decision creation
      Action + plan + packet creation
```

Relevant files:

- `src/intake/normalization.ts`
- `src/intake/index.ts`
- `src/intent/resolver.ts`
- `src/stewardship/index.ts`
- `src/commands/ask.ts`
- `config/defaults/intent-registry.json`

Project resolution uses names, aliases, recent activity, and active Milestones loaded from SQLite. Confidence and ambiguity are properties of the deterministic Intake result. No model is called for interpretation.

### Persistent state

| Canonical concept | SQLite implementation | Created or updated by the daily loop |
| --- | --- | --- |
| Project | `projects`, `project_metadata` | Read for routing and executor configuration; Project lifecycle status is not changed by a Run |
| Outcome | `projects.goal` compatibility field | Read into packets and dashboard views |
| Milestone | `milestones` | Attached to a routed Action when resolution succeeds |
| Action | `work_items` | Created by `ask`, `capture`, imports, or Back Burner promotion; queue, Responsibility, status, and Next Action change after Runs |
| Decision | `review_items` | Created for clarification, unsafe work, missing repository configuration, Validation failure, and executor follow-up |
| Plan | `execution_plans`, `execution_plan_steps` | Created for Actions |
| Approval boundary | `approval_gates` | Created for some resolved intents; the Action-plan runner does not evaluate gate status |
| Run | `execution_runs`, `execution_run_steps` | Created synchronously by `executePlan` or queued for the review worker |
| Artifact | `artifacts`, `run_artifacts` | Expected, packet, critique, Validation, specification, publication, and review-execution records |
| Log | `mission_logs` | Written for Action-plan Runs, file ingress, manual Logs, and observed Codex completion |
| Request | `ask_requests` | Stores raw request, resolved intent, stewardship JSON, and links to an Action/plan |
| Codex packet | `codex_invocations` plus files under `prompts/codex/` | Stores prompt, output, final-message, metadata, and critique paths |
| Incubating capture | `back_burner_items` | Stores vague or exploratory input without inventing an Action |

SQLite is operationally authoritative. Markdown and JSON files are durable evidence, but several generated files are not represented by complete Artifact links.

### Two separate execution systems

| Property | Action-plan runner | Decision-triggered worker |
| --- | --- | --- |
| Entry | `arcadia work run <action-id>` | `arcadia review approve <decision-id> --execute`, then `arcadia worker start` |
| Core code | `src/execution/runner.ts#executePlan` | `src/execution/reviewExecutor.ts#executeApprovedReview` and `src/commands/worker.ts` |
| Run creation | Synchronous, after steps execute | Queued as `pending_execution`, then claimed by worker |
| Codex configuration | `config/coding-agent-profiles.json` | Built-in or `.arcadia` executor adapters |
| Approval mechanism | CLI `--allow-codex-planning` or `--allow-codex-build`; no persisted Decision required | A `review_items` Decision |
| Validation | Planning-artifact validator; deterministic skill failures | Project metadata commands run after executor |
| Failed Validation status | Run becomes `requires_review` for bad planning content; `failed` if Validation cannot run | Worker still sets Run `completed`; follow-up Decision contains failures |
| Final output Artifact | Final file path is stored on `codex_invocations`, but no final planning Artifact row is created | A `review_execution` Artifact points to metadata |
| Run Artifact links | Validation Artifact linked through `run_artifacts` | Review-execution Artifact is not attached through `run_artifacts` |
| Log | Created and attached to Run | No Log created or attached |
| Recovery | Another `work run` is possible but undocumented as retry | Worker requeues orphaned `running` Runs; no explicit failed-Run retry command |

The canonical planning packet is created for the Action-plan runner, but Mission Control displays the raw `codex exec` packet command when `codex_invocations.plan_step_id` is null. That command bypasses both execution systems.

## What The Operator Experiences

Today the operator can enter the Pinterest request from a phone in Mission Control. Arcadia confirms "Action created," associates it with Rebuster, and shows a detailed planning packet under Attention. The packet can be opened while it exists.

The next step is not a real Arcadia approval. "Approve & Run" is displayed as terminal text containing a `codex exec` command. There is no Decision to approve, no approval record, and no button that starts Arcadia's managed planning runner. If the operator copies the displayed command, Arcadia does not create a Run, invoke its planning validator, attach the final plan as an Artifact, or write a Log.

An operator who already knows the internal CLI can instead run:

```sh
arcadia work run <action-id> --plan <plan-id> --allow-codex-planning
```

That path does create a Run, Validation evidence, a Log, and correct blocked/review state. Mission Control does not expose this managed command for the canonical packet and does not record a Decision before it.

Vague input is safer: it is preserved in Back Burner and remains visible. A safe report request is less usable: the exact natural-language wording requested in this audit is also sent to Back Burner, even though the lower-level `capture` command can recognize and run it deterministically.

Failures in the Action-plan runner are visible in Attention and the Runs list. The current `/runs/[id]` detail page is optimized for worker Runs and omits the Action-plan Run's Log, Validation Artifact, and failure reason, even though the Runs list shows them.

## Canonical Scenario Walkthrough

Input:

> Prepare a plan for adding Pinterest publishing to Rebuster.

Fixture: an active Rebuster Project with a current Milestone, alias, repository path, Outcome, and `pnpm test` Validation command.

### 1. Capture

| Field | Observed behavior |
| --- | --- |
| User action | Enter the request in Mission Control and press Ask. |
| Entry surface | `/` or `/capture`; both call `POST /api/ask`. |
| Relevant code path | `apps/dashboard/app/page.tsx` → `apps/dashboard/app/api/ask/route.ts` → `apps/dashboard/lib/arcadia-cli.ts#runAsk` → CLI `ask` → `runAskCommand`. |
| Persistent state | Creates one `work_items` Action, one expected `artifacts` row with no path, one plan and step, one `codex_invocations` row, packet and critique Artifact rows, and one `ask_requests` row. |
| User-visible result | Immediate message: `Action created.` After snapshot refresh: `Codex planning packet awaiting review.` |
| Approval boundary | None persisted. `reviewItemId` and `decisionId` are `null`. |
| Responsibility | Codex. |
| Artifact or Log | Packet, metadata, placeholder final output, output JSONL, and critique files are written. No Log. |
| Failure behavior | API/CLI errors are shown as "Ask failed"; duplicate submission is not deduplicated. |
| Existing automated coverage | CLI and command-level ask tests cover related planning requests, not this dashboard submission through a browser. |
| Coverage confidence | Partially Covered. |

### 2. Interpretation and Project resolution

| Field | Observed behavior |
| --- | --- |
| User action | None; interpretation is synchronous during capture. |
| Entry surface | Shared `ask` command. |
| Relevant code path | `resolveIntake` → `stewardIntent` → `resolvedIntentFromIntake`. |
| Persistent state | Stewardship JSON is stored on `ask_requests`; Project, Milestone, Responsibility, expected Artifact, and Next Action are stored on the Action. |
| User-visible result | Mission Control shows Rebuster, its Milestone and Outcome, target repository, expected Artifact, and packet paths. |
| Approval boundary | The stewardship result is `Plan First`, `planningRecommended: true`, `reviewRequired: false`. |
| Responsibility | Codex. |
| Artifact or Log | The generated packet is a drafted Artifact and the deterministic stewardship critique is ready. |
| Failure behavior | Missing repository metadata creates a Decision and moves the Action to Requires Review. |
| Existing automated coverage | `tests/phase3.test.ts` and `tests/stewardship-quality.integration.test.ts` cover Rebuster routing and planning packet context. |
| Coverage confidence | Partially Covered. |

The interpretation is not clean. The exact probe produced:

```text
Proposed action: Pinterest a plan for Rebuster.
Expected Artifact: Pinterest a plan plan for Rebuster with ordered phases, ...
Generated goal: Create a practical plan for Pinterest a plan for Rebuster ...
```

Project resolution is correct, but the plan subject extraction is malformed.

### 3. Review

| Field | Observed behavior |
| --- | --- |
| User action | Open Attention or the Requires Review page. |
| Entry surface | `/` Attention; `/review`; CLI `review`. |
| Relevant code path | `src/dashboard/snapshot.ts#listPendingCodexPackets` synthesizes an Attention item. `/review` reads only actionable `review_items`. |
| Persistent state | No Decision is created for this packet. |
| User-visible result | Attention says the packet awaits review and links packet/final/Validation paths. `/review` does not contain this packet. |
| Approval boundary | Informational only. The packet's Markdown contains safety boundaries, but there is no Decision record. |
| Responsibility | Codex remains stored on the Action, even though the next operation requires the operator. |
| Artifact or Log | Packet and critique are inspectable Artifacts. |
| Failure behavior | If a packet file disappears, Attention can continue to link the now-missing path; `/api/file` correctly returns 404. |
| Existing automated coverage | Snapshot tests assert the synthesized card and its labels. No browser test verifies the mismatch between Attention and `/review`. |
| Coverage confidence | Not Covered end to end. |

### 4. Approval

| Field | Observed behavior |
| --- | --- |
| User action | Attempt to use "Approve & Run." |
| Entry surface | Mission Control Attention. |
| Relevant code path | `src/dashboard/snapshot.ts#buildAttentionItems` creates an action whose `command` is rendered by `AttentionCard` as `<code>`. |
| Persistent state | None. No Decision status, approval gate status, invocation status, or Run changes. |
| User-visible result | A raw command must be copied manually. It is not a button. |
| Approval boundary | Not durable or auditable. |
| Responsibility | Effectively Requires Review, but stored Responsibility remains Codex. |
| Artifact or Log | None created by approval because approval does not exist. |
| Failure behavior | Operator command errors occur outside Arcadia if the displayed raw command is used. |
| Existing automated coverage | Snapshot tests assert that the label "Approve & Run" exists, but do not assert that it is actionable or persisted. |
| Coverage confidence | Not Covered. |

The displayed command is:

```text
codex exec --json --sandbox read-only --cd <repo> --output-last-message <workspace>/prompts/.../final.md -
```

It bypasses Arcadia's Run and Validation path.

### 5. Execution dispatch

| Field | Observed behavior |
| --- | --- |
| User action | Manually discover and run `arcadia work run <action-id> --plan <plan-id> --allow-codex-planning`. |
| Entry surface | CLI only for this packet. |
| Relevant code path | `src/commands/work.ts#runWorkRunCommand` → `src/execution/runner.ts#executePlan` → `executeCodexStep`. |
| Persistent state | Creates `execution_runs`, Run steps, and links completed invocations to the Run. |
| User-visible result | CLI shows Run status and Log. Dashboard shows the Run after refresh. |
| Approval boundary | The allow flag is treated as authorization; pending `approval_gates` are not evaluated and no Decision is required. |
| Responsibility | Codex during execution; becomes Requires Review on Validation review or Blocked on failure. |
| Artifact or Log | Output JSONL/final file are written; later steps create Validation evidence and a Log. |
| Failure behavior | Spawn errors and missing packets become failed Run steps. |
| Existing automated coverage | Fake-agent integration tests cover this internal command path. No real dashboard approval-to-dispatch test exists. |
| Coverage confidence | Partially Covered. |

The separate `review approve --execute` worker cannot execute the canonical packet as such. It creates a different implementation packet from a Decision and uses a different executor configuration.

### 6. Validation

| Field | Observed behavior |
| --- | --- |
| User action | None; Validation follows a managed planning Run. |
| Entry surface | Action-plan runner. |
| Relevant code path | `recordPlanningArtifactValidation` and `validatePlanningArtifact` in `src/execution/runner.ts` and `src/stewardship/artifactValidator.ts`. |
| Persistent state | Creates a `planning_artifact_validation` Artifact and links it through `run_artifacts`. Validation failure also creates a Decision. |
| User-visible result | Run output and Attention show pass, warning, failure, or not-run summary. |
| Approval boundary | Failed planning quality becomes Requires Review. |
| Responsibility | Requires Review for failed content; Blocked when Validation cannot run. |
| Artifact or Log | `planning-validation.json` is durable and served through `/api/file`. |
| Failure behavior | Missing packet produced a `failed` Run, a drafted not-run Validation Artifact, and blocked Action. |
| Existing automated coverage | `tests/planning-artifact-workflow.test.ts` covers pass, warning, quality failure, and not-run cases with fake executors or a deleted packet. |
| Coverage confidence | Partially Covered because ingress and approval are bypassed. |

### 7. Artifact and Log recording

| Field | Observed behavior |
| --- | --- |
| User action | Inspect generated evidence. |
| Entry surface | Dashboard Artifacts, Runs, `/api/file`, CLI `artifact list`, `run show`. |
| Relevant code path | `createPlanningValidationArtifact`, `createRunMissionLog`, `attachMissionLogToExecutionRun`. |
| Persistent state | Validation Artifact and Log are linked to the Run. The final plan file is not created as an Artifact row; the original expected Artifact remains planned with no path. |
| User-visible result | The dashboard can infer a final file path from `codex_invocations`, but the Run's produced Artifacts contain only Validation evidence. |
| Approval boundary | No final-plan acceptance Decision is created after successful Validation. |
| Responsibility | A completed Run marks the Action done even though no operator accepted the plan. |
| Artifact or Log | Log is written under `mission_logs/YYYY/MM/`; final plan remains only a file path on the invocation. |
| Failure behavior | Failure Log is retained and the Validation sidecar is linked. |
| Existing automated coverage | Tests assert Log and Validation linkage but do not require the final plan itself to be a linked Artifact. |
| Coverage confidence | Partially Covered. |

### 8. Attention and project-state visibility

| Field | Observed behavior |
| --- | --- |
| User action | Return to Mission Control or Runs. |
| Entry surface | `/`, `/runs`, `/runs/[id]`, CLI `attention`, `status`, `run show`. |
| Relevant code path | `src/dashboard/snapshot.ts` and dashboard pages/components. |
| Persistent state | The Action is marked `done`, `requires_review`, or `blocked`; Project lifecycle status remains unchanged. |
| User-visible result | Missing-packet failure appeared as both a failed Run and blocked Action with an explicit Next Action. `/runs` showed failure, Log, Artifact, and reason. |
| Approval boundary | Failed planning quality can create a Decision; missing-packet failure does not. |
| Responsibility | Blocked for the controlled failure. |
| Artifact or Log | Attention linked the Validation Artifact; `/runs` listed the Log. |
| Failure behavior | `/runs/[id]` omitted the Action-plan failure reason, Log, and Artifact even though `/runs` showed them. No retry control was present. |
| Existing automated coverage | Snapshot mapping is tested directly; page rendering and navigation are not automated. |
| Coverage confidence | Partially Covered. |

At a 390×844 viewport, the Mission Control page had a 436-pixel document width. Long paths and command text therefore caused horizontal overflow on the phone-sized surface.

## Supporting Scenario Findings

### Scenario A: ambiguous capture

Input:

> Maybe we should do something with Pinterest for Rebuster.

Observed result:

| Property | Result |
| --- | --- |
| Interpretation | `CaptureThought`, classification `Idea`, low confidence |
| Project | Not resolved, despite the name Rebuster appearing |
| Stewardship | `Back Burner Idea → Back Burner` |
| Persistence | `ask_requests` plus `back_burner_items`; no Action, plan, Decision, Run, or Artifact |
| Execution | None |
| Visibility | Back Burner dashboard and CLI list; item can be promoted or archived |
| Recovery | Durable and recoverable |
| Assessment | Implemented and substantially verified |

This satisfies the core safety requirement: Arcadia does not invent a concrete Action.

### Scenario B: safe deterministic report

Input:

> Generate this week's Arcadia project status report.

Observed through `ask --run-safe`:

| Property | Result |
| --- | --- |
| Interpretation | `CaptureThought`, `IncubatingThought`, low confidence |
| Stewardship | Back Burner |
| Persistence | Back Burner item only |
| Execution | None |
| Assessment | The requested daily-use behavior is missing |

Observed through the lower-level structured path:

```sh
arcadia capture --project <arcadia-id> \
  --text "Generate this week's Arcadia project status report." \
  --expected-artifact "Weekly Arcadia project status report"
arcadia work plan <action-id>
arcadia work run <action-id>
```

| Property | Result |
| --- | --- |
| Recognition | `generate_status_report` |
| Responsibility | Autonomous |
| Run | Completed |
| Generated file | `reports/status.md` |
| Log | Written and attached |
| Artifact state | Expected Artifact remained `planned` with no path; the report was not attached through `run_artifacts` |
| Codex | Not invoked |
| Assessment | Deterministic capability exists, but the natural-language ingress and Artifact provenance are incomplete |

### Scenario C: execution failure

Controlled failure: delete the generated Codex packet in a disposable workspace, then invoke the managed planning Run.

Observed result:

| Property | Result |
| --- | --- |
| Run | `failed` |
| Step | `failed` with exact missing-packet diagnostic |
| Action | `blocked`, Responsibility Blocked, Next Action `Review the failed run.` |
| Validation | `planning-validation.json`, status `not_run`, attached to Run |
| Log | Written and attached to Run |
| Attention | Failed Run plus blocked Action; required Next Action visible |
| Partial evidence | Retained and served with HTTP 200 |
| Retry | No explicit retry command or dashboard control |
| Assessment | The Action-plan runner handles this failure safely; recovery UX is incomplete |

Separate worker-path risk:

- `executeApprovedReview` returns normally for a non-zero executor exit and failed Validation commands.
- `src/commands/worker.ts` computes `validationPassed` for summary text, then unconditionally calls `updateExecutionRunStatus(..., "completed", ...)`.
- A follow-up Decision is created, but the Run itself can be falsely terminal-successful.

## Existing Test Realism

No existing test covers the complete daily-use acceptance path. The strongest current test is a CLI-only deterministic slice.

| Existing test | Classification | Why |
| --- | --- | --- |
| `tests/cli-response.test.ts` — captures, plans, runs, and shows deterministic execution work | Strong end-to-end coverage | Uses real CLI subprocesses, workspace, SQLite, report file, Log, Run list, and user-visible JSON. It starts at structured `capture`, not phone/`ask`, and has no Decision. |
| `tests/cli-response.test.ts` — emits JSON success for Back Burner capture and keeps review empty | Strong end-to-end coverage | Uses the real CLI `ask`, SQLite, Back Burner list, and Decision list for a close variant of Scenario A. It does not render the dashboard. |
| `tests/cli-response.test.ts` — asks natural language intent with JSON output | Partial integration coverage | Uses the real CLI and persistence, but stops at Decision creation. |
| `tests/cli-response.test.ts` — pauses captured ambiguous work as Requires Review | Misleading coverage | The name suggests ambiguous natural-language routing, but it uses structured `capture` and a different input than Scenario A. |
| `tests/cli-response.test.ts` — emits JSON success for dashboard snapshots | Partial integration coverage | Exercises the CLI snapshot boundary but asserts only envelope/count shape, not rendered state. |
| `tests/cli-response.test.ts` — queues an execution run when review is approved with `--execute` | Partial integration coverage | Covers real CLI queue creation, not worker pickup or terminal result. The test omits `--execute`, relying on Commander's current default. |
| `tests/cli-response.test.ts` — worker executes a queued run with built-in Codex adapter | Misleading coverage | Calls `executeApprovedReview` directly. It does not start the worker, claim the queued Run, or verify the stored Run status. |
| `tests/cli-response.test.ts` — leaves an actionable execution review when approval explicitly skips execution | Partial integration coverage | Real CLI and Decision persistence, but no execution or final visibility. |
| `tests/cli-response.test.ts` — refuses execution when project repo path is invalid | Partial integration coverage | Real CLI failure envelope; no dashboard or recoverable Attention assertion. |
| `tests/ingress.test.ts` — ingests a request through ask, moves it to Done, writes a sidecar, and records a mission log | Partial integration coverage | Uses the real ingress handler and real `ask`, filesystem, SQLite, and Log, but bypasses the CLI process and stops at Decision creation. |
| `tests/ingress.test.ts` — moves failed requests to Failed with a readable error sidecar and mission log | Unit-only confidence | Injects an `askRunner` that throws; it does not exercise a production failure. |
| `tests/phase3.test.ts` — routes the Golden Request Suite through ask | Partial integration coverage | Real Intake/stewardship command path and SQLite, but no public ingress process or downstream execution. |
| `tests/phase3.test.ts` — preserves low-confidence input in Back Burner instead of invoking Codex | Partial integration coverage | Meaningful command-level safety assertion; no adapter or rendered recovery check. |
| `tests/phase3.test.ts` — approves a Requires Review item by replaying the intended ask workflow | Partial integration coverage | Covers Decision-to-Action replay directly; no managed Run. |
| `tests/phase3.test.ts` — resolves Requires Review replies by option letter and slug | Partial integration coverage | Covers shared Decision parsing and persistence directly, not a real adapter reply or execution. |
| `tests/phase3.test.ts` — routes context-backed review replies through ask | Partial integration coverage | Verifies adapter metadata reaches the shared command path; no HTTP/Discord boundary. |
| `tests/phase3.test.ts` — supports every decision command for every shown Requires Review item shape | Partial integration coverage | Verifies command behavior against SQLite, not UI or execution. |
| `tests/phase3.test.ts` — resolves a daily-driver Rebuster planning ask to the project repository root | Partial integration coverage | Closest packet-routing coverage, but it uses `runAskCommand` directly and asserts no Decision or execution. |
| `tests/phase3.test.ts` — runs an explicitly approved Codex build step through a configured fake agent | Partial integration coverage | Covers fake process execution in the Action-plan runner, but bypasses real ingress and Decision approval. |
| `tests/stewardship-quality.integration.test.ts` — planning packet fixtures | Partial integration coverage | Strong packet and interpretation assertions; calls command functions directly and does not execute the canonical packet. |
| `tests/planning-artifact-workflow.test.ts` — passing planning Artifact | Partial integration coverage | Fake agent plus real runner, files, SQLite, and Validation; begins after packet/plan setup. |
| `tests/planning-artifact-workflow.test.ts` — failed planning Validation | Partial integration coverage | Meaningful failure assertions, Decision creation, and Action queue state; no real ingress or user-visible page. |
| `tests/planning-artifact-workflow.test.ts` — missing packet reports Validation not run | Partial integration coverage | Real controlled failure in the runner; does not assert final Attention or run-detail UI. |
| `tests/planning-artifact-validator.test.ts` — validator fixture family | Unit-only confidence | Protects planning content rules without any Run, persistence, or user-visible state. |
| `tests/stewardship-critic.test.ts` and `tests/stewardship-quality.unit.test.ts` — stewardship fixture families | Unit-only confidence | Protect deterministic packet/interpretation quality only. |
| `tests/dashboard-snapshot.test.ts` — builds a read-only dashboard snapshot | Partial integration coverage | Uses real SQLite mapping but seeds rows directly and never renders the UI. It asserts an "Approve & Run" label without proving an actionable approval. |
| `tests/dashboard-snapshot.test.ts` — surfaces missing repository path | Partial integration coverage | Uses real `ask` and snapshot builder, but no HTTP/browser interaction. |
| `tests/dashboard-snapshot.test.ts` — project update route | Partial integration coverage | Calls the route handler directly; it is meaningful route/persistence coverage, not a daily-loop E2E. |
| `tests/discord-bot.test.ts` — mocked `/arcadia request` interaction | Unit-only confidence | Uses a fake Arcadia CLI process response. |
| `tests/discord-bot.test.ts` — can run deterministic safe steps from Discord | Unit-only confidence | The CLI response is mocked, so no deterministic Run occurs. |
| `tests/discord-bot.test.ts` — shows one Run with Log, Artifacts, and review reason | Unit-only confidence | Formatter input is a fixture; it does not read a real Run. |
| `tests/discord-bot.test.ts` — Discord bot end-to-end fixture | Misleading coverage | Uses the real CLI adapter for ask, but approves through an internal function, does not execute the packet, and evaluates notification functions directly. |
| `tests/discord-bot.test.ts` — notifications | Unit-only confidence | Tests pure notification evaluation with fixture snapshots, not polling against a live daily loop. |

## End-to-End Coverage Matrix

| Daily-use step | Current implementation path | Existing test file(s) | Test level | Covered behavior | Missing behavior | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Capture ingestion | Dashboard `/` or `/capture` → `/api/ask` → CLI `ask`; CLI/file/Discord adapters | `cli-response`, `ingress`, `discord-bot` | End-to-end | Real CLI structured capture and file handler | No browser-to-CLI E2E; Discord is mocked | Partially Covered |
| 2. Request persistence | `createAskRequest`; Back Burner, Action, or Decision branch | `phase3`, `ingress`, `ask-feedback` | Integration | `ask_requests` and links are asserted | No single test follows the same request to terminal state | Partially Covered |
| 3. Intent interpretation | Intake, intent registry, stewardship | `intake`, `phase3`, `stewardship-quality.*` | Integration | Many deterministic phrases and packet fields | Exact safe-report input fails; canonical subject is malformed | Partially Covered |
| 4. Project resolution | `buildIntakeContext`, alias/fuzzy/recent-context matching | `intake`, `phase3`, `stewardship-quality.*` | Integration | Rebuster and Milestone resolution | No browser assertion; vague Scenario A does not retain Project association | Partially Covered |
| 5. Confidence / ambiguity handling | stewardship Back Burner or Decision branches | `cli-response`, `intake`, `phase3` | Integration | Low-confidence input is retained and not executed | Exact requested phrase is not a full ingress/UI E2E | Partially Covered |
| 6. Decision creation | `createReviewItem` for clarification, unsafe work, setup, Validation | `phase3`, `ingress`, `planning-artifact-workflow` | Integration | Multiple Decision shapes are persisted | Canonical planning packet creates no Decision | Partially Covered |
| 7. Decision display or retrieval | CLI `review`, dashboard snapshot, `/review`, Discord formatter | `dashboard-snapshot`, `discord-bot`, `phase3` | Integration | SQLite-to-view model and formatters | No rendered browser coverage; packet pseudo-review absent from `/review` | Partially Covered |
| 8. Approval | `review approve` replay or queue; packet has only command text | `cli-response`, `phase3` | Integration | Real Decisions can be approved/rejected/deferred | No canonical packet approval record; gate statuses not enforced | Partially Covered |
| 9. Approval-to-execution wiring | Decision queues worker Run; Action runner uses allow flags | `cli-response` | Integration | Queue row and direct executor service are covered separately | No test connects approval, worker claim, terminal status, and UI | Partially Covered |
| 10. Execution dispatch | `executePlan` or worker `claimNextPendingRun` | `planning-artifact-workflow`, `cli-response` | Integration | Fake Action-plan agent and executor service | Worker loop is never exercised; raw packet command bypasses Arcadia | Partially Covered |
| 11. Execution result handling | Runner sets status; worker updates status | `planning-artifact-workflow`, `cli-response` | Integration | Action-plan pass/fail/review states | Worker can mark failed execution/Validation completed | Partially Covered |
| 12. Validation | Planning validator or project Validation commands | `planning-artifact-validator`, `planning-artifact-workflow`, `cli-response` | Integration | Planning pass/fail/warn/not-run; review executor command output | Review worker ignores failed Validation for terminal status | Partially Covered |
| 13. Artifact persistence | `artifacts`, `run_artifacts`, packet/output files | `phase0`, `planning-artifact-workflow`, `blogging-capability` | Integration | Packet, critique, Validation, and some deterministic Artifacts | Final plan and status report are not correctly linked as produced Artifacts | Partially Covered |
| 14. Log persistence | `createRunMissionLog`, ingress Log | `cli-response`, `ingress`, `phase0` | End-to-end | CLI deterministic Run has a real Markdown Log | Review-worker Runs create no Log | Partially Covered |
| 15. Project state update | Action queue/Responsibility/status; Project status unchanged | `planning-artifact-workflow`, `dashboard-snapshot` | Integration | Action done/review/blocked transitions | No agreed Project-level transition; split runners differ | Partially Covered |
| 16. Attention / visible Next Action | `buildDashboardSnapshot`, dashboard pages, CLI `attention` | `dashboard-snapshot`, `discord-bot` | Integration | Snapshot items and notifications | No automated rendered UI; run detail loses old-run evidence | Partially Covered |
| 17. Failure handling | Runner failure, invalid repo rejection, ingress sidecar, worker catch | `planning-artifact-workflow`, `cli-response`, `ingress` | Integration | Controlled Action-plan failure is safe | No non-zero worker E2E; false-completion path unprotected | Partially Covered |
| 18. Retry or recovery | Repeat commands; worker orphan requeue | None found | None found | Worker source can requeue orphaned running Runs | No explicit retry contract, command, UI, or test for failed Runs | Not Covered |

## Daily-Use UX Friction and Trust Risks

| Severity | Finding | Evidence | User impact | Exact affected path | Smallest plausible correction | Work type |
| --- | --- | --- | --- | --- | --- | --- |
| Critical | Canonical planning packet has no persisted Decision or actionable approval | Exact probe returned `decisionId: null`; Attention renders raw command text | Operator cannot prove approval or continue safely without CLI reconstruction | `src/commands/ask.ts`, `src/dashboard/snapshot.ts`, `apps/dashboard/components/dashboard-ui.tsx` | Create one packet-execution Decision and wire its approval to the managed planning runner | Backend, UX, test |
| Critical | Review worker can falsely mark failed execution complete | Worker unconditionally sets `completed` after executor returns; Validation result only changes summary text | Mission Control can report success when executor or Validation failed | `src/commands/worker.ts`, `src/execution/reviewExecutor.ts` | Derive terminal Run status from exit and every Validation result; test non-zero and failed checks | Backend, test |
| High | Raw displayed `codex exec` bypasses Arcadia | Packet Attention uses `codex_invocations.command` when `plan_step_id` is null | No managed Run, Validation, Log, or durable result if copied | `src/dashboard/snapshot.ts#buildAttentionItems` | Expose only an Arcadia approval/run operation, never the provider command as primary action | Backend, UX |
| High | Exact safe-report request routes to Back Burner | `ask --run-safe` produced `CaptureThought`; structured `capture` recognized `generate_status_report` | Operator must know lower-level commands for obvious safe work | `src/intake/index.ts`, intent registry, `src/execution/skills.ts` | Route the exact report phrasing to the existing deterministic skill | Backend, test |
| High | Final planning output is not a linked Artifact | Run Artifact list contains Validation only; expected Artifact stays planned/pathless | Operator cannot reliably find or accept the actual plan | `src/execution/runner.ts#executeCodexStep` | Create/update a final planning Artifact and attach it to the Run and Action | Backend, test |
| High | Review-worker Runs have no Log or `run_artifacts` link | `executeApprovedReview` creates an Artifact, worker never attaches it or a Log | Execution provenance differs by hidden internal path | `src/execution/reviewExecutor.ts`, `src/commands/worker.ts` | Attach execution Artifact and create one Run Log before terminal update | Backend, test |
| High | Approval gates are records, not enforced state | `executePlan` does not read `approval_gates`; allow flags are sufficient | Database can show pending gates after work ran | `src/execution/runner.ts`, `src/commands/work.ts` | Require a resolved Decision/gate set before protected steps | Backend, test |
| Medium | Canonical interpretation text is malformed | Exact output contains `Pinterest a plan plan` | Review evidence looks unreliable even when Project routing is correct | `src/intake/index.ts`, `src/commands/ask.ts` artifact-subject helpers | Add a golden fixture for "Prepare a plan for adding..." and correct subject extraction | Backend, test |
| Medium | `/runs/[id]` omits Action-plan failure evidence | Manual browser check showed only status/summary; `/runs` showed reason, Log, Artifact | Detail view is less informative than list view at the moment of failure | `apps/dashboard/app/runs/[id]/page.tsx`, `/api/runs/[id]` | Render Run steps, Log, Artifacts, and failure/review reason for both Run types | UX, backend, test |
| Medium | Failed Runs have no explicit retry/recovery operation | No CLI/dashboard retry command or tested contract | Operator must infer whether repeating `work run` is safe | Commands, runner, dashboard | Define one idempotent retry operation or explicit create-new-attempt action | Backend, UX, test, documentation |
| Medium | Phone-sized Mission Control horizontally overflows | At 390px viewport, document and main widths were 436px | Long commands/paths force horizontal scrolling on a phone | `apps/dashboard/components/dashboard-ui.tsx` | Constrain/break long code and path fields within cards | UX, browser test |
| Medium | Safe report file is not recorded as produced Artifact | `generate_status_report` returns `artifact: null` | Visible output lacks durable linkage and provenance | `src/execution/runner.ts#executeDeterministicStep` | Create/update and attach a status-report Artifact | Backend, test |
| Medium | Dashboard documentation contradicts behavior | README says dashboard does not start Runs; `/review` has Approve & Execute | Operator cannot know which approval path is authoritative | `apps/dashboard/README.md`, review UI | Update docs after the execution path is made coherent | Documentation |
| Low | Home and `/capture` duplicate capture with different feedback treatment | Two pages call the same route with different result presentation | Inconsistent confirmation and follow-up affordances | `apps/dashboard/app/page.tsx`, `apps/dashboard/app/capture/page.tsx` | Choose one canonical capture presentation in a later UX mission | UX |
| High | No browser E2E suite or CI execution | Vitest is Node-only; no workflow files found | Regressions across HTTP, child process, worker, and rendered UI can merge unnoticed | Test configuration and repository automation | Add the minimum suite in the next mission and run it in CI | Test, CI |

## Recommended Next Mission

### Mission

**Make Codex planning packets first-class, Decision-gated Runs.**

### Outcome statement

The exact request "Prepare a plan for adding Pinterest publishing to Rebuster." creates a reviewable Decision; the operator can inspect the interpretation, packet, expected Artifact, and safety boundaries in Mission Control; approval starts Arcadia's existing managed planning runner; Validation determines the truthful Run state; and the final plan, Validation evidence, Log, and remaining Decision are linked and visible.

### Why this is the highest-leverage gap

This closes the first hard break in the canonical daily-use path while reusing the existing packet builder, Action-plan runner, planning validator, SQLite records, `/api/file` endpoint, and dashboard Attention model. It removes the need to copy a provider command and creates a single auditable boundary before any Codex invocation.

It also creates the seam needed to protect the rest of the loop with one real browser/process E2E test.

### Explicit non-goals

- Do not implement Pinterest publishing.
- Do not run Codex implementation mode.
- Do not publish, deploy, merge, use credentials, access production data, spend money, or send messages.
- Do not introduce a new agent framework, service, queue product, or autonomous scheduler.
- Do not redesign unrelated dashboard pages.
- Do not migrate legacy database naming.
- Do not unify all executor types in this mission.

### Acceptance criteria

1. The exact canonical request resolves to Rebuster with a clean planning subject and expected Artifact.
2. Packet creation also creates one open Decision linked to the Action, plan, Project, packet Artifact, and safety boundaries.
3. The Action's user-facing Responsibility is Requires Review while that Decision is open.
4. Mission Control and `/review` show the same Decision and evidence.
5. Approval is persisted before execution and cannot be bypassed by a dashboard provider-command link.
6. Approval dispatches the existing Action-plan runner with a configured fake/local planning executor in tests.
7. A passed planning Artifact creates a final ready Artifact, links it to the Run and Action, writes and attaches a Log, and leaves a final plan-acceptance Decision.
8. Failed or unavailable Validation cannot produce a completed Run or ready Artifact.
9. Failed execution sets the Action Blocked or Requires Review with an explicit Next Action and retained diagnostic Artifact.
10. Attention and `/runs/[id]` show the same truthful state, Log, Artifacts, and recovery action.

### Proposed Artifacts

- Implementation changes for the Decision-gated planning Run.
- `tests/e2e/mission-control.spec.ts`.
- Focused worker/runner and dashboard integration tests.
- Playwright configuration and deterministic fixture/fake-executor utilities.
- CI workflow running unit/integration tests, builds, and the new E2E suite.
- Updated adapter/dashboard documentation for the authoritative approval path.

### Required automated tests

Implement first:

1. Canonical dashboard capture-to-validated-plan.
2. Approval cannot be bypassed.
3. Validation failure cannot be marked complete.
4. Final planning Artifact and Log are linked to the Action and Run.
5. Failed or review-required Run appears accurately in Attention and Run detail.

Also retain regression tests for ambiguous Back Burner capture and safe Autonomous reporting.

### Manual validation

1. Start a disposable workspace and dashboard with a seeded Rebuster Project.
2. Enter the exact canonical request from a phone-sized viewport.
3. Inspect the Decision, packet, target Project/Milestone, expected Artifact, and boundaries.
4. Approve using Mission Control with a fake local planning executor.
5. Observe queued/running/final state without invoking an external service.
6. Open the final plan, Validation evidence, Log, Run detail, and remaining Decision.
7. Repeat with failing Validation and verify that no surface says completed or ready.
8. Confirm no horizontal overflow at the supported phone breakpoint.

### Definition of done

The mission is done when the canonical browser-level E2E test passes in CI, every state transition is persisted in SQLite, the final plan and Validation evidence are durable Artifacts, the Run has a Log, approval is auditable and cannot be bypassed through Mission Control, and failure produces one truthful, recoverable Attention path.
