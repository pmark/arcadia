import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArcadiaCli } from "../apps/discord-bot/src/arcadia/cli.js";
import { handleArcadiaMessage } from "../apps/discord-bot/src/events/messageCreate.js";
import { parseAskCorrectionReply } from "../apps/discord-bot/src/events/askCorrection.js";
import { formatRequest } from "../apps/discord-bot/src/formatters/requestFormatter.js";
import { askReceiptMessageStatePath, loadAskReceiptMessageState } from "../apps/discord-bot/src/notifications/state.js";
import { ASK_HEARD_HINT } from "../src/ask/heard.js";
import { buildProgram } from "../src/cli.js";
import { renderAskSuccess, runAskCommand } from "../src/commands/ask.js";
import { renderAskCorrectSuccess, runAskCorrectCommand } from "../src/commands/askCorrect.js";
import { renderAskTrailSuccess, runAskShowCommand } from "../src/commands/askTrail.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createAskRequest,
  createProjectWithInitialWork,
  createReviewItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const WORK_TEXT = "I should be able to Ask Arcadia to schedule a recurring action";
const IDEA_TEXT = "Maybe creator partnerships could help someday.";
const UNCLEAR_TEXT = "Sourdough starter notes for Sunday";
const HEARD_LINE = /^Heard: (work|idea|answer|status|unclear|none) \((high|medium|low), rule\) -> .+ \. wrong\? reply type: work\|idea\|answer\|status$/;

beforeEach(() => {
  delete process.env.DISCORD_ALLOWED_USER_IDS;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DISCORD_ALLOWED_USER_IDS;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `arcadia-ask-correct-${prefix}-`));
  roots.push(root);
  return root;
}

function workspaceWithProjects(): { workspace: string; arcadiaId: string; songbookId: string } {
  const workspace = temp("ws");
  initWorkspace(workspace);
  return withDatabase(workspace, (db) => {
    const arcadia = createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Turn intent into governed work.",
      goal: "Make Ask trustworthy.",
      status: "active",
      currentMilestone: "Visible Asks",
      nextAction: "Show every Ask.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, {
      projectId: arcadia.project.id,
      aliases: ["Arcadia"],
      repoPath: workspace,
      validationCommands: ["node -e \"process.exit(0)\""]
    });
    const songbook = createProjectWithInitialWork(db, {
      name: "Living Songbook",
      mission: "Keep the repertoire.",
      goal: "Play well.",
      status: "active",
      currentMilestone: "Repertoire",
      nextAction: "Sort songs.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, {
      projectId: songbook.project.id,
      aliases: ["Songbook"],
      repoPath: workspace,
      validationCommands: ["node -e \"process.exit(0)\""]
    });
    return { workspace, arcadiaId: arcadia.project.id, songbookId: songbook.project.id };
  });
}

function count(workspace: string, table: string, where = "1 = 1"): number {
  return (withDatabase(workspace, (db) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get()) as { n: number }).n;
}

function row<T>(workspace: string, sql: string, ...params: unknown[]): T {
  return withDatabase(workspace, (db) => db.prepare(sql).get(...params)) as T;
}

/** An Ask row to stand as the Ask that raised a Decision; only its id matters. */
function raisingAsk(db: Parameters<typeof createAskRequest>[0]): string {
  return createAskRequest(db, {
    rawRequest: "export retention",
    resolvedIntent: "CaptureThought",
    registryVersion: 1,
    outputKind: "requires_review",
    status: "requires_review"
  }).id;
}

/** A pending Decision the operator could be answering: an ordinary open review_item an Ask raised. */
function pendingDecision(workspace: string): { id: string; slug: string } {
  return withDatabase(workspace, (db) => {
    const item = createReviewItem(db, {
      askRequestId: raisingAsk(db),
      decisionNeeded: "Which retention window should the export use?",
      recommendation: "90 days",
      sourceInput: "export retention",
      proposedAction: "Pick a window",
      resolvedIntent: "ActionClarification",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: [],
      context: {}
    });
    return { id: item.id, slug: item.slug ?? item.id };
  });
}

describe("the Heard receipt line", () => {
  it.each([
    { label: "work", text: WORK_TEXT, type: "work" },
    { label: "idea", text: IDEA_TEXT, type: "idea" },
    { label: "an Ask it could not place", text: UNCLEAR_TEXT, type: "unclear" }
  ])("opens the result for $label with one line, ahead of any detail", ({ text, type }) => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: text });

    expect(asked.data.heard?.line).toMatch(HEARD_LINE);
    expect(asked.data.heard?.type).toBe(type);
    expect(asked.data.heard?.line).toContain(ASK_HEARD_HINT);
    expect(renderAskSuccess(asked)[0]).toBe(asked.data.heard?.line);
    // The same text is the first line the Discord bot posts.
    expect(formatRequest(asked.data as never).split("\n")[0]).toBe(asked.data.heard?.line);
  });

  it("says what was created and where", () => {
    const { workspace } = workspaceWithProjects();
    const work = runAskCommand({ workspace, request: WORK_TEXT });
    expect(work.data.heard?.line).toContain(`-> Action ${work.data.workItem?.id}`);
    const idea = runAskCommand({ workspace, request: IDEA_TEXT });
    expect(idea.data.heard?.line).toContain(`-> Back Burner item ${idea.data.backBurnerItemId}`);
    const unclear = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(unclear.data.heard?.line).toMatch(/-> question .+ in Clarify First/);
  });

  it("keeps the stewardship detail for --verbose and --json, and out of the default text", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });

    const compact = renderAskSuccess(asked).join("\n");
    expect(compact).not.toContain("Stewardship intent:");
    expect(compact).not.toContain("Execution path:");
    expect(compact).toContain("Decision created:");

    const verbose = renderAskSuccess(asked, { verbose: true }).join("\n");
    expect(verbose).toContain("Stewardship intent:");
    expect(verbose).toContain("Execution path: Clarify First");
    expect(verbose.split("\n")[0]).toBe(asked.data.heard?.line);

    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
  });

  it("prints the line first from the CLI, and the detail only with --verbose; --json carries both", async () => {
    const { workspace } = workspaceWithProjects();
    const run = async (args: string[]): Promise<string> => {
      let stdout = "";
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
      try {
        await buildProgram().parseAsync(["node", "arcadia", "ask", ...args, "--workspace", workspace]);
      } finally {
        vi.restoreAllMocks();
        process.exitCode = undefined;
      }
      return stdout;
    };

    const plain = await run([UNCLEAR_TEXT]);
    expect(plain.split("\n")[0]).toMatch(HEARD_LINE);
    expect(plain).not.toContain("Stewardship intent:");

    const verbose = await run([`${UNCLEAR_TEXT} again`, "--verbose"]);
    expect(verbose.split("\n")[0]).toMatch(HEARD_LINE);
    expect(verbose).toContain("Stewardship intent:");

    const json = JSON.parse(await run([`${UNCLEAR_TEXT} once more`, "--json"]));
    expect(json.data.heard.line).toMatch(HEARD_LINE);
    expect(json.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
  });
});

describe("arcadia ask correct: each target", () => {
  it("work: an unplaced question becomes an Action, the question is closed and linked as superseded", () => {
    const { workspace, arcadiaId } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const questionId = asked.data.reviewItemId as string;
    const runsBefore = count(workspace, "execution_runs");

    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work", project: arcadiaId });

    expect(corrected.data.targetType).toBe("work");
    expect(corrected.data.created.kind).toBe("action");
    expect(corrected.data.previous).toMatchObject({ kind: "question", id: questionId, disposition: "closed" });
    expect(corrected.data.heard.line).toMatch(HEARD_LINE);
    expect(row<{ status: string; decision_note: string }>(workspace, "SELECT status, decision_note FROM review_items WHERE id = ?", questionId))
      .toMatchObject({ status: "rejected", decision_note: expect.stringContaining("Superseded by Ask correction") });
    expect(row<{ project_id: string }>(workspace, "SELECT project_id FROM work_items WHERE id = ?", corrected.data.created.id))
      .toEqual({ project_id: arcadiaId });
    expect(row(workspace, "SELECT old_ask_request_id, new_ask_request_id, old_record_id, new_record_id FROM ask_supersessions WHERE id = ?", corrected.data.supersessionId))
      .toEqual({
        old_ask_request_id: asked.data.ask?.id,
        new_ask_request_id: corrected.data.newAskId,
        old_record_id: questionId,
        new_record_id: corrected.data.created.id
      });
    expect(count(workspace, "execution_runs")).toBe(runsBefore);
    expect(renderAskCorrectSuccess(corrected)[0]).toBe(corrected.data.heard.line);
  });

  it("work: never deletes the original capture, Ask or question", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const captures = count(workspace, "ask_capture_envelopes");
    const asks = count(workspace, "ask_requests");
    const reviews = count(workspace, "review_items");

    runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" });

    expect(count(workspace, "ask_capture_envelopes")).toBe(captures);
    expect(count(workspace, "ask_requests")).toBeGreaterThan(asks);
    expect(count(workspace, "review_items")).toBe(reviews);
    expect(row<{ id: string }>(workspace, "SELECT id FROM review_items WHERE id = ?", asked.data.reviewItemId)).toBeTruthy();
    expect(row<{ original_text: string }>(workspace, "SELECT original_text FROM ask_capture_envelopes WHERE id = ?", asked.data.captureEnvelope.id).original_text)
      .toBe(UNCLEAR_TEXT);
  });

  it("work: a shelved idea is promoted through Back Burner promote", () => {
    const { workspace, songbookId } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: IDEA_TEXT });
    const itemId = asked.data.backBurnerItemId as string;

    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work", project: songbookId });

    expect(corrected.data.previous).toMatchObject({ kind: "idea", id: itemId, disposition: "promoted" });
    expect(row<{ status: string; promoted_work_item_id: string }>(workspace, "SELECT status, promoted_work_item_id FROM back_burner_items WHERE id = ?", itemId))
      .toEqual({ status: "promoted", promoted_work_item_id: corrected.data.created.id });
    expect(row<{ project_id: string }>(workspace, "SELECT project_id FROM work_items WHERE id = ?", corrected.data.created.id))
      .toEqual({ project_id: songbookId });
  });

  it("idea: an Action the Ask created is deferred and the Ask is shelved in Back Burner", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: WORK_TEXT });
    const workId = asked.data.workItem?.id as string;
    expect(workId).toBeTruthy();
    const runsBefore = count(workspace, "execution_runs");

    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "idea" });

    expect(corrected.data.created.kind).toBe("back_burner_item");
    expect(corrected.data.previous).toMatchObject({ kind: "work", id: workId, disposition: "deferred" });
    expect(row<{ status: string }>(workspace, "SELECT status FROM work_items WHERE id = ?", workId)).toEqual({ status: "deferred" });
    expect(row<{ status: string }>(workspace, "SELECT status FROM back_burner_items WHERE id = ?", corrected.data.created.id)).toBeTruthy();
    expect(count(workspace, "execution_runs")).toBe(runsBefore);
  });

  it("idea: an unplaced question is shelved, and an idea moved to another Project archives the old item", () => {
    const { workspace, songbookId } = workspaceWithProjects();
    const question = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const shelved = runAskCorrectCommand({ workspace, askId: question.data.ask?.id as string, type: "idea" });
    expect(shelved.data.previous).toMatchObject({ kind: "question", disposition: "closed" });
    expect(shelved.data.created.kind).toBe("back_burner_item");

    const moved = runAskCorrectCommand({ workspace, askId: shelved.data.newAskId, type: "idea", project: songbookId });
    expect(moved.data.previous).toMatchObject({ kind: "idea", id: shelved.data.created.id, disposition: "archived" });
    expect(row<{ status: string }>(workspace, "SELECT status FROM back_burner_items WHERE id = ?", shelved.data.created.id)).toEqual({ status: "archived" });
    expect(row<{ project_id: string }>(workspace, "SELECT project_id FROM back_burner_items WHERE id = ?", moved.data.created.id)).toEqual({ project_id: songbookId });
  });

  it("status: shows status, creates nothing and supersedes the wrong record", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const workItems = count(workspace, "work_items");

    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "status" });

    expect(corrected.data.targetType).toBe("status");
    expect(corrected.data.created).toMatchObject({ kind: "none", id: null });
    expect(corrected.data.heard.line).toMatch(HEARD_LINE);
    expect(count(workspace, "work_items")).toBe(workItems);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", asked.data.reviewItemId)).toEqual({ status: "rejected" });
  });

  it("answer: goes through review resolve-reply on the referenced pending Decision and queues no Run", () => {
    const { workspace } = workspaceWithProjects();
    const decision = pendingDecision(workspace);
    const asked = runAskCommand({ workspace, request: "Use a 90 day window for the export retention." });
    const questionId = asked.data.reviewItemId as string;
    const runsBefore = count(workspace, "execution_runs");

    const corrected = runAskCorrectCommand({
      workspace,
      askId: asked.data.ask?.id as string,
      type: "answer",
      ref: decision.slug
    });

    expect(corrected.data.targetType).toBe("answer");
    expect(corrected.data.created).toMatchObject({ kind: "decision", id: decision.id });
    expect(corrected.data.previous).toMatchObject({ kind: "question", id: questionId, disposition: "closed" });
    expect(row<{ status: string; decision_note: string }>(workspace, "SELECT status, decision_note FROM review_items WHERE id = ?", decision.id).status).toBe("approved");
    expect(count(workspace, "execution_runs")).toBe(runsBefore);
    expect(count(workspace, "execution_runs", "status IN ('queued', 'pending_execution')")).toBe(0);
  });

  it("answer: approving an ordinary Decision by correction leaves a pending execution Decision, never a Run", () => {
    const { workspace } = workspaceWithProjects();
    const decision = withDatabase(workspace, (db) =>
      createReviewItem(db, {
        askRequestId: raisingAsk(db),
        decisionNeeded: "Add a deterministic fixture for Arcadia?",
        recommendation: "Approve",
        sourceInput: "Add a deterministic fixture for Arcadia.",
        proposedAction: "Add a deterministic fixture for Arcadia.",
        resolvedIntent: "CaptureThought",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      })
    );
    const asked = runAskCommand({ workspace, request: "approve" });
    expect(asked.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    const runsBefore = count(workspace, "execution_runs");

    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "answer", ref: decision.slug ?? decision.id });

    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", decision.id)).toEqual({ status: "approved" });
    expect(count(workspace, "review_items", "resolved_intent = 'ReviewExecutionPending' AND status = 'open'")).toBe(1);
    expect(count(workspace, "execution_runs")).toBe(runsBefore);
    expect(corrected.data.queuedRun).toBe(false);
  });

  it("task is not a target yet: ask-do-for-me-operator-tasks adds it", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "task" })).toThrow(/Unknown correction type/);
  });

  it("moves an unplaced question to another Project with --project alone", () => {
    const { workspace, songbookId } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });

    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, project: songbookId });

    expect(corrected.data.targetType).toBe("reroute");
    expect(corrected.data.previous).toMatchObject({ kind: "question", disposition: "closed" });
    expect(row<{ project_id: string }>(workspace, "SELECT project_id FROM review_items WHERE id = ?", corrected.data.created.id)).toEqual({ project_id: songbookId });
  });

  it("refuses a correction with neither a type nor a Project, an unknown Ask, and a no-op", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: WORK_TEXT });
    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string })).toThrow(/Pass --type/);
    expect(() => runAskCorrectCommand({ workspace, askId: "ask_missing", type: "work" })).toThrow(/No Ask matches/);
    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" })).toThrow(/already an Action/);
  });

  it("refuses to supersede an Action somebody already started", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: WORK_TEXT });
    withDatabase(workspace, (db) => db.prepare("UPDATE work_items SET status = 'in_progress' WHERE id = ?").run(asked.data.workItem?.id));
    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "idea" })).toThrow(/already in_progress/);
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it("corrects again from the live record, so a second reply to the same receipt works", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const first = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "idea" });
    const second = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" });

    expect(second.data.correctedAskId).toBe(first.data.newAskId);
    expect(second.data.previous).toMatchObject({ kind: "idea", id: first.data.created.id });
    expect(count(workspace, "ask_supersessions")).toBe(2);
  });

  it("never lets a correction queue a Run, whichever target it takes", () => {
    const { workspace } = workspaceWithProjects();
    const decision = pendingDecision(workspace);
    const before = count(workspace, "execution_runs");
    for (const [type, ref] of [["work", undefined], ["idea", undefined], ["status", undefined], ["answer", decision.slug]] as const) {
      const asked = runAskCommand({ workspace, request: `${UNCLEAR_TEXT} number ${count(workspace, "ask_requests")}` });
      const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type, ref });
      expect(corrected.data.queuedRun).toBe(false);
      expect(count(workspace, "execution_runs"), type).toBe(before);
    }
    expect(count(workspace, "execution_runs", "work_item_id IS NOT NULL")).toBe(0);
  });
});

describe("arcadia ask correct: answer corrections are explicit and verified", () => {
  it("refuses an answer correction that names no Decision", () => {
    const { workspace } = workspaceWithProjects();
    pendingDecision(workspace);
    const asked = runAskCommand({ workspace, request: "Use a 90 day window for the export retention." });

    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "answer" }))
      .toThrow(/explicit reference to the pending Decision/);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", asked.data.reviewItemId)).toEqual({ status: "open" });
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it("refuses to answer a derived or execution-approval Decision, and creates no work_item or review_item", () => {
    const { workspace } = workspaceWithProjects();
    const workItemId = row<{ id: string }>(workspace, "SELECT id FROM work_items LIMIT 1").id;
    const kinds = ["ReviewExecutionPending", "CodexBuildPacketApproval", "ProjectProposalApproval", "CodexPlanningRunApproval", "CodexPlanningRetryApproval"];
    const refs = withDatabase(workspace, (db) =>
      kinds.map((resolvedIntent) => {
        const item = createReviewItem(db, {
          askRequestId: raisingAsk(db),
          workItemId,
          decisionNeeded: `Approve ${resolvedIntent}?`,
          recommendation: "Approve",
          sourceInput: "Add a deterministic fixture for Arcadia.",
          proposedAction: "Add a deterministic fixture for Arcadia.",
          resolvedIntent,
          confidenceLabel: "high",
          confidence: 1,
          missingFields: [],
          context: {}
        });
        return { kind: resolvedIntent, ref: item.slug ?? item.id, id: item.id };
      })
    );
    // An ordinary-looking intent is still refused when it is tied to an Action.
    const tied = withDatabase(workspace, (db) =>
      createReviewItem(db, {
        workItemId,
        decisionNeeded: "Tied?",
        sourceInput: "x",
        proposedAction: "x",
        resolvedIntent: "CaptureThought",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      })
    );
    refs.push({ kind: "tied to an Action", ref: tied.slug ?? tied.id, id: tied.id });

    const asked = runAskCommand({ workspace, request: "approve" });
    const workItems = count(workspace, "work_items");
    const reviews = count(workspace, "review_items");
    const runs = count(workspace, "execution_runs");

    for (const { kind, ref, id } of refs) {
      expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "answer", ref }), kind)
        .toThrow(/cannot answer it/);
      expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", id), kind).toEqual({ status: "open" });
    }
    expect(count(workspace, "work_items")).toBe(workItems);
    expect(count(workspace, "review_items")).toBe(reviews);
    expect(count(workspace, "execution_runs")).toBe(runs);
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it.each(["SchedulingCircuitBreaker", "CandidateQaSignoff", "PrBlastRadiusAssessment"])(
    "refuses a system-raised %s Decision (no Ask raised it), creating no work_item or review_item",
    (resolvedIntent) => {
      const { workspace } = workspaceWithProjects();
      const system = withDatabase(workspace, (db) =>
        createReviewItem(db, {
          decisionNeeded: `Decide ${resolvedIntent}?`,
          recommendation: "Approve",
          sourceInput: "Add a deterministic fixture for Arcadia.",
          proposedAction: "Add a deterministic fixture for Arcadia.",
          resolvedIntent,
          confidenceLabel: "high",
          confidence: 1,
          missingFields: [],
          context: {}
        })
      );
      const asked = runAskCommand({ workspace, request: "approve" });
      const workItems = count(workspace, "work_items");
      const reviews = count(workspace, "review_items");

      expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "answer", ref: system.slug ?? system.id }))
        .toThrow(/was not raised by an Ask/);
      expect(count(workspace, "work_items")).toBe(workItems);
      expect(count(workspace, "review_items")).toBe(reviews);
      expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", system.id)).toEqual({ status: "open" });
    }
  );

  it("does not overwrite a question answered while the correction ran, and links nothing", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    // The status correction inserts one Ask row; answering the question at that moment is the race.
    withDatabase(workspace, (db) =>
      db.exec(
        `CREATE TRIGGER concurrent_answer AFTER INSERT ON ask_requests WHEN NEW.output_kind = 'correction'
         BEGIN UPDATE review_items SET status = 'approved' WHERE id = '${asked.data.reviewItemId}'; END`
      )
    );

    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "status" }))
      .toThrow(/is now approved, changed while the correction ran/);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", asked.data.reviewItemId)).toEqual({ status: "approved" });
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it("is idempotent: a retry after a failed link reuses the replacement, so exactly one Action exists", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const before = count(workspace, "work_items");
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON ask_supersessions BEGIN SELECT RAISE(ABORT, 'link failed'); END")
    );
    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" })).toThrow(/link failed/);
    expect(count(workspace, "work_items")).toBe(before + 1);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", asked.data.reviewItemId)).toEqual({ status: "open" });

    withDatabase(workspace, (db) => db.exec("DROP TRIGGER fail_link"));
    const retried = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" });

    expect(count(workspace, "work_items")).toBe(before + 1);
    expect(count(workspace, "ask_supersessions")).toBe(1);
    expect(retried.data.previous).toMatchObject({ kind: "question", disposition: "closed" });
    expect(row<{ new_record_id: string }>(workspace, "SELECT new_record_id FROM ask_supersessions").new_record_id).toBe(retried.data.created.id);
    expect(row<{ id: string }>(workspace, "SELECT id FROM work_items WHERE id = ?", retried.data.created.id)).toBeTruthy();
    // A second plain run now has nothing left to correct.
    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" })).toThrow(/already an Action/);
  });

  it("is idempotent for an idea and for a promotion too", () => {
    const { workspace } = workspaceWithProjects();
    const question = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const ideasBefore = count(workspace, "back_burner_items");
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON ask_supersessions BEGIN SELECT RAISE(ABORT, 'link failed'); END")
    );
    expect(() => runAskCorrectCommand({ workspace, askId: question.data.ask?.id as string, type: "idea" })).toThrow(/link failed/);
    withDatabase(workspace, (db) => db.exec("DROP TRIGGER fail_link"));
    runAskCorrectCommand({ workspace, askId: question.data.ask?.id as string, type: "idea" });
    expect(count(workspace, "back_burner_items")).toBe(ideasBefore + 1);

    const idea = runAskCommand({ workspace, request: IDEA_TEXT });
    const worksBefore = count(workspace, "work_items");
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON ask_supersessions BEGIN SELECT RAISE(ABORT, 'link failed'); END")
    );
    expect(() => runAskCorrectCommand({ workspace, askId: idea.data.ask?.id as string, type: "work" })).toThrow(/link failed/);
    withDatabase(workspace, (db) => db.exec("DROP TRIGGER fail_link"));
    const retried = runAskCorrectCommand({ workspace, askId: idea.data.ask?.id as string, type: "work" });
    expect(count(workspace, "work_items")).toBe(worksBefore + 1);
    expect(retried.data.previous.disposition).toBe("promoted");
  });

  it("refuses the real execution-pending Decision an approval leaves behind (no duplicate Action)", () => {
    const { workspace } = workspaceWithProjects();
    const question = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    runReviewApproveCommand({ workspace, id: question.data.reviewItemId as string, execute: false });
    const pending = row<{ id: string; slug: string }>(workspace, "SELECT id, slug FROM review_items WHERE resolved_intent = 'ReviewExecutionPending'");
    const second = runAskCommand({ workspace, request: "approve" });
    const workItems = count(workspace, "work_items");
    const reviews = count(workspace, "review_items");

    expect(() => runAskCorrectCommand({ workspace, askId: second.data.ask?.id as string, type: "answer", ref: pending.slug }))
      .toThrow(/approves execution/);
    expect(count(workspace, "work_items")).toBe(workItems);
    expect(count(workspace, "review_items")).toBe(reviews);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", pending.id)).toEqual({ status: "open" });
  });

  it("may answer another Ask's question, which creates its Action once and queues no Run", () => {
    const { workspace } = workspaceWithProjects();
    const first = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const second = runAskCommand({ workspace, request: "approve" });
    const runs = count(workspace, "execution_runs");
    const corrected = runAskCorrectCommand({ workspace, askId: second.data.ask?.id as string, type: "answer", ref: first.data.reviewItemId as string });
    expect(corrected.data.created.id).toBe(first.data.reviewItemId);
    expect(count(workspace, "execution_runs")).toBe(runs);
    expect(count(workspace, "review_items", "resolved_intent = 'ReviewExecutionPending'")).toBe(1);
  });

  it("never claims execution in the correction summary", () => {
    const { workspace } = workspaceWithProjects();
    const decision = withDatabase(workspace, (db) =>
      createReviewItem(db, {
        askRequestId: raisingAsk(db),
        decisionNeeded: "Add a deterministic fixture for Arcadia?",
        sourceInput: "Add a deterministic fixture for Arcadia.",
        proposedAction: "Add a deterministic fixture for Arcadia.",
        resolvedIntent: "CaptureThought",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      })
    );
    const asked = runAskCommand({ workspace, request: "approve" });
    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "answer", ref: decision.slug ?? decision.id });
    const text = [corrected.data.created.summary, ...renderAskCorrectSuccess(corrected)].join("\n");
    expect(text).not.toMatch(/resum|executing|execution queued/i);
    expect(text).toContain("No execution was started.");
  });

  it("states a work correction that needs review as such in the receipt", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "work" });
    const queue = row<{ queue: string }>(workspace, "SELECT queue FROM work_items WHERE id = ?", corrected.data.created.id).queue;
    expect(queue).toBe("requires_review");
    expect(corrected.data.heard.line).toContain(`Action ${corrected.data.created.id} (needs review)`);
    expect(corrected.data.heard.line).toMatch(HEARD_LINE);
  });

  it("closes the old record and records the link together or not at all", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER fail_retire BEFORE UPDATE ON review_items BEGIN SELECT RAISE(ABORT, 'boom'); END")
    );
    expect(() => runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "idea" })).toThrow(/boom/);
    expect(count(workspace, "ask_supersessions")).toBe(0);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", asked.data.reviewItemId)).toEqual({ status: "open" });
  });

  it("refuses a reference that is missing, already decided or the Ask's own question", () => {
    const { workspace } = workspaceWithProjects();
    const decision = pendingDecision(workspace);
    const asked = runAskCommand({ workspace, request: "Use a 90 day window for the export retention." });
    const askId = asked.data.ask?.id as string;

    expect(() => runAskCorrectCommand({ workspace, askId, type: "answer", ref: "review_nope" })).toThrow(/not found/);
    expect(() => runAskCorrectCommand({ workspace, askId, type: "answer", ref: asked.data.reviewItemId as string })).toThrow(/cannot answer the question it raised/);
    withDatabase(workspace, (db) => db.prepare("UPDATE review_items SET status = 'approved' WHERE id = ?").run(decision.id));
    expect(() => runAskCorrectCommand({ workspace, askId, type: "answer", ref: decision.slug })).toThrow(/already decided/);
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it("refuses an answer correction from Discord unless DISCORD_ALLOWED_USER_IDS is set and lists the author", () => {
    const { workspace } = workspaceWithProjects();
    const decision = pendingDecision(workspace);
    const asked = runAskCommand({ workspace, request: "Use a 90 day window for the export retention." });
    const base = { workspace, askId: asked.data.ask?.id as string, type: "answer", ref: decision.slug, source: "discord" as const };

    expect(() => runAskCorrectCommand({ ...base, actor: "42" })).toThrow(/verified author/);
    process.env.DISCORD_ALLOWED_USER_IDS = "7, 8";
    expect(() => runAskCorrectCommand({ ...base, actor: "42" })).toThrow(/verified author/);
    expect(() => runAskCorrectCommand({ ...base })).toThrow(/verified author/);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", decision.id)).toEqual({ status: "open" });

    process.env.DISCORD_ALLOWED_USER_IDS = "7, 42";
    const ok = runAskCorrectCommand({ ...base, actor: "42" });
    expect(ok.data.created).toMatchObject({ kind: "decision", id: decision.id });
  });

  it("does not need the allowlist for the non-answer targets from Discord", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "idea", source: "discord", actor: "42" });
    expect(corrected.data.created.kind).toBe("back_burner_item");
    expect(row<{ source: string; actor: string }>(workspace, "SELECT source, actor FROM ask_supersessions")).toEqual({ source: "discord", actor: "42" });
  });
});

describe("ask show displays the supersession", () => {
  it("marks the replaced record and links both Asks", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const corrected = runAskCorrectCommand({ workspace, askId: asked.data.ask?.id as string, type: "idea" });

    const trail = runAskShowCommand({ workspace, id: asked.data.captureEnvelope.id });
    const [original, replacement] = trail.data.asks;
    expect(original?.id).toBe(asked.data.ask?.id);
    expect(original?.supersededBy).toEqual([
      expect.objectContaining({ askId: corrected.data.newAskId, targetType: "idea", record: { kind: "back_burner_item", id: corrected.data.created.id } })
    ]);
    expect(original?.outcomes).toContainEqual(
      expect.objectContaining({ kind: "decision", id: asked.data.reviewItemId, supersededBy: { askId: corrected.data.newAskId, recordId: corrected.data.created.id } })
    );
    expect(replacement?.supersedes).toMatchObject({ askId: asked.data.ask?.id, targetType: "idea" });

    const text = renderAskTrailSuccess(trail).join("\n");
    expect(text).toContain(`[superseded by ${corrected.data.created.id} via ${corrected.data.newAskId}]`);
    expect(text).toContain(`Superseded by ${corrected.data.newAskId}: corrected to idea`);
    expect(text).toContain(`Supersedes ${asked.data.ask?.id}: corrected to idea`);
  });

  it("leaves an uncorrected Ask's trail unchanged", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const trail = runAskShowCommand({ workspace, id: asked.data.ask?.id as string });
    expect(trail.data.asks[0]?.supersededBy).toEqual([]);
    expect(trail.data.asks[0]?.supersedes).toBeNull();
    expect(renderAskTrailSuccess(trail).join("\n")).not.toContain("uperse");
  });

  it("still reads a database that predates the supersession table", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) => db.exec("DROP TABLE ask_supersessions"));
    expect(runAskShowCommand({ workspace, id: asked.data.ask?.id as string }).data.asks[0]?.supersededBy).toEqual([]);
  });

  it("is runnable as arcadia ask correct and reports through --json", async () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { stdout += String(chunk); return true; });
    try {
      await buildProgram().parseAsync([
        "node", "arcadia", "ask", "correct", asked.data.ask?.id as string, "--type", "idea", "--workspace", workspace, "--json"
      ]);
    } finally {
      vi.restoreAllMocks();
      process.exitCode = undefined;
    }
    const json = JSON.parse(stdout);
    expect(json).toMatchObject({ ok: true, command: "ask.correct", data: { targetType: "idea", queuedRun: false } });
    expect(json.data.previous.id).toBe(asked.data.reviewItemId);
  });
});

describe("a correction cannot approve an Ask question into a Run", () => {
  it("keeps the Ask-question no-execute rule: answering the question a correction left behind queues nothing", () => {
    const { workspace } = workspaceWithProjects();
    const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const runsBefore = count(workspace, "execution_runs");
    // The question is still approvable on its own, and approving it starts no executor.
    runReviewApproveCommand({ workspace, id: asked.data.reviewItemId as string, execute: true });
    expect(count(workspace, "execution_runs")).toBe(runsBefore);
  });
});

describe("Discord: a reply to an Ask receipt that starts with type: or project:", () => {
  const AUTHOR = "424242";

  function config(workspace: string, allowedUserIds: string[] = []) {
    return {
      arcadiaWorkspace: workspace,
      discordBotToken: "token",
      discordClientId: "client",
      discordGuildId: "guild",
      discordChannelId: "channel",
      arcadiaCliPath: null,
      pollIntervalSeconds: 60,
      allowedUserIds
    } as never;
  }

  function message(options: { content: string; referenceMessageId?: string; authorId?: string; replies: string[]; sentId?: string }) {
    return {
      content: options.content,
      guildId: "guild",
      channelId: "channel",
      author: { bot: false, id: options.authorId ?? AUTHOR },
      react: async () => {},
      reference: options.referenceMessageId ? { messageId: options.referenceMessageId } : null,
      reply: async (content: string) => {
        options.replies.push(content);
        return { id: options.sentId ?? `sent_${options.replies.length}` };
      }
    } as never;
  }

  /** The bot's CLI over the real commands, as `cli.ask` and `cli.askCorrect` are in production. */
  function realCli(workspace: string, calls: Array<Record<string, unknown>>): ArcadiaCli {
    return {
      ask: async (request: string, options?: { sourceIngress?: string }) => ({
        ok: true,
        command: "ask",
        data: JSON.parse(JSON.stringify(runAskCommand({ workspace, request, sourceIngress: options?.sourceIngress }).data))
      }),
      askCorrect: async (askId: string, correction: Record<string, unknown>) => {
        calls.push({ askId, ...correction });
        return {
          ok: true,
          command: "ask.correct",
          data: runAskCorrectCommand({
            workspace,
            askId,
            type: (correction.type as string | null) ?? undefined,
            project: (correction.project as string | null) ?? undefined,
            ref: (correction.ref as string | null) ?? undefined,
            source: "discord",
            actor: correction.actor as string
          }).data
        };
      }
    } as unknown as ArcadiaCli;
  }

  it("records the receipt message to ask id mapping, like review messages", async () => {
    const { workspace } = workspaceWithProjects();
    const replies: string[] = [];
    await handleArcadiaMessage(message({ content: UNCLEAR_TEXT, replies, sentId: "receipt_1" }), config(workspace), realCli(workspace, []));

    expect(replies[0]?.split("\n")[0]).toMatch(HEARD_LINE);
    const state = await loadAskReceiptMessageState(askReceiptMessageStatePath(workspace));
    const askId = row<{ id: string }>(workspace, "SELECT id FROM ask_requests ORDER BY created_at DESC LIMIT 1").id;
    expect(state.messages.receipt_1).toMatchObject({ askId, channelId: "channel", messageId: "receipt_1" });
  });

  it("calls the same command for type: and posts and records the new receipt", async () => {
    const { workspace, songbookId } = workspaceWithProjects();
    const calls: Array<Record<string, unknown>> = [];
    const cli = realCli(workspace, calls);
    const first: string[] = [];
    await handleArcadiaMessage(message({ content: UNCLEAR_TEXT, replies: first, sentId: "receipt_1" }), config(workspace), cli);

    const second: string[] = [];
    await handleArcadiaMessage(
      message({ content: "type: work project: living-songbook", referenceMessageId: "receipt_1", replies: second, sentId: "receipt_2" }),
      config(workspace),
      cli
    );

    expect(calls).toEqual([expect.objectContaining({ type: "work", project: "living-songbook", ref: null, actor: AUTHOR })]);
    expect(second[0]?.split("\n")[0]).toMatch(HEARD_LINE);
    expect(second[0]).toContain("Arcadia correction applied");
    expect(second[0]).toContain("Superseded: question");
    expect(count(workspace, "ask_supersessions")).toBe(1);
    expect(row<{ project_id: string }>(workspace, "SELECT w.project_id FROM work_items w JOIN ask_supersessions s ON s.new_record_id = w.id")).toEqual({ project_id: songbookId });
    const state = await loadAskReceiptMessageState(askReceiptMessageStatePath(workspace));
    expect(state.messages.receipt_2?.askId).toBe(row<{ new_ask_request_id: string }>(workspace, "SELECT new_ask_request_id FROM ask_supersessions").new_ask_request_id);
  });

  it("treats a project: reply as a correction too", async () => {
    const { workspace, songbookId } = workspaceWithProjects();
    const calls: Array<Record<string, unknown>> = [];
    const cli = realCli(workspace, calls);
    await handleArcadiaMessage(message({ content: UNCLEAR_TEXT, replies: [], sentId: "receipt_1" }), config(workspace), cli);
    const replies: string[] = [];
    await handleArcadiaMessage(message({ content: "project: living-songbook", referenceMessageId: "receipt_1", replies }), config(workspace), cli);

    expect(calls).toEqual([expect.objectContaining({ type: null, project: "living-songbook" })]);
    expect(replies[0]).toContain("Arcadia correction applied");
    expect(row<{ project_id: string }>(workspace, "SELECT project_id FROM review_items WHERE status = 'open' AND ask_request_id IS NOT NULL")).toEqual({ project_id: songbookId });
  });

  it("treats any other reply to a receipt as a new Ask, not a correction", async () => {
    const { workspace } = workspaceWithProjects();
    const calls: Array<Record<string, unknown>> = [];
    const cli = realCli(workspace, calls);
    await handleArcadiaMessage(message({ content: UNCLEAR_TEXT, replies: [], sentId: "receipt_1" }), config(workspace), cli);
    const asks = count(workspace, "ask_requests");
    await handleArcadiaMessage(message({ content: "no wait, a different thing: Sourdough again", referenceMessageId: "receipt_1", replies: [] }), config(workspace), cli);

    expect(calls).toEqual([]);
    expect(count(workspace, "ask_requests")).toBe(asks + 1);
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it("refuses type: answer when DISCORD_ALLOWED_USER_IDS is not configured, and when it omits the author", async () => {
    const { workspace } = workspaceWithProjects();
    const decision = pendingDecision(workspace);
    const calls: Array<Record<string, unknown>> = [];
    const cli = realCli(workspace, calls);
    await handleArcadiaMessage(message({ content: "Use a 90 day window for the export retention.", replies: [], sentId: "receipt_1" }), config(workspace), cli);

    for (const allowed of [[], ["7"]]) {
      const replies: string[] = [];
      // With a list that omits the author the whole message is refused earlier, so only the unset list reaches the correction gate.
      await handleArcadiaMessage(
        message({ content: `type: answer ref: ${decision.slug}`, referenceMessageId: "receipt_1", replies }),
        config(workspace, allowed),
        cli
      );
      if (allowed.length === 0) expect(replies[0]).toContain("Arcadia correction refused");
      else expect(replies).toEqual([]);
    }
    expect(calls).toEqual([]);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", decision.id)).toEqual({ status: "open" });
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it("accepts type: answer ref: from a listed author and answers through resolve-reply with no Run", async () => {
    const { workspace } = workspaceWithProjects();
    const decision = pendingDecision(workspace);
    const calls: Array<Record<string, unknown>> = [];
    const cli = realCli(workspace, calls);
    process.env.DISCORD_ALLOWED_USER_IDS = AUTHOR;
    await handleArcadiaMessage(message({ content: "Use a 90 day window for the export retention.", replies: [], sentId: "receipt_1" }), config(workspace, [AUTHOR]), cli);
    const runsBefore = count(workspace, "execution_runs");

    const replies: string[] = [];
    await handleArcadiaMessage(
      message({ content: `type: answer ref: ${decision.slug}`, referenceMessageId: "receipt_1", replies }),
      config(workspace, [AUTHOR]),
      cli
    );

    expect(calls).toEqual([expect.objectContaining({ type: "answer", ref: decision.slug, actor: AUTHOR })]);
    expect(replies[0]).toContain("Arcadia correction applied");
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", decision.id)).toEqual({ status: "approved" });
    expect(count(workspace, "execution_runs")).toBe(runsBefore);
  });

  it("refuses type: answer with no ref: and type: task, and reports the CLI's reason", async () => {
    const { workspace } = workspaceWithProjects();
    pendingDecision(workspace);
    process.env.DISCORD_ALLOWED_USER_IDS = AUTHOR;
    const cli = realCli(workspace, []);
    await handleArcadiaMessage(message({ content: "Use a 90 day window for the export retention.", replies: [], sentId: "receipt_1" }), config(workspace, [AUTHOR]), cli);

    const noRef: string[] = [];
    await handleArcadiaMessage(message({ content: "type: answer", referenceMessageId: "receipt_1", replies: noRef }), config(workspace, [AUTHOR]), cli);
    expect(noRef[0]).toContain("explicit reference to the pending Decision");

    const task: string[] = [];
    await handleArcadiaMessage(message({ content: "type: task", referenceMessageId: "receipt_1", replies: task }), config(workspace, [AUTHOR]), cli);
    expect(task[0]).toContain("Unknown correction type");
    expect(count(workspace, "ask_supersessions")).toBe(0);
  });

  it("parses the reply fields", () => {
    expect(parseAskCorrectionReply("type: work")).toEqual({ type: "work", project: null, ref: null });
    expect(parseAskCorrectionReply("Type: Answer, ref: R12")).toEqual({ type: "answer", project: null, ref: "R12" });
    expect(parseAskCorrectionReply("project: `songbook` type: idea")).toEqual({ type: "idea", project: "songbook", ref: null });
    expect(parseAskCorrectionReply("please use type: work")).toBeNull();
    expect(parseAskCorrectionReply("thanks")).toBeNull();
  });
});
