import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import {
  createMissionLog,
  createReviewItem,
  setMissionLogDocRef,
  upsertProject
} from "../src/db/repositories.js";
import { buildNarrativeDigestRequest } from "../src/digests/contract.js";
import { composeProjectDigest, gatherProjectDigestFacts } from "../src/digests/composer.js";
import type { DigestNarrator, DigestWindow } from "../src/digests/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { runDigestExportCommand } from "../src/commands/digest.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const workspaces: string[] = [];
const WINDOW: DigestWindow = {
  period: "day",
  start: "2026-07-01T00:00:00.000Z",
  end: "2026-07-02T00:00:00.000Z"
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function workspaceWithProject(): { workspace: string; projectId: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-digest-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  const projectId = withDatabase(workspace, (db) => upsertProject(db, {
    name: "Alpha",
    mission: "Ship Alpha honestly.",
    status: "active",
    currentMilestone: "Tell the story",
    nextAction: "Compose the digest",
    workClassification: "agent"
  }).id);
  return { workspace, projectId };
}

function enableMemory(workspace: string, vault: string): void {
  const configPath = getWorkspacePaths(workspace).configFile;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.memory = { enabled: true, obsidianVaultPath: vault };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function vault(): string {
  const result = mkdtempSync(path.join(tmpdir(), "arcadia-digest-vault-"));
  workspaces.push(result);
  mkdirSync(path.join(result, ".obsidian"), { recursive: true });
  return result;
}

describe("narrative digest request", () => {
  it("is local-preferred, unpaid, and explicitly forbids invention", () => {
    const request = buildNarrativeDigestRequest({
      subject: {
        scope: "project",
        scopeKey: "project-alpha",
        projectId: "project-alpha",
        name: "Alpha",
        slug: "alpha"
      },
      window: WINDOW,
      facts: [{
        id: "mission-log:1",
        kind: "mission_log",
        occurredAt: WINDOW.start,
        summary: "A test passed.",
        detail: {}
      }]
    });

    expect(request).toMatchObject({
      capability: "text.generate",
      execution: "local-preferred",
      profile: "fast",
      executionPolicy: { allowPaidUsage: false, maxRetries: 1 },
      outputContract: { schemaId: "arcadia.narrative-digest.v1", schemaVersion: 1 }
    });
    const instructions = (request.input as { instructions: string }).instructions;
    expect(instructions).toContain("Every factual claim must be supported");
    expect(instructions).toContain("do not judge, grade, recommend, or invent");
  });
});

describe("project digest composition", () => {
  it("gathers only the Project's in-window Logs, dispatches, and Decisions", () => {
    const { workspace, projectId } = workspaceWithProject();
    withDatabase(workspace, (db) => {
      const project = db.prepare("SELECT *, goal AS outcome FROM projects WHERE id = ?").get(projectId) as any;
      const inside = createMissionLog(db, {
        projectId,
        workPerformed: "Implemented the parser.",
        result: "Focused tests passed.",
        nextAction: "Review it.",
        markdownPath: "MISSION_LOG.md"
      });
      setMissionLogDocRef(db, inside.id, "log/alpha#2026-07-01--parser");
      const outside = createMissionLog(db, {
        projectId,
        workPerformed: "Old work.", result: "Old result.", nextAction: "None.", markdownPath: "MISSION_LOG.md"
      });
      setMissionLogDocRef(db, outside.id, "log/alpha#2026-06-30--old");

      db.prepare(
        `INSERT INTO dispatch_events (
          id, occurred_at, local_date, command, project_id, project_slug, plan_slug,
          action_id, dispatchable, blocker_count, blocker_fields, operator_question
        ) VALUES (?, ?, ?, 'next', ?, ?, NULL, NULL, 1, 0, '[]', 0)`
      ).run("dispatch-inside", "2026-07-01T01:00:00.000Z", "2026-07-01", projectId, project.slug);
      db.prepare(
        `INSERT INTO dispatch_events (
          id, occurred_at, local_date, command, project_id, project_slug, plan_slug,
          action_id, dispatchable, blocker_count, blocker_fields, operator_question
        ) VALUES (?, ?, ?, 'next', ?, ?, NULL, NULL, 1, 0, '[]', 0)`
      ).run("dispatch-end", WINDOW.end, "2026-07-02", projectId, project.slug);

      const decision = createReviewItem(db, {
        projectId,
        decisionNeeded: "Approve the bounded change?",
        sourceInput: "test",
        proposedAction: "Approve",
        resolvedIntent: "Approval",
        confidenceLabel: "high",
        confidence: 1
      });
      db.prepare("UPDATE review_items SET created_at = ?, updated_at = ? WHERE id = ?")
        .run("2026-07-01T12:00:00.000Z", "2026-07-01T12:00:00.000Z", decision.id);

      const facts = gatherProjectDigestFacts(db, project, WINDOW);
      expect(facts.map((fact) => fact.id)).toEqual([
        `mission-log:${inside.id}`,
        "dispatch:dispatch-inside",
        `decision:${decision.id}`
      ]);
      expect(facts.every((fact) => fact.occurredAt >= WINDOW.start && fact.occurredAt < WINDOW.end)).toBe(true);
    });
  });

  it("updates one Artifact in place for the same Project/window", async () => {
    const { workspace, projectId } = workspaceWithProject();
    const db = openDatabase(workspace);
    try {
      const project = db.prepare("SELECT *, goal AS outcome FROM projects WHERE id = ?").get(projectId) as any;
      const log = createMissionLog(db, {
        projectId,
        workPerformed: "Built the composer.",
        result: "It produced a digest.",
        nextAction: "Export it.",
        markdownPath: "MISSION_LOG.md"
      });
      setMissionLogDocRef(db, log.id, "log/alpha#2026-07-01--composer");
      const narrator = vi.fn<DigestNarrator>(async () => ({ narrative: "Alpha built and verified the composer.", jobId: null }));

      const first = await composeProjectDigest({ db, workspacePath: workspace, project, window: WINDOW, narrator });
      const second = await composeProjectDigest({ db, workspacePath: workspace, project, window: WINDOW, narrator });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.digest.id).toBe(first.digest.id);
      expect(second.artifact.id).toBe(first.artifact.id);
      expect(db.prepare("SELECT COUNT(*) AS count FROM narrative_digests").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE artifact_type = 'narrative_digest'").get())
        .toEqual({ count: 1 });
      expect(readFileSync(path.join(workspace, second.artifact.path!), "utf8"))
        .toContain("Alpha built and verified the composer.");
      expect(narrator).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it("uses an honest deterministic result when the window has no facts", async () => {
    const { workspace, projectId } = workspaceWithProject();
    const db = openDatabase(workspace);
    try {
      const project = db.prepare("SELECT *, goal AS outcome FROM projects WHERE id = ?").get(projectId) as any;
      const narrator: DigestNarrator = async () => ({ narrative: "A spectacular launch happened.", jobId: null });
      const result = await composeProjectDigest({ db, workspacePath: workspace, project, window: WINDOW, narrator });
      expect(result.narrative).toBe("Nothing happened in Alpha's recorded activity during this day window.");
      expect(result.facts).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("exports an AI-labelled vault Record and skips an unchanged re-export", async () => {
    const { workspace, projectId } = workspaceWithProject();
    const obsidian = vault();
    enableMemory(workspace, obsidian);
    const db = openDatabase(workspace);
    let result;
    try {
      const project = db.prepare("SELECT *, goal AS outcome FROM projects WHERE id = ?").get(projectId) as any;
      const log = createMissionLog(db, {
        projectId,
        workPerformed: "Made the parser dependable.",
        result: "Alpha made the parser dependable.",
        nextAction: "Export the digest.",
        markdownPath: "MISSION_LOG.md"
      });
      setMissionLogDocRef(db, log.id, "log/alpha#2026-07-01--parser");
      result = await composeProjectDigest({
        db,
        workspacePath: workspace,
        project,
        window: WINDOW,
        narrator: async () => ({ narrative: "Alpha made the parser dependable.", jobId: null })
      });
    } finally {
      db.close();
    }

    const first = runDigestExportCommand({ workspace, digestId: result!.digest.id });
    const second = runDigestExportCommand({ workspace, digestId: result!.digest.id });
    const recordPath = first.data.memory?.recordPath;

    expect(first.data.memory).toMatchObject({ status: "created", artifactId: result!.artifact.id, project: "Alpha" });
    expect(second.data.memory?.status).toBe("skipped");
    expect(recordPath).not.toBeNull();
    const record = readFileSync(recordPath!, "utf8");
    expect(record).toContain("record_type: narrative_digest");
    expect(record).toContain("narration: local_preferred_ai");
    expect(record).toContain(`arcadia_digest_id: ${JSON.stringify(result!.digest.id)}`);
    expect(record).toContain("Alpha made the parser dependable.");
    expect(record).toContain("AI-narrated from the digest's bounded Arcadia fact snapshot");
  });

  it("does not touch a vault when memory is disabled", async () => {
    const { workspace, projectId } = workspaceWithProject();
    const db = openDatabase(workspace);
    let result;
    try {
      const project = db.prepare("SELECT *, goal AS outcome FROM projects WHERE id = ?").get(projectId) as any;
      result = await composeProjectDigest({
        db,
        workspacePath: workspace,
        project,
        window: WINDOW,
        narrator: async () => ({ narrative: "Alpha wrote a story.", jobId: null })
      });
    } finally {
      db.close();
    }

    expect(runDigestExportCommand({ workspace, digestId: result!.digest.id }).data.memory).toBeNull();
  });
});
