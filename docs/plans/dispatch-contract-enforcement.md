---
arcadia: v1
type: plan
slug: dispatch-contract-enforcement
project: arcadia
status: active
milestone: Managed plans govern work from dispatch through acceptance
current_action: compute-ready-set
updated: 2026-07-31
actions:
  - id: verify-acceptance-criteria
    title: Check finished work against the Action's declared acceptance criteria
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered as src/stewardship/acceptanceCriteria.ts, wired into the artifact-acceptance approval in review.ts; no further work.
    expected_artifact: Per-criterion pass/fail on the acceptance Decision, from the plan's own criteria
    clarification: clarified
    confidence: high
    source: graph-engineering review session, 2026-07-28
    acceptance_criteria:
      - Accepting a Run reports each declared criterion as met or unmet, named in the plan author's words.
      - An Action whose plan declared no criteria validates exactly as it does today.
      - Criteria that cannot be checked deterministically are reported as unchecked, never as passed.
    depends_on: []
  - id: compute-ready-set
    title: Compute the ready set instead of only refusing a bad pointer
    status: open
    responsibility: codex
    effort: session
    next_action: Add `arcadia next --ready`, listing every Action with no unmet prerequisite, no unanswered required Decision, and no open clarification question.
    expected_artifact: arcadia next --ready listing dispatchable Actions across the active plan
    clarification: clarified
    confidence: high
    source: graph-engineering review session, 2026-07-28
    acceptance_criteria:
      - The ready set excludes Actions with unmet transitive prerequisites, unanswered required Decisions, or an open clarification question.
      - The command suggests a current_action without writing one; the operator still decides.
      - An empty ready set says which unfinished Action is nearest to ready, rather than printing nothing.
      - Readiness is computed through resolveActionReadiness, not a second implementation of the same rules.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: project
        required:
          - Shared dispatch readiness resolution
          - CLI surface for arcadia next
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    references:
      - src/docs/dispatch.ts
      - docs/COMMANDS.md
    depends_on: []
  - id: recheck-readiness-at-approval
    title: Decide whether readiness is rechecked when a planning Decision is approved
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered as the hybrid recheck under Decision 0005; no further work.
    expected_artifact: Approval refuses a packet whose plan document changed and now fails readiness, and passes through unchanged otherwise.
    clarification: clarified
    confidence: high
    source: Decision 0005, which selected the hybrid over immutability and full recheck
    acceptance_criteria:
      - Approval is unaffected when the plan document's updated field is unchanged since the packet was built.
      - Approval refuses, naming the blocker, when the document moved and a real blocker or clarification question is now present.
      - Approval succeeds when the document moved but nothing about readiness regressed.
      - The refusal is journalled even though the approval transaction that would have executed it rolls back.
    decisions: ["0005"]
    depends_on: []
  - id: surface-dispatch-journal
    title: Surface the dispatch journal where the operator already looks
    status: open
    responsibility: codex
    effort: short
    next_action: Add the dispatch journal's refusal tally to the dashboard snapshot so reading it does not depend on remembering a CLI command.
    expected_artifact: Refusal tally in the dashboard snapshot
    clarification: clarified
    confidence: medium
    source: graph-engineering review session, 2026-07-28
    acceptance_criteria:
      - The snapshot reports total resolutions, how many were refused, and the most frequent blocking field.
      - The dashboard stays read-only and runs no AI.
    depends_on: []
questions:
  - id: criteria-judgment
    question: When a declared acceptance criterion cannot be checked by a script, should Arcadia ask local Intelligence to judge it, or report it unchecked and leave the judgment to the operator?
    gap_type: missing-decision
decisions: []
---

# Managed plans govern work from dispatch through acceptance

## Why this plan exists

The continuation contract made checked-in documentation authoritative, and the
dependency and acceptance-criteria work landed in
[PR #18](https://github.com/pmark/arcadia/pull/18) made it enforceable: the
action graph blocks a premature dispatch, plan-declared acceptance criteria
reach the coding agent, both dispatch paths answer to the same rules, and every
resolution is journalled.

That closed the gap between *what a plan claims* and *what an agent is told*.
This plan closes the remaining one: between what an agent was told and what it
is judged on.

## The shape of what is left

Acceptance criteria now travel from the plan into the packet, and stop there.
Nothing compares the finished Run against them — `artifactValidator` checks that
a planning Artifact has the required sections, and `critic` checks the packet
for goal alignment, but neither reads the plan author's own criteria. An agent
can therefore satisfy every structural rule while missing the thing the operator
actually asked for, and acceptance will not notice.

The ordering work has the mirror-image gap. `depends_on` now stops a dispatch
that should not happen, but nothing computes the dispatch that *should* — the
operator still hand-edits `current_action` and finds out afterwards whether they
picked something workable. Refusing a wrong answer is worth less than offering
the right one, and the graph needed to offer it already exists.

Readiness is also checked once, when the packet is built. Whether that is a bug
or the intended immutability of a bound packet is a real question, not an
oversight, which is why it is recorded as one rather than as work.

## Ordering

No action here hard-depends on another, so `depends_on` is empty throughout
rather than carrying invented edges — the graph is only useful if it means
something.

There is a soft preference worth respecting anyway: `verify-acceptance-criteria`
and `recheck-readiness-at-approval` both touch the review and acceptance path,
so answering the second before starting the first avoids doing that surgery
twice. `compute-ready-set` and `surface-dispatch-journal` are independent of both
and of each other.

That preference is what made `compute-ready-set` the `current_action` when this
plan became active under Decision 0004: it was the only one of the four that
depended on no open question. `recheck-readiness-at-approval` and
`verify-acceptance-criteria` are both now delivered, in that order, following
the ordering this section committed to before either was started.
`compute-ready-set` remains `current_action` — still open, still the pointer —
with `surface-dispatch-journal` deliberately last after it.

`surface-dispatch-journal` is the least valuable of the four and should stay
last. The journal already answers its question from the CLI; putting it on the
dashboard makes it easier to notice, not more true.

## Acceptance criteria checking

Delivered in `src/stewardship/acceptanceCriteria.ts`, wired into the
`CodexPlanningArtifactAcceptance` approval in `src/commands/review.ts`.

Each declared criterion is one sentence of free-text English a human wrote
("The migration is idempotent."). Nothing can mechanically verify that a claim
like that is *true* — only whether the accepted Artifact ever addressed the
topic at all. That ceiling is a negative, not a positive: strong absence of a
criterion's own terms anywhere in the Artifact is real evidence of `unmet`.
Presence is not evidence of `met` — an Artifact that mentions a topic has not
thereby satisfied it — so `unmet` and `unchecked` are the only two values this
checker produces. `met` stays part of the type for when a stronger signal
exists to justify it (a self-reported checklist section, a validation command
result), rather than being invented now to satisfy the letter of "met or
unmet." This plan's own `criteria-judgment` question is what would license a
`met` verdict, and it is still open, not assumed — consistent with "no judge
agent for what a script can check" below.

An Action whose plan declared no criteria is unaffected: the check runs only
when `acceptance_criteria_json` is non-empty, so `decisionNote` and
`context_json` are byte-for-byte what they were before this Action existed.

## What this plan deliberately does not do

- **No node runtime, planner, or router.** The clarify → dispatch → run → review
  path already is the graph. Rebuilding it as a framework would be the
  over-engineering the constitution rules out.
- **No parallel execution.** One current Action across the project is a
  deliberate choice for an operator with little time. Making the ready set
  *visible* helps; running it concurrently would break that invariant.
- **No judge agent for what a script can check.** If a criterion is mechanically
  checkable, check it. `criteria-judgment` above asks whether local Intelligence
  should judge the rest, and that question is open, not assumed.
