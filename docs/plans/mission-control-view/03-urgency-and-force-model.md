# Mission Control View — Urgency Math & Force Model

> Captures the spatial-urgency design worked out after
> [02-graph-and-3d-vision.md](./02-graph-and-3d-vision.md). Still
> design-only: this doc and its companion pure-math module
> ([mission-control-math.ts](../../../apps/dashboard/lib/mission-control-math.ts))
> are the only things "built" — no renderer, no components, no simulation
> wiring, per the explicit instruction to crystallize UI/UX before building.

## Why distance-as-urgency needs a continuous score, not the 3-level enum

`UrgencySignal.level` (`critical`/`attention`/`quiet`) is a good badge/sort
key but a bad distance input — three levels would produce three flat
concentric shells, not a gradient. Spatial placement needs a continuous
`urgencyScore ∈ [0, 1]`, computed per node, with the enum staying purely a
coarse label derived from it.

## The distance function is geometric, not linear — for a real reason

Human perception of intensity follows the **Weber-Fechner law**: equal
*ratios* of stimulus register as equal *increments* of perceived intensity,
not equal absolute differences. So the correct mapping from urgency to
distance is a geometric interpolation, not linear:

```
distance(u) = dNear · (dFar / dNear) ^ (1 − u)
```

At `u = 1` (maximally urgent): `distance = dNear`. At `u = 0`: `distance =
dFar`, out at the horizon. Equal steps in `u` produce equal *percentage*
changes in distance — the gap between "urgent" and "very urgent" compresses
near the viewer, and "someday" vs. "never" compresses out near the horizon,
which is also exactly how a perspective vanishing point already forecones
distance visually. The math and the visual language reinforce each other
instead of competing. This is implemented as `urgencyToDistance()` in the
math module.

## Computing the continuous score from real data (per domain, not generic)

`urgencyScore` itself is domain-specific — how a Life-ledger entry earns a
score is different from how a Decision might — so it does **not** live in
the generic math module. For the Life tower specifically, reusing fields and
helpers that already exist (`src/orientation/types.ts`, `staleness.ts`)
rather than inventing a parallel system:

```
u = clamp(basePriority(priority) + deadlineBonus(entry), 0, 1)

basePriority: critical=0.75, high=0.55, normal=0.35, low=0.15
deadlineBonus: for time_bound entries, grows 0 → 0.25 smoothly as
  daysUntilDue() shrinks inside that priority's existing
  APPROACHING_LEAD_DAYS window (staleness.ts) — the same "approaching" math
  the packet composer already uses, now also pulling the node physically
  closer, not just into a Discord message section.
```

Note staleness is *not* subtracted from `u` here (an earlier version of this
idea did that) — see below for why it moved into the force model instead.

## The force-directed model (corrected framing)

Force-directed layout was initially discussed as if it were in tension with
"mathematically precise" — that was wrong. A force-directed layout **is**
math: a physical simulation solved to equilibrium (spring forces along
edges — Hooke's law; repulsion between all nodes — Coulomb-like; integrated
over time). It's a richer mathematical object than a placement formula, not
a less rigorous one. The synthesis:

- **Link/spring forces** along the `relations` edges added in
  [02](./02-graph-and-3d-vision.md) (`blocks`/`relates_to`/`same_area`/
  `depends_on`) — related things cluster together. This is the
  graph-friendly-semantics half of the destination vision, honored directly.
- **Repulsion / collision** — standard, keeps the scene readable, no overlap.
- **A radial force per node** — target radius = `urgencyToDistance(u)` from
  above. This is `forceRadial(radius, cx, cy)` in `d3-force` (2D) /
  `d3-force-3d` (the direct 3D port — same API family), where `radius` is a
  function of the node rather than a constant. The physics, not a manual
  placement rule, decides where things actually land: urgent-and-related
  things cluster close and tight; urgent-but-unrelated things end up close
  in a different direction; nothing is rigidly assigned.

**Staleness lives here, not in the distance formula**: it decays the
*strength* of a node's radial anchor force over time, not its target
position. A fresh urgent item is held firmly at its close radius. An
unconfirmed one loses its grip on that position and drifts outward under
ambient repulsion from everything else — not because its urgency changed,
but because nothing is holding it in place anymore. That reads as "this is
slipping away" without a separate visual channel (flicker, desaturation) —
it's the same force system quietly telling you something, which is why it
superseded the earlier "subtract a staleness term from u" idea: this is one
mechanism instead of two, and it's a better metaphor for neglect than a
number.

## Known, real libraries this maps onto (not hypothetical)

`3d-force-graph` (Three.js + `d3-force-3d`, open source, already supports
custom per-node forces and post-processing bloom) is the concrete target for
the eventual 3D version — see
[04-camera-and-navigation.md](./04-camera-and-navigation.md) for why this
means no rewrite is needed between the flat prototype and the final scene.

## Open, not yet decided

- Exact `dNear`/`dFar` values (world-unit scale) — depends on the camera/FOV
  decisions in 04, not decidable from the math alone.
- Real edge-type weights beyond "an edge exists" (should `blocks` pull
  harder than `same_area`?) — deferred until there's enough real
  `relations` data to tune against.
