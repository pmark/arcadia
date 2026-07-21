# Mission Control View — Rendering Architecture Options

> Follows [00-view-models.md](./00-view-models.md), which fixed the *data*
> shape (`MissionControlNodeSummary`/`Detail` — one recursive contract for
> status/actions/context/children at every zoom level). This doc is about
> the *rendering* layer: how many UIs consume that data, and whether "one
> hyperversal generic view" and "several view modes to find the right fit"
> are actually in tension. **Thinking only — nothing built yet.**

## The real question underneath the request

"One generic view that adapts to any context" and "several view modes while
we find the fit" sound like they're pulling opposite directions, but they're
actually answers to two different questions:

- *How many rendering engines exist?* (one vs. several)
- *How many distinct visual/interactive experiences can a user reach?* (one
  vs. several)

You can have **one rendering engine that produces several distinct
experiences** (drive it with different configs), or **several rendering
engines that happen to look similar today** (independent components that
just haven't diverged yet). Those are different bets with different payoffs,
and the two options below make that choice explicitly instead of leaving it
implicit.

Both options below consume the *same* `MissionControlNodeDetail` from
[00-view-models.md](./00-view-models.md) unchanged — that data contract
already isn't the thing in question; only what renders it is.

---

## Option A — Schema-driven generic renderer (genericity in the render layer)

The view model layer doesn't just return `MissionControlNodeDetail` — a
thin adapter turns it into a **declarative block tree**: a small, fixed
vocabulary of typed blocks (`StatusBlock`, `ActionListBlock`,
`ContextInputBlock`, `ChildListBlock`, maybe later `TimelineBlock`,
`MetricBlock`). Exactly **one** React component walks that tree and renders
whatever block types it finds, each block type mapped to one small primitive
component (a "block registry," the same pattern Notion/Slack Block
Kit/Contentful use for exactly this reason — server-driven, evolvable UI).

```ts
type MissionControlBlock =
  | { type: "status"; headline: string; detail?: string }
  | { type: "actionList"; items: MissionControlActionItem[]; layout: "list" | "cards" }
  | { type: "contextInput"; placeholder: string; routesTo: MissionControlContextChannel["routesTo"] }
  | { type: "childList"; items: MissionControlNodeSummary[]; layout: "list" | "grid" | "timeline" };

// A "view mode" here is just: which layout string gets set per block,
// decided by node kind, a per-user preference, or an experiment flag —
// not a different component.
function renderNode(node: MissionControlNodeDetail, mode: ViewModeConfig): MissionControlBlock[]
```

**"View modes" under this option are data, not code** — swapping from a list
to a card grid to a timeline is a different `layout` value on the same
block, resolved by one `<BlockRenderer />`. That is the literal, purest form
of "one hyperversal view that adapts."

**Where this bites:** designing the *right* block vocabulary is itself a
hard design problem, and you're being asked to solve it *before* you've seen
enough real screens to know what you need. Get the vocabulary wrong early
and every new idea either gets awkwardly forced into an existing block type
or requires a schema migration. This is the classic server-driven-UI
trap: powerful once mature, expensive to get right on the first guess, and
you're explicitly still in "find the right fit" territory.

## Option B — Shared contract, plural independent view components (genericity in the data layer only)

The data contract (`MissionControlNodeDetail`) is the *only* thing that's
generic. On top of it, build several genuinely separate, ordinary React
components — a plain list view, a card-grid view, a timeline/feed view, maybe
a command-palette-style view — each one a normal component with its own
layout logic, not a config for a shared engine.

```tsx
// All three take the exact same data. Nothing shared but the contract.
<ListView node={detail} />
<CardGridView node={detail} />
<TimelineView node={detail} />

// A thin switcher (per-user preference, per-node-kind default, or a manual
// toggle) decides which one mounts. Swapping "view mode" = swapping which
// component gets rendered, not reconfiguring one.
```

**This is explicitly the "alternate view modes" answer** — cheap to build,
cheap to throw away, no up-front schema design, and each view is free to be
a genuinely different visual metaphor rather than a constrained
reconfiguration of shared blocks. Small shared sub-pieces (an
`<ActionItemRow>`, say) can still be reused between the view components to
cut duplication, without forcing the whole tree through one schema.

**Where this bites:** there is real duplicated "how do I show an action
item" logic across N components unless you deliberately share sub-pieces,
and nothing here *automatically* converges toward "one hyperversal view" —
that convergence is a deliberate later step (pick the winner, retire the
rest, optionally re-platform the winner onto something schema-driven once
you actually know what it needs to express).

---

## A pragmatic middle point worth naming

There's a hybrid that's smaller than both: **fix the overall page shape as
one generic shell — status, then action items, then context input, then
children, always in that order (this is already what
`MissionControlNodeDetail` implies) — and only let *slots within it* swap
renderers.** E.g. the action-item slot can render as a list or as cards; the
children slot can render as a list or a timeline; status and context input
stay fixed everywhere. One page structure everywhere (the "hyperversal"
part, satisfied at the navigation/shell level), swappable pieces inside it
(the "alternate view modes" part, but scoped small rather than "totally
different whole screens"). This is a smaller, lower-risk generalization
problem than Option A's full block vocabulary, because you're only trying to
generalize *one slot's* rendering strategies at a time instead of guessing
an entire schema up front.

---

## Recommended sequencing

Given the explicit framing — *ultimate desire is one hyperversal view,
practical need right now is several modes to find the fit* — build
**Option B first**. It's the cheapest way to actually learn what "the right
UX" looks like, and critically: **nothing from it is wasted if Option A gets
built later.** The data contract these all consume is already settled
([00-view-models.md](./00-view-models.md)); Option A is really "take
whichever view component wins in Option B, and generalize *its* layout logic
into a schema" — a much better-informed schema design problem than doing it
cold today.

The two options aren't actually rivals for the end state, either: a genuine
schema-driven renderer (Option A) can itself be built later as *one of the
pluggable view modes* competing inside Option B's switcher, alongside a
couple of hand-built ones. Whichever wins — including possibly the generic
one — becomes the default. That reframes "we'll figure out how to build
both" as: build B's switcher + two or three real view components now; treat
Option A as a strong later candidate to slot into that same switcher once a
winning layout pattern is clear, not a competing architecture to choose
between today.

## What "build both" concretely means next

1. The switcher/router itself (which view component mounts for a given node
   + how the choice is stored — per-user preference is enough for v1, no
   need for per-node overrides yet).
2. Two real view components to start the comparison — a plain list/detail
   view (closest to the existing `/momentum` card) and one genuinely
   different metaphor (card grid, or a chat/feed-style view that reads
   naturally alongside the correction-loop's conversational input). Building
   exactly two, not three, keeps the first comparison cheap and honest.
3. Defer Option A entirely until one of the two above earns being made the
   default — then decide whether generalizing it is worth doing at all.
