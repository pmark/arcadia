# Mission Control sky reuse in React

Delivery update: the React sky and routing scaffold subsequently merged in [PR #1427](https://github.com/pmark/arcadia/pull/1427). Earlier entries below retain their original research-time limits. See [current design status](arcadia-conversational-workspace.md) and the [next integration handoff](../reports/handoffs/20261015T0621Z-01a13dbc-5c50-7ef1-b48b-a9678ff4fb9b.md).

Status: source research completed, 15 October 2026. No port, build, service change or deployment performed.

**Operator direction: use the existing Mission Control animated sky verbatim. Adapt the Astro integration to React; do not redesign or approximate the renderer.**

A read-only researcher inspected `/Users/pmark/Dev/MR/Arcadia/mission-control-site`, the repository identified by the local Arcadia Mission Control project. It is clean at `c0347d93c964e50779ebb44b16e690642d857ebd`, on `codex/guide-wide-layout-20261009`. Its source identifies `https://arcadiamissioncontrol.com` as the site URL. Live deployed parity was not checked.

## Reuse boundary

The sky is **two Canvas 2D layers**, with plain TypeScript and CSS, not SVG. It has no animation-library dependency or external sky image/texture assets. Retain this implementation as the ambient background. The work hierarchy can independently use SVG/DOM above it. The earlier proposal to recreate a simpler CSS sky is superseded.

| Source to preserve | Purpose |
| --- | --- |
| [Backdrop.astro](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/components/Backdrop.astro#L14) | Two decorative canvases and browser drawing/controller logic, lines 14–303 |
| [sol-phase.ts](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/lib/sol-phase.ts#L16) | Exact phase, easing, light/dark color tables and interpolation, lines 16–109 |
| [sky-scroll.ts](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/lib/sky-scroll.ts#L1) | Tiny synthetic-scroll bridge, lines 1–7 |
| [Canvas positioning](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/styles/global.css#L1298) | Fixed, noninteractive background stacking, lines 1298–1322 |
| [Static fallback](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/styles/global.css#L176) | No-script/canvas fallback treatment, lines 176–217 |
| [Base.astro](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/layouts/Base.astro#L31) | Pre-paint theme and saved-sky-color initialization, lines 31–57 |
| [Footer.astro](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/components/Footer.astro#L7) | Optional separately rendered Martian ground, lines 7–144; its CSS is global.css:1217–1296 |
| [Glass surface reference](https://github.com/pmark/mission-control-site/blob/c0347d93c964e50779ebb44b16e690642d857ebd/src/styles/global.css#L481) | Foreground transparency through which the real sky remains visible, lines 481–487 |

No existing React version surfaced in the bounded source search. Fonts belong to foreground styling and are not required by the sky renderer.

## Existing behavior to preserve

**Day and night.** One simulated sol lasts ten minutes. The session initially opens at midnight, eases to morning phase 0.34 over its first 60 seconds, then proceeds at the normal rate. Reduced motion omits the accelerated opening. Sunrise, noon and sunset are phases 0.25, 0.5 and 0.75. This is an ambient simulated cycle, not local or real Martian time. Separate light/dark color tables control zenith, middle and horizon.

**Continuity.** `sessionStorage['sol-start']` holds the session clock across pages, discarding a future start timestamp. Storage failures are caught; navigation without storage starts at night again. Current sky colors are also saved so a new page can paint them before its first frame. The public site and dashboard do not share storage automatically because storage is origin-scoped.

**Sun and stars.** The Sun crosses left to right with the existing pale disc, blue horizon glow and slow breathing. A fixed random seed of 11 produces 80–240 stars according to viewport area. Three depth layers have different size, opacity, drift and parallax. Stars twinkle individually and show scroll-induced streaks up to the existing 90px cap. A small blue Earth appears in the evening. Clouds, Phobos, Deimos and pointer-following are not features of this source; earlier concept imagery must not be treated as the actual background.

**Scroll.** The animation samples `window.scrollY + skyScroll.y` each frame. The tour updates the synthetic bridge in possible.astro:626. A chat scrolling inside a div will need that narrow bridge if it is to drive the same existing parallax. Do not silently add a new camera or alter the visual effect.

**Lifecycle and motion.** The source uses display-rate requestAnimationFrame, not a 30fps throttle. Sky state/CSS colors publish every 250ms. Hidden tabs cancel interval/rAF and catch up on resume. Resize is debounced 150ms. Stars cap device-pixel ratio at two. Reduced motion disables frame animation, twinkle, scroll parallax/streaks and Sun breathing while keeping slow sky repaints. Both canvases are decorative, fixed, out of layout and pointer-transparent.

These are source findings, not measured performance results. An existing design document's 30fps claim does not match the current implementation and should not be repeated as a measured property.

## Smallest faithful Astro to React port

1. Create one client component containing the same two canvas elements. Pass refs to the existing controller instead of querying canvases globally. Keep the drawing routines, phase helpers, seed, constants, densities, timing and colors unchanged.
2. Initialize browser behavior in an effect. Render no Date.now, storage or random values in JSX, avoiding server/client markup disagreement.
3. Supply explicit cleanup: cancel rAF, interval and pending resize timeout; remove resize, hashchange, visibility and media-query listeners; disconnect the theme MutationObserver. Astro currently assumes document lifetime and provides no teardown. React StrictMode setup/cleanup/setup must leave exactly one renderer.
4. Mount once in the persistent layout of the opted-in workspace. Selecting an entity must not remount the sky, reset its session clock, or flash a different phase.
5. Preserve the source fallback and pre-paint theme/saved-color initialization. Keep browser/storage access client-only and preserve its failure behavior.
6. Adapt only the CSS/property ownership and theme bridge needed to coexist with the dashboard. Do not import the entire 1,433-line site stylesheet. Preserve previous property values if cleanup restores styles.
7. If the ground is part of the desired surface, port Footer's seeded static canvas and haze/shade layers separately with ResizeObserver cleanup. Ground is optional in the source's bare layout and is not required to run the sky.

The existing dashboard uses apps/dashboard/app/layout.tsx for the persistent body shell. app/globals.css paints opaque html/body surfaces; components/mobile-shell.tsx and components/chrome.tsx add opaque viewport surfaces. Those can conceal a faithful imported sky. Use an opt-in shell with the appropriate transparent gaps rather than globally changing unrelated dashboard pages. Reconcile source data-theme/system behavior with the dashboard's existing scoped theme through a small explicit adapter.

## Port acceptance checklist

- Compare source and React port at `#night`, `#dawn`, `#day`, `#dusk`, in both themes and phone/desktop viewports: 375×650, 390×700, 430×800 and 1440×900.
- Fix session start, clock and device scale for pixel comparison. The source hash hooks freeze phase/drift, but Sun breathing and twinkle still read Date.now; hash alone is insufficient for exact screenshots.
- Compare motion through the opening, scroll, entity navigation, resize and theme changes. Check initial paint, no reset/flash, no duplicate loops and identical layer ordering.
- Test reduced motion, hidden-tab pause/resume, unavailable canvas and blocked storage.
- Test StrictMode mount/unmount/remount: listeners, timers and observers return to baseline.
- Test a real phone for input behavior, frame cadence and CPU; do not infer a performance guarantee from source size or zero dependencies.

## Provenance

Git blob IDs at the pinned source revision:

| File | Blob |
| --- | --- |
| Backdrop.astro | 97ec4a530b03b123cc810d7e579a20559177e47f |
| sol-phase.ts | 2e577f294190dd2298b092c9e9172bdb4fc15883 |
| sky-scroll.ts | d29019aa5e26a2ab0ebb7b1c306bf91a2270690a |
| global.css | f1bec4d10e150004375aae194ae5b4d1f75ef793 |
| Base.astro | 1d73894884687ce9dca7db282f95ed815ad6f90c |
| Footer.astro | 90194452d14e56e691ef5a559432fd6655a25dc2 |

Preserve source provenance and notices during extraction. The source footer names MPL 2.0; this research did not resolve a canonical root license file or make a licensing conclusion.

Research role: native depth-one researcher, task `/root/mission_control_sky_research`, explicitly requested by the operator. Root supplied the canonical role brief and retrieved key renderer/phase/site identity/CSS sections independently. No source repository changes or live requests were made. The source repository's AGENTS is 60,035 bytes and its modern guidance index and notes file are absent; its older AGENTS inlines procedures and does not forbid this read-only inspection. These adoption gaps were reported and not repaired. Refresh them through the canonical adoption workflow before affected implementation governed by those missing references.

The next implementation step is a mechanical React lifecycle adaptation in an authorized isolated candidate, with visual parity as the acceptance criterion. This research does not claim that port is already done.
