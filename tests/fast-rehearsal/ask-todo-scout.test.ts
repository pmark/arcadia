import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAskCommand } from "../../src/commands/ask.js";
import { runAskShowCommand } from "../../src/commands/askTrail.js";
import { runTodoCommand } from "../../src/commands/todo.js";
import { withReadOnlyDatabase, withDatabase } from "../../src/db/connection.js";
import { createMilestoneForProject, createProjectWithInitialWork, upsertProjectMetadata } from "../../src/db/repositories.js";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
import { PhaseRecorder, sanitizer, writeScenarioReport } from "./helpers/report.js";
import { isolateProcess, type IsolatedProcess } from "./helpers/environment.js";

const REQUEST_ID = "ask-todo-scout-hello-world-20261012";
const APPROVAL_REQUEST_ID = `${REQUEST_ID}-approval`;
const PROJECT = "Ask To-do Scout";
const OUTPUT_PATH = "HelloWorld.txt";
const OUTPUT_BYTES = Buffer.from("Hello World!\n", "utf8");
const SCENARIO = "Ask/To-do scout";
const NEXT_STEP = "Issue #1320: expose the correlated queued/running review Run and its truthful state in Ask and To-do; then rerun this scout with a worker-capable fixture.";

interface ScoutState {
  outcome: "yes" | "no";
  firstBlocker: string | null;
  identifiers: Record<string, string | null>;
    transcript: Array<{ command: "ask" | "todo"; input: string; result: unknown }>;
  artifactCheck: { path: string; expectedSha256: string; exists: boolean; exactBytes: boolean; acceptedCompletionEvidence: boolean; evidence: unknown[] };
  launched: { queued: boolean; launched: boolean; publicRunId: string | null; runId: string | null; runStatus: string | null; executionObserved: boolean };
  modelUsage: { calls: 0; tokens: 0; guardCalls: string[]; proof: string[] };
  findings: Array<{ code: string; detail: string; fingerprint: string; proposedNextStep: string }>;
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

function acceptedCompletion(run: { status: string; work_item_id: string | null }, artifacts: Array<{ path: string | null; status: string; work_item_id: string | null }>): boolean {
  return run.status === "completed" && run.work_item_id !== null && artifacts.some((artifact) =>
    artifact.path === OUTPUT_PATH && ["ready", "published"].includes(artifact.status) &&
    artifact.work_item_id === run.work_item_id
  );
}

function scoutPasses(fileExists: boolean, exactBytes: boolean, run: { status: string; work_item_id: string | null } | undefined, artifacts: Array<{ path: string | null; status: string; work_item_id: string | null }>): boolean {
  return fileExists && exactBytes && Boolean(run && acceptedCompletion(run, artifacts));
}

describe("Ask/To-do scout", () => {
  it("writes a binary report for the bounded Hello World Ask journey", () => {
    const began = performance.now();
    const isolation: IsolatedProcess = isolateProcess();
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-ask-todo-scout-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    const repo = path.join(root, "project-repo");
    const recorder = new PhaseRecorder(SCENARIO, import.meta.filename, sanitizer([[root, "<scout>"]]));
    const scout: ScoutState = {
      outcome: "no", firstBlocker: "Journey did not reach a verified completion state.",
      identifiers: { requestId: REQUEST_ID, captureId: null, askId: null, reviewId: null, approvalRequestId: APPROVAL_REQUEST_ID, approvalCaptureId: null, approvalAskId: null, runId: null },
      transcript: [],
      artifactCheck: { path: OUTPUT_PATH, expectedSha256: hash(OUTPUT_BYTES), exists: false, exactBytes: false, acceptedCompletionEvidence: false, evidence: [] },
      launched: { queued: false, launched: false, publicRunId: null, runId: null, runStatus: null, executionObserved: false },
      modelUsage: { calls: 0, tokens: 0, guardCalls: [], proof: ["For this deterministic scout only: runAskCommand, runTodoCommand and Ask show are the sole interaction paths.", "Provider binary guards recorded zero calls; their exact call list is retained in guardCalls.", "Ask intent resolution uses the deterministic local registry and does not call a model adapter; zero tokens excludes coding-agent implementation work."] },
      findings: []
    };
    let journeyError: unknown = null;
    let providerGuardCalls: string[];

    try {
      initWorkspace(workspace);
      mkdirSync(repo, { recursive: true });
      const created = withDatabase(workspace, (db) => createProjectWithInitialWork(db, {
        name: PROJECT, mission: "Disposable fixture for a zero-model Ask and To-do scout.",
        goal: "Observe whether a user-approved Hello World request reaches a completed artifact.",
        status: "active", currentMilestone: "Scout fixture", nextAction: "Keep the scout fixture ready.",
        workClassification: "agent"
      }));
      withDatabase(workspace, (db) => {
        createMilestoneForProject(db, created.project.id, "Hello World scout");
        upsertProjectMetadata(db, { projectId: created.project.id, repoPath: repo, aliases: [PROJECT], validationCommands: [] });
      });

      const request = `Implement ${OUTPUT_PATH} in ${PROJECT}, containing exactly the bytes "Hello World!\\n".`;
      const first = runAskCommand({ workspace, project: PROJECT, request, requestId: REQUEST_ID });
      const reviewId = first.data.reviewItemId ?? null;
      scout.identifiers.captureId = first.data.captureEnvelope.id;
      scout.identifiers.askId = first.data.ask?.id ?? null;
      scout.identifiers.reviewId = reviewId;
      scout.transcript.push({ command: "ask", input: request, result: { status: first.data.result.status, summary: first.data.result.summary, captureId: first.data.captureEnvelope.id, askId: first.data.ask?.id ?? null, reviewItemId: reviewId, resolvedIntent: first.data.resolvedIntent.intentId } });

      const todoBefore = runTodoCommand({ workspace, project: created.project.slug, fixtureRoots: [], now: new Date("2026-10-12T19:23:00.000Z") });
      const visibleBefore = todoBefore.data.items.filter((item) => item.sourceRef === `review_items:${reviewId}`);
      scout.transcript.push({ command: "todo", input: `project=${created.project.slug} after initial Ask`, result: { schema: todoBefore.data.schema, matchingReviewItems: visibleBefore } });

      if (!reviewId) throw new Error("Initial Ask created no Requires Review item.");
      const approvalText = `approve ${reviewId}`;
      const approval = runAskCommand({ workspace, request: approvalText, requestId: APPROVAL_REQUEST_ID, adapterMetadata: { reviewId } });
      scout.identifiers.approvalCaptureId = approval.data.captureEnvelope.id;
      scout.identifiers.approvalAskId = approval.data.ask?.id ?? null;
      scout.transcript.push({ command: "ask", input: `${approvalText} (fixture operator approval transported with reviewId=${reviewId})`, result: { status: approval.data.result.status, summary: approval.data.result.summary, captureId: approval.data.captureEnvelope.id, askId: approval.data.ask?.id ?? null, run: approval.data.run ?? null } });

      const trail = runAskShowCommand({ workspace, id: REQUEST_ID });
      scout.transcript.push({ command: "ask", input: `show ${REQUEST_ID}`, result: trail.data });
      const todoAfter = runTodoCommand({ workspace, project: created.project.slug, fixtureRoots: [], now: new Date("2026-10-12T19:23:00.000Z") });
      const visibleAfter = todoAfter.data.items.filter((item) => item.sourceRef === `review_items:${reviewId}`);
      scout.transcript.push({ command: "todo", input: `project=${created.project.slug} after fixture approval`, result: { schema: todoAfter.data.schema, matchingReviewItems: visibleAfter, agentWork: todoAfter.data.agentWork } });

      const dbEvidence = withReadOnlyDatabase(workspace, (db) => {
        const run = db.prepare("SELECT id, status, review_item_id, work_item_id FROM execution_runs WHERE review_item_id = ? ORDER BY created_at DESC LIMIT 1").get(reviewId) as { id: string; status: string; review_item_id: string; work_item_id: string | null } | undefined;
        const artifacts = db.prepare("SELECT id, path, status, work_item_id FROM artifacts WHERE path = ?").all(OUTPUT_PATH) as Array<{ id: string; path: string | null; status: string; work_item_id: string | null }>;
        return { run, artifacts };
      });
      const outputFile = path.join(repo, OUTPUT_PATH);
      scout.artifactCheck.exists = existsSync(outputFile);
      scout.artifactCheck.exactBytes = scout.artifactCheck.exists && readFileSync(outputFile).equals(OUTPUT_BYTES);
      scout.artifactCheck.evidence = dbEvidence.artifacts;
      scout.artifactCheck.acceptedCompletionEvidence = Boolean(dbEvidence.run && acceptedCompletion(dbEvidence.run, dbEvidence.artifacts));
      scout.launched = {
        queued: dbEvidence.run?.status === "pending_execution", launched: false,
        publicRunId: approval.data.run?.id ?? null, runId: dbEvidence.run?.id ?? null,
        runStatus: dbEvidence.run?.status ?? null,
        executionObserved: Boolean(dbEvidence.run && dbEvidence.run.status !== "pending_execution")
      };
      scout.identifiers.runId = scout.launched.runId;
      const success = scoutPasses(scout.artifactCheck.exists, scout.artifactCheck.exactBytes, dbEvidence.run, dbEvidence.artifacts);
      scout.outcome = success ? "yes" : "no";
      scout.firstBlocker = success ? null : dbEvidence.run?.status === "pending_execution"
        ? "The approved Ask queued a review-execution Run, but no worker executed it; To-do still exposes the review item and Ask hides the queued Run id."
        : "No exact HelloWorld.txt with matching completed-run and ready/published Artifact evidence exists.";
      if (!success) {
        const details = [scout.firstBlocker, `run=${dbEvidence.run?.status ?? "missing"}`, `fileExact=${scout.artifactCheck.exactBytes}`, `acceptedEvidence=${scout.artifactCheck.acceptedCompletionEvidence}`].join("\n");
        scout.findings.push({ code: "queued-run-not-execution", detail: details, fingerprint: hash(`queued-run-not-execution\n${details}`), proposedNextStep: NEXT_STEP });
      }
    } catch (error) {
      journeyError = error;
      scout.firstBlocker = error instanceof Error ? error.message : String(error);
      const details = `Journey stopped before completion proof: ${scout.firstBlocker}`;
      scout.findings.push({ code: "journey-stopped", detail: details, fingerprint: hash(`journey-stopped\n${details}`), proposedNextStep: NEXT_STEP });
    } finally {
      providerGuardCalls = isolation.guardCalls();
      scout.modelUsage.guardCalls = providerGuardCalls;
      if (providerGuardCalls.length) {
        const details = `Provider guard calls were observed: ${providerGuardCalls.join(" | ")}`;
        scout.findings.push({ code: "provider-call-guard-triggered", detail: details, fingerprint: hash(`provider-call-guard-triggered\n${details}`), proposedNextStep: "Fix the scout boundary before running it again; no provider invocation is permitted." });
        scout.firstBlocker ??= details;
        scout.outcome = "no";
      }
      const report = recorder.build("unsandboxed", 0, []);
      report.wallMs = Math.round(performance.now() - began);
      report.notes.push("Scout runner success means the bounded journey and report completed; scout.outcome=yes is the separate product completion result.");
      report.scout = scout;
      writeScenarioReport(report);
      isolation.restore();
    }

    if (journeyError instanceof Error) throw journeyError;
    if (journeyError !== null) throw new Error(String(journeyError));
    expect(providerGuardCalls).toEqual([]);
    expect(scout.outcome).toBe("no");
    expect(scout.identifiers.captureId).toMatch(/^capture_/);
    expect(scout.identifiers.reviewId).toMatch(/^review_/);
    expect(scout.launched.runStatus).toBe("pending_execution");
    expect(scout.launched.queued).toBe(true);
    expect(scout.launched.launched).toBe(false);
    expect(scout.launched.publicRunId).toBeNull();
    expect(scout.launched.executionObserved).toBe(false);
    expect(scout.artifactCheck.exactBytes).toBe(false);
    expect(scout.artifactCheck.acceptedCompletionEvidence).toBe(false);
    expect(scout.modelUsage).toMatchObject({ calls: 0, tokens: 0 });
  });

  it("does not pass an existing file without correlated completed-run Artifact evidence", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-scout-negative-oracle-"));
    roots.push(root);
    const file = path.join(root, OUTPUT_PATH);
    writeFileSync(file, OUTPUT_BYTES);
    expect(scoutPasses(existsSync(file), readFileSync(file).equals(OUTPUT_BYTES), { status: "pending_execution", work_item_id: null }, [])).toBe(false);
    expect(acceptedCompletion({ status: "completed", work_item_id: null }, [{ path: OUTPUT_PATH, status: "ready", work_item_id: "unrelated-work" }])).toBe(false);
  });
});
