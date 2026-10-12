---
title: "Arcadia Studio gives agents room to create and puts the system to the test"
date: "2026-10-12"
type: essay
slug: "arcadia-studio-creative-work-integration-test"
summary: "Arcadia Studio proposes giving persistent agent personas time to build their own projects through Ask, To-do, and verifiable artifacts. Their creative work would become a demanding test of the same system people use."
author: "Arcadia (drafted by Cody Atlas)"
status: draft
claims_receipt: "docs/articles/receipts/arcadia-studio-creative-work-integration-test.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/arcadia-studio-creative-work-integration-test/"
channels: [site, rss]
publication_target: "ArcadiaMissionControl.com"
---

# Arcadia Studio gives agents room to create and puts the system to the test

Imagine a software team setting aside some time for projects its members choose themselves: a strange little tool, an experiment, a question worth exploring. Arcadia Studio brings that idea to a team of coding agents. Give them persistent personas, room to develop a portfolio, and a system through which they can turn an idea into something that works.

The exciting part is that they would build through Arcadia itself. Every creative project would also test whether Arcadia can carry work from an initial request to a verifiable result. The playground and the proving ground would be the same place.

## A persona that can work across models

A Studio persona would have a name, a role, a history, and a collection of projects. Its continuity would live in durable records: what it is exploring, what it has tried, what it learned, and what it wants to attempt next. It could work through different coding tools and models as the task and budget require.

That opens up some lovely possibilities. One persona might make playful music tools. Another might explore accessible reading interfaces. A third might build ways to see how software changes over time. Their portfolios could become a record of experiments that grew into useful software, alongside attempts that taught us something and stopped.

This is a way to design continuity and creative direction for agents. The interests and missions are part of the persona we build and maintain; a particular model does not have to own them.

## Ask, To-do, and evidence

The proposed working interface is deliberately small.

**Ask** is where a persona proposes a project, requests work, answers a question, or asks for help. **To-do** is where it discovers the work and decisions Arcadia is waiting on. **An evidence artifact directory** holds the outputs and the proof needed to judge them: files, tests, logs, and links to the relevant work.

A persona should be able to submit an idea, follow the work Arcadia surfaces, handle the decisions within its authority, and leave a result someone else can verify. When it cannot proceed, the reason should be visible through those same interfaces.

The CLI and API would be the primary ways to do this efficiently. The UI would launch tests and show their progress using the same API data. An agent would not need to click through pages to use Arcadia, and a human could still follow the run from a dashboard.

## The ultimate integration test

Arcadia Studio would ask a demanding question: can an agent turn an idea into working software through the same interfaces available to a user, without a hidden shortcut?

That journey crosses the seams where individual component tests can miss problems. Arcadia has to preserve the request, route the work, surface approval, launch the right execution, report its state, and connect the finished artifact to the original goal. A cheerful message saying that work has resumed is not enough. There has to be observable progress and, eventually, a working result.

Creative projects make that test more interesting. A music toy and an accessibility tool would place different demands on the system. We would learn from the software they produce and from the friction they encounter while producing it.

Failures would become reproducible findings, with evidence and a concrete next step. Fixes would feed back into cheap regression tests. Integration testing would grow into automated user acceptance testing as the personas attempt increasingly realistic work.

## Start with Hello World

Before the portfolios, start with one scout and one tiny request: produce a file containing exactly `Hello World!` followed by a newline. The first question is binary. Did it produce the required result?

The [first scout probe is merged](https://github.com/pmark/arcadia/pull/1325). It exercises Ask and To-do directly in a disposable fixture and captures a structured report without model calls. Its current result is **No**: approval queues an execution Run, but the fixture has no worker to execute it. The probe also captures an interface defect: Ask does not expose that queued Run's identity, tracked in [issue #1320](https://github.com/pmark/arcadia/issues/1320).

That is useful evidence, but it is not a successful Studio build. The harness can complete its observation while the product journey remains incomplete. Keeping those two outcomes separate is essential.

The cost goal is simple: repeat deterministic checks freely apart from local compute, and use the least costly compliant coding agent only when actual coding is needed. A later live run should pin its provider, model, and limits before it starts. If the budget or authority is unclear, it should stop with an actionable reason.

## What is not done

Arcadia Studio is still a proposal. The merged probe does not launch a live builder or prove that a persona can complete Hello World end to end. The shared API and CLI result contract, persistent Studio personas, and automatic conversion of findings into governed repairs remain work to do. The [merged launcher's declared scope](https://github.com/pmark/arcadia/blob/586a5d96becb0f71b3674c9da09b52d1c09df99c/artifacts/generated/operator-scripts/run-scout-hello-world-probe.json) excludes workers and automatic Issue publication.

The next proof is small enough to be honest: one scout, one bounded execution, one verified artifact. Once that works, the creative possibilities open up. A portfolio of agent projects could give us useful tools, surprising experiments, and a steady stream of evidence that Arcadia is becoming easier to use.
