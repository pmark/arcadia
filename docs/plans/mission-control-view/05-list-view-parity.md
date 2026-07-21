# Mission Control View — List/Graph Parity

> Continues [04-camera-and-navigation.md](./04-camera-and-navigation.md).
> Closes the loop back to [01-rendering-approaches.md](./01-rendering-approaches.md)'s
> Option B. Design-only.

## The list is not a fallback — it's the same data, permanently in parity

[01-rendering-approaches.md](./01-rendering-approaches.md) proposed building
a plain list/detail view as one of two cheap, divergent view components to
find the right fit. What's now settled is stronger than that: the list and
the spatial/graph view are **permanently equal, parallel ways to interact**
with the same underlying world — not a temporary experiment where one wins
and the other gets retired. The requirement was explicit: usable purely
visually, purely by list, or mixed, at will.

This costs nothing new in data modeling. The list is the same
`MissionControlOverview`/`NodeSummary` tree from
[00-view-models.md](./00-view-models.md), rendered conventionally instead of
spatially: `needsYouNow` at the top (cross-tower, most urgent first), then
each lane/tower as a section, drill into either exactly like the recursive
detail fetch already specified. No new types, no new backend shape — a
different renderer over data that already exists.

## One shared ranking, two encodings

Both views are driven by the same `urgencyScore`
([03](./03-urgency-and-force-model.md)): the list sorts by it top-to-bottom,
the graph encodes it as distance from the viewer. Same ranking, different
visual language — which is also why building the list first (cheap, no
rendering risk) is a real rehearsal of the ranking logic the graph view will
also depend on, not throwaway work.

## One shared piece of state: current focus

The two views share exactly one thing: **current position/focus** — which
lane, and where within it. Selecting an item in the list updates the same
camera-position state the graph view reads; switching to the graph
afterward puts you exactly where the list took you. Neither view owns this
state privately — it's a single source of truth both renderers subscribe
to, which is what makes "hop around in the list, then look at the pretty
version" work without separate "where was I" logic per view.

## Open, not yet decided

- Whether the list groups by lane/tower as sections (mirroring the spatial
  layout) or is presented as one flat list sorted purely by urgency across
  towers, with lane only shown as a tag/badge per row. `needsYouNow` at the
  top argues for the flat-first framing; per-lane sections still make sense
  below it. Likely both, in that order — not yet locked.
- Whether the list is the primary interface on small/mobile screens (where a
  3D scene is more awkward) while the graph is primary on desktop, or both
  are equally available everywhere and it's purely a user preference.
