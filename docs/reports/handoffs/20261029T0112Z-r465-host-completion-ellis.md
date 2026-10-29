# Bounded host-completion repair handoff

Standard builder: Cody Mason (`gpt-5.6-terra`, medium). Candidate: `codex/repair-host-owned-source-completion-capabilities-20261029T003646462Z`, base `1502c0bdfc565f9aed4e1e1e378cec749fe70b6a`.

## Source delivered

- Host writes a Session-, packet-, and nonce-bound capability contract under the existing workspace Session records. Headless Codex/Claude contracts declare direct workspace writes unavailable; existing other launch modes retain required direct writes.
- The provider must record the exact issued probe command and paired result. Raw narration, echoed JSON, duplicate output, a mismatched command/contract, malformed output, and a candidate-local probe replacement do not establish a pass.
- The probe reports optional unavailable direct DB writes without passing them, and exits nonzero only when required checks fail. It no longer writes a result file beneath the protected workspace.
- The managed tick passes source completion capability to reconciliation only after fresh, exact provider evidence is clear. Reconciliation performs the existing candidate validation and canonical Ask settlement at that host boundary. Missing/mismatched evidence, unavailable local Ask transport, and direct-write-required contracts refuse.
- `START_HERE.md` records the changed source-only flow, review/adoption sequence, and Production-Off boundary.

## Criteria evidence and limits

1. **Host-bound requirements:** contract and parser checks are in `src/sessions/sessionProbeCommand.ts`, `src/production/sessionCapability.ts`, and focused attribution tests. Direct-required launch modes remain required.
2. **Restricted local draft:** the first host run failed: calling `runAgentAskDraftCommand` in the same process left the disposable SQLite connection readonly at later host settlement (`/private/tmp/r465-repair-host-focused-tests.log`). The regression now invokes the actual CLI in a child process, matching the agent/host process boundary, before canonical host validation and settlement. In this protected sandbox it explicitly returns after proving `preview_blocked`; Rowan must rerun the full host test. No complete host proof is claimed yet.
3. **Gates preserved:** no production, R465 retry, admission, broker, credential, or governed-record mutation occurred. The source flow refuses malformed or missing evidence and does not use Go heartbeat readiness.
4. **Checks:** focused parser/probe tests passed (19); TypeScript passed. The four lint errors from the failed host build (unused probe nonce, obsolete parser helper, and two unnecessary assertions) were removed; a fresh full host build remains required. Preservation self-check passed (3,294 files); `git diff --check` passed.

## Commands and receipts

- `arcadia identity resolve --agent codex --tier standard --role builder --json` — passed; Cody Mason.
- `pnpm exec vitest run tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts` — passed, 19 tests.
- `pnpm exec vitest run tests/session-reconciliation.test.ts -t 'preview_blocked source draft'` — passed only through the permitted sandbox boundary; 49 skipped.
- Parent host run: `mise exec -- pnpm exec vitest run tests/session-reconciliation.test.ts tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism` — 67 passed, 1 failed, 1 skipped. The failed test exposed the same-process readonly SQLite handle above; it is the reason for this follow-up correction.
- Sandbox follow-up: `pnpm exec vitest run tests/session-reconciliation.test.ts -t 'preview_blocked source draft|host completion contract|another packet' --no-file-parallelism` — 3 passed, 49 skipped. This is partial source evidence only.
- `pnpm exec tsc --noEmit` — passed. `pnpm lint` began successfully; `pnpm build` timed out at the execution boundary while lint was running.
- `node scripts/preservation-self-check.mjs` — passed. `git diff --check` — passed.

## Rowan host follow-up

Run outside the coding-agent sandbox with the normal host permission path:

```sh
pnpm exec vitest run tests/session-reconciliation.test.ts
pnpm exec vitest run tests/session-capability-attribution.test.ts tests/session-capability-probe.test.ts --no-file-parallelism
pnpm build
pnpm check:session-ledger
```

Then perform independent current-head review and separately governed adoption before any fresh R465 attempt. No live R465 success is claimed.
