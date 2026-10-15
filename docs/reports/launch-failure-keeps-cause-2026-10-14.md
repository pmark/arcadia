# Launch failure diagnostics: candidate evidence, 2026-10-14

Action: `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider#launch-failure-keeps-cause`, agent owned. Candidate: `codex/launch-failure-keeps-cause-20261014T181827489Z`, starting at `69e686dea3f6314313d2e10b6925d095eb8048d5`. This is the original implementation pass; no new attempt or production allowance is claimed. Actual native model ID, effort and token usage are unavailable; standard/medium is the Plan recommendation.

## Reproduced defect and fix

The first hermetic regression ran the real `systemTmux.launch` subprocess and real worker tick against an executable tmux stub. It failed because red-alert evidence contained only “tmux could not start the Claude Code Session.” rather than the stub's known stderr, “known tmux stderr: cannot create server socket”. Failed output is retained at `/private/tmp/arcadia-launch-failure-red-regression.txt`.

The adapter now pipes bounded stderr and ignores stdout. `spawnSync` avoids `execFileSync`'s automatic inclusion of the full command and provider prompt in an exception. An unavailable executable retains ENOENT with absent stderr handled safely. The wrapper's `details.cause` and native Error causes reach the worker's repair record, failed Run, log, launch result, exhaustion escalation, red alert and production status. The final diagnostic is capped at 2,048 characters and redacted/sanitized using the existing validation-output utilities. Command-failure messages without stderr omit argv; arbitrary error details, stdout and environment objects are never serialized.

The regression asserts both persisted red-alert evidence and the canonical `production status` JSON envelope, along with the repair record and escalation, credential redaction, payload omission and length bounds. Focused edge tests cover native/Arcadia causes, Buffer stderr, empty stderr, controls, verbosity, circular causes, unavailable executables and nonzero exits. This proves immediate launch diagnostics, not that a detached provider succeeds or that live production is operational. Claude worker replay remains the next governed Action.

## Deterministic evidence

| Command | Result | Retained raw output |
| --- | --- | --- |
| `vitest run tests/production-tick.test.ts -t 'retains real tmux stderr'`, before fix | Failed on missing underlying cause | `/private/tmp/arcadia-launch-failure-red-regression.txt` |
| Same regression, after fix | Passed | `/private/tmp/arcadia-launch-failure-green-regression.txt` |
| `vitest run tests/launch-failure.test.ts tests/production-tick.test.ts` | 81 passed | `/private/tmp/arcadia-launch-failure-focused-core.txt` |
| `vitest run tests/session-launch.test.ts -t '^launchGuardedHostSession'` | 42 passed, 16 outside the selected describe skipped | `/private/tmp/arcadia-launch-failure-focused-session.txt` |
| `tsc --noEmit` | Exit 0 | `/private/tmp/arcadia-launch-failure-tsc-final.txt` |
| `pnpm build` (includes repository lint, core TypeScript and Discord build) | Exit 0 | `/private/tmp/arcadia-launch-failure-build.txt` |
| `node scripts/fast-rehearsal.mjs -t 'admits, builds, preserves, readies, reviews and integrates Action 1'` | Existing two-Action serial scenario passed, 13 ticks, zero recorded/unexpected errors | `/private/tmp/arcadia-launch-failure-fast-rehearsal.txt`; combined `report.json` in the report directory printed there |
| `git diff --check` | Exit 0 before evidence additions; rerun at preservation | Candidate diff |

The whole three-file focused command was also attempted twice: normal execution and the same supported ordinary host permission route. Both recorded 134 passed and five failed existing Go-parity fixture cases because the inherited `CODEX_SANDBOX` marker refused `runGoCommand` before their expected fixture assertions. Host permission did not change that precondition. Outputs: `/private/tmp/arcadia-launch-failure-focused-tests.txt` and `/private/tmp/arcadia-launch-failure-host-focused-tests.txt`. No third unchanged retry, marker manipulation, test weakening or live Go mutation was performed. Full-file proof remains for the existing CI environment. The standard unmodified rehearsal isolates its disposable HOME and provider/Git environment, guards real provider execution and retains its own report; it is fixture evidence, not host production authority.

## Custody, recovery and friction

Claim/reservation `wtres_1180aa89f3bc4e8ca2`, generation `wtres_d9f17ae1aec84012a4`, revalidated through the canonical read-only APIs at 22:26:11 UTC. It binds this exact candidate, branch and Action until 2026-10-15 18:18:27 UTC; managed repository lease is null. The writer remains chat `01a13bae-ec86-7ab1-9056-1bec92ece2a4` under manager `01a13c78-bb7e-7bc1-ae8e-4bcdc17aa6f1`.

The first bridge failed EPERM because the live permissions excluded the candidate. After the operator refreshed this existing chat, the actual writable roots included the candidate; the installed bridge succeeded linking all four dependency trees. A mise tracked-config symlink warning remains nonfatal. The fixed brief passed with correlation `ecdc0429-a739-41c0-9bb8-62705e259f87`, dispatchable current Action and no blocking operator gate. Exact receipt and verbatim brief are retained at `/private/tmp/arcadia-launch-failure-brief-20261014.json` and `/private/tmp/arcadia-launch-failure-dispatch-brief-20261014.txt`. A second read-only brief invocation recovered the first tool output's truncation; a premature JSON parse of its still-running output failed, then succeeded after completion.

Automatic approval review rejected worker-to-manager status messages, citing the earlier Codex progress-update prohibition. One evidence-supported retry was also rejected. The manager instructed no further messaging retries and uses read_thread/wait_threads to observe this owner. No operator relay or new communication allowance is claimed. An attempted read-only preservation-readiness API could not materialize its comparison index under protected `.git`; that is agent-environment evidence, not a protected-host preservation refusal. Preservation uses only the installed fixed launcher.

## Readiness and remaining gates

At 22:37:43 UTC the configured live workspace reported Inactive · Idle, policy 47 / epoch 28, zero live admissions. Historical red alert `ra-2bcf88b68759` still has its generic stored cause; a code fix cannot reconstruct discarded historical stderr. No launch, activation, Grant, installation, restart, credential change or deployment occurred.

Independent exact-head review, manager replay, same-candidate completion settlement, remote preservation/PR and current-head CI remain required at this evidence checkpoint. No Action completion is claimed by this report.

Historical manager replay (superseded by the safety correction) passed at 22:38:59 UTC: eight tests passed (73 outside the selected cases skipped), exit 0, source hashes unchanged during the run. The six code/test hashes also matched this candidate when the receipt was copied to `launch-failure-keeps-cause-manager-replay-2026-10-14.json`. The later safety correction changes those hashes, so this receipt cannot establish final-candidate replay. Independent code review remains separate.

## Retrieved instructions

Loaded paths/bytes were recorded in activation PR #1406's continuation comment. This pass reused arcadia-go, arcadia-guardrail, continuation, learning, working-copy safety, identity, Agent Asks, PR guidance, native-app sessions, role and Hacker recovery. Additional exact sections: `docs/managed-production-readiness.md` Refresh contract; `docs/agent-guidance/arcadia-repository.md` PR QA Plan and Working-Copy Safety; Notes To Self dependency bridge, brief sandbox and fast-rehearsal entries; `tests/fast-rehearsal/README.md` existing scenario workflow; session ledger schema/source. Discovery remained targeted to the launch adapter, tick, alerts, diagnostics, tests and delivery seams. No denied environment file was read.

## Blocking review and bounded correction

The independent generic read-only reviewer `launch_diagnostic_review` found a blocking P2: clipping raw text at 65,536 characters before sanitizing terminal escapes and redacting secrets could expose a credential prefix. The owner reproduced `API_KEY=abcdefg` in the formatter and actual adapter; raw receipt `/private/tmp/arcadia-launch-failure-review-p2.json`. The manager's separate immutable-snapshot reviewer independently reproduced the same defect with a CSI escape and a shortened `sk-` credential. Its provisional no-finding result is superseded. Both findings remain part of the review history; neither is a PASS. Actual reviewer runtime model, effort and usage are unavailable.

The unchanged original snapshot was preserved locally at `66a6aac1f0ea5cbed2092457e262ce81eac00582`, receipt `presv_c0fb8c2c413748cdb3`, after the single authorized timeout replay. The prior attempt failed `PRESERVATION_GIT_TIMEOUT` during `validation.recheck-binding`, `git hash-object -w --stdin`, 90,000 ms; receipt `/private/tmp/arcadia-launch-failure-preservation-retry.json`. The successful replay receipt is `/private/tmp/arcadia-launch-failure-preservation-timeout-replay.json`. That commit contains the known P2 and supplies preservation only, not completion or review approval.

After the pending preservation reached terminal success, the manager-authorized single scoped safety correction began. Three new regressions failed first: OSC and CSI escapes at the raw-input boundary, and an actual subprocess capture overflow with an incomplete credential line. Receipt `/private/tmp/arcadia-launch-failure-boundary-red.txt`. The formatter now sanitizes and redacts the complete captured text before the final 2,048-character clip. On ENOBUFS the adapter retains only complete stderr lines and explicitly reports that the incomplete tail was withheld; it retains the overflow cause without rendering provider argv.

The augmented targeted suite passed 11 cases (73 outside scope skipped), TypeScript passed and `pnpm build` passed after the correction. Receipts `/private/tmp/arcadia-launch-failure-boundary-green.txt`, `/private/tmp/arcadia-launch-failure-tsc-boundary.txt`, `/private/tmp/arcadia-launch-failure-build-boundary.txt`. The full relevant core passed 84/84 and the scoped launch suite passed 42 cases (16 outside scope skipped) after correction; receipts `/private/tmp/arcadia-launch-failure-core-boundary.txt` and `/private/tmp/arcadia-launch-failure-session-boundary.txt`. Fresh manager replay and one independent delta review must bind the corrected preserved head before completion settlement or PR delivery. No broader allowance, extra writer or production operation was introduced.

## Corrected-head delivery checkpoint

Protected preservation succeeded with `presv_7f7b02fb0b804544a8`, commit `4e19fd0b0aded12ed64bc3f3ab4c28a354b4f50b`, tree `f175ee7ee212b3334a4830f2a13545e5165411fa`. The candidate was clean; the six committed source/test hashes matched `/private/tmp/arcadia-launch-failure-corrected-source.json`. Restricted host self-check passed (2,584 files). Receipt `/private/tmp/arcadia-launch-failure-preservation-corrected.json`; no remote publication or production authority is implied.

The manager's fresh replay passed 11 cases on that exact unchanged clean head, exit 0. Durable receipt: [corrected manager replay](launch-failure-keeps-cause-manager-corrected-replay-2026-10-14.json). Its independent generic reviewer `launch_failure_review`, round 2, returned PASS with no new findings and closed the prior credential-prefix blocker: CSI/OSC inputs redact; actual Node ENOBUFS and the exact adapter withhold incomplete credentials while retaining a prior complete diagnostic. All six delta files were inspected, diff check passed, primary reflog remained unchanged and no mutations occurred. This result was delivered by sole manager chat `01a13c78-bb7e-7bc1-ae8e-4bcdc17aa6f1` to this writer. Runtime model, effort and usage remain unavailable. Round 1's blocking result and the manager's superseded provisional no-finding result are not substitutes for this proof.

Both required review/replay gates now pass for the corrected code. These delivery-evidence changes do not change source/tests, but require the remaining scoped round at PR creation to bind the final preserved head. Same-candidate completion settlement, remote PR and current-head CI are still required at this checkpoint. The session ledger records this acceptance checkpoint, before the PR number exists.

One session-renewal Discord attention ping was queued as `ping_2ad5ffd2b5a04f8283` after `SQLITE_WORKSPACE_WRITE_DENIED`; the same installed command succeeded through ordinary host permission recovery. Delivery was not independently confirmed. The manager subsequently confirmed its bounded watch is active and asked for no duplicate resume alert or operator relay. No additional implementation or correction allowance is claimed.

Agent Ask delivery uses installed `/Users/pmark/.codex/skills/arcadia-agent-ask/SKILL.md` and the live `agent-ask contract`; same-candidate settlement and identity/PR procedures were reread before delivery. The remaining review is generic current-head verification, not registered reviewer admission.

## Delivery preservation boundary

The next protected preservation attempt for the evidence-only delivery delta failed `PRESERVATION_GIT_TIMEOUT` at `binding.manual`: `git hash-object -w --stdin`, 90,000 ms. Receipt `/private/tmp/arcadia-launch-failure-preservation-delivery-stderr.txt`; attempt `a28da1e8-352c-4449-a35c-88ecd4dd48e4`. Nothing was committed, and the index/status/locks were unchanged. The prior reviewed code head remains `4e19fd0b0aded12ed64bc3f3ab4c28a354b4f50b`. Four narrative/receipt files remain dirty. No automatic retry, host timeout adjustment, raw Git write, service restart, completion settlement or remote push followed. This is the new named failure at which the manager's bounded delivery/watch instructions require a stop. The manager observes this writer and owns diagnosis/attention; no duplicate operator resume ping was sent.
