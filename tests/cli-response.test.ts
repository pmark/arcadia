import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork } from "../src/db/repositories.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("CLI response contract", () => {
  it("emits JSON success for init", () => {
    const workspace = createTempWorkspacePath();
    const result = runCli(["init", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("init");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.databasePath).toBe(path.join(path.resolve(workspace), "database", "arcadia.sqlite3"));
    expect(json.artifacts).toContain(path.join(path.resolve(workspace), "database", "arcadia.sqlite3"));
    expect(existsSync(path.join(workspace, "config", "arcadia.json"))).toBe(true);
  });

  it("emits JSON success for status and generated report artifacts", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["status", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("status");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.projectCount).toBe(0);
    expect(json.data.reportPath).toBe(path.join(path.resolve(workspace), "reports", "status.md"));
    expect(json.artifacts).toContain(path.join(path.resolve(workspace), "reports", "status.md"));
  });

  it("emits JSON success for project list", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["project", "list", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.list");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.projects).toEqual([]);
  });

  it("updates project status with JSON output", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);

    const result = runCli([
      "project",
      "update",
      created.project.id,
      "--workspace",
      workspace,
      "--status",
      "paused",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.update");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.updated).toEqual(["status"]);
    expect(json.data.project.id).toBe(created.project.id);
    expect(json.data.project.status).toBe("paused");
  });

  it("creates and completes milestones with JSON output", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);

    const createResult = runCli([
      "milestone",
      "create",
      created.project.id,
      "--workspace",
      workspace,
      "--title",
      "Ship the next slice",
      "--json"
    ]);

    expect(createResult.status).toBe(0);
    expect(createResult.stderr).toBe("");
    const createJson = parseJson(createResult.stdout);
    expect(createJson.ok).toBe(true);
    expect(createJson.command).toBe("milestone.create");
    expect(createJson.data.milestone.id).toMatch(/^ms_/);
    expect(createJson.data.milestone.project_id).toBe(created.project.id);
    expect(createJson.data.milestone.title).toBe("Ship the next slice");
    expect(createJson.data.milestone.status).toBe("active");

    const completeResult = runCli([
      "milestone",
      "complete",
      createJson.data.milestone.id,
      "--workspace",
      workspace,
      "--json"
    ]);

    expect(completeResult.status).toBe(0);
    expect(completeResult.stderr).toBe("");
    const completeJson = parseJson(completeResult.stdout);
    expect(completeJson.ok).toBe(true);
    expect(completeJson.command).toBe("milestone.complete");
    expect(completeJson.data.milestone.id).toBe(createJson.data.milestone.id);
    expect(completeJson.data.milestone.status).toBe("completed");
  });

  it("emits JSON success for queue groups", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["queue", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("queue");
    expect(json.data.queues.inbox).toEqual([]);
    expect(json.data.queues.work_queue).toEqual([]);
    expect(json.data.queues.needs_mark).toEqual([]);
    expect(json.data.queues.blocked).toEqual([]);
  });

  it("imports an inbox item non-interactively with JSON output", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "inbox",
      "import",
      "--workspace",
      workspace,
      "--title",
      "Capture scripted work",
      "--input",
      "Capture scripted work from a local tool",
      "--queue",
      "work_queue",
      "--classification",
      "autonomous",
      "--next-action",
      "Run the local script",
      "--expected-artifact",
      "Script output",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("inbox.import");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.workItem.id).toMatch(/^work_/);
    expect(json.data.workItem.title).toBe("Capture scripted work");
    expect(json.data.workItem.queue).toBe("work_queue");
    expect(json.data.workItem.work_classification).toBe("autonomous");
    expect(json.data.artifact.id).toMatch(/^art_/);
    expect(json.data.artifact.title).toBe("Script output");

    const queueResult = runCli(["queue", "--workspace", workspace, "--json"]);
    const queueJson = parseJson(queueResult.stdout);
    expect(queueJson.data.queues.work_queue).toHaveLength(1);
    expect(queueJson.data.queues.work_queue[0].title).toBe("Capture scripted work");
  });

  it("lists artifacts with JSON output", () => {
    const workspace = initializedWorkspace();
    createProject(workspace);

    const result = runCli(["artifact", "list", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("artifact.list");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.artifacts).toHaveLength(1);
    expect(json.data.artifacts[0].title).toBe("CLI Fixture Artifact");
    expect(json.data.artifacts[0].status).toBe("planned");
  });

  it("updates artifacts with JSON output", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const artifactId = created.artifact?.id;
    expect(artifactId).toBeTruthy();

    const result = runCli([
      "artifact",
      "update",
      artifactId,
      "--workspace",
      workspace,
      "--status",
      "ready",
      "--path",
      "artifacts/cli-fixture.md",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("artifact.update");
    expect(json.data.updated).toEqual(["status", "path"]);
    expect(json.data.artifact.id).toBe(artifactId);
    expect(json.data.artifact.status).toBe("ready");
    expect(json.data.artifact.path).toBe("artifacts/cli-fixture.md");
  });

  it("lists work items with JSON output", () => {
    const workspace = initializedWorkspace();
    importWorkItem(workspace, {
      title: "List this work",
      queue: "inbox",
      classification: "autonomous",
      nextAction: "Review the listing"
    });

    const result = runCli(["work", "list", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("work.list");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.workItems).toHaveLength(1);
    expect(json.data.workItems[0].title).toBe("List this work");
  });

  it("updates work items with JSON output", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Update this work",
      queue: "inbox",
      classification: "autonomous",
      nextAction: "Clarify the update"
    });

    const result = runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--queue",
      "work_queue",
      "--classification",
      "codex",
      "--next-action",
      "Implement the update",
      "--status",
      "in_progress",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("work.update");
    expect(json.data.updated).toEqual(["queue", "classification", "nextAction", "status"]);
    expect(json.data.workItem.id).toBe(workItem.id);
    expect(json.data.workItem.queue).toBe("work_queue");
    expect(json.data.workItem.work_classification).toBe("codex");
    expect(json.data.workItem.next_action).toBe("Implement the update");
    expect(json.data.workItem.status).toBe("in_progress");
  });

  it("marks work items done with JSON output", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Complete this work",
      queue: "work_queue",
      classification: "codex",
      nextAction: "Finish it"
    });

    const result = runCli(["work", "done", workItem.id, "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("work.done");
    expect(json.data.workItem.id).toBe(workItem.id);
    expect(json.data.workItem.status).toBe("done");
  });

  it("emits stable JSON for inbox import validation errors", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "inbox",
      "import",
      "--workspace",
      workspace,
      "--title",
      "Bad queue",
      "--input",
      "Bad queue",
      "--queue",
      "bad_queue",
      "--classification",
      "codex",
      "--next-action",
      "Should fail",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("inbox.import");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Queue must be one of");
  });

  it("emits stable JSON for inbox import missing project references", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "inbox",
      "import",
      "--workspace",
      workspace,
      "--title",
      "Needs project",
      "--input",
      "Needs project",
      "--queue",
      "work_queue",
      "--classification",
      "codex",
      "--next-action",
      "Find project",
      "--project",
      "proj_missing",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("inbox.import");
    expect(json.error.code).toBe("PROJECT_NOT_FOUND");
    expect(json.error.details.projectId).toBe("proj_missing");
  });

  it("emits stable JSON for project update validation errors", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);

    const result = runCli([
      "project",
      "update",
      created.project.id,
      "--workspace",
      workspace,
      "--status",
      "not_a_status",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("project.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Project status must be one of");
  });

  it("emits stable JSON for missing project updates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "project",
      "update",
      "proj_missing",
      "--workspace",
      workspace,
      "--status",
      "paused",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("project.update");
    expect(json.error.code).toBe("PROJECT_NOT_FOUND");
    expect(json.error.details.projectId).toBe("proj_missing");
  });

  it("emits stable JSON for missing milestone create project references", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "milestone",
      "create",
      "proj_missing",
      "--workspace",
      workspace,
      "--title",
      "Missing parent",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("milestone.create");
    expect(json.error.code).toBe("PROJECT_NOT_FOUND");
    expect(json.error.details.projectId).toBe("proj_missing");
  });

  it("emits stable JSON for missing milestone completion", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["milestone", "complete", "ms_missing", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("milestone.complete");
    expect(json.error.code).toBe("MILESTONE_NOT_FOUND");
    expect(json.error.details.milestoneId).toBe("ms_missing");
  });

  it("emits stable JSON for artifact update validation errors", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const artifactId = created.artifact?.id;
    expect(artifactId).toBeTruthy();

    const result = runCli([
      "artifact",
      "update",
      artifactId,
      "--workspace",
      workspace,
      "--status",
      "not_a_status",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("artifact.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Artifact status must be one of");
  });

  it("emits stable JSON when artifact update has no fields", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const artifactId = created.artifact?.id;
    expect(artifactId).toBeTruthy();

    const result = runCli(["artifact", "update", artifactId, "--workspace", workspace, "--json"]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("artifact.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.fields).toEqual(["status", "path"]);
  });

  it("emits stable JSON for missing artifact updates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "artifact",
      "update",
      "art_missing",
      "--workspace",
      workspace,
      "--status",
      "ready",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("artifact.update");
    expect(json.error.code).toBe("ARTIFACT_NOT_FOUND");
    expect(json.error.details.artifactId).toBe("art_missing");
  });

  it("emits stable JSON for work update validation errors", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Invalid update target",
      queue: "work_queue",
      classification: "codex",
      nextAction: "Stay valid"
    });

    const result = runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--status",
      "not_a_status",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("Work item status must be one of");
  });

  it("emits stable JSON when work update has no fields", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "No fields target",
      queue: "work_queue",
      classification: "codex",
      nextAction: "Stay valid"
    });

    const result = runCli(["work", "update", workItem.id, "--workspace", workspace, "--json"]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.update");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details.fields).toEqual(["queue", "classification", "nextAction", "status"]);
  });

  it("emits stable JSON for missing work item updates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "work",
      "update",
      "work_missing",
      "--workspace",
      workspace,
      "--status",
      "in_progress",
      "--json"
    ]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.update");
    expect(json.error.code).toBe("WORK_ITEM_NOT_FOUND");
    expect(json.error.details.workItemId).toBe("work_missing");
  });

  it("emits stable JSON for missing work item completion", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["work", "done", "work_missing", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.done");
    expect(json.error.code).toBe("WORK_ITEM_NOT_FOUND");
    expect(json.error.details.workItemId).toBe("work_missing");
  });

  it("emits stable JSON for inbox import usage errors", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["inbox", "import", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("inbox.import");
    expect(json.error.code).toBe("USAGE_ERROR");
    expect(json.error.message).toContain("required option");
  });

  it("emits stable JSON for usage errors", () => {
    const result = runCli(["status", "--json"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("status");
    expect(json.error.code).toBe("USAGE_ERROR");
    expect(json.error.message).toContain("required option");
  });

  it("emits stable JSON for missing workspaces", () => {
    const missingWorkspace = path.join(tmpdir(), `arcadia-missing-${Date.now()}`);
    const result = runCli(["status", "--workspace", missingWorkspace, "--json"]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("status");
    expect(json.workspace).toBe(path.resolve(missingWorkspace));
    expect(json.error.code).toBe("WORKSPACE_NOT_FOUND");
    expect(json.error.message).toBe("Workspace not found.");
  });

  it("emits stable JSON for uninitialized databases", () => {
    const workspace = createTempWorkspacePath();
    mkdirSync(workspace, { recursive: true });
    const result = runCli(["work", "list", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("work.list");
    expect(json.error.code).toBe("DATABASE_NOT_INITIALIZED");
    expect(json.error.message).toBe("Arcadia database is not initialized.");
  });

  it("emits stable human errors without stack traces", () => {
    const result = runCli(["status", "--workspace", path.join(tmpdir(), "arcadia-nope")]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Error [WORKSPACE_NOT_FOUND]: Workspace not found.");
    expect(result.stderr).not.toContain("at ");
  });
});

function runCli(args: string[]) {
  return spawnSync(tsxBin, ["src/cli.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

function parseJson(value: string) {
  return JSON.parse(value) as Record<string, any>;
}

function createTempWorkspacePath(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-cli-test-"));
  rmSync(workspace, { recursive: true, force: true });
  workspaces.push(workspace);
  return workspace;
}

function initializedWorkspace(): string {
  const workspace = createTempWorkspacePath();
  const result = runCli(["init", workspace]);
  expect(result.status).toBe(0);
  return workspace;
}

function createProject(workspace: string) {
  return withDatabase(workspace, (db) =>
    createProjectWithInitialWork(db, {
      name: "CLI Fixture Project",
      mission: "Support CLI tests.",
      status: "active",
      currentMilestone: "Initial milestone",
      nextAction: "Exercise the CLI",
      expectedArtifact: "CLI Fixture Artifact",
      workClassification: "codex"
    })
  );
}

function importWorkItem(
  workspace: string,
  input: { title: string; queue: string; classification: string; nextAction: string }
) {
  const result = runCli([
    "inbox",
    "import",
    "--workspace",
    workspace,
    "--title",
    input.title,
    "--input",
    input.title,
    "--queue",
    input.queue,
    "--classification",
    input.classification,
    "--next-action",
    input.nextAction,
    "--json"
  ]);
  expect(result.status).toBe(0);
  return parseJson(result.stdout).data.workItem;
}
