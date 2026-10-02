# Friction observed during minimal production orchestration

This report records observed friction and prevention advice. It creates no
Action, answers no Decision, and grants no execution or production authority.
The recovery being prepared in another session remains separate from this report.

## Accepted settlement followed by publication refusal

The original enrollment/configuration operator action failed before mutation
because its pinned queue revision was 179 while the current revision was 180.
This session refreshed its preview and the existing script to revision 180.
Shell syntax, descriptor validation, live library discovery, and independent
read-only review passed. The full disposable preview/apply/publication transaction
was not exercised before the operator ran the refreshed action.

The operator's run `20261002T151612Z-53615` then applied the settlement and
created commit `a5a6844e751a6441576871b8b20ae8ccf2ab9d6e`, after preparation
commit `ec53674aaaad0148e3ed7e6f3da3a9bb75ab3d64`. Its applied receipt names
both prerequisite Actions. Publication refused with:

> The settlement parent no longer matches its exact reviewed document preview.

Comparison of both retained non-applied previews against preparation commit
`ec53674aa` establishes the mismatch:

| Preview document | Matches the Git parent's `before` state? |
| --- | --- |
| Active Plan | Yes |
| Original untracked Ask | No: present on disk, absent from the parent tree |
| Archived Ask destination | Yes: absent before settlement |

The validator compared every preview's filesystem `before` content to the Git
parent. That assumption fails for an untracked input that canonical settlement
archives into a tracked path. This is not evidence that the wrong preview was
selected; both inspected previews reproduce the same mismatch. The earlier
chat explanation proposing wrong-preview selection is superseded by this check.

Retained evidence is under
`artifacts/generated/operator-scripts/runs/20261002T151612Z-53615/`
and `artifacts/generated/operator-scripts/runs/20261002-orchestration-refresh-preview/`.
No publication receipt was present in the failed run at inspection. Acceptance,
publication, pointer authority, and production activation are separate facts.

Prevention: read Notes To Self before repairing an operator script; its existing
shared-runner guidance already warned against bespoke settlement parsing.
Reproduce the entire transaction with untracked Ask archival in a disposable
workspace. Validate pinned untracked input bytes separately from tracked parent
documents. A syntax check, valid descriptor, or reviewer reading cannot replace
that execution evidence. Preserve applied commits and recover publication only;
never repeat the acceptance just because the dashboard says failed.

## Other avoidable friction

- **Workspace writes:** settlement preview records a receipt and needs workspace
  write access. The sandbox returned `SQLITE_WORKSPACE_WRITE_DENIED` for configured
  martianrover. A reviewed outside-sandbox preview succeeded; a later evidence
  draft was validated and retained with `workspaceStatus: preview_blocked`.
  Treat those as distinct outcomes. Use the configured resolver and approved host
  path; never guess a workspace or edit SQLite to bypass refusal.
- **Local dashboard access:** sandbox curl could not connect to port 3020;
  the in-app browser returned `ERR_BLOCKED_BY_CLIENT`. A reviewed outside-sandbox
  GET succeeded. Neither sandbox failure established a stopped service. Do not
  restart services merely because one sandbox cannot reach loopback.
- **Service helper location:** attempted repo-local service-helper paths did not
  exist. The installed restart skill owns its bundled helper. Read that skill's
  documented location before guessing a script path.
- **Library validation:** the full operator-library check found five existing
  undeclared-settlement descriptors. The refreshed pair passed an isolated check.
  Report both results; an isolated pass does not make the whole library green.
- **Scope count:** reusing two prerequisite Actions plus durability and rehearsal
  yields four implementation records, while the brief explicitly requires three.
  Planning and independent critique exposed this before implementation. Resolve
  it through governed scope choices; calling two records one stage is insufficient.
- **Handoff timing:** the operator's started message established launch, not
  success. Reading its terminal run and applied receipt prevented the next-session
  prompt from claiming publication or asking for acceptance a second time.
- **Focused-test invocation:** while writing this report, `pnpm test --
  tests/notes-to-self.test.ts` launched unrelated suites. The run was interrupted
  rather than interpreted as verification. Use `pnpm exec vitest run
  tests/notes-to-self.test.ts` to select this file on the installed pnpm version.

The vital prevention is transaction-level proof before a real operator click,
followed by stage-aware reporting from canonical receipts. Source fixes belong
in their governed candidate; these notes must not weaken the original guards.
