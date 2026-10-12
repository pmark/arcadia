import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { validateAcceptanceCriteria } from "../src/docs/acceptanceCriteria.js";
import { parseDoc } from "../src/docs/parse.js";

function plan(criteria: unknown, status = "open", clarification = "clarified") {
  return "---\n" + stringify({
    arcadia: "v1", type: "plan", slug: "criteria", project: "demo", status: "draft",
    milestone: "Check all Actions", token_impact: "none", token_budget: "Deterministic checks only.",
    actions: [{ id: "non-current", title: "Exercise the criterion", status, responsibility: "requires_review",
      clarification, ...(clarification === "question_open" ? { question: "Which limit?", gap_type: "missing-decision" } : { next_action: "Run the fixture." }),
      acceptance_criteria: criteria }], updated: "2026-10-12"
  }) + "---\n";
}

describe("acceptance criteria on every Plan Action", () => {
  it.each(["open", "in_progress", "done", "blocked", "deferred"])("rejects missing criteria on a non-current %s Action", (status) => {
    const result = parseDoc("criteria.md", "/tmp/criteria.md", plan(undefined, status));
    expect(result.doc).toBeNull();
    expect(result.errors).toContainEqual(expect.objectContaining({ field: "actions[0].acceptance_criteria" }));
  });
  it.each(["unclarified", "question_open"])("does not exempt %s Actions", (clarification) => {
    const result = parseDoc("criteria.md", "/tmp/criteria.md", plan([], "open", clarification));
    expect(result.errors.some((e) => e.field === "actions[0].acceptance_criteria")).toBe(true);
  });
  it.each(["missing", 42, [""], [null], [42], [{ result: "Pass" }]])("rejects malformed criteria without dropping entries: %j", (criteria) => {
    const result = parseDoc("criteria.md", "/tmp/criteria.md", plan(criteria));
    expect(result.doc).toBeNull();
    expect(result.errors.some((e) => e.field.startsWith("actions[0].acceptance_criteria"))).toBe(true);
  });
  it.each(["Works correctly.", "The product is high-quality.", "The product is excellent.", "Improve the product so every user loves it.", "The UI is beautiful.", "The feature will delight users.", "The product has a nice design.", "Complete", "Pass", "Required", "Visible", "TBD", "<REPLACE: criterion>", "Implement the feature.", "The probe is refused within the probe token budget."])("rejects an uncheckable condition: %s", (criterion) => {
    expect(validateAcceptanceCriteria([criterion])).not.toEqual([]);
  });
  it("rejects normalized duplicate conditions", () => {
    expect(validateAcceptanceCriteria(["The command exits zero.", " the COMMAND exits zero "])).toContainEqual(expect.objectContaining({ index: 1 }));
  });
  it("accepts reproducible success, refusal, threshold and Decision conditions", () => {
    const criteria = [
      "Running pnpm test tests/migration.test.ts exits zero; two migrations leave exactly one status column.",
      "Proof exists.",
      "p95<=100ms",
      "A probe fixture returns environment_wall within its 1,000 input tokens probe token budget and records exactly one launch.",
      "Opening /todo exposes the registered reset-repair-budget operator script.",
      "A Decision records the operator-selected limit; the Action remains question_open until the answer is recorded."
    ];
    expect(validateAcceptanceCriteria(criteria)).toEqual([]);
    expect(parseDoc("criteria.md", "/tmp/criteria.md", plan(criteria, "done")).errors).toEqual([]);
  });
});
