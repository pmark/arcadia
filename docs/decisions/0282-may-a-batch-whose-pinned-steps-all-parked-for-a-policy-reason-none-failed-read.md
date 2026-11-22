---
arcadia: v1
type: decision
id: "0282"
slug: may-a-batch-whose-pinned-steps-all-parked-for-a-policy-reason-none-failed-read
project: arcadia
status: open
question: May a batch whose pinned steps all parked for a policy reason (none failed) read as 'parked for you' rather than FAILED, so the successor timer keeps pressing approved cards?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. Approve: a parked step is not a failed batch"
options:
  - label: "A. Approve: a parked step is not a failed batch"
    consequence: "When every pinned step of a batch either merged or has a recorded park because a merge rule reserves it for you (no in-run authorization, a delegated or unpinned card, a changed requirement, or a protected path), the batch reads 'parked for you' and the timer presses the next approved card; the parked pull requests wait for your merge as today. Anything else still reads FAILED and stops the engine: a red check or review, a missing review marker, an escalation, a launch or repair failure, an early Off, or a missing or unreadable park record. Consequence: production keeps building through the night and stops only on a real failure; you merge the parked work in the morning. Risk: each later card runs on top of unmerged parked work, and under A there is no limit on consecutive parked batches (option C can set one); a misread failure could run past the stop, bounded by reading every missing or unreadable record as FAILED."
    recommended: true
  - label: B. Keep the rule
    consequence: "Any unlanded pinned step reads FAILED, and the engine stops after each batch until a merged fix and a clearance. Consequence: every night needs a fix-and-clear step and usually your press; this is today's behaviour and the default if you do not answer."
    recommended: false
  - label: "C. Change: you state a different rule"
    consequence: "You describe a different rule (for example a limit on how many parked batches in a row may continue), and an agent drafts it as a new Decision for your answer. Consequence: nothing changes until that Decision is answered."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-22
---

# Decision 0282: May a batch whose pinned steps all parked for a policy reason (none failed) read as 'parked for you' rather than FAILED, so the successor timer keeps pressing approved cards?

## Options

- **A. Approve: a parked step is not a failed batch** (recommended): When every pinned step of a batch either merged or has a recorded park because a merge rule reserves it for you (no in-run authorization, a delegated or unpinned card, a changed requirement, or a protected path), the batch reads 'parked for you' and the timer presses the next approved card; the parked pull requests wait for your merge as today. Anything else still reads FAILED and stops the engine: a red check or review, a missing review marker, an escalation, a launch or repair failure, an early Off, or a missing or unreadable park record. Consequence: production keeps building through the night and stops only on a real failure; you merge the parked work in the morning. Risk: each later card runs on top of unmerged parked work, and under A there is no limit on consecutive parked batches (option C can set one); a misread failure could run past the stop, bounded by reading every missing or unreadable record as FAILED.
- **B. Keep the rule**: Any unlanded pinned step reads FAILED, and the engine stops after each batch until a merged fix and a clearance. Consequence: every night needs a fix-and-clear step and usually your press; this is today's behaviour and the default if you do not answer.
- **C. Change: you state a different rule**: You describe a different rule (for example a limit on how many parked batches in a row may continue), and an agent drafts it as a new Decision for your answer. Consequence: nothing changes until that Decision is answered.

## Rationale

Operator, 2026-11-22 (relayed by Signal 17): 'I want the production engine to be running and ready to process jobs that are on a queue. That just needs to be happening.' Today the engine stops after every batch. A batch reads clean only when production wrote scope_complete with at least one merge and no escalation (isFailedBatch, src/operatorActions/startRunDayGrant.ts:184-188), and scope_complete is written only when every pinned step is done (src/production/tick.ts:1258-1259). Every remaining Plan F step touches protected code and parks for your merge, and cards the timer presses park the standing merge at C1 by its delegation rule (src/production/standingMerge.ts:180), so every batch reads FAILED and the successor step ends until a merged-fix clearance (src/production/successorPress.ts:116-123, and the latest-press check near :161-164). This extends Rowan 26's #2891 batch-outcome question with a third outcome. 'Parked for a policy reason' means the step's pull request passed its independent review and required checks and was held only by a merge rule that reserves it for you: no in-run authorization, a standing-merge C1 park (delegated card, Action not pinned, or requirement changed since approval), or a C4 park (a protected or authority path); and it requires a recorded park event for that exact head for every pinned step that did not merge, so absent, partial or unreadable records read FAILED. Parks at C2 (review marker), C3 (checks) or C5 (production not Active) stay FAILED; 'failed' keeps its meaning: a red check or review, an escalation, a launch or repair failure, an Off before the run finished, or unreadable evidence. Answer A unblocks no Plan Action directly: it authorizes a new build Action (the parked-for-you batch reading in src/operatorActions/startRunDayGrant.ts, src/operatorActions/startRunDerive.ts and src/commands/productionSuccessor.ts), added by a Plan amendment, after which the timer can press the approved queue's next cards without a press from you per card; it pre-approves no particular Action. The two current failed presses still need their clearances. It changes what the timer presses and loosens a deliberately fail-closed rule, so it is your answer and its record PR is your merge (not Decision 0273). If you do not answer, nothing changes (B). Next free number: allocate from fresh origin/main at settle. An independent Sonnet plan-critic checked this draft against origin/main 3aee35195 (PASS WITH FIXES; fixes applied). This draft grants nothing.

Proposed by Agent Ask ellis-decision-parked-is-not-failed-batch-20261122.
