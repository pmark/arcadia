# Small bug batch: selection and acceptance

The operator approved selecting a small existing Action for a coding-agent Go
test, then suggested a small bug batch. This records the selection and public
source evidence only. Detailed host diagnostics remain local pending permission
to publish. The real end-to-end Go test is incomplete; no bug delivery, new
Session, successful validation or bug-fix PR is asserted by this report.

## Selected first Action

[Issue #749](https://github.com/pmark/arcadia/issues/749),
`bootstrap-managed-production-to-build-flight-deck#fix-tidy-torn-tail-byte-offset`.
At source base `d08201e2c0017ceb9230d91a4ee914c220d04ee4`,
`src/git/quarantine.ts` still passes a UTF-16 string index to byte-based
`ftruncateSync`. The existing Action has no dependencies. Bounded candidate and
PR searches found no separate fix candidate. The finding was deferred from
merged PR #748; it is not the exhausted #1419 repair.

Acceptance remains the existing Action's exact contract: byte-accurate
truncation, a deterministic regression with multibyte text before a torn tail,
unchanged recovery behavior, and passing `pnpm test`.

The canonical selection commit is
`06a2cf802ad77cb34f26b78cf725d11908825c36`. It selects the light tier at low
effort; this replaces the parent Plan-wide default `claude-sonnet-5 / high`,
not an Action-local setting. It is a configured recommendation, not evidence
of a launched model. Revalidate model suitability before any successor launch.
It restores the parent Plan's 58 unfinished queue entries, selecting this
Action at position 33, and preserves the former Go Plan as a draft without
changing its Action completion state. No process is started by selection.
Execution authorization is bounded to this first Action and a reviewed draft
PR. Production activation, automatic successor execution, merge, deployment,
installation and attempt resets are outside this test.

## Follow-on candidates, not yet assigned

| Issue | Public source finding | Remaining work |
| --- | --- | --- |
| [#1536](https://github.com/pmark/arcadia/issues/1536) | The no-`launcherDirectory` case in `tests/system-tmux-long-command.test.ts` checks argv but never asserts temporary-directory removal. | A separate governed Action should observe the actual launcher path and fail when cleanup is removed, retaining the private tmux fixture and exact-argv assertion. |
| [#1763](https://github.com/pmark/arcadia/issues/1763) | The open issue requests narrow diagnostic-file ignore rules; root `.gitignore` has no corresponding worker-request rule. No matching PR was found in bounded search. | Trace exact request/archive filenames, then a separate Action can add narrow rules and a disposable-Git regression proving unrelated source remains visible. No diagnostic invocation or consumed-attempt changes. |

These are three independent changes, each requiring its own acceptance,
candidate, independent review and checks. The proposed order is #749, #1536,
#1763. Only #749 is selected. This is a focused screen, not a whole-backlog
triage or a completed ownership-release audit for the later candidates.

## Exclusions

- [#1419](https://github.com/pmark/arcadia/issues/1419): PRs #1780–#1783 are
  closed without merge. #1783 records exhausted repair rounds and a valid
  regression-test finding. Preserve all candidates and attempt history.
- #746 and #937: GitHub Issues are closed while older Plan Actions remain
  open. Excluded rather than assuming completion or creating duplicate fixes.

## Status and next step

The protected Go path has not furnished a new assignment for the selected
Action. Do not manually prepare a replacement candidate or label this
records-only PR as the delivery under test. Resume through the supported route
only when the outstanding entry problem is resolved; verify actual assignment,
claim, candidate and Session evidence before implementation. Preserve existing
owners and stop before automatic successor work.

## Records-only validation

`node scripts/preservation-self-check.mjs` passed with 3335 files inspected;
`git diff --check` passed. Independent exact-head review and required CI are
separate PR evidence. None of these checks establishes bug-fix or live Go
completion.
