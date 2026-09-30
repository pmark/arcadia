# Read-only dispatch brief repair — issue #836

Date: 2026-09-30. Owning defect:
[Arcadia #836](https://github.com/pmark/arcadia/issues/836).

## Observed failure and priority

The installed fixed brief launcher, release
`df6589f932b670960340acbda85d42f127439cb0`, failed with
`SQLITE_WORKSPACE_WRITE_DENIED`, stage `next`, in the prepared Nagel candidate.
The operator confirmed `arcadia-unattended` and restarted Codex; normal and
escalated retries failed identically. The profile correctly excludes the shared
workspace database. The source `next` stage opened writable SQLite, initialized
schema, and attempted dispatch journaling despite the brief's read-only contract.

The operator explicitly ordered immediate reporting and repair. Issue #836 was
filed in the owning repository. Normal governance reporting and queue promotion
require the same unavailable database write access, so repair preceded recording
under AGENTS.md's stop-the-line exception. The canonical drafted Log Ask records
that inversion; it has not been settled or represented as a notification sent.
No Project pointer, Action status, or Decision answer was hand-edited.

## Repair

`runNextReadOnlyCommand` shares dispatch resolution with the existing host
`runNextCommand`: same authoritative pointer, readiness checks, pending Ask and
Decision gates, Back Burner count, Constitution pinning, and rendered brief.
The broker selects the read-only entrypoint. Host `next` keeps its existing
dispatch-journal behavior. No profile permissions or approval boundaries change.

## Evidence

- Before repair, the two new broker regression cases detected three writable
  database calls each. Previous combined-brief tests replaced the next runner,
  hiding this failure.
- After repair, 87 tests in `dispatch-journal`, `go-broker`, `operator-gate`,
  `go-broker-agent-setup`, and `go-broker-ensure` passed. Both blocked and
  dispatchable cases use the real default broker next
  runner and real SQLite, preserve identical canonical data and brief text, and
  leave the journal unchanged. The actual read-only connection reports
  `db.readonly === true`.
- TypeScript `tsc --noEmit -p tsconfig.json` and focused ESLint passed.
- The complete `pnpm build` passed, including repository-wide ESLint, CLI
  TypeScript compilation, and Discord adapter TypeScript compilation. The
  dependency-free preservation self-check also passed (1,427 files inspected).
- The repaired source launcher ran in the actual prepared candidate
  `/Users/pmark/.codex/worktrees/verify-nagel-release-quality-20260930T193857443Z/platform`
  using Node 22.23.1 and the source TypeScript loader, under this unchanged task
  sandbox. It returned exit 0, `ok: true`, `command: brief-broker`, the
  `verify-nagel-release-quality` Action, its full standing constraints, operator
  alerts, and session titles. This used all three real brief stages, not mocked
  advance or work-monitor responses.

## Remaining installation boundary

This proves the candidate source works. It does not replace the installed fixed
launcher or claim any Nagel release acceptance criterion complete. The installed
broker must come from a reviewed clean revision. Reuse the existing repeatable
`reinstall-go-broker` operator action after merge; it preserves configuration
backups and reports installation status. Then run the installed brief in the
same prepared worktree. Installation and governance settlement remain distinct
from this code proof.
