---
arcadia: v1
type: decision
id: "0223"
slug: d1-who-may-park-a-showstopped-action-during-an-unattended-production-run
project: arcadia
status: approved
question: "D1: Who may park a showstopped Action during an unattended production run?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A
options:
  - label: A
    consequence: "Extend the existing held-candidate skip to named Action-local classes only: repair-budget exhaustion and validation-environment holds. Candidate, counters and evidence are kept; dependents do not launch; global, unknown or shared failures (sign-in, authority, STOP, storage, custody) still hold the run. The tick parks the Action with an Issue and revival trigger; you see parked Actions in the digest and can reinstate any. Independent authorized work continues while it waits. Grants no START."
    recommended: true
  - label: B
    consequence: Keep the three existing review-repair held kinds only. No new policy and no immediate change, but other stop classes can still idle the scope until you act. Grants no START.
    recommended: false
  - label: C
    consequence: Require an operator disposition for every additional stop class. Strongest individual judgment, with a recurring operator wait at each stop. Grants no START.
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-12
answer: A
decided: 2026-11-12
---

# Decision 0223: D1: Who may park a showstopped Action during an unattended production run?

## Options

- **A** (recommended): Extend the existing held-candidate skip to named Action-local classes only: repair-budget exhaustion and validation-environment holds. Candidate, counters and evidence are kept; dependents do not launch; global, unknown or shared failures (sign-in, authority, STOP, storage, custody) still hold the run. The tick parks the Action with an Issue and revival trigger; you see parked Actions in the digest and can reinstate any. Independent authorized work continues while it waits. Grants no START.
- **B**: Keep the three existing review-repair held kinds only. No new policy and no immediate change, but other stop classes can still idle the scope until you act. Grants no START.
- **C**: Require an operator disposition for every additional stop class. Strongest individual judgment, with a recurring operator wait at each stop. Grants no START.

## Rationale

Production went Off on 11-11 because one held Action idled the run. The three review-repair held kinds already skip to independent work (src/production/terminalCandidates.ts, src/scheduling/scheduler.ts). This decision picks how far that skip extends. Sources: proposal agentask_93d0170cd186a88db7 (Fable, Mira) and agentask_b99a3e8db0ae4c862f (Codex, Cody Atlas). Codex base supersedes where they differ. This decision grants no START and preserves Constitution gates: merge, deploy, spend, credentials and production stay with the operator.

Proposed by Agent Ask decision-d1-who-parks-showstopped-action-20261112.
