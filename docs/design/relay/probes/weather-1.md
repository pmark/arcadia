# Probe weather-1: does the weather have rhythm?

Date: 2026-11-05. Agent probe, at no cost. Machine load was about 18.

**Method.** [`weather-1.mjs`](weather-1.mjs) runs a local production build in headless WebKit at iPhone 15 Pro size, with fixture status. It
reads the weather canvas about every 500 ms to 2 s. "Moved" counts sampled pixels whose alpha changed by more than 24 of 255 since the
last reading. That counts specks of dust and leaves out the slow colour breath. The baseline is the live dashboard at `ea341341c`, with the
constant storm. Raw results: [`weather-1-results.json`](weather-1-results.json).

| What was measured | Moved | Weather alpha |
|---|---|---|
| Baseline: constant storm | 5,122 to 5,228, all the time | 0.50 |
| Storm landing, from 1 s to 5.1 s after the change, 500 ms apart | 2,537, 2,393, 1,834, 1,273, 834, 510, 295, 197, 157 | 0.24 to 0.31 |
| Storm settled | 126 to 175 | 0.25 to 0.31, breathing |
| Swells over 100 s of settled storm | Two, peaking at 611 and 566, each about 8 s long | Unchanged |
| Reopening on the same storm | 143 to 179 after the crossfade | 0.24 to 0.31 |
| Settled clear, active, attention and overcast | 20 to 23, 102 to 114, 63 to 67, 9 to 10 | 0.03, 0, 0.09, 0.34 |
| Reduced motion, storm | 0 | 0.28, constant |

**What this shows.**

- A settled storm moves about 30 times less than the constant storm, and it still reads as rust.
- A landing fades to the settled level in about 5 s.
- Reopening on the same news doesn't land again.
- I looked at the landing and settled frames for the storm, and the settled frames for attention and overcast. The status colours stay distinct,
  and text stays readable.

**What this doesn't show.**

- **Smoothness.** Headless WebKit ran at about 25 to 30 frames a second throughout, with the constant storm no worse than the rest, so it can't tell the two apart.
  Only a real phone can settle this.
- **Taste.** Whether a landing is vivid enough, and whether a swell reads as alive or goes unnoticed. These values are the prototype's, and they're
  easy to change in `SKIES`.
- **Swells in the quietest skies.** The probe's windows for clear and overcast didn't catch a swell, and those skies move little, so whether they feel alive is a question for the phone.
- **News inside a state.** A new blocker in a sky that's already Blocked doesn't land, because only a change of state does.
