import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runWorkDoneCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork, getWorkItem, upsertProjectMetadata } from "../src/db/repositories.js";
import { runLivingSystemSyncCommand } from "../src/livingSystem/sync.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("living-system sync integration", () => {
  it("previews without writes, applies the same Project, and reports an unchanged rerun", () => {
    const fixture = setup();
    const preview = runLivingSystemSyncCommand({
      workspace: fixture.workspace,
      project: "arcadia",
      refreshedAt: "2026-08-21T12:00:00.000Z"
    });
    expect(preview.data.applied).toBe(false);
    expect(preview.data.counts.created).toBeGreaterThan(0);
    expect(existsSync(path.join(fixture.vault, "Projects", "arcadia"))).toBe(false);

    const applied = runLivingSystemSyncCommand({
      workspace: fixture.workspace,
      project: "arcadia",
      apply: true,
      refreshedAt: "2026-08-21T12:00:00.000Z"
    });
    expect(applied.data.counts).toEqual(preview.data.counts);
    expect(readFileSync(path.join(fixture.vault, "Projects", "arcadia", "Home.md"), "utf8"))
      .toContain("## Choose your depth");

    const unchanged = runLivingSystemSyncCommand({
      workspace: fixture.workspace,
      project: "arcadia",
      apply: true,
      refreshedAt: "2026-08-22T12:00:00.000Z"
    });
    expect(unchanged.data.counts.unchanged).toBeGreaterThan(0);
    expect(unchanged.data.counts.updated).toBe(0);
  });

  it("isolates --all failures and makes post-transition refresh warnings non-blocking", () => {
    const fixture = setup();
    const missingRepo = temporary("living-system-missing-");
    const missing = withDatabase(fixture.workspace, (db) => {
      const created = createProjectWithInitialWork(db, {
        name: "Missing Manifest",
        mission: "Prove independent sync failures.",
        status: "active",
        currentMilestone: "Proof",
        nextAction: "Complete the proof",
        workClassification: "autonomous"
      });
      upsertProjectMetadata(db, { projectId: created.project.id, aliases: [], repoPath: missingRepo, validationCommands: [] });
      return created;
    });
    const all = runLivingSystemSyncCommand({ workspace: fixture.workspace, all: true });
    expect(all.data.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ project: "arcadia", status: "projected" }),
      expect.objectContaining({ project: "missing-manifest", status: "skipped" })
    ]));

    writeFileSync(getWorkspacePaths(fixture.workspace).configFile, JSON.stringify({
      memory: { enabled: true, obsidianVaultPath: path.join(fixture.workspace, "absent-vault") }
    }));
    const completed = runWorkDoneCommand({ workspace: fixture.workspace, workId: missing.workItem.id });
    expect(completed.data.workItem.status).toBe("done");
    expect(completed.warnings[0]).toMatch(/Action completed, but living-system refresh needs attention/);
    expect(withDatabase(fixture.workspace, (db) => getWorkItem(db, missing.workItem.id))?.status).toBe("done");
  });
});

function setup(): { workspace: string; vault: string } {
  const workspace = temporary("living-system-workspace-");
  const vault = temporary("living-system-vault-");
  const repository = temporary("living-system-repository-");
  cpSync(path.resolve("tests/fixtures/living-system/arcadia"), repository, { recursive: true });
  writeFileSync(path.join(repository, "PROJECT.md"), `---
arcadia: v1
type: project
slug: arcadia
name: Arcadia
status: active
goal: Maintain momentum.
outcome: A truthful system story.
milestone: Living system v1
active_plan: main
current_action: project
updated: 2026-08-21
---
`);
  mkdirSync(path.join(repository, "docs", "plans"), { recursive: true });
  writeFileSync(path.join(repository, "docs", "plans", "main.md"), `---
arcadia: v1
type: plan
slug: main
project: arcadia
status: active
milestone: Living system v1
current_action: project
token_impact: none
token_budget: Deterministic only.
recommended_model: gpt-5.6-terra
updated: 2026-08-21
actions:
  - id: project
    title: Project the living system
    status: open
    responsibility: codex
    next_action: Validate the generated story.
    expected_artifact: Generated vault subtree
    clarification: clarified
    confidence: high
    source: Approved plan
    acceptance_criteria: [The result is observable.]
    depends_on: []
    decisions: []
    references: [src/clarification.ts]
questions: []
decisions: []
---
`);
  mkdirSync(path.join(vault, ".obsidian"));
  initWorkspace(workspace);
  writeFileSync(getWorkspacePaths(workspace).configFile, JSON.stringify({
    memory: { enabled: true, obsidianVaultPath: vault }
  }));
  withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Maintain momentum.",
      status: "active",
      currentMilestone: "Living system v1",
      nextAction: "Project the living system",
      workClassification: "autonomous"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      aliases: [],
      repoPath: repository,
      validationCommands: []
    });
  });
  return { workspace, vault };
}

function temporary(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
