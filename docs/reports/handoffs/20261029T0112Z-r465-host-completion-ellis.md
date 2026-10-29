# Bounded host-completion repair handoff

Standard builder: Cody Mason (`gpt-5.6-terra`, medium). Candidate: `codex/repair-host-owned-source-completion-capabilities-20261029T003646462Z`, base `1502c0bdfc565f9aed4e1e1e378cec749fe70b6a`.

## Source delivered

- Host writes a Session-, packet-, and nonce-bound capability contract under the existing workspace Session records. Headless Codex/Claude contracts declare direct workspace writes unavailable; existing other launch modes retain required direct writes.
- The provider must record the exact issued probe command and paired result. Raw narration, echoed JSON, duplicate output, a mismatched command/contract, malformed output, and a candidate-local probe replacement do not establish a pass.
- The probe reports optional unavailable direct DB writes without passing them, and exits nonzero only when required checks fail. It no longer writes a result file beneath the protected workspace.
- The managed tick passes source completion capability to reconciliation only after fresh, exact provider evidence is clear. Reconciliation performs the existing candidate validation and canonical Ask settlement at that host boundary. Missing/mismatched evidence, unavailable local Ask transport, and direct-write-required contracts refuse.
- R1-01: an optional `{ workspace_write, ok:false, required:false, unavailable:true }` result no longer becomes a wall. The same exact provider observation now remains clear through the managed-tick capability transport; required failed checks still form walls.
- R2-01: `agent_sessions.completion_capability_mode` now records the host-selected completion posture before provider startup. New headless Codex/Claude Sessions are `source_only`; direct-required modes remain required; legacy rows and operator-attended interactive Sessions remain `legacy`. The tick reads this durable field, never the presence of a provider log, so a source-only Session with a missing, corrupt, swapped, or spoofed contract/evidence cannot fall into legacy settlement.
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
