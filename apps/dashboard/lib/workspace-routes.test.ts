import { describe, expect, it } from "vitest";
import type { PlanProgressData, PlanRow, PlanSummariesResponse } from "./plans-types";
import { AHEAD_NAMED, actionWords, crumbName, humanizeSlug, namesNote, narrowPlanSummaries, plainText, planRoute, planWords, portfolioRoutes, readingLine, routeTap, shapeFromCounts, shortText, statusWord, stopShape, workspaceParts } from "./workspace-routes";

/** Real titles from Arcadia's own active Plan. */
const LONG = "A QA verdict whose only failure is the host-written operator QA plan uses no repair rounds, stops blocking, and files an Issue; and the plan renderer inspects what it writes.";
const MILESTONE = "Arcadia runs production unattended on its own repository on the Claude provider: the worker launches a Session, preserves a reviewed PR, merges it through the PR when it is not authority-adjacent, and continues to the next Action within a spend bound.";

describe("shortText", () => {
  it("leaves text that fits alone", () => expect(shortText("Review the page on a phone")).toBe("Review the page on a phone"));

  it.each([
    LONG, MILESTONE,
    "Pin how recovery signals order an unparseable time with tests, covering the epoch fallback named in Issue #2004.",
    "Before reporting base_not_synced, the worker reconciles local main when its only local-only commits are its own pointer commits; anything else still refuses.",
    "x".repeat(400),
    `${"word ".repeat(100)}`,
    "One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten. Eleven. Twelve. Thirteen. Fourteen. Fifteen. Sixteen.",
    "Use e.g. a short sentence, i.e. something that doesn't split on an abbreviation or any other period that is not really the end."
  ])("only ever keeps a marked prefix of the record, within the limit: %s", text => {
    for (const max of [12, 26, 48, 72, 150]) {
      const short = shortText(text, max);
      const plain = plainText(text);
      expect(short.length).toBeLessThanOrEqual(max);
      if (plain.length > max) {
        expect(short.endsWith("…")).toBe(true);
        expect(plain.startsWith(short.slice(0, -1))).toBe(true);
      }
    }
  });

  it("cuts at a clause when that keeps enough room", () => {
    expect(shortText("Pin how recovery signals order an unparseable time with tests, covering the epoch fallback named in Issue #2004.")).toBe("Pin how recovery signals order an unparseable time with tests…");
  });

  it("doesn't end on a word that needs what was cut", () => {
    expect(shortText("The worker must not touch anything at all in the repository without a Decision", 19)).toBe("The worker must…");
    expect(shortText(MILESTONE)).toBe("Arcadia runs production unattended on its own repository on the Claude…");
  });

  it("doesn't cut at an abbreviation's period", () => {
    expect(shortText("Reads the small cases, e.g. every one of the fixture Plans, and then the whole portfolio", 40)).not.toMatch(/e\.g…$/);
  });

  it("marks a single token longer than the room", () => {
    expect(shortText("x".repeat(80), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("treats no text as empty", () => {
    expect(shortText(null)).toBe("");
    expect(shortText("   ")).toBe("");
  });
});

describe("plainText", () => {
  it("removes Markdown marks and keeps the words", () => {
    expect(plainText("Fix **the** `fetch`  in [the route](https://x/y)\n\n## Next line")).toBe("Fix the fetch in the route Next line");
    expect(plainText("An *emphasized* word, and *another*.")).toBe("An emphasized word, and another.");
  });
  it("keeps an asterisk that's part of the text", () => {
    expect(plainText("Multiply 5*3 and 2*4, or glob src/*.ts")).toBe("Multiply 5*3 and 2*4, or glob src/*.ts");
  });
});

describe("names", () => {
  it("humanizes a slug", () => {
    expect(humanizeSlug("first-website")).toBe("First website");
    expect(humanizeSlug(undefined)).toBe("");
  });
  it("shortens a crumb", () => expect(crumbName(MILESTONE).length).toBeLessThanOrEqual(26));
  it("shows a status it doesn't know as recorded rather than mapping it", () => {
    expect(statusWord("in_progress")).toBe("In progress");
    expect(statusWord("waiting_on_host")).toBe("Waiting on host");
  });
});

const summary = {
  schema: "arcadia-plan-summary-v1" as const, generated: true as const, plan: "garden", source: "docs/plans/garden.md", source_fingerprint: "a", note: "", written: "2030-01-01", author: "fixture",
  title: "Grow a garden", purpose: "Feed the street.", serves: "The outcome.", done_when: "Food grows.",
  actions: [{ id: "plant", source_fingerprint: "b", title: "Plant the beds", why: "Nothing grows otherwise.", done_when: "Beds planted." }]
};
const summaries = (planFresh: boolean, action: "fresh" | "stale" | "missing"): PlanSummariesResponse => ({ project: "demo", generatedAt: "2030-01-01", plans: { garden: { state: planFresh ? "fresh" : "stale", planFresh, summary, actions: { plant: action } } } });
const row = (slug: string, counts: PlanRow["actionCounts"], milestone: string | null = null, extra: Partial<PlanRow> = {}): PlanRow => ({ slug, status: "active", governed: true, milestone, isActivePlan: true, actionCounts: counts, activationNote: null, relativePath: `docs/plans/${slug}.md`, ...extra });

describe("words", () => {
  it("names a Plan from a fresh summary only", () => {
    expect(planWords(row("garden", null, "Recorded milestone"), "garden", summaries(true, "fresh"))).toEqual({ name: "Grow a garden", sentence: "Feed the street.", source: "summary" });
    expect(planWords(row("garden", null, "Recorded milestone"), "garden", summaries(false, "fresh"))).toEqual({ name: "Recorded milestone", sentence: null, source: "record" });
  });
  it("falls back to a shortened milestone, then the slug", () => {
    expect(planWords(row("garden", null, MILESTONE), "garden", null).source).toBe("shortened");
    expect(planWords(row("first-website", null), "first-website", null)).toEqual({ name: "First website", sentence: null, source: "record" });
    expect(planWords(null, "first-website", null).name).toBe("First website");
  });
  it("names an Action from its own fresh summary only", () => {
    expect(actionWords("Plant", "plant", "garden", summaries(true, "fresh")).name).toBe("Plant the beds");
    expect(actionWords("Plant", "plant", "garden", summaries(true, "fresh")).sentence).toBe("Nothing grows otherwise.");
    expect(actionWords("Plant", "plant", "garden", summaries(true, "stale"))).toEqual({ name: "Plant", sentence: null, source: "record" });
    expect(actionWords("Plant", "plant", "garden", summaries(true, "missing")).source).toBe("record");
    expect(actionWords(LONG, "plant", "garden", null).source).toBe("shortened");
  });
});

describe("shapeFromCounts", () => {
  it("says what the counts say and nothing more", () => {
    const shape = shapeFromCounts({ open: 4, in_progress: 0, done: 29, blocked: 0 })!;
    expect(shape).toMatchObject({ done: 29, total: 33, tone: "open", label: "29 of 33 done", position: 29 });
    expect(shape.marks).toHaveLength(33);
  });
  it("only moves when the record says in progress", () => {
    expect(shapeFromCounts({ open: 1, in_progress: 1, done: 0, blocked: 0 })).toMatchObject({ tone: "moving", label: "0 of 2 done · 1 in progress" });
  });
  it("shows blocked first", () => {
    expect(shapeFromCounts({ open: 1, in_progress: 1, done: 1, blocked: 1 })).toMatchObject({ tone: "blocked", label: "1 of 4 done · 1 in progress · 1 blocked" });
  });
  it("arrives only when nothing is left", () => {
    expect(shapeFromCounts({ open: 0, in_progress: 0, done: 3, blocked: 0 })).toMatchObject({ tone: "arrived", position: 2 });
  });
  it("counts deferred without calling it ahead", () => {
    const shape = shapeFromCounts({ open: 0, in_progress: 0, done: 1, blocked: 0, deferred: 2 } as PlanRow["actionCounts"]);
    expect(shape).toMatchObject({ total: 3, tone: "open", position: 1, label: "1 of 3 done · 2 deferred" });
  });
  it("has no route without counts or stops", () => {
    expect(shapeFromCounts(null)).toBeNull();
    expect(shapeFromCounts({ open: 0, in_progress: 0, done: 0, blocked: 0 })).toMatchObject({ tone: "empty", label: "No Actions recorded", position: null });
  });
});

const project = (slug: string, status: string, plans: PlanRow[] | null, error: string | null = null) => ({ id: slug, slug, name: slug, status, activePlan: plans?.[0]?.slug ?? null, plans, error });

describe("portfolioRoutes", () => {
  it("leads with a few active Projects, worst first, and keeps the rest", () => {
    const done = project("done", "active", [row("p", { open: 0, in_progress: 0, done: 2, blocked: 0 })]);
    const open = project("open", "active", [row("p", { open: 1, in_progress: 0, done: 0, blocked: 0 })]);
    const blocked = project("blocked", "active", [row("p", { open: 1, in_progress: 0, done: 0, blocked: 1 })]);
    const failed = project("failed", "active", null, "No repository");
    const paused = project("paused", "paused", [row("p", { open: 1, in_progress: 0, done: 0, blocked: 0 })]);
    const { lead, rest } = portfolioRoutes([done, open, paused, failed, blocked]);
    expect(lead.map(r => r.slug)).toEqual(["blocked", "failed", "open", "done"]);
    expect(rest.map(r => r.slug)).toEqual(["paused"]);
    expect(lead[1]).toMatchObject({ tone: "unread", problem: "Can't read its Plans" });
  });
  it("holds back active Projects beyond the lead rather than dropping them", () => {
    const projects = Array.from({ length: 8 }, (_, i) => project(`p${i}`, "active", [row("p", { open: 1, in_progress: 0, done: 0, blocked: 0 })]));
    const { lead, rest } = portfolioRoutes(projects);
    expect(lead).toHaveLength(5);
    expect(rest.map(r => r.slug)).toEqual(["p5", "p6", "p7"]);
  });
  it("prefers the Plan the Project names", () => {
    const named = { ...project("a", "active", [row("other", { open: 1, in_progress: 0, done: 0, blocked: 0 }), row("named", { open: 0, in_progress: 0, done: 1, blocked: 0 }, null, { isActivePlan: false })]), activePlan: "named" };
    expect(portfolioRoutes([named]).lead[0].plan).toBe("named");
  });
});

const action = (id: string, status: string, title = id) => ({ key: `demo/${id}`, status, title, dependsOn: [] });
function progress(actions: Array<ReturnType<typeof action>>, current: PlanProgressData["current"] = null): PlanProgressData {
  return { schema: "fixture", source: { planSlug: "garden", planPath: "docs/plans/garden.md", updated: "2030-01-01" }, counts: { open: 0, in_progress: 0, done: 0, blocked: 0, deferred: 0, total: actions.length }, isActivePlan: true, current, currentNote: null, next: [], blocked: [], actions, note: "" };
}
const current = (id: string, basis: "project_current_action" | "first_unfinished_ready" = "project_current_action") => ({ key: `demo/${id}`, title: id, status: "open", waitingOn: [], basis }) as NonNullable<PlanProgressData["current"]>;

describe("planRoute", () => {
  const actions = [action("a", "done"), action("b", "done"), action("c", "open"), action("d", "open"), action("e", "blocked"), action("f", "open"), action("g", "open"), action("h", "deferred")];

  it("splits the route into been, here, the next few and the rest, keeping every Action", () => {
    const route = planRoute(progress(actions, current("c")), "garden", null);
    expect(route.been.map(s => s.id)).toEqual(["a", "b"]);
    expect(route.here?.id).toBe("c");
    expect(route.here?.role).toBe("current");
    expect(route.ahead.map(s => s.id)).toEqual(["e", "d"]);
    expect(route.ahead).toHaveLength(AHEAD_NAMED);
    expect(route.later.map(s => s.id)).toEqual(["f", "g"]);
    expect(route.aside.map(s => s.id)).toEqual(["h"]);
    const shown = [...route.been, route.here!, ...route.ahead, ...route.later, ...route.aside].map(s => s.id).sort();
    expect(shown).toEqual(actions.map(a => a.key.split("/")[1]).sort());
  });

  it("keeps the rover on the current Action in the Plan's own order", () => {
    const route = planRoute(progress([action("a", "open"), action("b", "done"), action("c", "open")], current("c")), "garden", null);
    expect(route.shape.position).toBe(2);
    expect(route.shape.marks).toEqual(["ahead", "done", "here"]);
  });

  it("doesn't call a computed next stop the current Action", () => {
    const route = planRoute(progress(actions, current("c", "first_unfinished_ready")), "garden", null);
    expect(route.here?.role).toBe("next-ready");
  });

  it("names no current stop when the record names none, and never claims movement", () => {
    const route = planRoute(progress([action("a", "done"), action("b", "open")]), "garden", null);
    expect(route.here).toBeNull();
    expect(route.shape).toMatchObject({ tone: "open", position: 1, label: "1 of 2 done" });
    expect(planRoute(progress([action("a", "in_progress")]), "garden", null).shape.tone).toBe("moving");
  });

  it("marks Go's current Action only as Go named it", () => {
    const route = planRoute(progress(actions, current("c")), "garden", null, "d");
    expect(route.stops.filter(s => s.go).map(s => s.id)).toEqual(["d"]);
    expect(route.here?.go).toBe(false);
  });

  it("arrives when everything is done, and is empty with no Actions", () => {
    expect(planRoute(progress([action("a", "done")]), "garden", null).shape).toMatchObject({ tone: "arrived", position: 0 });
    expect(planRoute(progress([]), "garden", null).shape).toMatchObject({ tone: "empty", position: null, label: "No Actions recorded" });
  });

  it("doesn't call a route with deferred stops arrived", () => {
    expect(planRoute(progress([action("a", "done"), action("b", "deferred")]), "garden", null).shape).toMatchObject({ tone: "open", position: 1 });
  });

  it("says once when any name in a list is a reading aid", () => {
    expect(namesNote(["record", "record"])).toBeNull();
    expect(namesNote(["record", "shortened"])).toContain("The record governs.");
    expect(namesNote(["summary"])).toContain("The record governs.");
    expect(planRoute(progress([action("plant", "open", LONG)]), "garden", summaries(true, "fresh")).stops[0].source).toBe("summary");
  });

  it("uses a fresh Action summary for the stop's name and keeps the record's title", () => {
    const route = planRoute(progress([action("plant", "open", LONG)]), "garden", summaries(true, "fresh"));
    expect(route.stops[0]).toMatchObject({ name: "Plant the beds", title: LONG });
    const stale = planRoute(progress([action("plant", "open", LONG)]), "garden", summaries(true, "stale"));
    expect(stale.stops[0].name.length).toBeLessThanOrEqual(60);
    expect(stale.stops[0].name.endsWith("…")).toBe(true);
  });

  it("places one Action on the route", () => {
    const route = planRoute(progress(actions, current("c")), "garden", null);
    expect(stopShape(route, "e")).toMatchObject({ position: 4, tone: "blocked", label: "Stop 5 of 8" });
    expect(stopShape(route, "a")).toMatchObject({ tone: "arrived" });
    expect(stopShape(route, "c")?.tone).toBe("open");
    expect(stopShape(route, "gone")).toBeNull();
  });
});

describe("the interface never waits", () => {
  it("says what it's reading, and then that the tap was received", () => {
    expect(readingLine("Plan", false)).toBe("Reading this Plan...");
    expect(readingLine("Project", false)).toBe("Reading this Project's Plans...");
    expect(readingLine("Plan", true)).toContain("your tap was received");
  });

  const here = { origin: "http://arcadia", pathname: "/workspace" };
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  it("moves on a plain tap on another route", () => {
    expect(routeTap({ href: "http://arcadia/workspace/projects/a" }, plain, here)).toBe("move");
  });
  it("stays on a tap on the same address", () => {
    expect(routeTap({ href: "http://arcadia/workspace" }, plain, here)).toBe("stay");
  });
  it("leaves modified taps, other tabs and other sites to the browser", () => {
    expect(routeTap({ href: "http://arcadia/workspace/x" }, { ...plain, metaKey: true }, here)).toBe("browser");
    expect(routeTap({ href: "http://arcadia/workspace/x" }, { ...plain, button: 1 }, here)).toBe("browser");
    expect(routeTap({ href: "http://arcadia/workspace/x", target: "_blank" }, plain, here)).toBe("browser");
    expect(routeTap({ href: "http://elsewhere/workspace/x" }, plain, here)).toBe("browser");
    expect(routeTap({ href: "not a url" }, plain, here)).toBe("browser");
  });

  it("reads the view's scope from the address", () => {
    expect(workspaceParts("/workspace")).toEqual([]);
    expect(workspaceParts("/workspace/")).toEqual([]);
    expect(workspaceParts("/workspace/projects/moon-garden/plans/first%20website")).toEqual(["projects", "moon-garden", "plans", "first website"]);
    expect(workspaceParts("/workspace/projects/%E0%A4%A")).toEqual(["projects", "%E0%A4%A"]);
    expect(workspaceParts(null)).toEqual([]);
  });
});

describe("narrowPlanSummaries", () => {
  const response: PlanSummariesResponse = { project: "demo", generatedAt: "2030-01-01", plans: { garden: { state: "fresh", planFresh: true, summary, actions: { plant: "fresh" } }, empty: { state: "missing", planFresh: false, summary: null, actions: {} } } };
  it("keeps one Plan with its Action text", () => {
    const narrowed = narrowPlanSummaries(response, { plan: "garden" });
    expect(Object.keys(narrowed.plans)).toEqual(["garden"]);
    expect(narrowed.plans.garden.summary?.actions).toHaveLength(1);
  });
  it("answers nothing for a Plan it doesn't have", () => {
    expect(narrowPlanSummaries(response, { plan: "gone" }).plans).toEqual({});
    expect(narrowPlanSummaries(response, { plan: "__proto__" }).plans).toEqual({});
  });
  it("drops only the per-Action text in a brief answer", () => {
    const brief = narrowPlanSummaries(response, { brief: true });
    expect(brief.plans.garden.summary).toMatchObject({ title: "Grow a garden", purpose: "Feed the street.", actions: [] });
    expect(brief.plans.garden.actions).toEqual({});
    expect(brief.plans.empty.summary).toBeNull();
  });
  it("changes nothing when nothing is asked", () => {
    expect(narrowPlanSummaries(response, {})).toEqual(response);
    expect(response.plans.garden.summary?.actions).toHaveLength(1);
  });
});
