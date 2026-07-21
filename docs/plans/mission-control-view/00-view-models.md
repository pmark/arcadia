# Mission Control View — View Models (v1)

Replaces the `/momentum` "Today" screen (currently one project-action card,
[apps/dashboard/app/momentum/page.tsx](../../../apps/dashboard/app/momentum/page.tsx))
with a default view that oversees the operator's whole world: Life, Projects,
and Decisions, each zoomable for status / urgent action items / a place to
add context or ask a question.

Types live at
[apps/dashboard/lib/mission-control-types.ts](../../../apps/dashboard/lib/mission-control-types.ts).
**View models only — no API routes, components, or pages built yet.**

## The one idea that makes this minimal

"Zoom into any visible area for its status, its urgent items, or to add
context" is the *same three affordances* whether you're looking at the whole
system, a tower, a life area, or one specific ledger entry. So there is one
recursive shape (`MissionControlNodeSummary` for the collapsed row,
`MissionControlNodeDetail` when zoomed in), not a bespoke screen per domain.
Zooming in is just: fetch this node's `MissionControlNodeDetail`, which
includes one level of children as `MissionControlNodeSummary[]` to zoom into
next. Arbitrarily deep, one generic screen.

## Proposed v1 towers (grounded in real, already-existing data)

| Tower | Backed by | Nothing new needed |
|---|---|---|
| **Life** | The Orientation Ledger, grouped by `area` | `src/orientation/repository.ts`, `listLiveOrientationEntries` |
| **Projects** | `DashboardSnapshot.projects` + `dailyAdvantage` | `src/dashboard/snapshot.ts` (existing) |
| **Decisions** | `DashboardSnapshot.requiresReviewItems` / `attentionItems` | existing |

Left out of v1 on purpose: a fourth "Capabilities" tower (blogging sites,
the Rebuster bridge) — that data already exists
(`DashboardBloggingSnapshot`/`DashboardRebusterSnapshot`) but reads as
automation health, not something to zoom into daily. Easy to add later; not
worth the extra top-level slot now.

The root screen (`MissionControlOverview`) adds one more thing above the
three towers: `needsYouNow` — the most urgent action items pulled from *any*
tower, so the operator sees what's on fire without opening all three.

## Open questions before the precise IA is locked

- **Depth per tower.** The recursive shape supports arbitrary depth, but how
  deep should each tower actually go? E.g. does Projects stop at one level
  (project → its own actions), or go project → milestone → decision? Life
  seems naturally 2-level (tower → area → entries-as-action-items, no further
  nesting since entries are leaves). Decisions is naturally flat (tower →
  each decision).
- **Context-channel scoping.** `routesTo.entityId` is written as
  forward-looking — today's `orientation reply` CLI command takes free text
  and figures out the target entry itself (no entity scoping param exists
  yet). Zooming into one specific ledger entry and typing there implies the
  reply *should* be scoped to that entry unambiguously. Does the interpreter
  need an optional "assume this entry unless clearly about something else"
  hint, or is that overengineering for ~10 entries?
- **Projects/Decisions context channel.** Life's context channel reuses a
  capability that already exists end-to-end (the correction loop). Projects
  and Decisions route to `ask`/review actions that exist as CLI commands but
  have no "type a sentence, get it acted on" loop the way Life does yet — is
  building that loop for those two towers in scope for this pass, or a
  separate follow-up?
- **Mobile vs. desktop.** The existing dashboard is a `MobileShell`-first
  Next.js app (see `apps/dashboard/components/mobile-shell.tsx`). Does Mission
  Control replace the mobile Today view only, or become the desktop admin
  default too?

## Non-goals (this pass)

- No API routes, React components, or page wiring.
- No decision yet on exact tower depth or navigation chrome (tabs vs.
  breadcrumbs vs. a literal zoom/pan interaction) — deliberately deferred
  per the request to nail the view models first.
