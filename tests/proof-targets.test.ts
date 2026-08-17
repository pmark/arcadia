import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProofTargetCheckCommand, runProofTargetListCommand } from "../src/commands/proofTargets.js";
import { performProofCheck, type ProofCheckResult } from "../src/proofTargets/check.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, createReviewItem } from "../src/db/repositories.js";
import { resolveProofHeroState } from "../src/proofTargets/hero.js";
import type { ProofTargetConfig } from "../src/proofTargets/targets.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function fakeCheck(result: ProofCheckResult): { performCheck: () => Promise<ProofCheckResult> } {
  return { performCheck: () => Promise.resolve(result) };
}

const STABLE: ProofTargetConfig = {
  id: "stable-1",
  project: "private-practice-now",
  environment: "Stable",
  label: "Stable Site",
  url: "https://example.invalid/stable",
  environmentKind: "remote",
  accessState: "public",
  sourceRevision: null
};

const CANDIDATE: ProofTargetConfig = {
  id: "river-copy-studio",
  project: "private-practice-now",
  environment: "Candidate",
  label: "River Copy Studio",
  url: "http://127.0.0.1:4321",
  environmentKind: "local",
  accessState: "local-only",
  sourceRevision: "configured-local-candidate"
};

function healthyCheck(overrides: Partial<{ health_state: "healthy" | "unhealthy" }> = {}) {
  return {
    id: "ptc_1",
    target_id: CANDIDATE.id,
    project_id: "proj_1",
    url: CANDIDATE.url,
    health_state: "healthy" as const,
    http_status: 200,
    latency_ms: 12,
    error_message: null,
    checked_at: "2026-08-17T00:00:00.000Z",
    created_at: "2026-08-17T00:00:00.000Z",
    ...overrides
  };
}

describe("resolveProofHeroState", () => {
  it("resolves proof_unavailable when nothing is configured", () => {
    const resolution = resolveProofHeroState({
      stable: null,
      candidate: null,
      stableCheck: null,
      candidateCheck: null,
      candidateQaDecision: null
    });
    expect(resolution.state).toBe("proof_unavailable");
    expect(resolution.primaryAction).toBeNull();
  });

  it("resolves proof_unavailable when the Candidate has never been checked", () => {
    const resolution = resolveProofHeroState({
      stable: STABLE,
      candidate: CANDIDATE,
      stableCheck: null,
      candidateCheck: null,
      candidateQaDecision: null
    });
    expect(resolution.state).toBe("proof_unavailable");
  });

  it("resolves failure when the Candidate's last check was unhealthy", () => {
    const resolution = resolveProofHeroState({
      stable: STABLE,
      candidate: CANDIDATE,
      stableCheck: null,
      candidateCheck: healthyCheck({ health_state: "unhealthy" }),
      candidateQaDecision: null
    });
    expect(resolution.state).toBe("failure");
    expect(resolution.primaryAction?.label).toBe("Inspect failure");
  });

  it("resolves ready_for_operator_demo when the Candidate is healthy and unreviewed", () => {
    const resolution = resolveProofHeroState({
      stable: STABLE,
      candidate: CANDIDATE,
      stableCheck: null,
      candidateCheck: healthyCheck(),
      candidateQaDecision: null
    });
    expect(resolution.state).toBe("ready_for_operator_demo");
    expect(resolution.primaryAction).toEqual({ label: "Test Candidate", targetId: CANDIDATE.id, url: CANDIDATE.url });
  });

  it("resolves qa_failed when QA recorded fail or needs-follow-up", () => {
    for (const decision of ["fail", "needs-follow-up"] as const) {
      const resolution = resolveProofHeroState({
        stable: STABLE,
        candidate: CANDIDATE,
        stableCheck: null,
        candidateCheck: healthyCheck(),
        candidateQaDecision: decision
      });
      expect(resolution.state).toBe("qa_failed");
    }
  });

  it("resolves release_decision_needed when QA passed", () => {
    const resolution = resolveProofHeroState({
      stable: STABLE,
      candidate: CANDIDATE,
      stableCheck: null,
      candidateCheck: healthyCheck(),
      candidateQaDecision: "pass"
    });
    expect(resolution.state).toBe("release_decision_needed");
  });

  it("resolves stable_only when no Candidate is active and Stable is healthy", () => {
    const resolution = resolveProofHeroState({
      stable: STABLE,
      candidate: null,
      stableCheck: { ...healthyCheck(), target_id: STABLE.id, url: STABLE.url },
      candidateCheck: null,
      candidateQaDecision: null
    });
    expect(resolution.state).toBe("stable_only");
    expect(resolution.primaryAction).toEqual({ label: "Show Stable", targetId: STABLE.id, url: STABLE.url });
  });

  it("never returns two primary actions for one resolution", () => {
    const resolution = resolveProofHeroState({
      stable: STABLE,
      candidate: CANDIDATE,
      stableCheck: { ...healthyCheck(), target_id: STABLE.id, url: STABLE.url },
      candidateCheck: healthyCheck(),
      candidateQaDecision: null
    });
    expect(resolution.primaryAction === null || typeof resolution.primaryAction === "object").toBe(true);
    expect(Array.isArray(resolution.primaryAction)).toBe(false);
  });
});

describe("performProofCheck", () => {
  it("reports healthy for a 2xx response and unhealthy for a 5xx response, on an ephemeral local port", async () => {
    const server = await startServer(200);
    servers.push(server);
    const port = (server.address() as { port: number }).port;

    const healthy = await performProofCheck(`http://127.0.0.1:${port}/`);
    expect(healthy.healthState).toBe("healthy");
    expect(healthy.httpStatus).toBe(200);
    expect(healthy.errorMessage).toBeNull();

    const failingServer = await startServer(503);
    servers.push(failingServer);
    const failingPort = (failingServer.address() as { port: number }).port;
    const unhealthy = await performProofCheck(`http://127.0.0.1:${failingPort}/`);
    expect(unhealthy.healthState).toBe("unhealthy");
    expect(unhealthy.httpStatus).toBe(503);
  });

  it("reports unhealthy with a reason when nothing is listening", async () => {
    const result = await performProofCheck("http://127.0.0.1:1/", 500);
    expect(result.healthState).toBe("unhealthy");
    expect(result.httpStatus).toBeNull();
    expect(result.errorMessage).toBeTruthy();
  });
});

describe("proof-target CLI commands", () => {
  it("persists a check result and reflects it in both the check and list responses", async () => {
    const workspace = createWorkspace();
    withDatabase(workspace, (db) => {
      createProjectWithInitialWork(db, {
        name: "Private Practice Now",
        mission: "Ship practice sites.",
        status: "active",
        currentMilestone: "Beta",
        nextAction: "Finish the exemplar",
        workClassification: "codex"
      });
    });

    const checked = await runProofTargetCheckCommand(
      { workspace, targetId: "river-copy-studio" },
      fakeCheck({ healthState: "unhealthy", httpStatus: null, latencyMs: 3, errorMessage: "ECONNREFUSED" })
    );
    expect(checked.data.target.id).toBe("river-copy-studio");
    expect(checked.data.check.target_id).toBe("river-copy-studio");
    expect(checked.data.check.health_state).toBe("unhealthy");
    expect(checked.data.hero.state).toBe("failure");

    const listed = runProofTargetListCommand({ workspace, project: "private-practice-now" });
    expect(listed.data.targets.map((view) => view.target.id).sort()).toEqual(["ppn-stable-juniper", "river-copy-studio"]);
    const candidateView = listed.data.targets.find((view) => view.target.id === "river-copy-studio");
    expect(candidateView?.lastCheck?.health_state).toBe("unhealthy");
  });

  it("resolves qa_failed once a QA Decision is recorded against the Candidate revision", async () => {
    const workspace = createWorkspace();

    withDatabase(workspace, (db) => {
      const bundle = createProjectWithInitialWork(db, {
        name: "Private Practice Now",
        mission: "Ship practice sites.",
        status: "active",
        currentMilestone: "Beta",
        nextAction: "Finish the exemplar",
        workClassification: "codex"
      });
      createReviewItem(db, {
        projectId: bundle.project.id,
        decisionNeeded: "QA fail recorded for River Copy Studio.",
        recommendation: null,
        sourceInput: "test",
        proposedAction: "Preserve this operator QA result.",
        resolvedIntent: "CandidateQaSignoff",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: { schemaVersion: 1, candidateId: "river-copy-studio", candidateLabel: "River Copy Studio", revision: "rev-1", decision: "fail", note: null }
      });
    });

    const checked = await runProofTargetCheckCommand(
      { workspace, targetId: "river-copy-studio" },
      fakeCheck({ healthState: "healthy", httpStatus: 200, latencyMs: 5, errorMessage: null })
    );
    expect(checked.data.check.health_state).toBe("healthy");
    expect(checked.data.hero.state).toBe("qa_failed");
  });
});

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-proof-target-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function startServer(status: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(status, { "content-type": "text/plain" });
      response.end("ok");
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
