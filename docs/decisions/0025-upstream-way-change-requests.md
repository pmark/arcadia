---
arcadia: v1
type: decision
id: "0025"
slug: upstream-way-change-requests
project: arcadia
status: approved
question: How does a coding agent working in an adopting project formally request a change to the Arcadia Way, its commands, or its shared files, so that improvising a local implementation is never the only available move?
gap_type: missing-decision
recommendation: >-
  The request travels as a managed document, not as a message. An agent writes
  a `type: proposal` document into its own repository and commits it; `docs
  sync` already crawls that repository and matches documents to their project,
  so the request arrives with the next sync and needs no new channel, command,
  or network call. Surface unresolved proposals in `arcadia portfolio` under
  the existing "Waiting on you" section, and state the path in the shared
  `AGENTS.md` region so every agent reads it before it can improvise.
confidence: high
decided: 2026-08-17
answer: >-
  Approved as recommended by the operator on 2026-08-17. A Way-change request
  travels as a `type: proposal` document committed in the project's own
  repository and arrives through `docs sync` -- no new channel, consistent
  with Decision 0022's git-only rule. Unresolved proposals surface in `arcadia
  portfolio` under "Waiting on you". The shared AGENTS.md region gains the
  rule that an agent files a proposal and continues without the capability,
  and never implements Arcadia commands, parsers, or governance machinery
  locally. PPN's six shim capabilities -- docket, triggers, demo, plan,
  report, and the hand-rolled document parser -- are treated as the first six
  proposals, retroactively filed, so that backlog becomes visible as requests
  rather than staying as a rogue script. This ratification does not
  authorize implementing proposal ingestion, portfolio surfacing, or the
  AGENTS.md region change; that is `accept-upstream-proposals` on the
  `way-delivery` plan.
updated: 2026-08-17
---

# Upstream Way-change requests

## Context

Private Practice Now's `scripts/arcadia.mjs` is 781 lines of locally written
Arcadia: a docket, a trigger evaluator, a demo prober, a plan brief, a report
digest, and a second hand-rolled parser for the managed-document format.

It is tempting to read that as a project overstepping. It is not. There has
never been a way for an agent in an adopting project to ask for a capability,
so when one was needed the only available move was to build it locally. The
shim is the predictable output of a missing escalation path, and the same
incentive is intact for every project onboarded next.

Two of those six capabilities — trigger evaluation and demo probing — do not
exist in Arcadia at all. The Way tells agents to trust `arcadia triggers`, and
in the Arcadia repository there is nothing to run. That is not drift. It is a
capability that was requested by being written, in the only place it could be.

## Why this travels as a document

Decision 0022 settled that git is the only channel between an Arcadia
installation and anything else. A request mechanism that opened a second
channel would contradict it on the day it shipped.

The operator's observation is that the precedent already exists: everything
Arcadia learns about a project, it learns by reading that project's repository.
A Way-change request is just another thing to learn, so it should arrive the
same way.

What makes this cheap is that almost none of it needs building:

- `proposal` is **already** a valid `DOC_TYPES` entry in `src/docs/types.ts`.
- `discoverDocs` scans the whole repository, not only the control paths, so a
  proposal anywhere in the tree is found.
- `syncProjectDocs` already matches each discovered document to its owning
  project and reports foreign ones separately.
- `arcadia portfolio` already renders a **Waiting on you** section.

The pipe runs end to end today. The missing inch is that a `proposal` currently
lands as an unhandled narrative record rather than as something awaiting an
answer.

## The mechanism

**Filing.** An agent writes `docs/proposals/<slug>.md` in its own repository
with `arcadia: v1`, `type: proposal`, its own `project` slug, a one-sentence
`question` naming what it needs, and a body stating the capability, why the
project needs it, and what the agent would otherwise build locally. It commits
this like any other document. It does not need network access, credentials, or
a reachable Arcadia — which is what makes it work from a cloud container.

**Arrival.** `arcadia docs sync` ingests it on the next run against that
project.

**Triage.** Unresolved proposals appear in `arcadia portfolio` under "Waiting
on you", and in `/menu`. The operator answers by ratifying a Decision in the
Arcadia repository, which is where a Way change belongs.

**Closing the loop.** The proposal document records the Decision that answered
it, the same way a plan `questions:` entry records its `decision:`.

## The rule this makes statable

The shared `AGENTS.md` region gains a short section, so it reaches every
adopting project through the propagation machinery rather than by being
remembered:

> If the Way lacks a capability you need, file a `proposal` document in this
> repository and continue without it. Do not implement Arcadia commands,
> parsers, or governance machinery locally. A capability Arcadia does not have
> is a request, not a gap for this project to fill.

The second sentence is the operative one. Without it the first is advice.

## What this does not solve

An agent can still ignore the rule, and nothing detects a project that has
quietly grown its own Arcadia. Detecting that is a different problem —
plausibly an extension of `arcadia way`, which already reports per-project
drift — and it is deliberately not in scope here. Prevention first; detection
when there is evidence prevention is insufficient.

## Recommendation

Adopt the mechanism above, and treat PPN's six shim capabilities as the first
six proposals: retroactively filed, so the backlog of what PPN needed becomes
visible as requests rather than staying as a rogue script.

## Keep triggered

| Increment | Reactivate when |
| --- | --- |
| `arcadia way request` as a command | An agent files a proposal in a form the operator cannot act on, or a second project improvises rather than filing. |
| Detect locally grown Arcadia machinery | A project is found to have implemented a Way capability locally after this Decision is adopted. |

## What this Decision does not authorize

- It does not implement proposal triage, the portfolio surfacing, or the
  `AGENTS.md` region change. Approval is the gate for each.
- It does not decide whether PPN's shim capabilities are accepted into Arcadia.
  Filing a proposal is a request, not an approval.
