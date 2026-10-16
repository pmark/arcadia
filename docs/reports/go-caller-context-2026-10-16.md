# Go caller context — source evidence, 2026-10-16

Assigned Action: `make-arcadia-go-orient-one-caller-truthfully-before-authorized-work#resolve-go-caller-context`.
Candidate: `/tmp/arcadia-go-context-01a143a6`, branch `codex/go-caller-context-20261016`.
Accepted inactive Plan: commit `621fc63b4598f680532a18c48499e186258f3e30`, settlement `asksettle_b880d26e3c9d4924af`.
Intake: https://github.com/pmark/arcadia/issues/1458.

The operator approved inactive Plan acceptance and the first source Action after the compact display. This is one bounded source implementation; the current production Plan and `claude-worker-launch-replay` pointer remain selected. No governed Session admission or claim is inferred from this native depth-one implementer. The parent Lead is the sole handoff/settlement/commit/PR owner; this delegate does not commit or publish.

## Result

The combined brief passes its caller checkout to read-only next. Canonical own reservation evidence binds the assigned Action, while the selected pointer remains separately visible. A uniquely named Action can resolve across Project Plans through the existing dispatch resolver, preserving Project, selected-Plan, document, Constitution, capability, guidance, readiness and operator gates. No supplied Plan label creates an assignment. The default pointer-only next path remains unchanged.

Orientation includes repository/base and caller revisions, claim identity/generation, canonical stored active Session id/status only when a row is observed, source/time, at most five ownership observations and the selected/assigned related Plans (at most two). Invalid ownership emits a precise blocker; unknown/mismatched repositories refuse. Output never treats reservation or native activity as Session admission. `observedAt` is explicitly pinnable; identical pinned fixture inputs yield identical results.

Source changes: `src/goBroker.ts`, `src/commands/next.ts`, `src/docs/dispatch.ts`. The protected Go preparation/transport, replay, admission, live controls, installation, production and cleanup policies are unchanged. `src/commands/advance.ts` is untouched; its existing named-Action resolution benefits from the shared deterministic lookup.

## Exact assigned acceptance criteria

```yaml
      - "Requirement REQ-001. Given a registered Project whose pointer names Action A and a caller candidate with a valid own claim for Action B, the existing read-only orientation resolves repository/base and caller worktree, Project, active Plan and selected Action A, assigned Plan/Action B and claim identity separately; actual Session id/status is present only when canonical Session evidence exists. Expected proof: hermetic distinct-A/B fixture through advance and next/combined-brief consumers; titles and acceptance refer to B when assigned, never silently A. Center this correction on src/goBroker.ts brief integration: advance currently receives request.source while nextRunner receives only workspace/project; reuse current dispatch/gate resolution rather than inventing a second resolver."
      - "Requirement REQ-002. Given no own claim, another caller’s claim, a stale/conflicting claim, an unknown repository or missing/ambiguous Project/Plan/Action record, orientation shows selected work separately and either no assignment or one exact existing refusal; it never steals/rebinds a claim, invents a Session or authorizes work. Expected proof: focused fixtures for each case including cross-Project/cross-Plan and secret-redaction assertions."
      - "Requirement REQ-003. Rendering orientation reports observed ongoing ownership and related Plans with source/time and a bounded summary, plus the next permitted step or exact gate. Identical pinned inputs produce identical output. Expected proof: read-only adapter spies and before/after snapshots prove zero Project/queue/claim/admission/Git/worktree mutations and zero provider calls; malformed/missing evidence remains visible."
      - Focused context/advance/next/brief tests, TypeScript, lint and build pass; retain failed-first evidence for any reproduced caller-versus-registered-path defect. Read-only orientation does not implement orchestrator replacement or modify the existing live control/admission policy.
```

## Criterion evidence

1. REQ-001: hermetic distinct selected-A/assigned-B fixtures exercise the actual read-only next and combined brief, and the actual advance command. Same-Plan and cross-Plan cases resolve B; caller-owned B survives a coherent pointer A-to-C move. Combined brief titles and acceptance describe B. No-Session fixtures report null; adapter fixtures only expose id/status from the canonical Session reader and refuse a Session/claim conflict.
2. REQ-002: fixtures cover no claim, foreign caller, expiry, cross-Project claim, missing Action, duplicate Action across Plans, branch/fence mismatch, missing generation, unknown repository, mismatched caller Project, malformed Plan, redaction of unrelated claim branch/generation. Missing/ambiguous documents retain canonical dispatch blockers. A named-Action lookup refuses duplicate/missing Project Plans rather than choosing by order. No test admits, steals or refreshes ownership.
3. REQ-003: repeated pinned observations compare equal. Spies assert zero writable database-adapter calls and zero fetch/provider-network calls. Before/after snapshots compare every fixture database table, repository and caller documents, complete Git metadata, refs and worktree inventory. Bounded ownership fixture retains total count while rendering five rows. Related Plans are derived from managed documents, not a new authority store. No runtime model/provider invocation path was introduced; live cost and latency are unmeasured (null).
4. Validation: see exact commands and raw results below. Retained failing-first broker regression proves the omitted caller `repo` input before the fix. No runtime installation or live-provider acceptance is claimed.

## Validation and retained friction

Final delegate checkpoint: focused Action checks, TypeScript, repository lint/build and fast rehearsal passed. Broader legacy Go tests have a host-permission limitation below; criterion 4 is proved by the focused context/advance/next/brief suite and required static/build checks, while full Go-suite host acceptance remains unproved. Product source stays frozen for independent review; all delegate check processes have exited.

| Check | Result / raw evidence |
| --- | --- |
| Pinned Node `node node_modules/vitest/vitest.mjs run tests/go-broker.test.ts -t 'runs advance, work-monitor, and next once'` before fix | exit 1; `go-caller-context-2026-10-16/failed-first.txt` |
| `node node_modules/vitest/vitest.mjs run tests/go-caller-context.test.ts tests/go-broker.test.ts tests/dispatch-journal.test.ts tests/dispatch.test.ts` | exit 0; 111 tests; `go-caller-context-2026-10-16/source-tests.txt` |
| `node node_modules/vitest/vitest.mjs run tests/brief-supervisor.test.ts tests/go-caller-context.test.ts` after supervisor expectation correction | exit 0; 26 tests; `go-caller-context-2026-10-16/brief-tests.txt` |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0; `go-caller-context-2026-10-16/tsc.txt` |
| `node node_modules/eslint/bin/eslint.js src/goBroker.ts src/commands/next.ts src/docs/dispatch.ts tests/go-caller-context.test.ts tests/go-broker.test.ts tests/dispatch-journal.test.ts tests/brief-supervisor.test.ts` | exit 0; `go-caller-context-2026-10-16/lint.txt` |
| `PATH=/Users/pmark/.local/share/mise/installs/node/22.23.1/bin:$PATH pnpm build` (includes repository lint, TypeScript and Discord build) | exit 0; `go-caller-context-2026-10-16/build.txt` |
| `node scripts/fast-rehearsal.mjs` | exit 0; 19 files, 72 passed + 1 expected fail, 34 scenarios; `go-caller-context-2026-10-16/fast-rehearsal.txt` and `report.json` |
| Nine-file broad context/advance/dispatch/Go/brief batch | exit 1; 229 passed / 16 failed: one superseded supervisor-format expectation (corrected and 26-test rerun passed), plus 15 legacy Go fixtures refused mkdir outside writable roots; `go-caller-context-2026-10-16/broad-tests.txt` |

All `node` commands above use `/Users/pmark/.local/share/mise/installs/node/22.23.1/bin/node`. No provider-network/model calls were used by orientation fixtures. Raw outputs are preserved beside this report where complete. Initial regression failed because the old nextRunner input omitted `repo`; this is the source defect. Fixture setup initially used invalid Plan rubric fields (`low`, missing `recommended_model`, unobservable acceptance), corrected to valid fixture records without loosening validators. Existing journal fixtures gained actual disposable Git repositories and realpath normalization. Existing supervisor byte/hash checks now compare against direct caller-aware next pinned to each receipt's observation time, and still assert restart stability of every other byte and zero database/Git changes.

The read-only monitor completed successfully before product edits; its local raw inventory is `/tmp/go-context-monitor.json` and is not published because it includes unrelated portfolio working copies. Learn search `Go caller claim next brief` in `project:arcadia` returned no matches. A diagnostic process listing was refused by the sandbox (`ps` operation not permitted); no policy or environment marker was changed in response.

## Deferred input and boundary

Mobile-first Unicode stacked sections, human short Plan name/milestone/progress, selected versus running, current versus proposed and switch/assignment effects remain later projection input: `agentask_2d905b2b024bd42258` / `capture_5008b06e-4c0b-4f59-b393-2dc655b3c190`. Menu refinement remains `agentask_82df6f348e263d42c8` / `capture_741a3bcd-6b96-4ecb-91ca-4baa44675b60`. No menu, live title rollout, replay transport, new state taxonomy or broad inactive-Plan browser was added. Revival trigger: the existing later Actions are separately assigned after their dependencies and gates are met.

`START_HERE.md` includes executable local QA and clearly separates source proof from a separately reviewed installed-broker rollout. The source is local-only until the parent preserves a reviewed PR. No merge, installation, production activation, Plan switch, spending, credentials or cleanup is authorized here.

## Instruction retrieval and responsibility

Implementer, native depth 1, no delegates. Supervisor/handoff: parent Lead `01a143a6-51ee-720c-b93d-86a3dcff50eb`. Actual runtime model is not proven by the role brief's registry default; tokens and measured wall minutes are null. Mandatory retrieval included installed `arcadia-role/SKILL.md`, candidate `AGENTS.md`, `.arcadia/AGENT_CONTEXT_POLICY.md`, `.arcadia/repo-context.md`, `.arcadia/context-policy.json`, `CONSTITUTION.md`, Project/current production Action, assigned Plan/Action, guidance index, targeted Notes, continuation, learning, working-copy safety, PR, session-role, repository Orientation/Semantics/Operator Guide/Working-Copy Safety, rehearsal-freeze guidance and canonical semantics. Parent retains settlement/identity/PR operation responsibility.

## Review checkpoint and next safe move

Product source frozen at the native delegate handback; all checks have exited. Parent may preserve this candidate and open the draft PR for scoped independent review. Full build and rehearsal passed; the remaining validation limitation is 15 legacy Go fixtures that attempt host worktree roots outside this sandbox. Their exact EPERM refusals are retained. Run them through existing safe CI or an approved isolated host-fixture route; do not broaden permissions, remove sandbox markers or weaken tests. Exact current changed paths: `START_HERE.md`, `src/goBroker.ts`, `src/commands/next.ts`, `src/docs/dispatch.ts`, `tests/go-broker.test.ts`, `tests/dispatch-journal.test.ts`, `tests/brief-supervisor.test.ts`, `tests/go-caller-context.test.ts`, this report and its raw-evidence directory. No other source writer is active here.

Review attention: ownership is a bounded observation of canonical reservation and Session rows through read-only adapters, not an admission/launch receipt or a live-process probe. Independent review should attack cross-Plan and malformed/foreign ownership, stale observation races, failure-path redaction, and preservation of the default selected-pointer gates. Live runtime/provider latency and token counts remain null. Fixture rehearsal wallMs is 283121, not a live performance promise.

The broad Go fixture refusals are `EPERM: operation not permitted, mkdir` for `/Users/pmark/.claude/worktrees/...`, `/Users/pmark/.codex/worktrees/...` and `/Users/pmark/.opencode/worktrees/...`. No real directory or worktree was created through those denied paths. The fixtures' source code was not changed to bypass host boundaries. All newly added caller-context fixtures are hermetic under disposable temporary roots.

Root instruction-file sizes (UTF-8 bytes, retrieved as indexed sections where noted): AGENTS 10100; context policy 539 + repo context 703 + context-policy JSON 870; Constitution 3320; guidance index 9449; continuation 7256; learning 2458; working-copy safety 16202 (relevant sections); PR guidance 17585 (relevant sections); session-role guidance 6152; repository procedure 30174 (targeted sections). Project/current-Action and Notes retrieval was targeted; file size is not a claim to have loaded their full narrative bodies.
