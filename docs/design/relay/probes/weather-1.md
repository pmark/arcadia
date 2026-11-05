# Probe weather-1: does the weather have rhythm?

Date: 2026-11-05. Agent probe, at no cost. Machine load was about 14 to 18.

**Method.** [`weather-1.mjs`](weather-1.mjs) runs a local production build in headless WebKit at iPhone 15 Pro size, with fixture status. It
reads the weather canvas about every 500 ms to 2 s. "Moved" counts sampled pixels whose alpha changed by more than 24 of 255 since the
last reading. That counts specks of dust and leaves out the slow colour breath. The baseline is the live dashboard at `ea341341c`, with the
constant storm. Raw results: [`weather-1-results.json`](weather-1-results.json).

| What was measured | Moved | Weather alpha |
|---|---|---|
| Baseline: constant storm | 5,088 to 5,311, all the time | 0.50 |
| Storm landing, first 4 s, 500 ms apart | 2,543, 2,181, 1,328, 747, 430, 229, 115, 68 | 0.24 to 0.30 |
| Storm settled | 61 to 93 | 0.25 to 0.31, breathing |
| Swells over 100 s of settled storm | Two, peaking at 589 and 529, each about 8 s long | Unchanged |
| Reopening on the same storm | 76 to 85 after the crossfade | 0.24 to 0.31 |
| Settled clear, active, attention and overcast | 0, 36 to 45, 14 to 19, 0 | 0.03, 0, 0.09, 0.34 |
| Reduced motion, storm | 0 | 0.28, constant |

**What this shows.**

- A settled storm moves about 70 times less than the constant storm, and it still reads as rust.
- A landing fades to the settled level in about 4 s.
- Reopening on the same news doesn't land again.
- I looked at the landing and settled frames for the storm, and the settled frames for attention and overcast. The status colours stay distinct,
  and text stays readable.

**What this doesn't show.**

- **Smoothness.** Headless WebKit ran at a steady 30 frames a second in nearly every state, so it can't tell the two apart. One landing run dropped
  to 7 frames a second while the probe was reading the whole canvas and taking a screenshot, so that says nothing about the page. Only a real phone can settle
  this.
- **Taste.** Whether a landing is vivid enough, and whether a swell reads as alive or goes unnoticed. These values are the prototype's, and they're
  easy to change in `SKIES`.
- **News inside a state.** A new blocker in a sky that's already Blocked doesn't land, because only a change of state does.
