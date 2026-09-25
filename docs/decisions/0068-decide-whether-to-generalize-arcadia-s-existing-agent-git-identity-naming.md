---
arcadia: v1
type: decision
id: "0068"
slug: decide-whether-to-generalize-arcadia-s-existing-agent-git-identity-naming
project: arcadia
status: open
question: "Decide whether to generalize Arcadia's existing agent Git identity naming scheme (src/codingAgents/agentIdentity.ts: platform given-name x tier surname, plus a builder/critic role title) into a broader set of 'Ask an agent' content-generation personas -- e.g. Writer, Painter, Director, Photographer -- that can be invoked ephemerally or persistently for non-coding tasks like copy and imagery generation, and if pursued, where that registry should live."
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Defer -- revisit when a first concrete content-generation task needs a named persona
options:
  - label: Defer -- revisit when a first concrete content-generation task needs a named persona
    consequence: No persona system is built now. Ad hoc model/provider selection (per docs/model-selection.md) continues to cover copy and imagery tasks until a real recurring need names the trigger.
    recommended: true
  - label: Extend AGENT_ROLES / agentIdentity.ts to cover content personas
    consequence: Reuses the exact naming and tier infrastructure already proven in git history, but the same enum now governs both commit authorship and content-persona routing -- a later change to one concern (e.g. adding a role) risks touching the other.
    recommended: false
  - label: Build a separate persona registry alongside agentIdentity.ts
    consequence: Keeps git-authorship identity and content-generation personas as distinct concerns, at the cost of a second place that defines the given-name/tier naming convention and must be kept consistent with the first.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-25
---

# Decision 0068: Decide whether to generalize Arcadia's existing agent Git identity naming scheme (src/codingAgents/agentIdentity.ts: platform given-name x tier surname, plus a builder/critic role title) into a broader set of 'Ask an agent' content-generation personas -- e.g. Writer, Painter, Director, Photographer -- that can be invoked ephemerally or persistently for non-coding tasks like copy and imagery generation, and if pursued, where that registry should live.

## Options

- **Defer -- revisit when a first concrete content-generation task needs a named persona** (recommended): No persona system is built now. Ad hoc model/provider selection (per docs/model-selection.md) continues to cover copy and imagery tasks until a real recurring need names the trigger.
- **Extend AGENT_ROLES / agentIdentity.ts to cover content personas**: Reuses the exact naming and tier infrastructure already proven in git history, but the same enum now governs both commit authorship and content-persona routing -- a later change to one concern (e.g. adding a role) risks touching the other.
- **Build a separate persona registry alongside agentIdentity.ts**: Keeps git-authorship identity and content-generation personas as distinct concerns, at the cost of a second place that defines the given-name/tier naming convention and must be kept consistent with the first.

## Rationale

The operator's proposed naming scheme ([Role] [Provider] [Level], e.g. 'Writer Owen Swift', 'Critic Owen Mason') already matches the given-name/surname convention agentIdentity.ts uses today for git authorship (Owen=opencode, Swift=light tier, Mason=standard tier, Atlas=heavy tier), so this reads as a natural extension rather than a new mechanism. But that table's role field (AGENT_ROLES: builder/critic) exists specifically to keep git commit/PR-comment authorship honest, a different concern from routing a content-generation task to a model/provider/tier under a persona name. Reusing AGENT_ROLES risks conflating those two concerns; a separate persona registry avoids that but duplicates the naming convention. The operator framed this as exploratory ('by and by, I want to explore... are you with me?'), and no concrete content-generation task is blocked on it today, so YAGNI favors deferring until a first real Writer/Painter/Director task exists -- but this is exactly the kind of naming/architecture fork a reasonable person could resolve differently, so it is presented as a Decision rather than assumed.

Proposed by Agent Ask generalize-agent-personas-for-ask-an-agent-2026-09-25.
