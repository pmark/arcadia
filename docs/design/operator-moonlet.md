# Operator moonlet

Operator request: [Issue 1761](https://github.com/pmark/arcadia/issues/1761)
(back burner, 2026-10-25). No governed Action exists yet. The proposed Plan is
the inactive-draft Agent Ask
[`agent-ask-plan-operator-moonlet-2026-10-25.yaml`](../../.arcadia/asks/agent-ask-plan-operator-moonlet-2026-10-25.yaml).
It is validated but not yet registered: a host with the live workspace runs
`arcadia agent-ask preview --file .arcadia/asks/agent-ask-plan-operator-moonlet-2026-10-25.yaml --json`,
and only the operator's settlement creates the inactive draft Plan.

## Purpose

Arcadia's agents work while the operator is away, and the one thing they
cannot observe is the operator. The moonlet gives the operator one tap to tell
Arcadia, and anyone reading the workspace, how they are doing:

- **Atmosphere** is the slow, ambient mood: calm, content, focused, stoked,
  tired, stressed, low or playful.
- **Right now** is the momentary state: thinking, typing, confused, worried,
  rushing, impatient, angry, freaking out, excited, stoked, content, stepped
  away, or the operator's own emoji, sticker or GIF. It fades back to the
  atmosphere after a timeout.

It is useful because a message's tone travels with it ("fix it" while
impatient is not "fix it" while thinking), and because a later, separately
decided step could let agents adapt (shorter replies while rushing, held
non-urgent pings while focused). It is fun because it is a responsive toy
that turns how you feel into something playful instead of an explanation.

The signal is display-only and carries `authority: none`. Showing it to
agents, attaching it to Asks, syncing it across devices or posting it to
Discord each needs an operator Decision first.

## Brand fit

- The wordmark's orbiting dot is a moon; the moonlet is that moon with a face.
- The atmosphere is Martian weather over the existing sol-phase sky: violet
  dusk, pale haze, clear night, golden hour, dust storm, overcast, aurora.
- Mars's moons are named for feelings: Phobos (fear) and Deimos (dread). The
  prototype lights their labels for the matching states.
- Mission vocabulary: "operator telemetry", sol and Mars Coordinated Time.

## Route scaffold

Operator-directed, ungoverned scaffold (PR 1768): `/workspace/moonlet`, under
the workspace layout so it keeps the real sol sky.

- **Feed.** Read-only messages from the existing sources: next steps
  (`/api/next-steps`) under "Your move", Decisions and other to-do items
  (`/api/approvals`) under "Waiting on you", and open pull requests
  (`/api/pull-requests`). Each links to the control that already answers it;
  the page adds no write path. `lib/moonlet-feed.ts` builds the order.
- **Missions.** Expandable rover missions from `lib/journey-fixture.ts`, a
  sample in the real `arcadia-plan-journey-v1` shape, labelled "Sample data".
  Replacing it with live journey reads is its own Plan Action.
- **Mood.** `lib/operator-mood.ts` holds the browser-local signal;
  `components/workspace/moonlet/weather.ts` draws the atmosphere on its own
  canvas and reads only the sky's published `--night`; `moonlet.tsx` is the
  companion and orbit picker. Custom states: up to three, images up to 1 MB.
- There is no composer on this page yet; "Ask from the workspace" links to the
  existing receipt-loop composer.
- Proof: `apps/dashboard/lib/{operator-mood,moonlet-feed}.test.ts` and
  `tests/e2e/workspace-moonlet.spec.ts`.

## Prototypes

Both are throwaway UX sketches, not production code.

- [`prototypes/operator-moonlet.html`](prototypes/operator-moonlet.html):
  open it directly in a browser. It is the conversational workspace with the
  moonlet docked above the composer, an orbit picker, the fade-back trail and
  message mood stamps. Its sky is a port of `components/workspace/sky/`
  (sol phase, sun and star arcs; scroll parallax omitted) with the atmosphere
  drawn as a separate weather canvas on top: tint, haze, veil, overcast,
  vignette, dust, rising motes and aurora, crossfading over about two seconds
  while the sol clock keeps running. The Sky time control (or `#dawn`, `#day`,
  `#dusk`, `#night`) freezes the phase to compare weather at each hour.
- The first, plainer widget sketch (corner buddy on a sample dashboard) lives
  only as the operator's private Claude artifact.

## Constraints for the build

- `/workspace` already owns the sky (`apps/dashboard/components/workspace/sky/`).
  `sol-phase.ts` and `sky-scroll.ts` are verbatim copies (the source footer
  names MPL 2.0) and stay unmodified. Atmosphere is a separate weather layer that composes with the
  sol phase; it never replaces time of day.
- State is browser-local on the workspace surface, like the Ask recovery
  history in `workspace-ask.tsx`. The Ask payload is unchanged.
- Reduced motion, keyboard use (open, choose, Escape), blocked storage and
  phone width are acceptance conditions, not polish.
