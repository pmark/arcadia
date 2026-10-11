# Rehearsal reviewer pre-flight smoke

**Status: maintained as `scripts/rehearsal-reviewer-smoke.ts`** (tested by `tests/rehearsal-reviewer-smoke.test.ts`, GitHub Issue #1225). The `run8/` and `qa986/` directories here are retained history: reference code from the 2026-10-06 release-manager session, with that session's absolute scratch paths, kept so the original checks stay reproducible in principle. They are not wired into anything and are not the way to run the smoke now.

## Run it
```
mise exec -- node --import tsx scripts/rehearsal-reviewer-smoke.ts --dry              # build, settle and assert; no model call
mise exec -- node --import tsx scripts/rehearsal-reviewer-smoke.ts --spend-approved   # live: 3 QA + 3 code-review calls
```
It builds the rendered Action shape from the fixture itself, so it is N-neutral: a single-Action reopen or a nine-Action chain reset renders the same way. The last line is `SMOKE GATE: PASS`, `FAIL` or `DRY-OK`; the exit status is 0 only for `PASS` or `DRY-OK` with every deterministic assertion held (2 for a refusal).

| Flag | Default | Meaning |
| --- | --- | --- |
| `--fixture <path>` | `/Users/pmark/tmp/arcadia-three-action-rehearsal` | The fixture repository. Only cloned (`git clone --no-hardlinks`) into the out dir; its `git status` and HEAD are checked unchanged afterwards. |
| `--base <rev>` | newest commit whose subject starts with `Reopen ` or `Reset the rehearsal fixture` | The tree a single-Action or chain reset renders. |
| `--action <id>` | first Action not `done` in the Plan (`CHAIN_FIXTURE.planFile`) at the base | The Action to render, settle and review. |
| `--qa <n>` / `--code-review <n>` | 3 / 3 | Reviewer calls per role. The model is nondeterministic: use three attempts per role. |
| `--dry` (or `SMOKE_DRY=1`) | off | Build everything and run every deterministic assertion; the reviewer model process is intercepted and never run (the real sandbox preflight still runs, so `DRY-OK` also shows the reviewer is reachable). |
| `--spend-approved` | off | Required for any non-dry run. Without it a live run refuses before cloning anything. |
| `--out <dir>` | fresh dir under `$TMPDIR` | Everything the script writes (clone, throwaway workspaces, PR evidence, `reviewer-calls.log`, `smoke-result.json`). It is printed, and must be empty if given. |
| `--live-workspace <path>` | `/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover` | Read only: preserved attempt evidence under `artifacts/qa/` and `config/coding-agent-profiles.json` and `config/provider-adapters.json`. |

**Steps.**
(a) Clone the fixture and check out the base.
(b) Replay the product files of the newest merged `Candidate: <action-id>` commit (everything outside `.arcadia/`, `MISSION_LOG.md`, `PROJECT.md`, `docs/plans/`) as one work commit; refuse by name when there is none.
(c) Draft, preview and settle a real `complete` Agent Ask in a throwaway workspace: one `met` evidence entry per declared criterion, verbatim and in order, and the completion request id the Plan's `next_action` names. `arcadia agent-ask settle` itself writes the settlement commit.
(d) Assert deterministically that the Action is `done`, its `next_action` is exactly `Completed via Agent Ask <request id>; no further action.`, pending sibling Actions' `next_action` is unchanged, and the settlement commit touches only governed-record paths (and that the settled checkout is clean).
(e) Render the PR body with the real Operator QA plan renderer and the newest preserved attempt's validation-evidence tail, with head and tree replaced (a clearly labelled synthetic tail when none exists).
(f) Run the real `runQaPrReviewCommand`, QA role and `code-review` role, in a temporary workspace with only `gh` stubbed.
(g) Print the call table, check the live `artifacts/qa` and `artifacts/code-review` file lists and the fixture are unchanged, and print the gate.

**Spend rule.** A live run makes real reviewer-model calls (quota or spend). Run `--dry` first. Pass `--spend-approved` only after the operator's own yes for that spend in the current session: no standing permission, release-manager permission or agent judgment substitutes for it. It stays subject to the Cost Minimization Directive: three attempts per role is the ceiling, and a failed attempt is read before another is bought.

## What it does
It runs Arcadia's **real** `runQaPrReviewCommand` (the real reviewer profile, for example `codex_planning` on `codex-cli`, and the real sandbox preflight) in a **temporary workspace**. Only `gh` is stubbed: `pr view`, `commits` and `compare` are served from the simulated pull request; every other `gh` call is refused and logged (a refused call fails the run). It writes nothing to GitHub, the live workspace or the fixture.

## What is not faithful
The settlement commit is the real `agent-ask settle` output, but preservation is not run: the work commit is replayed from the fixture's merged candidate rather than made by a Session, and there is no preservation receipt. The head branch name is synthesized in the host's branch shape; the PR number, check rollup and validation record are borrowed from the newest preserved attempt (or are labelled synthetic). The reviewer workspace registers the fixture itself, read only, as the Project repository so the sandbox preflight sees a repository outside any temporary directory as it does live. The model call is nondeterministic, so use three attempts per role, not one. For a non-first Action the replay is that candidate's product files only, so earlier Actions' work is absent unless the base already contains it.

## Retained history: `run8/` and `qa986/`
- `qa986/`: the #986 check. It re-renders run 5's PR #5 Operator QA plan with the candidate renderer (`render.mts`) and reviews it (`smoke.mts`, `run.sh <label>`). `render6.mts` and `smoke6.mts` simulate run 5's PR #6 with a corrected (stacked) base. Its inputs (`pr5-evidence-attempt1.json`, `candidate.patch`) and the worktree it pointed at were not preserved, so it cannot be rerun as is.
- `run8/`: the run-8 check, the template the maintained script generalizes. `build-repo.sh` builds a throwaway git repository whose base is the run-8 reset's rendered fixture tree (from a reset `--dry-run` evidence directory that no longer exists), with Action 1's work commit and a hand-built settlement-shaped commit. `build-evidence.mts` assembles the PR evidence, and `smoke.mts` / `run.sh <label>` reviews it.

## Results so far
- #986, run 5's PR #5 shape: PASS 3 of 3 on the final wording. PR #6 stacked shape: PASS 2 of 2.
- Run-8 Action 1 shape with nine-Action wording: PASS 1, **FAIL 1** (MEDIUM "Managed documents": a done Action keeps its original `next_action`). See runbook section 9; the source fix is PR #1212 and the maintained script asserts it.
