# Rehearsal reviewer pre-flight smoke (reference code)

**Status: reference code, not wired into the operator scripts.** These scripts were written during the 2026-10-06 release-manager session to predict a live rehearsal's independent-review verdicts before spending an operator G7 press. They contain that session's absolute scratch paths (`/private/tmp/claude-501/.../scratchpad/...`). Adapt the paths before running; runbook section 10, recommendation 2, is to turn this into a maintained script.

## What it does
It runs Arcadia's **real** `runQaPrReviewCommand` (the real reviewer profile, for example `codex_planning` on `codex-cli`, and the real sandbox preflight) in a **temporary workspace**. Only `gh` is stubbed: `pr view`, `commits` and `compare` are served from a preserved attempt's `evidence.json` and `candidate.patch` or from a simulated repository, and every other `gh` call is refused. It writes nothing to GitHub, the live workspace or the fixture. After each use, check that the live `artifacts/qa` file list is unchanged and that the fixture clone's `git status` is clean.

- `qa986/`: the #986 check. It re-renders run 5's PR #5 Operator QA plan with the candidate renderer (`render.mts`) and reviews it (`smoke.mts`, `run.sh <label>`). `render6.mts` and `smoke6.mts` simulate run 5's PR #6 with a corrected (stacked) base.
- `run8/`: the run-8 check. `build-repo.sh` builds a throwaway git repository whose base is the run-8 reset's rendered fixture tree (from a reset `--dry-run` evidence directory, `.fixture-amended`), with Action 1's work commit and a settlement-shaped commit on top. `build-evidence.mts` assembles the PR evidence, and `smoke.mts` / `run.sh <label>` reviews it (`SMOKE_DRY=1` first, to check plumbing without a model call).

## What is not faithful
The settlement commit is hand-built rather than written by `arcadia agent-ask settle`, and preservation is not run. Branch names, commit hashes, CI status and the validation record are borrowed from the preserved run. The model call is nondeterministic, so use several attempts, not one.

## Results so far
- #986, run 5's PR #5 shape: PASS 3 of 3 on the final wording. PR #6 stacked shape: PASS 2 of 2.
- Run-8 Action 1 shape with nine-Action wording: PASS 1, **FAIL 1** (MEDIUM "Managed documents": a done Action keeps its original `next_action`). See runbook section 9.
