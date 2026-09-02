---
arcadia: v1
type: decision
id: "0041"
slug: prioritize-the-preserved-ask-tail
project: arcadia
status: open
question: Do you accept the live agent-managed queue proof and, if so, should Arcadia reactivate the guided understanding session as the next preserved Ask tail?
gap_type: missing-decision
recommendation: Yes. Reactivate arcadia-ask-active-sessions at build-guided-understanding-session; it is the dependency that makes later Ask-rule management and Living Songbook dogfood usable rather than isolated features.
confidence: high
plan: agent-ask-execution-queue
action: dogfood-agent-managed-queue
updated: 2026-09-01
---

# Decision 0041: Prioritize the preserved Ask tail

## Context

Decision 0039 required Arcadia to defer the unstarted guided understanding
session, Ask-rule management, and Living Songbook dogfood until one real coding
agent Ask entered the explicit queue, was reprioritized, became governed next
work beneath higher ineligible Actions, and emitted its Discord settlement
summary.

That proof now exists. The live workspace has one valid revisioned order with
zero unpositioned Actions. A strict Agent Ask created and positioned a canonical
Action, a governed pointer preview selected it, the Dashboard and CLI agree on
the selected next Action and every higher skip reason, and Discord delivered
the retry-safe settlement effects summary exactly once.

## Recommendation

Reactivate `arcadia-ask-active-sessions` at
`build-guided-understanding-session`. That Action turns the already-delivered
capture envelope into the corrigible operator interaction required by both
remaining Actions. Ask-rule management depends on it, and Living Songbook
dogfood depends on both, so starting later in that chain would either violate
the declared dependencies or duplicate missing interaction work.

If this recommendation is rejected, record whether the preserved plan should
remain superseded or be replaced by a different explicitly named Plan. Do not
infer a new priority from backlog order.

## Boundaries

This Decision selects the next planning priority only. It does not approve a
Run, merge, deployment, publication, credential use, spending, arbitrary
external messaging, or Living Songbook repository writes.
