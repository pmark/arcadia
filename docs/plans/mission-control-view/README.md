# Mission Control View — Design Series

Replaces the `/momentum` "Today" screen (currently one project-action card)
with a default view that oversees the operator's whole world — Life,
Projects, Decisions — where any visible area can be zoomed into for its
status, its urgent action items, or a place to add context/ask a question.

**Design-only through doc 08.** The only things written across 00–08 are
view-model types
([mission-control-types.ts](../../../apps/dashboard/lib/mission-control-types.ts))
and a small pure-math reference module
([mission-control-math.ts](../../../apps/dashboard/lib/mission-control-math.ts))
— no renderer, no components, no pages, no wiring, per explicit instruction
that building begins only after the UI/UX is crystallized.

**That instruction is now satisfied for one slice.** Doc 09 is a build
specification with a filed, governed plan behind it. Doc 10 records an
adjacent question that was deliberately deferred against a named trigger.

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
| 09 | [Flight Deck Build Spec](./09-flight-deck-board-build-spec.md) | The buildable slice: Plan swimlanes, Arcadia's dispatch gates as columns, the labeled relationship chain, and one copyable dispatch command per card. **Governed by a filed plan — start here to build.** |
| 10 | [Session Unit Ledger (deferred)](./10-session-unit-ledger-deferred.md) | Weekly coding-agent budgeting: the Session Unit model, provider-neutral assignment, three gaps it surfaced, and the trigger that reactivates it. |

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

## Flight Deck operational expansion (2026-09-05)

The operator requires Flight Deck as the first operational destination, including
automatically selected coding-agent launch. Start with these supplemental records:

- [11 — Existing surfaces and reuse audit](./11-existing-surfaces-audit.md): source evidence, live inspection limits, reuse boundaries and gaps.
- [12 — Operations contract](./12-flight-deck-operations-contract.md): complete interaction, selection, launch, observation and truth requirements.
- [13 — Delivery sequence](./13-flight-deck-delivery-sequence.md): twenty bounded Actions, dependencies, recommended execution sizing and continuation protocol.
- [14 — Exact plan amendment Ask](./14-flight-deck-plan-amendment.yaml): four existing Action amendments and sixteen additions, pending operator settlement.
- [15 — Acceptance matrix](./15-flight-deck-acceptance-matrix.md): deterministic and real-week proof, operator procedure and cutover gate.

These are supporting design/proposal Artifacts. They do not independently change
the Project pointer, mark work complete, or settle the proposed amendments.

- [16 — Settlement handoff](./16-flight-deck-settlement-handoff.md): validated proposal, queue prerequisite, exact operator question and safe application sequence.

## Latest priority: managed production

[17 — Managed production](./17-managed-production-contract.md) is the latest
operator scope: prioritized Plans, Active/Inactive control, automatic capacity
admission, worker-supervised Sessions and automatic next-Action advancement.
The revised Ask contains 27 Actions, with a real two-Action production proof
before broad UI polish. The earlier manual-launch-only proposal is no longer
the intended feature for settlement; this expanded version awaits review.

## Latest sequence: bootstrap, then build Flight Deck with it

[18 — Bootstrap then dogfood](./18-bootstrap-then-dogfood.md) separates the two
Plans and protects the stable controller during its own repository's development.
[19 — Bootstrap Plan Ask](./19-managed-production-bootstrap-ask.yaml) proposes
14 Actions with no Flight Deck dependency; [14](./14-flight-deck-plan-amendment.yaml)
now proposes 17 Flight Deck Actions executed by that controller. This replaces
the pending combined Plan. Plan creation alone does not activate it.

- [20: Production quality and reliability](./20-production-quality-and-reliability.md) — output acceptance, recovery invariants and required release evidence.
