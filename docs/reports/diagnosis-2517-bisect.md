# Diagnosis: #2517 stub-provider failures, bisect of the production invocation

Research only (Issue #2517; follow-up to the diagnosis report `docs/reports/diagnosis-2517-stub-provider-pre-acceptance.md`, merged in #2538). No source or test change. Code read at `origin/main` cb5d88f96.

Labels: **single run** means one run of that configuration. **UNRETAINED** means the artifact lives only in the agent's scratch directory `/tmp/claude-501/diag2517` and is not in this PR. Line numbers were checked against `origin/main` with `git show`.

## Verdict

- **Root cause of the 15 stub-provider failures (strong, one controlled pair of runs plus the receipts):** the candidate materializer writes non-executable files read-only (mode `0444`). The test's experiment setup copies the default `config/defaults/coding-agent-profiles.json` into the experiment workspace, keeps that read-only mode, and then writes it. The write fails with `EACCES`. The provider never runs, so each stub test sees `failed` instead of `succeeded`.
- **The Seatbelt profile is not the cause.** The failures reproduce with the production validator run unconfined (`unconfinedForTests`, single run). The profile is not needed to reproduce them.
- **Single-factor control (single run each):** the same production invocation, changing only the materializer's mode (`0444` to `0644`, `0555` to `0755`) in a scratch copy of the validator, turns 18 failing tests into 3. The 15 stub tests all pass. The 3 that remain are the launcher tests.
- **The 3 launcher failures are not explained.** They fail the same way on the host unconfined and in the validator run, with exit status `1` where the test expects `7`. No `mise` trust text appears in the host output. Their cause is not established here.
- **Not a fix.** No fix is implemented. See "Recommended fix".

## Reproduction (all single runs, unconfined, UNRETAINED unless stated)

Fixture: `git archive origin/main` of this checkout, committed as a disposable repository at base `db35282b43b94d8d778aca374d502e35d03b97c0`. The first attempt used `git add -A`, which dropped the gitignored-but-tracked `artifacts/generated/`. The materialized tree then lacked the test's JSON, and the file failed with ENOENT before any case ran. That run is discarded and is not evidence. The corrected base tracks all 138 files under `artifacts/generated/operator-scripts`, as `origin/main` does.

Driver (scratch, not committed): calls `validateCompletionCandidate` with `repository` = fixture, `base` = fixture base, `workspace` = an empty scratch directory, `commands` = `["node --version"]`, `acceptanceCriteria` = `["tests/headless-provider-operator-script.test.ts still passes all of its tests"]`, `dependencyRoot` = this worktree (already bridged), `unconfinedForTests: true`, run with `VITEST=1` in the driver's environment. The validator's child process gets its own explicit environment, so `VITEST` does not reach the inner tests.

A scratch copy of `src/sessions/completionValidation.ts` (line 498) keeps the validator root when `DIAG_KEEP_ROOT` is set, so the materialized tree and vitest JSON can be read afterwards. The copy changes nothing else.

| Run | Change from baseline | Result (from its vitest JSON) | Retained |
|---|---|---|---|
| A (baseline) | none | refused. 43 tests: 25 passed, 18 failed. The 18 are the 15 stub tests plus the 3 launcher tests | `report-A.json` (UNRETAINED) |
| R (receipts) | baseline plus a scratch copy of the test file whose `afterEach` copies each run directory to a receipts folder before cleanup (see "Receipts") | refused, same 18 failures | 74 receipt directories (UNRETAINED) |
| F1 | only `candidateSnapshot.ts:347` mode changed to `0o644`/`0o755` in the validator copy | refused. 43 tests: 40 passed, 3 failed. The 3 failing are the launcher tests | `report-F1.json` (UNRETAINED) |
| C4 (invalid, see below) | `initWorkspace.ts:69` plus `chmodSync(…,0o644)` in the validator copy | refused, same 18 failures | `report-C4.json` (UNRETAINED) |

**C4 is not a valid control.** The inner tests run the candidate's own `src/` from the materialized tree, not the validator copy's `src/`. So a patch to `initWorkspace.ts` in the validator copy never reaches the experiment workspace. The C4 result therefore says nothing about whether a config-only chmod fixes it. A valid config-only variant would need the change in the candidate tree (a candidate commit) and was not run.

**F1 is the only single-factor control.** Baseline A and F1 use the same driver, the same fixture base, the same scratch validator copy with the same `DIAG_KEEP_ROOT` edit, and the same configuration. The only difference is the materializer mode line. Strength: one run each. The result is repeated across the 15 cases, but there is no second run of either configuration.

## Provider-level receipt for one failing case (verified in UNRETAINED receipts)

Case: `accepts a completion the agent settled itself`. Its preserved run directory is `…accepts_a_completio__headless-run-x6Ds5J/runs/run-1/receipt.json`. Relevant fields, exact:

- `"outcome": "failed"`, `"stage": "complete"`, `"reason": "no provider passed every criterion"`
- providers[0]: `"provider": "codex"`, `"outcome": "FAIL"`, `"reason": "EACCES: permission denied, open '/private/var/folders/cm/…/T/arcadia-completion-7E43QJ/scratch/headless-base-gQpcuW/arcadia-headless-provider-test-dlWcZV/codex/exp-headless-codex/config/coding-agent-profiles.json'"`
- failureDetails: `"criterion": "setup"`, `"label": "the attempt did not reach a judged result"`, logLines: `"(the provider log is empty: the provider never produced output)"`

The stub's call log for the same case (`calls.log` in the preserved base directory) records only `codex login status` and `codex exec --help`. No `codex exec` ran.

Tally over all 74 preserved receipt files (UNRETAINED): every provider `FAIL` is this `EACCES` on `config/coding-agent-profiles.json`, for codex, opencode and claude variants. The other reasons are `SKIPPED` (not logged in, or not on PATH, which is the test's intended path for those cases) and one `NOPROV` from a wall-clock test (Decision 0082 window ended 2026-10-18, because the system date is later). That last one is a separate, date-dependent test and is not part of the 18.

## Mechanism (verified at origin/main cb5d88f96)

1. `src/sessions/candidateSnapshot.ts:347`: `writeFileSync(entry.target, blob, { mode: entry.mode === "100755" ? 0o555 : 0o444 });` Every non-executable materialized blob is read-only. This is the materializer that `runCompletionValidation` uses (`src/sessions/completionValidation.ts:355`: `materializeCandidateTree(candidate.repository, tree, source)`). The production callers are `src/sessions/reconciliation.ts:523`, `:608` and `:1170`, which call `validateCompletionCandidate`. So the real pre-acceptance path materializes through this line.
2. `src/workspace/initWorkspace.ts:69`: `copyFileSync(getDefaultRegistryPath(fileName), destination);`. `copyFileSync` copies the source's mode. `getDefaultRegistryPath` resolves `config/defaults/<name>` against the current directory first (`src/intent/registries.ts:88-92`), and the inner test's cwd is the materialized source. So the copy is read-only.
3. `src/operatorActions/headlessProviderTest.ts:502-505` (`setBuildProfile`): `readFileSync(file)`, then `writeFileSync(file, …)`. On the read-only copy this throws `EACCES`. That is the error in the receipt.

Verified state of the materialized tree: `ls -l` on the retained validator root's `config/defaults/*.json` shows `-r--r--r--` for every file (UNRETAINED, the root was kept by the scratch copy).

Verified git modes: `git ls-files -s config/defaults` on this checkout lists 8 entries, all `100644`. A `git archive` extract has `-rw-r--r--` on `config/defaults/coding-agent-profiles.json` (verified on the fixture).

## Why the host test run and the replicas pass (partly inferred)

- Verified: this worktree's `config/defaults/coding-agent-profiles.json` is `-rw-r--r--` (a git checkout, so `100644`). The host vitest run of the file uses that tree and never goes through the materializer, so the copy is writable and the 15 stub tests pass on the host (report R0 and this worktree's launcher-only run).
- Inferred, not re-run: the report's replicas (R3 to R9) used `git archive` trees, which have `0644` defaults (verified above on the fixture). That is the likely reason they pass. Their exact trees were not re-checked.
- Inferred, not verified: CI runs the file from a normal checkout, so it has `0644` files. CI was not inspected.

## Launcher failures (not explained)

Failing: `writes a fallback receipt and handoff when the helper dies…` (`expected 1 to be 7`, test line 788), `forwards SIGTERM to the helper…` (`the fake helper never started`, line 812), `trusts a receipt the helper wrote and exits 0…` (`expected 1 to be +0`, line 827).

- The launcher script runs `cd "$REPOSITORY"` (`artifacts/generated/operator-scripts/test-headless-provider-single-action.sh:78`) and `mise exec -- node …` (line 83), with the fake `mise` first on PATH from the test (`tests/headless-provider-operator-script.test.ts:777-782`).
- Checked: the launcher-only run on the host (`node node_modules/vitest/vitest.mjs run tests/headless-provider-operator-script.test.ts -t "launcher fallbacks"`, single run) fails the same 3 tests. Its output contains no `mise ERROR` and no `not trusted` text. So the mise-trust hypothesis from the earlier report has no support in this run.
- Not checked: why the script exits `1`. The script's own explicit exits are `2`. The cause is open.
- Note: the `mise ERROR … not trusted` line seen earlier was printed by the agent shell's `cd` hook when the shell entered the fixture directory, which has a `mise.toml`. It was not printed by the test.

## What is proved

1. The 15 stub-provider failures are, in the runs above, setup failures (`EACCES` on the read-only copied profile config), not assertion failures. (Strong: the receipts show it directly.)
2. The Seatbelt profile is not required to reproduce them. (Single unconfined run, same 18 failures as the report's profiled runs.)
3. Changing only the materializer's non-executable mode from `0444` to `0644` takes the production invocation from 18 failing to 3 failing, and the 3 are the launcher tests. (Single run; one controlled pair.)
4. The mode in the materialized tree is read-only because of `candidateSnapshot.ts:347`, and the EACCES comes from the copy at `initWorkspace.ts:69` followed by the write at `headlessProviderTest.ts:502-505`.

## What remains unproved

- That the `0444` mode is the only factor. F1 is one run. The node `--version` pre-run, `bindCheckDefinitions`, the workspace argument and the dependency bridge were not flipped, because F1 already flipped the failures (the coordinator's instruction was to skip them unless F1 did not flip).
- A valid config-only fix. C4 was invalid (see above). A candidate-tree change was not run.
- That `0444` is deliberate protection for candidate content. The code gives no comment on line 347. This is inferred from the mode choice (`0555` for executables, `0444` for others) and the materializer's purpose. It is not verified.
- Whether CI uses the same materializer. CI was not inspected.
- The launcher failures' cause (exit `1`, not `7`).
- The report's replica trees: the `git archive` reasoning is inferred, not re-run.

## Recommended fix (described only, not implemented)

The `0444` on materialized candidate files is the protection the materializer provides, and the candidate's own files should stay read-only. The change should therefore be on the harness side, not in the snapshot.

- Preferred: in the test harness setup (`src/operatorActions/headlessProviderTest.ts`, before `setBuildProfile` at line 502), make the experiment workspace's copied config files writable (`chmodSync(file, 0o644)`) after the CLI creates them. This affects only the test fixture, not product copy semantics. A product-side `chmod` in `initWorkspace.ts:69` would change behavior for every copied registry; that is a larger and less safe change.
- Do not change `candidateSnapshot.ts:347`. Changing it would make candidate files writable in the validator, which weakens the protection.

## Regression-test idea

- A test in the headless provider suite that asserts the experiment workspace's `config/coding-agent-profiles.json` (and the other copied registry files) is writable after setup, so the failure is caught directly and not as 15 provider failures.
- A test in the candidate snapshot suite that materializes a `config/defaults/*.json` blob and asserts that a `copyFileSync` followed by a write succeeds only if the harness resets the mode. This documents the coupling.

## QA plan

- Confirm the cited lines on `origin/main` (done for this report: `candidateSnapshot.ts:347`, `initWorkspace.ts:69`, `headlessProviderTest.ts:502-505`, `completionValidation.ts:355`).
- Confirm the file mode with `git ls-files -s config/defaults/coding-agent-profiles.json` (`100644`) and with `ls -l` on this worktree (`-rw-r--r--`).
- Re-run the launcher-only host test to confirm the 3-failure set (done in this run).
- Reviewer re-check: the reproduction needs a scratch validator copy and a disposable fixture, which are not in the repository. A reader cannot reproduce F1 from this PR alone.

## Known limits

- Every run is a single run. No configuration was repeated.
- All scratch material is UNRETAINED: `/tmp/claude-501/diag2517` (fixture, receipts, vitest JSON, logs, scratch validator copies). The receipt copy test is a scratch commit (`34f59a05`) in a scratch clone, not pushed.
- The validator was run from a scratch copy whose only edits are the `DIAG_KEEP_ROOT` guard at line 498, plus the single factor under test in each variant.
- The host is macOS with Node 22.23.1 under `$HOME/.local/share/mise`. Other hosts were not tested.
- The date-dependent Decision 0082 test was not analyzed beyond classifying it as separate.
