# Diagnosis: #2517 stub-provider failures under pre-acceptance validation

Research only (Issue #2517; Plan Action `split-environment-parity-ci-diagnosis-and-port-broker`, slice 2). No source change, no fix, no merge. Code tested at `d0328ffad` (main when the work started). This PR adds only this file on top of it. Host: macOS, Node 22.23.1, vitest 4.1.8 (installed; `package.json` declares `^4.1.0`, and `pnpm-lock.yaml` pins `vitest@4.1.8`). `package.json` has no `engines` field, so the Node version is not pinned by the repository.

Labels used below: **UNRETAINED** means the output came from a run whose files lived in the agent's scratch directory and were not committed. Nothing in this PR is a retained artifact.

## Verdict

- **Single unconfined production run, with a confound.** The production path with the Seatbelt profile (R1) and one production run without it (R2, which also sets `VITEST=1` to honour the unconfined seam, `completionValidation.ts:309`) both fail the same 18 named tests. R2 was run once and was not replicated. The profile is therefore not shown to be required, but this is one run, not a controlled comparison.
- **The failure is specific to the production invocation as replicated here.** Hand-built replicas with the same tree, the same dependency bridge and the same owned-validation helper pass the stub tests with no profile (R5, R7) and with the exact profile text (R3, R9 at 43/43). So what differs is something in the production invocation, which is not yet isolated.
- **Counts:** 18 named failures = 15 stub-provider tests in `tests/headless-provider-operator-script.test.ts` + 3 `launcher fallbacks (fake mise)` tests in the same file.
- **#2519 (loopback denial) is not shown to be the same class.** The failing reports contain zero `EPERM` lines, and the loopback path did not fire (`loopbackDenied` absent from the refusal).
- **The 3 launcher failures: cause suspected, not established.** Their test setup puts a fake `mise` first on `PATH` (test lines 777-778), so the real mise trust store is not obviously on their path. The line `mise ERROR Config files in $TMPDIR/mise.toml are not trusted` was captured from the agent's own shell (cwd under `$TMPDIR`), not from the failing test run (the host test log contains no `mise ERROR` line). Whether it relates to the launcher's `cd "$REPOSITORY"` (`artifacts/generated/operator-scripts/test-headless-provider-single-action.sh`, line 78) followed by `mise exec` (line 83) is SUSPECTED and unproved.
- **#2520 is merged** (PR #2520, "Hold loopback-denied named tests as unavailable (Option C of #2519)", merged 2026-11-12, merge commit `1c8ddb1a9`). It is the origin of the current `LOOPBACK_DENIED` classifier (`src/sessions/completionValidation.ts:289`). It was not changed here.

## How pre-acceptance runs (code facts)

`src/sessions/completionValidation.ts`, `runCompletionValidation`:

- **Profile** (built at line 413): `(deny default)`. Then:
  - `file-read-metadata` is allowed everywhere.
  - `file-read*` is allowed for the materialized `source`, the private `scratch`, and the `readable` set.
  - The `readable` set holds the bridged dependency trees, the pnpm store, and the Node install prefix when it lies under `$HOME` and its last path component looks like a version (line 409).
  - Candidate workspace, repository, worktree and `$HOME` are denied only in the `require-all` clause that guards the `source`/`scratch` allow. Reads under `$HOME` outside the `readable` set are therefore denied by `deny default`, not by an explicit rule.
  - `file-write*` is allowed only for `scratch` and `/dev/null`.
  - There is no `network*` rule, so loopback bind and connect are denied.
  - The profile lists no system library paths. The profile does run `node` in R1, so macOS does not need them listed, but this is not separately tested.
- **Env:** `PATH` is `source/node_modules/.bin:<node dir>:/usr/bin:/bin:/usr/sbin:/sbin`. `HOME` and `TMPDIR` are `scratch`. Also `NODE_ENV=test`, `CI=1`, `COREPACK_ENABLE_NETWORK=0`.
- **Launch:** `runOwnedValidation` (`src/sessions/preservationProcessLifecycle.ts`) spawns a helper, which wraps argv in `/usr/bin/sandbox-exec -p <profile>`.
- **Unconfined seam:** line 309 honours `unconfinedForTests` only when `process.env.VITEST` is set. R2 set `VITEST=1`, so it ran unconfined. R1 did not, so it ran under the profile.
- **Loopback classifier:** `LOOPBACK_DENIED` (line 289) is tested on the first line of each failure, and only when every failing test matches. Otherwise the completion is refused without `loopbackDenied`. It excludes `AssertionError`.
- **Nesting:** `sandbox-exec` run inside the agent's own Seatbelt fails with `sandbox_apply: Operation not permitted`, so R1 required an unsandboxed shell. The repository notes say the same: "the Seatbelt validation cannot nest inside the agent sandbox" (`docs/notes-to-self.md`, the headless-provider section, around line 306).

## Reproduction

| # | Run (same test file, same code head) | Result | Stub-provider tests (15) |
|---|---|---|---|
| R0 | Host, unsandboxed, `vitest run tests/headless-provider-operator-script.test.ts` (UNRETAINED) | 40 pass, 3 fail (the launcher tests) | all pass |
| R1 | Production `validateCompletionCandidate` under the profile (no `VITEST`). UNRETAINED. Three such runs were refused. Two of them (the keep run and the evidence run) have reports listing 18 failures; the first run's listing was truncated at 10 | refused, vitest exit 1; `loopbackDenied` absent, `hostFault` false | 15 fail |
| R2 | Production call with `VITEST=1`, so the unconfined seam is honoured. Single run. UNRETAINED; its report lists 18 failures | refused, same 18 failures | 15 fail |
| R3 | Hand-built replica: exact profile text, exact env, `git archive HEAD` tree, bridged deps, direct spawn (UNRETAINED) | 43/43 pass | all pass |
| R4 | R3 with scratch under the host `$TMPDIR` (UNRETAINED) | 40 pass, 3 fail (= R0) | all pass |
| R5 | R3 through `runOwnedValidation`, no profile (UNRETAINED) | 40 pass, 3 fail | all pass |
| R6 | R5 with the real `bridgeCompletionDependencies` in place of the hand bridge (UNRETAINED) | 40 pass, 3 fail | all pass |
| R7 | R3 with no profile, real environment (UNRETAINED) | 40 pass, 3 fail | all pass |
| R8 | R3 with no profile, scrubbed environment (UNRETAINED) | 42 pass, 1 fail | 1 fail (a codex table assertion, `FAIL  provider exited 0`) |
| R9 | R3 with `(allow network*)` added to the profile (UNRETAINED) | 43/43 pass | all pass |

Of the replicas, only R3 and R9 pass 43/43. R4 to R7 pass every stub-provider test and fail only the three launcher tests. R8 fails one stub-provider test.

Other checks (UNRETAINED):

- `diff -rq` of the production materialized `source` against the R6 `source`, excluding `node_modules` and `scratch`: 0 differences, apart from symlink-loop noise under `.claude/skills`. Both trees have 106 executable files.
- The production bridge contains `tsx`, `vitest` and `commander`, and `apps/*` member trees. R6 used the same bridge function and still passed the stub tests.

## Failure lines (UNRETAINED: from the R1 keep run's and R2's reports in agent scratch)

Those reports are not committed. The keep-run report lists 43 tests, 25 passing and 18 failing. `grep -c 'EPERM\|Operation not permitted'` on it returns `0`. All 18 failing tests, first failure line of each:

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

## Competing explanations

| # | Explanation | Verdict | Evidence |
|---|---|---|---|
| E1 | The profile denies a read, exec or write the stub providers need (HOME/config, temp, PATH) | Not shown, one unreplicated run | R2 (single, with `VITEST=1`) fails with no profile. R3 and R9 pass under the exact profile text in replicas, not in the production path. |
| E2 | Loopback denial, the same class as #2519 | Not shown to apply to these 15 | Zero `EPERM` lines in the unretained reports. The classifier did not fire. |
| E3 | Network guard | Not shown | R9 passes with `network*` allowed, but R9 is a replica, not the production path. |
| E4 | mise trust (untrusted `$TMPDIR/mise.toml`) | SUSPECTED for the 3 launcher tests only | The captured line came from the agent shell, not the test run. Those tests put a fake `mise` first on `PATH`. R0 reproduces the same 3. The 15 stub tests pass on host. |
| E5 | The production invocation differs from the replicas | Supported as the locus; the step is not isolated | R1 and R2 fail. R3 to R7 pass with the same tree, the same bridge and the same helper. |
| E6 | Timing or load flakiness | Not supported by the runs made | The two R1 runs with listed failure sets (keep run, evidence run) and the one R2 run list the same 18 tests. The replicas R3 and R9 pass 43/43 in each run. |

## What remains unproved

1. **Which step of the production invocation causes it.** Not isolated: the configured `node --version` command that runs first in production; `bindCheckDefinitions` and the snapshot; the driver environment (`VITEST` is set only in R2); the `workspace` argument.
2. **Whether the profile is required.** Only one unconfined production run exists, and it also sets `VITEST=1`. No second unconfined production run was made.
3. **The provider-level cause of each stub failure.** The test's `afterEach` (test line 46) removes the temp directories the harness creates, so the provider receipts and logs were not kept. The assertions show only the outcome.
4. **Whether the launcher failures relate to mise trust.** SUSPECTED only.
5. **Whether the worker's host reproduces it.** Only this host was tested.

## Suggested next proving steps (no fix proposed)

- Keep the failing runs' receipts. Two concrete options, both in a scratch copy of the materialized source and not committed: (a) pass `keep: true` into the harness calls the failing tests make, which the harness supports through its `keep` option; or (b) replace the `afterEach` cleanup on test line 46 with a copy of each `directories` entry into a scratch folder before it is removed. Then run the production path unconfined with `VITEST=1` and read the first failure detail of one failing test.
- Run the production path unconfined a second time, and bisect one change at a time: first remove the `node --version` pre-run, then move the `workspace` argument.
- For the launcher tests, check whether the real mise is ever invoked on their path (the fake one is first on `PATH`).
- Keep the #2520 classifier unchanged. Any change must not accept `AssertionError` or a generic exit-1.

## Reproducing the results

No artifacts are committed. The replica scripts, the driver files and the production-run reports lived in the agent's scratch directory and are UNRETAINED. The commands below reproduce them.

Driver for R1 and R2 (a small `.mts` file run with `node --import tsx` from the worktree root; `<WT>` is the worktree, `<WS>` a directory outside it):

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
- R2: `VITEST=1 node --import tsx driver.mts <WS>`, also unsandboxed.
- R0: `node scripts/bridge-worktree-deps.mjs`, then `node node_modules/vitest/vitest.mjs run tests/headless-provider-operator-script.test.ts --reporter=json --outputFile.json=<SCRATCH>/host.json` from the worktree.
- Zero-EPERM check: `grep -c 'EPERM\|Operation not permitted' <report.json>`, where the report is the vitest JSON file in the validation scratch root while the run is kept.
- Tree comparison: `diff -rq --exclude=node_modules --exclude=scratch <production source> <replica source> | grep -v 'Directory loop'`.
- Replicas R3 to R9: one vitest command per variant, `node node_modules/vitest/vitest.mjs run tests/headless-provider-operator-script.test.ts --maxWorkers=2 --reporter=json --outputFile.json=<report>`, in a source tree from `git archive HEAD`, with `HOME` and `TMPDIR` set to a scratch folder, `PATH` as in the Env bullet, and the profile or no profile as listed. The replica script itself is not retained.

## QA plan

- The PR diff contains only this file.
- Re-run R0 on a clean checkout. Expect the 3 launcher failures on this host, and no stub-provider failures.
- Re-run R1 from an unsandboxed macOS shell with the driver above. Expect `status: "refused"`, `loopbackDenied` absent, 18 failing named tests, and no `EPERM` in the report.
- Confirm `src/sessions/completionValidation.ts` is unchanged by this PR.
