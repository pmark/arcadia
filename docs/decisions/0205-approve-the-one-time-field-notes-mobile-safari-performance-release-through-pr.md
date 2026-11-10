---
arcadia: v1
type: decision
id: "0205"
slug: approve-the-one-time-field-notes-mobile-safari-performance-release-through-pr
project: arcadia
status: approved
question: "Approve the one-time Field Notes Mobile Safari performance release through PR #2388 and the existing Blog GitHub Pages workflow after exact-head review and required checks pass."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Publish the Field Notes mobile fix
options:
  - label: Publish the Field Notes mobile fix
    consequence: "Merge the reviewed green PR #2388 and verify the Pages deployment and public rendering."
    recommended: true
  - label: Keep the fix in review
    consequence: "Leave PR #2388 open and preserve the current public version."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-09
answer: Publish the Field Notes mobile fix
decided: 2026-11-09
---

# Decision 0205: Approve the one-time Field Notes Mobile Safari performance release through PR #2388 and the existing Blog GitHub Pages workflow after exact-head review and required checks pass.

## Options

- **Publish the Field Notes mobile fix** (recommended): Merge the reviewed green PR #2388 and verify the Pages deployment and public rendering.
- **Keep the fix in review**: Leave PR #2388 open and preserve the current public version.

## Rationale

Issue #2387 reports jumpy canyon scrolling in Mobile Safari. The repair eliminates scroll-time canvas copying, uses a fixed star field and a full-width header, honors system reduced motion, and labels the page Arcadia Dev Blog. Decision 0204 was scoped to the earlier release through PR #2385.

Proposed by Agent Ask decision-field-notes-mobile-performance-release-20261109.
