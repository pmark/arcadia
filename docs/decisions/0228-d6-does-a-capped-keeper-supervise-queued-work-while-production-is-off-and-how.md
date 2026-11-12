---
arcadia: v1
type: decision
id: "0228"
slug: d6-does-a-capped-keeper-supervise-queued-work-while-production-is-off-and-how
project: arcadia
status: open
question: "D6: Does a capped keeper supervise queued work while production is Off, and how does a successor take over?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A
options:
  - label: A
    consequence: Define bounded service duty from the already-approved work window, distinct from Active. One capped keeper may remain while Off for known queued or blocked work, amending 0190's stop-at-Off rule. It ends at explicit STOP or expiry unless separately renewed. A successor re-resolves durable grants and proves eligibility for delegated presses. Where grants bind only the predecessor, a narrow governed successor binding is requested. Housekeeping can continue without silently granting another day or START.
    recommended: true
  - label: B
    consequence: Retain stop-at-Off and the existing successor authority limits. Deterministic monitoring stays available. Clearer alarms, but no promise of supervision between runs or across a lost coordinator. Grants no START.
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-12
---

# Decision 0228: D6: Does a capped keeper supervise queued work while production is Off, and how does a successor take over?

## Options

- **A** (recommended): Define bounded service duty from the already-approved work window, distinct from Active. One capped keeper may remain while Off for known queued or blocked work, amending 0190's stop-at-Off rule. It ends at explicit STOP or expiry unless separately renewed. A successor re-resolves durable grants and proves eligibility for delegated presses. Where grants bind only the predecessor, a narrow governed successor binding is requested. Housekeeping can continue without silently granting another day or START.
- **B**: Retain stop-at-Off and the existing successor authority limits. Deterministic monitoring stays available. Clearer alarms, but no promise of supervision between runs or across a lost coordinator. Grants no START.

## Rationale

Decision 0190 says stop at Off, so no monitor runs between runs or after a lost coordinator. Production was Off about 15 hours on 11-11 to 11-12. Sources: agentask_93d0170cd186a88db7 and agentask_b99a3e8db0ae4c862f (Codex base). This decision grants no START and preserves Constitution gates: no silent day grant, no START, and durable grants must be re-resolved by a successor. Chat-only approval does not transfer.

Proposed by Agent Ask decision-d6-supervision-while-off-successor-20261112.
