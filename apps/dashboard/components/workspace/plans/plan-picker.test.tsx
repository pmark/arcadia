import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AllPlansResponse, PlanRow } from "../../../lib/plans-types";

const requested: Array<string | null> = [];
let answer: AllPlansResponse;
vi.mock("../use-read", () => ({ useRead: (url: string | null) => { requested.push(url); return { kind: "ready", data: answer }; } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/plans" }));
import { PlanPicker } from "./plan-picker";

interface FixturePlan { slug: string; status: string; milestone: string | null; updated: string | null; actionCounts: PlanRow["actionCounts"] }
const fixture = JSON.parse(readFileSync(new URL("../../../lib/__fixtures__/arcadia-plans.json", import.meta.url), "utf8")) as { plans: FixturePlan[] };
const rows: PlanRow[] = fixture.plans.map(p => ({ slug: p.slug, status: p.status, governed: true, milestone: p.milestone, isActivePlan: false, actionCounts: p.actionCounts, activationNote: null, relativePath: `docs/plans/${p.slug}.md`, updated: p.updated }));
answer = { generatedAt: "2026-11-22T00:00:00Z", projects: [
  { id: "i1", slug: "arcadia", name: "Arcadia", status: "active", activePlan: null, plans: rows, error: null },
  { id: "i2", slug: "other", name: "Other", status: "active", activePlan: null, plans: [{ ...rows[0], slug: "other-plan", milestone: "Unrelated zebra work", status: "proposed", actionCounts: null }], error: null }
] };

const listed = (html: string) => (html.match(/class="plan-picker-item"/g) ?? []).length;

describe("PlanPicker", () => {
  it("makes exactly one /api/plans read on first paint and no other request", () => {
    requested.length = 0;
    renderToStaticMarkup(<PlanPicker />);
    expect(requested).toEqual(["/api/plans"]);
  });
  it("lists Plans across Projects and flags done-but-not-closed and likely duplicates with scores", () => {
    const html = renderToStaticMarkup(<PlanPicker />);
    expect(listed(html)).toBe(rows.length + 1);
    expect(html).toContain("Done but not closed");
    expect(html).toMatch(/Likely duplicate of .*similarity 0\.\d\d/);
  });
  it("shows proposed Plans and filters by status, Project and progress", () => {
    expect(listed(renderToStaticMarkup(<PlanPicker initial={{ filters: { status: "proposed" } }} />))).toBe(1 + rows.filter(r => r.status === "proposed").length);
    expect(listed(renderToStaticMarkup(<PlanPicker initial={{ filters: { project: "other" } }} />))).toBe(1);
    const done = renderToStaticMarkup(<PlanPicker initial={{ filters: { progress: "done" } }} />);
    expect(done).not.toContain("Unrelated zebra work");
    expect(listed(done)).toBeGreaterThan(0);
  });
  it("sorts by last update, progress and queue position", () => {
    const first = (sort: "updated" | "progress" | "queue") => /class="plan-picker-title"[^>]*>([^<]*)</.exec(renderToStaticMarkup(<PlanPicker initial={{ sort }} />))?.[1];
    const updated = first("updated"); const progress = first("progress"); const queue = first("queue");
    expect(updated).toBeTruthy();
    expect(progress).toBeTruthy();
    expect(queue).toBeTruthy();
    // Different orderings give different leaders over the real fixture: newest update, furthest progress, first by slug.
    expect(new Set([updated, progress, queue]).size).toBeGreaterThan(1);
  });
  it("groups with a heading per group", () => {
    const html = renderToStaticMarkup(<PlanPicker initial={{ group: "status" }} />);
    expect(html).toContain('aria-label="draft"');
    expect(html).toContain('aria-label="proposed"');
  });
});
