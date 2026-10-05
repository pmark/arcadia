---
arcadia: v1
type: decision
id: "0084"
slug: decide-whether-agents-may-send-the-operator-read-only-discord-pings-arcadia
project: arcadia
status: approved
question: Decide whether agents may send the operator read-only Discord pings (arcadia ping) on their own judgment, to the default channel or an operator-configured channel alias, for look-at-this and FYI items.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Authorize standing read-only pings (Recommended)
options:
  - label: Authorize standing read-only pings (Recommended)
    consequence: Agents may run arcadia ping for look-at-this and FYI items without asking, to the default channel or a listed alias. Cannot approve, answer, spend, or reach anyone but you. Cap of 30 per hour and 10-minute dedup bound the noise. Revocable by answering a later Decision.
    recommended: true
  - label: Authorize only to the default channel
    consequence: Agents may ping on judgment but never name a channel; --channel is ignored and the alias map is unused. Less routing, less risk of a misrouted nudge.
    recommended: false
  - label: Do not authorize
    consequence: The command ships but agents must not run it unprompted; they may use it only when you explicitly ask in chat. Today only fixed-event pings reach you.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-05
answer: Authorize standing read-only pings (Recommended)
decided: 2026-10-05
---

# Decision 0084: Decide whether agents may send the operator read-only Discord pings (arcadia ping) on their own judgment, to the default channel or an operator-configured channel alias, for look-at-this and FYI items.

## Options

- **Authorize standing read-only pings (Recommended)** (recommended): Agents may run arcadia ping for look-at-this and FYI items without asking, to the default channel or a listed alias. Cannot approve, answer, spend, or reach anyone but you. Cap of 30 per hour and 10-minute dedup bound the noise. Revocable by answering a later Decision.
- **Authorize only to the default channel**: Agents may ping on judgment but never name a channel; --channel is ignored and the alias map is unused. Less routing, less risk of a misrouted nudge.
- **Do not authorize**: The command ships but agents must not run it unprompted; they may use it only when you explicitly ask in chat. Today only fixed-event pings reach you.

## Rationale

Messaging is an approval boundary. Existing standing pings fire only on fixed events (PR opened, PR ready, CI blocked). arcadia ping lets an agent decide when something merits the operators attention, so the trigger set is open-ended. The ping is read-only, reaches only the operator on Discord, only channels the operator listed in DISCORD_PING_CHANNELS, is capped at 30 per hour, and grants no authority.

Proposed by Agent Ask decide-operator-ping-standing-authority-2026-10-05.
