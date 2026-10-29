# PR 1867: bounded repair approval preparation

2026-10-29. Preparation only. Source repair and R7 remain paused.

## Outcome and scope

Decision 0147 is an open, unanswered question produced by the canonical Agent Ask settlement. Its A option conditionally offers one repair pass for R6-01/R6-02 and one extra independent R7; B holds. The package also preserves the existing canonical two-pointer correction described below. Merging this question and historical pointer publication does not select A, approve repair/review, transfer custody or start a writer. Authority-adjacent merge remains operator-owned.

Source candidate stays pinned at `63aaf6ffacd9ceb70720d3a021b92824f2e71874`, draft [PR 1867](https://github.com/pmark/arcadia/pull/1867). Retain [R6-01](https://github.com/pmark/arcadia/pull/1867#issuecomment-6489750617), [R6-02](https://github.com/pmark/arcadia/pull/1867#issuecomment-6489755843), Issues 1874/1875 and R1–R6 consumed allowances. Those are synthetic malformed/mismatched evidence reproductions, not proof of an observed live denial or agent modification of protected logs.

The two proposed fixes bind result requirements to the issued host contract and bind that contract to durable Session completion mode. No split has been shown to unblock other waiting PRs; #1662/#1783 have independent review/QA gates and #1787 is already merged. This package does not change their state.

## Independent preparation critique

Native independent plan-critic `/root/repair_proposal_critic`, depth 1, two bounded read-only preparation passes; inherited actual model/effort telemetry unavailable. No files, tests or live state changed by the critic; no implementation review or R7 occurred.

Initial verdict: GO for bounded package preparation, NO-GO for calling the v2 proposal or a regenerated settlement card executable repair approval. Findings and prevention:

1. **P1, wrong grant surface:** `src/operatorActions/libraryContract.ts:178–182` forbids expiry/kind/custom launcher changes on a pinned settlement. That card accepts intake and can open a question; it does not answer or enforce the repair grant. Prevention: separate question publication from the operator's eventual answer; never wrap or relabel the old NOT READY R5 card.
2. **P1, local publication gap:** `src/operatorActions/pinnedAskSettlement.ts:179–185` reports a local documents commit and never publishes it. Prevention: fresh governance candidate, exact canonical commit, candidate push/PR, independent review/checks, operator merge. Do not publish primary's unrelated ahead-two history. Local applied=true is not public authority.
3. **P2, clock/preservation ambiguity:** define a single immutable start receipt; latest full-envelope start `2026-10-29T20:01:53Z`; `deadline=min(start+3h,2026-10-29T23:01:53Z)`. Last 15 minutes only preservation/closeout; no post-expiry grace. Token targets are advisory if unmetered; elapsed/pass/round limits remain hard.
4. **P2, approval is not custody:** pin separately acknowledged coordinator handoff and existing writer/reservation evidence before actual start. The answer receipt cannot replace custody evidence.

Delta critique of the governance-only PR route: GO to create an open Decision plus its archived Ask and proof report; NO-GO to claim an executable approval until runtime guards are demonstrated. Missing approval/custody is distinct from unverified automated enforcement. These findings are retained in this report and the question-opening Ask; no source changes or expanded authority are inferred.

## Independent route audit

Native read-only researcher `/root/approval_route_audit`, depth 1, one bounded pass; actual inherited model/effort telemetry unavailable. Findings:

- Candidate settlement opens an unanswered Decision through `src/ask/settlement.ts:1444–1450`; allocation/rendering is at `:2597–2652`.
- `src/decisions/answerMenu.ts:81–114` checks document existence and committed presence on the configured local base. A published draft PR alone does not make the Decision answerable.
- After operator merge and supported local-base adoption, `/review` offers document-derived letters with consequences. The Decision-card route is stronger against stale options: `apps/dashboard/app/api/decision-card/route.ts:153–168` passes expected status/update/options digest and no-pointer-move into the canonical answer writer.
- `src/commands/decision.ts:304–328` checks those optional pins, and `:350–355` writes the answer. It does not enforce this repair's absolute deadline, elapsed limit, writer ownership or coordinator custody. The card's renewable ten-minute UI TTL is not the repair expiry.
- Answers commit locally only (`decision.ts:515–526`). Retain and publish the exact answer through the supported reviewed route before claiming public authority; successful answer submission is not remote publication.

Therefore this is a reviewable policy-question package, not a new automatic grant runner. Governed agent/coordinator checks must refuse if the A conditions cannot be established. No machine-enforced expiry/custody admission is claimed. Missing automatic support is retained as a capability gap; do not improvise another runner.

## Preserved pointer publication and CI correction

Initial PR head `d73c20ace7096b8fbfd886b8e0073652746c3811` passed its independent governance R1 but CI unit-shard-6 failed `tests/managed-documents-contract.test.ts:31`: fetched main selected the checklist although it depends on the unfinished repair. The two affected control files were identical to origin/main; a focused local run reproduced exactly that blocker. This was an existing publication inconsistency, not a new source defect or a flake. No CI rerun, test relaxation, dependency removal or fabricated completion was used.

Canonical commit `1502c0bdfc565f9aed4e1e1e378cec749fe70b6a` already records both `current_action` replacements to the repair, with receipt `qpointer_077a5ca9a4bb404e94`. Its actual parent is `a444846cf26f2c99e90ad988279c502fc23e2d5a`, already an ancestor of origin/main. Its historical operator identity is retained without rewriting; new merge/report commits use the current agent identity. Independent critic approved publishing this existing correction in the governance candidate, with fresh delta review/checks and operator-owned merge.

The candidate merged exactly `1502` conflict-free, retaining its history. Git's precomputed automatic tree and actual merged tree both equal `a15cee417aa31a8cc05a1cef9638d5b453f3727f`; the delta from d73 is exactly two pointer lines in `PROJECT.md` and the active Plan. No primary `f319` merge or PR1867 source commit was carried. A focused rerun of the unchanged managed-document contract passed **1/1**. The final PR therefore has six changed files: the four question-package files plus the two preserved pointer records. Its final-head review/CI are separate from the initial failed run.

Pointer publication preserves an already-governed selection; it does not settle the new R7 exception, complete the repair, release/resume the writer or grant a live attempt. No hand editing or rerunning the pointer command occurred.

## Publication/recovery fixture proof

Independent researcher `/root/approval_route_audit` ran `node --import tsx /private/tmp/arcadia-pr1867-publication-fixture.mts`, exit **0**, `07:34:26.199Z–07:34:29.001Z`, using disposable linked fixture repositories/workspace and a local bare remote only. Exact Ask bytes from d73 were 4471 bytes, SHA-256 `ff7f9804289fcacb46b22339160874dc47e8b9d353f8918d5f5ad8d0611d6baf`; six selected production-source blobs matched before execution.

The untracked draft was canonically previewed/applied/committed with an exact archive and open unanswered Decision. A nonexistent-local-remote push failed 128 while retaining head `4ebe9d55880721b84209d66fd8d62cc8210413b1`. Same-request settlement replay retained one Decision, one settlement and unchanged HEAD. Correcting only the fixture remote published that exact head. The menu was unanswerable before fixture base merge and answerable afterward. A synthetic B/Hold answer then created separate local commit `51f4f590c344b9009223a0c89d7540ad8eeb4c23`; the bare remote still contained the unanswered question. This proves why answer publication remains separate; it is not an operator answer or GitHub/live-surface proof.

Host-local report `/private/tmp/arcadia-pr1867-publication-WT49lH/report.json` and fixture script retain raw evidence. Earlier fixture reports retain a correctly refused primary-checkout draft and a harness assertion corrected from recovery:null to absent recovery after successful settlement. No live data/source/candidate was changed by this proof. It proves neither shared-card execution nor automatic expiry/custody admission.

## Proposed repair proof, not executed here

First reproduce R6-01/R6-02 via public reconciliation with genuine earlier fixture settlement, both primary/candidate repo roots and drafted/already-settled paths. Required-write contract with optional failed-write result must refuse; direct_required Session with unavailable contract and genuine probe must refuse. Validate check types/names/cardinality; host_validation/preservation cannot become optional. Retain source_only local preview_blocked Ask -> real host validation/settlement, compatible direct_required positive, true denial, missing/corrupt/duplicate/swapped evidence and explicit legacy coverage. Preserve the existing four Action criteria.

Authorized future repair must run focused capability/attribution/reconciliation, direction-managed and two-Action regressions, touched lint/TypeScript, build, ledger, preservation-self-check and isolated fast-rehearsal with report; exact-head R7 and required CI must pass. No such feature validation, independent R7 or live attempt occurred in this package preparation.

## Preparation evidence

- User chose independent critique/approval-package preparation, then requested continued progress and appropriate delegation while asleep. That authorizes preparation, not an answer to Decision 0147.
- Registered proposal v2 `agentask_848cf989dd610057c9`; question-opening Ask `agentask_a5a4e3a322042a0ecb` / `decide-pr1867-r7-bounded-binding-repair-20261029`.
- Canonical question-opening settlement `asksettle_c62fbd26b14b482098`, documents commit `80df7232aba22978ea62852420b304a40e78b9ff`. Preview and applied readback agree: one open Decision and archived Ask, no answer or queue/Project/Plan mutation. Input draft was untracked before archival; canonical commit preserved it as an archive.
- Separate governance branch `codex/pr1867-bounded-approval` starts at fetched main `3d2fdac1cb82396816e1048677b120628334ce90`; primary ahead-two and original source candidate were not reset, edited or published.
- Work monitor completed with no recovery/cleanup. Main checkpoint cursor remains `3d2fdac1cb82396816e1048677b120628334ce90`, both required history listings empty at preparation checkpoint. Existing source reservation/custody remain unchanged.
- Existing host fixture suites: `mise exec -- pnpm exec vitest run tests/pinned-ask-settlement.test.ts tests/decision-answer-menu.test.ts --no-file-parallelism`: **18 passed**, two files, 15.82 s. These prove existing settlement/letter-menu cases, not full new grant expiry/custody or live publication.
- Canonical `parseDoc` on the generated candidate Decision returns type decision/status open/errors empty. `node scripts/preservation-self-check.mjs`: passed, 3302 files at the Decision commit. `git diff --check`: passed. Later preparation metadata gets ledger/self-check validation before publication.

Friction retained: overlong specialization label was refused; the documented short `process pre-mortem` label succeeded. Sandbox Vite cache mkdir was EPERM; same isolated fixture run succeeded through normal host permission. `decision validate` first required --project, then sandbox workspace access was denied; host retry returned no matching file because that command reads the configured base rather than the candidate. Candidate parsing above validates its actual file without relabelling it as base-visible. A process scan was denied; no liveness/release conclusion was drawn. No guard or permission was bypassed. No live approval button was pressed.

## Remote QA and remaining gates

1. In the PR, inspect Decision 0147 and archived Ask. Expect status open, exact A/B consequences, no answer/decided fields and no changes to Project/Plan/source/queue.
2. Verify the two pointer changes exactly preserve canonical commit1502; all Action criteria/statuses and the queue remain unchanged. Inspect the clock: latest start 13:01:53 Pacific on 2026-10-29; absolute expiry 16:01:53 Pacific, with the final 15 minutes reserved. An expired question may remain visible but conveys no renewed authority.
3. Inspect this report's enforcement limitations. Do not mistake merging this open question for approving A or making the source candidate safe.
4. Only after the operator-owned merge and supported base update, verify exact document/options on the existing Decision surface. Do not promise it is answerable before that observation. Operator A answer and its canonical/publication receipts remain separate from coordinator transfer and writer start receipt.

No service/URL was started or deployed. Existing remote surface is `/review` on the configured Arcadia Dashboard; live answerability has not been claimed. This session creates no wakeup, watcher, automation, successor or custody transfer. Stop at the published reviewed PR or an exact publication blocker. Implementation remains paused pending its separate gates.
