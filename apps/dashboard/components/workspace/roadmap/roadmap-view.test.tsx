import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoadmapView } from "../../../../../src/roadmap/derive";
import { RoadmapLive } from "./roadmap-live";
import { PX_PER_ACTION, RoadmapStack } from "./roadmap-view";

const counts = { done: 13, open: 15, inProgress: 1, blocked: 0, deferred: 2, total: 31 };
const view: RoadmapView = {
  schema: "arcadia-roadmap-v1",
  generatedAt: "2026-11-20T00:00:00.000Z",
  sourcesNewestAt: null,
  project: { slug: "demo", name: "Demo", activePlan: "plan-f", currentAction: "a1" },
  northStar: { target: "Ship <img src=x onerror=alert(1)> nights", why: "Because.", looksLike: "Quiet.", updated: "2026-11-20", gates: [{ id: "g", title: "A <b>gate</b>", status: "open", basis: "Action a in its Plan record", source: "plan-record" }] },
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
    const draft: RoadmapView = { ...view, northStar: { ...view.northStar!, gates: [{ id: "g", title: "Declared", status: "done", basis: "declared in NORTH_STAR.md", source: "declared" }, { id: "h", title: "Recorded", status: "done", basis: "Action a in its Plan record", source: "plan-record" }] }, sequence: [{ kind: "plan", order: 1, letter: "G", slug: "g", description: "", status: "draft", checkpoint: null, counts: { done: 0, open: 4, inProgress: 0, blocked: 0, deferred: 0, total: 4 }, notSmall: 4, countsAsOf: "2026-11-19", isActive: false }] };
    const out = renderToStaticMarkup(<RoadmapStack view={draft} />);
    expect(out).not.toContain("rm-seg rm-done");
    expect(out.match(/rm-gate rm-gate-done/g)?.length).toBe(1);
    expect(readFileSync(new URL("./roadmap.css", import.meta.url), "utf8")).not.toMatch(/\.rm-plan \{[^}]*var\(--rm-done\)/);
  });

  it("keys gate styling to where the status came from, not to the wording of its basis", () => {
    const spoof: RoadmapView = { ...view, northStar: { ...view.northStar!, gates: [{ id: "g", title: "Spoof", status: "done", basis: "Action x in its Plan record", source: "declared" }] } };
    expect(renderToStaticMarkup(<RoadmapStack view={spoof} />)).not.toContain("rm-gate-done");
  });

  it("renders duplicate Plan slugs and gate ids without duplicate React keys", () => {
    const stop = view.sequence[0];
    const dup: RoadmapView = {
      ...view,
      northStar: { ...view.northStar!, gates: [view.northStar!.gates[0], view.northStar!.gates[0]] },
      sequence: [stop, { ...stop, order: 2, letter: "G" }, { kind: "unreadable", order: 3, letter: "H", slug: "plan-f", description: "", reason: "x" }, { kind: "unreadable", order: 4, letter: "I", slug: "plan-f", description: "", reason: "x" }]
    };
    // Fizz (renderToStaticMarkup) never warns about keys, so inspect the element tree: no sibling list may repeat a key.
    const repeated: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        const keys = node.filter(isValidElement).map(el => el.key).filter((k): k is string => k !== null);
        keys.forEach((k, n) => { if (keys.indexOf(k) !== n) repeated.push(k); });
        node.forEach(walk);
      } else if (isValidElement(node)) walk((node.props as { children?: unknown }).children);
    };
    walk(RoadmapStack({ view: dup }));
    expect(repeated).toEqual([]);
    const out = renderToStaticMarkup(<RoadmapStack view={dup} />);
    expect(out.match(/Plan [FGHI]\b/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("RoadmapLive", () => {
  it("says the page is interim and claims no Milestone, in the rendered page", () => {
    const html = renderToStaticMarkup(<RoadmapLive project="demo" initial={view} initialError={null} />);
    expect(html).toContain('data-testid="roadmap-interim"');
    expect(html).toContain("Interim page");
    expect(html).toContain("no Milestone is claimed or declared here");
    expect(html).toContain("Milestones: none recorded");
    expect(html).not.toMatch(/ready to celebrate|Milestone (is |was )?(reached|achieved)|<button[^>]*>[^<]*declare/i);
  });

  it("shows the interim line and the error, not a blank page, when the first read failed", () => {
    const html = renderToStaticMarkup(<RoadmapLive project="demo" initial={null} initialError="The Arcadia workspace could not be read." />);
    expect(html).toContain('data-testid="roadmap-interim"');
    expect(html).toContain("The Roadmap could not be read: The Arcadia workspace could not be read.");
  });
});
