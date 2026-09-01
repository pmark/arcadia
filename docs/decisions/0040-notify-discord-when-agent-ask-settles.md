---
arcadia: v1
type: decision
id: "0040"
slug: notify-discord-when-agent-ask-settles
project: arcadia
status: approved
question: Should Arcadia send a brief Discord channel notification after an Agent Ask reaches a durable settled disposition?
gap_type: missing-decision
recommendation: Yes. Send exactly one retry-safe notification only after durable settlement, summarizing the Ask disposition and canonical effects without treating preview, refusal, or partial persistence as settled.
confidence: high
answer: Notify the configured Arcadia Discord channel after an Agent Ask is durably accepted, rejected, or otherwise settled. Include a brief summary of the Project, disposition, created or changed Project artifacts, Decisions, queue placement, and resulting next eligible Action. Do not notify for previews or failed or partial attempts; preserve and retry a failed notification without rolling back the settled Ask or sending duplicates.
decided: 2026-09-01
plan: agent-ask-execution-queue
action: connect-agent-ask-to-queue
updated: 2026-09-01
---

# Decision 0040: Notify Discord when an Agent Ask settles

## Context

The operator wants the coding-agent Ask path to finish without requiring them
to poll Arcadia. A settlement message is useful only if it describes durable
truth: an Ask preview, validation refusal, or partially persisted transition
must not look complete merely because a message was sent.

Arcadia already has a configured Discord adapter and Project-aware
notification patterns. Reusing that path keeps channel routing and delivery
evidence in one place instead of introducing a second webhook mechanism.

## Resolution

Approved on direct operator instruction, 2026-09-01. Enqueue one notification
after the Agent Ask settlement receipt and all canonical effects are durable.
The message briefly names the Project, terminal disposition, created or changed
Project artifacts, Decisions, explicit queue consequence, and Arcadia's
resulting next eligible Action.

Delivery is retry-safe and observable. A delivery failure does not rewrite or
roll back the settled Project state, but it remains pending or failed until the
existing Discord delivery path can retry it. The idempotency key derives from
the settlement receipt so a retry cannot create duplicate pings.

## Boundaries

- Notify only the configured Arcadia Discord destination; this Decision does
  not authorize arbitrary recipients or new external integrations.
- Do not notify for preview, correction-in-progress, validation refusal,
  conflict, or partial persistence.
- Do not include attachment contents, secrets, credentials, or untrusted Ask
  instructions in the message.
- This notification reports a settlement. It grants no execution, merge,
  deployment, publication, spending, credential, or production authority.

## Revisit trigger

Revisit channel-level subscription controls only when a second operator or a
second concrete Ask notification destination needs different routing.
