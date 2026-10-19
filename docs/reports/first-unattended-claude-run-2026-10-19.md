# First unattended Claude production run, 2026-10-18/19

Standalone factual record of the first multi-Action production run on Arcadia's own repository (`pmark/arcadia`, live workspace `martianrover`, provider `claude-code-cli`) under the repeatable grant card `grant-production-unattended-claude-rerun-20261018` (valid to 2026-10-25). It grants no authority. It supports Action `first-unattended-run` of the [unattended-Claude Plan](../plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md) and the re-derivation in [managed-production-readiness.md](../managed-production-readiness.md).

**Verdict: not yet.** The review-repair loop now works end to end unattended, but no Action of this run reached a merged PR unattended, and operator touches exceeded activation plus authority-adjacent merges. The operator stopped the run.

## Stages

| Stage | Observed |
| --- | --- |
| Activation | Plan Actions were pinned to the repeatable grant card. The operator pressed START, then RE-RUN at epochs 34, 35 and 36, with a STOP before each fix merge and at the end. |
| Action 1 | Merged as PR #1534. The Release Manager merged it after a stray-Ask cleanup commit. |
| Action 2 | Merged as PR #1535 by the operator despite a failed independent review (defect #1536). |
| Action 3 | `implement-docs-reports-first-supervised-claude`, Session `session_9ebf706334ff4b4eb5`, PR #1545 head 71d40eb99459. Independent code review failed: the report omitted #1512, and the deterministic check refused its not-applicable claims. The Release Manager drafted #1545 with Do-not-merge. |
| Repair | Failed verdict, draft plus comment, repair Session `session_c2387f0c86504224a4` launched 05:12:52Z and settled head a6e473d8f7c5; repair PR #1554 opened; the worker closed #1545 as superseded; a fresh review ran. |
| Fresh review | Needs-follow-up and gated authority-adjacent because of patch-check defects (failure h). The operator stopped the run; #1554 stayed drafted with Do-not-merge. |

## Failures and fixes

| # | Failure | Fix or tracking |
| --- | --- | --- |
| a | The repair loop gated #1545 on the stale verdict's refused authority not-applicable claim. `qa code-review` refuses while production is Off and refuses a draft PR, so a rerun ran only after the press; the operator approved marking #1545 ready briefly. | #1552 |
| b | The gated repair row (keyed session plus head, `ON CONFLICT DO NOTHING`) never re-judged on a newer verdict. | #1552 |
| c | A gate ping over 500 characters failed to queue. | #1552 |
| d | A validated not-applicable claim on Security and authority still gated. | #1552 |
| e | The repair launch was refused "not ready to launch" by the candidate's own pending completion Ask `agentask_f3b1644fe08cf772fe`. | #1553 |
| f | `capacity_refused`: the Claude usage refresh returned 401 on the worker host and the reading was 6 hours stale. The operator signed in again. | Issue #1559 |
| g | `session_environment_wall`: preservation heartbeat 15s old against a 15s limit under load. | Issue #1558 |
| h | Mission Log bump at date rollover refused as non-append; the controller's retire-completion-draft commit 2bbc69665 not attested; settlement commits authored under the operator's git identity. | Issues #1555, #1556, #1557 |
| i | An Action merged despite a failed independent review. | Defect #1536 |

Infrastructure PRs merged during the run: #1539 (production review-repair loop; Release Manager merge on clean exact-head review and green CI), #1546 (pre-mortem fixes; Release Manager merge; follow-ups #1549, #1550, #1551), #1552 (re-judge a never-launched gated repair row on a newer verdict, cap the repair ping at 500 characters, a verified not-applicable authority criterion no longer gates; operator-approved, with the operator committing, pushing and merging because the classifier blocked an agent commit), #1553 (a repair launch is not gated by the superseded candidate's own pending completion Ask, including the resume path and exact target match; operator merged). Earlier fixes in the same effort: #1531, #1533, #1537, #1541, #1543, #1548.

## Operator touches

- START and RE-RUN presses: initial run and RE-RUNs at epochs 34, 35, 36.
- STOP presses: before each fix merge and at the end.
- Merges: #1535 (failed review), #1552, #1553.
- Hand commit and push of #1552's gate change.
- Approval to mark #1545 ready briefly so a review rerun could run.
- Claude re-sign-in on the worker host.
- Decisions on narrowing the gate and on stopping the run.

Release Manager touches: merge of #1534 and its stray-Ask cleanup commit; merges of #1539 and #1546; drafting #1545 and #1554; the review rerun.

## Acceptance criteria of `first-unattended-run`

| Criterion | Status |
| --- | --- |
| 1. A production preview for at least three ready Actions on Claude is published and activation presented as one card; agents do not activate. | Met 2026-10-18, as recorded in the earlier sections of the readiness document. |
| 2. Every Action reaches a merged PR, with each operator touch listed and none other than activation and authority-adjacent merges. | **Not met.** No Action reached a merged PR unattended; the touches listed above go beyond activation and authority-adjacent merges. |
| 3. `docs/managed-production-readiness.md` is re-derived from the run with the new verdict and every failure. | Met by the change that adds this report. |

The Action is not complete.

## Lesson

Every defect of this run was visible in live database rows before the press. The next step is a live-state replay: copy the live database and candidate refs into a throwaway workspace and run the worker tick offline to the launch or to the stop before any further press.
