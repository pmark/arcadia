---
arcadia: v1
type: decision
id: "0039"
slug: prioritize-agent-ask-and-work-queue
project: arcadia
status: approved
question: Should coding-agent use of Arcadia Ask and one explicitly ordered execution queue become Arcadia's next priority ahead of the unstarted guided-understanding, Ask-rule management, and Songbook dogfood work?
gap_type: missing-decision
recommendation: Yes. Make the agent Ask management contract the current Action, then build the approved-Action queue, connect accepted Ask changes to it, expose it in the operator Dashboard, and prove the complete loop through coding-agent dogfood.
confidence: high
answer: Prioritize coding-agent use of Arcadia Ask and one explicitly ordered execution queue now. Preserve the completed Ask routing and capture work, supersede the unstarted Ask active-session sequence, and reconsider its guided operator interaction, rule management, and Songbook dogfood only after the agent-managed queue loop is accepted.
decided: 2026-09-01
plan: agent-ask-execution-queue
updated: 2026-09-01
---

# Decision 0039: Prioritize agent Ask and the execution queue

## Context

Arcadia Ask now preserves one auditable text-and-file capture and makes special
routing visible. The next planned slice was a broad guided operator session.
The operator identified a higher-leverage path: coding agents already help
articulate desired Outcomes at every granularity, but they cannot hand those
results back through Ask as a conventional, reliably interpreted Project
management contribution. Approved work also lacks one easy-to-reorder ordering
surface, so priority still leaks across pointers, plans, and operator memory.

The two needs reinforce each other. Agent Ask should turn an articulated intent
into proposed canonical Project records. Once accepted, every resulting Action
should enter one explicit portfolio execution order. Arcadia can then answer
what comes next by selecting the first eligible Action in that operator-owned
order, while explaining every skipped dependency, Decision, blocker, or
responsibility boundary.

## Resolution

Approved on direct operator instruction, 2026-09-01. Activate
`agent-ask-execution-queue` and begin with its conventional coding-agent Ask
contract. This supersedes only the unstarted remainder of
`arcadia-ask-active-sessions`; its completed routing and capture Actions remain
accepted foundations.

The queue is an ordering over canonical Actions, not a second task model.
Proposals and unapproved changes do not enter it. Every approved Action has an
explicit position even when currently blocked, and readiness remains governed
by Decisions, dependencies, responsibility, and approval boundaries. Arcadia's
default next work is the first eligible Action in that order; it never hides a
higher item or invents priority from a score.

An agent may submit, preview, and correct proposed Project changes. It may not
claim operator approval, approve its own Decision, widen authority, merge,
deploy, publish, spend, use credentials, or message externally. An operator
reorder is itself the bounded authority to change order and must return a
durable, reversible receipt.

## Revisit trigger

After one real Project is successfully managed through agent Ask, accepted
changes enter the queue, the operator reorders that queue, and Arcadia dispatches
the newly correct next Action, choose which preserved tail has the most value:
the guided human understanding session, Ask-rule management, or Songbook
dogfood. Do not re-ask before that proof exists.
