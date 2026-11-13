# Diagnosis: #2517 stub-provider failures under pre-acceptance validation

Research only (Issue #2517; Plan Action `split-environment-parity-ci-diagnosis-and-port-broker`, slice 2). No source change, no fix, no merge. Tested at head `d0328ffad` (main at start of work). Host: macOS, Node 22.23.1, vitest 4.1.8.

## Verdict

- **Not the Seatbelt profile, not loopback, not mise trust, for the 15 stub-provider tests.** The failure reproduces through the production validation path with the profile (R1) and without it (R2). It contains no `EPERM` or `Operation not permitted` text. The exact profile text, env and tree, run through a hand-built equivalent, pass 43/43 (R3).
- **The cause is located in the production path, but the specific step is not proved.** Four production runs give the same 18-failure set. No hand-built equivalent (R3 to R9) reproduces it. The remaining candidates are listed below.
- **#2519 (loopback denial) is a distinct cause and is not proved to be the same.** The failing report contains zero `EPERM` lines. The loopback classifier correctly did not fire (`loopbackDenied` is absent from the refusal). Do not merge #2519 into #2517.
- **The three `launcher fallbacks (fake mise)` failures are a separate, host-side issue.** The host reproduces them, with `mise ERROR ... not trusted` for `$TMPDIR/mise.toml`. They are not the 15 stub-provider failures.

## How pre-acceptance runs (code facts)

`src/sessions/completionValidation.ts`, `runCompletionValidation`:

- **Profile:** `(deny default)`. `file-read*` is allowed only for the materialized `source`, the private `scratch`, and the bridged `node_modules` trees. It is denied for the candidate workspace, repository and worktree, and for the whole `$HOME`. `file-write*` is allowed only for `scratch` and `/dev/null`. There is no `network*` rule, so loopback bind and connect are denied.
- **Env:** `PATH` is `source/node_modules/.bin:<node dir>:/usr/bin:/bin:/usr/sbin:/sbin`. `HOME` and `TMPDIR` are `scratch`. Also `NODE_ENV=test`, `CI=1`, `COREPACK_ENABLE_NETWORK=0`.
- **Launch:** `runOwnedValidation` (`src/sessions/preservationProcessLifecycle.ts`) spawns a helper, which wraps argv in `/usr/bin/sandbox-exec -p <profile>`.
- **Loopback classifier:** `LOOPBACK_DENIED = /^(?!AssertionError)\w*Error: (?:listen|connect|bind) EPERM\b/`, tested on the first line of each failure, and only when every failing test matches. Otherwise the completion is refused without `loopbackDenied`. This is already narrow. It excludes `AssertionError` and any non-loopback failure. It was not changed here.
- **Nesting:** `sandbox-exec` run inside the agent's own Seatbelt fails with `sandbox_apply: Operation not permitted`. R1 and R2 therefore ran from an unsandboxed shell. The test file's own notes say the same: validation cannot nest inside the agent sandbox.

## Reproduction

| # | Run (same test file, same head) | Result | Stub-provider tests |
|---|---|---|---|
| R0 | Host, unsandboxed, `vitest run tests/headless-provider-operator-script.test.ts` | 40 pass, 3 fail (launcher fake-mise) | all pass |
| R1 | Production `validateCompletionCandidate`, under the profile via `sandbox-exec`, evidence retained | refused, vitest exit 1, 18 named failures; `loopbackDenied` absent, `hostFault` false | 15 fail |
| R2 | Same production call, no profile (the test-only unconfined seam; `VITEST=1` set on the driver) | refused, the same 18 failures | 15 fail |
| R3 | Hand-built replica: exact profile text, exact env, `git archive HEAD` tree, root bridged deps, direct spawn | 43/43 pass | all pass |
| R4 | R3 with scratch under the host `TMPDIR` (`/private/var/folders/...`) | 40 pass, 3 fail (= R0) | all pass |
| R5 | R3 via `runOwnedValidation`, no profile | 40 pass, 3 fail | all pass |
| R6 | R5 with the real `bridgeCompletionDependencies` | 40 pass, 3 fail | all pass |
| R7 | Replica, no profile, real env | 40 pass, 3 fail | all pass |
| R8 | Replica, no profile, scrubbed env | 42 pass, 1 fail | 1 fail: a codex table assertion, `expected ... to match /FAIL {2}provider exited 0.../` |
| R9 | R3 with `(allow network*)` added | 43/43 pass | all pass |

Other checks:

- `diff -rq` of the production materialized `source` against the replica `source`, excluding `node_modules` and `scratch`: 0 differences, apart from symlink-loop noise under `.claude/skills`. Both trees have 106 executable files.
- The bridged `node_modules` in the production run contains `tsx`, `vitest` and `commander`, and `apps/*` member trees. R6 used the same bridge function and still passed.

## Exact error lines (production run, R2 retained report)

Distinct first lines of the 18 failing tests:

- `AssertionError: expected 'failed' to be 'succeeded'` at `tests/headless-provider-operator-script.test.ts:256`, `:293`, `:334`, `:429`, `:519`, `:536`, `:551`.
- `AssertionError: expected { provider: 'claude', ...} to match object { outcome: 'PASS', ... }` (two tests).
- `AssertionError: expected { provider: 'codex', ...} to match object { outcome: 'FAIL', timedOut: true }`.
- `TypeError: Cannot read properties of undefined (reading 'pass')` at `:397` and `:482`.
- `Error: the stub provider never started` at `:444`.
- Launcher, three tests: `AssertionError: expected 1 to be 7` (`:788`), `Error: the fake helper never started` (`:812`), `AssertionError: expected 1 to be +0` (`:827`).
- The first captured precondition line reads `precondition (codex): ok: codex login status succeeded`. The live workspace snapshot line reads `skipped`.
- `grep -c 'EPERM\|Operation not permitted'` on the retained report: `0`.

## Competing explanations

| # | Explanation | Verdict | Evidence |
|---|---|---|---|
| E1 | Seatbelt profile denies a read, exec or write the stub providers need (HOME/config, temp, PATH) | Not supported | R2 fails without any profile. R3 and R9 pass under the exact profile text. |
| E2 | Loopback denial, the same root cause as #2519 | Not supported for these 15 | Zero `EPERM` lines. The classifier did not fire. Distinct from #2519. |
| E3 | Network guard | Not supported | R9 passes with `network*` allowed, but R9 is a replica, not the production path. |
| E4 | mise trust (`$TMPDIR/mise.toml` not trusted) | Supported only for the 3 launcher tests | Host (R0) reproduces the same 3 failures. The stub tests do not use mise on this path, and they pass on host. |
| E5 | Something in the production invocation differs from the hand-built replica | Supported as the locus; step not proved | R1, R2 fail; R3 to R7 pass. Same tree, same bridge, same helper. |
| E6 | Timing or load flakiness | Not supported | Four production runs give the same 18-failure set; five replica runs pass. |

## What remains unproved

1. **Which step of the production invocation causes it.** Unisolated differences: the configured `node --version` command that runs first in production; `bindCheckDefinitions` and the snapshot; the driver's environment (`VITEST=1` in R2 only); and the candidate `workspace` argument.
2. **The provider-level cause of each failure.** The test's `afterEach` removes the `--keep` run directories, so the provider's receipts and logs for the failing cases were not retained. The assertion messages show only the `failed` outcome.
3. **Whether the worker's host reproduces this.** Only this host was tested.

## Suggested next proving steps (no fix proposed)

- Run the production path with the test's `keep` option on, so the failing provider receipts survive, and read the first `failureDetails` line for one failing case.
- Bisect the production invocation: first with `commands` set to a trivial command and without the `node --version` pre-run, then with the workspace argument moved, one change at a time, unconfined.
- Keep the #2520 classifier unchanged. Any change must not accept `AssertionError` or a generic exit-1.

## Notes on the plan

- Issue `#2520` could not be read: `gh issue view 2520` reports no such issue in `pmark/arcadia`. The current `LOOPBACK_DENIED` pattern already excludes `AssertionError` and non-loopback failures.
- Issue `#2519` describes the loopback-denial class for `tests/dashboard-live.test.ts`. That class is distinct from the 15 stub-provider failures here.

## QA plan

- The diff contains only this file. `git diff --stat origin/main...HEAD` should show `docs/reports/diagnosis-2517-stub-provider-pre-acceptance.md` and nothing else.
- Re-run R0 on a clean checkout: `pnpm exec vitest run tests/headless-provider-operator-script.test.ts`. Expect 3 launcher failures on a host whose `TMPDIR` holds an untrusted `mise.toml`, and no stub-provider failures.
- R1 requires an unsandboxed macOS shell, because `sandbox-exec` cannot nest. Drive `validateCompletionCandidate` on the same head with `commands: ["node --version"]`, `acceptanceCriteria` naming the test file, and a `workspace` outside the worktree. Expect `status: "refused"`, `loopbackDenied` absent, and about 18 failing named tests.
- Grep the retained vitest report for `EPERM`. Expect no match.
