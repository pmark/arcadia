# Preservation input repair: bounded candidate evidence

Current Action: `launch-failure-keeps-cause` in `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider`. Candidate branch `codex/launch-failure-keeps-cause-20261014T181827489Z`, base reviewed code head `4e19fd0b0aded12ed64bc3f3ab4c28a354b4f50b`. Defect: [Issue #1414](https://github.com/pmark/arcadia/issues/1414).

## Authority and custody

The operator selected the sole manager's option 1 after proposal `agentask_50f78507d207ede2ab`: one failing-regression-first repair pass, capped at 45 minutes and three additional weekly usage points. Manager chat `01a13c78-bb7e-7bc1-ae8e-4bcdc17aa6f1` relayed this approval; the writer verified the human `1` and the exact preceding option through `read_thread`. Start 2026-10-15 00:29 UTC, deadline approximately 01:14 UTC; baseline 56% weekly used, stop at 59%, reset 1792472321. At 00:37 UTC usage was 57%. Standard/medium is the recommendation; actual model, effort and token usage are unavailable. No additional pass or allowance is inferred.

The active Plan explicitly permits additional attempts with a named failure and finite repair budget. This narrowly authorized delivery repair retains the current Action and all three acceptance criteria; no Plan amendment, status, pointer, queue or Decision was hand-edited. The operator-directed-work procedure's separate no-Action workflow is not substituted for this existing Action.

Canonical read-only custody at 00:30:14 UTC confirmed reservation/claim `wtres_1180aa89f3bc4e8ca2`, generation `wtres_d9f17ae1aec84012a4`, same candidate/branch/Action, expiry 2026-10-15 18:18:27 UTC, no managed repository lease. Work monitor with `--no-pull-requests` passed before edits and exposed the candidate's four pending evidence files. Those files remain byte-identical to `/private/tmp/arcadia-launch-failure-delivery-boundary-20261014/handoff.json` and its copies. Source/test edits are limited to `src/sessions/candidateSnapshot.ts` and new `tests/candidate-snapshot-input.test.ts`; Notes To Self updates the existing timeout entry.

## Observation, reproduction and limits

Observed protected attempts `a28da1e8-352c-4449-a35c-88ecd4dd48e4` and `1bdc1a9d-1bab-4c11-a75b-af17772cda4e` reached `PRESERVATION_GIT_TIMEOUT` in `hash-object -w --stdin` at `binding.manual` and `validation.binding`. The manager's read-only process samples captured Git in `hash_fd -> strbuf_read -> read_in_full -> xread -> read`, while Node's SyncProcessRunner waited. Samples: `/private/tmp/arcadia-preservation-persistent-87018.sample.txt`, `/private/tmp/arcadia-preservation-executor-stalled.sample.txt`, `/private/tmp/arcadia-preservation-stalled-fds.txt`. This locates a stdin wait but does not establish its lower-level cause.

Simple probes with 0, 1, 65,536 and 1,048,576 input bytes passed. A repeated real-Git probe passed 600 calls. Actual probe runtime was Node v22.23.1 at `/Users/pmark/.local/share/mise/installs/node/22.23.1/bin/node`, Git `/usr/bin/git`; the live sample named Homebrew Git (`/opt/homebrew/*/git`). Therefore these negative probes do not prove the live Git environment cannot stall. Receipts: `/private/tmp/arcadia-preservation-input-probe.txt`, `/private/tmp/arcadia-preservation-repeated-input-probe.txt`, `/private/tmp/arcadia-preservation-repair-runtime.json`.

The failing-first hermetic regression deliberately injects withheld EOF: the actual Git subprocess reads bytes from a FIFO whose writer stays open and reaches the existing typed timeout at `validation.binding`. This is honest fault injection of the observed wait, not a reproduced Node root cause. Failed receipt: `/private/tmp/arcadia-preservation-input-regression-red.txt`; the same case passed after repair in `/private/tmp/arcadia-preservation-input-regression-green.txt`.

## Minimal mitigation and security

Only snapshot Git calls with supplied input change. Captured bytes are written exclusively as mode 0600 inside the existing private scratch directory, opened read-only with O_NOFOLLOW, and unlinked before spawning. Git receives the descriptor at stdin, without input bytes or a temporary path in argv. A finite regular file reaches EOF without the synchronous input-pipe handoff. Each call starts at offset zero and closes the descriptor in `finally`; existing scratch cleanup remains in the outer `finally`. Calls without supplied input are unchanged.

The anchored no-follow capture, 64-MiB capture/command bounds, immutable byte hashing, scratch index isolation, baseline symlink checks, timeout limits and host validation remain unchanged. Tests verify exact non-UTF8/NUL and empty blobs, repeated tree identity, unchanged candidate index/status, input file permissions, read-only descriptors, zero link count while the child runs, closed descriptors and removed scratch after success and an actual timed-out child. This is a preservation-safe candidate mitigation, not proof that the installed broker adopted it.

## Verification checkpoint

- Focused preservation suite: 78 tests passed across seven files, including timeout stages, index locks, symlink security, custody and idempotence. `/private/tmp/arcadia-preservation-repair-focused.txt`.
- Targeted ESLint and `tsc --noEmit`: exit 0. `/private/tmp/arcadia-preservation-repair-eslint.txt`, `/private/tmp/arcadia-preservation-repair-tsc.txt`.
- Existing two-Action serial rehearsal: passed, 13 ticks, zero recorded/unexpected errors. `/private/tmp/arcadia-preservation-repair-fast-rehearsal.txt`; combined report path is printed there.
- Full `pnpm build`: exit 0, including repository lint, core TypeScript and Discord build. `/private/tmp/arcadia-preservation-repair-build.txt`.
- Diff check passes. Original four pending evidence files are unchanged.

## Delivery boundary and friction

The source is dirty candidate work, not an immutable Git revision or installed release. No raw Git mutation, new candidate, Go, live preservation attempt, timeout/configuration change, installation, restart or production activation occurred during this repair pass. Manager replay and scoped independent review must bind the final source hashes before any delivery. Protected commit/publication and installed adoption still require their supported routes and actual authority; the manager is preparing that boundary rather than treating this source patch as adoption.

GitHub CLI search and creation could not connect even through ordinary host permission recovery. The purpose-built connector completed the search and created Issue #1414. Its first create call lacked `repository_full_name`; schema-corrected retry succeeded. The manager independently created #1415 during an observation race, then closed that duplicate; #1414 is canonical. No further Issue creation is pending here.

Retrieved for this repair: existing guardrail/Hacker/role instructions, Constitution, Project and exact current Action, context policy trio, indexed guidance, working-copy safety, learning, principles, operator-directed work (applicability checked), identity, PR and Agent Ask procedures. Mandatory notes searches preceded the new subsystem and failures. No denied environment file was read. Loaded-path byte inventory is retained with the review binding; earlier session instruction evidence remains in the diagnostic Action report.

## Frozen source and manager replay

The manager replay passed 14 targeted cases (three preservation-input cases plus 11 existing diagnostic cases; 73 outside filter skipped), exit 0, with unchanged hashes before/after. Repository-local replay Artifact pending preservation: [manager replay receipt](preservation-input-repair-manager-replay-2026-10-14.json). The source binding is `/private/tmp/arcadia-preservation-repair-review-manifest.json`, base `4e19fd0b0aded12ed64bc3f3ab4c28a354b4f50b`, with `candidateSnapshot.ts` SHA256 `e4bb1fd268271e574b076c6bb6549f42c0718bf121580b214ea6ad3a7e69fed7` and test SHA256 `db009d262813d9bbeb20e0b71a83761dc8388164969fb966f8dfb2c850c4f261`. These are dirty-file hashes, not a preserved tree or commit. Independent scoped round 3 returned no new findings on these exact hashes. No source changes followed this binding.

The installed broker remains unchanged. A separately authorized, exactly pinned host preservation exception may be needed to commit this reviewed candidate; no such exception is executed or inferred here. The original four pending evidence files remain byte-identical. This report carries the new repair-pass history without rewriting those waiting bytes or claiming a new governed Session or completed Action.

## Final source-verification outcome and stop

The manager's independent generic read-only reviewer `launch_failure_review` completed round 3 on the frozen two-file binding with no new findings. It verified offset-zero finite EOF, exact binary/empty input, exclusive 0600 creation, O_NOFOLLOW/read-only input, unlink-before-spawn, cleanup on success/exception, and unchanged bounds, capture anchors, symlink, hook and filter protections. The six round-2 launch files remained unchanged; diff check passed and the primary reflog did not change. This is source-hash proof, not current preserved-head approval or installed adoption. Three scoped rounds are used; no additional automatic review or source change is claimed.

The single authorized source repair pass is finished. Focused 78-test proof, lint, TypeScript, full build, serial rehearsal and manager 14-case replay passed. The source and all pending narrative/receipt files are frozen with exact byte copies and SHA256 hashes for the manager's separately prepared host-preservation exception. No exception, protected retry, shared Git write, runtime adoption, completion settlement or PR was executed. The next gate is an explicit, narrowly pinned supported preservation route; old installed-broker retries are not a source test.

Instruction inventory: `/private/tmp/arcadia-preservation-repair-instruction-inventory.json` records current authoritative file paths, byte sizes and hashes; the retrieved sections are listed above and in the diagnostic report. This report supplements the original session's single ledger row while preserving the four waiting evidence files byte-for-byte.
