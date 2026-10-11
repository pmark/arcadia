---
title: "The single-Action path: a governed AI coding workflow"
date: 2026-10-10
type: essay
slug: the-single-action-path-runs-itself
summary: "Arcadia's fixture rehearsal shows a path from bounded coding work to validated, reviewed merges. Here is how the workflow separates work, proof and authority."
author: "Arcadia (original draft by Claudia Atlas; substantially revised by Cody Atlas)"
status: draft
claims_receipt: docs/articles/receipts/the-single-action-path-runs-itself.md
not_done: true
canonical: https://arcadiamissioncontrol.com/notes/the-single-action-path-runs-itself/
channels: [site, rss]
---

# The single-Action path: a governed AI coding workflow

On October 9–10, 2026, nine small coding Actions reached merged pull requests in Arcadia's disposable rehearsal repository.
That is a concrete result for a governed AI coding workflow, with a narrow proof boundary: the work changed marker files in a fixture, not a production application.
The useful question is how work gets from an approved instruction to a change someone can inspect and recover.

## Give the agent one finishable Action

Arcadia calls its smallest unit of intentional work an **Action**; an **Artifact** is the durable output or evidence, and a **Decision** records a point requiring human judgment.
The checked-in Project record selects a current Action inside an active Plan, while the execution contract requires clarified work and observable acceptance criteria.
These are the workflow's declared rules, rather than a claim that a model can understand any request.

The [first rehearsal Action](https://github.com/pmark/arcadia-three-action-rehearsal-20261004/pull/11) makes the distinction tangible: create `MARKER.md` with exactly one specified line and a trailing newline, then pass the repository's declared check.
The instruction gives a reviewer something sharper than “make the project better.”
In our reading of this example, the crucial preparation happens before the agent starts: decide what output counts, how to verify it, and where the agent's authority ends.

An immutable build packet freezes execution input, and its approval is a separate gate from permission to launch a Session.
That separation matters when the operator approves a task but has not approved every way an agent might carry it out.

## Let the agent work; let the host preserve

Arcadia's documented headless path runs a coding agent without an operator at its terminal, in an isolated candidate worktree.
Its completion brief distinguishes the agent's validation and evidence draft from the host's preservation responsibilities.
For headless Claude, Git commits and the preservation broker are host-owned; the brief supplies an exact completion-draft command instead.
For headless Codex, the brief includes a protected broker request, followed by an evidence draft once the agent's own validation passes—even if the broker refused.

This is an important design choice: a refused operation should leave a precise next step inside the agent's remaining authority.
It should not invite the model to find another way around the refusal.

The host preservation contract binds validation to a candidate tree, preserves the work in Git, and gates remote push and draft-PR creation separately.
In the first fixture PR, the public preservation evidence names the candidate commit and tree, reports the declared check exiting zero, and supplies reproducible inspection steps.
The archived completion Ask sits beside the changed file and governed records at that commit.
Those pieces let a reader inspect the output and its recorded acceptance instead of relying on the agent's final message.

## Review the same revision that will merge

[Arcadia's PR procedure](https://github.com/pmark/arcadia/blob/9302b5946451ba763de72052a69c6a35124aabc9/docs/agent-guidance/pull-requests.md) requires an independent read-only reviewer, passing required checks, and a clean merge state before its standing merge permission applies.
Changes to important Decisions or agent authority remain outside that standing permission.
For the rehearsal's first PR, a public review comment names the exact candidate head, reports no blocking finding and a green check, and identifies the fixture Decision used for merge.
GitHub separately records that PR as merged.

These are different kinds of evidence: the comment records the review verdict, while the commit contains the work and GitHub records the merge.
The public comment is not a full reviewer transcript or a security audit.
The transferable lesson is to bind the review to a revision, so “reviewed” cannot silently describe an earlier version of a change.

## Autonomy has a named boundary

[Decision 0100](https://github.com/pmark/arcadia/blob/9302b5946451ba763de72052a69c6a35124aabc9/docs/decisions/0100-decide-whether-agents-may-launch-actions-in-disposable-fixture-projects-without.md) granted standing launch and merge-on-green permission for registered disposable fixtures through October 18, 2026, subject to its conditions.
It expressly excluded Arcadia's own repository and other Projects from that fixture launch permission.
[Decision 0119](https://github.com/pmark/arcadia/blob/9302b5946451ba763de72052a69c6a35124aabc9/docs/decisions/0119-decide-whether-agents-may-approve-the-immutable-build-packet-of-an-action-in-a.md) subsequently allowed agents to approve fixture build packets, without approving planning runs, Grants or production changes.
Both grants had the same October 18 expiry, and Decisions raised inside the fixture still required the operator.

Our interpretation is that useful autonomy comes from making these boundaries executable and inspectable.
Removing a repeated confirmation is a policy change; it deserves an explicit grant, rather than an agent deciding that a pause is inconvenient.

## What is not done

The fixture result does not establish end-to-end production readiness, reliable operation on arbitrary repositories, or an installation experience for other developers.
Its marker-file tasks do not measure product judgment, security review depth, cost, or coding speed.
Public validation excerpts and merge records do not establish that every step occurred without human intervention.
This essay therefore explains the documented workflow and the inspectable fixture result, without claiming complete autonomy.

For the evaluation of the test itself, the companion essay, [What nine automated Actions proved—and what they didn't](https://arcadiamissioncontrol.com/notes/what-nine-automated-actions-proved/), is a planned Field Note awaiting publication.
The existing [guide to governed autonomous development](https://arcadiamissioncontrol.com/guides/governed-autonomous-development/) provides broader background.
