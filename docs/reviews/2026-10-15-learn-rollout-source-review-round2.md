## BLOCK — current head `d1d5d9083df9e05ffce74f893cdd5d6f2cd72b70`

R1’s no-op leak is fixed on the ordinary path: repeated no-op applies remove their temporary worktree and branch. The focused suite passes.

New blocking finding:

- **HIGH — partial cleanup after a concurrent candidate commit reports a nonexistent recovery candidate.** [`wayPropagate.ts`](/Users/pmark/.codex/worktrees/learn-rollout/arcadia/src/projects/wayPropagate.ts:285) removes the worktree before expected-OID branch deletion. If a concurrent writer commits cleanly after planning, removal succeeds, `update-ref -d … <pinned-old-oid>` correctly refuses, but the error result still reports the removed `candidatePath` and stale `candidateHead`. The unique branch is retained, but recovery details falsely imply its worktree still exists.

  Reproduced in a disposable Git fixture: `worktree remove=0`, candidate path absent, `update-ref=1`, branch preserved at a newer SHA.

  Add a regression for this partial-cleanup state and return truthful recovery data: absent worktree, current retained branch OID, and a recreate-worktree remedy. An ownership/race guard is also needed if concurrent candidate use must be preserved beyond Git’s dirty-worktree protection.

R1 disposition: **fixed for normal repeated no-op applies; superseded by the partial-cleanup race above.**

The `185aa239` base merge is conflict-free and separate from repair/evidence commit `00075e3d1`. Rollout report, ledger, handoff, and copied reviews are internally consistent: Rebuster #28 is merged; PPN #302 and MCS #84 remain at their stated operator/production gates; no universal-agent-compliance or deployment claim is made.

Checks:

- `pnpm vitest run tests/way-propagation.test.ts` — 20 passed
- `pnpm exec tsc --noEmit` — passed
- `git diff --check` for repair and merge deltas — passed
- Candidate tree clean; HEAD and reflog unchanged.
