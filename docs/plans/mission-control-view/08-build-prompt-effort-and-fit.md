# Build Prompt — Effort Sizing & Fit-to-Gap ("plan my day")

*An implementation brief for the next build session. Assumes repo access.
Read [07-executive-summary-and-time-planning.md](./07-executive-summary-and-time-planning.md)
first — this is the buildable form of the gap it identifies. The second half
of this document ("Level of detail") is deliberate guidance about how
prescriptive to be, and why.*

---

## Why this is the right thing to build next

Arcadia has solved **orientation** — it reliably answers "what matters?"
across Life, Projects, and Decisions, and lets the operator correct it in one
plain-English sentence. It has **not** solved **planning** — it cannot yet
say what fits in the time actually available. Every tracked item is weighted
by importance and urgency but carries no notion of *time cost*. (Verified:
neither `orientation_entries` nor `work_items` has an effort/estimate/duration
column.)

This is the right next build for three reasons:

1. **It sits directly on top of what already works.** The orientation ledger,
   the correction loop, the deterministic packet composer, the urgency score,
   and Mission Control all exist and are trusted. This adds one dimension to
   data that's already flowing — it is not a new subsystem.
2. **It is the smallest change that flips the system's category.** With a
   coarse sense of effort plus a coarse sense of available time, Arcadia stops
   *reflecting* the operator's life and starts *helping spend the resource
   they're short on.* Nothing else on the roadmap has that leverage-to-cost
   ratio.
3. **It needs nothing risky.** No scheduler engine, no calendar integration,
   no cloud dependency, no dependence on the eventual 3D view. It is additive
   and deterministic end to end.

## How it actually helps effect the change the operator needs

The operator's real bind is not confusion about priorities — Arcadia already
fixes that — it is **too little time, split between two demands that erode
each other**: protected blocks to deliver for the client (the private-practice
website, Rebuster), and a relentless household/family list (the disposal, the
baseball signup, the car mirror, the bathroom door, cleaning, MacKaylee's
party) that competes for exactly the fragments client work also needs.

This feature intervenes at the four moments where that bind actually plays out:

- **The dead 20-minute gap.** Today it's lost to scrolling or to the anxiety
  of a list too big to start. With effort sizing, the operator asks "what
  fits?" and gets the two or three *urgent, genuinely-15-minutes* things — the
  baseball signup, one phone call — turning fragments into progress on the
  household list **without touching the client block.**
- **The morning.** The packet stops being a weight ("here is everything") and
  becomes a plan ("protect your client session, here are the small urgent
  things that fit today's gaps, and here's what honestly won't happen — so
  stop carrying it").
- **The week.** Knowing the disposal is a `session` and there's no session
  free until Saturday lets Arcadia say so *before* it becomes a crisis — the
  anti-procrastination purpose, extended from "is this still true?" to "when
  does this realistically fit?"
- **The guilt.** An item that is honestly too big for any slot this week
  should be *deferred out loud, with a reason* — not left to rot silently and
  generate background dread. Effort + capacity makes that deferral legitimate
  and visible.

If it works, the operator wakes up and Arcadia answers the question they
actually have — **"what should I do right now, and what can wait?"** — instead
of just the one it answers today ("what matters?").

## What to build

### Step 1 — Effort as a first-class, optional dimension

Give ledger entries (and, where it's cheap, work items/actions) an optional
coarse **effort** size. Not exact minutes — humans estimate those badly and
won't fill them in. A four-value t-shirt scale the operator can say in
passing:

| Value | Rough time | Example from the operator's real list |
|---|---|---|
| `quick` | ≤ 15 min | register the kids for baseball; one phone call |
| `short` | ≤ 1 hour | a focused errand; a small fix |
| `session` | 1–3 hours | the disposal repair; a client work block |
| `project` | multi-session | the website; party prep (needs breaking down) |

- **Capture must flow through the existing correction loop.** "register the
  kids for baseball, quick" or "the disposal's a whole afternoon" already
  reads as effort to a human; the orientation (and project) reply interpreters
  should learn this one optional field. It must also be settable/editable in
  the Mission Control node detail view.
- **Optional and additive.** Un-sized items keep working exactly as today and
  simply don't appear in fit-to-gap results until sized.

### Step 2 — "What fits?" (the highest-leverage piece)

Given a number of available minutes, return the urgent items whose effort fits
that window, ranked by the existing urgency score. Deterministic — a filter
and a sort over data that already carries urgency. Surface it in both Mission
Control and the Discord packet flow.

### Step 3 — A one-line daily capacity note

Let the operator state, and easily amend, roughly how much time today holds
("one client session + ~1 hour of fragments; evening gone"). Not a calendar,
not scheduling — just enough for the packet to propose a slate that respects
reality. Capturable the same conversational way as everything else.

### Step 4 — Make the morning packet a plan, not a list

Recompose the deterministic packet as: protected client/`session` work first,
then the urgent items that fit the day's real gaps, then an honest "not today,
here's why" tail. Same composer, one new input (capacity), one new field
(effort).

**Sequencing:** Step 1 is the foundation and is independently valuable (even
just seeing effort on items helps). Step 2 is the first thing that feels
magic. Ship 1 then 2; 3 and 4 build on both.

## Constraints and guardrails (do not violate)

- **Deterministic before AI.** Only *capturing* effort from free text uses the
  model (via the existing interpreters). Fit-to-gap, the slate, and the packet
  are pure deterministic logic over stored data. No model call to decide what
  fits.
- **Additive, compatibility-preserving.** New column via the established
  `ensure*` migration pattern in `src/db/schema.ts` (read
  `ensureOrientationTables` and its neighbors — do not edit only
  `database/schema.sql`). Everything optional; nothing existing breaks.
- **Stay in the grain.** Reuse the correction-loop interpreters, the urgency
  score (`src/orientation/urgency.ts`), the deterministic composer, the CLI
  JSON envelope, and the Mission Control assembler. No new engine, no
  scheduler, no cloud, no new top-level subsystem.
- **Not a task manager.** The ledger stays ~10 orientation facts; this adds a
  dimension to them, it does not turn them into a backlog tool.

## Acceptance criteria (behavioral, testable)

1. An operator can set effort on an entry by replying in natural language, and
   by editing it in the UI; un-sized entries are unaffected.
2. Given "I have N minutes," Arcadia returns only items whose effort fits N,
   urgency-ranked, deterministically (unit-testable with no model).
3. With a capacity note set, the morning packet visibly separates protected
   work, fits-today, and honest-deferral — and never proposes a `session`
   into a day with no session.
4. All of it degrades cleanly when effort/capacity are absent (falls back to
   today's importance/urgency-only behavior).
5. Verified against the real workspace with the operator's actual items, not
   only fixtures.

---

## Level of detail this prompt provides — and why

This brief is intentionally **precise about intent and contract, and quiet
about mechanics.** That is the optimal calibration for this particular job,
and the reasoning matters as much as the calibration:

**Specify tightly (as above):** the *why*, the human stakes, the effort
vocabulary and its semantics, the behavioral contract of each step, the
guardrails, and testable acceptance criteria. These are genuine decisions —
t-shirt sizing over minutes, deterministic fit-to-gap, capture-through-the-loop,
packet-as-plan — that were reasoned through against the operator's real life
and the system's grain. Leaving them vague would invite an implementer to
re-derive (and likely drift from) choices already made well.

**Deliberately do NOT specify:** the exact DDL, column name, migration code,
function signatures, file layout, or component structure. Not because they
don't matter, but because **the codebase is the source of truth for them and
is already internally consistent.** A competent implementer reading
`ensureOrientationTables`, the orientation interpreter, the urgency module,
and the Mission Control assembler will produce mechanics that match the repo
better than any DDL I could dictate from outside — and my dictation would risk
being subtly stale the moment the code moves. Prescribing the *how* here would
be writing the code in prose: slower, more brittle, and lower quality than
letting the patterns already in the repo speak.

**The test of whether this brief is at the right altitude:** an implementer
should never have to *guess what the operator wants* (that's fully specified),
but should always have to *read the code to decide how to build it* (that's
deliberately theirs). If they find themselves inventing product behavior,
this prompt was too thin. If they find themselves fighting a mechanical
instruction that conflicts with the actual code, it was too thick. Aim for
exactly that line — and when in doubt on a genuine product question not
covered here (e.g. whether `project`-sized items should force a
break-it-down prompt), surface it rather than guess.
