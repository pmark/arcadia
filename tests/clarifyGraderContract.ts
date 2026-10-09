import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ClarifyGrader, GraderInput } from "../src/clarify/grader.js";
import type { ClarifySourceMaterial } from "../src/clarify/lint.js";
import type { WorkItemSummary } from "../src/domain/types.js";

/**
 * The runnable grader contract. `tests/fixtures/clarify-golden/README.md` says
 * the golden set is the bar a deterministic replacement grader must clear; this
 * is the code that applies that bar. `runGraderContract` takes any
 * `ClarifyGrader` (a script, a smaller model, another prompt) and reports every
 * case it gets wrong. Run a candidate with `pnpm test:grader-contract` (see
 * tests/clarifyGraderContract.test.ts).
 */

export const GOLDEN_DIR = path.join(__dirname, "fixtures", "clarify-golden");

export interface GoldenCase {
  /** Where the case lives: a passing case, a lint-rejected case or a grader-only case. */
  kind: "pass" | "lint-fail" | "grader-fail";
  name: string;
  nextAction: string;
  doneCondition: string;
  actor: GraderInput["candidate"]["actor"];
  source: ClarifySourceMaterial;
  expected: "pass" | "fail";
  /** Criterion ids a grader-only case must name. Empty for the others. */
  failedCriteria: string[];
}

export interface ContractFailure {
  case: string;
  problem: string;
}

export interface ContractReport {
  total: number;
  failures: ContractFailure[];
}

function readCases(dir: string, kind: GoldenCase["kind"], prefix: string): GoldenCase[] {
  return readdirSync(dir)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Partial<GoldenCase>;
      return {
        kind,
        name: raw.name as string,
        nextAction: raw.nextAction as string,
        doneCondition: raw.doneCondition as string,
        actor: raw.actor ?? "coding-agent",
        source: raw.source ?? {},
        expected: raw.expected as "pass" | "fail",
        failedCriteria: raw.failedCriteria ?? []
      };
    });
}

export function loadGoldenCases(): GoldenCase[] {
  return [
    ...readCases(GOLDEN_DIR, "pass", "pass-"),
    ...readCases(GOLDEN_DIR, "lint-fail", "fail-"),
    ...readCases(path.join(GOLDEN_DIR, "grader-only"), "grader-fail", "fail-")
  ];
}

function inputFor(entry: GoldenCase): GraderInput {
  const workItem = { id: `golden-${entry.name}`, title: entry.source.title ?? entry.name, project_id: null } as WorkItemSummary;
  return {
    workItem,
    candidate: { nextAction: entry.nextAction, doneCondition: entry.doneCondition, actor: entry.actor },
    source: entry.source
  };
}

/** Grade every golden case and report each place the grader departs from its `expected`. */
export async function runGraderContract(grader: ClarifyGrader, cases: GoldenCase[] = loadGoldenCases()): Promise<ContractReport> {
  const failures: ContractFailure[] = [];

  for (const entry of cases) {
    let outcome;
    try {
      outcome = await grader(inputFor(entry));
    } catch (error) {
      failures.push({ case: entry.name, problem: `grader threw: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }

    if (outcome.grade !== entry.expected) {
      failures.push({ case: entry.name, problem: `expected ${entry.expected}, got ${outcome.grade}` });
      continue;
    }
    if (outcome.grade === "pass") {
      continue;
    }

    // On a fail: every named criterion, and exactly one single-question request.
    const missing = entry.failedCriteria.filter((id) => !outcome.failedCriteria.includes(id));
    if (missing.length > 0) {
      failures.push({ case: entry.name, problem: `failedCriteria is missing ${missing.join(", ")}` });
    }
    const request = outcome.request?.trim() ?? "";
    if (!request) {
      failures.push({ case: entry.name, problem: "a fail must carry one information request" });
    } else if ((request.match(/\?/g) ?? []).length !== 1 || !request.endsWith("?")) {
      failures.push({ case: entry.name, problem: `request must be exactly one question, got ${JSON.stringify(request)}` });
    }
  }

  return { total: cases.length, failures };
}
