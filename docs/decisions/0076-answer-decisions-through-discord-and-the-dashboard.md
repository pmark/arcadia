---
arcadia: v1
type: decision
id: "0076"
slug: answer-decisions-through-discord-and-the-dashboard
project: arcadia
status: approved
question: Now that GitHub cannot tell an operator's merge from an agent's, how should the operator answer Decisions by default?
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Answer Decisions through Discord or the dashboard, preferably through a Discord ping that links to a single-Decision page; drop decide-by-merge.
confidence: high
updated: 2026-09-29
answer: Answer Decisions through Discord or the dashboard, preferably through a direct link to a single-Decision page; decide-by-merge is dropped
decided: 2026-09-29
options:
  - label: Answer Decisions through Discord or the dashboard, preferably through a direct link to a single-Decision page
    consequence: A Decision reaches the operator as a Discord ping linking straight to one Decision's page, where they answer it in one step. Decision 0075's decide-by-merge rule is withdrawn, and the ratify-by-merge enforcement work is not built.
    recommended: true
  - label: Keep decide-by-merge and give agents their own GitHub identity
    consequence: A separate GitHub machine user or App performs agent merges, so `merged_by` distinguishes the operator. That needs an operator setup step before anything works, and Decisions still wait on a merge.
  - label: Keep decide-by-merge and trust an agent merge marker
    consequence: Agents add a trailer to every merge commit they make. It is cheap, but it rests on agents following instructions, which is no real protection.
---

# Decision 0076: Answer Decisions through Discord and the dashboard

## Context

Decision 0075 made merging a pull request the default way to answer a
Decision. On 2026-09-29, while designing a worker that would settle Asks from
PRs the operator merged, the agent found that GitHub records every agent merge
as the operator's: the GitHub connection agents use acts as the operator's
account. `pmark/arcadia#760`, which an agent merged, reports `merged_by: pmark`,
exactly like a merge the operator made. So a merge cannot show that the
operator decided anything, and the `ratified_by` check proposed in
`docs/proposals/ratify-decisions-by-pr-merge.md` cannot work as designed.

## Resolution

Answer Decisions through Discord or the dashboard, preferably through a direct
link to a single-Decision page. Decide-by-merge is dropped.

The operator gave this answer on 2026-09-29 in Claude Code session
https://claude.ai/code/session_01PV3f9xHNWQ48L7yaZYvi6t: "Perhaps we can
conclude that decide-by-pr-merge will not work, and that Discord or the
Dashboard (preferably a deep link to a single decision page) is the best way
to go, and that's fine."

## What this commits to

- **Decision 0075 is superseded.** Its "Decide by merging a pull request" rule
  is removed from `docs/agents-context.md` (and so from every managed
  repository's AGENTS.md), `OPERATOR_CONTEXT.md` and `START_HERE.md`.
- **Decisions already recorded stay recorded.** Decisions 0073, 0074 and 0075
  keep their answers. Each rests on an answer the operator gave in their own
  words, not on who merged it.
- **The enforcement work is withdrawn.** `docs/proposals/ratify-decisions-by-pr-merge.md`
  is answered by this Decision. The unsettled draft-Plan Ask from #760 is
  archived, so nobody settles it.
- **The gap is a single-Decision page.** The dashboard's `/review` lists every
  item, and the Discord "requires review" notification only says to run
  `/arcadia review`. Neither links to one Decision. Building that page and
  link is the follow-up, filed as a draft-Plan Ask.

## Options considered

The three options above. The first is recommended and chosen.

## Provenance

- Operator direction: the session linked above.
- Supersedes: Decision 0075 (`pmark/arcadia#759`).
- Evidence: `merged_by` on `pmark/arcadia#760` and `#750`, both `pmark`.
