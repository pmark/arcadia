import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanJourneyList } from "./journey-plan";
import type { PlanJourney } from "../lib/journey-types";

const action = (id: string, phase: PlanJourney["actions"][number]["journey"]["activity"]["phase"], headline: string, extra: Partial<PlanJourney["actions"][number]> = {}, yourMove: string | null = null): PlanJourney["actions"][number] => ({
  id, title: `Title ${id}`, status: "open", current: false,
  journey: { activity: { phase, headline, since: "2026-10-19T15:00:00.000Z", yourMove }, destination: { reached: phase === "arrived" }, counts: { victories: 0, cleared: 0, open: 0 } },
  ...extra
});

const journey: PlanJourney = {
  schema: "arcadia-plan-journey-v1", generatedAt: "2026-10-19T16:00:00.000Z", project: "arcadia",
  plan: { slug: "demo-plan", milestone: "M1", active: true },
  context: { project: { name: "Arcadia", goal: "Goal", outcome: null, milestone: "M1" }, plan: { slug: "demo-plan", milestone: "M1", active: true, position: null, total: 3, done: 1 }, action: null },
  northStar: null,
  actions: [action("a", "arrived", "Done"), action("b", "in-review", "In review", { current: true }, "Merge PR 5"), action("c", "parked", "Parked")],
  warnings: []
};

describe("PlanJourneyList", () => {
  it("renders one linked row per Action, the current one marked, with a Your move chip", () => {
    const html = renderToStaticMarkup(<PlanJourneyList journey={journey} formatTime={(iso) => iso.slice(11, 16)} />);
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain('href="/journey/arcadia/b#now"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Your move: </span>Merge PR 5");
    expect(html).toContain('data-phase="arrived"');
    expect(html).toContain("since 15:00");
    expect(html).toContain("1 of 3 Actions done");
    expect(html.indexOf("Title a")).toBeLessThan(html.indexOf("Title c"));
  });
});
