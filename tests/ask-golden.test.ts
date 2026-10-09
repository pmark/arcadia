import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { findAskMemo, recordAskCorrection } from "../src/ask/corrections.js";
import { GOLDEN_RELATIVE_PATH, GoldenSetError, parseGoldenCases, type GoldenCase } from "../src/ask/goldenCases.js";
import { replayAsk } from "../src/ask/goldenReplay.js";
import { runAskCommand } from "../src/commands/ask.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, createReviewItem, upsertProjectMetadata } from "../src/db/repositories.js";
import { applyInitialSchema } from "../src/db/schema.js";
import type { IntakeWorkspaceContext } from "../src/intake/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * The Ask golden set (Plan Action ask-golden-set-and-vanish-report). Every case in tests/fixtures/ask-golden.jsonl is
 * replayed through the pure intake, memo and stewardship functions and must come out as expected, so a change that
 * makes a known Ask route differently fails CI. The same cases also run through the real `arcadia ask` to prove the
 * replay and the command agree, so the replay cannot quietly drift from what operators get.
 */
const REPO_ROOT = path.resolve(__dirname, "..");
const cases: GoldenCase[] = parseGoldenCases(readFileSync(path.join(REPO_ROOT, GOLDEN_RELATIVE_PATH), "utf8"));

const PROJECTS = [
  { name: "Arcadia", alias: "Arcadia" },
  { name: "Living Songbook", alias: "Songbook" }
];

const context: IntakeWorkspaceContext = {
  projects: PROJECTS.map((project) => ({
    id: `project_${project.alias.toLowerCase()}`,
    name: project.name,
    goal: "Fixture goal.",
    aliases: [project.alias, project.name],
    activeMilestoneId: null,
    activeMilestoneTitle: null
  })),
  recentActivity: []
};

/** An in-memory database holding only the case's seeded corrections: the memo lookup is the real `findAskMemo`. */
function memoDatabase(golden: GoldenCase): Database.Database {
  const db = new Database(":memory:");
  applyInitialSchema(db);
  for (const correction of golden.corrections ?? []) {
    recordAskCorrection(db, {
      askRequestId: "ask_seeded",
      text: correction.text,
      predictedType: "unclear",
      correctedType: correction.type,
      correctedProject: null,
      source: correction.source ?? "cli"
    });
  }
  return db;
}

describe("the golden set file", () => {
  it("covers every routing outcome the Plan names", () => {
    const has = (predicate: (golden: GoldenCase) => boolean) => cases.some(predicate);
    expect(has((c) => c.expected_type === "work" && c.expected_path !== "Requires Review")).toBe(true);
    expect(has((c) => c.expected_type === "idea")).toBe(true);
    expect(has((c) => c.expected_type === "status")).toBe(true);
    expect(has((c) => c.expected_type === "unclear" && c.expected_path === "Clarify First")).toBe(true);
    expect(has((c) => c.expected_path === "Requires Review")).toBe(true);
    expect(has((c) => c.expected_type === "answer")).toBe(true);
    expect(has((c) => c.expected_memo === true)).toBe(true);
    expect(has((c) => (c.corrections?.length ?? 0) > 0 && c.expected_memo === false)).toBe(true);
  });

  it("has unique ids, and a memo hit repeats a seeded correction exactly", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const golden of cases.filter((c) => c.expected_memo)) {
      expect(golden.corrections?.map((c) => c.text.trim().toLowerCase())).toContain(golden.text.trim().toLowerCase());
    }
  });

  it("fails loudly on a malformed or unknown case instead of skipping it", () => {
    expect(() => parseGoldenCases("{not json}")).toThrow(GoldenSetError);
    expect(() => parseGoldenCases('{"id":"a","text":"x","expected_type":"banana"}')).toThrow(/expected_type/);
    expect(() => parseGoldenCases('{"id":"a","text":"","expected_type":"work"}')).toThrow(/text/);
    const line = '{"id":"a","text":"x","expected_type":"work"}';
    expect(() => parseGoldenCases(`${line}\n${line}`)).toThrow(/duplicate id/);
  });
});

describe("pure replay of the golden set", () => {
  it.each(cases.map((golden) => [golden.id, golden] as const))("%s", (_id, golden) => {
    const db = memoDatabase(golden);
    try {
      const replayed = replayAsk(golden.text, { context, memo: (text) => findAskMemo(db, text) });
      expect({ type: replayed.type, memo: replayed.memo }).toEqual({ type: golden.expected_type, memo: golden.expected_memo ?? false });
      if (golden.expected_path) expect(replayed.path).toBe(golden.expected_path);
    } finally {
      db.close();
    }
  });
});

describe("the replay agrees with the real arcadia ask", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function freshWorkspace(golden: GoldenCase): string {
    const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-ask-golden-"));
    roots.push(workspace);
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      for (const project of PROJECTS) {
        const created = createProjectWithInitialWork(db, {
          name: project.name,
          mission: "Fixture project.",
          goal: "Fixture goal.",
          status: "active",
          currentMilestone: "Fixture",
          nextAction: "Fixture next action.",
          workClassification: "agent"
        });
        upsertProjectMetadata(db, {
          projectId: created.project.id,
          aliases: [project.alias],
          repoPath: workspace,
          validationCommands: ["node -e \"process.exit(0)\""]
        });
      }
      // A reply names a Decision by its number (R12), so those Decisions must exist for the real command to answer one.
      if (golden.expected_type === "answer") {
        for (let index = 1; index <= 12; index += 1) {
          createReviewItem(db, {
            decisionNeeded: `Fixture question ${index}`,
            recommendation: "Decide.",
            sourceInput: `fixture source ${index}`,
            proposedAction: "Decide",
            resolvedIntent: "SomethingElse",
            confidenceLabel: "low",
            confidence: 0.1,
            missingFields: [],
            context: {}
          });
        }
      }
      for (const correction of golden.corrections ?? []) {
        recordAskCorrection(db, {
          askRequestId: "ask_seeded",
          text: correction.text,
          predictedType: "unclear",
          correctedType: correction.type,
          correctedProject: null,
          source: correction.source ?? "cli"
        });
      }
    });
    return workspace;
  }

  it("a memo on words nothing matched makes only a Requires Review Action whose steps are not safe to run", { timeout: 60_000 }, () => {
    const golden = cases.find((c) => c.id === "memo-hit-work") as GoldenCase;
    const workspace = freshWorkspace(golden);
    const asked = runAskCommand({ workspace, request: golden.text });
    expect(asked.data.intake.action.kind).toBe("capture_thought");
    expect(asked.data.memo).toBeDefined();
    expect(asked.data.workItem?.queue).toBe("requires_review");
    expect(asked.data.run).toBeNull();
    const steps = asked.data.plan?.steps ?? [];
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(["operator", "codex_planning"]).toContain(step.executor_type);
      expect(step.safe_to_run).toBe(0);
    }
  });

  it.each(cases.map((golden) => [golden.id, golden] as const))("%s", { timeout: 60_000 }, (_id, golden) => {
    const workspace = freshWorkspace(golden);
    const asked = runAskCommand({ workspace, request: golden.text });
    expect(asked.data.heard?.type).toBe(golden.expected_type);
    expect(Boolean(asked.data.memo)).toBe(golden.expected_memo ?? false);
    // A status memo or a Decision reply takes a route that never consults the stewardship path.
    if (golden.expected_path) expect(asked.data.stewardship.recommendedExecutionPath).toBe(golden.expected_path);
  });
});
