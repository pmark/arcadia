# Claude worker launch replay: candidate evidence, 2026-10-17

Action: `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider#claude-worker-launch-replay`. The Plan is `draft` while this evidence is produced. This report claims no Action, completion or settlement; those follow the Plan's reactivation. No live workspace, operator host, experiment workspace or model call was used.

## The replay

`tests/fast-rehearsal/claude-worker-launch-replay.test.ts` drives the real worker tick (`runManagedProductionTick`, as `arcadia worker` calls it) on the fast-rehearsal fixture. The provider is `claude-code-cli` with profile `claude_build`. Unlike the other scenarios, the tick's tmux adapter is the production `systemTmux`. That means the real `tmux new-session` subprocess runs with the real recording wrapper (`wrapRecordedLaunch`, `scripts/record-session-exit.mjs`) on a real tmux server (3.4).

Stand-ins, all external:

- **tmux socket.** A `tmux` first on PATH execs the real binary with `-S <scenario socket>`. `systemTmux` strips `TMUX`/`TMUX_TMPDIR`, so a socket flag is the only way to keep the replay off the host's server.
- **`claude` binary.** A stub records the argv and working directory, prints one stream-json line and stays alive until released.
- **The agent's edits and completion.** The scripted executor makes them from the same argv.
- **GitHub, reviewers, capacity and sign-in.** These use the harness's shared fakes.

The guard binaries record no call.

Asserted:

| Criterion | Assertion |
| --- | --- |
| Session reaches `running` | `agent_sessions.status` is `running` right after the launch tick. It stays `running` across a tick that sees the pane live, and that tick reconciles nothing. |
| The launch is real | The stub receives the exact brief argument and worktree that tmux was asked to run. `capture-pane` shows the provider's output. |
| Exit is recorded | The wrapper writes exit status 0 and the Session log has the provider output and `arcadia: provider exited with status 0`. The Session reconciles to `completed` with a settlement commit. |
| Draft PR recorded | The terminal tick preserves the candidate. The fake GitHub holds an open PR for its branch with `isDraft: true`, and the preservation receipt names that PR's URL. |

## Defects found

None. The real launch, live-Session tick, exit recording, reconcile and preservation path reached a running Session and a draft PR on the first run. No source change was needed, so there is no failing-first fix to keep. The replay stays in the suite as a regression scenario.

The replay is not vacuous. Two mutations each failed it, and both were reverted:

- **tmux mutation.** The `tmux` wrapper fails `new-session` with a known stderr. `untilLaunched` then fails. The tick reports `tmux could not start the Claude Code Session. Cause: tmux new-session failed (1). Cause: <the stderr>`, then `repair_budget_exhausted` with the same cause.
- **Exit mutation.** The stub exits 5. The exit-recording assertion then fails, and the other five tests pass.

## The 2026-10-11 tmux failure

**Not reproduced on `claude-code-cli`.** The 2026-10-11 run used `codex-cli` under the operator host's launchd worker. Its 155 failures kept only "tmux could not start", so the original cause is still unknown (red alert `ra-2bcf88b68759`). A code replay cannot recover stderr that was discarded. The launch path is provider-neutral, and in this replay it launches cleanly on a real tmux server. If the failure recurs, the cause is now kept: the tmux mutation above shows the stderr reaching the launch result, the repair escalation and (per PR #1416) red-alert evidence and `production status`. That makes the remaining candidates host-environment causes, such as tmux missing from the launchd PATH or a socket directory problem. Only a host launch can confirm or rule them out.

## Commands

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/fast-rehearsal/claude-worker-launch-replay.test.ts` | 6 passed |
| The same with the tmux mutation | Failed in setup with the retained tmux cause (expected) |
| The same with the stub exiting 5 | 1 failed, 5 passed (expected) |
| `node scripts/fast-rehearsal.mjs` (all scenarios) | 20 files, 78 passed, 1 expected fail. The report's 2 unexpected recorded errors belong to the existing `session-probe-wall` scenario, which this change does not touch. |
| `pnpm exec vitest run tests/production-tick.test.ts -t "retains real tmux stderr"` | 1 passed |
| `eslint tests/fast-rehearsal`, `tsc --noEmit`, `pnpm build` | Exit 0 |

The run was in a Linux cloud container with tmux 3.4. CI runs the scenario wherever `tmux` is installed; elsewhere it skips.

## Proven here, and what waits

- **Proven in source:** criteria 1 (replay on `claude-code-cli`, running Session, draft PR), 3 (tmux failure named as not reproduced, cause unknown) and 4 (focused tests, lint, tsc, build). Criterion 2 holds vacuously: the replay found no defect and is kept as a regression scenario.
- **After reactivation:** claiming and settling the Action with its completion Agent Ask.
- **On the host only:** whether the launchd worker's environment reproduces the 2026-10-11 failure. That is the first supervised run's concern, not this Action's.
