# Mission Control View — The Graph/3D Destination

> Captures the ultimate target revealed after
> [01-rendering-approaches.md](./01-rendering-approaches.md): "a fairly
> abstract, gorgeous, mathematically precise Synthwave-inspired 3D plane
> system to connect any graph-friendly semantics." Still thinking-only — the
> user has explicitly deferred building until the UI/UX is crystallized.
> This doc exists so that deferral doesn't lose the destination.

## The insight that reframes Option A

A 3D graph/plane renderer — nodes positioned in space, edges as connecting
lines, camera movement standing in for "zoom" — cannot be hand-built per
node kind. It is *necessarily* driven by declarative data: a set of nodes,
a set of typed edges between them, and rules mapping semantic properties
(urgency, kind, tower) to visual encoding (color, glow, position, plane
depth). That is structurally exactly **Option A** from the previous doc — one
generic renderer driven by a schema — just with a 3D graph-layout engine
in place of a 2D block-layout engine, and a synthwave visual language in
place of plain component styling.

So the instinct toward "one hyperversal generic view" wasn't a stylistic
preference competing with practicality — it's a correct read of what a
spatial graph renderer *requires*. That validates the destination. It does
not change the sequencing risk: this is also, by a wide margin, the most
technically and aesthetically expensive piece of the whole system (3D scene
graph, camera/interaction model, shader work, real-time layout math,
probably WebGL/Three.js or similar). Building it before the underlying
information architecture is proven would mean spending the most expensive
effort on the least-validated assumptions. The recommendation to build cheap
2D view components first (Option B) stands — but which second view mode to
build changes, below.

## The data-model implication: trees aren't enough

`MissionControlNodeSummary`/`Detail` ([00-view-models.md](./00-view-models.md))
is currently a strict tree — each node has exactly one parent, discovered by
fetching `children` one level at a time. A synthwave graph view needs actual
**graph** semantics: a node reachable from more than one place, and edges
that mean something other than containment.

This isn't hypothetical for you specifically. "Private practice website
work" is sitting in the Life ledger right now as a plain `active_concern`,
but if it ever becomes a real tracked Project (its own milestones, Decisions,
runs), it's still the *same underlying thing* the Life tower cares about —
a tree forces a choice of exactly one home; a graph lets one node be
referenced from both the Life area and the Projects tower without
duplicating it. Same idea for something like "Decision R17 blocks the
Rebuster milestone, which is also what today's Daily Advantage line is
about" — three towers, one real relationship, expressible as edges, not
expressible as parent/child.

**Proposed near-term change (data model only, still no rendering):** add an
optional, additive `relations` field to `MissionControlNodeSummary` —
typed edges to other node ids, independent of the containment tree:

```ts
export type MissionControlEdgeType =
  | "blocks"
  | "relates_to"
  | "same_area"
  | "depends_on";

export interface MissionControlEdge {
  targetId: string;
  type: MissionControlEdgeType;
  label?: string;
}

export interface MissionControlNodeSummary {
  // ...existing fields unchanged...
  relations?: MissionControlEdge[];
}
```

Containment (`children`) stays the primary navigation structure for the
near-term list/detail view — `relations` is inert extra data until something
actually reads it. Populating it costs nothing today (most nodes will have
zero edges for a long while) and means the eventual graph view isn't
starting from a data model that has to be retrofitted.

## Revised two-view-mode plan

[01-rendering-approaches.md](./01-rendering-approaches.md) proposed building
exactly two cheap, divergent view components to find the UX fit before
investing further. Given the destination, the second one should stop being
an arbitrary alternative (card grid, timeline) and become a **deliberate,
low-cost rehearsal of the graph interaction paradigm**:

1. **List/detail view** — closest to what exists today, cheapest, validates
   the data contract and the correction-loop reply interaction. The safe
   default.
2. **A flat 2D node-graph view** — nodes and edges rendered with an
   existing 2D graph library (e.g. React Flow, or a light d3-force layout),
   no z-depth, no shaders, no synthwave styling yet. Its entire purpose is
   to validate the *graph data shape and the spatial interaction model*
   (pan, zoom-to-node, select, see edges) cheaply, in a library that already
   exists, before any 3D engine work begins.

This turns "zoom into a node" from a metaphor into a literal, testable
mechanic early: in the 2D graph view, zooming toward a node *is* panning the
camera toward it — which is exactly what the 3D version does later, just
with a synthwave-lit plane instead of a flat canvas. If that mechanic
doesn't feel right at 2D, it won't feel right in 3D either, and you'll have
learned that before touching a single shader.

## Explicit non-goals right now

- No 3D engine, camera system, or shader/lighting work.
- No synthwave visual design (palette, grid-horizon aesthetic, glow) —
  that's skin on a proven structure, not a prerequisite for proving the
  structure.
- No commitment yet to which planes exist in the 3D version or how many —
  towers-as-planes is the obvious mapping (one plane per tower, nodes as
  points on it, cross-tower edges as trails between planes) but that's a
  layout decision for when 3D work actually starts, not now.

## Open questions to settle before crystallizing further

- Which edge types actually matter for your real data? `blocks` and
  `relates_to` are easy guesses; is there a real recurring relationship
  shape in your world worth naming now (e.g. "same client," "same
  deadline week") rather than later?
- Is cross-tower node sharing (one node, multiple homes) needed now, or is
  it fine for a while longer that "private practice website work" simply
  lives in Life until/unless it's promoted to a real Project?
- "Mathematically precise" — is there a specific geometric idea already in
  mind (force-directed layout, a fixed lattice/grid, golden-ratio spacing,
  literal parallel horizon planes like synthwave art), or is that itself
  still open?
