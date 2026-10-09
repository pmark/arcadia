---
arcadia: v1
type: decision
id: "0097"
slug: decide-how-an-autonomous-chain-hands-off-from-one-action-to-the-next-merge-each
project: arcadia
status: open
question: "Decide how an autonomous chain hands off from one Action to the next: merge each Action to main before launching the next, or keep stacking each Action on its unmerged predecessor. Nothing changes by raising this Decision."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Merge-then-next: each Action merges to main before the next launches"
options:
  - label: "Merge-then-next: each Action merges to main before the next launches"
    consequence: "A chain becomes a loop of reliable single runs. Each Action's draft PR is reviewed and merged to main under the existing Decision 0060 and 0080 gate (independent review of the exact head, all required checks green, clean merge state), and only then does the next Action launch from the new main. Stacked bases and the wrong-base class of failure disappear, and every PR is judged against real main. A chain moves at merge speed, roughly one review-and-CI cycle per Action. A failed gate stops the chain at a merged, consistent main. The stacked-PR code from #1006 stays but chains stop using it."
    recommended: true
  - label: "Keep stacking (current, #987 option a)"
    consequence: The next Action keeps building on its predecessor's unmerged branch, so a chain can run ahead of review and CI and finish sooner. Each later PR is judged against a stacked base, and the review and QA handoff remains the part that has failed in every rehearsal so far. Rehearsals resume on the current design after the single-session proof.
    recommended: false
  - label: Decide after the single-session proof
    consequence: Chain rehearsals stay paused until the reliable single-session Plan's live proof passes, and then this Decision is asked again with that evidence. No chain work is scheduled meanwhile.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0097: Decide how an autonomous chain hands off from one Action to the next: merge each Action to main before launching the next, or keep stacking each Action on its unmerged predecessor. Nothing changes by raising this Decision.

## Options

- **Merge-then-next: each Action merges to main before the next launches** (recommended): A chain becomes a loop of reliable single runs. Each Action's draft PR is reviewed and merged to main under the existing Decision 0060 and 0080 gate (independent review of the exact head, all required checks green, clean merge state), and only then does the next Action launch from the new main. Stacked bases and the wrong-base class of failure disappear, and every PR is judged against real main. A chain moves at merge speed, roughly one review-and-CI cycle per Action. A failed gate stops the chain at a merged, consistent main. The stacked-PR code from #1006 stays but chains stop using it.
- **Keep stacking (current, #987 option a)**: The next Action keeps building on its predecessor's unmerged branch, so a chain can run ahead of review and CI and finish sooner. Each later PR is judged against a stacked base, and the review and QA handoff remains the part that has failed in every rehearsal so far. Rehearsals resume on the current design after the single-session proof.
- **Decide after the single-session proof**: Chain rehearsals stay paused until the reliable single-session Plan's live proof passes, and then this Decision is asked again with that evidence. No chain work is scheduled meanwhile.

## Rationale

Operator question, 2026-10-09: what is the real difference between chaining two Actions and executing two Actions separately?

The sessions are identical either way. Chaining only automates the handoff: detect the end, judge completion, integrate, advance the pointer and launch the next. Today's chain may not merge partway through, so on Decision #987 option (a) Action 2 builds on Action 1's unmerged branch as stacked PRs (implemented in #1006). Every rehearsal failure in runs 1-7 occurred in that handoff (review verdicts, QA, and a wrong base), never inside a single session.

Chain rehearsals resume after the reliable single-session Plan's live proof, using whichever option you choose.

Proposed by Agent Ask raise-chain-handoff-decision-20261009.
