# Mission Control View — Camera, Layout, and Navigation

> Continues [03-urgency-and-force-model.md](./03-urgency-and-force-model.md).
> Design-only — no renderer or components built yet.

## Render depth for real, in Three.js, from the start — not faked in 2D

Depth was initially going to be simulated in a flat 2D renderer (size,
blur, opacity, manual z-sorting for occlusion). Rejected: `3d-force-graph`
already exists (Three.js + `d3-force-3d`), so real depth costs the same as
faked depth and is strictly better —

- **Real z** — the radial force's target distance (03) becomes a literal 3D
  distance from the camera, not a 2D radius. Same formula, same force model.
- **Real perspective foreshortening** — `PerspectiveCamera` makes near
  things bigger and far things smaller from projection math alone.
- **Real atmospheric fade** — `THREE.Fog`, no manual opacity logic; its
  color can later *be* the synthwave horizon glow rather than a separate
  effect to invent.
- **Real occlusion** — free via the z-buffer; a flat 2D layout would need
  manual re-sorting every time something moves.

**Prototype phase**: fixed/simple camera, `PerspectiveCamera`, fog on, plain
circles/lines, no shaders, no grid-plane geometry, no bloom. **Later**:
unlock camera controls, add grid-plane geometry and lighting, add bloom/glow
post-processing, art-direct the fog color into the actual synthwave palette.
Same scene graph throughout — the split is *which camera/materials are
turned on*, not *which renderer*. Nothing gets rewritten between prototype
and final.

## The camera: fixed height, fixed orientation, translate-only

Deliberately simplified to two degrees of freedom — x and y position only.
Height (z) and orientation never change; the camera always looks the same
direction ("downrange"). This is dramatically simpler than free orbit (no
gimbal concerns, no risk of the user spinning around and losing their
bearings) while keeping every depth cue above, since none of them depend on
the camera being able to rotate.

**Interaction**: tap the ground → ray-cast from the tap point through the
camera, intersect the ground plane, animate the camera's (x, y) to that
point — like a simplified Google Street View (walk toward where you tap, no
look-around). Tapping empty ground moves you there. Tapping a node opens it,
with the camera gliding toward that node as part of "opening" it — so
zooming into any area (the very first requirement of this whole feature) is
literally walking closer, not a panel snapping open over the scene.

## Layout is Cartesian, not polar — a direct consequence of the camera

An earlier version of this design used polar coordinates (angle = tower,
radius = urgency), which assumed the viewer could rotate to face different
towers. A camera that never rotates can't do that — an angle you can't turn
toward isn't doing anything for you. So towers become **lanes**: fixed bands
on the x-axis (Life / Projects / Decisions, or however many), with the
downrange axis carrying urgency exactly as in 03 — close is urgent, far
fades to fog at the horizon. `x = which world, y = how urgent.` Simpler math
than polar, and it matches the camera model exactly.

**Lane switching**: swipe or an edge control, staying at the same altitude —
a smooth lateral slide of the camera's x-position (not a hard cut), so
adjacent lanes read as one continuous space rather than separate screens
stitched together.

## Altitude is the same "zoom" the original data model already had

The Mission Control tree (root → tower → area → entry,
[00-view-models.md](./00-view-models.md)) was always hierarchical. Camera
altitude gives that hierarchy a literal spatial expression: **high altitude
renders a coarser level of the tree** (one aggregate marker per lane/tower,
sized or colored by its most urgent contents — an "overview" mode), **ground
level renders full leaf detail** within whichever lane you've descended
into. Two independent axes of "zoom" that were always conceptually separate
in the data model now stay separate spatially too: walking closer within a
lane (moving among siblings at the same tree level) vs. changing altitude
(moving between tree levels entirely).

**Transition**: tapping a lane's overview marker descends into that lane at
ground level; an explicit control (pinch, button, edge gesture — TBD)
ascends back to overview. Same eased, capped-duration motion as everything
else (below) — no separate transition style for altitude changes.

## "No unnecessary detail" mostly falls out of decisions already made

- **By altitude** — overview shows aggregate markers only, never individual
  leaf nodes; that's what "coarser tree level" already means.
- **By fog-distance, even at ground level** — a node's full label/detail
  only resolves within some legibility radius of the camera. Beyond that
  it's already small, hazy, and desaturated from fog — showing a fully
  legible label on something you can barely make out visually would
  contradict the depth cue instead of reinforcing it. This isn't a separate
  LOD system to build, it's just not rendering detail past the point fog
  already made it unreadable.

## Motion: quick, capped, one consistent language everywhere

"Never sluggish" means duration must not scale with distance — a short walk
and a long one should take about the same (short) time, at different
effective speeds. Concretely: eased motion (ease-in-out), duration capped at
roughly 200–350ms regardless of distance traveled, and — critically — the
*same* easing and cap used for tap-to-walk, lane-switch slides, and altitude
changes. Cohesion comes from one motion language applied everywhere, not
from any single number being fast enough on its own; three different
transition "feels" for three interactions would read as three separate
systems no matter how quick each one is.

**Exception**: if the 3D view isn't currently visible (navigating purely
through the list — see [05](./05-list-view-parity.md)) there's nothing to
animate for — that state update can be instant, and only needs to animate
the moment the graphical view becomes visible again.

## Re-entering a lane: remember position, with a concrete override rule

Default: restore the exact remembered (x, y) from the last visit to that
lane. For first-visit or "things changed while I was away," the rule is
checkable, not vague: **land at the remembered spot unless something more
urgent than whatever was near that spot has appeared since** — in that case,
land near the new thing instead. Compares the remembered position's local
urgency context against the most urgent item added since the last visit;
overrides only when that comparison actually warrants it.

## Open, not yet decided

- Exact altitude-ascend gesture (pinch vs. button vs. edge control).
- Whether adjacent lanes are ever partially visible at the edges of the
  viewport during ground-level walking (peripheral awareness of "something's
  over there") or the view is strictly single-lane until an explicit switch.
- World-unit scale for `dNear`/`dFar` and lane width/spacing — a rendering
  calibration question, not a design one; deferred to first implementation.
