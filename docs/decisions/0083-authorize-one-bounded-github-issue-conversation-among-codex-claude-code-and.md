---
arcadia: v1
type: decision
id: "0083"
slug: authorize-one-bounded-github-issue-conversation-among-codex-claude-code-and
project: arcadia
status: approved
question: "Authorize one bounded GitHub Issue conversation among Codex, Claude Code, and OpenCode, plus one compact link comment on #940."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Authorize the bounded Issue conversation and #940 link comment"
options:
  - label: "Authorize the bounded Issue conversation and #940 link comment"
    consequence: "Create exactly one dedicated Issue using the supplied ticket and the agreed evidence, hypothesis, non-goals, reply prompts, provisional responsibility split, and final summary requirements. Post one compact link comment on #940 stating it remains the curation catalog. Permit only compact, signed replies from Codex, Claude Code, and OpenCode to those prompts and one evidence-only summary on that Issue. Do not post to #899. This does not authorize starting the experiment or changing governance, production, workspaces, fixtures, pointers, or ownership. The proposed responsibility split becomes ownership only after each named agent explicitly acknowledges it."
    recommended: true
  - label: Keep the ticket local until separately authorized
    consequence: Do not create the Issue or post comments. Preserve the supplied ticket as a local proposal until the operator authorizes GitHub messaging through the Decision surface.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-04
answer: "Authorize the bounded Issue conversation and #940 link comment"
decided: 2026-10-04
---

# Decision 0083: Authorize one bounded GitHub Issue conversation among Codex, Claude Code, and OpenCode, plus one compact link comment on #940.

## Options

- **Authorize the bounded Issue conversation and #940 link comment** (recommended): Create exactly one dedicated Issue using the supplied ticket and the agreed evidence, hypothesis, non-goals, reply prompts, provisional responsibility split, and final summary requirements. Post one compact link comment on #940 stating it remains the curation catalog. Permit only compact, signed replies from Codex, Claude Code, and OpenCode to those prompts and one evidence-only summary on that Issue. Do not post to #899. This does not authorize starting the experiment or changing governance, production, workspaces, fixtures, pointers, or ownership. The proposed responsibility split becomes ownership only after each named agent explicitly acknowledges it.
- **Keep the ticket local until separately authorized**: Do not create the Issue or post comments. Preserve the supplied ticket as a local proposal until the operator authorizes GitHub messaging through the Decision surface.

## Rationale

The operator supplied a specific three-agent ticket, directly requested its use, and said the proposed scope was approved. The arcadia-github-issues skill requires an explicit Decision for GitHub publication or messaging. This Decision would authorize only the initial Issue, one compact #940 link comment, compact signed replies from the three named agents to the Issue prompts, and one final evidence-only summary there. It would create no second queue, Decision, Grant, authorization, or work claim. #940 remains the curation and evidence catalog; #899 remains rehearsal and shared-authority coordination and receives no post. No experiment, workspace, fixture, pointer, ownership, or production state is created or changed by this messaging scope.

Proposed by Agent Ask authorize-three-agent-issue-messaging-2026-10-04.
