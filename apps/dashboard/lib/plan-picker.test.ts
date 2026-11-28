import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AllPlansResponse, PlanRow } from "./plans-types";
import {
  DUPLICATE_LOOSE_OVERLAP_THRESHOLD, DUPLICATE_OVERLAP_THRESHOLD, duplicatesByPlan, filterPlans, groupPlans, isDoneButNotClosed,
  isLikelyDuplicate, likelyDuplicatePairs, planSimilarity, sortPlans, toPickerPlans, DEFAULT_FILTERS
} from "./plan-picker";

interface FixturePlan { slug: string; status: string; milestone: string | null; updated: string | null; actionCounts: PlanRow["actionCounts"] }
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/arcadia-plans.json", import.meta.url), "utf8")) as { plans: FixturePlan[] };

const row = (slug: string, status: string, extra: Partial<PlanRow> = {}): PlanRow =>
  ({ slug, status, governed: true, milestone: null, isActivePlan: false, actionCounts: null, activationNote: null, relativePath: `docs/plans/${slug}.md`, updated: null, ...extra });
const counts = (done: number, open = 0, deferred = 0) => ({ open, in_progress: 0, done, blocked: 0, deferred });
const NOW = new Date("2026-11-22T12:00:00Z");
const response = (...projects: Array<{ slug: string; plans: PlanRow[] }>): AllPlansResponse => ({
  generatedAt: NOW.toISOString(),
  projects: projects.map(p => ({ id: `id-${p.slug}`, slug: p.slug, name: p.slug.toUpperCase(), status: "active", activePlan: null, plans: p.plans, error: null }))
});
const arcadia = (): AllPlansResponse => response({ slug: "arcadia", plans: fixture.plans.map(p => row(p.slug, p.status, { milestone: p.milestone, updated: p.updated, actionCounts: p.actionCounts })) });

const A = "let-the-operator-change-what-production-queues-from-the-production-project";
const B = "ask-queues-approved-work-or-admits-bounded-independent-sessions-without";
const C = "add-the-missing-plans-project-dashboard-route-that-lists-one-project-s-plans";
const D = "i-can-see-every-project-s-plans-and-actions-understand-what-is-selected-and";

describe("plan picker: filters", () => {
  const plans = toPickerPlans(response(
    { slug: "alpha", plans: [row("a-draft", "draft", { actionCounts: counts(0, 2), updated: "2026-11-20" }), row("a-active", "active", { isActivePlan: true, actionCounts: counts(1, 1), updated: "2026-11-21" }), row("a-done", "complete", { actionCounts: counts(2), updated: "2026-10-01" })] },
    { slug: "beta", plans: [row("b-proposed", "proposed", { governed: false }), row("b-super", "superseded", { actionCounts: counts(1, 0, 1), updated: "2026-09-01" })] }
  ), NOW);
  const slugs = (list: typeof plans) => list.map(p => p.row.slug).sort();

  it("filters by every status, including proposed (displayed, not dropped)", () => {
    for (const [status, want] of [["draft", ["a-draft"]], ["proposed", ["b-proposed"]], ["active", ["a-active"]], ["complete", ["a-done"]], ["superseded", ["b-super"]]] as const)
      expect(slugs(filterPlans(plans, { ...DEFAULT_FILTERS, status }))).toEqual(want);
    expect(filterPlans(plans, DEFAULT_FILTERS)).toHaveLength(5);
  });
  it("filters by Project", () => {
    expect(slugs(filterPlans(plans, { ...DEFAULT_FILTERS, project: "beta" }))).toEqual(["b-proposed", "b-super"]);
  });
  it("filters by progress", () => {
    expect(slugs(filterPlans(plans, { ...DEFAULT_FILTERS, progress: "none" }))).toEqual(["a-draft"]);
    expect(slugs(filterPlans(plans, { ...DEFAULT_FILTERS, progress: "partial" }))).toEqual(["a-active"]);
    expect(slugs(filterPlans(plans, { ...DEFAULT_FILTERS, progress: "done" }))).toEqual(["a-done", "b-super"]);
  });
  it("sorts by last update (undated last), progress and queue position (active first)", () => {
    expect(sortPlans(plans, "updated").map(p => p.row.slug)).toEqual(["a-active", "a-draft", "a-done", "b-super", "b-proposed"]);
    expect(sortPlans(plans, "progress").map(p => p.row.slug)).toEqual(["a-done", "b-super", "a-active", "a-draft", "b-proposed"]);
    expect(sortPlans(plans, "queue").map(p => p.row.slug)[0]).toBe("a-active");
  });
  it("groups by status, Project and staleness", () => {
    expect(groupPlans(plans, "status").map(g => g.key)).toEqual(["draft", "proposed", "active", "complete", "superseded"]);
    expect(groupPlans(plans, "project").map(g => g.key)).toEqual(["alpha", "beta"]);
    const stale = Object.fromEntries(groupPlans(plans, "stale").map(g => [g.key, g.plans.map(p => p.row.slug).sort()]));
    expect(stale).toEqual({ fresh: ["a-active", "a-draft"], stale: ["a-done", "b-super"], unknown: ["b-proposed"] });
  });
});

describe("plan picker: done but not closed", () => {
  const find = (slug: string) => fixture.plans.find(p => p.slug === slug)!;
  it("flags guard-against-paid-usage and record-run-unattended-test-pins-20261107 (all Actions done, still draft)", () => {
    for (const slug of ["guard-against-paid-usage", "record-run-unattended-test-pins-20261107"]) {
      const p = find(slug);
      expect(p.status).toBe("draft");
      expect(isDoneButNotClosed(row(slug, p.status, { actionCounts: p.actionCounts }))).toBe(true);
    }
  });
  it("counts deferred as finished, and never flags a complete, active or unfinished Plan", () => {
    expect(isDoneButNotClosed(row("x", "proposed", { actionCounts: counts(1, 0, 1) }))).toBe(true);
    expect(isDoneButNotClosed(row("x", "complete", { actionCounts: counts(2) }))).toBe(false);
    expect(isDoneButNotClosed(row("x", "active", { actionCounts: counts(2) }))).toBe(false);
    expect(isDoneButNotClosed(row("x", "draft", { actionCounts: counts(1, 1) }))).toBe(false);
    expect(isDoneButNotClosed(row("x", "draft", { actionCounts: null }))).toBe(false);
  });
});

describe("plan picker: likely duplicates (isLikelyDuplicate)", () => {
  const by = (slug: string) => { const p = fixture.plans.find(f => f.slug === slug)!; return { slug, milestone: p.milestone }; };
  it("flags the two named pairs and not guard-against-paid-usage vs record-run-unattended-test-pins-20261107", () => {
    const pairs: Array<[string, string, boolean]> = [[A, B, true], [C, D, true], ["guard-against-paid-usage", "record-run-unattended-test-pins-20261107", false]];
    for (const [x, y, flagged] of pairs) {
      const verdict = isLikelyDuplicate(by(x), by(y));
      // The score is printed so a threshold change is reviewed against real data.
      console.log(`similarity ${verdict.score.toFixed(3)} ${flagged ? "FLAGGED" : "not flagged"}: ${x} | ${y}`);
      expect(verdict.duplicate).toBe(flagged);
    }
    expect(DUPLICATE_OVERLAP_THRESHOLD).toBe(0.4);
    expect(DUPLICATE_LOOSE_OVERLAP_THRESHOLD).toBe(0.15);
  });
  it("is symmetric and scores identical text as 1", () => {
    expect(planSimilarity(by(A), by(B))).toEqual(planSimilarity(by(B), by(A)));
    expect(planSimilarity(by(A), by(A)).score).toBe(1);
  });
  it("finds the pairs over the whole fixture, and a Plan lists its matches by Project", () => {
    const plans = toPickerPlans(arcadia(), NOW);
    const pairs = likelyDuplicatePairs(plans);
    const has = (x: string, y: string) => pairs.some(p => (p.a === x && p.b === y) || (p.a === y && p.b === x));
    expect(has(A, B)).toBe(true);
    expect(has(C, D)).toBe(true);
    expect(has("guard-against-paid-usage", "record-run-unattended-test-pins-20261107")).toBe(false);
    expect(duplicatesByPlan(plans).get(`arcadia/${A}`)?.length).toBeGreaterThan(0);
  });
  it("compares Plans only within one Project, and ignores finished Plans", () => {
    const plans = toPickerPlans(response(
      { slug: "p1", plans: [row("one", "draft", { milestone: "Ship the queue controls dashboard" }), row("fin", "complete", { milestone: "Ship the queue controls dashboard" })] },
      { slug: "p2", plans: [row("two", "draft", { milestone: "Ship the queue controls dashboard" })] }
    ), NOW);
    expect(likelyDuplicatePairs(plans)).toEqual([]);
  });
});
