# Daily-Use Mission Control Loop Test Plan

Date: 2026-06-27

Current Milestone: prove the daily-use Mission Control loop with the smallest reliable automated suite.

Next Action: implement the Decision-gated planning vertical slice and the eight must-have tests below.

Responsibility: Codex.

Required Artifact: an automated suite that proves capture, Decision, approval, managed execution, Validation, Artifact and Log recording, and final Attention state.

## Test Strategy

The existing suite is strong at pure logic and command-level integration. It does not need another large set of direct service tests. The missing confidence comes from process boundaries and state transitions.

The minimum reliable stack is:

```text
Playwright browser
  → real Next.js dashboard
  → real /api routes
  → real Arcadia CLI child process
  → isolated SQLite workspace
  → fake local planning executable
  → real runner and deterministic planning validator
  → real Artifact and Log files
  → refreshed dashboard snapshot
```

### Harness design

- Add `@playwright/test` as a development dependency and a root `test:e2e` script.
- Use one temporary Arcadia workspace per test. Never share SQLite files between workers.
- Use one temporary Git repository per executor scenario.
- Seed Projects through public CLI commands where practical; use a small fixture helper only for data that has no stable public setup command.
- Start the dashboard on an allocated localhost port with `ARCADIA_WORKSPACE` pointing to the temporary workspace.
- Put a fake `codex` executable first on `PATH`. It must:
  - accept stdin;
  - optionally write a configured final message;
  - emit deterministic stdout/stderr;
  - expose its invocation count and arguments;
  - support success, non-zero exit, missing output, and invalid-plan modes.
- Do not mock `/api/ask`, `/api/review-action`, child-process execution, SQLite, filesystem writes, the planning validator, or dashboard snapshot generation in must-have E2E tests.
- Query SQLite only after asserting the user-visible result. Database checks prove durable state but do not replace UI assertions.
- Freeze or pattern-match dates and generated IDs rather than snapshotting them literally.
- Run E2E tests serially initially. Parallelize only after port, process, and cleanup behavior is proven.
- Ensure every spawned dashboard/worker/fake-agent process is terminated in `afterEach`, including after failures.

Likely harness files:

- `playwright.config.ts`
- `tests/e2e/mission-control.spec.ts`
- `tests/e2e/fixtures/arcadia-workspace.ts`
- `tests/e2e/fixtures/fake-planning-agent.ts`
- `tests/e2e/fixtures/processes.ts`
- `package.json`
- `.github/workflows/test.yml`

## 1. Must-Have End-to-End Tests

### Test: canonical planning request completes as a Decision-gated validated Run

| Field | Specification |
| --- | --- |
| Test name | `canonical planning request completes as a Decision-gated validated Run` |
| Scenario | Canonical Pinterest planning scenario |
| Entry surface | Browser, Mission Control `/` |
| Initial fixture state | Initialized workspace; active Rebuster Project; Outcome `Ship Pinterest publishing support.`; active Milestone; alias `Rebuster`; temporary repository; Validation command; fake planning agent configured to produce a validator-compliant plan |
| User action | Enter `Prepare a plan for adding Pinterest publishing to Rebuster.`; inspect the Decision; choose Approve; wait for the Run to finish |
| Expected persisted state | One `ask_requests` record; one linked Action and plan; one initial open Decision; approved Decision before Run starts; one planning Run; completed invocation; Action moved to Needs Mark with a final plan-acceptance Decision |
| Expected Artifact/Log state | Packet and critique Artifacts; final planning Artifact with a real path and `ready` status; passed Validation Artifact; all produced Artifacts linked to the Run/Action/Project; one Log attached to the Run |
| Expected user-visible result | Capture confirms the interpreted Rebuster plan; `/review` and Attention show the same initial Decision and boundaries; Run transitions queued/running/completed; final Attention item links plan, Validation, Log, and final acceptance Decision |
| Expected Responsibility | Codex before execution; Needs Mark after the validated plan is ready for acceptance |
| Expected failure behavior | Any missing packet, executor error, or missing final output fails the test and must not show completed/ready |
| Why this test belongs at this level | Only a real browser, HTTP route, CLI process, executor process, SQLite database, filesystem, and refreshed snapshot prove the daily loop |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, E2E fixture helpers, `playwright.config.ts`, `package.json` |

### Test: ambiguous Pinterest thought remains recoverable in Back Burner

| Field | Specification |
| --- | --- |
| Test name | `ambiguous Pinterest thought remains recoverable in Back Burner` |
| Scenario | Ambiguous capture |
| Entry surface | Browser, `/capture` |
| Initial fixture state | Initialized workspace with an active Rebuster Project |
| User action | Enter `Maybe we should do something with Pinterest for Rebuster.` |
| Expected persisted state | One ask request and one active Back Burner item; no Action, Decision, plan, Run, invocation, or approval gate |
| Expected Artifact/Log state | No execution Artifact or Log required; original input, confidence, reason, and suggested next step retained |
| Expected user-visible result | Capture says the item was preserved; Back Burner shows the exact input and offers Promote/Archive; Attention does not imply execution |
| Expected Responsibility | Needs Mark only if promoted or clarified later; no executable Responsibility assigned at capture |
| Expected failure behavior | Test fails if an Action, Run, packet, or external process is created |
| Why this test belongs at this level | The safety claim depends on real ingress, persistence, and recoverability in the rendered UI |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, workspace fixture |

### Test: safe status report uses Autonomous deterministic execution

| Field | Specification |
| --- | --- |
| Test name | `safe status report uses Autonomous deterministic execution` |
| Scenario | Safe Autonomous report generation |
| Entry surface | Browser, Mission Control `/` |
| Initial fixture state | Initialized Arcadia-profile workspace with representative Project state and no fake agent on the invoked path |
| User action | Enter `Generate this week's Arcadia project status report.` |
| Expected persisted state | One ask request; one Autonomous Action and deterministic plan; one completed Run; no Decision, Codex invocation, or approval gate |
| Expected Artifact/Log state | `reports/status.md` exists; one ready status-report Artifact points to it and is linked to the Action/Run/Project; one Log is attached to the Run |
| Expected user-visible result | Capture identifies Autonomous execution; Run completes; Latest Artifacts links the report; Activity and project Next Action reflect completion |
| Expected Responsibility | Autonomous |
| Expected failure behavior | Missing report output produces a failed Run and Blocked Attention item; it must not silently complete |
| Why this test belongs at this level | It proves that natural-language ingress actually reaches the existing deterministic path without an unnecessary Codex process |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, fake-agent invocation monitor, report fixture data |

### Test: failed planning executor remains failed and recoverable

| Field | Specification |
| --- | --- |
| Test name | `failed planning executor remains failed and recoverable` |
| Scenario | Execution failure |
| Entry surface | Browser capture and Decision approval |
| Initial fixture state | Canonical Rebuster fixture; fake planning executor exits with status 9 after writing diagnostic stderr and a partial output file |
| User action | Submit canonical request and approve its execution Decision |
| Expected persisted state | Approved Decision; one failed Run; failed invocation; Action status/queue Blocked; no completed state; explicit recovery Next Action |
| Expected Artifact/Log state | Prompt, executor output/diagnostic, partial output if present, Validation-not-run evidence, and failed Run Log retained and linked |
| Expected user-visible result | Run detail and Attention show Failed, the diagnostic, Artifact links, Log, and a concrete retry/revise action |
| Expected Responsibility | Blocked |
| Expected failure behavior | This is the asserted behavior; any `completed` Run or `ready` final Artifact fails the test |
| Why this test belongs at this level | The current worker false-completion risk exists across executor result, persistence, and UI boundaries |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, fake planning agent fixture, process cleanup helper |

### Test: planning Run cannot start before approval

| Field | Specification |
| --- | --- |
| Test name | `planning Run cannot start before approval` |
| Scenario | Approval cannot be bypassed |
| Entry surface | Browser plus public CLI subprocess attempt |
| Initial fixture state | Canonical request captured; packet and open Decision exist; fake executor invocation counter is zero |
| User action | Observe Mission Control before approval; attempt the public managed Run command without an approved Decision; then refresh |
| Expected persisted state | Decision remains open; no Run or invocation status transition; approval gates remain pending; Action remains Needs Mark |
| Expected Artifact/Log state | Packet/critique only; no final Artifact, Validation result, or Run Log |
| Expected user-visible result | Mission Control offers inspect/approve/reject/defer, never a raw provider command; rejected CLI attempt returns a stable validation error |
| Expected Responsibility | Needs Mark |
| Expected failure behavior | Test fails if the fake executable is invoked, a Run is created, or a provider command is displayed as the primary action |
| Why this test belongs at this level | Bypass protection must be proven at both user-facing and process entry boundaries |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, CLI helper in E2E fixtures |

### Test: failed Validation cannot complete a planning Run

| Field | Specification |
| --- | --- |
| Test name | `failed Validation cannot complete a planning Run` |
| Scenario | Validation failure cannot be marked complete |
| Entry surface | Browser capture and approval |
| Initial fixture state | Canonical fixture; fake agent exits zero but writes a plan missing ordered phases and approval boundaries |
| User action | Approve planning execution and wait for terminal state |
| Expected persisted state | Run is `requires_review`, not `completed`; Action is Needs Mark; one open Validation Decision includes machine-readable failure codes |
| Expected Artifact/Log state | Final plan retained as drafted; failed Validation Artifact linked; Log attached with blocker and next Action |
| Expected user-visible result | Run detail and Attention say Validation failed and link the plan, packet, Validation result, Log, and Decision |
| Expected Responsibility | Needs Mark |
| Expected failure behavior | A completed Run, done Action, or ready final Artifact fails the test |
| Why this test belongs at this level | The trust guarantee depends on validator output controlling terminal state across persistence and UI |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, invalid-plan fake-agent mode |

### Test: final planning Artifact and Log are linked to the relevant Project and Action

| Field | Specification |
| --- | --- |
| Test name | `final planning Artifact and Log are linked to the relevant Project and Action` |
| Scenario | Artifact and provenance linkage |
| Entry surface | Browser after a successful canonical Run |
| Initial fixture state | Completed canonical E2E fixture or a fresh equivalent |
| User action | Open Latest Artifacts, the Run detail, and Project detail |
| Expected persisted state | Final Artifact has Rebuster `project_id` and canonical `work_item_id`; `run_artifacts` links final and Validation Artifacts; `execution_runs.mission_log_id` is non-null |
| Expected Artifact/Log state | Every displayed file exists under the workspace; `/api/file` returns 200 for plan, Validation, and Log-compatible links; no expected Artifact remains pathless for the completed output |
| Expected user-visible result | The same final plan title/path is discoverable from Run, Project, Latest Artifacts, and Attention without copying an ID |
| Expected Responsibility | Needs Mark for final plan acceptance |
| Expected failure behavior | Broken link, mismatched Project/Action, pathless final Artifact, or missing Log fails the test |
| Why this test belongs at this level | Database-only linkage does not prove that the operator can actually find and open the evidence |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, file-link assertions |

### Test: Attention mirrors Needs Mark and Blocked state after failure

| Field | Specification |
| --- | --- |
| Test name | `Attention mirrors Needs Mark and Blocked state after failure` |
| Scenario | Attention accuracy |
| Entry surface | Browser Mission Control and `/runs/[id]` |
| Initial fixture state | Two isolated cases: failed Validation and non-zero executor failure |
| User action | Refresh Mission Control, open each Run, and follow its primary recovery action |
| Expected persisted state | Validation case has a Requires Review Action and open Decision; executor case has a Blocked Action and failed Run |
| Expected Artifact/Log state | Each case links its own diagnostics, final/partial Artifact where present, Validation record, and Log |
| Expected user-visible result | Counts, badges, reason, Next Action, and Run detail agree; no duplicate contradictory Attention cards; phone viewport has no horizontal overflow |
| Expected Responsibility | Needs Mark for Validation failure; Blocked for executor failure |
| Expected failure behavior | Incorrect count, completed label, hidden recovery action, missing evidence, or horizontal overflow fails the test |
| Why this test belongs at this level | Attention is the operator's final daily-use contract and must be checked as rendered behavior |
| Files likely added or changed | `tests/e2e/mission-control.spec.ts`, optional visual/viewport helper |

## 2. Supporting Integration Tests

These tests should use real SQLite and filesystem state. They may call a command or route function directly when the behavior is narrower than a user journey.

| Test name | Scenario and entry surface | Initial fixture state and user action | Expected persisted state | Expected Artifact/Log and visible result | Expected Responsibility / failure behavior | Why this level | Likely files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `canonical ask creates one linked planning Decision` | Command-level `runAskCommand` | Seed Rebuster; submit exact canonical text | Action, plan, packet invocation, and one open Decision share Project/Action/plan IDs | Packet Artifact exists; response exposes Decision ID and clean expected Artifact | Needs Mark; missing repo creates setup Decision without packet | Fast invariant coverage below browser layer | `tests/mission-control.integration.test.ts`, `src/commands/ask.ts` |
| `planning Decision approval queues only the originating plan` | Review command/API | Seed two packets; approve one Decision | Only matching Decision approved and only matching plan gets a Run | No cross-linked Artifacts or Logs; response returns matching Run ID | Codex while running; stale/second approval rejected | Protects identity wiring and duplicate clicks | `tests/mission-control.integration.test.ts`, `src/commands/review.ts` |
| `worker terminal status follows executor and Validation outcomes` | Worker one-iteration helper | Table of exit 0/9 and Validation pass/fail | Completed only for exit 0 plus passed Validation; otherwise review/failed | Execution Artifact and Log attached in every terminal case | Needs Mark or Blocked; never false completed | Directly protects the current critical worker bug without a long-lived process | `tests/worker-execution.integration.test.ts`, `src/commands/worker.ts` |
| `planning output creates and attaches final Artifact` | Action-plan runner | Fake successful plan output | One final Artifact linked through `run_artifacts`; expected Artifact updated or superseded deterministically | File exists and Run summary names it; Log artifact impact names it | Needs Mark after final Decision; missing file fails Run | Precise persistence/provenance protection | `tests/planning-artifact-workflow.test.ts`, `src/execution/runner.ts` |
| `status-report skill creates a produced Artifact` | `runAskCommand` or managed deterministic command | Arcadia fixture; exact report request | Autonomous Action and completed Run; no Codex invocation | `reports/status.md`, ready Artifact, linked Log; response lists path | Autonomous; missing output fails | Protects Scenario B without browser cost | `tests/mission-control.integration.test.ts`, runner/Intake files |
| `dashboard snapshot represents one authoritative recovery item per failed Run` | `buildDashboardSnapshot` | Seed runner failure and worker failure | Read-only; no writes | Attention item links Run, evidence, Log, and Decision where applicable | Needs Mark/Blocked labels match SQLite; no duplicate contradiction | Snapshot mapping is best tested directly | `tests/dashboard-snapshot.test.ts` |
| `run detail API returns evidence for both Run engines` | `GET /api/runs/[id]` route function | One Action-plan Run and one review-worker Run | Read-only | Response includes steps, failure/review reason, Log, Artifacts, and follow-up Decision for both | Stable 404 for missing Run | Ensures the page does not depend on engine-specific fields | `tests/dashboard-routes.integration.test.ts`, API/run command files |
| `file ingress preserves canonical Decision linkage` | `runIngressProcessCommand` | Real input file with canonical request | Ask, Action, Decision, packet, ingress Log, sidecar all linked | File moves to Done; sidecar exposes Decision and Artifact paths | Needs Mark; processing failure moves to Failed with Log | File ingress has extra provenance not covered by browser | `tests/ingress.test.ts` |
| `Discord request preserves canonical Decision identity` | Real `ArcadiaCli` adapter with fake Discord interaction | Seed workspace; submit canonical request | Same Decision ID visible through CLI review | Formatter shows Project, expected Artifact, Decision, boundaries, Next Action | Needs Mark; Discord does not run provider directly | Adapter contract check without external Discord | `tests/discord-bot.test.ts` |
| `orphaned worker Run recovery is idempotent` | Extracted worker recovery helper | Seed running Run with dead PID and another live/claimed Run | Dead Run returns once to `pending_execution`; repeated recovery makes no extra changes | No Artifact/Log loss; worker status reports recovery | Existing Responsibility retained; live Run untouched | Recovery is deterministic repository behavior | `tests/worker-execution.integration.test.ts`, `src/commands/worker.ts` |

## 3. Unit Tests That Protect Important Edge Cases

| Test name | Scenario and entry surface | Initial fixture state and action | Expected persisted state | Expected Artifact/Log and visible result | Expected Responsibility / failure behavior | Why this level | Likely files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `extracts Pinterest publishing subject from prepare-plan phrasing` | Intake/stewardship function | Exact canonical sentence | None | Expected Artifact says `Pinterest publishing plan for Rebuster`; never `Pinterest a plan plan` | Codex/Plan First; no malformed fallback | Pure deterministic parsing | `tests/intake.test.ts`, stewardship fixture files |
| `recognizes weekly Arcadia status report as deterministic` | Intake/intent resolver | Exact Scenario B sentence | None | Resolves status-report output and deterministic skill | Autonomous; no Back Burner or Codex | Pure phrase routing | `tests/intake.test.ts`, `tests/phase3.test.ts` |
| `protected planning step requires approved Decision` | Runner authorization predicate | Pending, approved, rejected, deferred, and missing Decision states | None | Stable reason for refusal | Only approved state permits Codex; every other state blocks | Small policy truth table | New runner-policy unit test |
| `Run outcome reducer never completes on failed Validation` | Worker/runner status reducer | Exit and Validation matrix | None | Deterministic terminal result and summary | Passed→completed; quality failure→Needs Mark; execution failure→Blocked | Removes branching ambiguity from worker loop | New worker-status unit test |
| `final Artifact linking is idempotent` | Artifact helper | Same invocation/result applied twice | One final Artifact and one Run link | Stable path/title/status | No duplicate Artifact on retry | Narrow database invariant | `tests/phase0.test.ts` or new repository test |
| `Attention card does not expose provider command` | Snapshot action builder | Packet with open Decision | None | Primary actions are View/Approve/Reject/Defer; provider command absent | Needs Mark | Pure view-model contract | `tests/dashboard-snapshot.test.ts` |
| `Run detail normalizer supports both execution engines` | API/view-model mapper | Action-plan and worker-shaped fixtures | None | Same evidence fields normalized | Failure/review state preserved | Pure shape compatibility | New dashboard unit test |
| `long paths and commands use wrapping classes` | Component rendering/static assertion | Attention item with long path | None | Card uses `min-w-0`, `break-all`/`overflow-wrap`, no fixed minimum width | No state change | Cheap guard complementing phone E2E | Dashboard component test if a React harness is added |
| `duplicate approval returns the existing result or stable conflict` | Decision transition function | Already approved Decision | No second Run | Existing Run ID or stable conflict response | Responsibility unchanged; no second executor call | Idempotency boundary | `tests/phase3.test.ts` or new review unit test |
| `retry creates a new attempt linked to the prior failed Run` | Retry policy/helper | Failed Run with retained evidence | New Run ID with prior-run reference; original immutable | Original Artifacts/Log retained; new attempt visible | Codex or Needs Mark according to approved retry | Pure retry contract before UI wiring | New retry policy unit/integration test |

## 4. Manual UX Verification Checklist

Run this checklist after all automated tests pass.

### Environment

- [ ] Initialize a disposable workspace.
- [ ] Seed Rebuster with Outcome, active Milestone, alias, temporary repository, and harmless Validation command.
- [ ] Put the fake planning executable first on `PATH`.
- [ ] Start the worker if the chosen implementation uses queued Runs.
- [ ] Start the production-built dashboard, not only `next dev`.
- [ ] Confirm no external network, credentials, or real Codex configuration is available to the fixture.

### Canonical flow

- [ ] At 390×844, submit the exact Pinterest planning request from Mission Control.
- [ ] Confirm the interpretation says Pinterest publishing plan for Rebuster with no malformed repetition.
- [ ] Confirm Project, Outcome, Milestone, target repository, expected Artifact, boundaries, and Responsibility are visible.
- [ ] Confirm the Decision appears identically in Attention and `/review`.
- [ ] Open the packet before approval.
- [ ] Confirm no provider command is presented as an alternative approval path.
- [ ] Approve and observe queued, running, and terminal state.
- [ ] Open executor output while running if available.
- [ ] Open the final plan, Validation result, and Log after completion.
- [ ] Confirm the final acceptance Decision is obvious.
- [ ] Confirm no page horizontally scrolls at the phone viewport.

### Safety and failure

- [ ] Repeat without approval and confirm the executor is never invoked.
- [ ] Reject a Decision and confirm no Run is created.
- [ ] Defer a Decision and confirm it stays visible and can later be approved.
- [ ] Run the invalid-plan fixture and confirm the Run is not completed.
- [ ] Run the non-zero executor fixture and confirm the Run is failed and Action Blocked.
- [ ] Confirm partial output and diagnostics remain openable.
- [ ] Follow the retry/revise action and confirm the original failed attempt remains immutable.
- [ ] Refresh every page during and after a Run to confirm SQLite state, not client memory, drives the display.

### Supporting scenarios

- [ ] Submit the ambiguous Pinterest thought and recover it from Back Burner.
- [ ] Promote it only after adding concrete intent.
- [ ] Submit the exact weekly Arcadia status-report request.
- [ ] Confirm it runs Autonomous and creates no Codex invocation.
- [ ] Open the linked report Artifact and Log.

### Adapter parity

- [ ] Submit the canonical request through one file-drop fixture and compare its Decision ID and evidence with dashboard state.
- [ ] Submit through the local Discord adapter fixture and confirm the same authoritative Decision is shown.
- [ ] Confirm neither adapter stores an independent approval or execution state.

## CI Execution

Add one workflow with separate fast and E2E jobs:

```text
fast:
  pnpm install --frozen-lockfile
  pnpm test
  pnpm build
  pnpm dashboard:build

e2e:
  pnpm install --frozen-lockfile
  pnpm exec playwright install --with-deps chromium
  pnpm test:e2e
```

Required CI properties:

- Use Node 20 or the repository's newer supported version.
- Upload Playwright traces only on failure.
- Upload the disposable Arcadia workspace, dashboard logs, worker logs, and fake-agent logs on failure, with secrets excluded.
- Set a hard timeout per E2E test and for the overall job.
- Fail on leaked child processes or unclean workspace teardown.
- Do not allow E2E tests to use a real home-directory Arcadia workspace.

## Definition Of A Reliable Suite

The suite is sufficient when:

- the eight must-have E2E tests pass locally and in CI;
- at least one test starts from the real phone-facing dashboard;
- no must-have test mocks the CLI or executor process boundary, validator, database, filesystem, or snapshot layer; the fake executor must run as a real subprocess;
- every terminal state is checked in both SQLite and rendered Mission Control;
- approval is persisted before process execution;
- failed execution or Validation can never appear completed;
- final and diagnostic Artifacts plus the Run Log are openable from the user-visible state;
- retry/recovery behavior is explicit and tested; and
- the suite never contacts an external service or invokes real Codex.
