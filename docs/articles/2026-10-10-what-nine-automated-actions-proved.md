---
title: "Nine AI coding Actions: what the rehearsal proved"
date: 2026-10-10
type: essay
slug: what-nine-automated-actions-proved
summary: "Nine merged fixture PRs provide evidence of bounded AI coding work and its handoffs. They do not establish production readiness or uninterrupted autonomy."
author: "Arcadia (drafted by Cody Atlas)"
status: draft
claims_receipt: docs/articles/receipts/what-nine-automated-actions-proved.md
not_done: true
canonical: https://arcadiamissioncontrol.com/notes/what-nine-automated-actions-proved/
channels: [site, rss]
---

# Nine AI coding Actions: what the rehearsal proved

On October 9–10, 2026, Arcadia's disposable fixture accumulated nine merged PRs for a serial chain of small file edits.
The public record supports a bounded result: the expected artifacts exist, validation evidence accompanies the PRs, and review comments identify the heads that were merged.
It does not support a claim that autonomous AI coding is ready for real production.
For a developer evaluating an agent workflow, the interesting result is the evidence between those two statements.

## A deliberately small test with visible outputs

The first three Actions wrote a start line, appended its uppercase form, and appended a verification line to `MARKER.md`, with tests for the expected order.
The remaining six Actions built `CHAIN.md`, each reading the previous result and adding one specified line while preserving earlier content.
An Action is Arcadia's unit of intentional work; a Plan supplies the sequence and acceptance criteria.

Small tasks make errors easier to locate, which is why we regard this as a handoff test rather than a measure of coding ability.
The sequence asks whether the next Action receives the preceding output and whether each result survives as reviewable Git history.
It does not ask an agent to design a feature, diagnose a production incident or choose a product tradeoff.

Fixture [PRs #11–#19](https://github.com/pmark/arcadia-three-action-rehearsal-20261004/pulls?q=is%3Apr+is%3Amerged) are merged, and the final pinned Plan records all nine Actions as done.
Each PR contains a public host-validation excerpt reporting `node scripts/check-rehearsal.mjs` exiting zero and a review comment naming its exact head.
For this essay, we also extracted each candidate head into a temporary directory, reran that command successfully, and checked the exact expected marker and chain bytes.
That reproduction verifies the file results today; it does not reconstruct the original launch or every event between launch and merge.

## Passing the check was only part of acceptance

The [genesis check](https://github.com/pmark/arcadia-three-action-rehearsal-20261004/blob/e15120f26a61b795c550a7bcd3916da5dfcda4e9/scripts/check-rehearsal.mjs) inspects `MARKER.md` and runs available marker tests; it does not inspect `CHAIN.md`.
The chain Actions nevertheless require exact chain lines, unchanged earlier content and an unchanged marker file in their acceptance criteria.
Consequently, a green command alone is weaker evidence than the full acceptance contract.

The PR inspection steps expose those additional criteria, and the pinned artifacts allow their contents to be checked independently.
Our lesson from this gap is to evaluate what a check actually covers before treating its exit code as proof that an Action is complete.
An acceptance criterion outside a test still needs evidence; a model's confidence cannot supply the missing bytes.

## The human approvals were separate from the coding work

Decision 0100, approved October 9, allowed standing fixture launches and fixture merges after independent review and passing checks.
Its scope did not include build-packet approval, and Decision 0119's rationale records that fresh packets still stopped the fixture workflow for the operator.
Decision 0119, approved October 10, added agent approval of fixture build packets with no execution as part of that approval.
Both permissions were set to expire after October 18, 2026, and excluded Arcadia's own repository and other real Projects from the fixture exception.

This distinction explains why removing a launch confirmation did not remove every operator gate.
The public Decisions establish the authority granted; they are not a time-stamped ledger of every approval applied to every rehearsal PR.
We therefore do not turn the nine merges into a count of operator taps saved, or assert that a particular subset required no human action.

## Failures improved the surrounding workflow

The public repair history describes failure classes around the rehearsal, including provider sign-in failures, repeated superseded-candidate messages, incomplete completion drafts and reset recovery failures.
Those descriptions are reported incident evidence; the merged changes and regression tests provide the inspectable proof of what was fixed.

The [sign-in repair](https://github.com/pmark/arcadia/pull/1159) classifies matching structured Claude error results and supplies a sign-in remedy, while leaving authorization consumption unchanged.
The [logging repair](https://github.com/pmark/arcadia/pull/1161) reports a superseded candidate once per worker process and input revision, while continuing to skip that candidate.
The [completion-brief repair](https://github.com/pmark/arcadia/pull/1163) gives headless agents an exact evidence-draft recipe, and the later [Codex repair](https://github.com/pmark/arcadia/pull/1193) explicitly continues to that step after a broker refusal only when the agent's own validation passes.
The [single-Action reset work](https://github.com/pmark/arcadia/pull/1179) separates fixture reset from production receipts, then [repairs a multiple-receipt lookup](https://github.com/pmark/arcadia/pull/1185) and adds bounded retries for database-lock errors.

Our reading of these changes is that recovery instructions and observability belong in the workflow's design, alongside the agent prompt.
Classifying a sign-in failure does not renew credentials, and clarifying a completion step does not grant permission to bypass a refused broker.
The fixes make specific failure paths clearer; they do not establish that every possible failure now recovers unattended.

## What is not done

Nine related marker-file Actions in one disposable fixture are not nine independent trials across real applications.
They cannot establish a reliability rate, comparative model quality, elapsed-time performance, cost savings or production security.
The public evidence does not include independently inspectable launch-to-PR timings or a complete intervention ledger, so this essay omits those claims.
Merged repair code is also not proof that a particular release was deployed on the host that ran every Action.

We would want a separately authorized real-Project trial with pinned launch, acceptance, preservation and review evidence before extending this conclusion to production work.
That is a proposed next evidentiary standard, not a claim that such a trial has already succeeded.

The companion [single-Action workflow essay](https://arcadiamissioncontrol.com/notes/the-single-action-path-runs-itself/) explains the design and is a planned Field Note awaiting publication.
For current background, see the existing [coding-agent Session management guide](https://arcadiamissioncontrol.com/guides/coding-agent-session-management/).
