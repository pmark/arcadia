---
arcadia: v1
type: decision
id: "0173"
slug: decide-what-authority-rowan-holds-for-a-day-at-a-time-over-unattended-work-on
project: arcadia
status: open
question: Decide what authority Rowan holds for a day at a time over unattended work on the critical path, so that routine operational steps stop waiting on the operator.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. Daily grant: START and routine run operations"
options:
  - label: "A. Daily grant: START and routine run operations"
    consequence: The operator approves one day at a time, with one word or press. For up to 24 hours, on the active Plan's critical path at concurrency one, Rowan may press START cards it prepared, each after a fresh pre-mortem, preflight and pin check; end a stuck or failed attempt; make CI run again on a head whose run failed or never started; reset a repair budget after naming and fixing the cause; and merge pull requests under the standing merge gate. Rowan still may not answer a Decision, merge a pull request that carries a Decision or changes agent authority, use credentials or paid fallback, deploy or publish, or go past Decision 0170's three attempts. Every use is recorded on the coordination Issue and alerted on Discord. An operator STOP or Off ends the day. Mistakes can spend attempts without the operator seeing them first.
    recommended: true
  - label: "B. Daily grant: START and retries only"
    consequence: The operator approves one day at a time. Rowan may press prepared START cards and retry after a failed attempt, within Decision 0170's limit. Ending a stuck attempt, resetting a repair budget and making CI run again still wait for the operator, so a hold like the night of 2026-11-04 would still wait for the operator to wake.
    recommended: false
  - label: "C. No grant: keep each press with the operator"
    consequence: Nothing changes. Every START, retry, Off and reset waits for the operator, as Decision 0171 now says. It is the most supervised option and it keeps the delays the operator asked to remove.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-04
---

# Decision 0173: Decide what authority Rowan holds for a day at a time over unattended work on the critical path, so that routine operational steps stop waiting on the operator.

## Options

- **A. Daily grant: START and routine run operations** (recommended): The operator approves one day at a time, with one word or press. For up to 24 hours, on the active Plan's critical path at concurrency one, Rowan may press START cards it prepared, each after a fresh pre-mortem, preflight and pin check; end a stuck or failed attempt; make CI run again on a head whose run failed or never started; reset a repair budget after naming and fixing the cause; and merge pull requests under the standing merge gate. Rowan still may not answer a Decision, merge a pull request that carries a Decision or changes agent authority, use credentials or paid fallback, deploy or publish, or go past Decision 0170's three attempts. Every use is recorded on the coordination Issue and alerted on Discord. An operator STOP or Off ends the day. Mistakes can spend attempts without the operator seeing them first.
- **B. Daily grant: START and retries only**: The operator approves one day at a time. Rowan may press prepared START cards and retry after a failed attempt, within Decision 0170's limit. Ending a stuck attempt, resetting a repair budget and making CI run again still wait for the operator, so a hold like the night of 2026-11-04 would still wait for the operator to wake.
- **C. No grant: keep each press with the operator**: Nothing changes. Every START, retry, Off and reset waits for the operator, as Decision 0171 now says. It is the most supervised option and it keeps the delays the operator asked to remove.

## Rationale

Operator, in Rowan's chat, 2026-11-04: "I just don't see the value in repeatedly waiting for me to start when I definitely would do it ASAP. For tomorrow and moving forward, please make it so that I can approve unattended work on the critical path for a day at a time." And later: "let's give you the authority to make decisions like this in the future so that we don't have long delays that serve no real purpose again." That night, attempt 1 waited about seven hours for the operator to wake, on a hold that had one sensible answer. Rowan recommended the first option. The critical path is the active Plan's governed queue. This Decision grants nothing until the operator answers it and the delegation is built on Decision 0163's delegated press. It would supersede Decision 0171's rule that each retry needs an operator press, and would widen Decision 0163's scope. Decision 0170's limit stands: at three attempts Rowan stops and the operator decides again.

Proposed by Agent Ask decide-daily-critical-path-authority-20261104.
