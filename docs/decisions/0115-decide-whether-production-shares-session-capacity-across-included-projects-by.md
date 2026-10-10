---
arcadia: v1
type: decision
id: "0115"
slug: decide-whether-production-shares-session-capacity-across-included-projects-by
project: arcadia
status: open
question: Decide whether production shares Session capacity across included Projects by percentage shares, so a lower Project can run while a higher one still has ready work.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Percentage shares per included Project, highest-priority Project first when shares tie
options:
  - label: Percentage shares per included Project, highest-priority Project first when shares tie
    consequence: Each included Project gets a share of Session starts (for example PPN 70, Arcadia 30). The tick favors the Project furthest below its share, measured over a rolling window of Session starts per provider window, never across providers. A Project with no admissible Action gives its turn to the next by priority. Needs a starvation-and-share readout on /production. At 1-3 Sessions the split is coarse and alternates.
    recommended: true
  - label: Strict priority over included Projects
    consequence: A lower Project runs only when every higher one has no admissible Action. No new scheduler state; a starvation signal shows how long lower Projects waited. Breadth stays a later option.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-10
---

# Decision 0115: Decide whether production shares Session capacity across included Projects by percentage shares, so a lower Project can run while a higher one still has ready work.

## Options

- **Percentage shares per included Project, highest-priority Project first when shares tie** (recommended): Each included Project gets a share of Session starts (for example PPN 70, Arcadia 30). The tick favors the Project furthest below its share, measured over a rolling window of Session starts per provider window, never across providers. A Project with no admissible Action gives its turn to the next by priority. Needs a starvation-and-share readout on /production. At 1-3 Sessions the split is coarse and alternates.
- **Strict priority over included Projects**: A lower Project runs only when every higher one has no admissible Action. No new scheduler state; a starvation signal shows how long lower Projects waited. Breadth stays a later option.

## Rationale

In the 2026-10-09 /production design session the operator chose this option in chat; this Decision records it for the operator's own answer. It amends the no-fairness rule in docs/production-scheduling.md and the Action-queue priority authority of Decisions 0048 and 0054 for cross-Project admission. An adversarial review (Fable) recommended strict priority because shares oscillate at 1-3 Sessions; the operator chose shares to keep breadth (usable work across several areas, then iterate).

Proposed by Agent Ask decide-project-capacity-shares-2026-10-09.
