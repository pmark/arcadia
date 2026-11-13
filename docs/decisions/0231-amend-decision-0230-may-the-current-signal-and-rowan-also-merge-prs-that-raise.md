---
arcadia: v1
type: decision
id: "0231"
slug: amend-decision-0230-may-the-current-signal-and-rowan-also-merge-prs-that-raise
project: arcadia
status: open
question: "Amend Decision 0230: may the current Signal and Rowan also merge PRs that raise, carry, record or answer a Decision, on the same merge gate?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A: Amend Decision 0230 so Signal and Rowan may also merge PRs that raise, carry, record or answer a Decision, on the same gate. Answering a Decision still needs the operator's own verified words; START, spend, credentials and gate or branch-protection changes stay the operator's."
options:
  - label: "A: Amend Decision 0230 so Signal and Rowan may also merge PRs that raise, carry, record or answer a Decision, on the same gate. Answering a Decision still needs the operator's own verified words; START, spend, credentials and gate or branch-protection changes stay the operator's."
    consequence: "Decision PRs stop waiting for the operator's merge click; the operator still decides every Decision. Risk: an agent-written Decision PR that misstates options or an answer could land on a PASS alone, bounded by head pinning and the independent review checking the operator's quoted words."
    recommended: true
  - label: "B: Amend Decision 0230 only for PRs that record an answer the operator already gave (verified per Decision 0229); PRs that raise or carry a new Decision stay operator merges."
    consequence: Recording answers is fast, but a PR that opens a new Decision, which shapes the operator's choices, still waits for the operator.
    recommended: false
  - label: "C: Keep Decision-raising, carrying and answering PRs as operator merges (Decision 0230 unchanged)."
    consequence: No new risk; every Decision PR keeps waiting on the operator, adding a merge click per Decision.
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-13
---

# Decision 0231: Amend Decision 0230: may the current Signal and Rowan also merge PRs that raise, carry, record or answer a Decision, on the same merge gate?

## Options

- **A: Amend Decision 0230 so Signal and Rowan may also merge PRs that raise, carry, record or answer a Decision, on the same gate. Answering a Decision still needs the operator's own verified words; START, spend, credentials and gate or branch-protection changes stay the operator's.** (recommended): Decision PRs stop waiting for the operator's merge click; the operator still decides every Decision. Risk: an agent-written Decision PR that misstates options or an answer could land on a PASS alone, bounded by head pinning and the independent review checking the operator's quoted words.
- **B: Amend Decision 0230 only for PRs that record an answer the operator already gave (verified per Decision 0229); PRs that raise or carry a new Decision stay operator merges.**: Recording answers is fast, but a PR that opens a new Decision, which shapes the operator's choices, still waits for the operator.
- **C: Keep Decision-raising, carrying and answering PRs as operator merges (Decision 0230 unchanged).**: No new risk; every Decision PR keeps waiting on the operator, adding a merge click per Decision.

## Rationale

Re-drafted by Rowan 13 from Signal 10's proposal signal-merges-decision-prs-on-gate-20261113, whose natural-fallback preview mapped the effect to Decision 0229; the target is Decision 0230 (merge on gate, answered A: 2026-11-13, #2587). Operator words, verified per Decision 0229 in Signal 10 transcript 67f5e9a4-65f4-490c-8bde-6b77f7a9e20d: line 2395, 2026-11-13T21:14:07.643Z 'Signal merges future gate-passing PRs without asking'; line 2409, uuid e5357cda-ef56-4262-8284-ee9f30d04554, content[1], 2026-11-13T21:14:35.578Z 'Include Decision PRs too'. This grants merge only: answering a Decision still requires the operator's own words verified per Decision 0229; production START or activation, spend, credentials and gate or branch-protection changes stay with the operator. Gate is unchanged: independent PASS on the current head, required checks green, CLEAN, merge pinned to the reviewed head, production Off for runtime paths.

Proposed by Agent Ask signal-merges-decision-prs-decision-20261113.
