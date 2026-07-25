import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildClarifyRequest, CLARIFY_OPERATION_ID, CLARIFY_SCHEMA_ID } from "../src/clarify/contract.js";
import { ClarifyVerdictUnusableError, normalizeVerdict } from "../src/clarify/engine.js";
import type { ClarifyEvaluator } from "../src/clarify/types.js";
import { runClarifyCommand, renderClarifySuccess } from "../src/commands/clarify.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { withDatabase } from "../src/db/connection.js";
import { createWorkItemWithOptionalArtifact, getWorkItem, listReviewItems, listWorkItems } from "../src/db/repositories.js";
import type { WorkItemSummary } from "../src/domain/types.js";
import { clarifyGoldenExamples } from "./clarifyFixtures.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(path.dirname(workspace), { recursive: true, force: true });
  }
});

function initializedWorkspace(): string {
  const workspace = path.join(mkdtempSync(path.join(tmpdir(), "arcadia-clarify-")), "workspace");
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

/** Returns the same verdict for every Action, so a pass is fully deterministic. */
function stubEvaluator(raw: Record<string, unknown>): ClarifyEvaluator {
  return async () => normalizeVerdict(raw);
}

describe("clarify request contract", () => {
  it("builds a stable, local-preferred, unpaid request", () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Sort out the nightly sync");

    const request = buildClarifyRequest(action, { idempotencyKey: "fixed-key" });

    expect(request).toMatchObject({
      idempotencyKey: "fixed-key",
      operationId: CLARIFY_OPERATION_ID,
      clientApp: "arcadia-clarify",
      capability: "text.generate",
      // A pass runs over every unclarified Action; it must not quietly bill a
      // frontier model per Action.
      execution: "local-preferred",
      profile: "fast",
      executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
      outputContract: { schemaId: CLARIFY_SCHEMA_ID, schemaVersion: 1 },
      template: { id: "arcadia.clarify.rubric", version: "1" }
    });

    const input = request.input as { instructions: string; action: Record<string, unknown> };
    expect(input.action.title).toBe("Sort out the nightly sync");
    expect(input.instructions).toContain("exactly ONE gapType");
    // Negative guard: the rubric itself must not teach a personal name.
    expect(input.instructions).not.toMatch(/\bMark\b/);
    expect(input.instructions).toContain("the operator");
  });

  it("derives a deterministic idempotency key from the Action and its updated_at", () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Stable key");

    expect(buildClarifyRequest(action).idempotencyKey).toBe(buildClarifyRequest(action).idempotencyKey);
  });
});

describe("clarify verdict normalization", () => {
  for (const example of clarifyGoldenExamples) {
    it(`accepts a ${example.name} result`, () => {
      expect(normalizeVerdict(example.rawResult)).toEqual(example.expected);
    });
  }

  it("refuses a clarified verdict with no next action", () => {
    expect(() => normalizeVerdict({ verdict: "clarified", actor: "operator" })).toThrow(
      ClarifyVerdictUnusableError
    );
  });

  it("refuses a question with a gap type outside the taxonomy", () => {
    expect(() =>
      normalizeVerdict({ verdict: "question_open", gapType: "missing-everything", question: "What?" })
    ).toThrow(/must classify the gap as one of/);
  });

  it("refuses a question_open verdict with no question", () => {
    expect(() => normalizeVerdict({ verdict: "question_open", gapType: "missing-decision" })).toThrow(
      /exactly one question/
    );
  });

  it("refuses an unrecognized verdict", () => {
    expect(() => normalizeVerdict({ verdict: "maybe" })).toThrow(/must be "clarified" or "question_open"/);
  });

  it("falls back to the operator for an unrecognized actor", () => {
    // Routing to a human for a second look is always safe; guessing
    // "coding-agent" would hand unreviewed work to an executor.
    const verdict = normalizeVerdict({
      verdict: "clarified",
      nextAction: "Do the thing",
      actor: "the-intern",
      source: "title"
    });

    expect(verdict).toMatchObject({ actor: "operator", confidence: "low" });
  });
});

describe("clarify orchestrator", () => {
  it("previews without writing anything by default", async () => {
    const workspace = initializedWorkspace();
    const action = captureAction(workspace, "Sort out the nightly sync");

    const response = await runClarifyCommand({
      workspace,
      evaluator: stubEvaluator(clarifyGoldenExamples[0].rawResult)
    });

    expect(response.data.applied).toBe(false);
    expect(response.data.evaluated).toHaveLength(1);
    expect(response.data.applications).toHaveLength(0);

    const after = withDatabase(workspace, (db) => getWorkItem(db, action.id));
    expect(after?.clarification_status).toBe("unclarified");
    expect(after?.next_action).toBe(action.next_action);

    expect(renderClarifySuccess(response).join("\n")).toContain("Re-run with --apply");
  });

  for (const example of clarifyGoldenExamples) {
    it(`applies a ${example.name} verdict`, async () => {
      const workspace = initializedWorkspace();
      const action = captureAction(workspace, `Action for ${example.name}`);

      const response = await runClarifyCommand({
        workspace,
        apply: true,
        evaluator: stubEvaluator(example.rawResult)
      });

      expect(response.data.applied).toBe(true);
      const after = withDatabase(workspace, (db) => getWorkItem(db, action.id));
      expect(after?.clarification_status).toBe(example.expectedAfterApply.clarification_status);
      expect(after?.gap_type).toBe(example.expectedAfterApply.gap_type);

      if (example.expectedAfterApply.work_classification) {
        expect(after?.work_classification).toBe(example.expectedAfterApply.work_classification);
        expect(after?.queue).toBe(example.expectedAfterApply.queue);
        expect(after?.next_action).toBe((example.expected as { nextAction: string }).nextAction);
      } else {
        // A question becomes a real Decision so it queues with everything else
        // waiting on a human.
        const decisions = withDatabase(workspace, (db) => listReviewItems(db, "open"));
        const opened = decisions.find((item) => item.work_item_id === action.id);
        expect(opened?.resolved_intent).toBe("ActionClarification");
        expect(opened?.decision_needed).toBe((example.expected as { question: string }).question);
        expect(after?.open_question).toBe((example.expected as { question: string }).question);
      }
    });
  }

  it("never auto-creates subtasks from a missing-definition decomposition", async () => {
    const workspace = initializedWorkspace();
    const example = clarifyGoldenExamples.find((entry) => entry.name === "missing-definition");
    const action = captureAction(workspace, "Improve onboarding");
    const before = withDatabase(workspace, listWorkItems).length;

    const response = await runClarifyCommand({
      workspace,
      apply: true,
      evaluator: stubEvaluator(example!.rawResult)
    });

    // The decomposition is reported so the operator can act on it, and nothing
    // else. Approval is the operator's call, not the engine's.
    const after = withDatabase(workspace, listWorkItems);
    expect(after).toHaveLength(before);
    expect(after.some((item) => item.parent_work_item_id === action.id)).toBe(false);
    expect(response.data.applications[0].proposedSubtasks).toEqual(example!.rawResult.decomposition);

    const rendered = renderClarifySuccess(response).join("\n");
    expect(rendered).toContain("Proposed subtasks (not created");
    expect(rendered).toContain("Instrument the email verification screen");
  });

  it("emits no personal name anywhere in its output", async () => {
    const workspace = initializedWorkspace();
    captureAction(workspace, "Check the filing deadline");

    const response = await runClarifyCommand({
      workspace,
      apply: true,
      evaluator: stubEvaluator(clarifyGoldenExamples[1].rawResult)
    });

    const rendered = renderClarifySuccess(response).join("\n");
    expect(rendered).not.toContain("Needs Mark");
    expect(rendered).not.toMatch(/\bMark\b/);
    expect(rendered).toContain("operator");
  });

  it("only considers unclarified, unfinished Actions", async () => {
    const workspace = initializedWorkspace();
    const unclarified = captureAction(workspace, "Still needs clarifying");

    // NULL clarification_status means "predates clarification"; a first pass
    // must not sweep historical rows into a model run.
    const legacy = withDatabase(workspace, (db) =>
      createWorkItemWithOptionalArtifact(db, {
        title: "Legacy Action",
        rawInput: "Legacy Action",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Already decided"
      })
    );

    const response = await runClarifyCommand({
      workspace,
      evaluator: stubEvaluator(clarifyGoldenExamples[0].rawResult)
    });

    const consideredIds = response.data.evaluated.map((entry) => entry.workItem.id);
    expect(consideredIds).toEqual([unclarified.id]);
    expect(consideredIds).not.toContain(legacy.workItem.id);
  });

  it("clarifies one named Action whatever its current state", async () => {
    const workspace = initializedWorkspace();
    const legacy = withDatabase(workspace, (db) =>
      createWorkItemWithOptionalArtifact(db, {
        title: "Named explicitly",
        rawInput: "Named explicitly",
        queue: "work_queue",
        workClassification: "codex",
        nextAction: "Already decided"
      })
    );

    const response = await runClarifyCommand({
      workspace,
      workId: legacy.workItem.id,
      evaluator: stubEvaluator(clarifyGoldenExamples[0].rawResult)
    });

    expect(response.data.evaluated.map((entry) => entry.workItem.id)).toEqual([legacy.workItem.id]);
  });

  it("skips an unusable verdict and keeps going", async () => {
    const workspace = initializedWorkspace();
    const first = captureAction(workspace, "First Action");
    const second = captureAction(workspace, "Second Action");

    let call = 0;
    const evaluator: ClarifyEvaluator = async () => {
      call += 1;
      // The first Action comes back unusable; the second must still be evaluated.
      return normalizeVerdict(call === 1 ? { verdict: "nonsense" } : clarifyGoldenExamples[0].rawResult);
    };

    const response = await runClarifyCommand({ workspace, apply: true, evaluator });

    expect(response.data.skipped).toHaveLength(1);
    expect(response.data.evaluated).toHaveLength(1);

    const skippedId = response.data.skipped[0].workItemId;
    const survivor = withDatabase(workspace, (db) => getWorkItem(db, skippedId));
    // A skipped Action keeps exactly the state it had.
    expect(survivor?.clarification_status).toBe("unclarified");
    expect([first.id, second.id]).toContain(skippedId);
  });

  it("honors --limit and reports an empty queue plainly", async () => {
    const workspace = initializedWorkspace();
    captureAction(workspace, "One");
    captureAction(workspace, "Two");
    captureAction(workspace, "Three");

    const limited = await runClarifyCommand({
      workspace,
      limit: 2,
      evaluator: stubEvaluator(clarifyGoldenExamples[0].rawResult)
    });
    expect(limited.data.evaluated).toHaveLength(2);

    const empty = initializedWorkspace();
    const none = await runClarifyCommand({
      workspace: empty,
      evaluator: stubEvaluator(clarifyGoldenExamples[0].rawResult)
    });
    expect(renderClarifySuccess(none)).toEqual(["No unclarified Actions."]);
  });
});
