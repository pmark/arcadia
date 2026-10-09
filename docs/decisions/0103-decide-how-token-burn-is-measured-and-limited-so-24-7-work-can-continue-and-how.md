---
arcadia: v1
type: decision
id: "0103"
slug: decide-how-token-burn-is-measured-and-limited-so-24-7-work-can-continue-and-how
project: arcadia
status: open
question: Decide how token burn is measured and limited so 24/7 work can continue, and how the operator emergency reserve is kept from agents.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Percent-of-window budget with a proof-gated reserve. Unattended Sessions and delegations cannot use the reserve. Releasing reserve, or lowering its size, is offered as an operator-script library entry (kind grant) run through the governed operator-script path, published in advance, and takes effect only with a valid operator presence proof. Burn rate comes from stored capacity observations. When projected use reaches the reserve before reset, new delegations queue first and then new Sessions stop
options:
  - label: Percent-of-window budget with a proof-gated reserve. Unattended Sessions and delegations cannot use the reserve. Releasing reserve, or lowering its size, is offered as an operator-script library entry (kind grant) run through the governed operator-script path, published in advance, and takes effect only with a valid operator presence proof. Burn rate comes from stored capacity observations. When projected use reaches the reserve before reset, new delegations queue first and then new Sessions stop
    consequence: Deterministic, and it reuses existing capacity observations. Running the script, writing a receipt or editing a file never releases reserve without the proof. An emergency needs the operator to complete the proof, so a proof outage blocks release. Precision is limited to provider percentages and the 15-minute freshness window.
    recommended: true
  - label: Per-Session token counts parsed from provider usage output, with a daily token cap per provider and the same proof-gated reserve
    consequence: Precise attribution to each agent. It needs new usage collectors per provider, which some may not expose, and window percentages are still needed for resets.
    recommended: false
  - label: Fixed concurrency caps only (at most N Sessions and M delegates), with no burn measurement and no reserve
    consequence: Trivial to build. It protects no reserve for the operator and cannot tell whether 24/7 work will last until reset.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0103: Decide how token burn is measured and limited so 24/7 work can continue, and how the operator emergency reserve is kept from agents.

## Options

- **Percent-of-window budget with a proof-gated reserve. Unattended Sessions and delegations cannot use the reserve. Releasing reserve, or lowering its size, is offered as an operator-script library entry (kind grant) run through the governed operator-script path, published in advance, and takes effect only with a valid operator presence proof. Burn rate comes from stored capacity observations. When projected use reaches the reserve before reset, new delegations queue first and then new Sessions stop** (recommended): Deterministic, and it reuses existing capacity observations. Running the script, writing a receipt or editing a file never releases reserve without the proof. An emergency needs the operator to complete the proof, so a proof outage blocks release. Precision is limited to provider percentages and the 15-minute freshness window.
- **Per-Session token counts parsed from provider usage output, with a daily token cap per provider and the same proof-gated reserve**: Precise attribution to each agent. It needs new usage collectors per provider, which some may not expose, and window percentages are still needed for resets.
- **Fixed concurrency caps only (at most N Sessions and M delegates), with no burn measurement and no reserve**: Trivial to build. It protects no reserve for the operator and cannot tell whether 24/7 work will last until reset.

## Rationale

The operator wants token burn rate monitored and managed so 24/7 work can be sustained, with a configurable amount of emergency tokens always available for the operator. Providers report windows as percentages used. Admission today keeps a fixed reserveMarginPercentage of 5 (src/codingAgents/capacity.ts:164, inside CAPACITY_ADMISSION_LIMITS at :160). Verified on main: nothing today proves a request came from the operator. The dashboard states it has no auth or identity layer (apps/dashboard/lib/originGuard.ts). Operator-script receipts are plain files, and scripts can be run from any shell. production capacity attest and ARCADIA_OPERATOR_SCRIPT_ID are callable by any agent. So the operator presence proof is its own Decision (decide-operator-presence-proof-2026-10-09), and the reserve size is another (decide-operator-reserve-size-2026-10-09-r3). This concerns included provider capacity only, and paid credits stay off-limits. Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-burn-rate-and-emergency-reserve-2026-10-09-r3.
