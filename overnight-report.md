# Overnight orchestration report

## Stop condition

Action 0 ([PR #820](https://github.com/pmark/arcadia/pull/820)) and Action 1
([PR #822](https://github.com/pmark/arcadia/pull/822)) merged and were verified
on `origin/main`. The chain stopped during Action 2 at
[PR #825](https://github.com/pmark/arcadia/pull/825).

The original Action 2 completion Ask previewed against the configured Martian
Rover default workspace and was not applied. Its candidate revision was later
stale. A replacement Ask,
`complete-fix-auto-settle-eligibility-docs-2026-09-30-v2`, was bound to the
current candidate revision and explicitly scoped to Arcadia's own workspace.
Its exact preview applied successfully in commit `b4a7725b`, marking Action 2
done, archiving the v2 Ask, and advancing the governed pointer to
`prove-two-action-unattended-production`. No refusal was bypassed or worked
around.

## Verified state at stop

- Pull request: [#825](https://github.com/pmark/arcadia/pull/825), **OPEN** and
  unmerged.
- Required CI and CodeRabbit must rerun for the settlement/report head before
  this pull request can be considered for merge.

## Boundaries preserved

No Grant was pressed. No production policy was activated, worker or other
service restarted, credential used or changed, deployment made, or live
rehearsal run.

Actions 3–5 must not start. Starting them would violate the required
one-at-a-time chain until PR #825 merges, `origin/main` is verified, and the
main checkout is pulled.
