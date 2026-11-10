---
arcadia: v1
type: decision
id: "0209"
slug: record-the-one-time-public-field-notes-deployment-of-the-approved-canyon-pass
project: arcadia
status: open
question: "Record the one-time public Field Notes deployment of the approved Canyon Pass ride and animated sky through PR #2414 and the existing Blog GitHub Pages workflow."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Publish the Canyon Pass ride and animated sky
options:
  - label: Publish the Canyon Pass ride and animated sky
    consequence: "Merge the reviewed green PR #2414 and verify the existing public Pages deployment and Field Notes rendering."
    recommended: true
  - label: Keep the Canyon Pass ride and animated sky in preview
    consequence: Leave the candidate open and keep the currently published Field Notes version.
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-10
---

# Decision 0209: Record the one-time public Field Notes deployment of the approved Canyon Pass ride and animated sky through PR #2414 and the existing Blog GitHub Pages workflow.

## Options

- **Publish the Canyon Pass ride and animated sky** (recommended): Merge the reviewed green PR #2414 and verify the existing public Pages deployment and Field Notes rendering.
- **Keep the Canyon Pass ride and animated sky in preview**: Leave the candidate open and keep the currently published Field Notes version.

## Rationale

Operator interaction opint_fdc550d0efed40f0b9 approved deployment in chat. The operator then requested more room below the last article card and vertical alignment of the hero diamond with the Arcadia Dev Blog label. The final site revision is b84f02bae309ef4e560c61e729faa43cad0c913f; it contains both refinements and the previously approved #2414 and #2410 changes. This supersedes the earlier candidate-only record; main assigned Decision 0208 to the separate article publication in PR #2418. Merge #2414 after independent review, required checks and a clean merge state, then verify public Pages rendering. This Decision only covers Field Notes.

Proposed by Agent Ask decision-field-notes-canyon-ride-release-20261109-r3.
