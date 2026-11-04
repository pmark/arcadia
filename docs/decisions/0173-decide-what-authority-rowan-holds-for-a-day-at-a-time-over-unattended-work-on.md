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
    consequence: "The operator's own message or press approves one day: 24 hours from that approval, never self-renewing, and Rowan cannot grant it. Within it, on the active Plan's critical path at concurrency one, Rowan may: press START cards it prepared, each after a fresh pre-mortem, preflight and pin check; retry after a failed attempt once it has named the cause, stopping for the operator if two attempts fail on the same cause; turn production Off to end a stuck or failed attempt; run CI once per head when a run failed for a reason not attributed to the candidate or never started; reset an Action's repair budget once per Action per day after naming and fixing the cause; and merge pull requests under the standing merge gate. Rowan still may not answer a Decision, merge a pull request that carries a Decision or changes agent authority, reset a consumed START allowance, probe credentials, use paid fallback, run runtime recovery, grant itself a merge exception, deploy or publish. Attempts count across days, and at Decision 0170's three Rowan stops and the operator decides. No new START after hour 24; a run already started keeps its own grant. Each use is recorded on the coordination Issue and alerted on Discord, and these steps are not operator touches for a clean run. An operator STOP or Off ends the day. Risk: Rowan could spend all three attempts within hours, before the operator sees them, and each START may renew the shared Claude sign-in."
    recommended: true
  - label: "B. Daily grant: START and retries only"
    consequence: The operator's own message or press approves one day, as in the first option. Rowan may press prepared START cards, after the same checks, and retry after a failed attempt once it has named the cause, within Decision 0170's limit. Ending a stuck attempt, resetting a repair budget and running CI beyond Decision 0171's rule still wait for the operator, so a hold like the one on 2026-11-04 would still wait for the operator.
    recommended: false
  - label: "C. No grant: keep each press with the operator"
    consequence: Nothing changes. Every START, retry and reset waits for the operator, and Decision 0171 still lets Rowan issue only the Off at scope complete. It is the most supervised option, and it keeps the delays the operator asked to remove.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-11-04
---

# Decision 0173: Decide what authority Rowan holds for a day at a time over unattended work on the critical path, so that routine operational steps stop waiting on the operator.

## Options

- **A. Daily grant: START and routine run operations** (recommended): The operator's own message or press approves one day: 24 hours from that approval, never self-renewing, and Rowan cannot grant it. Within it, on the active Plan's critical path at concurrency one, Rowan may: press START cards it prepared, each after a fresh pre-mortem, preflight and pin check; retry after a failed attempt once it has named the cause, stopping for the operator if two attempts fail on the same cause; turn production Off to end a stuck or failed attempt; run CI once per head when a run failed for a reason not attributed to the candidate or never started; reset an Action's repair budget once per Action per day after naming and fixing the cause; and merge pull requests under the standing merge gate. Rowan still may not answer a Decision, merge a pull request that carries a Decision or changes agent authority, reset a consumed START allowance, probe credentials, use paid fallback, run runtime recovery, grant itself a merge exception, deploy or publish. Attempts count across days, and at Decision 0170's three Rowan stops and the operator decides. No new START after hour 24; a run already started keeps its own grant. Each use is recorded on the coordination Issue and alerted on Discord, and these steps are not operator touches for a clean run. An operator STOP or Off ends the day. Risk: Rowan could spend all three attempts within hours, before the operator sees them, and each START may renew the shared Claude sign-in.
- **B. Daily grant: START and retries only**: The operator's own message or press approves one day, as in the first option. Rowan may press prepared START cards, after the same checks, and retry after a failed attempt once it has named the cause, within Decision 0170's limit. Ending a stuck attempt, resetting a repair budget and running CI beyond Decision 0171's rule still wait for the operator, so a hold like the one on 2026-11-04 would still wait for the operator.
- **C. No grant: keep each press with the operator**: Nothing changes. Every START, retry and reset waits for the operator, and Decision 0171 still lets Rowan issue only the Off at scope complete. It is the most supervised option, and it keeps the delays the operator asked to remove.

## Rationale

Operator, in Rowan's chat, 2026-11-04: "I just don't see the value in repeatedly waiting for me to start when I definitely would do it ASAP. For tomorrow and moving forward, please make it so that I can approve unattended work on the critical path for a day at a time." And later: "let's give you the authority to make decisions like this in the future so that we don't have long delays that serve no real purpose again." On 2026-11-04 attempt 1 waited about six hours, from the worker's 10:41 UTC escalation, on a hold with one sensible answer. Rowan recommended the first option. It covers the operational calls the operator named; it gives Rowan no authority over Decisions, which the Constitution keeps with the operator, and any wider authority needs its own Decision and a Constitution change. The critical path is the active Plan's governed queue. This grants nothing until the operator answers it and the delegation is built, in a separate reviewed pull request, on Decision 0163's delegated press. Option A changes these records: it supersedes Decision 0171's rule that each retry needs an operator press, widens Decision 0163's scope, and lifts the AGENTS.md production directive's bar on attempt reset only for the repair-budget reset it names. Every other bar in that directive stands, as does Decision 0163's exclusion of resetting a consumed allowance.

Proposed by Agent Ask decide-daily-critical-path-authority-20261104-r2.
