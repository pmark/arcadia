# Operator demo, QA, and release contract

This is the human-readable operating agreement behind Decision 0007 and the
`demo-first-delivery` plan. It is effective immediately as a manual process;
the plan turns it into Mission Control behavior.

## The direct agreement

Arcadia owes the operator an obvious, stable thing to use. The operator does
not owe Arcadia a morning archaeology session through plans and Logs merely to
discover what changed.

The operator does owe the Project informed judgment before consequential
transitions. A quick demo may come first. Acceptance, merge, release, and client
delivery may not come before the relevant Log and QA evidence are understood.

## Responsibilities

| Entity | Owns | Must not claim |
| --- | --- | --- |
| Coding agent | Build the candidate, run repository checks, prepare the change summary, runnable target, screenshots, and Log | That its own implementation is independently QA-approved or released |
| Arcadia | Reconcile Project state, preserve Stable and Candidate targets, health-check links, collect proof Artifacts, and present one exact next thing | That a URL is healthy, current, or stable without evidence |
| Operator | Exercise the candidate, judge usefulness and direction, read the Log and QA evidence before acceptance, and authorize merge/deploy/delivery | That a skimmed screenshot is acceptance or that QA replaces product judgment |
| Arcadia QA | Verify the exact candidate revision independently against declared criteria; produce a QA report and reproducible evidence | Product-direction authority, release authority, or permission to change the candidate while testing it |
| Release management | Bind an immutable release candidate, verify approvals, perform the authorized release, run post-release smoke checks, preserve rollback information, and record client delivery | That a successful deployment is acceptable without QA and operator approval |

## Required handoff evidence

Observable software work should supply one Project proof set:

- known-good Stable target, or an explicit reason none exists yet;
- current Candidate target and source revision;
- one-paragraph `What's changed` summary relative to Stable;
- pull request or comparison link when one exists;
- automated desktop and mobile screenshots for declared demonstration routes;
- repository validation results and last verification time;
- Arcadia QA status and report once QA has run;
- relevant Log; and
- one primary action: fix proof, inspect failure, Test Candidate, review QA, or
  approve release.

## Handoff gates

| Gate | Minimum evidence | Human responsibility |
| --- | --- | --- |
| Ready for operator demo | Candidate reachable, revision identified, basic health check passes, change summary present | Use it and record directional feedback |
| Ready for Arcadia QA | Operator indicates the workflow is directionally acceptable; candidate revision is frozen for the QA Run | Confirm QA should evaluate this candidate |
| Ready for release Decision | QA passes against that exact revision; Log and release notes are available; rollback target is known | Read the Log and QA report; approve, reject, or defer release |
| Released | Approved revision deployed; post-release smoke and screenshot proof pass | Confirm delivery readiness |
| Delivered | Client/stakeholder target and communication are recorded | Explicitly authorize outbound delivery/communication |

## Stable versus Candidate

`Stable` is the stakeholder-safe target Arcadia last proved. `Candidate` is the
thing the operator is evaluating now. They may point to the same revision only
after release verification. A broken Candidate must never take Stable away.

For local-only projects, Stable may initially be a managed laptop service
reachable over LAN or Tailscale. That is an operator demo, not automatically a
stakeholder-ready deployment. Stakeholder-ready means the intended stakeholder
can reach it through an approved, access-controlled target.

## Cloud preview posture

Cloud development previews are supported, but are Candidates, not Stable:

- Cloudflare Pages can create a unique deployment for each pull request and a
  branch alias that follows the branch.
- Cloudflare Workers can expose versioned and aliased preview URLs.
- Preview URLs are public by default. Client or non-public work should use
  Cloudflare Access and must not embed secrets or production data.
- Pages preview deployments should remain non-indexable, and Arcadia should
  verify the `noindex` response rather than assume it.
- Local Playwright is the first screenshot runner because it works against
  local and remote targets without adding cloud credentials or spend.
  Cloudflare Browser Rendering is an optional later runner for remote capture.

## What the Project Detail hero should say

The hero is a state resolver, not a second Next Action field. Priority order:

1. Candidate or validation failed: show the failure and `Inspect failure`.
2. Candidate is ready for operator judgment: show `Test Candidate`.
3. QA failed: show the QA finding and `Review QA`.
4. QA passed and release approval is needed: show `Review release`.
5. No candidate is active and Stable is healthy: show `Show Stable`.
6. No usable proof exists: show `Fix demo surface` and name the missing field.

Below the hero, each deployment is an App-Store-like card: environment name,
health and access state, source revision, last verified time, `What's changed`,
screenshot gallery, PR, validation, QA, Log, and Test action.
