import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandSuccess } from "../src/cli/response.js";
import type { AskCommandData, AskOptions } from "../src/commands/ask.js";
import { runIngressProcessCommand } from "../src/commands/ingress.js";
import { withDatabase } from "../src/db/connection.js";
import { countRows, listRecentMissionLogs } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ingress process command", () => {
  it("ingests a request through ask, moves it to Done, writes a sidecar, and records a mission log", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    const inputPath = writeIngressFile(ingressRoot, "20260610-075552.txt", "Create a new blog site named MartianRover Field Notes.");

    const result = runIngressProcessCommand({
      workspace,
      source: "iCloudIdeas",
      ingressRoot
    });

    expect(result.data.counts).toMatchObject({ discovered: 1, processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(existsSync(inputPath)).toBe(false);
    const finalPath = path.join(ingressRoot, "iCloudIdeas", "Done", "20260610-075552.txt");
    const sidecarPath = path.join(ingressRoot, "iCloudIdeas", "Done", "20260610-075552.response.json");
    expect(existsSync(finalPath)).toBe(true);
    expect(existsSync(sidecarPath)).toBe(true);

    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    expect(sidecar.status).toBe("processed");
    expect(sidecar.response.data.ask.id).toMatch(/^ask_/);
    expect(sidecar.response.data.result.status).toBe("requires_review");
    expect(sidecar.response.data.reviewItemId).toMatch(/^review_/);
    expect(sidecar.response.data.workItem).toBeNull();
    expect(sidecar.response.data.plan).toBeNull();

    withDatabase(workspace, (db) => {
      expect(countRows(db, "ask_requests")).toBe(1);
      expect(countRows(db, "work_items")).toBe(0);
      expect(countRows(db, "execution_plans")).toBe(0);
      expect(countRows(db, "review_items")).toBe(1);
      const logs = listRecentMissionLogs(db, 5);
      expect(logs.some((log) => log.work_performed.includes("Ingested local request file"))).toBe(true);
      expect(logs.some((log) => log.work_performed.includes("20260610-075552.txt"))).toBe(true);
    });
  });

  it("records convention-based shared files as ready Artifacts", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    writeIngressFile(ingressRoot, "shared-capture.txt", "Capture this shared file.");
    const attachmentDirectory = path.join(ingressRoot, "iCloudIdeas", "Attachments", "shared-capture");
    mkdirSync(attachmentDirectory, { recursive: true });
    const attachmentPath = path.join(attachmentDirectory, "notes.pdf");
    writeFileSync(attachmentPath, "example", "utf8");

    const result = runIngressProcessCommand({
      workspace,
      ingressRoot,
      askRunner: (options) => {
        const response = fakeAskResponse(options.request);
        response.data.workItem = null;
        response.data.plan = null;
        response.data.result = { status: "captured", summary: "Shared file captured." };
        return response;
      }
    });

    expect(result.data.files[0].artifacts).toContain(attachmentPath);
    const sidecarPath = path.join(ingressRoot, "iCloudIdeas", "Done", "shared-capture.response.json");
    expect(JSON.parse(readFileSync(sidecarPath, "utf8")).artifacts).toContain(attachmentPath);
    withDatabase(workspace, (db) => {
      expect(countRows(db, "artifacts")).toBe(1);
      const artifact = db.prepare("SELECT * FROM artifacts LIMIT 1").get() as {
        artifact_type: string;
        status: string;
        path: string;
      };
      expect(artifact).toMatchObject({ artifact_type: "shared_file", status: "ready", path: attachmentPath });
    });
  });

  it("moves empty files to Done without calling ask or creating mission logs", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    writeIngressFile(ingressRoot, "empty.txt", "  \n\t");
    let askCalls = 0;

    const result = runIngressProcessCommand({
      workspace,
      ingressRoot,
      askRunner: () => {
        askCalls += 1;
        return fakeAskResponse("unused");
      }
    });

    expect(askCalls).toBe(0);
    expect(result.data.files[0].status).toBe("skipped_empty");
    const finalPath = path.join(ingressRoot, "iCloudIdeas", "Done", "empty.txt");
    const sidecarPath = path.join(ingressRoot, "iCloudIdeas", "Done", "empty.response.json");
    expect(existsSync(finalPath)).toBe(true);
    expect(JSON.parse(readFileSync(sidecarPath, "utf8")).status).toBe("skipped_empty");
    withDatabase(workspace, (db) => {
      expect(countRows(db, "ask_requests")).toBe(0);
      expect(countRows(db, "mission_logs")).toBe(0);
    });
  });

  it("moves failed requests to Failed with a readable error sidecar and mission log", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    writeIngressFile(ingressRoot, "bad.txt", "Do a thing that fails.");

    const result = runIngressProcessCommand({
      workspace,
      ingressRoot,
      askRunner: () => {
        throw new Error("Injected ask failure.");
      }
    });

    expect(result.data.counts.failed).toBe(1);
    const finalPath = path.join(ingressRoot, "iCloudIdeas", "Failed", "bad.txt");
    const sidecarPath = path.join(ingressRoot, "iCloudIdeas", "Failed", "bad.error.json");
    expect(existsSync(finalPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8"));
    expect(sidecar.status).toBe("failed");
    expect(sidecar.error.message).toBe("Unexpected error.");
    expect(sidecar.error.details.cause).toBe("Injected ask failure.");
    withDatabase(workspace, (db) => {
      const logs = listRecentMissionLogs(db, 5);
      expect(logs[0].result).toContain("Ingress request failed");
      expect(logs[0].blockers).toContain("Unexpected error.");
    });
  });

  it("dry-run reports candidates without moving files, writing sidecars, or executing ask", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    const inputPath = writeIngressFile(ingressRoot, "dry.txt", "Prepare a weekly Martian Rover Labs update from recent mission logs.");
    let askCalls = 0;

    const result = runIngressProcessCommand({
      workspace,
      ingressRoot,
      dryRun: true,
      askRunner: () => {
        askCalls += 1;
        return fakeAskResponse("unused");
      }
    });

    expect(askCalls).toBe(0);
    expect(result.data.dryRun).toBe(true);
    expect(result.data.files[0].status).toBe("would_process");
    expect(existsSync(inputPath)).toBe(true);
    expect(readdirSync(path.join(ingressRoot, "iCloudIdeas", "Done"))).toEqual([]);
    expect(readdirSync(path.join(ingressRoot, "iCloudIdeas", "Failed"))).toEqual([]);
    withDatabase(workspace, (db) => {
      expect(countRows(db, "ask_requests")).toBe(0);
      expect(countRows(db, "mission_logs")).toBe(0);
    });
  });

  it("processes files oldest first", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    const newer = writeIngressFile(ingressRoot, "newer.txt", "newer request");
    const older = writeIngressFile(ingressRoot, "older.txt", "older request");
    setMtime(older, new Date("2026-06-10T07:00:00.000Z"));
    setMtime(newer, new Date("2026-06-10T08:00:00.000Z"));
    const seen: string[] = [];

    runIngressProcessCommand({
      workspace,
      ingressRoot,
      askRunner: (options) => {
        seen.push(options.request);
        return fakeAskResponse(options.request);
      }
    });

    expect(seen).toEqual(["older request", "newer request"]);
  });

  it("preserves existing Done files by adding a numeric suffix", () => {
    const workspace = initializedWorkspace();
    const ingressRoot = initializedIngressRoot();
    const donePath = path.join(ingressRoot, "iCloudIdeas", "Done", "collision.txt");
    writeFileSync(donePath, "existing", "utf8");
    writeIngressFile(ingressRoot, "collision.txt", "new request");

    const result = runIngressProcessCommand({
      workspace,
      ingressRoot,
      askRunner: (options) => fakeAskResponse(options.request)
    });

    const movedPath = path.join(ingressRoot, "iCloudIdeas", "Done", "collision-1.txt");
    expect(readFileSync(donePath, "utf8")).toBe("existing");
    expect(existsSync(movedPath)).toBe(true);
    expect(result.data.files[0].finalPath).toBe(movedPath);
    expect(existsSync(path.join(ingressRoot, "iCloudIdeas", "Done", "collision-1.response.json"))).toBe(true);
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-ingress-workspace-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function initializedIngressRoot(): string {
  const ingressRoot = mkdtempSync(path.join(tmpdir(), "arcadia-ingress-root-"));
  roots.push(ingressRoot);
  mkdirSync(path.join(ingressRoot, "iCloudIdeas", "In"), { recursive: true });
  mkdirSync(path.join(ingressRoot, "iCloudIdeas", "Done"), { recursive: true });
  mkdirSync(path.join(ingressRoot, "iCloudIdeas", "Failed"), { recursive: true });
  mkdirSync(path.join(ingressRoot, "iCloudIdeas", "Attachments"), { recursive: true });
  return ingressRoot;
}

function writeIngressFile(ingressRoot: string, fileName: string, content: string): string {
  const inputPath = path.join(ingressRoot, "iCloudIdeas", "In", fileName);
  writeFileSync(inputPath, content, "utf8");
  return inputPath;
}

function setMtime(filePath: string, date: Date): void {
  utimesSync(filePath, date, date);
}

function fakeAskResponse(request: string): CommandSuccess<AskCommandData> {
  return {
    ok: true,
    command: "ask",
    workspace: "/tmp/fake-workspace",
    data: {
      ask: {
        id: `ask_${request.replaceAll(/\W/g, "").slice(0, 8)}`,
        raw_request: request,
        resolved_intent: "fake",
        registry_version: 1,
        output_kind: "fake",
        status: "planned",
        work_item_id: null,
        plan_id: null,
        prompt_packet_path: null,
        created_at: "2026-06-10T00:00:00.000Z",
        updated_at: "2026-06-10T00:00:00.000Z"
      },
      resolvedIntent: {
        intentId: "fake",
        matched: true,
        title: request,
        queue: "work_queue",
        workClassification: "autonomous",
        nextAction: "Review fake response.",
        outputKind: "fake",
        expectedArtifact: null,
        skillSequence: [],
        approvalGates: [],
        codexPurpose: null,
        templates: [],
        slots: {}
      },
      workItem: {
        id: `work_${request.replaceAll(/\W/g, "").slice(0, 8)}`,
        project_id: null,
        milestone_id: null,
        title: request,
        raw_input: request,
        queue: "work_queue",
        work_classification: "autonomous",
        next_action: "Review fake response.",
        expected_artifact: null,
        status: "open",
        created_at: "2026-06-10T00:00:00.000Z",
        updated_at: "2026-06-10T00:00:00.000Z"
      },
      plan: {
        id: `plan_${request.replaceAll(/\W/g, "").slice(0, 8)}`,
        work_item_id: `work_${request.replaceAll(/\W/g, "").slice(0, 8)}`,
        status: "planned",
        summary: "Fake plan.",
        created_at: "2026-06-10T00:00:00.000Z",
        updated_at: "2026-06-10T00:00:00.000Z",
        steps: []
      },
      approvalGates: [],
      codexInvocations: [],
      run: null
    },
    artifacts: [],
    warnings: []
  };
}
