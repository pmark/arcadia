# Bounded host-completion repair handoff

Standard builder: Cody Mason (`gpt-5.6-terra`, medium). Candidate: `codex/repair-host-owned-source-completion-capabilities-20261029T003646462Z`, base `1502c0bdfc565f9aed4e1e1e378cec749fe70b6a`.

## Source delivered

- Host writes a Session-, packet-, and nonce-bound capability contract under the existing workspace Session records. Headless Codex/Claude contracts declare direct workspace writes unavailable; existing other launch modes retain required direct writes.
- The provider must record the exact issued probe command and paired result. Raw narration, echoed JSON, duplicate output, a mismatched command/contract, malformed output, and a candidate-local probe replacement do not establish a pass.
- The probe reports optional unavailable direct DB writes without passing them, and exits nonzero only when required checks fail. It no longer writes a result file beneath the protected workspace.
- The managed tick passes source completion capability to reconciliation only after fresh, exact provider evidence is clear. Reconciliation performs the existing candidate validation and canonical Ask settlement at that host boundary. Missing/mismatched evidence, unavailable local Ask transport, and direct-write-required contracts refuse.
- R1-01: an optional `{ workspace_write, ok:false, required:false, unavailable:true }` result no longer becomes a wall. The same exact provider observation now remains clear through the managed-tick capability transport; required failed checks still form walls.
- R2-01: `agent_sessions.completion_capability_mode` now records the host-selected completion posture before provider startup. New headless Codex/Claude Sessions are `source_only`; direct-required modes remain required; legacy rows and operator-attended interactive Sessions remain `legacy`. The tick reads this durable field, never the presence of a provider log, so a source-only Session with a missing, corrupt, swapped, or spoofed contract/evidence cannot fall into legacy settlement.
- CI follow-up: the shared rehearsal fixture now records output from the real probe script against the already host-issued Session contract and exact command, in paired Claude tool-use/result events. The required-denial rehearsal likewise uses current v2 contract attribution; the Claude permission assertion pins the complete exact argv shape.
- `START_HERE.md` records the changed source-only flow, review/adoption sequence, and Production-Off boundary.

## Criteria evidence and limits

1. **Host-bound requirements:** contract and parser checks are in `src/sessions/sessionProbeCommand.ts`, `src/production/sessionCapability.ts`, and focused attribution tests. The launch-mode requirement is stored with the Session in `src/sessions/index.ts` and migrated by `src/db/schema.ts`; it cannot be derived from a model-controlled file or log presence. Direct-required launch modes remain required.
2. **Restricted local draft:** the first host run failed: calling `runAgentAskDraftCommand` in the same process left the disposable SQLite connection readonly at later host settlement (`/private/tmp/r465-repair-host-focused-tests.log`). The regression now invokes the actual CLI in a child process, matching the agent/host process boundary, before canonical host validation and settlement. In this protected sandbox it explicitly returns after proving `preview_blocked`; Rowan must rerun the full host test. No complete host proof is claimed yet.
3. **Gates preserved:** no production, R465 retry, admission, broker, credential, or governed-record mutation occurred. The source flow refuses malformed or missing evidence and does not use Go heartbeat readiness.
4. **Checks:** R2 sandbox parser/probe/attribution tests passed (22); managed transport plus real reconciliation regressions passed (5, with host-only fixture cases skipped). TypeScript, touched-file lint, and the ledger self-check passed. A sandbox run of the host-controller guarded `tests/session.test.ts` launch assertions refused before launch, as designed; it is retained for the host rerun. The prior host focused/build results apply only to head `921434ae427c0de43c667fcad2b87073c6a932c6`, before R2. Fresh host proof remains required.

## Commands and receipts

- `arcadia identity resolve --agent codex --tier standard --role builder --json` — passed; Cody Mason.
- `pnpm exec vitest run tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts` — passed, 19 tests.
- `pnpm exec vitest run tests/session-reconciliation.test.ts -t 'preview_blocked source draft'` — passed only through the permitted sandbox boundary; 49 skipped.
- Parent host run: `mise exec -- pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism` — 67 passed, 1 failed, 1 skipped. The failed test exposed the same-process readonly SQLite handle above; it is the reason for this follow-up correction.
- Sandbox follow-up: `pnpm exec vitest run tests/session-reconciliation.test.ts -t 'preview_blocked source draft|host completion contract|another packet' --no-file-parallelism` — 3 passed, 49 skipped. This is partial source evidence only.
- R1-01 sandbox: `pnpm exec vitest run tests/session-capability-probe.test.ts tests/session-capability-attribution.test.ts --no-file-parallelism` — 20 passed. `pnpm exec eslint src/production/sessionCapability.ts src/production/tick.ts tests/session-capability-probe.test.ts` and `pnpm exec tsc --noEmit` passed.
- R2 sandbox: `pnpm exec vitest run tests/session-capability-probe.test.ts tests/session-reconciliation.test.ts --no-file-parallelism -t 'managed|preview_blocked source'` — 5 passed, 59 skipped. `pnpm exec vitest run tests/session-capability-probe.test.ts tests/session-capability-attribution.test.ts --no-file-parallelism` — 22 passed. `pnpm exec tsc --noEmit`, `pnpm exec eslint src/db/schema.ts src/production/tick.ts src/sessions/index.ts tests/session-capability-probe.test.ts tests/session-reconciliation.test.ts tests/session.test.ts`, and `pnpm check:session-ledger` passed.
- R2 sandbox boundary: `pnpm exec vitest run tests/session.test.ts --no-file-parallelism -t 'headless by default|interactive TUI'` refused with `Arcadia go mutation must run in the protected host controller`; no guard was bypassed and this is not a failed product assertion.
- CI follow-up sandbox: `pnpm exec tsc --noEmit`, focused ESLint, and `pnpm check:session-ledger` passed. The broad lifecycle/fast-rehearsal host suite was intentionally not rerun in this sandbox.
- `pnpm exec tsc --noEmit` — passed. `pnpm lint` began successfully; `pnpm build` timed out at the execution boundary while lint was running.
- `node scripts/preservation-self-check.mjs` — passed. `git diff --check` — passed.

## Rowan host follow-up

Run outside the coding-agent sandbox with the normal host permission path:

```sh
pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism
pnpm exec vitest run tests/session.test.ts --no-file-parallelism -t 'headless by default|interactive TUI'
pnpm build
pnpm check:session-ledger
pnpm fast-rehearsal
```

## Decision 0147A R6 binding correction — host proof pending

R6-01 binds probe result meaning to the trusted issued requirement: only a source-only contract may record `workspace_write` as `{ ok:false, required:false, unavailable:true }`. A provider cannot label failed `host_validation` or `preservation` optional. Existing successful mandatory checks may continue omitting `required`.

R6-02 binds the durable `agent_sessions.completion_capability_mode` to the host contract: `source_only` requires `unavailable`; `direct_required` requires `required`; legacy remains compatible. A mismatch retains `sourceCompletionRequired` and makes local Ask transport unavailable, so canonical reconciliation refuses rather than downgrading. The tick-only caller that has the host-issued exact command and digest derives the same requirement from its fixed issued argv, never the provider result.

Sandbox evidence: capability/attribution: `25 passed`; R6-02 genuine real-probe public reconciliation: `1 passed, 58 skipped`; both source-only/direct-required contract-mode mismatches: `2 passed, 13 skipped`; touched ESLint passed. The earlier complete TypeScript pass predates these test-only additions, so Rowan must rerun it. Host checks and final review remain required; no CI, adoption, Production, or R465 success is claimed.

```sh
pnpm exec vitest run tests/session-capability-probe.test.ts tests/session-capability-attribution.test.ts tests/session-reconciliation.test.ts --no-file-parallelism
pnpm exec vitest run tests/direction-managed.test.ts tests/rehearsal-two-action.test.ts --no-file-parallelism
pnpm build
pnpm check:session-ledger
pnpm fast-rehearsal
```

### R6 focused follow-up — direction manual completion producer

The host run of `tests/direction-managed.test.ts` on `3d819e2a333c44a00bc1a2a3f84c49565acffc09` reached reconciliation and returned `incomplete_resumable` at its accepted-completion assertion. The fixture manually drafts and settles its complete Ask, so it bypassed `Rehearsal.agentFinish`, the existing producer that records the genuine host-issued paired probe. It now calls `recordClearProbeEvidence` once at that explicit simulated completion point, after the candidate commit and before the manual Ask. The helper uses the issued Session contract and real probe script and appends idempotently; it does not seed every launch or alter production gates.

The OpenCode two-action path already uses `Rehearsal.agentFinish`, which records that same probe. The R6 canonical settled path permits its direct-required Session only when its required-write probe is paired and clear; source-only drafts and missing or mismatched direct evidence remain refused. Sandbox reruns: settled canonical selection `5 passed, 52 skipped`; capability/attribution `23 passed`; touched ESLint, TypeScript, ledger validation and diff check passed. Host confirmation remains required; do not infer it from the sandbox.

```sh
pnpm exec vitest run tests/direction-managed.test.ts tests/rehearsal-two-action.test.ts --no-file-parallelism
pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism
pnpm build
pnpm check:session-ledger
pnpm fast-rehearsal
```

Then perform independent current-head review and separately governed adoption before any fresh R465 attempt. No live R465 success is claimed.

## R4 canonical reconciliation repair — pending host proof

Independent R3 reproduced a public-CLI bypass: `reconcileSessionExit` accepted optional caller transport, while `arcadia session reconcile` supplied none. A durable `source_only` Session could therefore settle after its contract/log were removed. The shared capability resolver now lives in `src/production/sessionCapability.ts`; both the tick compatibility export and canonical reconciliation use it. At reconciliation, persisted `source_only` and `direct_required` modes require fresh contract, nonce, exact provider command/result, and local Ask transport evidence. Omitted fields, an explicit `sourceCompletionRequired: false`, and a spoofed supplied capability cannot weaken that Session. Legacy rows keep the established optional caller behavior.

The reconciliation regressions now call the public CLI for the successful source-only path and missing-contract refusal, while direct API cases omit transport fields and cover corrupt, missing-log, swapped-contract, explicit-false, spoofed-capability, and direct-required denial paths. Sandbox checks passed: `pnpm exec tsc --noEmit`; focused ESLint on the four R4 files; probe/attribution `23 passed`; and focused reconciliation `3 passed, 50 skipped`. The successful source-only CLI case remains host-only because it intentionally stops after `preview_blocked` under `CODEX_SANDBOX`; no host settlement, CI, rehearsal, adoption, or live R465 success is claimed.

A single disposable host-issued source-only probe was executed as its exact issued `node` command. Its session/packet/nonce/contract binding, fixture path, command, and JSON result are retained at `/private/tmp/rowan-r465-r3-native-probe-binding.json`; it uses no live workspace or credentials.

Rowan must run outside the coding sandbox:

```sh
pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism
pnpm build
pnpm check:session-ledger
pnpm fast-rehearsal
```

Then obtain independent R4 delta review and current-head CI before any separately governed adoption.

## R4 fixture producer correction — host rerun required

Host focused reconciliation on `50888f5c50bdd843118306ca2d49400cad789354` found 12 lifecycle assertions blocked before their intended acceptance, validation, or scope behavior. The durable gate behaved correctly: older direct fixture calls omitted `workspace`, so canonical reconciliation could not read the host-owned Session contract/log and refused. The affected simulated completion helpers also need the real paired evidence before they ask reconciliation to settle.

`tests/session-reconciliation.test.ts` now passes the fixture workspace for the acceptance-grant direct reconciliation and records the existing host-issued exact probe only after the named-test and scope helpers have created their actual completion draft and candidate revision. Generic FakeTmux launch remains unmodified; missing-evidence, malformed, spoofed, direct-required, and R3 public-CLI omitted-input regressions retain their refusal paths. The source-only contract is not changed.

Sandbox evidence: grant plus scope selection `8 passed, 45 skipped`; capability/attribution `23 passed`; TypeScript and touched ESLint passed; ledger validation passed. The named-test validation cases reach the validator but it refuses its validation descendant in this coding sandbox, so they require host rerun and are not claimed locally.

Rowan host rerun:

```sh
pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism
```

The current-head CI unit shards remain pending after the push. R4 review, isolated rehearsal, adoption, Production, and any R465 retry remain outside this repair.

## R5 final delta — settled-candidate capability gate

R4-01 showed that a genuine already-settled candidate bypassed the canonical managed capability check because that check ran only while settling a draft. Canonical reconciliation now evaluates the same host-derived requirement before accepting either a draft settlement or an already-settled candidate. For persisted `source_only` and `direct_required` Sessions, missing, corrupt, swapped, unavailable, or direct-write-required evidence produces the existing non-resumable self-settled refusal/escalation. The previously recorded settlement is not changed or undone. Legacy Sessions retain their established path.

Focused sandbox checks passed: settled-candidate capability/scope selection `5 passed, 50 skipped`; capability/attribution `23 passed`; touched ESLint, TypeScript, session-ledger validation, and scoped diff check passed. Host rerun is still required for the full reconciliation suite, including restricted-draft settlement and validation-descendant cases; no CI, R5 review, rehearsal, adoption, Production, or R465 success is claimed.

```sh
pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism
pnpm build
pnpm check:session-ledger
pnpm fast-rehearsal
```

## R6-pending delta — Plan-done public reconciliation and direct providers

R5-01 found that `classifyExitOutcome` returned `accepted_completion` from a done Plan before canonical managed capability evaluation. For persisted managed modes reconciliation now reclassifies that preliminary state as pending, then validates the same host-owned contract/log/probe path used by draft and settled candidates. A verified settled candidate is accepted; missing, corrupt, swapped, spoofed, unavailable, or direct-required-without-proof evidence is refused through the established non-resumable settled-candidate path. Existing settlement records remain untouched. `legacy` preserves the historic Plan-done outcome.

A direct-required provider with a paired successful required-write probe may accept its own already-settled completion; only the source-only draft settlement path refuses direct-required mode. This restores OpenCode’s genuine direct provider path without allowing an unavailable direct-write contract to pass. Public CLI tests cover both primary and candidate repository inputs.

Sandbox checks: public settled-candidate selection `5 passed, 52 skipped`; capability/attribution `23 passed`; touched ESLint, TypeScript, ledger validation and scoped diff check passed. `direction-managed` and `rehearsal-two-action` stopped at the expected `The preservation consumer must run on the host` guard before their intended assertions, so Rowan must run them on the host. One independent R6 is the final available review after host checks; no CI, R6 verdict, rehearsal, adoption, Production, or R465 success is claimed.

```sh
pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts tests/direction-managed.test.ts tests/rehearsal-two-action.test.ts --no-file-parallelism
pnpm build
pnpm check:session-ledger
pnpm fast-rehearsal
```

## Decision 0148: admitted heavy Ellis repair, before independent R8

The preceding sections are historical evidence from the outgoing writer. R7
subsequently found two static P1 blockers at `d3ff8091c029eb4a21dba439d153fcfcc28a23b5`:
#1881's directory-only SQLite probe and #1882's accepted non-Boolean optional
flags. Neither that static review nor its passing CI proved dynamic reproduction.
All R1-R7 findings, receipts and consumed allowances remain retained; none is reset.

Rowan published Decision 0148 A on fetched main
`5974cf827e62946c059c282ba724b61f4594e519` (PR #1883,
`decisionanswer_73c489cbb90940849f`). The later human-directed heavy-writer
override is `agentask_b5c86c85c0bdc3b76d`; outgoing release is
`agentask_3f8a0113afe25ba352` and successor custody acknowledgement is
`agentask_d347988c4d39983926`. New native chat
`01a188c9-777d-7a70-a7f5-e02dbf60687c` is Ellis, sole implementer under Rowan.
Parent `create_thread` evidence pins `gpt-6.1-sol/high`; available self-metadata
does not independently expose that runtime binding. No prior managed Session,
lease, generation or identity is reused. The schema's `driver` ledger label
represents this implementer assignment; the outgoing writer's ledger is unchanged.

Immutable admission `agentask_a1ccb3160b9dc36e40` starts at
2026-10-29T17:56:06.118460Z. The existing candidate reservation
`wtres_4a3b0f2d5c114fde9e` sets the shorter hard deadline
2026-10-30T00:36:46.462Z; preservation-only begins at 00:06:46.462Z.
This turn stops before 2026-10-29T18:26:06Z. Charge its entire wall clock and
the earlier 72.485-second acknowledgement to the cumulative eight-hour writer
allowance. Admission adds no allowance beyond Decision 0148 and renews no
reservation; no new production admission is claimed.

Only the existing candidate and branch are used. Its base head was clean at
`d3ff8091c029eb4a21dba439d153fcfcc28a23b5`; the following repair is uncommitted
at this handback and has no new revision/CI/review proof yet.

- Required direct DB writes now lazily load Arcadia's existing `better-sqlite3`,
  open the existing database with `fileMustExist`, and force a main-database
  header write inside `BEGIN IMMEDIATE` followed by `ROLLBACK`. No application
  table is assumed, no schema initialization/journal-mode change is performed,
  and no database changes are committed. Source-only probes never load SQLite.
  SQLite error codes remain in the structured failure text, including lock errors.
- Present `required`/`unavailable` properties must be Boolean (own-property
  presence, including explicit undefined in direct objects); missing legacy
  fields remain compatible. Malformed paired evidence stays unknown and
  suppresses legacy-diagnostic fallback.
- Real isolated SQLite regressions prove that a sibling marker can be written
  while an attempted DB transaction fails on a read-only DELETE database,
  DELETE journal or WAL database. The issued required probe then refuses;
  restored writable controls pass. Database bytes and sentinel contents remain
  unchanged. Root/non-enforcing environments explicitly skip rather than claiming denial.
- Public reconciliation tests cover recorded required-write denial and malformed
  passing host checks at both primary/candidate roots, drafted/already-settled
  malformed cases, and existing legitimate direct-required/legacy controls.
  Parser tests cover Codex and Claude pairing, all three check names, both flags,
  string/number/null/array/object values, explicit undefined and fallback precedence.
  The preview-blocked draft test now records the genuine issued probe instead of
  constructing successful probe JSON. Its existing coding-sandbox early return
  still means a sandbox execution alone does not prove final host settlement.

Reproduction and friction: the initial targeted run (native tool session 31163)
showed the old database producer returning exit 0 after a genuine failed SQLite
write, and malformed host flags observing clear. The journal fixture initially
masked its assertion during cleanup and needed SQLite's `disk I/O` failure code
recognized and its removed empty journal recreated. A later launch was denied
writing Vite's temporary config; the normal approved host-execution route was
used, with no workspace substitution. The file named
`/private/tmp/rowan-successor-20261029/ellis-r8-regression-before.log` contains
that startup denial, not a completed regression run. The WAL writable-control
initially failed because opening a readonly fixture can leave readonly WAL/SHM
sidecars; restoring all fixture sidecar modes repaired the control. Failed logs
remain in the same temporary evidence directory. SQLite permission regressions
used only fixture databases. The sidecar observation was captured through the
supported CLI as `lesson_96dd18c258b4b132d923` / receipt
`lessonReceipt_c0d6f3a8-7890-40b5-877c-ebef49bc11d7`.

Instruction evidence is retained in the native turn: candidate `AGENTS.md`,
Constitution, PROJECT frontmatter/exact Action, context policies/index,
role/guardrail skills, targeted Notes, continuation/learning/working-copy,
native-mail checkpoints, roles guidance, repository orientation and DB orientation.
Retained-lesson search returned zero matches; work monitor completed before edits.
The main history from the inherited cursor through `5974cf8` and the exact
published Decision were read. Rowan supplied the fetched-main/Production-Off/
reservation admission verification. No messaging, delegation, commit, push,
preservation broker, settlement, merge, install/adopt/restart, provider/credential
probe or live R465/START operation was performed by this writer.

Validation (exit 0 unless explicitly stated; logs under
`/private/tmp/rowan-successor-20261029/`):

- `pnpm exec vitest run tests/session-capability-probe.test.ts tests/session-capability-attribution.test.ts tests/session-capability-tokens.test.ts tests/session-reconciliation.test.ts --no-file-parallelism`:
  98 passed, one skipped, 207.56s (`ellis-r8-full-focused.log`). After this run,
  the public denied-write fixture precondition was strengthened from a same-value
  PRAGMA to guaranteed transactional fixture table creation. Its targeted
  verbose rerun passed at both repository roots: one passed, 61 filtered skips,
  11.07s (`ellis-r8-required-write-control.log`). No runtime code changed for
  this test-only correction. Do not collapse these into a claim of a final
  99-test no-skip run.
- Final producer/parser file: 23 passed, 3.49s
  (`ellis-r8-probe-final-diagnostics.log`), including SQLite error-code retention
  and malformed-probe precedence over legacy diagnostics. Targeted public
  reconciliation cases earlier passed nine tests with 53 filtered skips
  (`ellis-r8-reconciliation-cases.log`).
- `pnpm exec tsc --noEmit` (`ellis-r8-tsc.log`), `pnpm lint`
  (`ellis-r8-full-lint.log`), and final touched-file ESLint
  (`ellis-r8-final-touched-lint.log`) passed. The last fixture SQL replacement
  is test-only; final touched lint is rerun at handback.
- `pnpm build:artifacts` passed (`ellis-r8-build-final.log`); packaged probe
  and source match SHA-256
  `d3c3b50e3f735b8cbc95ea38a8609afec6a244fb00a5feeb1eea3fc6c9c71c90`.
  An earlier build's copy became stale after the diagnostic-text correction;
  the mismatch was measured and the canonical build repeated.
- `node scripts/preservation-self-check.mjs`: 3295 files inspected, passed
  (`ellis-r8-preservation-self-check.log`). Session-ledger validation and
  `git diff --check` passed after correcting this new row's overlong notes field.
- Writer `pnpm fast-rehearsal` began just before Rowan's no-duplicate steering;
  it was interrupted with exit 130, with no result claimed
  (`ellis-r8-fast-rehearsal.log`). Rowan owns the canonical run and its result.
- Rowan separately reported the genuine preview-blocked host-settlement test
  passed (one pass, 61 filtered skips, 7.63s), log
  `host0148/source-only-real-host.log`. This is fixture-only host proof. It
  establishes no Go parity/live acceptance; its inherited diagnostic marker
  handling must not be applied to Go-parity tests.

Author inspection verified lazy SQLite loading, existing-file-only access,
rollback/close paths, preserved host-issued command/contract bindings and
fail-closed malformed evidence. This is not independent R8. Runtime files
were frozen before Rowan's canonical rehearsal checkpoint; only the guaranteed
write precondition in the public regression and handback/ledger documentation
changed afterwards. Final fetch/checkpoint retained main cursor
`5974cf827e62946c059c282ba724b61f4594e519`; both history ranges were empty.
Pending: canonical rehearsal result, protected preservation, new-head required
CI, independent R8 and then any separately allowed completion. No independent
R8 verdict, new CI, completion settlement, adoption or live acceptance is claimed.
Sole source custody remains with this paused writer unless Rowan explicitly
reassigns it; no second writer or automatic resume.
