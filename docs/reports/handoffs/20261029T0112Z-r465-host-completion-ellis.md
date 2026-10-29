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
