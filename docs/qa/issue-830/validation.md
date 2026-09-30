# Issue #830 candidate proof

Milestone: bootstrap managed production to run unattended from the GitHub board.
Work classification: deterministic operator-settlement repair.
Scope: the shared Plan-amendment runner and traceability descriptor migration.
There is no #830 Action in the active Plan; no completion is asserted for the
current production proof or the traceability Action.

Issue acceptance: “resolve only when a representative Plan-amendment /runs
action succeeds in this hermetic contract suite without a coding agent and all
negative cases refuse before a governance mutation.”

The generated representative action executes with a real temporary SQLite
workspace, real Agent Ask draft, non-apply preview and apply, and a local bare
Git origin. Its success, actual fresh fingerprint, one canonical settlement,
committed Action replacement and publication are asserted. Refusal cases assert
unchanged Plan bytes, Git HEAD, canonical settlement count and queue positions.
A push failure is explicitly post-settlement: its receipt records the local
commit, and retries prove that publication recovers without another settlement.

Validation on 2026-09-30:

- `tests/plan-amendment-runner.test.ts`: 22 real-workspace cases (real newlines,
  legal and illegal flags, fresh fingerprint, harmless base advance, target and
  semantic drift, changed Ask, dirty/wrong/stale checkout, unavailable workspace
  or origin, another proposal/settlement, duplicate/retry, live/dead locks and simultaneous stale-lock retries,
  final authority fence, and failure between settlement and publication).
- Focused settlement/CLI/dashboard validation: 131 passed across six files;
  endpoint receipt projection and one-shot refusal: another 1 passed.
- CodeRabbit stale-lock finding repaired; the 22-case runner suite passes,
  including six simultaneous retries against one abandoned lock.
- Browser: `tests/e2e/plan-amendment-receipt.spec.ts`, 1 passed. It shows failure,
  recovery and the canonical receipt at phone width, with zero operator launches.
- Core/Discord build, Dashboard build, lint, typecheck, `git diff --check`, and
  preservation self-check passed. CI on the PR remains the current-head gate.
- Full suite: 2,590 passed, 18 skipped, 1 unrelated failure in the existing
  missing-workspace CLI test. Its isolated rerun passed; the entire CLI contract
  file passed in the later focused suite. Captured as GitHub issue #831 rather
  than changing unrelated workspace behavior in this repair.

The live traceability amendment is never executed by these checks. Its launcher
is inspected and described only. The candidate library is not published to the
main checkout before merge. No Grant, production activation, service restart,
deployment, credential operation, or PR #826 transition is part of this proof.

Operator and end-user QA are the same:

1. In the isolated candidate, run the hermetic suite named in
   `docs/operator-plan-amendments.md`. Expected: a representative action settles
   once, every pre-settlement refusal preserves governance, and push retry
   preserves the original canonical receipt.
2. Run `mise exec -- pnpm exec playwright test tests/e2e/plan-amendment-receipt.spec.ts`.
   Expected: the phone-width `/runs` fixture displays `PUBLICATION_FAILED`, its
   recovery instruction and canonical commit, without launching an action.
3. Describe the migrated traceability script with `--describe` only. Expected:
   `arcadia-plan-amendment-v1` pinned inputs and explicit no-change fields; no
   stored settlement preview fingerprint. Do not click the live amendment as QA.

The browser fixture starts its own isolated temporary Dashboard on a disposable
loopback port. It is local-only; the exact address is printed by its fixture.
There is no persistent candidate demo URL, and the live host at
`http://127.0.0.1:3020/runs` still uses main until normal approved integration.
