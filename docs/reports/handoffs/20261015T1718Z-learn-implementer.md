# Learn lossless capture hand-off — 2026-10-15

Candidate: `/Users/pmark/.codex/worktrees/learn-lossless-capture/arcadia`  
Branch: `codex/learn-lossless-capture-20261015`  
Implementation commit: `fd50f7fba1c5b1346a4a07b1757af3e2c3024e8a`.  
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
| Safe bounded cache maintenance | All current entries import before an explicit named eviction. Eviction requires an exact-text receipt and source-byte recheck before write; invalid/no-entry input leaves the cache unchanged. No automatic truncation occurs. |
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
- Build receipt: the original direct `pnpm build` output reached `eslint src test tests scripts apps/dashboard apps/discord-bot` but this implementer transport returned no exit/session receipt. Two background persistence attempts returned from their launcher with no output and left zero-byte `/private/tmp/learn-lossless-build.log` plus no `.exit` file; no session id was provided. Build remains unproved here. Lead Hacker recovery owns the single supported direct build session `92373`; record its actual exit in a follow-up report-only commit before PR readiness.

## Internal review and custody

Internal diff review checked replay-after-correction behavior, literal `%`/`_` search semantics, restore pointer/graph closure and transaction rollback, path/symlink and source-byte protections, and experiment-root mutation guards. This is not the required independent PR review; the Lead owns the separate canonical review and QA processes.

Ledger custody: `docs/reports/session-ledger/20261015T1718Z-01a1405f-ebaa-7850-8083-88f871e17d45.json` records the parent Lead with truthful pending-review `split` outcome. The manager checkpoint `/tmp/learn-release-checkpoint-20261015.json` supplied scope/authority and preparation-receipt custody; it is not copied into the repository.

Loaded instructions/evidence: `AGENTS.md` (10,118 bytes); `.agents/skills/arcadia-role/SKILL.md` (8,539); `/tmp/learn-implementer-brief.json` (4,922); `CONSTITUTION.md` (3,320); `PROJECT.md` (31,677); `docs/AGENT_ORIENTATION.md` (13,594); `docs/agent-guidance/index.json` (9,014); `docs/agent-guidance/learning.md`; `docs/agent-guidance/arcadia-repository.md`; `docs/notes-to-self.md` (36,802); and indexed continuation, working-copy safety, operator-directed work, principles, identity, semantics, experiment-workspace, and PR procedures. Retrieved portions covered mandatory Notes lookup/cache, DB semantics, scope/CLI safety, experiment containment, identity/commit, validation and handoff.

Friction: the prepared candidate is outside default writable roots, so ordinary host escalation was required for candidate-only writes. The primary checkout was never edited; manager evidence says its baseline reflog is unchanged. This transport did not preserve the first build exit and the two persistence launch attempts produced no output/receipt; that is a validation-evidence gap, not a build failure claim. Remaining budget is unmeasured; no purchased credits or reset redemption was used.
