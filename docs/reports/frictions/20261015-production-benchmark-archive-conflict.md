---
id: production-benchmark-archive-conflict
cost: unmeasured
fix: docs/agent-guidance/pull-requests.md#pr-lifecycle-notifications
status: mitigated
---

# Production benchmark archive close-out

PR #1208 was preserved and all seven CI jobs had passed at
`423c5443b61db7de3effbf90880a945e1d34e598`. On 2026-10-15, archive-readiness
verification found `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`.
The base advanced to `b0f8b57ce`; only `MISSION_LOG.md` conflicted during
`git merge --no-commit --no-ff origin/main` in the original isolated candidate.

The candidate's stage-2 Log was exactly stage 1 plus 1,228 bytes: two authentic
historical PR lifecycle settlement entries. Resolution preserves the entire
419,900-byte stage-3 base Log followed by that exact suffix. Both histories
remain intact; no proposal text, Plan, pointer, Decision, queue, production,
service, or permission was changed. This does not execute or approve the
benchmark. Current-base records arrive through the merge, not new author edits.

Prevention is the existing #1254 rule in `pull-requests.md`: routine lifecycle
notifications use `arcadia ping send`, never new PR-branch Log settlements.
No settlement or notification is replayed during this repair. The prior
settlements are retained as history, not represented as new authority.

Verification: byte-equality assertions for the conflict resolution; original
benchmark/corpus/review blobs unchanged; focused proposal tests and session
ledger validation; independent delta review and latest-head CI recorded in
PR #1208. Re-check mergeability immediately before handoff.

Two close-out probes were corrected before continuing: a mistaken procedure
path was replaced with the index's `docs/working-copy-safety.md`; monitor
filtering now treats null `worktreePath` values as empty strings. Neither
probe changed files or evidence. Unrelated worktrees remain untouched.

Local proposal tests passed 10/10 on the updated base, and the session-ledger
validator passed. A first `git diff --cached --check` against the old candidate
head reported existing end-of-file blank lines imported from the base in
`docs/lead-session-trials/README.md` and `src/git/isolatedGitEnvironment.ts`.
Those files are unchanged relative to `origin/main`; they were not edited.
The scope check is `git diff --cached --check origin/main`.

Retrieved instructions (byte sizes at close-out; sections were bounded):
- `CONSTITUTION.md`: 3320 bytes.
- `PROJECT.md`: 31677 bytes.
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539 bytes.
- `.arcadia/repo-context.md`: 703 bytes.
- `.arcadia/context-policy.json`: 870 bytes.
- `docs/agent-guidance/index.json`: 9449 bytes.
- `docs/agent-guidance/continuation.md`: 7256 bytes.
- `docs/working-copy-safety.md`: 15818 bytes.
- `docs/agent-guidance/pull-requests.md`: 17585 bytes.
- `docs/agent-guidance/learning.md`: 1927 bytes.
- `docs/agent-guidance/git-identity.md`: 5248 bytes.
- `docs/agent-guidance/arcadia-repository.md`: 30174 bytes.
- `docs/agent-guidance/session-roles-and-briefs.md`: 6152 bytes.
- `docs/agent-guidance/native-app-sessions.md`: 9061 bytes.
- `docs/notes-to-self.md`: 36802 bytes.

Project pointer and exact `launch-failure-keeps-cause` Action were read only
to exclude overlap. Repository reads covered Orientation, PR QA and Working-Copy
Safety/automatic conflict recovery. Notes reads targeted worktree, archive,
Log, conflict, and dependency bridging entries. No unrelated Action was claimed.
