# Mission Control View — Design Series

Replaces the `/momentum` "Today" screen (currently one project-action card)
with a default view that oversees the operator's whole world — Life,
Projects, Decisions — where any visible area can be zoomed into for its
status, its urgent action items, or a place to add context/ask a question.

**Design-only through this entire series.** The only things actually
written are view-model types
([mission-control-types.ts](../../../apps/dashboard/lib/mission-control-types.ts))
and a small pure-math reference module
([mission-control-math.ts](../../../apps/dashboard/lib/mission-control-math.ts))
— no renderer, no components, no pages, no wiring. Building begins only
after the UI/UX is crystallized, per explicit instruction.

## Documents, in order

| # | Doc | Covers |
|---|---|---|
| 00 | [View Models](./00-view-models.md) | The recursive node shape (status/actions/context/children at every zoom level); v1 towers grounded in real existing data. |
| 01 | [Rendering Approaches](./01-rendering-approaches.md) | Schema-driven generic renderer vs. plural independent view components; recommends building cheap divergent components first. |
| 02 | [Graph & 3D Vision](./02-graph-and-3d-vision.md) | The revealed destination — a Synthwave-inspired 3D graph/plane system. Why that's structurally a schema-driven renderer; adds non-hierarchical `relations` edges to the data model. |
| 03 | [Urgency & Force Model](./03-urgency-and-force-model.md) | Continuous urgency score, the Weber-Fechner-based distance function, and the force-directed model (relationship springs + repulsion + a per-node radial urgency force whose *strength* decays with staleness). |
| 04 | [Camera & Navigation](./04-camera-and-navigation.md) | Real depth via Three.js from the start; a fixed-height, non-rotating, translate-only camera; Cartesian lane layout; altitude as tree-depth (ground vs. overview); motion timing rules; remembered lane position. |
| 05 | [List/Graph Parity](./05-list-view-parity.md) | The list view is the same data, permanently in parity with the spatial view — not a temporary experiment, a shared ranking and a shared camera-state. |
| 06 | [Concrete UI Specification](./06-concrete-ui-specification.md) | The walkthrough: exactly what's visible, tappable, and doable at every screen state (Overview, Ground-ambient, Node detail per kind, List). Makes the final call on every question 00–05 left open. **Start here if you want to know what the finished thing actually looks like.** |

## The throughline, if you only read one paragraph

Every zoom level (root, tower, lane, single entry) is the same recursive
data shape. Urgency is a continuous score with one function mapping it to
distance, chosen because it matches how perceived intensity actually scales
perceptually. That same score drives a force-directed simulation (not a
static layout) so relationships cluster and urgency pulls things close as
emergent physics, not manual placement. The camera is deliberately
simple — no rotation, just position — which is what turns towers into
lanes instead of angles. Altitude re-expresses the same tree hierarchy
spatially instead of introducing a second concept. And the list view isn't
a fallback for any of this — it's the same data and the same camera state,
just rendered as rows instead of distance.
