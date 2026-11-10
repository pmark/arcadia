---
arcadia: v1
type: decision
id: "0206"
slug: record-the-one-time-public-field-notes-deployment-of-the-reviewed-rover-track
project: arcadia
status: approved
question: "Record the one-time public Field Notes deployment of the reviewed rover-track Canyon Pass preview through PR #2401 and the existing Blog GitHub Pages workflow."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Publish the Canyon Pass rover-track preview
options:
  - label: Publish the Canyon Pass rover-track preview
    consequence: "Merge the reviewed green PR #2401 into main and verify the existing public Pages deployment and Field Notes rendering."
    recommended: true
  - label: Keep the Canyon Pass rover-track preview private
    consequence: Leave the draft on the preview branch and keep the currently published Field Notes version.
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-09
answer: Publish the Canyon Pass rover-track preview
decided: 2026-11-09
---

# Decision 0206: Record the one-time public Field Notes deployment of the reviewed rover-track Canyon Pass preview through PR #2401 and the existing Blog GitHub Pages workflow.

## Options

- **Publish the Canyon Pass rover-track preview** (recommended): Merge the reviewed green PR #2401 into main and verify the existing public Pages deployment and Field Notes rendering.
- **Keep the Canyon Pass rover-track preview private**: Leave the draft on the preview branch and keep the currently published Field Notes version.

## Rationale

The operator approved the Tailnet preview in chat with the exact words: I love it. Let's get it deployed. PR #2401 at a8683f76b3c60c23d0ba537c5bf4d17a6fc7bed5 includes the Canyon Pass fixes from PR #2390 and the rover tracks and stones. Deliver the same product diff in one publication by retargeting PR #2401 to main, then merge once independent review, required checks and clean merge are confirmed. No separate deploy of the base PR is needed.

Proposed by Agent Ask decision-field-notes-rover-tracks-release-20261109.
