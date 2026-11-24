---
arcadia: v1
type: decision
id: "0289"
slug: may-a-refused-successor-or-per-card-press-that-consumed-nothing-retry-under-the
project: arcadia
status: approved
question: May a refused successor or per-card press that consumed nothing retry under the same grant once a fix for its cause has merged, instead of needing a new card and a new operator press?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: D. B now, then A after three clean runs of the per-card shape
options:
  - label: A. Retry under the same grant after a merged phase-cause fix, capped
    consequence: "When a press under an open grant was refused before any allowance or Session was consumed, and a PR citing that refusal's Issue (labelled phase-cause) has since merged with green checks, the timer may re-derive and retry under the same grant: at most 3 retries per grant run and at most 1 per merged fix, each still passing the full replay and preflight, with one Discord note per retry. A second refusal on the same cause after a fix still ends the grant (Decisions 0181/0187 stand). STOP, revoke, Off and expiry still end it. Consequence: a fixed defect no longer costs you a press; risk: a wrong fix retries once more before stopping, bounded by the cap and the no-consumption condition."
    recommended: false
  - label: B. Retry only on your one-tap 'retry' card, no new card or pre-mortem
    consequence: "After a merged fix, Signal pings one 'retry this grant' button; your tap re-arms the same grant. Consequence: one tap instead of a full new card cycle; you still have to be awake."
    recommended: false
  - label: C. No; every refusal needs a new card and a new press
    consequence: "Today's behaviour. Consequence: about half a day and one press per fixed defect."
    recommended: false
  - label: D. B now, then A after three clean runs of the per-card shape
    consequence: "Build the one-tap 'retry this grant' card first (option B): after a merged fix for a refusal that consumed nothing, Signal pings one button and your tap re-arms the same grant, so you see the new code before it runs. After three clean per-card runs (standing rule 2), automatic capped retry (option A) may be built and turned on, each still passing the full replay and preflight. Consequence: most of the saving now, no trust in new press code before it has proven itself; until A ships, you still tap once per fixed refusal."
    recommended: true
confidence: high
plan: draft-an-inactive-plan-of-four-worker-mergeable-actions-for-the-engine-s-first
updated: 2026-11-24
answer: D. B now, then A after three clean runs of the per-card shape
decided: 2026-11-24
---

# Decision 0289: May a refused successor or per-card press that consumed nothing retry under the same grant once a fix for its cause has merged, instead of needing a new card and a new operator press?

## Options

- **A. Retry under the same grant after a merged phase-cause fix, capped**: When a press under an open grant was refused before any allowance or Session was consumed, and a PR citing that refusal's Issue (labelled phase-cause) has since merged with green checks, the timer may re-derive and retry under the same grant: at most 3 retries per grant run and at most 1 per merged fix, each still passing the full replay and preflight, with one Discord note per retry. A second refusal on the same cause after a fix still ends the grant (Decisions 0181/0187 stand). STOP, revoke, Off and expiry still end it. Consequence: a fixed defect no longer costs you a press; risk: a wrong fix retries once more before stopping, bounded by the cap and the no-consumption condition.
- **B. Retry only on your one-tap 'retry' card, no new card or pre-mortem**: After a merged fix, Signal pings one 'retry this grant' button; your tap re-arms the same grant. Consequence: one tap instead of a full new card cycle; you still have to be awake.
- **C. No; every refusal needs a new card and a new press**: Today's behaviour. Consequence: about half a day and one press per fixed defect.
- **D. B now, then A after three clean runs of the per-card shape** (recommended): Build the one-tap 'retry this grant' card first (option B): after a merged fix for a refusal that consumed nothing, Signal pings one button and your tap re-arms the same grant, so you see the new code before it runs. After three clean per-card runs (standing rule 2), automatic capped retry (option A) may be built and turned on, each still passing the full replay and preflight. Consequence: most of the saving now, no trust in new press code before it has proven itself; until A ships, you still tap once per fixed refusal.

## Rationale

Operator, 2026-11-24 PST, in Signal 19's session (local_4ffd80da-08ca-4027-b1bc-8592a0208401), verbatim: 'Draft the standing rules on the retry decision for my approval.' Today any refusal ends the grant run for good (src/production/successorPress.ts:112-128: an ended step resumes only for FAILED_BATCH_NEEDS_FIX with a recorded clearance; SAME_REFUSAL and REPRESSES_EXHAUSTED end it), so on Nov 22-23 three fixes each needed a new card and a new operator press (about half a day each). Mira's advice: 'a refusal that spent nothing should retry itself instead of waiting for you.' This changes how a press is authorized, so it needs your answer; the code is engine-path work, built after the Wed 2026-11-25 checkpoint under the freeze rules. Nothing here is in force before you answer and merge its record PR.

Proposed by Agent Ask signal19-retry-a-refusal-that-spent-nothing-20261124b.
