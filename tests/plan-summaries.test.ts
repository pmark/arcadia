import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { actionFingerprint, checkPlanSummaries, comparePlanSummary, planFingerprint, readPlanSource, stampPlanSummary } from "../src/docs/planSummaries.js";

const plan = (milestone = "A garden on the web", why = "So it shows") => `---
arcadia: v1
type: plan
slug: garden
project: demo
status: active
milestone: ${milestone}
actions:
  - id: plant
    title: Plant the beds
    status: open
    why: ${why}
    acceptance_criteria:
      - Beds are planted.
  - id: water
    title: Water the beds
    status: open
    depends_on: [plant]
    acceptance_criteria:
      - Beds are watered.
---

# Garden

Grow food for the street.
`;

const authored = {
  written: "2030-01-01", author: "Clara (fixture)", title: "Grow a garden", purpose: "Feed the street.", serves: "The outcome.", done_when: "Food grows.",
  actions: [{ id: "plant", title: "Plant", why: "Nothing grows otherwise.", done_when: "Beds planted." }, { id: "water", title: "Water", why: "Plants need water.", done_when: "Beds watered." }]
};

let roots: string[] = [];
function repo(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "plan-summaries-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots = []; });

describe("Plan summary fingerprints", () => {
  it("are stable for identical input and ignore key order", () => {
    const a = readPlanSource("docs/plans/garden.md", plan())!;
    const b = readPlanSource("docs/plans/garden.md", plan())!;
    expect(planFingerprint(a)).toBe(planFingerprint(b));
    expect(actionFingerprint({ why: "x", id: "a", title: "t" })).toBe(actionFingerprint({ id: "a", title: "t", why: "x" }));
    expect(planFingerprint(a)).toMatch(/^[0-9a-f]{16}$/);
  });
  it("change when the milestone, body prose or an Action's why changes", () => {
    const base = readPlanSource("p.md", plan())!;
    expect(planFingerprint(readPlanSource("p.md", plan("A different milestone"))!)).not.toBe(planFingerprint(base));
    expect(planFingerprint(readPlanSource("p.md", plan().replace("Grow food", "Grow flowers"))!)).not.toBe(planFingerprint(base));
    expect(actionFingerprint(readPlanSource("p.md", plan(undefined, "Because"))!.actions[0])).not.toBe(actionFingerprint(base.actions[0]));
    expect(actionFingerprint(readPlanSource("p.md", plan(undefined, "Because"))!.actions[1])).toBe(actionFingerprint(base.actions[1]));
  });
  it("match a fixed vector, cross-checked with Python's json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)", () => {
    const golden = "---\narcadia: v1\ntype: plan\nslug: jardín\nproject: demo\nstatus: active\nmilestone: Un jardín — 庭 🌱\nactions:\n  - id: plant\n    title: Plant the beds\n    status: open\n    why: \"So it shows — “quoted”\"\n    acceptance_criteria:\n      - Beds are planted.\n---\n\n# Jardín\n\nGrow food for the street. 🌻\n";
    const source = readPlanSource("docs/plans/jardin.md", golden)!;
    expect(planFingerprint(source)).toBe("36b1f4b5fe9fe53c");
    expect(actionFingerprint(source.actions[0])).toBe("e1436f2efe84b04c");
  });
  it("ignore files that are not type: plan", () => {
    expect(readPlanSource("x.md", "# Just notes\n")).toBeNull();
    expect(readPlanSource("x.md", "---\narcadia: v1\ntype: decision\nslug: d\n---\n")).toBeNull();
  });
});

describe("Plan summary freshness", () => {
  it("reports fresh, then the exact stale Action, and an orphaned entry", () => {
    const source = readPlanSource("docs/plans/garden.md", plan())!;
    const summary = stampPlanSummary(source, authored);
    expect(comparePlanSummary(source, summary)).toMatchObject({ state: "fresh", orphaned: [] });
    const changed = readPlanSource("docs/plans/garden.md", plan(undefined, "Because"))!;
    expect(comparePlanSummary(changed, summary)).toMatchObject({ state: "stale", actions: [{ id: "plant", state: "stale" }, { id: "water", state: "fresh" }] });
    const extra = { ...summary, actions: [...summary.actions, { id: "gone", source_fingerprint: "0000000000000000", title: "Gone", why: "Old.", done_when: "Never." }] };
    expect(comparePlanSummary(source, extra).orphaned).toEqual(["gone"]);
  });
  it("reports missing and invalid summaries without throwing", () => {
    const source = readPlanSource("docs/plans/garden.md", plan())!;
    expect(comparePlanSummary(source, null)).toMatchObject({ state: "missing", actions: [{ state: "missing" }, { state: "missing" }] });
    expect(comparePlanSummary(source, { schema: "other" }).state).toBe("invalid");
    expect(comparePlanSummary(source, { ...stampPlanSummary(source, authored), plan: "another" }).state).toBe("invalid");
  });
  it("re-stamps with current fingerprints even when the authored input carries old ones", () => {
    const source = readPlanSource("docs/plans/garden.md", plan())!;
    const resubmitted = { ...authored, schema: "x", source: "elsewhere.md", source_fingerprint: "deadbeefdeadbeef" } as typeof authored;
    const summary = stampPlanSummary(source, resubmitted);
    expect(summary).toMatchObject({ schema: "arcadia-plan-summary-v1", source: "docs/plans/garden.md", source_fingerprint: planFingerprint(source) });
    expect(comparePlanSummary(source, summary).state).toBe("fresh");
  });
  it("keeps the Plan text fresh when only an Action changed", () => {
    const summary = stampPlanSummary(readPlanSource("docs/plans/garden.md", plan())!, authored);
    expect(comparePlanSummary(readPlanSource("docs/plans/garden.md", plan(undefined, "Because"))!, summary)).toMatchObject({ state: "stale", planFresh: true });
    expect(comparePlanSummary(readPlanSource("docs/plans/garden.md", plan("Another milestone"))!, summary)).toMatchObject({ state: "stale", planFresh: false });
  });
  it("refuses to stamp a summary whose Actions don't match the Plan", () => {
    const source = readPlanSource("docs/plans/garden.md", plan())!;
    expect(() => stampPlanSummary(source, { ...authored, actions: authored.actions.slice(0, 1) })).toThrow(/missing water/);
  });
  it("checks a repository read-only, counting every Plan and Action", () => {
    const source = readPlanSource("docs/plans/garden.md", plan())!;
    const root = repo({
      "docs/plans/garden.md": plan(),
      "docs/plans/notes.md": "# Not a plan\n",
      "docs/plans/nested/orchard.md": plan().replace("slug: garden", "slug: orchard"),
      "docs/generated/plan-summaries/garden.json": JSON.stringify(stampPlanSummary(source, authored)),
      "docs/generated/plan-summaries/orchard.json": "{not json",
      "docs/plans/odd.md": plan().replace("slug: garden", "slug: ../escape"),
      "docs/escape.json": JSON.stringify({ ...stampPlanSummary(source, authored), plan: "../escape" })
    });
    const report = checkPlanSummaries(root);
    expect(report.plans.map(p => [p.plan, p.state])).toEqual([["../escape", "invalid"], ["garden", "fresh"], ["orchard", "invalid"]]);
    expect(report.counts).toEqual({ fresh: 1, stale: 0, missing: 0, invalid: 2 });
    expect(report.actions).toEqual({ total: 6, fresh: 2, stale: 0, missing: 4 });
  });
});
