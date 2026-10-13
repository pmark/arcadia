# Issue 1330: distribute real rehearsal-chain fixture tests

Operator direction: “Launch an engineer to fix issue #1330”. Issue:
https://github.com/pmark/arcadia/issues/1330. This is a separate repair after the
operator merged PR 1355; no governed Action is claimed, no Plan pointer/queue
changes are made. Candidate branch `codex/fix-unit-shard-timeout-1330` starts at
`5cd1017fe1f3fe1ef5d7c033fa12b3f42eaff506`. Only this candidate was edited.
Engineer is the sole implementer, native depth 1, reporting to parent Lead;
complete generated role brief was read from the parent's temporary assignment.
No further delegation, commit/push, host broker, messaging or live-worktree
operation was performed by the engineer.

## Problem and scope

PR 1355 CI provided the baseline: its first attempt passed 99 suites/1,218 tests,
then the unchanged 47-case rehearsal-chain operator-script file alone took
484.813 seconds. Unit shard 4 exceeded the existing 10-minute job limit twice.
This was an existing base failure, not a role implementation regression.

The fixtures intentionally execute real Arcadia CLI/probes through synchronous
`node --import tsx` subprocesses, for each shell-script case. Real state changes
and distinct refusal coverage make caching those results unsafe. Fake sleep was
already immediate. Preserve those commands; distribute the independent cases
through Vitest's existing file sharding instead.

Extract shared fixture setup/cleanup into `tests/helpers/rehearsalChain.ts`,
with the repository root adjusted for the helper's one extra directory level.
Move the seven heavy independent describe blocks into separate descriptive test
files. Static safety, launcher cases and the run 5 byte guard remain in the
original file. Fixture roots, fake tools, real passthroughs, state isolation,
assertions, parameters and every timeout remain unchanged. CI workflow/config
is unchanged. The existing coherence/codex-capacity test files are unchanged.

## Preservation and actual shard placement

Tracked `issue-1330-fixture-preservation-2026-10-12.json` records hashes and
locations. TypeScript AST comparison proves all 10 original describe/it bodies
byte-identical. All 46 helper statements match after removing export markers;
only the expected repoRoot path adjustment differs. Vitest collected-name
inventories match exactly: 47 before, 47 after, no lost or added case.

`vitest list --shard` lists all files without applying pool sharding in this
version. Use the installed Vitest4.1.8 `BaseSequencer.shard`, the same sequencer
called by the runtime test pool, against its discovered full-file inventory.
This preserves actual source-backed placement rather than an assumed order.
Descriptive names were selected to distribute the heavy groups across all four
existing shards; no shard count/config or timeout change was used.

| Existing CI shard | Moved cases/files |
|---|---|
| 1 | reset-queue 11 + end-to-end 1 |
| 2 | fixture-reset 9 + preflight-capacity 2 |
| 3 | g6-g7-g8 gates 3 + emergency-stop 7 + preflight-coherence 1 |
| 4 | original static/launcher/run 5 guard 13 |

## Validation and timing

The narrow all 47-case invocation passed, exit 0: local wall time 276.441 seconds,
zero failures. Raw report: `/private/tmp/issue1330-split-results.json`; tracked
command/result summary: `issue-1330-fixture-validation-2026-10-12.json`.
It ran before final descriptive renames/private-export pruning; final collected
names, body/helper identity checks, lint and TypeScript passed afterward.
These local macOS times and the prior GitHub runner's 484.813 seconds are different
environments; no direct speed ratio or final CI acceptance is claimed.

| Final test file | Cases | Local suite seconds |
|---|---:|---:|
| `tests/rehearsal-chain-preflight-capacity.test.ts` | 2 | 187.539 |
| `tests/rehearsal-chain-emergency-stop.test.ts` | 7 | 60.403 |
| `tests/rehearsal-chain-end-to-end.test.ts` | 1 | 135.257 |
| `tests/rehearsal-chain-g6-g7-g8.test.ts` | 3 | 36.181 |
| `tests/rehearsal-chain-operator-scripts.test.ts` | 13 | 16.872 |
| `tests/rehearsal-chain-preflight-coherence.test.ts` | 1 | 93.707 |
| `tests/rehearsal-chain-reset-queue.test.ts` | 11 | 268.586 |
| `tests/rehearsal-chain-fixture-reset.test.ts` | 9 | 218.495 |

Final checks: touched fixture/test ESLint exit 0; `pnpm exec tsc --noEmit` exit 0;
final Vitest case/file collection exit 0; AST/case/shard receipt generator exit 0;
`git diff --check` exit 0. Required CI under its existing 10-minute gates and
repeat critical-shard proof remain for the parent after independent review and
PR creation. A local narrow pass does not prove that acceptance.

## Retrieval and friction

Reused previously loaded AGENTS, Constitution, context policies, continuation,
operator-directed-work, working-copy, learning, principles, standard harness,
role/native dispatch and PR procedures. Applied arcadia-guardrail/arcadia-role.
Refreshed Notes To Self targeted fixture/Vitest/timeout lookup and read its
focused-Vitest guidance. Read the exact cards-from-existing-sources Action
section to rule out overlap; the candidate's Project pointer still reflects the
previous decision-card-contract snapshot. Neither is implementation authority
for this direct operator request. Parent refreshed work monitor and candidate
ownership before edits. No primary/other live checkout mutation occurred.

Preserved friction: initial inventory ran without required host permission and
Vite's bridged dependency config-write was denied; reran through ordinary host
approval. Mechanical extraction first selected an existing coherence filename;
restored that file's exact HEAD content and used preflight-coherence, before any
assertion run. Identifier-based import selection included property-name matches
(status/source), causing lint unused imports; removed only those imports. The
initial Vitest list --shard observation misleadingly returned every file; read
the real pool/sequencer and used its exact shard implementation. No test failure,
mock substitution, gate weakening or additional runtime was used to hide those
repairs. Production code and live services were not changed.

Next safe move: parent Lead commits/pushes the reviewed candidate, opens a
separate repair PR closing 1330, performs independent exact-head review and
watches all required CI checks. Record repeated critical-shard runtime on that
same head before claiming the Issue's CI acceptance met.

Additional retrieval sizes (current file bytes; sections, not whole files,
retrieved on this follow-up):

| Path | Bytes | Retrieved sections |
|---|---:|---|
| `docs/notes-to-self.md` | 35406 | fixture, subprocess/timeout and focused Vitest |
| `docs/plans/every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a.md` | 18158 | cards-from-existing-sources Action |
| `vitest.config.ts` | 3090 | test isolation/timeouts/exclusions |
| `.github/workflows/ci.yml` | 4891 | four unit shard jobs and unchanged 10-minute limits |

Prior loaded instruction paths/byte evidence is retained in
`docs/reports/lead-role-dispatch-2026-10-12.md`, Instruction retrieval.
