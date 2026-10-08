import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureOperatorReply,
  ingressSourceKind,
  operatorReplyRequestId
} from "../src/ask/replyCapture.js";
import { runAskCommand } from "../src/commands/ask.js";
import { runDecisionApproveCommand, runDecisionNewCommand } from "../src/commands/decision.js";
import { ACTION_CLARIFICATION_INTENT, runReviewResolveReplyCommand } from "../src/commands/review.js";
import { runWorkResolveQuestionCommand } from "../src/commands/workQuestion.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  upsertProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function workspaceOnly(): string {
  const workspace = path.join(scratch("arcadia-reply-capture-"), "ws");
  initWorkspace(workspace);
  return workspace;
}

interface EnvelopeRow { id: string; request_id: string; original_text: string; ingress_source: string; envelope_json: string }

function envelopes(workspace: string): EnvelopeRow[] {
  return withDatabase(workspace, (db) =>
    db.prepare("SELECT id, request_id, original_text, ingress_source, envelope_json FROM ask_capture_envelopes ORDER BY captured_at, id").all()
  ) as EnvelopeRow[];
}

function captureEvents(workspace: string): Array<{ review_item_id: string | null; payload: Record<string, unknown> }> {
  return (withDatabase(workspace, (db) =>
    db.prepare("SELECT review_item_id, payload_json FROM events WHERE event_type = 'operator.reply.captured' ORDER BY created_at, id").all()
  ) as Array<{ review_item_id: string | null; payload_json: string }>).map((row) => ({
    review_item_id: row.review_item_id,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>
  }));
}

describe("captureOperatorReply helper", () => {
  it("makes one envelope per distinct reply with the documented request id and exact text", () => {
    const workspace = workspaceOnly();
    const text = "  Ship it, but keep the old route.\n";
    const first = withDatabase(workspace, (db) => captureOperatorReply(db, {
      surface: "review.resolve-reply", entityId: "review_1", text, ingressSource: "operator.reply.review"
    }));
    const other = withDatabase(workspace, (db) => captureOperatorReply(db, {
      surface: "review.resolve-reply", entityId: "review_1", text: "Hold.", ingressSource: "operator.reply.review"
    }));

    expect(first.status).toBe("captured");
    expect(other.status).toBe("captured");
    const rows = envelopes(workspace);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.request_id).toBe(operatorReplyRequestId("review.resolve-reply", "review_1", text));
    expect(rows[0]?.request_id).toMatch(/^review\.resolve-reply:review_1:[0-9a-f]{12}$/);
    expect(rows[0]?.original_text).toBe(text);
    expect(rows[0]?.ingress_source).toBe("operator.reply.review");
    const envelope = JSON.parse(rows[0].envelope_json) as { actor: unknown; project?: unknown; authority: string };
    expect(envelope.actor).toBeNull();
    expect("project" in envelope).toBe(false);
    expect(envelope.authority).toBe("untrusted_input");
    expect(ingressSourceKind("operator.reply.review")).toBe("provenance");
    expect(ingressSourceKind("agent.ask")).toBe("agent");
    expect(ingressSourceKind("cli.ask")).toBeNull();
  });

  it("is idempotent on replay: one envelope, one event, and the first actor wins", () => {
    const workspace = workspaceOnly();
    const base = { surface: "review.resolve-reply", entityId: "review_1", text: "Yes.", ingressSource: "operator.reply.review" as const };
    const first = withDatabase(workspace, (db) => captureOperatorReply(db, { ...base, actor: { id: "discord-111" }, project: "demo" }));
    const replay = withDatabase(workspace, (db) => captureOperatorReply(db, { ...base, actor: { id: "discord-222" }, project: "other" }));

    expect(first.status).toBe("captured");
    expect(replay.status).toBe("replayed");
    expect(replay).toMatchObject({ captureId: (first as { captureId: string }).captureId });
    const rows = envelopes(workspace);
    expect(rows).toHaveLength(1);
    const stored = JSON.parse(rows[0].envelope_json) as { actor: { id: string }; project: string };
    expect(stored.actor).toEqual({ id: "discord-111" });
    expect(stored.project).toBe("demo");
    expect(captureEvents(workspace)).toHaveLength(1);
  });

  it("skips when the caller already holds a capture id", () => {
    const workspace = workspaceOnly();
    const result = withDatabase(workspace, (db) => captureOperatorReply(db, {
      surface: "review.resolve-reply", entityId: "review_1", text: "Yes.", ingressSource: "operator.reply.review",
      heldCaptureId: "capture_held"
    }));
    expect(result).toEqual({ status: "skipped", captureId: "capture_held" });
    expect(envelopes(workspace)).toHaveLength(0);
    expect(captureEvents(workspace)).toHaveLength(0);
  });

  it("fails open: logs, returns failed, and leaves no partial envelope", () => {
    const workspace = workspaceOnly();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    withDatabase(workspace, (db) => db.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON events WHEN NEW.event_type = 'operator.reply.captured' BEGIN SELECT RAISE(ABORT, 'event store down'); END;"
    ));
    const result = withDatabase(workspace, (db) => captureOperatorReply(db, {
      surface: "review.resolve-reply", entityId: "review_1", text: "Yes.", ingressSource: "operator.reply.review"
    }));
    expect(result.status).toBe("failed");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("operator reply capture failed"));
    expect(envelopes(workspace)).toHaveLength(0);
  });
});

function clarificationItem(workspace: string, question = "Does the proposal ship as written?") {
  return withDatabase(workspace, (db) => {
    const { project } = createProjectWithInitialWork(db, {
      name: "The Thing", mission: "Prove it.", status: "active", currentMilestone: "M1",
      nextAction: "Do it.", workClassification: "agent"
    });
    const { workItem } = createWorkItemWithOptionalArtifact(db, {
      projectId: project.id, title: "Build the surface", rawInput: "Build the surface",
      queue: "work_queue", workClassification: "agent", nextAction: "Clarify the desired outcome."
    });
    db.prepare("UPDATE work_items SET clarification_status = 'question_open', open_question = ? WHERE id = ?").run(question, workItem.id);
    const review = createReviewItem(db, {
      workItemId: workItem.id, projectId: project.id, decisionNeeded: question, recommendation: null,
      sourceInput: "test", proposedAction: "Answer it.", resolvedIntent: ACTION_CLARIFICATION_INTENT,
      confidenceLabel: "medium", confidence: 0, missingFields: []
    });
    return { workItemId: workItem.id, reviewId: review.id };
  });
}

function reviewRow(workspace: string, id: string) {
  return withDatabase(workspace, (db) =>
    db.prepare("SELECT status, decision_note, capture_id FROM review_items WHERE id = ?").get(id)
  ) as { status: string; decision_note: string | null; capture_id: string | null };
}

describe("review resolve-reply capture", () => {
  it("captures the exact reply once with the Discord actor and leaves capture_id alone", () => {
    const workspace = workspaceOnly();
    const { reviewId } = clarificationItem(workspace);
    const reply = "Yes, ship it as written, but call me first.";

    const response = runReviewResolveReplyCommand({ workspace, id: reviewId, reply, actor: "discord-424242" });

    expect(response.data.action).toBe("approved");
    expect(reviewRow(workspace, reviewId)).toMatchObject({ status: "approved", capture_id: null });
    const rows = envelopes(workspace);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ original_text: reply, ingress_source: "operator.reply.review" });
    expect(JSON.parse(rows[0].envelope_json)).toMatchObject({ actor: { id: "discord-424242" } });
    const [event] = captureEvents(workspace);
    expect(event?.review_item_id).toBe(reviewId);
    expect(event?.payload).toMatchObject({ captureId: rows[0].id, surface: "review.resolve-reply", entityId: reviewId });
  });

  it("records actor null for a reply with no authenticated principal", () => {
    const workspace = workspaceOnly();
    const { reviewId } = clarificationItem(workspace);
    runReviewResolveReplyCommand({ workspace, id: reviewId, reply: "Yes, as written." });
    expect(JSON.parse(envelopes(workspace)[0].envelope_json)).toMatchObject({ actor: null });
  });

  it("leaves the canonical write unchanged when capture fails", () => {
    const workspace = workspaceOnly();
    const { reviewId } = clarificationItem(workspace);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    withDatabase(workspace, (db) => db.exec(
      "CREATE TRIGGER fail_capture BEFORE INSERT ON ask_capture_envelopes BEGIN SELECT RAISE(ABORT, 'capture store down'); END;"
    ));

    const response = runReviewResolveReplyCommand({ workspace, id: reviewId, reply: "Yes, as written." });

    expect(response.ok).toBe(true);
    expect(response.data.action).toBe("approved");
    expect(reviewRow(workspace, reviewId)).toMatchObject({ status: "approved", decision_note: "Yes, as written." });
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("operator reply capture failed"));
    expect(envelopes(workspace)).toHaveLength(0);
  });

  it("makes no envelope when the caller holds a capture id", () => {
    const workspace = workspaceOnly();
    const { reviewId } = clarificationItem(workspace);
    runReviewResolveReplyCommand({ workspace, id: reviewId, reply: "Yes, as written.", captureId: "capture_held" });
    expect(envelopes(workspace)).toHaveLength(0);
  });

  it("makes no envelope when the reply is refused", () => {
    const workspace = workspaceOnly();
    expect(() => runReviewResolveReplyCommand({ workspace, id: "review_missing", reply: "Yes." })).toThrow();
    expect(envelopes(workspace)).toHaveLength(0);
  });
});

describe("ask reply path", () => {
  it("yields exactly one envelope for a reply routed through ask, with no operator.reply.review duplicate", () => {
    const workspace = workspaceOnly();
    const { reviewId } = clarificationItem(workspace);
    const reply = `${reviewId} Yes, ship it as written.`;

    runAskCommand({ workspace, request: reply, sourceIngress: "discord.message" });

    expect(reviewRow(workspace, reviewId).status).toBe("approved");
    const rows = envelopes(workspace);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ingress_source).toBe("discord.message");
    expect(captureEvents(workspace)).toHaveLength(0);
  });

  it("rejects an over-long --actor before any write", () => {
    const workspace = workspaceOnly();
    const { reviewId } = clarificationItem(workspace);
    expect(() => runReviewResolveReplyCommand({ workspace, id: reviewId, reply: "Yes.", actor: "x".repeat(129) })).toThrow(/at most 128/);
    expect(reviewRow(workspace, reviewId).status).toBe("open");
    expect(envelopes(workspace)).toHaveLength(0);
  });
});

describe("work resolve-question capture", () => {
  it("captures the dashboard/CLI answer once, provenance-only, with actor null", () => {
    const workspace = workspaceOnly();
    const { workItemId } = clarificationItem(workspace);
    runWorkResolveQuestionCommand({ workspace, workId: workItemId, answer: "Yes, ship it." });
    const rows = envelopes(workspace);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ original_text: "Yes, ship it.", ingress_source: "operator.reply.work-question" });
    expect(rows[0].request_id).toBe(operatorReplyRequestId("work.resolve-question", workItemId, "Yes, ship it."));
    expect(JSON.parse(rows[0].envelope_json)).toMatchObject({ actor: null });
  });
});

function decisionWorkspace(): { workspace: string; repoRoot: string } {
  const root = scratch("arcadia-reply-capture-decision-");
  const repoRoot = path.join(root, "repo");
  mkdirSync(repoRoot, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "reply-capture@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Reply Capture"], { cwd: repoRoot });
  writeFileSync(path.join(repoRoot, "README.md"), "repo\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: repoRoot });
  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Exercise reply capture.", status: "active", currentMilestone: "Initial",
      nextAction: "Start", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
  });
  return { workspace, repoRoot };
}

describe("decision approve capture", () => {
  it("captures a free-text answer once, with the project slug, and survives a same-day retry", () => {
    const { workspace } = decisionWorkspace();
    runDecisionNewCommand({ workspace, project: "demo", slug: "free-text", question: "What should we do?" });
    const answer = "Do the cheap thing first; revisit in a week.";

    const first = runDecisionApproveCommand({ workspace, project: "demo", id: "0001", answer });
    expect(first.data.applied).toBe(true);
    const retry = runDecisionApproveCommand({ workspace, project: "demo", id: "0001", answer });
    expect(retry.data.applied).toBe(true);

    const rows = envelopes(workspace);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ original_text: answer, ingress_source: "operator.reply.decision" });
    expect(rows[0].request_id).toBe(operatorReplyRequestId("decision.approve", "0001", answer));
    expect(JSON.parse(rows[0].envelope_json)).toMatchObject({ actor: null, project: "demo" });
    expect(captureEvents(workspace)).toHaveLength(1);
  });

  it("does not capture an offered option label, a dry run, or a held capture id", () => {
    const { workspace } = decisionWorkspace();
    runDecisionNewCommand({
      workspace, project: "demo", slug: "pick", question: "Merge now or hold?",
      options: [{ label: "Merge now", consequence: "Ships." }, { label: "Hold", consequence: "Waits." }]
    });
    runDecisionApproveCommand({ workspace, project: "demo", id: "0001", answer: "Hold", dryRun: true });
    runDecisionApproveCommand({ workspace, project: "demo", id: "0001", answer: "Hold" });
    expect(envelopes(workspace)).toHaveLength(0);

    runDecisionNewCommand({ workspace, project: "demo", slug: "held", question: "Anything?" });
    runDecisionApproveCommand({ workspace, project: "demo", id: "0002", answer: "Nothing.", captureId: "capture_held" });
    expect(envelopes(workspace)).toHaveLength(0);
  });

  it("leaves the Decision answer unchanged when capture fails", () => {
    const { workspace, repoRoot } = decisionWorkspace();
    runDecisionNewCommand({ workspace, project: "demo", slug: "free-text", question: "What should we do?" });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    withDatabase(workspace, (db) => db.exec(
      "CREATE TRIGGER fail_capture BEFORE INSERT ON ask_capture_envelopes BEGIN SELECT RAISE(ABORT, 'capture store down'); END;"
    ));

    const result = runDecisionApproveCommand({ workspace, project: "demo", id: "0001", answer: "Go." });

    expect(result.data.applied).toBe(true);
    expect(result.data.receiptId).toMatch(/^decisionanswer_/);
    const log = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repoRoot, encoding: "utf8" });
    expect(log).toContain("answer Decision 0001");
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("operator reply capture failed"));
    expect(envelopes(workspace)).toHaveLength(0);
  });
});
