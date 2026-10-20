import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JourneyMission } from "../components/journey-mission";
import { missionSummary } from "./journey-context";
import type { Journey } from "./journey-types";
import type { PathBrief } from "./path-types";

const journey = (plan: string | null): Journey => ({
  schema: "arcadia-journey-v1",
  generatedAt: "2026-10-19T20:00:00.000Z",
  action: { key: "arcadia/a13", project: "arcadia", plan, id: "a13", title: "Thirteen" },
  destination: { label: "PR merged", reached: false, at: null, ref: null },
  activity: { phase: "parked", headline: "Parked: production is Off", detail: "x", since: null },
  run: null,
  context: {
    project: { name: "Arcadia", goal: "Turn outcomes into work.", outcome: "The operator states an outcome.", milestone: "Production runs unattended." },
    plan: { slug: "run-plan", milestone: "Production runs unattended.", active: true, position: 13, total: 15, done: 11 },
    action: { title: "Implement hermetic tests.", why: "Issue #1582.", status: "open" }
  },
  events: [],
  now: null,
  gate: null,
  budget: { reviewAttempts: { spent: 0, inUse: 0, limit: 5 }, repairRounds: { spent: 0, inUse: 0, limit: 3 } },
  ahead: [],
  warnings: []
});

const path = (actionRef: string): PathBrief => ({
  generatedAt: "2026-10-19T20:00:00.000Z",
  target: { declared: true, text: "Automated production is live", looksLike: "Two Actions land unattended.", why: "Faster.", projectSlug: "arcadia", documentPath: null },
  legs: [
    { gateId: "g1", gateTitle: "Gate one", gateStatus: "done", actionRef: null, derived: true, nodes: [], done: 1, remaining: 0 },
    { gateId: "g2", gateTitle: "Two-action proof", gateStatus: "in_progress", actionRef, derived: true, nodes: [], done: 3, remaining: 1 }
  ],
  totals: { gates: 2, gatesDone: 1, steps: 5, stepsDone: 4, remaining: 1, gaps: 0 },
  warnings: []
});

describe("missionSummary", () => {
  it("names the North Star, its progress and the gate in progress, and finds the Action on the path", () => {
    expect(missionSummary(path("plan/run-plan#a13"), journey("run-plan"))).toEqual({
      northStar: { text: "Automated production is live", looksLike: "Two Actions land unattended.", why: "Faster." },
      progress: { gates: 2, gatesDone: 1, steps: 5, stepsDone: 4 },
      currentGate: "Two-action proof",
      onPath: { gateTitle: "Two-action proof", gateStatus: "in_progress" }
    });
  });

  it("falls back to the context Plan, and reports an Action off the path", () => {
    expect(missionSummary(path("plan/run-plan#a13"), journey(null)).onPath?.gateTitle).toBe("Two-action proof");
    expect(missionSummary(path("plan/other#x"), journey("run-plan")).onPath).toBeNull();
  });

  it("is empty without a declared North Star", () => {
    expect(missionSummary(null, journey("run-plan")).northStar).toBeNull();
  });
});

describe("JourneyMission", () => {
  it("renders the North Star, the milestone and this trip's place in its Plan", () => {
    const html = renderToStaticMarkup(<JourneyMission journey={journey("run-plan")} path={path("plan/other#x")} />);
    expect(html).toContain("Automated production is live");
    expect(html).toContain("1/2 gates · 4/5 steps");
    expect(html).toContain("Gate in progress: Two-action proof");
    expect(html).toContain("Production runs unattended.");
    expect(html).toContain("Step 13 of 15 in the active Plan · 11 done");
    expect(html).toContain("serves the milestone, not a North Star gate");
    expect(html).toContain("Issue #1582.");
  });

  it("still shows the Project context when the path cannot be read", () => {
    const html = renderToStaticMarkup(<JourneyMission journey={journey("run-plan")} path={null} />);
    expect(html).not.toContain("North Star");
    expect(html).toContain("Step 13 of 15");
  });
});
