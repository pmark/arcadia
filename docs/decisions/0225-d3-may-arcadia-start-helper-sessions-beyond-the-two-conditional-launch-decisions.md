---
arcadia: v1
type: decision
id: "0225"
slug: d3-may-arcadia-start-helper-sessions-beyond-the-two-conditional-launch-decisions
project: arcadia
status: approved
question: "D3: May Arcadia start helper sessions beyond the two conditional launch Decisions?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A
options:
  - label: A
    consequence: The designated custodian may request registered specialist types through the standard role and launch route. Lowest tier first. At most two launch attempts per assignment, a daily cap, no nested delegation, and autonomous replacement only for the bound assignment. Requires an approved finite spend and capacity envelope; a missing spend or capacity envelope refuses. Registered reviewer and QA sessions stay separate, independent Sessions, never native children. First proof targets the currently used provider; other providers follow after native tests. Removes the paste dependency. Helpers still have no authority. Grants no START.
    recommended: true
  - label: B
    consequence: Ship only the already-authorized coordinator and keeper routes and explicitly assigned helper launches. Useful today, but a helper that goes absent does not replace itself. Helpers stay background subagents of a coordinator. Grants no START.
    recommended: false
  - label: C
    consequence: Keep automatic helper launches disabled. Fails the unattended lifecycle outcome and leaves each launch call with a person. Grants no START.
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-12
answer: A
decided: 2026-11-12
---

# Decision 0225: D3: May Arcadia start helper sessions beyond the two conditional launch Decisions?

## Options

- **A** (recommended): The designated custodian may request registered specialist types through the standard role and launch route. Lowest tier first. At most two launch attempts per assignment, a daily cap, no nested delegation, and autonomous replacement only for the bound assignment. Requires an approved finite spend and capacity envelope; a missing spend or capacity envelope refuses. Registered reviewer and QA sessions stay separate, independent Sessions, never native children. First proof targets the currently used provider; other providers follow after native tests. Removes the paste dependency. Helpers still have no authority. Grants no START.
- **B**: Ship only the already-authorized coordinator and keeper routes and explicitly assigned helper launches. Useful today, but a helper that goes absent does not replace itself. Helpers stay background subagents of a coordinator. Grants no START.
- **C**: Keep automatic helper launches disabled. Fails the unattended lifecycle outcome and leaves each launch call with a person. Grants no START.

## Rationale

Helpers and registered reviewer or QA sessions currently need a person to paste a prompt. Decisions 0191 and 0190 cover only coordinator successors and the keeper. Sources: agentask_93d0170cd186a88db7 and agentask_b99a3e8db0ae4c862f. Codex base supersedes. This decision grants no START and preserves Constitution gates: helpers gain no authority, reviewer and QA stay separate independent sessions, and launch boundaries still need operator merge.

Proposed by Agent Ask decision-d3-arcadia-may-start-helper-sessions-20261112.
