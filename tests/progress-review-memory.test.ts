import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runReviewWeeklyCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import { createMissionLog, upsertProject } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const WINDOW = { since: "2026-06-03", until: "2026-06-09" };

function temporary(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function obsidianVault(): string {
  const vault = temporary("arcadia-progress-vault-");
  mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
  writeFileSync(path.join(vault, "Welcome.md"), "untouched\n", "utf8");
  return vault;
}

function enableMemory(workspace: string, vault: string): void {
  const configPath = getWorkspacePaths(workspace).configFile;
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.memory = { enabled: true, obsidianVaultPath: vault };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function fixture(options: { memory: boolean }): { workspace: string; vault: string } {
  const workspace = temporary("arcadia-progress-workspace-");
  const vault = obsidianVault();
  initWorkspace(workspace);
  if (options.memory) {
    enableMemory(workspace, vault);
  }

  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Rebuster",
      mission: "Ship Rebuster.",
      status: "active",
      currentMilestone: "First",
      nextAction: "Start",
      workClassification: "agent"
    });
    const log = createMissionLog(db, {
      projectId: project.id,
      workPerformed: "Shipped the publishing slice.",
      result: "Publishing works end to end.",
      nextAction: "Measure it.",
      markdownPath: "mission_logs/rebuster.md"
    });
    db.prepare("UPDATE mission_logs SET created_at = ?, updated_at = ? WHERE id = ?").run(
      "2026-06-05T12:00:00.000Z",
      "2026-06-05T12:00:00.000Z",
      log.id
    );
  });

  return { workspace, vault };
}

function recordFile(vault: string, scope: string): string {
  return path.join(realpathSync(vault), "Arcadia", "Records", "Progress", scope, "2026", "2026-06-09-progress-review.md");
}

describe("progress reviews as vault Records", () => {
  it("does nothing when the workspace has not opted into vault memory", () => {
    const { workspace, vault } = fixture({ memory: false });

    const response = runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });

    expect(response.data.memory).toBeNull();
    expect(response.data.memoryError).toBeNull();
    // The vault must be untouched, not merely empty of Records.
    expect(readFileSync(path.join(vault, "Welcome.md"), "utf8")).toBe("untouched\n");
  });

  it("projects a scoped review into the vault, with provenance", () => {
    const { workspace, vault } = fixture({ memory: true });

    const response = runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });

    expect(response.data.memory).toMatchObject({ status: "created", project: "Rebuster" });
    const record = readFileSync(recordFile(vault, "rebuster"), "utf8");
    expect(record).toContain("record_type: progress_review");
    expect(record).toContain('arcadia_review_key: "rebuster/2026-06-03..2026-06-09"');
    expect(record).toContain("# Rebuster progress, 2026-06-03 to 2026-06-09");
    // The report renders each Log's `result`, which is the operator-facing
    // sentence; `work_performed` stays in the database.
    expect(record).toContain("Publishing works end to end.");
    expect(record).toContain("SQLite remains operational truth");
  });

  it("carries only one title, not the report's as well", () => {
    const { workspace, vault } = fixture({ memory: true });

    runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });

    const headings = readFileSync(recordFile(vault, "rebuster"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("# "));
    expect(headings).toEqual(["# Rebuster progress, 2026-06-03 to 2026-06-09"]);
  });

  it("skips a re-run that found nothing new, rather than churning the vault", () => {
    const { workspace, vault } = fixture({ memory: true });

    const first = runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });
    const before = readFileSync(recordFile(vault, "rebuster"), "utf8");
    const second = runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });

    expect(first.data.memory?.status).toBe("created");
    // Only the generation timestamp differs between the two runs, and that
    // must not count as a change.
    expect(second.data.memory?.status).toBe("skipped");
    expect(readFileSync(recordFile(vault, "rebuster"), "utf8")).toBe(before);
  });

  it("updates the Record when the underlying work actually changed", () => {
    const { workspace, vault } = fixture({ memory: true });
    runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });

    withDatabase(workspace, (db) => {
      const projectId = (db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }).id;
      const log = createMissionLog(db, {
        projectId,
        workPerformed: "Also fixed the retry path.",
        result: "Retries are truthful.",
        nextAction: "Ship it.",
        markdownPath: "mission_logs/rebuster-2.md"
      });
      db.prepare("UPDATE mission_logs SET created_at = ?, updated_at = ? WHERE id = ?").run(
        "2026-06-06T12:00:00.000Z",
        "2026-06-06T12:00:00.000Z",
        log.id
      );
    });

    const second = runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });

    expect(second.data.memory?.status).toBe("updated");
    expect(readFileSync(recordFile(vault, "rebuster"), "utf8")).toContain("Retries are truthful.");
  });

  it("keeps portfolio and Project Records apart", () => {
    const { workspace, vault } = fixture({ memory: true });

    runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });
    const portfolio = runReviewWeeklyCommand({ workspace, ...WINDOW });

    expect(portfolio.data.memory?.recordPath).toBe(recordFile(vault, "portfolio"));
    expect(readFileSync(recordFile(vault, "portfolio"), "utf8")).toContain('project: "Portfolio"');
    expect(readFileSync(recordFile(vault, "rebuster"), "utf8")).toContain('project: "Rebuster"');
  });

  it("reports a vault problem without losing the review", () => {
    const { workspace } = fixture({ memory: false });
    enableMemory(workspace, path.join(workspace, "missing-vault"));

    const response = runReviewWeeklyCommand({ workspace, ...WINDOW, project: "rebuster" });

    // The report is the deliverable; a misconfigured vault must not cost it.
    expect(readFileSync(response.data.reportPath, "utf8")).toContain("Rebuster");
    expect(response.data.memory).toBeNull();
    expect(response.data.memoryError).toMatch(/vault directory does not exist/);
  });
});
