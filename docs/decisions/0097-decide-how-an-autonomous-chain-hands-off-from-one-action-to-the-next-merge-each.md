---
arcadia: v1
type: decision
id: "0097"
slug: decide-how-an-autonomous-chain-hands-off-from-one-action-to-the-next-merge-each
project: arcadia
status: open
question: "Decide how an autonomous chain hands off from one Action to the next: merge each Action to main before launching the next, keep stacking each Action on its unmerged predecessor, or decide after the single-session proof. Nothing changes by raising this Decision."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Merge-then-next: each Action merges to main before the next launches"
options:
  - label: "Merge-then-next: each Action merges to main before the next launches"
    consequence: "A chain becomes a loop of reliable single runs. Each Action's draft PR must be merged to main under the Decision 0060/0080 gate (independent review of the exact head, all required checks green, clean merge state) before the next Action launches from the new main. Stacked bases and the wrong-base class of failure disappear, because every PR is judged against real main. The stacked-base code keeps running in preservation but resolves to the project base. Cost: nothing merges automatically today, so an unattended chain needs a new automated review-and-merge capability (its own Plan), and until then a person, or an agent under Decisions 0060 and 0080, merges each step. A chain moves at one review-and-CI cycle per Action, and a failed gate stops it at a merged, consistent main."
    recommended: true
  - label: "Keep stacking (current, #987 option a)"
    consequence: The next Action keeps building on its predecessor's unmerged branch, so a chain can run ahead of review and CI and needs no automated merge. Each later PR is judged against a stacked base, and that review and QA handoff is where every rehearsal so far has failed. Rehearsals resume on the current design after the single-session proof.
    recommended: false
  - label: Decide after the single-session proof
    consequence: Chain rehearsals stay paused until the reliable single-session Plan's live proof passes. This Decision is then asked again with that evidence. No chain work is scheduled meanwhile.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0097: Decide how an autonomous chain hands off from one Action to the next: merge each Action to main before launching the next, keep stacking each Action on its unmerged predecessor, or decide after the single-session proof. Nothing changes by raising this Decision.

## Options

- **Merge-then-next: each Action merges to main before the next launches** (recommended): A chain becomes a loop of reliable single runs. Each Action's draft PR must be merged to main under the Decision 0060/0080 gate (independent review of the exact head, all required checks green, clean merge state) before the next Action launches from the new main. Stacked bases and the wrong-base class of failure disappear, because every PR is judged against real main. The stacked-base code keeps running in preservation but resolves to the project base. Cost: nothing merges automatically today, so an unattended chain needs a new automated review-and-merge capability (its own Plan), and until then a person, or an agent under Decisions 0060 and 0080, merges each step. A chain moves at one review-and-CI cycle per Action, and a failed gate stops it at a merged, consistent main.
- **Keep stacking (current, #987 option a)**: The next Action keeps building on its predecessor's unmerged branch, so a chain can run ahead of review and CI and needs no automated merge. Each later PR is judged against a stacked base, and that review and QA handoff is where every rehearsal so far has failed. Rehearsals resume on the current design after the single-session proof.
- **Decide after the single-session proof**: Chain rehearsals stay paused until the reliable single-session Plan's live proof passes. This Decision is then asked again with that evidence. No chain work is scheduled meanwhile.

## Rationale

Operator question, 2026-10-09: what is the real difference between chaining two Actions and executing two Actions separately?

The sessions are identical either way. Chaining only automates the handoff: detect the end, judge completion, integrate, advance the pointer and launch the next.

Today's chain may not merge partway through, so on Decision #987 option (a) Action 2 builds on Action 1's unmerged branch as stacked PRs (#1006). Every rehearsal failure in runs 1-7 occurred in that handoff (review verdicts, QA, a wrong base), never inside a single session.

Nothing on main merges a PR automatically today. The only automatic integration is a local fast-forward under Decision 0058. Chain rehearsals resume after the reliable single-session Plan's live proof, using whichever option you choose.

Proposed by Agent Ask raise-chain-handoff-decision-20261009-r3.
