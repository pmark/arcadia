# Mission Control View — Concrete UI Specification

> Continues [05-list-view-parity.md](./05-list-view-parity.md). Where prior
> docs established principles (urgency math, camera constraints, the force
> model), this doc is the walkthrough: exactly what's visible, tappable, and
> doable at every screen state. It also makes the final call on every
> question the earlier docs left open — see "Resolved" at the end. Still
> design-only.

## Global chrome — visible at all times, regardless of altitude/lane/view

| Element | What it shows | What it does |
|---|---|---|
| **Needs You Now strip** | The single most urgent action item system-wide (title + urgency badge); a count if there's more than one | Tapping it jumps straight there — graph view glides the camera to it, list view scrolls to and opens it |
| **Location indicator** | Current lane + altitude, e.g. "Life · Ground" or "Overview" | Not interactive itself — orientation only, so you always know where you are without having to infer it from the scene |
| **View toggle** | Graph / List | Switches renderer; camera/focus state carries over exactly (05) |
| **Jump-to search** | A type-ahead field, collapsed to an icon until tapped | Type a few letters of any node's title anywhere in the system → matching results appear instantly; picking one jumps there the same way Needs-You-Now does. This is the concrete form of "hop around without visual navigation" |
| **Altitude control** | A small "▲ Overview" button, only shown at Ground level | Ascends to Overview. (Resolves the open question from 04 — a dedicated button, not a gesture, since it's used far less often than lane-switching and deserves to be unambiguous rather than discoverable-by-accident.) |

## Screen state 1 — Overview (all lanes surveyed)

**Information shown**: one marker per tower — Life, Projects, Decisions.
Each shows: tower name, a one-line aggregate status ("3 need attention"),
and a glow/size driven by its single most urgent contained item's score.
Nothing below tower level renders here — no areas, no individual entries.
This is deliberately the coarsest tier; if you need more, you descend.

**Affordances**: tap a tower marker.

**Operations**: exactly one — descend into that tower at Ground level (see
"Resolved" below for exactly where you land). Overview is pure navigation;
there's nothing to act on at this altitude, on purpose — a tower marker
isn't itself something you can confirm/complete/approve.

## Screen state 2 — Ground level, ambient (walked into a lane, nothing opened yet)

**Information shown**: every live node in the current lane, positioned by
urgency-distance (03/04) — close, bright, legible ones are urgent; distant,
hazy, fog-desaturated ones are quiet. Within legibility radius, a node shows
its title; beyond it, just a glowing point, no text (04's "no unnecessary
detail" rule). Color/hue encodes a secondary attribute — for the Life lane,
`area` (family/home/work/art/life each a distinct hue); for Projects, nothing
extra needed (project name doubles as its own identity); for Decisions,
nothing extra (they're already flat and homogeneous). A node's glow also
dims as it goes stale, reinforcing the same signal its outward drift is
already showing (03) — two cues for one fact, not two facts.

**Affordances**:
- Tap empty ground → walk there (glide, capped duration, per 04).
- Tap a node → open it (screen state 3).
- Long-press / hover a node → a lightweight peek (title + urgency only, no
  action buttons) without committing to opening it.
- Swipe or edge-tap left/right → switch lanes, same altitude.
- "▲ Overview" button → ascend.

**Operations**: still no direct mutation here — peeking and walking only.
Anything you can *do* to a node requires opening it, because actions
without their surrounding context (what exactly you're confirming, what the
due date is) are how mistakes happen.

## Screen state 3 — Node detail (opened)

Reached by tapping a node in the graph, arriving via search/Needs-You-Now,
or selecting a row in List view — identically, since it's one shared
component regardless of entry point (00, 05).

**Life-tower entry** (the richest case — the correction loop lives here):
- *Information*: title, area, priority, horizon, due date (if any), status,
  "confirmed 2 days ago" / "unconfirmed for 9 days — reply to confirm"
  framed exactly like the staleness language already used in the Discord
  packet, detail/notes field if present.
- *Operations*: **Confirm** ("still true"), **Complete**, **Reprioritize**
  (change priority inline), **Edit** (title/detail/due date/area),
  **Drop**. Every one of these already exists as a real CLI command
  (`orientation entry confirm/complete/update`) — this is a UI in front of
  operations that are already real, not new backend work.
- *Context channel*: a free-text box, same placeholder language as
  proposed for Discord ("tell Arcadia what's true, ask a question, or give
  an update"), routed through the same `orientation reply` interpreter. The
  response echoes back inline using the same three-state language as
  Discord's reactions — ✅ applied (with the echo text), ❓ needs
  clarification (with the question, nothing mutated), 🚫 rejected/unavailable
  (with the reason, nothing mutated) — so the UI and the Discord experience
  read as the same system, not two different ones.

**Decision node**:
- *Information*: decision-needed text, proposed action, confidence,
  linked artifact/packet if any — the existing `DashboardReviewItem` fields.
- *Operations*: **Approve**, **Reject**, **Defer**, **View** (opens the
  linked artifact/packet). Already real (`review approve/reject/defer`).
- *Context channel*: present, but honestly scoped today to "add a note,"
  not a full interpret-and-mutate loop — Decisions don't have an
  interpreter the way Life does yet (05's honest caveat carried forward).

**Project node**:
- *Information*: mission, current milestone, next action, and today's Daily
  Advantage line if this project is the one selected for it.
- *Operations*: **View Project** (drops into the existing project detail
  page — this UI doesn't need to reinvent that screen, just link to it).
- *Context channel*: routes to the existing `ask` command — same caveat as
  Decisions, a genuine free-text entry point, not yet a full local
  interpreter loop.

**Tower-level node** (opened without descending — e.g. tapping a tower's
own detail rather than one of its children): status headline aggregating
its contents, a preview list of its children, and a context channel scoped
to *adding* something new to that tower (the one operation that's naturally
tower-scoped rather than entry-scoped).

**Closing**: tap anywhere outside the panel, or an explicit close control —
returns to wherever you were (screen state 2, or the list).

## Screen state 4 — List view

**Information shown**: "Needs You Now" as a flat section at the very top,
cross-tower, sorted by urgency descending — then one collapsible section per
tower (Life / Projects / Decisions), each listing its children as rows
(title, urgency badge, one-line status). (Resolves 05's open grouping
question — flat-first, sections below, in that order, collapsible so the
list doesn't get long even as towers grow.)

**Affordances**: tap a row → opens screen state 3, identically to the graph
entry point. Collapse/expand a tower section. View toggle back to Graph.

**Operations**: identical to whatever node kind is opened — the list
doesn't have its own separate action vocabulary, it's a different way to
arrive at the same detail screen.

## Resolved — final calls on what earlier docs left open

- **Cold-open default (app launch)**: Overview, not Ground — survey first,
  descend deliberately. Exception: if something Needs-You-Now-worthy exists
  at launch, the Needs-You-Now strip is populated immediately regardless of
  altitude, so urgency is never hidden behind a navigation step even though
  the *scene* still opens at Overview.
- **Where you land descending into a lane**: per 04's rule — the remembered
  position, unless something more urgent than what was near it has appeared
  since.
- **Altitude control**: an explicit small button, not a gesture (above).
- **Peripheral lane visibility**: no. Ground level shows only the current
  lane. Adjacent lanes are not glimpsed at the edges of the viewport — an
  explicit swipe is the only way to become aware of another lane's contents,
  keeping "no unnecessary detail" strict rather than leaking a little of it
  ambiently.
- **List grouping**: Needs-You-Now flat at top, then per-tower sections
  (above).
- **Default view mode on first launch**: List. It's the safer, faster,
  zero-risk entry point (01); Graph is one tap away via the view toggle at
  all times, and the choice is remembered per device after that.

## Deliberately still open (not needed to build the first version)

- Exact glow/color parameters (hex values, bloom intensity) — an art
  direction pass, not a UX-specification concern.
- Jump-to search ranking when multiple nodes match (recency? exact prefix
  first? doesn't matter until there's enough real data to notice it mattering).
- Sort/filter controls within List beyond the fixed urgency ordering —
  nothing today asks for this; add if it turns out to be missing once real
  use starts.
