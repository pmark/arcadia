import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  enforceClarifyLint,
  extractReferences,
  lintClarifiedVerdict,
  startsWithVerb,
  type ClarifyLintCode,
  type ClarifySourceMaterial
} from "../src/clarify/lint.js";
import type { ClarifiedVerdict } from "../src/clarify/types.js";

interface GoldenCase {
  name: string;
  reason: string;
  nextAction: string;
  doneCondition: string;
  source: ClarifySourceMaterial;
  expected: "pass" | "fail";
  expectedFindings: ClarifyLintCode[];
}

const GOLDEN_DIR = path.join(__dirname, "fixtures", "clarify-golden");

function loadGolden(): GoldenCase[] {
  return readdirSync(GOLDEN_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(GOLDEN_DIR, file), "utf8")) as GoldenCase);
}

function clarified(nextAction: string, doneCondition: string): ClarifiedVerdict {
  return { verdict: "clarified", nextAction, doneCondition, actor: "coding-agent", source: "title", confidence: "high" };
}

describe("clarify lint golden set", () => {
  const cases = loadGolden();

  it("holds at least ten hand-written cases, with both outcomes", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.some((entry) => entry.expected === "pass")).toBe(true);
    expect(cases.some((entry) => entry.expected === "fail")).toBe(true);
    expect(new Set(cases.map((entry) => entry.name)).size).toBe(cases.length);
    for (const entry of cases) {
      expect(entry.reason.length, entry.name).toBeGreaterThan(0);
    }
  });

  for (const entry of cases) {
    it(`${entry.expected}s: ${entry.name}`, () => {
      const verdict = clarified(entry.nextAction, entry.doneCondition);
      const result = lintClarifiedVerdict(verdict, entry.source);

      expect(result.passed).toBe(entry.expected === "pass");
      expect(result.findings.map((finding) => finding.code)).toEqual(entry.expectedFindings);

      const enforced = enforceClarifyLint(verdict, entry.source);
      if (entry.expected === "pass") {
        expect(enforced.verdict).toEqual(verdict);
      } else {
        expect(enforced.verdict.verdict).toBe("question_open");
        if (enforced.verdict.verdict === "question_open") {
          // Exactly one question, never a list.
          expect(enforced.verdict.question.match(/\?/g)).toHaveLength(1);
        }
      }
    });
  }
});

describe("clarify lint rules", () => {
  it("downgrades a missing done-condition to the missing-success-criteria question", () => {
    const { verdict, findings } = enforceClarifyLint(clarified("Add a retry", ""), { title: "Add a retry" });

    expect(findings.map((finding) => finding.code)).toEqual(["missing-done-condition"]);
    expect(verdict).toMatchObject({ verdict: "question_open", gapType: "missing-success-criteria" });
    expect((verdict as { question: string }).question).toContain("done-condition");
  });

  it("names every problem in one question when several are found", () => {
    const { verdict } = enforceClarifyLint(clarified("The sync fixes in src/sync/ghost.ts", ""), { title: "Sync" });

    expect(verdict.verdict).toBe("question_open");
    const question = (verdict as { question: string }).question;
    expect(question).toContain("done-condition");
    expect(question).toContain("open with a verb");
    expect(question).toContain("src/sync/ghost.ts");
  });

  it("passes question_open verdicts through untouched", () => {
    const question = { verdict: "question_open" as const, gapType: "missing-decision" as const, question: "Which one?" };
    expect(enforceClarifyLint(question, {})).toEqual({ verdict: question, findings: [] });
  });

  it("accepts any opening except clearly non-imperative ones", () => {
    for (const accepted of [
      "Add a retry", "  `Run` the monitor", "RUN, then stop", "Harden the sync", "Reconcile both", "Prove it",
      "Render the list", "Retire the flag", "Bring it in line", "`arcadia go` and read the brief", "Re-run the tests"
    ]) {
      expect(startsWithVerb(accepted), accepted).toBe(true);
    }
    for (const rejected of [
      "Fixing the sync", "The sync retries", "A retry", "This is broken", "Maybe add a retry", "After the merge, add it",
      "If it fails, retry", "We should retry", "What is the quota", "TBD", "", "   "
    ]) {
      expect(startsWithVerb(rejected), rejected).toBe(false);
    }
  });

  it("extracts paths, Action ids, Decision ids and arcadia commands, and ignores prose", () => {
    const labels = extractReferences(
      "Edit `src/a/b.ts` and package.json per Action grade-next-actions-before-actionable and Decisions 0060 and 80, " +
        "then run arcadia work monitor --no-pull-requests. See https://x.test/y/z.md and client/server and/or e.g. this."
    ).map((reference) => reference.label);

    expect(labels.sort()).toEqual(
      [
        "Action grade-next-actions-before-actionable",
        "Decision 0060",
        "Decision 0080",
        "arcadia work",
        "package.json",
        "src/a/b.ts"
      ].sort()
    );
  });

  it("matches the program and first subcommand only, so flags need not be in the source", () => {
    const result = lintClarifiedVerdict(clarified("Run arcadia work monitor --no-pull-requests", "Output is saved"), {
      rawInput: "run the arcadia work command"
    });
    expect(result.passed).toBe(true);
  });

  it("does not let a longer Decision number satisfy a shorter one", () => {
    const result = lintClarifiedVerdict(clarified("Apply Decision 92", "Done"), { rawInput: "Decision 192 says so" });
    expect(result.passed).toBe(false);
  });
});
