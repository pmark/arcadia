---
arcadia: v1
type: decision
id: "0101"
slug: decide-what-the-first-version-of-the-dashboard-agents-page-shows-and-whether-it
project: arcadia
status: open
question: Decide what the first version of the dashboard /agents page shows and whether it can change anything.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Read-only first version: a team tree per Session or interactive session (role, supervisor, delegates and verdicts, model and effort, state, last activity) plus each provider's burn rate, reserve and throttle state, with no controls"
options:
  - label: "Read-only first version: a team tree per Session or interactive session (role, supervisor, delegates and verdicts, model and effort, state, last activity) plus each provider's burn rate, reserve and throttle state, with no controls"
    consequence: The fastest to ship, with no new mutation or auth surface. The operator still acts through existing commands and arcadia todo. Controls come back only on their named trigger.
    recommended: true
  - label: "Read plus controls: approve or decline queued delegations, pause a team, and start a reserve release, which still needs the operator presence proof"
    consequence: More useful from a phone. Each control is a new mutation that needs receipts, and the dashboard has no identity layer, so every control beyond reserve release needs its own proof design.
    recommended: false
  - label: "No new route: fold the same read model into the existing /production page"
    consequence: Less surface to maintain. It does not give the explicit /agents route the operator asked for.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0101: Decide what the first version of the dashboard /agents page shows and whether it can change anything.

## Options

- **Read-only first version: a team tree per Session or interactive session (role, supervisor, delegates and verdicts, model and effort, state, last activity) plus each provider's burn rate, reserve and throttle state, with no controls** (recommended): The fastest to ship, with no new mutation or auth surface. The operator still acts through existing commands and arcadia todo. Controls come back only on their named trigger.
- **Read plus controls: approve or decline queued delegations, pause a team, and start a reserve release, which still needs the operator presence proof**: More useful from a phone. Each control is a new mutation that needs receipts, and the dashboard has no identity layer, so every control beyond reserve release needs its own proof design.
- **No new route: fold the same read model into the existing /production page**: Less surface to maintain. It does not give the explicit /agents route the operator asked for.

## Rationale

The operator wants all Session and agent activity monitored, captured, reported and shown on a new /agents page. The dashboard already has /production and an operator-script library listing, and the operator-timeline proposal covers the same need. Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-agents-page-scope-2026-10-09-r3.
