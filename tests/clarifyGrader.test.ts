import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildClarifyRequest } from "../src/clarify/contract.js";
import type { ClarifyJobRunner } from "../src/clarify/engine.js";
import { ClarifyEngineUnavailableError, ClarifyVerdictUnusableError, normalizeVerdict } from "../src/clarify/engine.js";
import {
  buildGraderRequest,
  createIntelligenceGrader,
  GRADER_CRITERIA,
  GRADER_INSTRUCTIONS,
  GRADER_OPERATION_ID,
  GRADER_PROFILE,
  GRADER_RECEIPT_SCHEMA,
  graderPromptSha256,
  normalizeGrade,
  renderGraderCriteria,
  sha256Hex,
  type ClarifyGrader,
  type GraderInput
} from "../src/clarify/grader.js";
import { enforceClarifyLint, type ClarifySourceMaterial } from "../src/clarify/lint.js";
import type { ClarifyEvaluator } from "../src/clarify/types.js";
import { GRADER_VERDICT_EVENT_TYPE, renderClarifySuccess, runClarifyCommand } from "../src/commands/clarify.js";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import { createWorkItemWithOptionalArtifact, getWorkItem, listReviewItems } from "../src/db/repositories.js";
import type { WorkItemSummary } from "../src/domain/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { clarifyGoldenExamples, passingGrader, stubGrader } from "./clarifyFixtures.js";

const REPO_ROOT = path.join(__dirname, "..");
const GOLDEN_DIR = path.join(__dirname, "fixtures", "clarify-golden");
const GRADER_ONLY_DIR = path.join(GOLDEN_DIR, "grader-only");

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(path.dirname(workspace), { recursive: true, force: true });
  }
});

function initializedWorkspace(): string {
  const workspace = path.join(mkdtempSync(path.join(tmpdir(), "arcadia-grader-")), "workspace");
  initWorkspace(workspace);
  workspaces.push(workspace);
  return workspace;
}

function captureAction(workspace: string, title: string): WorkItemSummary {
  return withDatabase(workspace, (db) => {
    const created = createWorkItemWithOptionalArtifact(db, {
      title,
      rawInput: title,
      queue: "requires_review",
      workClassification: "requires_review",
      nextAction: "Clarify the desired outcome or approve a Codex execution path.",
      clarificationStatus: "unclarified"
    });
    return getWorkItem(db, created.workItem.id) as WorkItemSummary;
  });
}

function stubEvaluator(raw: Record<string, unknown>): ClarifyEvaluator {
  return async () => normalizeVerdict(raw);
}

interface GraderEvent {
  id: string;
  work_item_id: string | null;
  review_item_id: string | null;
  source_module: string | null;
  payload_json: string;
}

function graderEvents(workspace: string): GraderEvent[] {
  return withDatabase(
    workspace,
    (db) =>
      db
        .prepare(
          "SELECT id, work_item_id, review_item_id, source_module, payload_json FROM events WHERE event_type = ? ORDER BY created_at"
        )
        .all(GRADER_VERDICT_EVENT_TYPE) as GraderEvent[]
  );
}

const YES = clarifyGoldenExamples[0].rawResult;

describe("next-action-grader instruction file", () => {
  const skill = readFileSync(path.join(REPO_ROOT, ".agents", "skills", "next-action-grader", "SKILL.md"), "utf8");

  it("carries exactly the criteria the grader prompt is built from", () => {
    const match = skill.match(/<!-- grader-criteria:start -->\n([\s\S]*?)\n<!-- grader-criteria:end -->/);
    expect(match, "SKILL.md must carry the criteria block between its markers").not.toBeNull();
    expect(match![1]).toBe(renderGraderCriteria());
    for (const criterion of GRADER_CRITERIA) {
      expect(GRADER_INSTRUCTIONS).toContain(criterion.text);
    }
  });

  it("names the five required checks", () => {
    const text = GRADER_CRITERIA.map((criterion) => criterion.text.toLowerCase()).join("\n");
    expect(text).toContain("concrete imperative verb");
    expect(text).toContain("under 15 minutes");
    expect(text).toContain("a third party could check");
    expect(text).toContain("absent from the source material");
    expect(text).toContain("exactly that one item");
  });

  it("has valid frontmatter and is listed in the skills guide", () => {
    expect(skill).toMatch(/^---\nname: next-action-grader\ndescription: .+\n---\n/);
    expect(readFileSync(path.join(REPO_ROOT, "docs", "using-arcadia-skills.md"), "utf8")).toContain(
      ".agents/skills/next-action-grader/SKILL.md"
    );
  });
});

describe("grader request", () => {
  const workspace = initializedWorkspace();
  const workItem = captureAction(workspace, "Sort out the nightly sync");
  const input: GraderInput = {
    workItem,
    candidate: { nextAction: "Add a retry", doneCondition: "A forced failure retries", actor: "coding-agent" },
    source: { title: workItem.title, rawInput: workItem.raw_input }
  };

  it("is a separate, local-preferred, unpaid call with its own operation, profile and prompt", () => {
    const request = buildGraderRequest(input);
    const generator = buildClarifyRequest(workItem);

    expect(request).toMatchObject({
      operationId: GRADER_OPERATION_ID,
      capability: "text.generate",
      execution: "local-preferred",
      profile: GRADER_PROFILE,
      executionPolicy: { allowPaidUsage: false }
    });
    expect(request.operationId).not.toBe(generator.operationId);
    expect(request.profile).not.toBe(generator.profile);
    expect((request.input as { instructions: string }).instructions).not.toBe(
      (generator.input as { instructions: string }).instructions
    );
  });

  it("never receives the generator's confidence or justification", () => {
    const serialized = JSON.stringify(buildGraderRequest(input)).toLowerCase();
    expect(serialized).not.toContain("confidence");
    expect(Object.keys((buildGraderRequest(input).input as Record<string, unknown>).candidate as object).sort()).toEqual([
      "actor",
      "doneCondition",
      "nextAction"
    ]);
  });

  it("keys its idempotency on the candidate, so a changed candidate is graded again", () => {
    const other = { ...input, candidate: { ...input.candidate, doneCondition: "Something else is observable" } };
    expect(buildGraderRequest(input).idempotencyKey).toBe(buildGraderRequest(input).idempotencyKey);
    expect(buildGraderRequest(input).idempotencyKey).not.toBe(buildGraderRequest(other).idempotencyKey);
  });

  it("puts the prompt hash in the key, and a retry attempt under its own suffix", () => {
    const key = buildGraderRequest(input).idempotencyKey;
    expect(key).toContain(graderPromptSha256().slice(0, 8));
    expect(key).toMatch(/^grade-.+-[0-9a-f]{8}-[0-9a-f]{16}$/);
    expect(buildGraderRequest(input, 1).idempotencyKey).toBe(`${key}-retry1`);
  });
});

describe("normalizeGrade", () => {
  const context = {
    grader: { id: "route", operationId: GRADER_OPERATION_ID, profile: GRADER_PROFILE },
    promptSha256: "p",
    inputSha256: "i"
  };

  it("accepts a pass", () => {
    expect(normalizeGrade({ grade: "pass", reason: "ok" }, context)).toMatchObject({
      grade: "pass",
      failedCriteria: [],
      receipt: { verdict: "pass", schema: GRADER_RECEIPT_SCHEMA }
    });
  });

  it("accepts a fail with one request, keeps only known criteria ids, and defaults the gap type", () => {
    const outcome = normalizeGrade(
      { grade: "fail", failedCriteria: ["observable-done", "not-a-criterion"], reason: "r", request: "What is X?", gapType: "bogus" },
      context
    );
    expect(outcome).toMatchObject({
      grade: "fail",
      failedCriteria: ["observable-done"],
      request: "What is X?",
      gapType: "missing-definition"
    });
  });

  it("refuses a fail with no request and a grade that is neither pass nor fail", () => {
    expect(() => normalizeGrade({ grade: "fail", reason: "r" }, context)).toThrow(ClarifyVerdictUnusableError);
    expect(() => normalizeGrade({ grade: "maybe" }, context)).toThrow(ClarifyVerdictUnusableError);
    expect(() => normalizeGrade(undefined, context)).toThrow(ClarifyVerdictUnusableError);
  });
});

describe("createIntelligenceGrader with a completed job whose result is unusable", () => {
  // The workspace is per test: the suite's afterEach removes it.
  function setup(): { workspace: string; input: GraderInput } {
    const workspace = initializedWorkspace();
    const workItem = captureAction(workspace, "Sort out the nightly sync");
    return {
      workspace,
      input: {
        workItem,
        candidate: { nextAction: "Add a retry", doneCondition: "A forced failure retries", actor: "coding-agent" },
        source: { title: workItem.title }
      }
    };
  }
  const UNUSABLE = { grade: "fail", reason: "no request given" };

  function fakeRunner(resultFor: (key: string) => unknown, keys: string[]): ClarifyJobRunner {
    return async (request) => {
      keys.push(request.idempotencyKey);
      return { id: request.idempotencyKey, status: "completed", result: resultFor(request.idempotencyKey) } as never;
    };
  }

  it("retries once under a retry-suffixed key instead of re-reading the stuck result forever", async () => {
    const { workspace, input } = setup();
    const keys: string[] = [];
    const base = buildGraderRequest(input).idempotencyKey;
    const db = openDatabase(workspace);
    try {
      const grader = createIntelligenceGrader(
        db,
        workspace,
        fakeRunner((key) => (key === base ? UNUSABLE : { grade: "pass", reason: "ok" }), keys)
      );
      const outcome = await grader(input);
      expect(outcome.grade).toBe("pass");
      expect(keys).toEqual([base, `${base}-retry1`]);
    } finally {
      db.close();
    }
  });

  it("reports the item as needing operator attention when the retry is unusable too", async () => {
    const { workspace, input } = setup();
    const keys: string[] = [];
    const db = openDatabase(workspace);
    try {
      const grader = createIntelligenceGrader(db, workspace, fakeRunner(() => UNUSABLE, keys));
      const failure = await grader(input).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ClarifyVerdictUnusableError);
      expect((failure as Error).message).toContain("needs operator attention");
      expect(keys).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it("does not retry a usable result", async () => {
    const { workspace, input } = setup();
    const keys: string[] = [];
    const db = openDatabase(workspace);
    try {
      const grader = createIntelligenceGrader(db, workspace, fakeRunner(() => ({ grade: "pass" }), keys));
      await grader(input);
      expect(keys).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe("clarify with the separate grader", () => {
  it("records clarified on a pass and stores the receipt with identity, prompt hash, input hash and verdict", async () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Sort out the nightly sync");
    const seen: GraderInput[] = [];
    const grader: ClarifyGrader = async (input) => {
      seen.push(input);
      return stubGrader({ grade: "pass", reason: "Every criterion holds." }, "arcadia.text.generate.local.standard")(input);
    };

    const response = await runClarifyCommand({ workspace, apply: true, evaluator: stubEvaluator(YES), grader });

    expect(seen).toHaveLength(1);
    expect(seen[0].candidate).toEqual({
      nextAction: YES.nextAction,
      doneCondition: YES.doneCondition,
      actor: "coding-agent"
    });
    const after = withDatabase(workspace, (db) => getWorkItem(db, action.id));
    expect(after?.clarification_status).toBe("clarified");
    expect(after?.next_action).toBe(YES.nextAction);

    const events = graderEvents(workspace);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ work_item_id: action.id, review_item_id: null, source_module: "clarify" });
    expect(response.data.applications[0].graderEventId).toBe(events[0].id);

    const payload = JSON.parse(events[0].payload_json) as {
      receipt: Record<string, unknown>;
      candidate: Record<string, unknown>;
    };
    expect(payload.receipt).toMatchObject({
      schema: GRADER_RECEIPT_SCHEMA,
      grader: { id: "arcadia.text.generate.local.standard", operationId: GRADER_OPERATION_ID, profile: GRADER_PROFILE },
      promptSha256: sha256Hex(GRADER_INSTRUCTIONS),
      verdict: "pass"
    });
    expect(payload.receipt.inputSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.receipt.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.candidate).toMatchObject({ doneCondition: YES.doneCondition });

    expect(renderClarifySuccess(response).join("\n")).toContain("Grader: pass (arcadia.text.generate.local.standard");
  });

  it("records question_open with the grader's single request on a fail, linked to the Decision", async () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Sort out the nightly sync");
    const grader = stubGrader({
      grade: "fail",
      failedCriteria: ["startable-first-step"],
      reason: "The first step needs the batch size, which is not stated.",
      request: "What is the batch size the nightly sync uses?",
      gapType: "missing-external-input"
    });

    const response = await runClarifyCommand({ workspace, apply: true, evaluator: stubEvaluator(YES), grader });

    expect(response.data.evaluated[0].verdict).toMatchObject({
      verdict: "question_open",
      gapType: "missing-external-input",
      question: "What is the batch size the nightly sync uses?"
    });
    const after = withDatabase(workspace, (db) => getWorkItem(db, action.id));
    expect(after?.clarification_status).toBe("question_open");
    expect(after?.open_question).toBe("What is the batch size the nightly sync uses?");
    // The rejected candidate is not recorded as the next action.
    expect(after?.next_action).toBe(action.next_action);

    const decisions = withDatabase(workspace, (db) => listReviewItems(db, "open")).filter(
      (item) => item.work_item_id === action.id
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].resolved_intent).toBe("ActionClarification");
    expect(decisions[0].decision_needed).toBe("What is the batch size the nightly sync uses?");

    const events = graderEvents(workspace);
    expect(events).toHaveLength(1);
    expect(events[0].review_item_id).toBe(decisions[0].id);
    const payload = JSON.parse(events[0].payload_json) as { receipt: Record<string, unknown> };
    expect(payload.receipt).toMatchObject({
      verdict: "fail",
      failedCriteria: ["startable-first-step"],
      request: "What is the batch size the nightly sync uses?"
    });
  });

  it("leaves the Action unclarified and writes nothing when the grader is unavailable", async () => {
    for (const failure of [
      new ClarifyEngineUnavailableError("Cannot reach the local model right now (CONNECTION): refused"),
      new ClarifyVerdictUnusableError("A fail grade must carry exactly one information request.")
    ]) {
      const workspace = initializedWorkspace();
      const action = captureAction(workspace, "Sort out the nightly sync");
      const grader: ClarifyGrader = async () => {
        throw failure;
      };

      const response = await runClarifyCommand({ workspace, apply: true, evaluator: stubEvaluator(YES), grader });

      expect(response.data.evaluated).toHaveLength(0);
      expect(response.data.applications).toHaveLength(0);
      expect(response.data.skipped).toHaveLength(1);
      expect(response.data.skipped[0].reason).toContain("Grader unavailable");
      expect(response.data.skipped[0].reason).toContain(failure.message);

      const after = withDatabase(workspace, (db) => getWorkItem(db, action.id));
      expect(after?.clarification_status).toBe("unclarified");
      expect(after?.next_action).toBe(action.next_action);
      expect(graderEvents(workspace)).toHaveLength(0);
      expect(withDatabase(workspace, (db) => listReviewItems(db, "open"))).toHaveLength(0);
    }
  });

  it("writes the clarification and its receipt atomically: a failed receipt write rolls the update back", async () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Sort out the nightly sync");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const grader: ClarifyGrader = async (input) => {
      const outcome = await passingGrader(input);
      return { ...outcome, receipt: { ...outcome.receipt, reason: circular as never } };
    };

    await expect(runClarifyCommand({ workspace, apply: true, evaluator: stubEvaluator(YES), grader })).rejects.toThrow();

    const after = withDatabase(workspace, (db) => getWorkItem(db, action.id));
    expect(after?.clarification_status).toBe("unclarified");
    expect(after?.next_action).toBe(action.next_action);
    expect(graderEvents(workspace)).toHaveLength(0);
  });

  it("does not let an unexpected grader error pass as a verdict", async () => {
    const workspace = initializedWorkspace();
    captureAction(workspace, "Sort out the nightly sync");
    const grader: ClarifyGrader = async () => {
      throw new Error("boom");
    };
    await expect(
      runClarifyCommand({ workspace, apply: true, evaluator: stubEvaluator(YES), grader })
    ).rejects.toThrow("boom");
  });

  it("previews the grade without writing a receipt", async () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Sort out the nightly sync");

    const response = await runClarifyCommand({ workspace, evaluator: stubEvaluator(YES), grader: passingGrader });

    expect(response.data.applied).toBe(false);
    expect(response.data.evaluated[0].grader?.receipt.verdict).toBe("pass");
    expect(graderEvents(workspace)).toHaveLength(0);
    expect(withDatabase(workspace, (db) => getWorkItem(db, action.id))?.clarification_status).toBe("unclarified");
  });

  it("does not call the grader for a verdict the lint rejected or for a question", async () => {
    const workspace = initializedWorkspace();
    captureAction(workspace, "Sort out the nightly sync");
    let calls = 0;
    const grader: ClarifyGrader = async (input) => {
      calls += 1;
      return passingGrader(input);
    };

    await runClarifyCommand({
      workspace,
      evaluator: stubEvaluator({ ...YES, nextAction: "Add a retry to src/sync/ghost.ts" }),
      grader
    });
    await runClarifyCommand({
      workspace,
      evaluator: stubEvaluator(clarifyGoldenExamples[2].rawResult),
      grader
    });

    expect(calls).toBe(0);
  });

  it("builds the real grader on the local, unpaid Intelligence path and reports an unreachable model as unavailable", async () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Sort out the nightly sync");
    const previous = process.env.ARCADIA_LITELLM_BASE_URL;
    process.env.ARCADIA_LITELLM_BASE_URL = "http://127.0.0.1:9";
    const db = openDatabase(workspace);
    try {
      const grader = createIntelligenceGrader(db, workspace);
      await expect(
        grader({
          workItem: action,
          candidate: { nextAction: "Add a retry", doneCondition: "A forced failure retries", actor: "coding-agent" },
          source: { title: action.title }
        })
      ).rejects.toThrow(/Cannot reach the local model|did not complete/);
    } finally {
      db.close();
      if (previous === undefined) {
        delete process.env.ARCADIA_LITELLM_BASE_URL;
      } else {
        process.env.ARCADIA_LITELLM_BASE_URL = previous;
      }
    }
  });
});

interface GraderOnlyCase {
  name: string;
  reason: string;
  nextAction: string;
  doneCondition: string;
  actor: "operator" | "coding-agent" | "external-party";
  source: ClarifySourceMaterial;
  expected: "fail";
  failedCriteria: string[];
  request: string;
}

describe("clarify golden set: the contract for the grader", () => {
  const graderOnly = readdirSync(GRADER_ONLY_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(GRADER_ONLY_DIR, file), "utf8")) as GraderOnlyCase);

  it("holds hand-written cases the lint cannot reject but the grader must", () => {
    expect(graderOnly.length).toBeGreaterThanOrEqual(5);
    expect(new Set(graderOnly.map((entry) => entry.name)).size).toBe(graderOnly.length);
    const criterionIds = new Set(GRADER_CRITERIA.map((criterion) => criterion.id));
    for (const entry of graderOnly) {
      expect(entry.reason.length, entry.name).toBeGreaterThan(0);
      expect(entry.request.endsWith("?"), entry.name).toBe(true);
      expect(entry.failedCriteria.length, entry.name).toBeGreaterThan(0);
      for (const id of entry.failedCriteria) {
        expect(criterionIds.has(id), `${entry.name}: ${id}`).toBe(true);
      }
    }
  });

  for (const entry of readdirSync(GRADER_ONLY_DIR).filter((file) => file.endsWith(".json")).sort()) {
    const golden = JSON.parse(readFileSync(path.join(GRADER_ONLY_DIR, entry), "utf8")) as GraderOnlyCase;

    it(`passes the lint, then a failing grade becomes one question: ${golden.name}`, async () => {
      const verdict = {
        verdict: "clarified" as const,
        nextAction: golden.nextAction,
        doneCondition: golden.doneCondition,
        actor: golden.actor,
        source: "golden",
        confidence: "high" as const
      };
      expect(enforceClarifyLint(verdict, golden.source).findings).toEqual([]);

      const workspace = initializedWorkspace();
      const action = withDatabase(workspace, (db) => {
        const created = createWorkItemWithOptionalArtifact(db, {
          title: golden.source.title ?? "Golden",
          rawInput: golden.source.rawInput ?? golden.source.title ?? "Golden",
          queue: "requires_review",
          workClassification: "requires_review",
          nextAction: golden.source.currentNextAction ?? "Clarify the desired outcome or approve a Codex execution path.",
          clarificationStatus: "unclarified"
        });
        return getWorkItem(db, created.workItem.id) as WorkItemSummary;
      });
      const grader = stubGrader({
        grade: "fail",
        failedCriteria: golden.failedCriteria,
        reason: golden.reason,
        request: golden.request
      });

      const response = await runClarifyCommand({
        workspace,
        workId: action.id,
        evaluator: async () => verdict,
        grader
      });

      expect(response.data.evaluated[0].verdict).toMatchObject({ verdict: "question_open", question: golden.request });
      expect(response.data.evaluated[0].grader?.receipt.failedCriteria).toEqual(golden.failedCriteria);
    });
  }

  it("lets every passing lint case through a passing grade as clarified", () => {
    const passes = readdirSync(GOLDEN_DIR)
      .filter((file) => file.startsWith("pass-") && file.endsWith(".json"))
      .map(
        (file) =>
          JSON.parse(readFileSync(path.join(GOLDEN_DIR, file), "utf8")) as {
            nextAction: string;
            doneCondition: string;
            source: ClarifySourceMaterial;
          }
      );
    expect(passes.length).toBeGreaterThanOrEqual(5);
    for (const entry of passes) {
      const verdict = {
        verdict: "clarified" as const,
        nextAction: entry.nextAction,
        doneCondition: entry.doneCondition,
        actor: "coding-agent" as const,
        source: "golden",
        confidence: "high" as const
      };
      expect(enforceClarifyLint(verdict, entry.source).verdict).toEqual(verdict);
    }
  });
});
