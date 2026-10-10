---
arcadia: v1
type: decision
id: "0109"
slug: decide-whether-the-managed-production-tick-adopts-selector-enforced-start-tiers
project: arcadia
status: approved
question: Decide whether the managed-production tick adopts selector-enforced start tiers, or only records the start tier it already uses.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Record only: the tick keeps today's start behavior and records start tier, model and reason on each Session"
options:
  - label: "Record only: the tick keeps today's start behavior and records start tier, model and reason on each Session"
    consequence: No change to what unattended production launches, and /agents still sees every production start. Enforcement against heavier starts stays limited to interactive and dispatch launches.
    recommended: true
  - label: "Adopt enforcement: the tick starts on the selector's smallest compliant start model, and anything heavier needs a recorded reason, derived automatically from the packet's plan pin"
    consequence: Production gets the same start rule as everything else and may cost less. Unattended Sessions can run smaller than they do today, which may need more escalations or repairs. It changes production launch behavior.
    recommended: false
  - label: Leave managed production out of start-tier work entirely
    consequence: No production change at all. Production starts stay off the /agents start-tier view, so the picture of what each Session started on is incomplete.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: "Record only: the tick keeps today's start behavior and records start tier, model and reason on each Session"
decided: 2026-10-09
---

# Decision 0109: Decide whether the managed-production tick adopts selector-enforced start tiers, or only records the start tier it already uses.

## Options

- **Record only: the tick keeps today's start behavior and records start tier, model and reason on each Session** (recommended): No change to what unattended production launches, and /agents still sees every production start. Enforcement against heavier starts stays limited to interactive and dispatch launches.
- **Adopt enforcement: the tick starts on the selector's smallest compliant start model, and anything heavier needs a recorded reason, derived automatically from the packet's plan pin**: Production gets the same start rule as everything else and may cost less. Unattended Sessions can run smaller than they do today, which may need more escalations or repairs. It changes production launch behavior.
- **Leave managed production out of start-tier work entirely**: No production change at all. Production starts stay off the /agents start-tier view, so the picture of what each Session started on is incomplete.

## Rationale

Managed production is an approval boundary under the Constitution. Today the tick already starts Sessions on the sessionStartTier model (light by default) and treats the packet's model as the escalation target (docs/model-selection.md). The plan enforces start tiers for interactive and dispatch launches first. This Decision covers only the managed-production launch path. Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-managed-production-start-tier-2026-10-09.
