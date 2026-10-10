---
arcadia: v1
type: decision
id: "0114"
slug: decide-which-governed-roles-may-request-subagents-and-how-deep-delegation-may-go
project: arcadia
status: approved
question: Decide which governed roles may request subagents, and how deep delegation may go.
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Only the session-start role may request delegates, and delegates may not delegate further (depth 1). Requests for code-reviewer and qa are met as separate independent Sessions, never as in-process children
options:
  - label: Only the session-start role may request delegates, and delegates may not delegate further (depth 1). Requests for code-reviewer and qa are met as separate independent Sessions, never as in-process children
    consequence: "Fan-out stays bounded and simple to budget, and every chain is delegate, then lead, then operator. Independence holds because a reviewer is never the lead's child. A delegated planner cannot spawn its own plan-critic. The lead has to request planner and plan-critic as siblings, one after the other, which is how this plan was made: the coordinating session ran the planner, then the critic. A delegate that needs help hands back to its lead."
    recommended: true
  - label: The session-start role and planner may delegate, to depth 2, with Arcadia admitting each level
    consequence: A delegated planner can call its own plan-critic and researchers without going back to the lead. This adds a second admission level, longer supervisor chains and more burn per Session.
    recommended: false
  - label: Any role may request, and admission alone bounds it (depth cap 3)
    consequence: The most flexible. Trees get deep, burn is hard to predict, and the supervisor relationship gets hard to read on /agents.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: Only the session-start role may request delegates, and delegates may not delegate further (depth 1). Requests for code-reviewer and qa are met as separate independent Sessions, never as in-process children
decided: 2026-10-09
---

# Decision 0114: Decide which governed roles may request subagents, and how deep delegation may go.

## Options

- **Only the session-start role may request delegates, and delegates may not delegate further (depth 1). Requests for code-reviewer and qa are met as separate independent Sessions, never as in-process children** (recommended): Fan-out stays bounded and simple to budget, and every chain is delegate, then lead, then operator. Independence holds because a reviewer is never the lead's child. A delegated planner cannot spawn its own plan-critic. The lead has to request planner and plan-critic as siblings, one after the other, which is how this plan was made: the coordinating session ran the planner, then the critic. A delegate that needs help hands back to its lead.
- **The session-start role and planner may delegate, to depth 2, with Arcadia admitting each level**: A delegated planner can call its own plan-critic and researchers without going back to the lead. This adds a second admission level, longer supervisor chains and more burn per Session.
- **Any role may request, and admission alone bounds it (depth cap 3)**: The most flexible. Trees get deep, burn is hard to predict, and the supervisor relationship gets hard to read on /agents.

## Rationale

The operator said certain roles can delegate to subagents. Depth sets how far token burn can fan out, and how long supervisor chains get. Operator direction 2026-10-09 (governed subagent roles), recorded verbatim in the planning brief; the operator was unavailable for a live interview, so that text stands in for one. Recommended option is listed first; the operator decides.

Proposed by Agent Ask decide-which-roles-may-delegate-2026-10-09-r2.
