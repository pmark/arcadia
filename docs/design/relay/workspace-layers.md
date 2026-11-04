# Relay: the three Workspace layers

Status: design for the operator's approval, 2026-11-03. It authorizes nothing and starts no build. Unattended
production stays first, and production stays Off. Built through [Arcadia Design](../../../.agents/skills/arcadia-design/SKILL.md)
as part of [the Relay brief](brief.md). Recorded as source S025.

**Try it:** [`prototypes/relay-workspace-layers.html`](../prototypes/relay-workspace-layers.html) is a throwaway
sketch using the real sky and weather drawing code and sample data. It calls nothing in Arcadia.

**What this advice rests on.** Arcadia has no reviewed field guide for interaction design, so this is disclosed
exploratory advice, not conformance to a guide. The rules below come from the operator's words (S022, S023), Arcadia's
earlier Workspace designs (S026 to S028), the code, and one probe. The look and feel are taste, marked where it matters.
Confidence is moderate: the structure is checked against code and pixels, but nobody has used it on a real phone yet.

## The operator's direction

> "the UI to be layered such that the Relay interaction appears as an overlay, always available from any context. The
> underlying view defines context, while the overlay offers natural language input and dynamic, free-flowing
> experiences. The scene's background conveys system status information." (S023)

> "It's not strictly a chatbot interface, but it has conversational elements. It's definitely not a dashboard, but
> appropriate views and controls are cued and fluidly presented as needed to serve and adapt to dynamic contextual
> shifts." (S022)

## The design

Three planes at three depths. Each answers one question and costs a different amount of attention.

| Layer | Depth | The question it answers | Attention | Can take input? |
|---|---|---|---|---|
| **Scene** | Far | How is everything? | A glance | Only its status pill |
| **View** | Middle | What are we talking about? | A look | Yes, by navigating and using its own controls |
| **Relay** | Near | What do you want? | A sentence | Yes, by words and taps, from anywhere |

**Who may move what** is the heart of it. Getting this wrong is how a fluid interface turns into one that grabs at you.

| What happened | Scene | View | Relay |
|---|---|---|---|
| Something changed in the system | Weather and pill change, over about two seconds | Stays put. Records may refresh in place | Stays exactly as it is. No message, no opening |
| You navigate | No change | Moves | Stays. Its target follows the View, unless a draft is pinned |
| You start typing, then navigate | No change | Moves | The draft keeps its original target, says so, and offers "Use this view" |
| You send a message | No change | Stays, unless you asked to go somewhere | Answers |
| The answer points at a view | No change | Stays. The answer offers a cue you tap | Shows the cue |
| You asked to go somewhere ("take me to the Plan") | No change | Moves, with a Back control | Says where you are now |
| You open an Artifact | No change | It lifts onto the Stage, and "this" now means the Artifact | On a phone it drops to Resting so you can see it. It stays usable |
| Relay's open thread on a phone | Top strip still shows | Inert behind it | Modal until you put it down |

This keeps the rule Downlink already set: surprise in quality, never in control. Your own words count as control. A
system event never does.

**This narrows your words, so check it.** You asked for views and controls cued "to serve and adapt to dynamic contextual
shifts". Here, only your own moves count as shifts. A system event changes the sky and the reasons on the pill, and those
reasons link to the item that needs you, but nothing else appears until you look. I chose this for your attention budget. If
you want a system event to cue something, that's a change to this table.

### Scene: status you can feel, words you can check

The sol sky keeps the time of day and the weather carries status, as `lib/system-sky.ts` already defines. Five things
change.

1. **Every Workspace view shows it.** Today only `/workspace/feed` draws weather. It moves to the layout.
2. **A pill always says it in words,** at the top of every view, with production's state beside the reading. Tap it for the
   reasons, each linking to the item or control it's about, which the Feed already knows. Weather is never the only channel.
3. **The top strip stays open sky,** at every Relay height, so the Scene is never fully covered.
4. **It can't falsely say "clear".** A clear sky is a claim that needs a fresh read.
   - Before the first read: no weather, a hollow dot, and "Reading".
   - A read older than the limit: Signal loss.
   - A reading has to hold for two reads before the weather changes, so a brief flicker doesn't crossfade the sky. The words
     change with it, and that's the only time a screen reader hears them.
5. **Production gets its own line,** from `/api/production-console?part=core`, which already serves production state, a
   worker heartbeat with a freshness flag, and live Sessions, behind a short cache.
   - Off is your choice, so it draws no weather, and the pill reads "All clear · Production Off". All clear is never shown
     alone while production is Off.
   - Running with a stale heartbeat, stopped, or failed all count as Blocked. A hung run has to look like a problem.
6. **"Work moving" means something is running:** live Sessions or missions. Today any open pull request counts, so a stalled
   run can read as Work moving. An open PR becomes a reason on the pill.

The Scene never speaks, opens anything or takes focus. Discord pings keep their existing rules.

### View: one subject, and that subject is the context

The View shows one thing and leaves the sky visible around it. This is what keeps it from being a dashboard.

- **The URL stays the scope,** as `lib/workspace-scope.ts` has it, so Back, Forward and links keep working. The Journey and
  the Stage aren't addressable yet: they're component state, so they can't be cued or restored until they are.
- **"This" means what's on screen.** The View publishes its subject: kind, ids, whether it could be verified, and
  when it was read. Relay sends that with each message once the Ask route accepts it (build step 3). Until then the chip names
  only what's really sent, which is the Project.
- **Every answer says which scope it used,** taken from the server's response, so a mismatch is visible.
- **Scope is a hint, never authority.** It helps resolve what you meant, and it grants nothing.
- **The Direction panel dissolves.** Ask moves into Relay. Go's next move and its protected Continue stay in the View,
  with the subject they belong to. Neighbouring records sit behind a disclosure.

### Relay: one surface, three heights

| Height | What it is | How you get there | The View |
|---|---|---|---|
| **Resting** | A capsule at the thumb: a real text field, ready to type | Default | Fully usable |
| **Answer** | The latest exchange, or starter suggestions | Focus the field, or send a message | Visible above it. On a phone, tapping the View puts Relay down |
| **Thread** | The whole conversation | Pull up or tap the chevron | Phone: inert behind it. Wide screen: it makes room and stays usable |

- **Always available means always.** It works when the View is loading, failed or unknown, falling back to the whole
  portfolio and saying so. It works while an earlier send is uncertain: that exchange keeps its own Retry, and a new
  message gets a new request id.
- **The keyboard is part of the design.** On a phone the scope chip stays above the keyboard, so you can still see what
  "this" means when the View is covered.
- **Directions keep their gates.** "Send as a direction" writes a durable instruction, and there scope picks the target, so
  it isn't a hint. It stays an explicit choice that names the exact Plan or Action, and it's unavailable when that target can't
  be verified. Only ordinary, read-side Ask loses the availability gate.
- **Talking to a Session stays separate.** Downlink's Uplink has its own input aimed at a live Session. When it ships, its
  field must name that Session, and Relay drops to Resting while it's open, so there's never doubt about who you're talking to.
- **Tapping the View to put Relay down only puts it down.** That tap doesn't also press what's under it.
- **Keyboard and assistive use:** `/` focuses it, Escape steps down a height and returns focus, and the thread is a
  polite live region.
- **Relay never speaks first in this design.** It's quiet until you use it, which protects the attention budget.

### Cued views: a closed vocabulary

The "dynamic, free-flowing" part is built from typed blocks, so a phone, a laptop, a headset or Discord can each draw
it. **Every answer has plain text that reads complete without any block.** That's what Discord, voice and a screen
reader use.

```text
Answer  { askId, at, effect: read | prepare | write, scopeUsed, text, blocks[], cue? }
Blocks  facts { items, source, asOf } | records { refs } | menu { menuId, fingerprint, options }
        | confirm { ... } | artifact { id, kind, alt }
Cue     { view: scope | feed | journey | artifact | control, target, move: offer | go }
```

- **It ships in stages.** The first answers use text, `facts` and a cue to a `scope`, the Feed or a `control` page. Each other
  block arrives with the route that needs it. Cues to the Journey and the Stage wait until they have addresses.
- **Code declares `move: go`,** and only on a deterministic route that matched an explicit request to go somewhere. A
  model can never set it.
- **`control` targets come from a fixed table** of existing pages (`/todo`, `/review`, `/actions`, `/production`,
  `/now`, `/mission-control`). No answer can supply a URL.
- **Text is shown as text.** Answers, labels and alt text are never rendered as markup. Agent script stays out, and
  Downlink's Decision requirement for interactive instruments stands.
- **The history doesn't get rewritten.** An old answer keeps its time and its facts. Current state appears when you open
  the record.

### Across devices

| Device | Scene | View | Relay |
|---|---|---|---|
| **Phone** (designed first) | Full-bleed sky, open strip on top | One subject, scrolling | Capsule at the thumb, rising to a sheet |
| **Tablet, laptop** | Full-bleed sky in the margins | Subject plus neighbours | Floats at the side; the View makes room when open |
| **Several monitors** | One reading, a sky in each window | A different View per window | One thread on the server, in whichever window you're using, from build step 4 |
| **Headset** (horizon) | The far field or a skybox | Panels at arm's length and beyond | Near your hand, voice first |
| **AR glasses** (horizon) | No backdrop, so a soft edge light, and words when asked | One small panel, anchored in the world | Voice, with one line of text |

AR glasses are why the Scene is defined as a reading rather than a canvas: `readSky` already returns one with no
rendering in it. Nothing for headsets gets built now. The cheap things that keep them open are typed answers, the
server-side thread, scope as a value, and this closed vocabulary.

## When things go wrong

| Situation | What you see |
|---|---|
| Arcadia can't be reached, or services restart | Signal loss weather and words. Your draft stays. An unconfirmed send says "outcome unknown" and never resends by itself |
| The View failed to load | Relay still works and says "Using your whole portfolio; couldn't confirm this Action" |
| Double tap, or a stale menu | The menu id and fingerprint make a second tap do nothing and refuse an old menu |
| The sky is pale or stormy | Text sits on its own surface with a contrast floor. The transparency gives way, not the text |
| Reduced motion | Still weather, no lift or drawing animation. The pill's words are unchanged |
| A hostile message or document | It stays text. No block can run anything, and `prepare` only ever shows a card you confirm |
| A status change while you're mid-sentence | Weather changes. Nothing else moves |
| A production run hangs | Its heartbeat goes stale, and the Scene reads Blocked rather than Work moving |
| A direction aimed at a Plan or Action that's gone or can't be read | It can't be sent. Your draft stays, and it says why |
| Two windows open before the thread is on the server | They share one browser store and can overwrite each other's draft. That's today's behaviour, and step 4 fixes the thread |

## What's there today

| Piece | Fit | Evidence |
|---|---|---|
| Sol sky, weather, status reading | **Partial:** weather draws only on the Feed | `app/workspace/layout.tsx:14`, `components/workspace/feed/feed-view.tsx:132,146` |
| Status covers production and live missions | **Partial:** the source exists, but the sky doesn't read it. The Feed passes no missions, so any open PR counts as moving | `app/api/production-console/route.ts`, `lib/system-sky.ts:49-56,85`, `feed-view.tsx:132` |
| Never falsely clear | **Conflicts:** first load draws clear weather | `lib/system-sky.ts:88` |
| Scope from the URL | **Exists** | `lib/workspace-scope.ts` |
| Relay gets the whole scope | **Partial:** an ordinary Ask sends only the Project; Plan and Action go only with a direction | `components/workspace/workspace-ask.tsx:121`, `app/api/ask/route.ts` |
| Composer available everywhere | **Conflicts:** it's in one panel, off when the context can't be verified, and off while a send is uncertain. The Feed has none | `workspace-view.tsx:153`, `workspace-ask.tsx:170,185` |
| Provider survives navigation | **Exists** | `app/workspace/layout.tsx:17` |
| Receipt loop and idempotent request ids | **Exists,** and reused as is | `workspace-ask.tsx` |
| Thread on the server | **Missing:** browser storage, five items | `workspace-ask.tsx:15` |
| Stage stays beneath Relay | **Conflicts:** the Artifact viewer is a native modal, which would block the overlay | `workspace-artifact-viewer.tsx:13` |
| Typed answers and cues | **Missing** | `lib/types.ts:252`, [Mira's inventory](reviews/mira-ask-surfaces-and-workspace.md) |

## What this changes in earlier designs

- **[The conversational workspace spec](../arcadia-conversational-workspace.md):** "the foreground is a conversation" and
  "the background carries orientation" give way to S023. Orientation moves to the View, and the conversation is an
  overlay rather than the page. Its rules on using the sky verbatim, draft scope, history and the Ask response contract
  all stay.
- **[Downlink](../downlink.md):** the Stage stops being a modal, so you can talk about what you're looking at. Everything
  else stands, including "never automatic".
- **[Operator presence](../operator-presence.md):** the status sky stands and spreads to every view. Presence stays
  private and never changes the sky.

## Evidence

[Probe layers-1](probes/layers-1.md) rendered the prototype in every combination of 4 times of day, 2 palettes, 5
statuses and each Relay height, using the real drawing code.

- **Sampled text and controls hold.** The worst case was 8.59:1, against a floor of 4.5:1. It passes largely because text sits on
  surfaces that are 88 to 95% opaque, which is also why the sky shows mainly in the gaps.
- **The sky stays visible.** On a phone, 39% at rest with the reasons panel open, 11% with an answer up, 9% with the thread open,
  and 11% of what's visible above a simulated keyboard, where the scope chip and field both stay on screen. On a laptop, 76%, 65%
  and 52%. A first version with cards stacked like today's Workspace left 17% on a phone at rest, which is why the View shows one
  subject.
- **Weak pairs, all on the light palette:** Work moving against Needs you (colour distance 4.1 to 6), Needs you against Blocked
  (4.3 to 8.6), and All clear against Signal loss (5 to 7). Missing a Needs you is the costly mistake. The dot and words always
  differ, and I'd judge these by eye on a phone before changing any colours.
- **All clear and Work moving differ only by motion** (distance 1.2 to 1.8, about the limit of perception). With reduced motion only
  the words separate them. This is acceptable only because a hung run reads as Blocked rather than either of these.

**Not known:** how it feels on a real phone, whether weather reads as status at a glance, the real keyboard behaviour on
iOS Safari, frame rate and battery with three canvases on a phone, and the cost of status reads from every view.

## If approved: the build order

Each is its own PR, stays off the production worker's path, and uses capacity production could use, so production work goes
first whenever they compete. The Scene comes first because it also helps you watch production from a phone. That's taste, and
yours to swap.

1. **Scene everywhere.** Move weather and the pill to the layout, with one shared read, freshness, and the production line.
2. **Relay overlay.** Move the existing composer into the three-height overlay, with its receipt loop unchanged and no backend
   change. The chip names only the Project. Ordinary Ask loses its availability gates, and directions keep theirs.
3. **Visible, typed answers.** The proposal's first step, as typed answers in the overlay, so "Status shown." finally shows the
   status. The Ask route starts accepting the View's subject and returning the scope it used.
4. **Thread on the server.** A new record holding each typed answer as it was given, pointing to Ask's receipt. What Relay said
   is its own fact, so it has one home, and current state still comes from the records themselves.
5. **Words that move the View,** if you choose 1A below, with a golden case and a near-miss for each request, and a measured
   precision before it's turned on. Until then those requests answer with a cue.

Then the proposal's name matching, lookups, menu and scorecard follow in their existing order.

**Acceptance for steps 1 and 2:** Playwright at 390 px wide, at a keyboard-height 390 by 500, and at desktop width, covering:

- text and controls at 4.5:1 or better across every sky and status;
- a status change moving nothing but the Scene;
- first load, a stale read, a stale heartbeat and production Off, none of which may read as plain All clear;
- navigation keeping the draft's target;
- Relay usable with the View's read failing;
- a direction refused for an unverified or vanished target;
- keyboard use, reduced motion and blocked storage;
- status reads per minute and per open window, against a budget set in step 1;
- the existing Workspace tests still passing.

Then you try it on your phone. Playwright can't reproduce iOS Safari's keyboard, so that's the test that counts.

## Decisions for the operator

**1. May your words move the View?** The operator's call, because it sets how the whole thing feels.

- **A. Yes, when you ask to go somewhere (recommended).** Fluid and honest: "take me to the Plan" takes you there, with
  Back. Everything else is a cue you tap. It needs Ask to recognize those requests reliably, which is unmeasured, so it has its
  own build step and a precision bar. A wrong match would move your screen, though never change anything.
- **B. Only taps.** The most predictable, with no way to be moved by mistake. "Take me to the Plan" answers with a button,
  which is one more tap each time and feels less like what you described.
- **C. Relay moves it whenever an answer has a view.** The most fluid and the most "magic". The screen changes when you
  only asked a question, and it breaks Downlink's rule.

**2. How far does "always available" reach in the first build?** Decision answers, operator actions and production
controls stay on their own pages for now, by your freeze.

- **A. Workspace only (recommended).** Smaller, and it touches no production page. Tapping through to `/todo` leaves
  Relay behind until you come back, which is the moment you may most want to ask "what does this mean?". Revive B when
  you first answer a Decision that way and miss it, or when a control page moves into Workspace.
- **B. Also on those six control pages, with no sky.** Truly everywhere sooner, with no change to their controls. This
  overrides your freeze for those pages. It's more surface to test and it touches production pages while production is the
  priority.

**Approving this also confirms four new requirements,** REQ-015 to REQ-018 in the record. They're proposed until you do.

**Decided by me, yours to overrule:**

- A capsule, not a floating button, at rest (taste).
- Relay doesn't speak first.
- The view's Go controls stay in the View.
- Production Off draws no weather.
- No background blur until it's measured on a phone (taste, plus cost).

**Parked, each with what brings it back:**

- Relay speaking first: after the scorecard, if you ask for it.
- Filtering the thread by scope: when the thread gets long enough that you go looking.
- Voice input in Workspace, and files in the overlay: `/capture` keeps files until the overlay has them, and the overlay
  gets them when you want to retire `/capture`.
- Spatial rendering: when you pick a headset target.
- Interactive instruments: Downlink's Decision.
