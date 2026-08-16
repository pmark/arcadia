---
arcadia: v1
type: plan
slug: operator-attention-routing
project: arcadia
status: draft
milestone: Every Project can durably request operator attention through GitHub and Arcadia surfaces each meaningful next action once in Discord
token_impact: medium
token_budget: "Repository scans, snapshot comparison, state persistence, CLI fixtures, and delivery tests stay deterministic. Reserve model-bearing work for implementation and one bounded review pass; do not add model classification to notification routing."
updated: 2026-08-15
actions:
  - id: build-attention-source-projection
    title: Normalize local and GitHub work that genuinely needs the operator
    status: open
    responsibility: codex
    effort: session
    next_action: Extend the existing read-only GitHub and Arcadia snapshots into one deterministic internal attention projection covering reviewable pull requests, merge-ready pull requests, arcadia:attention issues, local Decisions, and blocked Actions.
    expected_artifact: A typed attention projection with deterministic fixtures and no new source-of-truth table
    clarification: clarified
    confidence: high
    source: Decision 0015 and operator direction on 2026-08-15
    acceptance_criteria:
      - The projection has stable source keys and action fingerprints for configured Project pull requests, open GitHub issues labeled arcadia:attention, local open Decisions, and local blocked Actions.
      - Every new non-draft pull request is operator review work; a draft pull request appears only when explicitly labeled arcadia:attention.
      - A GitHub issue appears only while open and labeled arcadia:attention, and exposes its Project, title, URL, reason, next action, and completion condition without model interpretation.
      - Routine check transitions, edits, and comments do not create new attention fingerprints; reviewable, merge-ready, and explicit escalation transitions do.
      - The projection reads existing truth and adds no public Arcadia endpoint, webhook receiver, GitHub App, comment protocol, or duplicate task record.
      - A GitHub read error is explicit and cannot be mistaken for an empty attention set.
    decisions: ["0015"]
    references:
      - src/workMonitoring/pullRequests.ts
      - src/commands/workPullRequests.ts
      - src/commands/queue.ts
      - src/commands/review.ts
      - apps/discord-bot/src/notifications/poller.ts
    depends_on: []
  - id: deliver-attention-through-discord
    title: Deliver each meaningful operator action once through Discord
    status: open
    responsibility: codex
    effort: session
    next_action: Add attention fingerprints to the existing Discord notification snapshot and state transition evaluator, then format one concise message with Project, reason, next action, completion condition, and source link.
    expected_artifact: Retry-safe Discord attention delivery with first-run backlog summary and duplicate suppression
    clarification: clarified
    confidence: high
    source: Decision 0015
    acceptance_criteria:
      - A newly actionable attention fingerprint posts exactly once to the configured Discord channel.
      - Notification state advances only after that specific Discord send succeeds; a partial batch failure retries only undelivered messages.
      - First synchronization posts one bounded backlog summary and seeds individual fingerprints without flooding the channel or silently ignoring existing work.
      - A message names the Project, why attention is required, the exact next action, the completion condition when present, and a direct source URL.
      - Existing local Decision, blocked Action, Run, Milestone, and Codex notification behavior remains compatible.
      - Polling and formatting invoke no model and create no outbound GitHub mutation.
    decisions: ["0015"]
    references:
      - apps/discord-bot/src/notifications/poller.ts
      - apps/discord-bot/src/notifications/state.ts
      - apps/discord-bot/src/arcadia/cli.ts
      - tests/discord-bot.test.ts
    depends_on: [build-attention-source-projection]
  - id: include-attention-in-orientation
    title: Keep unresolved operator attention visible after the first notification
    status: open
    responsibility: codex
    effort: short
    next_action: Add the normalized open attention set to the deterministic daily orientation facts and portfolio status without turning unresolved items into repeated Discord alerts.
    expected_artifact: Daily orientation and portfolio status show unresolved operator actions with source links
    clarification: clarified
    confidence: high
    source: Decision 0015
    acceptance_criteria:
      - Open attention objects remain visible in daily orientation and portfolio status after their first Discord delivery.
      - Resolved issues, merged or closed pull requests, answered Decisions, and unblocked Actions leave the open set on the next successful scan.
      - The orientation distinguishes newly actionable work from previously notified unresolved work.
      - No reminder schedule, priority inference, due-date engine, or model classification is introduced.
    decisions: ["0015"]
    references:
      - src/orientation
      - src/commands/orientation.ts
      - src/commands/status.ts
    depends_on: [build-attention-source-projection]
  - id: dogfood-github-attention-object
    title: Prove one real Project can request and resolve operator attention
    status: open
    responsibility: requires_review
    effort: short
    next_action: After implementation passes deterministic tests, authorize and perform one live Private Practice Now trial using a real arcadia:attention issue or reviewable pull request, observe Discord delivery, complete the source action, and verify it disappears without a duplicate alert.
    expected_artifact: An operator QA Log recording one end-to-end GitHub-to-Discord attention cycle and any friction found
    clarification: clarified
    confidence: high
    source: Decision 0015 and the Private Practice Now Cloudflare/copy-review examples
    acceptance_criteria:
      - The operator explicitly authorizes the live GitHub object before any issue, label, comment, or other outbound mutation is created.
      - A cloud-representative Project object becomes one Discord notification with the correct source link and next action.
      - Completing or closing the source object removes it from the unresolved attention set after a successful poll.
      - Restarting the Discord bot does not resend the delivered fingerprint.
      - The QA Log records the actual delay, outcome, and any change needed before broader Project rollout.
    decisions: ["0015"]
    references:
      - apps/discord-bot/README.md
      - START_HERE.md
    depends_on: [deliver-attention-through-discord, include-attention-in-orientation]
decisions: ["0015"]
---

# Operator attention routing

## Outcome

A cloud container needs only its Project's existing GitHub access to leave a
durable request for the operator. Arcadia discovers that request, combines it
with local Decisions and blocked Actions, sends one useful Discord message, and
keeps the unresolved work visible until its source is resolved.

## Pareto boundary

The first useful slice is two GitHub objects, one deterministic projection, and
one existing Discord delivery path. Pull requests cover branch work. Issues
labeled `arcadia:attention` cover everything else. The source object is the
receipt and lifecycle record.

Version one deliberately excludes inbound Arcadia networking, webhooks,
GitHub Apps, comment parsing, hidden JSON, two-way Discord replies, automated
reminders, inferred priority, and copied local Actions. Those capabilities are
not required to prevent the missed-attention failures observed in Private
Practice Now.

## Activation trigger

This plan stays draft while `demo-first-delivery` owns Arcadia's authoritative
work pointer. Activate it after the current `build-demo-hero-vertical-slice`
Action is accepted, or earlier only if another missed operator-attention event
occurs and the operator explicitly reprioritizes the portfolio.
