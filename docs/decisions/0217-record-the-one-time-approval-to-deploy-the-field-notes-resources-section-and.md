---
arcadia: v1
type: decision
id: "0217"
slug: record-the-one-time-approval-to-deploy-the-field-notes-resources-section-and
project: arcadia
status: open
question: Record the one-time approval to deploy the Field Notes Resources section and its navigation on the existing GitHub Pages blog.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Publish the Field Notes Resources section
options:
  - label: Publish the Field Notes Resources section
    consequence: Merge the independently reviewed, green Resources change through its PR and deploy it through the existing Blog GitHub Pages workflow. Verify the public Resources page, menu links, and original source and published Field Note pairings.
    recommended: true
  - label: Keep Resources in preview
    consequence: Preserve the reviewed candidate without deploying Resources to the public blog.
    recommended: false
confidence: high
plan: carry-out-decision-0214-answer-a-unattended-production-s-worker-may-merge-src
updated: 2026-11-10
---

# Decision 0217: Record the one-time approval to deploy the Field Notes Resources section and its navigation on the existing GitHub Pages blog.

## Options

- **Publish the Field Notes Resources section** (recommended): Merge the independently reviewed, green Resources change through its PR and deploy it through the existing Blog GitHub Pages workflow. Verify the public Resources page, menu links, and original source and published Field Note pairings.
- **Keep Resources in preview**: Preserve the reviewed candidate without deploying Resources to the public blog.

## Rationale

On November 10, 2026 Pacific time the operator directed adding a Resources section to the blog, pairing original materials with the Field Notes that apply them. Interaction receipt opint_a69a9e949abb4699ad preserves the exact instruction; Issue #2466 tracks the change. Decision 0165 identifies the public site and existing Blog workflow. Limit this release to the Resources catalog and page, the Field Notes navigation, and their maintenance note. The companion essay has a separate one-time publication Decision. Preserve exact-head independent review, all required CI checks, Blog build, clean merge and live verification.

Proposed by Agent Ask decision-field-notes-resources-20261110.
