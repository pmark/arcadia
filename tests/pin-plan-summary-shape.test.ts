import { describe, expect, it } from "vitest";

import { isPlanSummary } from "../src/docs/planSummaries.js";

const action = { id: "a1", source_fingerprint: "abc123", title: "Do it", why: "Because", done_when: "Done" };
const summary = {
  schema: "arcadia-plan-summary-v1",
  generated: true,
  plan: "demo-plan",
  source: "docs/plans/demo-plan.md",
  source_fingerprint: "def456",
  written: "2026-11-28",
  author: "Claudia Atlas",
  title: "Demo Plan",
  purpose: "Show the shape",
  serves: "Tests",
  done_when: "All pass",
  actions: [action]
};

describe("isPlanSummary", () => {
  it("accepts a complete summary with one full Action", () => {
    expect(isPlanSummary(summary)).toBe(true);
  });

  it.each([
    ["a wrong schema", { ...summary, schema: "arcadia-plan-summary-v2" }],
    ["a title of two spaces", { ...summary, title: "  " }],
    ["an Action with only an id", { ...summary, actions: [{ id: "a1" }] }],
    ["an empty source_fingerprint", { ...summary, source_fingerprint: "" }],
    ["null", null]
  ])("rejects %s", (_label, value) => {
    expect(isPlanSummary(value)).toBe(false);
  });
});
