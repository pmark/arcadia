---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia render the route from here to a named completion state — for every active Project at once, at a chosen scope — and deliver it to Discord on request and whenever it changes?
---

# Flight Paths — the route view

## Why this project needs it

The operator asked a question the portfolio cannot currently answer: *what is
the path from here to done, and how far along it am I?*

`arcadia portfolio` answers "what is the state of each Project" — counts, clarity,
Decisions waiting. `arcadia next` answers "what is the one next thing." Neither
answers "what is the **route**, what are its waypoints, and which ones are
already behind me." That question gets re-derived by hand every time it is asked,
by reading a plan document's `depends_on` edges and computing the closure
mentally.

Today it was worth deriving, and the derivation found a real defect that three
sessions had missed. `prove-zero-prompt-production-loop` had been the work
pointer for days. Computing the milestone's dependency closure showed it is **not
in that closure** — nothing on the critical path waits for it; only
`harden-zero-prompt-production-loop` does. It is a valuable confidence proof
sitting on a spur, while the actual route to the milestone ran through an Action
that was frozen behind it by a semantic cycle the declared graph never exposed.

That is not a reporting nicety. **A route view makes "the pointer is parked on a
spur" visible at a glance**, and makes a cycle like
`break-launch-dependency-loop-2026-09-11` legible before it costs days.

Two further properties the operator asked for, which a one-Project report cannot
give:

- **Many routes, not one.** Automated plan production is one subproject among
  six active Projects. The view has to show every route in flight, because the
  decision being made is usually *which route to spend the morning on*, and that
  comparison is impossible when each is reported separately.
- **Scope is a parameter.** The same shape should answer "route to this
  Milestone," "route to this Project's Outcome," and "route across the
  portfolio." The operator stated this as a standing want, not a one-off:
  *"I always will want to be able to see the path from here to some completion
  state, at some scope level."*

And it should reach Discord — on request, and on change. A route that has to be
opened to be read is a route nobody checks between sessions.

## How this relates to the Flight Plan spec

[`docs/flight-plan-report-spec.md`](../flight-plan-report-spec.md) already exists
and is the right neighbour, not a competitor. It opens by naming exactly this
vocabulary — *"a flight plan states the route, the waypoints, the ETA, and the
fuel aboard"* — and then specifies **the ETA and the fuel**: committed hours,
token exposure, and the four plan-status buckets.

**The route and the waypoints are the half it names but does not specify.** This
proposal asks for that half, in the same command family and the same language,
rather than a second concept competing for the Flight Deck metaphor. If they
land together, `flight-plan` answers "can I afford the committed work this week"
and the route view answers "what is between me and done" — the same chart read
two ways.

The dependency closure it needs is already computed elsewhere: `arcadia next
--ready` resolves the ready set through the dependency-aware queue, and
`advance queue` maintains a dependency-safe order. This is a new projection over
existing graph data, not new graph machinery.

## What we would build locally

Nothing, per Decision 0025 — which is why this is a proposal rather than a
script.

The stopgap is a hand-maintained artifact, republished when the route moves:
<https://claude.ai/code/artifact/6bc97545-2abc-4f83-a158-d695cec931d1>. It
carries a copy-for-Discord block sized under the 2000-character limit, because
that delivery is the part most likely to be used daily and least likely to
survive as a manual step.

Its costs are the argument for building it properly:

- every count is transcribed by hand from `arcadia portfolio` and a plan
  document, so it is stale the moment either moves and silently wrong rather
  than visibly absent;
- the dependency closure is recomputed by a human each time, which is precisely
  the work that found today's defect and precisely the work that will not happen
  on a tired morning;
- the Discord digest is copied by hand, so "on change" is aspirational.

A deterministic command reading the graph Arcadia already maintains would make
all three free, and would make the route view trustworthy enough to act on
without re-deriving it first.

## What would make this answerable

The judgment the operator needs to settle, not the agent:

1. Does the route view ship as a mode of the specified `flight-plan` command, or
   as a sibling noun (`arcadia route` / `arcadia paths`)?
2. Is Discord delivery part of this capability, or does it reuse whatever
   notification surface `operator-attention-routing` settles on?
3. Which scope levels are worth supporting at v1 — Milestone only would cover
   today's need and is the smaller build.
