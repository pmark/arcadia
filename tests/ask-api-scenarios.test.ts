import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../apps/dashboard/app/api/ask/route.js";
import { GET } from "../apps/dashboard/app/api/ask/show/route.js";
import type { AskResponse } from "../apps/dashboard/lib/types.js";
import type { AskTrailResponse } from "../apps/dashboard/lib/arcadia-cli.js";
import { withDatabase } from "../src/db/connection.js";
import { attachArtifactToExecutionRun, createArtifactRecord, createExecutionRun, createProjectWithInitialWork, updateExecutionRunStatus, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

// No CLI mock: handlers spawn the source CLI, serialize JSON, and reopen SQLite.
// These requests use deterministic intake only; they never approve or launch work.
let workspace: string;
let projectId: string;
const samples: Array<{ operation: string; milliseconds: number }> = [];

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "arcadia-ask-api-"));
  initWorkspace(workspace);
  vi.stubEnv("ARCADIA_WORKSPACE", workspace);
  vi.stubEnv("ARCADIA_DASHBOARD_CLI", "source");
  projectId = withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Arcadia", mission: "Turn intent into governed work.", goal: "Make Ask trustworthy.",
      status: "active", currentMilestone: "Traceable Asks", nextAction: "Trace every Ask.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: created.project.id, aliases: ["Arcadia"], repoPath: workspace, validationCommands: ["node -e \"process.exit(0)\""] });
    return created.project.id;
  });
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(workspace, { recursive: true, force: true }); });
afterAll(() => {
  // Measurements include CLI startup and local fixture storage, not HTTP/network/provider time.
  process.stdout.write(`Ask API local handler + source CLI samples (ms): ${JSON.stringify(samples)}\n`);
});

function recordTiming(operation: "submit" | "show", began: number): void {
  const milliseconds = performance.now() - began;
  samples.push({ operation, milliseconds: Math.round(milliseconds) });
  const variable = operation === "submit" ? "ARCADIA_ASK_API_SUBMIT_BUDGET_MS" : "ARCADIA_ASK_API_READ_BUDGET_MS";
  const configured = process.env[variable];
  if (configured === undefined) return;
  const budget = Number(configured);
  if (!Number.isFinite(budget) || budget <= 0) throw new Error(`${variable} must be a positive finite number of milliseconds.`);
  expect(milliseconds, `${operation} exceeded operator-selected ${variable}=${budget}`).toBeLessThanOrEqual(budget);
}

async function submit(text: string, requestId: string, expectNewAsk = true): Promise<AskResponse> {
  const began = performance.now();
  const response = await POST(new Request("http://localhost/api/ask", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: text, requestId })
  }));
  recordTiming("submit", began);
  const body = await response.json() as { message: string; result: AskResponse };
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.message).toBe(body.result.result.summary);
  expect(body.message.trim().length).toBeGreaterThan(0);
  expect(body.result.captureEnvelope).toMatchObject({ requestId, originalText: text, ingressSource: "dashboard.ask" });
  expect(body.result.captureEnvelope.id).toMatch(/^capture_/);
  if (expectNewAsk) expect(body.result.ask?.id).toMatch(/^ask_/);
  return body.result;
}

async function reopen(id: string): Promise<AskTrailResponse> {
  const began = performance.now();
  const response = await GET(new Request(`http://localhost/api/ask/show?id=${encodeURIComponent(id)}`));
  recordTiming("show", began);
  const body = await response.json() as AskTrailResponse;
  expect(response.status, JSON.stringify(body)).toBe(200);
  return body;
}

describe("Ask API UI scenarios through the real CLI", () => {
  it("submits a Project request and reopens the same Action/Plan by all receipt identifiers", async () => {
    const asked = await submit("Improve UX of Arcadia Runs page in the web dashboard UI .\n\n* Add tabs for segregating concerns", "api-plan");
    expect(asked.workItem?.id).toBeTruthy();
    expect(asked.plan?.id).toBeTruthy();
    expect(asked.run).toBeNull();
    const replayed = await submit(asked.captureEnvelope.originalText, "api-plan", false);
    expect(replayed.captureEnvelope.id).toBe(asked.captureEnvelope.id);
    expect(replayed.result.status).toBe("ignored");
    expect(replayed.ask).toBeNull();
    expect(replayed.result.summary).toContain("already processed");
    for (const id of [asked.captureEnvelope.id, asked.captureEnvelope.requestId, asked.ask?.id ?? ""]) {
      const trail = await reopen(id);
      expect(trail.capture?.id).toBe(asked.captureEnvelope.id);
      expect(trail.capture?.status).toEqual(expect.any(String));
      expect(trail.capture?.outcomes).toEqual(expect.any(Array));
      expect(trail.asks).toHaveLength(1);
      expect(trail.asks[0]).toMatchObject({ id: asked.ask?.id, projectName: "Arcadia", executionPath: "Plan First", runs: [] });
      expect(trail.asks[0].reason).toEqual(expect.any(String));
      expect(trail.asks[0].outcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "action", id: asked.workItem?.id, projectName: "Arcadia", status: expect.any(String) }),
        expect.objectContaining({ kind: "plan", id: asked.plan?.id, status: "planned" })
      ]));
    }
  });

  it("makes a clarification Decision accessible and keeps a deferred idea separate", async () => {
    const clarify = await submit("Build Pinterest support.", "api-clarify");
    expect(clarify.reviewItemId).toMatch(/^review_/);
    const deferred = await submit("Maybe creator partnerships could help someday.", "api-defer");
    expect(deferred.backBurnerItemId).toMatch(/^bb_/);
    const decisionTrail = await reopen(clarify.captureEnvelope.id);
    expect(decisionTrail.asks[0]).toMatchObject({ executionPath: "Clarify First", runs: [] });
    expect(decisionTrail.asks[0].outcomes).toContainEqual(expect.objectContaining({ kind: "decision", id: clarify.reviewItemId, status: expect.any(String) }));
    const deferredTrail = await reopen(deferred.captureEnvelope.id);
    expect(deferredTrail.asks.map((ask) => ask.id)).toEqual([deferred.ask?.id]);
    expect(deferredTrail.asks[0].outcomes).toEqual([expect.objectContaining({ kind: "back_burner_item", id: deferred.backBurnerItemId })]);
    expect(JSON.stringify(deferredTrail)).not.toContain(clarify.reviewItemId);
    expect(JSON.stringify(decisionTrail)).not.toContain(deferred.backBurnerItemId);
  });

  it("refreshes correlated queued/running/review/failed state and exposes only linked ready artifacts", async () => {
    const asked = await submit("Improve UX of Arcadia Runs page in the web dashboard UI .\n\n* Add tabs for segregating concerns", "api-lifecycle");
    const run = withDatabase(workspace, (db) => createExecutionRun(db, {
      workItemId: asked.workItem?.id ?? "", planId: asked.plan?.id ?? "", status: "pending_execution", summary: "Queued fixture run", steps: []
    }));
    expect(run).not.toBeNull();
    const runId = run?.id ?? "";
    const queued = (await reopen(asked.captureEnvelope.id)).asks[0].runs;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ id: runId, status: "pending_execution", projectId, workItemId: asked.workItem?.id, artifacts: [], waitingReason: expect.stringContaining("worker") });
    withDatabase(workspace, (db) => updateExecutionRunStatus(db, runId, "running"));
    expect((await reopen(asked.captureEnvelope.id)).asks[0].runs[0]).toMatchObject({ status: "running", artifacts: [], waitingReason: null });
    const artifactPath = path.join(workspace, "page-sketch.svg");
    writeFileSync(artifactPath, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n");
    const artifact = withDatabase(workspace, (db) => {
      const linked = createArtifactRecord(db, { projectId, title: "Page sketch", artifactType: "file", status: "ready", path: artifactPath });
      createArtifactRecord(db, { projectId, title: "Unrelated", artifactType: "file", status: "ready", path: "unrelated.svg" });
      attachArtifactToExecutionRun(db, runId, linked.id);
      updateExecutionRunStatus(db, runId, "requires_review");
      return linked;
    });
    expect((await reopen(asked.captureEnvelope.id)).asks[0].runs[0]).toMatchObject({
      status: "requires_review", waitingReason: expect.stringContaining("review"),
      artifacts: [{ id: artifact.id, path: artifactPath, status: "ready", kind: "file", evidenceReference: artifactPath }]
    });
    withDatabase(workspace, (db) => updateExecutionRunStatus(db, runId, "failed", { summary: "Fixture validation failed" }));
    expect((await reopen(asked.captureEnvelope.id)).asks[0].runs[0]).toMatchObject({ status: "failed", waitingReason: "Fixture validation failed" });
  });

  it("returns a useful client error for an unknown receipt without revealing another Ask", async () => {
    const response = await GET(new Request("http://localhost/api/ask/show?id=capture_missing"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("No Ask capture"), details: { id: "capture_missing", remedy: expect.any(String) } });
  });
});
