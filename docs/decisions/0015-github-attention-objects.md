---
arcadia: v1
type: decision
id: "0015"
slug: github-attention-objects
project: arcadia
plan: operator-attention-routing
status: approved
question: How should cloud-hosted Project work request operator attention when it cannot reach Arcadia directly?
gap_type: missing-decision
recommendation: Use GitHub pull requests and issues labeled arcadia:attention as durable attention objects, let Arcadia poll and normalize them with existing local Decisions and blocked Actions, and keep Discord as a derived delivery surface.
confidence: high
decided: 2026-08-15
answer: "GitHub is the durable rendezvous point between disconnected Project workers and local Arcadia. Every new non-draft pull request is review work for the single operator; a Project requests any other operator action by opening one GitHub issue labeled arcadia:attention, or by applying that label to a draft pull request that needs attention before it is reviewable. Arcadia polls configured repositories, combines those objects with local Decisions and blocked Actions, and sends Discord only when the operator's next action meaningfully changes. The GitHub object remains the source of truth and closes or merges where the work occurs. Version one adds no public Arcadia endpoint, webhook receiver, GitHub App, comment protocol, hidden JSON envelope, two-way Discord reply bridge, or duplicate local task database."
updated: 2026-08-15
---

# GitHub attention objects

## Context

Arcadia already knows how to read Project pull requests and how to deliver
deduplicated Discord notifications. The missing boundary appears when work runs
inside a cloud container on a Project branch: that worker can push to GitHub,
but it cannot safely reach the operator's local Arcadia workspace.

Private Practice Now exposed two representative cases. A generated copy
Artifact needed human feedback, and a Cloudflare setup step required operator
account access. Both were real work, both stopped for the right reason, and
neither had a reliable path into the operator's existing notification flow.

Arcadia is currently a single-user system. There is no reviewer-assignment
problem to solve: every reviewable pull request in a configured Project is for
the operator.

## Decision

Use GitHub objects as the remote durable outbox:

- Every new non-draft pull request is operator review work.
- A draft pull request is quiet unless it carries `arcadia:attention`.
- Any non-PR operator task is one open GitHub issue labeled
  `arcadia:attention`.
- Each issue states why attention is required, the exact next action, the
  completion condition, and links to relevant context.
- Arcadia polls those objects, normalizes them beside local Decisions and
  blocked Actions, and delivers concise Discord notifications.
- Notification state advances only after a successful send. GitHub read
  failure advances nothing.
- The operator resolves work at its source by reviewing or merging the pull
  request, or by completing and closing the issue.

The notification rule is a change in operator action, not a change in remote
state. Routine check transitions, edits, and comments stay quiet. A pull
request becoming reviewable or merge-ready is meaningful; an explicitly
labeled escalation is meaningful.

## Consequences

- No inbound Arcadia service needs to be exposed to the internet.
- A terminated container cannot take its request with it; GitHub retains the
  durable object and audit trail.
- Version one can reuse existing `gh` authentication, repository configuration,
  Discord polling, and delivery-state patterns.
- GitHub remains authoritative for remote work. Arcadia does not mirror every
  issue into an Action or Decision merely to notify the operator.
- First synchronization summarizes the existing backlog once instead of
  silently discarding it or posting one message per historical object.
- Two-way Discord replies are deferred until a real workflow requires the
  response to return to a cloud worker without opening GitHub.
- Webhooks or a GitHub App are deferred until measured polling latency or rate
  limits make the existing read path inadequate.
- A stricter machine envelope is deferred until title, body, label, status, and
  URL fail to represent a real request.
