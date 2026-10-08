import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureAskEnvelope } from "../src/ask/captureEnvelope.js";
import { ClarifyEngineUnavailableError, normalizeVerdict } from "../src/clarify/engine.js";
import { handoffRequestId } from "../src/clarify/handoff.js";
import type { ClarifyEvaluator } from "../src/clarify/types.js";
import { runAskCommand } from "../src/commands/ask.js";
import { renderClarifySuccess, runClarifyCommand } from "../src/commands/clarify.js";
import { runReviewOpenCommand, runReviewResolveReplyCommand } from "../src/commands/review.js";
import { runReviewApproveWithClarify, runReviewResolveReplyWithClarify } from "../src/commands/reviewClarify.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  createWorkItemWithOptionalArtifact,
  getReviewItem,
  getWorkItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import type { WorkItemSummary } from "../src/domain/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { clarifyGoldenExamples, passingGrader, stubGrader } from "./clarifyFixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const YES = clarifyGoldenExamples[0].rawResult;
const AGENT_EVALUATOR: ClarifyEvaluator = async () => normalizeVerdict(YES);
const OPERATOR_EVALUATOR: ClarifyEvaluator = async () => normalizeVerdict(clarifyGoldenExamples[1].rawResult);

interface Fixture {
  workspace: string;
  repo: string;
  action: WorkItemSummary;
  captureId: string | null;
}

/** A workspace, a Project (optionally with a repository), and one unclarified Action (optionally from a captured Ask). */
function fixture(options: { repo?: boolean; capture?: boolean } = {}): Fixture {
  const { repo: withRepo = true, capture = true } = options;
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-handoff-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const repo = path.join(workspace, "demo-repo");
  initWorkspace(workspace);
  mkdirSync(repo, { recursive: true });

  const { action, captureId } = withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Demo Handoff",
      mission: "Prove the handoff.",
      goal: "A handoff Ask is drafted.",
      status: "active",
      currentMilestone: "Handoff",
      nextAction: "Choose the next step.",
      workClassification: "requires_review"
    });
    if (withRepo) {
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: [],
        repoPath: repo,
        statusSummary: "Ready.",
        validationCommands: []
      });
    }
    const item = createWorkItemWithOptionalArtifact(db, {
      projectId: created.project.id,
      title: "Sort out the nightly sync",
      rawInput: "Sort out the nightly sync",
      queue: "requires_review",
      workClassification: "requires_review",
      nextAction: "Clarify the desired outcome or approve a Codex execution path.",
      clarificationStatus: "unclarified"
    });
    let envelopeId: string | null = null;
    if (capture) {
      envelopeId = captureAskEnvelope(db, { requestId: "request-demo-1", originalText: "Sort out the nightly sync", ingressSource: "agent.ask" }).id;
      db.prepare("UPDATE work_items SET capture_id = ? WHERE id = ?").run(envelopeId, item.workItem.id);
    }
    return { action: getWorkItem(db, item.workItem.id) as WorkItemSummary, captureId: envelopeId };
  });

  return { workspace, repo, action, captureId };
}

function draftFiles(repo: string): string[] {
  const dir = path.join(repo, ".arcadia", "asks");
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".yaml")) : [];
}

function proposalCount(workspace: string, requestId: string): number {
  return withDatabase(
    workspace,
    (db) => (db.prepare("SELECT COUNT(*) AS n FROM agent_ask_proposals WHERE request_id = ?").get(requestId) as { n: number }).n
  );
}

const expectedRequestId = (workItemId: string) =>
  `handoff-${workItemId}-${createHash("sha256")
    .update(String(YES.nextAction) + String(YES.doneCondition))
    .digest("hex")
    .slice(0, 12)}`;

describe("arcadia ask marks the Actions it creates unclarified", () => {
  it("creates the Action unclarified", () => {
    const workspace = path.join(mkdtempSync(path.join(tmpdir(), "arcadia-ask-unclarified-")), "ws");
    roots.push(path.dirname(workspace));
    initWorkspace(workspace);
    withDatabase(workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Rebuster",
        mission: "Create high-quality rebus puzzles.",
        goal: "Make publishing reliable.",
        status: "active",
        currentMilestone: "Reliable publishing workflow",
        nextAction: "Choose the next publishing improvement.",
        workClassification: "requires_review"
      });
      const repo = path.join(workspace, "rebuster-repo");
      mkdirSync(repo, { recursive: true });
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: ["Rebuster Studio"],
        repoPath: repo,
        statusSummary: "Ready for planning.",
        validationCommands: []
      });
    });

    const response = runAskCommand({ workspace, request: "Prepare a plan for adding Pinterest publishing to Rebuster." });

    expect(response.data.workItem?.clarification_status).toBe("unclarified");
    const stored = withDatabase(workspace, (db) => getWorkItem(db, response.data.workItem!.id));
    expect(stored?.clarification_status).toBe("unclarified");
  });
});

describe("clarify --apply hands a graded coding-agent Action to a file", () => {
  it("drafts one strict v1 Agent Ask into the Project repository and writes no Action status, pointer or queue entry", async () => {
    const { workspace, repo, action, captureId } = fixture();

    const response = await runClarifyCommand({ workspace, apply: true, evaluator: AGENT_EVALUATOR, grader: passingGrader });

    const requestId = expectedRequestId(action.id);
    expect(handoffRequestId(action.id, String(YES.nextAction), String(YES.doneCondition))).toBe(requestId);
    expect(response.data.applications[0].handoff).toMatchObject({ requestId, status: "drafted" });
    expect(draftFiles(repo)).toEqual([`agent-ask-${requestId}.yaml`]);

    const ask = JSON.parse(readFileSync(path.join(repo, ".arcadia", "asks", `agent-ask-${requestId}.yaml`), "utf8")) as Record<string, unknown>;
    expect(ask).toMatchObject({
      agent_ask: "v1",
      request_id: requestId,
      project: "demo-handoff",
      intent: "action",
      requested_authority: "propose",
      desired_result: YES.nextAction,
      acceptance: [YES.doneCondition]
    });
    expect(ask.rationale).toContain(action.id);
    expect(ask.rationale).toContain(captureId);

    // A pending proposal in the workspace, which is what `arcadia todo` lists.
    expect(proposalCount(workspace, requestId)).toBe(1);
    // Nothing settled, queued or pointed.
    const counts = withDatabase(workspace, (db) => ({
      settlements: (db.prepare("SELECT COUNT(*) AS n FROM agent_ask_settlements").get() as { n: number }).n,
      positions: (db.prepare("SELECT COUNT(*) AS n FROM action_queue_positions").get() as { n: number }).n
    }));
    expect(counts).toEqual({ settlements: 0, positions: 0 });
    expect(readdirSync(repo).sort()).toEqual([".arcadia"]);

    // The Action itself is clarified by the existing path, nothing more.
    const after = withDatabase(workspace, (db) => getWorkItem(db, action.id));
    expect(after?.clarification_status).toBe("clarified");
    expect(after?.status).toBe(action.status);

    expect(renderClarifySuccess(response).join("\n")).toContain(`Handoff: drafted Agent Ask ${requestId}`);
  });

  it("is idempotent: re-clarifying the same candidate reports the existing Ask and drafts nothing", async () => {
    const { workspace, repo, action } = fixture();
    const requestId = expectedRequestId(action.id);

    await runClarifyCommand({ workspace, workId: action.id, apply: true, evaluator: AGENT_EVALUATOR, grader: passingGrader });
    const again = await runClarifyCommand({ workspace, workId: action.id, apply: true, evaluator: AGENT_EVALUATOR, grader: passingGrader });

    expect(again.data.applications[0].handoff).toMatchObject({ requestId, status: "skipped" });
    expect(again.data.applications[0].handoff?.reason).toContain("already exists");
    expect(draftFiles(repo)).toHaveLength(1);
    expect(proposalCount(workspace, requestId)).toBe(1);
  });

  it("treats a request id that was settled and archived as existing", async () => {
    const { workspace, repo, action } = fixture();
    const requestId = expectedRequestId(action.id);
    await runClarifyCommand({ workspace, workId: action.id, apply: true, evaluator: AGENT_EVALUATOR, grader: passingGrader });
    // Settlement archives the draft file out of .arcadia/asks/; the proposal row stays.
    rmSync(path.join(repo, ".arcadia", "asks", `agent-ask-${requestId}.yaml`));
    expect(draftFiles(repo)).toHaveLength(0);

    const again = await runClarifyCommand({ workspace, workId: action.id, apply: true, evaluator: AGENT_EVALUATOR, grader: passingGrader });

    expect(again.data.applications[0].handoff).toMatchObject({ requestId, status: "skipped" });
    expect(draftFiles(repo)).toHaveLength(0);
  });

  it("skips with a reported reason when the Project has no repo_path, and still records the clarification", async () => {
    const { workspace, action } = fixture({ repo: false });

    const response = await runClarifyCommand({ workspace, apply: true, evaluator: AGENT_EVALUATOR, grader: passingGrader });

    expect(response.data.applications[0].clarificationStatus).toBe("clarified");
    expect(response.data.applications[0].handoff).toMatchObject({ status: "skipped" });
    expect(response.data.applications[0].handoff?.reason).toContain("no repo_path");
    expect(proposalCount(workspace, expectedRequestId(action.id))).toBe(0);
    expect(renderClarifySuccess(response).join("\n")).toContain("Handoff: skipped");
  });

  it("hands off nothing for an operator Action, an Action with no capture, a failed grade, or a preview", async () => {
    const operator = fixture();
    const operatorRun = await runClarifyCommand({ workspace: operator.workspace, apply: true, evaluator: OPERATOR_EVALUATOR, grader: passingGrader });
    expect(operatorRun.data.applications[0].handoff).toBeUndefined();
    expect(draftFiles(operator.repo)).toHaveLength(0);

    const uncaptured = fixture({ capture: false });
    const uncapturedRun = await runClarifyCommand({ workspace: uncaptured.workspace, apply: true, evaluator: AGENT_EVALUATOR, grader: passingGrader });
    expect(uncapturedRun.data.applications[0].handoff).toBeUndefined();
    expect(draftFiles(uncaptured.repo)).toHaveLength(0);

    const failed = fixture();
    const failedRun = await runClarifyCommand({
      workspace: failed.workspace,
      apply: true,
      evaluator: AGENT_EVALUATOR,
      grader: stubGrader({ grade: "fail", reason: "r", request: "What is the batch size?" })
    });
    expect(failedRun.data.applications[0].clarificationStatus).toBe("question_open");
    expect(failedRun.data.applications[0].handoff).toBeUndefined();
    expect(draftFiles(failed.repo)).toHaveLength(0);

    const preview = fixture();
    await runClarifyCommand({ workspace: preview.workspace, evaluator: AGENT_EVALUATOR, grader: passingGrader });
    expect(draftFiles(preview.repo)).toHaveLength(0);
  });
});

describe("review answer --clarify", () => {
  function openQuestion(fx: Fixture): string {
    const opened = runReviewOpenCommand({
      workspace: fx.workspace,
      workId: fx.action.id,
      question: "Which sync should be fixed?",
      gapType: "missing-definition"
    });
    return opened.data.item.id;
  }

  function countingEvaluator(): { evaluator: ClarifyEvaluator; calls: () => number } {
    let calls = 0;
    return {
      evaluator: async () => {
        calls += 1;
        return normalizeVerdict(YES);
      },
      calls: () => calls
    };
  }

  it("review approve --answer --clarify records the answer, then clarifies once", async () => {
    const fx = fixture({ capture: false });
    const decisionId = openQuestion(fx);
    const counting = countingEvaluator();

    const response = await runReviewApproveWithClarify(
      { workspace: fx.workspace, id: decisionId, answer: "The nightly sync", clarify: true },
      { clarify: { evaluator: counting.evaluator, grader: passingGrader } }
    );

    expect(counting.calls()).toBe(1);
    expect(response.data.clarification).toMatchObject({ status: "ran", workItemId: fx.action.id });
    expect(response.data.clarification?.clarify?.applications[0].clarificationStatus).toBe("clarified");
    const decision = withDatabase(fx.workspace, (db) => getReviewItem(db, decisionId));
    expect(decision?.status).toBe("approved");
    const after = withDatabase(fx.workspace, (db) => getWorkItem(db, fx.action.id));
    expect(after?.clarification_status).toBe("clarified");
    expect(after?.next_action).toBe(YES.nextAction);
  });

  it("without the flag, nothing is clarified and the Action waits for an explicit re-clarify", async () => {
    const fx = fixture({ capture: false });
    const decisionId = openQuestion(fx);
    const counting = countingEvaluator();

    const response = await runReviewApproveWithClarify(
      { workspace: fx.workspace, id: decisionId, answer: "The nightly sync" },
      { clarify: { evaluator: counting.evaluator, grader: passingGrader } }
    );

    expect(counting.calls()).toBe(0);
    expect(response.data.clarification).toBeUndefined();
    expect(withDatabase(fx.workspace, (db) => getWorkItem(db, fx.action.id))?.clarification_status).toBe("unclarified");
  });

  it("review resolve-reply --id --clarify clarifies once; a bare resolve-reply (Discord and dashboard) does not", async () => {
    const withFlag = fixture({ capture: false });
    const flagged = countingEvaluator();
    const flaggedResponse = await runReviewResolveReplyWithClarify(
      { workspace: withFlag.workspace, reply: "The nightly sync", id: openQuestion(withFlag), clarify: true },
      { clarify: { evaluator: flagged.evaluator, grader: passingGrader } }
    );
    expect(flagged.calls()).toBe(1);
    expect(flaggedResponse.data.clarification?.status).toBe("ran");
    expect(withDatabase(withFlag.workspace, (db) => getWorkItem(db, withFlag.action.id))?.clarification_status).toBe("clarified");

    // The unchanged synchronous path: the answer is recorded and re-clarifying stays explicit.
    const bare = fixture({ capture: false });
    const bareResponse = runReviewResolveReplyCommand({ workspace: bare.workspace, reply: "The nightly sync", id: openQuestion(bare) });
    expect(bareResponse.data.action).toBe("approved");
    expect((bareResponse.data as { clarification?: unknown }).clarification).toBeUndefined();
    expect(withDatabase(bare.workspace, (db) => getWorkItem(db, bare.action.id))?.clarification_status).toBe("unclarified");
  });

  it("does not clarify a reply that rejects or defers the Decision", async () => {
    for (const reply of ["reject", "defer"]) {
      const fx = fixture({ capture: false });
      const counting = countingEvaluator();
      const response = await runReviewResolveReplyWithClarify(
        { workspace: fx.workspace, reply, id: openQuestion(fx), clarify: true },
        { clarify: { evaluator: counting.evaluator, grader: passingGrader } }
      );
      expect(counting.calls(), reply).toBe(0);
      expect(response.data.clarification?.status, reply).toBe("skipped");
    }
  });

  it("keeps the answer when clarify cannot finish, and says how to re-run it", async () => {
    const fx = fixture({ capture: false });
    const decisionId = openQuestion(fx);
    const unreachable: ClarifyEvaluator = async () => {
      throw new ClarifyEngineUnavailableError("Cannot reach the local model right now (CONNECTION): refused");
    };

    const response = await runReviewApproveWithClarify(
      { workspace: fx.workspace, id: decisionId, answer: "The nightly sync", clarify: true },
      { clarify: { evaluator: unreachable, grader: passingGrader } }
    );

    expect(response.data.clarification).toMatchObject({
      status: "failed",
      remedy: `arcadia clarify --work ${fx.action.id} --apply`
    });
    expect(response.data.clarification?.reason).toContain("CLARIFY_ENGINE_UNAVAILABLE");
    expect(withDatabase(fx.workspace, (db) => getReviewItem(db, decisionId))?.status).toBe("approved");
    expect(withDatabase(fx.workspace, (db) => getWorkItem(db, fx.action.id))?.clarification_status).toBe("unclarified");
  });
});
