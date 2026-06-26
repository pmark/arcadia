import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runRebusterConfigureCommand,
  runRebusterCreateRebusCommand,
  runRebusterIngestEventCommand,
  runRebusterStatusCommand
} from "../src/commands/rebuster.js";
import { parseRebusterEventPayload, validateStrictRebusterSpec } from "../src/capabilities/rebuster/actions.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import { countRows, createProjectWithInitialWork } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Rebuster bridge capability", () => {
  it("configures bridge metadata without creating Rebuster creative-state tables", () => {
    const workspace = initializedWorkspace();
    const project = createRebusterProject(workspace);

    const initialSnapshot = buildDashboardSnapshot({ workspace });
    expect(initialSnapshot.rebuster.connection.configured).toBe(false);
    expect(initialSnapshot.rebuster.status.summary).toBe("Rebuster bridge is not configured.");

    const configured = runRebusterConfigureCommand({
      workspace,
      project: project.id,
      repoPath: "/Users/pmark/Dev/MR/Rebuster/rebuster",
      baseUrl: "http://localhost:5173",
      dashboardUrl: "http://localhost:5173/studio"
    });

    expect(configured.data.integration).toMatchObject({
      project_id: project.id,
      repo_path: "/Users/pmark/Dev/MR/Rebuster/rebuster",
      base_url: "http://localhost:5173",
      dashboard_url: "http://localhost:5173/studio"
    });

    const status = runRebusterStatusCommand({ workspace });
    expect(status.data.integration?.project_id).toBe(project.id);
    expect(status.data.recentEvents).toHaveLength(0);

    const snapshot = buildDashboardSnapshot({ workspace });
    expect(snapshot.capabilities.map((capability) => capability.id)).toContain("rebuster");
    expect(snapshot.rebuster.connection).toMatchObject({
      configured: true,
      projectId: project.id,
      projectName: "Rebuster",
      repoPath: "/Users/pmark/Dev/MR/Rebuster/rebuster",
      dashboardUrl: "http://localhost:5173/studio"
    });

    withDatabase(workspace, (db) => {
      expect(countRows(db, "rebuster_integrations")).toBe(1);
      expect(tableNames(db)).toContain("rebuster_integrations");
      expect(tableNames(db)).toContain("rebuster_events");
      expect(tableNames(db)).not.toContain("rebuses");
      expect(tableNames(db)).not.toContain("rebus_artifacts");
      expect(tableNames(db)).not.toContain("rebus_relationships");
      expect(tableNames(db)).not.toContain("rebus_reviews");
    });
  });

  it("validates and ingests Rebuster events into Arcadia Decisions and activity", () => {
    const workspace = initializedWorkspace();
    const project = createRebusterProject(workspace);
    runRebusterConfigureCommand({
      workspace,
      project: project.id,
      repoPath: "/Users/pmark/Dev/MR/Rebuster/rebuster",
      dashboardUrl: "http://localhost:5173/studio"
    });
    const payload = rebusterEventPayload();
    const eventPath = path.join(workspace, "rebuster-event.json");
    writeFileSync(eventPath, JSON.stringify(payload, null, 2));

    const ingested = runRebusterIngestEventCommand({ workspace, jsonFile: eventPath });
    expect(ingested.data.event.answer).toBe("Toe Truck");
    expect(ingested.data.reviewItemId).toMatch(/^review_/);
    expect(ingested.data.createdDecision).toBe(true);

    const repeated = runRebusterIngestEventCommand({ workspace, jsonFile: eventPath });
    expect(repeated.data.reviewItemId).toBe(ingested.data.reviewItemId);
    expect(repeated.data.createdDecision).toBe(false);

    const snapshot = buildDashboardSnapshot({ workspace });
    expect(snapshot.rebuster.status.openDecisionCount).toBe(1);
    expect(snapshot.rebuster.status.lastEventType).toBe("decision_required");
    expect(snapshot.rebuster.decisions[0]).toMatchObject({
      answer: "Toe Truck",
      reviewItemId: ingested.data.reviewItemId,
      rebusterUrl: "http://localhost:5173/studio/rebuses/rebus_toe_truck"
    });
    expect(snapshot.rebuster.recentEvents[0]).toMatchObject({
      externalId: "rebuster-event-001",
      answer: "Toe Truck",
      eventType: "decision_required",
      decisionRequired: true
    });
    expect(snapshot.activityEvents.map((event) => event.eventType)).toContain("rebuster.decision_required");
    expect(snapshot.activityEvents.find((event) => event.eventType === "rebuster.decision_required")?.summary)
      .toContain("Strict spec is ready");

    withDatabase(workspace, (db) => {
      expect(countRows(db, "rebuster_events")).toBe(1);
      expect(countRows(db, "review_items")).toBe(1);
      expect(countRows(db, "events")).toBeGreaterThanOrEqual(2);
    });
  });

  it("triggers Rebuster rebus creation via configured Control Panel API", async () => {
    const workspace = initializedWorkspace();
    const project = createRebusterProject(workspace);
    const receivedBodies: unknown[] = [];
    const { server, baseUrl } = await startFakeRebusterServer(async (request) => {
      const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
      receivedBodies.push(body);
      return {
        record: {
          slug: "butter-fly",
          answer: "Butter Fly",
          status: "prompted"
        }
      };
    });
    servers.push(server);

    runRebusterConfigureCommand({
      workspace,
      project: project.id,
      baseUrl,
      dashboardUrl: `${baseUrl}/studio`
    });

    const created = await runRebusterCreateRebusCommand({
      workspace,
      specText: strictSpecText("Butter Fly"),
      force: true
    });

    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0]).toMatchObject({
      text: expect.stringContaining("ANSWER Butter Fly"),
      force: true
    });
    expect(created.data).toMatchObject({
      transport: "http",
      record: {
        slug: "butter-fly",
        answer: "Butter Fly",
        status: "prompted",
        url: `${baseUrl}/studio/rebuses/butter-fly`
      }
    });

    const snapshot = buildDashboardSnapshot({ workspace });
    expect(snapshot.rebuster.recentEvents[0]).toMatchObject({
      eventType: "candidate_captured",
      externalId: "rebuster:create:butter-fly",
      answer: "Butter Fly",
      decisionRequired: false
    });
    expect(snapshot.activityEvents.find((event) => event.eventType === "rebuster.candidate_captured")?.summary)
      .toContain("Created Rebuster rebus");

    withDatabase(workspace, (db) => {
      expect(countRows(db, "rebuster_events")).toBe(1);
      expect(countRows(db, "review_items")).toBe(0);
    });
  });

  it("rejects invalid Rebuster event payloads before creating Decisions", () => {
    expect(() => parseRebusterEventPayload({ ...rebusterEventPayload(), answer: "" })).toThrow("answer is required");
    expect(() => parseRebusterEventPayload({ ...rebusterEventPayload(), decisionRequired: "yes" })).toThrow(
      "decisionRequired must be a boolean"
    );
    expect(() => parseRebusterEventPayload({ ...rebusterEventPayload(), eventType: "image_generating" })).toThrow(
      "eventType must be one of"
    );
    expect(() => validateStrictRebusterSpec("ANSWER Bad\nCONCEPT Missing the rest")).toThrow(
      "missing required sections"
    );
    expect(() => validateStrictRebusterSpec(strictSpecText("Wrong Order").replace("ANSWER Wrong Order\n", ""))).toThrow(
      "missing required sections"
    );
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-rebuster-test-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function createRebusterProject(workspace: string) {
  return withDatabase(workspace, (db) =>
    createProjectWithInitialWork(db, {
      name: "Rebuster",
      mission: "Turn language-based visual rebus concepts into short-form content.",
      goal: "Ship Rebuster Studio vertical slice.",
      status: "active",
      currentMilestone: "Rebuster Studio bridge",
      nextAction: "Connect Rebuster Decisions to Arcadia.",
      workClassification: "codex"
    }).project
  );
}

function rebusterEventPayload() {
  return {
    eventType: "decision_required",
    externalId: "rebuster-event-001",
    rebusId: "rebus_toe_truck",
    answer: "Toe Truck",
    status: "spec_ready",
    summary: "Strict spec is ready for creator approval.",
    decisionRequired: true,
    recommendation: "Open Rebuster Studio and approve or revise the spec.",
    rebusterUrl: "http://localhost:5173/studio/rebuses/rebus_toe_truck",
    artifactRefs: [
      {
        type: "spec",
        title: "Strict Rebuster spec v1",
        url: "http://localhost:5173/studio/rebuses/rebus_toe_truck/specs/1"
      }
    ],
    occurredAt: "2026-06-26T12:00:00.000Z"
  };
}

function strictSpecText(answer: string): string {
  return `ANSWER ${answer}
CONCEPT A butterfly whose wings and body are physically made from butter while still reading as one coherent insect.
SHORT DESCRIPTION A fly-like butterfly literally made of butter.
IMAGE PROMPT A single centered cartoon butterfly whose wings and body are made from smooth yellow butter pats, with one coherent impossible subject, thick black outlines, flat colors, pure white background, no text.
CONSTRAINTS
MUST INCLUDE
- one coherent butter insect
- readable wings
MUST AVOID
- separate butter and fly objects
- visible text
PRIMARY FUSION TYPE OBJECT_MATERIAL_FUSION
TAGS #compound #food #insect
GROWTH PREDICTION
Scroll Stop: 8
Thumbnail Strength: 8
QUALITY SCORES
Fusion: 8
Clarity: 8
Humor: 7
METADATA SNAPSHOT
phrase_type: compound_word
components: butter fly
content_tags: food insect
fusion_type: thing_made_of_thing
visual_tags: strong_silhouette
strategic_tags: fast_solve
scores:
readability: 8
mirth: 7
expected_reaction: SMART_PAYOFF
`;
}

async function startFakeRebusterServer(
  handler: (request: IncomingMessage) => Promise<unknown>
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/api/rebuses/add") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not found" }));
        return;
      }

      const body = await handler(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake Rebuster server did not bind to a TCP port.");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function tableNames(db: Parameters<typeof countRows>[0]): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map((row) => row.name);
}
