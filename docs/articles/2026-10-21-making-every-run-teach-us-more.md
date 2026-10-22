---
title: "Making every run teach us more"
date: "2026-10-21"
type: essay
slug: "making-every-run-teach-us-more"
summary: "A proposed approach to autonomous production: use focused checks, disposable replays and deliberate failures to shorten the distance between discovering a defect and proving its repair."
author: "Arcadia (drafted by Cody Atlas)"
status: draft
claims_receipt: "docs/articles/receipts/making-every-run-teach-us-more.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/making-every-run-teach-us-more/"
channels: [site, rss]
---

# Making every run teach us more

The version of autonomous production we want is a chain of useful work. A coding
agent finishes an Action, the result receives independent review, a repair happens
when needed, and an accepted change is integrated before the next Action begins.
The operator supplies judgment and authority at the boundaries that need them.

Getting there raises an awkward development problem: a run can discover one new
bug, stop, and leave everything beyond that point unexplored. Repairing it helps,
but the next attempt may reveal another bug just a little farther along. Each
attempt teaches us something, while the feedback arrives slowly.

Our working hypothesis is that we can make those attempts much more informative
by finding more failures before a production run, and rehearsing several kinds
of failure in a disposable setting.

## Give the loop more chances to fail

The approach starts with cheap, focused checks around known weak points. If a
completion receipt has already been used, does a later repair receive its own
identity? If review rejects a change, can the system recover without quietly
reusing approval for the old revision?

Then comes a deeper rehearsal: reconstruct a trusted source state in a disposable
environment and exercise the actual orchestration code while simulating external
services. This could let us inspect the handoffs between completion, review,
repair, integration and the next Action without making those external changes.

We would deliberately introduce trouble. A reviewer might reject a candidate.
A required check might fail. An interruption might leave work preserved halfway
through. Each scenario would ask a concrete question about what happens next.
A useful scenario needs an observable expected result, including the point at
which the system must stop.

The repair itself matters. A convincing recovery would change the actual candidate,
produce fresh evidence for that revision, and pass the appropriate gates. A
scripted success message alone would tell us very little about whether the loop
can recover.

## Keep the experiment honest

Recent recovery work offers a small reason to pursue this direction. A focused
fixture exercised failure, a changed repair, simulated review and QA, simulated
integration, and continuation to another Action. A broader source-state replay
reached an automatic changed repair after a simulated review failure, then timed
out before the recovery chain was accepted. The [related repair PR](https://github.com/pmark/arcadia/pull/1684)
is still a candidate; these are limited development observations, not live
production acceptance.

That distinction shapes the proposal. Simulated reviewers can test how the system
handles a verdict; they cannot establish that an independent reviewer would reach
that verdict. A disposable replay also needs a trusted starting state and a clear
isolation boundary. Its usefulness depends on those assumptions remaining visible.

We would turn each reproducible failure into a regression check, so the next
attempt starts with more protection. We would also measure slow parts of the
rehearsal and improve the bottlenecks that make repeated checks expensive. The
[current performance investigation](https://github.com/pmark/arcadia/issues/1680)
is part of that effort; a new speedup has yet to be demonstrated.

## What is not done

Production remains Off, and we have not accepted a live autonomous chain from
start to finish. The scenarios above describe a proposed testing direction;
they have not all been proved. Faster replay would buy tighter feedback, while
production readiness still needs its own evidence. Any future run would retain
its explicit authority, spend and retry bounds.

The hope is practical: let each bounded experiment uncover more of the road
ahead, and make each repair easier to trust when we try again.
