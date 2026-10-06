# Fast rehearsal harness

A serial two-Action rehearsal over Arcadia's **real** production lifecycle that
finishes in about a minute, so an orchestration defect reproduces offline
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
worktree only after `node scripts/bridge-worktree-deps.mjs`. On macOS outside a
sandbox, preservation validation runs under the real Seatbelt validator;
elsewhere (CI, a sandboxed shell) under the harness's unsandboxed binding of the
same checks (`unsandboxedValidator` in `tests/helpers/rehearsalHarness.ts`).

`scripts/fast-rehearsal.mjs` runs `vitest run tests/fast-rehearsal` with
`FAST_REHEARSAL_REPORT_DIR` set to a fresh temporary directory, then prints a
per-phase timing table, every recorded error (command, working directory, exit
code, sanitised stderr; unexpected ones first) and the scenarios' notes, and
writes `report.json` (with each scenario's per-tick log and worker log) in that
directory. Nothing is written into the repository. The same test files also
run in the ordinary suite and the CI shards; there they write no report.

Measured on the operator's Mac (2026-10-05): about 52 s for all nine scenarios
with file parallelism and the Seatbelt validator; one scenario takes 5 to 25 s.

## What is real and what is faked

Real, called exactly as `arcadia worker` calls it (`runManagedProductionIteration`
in `src/commands/worker.ts`: preservation requests serviced, then
`runManagedProductionTick`): the workspace database and migrations; `project
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
| GitHub (`gh`) | `GitHubModel` (`helpers/github.ts`) over the shared `FakeGitHub`, injected through the lifecycle's own `handoff.preserve.remote` and `review.runCommand` options | No network and no real repository. Pushes are real `git push`es to a local bare remote; the PR's `baseRefOid` and `files` are computed the way GitHub reports them (the remote's base tip, three-dot diff), and its body is what the host wrote |
| The reviewer models | the shared fake's stubbed verdicts (pass by default) | Paid and nondeterministic. The host review commands around them run for real |
| Provider capacity and sign-in | the shared fixture observation | Needs a real provider account |

One protocol step is skipped: the executor does not call the
`arcadia-preserve-broker-<agent>` launcher (completion step 2); the worker
preserves the terminal candidate itself, which is the path every live run took.
The broker's file transport has its own tests (`tests/preservation-request-*.test.ts`).

Isolation (`helpers/environment.ts`): each file runs with `HOME` and
`XDG_CONFIG_HOME` in a temporary directory, `GIT_CONFIG_NOSYSTEM=1`, and
`ARCADIA_WORKSPACE` naming the scenario's own temporary workspace; `PATH`
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
| same | Issue #987 | After Action 1 integrates locally, Action 2's PR base is the remote's unadvanced `main`: the plan says base = Action 1's head and six files, the PR seven. Compared with the checkpoint-replay check (`scripts/qa-plan-consistency.ts`); marked `it.fails` |
| `executor-behaviours.test.ts` | untracked, unarchived draft | Run 4's defect (#981); with #983 the settle archives the draft and the candidate integrates |
| same | draft edited after an inline preview | #983's N4 case: settle warning, the guard refuses every tick, one `terminal_candidate_not_integrable` escalation in `production status` |
| same | extra uncommitted file / extra commit after settling | Today: reconciled incomplete, a continuation Session relaunched that cannot settle ("Action is already done"), then a silent stall. Marked `it.fails` for "integrates or escalates" |
| `completion-faults.test.ts` | `git push` fails once in preservation | The next tick retries; the Action advances exactly once |
| same | agent dies after its work commit | One continuation Session in the same worktree settles; advances exactly once |
| same | agent dies after the settlement commit, before it is recorded | Today: preserved, then a silent stall (no relaunch, no integration, no escalation). Marked `it.fails` for "recovers and advances exactly once" |
| same | crash in the readiness step, then a worker restart (fresh module graph) | The PR is readied once and the Action advances exactly once |

An `it.fails` test is an **expected failure**: it passes while the defect
exists. When a fix makes its body pass, vitest fails it; change `it.fails` to
`it` in the same change as the fix. Each one sits next to a normal test that
pins today's exact behaviour, so a broken scenario cannot pass silently.

## Add a scenario

1. Call `isolateProcess()` in the file's `beforeAll` and `restore()` in `afterAll`.
2. `new FastRehearsal("<scenario-name>", isolation, import.meta.filename)`, then `start()`.
3. Drive it: `untilLaunched(action)`, `execute(launch, action, behaviour)`,
   `tick()`/`ticks(n)`/`untilIntegrated(action)`; inject faults with
   `installGitFaults(world.root).arm("<git subcommand>")`, the shared
   `FakeGitHub` hooks (`world.github.beforeReady`, `duringReview`, `viewFailures`,
   `verdict`), or `await world.restartWorker()`.
4. Declare expected errors with `world.expectError(/.../)`, assert the outcome,
   assert `isolation.guardCalls()` is empty, and call `world.finish()` so the
   report includes the scenario. Pass `SCENARIO_TIMEOUT_MS` to the test or hook.
5. A new executor behaviour goes in `ExecutorBehaviour` with a comment naming
   the live shape it models.

Never replace a lifecycle step to make a scenario pass: if a seam the lifecycle
does not already expose seems necessary, it is a finding to report, not a fake
to add.
