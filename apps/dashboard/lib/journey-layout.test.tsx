import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JourneyActivityLine, JourneyLog, JourneyMap, describe as describeJourney } from "../components/journey-map";
import { layoutJourney, pathData, placeLabels } from "./journey-layout";
import type { Journey, JourneyEvent } from "./journey-types";

const event = (kind: JourneyEvent["kind"], label: string, at: string, extra: Partial<JourneyEvent> = {}): JourneyEvent => ({
  at, kind, label, detail: `${label} detail`, class: null, ref: null, source: "test", ...extra
});

const pr = (id: string) => ({ kind: "pr" as const, id, url: `https://github.com/pmark/arcadia/pull/${id}` });

function journey(overrides: Partial<Journey> = {}): Journey {
  return {
    schema: "arcadia-journey-v1",
    generatedAt: "2026-10-19T16:20:00.000Z",
    action: { key: "arcadia/demo", project: "arcadia", plan: "plan", id: "demo", title: "Demo" },
    destination: { label: "PR merged", reached: false, at: null, ref: pr("1577") },
    activity: { phase: "repairing", headline: "Under repair: round 2 of 3", detail: "Session s4 is fixing the failed code-review.", since: "2026-10-19T16:20:00.000Z" },
    events: [
      event("launch", "launched", "2026-10-18T21:48:00.000Z"),
      event("victory", "#1545", "2026-10-18T21:50:00.000Z", { ref: pr("1545") }),
      event("cleared", "review fail", "2026-10-19T02:18:00.000Z"),
      event("victory", "#1554", "2026-10-19T05:14:00.000Z", { ref: pr("1554") }),
      event("obstacle", "repair escalated", "2026-10-19T16:16:00.000Z", { class: "capacity-credential" })
    ],
    now: event("now", "#1577 blocked", "2026-10-19T16:18:00.000Z", { ref: pr("1577") }),
    gate: event("gate", "independent review", "2026-10-19T16:18:00.000Z"),
    budget: { reviewAttempts: { spent: 4, inUse: 1, limit: 5 }, repairRounds: { spent: 1, inUse: 0, limit: 3 } },
    ahead: [
      { id: "pass", label: "Review passes: the worker merges", available: true, likely: true },
      { id: "repair", label: "Repairable fail", available: true, likely: false }
    ],
    warnings: [],
    ...overrides
  };
}

describe("layoutJourney", () => {
  it("lays past glyphs in order, the rover after them, open rocks and the gate ahead", () => {
    const scene = layoutJourney(journey());
    const order = scene.glyphs.filter((glyph) => glyph.type !== "pip").map((glyph) => `${glyph.type}@${glyph.s}`);
    expect(order).toEqual(["launch@30", "victory@70", "cleared@110", "victory@150", "obstacle@260", "gate@335", "destination@505", "rover@220"]);
    expect(scene.now).toEqual({ s: 220, o: 0 });
    // The path arcs over the cleared rock.
    expect(pathData("h", scene.travelled)).toContain("Q110 70 123 100");
    // Review attempts: 4 spent, 1 live; repair rounds: 1 spent of 3.
    const pips = scene.glyphs.filter((glyph) => glyph.type === "pip").map((glyph) => `${glyph.size}:${glyph.pip}`);
    expect(pips).toEqual(["small:spent", "small:spent", "small:spent", "small:spent", "small:live", "large:spent", "large:left", "large:left"]);
    expect(scene.branches.map((branch) => branch.id)).toEqual(["pass", "repair"]);
  });

  it("projects the same scene vertically for phones", () => {
    expect(pathData("v", [{ op: "M", s: 30, o: 0 }, { op: "Q", cs: 110, co: -30, s: 123, o: 0 }])).toBe("M160 30 Q190 110 160 123");
  });

  it("runs the solid path to a filled destination once reached, with no rover or branches", () => {
    const scene = layoutJourney(journey({ destination: { label: "PR merged", reached: true, at: "2026-10-19T17:00:00.000Z", ref: pr("1577") }, now: null, gate: null, ahead: [], events: journey().events.filter((e) => e.kind !== "obstacle") }));
    expect(scene.now).toBeNull();
    expect(scene.branches).toEqual([]);
    expect(scene.glyphs.at(-1)).toMatchObject({ type: "destination", reached: true });
  });

  it("starts a label at the left edge when centring it would run off the map", () => {
    expect(placeLabels("h", [{ s: 30, text: "not launched", prefer: "a", strong: true }])).toEqual([{ x: 4, y: 78, anchor: "start", text: "not launched", strong: true }]);
  });

  it("keeps strong labels and drops colliding ones rather than overlapping them", () => {
    const placed = placeLabels("h", [
      { s: 100, text: "#1545", prefer: "a", strong: false },
      { s: 110, text: "#1554", prefer: "a", strong: false },
      { s: 105, text: "#1577 blocked", prefer: "a", strong: true }
    ]);
    expect(placed.map((label) => [label.text, label.y])).toEqual([["#1577 blocked", 78], ["#1545", 131]]);
  });
});

describe("JourneyMap", () => {
  it("renders both orientations, the #now anchor and a readable summary on the server", () => {
    const html = renderToStaticMarkup(<JourneyMap journey={journey()} />);
    expect(html).toContain('class="journey-map journey-h"');
    expect(html).toContain('class="journey-map journey-v"');
    expect(html).toContain('id="now"');
    expect(html).toContain("--hx:100px");
    expect(html).toContain("journey-halo");
    expect(describeJourney(journey())).toBe("Journey of demo: 2 victories, 1 obstacles cleared; 1 obstacle open; now: #1577 blocked; ahead: Review passes: the worker merges; ahead: Repairable fail.");
  });

  it("has no #now anchor once the destination is reached", () => {
    const html = renderToStaticMarkup(<JourneyMap journey={journey({ destination: { label: "PR merged", reached: true, at: "2026-10-19T17:00:00.000Z", ref: null }, now: null, gate: null, ahead: [] })} />);
    expect(html).not.toContain('id="now"');
  });

  it("states what the rover is doing, since when, in the given time format", () => {
    const html = renderToStaticMarkup(<JourneyActivityLine journey={journey()} />);
    expect(html).toContain("Under repair: round 2 of 3");
    expect(html).toContain("since 10-19 16:20 UTC");
    expect(html).toContain("bg-gold");
    expect(html).toContain("journey-halo");
    expect(renderToStaticMarkup(<JourneyActivityLine journey={journey()} formatTime={() => "9:20 AM"} />)).toContain("since 9:20 AM");
  });

  it("logs the gate first, then events newest first, with PR links and classes", () => {
    const html = renderToStaticMarkup(<JourneyLog journey={journey()} />);
    expect(html.indexOf("independent review")).toBeLessThan(html.indexOf("#1577 blocked"));
    expect(html.indexOf("#1577 blocked")).toBeLessThan(html.indexOf("launched"));
    expect(html).toContain('href="https://github.com/pmark/arcadia/pull/1545"');
    expect(html).toContain("capacity-credential");
  });
});
