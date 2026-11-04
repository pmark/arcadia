# Probe layers-1: does the three-layer Scene hold up?

Date: 2026-11-03. Agent probe, at no cost. Cheapest test that could prove wrong the assumption that one sky can carry
status behind a View and an overlay while all the text stays readable.

**Method.** [`layers-1.mjs`](layers-1.mjs) renders the throwaway prototype in headless Chromium at 390 by 844 and 1440 by
900, using the sky and weather drawing code ported from the dashboard. It takes every combination of 4 times of day, 2
palettes, 5 statuses and 3 Relay heights. Reduced motion freezes the weather so the frames compare. It reads pixels from
the sky, star and weather canvases. Raw results: [`layers-1-results.json`](layers-1-results.json).

- **Contrast:** for each kind of text, the worst point under its box, with its surfaces composited over the sky pixels.
- **Open sky:** the share of an 8 px grid that lands on nothing opaque.
- **Separation:** mean CIELAB distance between two statuses over the points that are open sky in both.

## Results

**Text and controls.** Worst case 8.59:1 (`.card p`, laptop, light palette, day), against a floor of 4.5:1. No text sits on bare sky.
The probe samples every visible element for 24 kinds of text, control and label, including the reasons panel, menu options, starter
suggestions and the pinned-draft line.
Retry and error text aren't in the prototype, so they aren't sampled. The floor passes largely because surfaces are 88 to 95% opaque.

**Open sky**, as a share of what's visible:

| | Resting (reasons panel open) | Answer | Thread | Answer above a simulated keyboard |
|---|---|---|---|---|
| Phone | 38.8% | 11.4% | 9.1% | 11.3% of the top 500 px |
| Laptop | 75.8% | 65.3% | 52.3% | n/a |

With the keyboard simulated, the scope chip sits at 135 px and the field ends at 491 px, so both stay in the 500 px left.

The first version stacked cards the way today's Workspace does and left 17.1% on a phone at rest with no panel open. That version
isn't in the repository. Showing one subject, with neighbours behind a disclosure, raised it to 40.9%. This changed the design.

**Separation.** The lowest distance for each pair across all skies, on a phone. These are means over open-sky points. A distance
near 2 is about the limit of perception for patches side by side, so treat them as indicative only.

| Pair | Resting | Thread | Keyboard | Lowest at |
|---|---|---|---|---|
| All clear, Work moving | 1.8 | 1.5 | 1.2 | Light palette |
| Work moving, Blocked | 6.9 | 5.3 | 3.9 | Light palette, day |
| Work moving, Needs you | 6 | 4.9 | 4.1 | Light palette, day |
| Needs you, Blocked | 8.6 | 6.1 | 4.3 | Light palette, day |
| All clear, Signal loss | 7 | 5.9 | 5 | Light palette, dusk |
| All clear, Needs you | 8.9 | 7.6 | 6.8 | Light palette, day |
| All clear, Blocked | 9.3 | 8 | 7 | Light palette, day |
| Signal loss, Blocked | 22.2 | 21.3 | 20.7 | Light palette |

On the dark palette, Needs you and Blocked are far apart at most times of day.

**Draw cost.** Script time per frame with a 4x CPU slowdown was 0.3 to 0.8 ms across runs. That counts only issuing the drawing commands, not
painting them, so it isn't evidence of phone performance.

## Reading

- **Supported:** sampled text stays legible on every sky, and the sky stays visible at every Relay height, though on a phone with the
  overlay up it's mainly the top strip and the edges.
- **Weak spots, all on the light palette:** Work moving against Blocked, Work moving against Needs you, Needs you against Blocked, and
  All clear against Signal loss. On the keyboard case, Work moving against Signal loss (4.5) and Needs you against Signal loss (5.1)
  are also low. Mistaking Blocked or Needs you for Work moving is the costly mistake. The dust, the dot and the words do differ. These need a look on a real phone before any colour changes.
- **Accepted, with a condition:** All clear and Work moving differ by motion, so under reduced motion only the words separate them.
  That's acceptable only if a flagged stall or a silent worker reads as Blocked, which the design now requires.
- **Not probed:** the Reading state's look, because it draws nothing.

## Limits

This was one machine, in headless Chromium, with sample content and frozen weather. The keyboard is a 344 px inset, not a real one. Colour distance isn't perception, and
it ignores motion, which is most of what makes weather read as weather. The prototype leaves out parallax, and its View is
shorter than a long real Plan, so a long View covers more sky.

**Not tested:** a real phone, iOS Safari's keyboard, frame rate and battery, whether a person reads weather as status at a
glance, or the cost of status reads. The next cheap test is the operator opening the prototype on their phone.
