---
arcadia: v1
type: decision
id: "0250"
slug: record-the-one-time-approval-to-merge-prs-2749-and-2751-and-publish-the
project: arcadia
status: open
question: "Record the one-time approval to merge PRs #2749 and #2751 and publish the approved canyon terrain and dust to Field Notes."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Publish the approved canyon terrain and dust
options:
  - label: Publish the approved canyon terrain and dust
    consequence: "Merge PR #2749 and then #2751 after verified review, green checks and clean merge, and verify the public Field Notes Ride."
    recommended: true
  - label: Keep the terrain and dust in preview
    consequence: Keep both drafts and leave the published Field Notes site as it is.
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-replace-the-daily-start
updated: 2026-11-17
---

# Decision 0250: Record the one-time approval to merge PRs #2749 and #2751 and publish the approved canyon terrain and dust to Field Notes.

## Options

- **Publish the approved canyon terrain and dust** (recommended): Merge PR #2749 and then #2751 after verified review, green checks and clean merge, and verify the public Field Notes Ride.
- **Keep the terrain and dust in preview**: Keep both drafts and leave the published Field Notes site as it is.

## Rationale

On 2026-11-16 Pacific time the operator said “Looks great. Let’s merge the terrain and dust PRs and get both changes live on Field Notes.” Interaction opint_46016293c3564ada82 retains the exact approval. The approved, independently reviewed site heads are terrain f0837e3dbeadf3751194af76076fcadc331a432c and dust 9200e7c2b8091a4deaf79d92fcb7ddca6c336787. The stacked release uses the existing Blog GitHub Pages workflow and the Field Notes destination recorded under Decision 0165.

Proposed by Agent Ask decision-publish-field-notes-terrain-dust-2749-2751-20261116.
