---
arcadia: v1
type: decision
id: "0060"
slug: settle-whether-constitution-md-s-rule-do-not-merge-without-an-explicit-decision
project: arcadia
status: open
question: Settle whether CONSTITUTION.md's rule 'do not merge ... without an explicit Decision' should be amended so an agent may merge a pull request once CodeRabbit has approved its current head and every required check is green.
gap_type: missing-decision
recommendation: Amend the Constitution to authorize merge-on-green (bounded)
options:
  - label: Amend the Constitution to authorize merge-on-green (bounded)
    consequence: "CONSTITUTION.md Authority is edited so merge is no longer a hard stop only when CodeRabbit approved the current head, every required check is green, and the merge state is clean; deploy, publish, delete, spend, credentials, production and messages stay hard stops. AGENTS.md and the Constitution then agree, agents merge unasked on green, and a later push resets the condition. Cost: the hard-stop list shrinks by one verb for a defined condition, and the Constitution edit itself needs a PR."
    recommended: true
  - label: Keep the Constitution as is and treat AGENTS.md as the operator's standing Decision
    consequence: No Constitution edit. This Decision, once answered, is the 'explicit Decision' line 11 requires, recorded as a standing authorization scoped to the merge-on-green condition. Agents merge on green, but the Constitution text still reads as a blanket hard stop, so a reader who skips this Decision sees a contradiction and the next reviewer may reopen it.
    recommended: false
  - label: Revert to per-PR approval
    consequence: Remove the 'Merge on green' section from AGENTS.md and the merge-gate memory. Every PR waits for the operator to merge or grant a Decision, restoring the strictest reading of the Constitution at the cost of an operator action per PR and stalled progress when the operator has almost no time.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-20
---

# Decision 0060: Settle whether CONSTITUTION.md's rule 'do not merge ... without an explicit Decision' should be amended so an agent may merge a pull request once CodeRabbit has approved its current head and every required check is green.

## Options

- **Amend the Constitution to authorize merge-on-green (bounded)** (recommended): CONSTITUTION.md Authority is edited so merge is no longer a hard stop only when CodeRabbit approved the current head, every required check is green, and the merge state is clean; deploy, publish, delete, spend, credentials, production and messages stay hard stops. AGENTS.md and the Constitution then agree, agents merge unasked on green, and a later push resets the condition. Cost: the hard-stop list shrinks by one verb for a defined condition, and the Constitution edit itself needs a PR.
- **Keep the Constitution as is and treat AGENTS.md as the operator's standing Decision**: No Constitution edit. This Decision, once answered, is the 'explicit Decision' line 11 requires, recorded as a standing authorization scoped to the merge-on-green condition. Agents merge on green, but the Constitution text still reads as a blanket hard stop, so a reader who skips this Decision sees a contradiction and the next reviewer may reopen it.
- **Revert to per-PR approval**: Remove the 'Merge on green' section from AGENTS.md and the merge-gate memory. Every PR waits for the operator to merge or grant a Decision, restoring the strictest reading of the Constitution at the cost of an operator action per PR and stalled progress when the operator has almost no time.

## Rationale

AGENTS.md now carries a 'Merge on green' rule (PR #431, merged 2026-09-20) that the operator authorized in chat: if CodeRabbit approves the current head and checks are green, the agent merges, because the operator would merge it anyway. CONSTITUTION.md line 11 (Authority) still lists 'merge' among hard stops that need an explicit Decision, and the Constitution outranks AGENTS.md. Today the two documents disagree, so a strict agent may refuse to merge while a permissive one merges under a rule the Constitution does not back. Related Constitution text already supports the intent: 'Carrying out a decision already made is not a second decision' and 'Gate judgment, not mechanics'. Evidence: #429 and #431 were both merged under this rule with CodeRabbit approval and all seven required checks green.

Proposed by Agent Ask decide-constitution-merge-on-green-2026-09-20. This Decision remains open until the operator answers it.
