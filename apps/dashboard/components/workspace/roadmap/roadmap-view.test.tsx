import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoadmapView } from "../../../../../src/roadmap/derive";
import { PX_PER_ACTION, RoadmapStack } from "./roadmap-view";

const counts = { done: 13, open: 15, inProgress: 1, blocked: 0, deferred: 2, total: 31 };
const view: RoadmapView = {
  schema: "arcadia-roadmap-v1",
  generatedAt: "2026-11-20T00:00:00.000Z",
  sourcesNewestAt: null,
  project: { slug: "demo", name: "Demo", activePlan: "plan-f", currentAction: "a1" },
  northStar: { target: "Ship <img src=x onerror=alert(1)> nights", why: "Because.", looksLike: "Quiet.", updated: "2026-11-20", gates: [{ id: "g", title: "A <b>gate</b>", status: "open", basis: "Action a in its Plan record" }] },
  milestones: { recorded: false, note: "No Milestones are recorded yet." },
  sequence: [
    { kind: "plan", order: 1, letter: "F", slug: "plan-f", description: "keep <i>alive</i>", status: "active", checkpoint: "<script>x</script>", counts, notSmall: 16, countsAsOf: "2026-11-19", isActive: true },
    { kind: "unreadable", order: 2, letter: "G", slug: "plan-g", description: "", reason: "docs/plans/plan-g.md does not exist." }
  ],
  later: [{ text: "Per-project queues." }],
  activePlanOffRoute: false,
  warnings: []
};

describe("RoadmapStack", () => {
  const html = renderToStaticMarkup(<RoadmapStack view={view} />);

  it("escapes every record string as text", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>gate");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("labels the Plan string a Checkpoint, never a Milestone, and shows fog where nothing is recorded", () => {
    expect(html).toContain("Checkpoint:");
    expect(html).toContain("Milestones: none recorded");
    expect(html).toContain("Unknown beyond here");
  });

  it("states counts with their record date, sizes Plan columns by Action count only, and draws an unreadable Plan as a gap", () => {
    expect(html).toContain("13 done · 16 open · 2 deferred");
    expect(html).toContain("Counts as recorded in the Plan on 2026-11-19");
    expect(html).toContain(`height:${13 * PX_PER_ACTION}px`);
    expect(html).toContain(`height:${16 * PX_PER_ACTION}px`);
    expect(html).toContain("could not be read");
    expect(html).toContain("you are here");
    expect(html).not.toMatch(/night(s)? (to|of|until)/i);
  });

  it("draws the latest Plan at the top and the active Plan's marker at the bottom of the stack", () => {
    expect(html.indexOf("Plan G")).toBeLessThan(html.indexOf("Plan F"));
    expect(html.indexOf("North Star")).toBeLessThan(html.indexOf("Plan G"));
  });

  it("never styles planned as reached: a draft Plan has no done column, and a declared gate is not styled done", () => {
    const draft: RoadmapView = { ...view, northStar: { ...view.northStar!, gates: [{ id: "g", title: "Declared", status: "done", basis: "declared in NORTH_STAR.md" }, { id: "h", title: "Recorded", status: "done", basis: "Action a in its Plan record" }] }, sequence: [{ kind: "plan", order: 1, letter: "G", slug: "g", description: "", status: "draft", checkpoint: null, counts: { done: 0, open: 4, inProgress: 0, blocked: 0, deferred: 0, total: 4 }, notSmall: 4, countsAsOf: "2026-11-19", isActive: false }] };
    const out = renderToStaticMarkup(<RoadmapStack view={draft} />);
    expect(out).not.toContain("rm-seg rm-done");
    expect(out.match(/rm-gate rm-gate-done/g)?.length).toBe(1);
    expect(readFileSync(new URL("./roadmap.css", import.meta.url), "utf8")).not.toMatch(/\.rm-plan \{[^}]*var\(--rm-done\)/);
  });

  it("the page says it is interim and claims no Milestone", () => {
    const live = readFileSync(new URL("./roadmap-live.tsx", import.meta.url), "utf8");
    expect(live).toContain("Interim page");
    expect(live).toContain("no Milestone is claimed or declared here");
  });
});
