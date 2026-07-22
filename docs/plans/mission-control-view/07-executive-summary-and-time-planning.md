# Arcadia — Executive Summary & the Time-Planning Gap

*Status assessment as of 2026-07-21, after the Mission Control build. Written
to answer one question: what will make Arcadia genuinely indispensable for
planning a day and a week — delivering for a client while chipping away at a
perpetual household/family list with very little time.*

---

## Where Arcadia stands today

Arcadia now does one thing well that nothing else in the operator's life
did: it **holds the whole picture in one place and keeps it honest.**

- **The Context Ledger (Life tower)** holds ~10 real orientation facts —
  taxes, register the kids for baseball, fix the garbage disposal,
  MacKaylee's birthday party, the private-practice website — each with a
  priority, a horizon, and (where it has one) a due date. It is deliberately
  *not* a task manager; it is a small, curated answer to "what's true right
  now that I shouldn't drop."
- **Staleness is first-class.** An unconfirmed entry visibly ages and
  degrades into a confirmation question rather than silently asserting a
  stale fact. Neglect is made legible instead of hidden — which is the exact
  failure mode this whole system exists to prevent.
- **The Morning Packet** arrives in Discord daily, deterministically
  composed (no model in the loop), and is **correctable by plain-English
  reply** — "the plumber's coming Thursday," "taxes are filed," "add the
  party date." The same correction loop now works for Projects too.
- **Mission Control** is the default view: a cross-cutting *Needs You Now*
  strip over three towers — Life, Projects, Decisions — each zoomable to its
  status, its urgent items, and a place to add context or ask a question.
  A continuous urgency score (not a coarse label) ranks everything, and the
  new sidebar surfaces Urgent and Recent from anywhere.

**What this already delivers:** orientation. At any moment, the operator can
see what matters most, across every part of life, without holding it in their
head — and can correct it in one sentence from their phone. That is real, and
it is the hard half.

**What it does not yet deliver:** a *plan*. Arcadia can tell you what matters.
It cannot yet tell you what actually *fits* in the time you have. That is the
gap between "clever, trustworthy dashboard" and "indispensable daily driver."

---

## A typical day, today vs. what it should be

**The operator's real constraint** isn't a shortage of clarity about what
matters — Arcadia already provides that. It's a shortage of *time*, split
across two irreconcilable demands:

1. **Deliver for the client** — the private-practice website, the Rebuster
   work. This needs protected, uninterrupted blocks. It is the thing that
   pays and the thing most easily eroded by everything else.
2. **Chip away at the household/family list** — baseball signup, the
   disposal, the car mirror, the bathroom door, cleaning, the birthday
   party. Each is individually small; collectively they are relentless, and
   they compete for exactly the fragments of attention that client work
   also needs.

**How the day goes today:** the 6:00 AM packet lands. It's accurate — it
correctly says the Rebuster demo is critical and the taxes and baseball
signup need attention. The operator reads it, feels the weight of it, and
then… still has to do the hard part in their own head: *given that I have a
3-hour client block this morning and maybe two 15-minute gaps this
afternoon, what do I actually do?* Arcadia surfaced the list. It didn't help
build the day.

**How the day should go:** the packet (and Mission Control) proposes a
*realistic slate*. It knows the disposal fix is a 2-hour job that will not
happen between meetings, but the baseball signup is a 10-minute phone task
that fits a gap perfectly. It protects the client block and fills the
fragments around it with things that genuinely fit them. When a 20-minute
hole opens up unexpectedly, the operator asks "what fits?" and gets three
real answers, not the whole anxiety-inducing list.

The difference between those two days is a single missing dimension:
**time.**

---

## The missing element: estimated effort/time

Nothing Arcadia tracks today carries any notion of how long it takes.
Confirmed against the live schema: neither `orientation_entries` nor
`work_items` has an estimate, effort, or duration field. Every item is
weighted only by *importance and urgency* — never by *cost in time*. So
Arcadia can rank, but it cannot budget, and budgeting is the whole game when
time is the scarce resource.

### Why exact minutes is the wrong ask

Humans estimate specific durations badly, and a system that demands "enter
minutes" for every item will simply not get filled in. The realistic,
correction-loop-friendly unit is **coarse effort sizing** — a t-shirt size
the operator can give in passing, by voice or Discord reply, without
stopping to think:

| Size | Rough time | Fits |
|---|---|---|
| **Quick** | ≤ 15 min | a gap between meetings, a phone call, one email |
| **Short** | ≤ 1 hour | a focused errand, a small fix |
| **Session** | 1–3 hours | a real client block, the disposal repair |
| **Project** | multi-session | the website, party prep — needs breaking down |

This maps naturally onto the existing correction loop: *"register the kids
for baseball, quick"* or *"the disposal is a whole afternoon"* is already how
a person talks. The interpreter that already turns replies into ledger ops
would just learn one more optional field.

### What the effort dimension unlocks (in order of value)

1. **Fit-to-gap.** The single highest-leverage feature. "I have 20 minutes —
   what fits?" becomes a real, answerable query: filter to `quick`, rank by
   urgency, return the top three. This is what turns dead fragments of the
   day into progress on the household list without stealing from client work.
2. **A realistic daily slate.** The morning packet stops being a list of
   everything that matters and becomes a *plan*: protect the client
   `session`, slot the urgent `quick` items into the known gaps, and be
   honest that the `project`-sized things won't happen today so they don't
   generate false guilt.
3. **Capacity awareness.** If the operator tells Arcadia roughly how much
   time each day actually holds (e.g. "4 client hours, ~1 hour of fragments,
   evenings mostly gone"), the week becomes plannable: Arcadia can say
   "there's no room for the disposal until Saturday" *before* it becomes a
   crisis, which is exactly the anti-procrastination purpose extended into
   time.
4. **Honest deferral.** Knowing an item is `session`-sized *and* has no
   session available this week is a legitimate, load-bearing signal — it
   justifies pushing it, out loud, instead of it silently rotting on the
   list.

---

## What would make this truly useful for planning a day and week

A concrete, buildable path — in Arcadia's existing grain (deterministic
before AI, additive schema, correction-loop capture, no new engine):

1. **Add an optional `effort` field** (the four-value enum above) to
   orientation entries — additive migration, exactly like the ledger tables
   themselves. Capturable through the correction loop and editable in the
   node detail view. Optional, so nothing breaks and un-sized items simply
   don't appear in fit-to-gap results yet.
2. **Add a "what fits?" affordance** to Mission Control and the Discord
   packet: given a number of available minutes, return the urgent items
   whose effort fits. Purely deterministic — a filter and a sort over data
   that already carries urgency.
3. **Introduce a lightweight daily capacity note** — one line the operator
   confirms or edits each morning ("today: one client session + ~1 hour of
   gaps"). Not a calendar integration, not scheduling — just enough for the
   packet to propose a slate that respects reality.
4. **Make the morning packet a plan, not a list**: protected client block
   first, then the urgent items that fit the day's real gaps, then an honest
   "not today, here's why" tail. Same deterministic composer, one new input.

None of this requires the eventual 3D graph, a scheduler engine, or any
cloud dependency. It is four additive steps on top of what already works,
and it is the difference between Arcadia *reflecting* the operator's life and
Arcadia *helping them spend the one resource they're actually short on.*

### The one-sentence version

Arcadia already answers "what matters?" — reliably, honestly, from one
place. Add a coarse sense of *how long things take* and *how much time today
holds*, and it starts answering the question the operator actually wakes up
with: **"what should I do right now, and what can wait?"** That is the line
between useful and indispensable.
