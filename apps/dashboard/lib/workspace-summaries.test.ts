import { describe, expect, it } from "vitest";
import type { PlanSummariesResponse } from "./plans-types";
import { actionSummaryView, planSummaryView } from "./workspace-summaries";

const summary = {
  schema: "arcadia-plan-summary-v1" as const, generated: true as const, plan: "garden", source: "docs/plans/garden.md", source_fingerprint: "a", written: "2030-01-01", author: "Clara",
  title: "Grow a garden", purpose: "Feed the street.", serves: "The outcome.", done_when: "Food grows.", reading_note: "Mostly done.",
  actions: [{ id: "plant", source_fingerprint: "b", title: "Plant", why: "Nothing grows otherwise.", done_when: "Beds planted.", note: "Needs seeds." }, { id: "water", source_fingerprint: "c", title: "Water", why: "Plants need water.", done_when: "Watered." }]
};
const response = (state: "fresh" | "stale", actions: Record<string, "fresh" | "stale" | "missing">, planFresh = state === "fresh"): PlanSummariesResponse =>
  ({ project: "demo", generatedAt: "2030-01-01", plans: { garden: { state, planFresh, summary, actions }, empty: { state: "missing", planFresh: false, summary: null, actions: { x: "missing" } } } });

describe("workspace summary views", () => {
  it("shows a fresh Plan summary and each Action's why", () => {
    const r = response("fresh", { plant: "fresh", water: "fresh" });
    expect(planSummaryView(r, "garden")).toEqual({ title: "Grow a garden", purpose: "Feed the street.", serves: "The outcome.", doneWhen: "Food grows.", readingNote: "Mostly done.", stale: false });
    expect(actionSummaryView(r, "garden", "plant")).toEqual({ title: "Plant", why: "Nothing grows otherwise.", doneWhen: "Beds planted.", note: "Needs seeds.", stale: false });
  });
  it("labels only the Action whose record changed as stale", () => {
    const r = response("stale", { plant: "stale", water: "fresh" }, true);
    expect(planSummaryView(r, "garden")?.stale).toBe(false);
    expect(actionSummaryView(r, "garden", "plant")?.stale).toBe(true);
    expect(actionSummaryView(r, "garden", "water")?.stale).toBe(false);
  });
  it("labels the Plan text stale only when the Plan's own record changed", () => {
    expect(planSummaryView(response("stale", { plant: "fresh", water: "fresh" }, false), "garden")?.stale).toBe(true);
  });
  it("falls back to the record when there is no summary", () => {
    const r = response("fresh", { plant: "fresh", water: "fresh" });
    expect(planSummaryView(r, "empty")).toBeNull();
    expect(planSummaryView(r, "unknown")).toBeNull();
    expect(planSummaryView(null, "garden")).toBeNull();
    expect(actionSummaryView(r, "garden", "gone")).toBeNull();
    expect(actionSummaryView(r, "garden", undefined)).toBeNull();
  });
});
