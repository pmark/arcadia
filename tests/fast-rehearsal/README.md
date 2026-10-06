# Fast rehearsal harness

Serial two-, three- and nine-Action rehearsals over Arcadia's **real** production lifecycle that
finish in a few minutes, so an orchestration defect reproduces offline
instead of in a 2 to 4 hour live repair loop (Issue #989). The live rehearsal
stays the integration check; this harness is where defects get found and fixed.

## Run it

```sh
pnpm fast-rehearsal                          # every scenario, then the report
pnpm fast-rehearsal -t "Issue #987"          # one scenario (any vitest argument passes through)
pnpm fast-rehearsal --no-file-parallelism    # steadier per-phase timings (about 2 minutes)
pnpm fast-rehearsal --unsandboxed-validator  # skip Seatbelt even where it can run
```

Run it unsandboxed (an agent shell: `dangerouslyDisableSandbox`), inside the
Project's mise environment (`mise exec -- pnpm fast-rehearsal`), and in a
worktree only after `node scripts/bridge-worktree-deps.mjs`. Only on macOS in
an unsandboxed shell does preservation validation run under the real Seatbelt
validator (`validatePreservationCandidate`). Elsewhere (CI, a sandboxed shell)
it runs under `unsandboxedValidator` in `tests/helpers/rehearsalHarness.ts`: the
same authority binding and declared commands re-bound without Seatbelt. Its
evidence lacks the real validator's `cwd`, `durationMs` and `timedOut`, so the
validation evidence rendered into the PR body differs on those runs.

`scripts/fast-rehearsal.mjs` runs `vitest run tests/fast-rehearsal` with
`FAST_REHEARSAL_REPORT_DIR` set to a fresh temporary directory, then prints a
per-phase timing table, every recorded error (command, working directory, exit
code, sanitised stderr; unexpected ones first) and the scenarios' notes, and
writes `report.json` (with each scenario's per-tick log and worker log) in that
directory. Nothing is written into the repository. The same test files also
run in the ordinary suite and the CI shards; there they write no report.

It takes a few minutes on the operator's Mac with file parallelism and the
Seatbelt validator (45 to 65 s measured before the long chain; 65 s for the 17
scenarios with the stacked-PR files, on a loaded host); one two-Action
scenario takes 5 to 25 s. The long-chain files dominate: the nine-Action
chain takes 1 to 2.5 min (about 12 to 20 s per Action under parallel load)
and sets the wall time. Measured 2026-10-06 on a loaded host: all 24
scenarios in 2 min 6 to 10 s, the nine-Action chain about 2 min.

## What is real and what is faked

Real, called as `arcadia worker` calls it (src/commands/worker.ts: preservation
requests serviced, and the managed tick skipped in an iteration that serviced
one, as the worker does; then `runManagedProductionTick`), with these
differences: an injected clock (`now`/`clock`) that moves one simulated
minute per tick (and `advanceClock` for time that passes with no tick, such
as the long chain's half hour of agent work per Action or a Grant's expiry), where the live worker iterates every few seconds and the
review step polls on its own deadline; `agentWorktreeRoot` pointing into the
scenario's temporary directory; and no catch-all around the tick (the worker's
"Tick error" catch), so a tick that throws fails the scenario, which makes the
harness stricter. Real: the workspace database and migrations; `project
import`, `docs sync`, `work plan`, `review approve`, `production preview` and
`activate`; the worker tick's admission, Grant scope, packet preparation and
launch; reconciliation of the exited Session; terminal preservation (commit,
validation, push to a real bare remote, draft PR body with the host-rendered
Operator QA plan); the tick's PR readiness, checks wait and both host review
commands (`qa code-review`, `qa pr`) with their deterministic checks;
integration by local fast-forward; the completion Agent Ask (`agent-ask
draft`, `preview`, `settle` in the candidate) and with it Plan, pointer and
queue advancement; operator escalations and `production status`.

Faked, and why only these (each is an external system or a paid model):

| Seam | Stand-in | Why |
| --- | --- | --- |
| tmux | the shared `FakeTmux` (injected), plus a `tmux` on PATH that answers `-V` and `has-session` from the same live set and refuses anything else | A real pane would start a real provider. `src/dispatch/queue.ts` resolves transitions with the default `systemTmux`, so the PATH fake keeps that read consistent with the injected one |
| The coding agent | `ScriptedExecutor` (`helpers/executor.ts`) | It costs tokens and is nondeterministic. The executor gets only what an agent gets (the launch argv with the Git identity and the rendered brief, and the worktree as cwd) and follows the brief's completion protocol through the real command functions |
| GitHub (`gh`) | `GitHubModel` (`helpers/github.ts`) over the shared `FakeGitHub`, injected through the lifecycle's own `handoff.preserve.remote` and `review.runCommand` options | No network and no real repository. Pushes are real `git push`es to a local bare remote and the branch tips preservation reads are a real `git ls-remote --heads origin`. A PR's base may be any branch (`gh pr create --base <branch>`, refused when the remote lacks it): its `baseRefName` is that branch, `baseRefOid` that branch's remote tip and `files` the three-dot diff against it, the way GitHub reports them; `state` may be set to `CLOSED` or `MERGED`; its body is what the host wrote |
| The reviewer models | the shared fake's stubbed verdicts (pass by default) | Paid and nondeterministic. The host review commands around them run for real |
| Provider capacity and sign-in | the shared fixture observation | Needs a real provider account |

One protocol step is skipped: the executor does not call the
`arcadia-preserve-broker-<agent>` launcher (completion step 2); the worker
preserves the terminal candidate itself when the Session exits. The broker's
file transport has its own tests (`tests/preservation-request-*.test.ts`).
Because nothing is preserved before the settle, the review step's push of a
settled head newer than the preserved one (`src/production/independentReview.ts`)
is not exercised here; `tests/tick-independent-review.test.ts` covers it.

Not exercised either: no tick runs while an agent pane is live (the executor
runs between ticks), so stall detection, pane capture and the live-Session
reconcile paths are outside this harness.

Isolation (`helpers/environment.ts`): each file runs with `HOME` and
`XDG_CONFIG_HOME` in a temporary directory, `GIT_CONFIG_NOSYSTEM=1`, every
other `GIT_CONFIG_*`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
`CODEX_HOME`, `CODEX_SANDBOX`, the capacity and usage cache paths and every
`ARCADIA_CLAUDE_*` unset, and `ARCADIA_WORKSPACE` naming the scenario's own
temporary workspace; `PATH`
starts with guard binaries for `gh`, `claude`, `codex` and `opencode` that
record and refuse any call. Every scenario asserts the guard log is empty.
Nothing here can reach the live workspace, GitHub or production.

## Phases in the report

Each worker tick is timed and attributed to one phase of the Action in flight;
the validator, every remote push or PR write and every stubbed `gh`/reviewer
call are timed separately and subtracted from their tick (`helpers/report.ts`):

- **queue wait**: ticks before the first launch, and the tick that admits and launches an Action;
- **agent execution**: the executor's edits;
- **validation**: the executor's validation command plus host preservation validation;
- **Git finalization**: the executor's commit and completion settle, the tick that reconciles and preserves, and all pushes and PR writes;
- **review**: ticks after preservation until integration (readiness, checks, both reviewers);
- **integration**: the tick that fast-forwards the base;
- **advancement**: ticks after integration until the next admission (or the trailing ticks after the last Action).

Simulated time advances one minute per tick; the table shows wall time.

## Scenarios and what each reproduces

| File | Scenario | Reproduces |
| --- | --- | --- |
| `serial-two-action.test.ts` | clean executor, two dependent Actions, end to end | The baseline: admission to integration to the next admission, each exactly once |
| same | Issue #987, fixed (stacked PRs) | After Action 1 integrates locally the remote's `main` stays behind, so Action 2's PR is opened on Action 1's candidate branch: the published plan, the PR's base and its files agree (also via `scripts/qa-plan-consistency.ts`). Live run 5 stopped at QA with its PR on `main`; a companion test pins what that PR would report. The `it.fails` marker flipped with the fix |
| `three-action-chain.test.ts` | three dependent Actions, end to end | Every PR stacked on the previous candidate branch (PR 1 on `main`, PR 2 on candidate 1, PR 3 on candidate 2), each consistent with its plan, each Action admitted once, all integrated locally, the remote base never pushed |
| `long-chain.test.ts` | the overnight shape: nine dependent Actions in three batches of three under one Grant, half a simulated hour of agent work each (5.4 simulated hours, inside the 12-hour Grant) | Each step reads its predecessor's output (`helpers/chain.ts`: step k appends to `chain/batch-<b>.md` a line derived from step k-1's, so a wrong launch base stops the executor), so each is launched from its predecessor's integrated head. Every Action admitted exactly once and integrated in order; eight stacked PRs (each on the previous candidate's branch), each with a QA plan consistent with its GitHub diff; no commit lost; the remote base never pushed; `production status` names the Action building, then the Action in review (`awaiting_independent_verdicts`), and each integration as a base advance; at the end nothing is admitted, no escalation, red alert or launch blocker remains, and the tick says every Action is done |
| `long-chain-verdict-failure.test.ts` | the chain with QA failing step 5's exact head | Steps 1 to 4 integrate; step 5 is preserved, never integrated, and is the one `independent_verdict_failed` entry in `production status` (with its `--rerun` remedy), refreshed every tick and still there three simulated hours later; step 6 is never admitted |
| `long-chain-grant-expiry.test.ts` | the Grant (integration grant and packet_approval delegation, both 12 hours) expires while step 4's agent is working | Fixed here: the preserved candidate was neither readied nor reviewed nor integrated, with **nothing** in `production status` for hours (the integration step refused before the verdict gate that records a wait). Now one `terminal_candidate_not_integrable` entry names the lapsed Grant and the fresh-Grant remedy; step 5 is never admitted; after a fresh activation step 4 is readied, reviewed and integrated and the entry clears |
| same | the Grant expires between steps 3 and 4 (the batch boundary) | Step 4 is never admitted. Fixed here: its one `build_packet_approval_pending` escalation said only "approve the packet"; its remedy now leads with the lapsed delegation and integration grant. After five refused ticks the red-alert layer adds `admission_refused_consecutive` for the same Action |
| same | step 4's packet approved one tick before the expiry | Today step 4 launches one tick after the Grant expired (the standing policy has no expiry of its own; admission does not consult the lapsed delegations), and then can only end as the first scenario. Marked `it.fails` for "admits no Action once the Grant has expired" (Issue #1012; revival trigger: admission made to consult the expiry, or a live chain planned to end within minutes of its Grant's expiry) |
| `stacked-base-refusal.test.ts` | the previous candidate's branch deleted on the remote | Preservation refuses Action 2's PR (nothing pushed, the candidate kept locally) with one `terminal_candidate_not_integrable` escalation naming the branch to push again; after that push it stacks and integrates |
| same | the operator published the integrated base | Action 2's base is the remote's `main`: its PR opens on `main`, unchanged |
| `stacked-base-github-state.test.ts` | the previous PR closed on GitHub | Still stacked on its branch; integrates |
| same | the previous PR merged on GitHub, its branch deleted | The tick fast-forwards onto the merged `main`, so Action 2 launches from it and its PR opens on `main`, consistent |
| `stacked-base-retarget.test.ts` | the stacked PR retargeted to `main` on GitHub | The review step requests no verdict while the PR's base differs from the one its plan describes: one `review_pull_request_unavailable` escalation naming `gh pr edit --base`; retargeted back, it integrates |
| same | the stacked base branch's tip moved (onto the candidate's own head) | No verdict while the base is not at the tip preservation chose: one `review_pull_request_unavailable` escalation naming the tip to restore; restored, it integrates |
| `stacked-base-existing-pr.test.ts` | an open PR for the candidate's branch already on `main` | Preservation refuses (`pull_request_base_mismatch`) before any push, and the tick's pre-check before host validation (never re-validated while blocked); one escalation naming `gh pr edit --base`; retargeted, that PR is preserved onto and integrates |
| `executor-behaviours.test.ts` | untracked, unarchived draft | Run 4's defect (#981); with #983 the settle archives the draft and the candidate integrates |
| same | draft edited after an inline preview | #983's N4 case: settle warning, the guard refuses every tick, one `terminal_candidate_not_integrable` escalation in `production status` |
| `settle-then-dirty.test.ts` | extra uncommitted file / extra commit after settling | #994: reconciled incomplete, but the candidate already carries the Action's recorded completion settlement, so no continuation is offered (it could only refuse "Action is already done"); the terminal guards refuse the head after the settlement commit (the extra work is never integrated) and `production status` shows one `terminal_candidate_not_integrable` entry naming the settlement commit, the extra paths and the operator's `merge --ff-only <settlement commit>`; doing that admits Action 2 once. Its `it.fails` marker is flipped |
| same | extra commit, the Session reconciled by an operator (`arcadia session reconcile`) before the worker | The worker never reconciles that exit, so one continuation runs, cannot settle ("Action is already done"), and is then held by the same single `terminal_candidate_not_integrable` entry: never a second continuation |
| `git-faults.test.ts` | the lifecycle's `git merge --ff-only` fails once at integration | The next tick retries; the Action advances exactly once |
| same | a push through the preservation remote adapter fails once | A remote-adapter failure (the shim fails the fake remote's `git push`, standing in for `systemPreservationRemote.push`); the next tick retries; advances exactly once |
| `completion-faults.test.ts` | agent dies after its work commit | One continuation Session in the same worktree settles; advances exactly once |
| same | agent dies after the settlement commit, before it is recorded | #995: the exit tick derives the pending `complete` proposal's settlement again at its Candidate revision (a settlement preview in a throwaway detached checkout) and, because the candidate's HEAD is exactly that settlement (evidence verbatim-covering every criterion, every entry met), records it (`recordCommittedCompletionSettlement`, no agent, no model); reconciliation accepts it and the Action advances exactly once. Its `it.fails` marker is flipped |
| same | the same, but an operator reconciles the Session (`arcadia session reconcile`) before the worker | The pending proposal stays: an operator gate (`resolveProjectTransition` answers `decision`). `production status` shows one `operator_gate_pending` entry (#997), logged once, naming the proposal, why it cannot settle again ("Action is already done") and that the candidate already holds its canonical settlement commit, with the remedy's route: an operator merge of exactly that commit, then retiring the candidate worktree (its head is on the base) so the next Action can launch, then rejecting the moot proposal (not rejecting alone, which would only let a continuation refuse again). Computing the remedy writes nothing durable. The test follows that route and Action 2 launches once |
| same | the settlement commit also answers a Decision / edits the Plan beyond the completion | The derived settlement differs (only the settlement's own day may differ, consistently), so the exit tick records nothing: no deterministic-proof receipt for a hand-made commit. The pending proposal shows as the operator gate: the candidate records the Action done but its head is not the canonical settlement, so the remedy says to inspect it and, to redo the Action, retire the worktree before rejecting |
| same | a step error in readiness, then a fresh module graph | Not a process kill: the tick's own catch logs it (no red alert: a terminal Session's handoff has no lease). The PR is readied once and the Action advances exactly once |

An `it.fails` test is an **expected failure**: it passes while the defect
exists. When a fix makes its body pass, vitest fails it; change `it.fails` to
`it` in the same change as the fix. Each one sits next to a normal test that
pins today's exact behaviour, so a broken scenario cannot pass silently.

## Add a scenario

1. Call `isolateProcess()` in the file's `beforeAll` and `restore()` in `afterAll`.
2. `new FastRehearsal("<scenario-name>", isolation, import.meta.filename)`, then `start()`.
   Pass `{ longChain: true }` for the nine-step chain fixture (`helpers/chain.ts`),
   whose `runChainStep(world, index)` drives one step from admission to
   integration (or, with `{ integrate: false }`, to its preserved PR) and keeps
   `production status` from each stage.
3. Drive it: `untilLaunched(action)`, `execute(launch, action, behaviour)`,
   `tick()`/`ticks(n)`/`untilIntegrated(action)`; inject faults with
   `installGitFaults(world.root).arm("<git subcommand>")`, the shared
   `FakeGitHub` hooks (`world.github.beforeReady`, `duringReview`, `viewFailures`,
   `verdict`), `world.advanceClock(ms)`, or `await world.restartWorker()`.
   Faults are in-process (a thrown error, a Git shim), never process kills:
   cleanup a killed process would skip still runs.
4. Declare expected errors with `world.expectError(/.../)`, assert the outcome,
   assert `isolation.guardCalls()` is empty, and call `world.finish()` so the
   report includes the scenario. Pass `SCENARIO_TIMEOUT_MS` to the test or hook.
5. A new executor behaviour goes in `ExecutorBehaviour` with a comment naming
   the live shape it models.

Never replace a lifecycle step to make a scenario pass: if a seam the lifecycle
does not already expose seems necessary, it is a finding to report, not a fake
to add.
