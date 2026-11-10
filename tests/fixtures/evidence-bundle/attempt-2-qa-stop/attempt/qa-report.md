# Arcadia QA report

**Verdict: NEEDS-FOLLOW-UP**

The test change appears sound. Its net diff stays in scope, and the verified 7-of-7 focused run and green required CI support it. Follow-up is needed for two non-code problems: the settlement records cite an Agent Ask id that does not match the archived Ask, and QA plan step 5 tells the operator to confirm a criterion from output that cannot show it. A lower-severity gap affects step 4.

## Immutable Candidate

- Project: Arcadia
- Pull request: [pmark/arcadia#2086](https://github.com/pmark/arcadia/pull/2086)
- Head revision: `d7674ea22328723e3c8645f34aef061c4128f5e5`
- Base revision: `ba7b79e83ba433af99bc7566d5da9f264ece44d3`
- Draft: no
- Merge state observed: CLEAN

## Evidence checks

| Check | Status | Evidence |
| --- | --- | --- |
| Reviewer sandbox boundary | pass | reviewer-boundary: no tools, no settings, no MCP servers, prompt only claude-flag-present: --tools claude-flag-present: --json-schema claude-flag-present: --setting-sources claude-flag-present: --strict-mcp-config claude-flag-present: --no-session-persistence |
| GitHub: lint | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410383) |
| GitHub: unit-shard-1 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410039) |
| GitHub: unit-shard-2 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410120) |
| GitHub: unit-shard-3 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410242) |
| GitHub: unit-shard-4 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410221) |
| GitHub: unit-shard-5 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410353) |
| GitHub: unit-shard-6 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410198) |
| GitHub: unit-shard-7 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034409876) |
| GitHub: unit-shard-8 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410011) |
| GitHub: dashboard | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034409841) |
| GitHub: e2e | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127034410316) |
| GitHub: unit-1 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127036619021) |
| GitHub: unit-2 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127036618887) |
| GitHub: unit-3 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127036618953) |
| GitHub: unit-4 | pass | SUCCESS (https://github.com/pmark/arcadia/actions/runs/41963224294/job/127036618909) |
| Correctness | pass | The final test takes a baseline scan, then cuts the first newline-delimited batched record to name and sha only. It asserts that the scan equals the baseline, that alterations is at least 1, and that stdout actually changed. It also asserts more git calls than the plain scan and a non-for-each-ref git call naming the altered branch. Together these show the fallback path ran. The test passed in the verified completion run and in required CI. The production parser is not in the patch, so its behaviour is judged only through these assertions. |
| Scope fidelity | pass | The PR file list shows only one non-governed change: tests/work-monitor-failures.test.ts (+43/-2). The other 4 paths are the settlement records named in the scope judgement. Intermediate Ask drafts were added and retired across the 15 commits and leave no net file. No product code changed. The extra fallback assertions strengthen the required test and stay inside the named file. |
| Approval boundaries | pass | The patch contains no merge, deploy, release, credential or authority change. Its status flip and pointer advance are confined to the verified settlement commit, which the brief classifies as governed records. The QA plan says merge, deployment and publication remain separate operator gates. The Ask notes argue that earlier QA findings do not apply, but that claim was treated as evidence and given no authority. |
| Managed documents | fail | The status flip to done is consistent, and current_action moves to pin-recovery-unparseable-time-order in both PROJECT.md and the Plan. The Plan and MISSION_LOG, however, cite Agent Ask auto-settle-arcadia-pin-work-monitor-malformed-record-002649b7b774, while the archived Ask's request_id is complete-pin-work-monitor-malformed-record-b57bfe06d7f5. The archived note's claim that no auto-settle id is cited in the tree is also false at this head. |
| Hidden consequences | pass | The non-governed change is test-only. The stdout alteration is opt-in through control.alterListing, guarded to git for-each-ref with a %00 argument, and reset in afterEach along with the alteration counter. The mock changes only the fresh result object of a spawnSync call. No runtime persistence, security or compatibility surface changes. The settlement commit's document changes are visible in the patch. |
| Operator QA plan | fail | Steps 1, 2 and 6 are concrete and have observable results. Step 5 expects a single file's content to prove a touched-files and required-CI criterion, which that output cannot show. Step 4 expects a diff to show that other tests pass, which a diff also cannot show. |
| Tests and evidence | pass | Verified completion evidence is bound to tree 7e7ea547864894b85fcfb75d4f17f2e0f03044e3, the tree of preserved commit 4781d2b6c78672155570a852662c9c3d70f7f2e0. It records vitest exit 0 with 7 of 7 named tests passed, including the new fallback test, and the self-check exit 0. Lint, all unit shards, dashboard, e2e and unit-1 to unit-4 are SUCCESS on head d7674ea22328723e3c8645f34aef061c4128f5e5, which adds only governed records to the preserved commit. |

## Ordered findings

1. **MEDIUM — Settlement records cite an Agent Ask id that does not match the archived Ask**
   - Evidence: The Plan's next_action and the new MISSION_LOG entry both cite Agent Ask auto-settle-arcadia-pin-work-monitor-malformed-record-002649b7b774. The only Ask in the settled tree is archived as agent-ask-complete-pin-work-monitor-malformed-record-b57bfe06d7f5.yaml, with request_id complete-pin-work-monitor-malformed-record-b57bfe06d7f5. No file or record in the patch carries the auto-settle id except the settlement commit subject. The preceding MISSION_LOG entry shown in the diff cites Agent Ask complete-cover-retired-reland-20261103, which has the same complete-* form as this archived request_id. The archived Ask's note also says 'no auto-settle id is cited anywhere in this tree', which this same settlement commit makes untrue at the head.
   - Recommendation: Have the host settlement cite an id that resolves to the archived Ask, or record the mapping from the auto-settle id to the archived request_id in the managed documents. The fix belongs in the settlement writer, not in the test.
2. **MEDIUM — Operator QA plan step 5: the prescribed output cannot show the criterion holds**
   - Evidence: Step 5 runs git show on tests/work-monitor-failures.test.ts and expects that output to show 'The change touches only tests/work-monitor-failures.test.ts' and that proof of the file, lint and tsc passing comes from required CI. A single file's content shows neither which files changed nor any CI result. Step 2 lists 5 changed files, and no step explains that 4 of them are governed settlement records outside this criterion. No step tells the operator to inspect the required checks on the head.
   - Recommendation: Rewrite step 5 to use the step 2 name-status output, separate the test file from the named settlement records, and add a concrete read of the required check results for head d7674ea22328723e3c8645f34aef061c4128f5e5 with the expected SUCCESS outcome.
3. **LOW — Operator QA plan step 4: a diff cannot show the other tests pass**
   - Evidence: Step 4 expects git diff output to show that 'every other test in that file passes unchanged'. A diff can show the other tests were not edited, but not that they pass. The only execution step in the plan, step 6, runs node scripts/preservation-self-check.mjs, which does not run this test file according to the recorded stdout.
   - Recommendation: Have step 4 point to a concrete pass result for the named test file, such as the retained completion report or a focused vitest command with its expected 7 passed result.

## Residual risks

- The patch does not include the work monitor source, so the claim that only the batched branch listing carries a %00 format argument cannot be confirmed directly. If the remote-ref listing also used %00, the guard would alter it too.
- The final assertion that a git call names the altered branch could also match ordinary per-branch calls. The higher call count is the stronger proof of fallback, and it depends on the scan issuing a stable number of git calls.
- The PR base is now ba7b79e83ba433af99bc7566d5da9f264ece44d3, while the completion evidence and QA plan use 4468082627ea89698a9285c3dfda362e041090f9. The focused run did not cover the newer base. GitHub reports the merge state as CLEAN.
- The patch shows only part of the Plan, so it cannot confirm that pin-recovery-unparseable-time-order is the next eligible Action in queue order.

## Reviewer provenance

- Profile: claude_planning
- Provider: claude-code-cli
- Model: opus
- Provider mapping: bundled-2026-07-25.1 / claude-review
- Executor exit status: 0

## Authority boundary

This QA report is evidence for the operator. It does not approve release, merge, deploy, post to GitHub, or modify the Candidate.
