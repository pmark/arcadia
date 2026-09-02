import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProjectSetupContextAllCommand } from "../src/commands/project.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import type { UpsertProjectInput } from "../src/domain/types.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

function projectInput(overrides: Partial<UpsertProjectInput> & { name: string }): UpsertProjectInput {
  return {
    mission: "Ship it",
    status: "active",
    currentMilestone: "Define the next milestone.",
    nextAction: "Clarify the next action.",
    workClassification: "autonomous",
    ...overrides
  };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-setup-context-all-workspace-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function tempRepo(name: string): string {
  const repo = mkdtempSync(path.join(tmpdir(), `arcadia-setup-context-all-repo-${name}-`));
  roots.push(repo);
  // realpath, because macOS resolves /var to /private/var and setup's own
  // path resolution compares against the resolved path.
  return realpathSync(repo);
}

describe("runProjectSetupContextAllCommand", () => {
  it("updates every active project with a configured repository, and skips the rest", () => {
    const workspace = tempWorkspace();
    const withRepo = tempRepo("with-repo");
    mkdirSync(path.join(withRepo, "src"), { recursive: true });

    withDatabase(workspace, (db) => {
      const configured = upsertProject(db, projectInput({ name: "Configured Project" }));
      upsertProjectMetadata(db, { projectId: configured.id, repoPath: withRepo });

      upsertProject(db, projectInput({ name: "Unconfigured Project" }));

      const inactive = upsertProject(db, projectInput({ name: "Retired Project", status: "completed" }));
      upsertProjectMetadata(db, { projectId: inactive.id, repoPath: tempRepo("inactive") });
    });

    const response = runProjectSetupContextAllCommand({ workspace });

    expect(response.data.summary).toEqual({ updated: 1, skipped: 1, failed: 0 });
    expect(response.data.results).toHaveLength(2);

    const updated = response.data.results.find((result) => result.projectName === "Configured Project");
    expect(updated?.status).toBe("updated");
    expect(updated?.repoPath).toBe(withRepo);
    expect(existsSync(path.join(withRepo, "AGENTS.md"))).toBe(true);
    expect(readFileSync(path.join(withRepo, "AGENTS.md"), "utf8")).toContain("## Divide and conquer");

    const skipped = response.data.results.find((result) => result.projectName === "Unconfigured Project");
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.repoPath).toBeNull();

    expect(response.data.results.some((result) => result.projectName === "Retired Project")).toBe(false);
  });

  // macOS volumes are case-insensitive by default, so `existsSync` answered
  // true for `docs/ARCHITECTURE.md` when only `docs/architecture.md` existed
  // and the generated context named a path that does not resolve on Linux.
  it("lists an important doc only under the casing actually committed", () => {
    const workspace = tempWorkspace();
    const repo = tempRepo("case-variant-docs");
    mkdirSync(path.join(repo, "docs"), { recursive: true });
    writeFileSync(path.join(repo, "docs/architecture.md"), "# Architecture\n");

    withDatabase(workspace, (db) => {
      const project = upsertProject(db, projectInput({ name: "Case Variant Project" }));
      upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    });

    runProjectSetupContextAllCommand({ workspace });

    const context = readFileSync(path.join(repo, ".arcadia/repo-context.md"), "utf8");
    expect(context).toContain("- docs/architecture.md");
    expect(context).not.toContain("- docs/ARCHITECTURE.md");
  });

  it("reports a per-project failure without aborting the rest of the batch", () => {
    const workspace = tempWorkspace();
    const goodRepo = tempRepo("good");
    const missingRepo = path.join(tmpdir(), "arcadia-setup-context-all-missing-repo-does-not-exist");

    withDatabase(workspace, (db) => {
      const good = upsertProject(db, projectInput({ name: "Good Project" }));
      upsertProjectMetadata(db, { projectId: good.id, repoPath: goodRepo });

      const broken = upsertProject(db, projectInput({ name: "Broken Project" }));
      upsertProjectMetadata(db, { projectId: broken.id, repoPath: missingRepo });
    });

    const response = runProjectSetupContextAllCommand({ workspace });

    expect(response.data.summary).toEqual({ updated: 1, skipped: 0, failed: 1 });
    const failed = response.data.results.find((result) => result.projectName === "Broken Project");
    expect(failed?.status).toBe("failed");
    expect(failed?.detail).toBeTruthy();
    const succeeded = response.data.results.find((result) => result.projectName === "Good Project");
    expect(succeeded?.status).toBe("updated");
  });
});
