import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { ClarifyGrader, GraderInput } from "../src/clarify/grader.js";
import { loadGoldenCases, runGraderContract } from "./clarifyGraderContract.js";
import { passingGrader, stubGrader } from "./clarifyFixtures.js";

/**
 * Runs a grader against the golden set. Without configuration this proves the
 * harness itself: a reference stub that answers each case from its fixture
 * passes, and obviously wrong graders fail. To prove a replacement grader:
 *
 *   ARCADIA_GRADER_CANDIDATE=./path/to/grader.ts pnpm test:grader-contract
 *
 * where the module exports `grader` (or a default export) of type ClarifyGrader.
 */

const cases = loadGoldenCases();

/** Answers from the fixture itself, so it tests the harness and plumbing, not grading skill. */
const referenceGrader: ClarifyGrader = (input: GraderInput) => {
  const entry = cases.find(
    (candidate) =>
      candidate.nextAction === input.candidate.nextAction &&
      candidate.doneCondition === input.candidate.doneCondition &&
      // Two cases share a candidate and differ only in the source, which a grader sees too.
      JSON.stringify(candidate.source) === JSON.stringify(input.source)
  );
  if (!entry) {
    throw new Error("unknown case");
  }
  return entry.expected === "pass"
    ? passingGrader(input)
    : stubGrader({
        grade: "fail",
        failedCriteria: entry.failedCriteria,
        reason: "fixture",
        request: "What is the one missing item?"
      })(input);
};

describe("grader contract harness", () => {
  it("loads pass, lint-fail and grader-only cases", () => {
    const kinds = new Set(cases.map((entry) => entry.kind));
    expect([...kinds].sort()).toEqual(["grader-fail", "lint-fail", "pass"]);
    expect(new Set(cases.map((entry) => entry.name)).size).toBe(cases.length);
  });

  it("passes a grader that reproduces every expected verdict", async () => {
    const report = await runGraderContract(referenceGrader);
    expect(report.failures).toEqual([]);
    expect(report.total).toBe(cases.length);
  });

  it("fails a grader that passes everything", async () => {
    const report = await runGraderContract(passingGrader);
    expect(report.failures.length).toBe(cases.filter((entry) => entry.expected === "fail").length);
  });

  it("fails a grader that fails everything", async () => {
    const report = await runGraderContract(stubGrader({ grade: "fail", reason: "no", request: "What is missing?" }));
    expect(report.failures.length).toBeGreaterThanOrEqual(cases.filter((entry) => entry.expected === "pass").length);
  });

  it("fails a grader that names too few criteria or asks a list of questions", async () => {
    const noCriteria = await runGraderContract((input) =>
      referenceGrader(input).then((outcome) => ({ ...outcome, failedCriteria: [] }))
    );
    expect(noCriteria.failures.some((failure) => failure.problem.includes("failedCriteria"))).toBe(true);

    const manyQuestions = await runGraderContract((input) =>
      referenceGrader(input).then((outcome) =>
        outcome.grade === "fail" ? { ...outcome, request: "What is X? And what is Y?" } : outcome
      )
    );
    expect(manyQuestions.failures.some((failure) => failure.problem.includes("exactly one question"))).toBe(true);
  });

  it("reports a throwing grader per case instead of aborting", async () => {
    const report = await runGraderContract(async () => {
      throw new Error("boom");
    });
    expect(report.failures).toHaveLength(cases.length);
    expect(report.failures[0].problem).toContain("boom");
  });

  const candidate = process.env.ARCADIA_GRADER_CANDIDATE;
  it.runIf(Boolean(candidate))("passes the candidate grader named by ARCADIA_GRADER_CANDIDATE", async () => {
    const loaded = (await import(pathToFileURL(path.resolve(candidate as string)).href)) as {
      grader?: ClarifyGrader;
      default?: ClarifyGrader;
    };
    const grader = loaded.grader ?? loaded.default;
    expect(typeof grader, "the module must export `grader` or a default ClarifyGrader").toBe("function");
    const report = await runGraderContract(grader as ClarifyGrader);
    expect(report.failures).toEqual([]);
  });
});
