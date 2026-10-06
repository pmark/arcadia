# QA plan consistency replay

`scripts/qa-plan-consistency.ts` checks one preserved candidate offline: does
the host Operator QA plan in its pull-request body agree with the pull request
as GitHub reports it? It reproduces
[Issue #987](https://github.com/pmark/arcadia/issues/987) (see also
[#989](https://github.com/pmark/arcadia/issues/989)) from rehearsal run 5's
preserved PR #6 in about a second, with no model, no network and no GitHub
write.

## What it does

1. Copies the candidate repository into a throwaway `git clone --mirror` under
   the system temporary directory, and deletes the copy afterwards. The source
   repository is only read; its refs, index and working tree stay unchanged.
2. Re-renders the plan through `renderPreservedOperatorQaPlan`
   (`src/sessions/candidatePreservation.ts`). That is host preservation's own
   path: the real `renderOperatorQaPlan` fed by the same Git reads (changed
   files from the launch base revision to the candidate commit, and which named
   paths exist at the commit).
3. Reads what the rendered plan tells the operator (its Base line, its Candidate
   commit and its Step 2 "exactly N changed files" list) and compares that with
   the PR metadata: base branch, base revision, head revision, file count, file
   paths, and each file's status where GitHub's `changeType` is `ADDED`,
   `MODIFIED` or `DELETED`.

Exit `0`: consistent. Exit `1`: at least one mismatch, each with the exact
differing values. Exit `2`: the replay could not run (bad arguments, a ref that
is not a commit, unreadable Git, a refused plan). An exit `2` never means
consistent.

## Pointing it at a preserved candidate

```sh
node --import tsx scripts/qa-plan-consistency.ts \
  --repo <candidate repository> \
  --pr <QA attempt directory | evidence.json> \
  [--receipt <receipt.json>] [--base <ref|sha>] [--commit <sha>] \
  [--branch <name>] [--base-branch <name>] \
  [--plan-source <plan-source.json>] [--patch <candidate.patch>] [--json]
```

- `--pr`: the PR metadata as GitHub reports it (`gh pr view --json` fields
  `baseRefName`, `baseRefOid`, `headRefName`, `headRefOid`, `files`, `body`).
  QA's `artifacts/qa/pull-requests/<repo>/<number>/<head>/attempts/<attempt>/evidence.json`
  is exactly that. Given the attempt directory, the replay also reads its
  `candidate.patch`, the patch the reviewer saw, and reports whether the patch
  touches the same files as the PR. That comparison is informational and does not
  gate the exit code.
- `--base`: the launch base revision the host used. For a past candidate, take
  it from the preservation receipt: the local base branch has usually moved since
  launch. `--receipt` reads a receipt row (`sqlite3 -json` output) and supplies
  `--repo`, `--base`, `--commit`, `--branch` and `--base-branch` unless they are
  given. Without either flag, the base is the local branch `refs/heads/<base branch>`
  as it is now, where the base branch is `--base-branch`, else the receipt's
  `base_branch`, else the PR's `baseRefName`. That is how the host launches a fresh
  Session (`git rev-parse <base>` in `src/sessions/launch.ts`).
- `--plan-source`: the Action's governed source,
  `{"actionKey", "action": {"title", "acceptanceCriteria"}, "validationCommands"}`
  (or an `OperatorQaPlanSource`). The base and the file list do not depend on it.
  Without it, a placeholder source is used and "Published plan" reads "differs".
  With it, "Published plan: identical to this re-render" proves that the replay
  rendered the same bytes the host published.
- `--json`: print the report (schema `arcadia-qa-plan-consistency-v1`) instead
  of the human summary. Read `consistent` and `mismatches`. Each mismatch is one
  of: `base-branch`, `base-revision` or `head-revision` (`plan`, `pullRequest`);
  `file-count` (`plan`, `pullRequest`); `files` (`onlyInPlan`,
  `onlyInPullRequest`); or `file-status` (`differences[]` of `path`, `plan`,
  `pullRequest`).

## Replaying live preserved state is read-only and never committed

Live rehearsal data (the fixture clone, the workspace artifacts and database)
is only read. Query the receipt with `sqlite3 -readonly`. Keep the receipt and
plan-source files in a scratch directory, never in this repository. The
checked-in test `tests/qa-plan-pr-consistency.test.ts` uses synthetic
temporary Git repositories only.

## Run 5 reproduction (Issue #987)

Observed on 2026-10-05 against fixture `pmark/arcadia-three-action-rehearsal-20261004`
(clone `/Users/pmark/tmp/arcadia-three-action-rehearsal`). The plan-source files
were transcribed from the fixture Plan at `f68ec48`
(`docs/plans/autonomous-three-action-rehearsal.md`, the Action's `title` and
`acceptance_criteria`, validation `node scripts/check-rehearsal.mjs`).

```sh
S=<scratch dir>
DB=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/database/arcadia.sqlite3
QA=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/artifacts/qa/pull-requests/pmark-arcadia-three-action-rehearsal-20261004
sqlite3 -readonly -json "$DB" "select repository_path, branch, base_branch, base_revision, commit_sha
  from candidate_preservation_receipts where commit_sha='69eb7d6283447270a9a16e540f7d4f5f2e3427fc'
  order by created_at desc limit 1" > "$S/pr6-receipt.json"
node --import tsx scripts/qa-plan-consistency.ts --receipt "$S/pr6-receipt.json" \
  --pr "$QA/6/69eb7d6283447270a9a16e540f7d4f5f2e3427fc/attempts/2026-10-06T03-32-26-510Z-bf5850ebd872" \
  --plan-source "$S/pr6-plan-source.json"
```

PR #6 (Action 2, `claude/transform-start-marker-20261006T032821535Z` at
`69eb7d62`), exit `1`:

```text
QA plan consistency: MISMATCH (4 findings) in 243 ms
Candidate  claude/transform-start-marker-20261006T032821535Z at 69eb7d628344; host base main at f68ec48ed4ff (receipt base_revision)
Plan       base main at f68ec48ed4ff95772fee108258d401158c26a54d; 6 changed files
PR #6      base main at 7214de28da2745c66f89d81e124e2ab2de05b2ca; 7 changed files; head 69eb7d628344
- base-revision: plan f68ec48ed4ff95772fee108258d401158c26a54d, PR 7214de28da2745c66f89d81e124e2ab2de05b2ca
- file-count: plan 6, PR 7
- files only in the PR: .arcadia/asks/archive/agent-ask-complete-write-start-marker-run5-2026-10-06.yaml
- file-status: MARKER.md plan M, PR ADDED; MISSION_LOG.md plan M, PR ADDED
Published plan: identical to this re-render
Reviewer patch: 7 files, same set as the PR files (informational)
```

The same command for PR #5 (Action 1, `claude/write-start-marker-20261006T032202909Z`
at `f68ec48e`, receipt base `7214de28`, attempt
`5/f68ec48ed4ff95772fee108258d401158c26a54d/attempts/2026-10-06T03-27-45-381Z-d7156201a058`),
exit `0`:

```text
QA plan consistency: CONSISTENT in 350 ms
Candidate  claude/write-start-marker-20261006T032202909Z at f68ec48ed4ff; host base main at 7214de28da27 (receipt base_revision)
Plan       base main at 7214de28da2745c66f89d81e124e2ab2de05b2ca; 5 changed files
PR #5      base main at 7214de28da2745c66f89d81e124e2ab2de05b2ca; 5 changed files; head f68ec48ed4ff
Published plan: identical to this re-render
Reviewer patch: 5 files, same set as the PR files (informational)
```

How to read PR #6: the host diffed from the local `main` (`f68ec48`, Action 1
fast-forwarded locally). GitHub's base stayed at `7214de28`, so the PR also
carries Action 1's commits. Its archived Ask appears only in the PR, and
`MARKER.md` and `MISSION_LOG.md` are additions to the PR but modifications to
the plan.

## The expected-failure test the fix must flip

`tests/qa-plan-pr-consistency.test.ts` builds that serial state synthetically.
A bare "GitHub" repository holds `main` at M0. The host clone fast-forwards
Action 1 into its local `main` (M1) without pushing, and Action 2 branches from
M1, with PR metadata based on M0. The test
`serial Action 2: the host plan agrees with its PR` is marked `it.fails`. While
#987 stands, its assertion fails and the suite stays green. The pinned
diagnostic test beside it asserts the exact mismatch.

When the fix lands in the host plan-rendering path (at or below
`renderPreservedOperatorQaPlan`), both tests fail. The change
then turns `it.fails` into `it` and updates the pinned diagnostic. One example
of such a fix is rendering against the merge base with `origin/<base>`; a
temporary edit of that shape was verified to flip exactly those two tests. The test passes the
host base (`base: "main"`) straight into the replay. A fix anywhere else
therefore does not flip the marker by itself. Examples are recording a different
base at launch (`src/sessions/launch.ts`), adjusting the base in the preservation
caller, stacking the PR on the previous candidate branch, or pushing the base
after integration. Such a fix must update the test's base input or the fixture
to its new world in the same pull request, because a marker the fix never
exercises would stay green.

Limits: `gh pr view --json files` may truncate very large PRs. The plan lists at
most 200 files; above that only the stated count is compared. The plan uses
`--no-renames`, so a file GitHub reports as `RENAMED` or `COPIED` (one entry,
new path) appears in the plan as `D` old plus `A` new. That shows as a
`file-count` and `files` mismatch even when the bases agree; read the old path
in `onlyInPlan` as a possible rename. A path with control characters is printed
with `?` by the renderer and so mismatches. The informational patch file list
does not decode Git's quoted `"a/..."` headers. The replay refuses (exit `2`)
when the renderer's format no longer parses.
