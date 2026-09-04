---
arcadia: v1
type: plan
slug: agent-advance-queue
project: arcadia
status: complete
milestone: Ready plan Actions feed coding agents with visible attention stops
token_impact: medium
token_budget: "Queue composition, readiness checks, and limit visibility are deterministic; reserve model calls for bounded agent execution and failure diagnosis."
updated: 2026-08-02
actions:
  - id: build-agent-queue-view
    title: Build the shared Agent Queue projection
    status: done
    responsibility: agent
    effort: session
    next_action: Delivered as src/dispatch/queue.ts with focused readiness and attention tests; no further work.
    expected_artifact: A deterministic Agent Queue projection exposing every ready Action, active Run, and pre-dispatch stop.
    clarification: clarified
    confidence: high
    source: Operator request, 2026-08-02
    acceptance_criteria:
      - The projection uses the managed document readiness rules as its source of truth.
      - Ready Actions, active Runs, and attention stops are separate, counted, and stably ordered.
      - Each attention stop names its reason, concrete next action, and document blocker when one exists.
      - A plan's declared token impact and plain-language token budget remain visible beside its work.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
    depends_on: []
  - id: surface-agent-advance-queue
    title: Surface the Agent Queue in the operator workflow
    status: done
    responsibility: agent
    effort: session
    next_action: Delivered as `advance queue`, Mission Control's Agent Queue, START_HERE.md, and docs/COMMANDS.md; no further work.
    expected_artifact: A CLI and Mission Control view where ready work and every intervention stop are obvious at a glance.
    clarification: clarified
    confidence: high
    source: Operator request, 2026-08-02
    acceptance_criteria:
      - "`advance queue` and Mission Control expose the same ready, running, and attention counts."
      - Attention entries link to the strongest existing review, Run, or Project surface.
      - The view is read-only and never grants execution authority.
    depends_on: [build-agent-queue-view]
  - id: budget-aware-admission
    title: Add provider-budget-aware admission to the feeder
    status: blocked
    responsibility: agent
    effort: session
    next_action: Resume when both Claude Code and Codex expose comparable current daily and weekly remaining-capacity data to Arcadia.
    expected_artifact: A deterministic admission decision that selects an eligible provider or leaves work visible with a precise quota stop.
    clarification: clarified
    confidence: medium
    source: Operator request, 2026-08-02
    acceptance_criteria:
      - Daily and weekly provider limits are evaluated before a packet or Run is admitted.
      - Unknown or stale limits are visible and never represented as unlimited capacity.
      - A quota stop names the provider, window, observed value, reset time, and next safe check.
    depends_on: [surface-agent-advance-queue]
questions: []
decisions: []
---

# Agent Advance Queue

## Status

- **Milestone:** Ready plan Actions feed coding agents with visible attention stops
- **Next Action:** Resume provider-budget admission when its named capacity trigger fires; the queue and surfaces are complete.
- **Responsibility:** Codex
- **Required Artifact:** Delivered: a deterministic Agent Queue projection plus CLI and Mission Control surfaces.
- **Decisions open:** None
- **Updated:** 2026-08-02

This plan is complete for the queue/readiness visibility slice. The provider-
budget admission increment remains explicitly blocked by its external trigger,
not silently counted as shipped.

## Operating rule

The queue is a projection, not a second source of truth. Managed documents remain
authoritative for the Project, active plan, current Action, responsibility,
acceptance criteria, and required Decisions. SQLite remains authoritative for
Runs, review items, and provider observations. The feeder may act only on a
ready Action whose existing dispatch rules permit it.

Every visible item belongs to one of three lanes:

- **Ready:** a coding agent can be prepared for the Action under the current
  document and approval rules.
- **Running:** a Run is pending or active and must finish before another Run is
  started for the same work stream.
- **Needs attention:** a Decision, packet, failed Run, repository, document,
  responsibility, or provider-budget condition requires a named intervention.

The budget-aware admission increment is deferred until both subscribed
providers expose comparable daily and weekly remaining-capacity observations.
The trigger is observable: the provider snapshot must contain those windows,
their reset times, and a freshness timestamp for Claude Code and Codex. Until
then, existing availability gates still refuse known-limited providers, while
the queue keeps the work visible rather than pretending that unknown capacity
is safe.
