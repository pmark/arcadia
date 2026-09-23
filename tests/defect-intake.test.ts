import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderDefectIntakeSuccess,
  renderDefectListSuccess,
  runDefectIntakeCommand,
  runDefectListCommand,
  runDefectShowCommand
} from "../src/commands/defect.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  getBackBurnerItem,
  listDefectSignals
} from "../src/db/repositories.js";
import { defectFingerprint } from "../src/defect/signal.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];
const originalInvokedFrom = process.env.ARCADIA_INVOKED_FROM;

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
  if (originalInvokedFrom === undefined) delete process.env.ARCADIA_INVOKED_FROM;
  else process.env.ARCADIA_INVOKED_FROM = originalInvokedFrom;
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-defect-intake-"));
  workspaces.push(directory);
  initWorkspace(directory);
  return directory;
}

/**
 * Point `invocationRoot()` at a throwaway directory that does (or does not)
 * declare a managed Project, so the enclosing-Project resolution is tested
 * against known content rather than whatever checkout vitest happens to run in.
 */
function invocationDir(projectSlug: string | null): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-defect-invocation-"));
  workspaces.push(directory);
  if (projectSlug) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "PROJECT.md"),
      [
        "---",
        "arcadia: v1",
        "type: project",
        `slug: ${projectSlug}`,
        "name: Invocation Project",
        "status: active",
        "goal: Prove the enclosing Project resolves.",
        "updated: 2026-09-23",
        "---",
        "",
        "# Invocation Project",
        ""
      ].join("\n"),
      "utf8"
    );
  }
  process.env.ARCADIA_INVOKED_FROM = directory;
  return directory;
}

function seedProject(ws: string, name = "Arcadia"): string {
  return withDatabase(ws, (db) =>
    createProjectWithInitialWork(db, {
      name,
      mission: "Maintain momentum.",
      status: "active",
      currentMilestone: "Capture defects",
      nextAction: "Continue",
      workClassification: "agent"
    }).project.id
  );
}

function count(db: Parameters<typeof listDefectSignals>[0], table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe("arcadia defect intake", () => {
  it("records a durable Back Burner defect signal with captured context and no model call", () => {
    const ws = workspace();
    const projectId = seedProject(ws);

    const result = runDefectIntakeCommand({
      workspace: ws,
      summary: "Worker stops processing the queue after a hang.",
      project: projectId,
      source: "cli.defect",
      evidence: ["Observed PID 1234 spinning", "worker.log shows Recovered hung worker:"],
      revision: "abc123"
    });

    expect(result.data.created).toBe(true);
    expect(result.data.signal).toMatchObject({
      project_id: projectId,
      source: "cli.defect",
      repository_revision: "abc123",
      evidence: ["Observed PID 1234 spinning", "worker.log shows Recovered hung worker:"]
    });
    expect(result.data.signal.id).toMatch(/^def_/);
    expect(result.data.signal.fingerprint).toHaveLength(64);

    withDatabase(ws, (db) => {
      const item = getBackBurnerItem(db, result.data.signal.back_burner_item_id);
      expect(item).toMatchObject({
        classification: "BugReport",
        original_input: "Worker stops processing the queue after a hang.",
        project_id: projectId,
        ingress_source: "cli.defect"
      });
      // Zero model calls: the deterministic intake never enters the Ask or
      // Intelligence pipelines that would spend tokens.
      expect(count(db, "ask_requests")).toBe(0);
      expect(count(db, "intelligence_jobs")).toBe(0);
    });
  });

  it("resolves the enclosing Project when none is named", () => {
    const ws = workspace();
    const projectId = seedProject(ws, "Arcadia");
    invocationDir("arcadia");

    const result = runDefectIntakeCommand({
      workspace: ws,
      summary: "The dashboard shows a stale count after an archive."
    });

    expect(result.data.signal.project_id).toBe(projectId);
    expect(result.data.signal.project_name).toBe("Arcadia");
  });

  it("leaves a report unscoped when no Project is named or discoverable", () => {
    const ws = workspace();
    invocationDir(null);

    const result = runDefectIntakeCommand({
      workspace: ws,
      summary: "A defect filed before any Project exists."
    });

    expect(result.data.signal.project_id).toBeNull();
    expect(result.data.signal.project_name).toBeNull();
  });

  it("is idempotent on exact retry and merges evidence without a second record", () => {
    const ws = workspace();
    const projectId = seedProject(ws);

    const first = runDefectIntakeCommand({
      workspace: ws,
      summary: "Export writes a truncated CSV.",
      project: projectId,
      evidence: ["first observation"]
    });
    const retry = runDefectIntakeCommand({
      workspace: ws,
      summary: "  Export writes a truncated CSV.  ",
      project: projectId,
      evidence: ["first observation", "second observation"],
      revision: "deadbeef"
    });

    expect(first.data.created).toBe(true);
    expect(retry.data.created).toBe(false);
    expect(retry.data.signal.id).toBe(first.data.signal.id);
    expect(retry.data.signal.evidence).toEqual(["first observation", "second observation"]);
    expect(retry.data.signal.repository_revision).toBe("deadbeef");

    withDatabase(ws, (db) => {
      expect(count(db, "defect_signals")).toBe(1);
      expect(count(db, "back_burner_items")).toBe(1);
    });
  });

  it("reports likely duplicates while preserving each distinct report", () => {
    const ws = workspace();
    const projectId = seedProject(ws);

    const original = runDefectIntakeCommand({
      workspace: ws,
      summary: "Video export drops the audio track on long clips.",
      project: projectId
    });
    const nearDuplicate = runDefectIntakeCommand({
      workspace: ws,
      summary: "Video export drops audio track for long clips.",
      project: projectId
    });
    const distinct = runDefectIntakeCommand({
      workspace: ws,
      summary: "Publishing fails when the Pinterest token is expired.",
      project: projectId
    });

    expect(nearDuplicate.data.created).toBe(true);
    expect(nearDuplicate.data.signal.id).not.toBe(original.data.signal.id);
    expect(nearDuplicate.data.duplicateCandidates.map((candidate) => candidate.id)).toContain(original.data.signal.id);
    expect(distinct.data.duplicateCandidates).toEqual([]);

    withDatabase(ws, (db) => {
      expect(count(db, "defect_signals")).toBe(3);
    });
  });

  it("derives a stable fingerprint from normalized summary, Project, and source", () => {
    const left = defectFingerprint("Export writes a truncated CSV.", "proj_1", "cli.defect");
    const right = defectFingerprint("  export   writes a truncated csv. ", "proj_1", "cli.defect");
    const otherSource = defectFingerprint("Export writes a truncated CSV.", "proj_1", "discord.defect");

    expect(left).toBe(right);
    expect(left).not.toBe(otherSource);
  });

  it("lists and shows recorded signals", () => {
    const ws = workspace();
    const projectId = seedProject(ws);
    const recorded = runDefectIntakeCommand({
      workspace: ws,
      summary: "Search ignores archived items.",
      project: projectId
    });

    const list = runDefectListCommand({ workspace: ws });
    expect(list.data.count).toBe(1);
    expect(list.data.signals[0]?.id).toBe(recorded.data.signal.id);

    const show = runDefectShowCommand({ workspace: ws, id: recorded.data.signal.id });
    expect(show.data.signal.summary).toBe("Search ignores archived items.");

    expect(() => runDefectShowCommand({ workspace: ws, id: "def_missing" })).toThrow(/not found/i);

    const rendered = renderDefectIntakeSuccess(recorded).join("\n");
    expect(rendered).toContain("Arcadia defect recorded.");
    expect(rendered).toContain(recorded.data.signal.id);
    expect(renderDefectListSuccess(list).join("\n")).toContain("Search ignores archived items.");
  });
});
