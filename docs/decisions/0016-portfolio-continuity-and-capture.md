---
arcadia: v1
type: decision
id: "0016"
slug: portfolio-continuity-and-capture
project: arcadia
plan: portfolio-continuity-view
status: approved
question: How should Arcadia make all past, current, future, deferred, and incidental work legible without forcing the operator to hold the portfolio in their head?
gap_type: missing-decision
recommendation: Build one deterministic portfolio continuity view over existing Arcadia records, filterable to one Project, and require conversational work capture to return a visible receipt naming where each separate idea landed.
confidence: high
decided: 2026-08-15
answer: "Arcadia will provide one portfolio continuity view, filterable by Project, that presents work in four truthful horizons: Past, Now, Next, and Later. It will project existing Logs, completed and active Actions, Decisions, Runs, managed plans, blocked work, and Incubating material rather than creating a second timeline store. Exact timestamps order historical facts; authoritative pointers and dependencies describe current and future intent without inventing dates. When the operator mentions tangential or unrelated work in conversation, the coding agent must preserve it through the Arcadia Way and report a capture receipt: attached to the current Action, recorded as a separate planned Action, recorded as a Decision, or preserved as Incubating with a visible reactivation trigger. No actionable idea may disappear silently into conversation history."
updated: 2026-08-15
---

# Portfolio continuity and conversational capture

## Context

Arcadia has the underlying records but still makes the operator reconstruct the
portfolio from separate surfaces: managed plans describe intent, queues describe
responsibility, Runs and Logs describe execution, Decisions describe judgment,
and the Back Burner preserves Incubating ideas. The existing orientation
timeline answers a different question—how much sized work fits into available
time—and should keep doing that well.

The operator needs to understand the whole story at a glance: what happened,
what is happening, what is committed next, what is planned later, what is
deferred and against which trigger, and what is merely Incubating. The same
conversation should also be a trustworthy capture surface for new thoughts,
including tangents unrelated to the current implementation.

## Decision

Build a read projection, not a new source of truth. Its four horizons are:

- **Past:** completed Actions, Decisions, Runs, Artifacts, and Log entries,
  ordered by observed time.
- **Now:** current managed Action, active Runs, open Decisions, and blocked
  Actions requiring intervention.
- **Next:** open planned Actions whose dependencies and Decisions make their
  sequence knowable, with authoritative plan pointers distinguished from merely
  ready work.
- **Later:** draft plans, explicitly deferred Actions with their triggers, and
  Incubating material.

The portfolio view uses the same projection with an optional Project filter.
Unknown dates remain unknown. Dependency order is not rendered as a calendar
promise. Incubating material is not mislabeled as committed work.

Conversation capture follows one deterministic receipt contract. When a new
thought is materially separate from the current Action, the agent states where
it was recorded and why:

- current Action context;
- separate planned Action;
- Decision;
- Incubating item with a reactivation trigger.

If classification is genuinely ambiguous, one focused Decision is opened. The
agent does not quietly choose a Project, priority, or activation order that the
operator did not provide.

## Consequences

- The view can be built over existing repositories and snapshot contracts
  before any schema addition is considered.
- “Timeline” is a user-facing continuity metaphor; the existing orientation
  timeline remains the capacity-to-scale calculation.
- Planned, ready, active, blocked, deferred, and Incubating remain distinct.
- Natural conversation becomes a reliable ingress surface without turning
  every aside into active work.
- Cross-Project calendar scheduling, inferred deadlines, automatic priority,
  and dependency forecasting are deferred until the read projection proves
  that stored facts are insufficient.
- Automatic capture from agents that have no Arcadia or managed-document
  access is deferred until a real source requires it; GitHub attention objects
  solve the immediate remote-operator boundary separately.
