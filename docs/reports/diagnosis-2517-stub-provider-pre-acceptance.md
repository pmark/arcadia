# Diagnosis: #2517 stub-provider failures under pre-acceptance validation

Research only (Issue #2517; Plan Action `split-environment-parity-ci-diagnosis-and-port-broker`, slice 2). No source change, no fix, no merge. Code tested at `d0328ffad` (main when the work started). This PR adds only this file on top of it. Host: macOS, Node 22.23.1, vitest 4.1.8.

## Verdict

- **The profile is not required for the failure.** The same 18 named failures occur through the production validation path with the Seatbelt profile (R1) and without it (R2). Neither run contains `EPERM` or `Operation not permitted` text. A hand-built equivalent of the production path with the exact profile text passes 43/43 (R3), so the production invocation differs in a way not yet isolated.
- **Counts:** 18 named failures = 15 stub-provider tests in `tests/headless-provider-operator-script.test.ts` + 3 `launcher fallbacks (fake mise)` tests (same file).
- **#2519 (loopback denial) is a distinct cause and is not proved to be the same.** The failing reports contain zero `EPERM` lines, and the loopback path did not fire (`loopbackDenied` absent from the refusal).
- **The 3 launcher failures are a separate host-side issue**, reproduced on the host (R0), from an untrusted `mise.toml` in `$TMPDIR`. They are not evidence about the 15 stub-provider tests.
- **#2520 is merged** (PR #2520, "Hold loopback-denied named tests as unavailable (Option C of #2519)", merged 2026-11-12, merge commit `1c8ddb1a9`). It is the origin of the current `LOOPBACK_DENIED` classifier (`src/sessions/completionValidation.ts:289`). It was not changed here.

## How pre-acceptance runs (code facts)

`src/sessions/completionValidation.ts`, `runCompletionValidation`:

- **Profile:** `(deny default)`. `file-read*` is allowed only for the materialized `source`, the private `scratch`, and the bridged `node_modules` trees. It is denied for the candidate workspace, repository and worktree, and for the whole `$HOME`. `file-write*` is allowed only for `scratch` and `/dev/null`. There is no `network*` rule, so loopback bind and connect are denied.
- **Env:** `PATH` is `source/node_modules/.bin:<node dir>:/usr/bin:/bin:/usr/sbin:/sbin`. `HOME` and `TMPDIR` are `scratch`. Also `NODE_ENV=test`, `CI=1`, `COREPACK_ENABLE_NETWORK=0`.
- **Launch:** `runOwnedValidation` (`src/sessions/preservationProcessLifecycle.ts`) spawns a helper, which wraps argv in `/usr/bin/sandbox-exec -p <profile>`.
- **Unconfined seam:** line 309 honours `unconfinedForTests` only when `process.env.VITEST` is set. R2 set `VITEST=1` on the driver, so it ran unconfined. R1 did not set it, so it ran under the profile.
- **Loopback classifier:** `LOOPBACK_DENIED` (line 289) is tested on the first line of each failure, and only when every failing test matches. Otherwise the completion is refused without `loopbackDenied`. It excludes `AssertionError`.
- **Nesting:** `sandbox-exec` run inside the agent's own Seatbelt fails with `sandbox_apply: Operation not permitted`, so R1 required an unsandboxed shell. The repository notes say the same: "the Seatbelt validation cannot nest inside the agent sandbox" (`docs/notes-to-self.md`, the section on the headless-provider test, around line 306).

## Reproduction

| # | Run (same test file, same code head) | Result | Stub-provider tests (15) |
|---|---|---|---|
| R0 | Host, unsandboxed, `vitest run tests/headless-provider-operator-script.test.ts` | 40 pass, 3 fail (the launcher tests) | all pass |
| R1 | Production `validateCompletionCandidate`, under the profile (no `VITEST`). Three such runs refused; the retained report of one (the keep run) and the evidence run both list 18 failures | refused, vitest exit 1; `loopbackDenied` absent, `hostFault` false | 15 fail |
| R2 | Production call with `VITEST=1`, so the unconfined seam is honoured (one run; retained report lists 18 failures) | refused, same 18 failures | 15 fail |
| R3 | Hand-built replica: exact profile text, exact env, `git archive HEAD` tree, bridged deps, direct spawn | 43/43 pass | all pass |
| R4 | R3 with scratch under the host `$TMPDIR` | 40 pass, 3 fail (= R0) | all pass |
| R5 | R3 through `runOwnedValidation`, no profile | 40 pass, 3 fail | all pass |
| R6 | R5 with the real `bridgeCompletionDependencies` in place of the hand bridge | 40 pass, 3 fail | all pass |
| R7 | R3 with no profile, real environment | 40 pass, 3 fail | all pass |
| R8 | R3 with no profile, scrubbed environment | 42 pass, 1 fail | 1 fail (a codex table assertion, `FAIL  provider exited 0`) |
| R9 | R3 with `(allow network*)` added to the profile | 43/43 pass | all pass |

Of the replicas, only R3 and R9 pass 43/43. R4 to R7 pass every stub-provider test and fail only the three launcher tests. R8 fails one stub-provider test.

Other checks:

- `diff -rq` of the production materialized `source` against the R6 `source`, excluding `node_modules` and `scratch`: 0 differences, apart from symlink-loop noise under `.claude/skills`. Both trees have 106 executable files.
- The production bridge contains `tsx`, `vitest` and `commander`, and `apps/*` member trees. R6 used the same bridge function and still passed the stub tests.

## Exact failure lines (retained production reports, R1 keep run and R2)

All 18 failing tests, first failure line of each:

Stub-provider tests (15):

1. `runs a chosen provider through the entry script with an explicit model...`: `AssertionError: == Headless provider single-Action test (experiment fixture, Decision 0082) ==` (the table dump).
2. `tries all three providers in order on fresh fixtures...`: `AssertionError: expected 'failed' to be 'succeeded'` at `:256`.
3. `reports each provider independently...`: `expected 'failed' to be 'succeeded'` at `:293`.
4. `skips only the provider whose precondition is missing...`: `expected 'failed' to be 'succeeded'` at `:334`.
5. `fails Claude on an is_error result event...`: `TypeError: Cannot read properties of undefined (reading 'pass')` at `:397`.
6. `passes Claude on its own part when it could not commit...`: `expected { provider: 'claude', ...} to match object { outcome: 'PASS', ...(1) }`.
7. `starts a provider on an operator-chosen model...`: `expected { provider: 'claude', ...} to match object { outcome: 'PASS', ...(2) }`.
8. `accepts a completion the agent settled itself...`: `expected 'failed' to be 'succeeded'` at `:429`.
9. `stops the provider's process group on SIGTERM...`: `Error: the stub provider never started` at `:444`.
10. `kills a provider that outlives the cap...`: `expected { provider: 'codex', ...} to match object { outcome: 'FAIL', timedOut: true }`.
11. `fails a provider whose Ask is not criterion-complete...`: `TypeError: Cannot read properties of undefined (reading 'pass')` at `:482`.
12. `fails a provider that writes the wrong marker...`: `expected undefined to match object { pass: false }`.
13. `plays the host's role when the sandboxed agent cannot commit...`: `expected 'failed' to be 'succeeded'` at `:519`.
14. `keeps a host step that could not run distinct from one that ran and refused...`: `expected 'failed' to be 'succeeded'` at `:536`.
15. `reports a host step that ran and refused as host_failed...`: `expected 'failed' to be 'succeeded'` at `:551`.

Launcher tests (3, `describe("launcher fallbacks (fake mise)")` from line 768):

16. `writes a fallback receipt and handoff when the helper dies...`: `AssertionError: expected 1 to be 7` at `:788`.
17. `forwards SIGTERM to the helper...`: `Error: the fake helper never started` at `:812`.
18. `trusts a receipt the helper wrote and exits 0...`: `AssertionError: expected 1 to be +0` at `:827`.

Also: the retained report has 43 tests, 25 passing and 18 failing. `grep -c 'EPERM\|Operation not permitted'` on it returns `0`.

## Competing explanations

| # | Explanation | Verdict | Evidence |
|---|---|---|---|
| E1 | The profile denies a read, exec or write the stub providers need (HOME/config, temp, PATH) | Not supported | R2 fails with no profile. R3 and R9 pass under the exact profile text. |
| E2 | Loopback denial, the same root cause as #2519 | Not supported for these 15 | Zero `EPERM` lines in the retained reports. The classifier did not fire. |
| E3 | Network guard | Not supported | R9 passes with `network*` allowed, but R9 is a replica, not the production path. |
| E4 | mise trust (untrusted `mise.toml` in `$TMPDIR`) | Supported only for the 3 launcher tests | R0 reproduces the same 3. The launcher describe starts at line 768. Line 182 says the case "needs no mise trust write" because it runs node directly. The 15 stub tests pass on host. |
| E5 | The production invocation differs from the hand-built replica | Supported as the locus; the step is not proved | R1 and R2 fail. R3 to R7 pass with the same tree, the same bridge and the same helper. |
| E6 | Timing or load flakiness | Not supported | Three profile runs and one unconfined run give the same failing set; R3 and R9 pass in 43/43 runs. |

## What remains unproved

1. **Which step of the production invocation causes it.** Not isolated: the configured `node --version` command that runs first in production; `bindCheckDefinitions` and the snapshot; the driver environment (`VITEST` is set only in R2); and the `workspace` argument.
2. **The provider-level cause of each failure.** The test's `afterEach` removes its `--keep` run directories, so the provider receipts and logs for the failing cases were not retained. The assertions show only the outcome.
3. **Whether the worker's host reproduces it.** Only this host was tested.

## Suggested next proving steps (no fix proposed)

- Run the production path with the test's `keep` option on, so the failing provider receipts survive, and read the first failure detail of one failing case.
- Bisect the production invocation unconfined, one change at a time: first remove the `node --version` pre-run, then move the `workspace` argument.
- Keep the #2520 classifier unchanged. Any change must not accept `AssertionError` or a generic exit-1.

## Reproducing the results

Retained artifacts: none. The replica scripts, the driver files and the retained validation reports lived in the agent's scratch directory and were not committed. The replica is described by its variants above, and the commands below reproduce it.

Driver for R1 and R2 (a small `.mts` file run with `node --import tsx` from the worktree root, with `<WT>` the worktree, `<SCRATCH>` a scratch directory and `<WS>` a directory outside the worktree):

```ts
import { validateCompletionCandidate } from "<WT>/src/sessions/completionValidation.ts";
import { execFileSync } from "node:child_process";
const head = execFileSync("git", ["-C", "<WT>", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const r = validateCompletionCandidate({ repository: "<WT>", worktree: "<WT>", base: head, workspace: "<WS>",
  commands: ["node --version"], acceptanceCriteria: ["tests/headless-provider-operator-script.test.ts still passes all of its tests"] },
  { dependencyRoot: "<WT>", timeoutMs: 900000 });
console.log(JSON.stringify(r, null, 2));
```

- R1: `node --import tsx driver.mts <WS>` from an unsandboxed shell, without `VITEST`.
- R2: `VITEST=1 node --import tsx driver.mts <WS>`. Both need an unsandboxed shell (see the nesting note).
- R0: `pnpm exec vitest run tests/headless-provider-operator-script.test.ts --reporter=json --outputFile.json=<SCRATCH>/host.json` from the worktree, after `node scripts/bridge-worktree-deps.mjs`.
- Zero-EPERM check: `grep -c 'EPERM\|Operation not permitted' <SCRATCH>/completion-vitest-report.json` (the report is written under the validation scratch root while the run is retained).
- Tree comparison: `diff -rq --exclude=node_modules --exclude=scratch <retained source> <replica source> | grep -v 'Directory loop'`.
- Replica variants (R3 to R9) are one vitest command per variant, run as `node node_modules/vitest/vitest.mjs run tests/headless-provider-operator-script.test.ts --maxWorkers=2 --reporter=json --outputFile.json=<report>` in a source tree from `git archive HEAD`, with `HOME` and `TMPDIR` set to scratch, `PATH` as in the Env bullet above, and the profile or no profile as listed. The replica script itself is not retained.

## QA plan

- The PR diff contains only this file.
- Re-run R0 on a clean checkout. Expect the 3 launcher failures on a host whose `TMPDIR` holds an untrusted `mise.toml`, and no stub-provider failures.
- Re-run R1 from an unsandboxed macOS shell with the driver above. Expect `status: "refused"`, `loopbackDenied` absent, 18 failing named tests, and no `EPERM` in the retained report.
- Confirm `src/sessions/completionValidation.ts` is unchanged by this PR.
