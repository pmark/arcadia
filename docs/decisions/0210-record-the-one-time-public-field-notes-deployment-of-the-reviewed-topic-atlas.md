---
arcadia: v1
type: decision
id: "0210"
slug: record-the-one-time-public-field-notes-deployment-of-the-reviewed-topic-atlas
project: arcadia
status: open
question: "Record the one-time public Field Notes deployment of the reviewed Topic Atlas and clickable article tags through PR #2412 and the existing Blog GitHub Pages workflow."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Publish the Topic Atlas
options:
  - label: Publish the Topic Atlas
    consequence: "After current-head independent review and required checks pass, merge PR #2412 to trigger the existing GitHub Pages workflow. Verify the public Topic Atlas and clickable tags."
    recommended: true
  - label: Keep the Topic Atlas in preview
    consequence: "Leave PR #2412 open and keep the currently published Field Notes site."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-10
---

# Decision 0210: Record the one-time public Field Notes deployment of the reviewed Topic Atlas and clickable article tags through PR #2412 and the existing Blog GitHub Pages workflow.

## Options

- **Publish the Topic Atlas** (recommended): After current-head independent review and required checks pass, merge PR #2412 to trigger the existing GitHub Pages workflow. Verify the public Topic Atlas and clickable tags.
- **Keep the Topic Atlas in preview**: Leave PR #2412 open and keep the currently published Field Notes site.

## Rationale

On November 9, 2026 Pacific time, the operator instructed “Publish the Topic Atlas.” Operator interaction opint_d3f38866002d41a785 records those words. Independent review cleared the site change at eafc7727f552b3df974d303dbc946687e33605cb. This approval covers only the Topic Atlas, its tag metadata and navigation on the public Field Notes site at https://pmark.github.io/arcadia/. Decision 0165 identifies the destination. Keep the existing article approval and withdrawal gates, channels, credentials and Arcadia managed Production state. Verify the live atlas and working topic links after deployment.

Proposed by Agent Ask decision-publish-field-notes-topic-atlas-20261109.
