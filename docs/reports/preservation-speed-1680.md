# Preservation blob batching — Issue #1680

Operator-directed work, 2026-10-21: “If you're idle, then why don't you go ahead and launch a sub-agent to perform the speed improvements on a fresh work tree.” No governed Action exists for this work. The active `cover-mail-ack-receipt-kind-collision` Action is limited to `tests/native-mail.test.ts` and has no overlap. The implementer is a depth-one native delegate, sole development writer in `codex/preservation-speed-1680`; the Lead owns independent review and integration. Runtime model/effort binding, token use, deadline and budget are unavailable/unmeasured; supplied role/model labels do not establish governed admission.

## Change and bounds

Historical phase evidence at source `fdc6d0548b4b6d51c81d7a4ce59654da3b75f67d` measured capture at 206121 ms with 2967 `hash-object` calls and materialization at 117923 ms with 2976 `cat-file` calls. The source-state replay guard is shell, not Node. The earlier interruption did not prove a hang.

Capture retains the anchored privileged reader and immutable-base symlink checks. One `hash-object --stdin-paths --no-filters` invocation hashes private numbered copies of the captured bytes. C-quoted octal path bytes handle special characters in the private scratch directory. Candidate files are never reopened by Git. Output count and full object identities are checked before constructing the scratch index.

Materialization asks `ls-tree` for sizes and reads raw blobs with `cat-file --batch`, at most 256 objects and normally at most 8 MiB of body bytes per call; a single larger object retains the 64 MiB limit. Each exact header, object identity, type, size, body delimiter and final response boundary is checked. Empty trees need no blob call. Baseline symlink trust, containment, regular/executable output modes and attribute/filter bypass remain covered.

Git inputs use exclusive 0600 files opened read-only, unlinked before subprocess launch, and closed in `finally`. Native timeout typing and production limits remain unchanged. The input fault-injection tests apply their short timeout specifically to the injected hash command, following the existing timeout-fixture pattern; unrelated Python startup keeps the ordinary test bound.

## Evidence

The same 3001-entry fixture (49968000 regular-file bytes plus one baseline symlink) produced tree `dfd53e47261961ae799e96932898e8160947d749` before and after. Every byte, executable bit and symlink target matched; HEAD, exact index bytes and status were preserved in both runs.

| Phase | Before | After | Git object processes before → after |
| --- | ---: | ---: | ---: |
| Capture | 133158 ms | 6802 ms | `hash-object` 3000 → 1 |
| Materialization | 153633 ms | 3992 ms | `cat-file` 3001 → 12 |

These are single serial samples using Node v22.23.1 and `/usr/bin/git`, with very high uncontrolled host load and warm caches. These samples are bound to source SHA-256 `18380a9875664e437e7da5a3cef7320fa630e0c8bb7946d3a7d335c22b621b85`. The [measurement Artifact](preservation-speed-1680-measurements.json) records timings, subprocess counts, load averages, source hashes and proof limits.

| Final validation | Exit | Result / receipt |
| --- | ---: | --- |
| Nine focused preservation/symlink/validation/timeout files, `vitest run ... --maxWorkers=1` | 0 | 84 passed, 10 skipped; `arcadia-1680-preservation-regressions.log` |
| Final `tests/candidate-snapshot-batch.test.ts` | 0 | 13 passed, including byte and object-count request bounds; `arcadia-1680-batch-final.log` |
| Final `tests/candidate-snapshot-input.test.ts` | 0 | 3 passed, including real withheld-EOF injection for text and Buffer input; `arcadia-1680-input-final.log` |
| `pnpm build` | 0 | Full repository lint, root TypeScript and Discord build; `arcadia-1680-build.log` |
| Full `node scripts/fast-rehearsal.mjs --maxWorkers=1` | 1 | 24 files passed, 2 failed; 97 tests passed, 1 failed, 1 expected failure, 4 skipped; 3349380 ms. Original hook timeout and wrong-stage fault selector preserved. |
| Focused unchanged-harness retry, Grant expiry / Issue #1518 | 0 | 7 passed, 96 skipped; 284.18 s. Grant expiry including fresh-Grant resume passed its original 240 s hook bound. |
| Final settlement case with exact expected refusal / zero-unexpected assertion | 0 | 1 passed, 102 skipped; 224.96 s including 146.78 s module import; scenario53.8s,3 expected errors,0 unexpected; `arcadia-1680-fast-settlement-final.log` |
| Static checks | 0 | Session ledger, agent guidance, operator scripts, frozen records, Plan close-outs, eight-shard allocation and `git diff --check`; `arcadia-1680-static-checks-final.json` |

Raw log names above are under `/private/tmp/`. The benchmark commands, full focused test command and exit codes are retained in the handback JSON. The new batch tests independently compute raw Git blob identities and assemble a separate reference tree, cover hostile filenames and scratch paths, binary/empty content, ignored/untracked/staged/deleted files, executable modes, baseline symlinks, empty trees, corrupt protocol responses and typed timeout cleanup.

The full rehearsal remains a failed invocation. Its Grant-expiry hook exceeded 240 s on the loaded host (scenario 418293 ms); four assertions were skipped despite zero unexpected scenario errors. The focused retry completed that scenario in 175.9 s including fresh-Grant resume. The settlement test originally injected the shared `--no-filters` capture command instead of the explicit-path settlement command. Its selector now targets `--no-filters -- ` and asserts the injected stage. All refusal/escalation assertions and production timeouts remain intact. The focused report exposed the intentional `incomplete_resumable` integration refusal as unexpected; its exact expected message is now registered and a zero-unexpected assertion added. See the [rehearsal receipts](preservation-speed-1680-rehearsal.json). No further full replay was run.

## Reproduce the phase comparison

The checked-in `preservation-speed-1680-profile.mts` is a phase-only diagnostic. It creates a disposable data-only Git fixture and extracts the pinned former implementation into that fixture, rebinding imports to unchanged helpers. It never creates an Arcadia workspace or executes captured Git fixture content; only the trusted pinned/current implementation modules execute. Run the `before` and `after` commands in its header serially with fresh absolute receipt paths; use exactly the same generated fixture JSON for both. The baseline commit must be available locally.

The fixture contains 3000 regular files totaling 49968000 bytes and one baseline symlink. Each phase uses the same shell Git counter and preservation timeout wrapper. Verification checks every file byte, executable bit, symlink target, HEAD, exact index bytes and status. Single samples have uncontrolled external host activity and warm caches; call counts and equivalence are stronger evidence than a general wall-time guarantee. This is not full source-state replay or installed-runtime proof.

## Preserved failures and preparation

The pre-edit monitor completed with exit 0 at 2026-10-22T03:06:02.927Z. The assigned worktree was clean. The retained older symlink candidate overlaps the source file, but the existing fail-closed host liveness probe returned `ok: true, processes: []`; its files and history were untouched. Raw monitor and liveness receipts are `/private/tmp/arcadia-1680-start-monitor.json` and `/private/tmp/arcadia-1680-overlap-liveness.json`.

The unchanged input suite first failed all three tests when Python exceeded its all-command 800 ms test budget. A trivial Python startup measured 1.00 s on that host. The failure remains in `/private/tmp/arcadia-1680-baseline-input-tests.log`; this does not demonstrate a production timeout defect. The new batch regression failed against the former implementation: 285 hash calls instead of one, and no batch output error-path handling (`arcadia-1680-batch-red.log`).

One owned focused run was terminated with exit 143 after its worker remained CPU-running with approximately 750 MiB RSS. Large deep-Buffer assertions and per-blob reference subprocess overhead were suspected contributors, not a proven production cause. The final test uses `Buffer.equals` and independently computes raw Git blob hashes before assembling a separate reference index. The incomplete receipt is retained as `arcadia-1680-batch-green.log`; the subsequent narrow run passed 15 tests in 69.05 s (`arcadia-1680-batch-green-final.log`).

The fresh worktree needed the documented dependency bridge (four trees, exit 0). A source CLI lesson search initially failed for missing `tsx`; the configured installed `arcadia learn search` succeeded with no matches. Restricted GitHub reads succeeded through ordinary host escalation. No sandbox, validator or CI gate was weakened.

## Handoff and limits

Configured production status was read at 2026-10-22T04:52:16.416Z: `inactive_idle`, desired inactive, zero live admissions (`/private/tmp/arcadia-1680-final-production-status.json`). The implementation performs no installation, restart, broker action, live workspace mutation, provider/reviewer spend, claim/budget reset, governance edit, merge or deployment. The Lead must bind independent review and CI to the pushed head. A final source-state replay remains a separate proof gate before any production press. Revival for broader performance work: this bounded change passes its checks and the next final-source replay identifies a remaining phase bottleneck.

Instruction paths/byte hashes and retrieved sections are retained in the checked-in [instruction inventory](preservation-speed-1680-instructions.json); raw commands, exit codes, artifacts and remaining gates are in `/private/tmp/arcadia-1680-speed-handback.json`.

## Review round 2: finite large-tree listing bound

CodeRabbit finding [4344728506](https://github.com/pmark/arcadia/pull/1689#discussion_r4344728506) identified a valid regression: adding sizes with `ls-tree -rlz` can exceed Node's default 1 MiB output bound for a tree whose former `-rz` listing fits. A real 16,000-empty-file tree reproduced `ENOBUFS` before the repair (`/private/tmp/arcadia-1680-listing-red.log`, exit 1). The listing now explicitly uses the existing finite 64 MiB Git output bound; blob/batch/file-size limits, timeout and authority are unchanged.

The new regression verifies both real listing sizes, every empty regular file and read-only mode, 63 bounded blob requests, and unchanged HEAD/index/status. The 14-case batch suite passed (30.86 s); touched-file ESLint, `tsc --noEmit`, and `git diff --check` passed. Raw receipts are `/private/tmp/arcadia-1680-listing-green.log`, `-lint.log` and `-tsc.log`; commands and exit codes are in the handback. This one-option repair changes runtime source SHA-256 to `f81fcb504df735b894694d45ab8781279ffadd34bcac562793ed7f1a7b56e1ee`. The timings above remain measurements of the prior source hash `18380a9875664e437e7da5a3cef7320fa630e0c8bb7946d3a7d335c22b621b85`; no benchmark or full rehearsal was rerun for this listing-bound delta. Lead owns independent delta review, new-head CI and combination/replay.
