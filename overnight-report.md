# Overnight orchestration report

## Stop condition

Action 0 ([PR #820](https://github.com/pmark/arcadia/pull/820)) and Action 1
([PR #822](https://github.com/pmark/arcadia/pull/822)) merged and were verified
on `origin/main`. The chain stopped during Action 2 at
[PR #825](https://github.com/pmark/arcadia/pull/825).

Action 2's completion Ask,
`complete-fix-auto-settle-eligibility-docs-2026-09-30`, previewed successfully.
Its `settle --apply` was correctly refused because the resolved Martian Rover
workspace would advance an unrelated live pointer. No workaround was attempted.
That settlement is not valid from this candidate, so PR #825 remains unmerged
awaiting a safe governance resolution.

## Verified state at stop

- Pull request: [#825](https://github.com/pmark/arcadia/pull/825), **OPEN** and
  unmerged.
- Required CI passed: `lint`, `unit-1`, `unit-2`, `unit-3`, `unit-4`,
  `dashboard`, and `e2e`.
- CodeRabbit was started for the current head and remains pending. It must
  finish before the PR can receive a final review verdict, but this PR must not
  merge while the completion settlement remains invalid.

## Boundaries preserved

No Grant was pressed. No production policy was activated, worker or other
service restarted, credential used or changed, deployment made, or live
rehearsal run.

Actions 3–5 must not start. Starting them would violate the required
one-at-a-time chain while Action 2 remains unmerged and its completion
settlement has no safe resolution.
