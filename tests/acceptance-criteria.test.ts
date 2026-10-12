import { describe, expect, it } from "vitest";
import { evaluateAcceptanceCriteria, renderAcceptanceCriteriaReport } from "../src/stewardship/acceptanceCriteria.js";

const ARTIFACT_TEXT = [
  "# Deterministic Stewardship Artifact Validation Plan",
  "",
  "## Ordered Phases",
  "1. Contract extraction: parse the originating planning packet sections.",
  "",
  "## Repository Impact Assessment",
  "- Primary area: `src/stewardship` deterministic validation module.",
  "",
  "## Validation Strategy",
  "- Use deterministic fixtures for pass, failure, and warning cases."
].join("\n");

describe("evaluateAcceptanceCriteria", () => {
  it("reports unmet when none of a criterion's key terms appear anywhere in the Artifact", () => {
    const results = evaluateAcceptanceCriteria(
      ["The migration adds a rollback script."],
      ARTIFACT_TEXT
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      criterion: "The migration adds a rollback script.",
      status: "unmet"
    });
    expect(results[0].reason).toContain("migration");
  });

  it("reports unchecked, never met, when the criterion's terms are present", () => {
    const results = evaluateAcceptanceCriteria(
      ["The plan includes a repository impact assessment."],
      ARTIFACT_TEXT
    );

    expect(results[0].status).toBe("unchecked");
    expect(results.some((result) => result.status === "met")).toBe(false);
  });

  it("never produces met, regardless of how closely the text matches", () => {
    // Even a criterion quoting the Artifact's own heading verbatim only earns
    // "unchecked" -- presence is not proof the claim is true, and this
    // checker does not invent judgment to bridge that gap.
    const results = evaluateAcceptanceCriteria(
      ['The artifact has an "Ordered Phases" section with contract extraction.'],
      ARTIFACT_TEXT
    );

    expect(results[0].status).toBe("unchecked");
  });

  it("reports unchecked when a criterion has no distinctive terms to search for", () => {
    const results = evaluateAcceptanceCriteria(["It is done."], ARTIFACT_TEXT);

    expect(results[0].status).toBe("unchecked");
    expect(results[0].reason).toContain("no distinctive terms");
  });

  it("preserves the plan author's order and exact wording", () => {
    const criteria = ["The migration is idempotent.", "The command is covered by a test."];
    const results = evaluateAcceptanceCriteria(criteria, ARTIFACT_TEXT);

    expect(results.map((result) => result.criterion)).toEqual(criteria);
  });

  it("returns nothing for an empty criteria list", () => {
    expect(evaluateAcceptanceCriteria([], ARTIFACT_TEXT)).toEqual([]);
  });
});

describe("renderAcceptanceCriteriaReport", () => {
  it("renders one line per criterion, in the plan author's words", () => {
    const results = evaluateAcceptanceCriteria(
      ["The migration adds a rollback script.", "The plan includes a repository impact assessment."],
      ARTIFACT_TEXT
    );

    const report = renderAcceptanceCriteriaReport(results);

    expect(report).toContain("Acceptance criteria:");
    expect(report).toContain('- unmet: "The migration adds a rollback script."');
    expect(report).toContain('- unchecked: "The plan includes a repository impact assessment."');
  });

  it("renders nothing for an empty result list", () => {
    expect(renderAcceptanceCriteriaReport([])).toBe("");
  });
});
