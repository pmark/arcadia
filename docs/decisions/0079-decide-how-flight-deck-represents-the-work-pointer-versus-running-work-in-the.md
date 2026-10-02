---
arcadia: v1
type: decision
id: "0079"
slug: decide-how-flight-deck-represents-the-work-pointer-versus-running-work-in-the
project: arcadia
status: open
question: Decide how Flight Deck represents the work pointer versus running work in the Project → Plan → Action tree.
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Separate Selected and Running indicators
options:
  - label: Separate Selected and Running indicators
    consequence: Each Plan shows its canonical current_action as Selected at that Plan's scope; every Action with a live Session independently shows Running, so several can run at once and a Selected-but-blocked or Selected-but-idle Action is visible as such. Mismatches between pointer and Sessions are flagged as conflicts, not hidden.
    recommended: true
  - label: One combined Active indicator
    consequence: "Simpler view: the pointer and live Sessions fold into a single Active marker. Selected-but-idle and parallel Sessions become indistinguishable, which is the confusion this Plan exists to remove."
    recommended: false
  - label: Running only; hide the pointer
    consequence: The tree shows only live Sessions. What runs next is invisible here and must be read from PROJECT.md or GitHub Kanban, so the view no longer answers 'what's next'.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-02
---

# Decision 0079: Decide how Flight Deck represents the work pointer versus running work in the Project → Plan → Action tree.

## Options

- **Separate Selected and Running indicators** (recommended): Each Plan shows its canonical current_action as Selected at that Plan's scope; every Action with a live Session independently shows Running, so several can run at once and a Selected-but-blocked or Selected-but-idle Action is visible as such. Mismatches between pointer and Sessions are flagged as conflicts, not hidden.
- **One combined Active indicator**: Simpler view: the pointer and live Sessions fold into a single Active marker. Selected-but-idle and parallel Sessions become indistinguishable, which is the confusion this Plan exists to remove.
- **Running only; hide the pointer**: The tree shows only live Sessions. What runs next is invisible here and must be read from PROJECT.md or GitHub Kanban, so the view no longer answers 'what's next'.

## Rationale

A work pointer and running work are different facts. The operator stated the intended design on 2026-10-01: show the canonical pointer at its actual scope, plus a separate running indicator on every Action with a live Session; selecting an Action must never imply that it is executing; multiple running Actions can appear simultaneously. A reasonable person could instead collapse them into one 'active' marker, so this is recorded as a Decision that governs plan flight-deck tree Actions define-flight-deck-tree-data-contract and build-flight-deck-execution-tree (companion Ask plan-flight-deck-execution-tree-2026-10-01).

Proposed by Agent Ask decision-work-pointer-vs-running-indicator-2026-10-01-v2.
