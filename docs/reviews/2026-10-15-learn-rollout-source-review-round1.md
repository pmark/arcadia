REVIEW `dae0c47f2f373ccc1585a122dc440d8c06021bbf` vs `5cec1ce3ae1840379dedc0aea68827b91b1e7ee1`

BLOCK

- HIGH — Current adoptions are not idempotent on the actual apply path. `applyPropagation` creates a persistent temp Git worktree and local `arcadia-way/propagate-*` branch before calculating whether anything changes; a no-op returns `current` without removing either. Repeating an already-current `--learning-only` apply accumulates candidates/branches despite no intended propagation.
  Locations: `src/projects/wayPropagate.ts:201-225`; missing integration assertion in `tests/way-propagation.test.ts:301-315`.
  Remedy: plan from the fetched pinned base before persistent candidate creation, or cleanly remove the no-op worktree and branch; preserve candidates only for commit/push/PR failure recovery.

Validation:

- `pnpm vitest run tests/way-propagation.test.ts` — 19 passed.
- `pnpm exec tsc --noEmit` — passed.
- `git diff --check` — passed.
- Candidate worktree remained clean; HEAD reflog unchanged.

Confirmed: no auto-merge command remains in the propagation route; apply requires validated agent/tier identity; selected Learn fingerprints use `guidanceFingerprint` normalization.
