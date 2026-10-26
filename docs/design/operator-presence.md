# Operator presence and the workspace feed

Operator request: [Issue 1761](https://github.com/pmark/arcadia/issues/1761)
(back burner, 2026-10-25), revised by the operator on 2026-10-26. No governed
Action exists yet. The operator registered the inactive-draft Plan Ask
[`agent-ask-plan-operator-moonlet-2026-10-25.yaml`](../../.arcadia/asks/agent-ask-plan-operator-moonlet-2026-10-25.yaml)
before the revision. Its Actions still name the moonlet route and the
mood-driven weather, so it needs an amendment Ask before any Action runs.

## Purpose

Arcadia's agents work while the operator is away. Two separate signals keep
the workspace honest about what is going on:

- **The sky shows system status.** The sol sky keeps the time of day; the
  weather over it reads the same live sources as the feed. Worst first:
  - *Blocked* (dust storm): a blocking item waits on the operator, or a
    mission is blocked.
  - *Signal loss* (overcast): a read failed, so the picture may be stale.
  - *Needs you* (warm haze): something waits on the operator, or a pull
    request is failing.
  - *Work moving* (light wind): work is moving without the operator.
  - *All clear* (clear skies).

  A status pill says the same thing in words, with the reasons, so the weather
  is never the only way to know. Sample missions never set the sky.
- **Presence is the operator's own condition.** It is a slow *overall*
  condition (calm, content, focused, stoked, tired, stressed, low or playful)
  plus an optional *right now* state (thinking, typing, confused, worried,
  rushing, impatient, angry, freaking out, excited, stoked, content, stepped
  away, or the operator's own emoji, sticker or GIF). The right-now state fades
  back after five minutes. Presence never changes the sky.

Presence lives in the profile button and menu of the workspace header, not in
the page's main space. It has two styles:

- **Quiet** (the default): a person icon with a status dot in the condition's
  color, a muted settings-style menu, and no face or animation.
- **Expressive**: the moonlet avatar, the wordmark's moon with a face, small in
  the same button, with the right-now emoji as a badge.

The signal is display-only and carries `authority: none`. Showing it to
agents, attaching it to Asks, syncing it across devices or posting it to
Discord each needs an operator Decision first.

## Route scaffold

This is an operator-directed, ungoverned scaffold. PR 1768 added it, and the
2026-10-26 revision moved it to `/workspace/feed`. It sits under the workspace
layout, so it keeps the real sol sky. The header's Feed link opens it.

- **Feed.** Read-only messages from the existing sources:
  - Next steps (`/api/next-steps`), under "Your move".
  - Decisions and other to-do items (`/api/approvals`), under "Waiting on
    you".
  - Wait steps, under "Waiting on others". They have no link, because there is
    nothing to press.
  - Open pull requests (`/api/pull-requests`).

  Every other item links to the control that already answers it; a card step
  goes to its card on `/todo`. The page adds no write path.
  `lib/workspace-feed.ts` builds the order.
- **Sky.** `lib/system-sky.ts` turns the feed and the failed reads into a
  reading. `components/workspace/feed/weather.ts` draws that reading on its own
  canvas over the sky.
- **Journey.** A floating button summarizes the rover fleet at a glance:
  - Each mission is one ring segment, colored blocked, moving, waiting or
    arrived.
  - The number in the center is how many feed items wait on the operator.
  - An ember halo means something urgent waits.
  - Its accessible name says all of it in words.

  Tapping the button opens the Journey. On a phone it replaces the feed; on a
  wide screen it opens beside it. Tap again to return to the feed.

  Journey opens on the last screen viewed (the fleet, or one mission's legs),
  so opening it never surprises. A blocked mission stays pinned at the top of
  any other mission's screen, but the view never switches on its own.
  `lib/journey-fleet.ts` holds the fleet order, the counts and the remembered
  screen.

  The missions come from `lib/journey-fixture.ts`: sample data in the real
  `arcadia-plan-journey-v1` shape, labelled "Sample data". Replacing them with
  live journey reads is its own Plan Action. Once that lands, live missions
  should also feed the sky.
- **Presence.** `lib/operator-presence.ts` holds the browser-local signal and
  style. `components/workspace/presence/presence-menu.tsx` is the profile
  button and menu. Up to three custom states are kept, with images up to 1 MB.
- **Proof.** `apps/dashboard/lib/{operator-presence,system-sky,journey-fleet,workspace-feed}.test.ts`
  and `tests/e2e/workspace-feed.spec.ts`.

## Brand fit

- The sky is Martian weather over the sol-phase sky: haze, dust storms,
  overcast, wind. System status reads as conditions on the surface the rovers
  drive.
- Mission vocabulary: rovers, legs, arrived, the Journey.
- The moonlet is the expressive option. The wordmark's orbiting dot is a moon,
  and the moonlet is that moon with a face.

## Prototypes

Both are throwaway UX sketches, not production code.

- [`prototypes/operator-moonlet.html`](prototypes/operator-moonlet.html):
  open it directly in a browser. It is the original Expressive sketch:
  - the conversational workspace, with the moonlet docked above the composer;
  - an orbit picker, the fade-back trail and message mood stamps;
  - mood-driven weather, which predates the move to system status.

  Its sky is a port of `components/workspace/sky/`. The Sky time control (or
  `#dawn`, `#day`, `#dusk`, `#night`) freezes the phase.
- The first, plainer widget sketch, a corner buddy on a sample dashboard,
  lives only as the operator's private Claude artifact.

## Constraints for the build

- `/workspace` already owns the sky (`apps/dashboard/components/workspace/sky/`).
  `sol-phase.ts` and `sky-scroll.ts` are verbatim copies (the source footer
  names MPL 2.0) and stay unmodified. Weather is a separate layer that composes
  with the sol phase. It never replaces the time of day.
- Presence and the Journey screen are browser-local on the workspace surface,
  like the Ask recovery history in `workspace-ask.tsx`. The Ask payload is
  unchanged.
- Reduced motion, keyboard use (open, choose, Escape, focus return), blocked
  storage and phone width are acceptance conditions, not polish.
