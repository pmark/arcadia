# Learn lossless capture hand-off — 2026-10-15

Candidate: `/Users/pmark/.codex/worktrees/learn-lossless-capture/arcadia`  
Branch: `codex/learn-lossless-capture-20261015`  
Implementation commit: `fd50f7fba1c5b1346a4a07b1757af3e2c3024e8a`.  
Base reconciliation: Lead merged `origin/main` at `e63ef8c73` conflict-free; the merged candidate was `40712ac107468433797775362dee4504f5d6f17c` before this report-only update.
Implementer: Codex, actual model `gpt-5.6-terra`, high effort.  
Authority: operator-directed GitHub #1432. No governed Action, plan pointer, status, Ask, approval, or broader reflection worker was created or changed. The broader `build-agent-agnostic-learning-loop` Action remains open.

## Authoritative home and boundaries

Learn is the authoritative durable, scoped evidence store. `docs/notes-to-self.md` is a bounded hot cache and projected source: every removal or shortening requires prior exact-text durable receipt verification. Git history adds provenance where locally available; the importer reports shallow and unreadable history instead of claiming recovery. Learn capture/search/import/export/restore use no model calls.

## Changed paths and acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Stable zero-model capture and exact retry | `src/learning/lessons.ts` uses exact SHA-256 text/scope fingerprints and SQLite only. Replays merge evidence and observations into the version whose exact text was observed. |
| Provenance and advice lifecycle | Versions retain explicit provenance, confidence, freshness, source revision/reference, evidence, observations, and immutable correction/retraction links. Unspecified capture provenance is `observation`, not an operator statement. Search includes current and retired versions and its text renderer labels freshness/provenance. |
| Scoped access | `arcadia learn` derives `project:<slug>` from the invoking `PROJECT.md`; `arcadia` scope is explicit. Show/correct/retract reject cross-scope IDs; export is scoped. |
| Existing intake primitives | Initial capture creates a linked Back Burner `IncubatingThought`; related lesson hints reuse `normalizeEvidence`, `summarySimilarity`, and the defect duplicate threshold. |
| Lossless retention | The graph export includes stable IDs, timestamps, versions, evidence and observations. Restore validates identity/fingerprint, contiguous version sequence, pointer membership/current consistency, enum/types, hashes and supersession closure before a transaction inserts the graph. Conflicts refuse. |
| Notes and history migration | Notes entries retain the exact heading/body as stale imported evidence. `learn import-history` runs bounded `git log --all --full-history -- <Notes file>` and reads only available file snapshots, retaining revision provenance and reporting gaps. |
| Safe bounded cache maintenance | All current entries import before an explicit named eviction. `--apply` moves actual bytes into workspace custody, retains/verifies them, then exclusively installs a prepared replacement only when the source path remains absent. |
| Experiment containment | `learn export --file` and `learn cache-maintain --apply` are guarded under Decision 0082 to the experiment allowed repository root; an actual isolated CLI test refuses external mutation. |
| Agent discovery/docs | Notes cache rules, START_HERE, retained-Learn agent lookup guidance, and its index fingerprint were updated. Guidance distinguishes verified Notes remedies from unverified Learn evidence. |

## Validation receipts

- `pnpm exec vitest run tests/experiment-workspace-guard.test.ts tests/learn-lossless.test.ts` — exit 0; 47 tests passed.
- Manager-observed: `pnpm exec vitest run tests/learn-lossless.test.ts tests/notes-to-self.test.ts` — exit 0; 10 tests passed in 7.80s.
- `pnpm exec eslint src/learning/lessons.ts src/commands/learn.ts src/cli.ts src/db/schema.ts src/workspace/experimentGuard.ts tests/learn-lossless.test.ts tests/experiment-workspace-guard.test.ts` — exit 0.
- `pnpm exec tsc --noEmit` — exit 0.
- `pnpm check:agent-guidance` — exit 0.
- `pnpm check:session-ledger` — exit 0.
- `git diff --check` — recorded immediately before commit.
- Build receipt: Lead Hacker recovery directly awaited supported `pnpm build` session `92373`; it completed exit 0, with final output `$ tsc -p tsconfig.json`. The original direct output reached `eslint src test tests scripts apps/dashboard apps/discord-bot` but this implementer transport returned no exit/session receipt. Two background persistence attempts returned from their launcher with no output and left zero-byte `/private/tmp/learn-lossless-build.log` plus no `.exit` file; no build failure is inferred from those dropped receipts.

## Disposable operator/end-user QA

Run this only as bounded fixture QA before Decision 0082 expires on 2026-10-18. It creates two disposable experiment workspaces and a fixture Project repository under the first experiment's allowed root; it does not use or mutate the exclusive live workspace.

```sh
repo_root=/Users/pmark/.codex/worktrees/learn-lossless-capture/arcadia
qa_root="$(mktemp -d)"; workspace="$qa_root/workspace"; restored="$qa_root/restored"
node --import tsx "$repo_root/src/cli.ts" init "$workspace" --profile experiment
node --import tsx "$repo_root/src/cli.ts" init "$restored" --profile experiment
repo="$workspace/projects/learn-qa"; mkdir -p "$repo/docs"; cd "$repo"
cat > PROJECT.md <<'EOF'
---
arcadia: v1
type: project
slug: learn-qa
name: Learn QA
status: active
goal: Exercise durable Learn intake
updated: 2026-10-15
---
EOF
cat > docs/notes-to-self.md <<'EOF'
## Cache entry
keys: learn qa
Durable cache record with exact  spaces.
EOF
git init && git config user.email qa@example.invalid && git config user.name QA
git add PROJECT.md docs/notes-to-self.md && git commit -m 'initial Notes'
```

The commands below deliberately omit `--scope` for capture/search/show/correct: from this repository the expected scope is `project:learn-qa`. `capture_json` yields a stable `lesson_…` id; the replay leaves the correction current and appends its evidence to the first retained version.

```sh
capture_json="$(node --import tsx "$repo_root/src/cli.ts" learn 'Original advice' --evidence 'operator test evidence' --workspace "$workspace" --json)"
lesson_id="$(printf '%s' "$capture_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).data.lesson.id))')"
node --import tsx "$repo_root/src/cli.ts" learn show "$lesson_id" --workspace "$workspace"
node --import tsx "$repo_root/src/cli.ts" learn correct "$lesson_id" 'Corrected advice' --workspace "$workspace"
node --import tsx "$repo_root/src/cli.ts" learn 'Original advice' --evidence 'replay evidence belongs to v1' --workspace "$workspace"
node --import tsx "$repo_root/src/cli.ts" learn search 'Original advice' --workspace "$workspace"
node --import tsx "$repo_root/src/cli.ts" learn correct "$lesson_id" 'Retracted advice' --retract --workspace "$workspace"
```

Expected human output includes the stable lesson ID, all retained version bodies from `show`, labelled `superseded`/`retracted` historical advice in search, and the current correction/retraction without a duplicate lesson. The next commands prove the required `--file` migration, receipt-backed cache mutation, available Git history import, and lossless export/restore.

```sh
node --import tsx "$repo_root/src/cli.ts" learn import-notes --file docs/notes-to-self.md --workspace "$workspace"
cache_json="$(node --import tsx "$repo_root/src/cli.ts" learn search 'Durable cache record' --workspace "$workspace" --json)"
cache_id="$(printf '%s' "$cache_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).data.lessons[0].id))')"
node --import tsx "$repo_root/src/cli.ts" learn cache-maintain --file docs/notes-to-self.md --evict "$cache_id" --apply --workspace "$workspace"
node --import tsx "$repo_root/src/cli.ts" learn import-history --file docs/notes-to-self.md --workspace "$workspace"
node --import tsx "$repo_root/src/cli.ts" learn export --file "$repo/lessons.json" --workspace "$workspace"
node --import tsx "$repo_root/src/cli.ts" learn restore --file "$repo/lessons.json" --workspace "$restored"
node --import tsx "$repo_root/src/cli.ts" learn search 'Original advice' --scope project:learn-qa --workspace "$restored"
```

Expected output: import reports retained entries; cache maintenance prints `Evicted: lesson_…` after custody verification; history reports locally available snapshots (and any shallow/unavailable gap); export writes JSON once; restore reports its count; final search finds the retained historical version in the restored workspace. Remove the disposable directory when finished: `rm -rf "$qa_root"`.

## Internal review and custody

Independent round-one review is preserved verbatim at `docs/reviews/2026-10-15-learn-pr1435-round1.md` for draft PR #1435. Dispositions: (1) default scope now uses `enclosingProjectRoot` plus `parseDoc`; (2) Notes file paths use `resolveInvocationPath` and contained regular-file checks; (3) restore rejects a payload outside selected scope before mutation; (4) restore requires a contiguous v1→latest predecessor chain; (5) cache application now moves actual bytes into workspace artifact custody and uses exclusive replacement, restoring custody only when the path remains absent. Focused deterministic coverage now proves modified custody bytes remain searchable, a recreated source is never overwritten, a real SQLite trigger abort restores the source while retaining custody, normal eviction preserves restrictive mode, and unrelated dirty tracked/untracked fixture bytes survive. These repairs require independent round-two review; this record does not mark the findings passed.

Independent round-two review is preserved verbatim at `docs/reviews/2026-10-15-learn-pr1435-round2.md`. Its new custody-object finding is repaired with no-follow, nonblocking descriptor reads plus descriptor `fstat` after an `lstat` nonregular refusal. Symlink, directory, and supported FIFO swaps are retained in custody without import; rollback is reported as `restored`, `source-present`, or `failed` instead of being silently swallowed. The first FIFO test run was interrupted (session `86805`, exit 130) after its fixture wrote through a restored FIFO; this was a fixture issue, fixed by unlinking that source before the next ordinary write. Re-run session `60845` passed 8/8. This disposition awaits independent round-three review.

Internal diff review checked replay-after-correction behavior, literal `%`/`_` search semantics, restore pointer/graph closure and transaction rollback, path/symlink and source-byte protections, and experiment-root mutation guards. This is not the required independent PR review; the Lead owns the separate canonical review and QA processes.

Ledger custody: `docs/reports/session-ledger/20261015T1718Z-01a1405f-ebaa-7850-8083-88f871e17d45.json` records the parent Lead with truthful pending-review `split` outcome. The manager checkpoint `/tmp/learn-release-checkpoint-20261015.json` supplied scope/authority and preparation-receipt custody; it is not copied into the repository.

Loaded instructions/evidence: `AGENTS.md` (10,118 bytes); `.agents/skills/arcadia-role/SKILL.md` (8,539); `/tmp/learn-implementer-brief.json` (4,922); `CONSTITUTION.md` (3,320); `PROJECT.md` (31,677); `docs/AGENT_ORIENTATION.md` (13,594); `docs/agent-guidance/index.json` (9,014); `docs/agent-guidance/learning.md`; `docs/agent-guidance/arcadia-repository.md`; `docs/notes-to-self.md` (36,802); and indexed continuation, working-copy safety, operator-directed work, principles, identity, semantics, experiment-workspace, and PR procedures. Retrieved portions covered mandatory Notes lookup/cache, DB semantics, scope/CLI safety, experiment containment, identity/commit, validation and handoff.

Friction: the prepared candidate is outside default writable roots, so ordinary host escalation was required for candidate-only writes. The primary checkout was never edited; manager evidence says its baseline reflog is unchanged. This transport did not preserve the first build exit and the two persistence launch attempts produced no output/receipt; reusable prevention is to directly await `exec_command`, retain its session id, and poll with `write_stdin`. The root cause of the earlier dropped launches remains unproved. Remaining budget is unmeasured; no purchased credits or reset redemption was used.


## Delta review and QA follow-up

CodeRabbit advisory findings `4286689252` and `4286689266` were independently verified. Cache eviction now removes the selected `noteEntryRanges` byte interval rather than applying global string replacement, so duplicate bodies and matching preamble bytes are preserved. Restore, Notes import, and cache-maintain parse their files inside the command activity boundary. Focused suite session `71396` passed 9/9 after the change; the earlier focused session `61301` failed four tests while the new range binding and receipt assertion were being completed, then was repaired.

QA R394 is preserved compactly at `docs/reviews/2026-10-15-learn-pr1435-qa-r394.md` without its oversized context payload. The portable graph now exports exact `lesson_receipts` and `source_back_burner_item_id`. Restore validates receipt IDs, request fingerprints, owning lesson, operation payload, version membership, exact hashes, and existing collisions before the transaction writes; it rebinds the active Back Burner row locally while retaining original source provenance. Tests prove receipt equivalence and repeated restore/export provenance stability, plus malformed receipt rollback. This candidate still requires fresh independent QA/review at its final head; earlier PR #1435 QA and CI apply only to their recorded heads.


Final portable-link detail: capture now stores its original Back Burner ID in the non-FK `source_back_burner_item_id`; the additive migration backfills existing null source provenance from the active link. Repeated restore/export therefore keeps the original source ID even if a local active Back Burner projection later disappears. Receipt fingerprints must be 64-character SHA-256 values; a receipt payload must bind both version ID and exact hash together (or both null), and bound hashes must equal the retained version. Final focused validation session `96326`: `pnpm exec vitest run tests/learn-lossless.test.ts` 9/9, `pnpm exec tsc -p tsconfig.json --noEmit`, touched `eslint`, and `git diff --check`, all exit 0.
