---
arcadia: v1
type: decision
id: "0075"
slug: decide-by-merging-a-pull-request
project: arcadia
status: approved
question: Should the operator answer Decisions by merging a pull request by default, in every Project, instead of through an Arcadia CLI or UI surface?
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Adopt decide-by-merge as the default in every Project.
confidence: high
updated: 2026-09-28
answer: Adopt decide-by-merge as the default in every Project
decided: 2026-09-28
options:
  - label: Adopt decide-by-merge as the default in every Project
    consequence: Every Decision reaches the operator as its own PR whose merge accepts the recommended option, and a comment naming another option asks the agent to switch the ballot, which the operator merges once the updated head's checks are green. Agents keep working on everything that does not depend on the answer. The rule reaches every managed repository through the shared AGENTS.md block, and `decision approve` becomes a fallback rather than the path.
    recommended: true
  - label: Use decide-by-merge only when the operator asks for it
    consequence: The CLI stays the default; agents offer a Decision PR only on request. Less changes today, but every unattended Decision still waits for the operator at a terminal, which is the bottleneck this Decision exists to remove.
  - label: Keep answering Decisions through the Arcadia CLI
    consequence: Nothing changes; Decisions drafted by cloud or production sessions keep needing `agent-ask settle` and `decision approve` from the operator's machine. Revisit when managed production raises more Decisions than the operator clears in a week.
---

# Decision 0075: Decide by merging a pull request

## Context

Answering a Decision used to take two Arcadia commands on the operator's
machine: `agent-ask settle --apply` and then `decision approve`. When
managed production runs unattended, the operator is mostly not inside a
coding agent, so every Decision waited for them at a terminal. That made the
operator the bottleneck.

On 2026-09-28 the operator said, in Claude Code session
https://claude.ai/code/session_01PV3f9xHNWQ48L7yaZYvi6t, that they want to
record decisions through a pull request merge rather than by interacting
directly with an Arcadia tool or UI surface. They said this is how they want
to handle decision making by default: "a streamlined approach… I don't want
to be the bottleneck."

## Resolution

Adopt decide-by-merge as the default in every Project. The operator stated
this preference in their own words, as quoted above. **Merging the pull
request that adds this document is the operator's ratification.** It is also
the first Decision made under the rule it adopts. Until that merge, this
file exists only on an unmerged branch and decides nothing.

## What this commits to

- **The rule lives in `docs/agents-context.md`** ("Decide by merging a pull
  request"), which is the shared block regenerated into every managed
  repository's AGENTS.md. `OPERATOR_CONTEXT.md` records it as a standing
  preference.
- **The shape of a Decision PR.** It carries one Decision, whose document has
  every option and uses the recommended option as its `answer`. It opens with
  "Merging accepts: …". A comment naming another option does not change the
  answer by itself: the agent pushes the switched ballot, and the operator
  merges that updated head once its checks are green.
  Agents never merge it.
- **Arcadia will be asked to enforce it.** That request is
  `docs/proposals/ratify-decisions-by-pr-merge.md`: a `ratified_by` check
  bound to who merged the PR and to the Decision's exact content, and
  settle-on-merge for managed production. Until that is built, the rule works
  by agent instructions plus the operator's merge.

This changes how a Decision is recorded, not what agents are authorized to
do. It adds no approval boundary and removes none.

## Options considered

The three options above. The first is recommended and chosen.

## Provenance

- Operator direction: the session linked above.
- First use: Decision 0074 (`pmark/arcadia#756`).
- Enforcement request: `docs/proposals/ratify-decisions-by-pr-merge.md`.
