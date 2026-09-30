# Overnight orchestration report

## Stop condition

The chain stopped after Action 0 at [PR #820](https://github.com/pmark/arcadia/pull/820).
That pull request prepares the v6 rehearsal fixture, its unpressed one-click
Grant, and the morning runbook. It changes a production Grant/approval
boundary. The overnight instruction requires the chain to stop at an open PR
for any work touching admission, approvals, credentials, or the concurrency
gate, so this PR was not merged.

## Verified state at stop

- Pull request: **OPEN**, **CLEAN**, **APPROVED**.
- Required CI passed: `lint`, `unit-1`, `unit-2`, `unit-3`, `unit-4`,
  `dashboard`, and `e2e`.
- CodeRabbit completed successfully. Its configured generated-path filter
  skipped file-level review of these generated operator artifacts; script
  syntax, descriptor JSON, executable bits, and `--describe` paths were
  independently checked before the PR was opened.

## Boundaries preserved

No Grant was pressed. No production policy was activated, worker or other
service restarted, credential used or changed, deployment made, coding-agent
Session launched or terminated, or live rehearsal run.

Actions 1–5 were deliberately not started. Starting them would violate the
required one-at-a-time chain: Action 0 has not merged to `origin/main`, and
this PR must remain open for the operator because it changes a Grant/approval
boundary.
