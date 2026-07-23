import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  createReviewItem,
  getProjectMetadata,
  getReviewItem,
  listActionableReviewItems,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { executeApprovedReview } from "../src/execution/reviewExecutor.js";

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
    createProject(workspace);
    const result = runCli(["status", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("status");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.projectCount).toBe(1);
    expect(json.data.activeProjectCount).toBe(1);
    expect(json.data.runningWorkCount).toBe(0);
    expect(json.data.queuedWorkCount).toBe(1);
    expect(json.data.requiresReviewCount).toBe(0);
    expect(json.data.requiresReviewWorkCount).toBe(0);
    expect(json.data.recentArtifactCount).toBe(1);
    expect(json.data.reportPath).toBe(path.join(path.resolve(workspace), "reports", "status.md"));
    expect(json.artifacts).toContain(path.join(path.resolve(workspace), "reports", "status.md"));
  });

  it("emits JSON success for weekly review and generated report artifacts", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE work_items SET status = ?, updated_at = ? WHERE id = ?").run(
        "done",
        "2026-06-07T12:00:00.000Z",
        created.workItem.id
      );
    });

    const result = runCli([
      "review",
      "weekly",
      "--workspace",
      workspace,
      "--since",
      "2026-06-03",
      "--until",
      "2026-06-09",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    const reportPath = path.join(path.resolve(workspace), "reports", "weekly", "2026-06-09.md");
    expect(json.ok).toBe(true);
    expect(json.command).toBe("review.weekly");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.window).toEqual({ since: "2026-06-03", until: "2026-06-09" });
    expect(json.data.reportPath).toBe(reportPath);
    expect(json.data.counts.completedWork).toBe(1);
    expect(json.artifacts).toContain(reportPath);
    expect(readFileSync(reportPath, "utf8")).toContain("Review window: 2026-06-03 to 2026-06-09");
  });

  it("emits JSON success for Back Burner capture and keeps review empty", () => {
    const workspace = initializedWorkspace();
    const asked = runCli(["ask", "Pinterest might help Rebuster.", "--workspace", workspace, "--json"]);
    expect(asked.status).toBe(0);
    const askedJson = parseJson(asked.stdout);
    expect(askedJson.data.result.status).toBe("captured");
    expect(askedJson.data.reviewItemId).toBeNull();
    expect(askedJson.data.backBurnerItemId).toMatch(/^bb_/);

    const backBurner = runCli(["back-burner", "list", "--workspace", workspace, "--status", "all", "--json"]);
    const review = runCli(["review", "--workspace", workspace, "--json"]);

    expect(backBurner.status).toBe(0);
    const json = parseJson(backBurner.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("back-burner.list");
    expect(json.data.count).toBe(1);
    expect(json.data.items[0].id).toBe(askedJson.data.backBurnerItemId);
    expect(json.data.items[0].original_input).toBe("Pinterest might help Rebuster.");

    expect(review.status).toBe(0);
    expect(parseJson(review.stdout).data.count).toBe(0);
  });

  it("shows, promotes, and archives Back Burner items from the CLI", () => {
    const promoteWorkspace = initializedWorkspace();
    const asked = parseJson(runCli(["ask", "Pinterest might help Rebuster.", "--workspace", promoteWorkspace, "--json"]).stdout);
    const itemId = asked.data.backBurnerItemId;

    const shown = parseJson(runCli(["back-burner", "show", itemId, "--workspace", promoteWorkspace, "--json"]).stdout);
    expect(shown.command).toBe("back-burner.show");
    expect(shown.data.item.original_input).toBe("Pinterest might help Rebuster.");

    const promoted = parseJson(runCli(["back-burner", "promote", itemId, "--workspace", promoteWorkspace, "--json"]).stdout);
    expect(promoted.command).toBe("back-burner.promote");
    expect(promoted.data.result.status).toBe("promoted");
    expect(promoted.data.workItem.id).toMatch(/^work_/);

    const archiveWorkspace = initializedWorkspace();
    const archivedAsk = parseJson(runCli(["ask", "Maybe improve Arcadia intake.", "--workspace", archiveWorkspace, "--json"]).stdout);
    const archived = parseJson(runCli([
      "back-burner",
      "archive",
      archivedAsk.data.backBurnerItemId,
      "--workspace",
      archiveWorkspace,
      "--json"
    ]).stdout);
    expect(archived.command).toBe("back-burner.archive");
    expect(archived.data.item.status).toBe("archived");
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

  it("defaults workspace commands from ARCADIA_WORKSPACE", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["project", "list", "--json"], { ARCADIA_WORKSPACE: workspace });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.list");
    expect(json.workspace).toBe(path.resolve(workspace));
  });

  it("lets explicit --workspace override ARCADIA_WORKSPACE", () => {
    const envWorkspace = initializedWorkspace();
    const explicitWorkspace = initializedWorkspace();
    createProject(explicitWorkspace);

    const result = runCli(
      ["project", "list", "--workspace", explicitWorkspace, "--json"],
      { ARCADIA_WORKSPACE: envWorkspace }
    );

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.workspace).toBe(path.resolve(explicitWorkspace));
    expect(json.data.projects).toHaveLength(1);
  });

  it("sets, gets, and uses the persistent default workspace", () => {
    const workspace = initializedWorkspace();
    const configPath = createTempConfigPath();

    const set = runCli(["config", "set", "defaultWorkspace", workspace, "--json"], {}, { configPath });
    expect(set.status).toBe(0);
    expect(parseJson(set.stdout).data.defaultWorkspace).toBe(path.resolve(workspace));

    const get = runCli(["config", "get", "defaultWorkspace", "--json"], {}, { configPath });
    expect(get.status).toBe(0);
    expect(parseJson(get.stdout).data.defaultWorkspace).toBe(path.resolve(workspace));

    const listed = runCli(["project", "list", "--json"], {}, { configPath });
    expect(listed.status).toBe(0);
    expect(parseJson(listed.stdout).workspace).toBe(path.resolve(workspace));
  });

  it("reports workspace resolution source precedence", () => {
    const userWorkspace = initializedWorkspace();
    const localWorkspace = initializedWorkspace();
    const envWorkspace = initializedWorkspace();
    const explicitWorkspace = initializedWorkspace();
    const configPath = createTempConfigPath();
    const nested = path.join(localWorkspace, "projects", "nested");
    mkdirSync(nested, { recursive: true });

    expect(runCli(["config", "set", "defaultWorkspace", userWorkspace], {}, { configPath }).status).toBe(0);

    const user = parseJson(runCli(["workspace", "resolve", "--json"], {}, { configPath }).stdout);
    expect(user.data.source).toBe("user config");
    expect(user.data.workspacePath).toBe(path.resolve(userWorkspace));

    const local = parseJson(runCli(["workspace", "resolve", "--json"], {}, { configPath, cwd: nested }).stdout);
    expect(local.data.source).toBe("local marker");
    expect(local.data.workspacePath).toBe(realpathSync(localWorkspace));

    const env = parseJson(runCli(["workspace", "resolve", "--json"], { ARCADIA_WORKSPACE: envWorkspace }, { configPath, cwd: nested }).stdout);
    expect(env.data.source).toBe("environment variable");
    expect(env.data.workspacePath).toBe(path.resolve(envWorkspace));

    const explicit = parseJson(
      runCli(
        ["workspace", "resolve", "--workspace", explicitWorkspace, "--json"],
        { ARCADIA_WORKSPACE: envWorkspace },
        { configPath, cwd: nested }
      ).stdout
    );
    expect(explicit.data.source).toBe("flag");
    expect(explicit.data.workspacePath).toBe(path.resolve(explicitWorkspace));
  }, 20_000);

  it("imports projects with JSON output", () => {
    const workspace = initializedWorkspace();

    const result = runCli([
      "project",
      "import",
      "--workspace",
      workspace,
      "--name",
      "Rebuster",
      "--mission",
      "Help users turn product evidence into better shipping decisions.",
      "--outcome",
      "Ship Pinterest support.",
      "--milestone",
      "Pinterest publishing support",
      "--next-action",
      "Define Pinterest posting support boundaries.",
      "--responsibility",
      "codex",
      "--expected-artifact",
      "Pinterest implementation plan",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.import");
    expect(json.data.project.name).toBe("Rebuster");
    expect(json.data.project.status).toBe("active");
    expect(json.data.project.goal).toBe("Ship Pinterest support.");
    expect(json.data.project.outcome).toBe("Ship Pinterest support.");
    expect(json.data.milestone.title).toBe("Pinterest publishing support");
    expect(json.data.workItem.next_action).toBe("Define Pinterest posting support boundaries.");
    expect(json.data.workItem.work_classification).toBe("codex");
    expect(json.data.workItem.responsibility).toBe("codex");
  });

  it("keeps legacy project goal and classification flags working", () => {
    const workspace = initializedWorkspace();

    const result = runCli([
      "project",
      "import",
      "--workspace",
      workspace,
      "--name",
      "Legacy Flags",
      "--mission",
      "Keep old automation working.",
      "--goal",
      "Accept legacy project goal input.",
      "--milestone",
      "Compatibility",
      "--next-action",
      "Run compatibility smoke.",
      "--classification",
      "autonomous",
      "--json"
    ]);

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.data.project.goal).toBe("Accept legacy project goal input.");
    expect(json.data.project.outcome).toBe("Accept legacy project goal input.");
    expect(json.data.workItem.work_classification).toBe("autonomous");
    expect(json.data.workItem.responsibility).toBe("autonomous");
  });

  it("rejects conflicting canonical and legacy semantic flags", () => {
    const workspace = initializedWorkspace();

    const outcomeConflict = runCli([
      "project",
      "update",
      createProject(workspace).project.id,
      "--workspace",
      workspace,
      "--goal",
      "Legacy",
      "--outcome",
      "Canonical",
      "--json"
    ]);
    expect(outcomeConflict.status).toBe(2);
    expect(parseJson(outcomeConflict.stderr).error.message).toContain("Use only one of --goal or --outcome.");

    const responsibilityConflict = runCli([
      "work",
      "update",
      createProject(workspace).workItem.id,
      "--workspace",
      workspace,
      "--classification",
      "codex",
      "--responsibility",
      "autonomous",
      "--json"
    ]);
    expect(responsibilityConflict.status).toBe(2);
    expect(parseJson(responsibilityConflict.stderr).error.message).toContain(
      "Use only one of --classification or --responsibility."
    );
  });

  it("creates a project when the workspace is supplied as the second positional argument", () => {
    const workspace = initializedWorkspace();

    const result = runCli(["project", "create", "Boring Defaults", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.create");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.project.name).toBe("Boring Defaults");
    expect(json.data.projectPath).toBe(path.join(path.resolve(workspace), "projects", "boring-defaults"));
    expect(existsSync(path.join(path.resolve(workspace), "projects", "boring-defaults", "PROJECT.md"))).toBe(true);
  });

  it("emits a usage error for project create when no workspace is configured", () => {
    const projectPath = createTempWorkspacePath();

    const result = runCli(["project", "create", "Boring Defaults", projectPath, "--json"]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.error.code).toBe("USAGE_ERROR");
    expect(json.error.message).toContain("Arcadia workspace is not configured.");
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

  it("updates project outcome with canonical alias", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);

    const result = runCli([
      "project",
      "update",
      created.project.id,
      "--workspace",
      workspace,
      "--outcome",
      "Ship canonical language.",
      "--json"
    ]);

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.data.updated).toEqual(["goal"]);
    expect(json.data.project.goal).toBe("Ship canonical language.");
    expect(json.data.project.outcome).toBe("Ship canonical language.");
  });

  it("upserts project metadata with JSON output", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);

    const result = runCli([
      "project",
      "metadata",
      created.project.id,
      "--workspace",
      workspace,
      "--alias",
      "Rebuster",
      "--alias",
      "rebuster app",
      "--repo-path",
      "/Users/pmark/Dev/MR/Rebuster/rebuster",
      "--status-summary",
      "Active product repository with posting automation work in scope.",
      "--validation-command",
      "pnpm test",
      "--validation-command",
      "pnpm lint",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("project.metadata");
    expect(json.data.metadata.project_id).toBe(created.project.id);
    expect(JSON.parse(json.data.metadata.aliases)).toEqual(["Rebuster", "rebuster app"]);
    expect(json.data.metadata.repo_path).toBe("/Users/pmark/Dev/MR/Rebuster/rebuster");
    expect(JSON.parse(json.data.metadata.validation_commands)).toEqual(["pnpm test", "pnpm lint"]);

    const metadata = withDatabase(workspace, (db) => getProjectMetadata(db, created.project.id));
    expect(metadata?.status_summary).toBe("Active product repository with posting automation work in scope.");
  });

  it("sets up Arcadia project context by --repo and by project metadata", () => {
    const repo = createTempRepo();
    writeFileSync(path.join(repo, "package.json"), JSON.stringify({
      scripts: {
        test: "vitest run",
        deploy: "platform deploy"
      },
      dependencies: {
        react: "^19.0.0"
      },
      devDependencies: {
        vitest: "^4.0.0"
      }
    }, null, 2), "utf8");
    writeFileSync(path.join(repo, "pnpm-lock.yaml"), "", "utf8");
    mkdirSync(path.join(repo, "src"));
    mkdirSync(path.join(repo, "tests"));
    writeFileSync(path.join(repo, "src", "index.ts"), "export const ok = true;\n", "utf8");
    writeFileSync(path.join(repo, "README.md"), "# Fixture\n", "utf8");

    const byRepo = runCli(["project", "setup-context", "--repo", repo, "--json"]);

    expect(byRepo.status).toBe(0);
    expect(byRepo.stderr).toBe("");
    const repoJson = parseJson(byRepo.stdout);
    expect(repoJson.command).toBe("project.setup-context");
    expect(repoJson.workspace).toBeUndefined();
    expect(repoJson.data.repoPath).toBe(realpathSync(repo));
    expect(existsSync(path.join(repo, ".arcadia", "AGENT_CONTEXT_POLICY.md"))).toBe(true);
    expect(existsSync(path.join(repo, ".arcadia", "repo-context.md"))).toBe(true);
    expect(existsSync(path.join(repo, ".arcadia", "context-policy.json"))).toBe(true);
    expect(readFileSync(path.join(repo, "AGENTS.md"), "utf8")).toContain("<!-- ARCADIA_CONTEXT_START -->");

    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    withDatabase(workspace, (db) =>
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: ["fixture alias"],
        repoPath: repo,
        statusSummary: "Fixture repo.",
        validationCommands: ["pnpm test"]
      })
    );

    const byProject = runCli(["project", "setup-context", "fixture alias", "--workspace", workspace, "--json"]);

    expect(byProject.status).toBe(0);
    expect(byProject.stderr).toBe("");
    const projectJson = parseJson(byProject.stdout);
    expect(projectJson.workspace).toBe(path.resolve(workspace));
    expect(projectJson.data.project).toMatchObject({ id: created.project.id, name: created.project.name });
    expect(projectJson.data.context.safe_commands).toContain("pnpm test");
    expect(projectJson.data.context.safe_commands).not.toContain("pnpm deploy");

    const agents = readFileSync(path.join(repo, "AGENTS.md"), "utf8");
    expect(agents.match(/ARCADIA_CONTEXT_START/g)).toHaveLength(1);
    expect(agents.match(/ARCADIA_CONTEXT_END/g)).toHaveLength(1);
    const policy = JSON.parse(readFileSync(path.join(repo, ".arcadia", "context-policy.json"), "utf8"));
    expect(policy).toMatchObject({
      source_roots: ["src"],
      test_roots: ["tests"],
      broad_scan_allowed: false,
      max_discovery_commands: 6
    });
    expect(policy.denied_context_paths).toContain("node_modules/");
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

  it("lists milestones with JSON output", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const createResult = runCli([
      "milestone",
      "create",
      created.project.id,
      "--workspace",
      workspace,
      "--title",
      "Completed milestone",
      "--json"
    ]);
    const milestoneId = parseJson(createResult.stdout).data.milestone.id;
    const completeResult = runCli(["milestone", "complete", milestoneId, "--workspace", workspace, "--json"]);
    expect(completeResult.status).toBe(0);

    const result = runCli(["milestone", "list", "--workspace", workspace, "--status", "completed", "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("milestone.list");
    expect(json.data.milestones).toHaveLength(1);
    expect(json.data.milestones[0].id).toBe(milestoneId);
    expect(json.data.milestones[0].project_name).toBe("CLI Fixture Project");
    expect(json.data.milestones[0].status).toBe("completed");
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
    expect(json.data.queues.blocked).toEqual([]);
  });

  it("emits JSON success for dashboard snapshots", () => {
    const workspace = initializedWorkspace();
    createProject(workspace);
    const result = runCli(["dashboard", "snapshot", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("dashboard.snapshot");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.snapshot.counts.activeProjects).toBe(1);
    expect(json.data.snapshot.projects[0].lastArtifact.title).toBe("CLI Fixture Artifact");
    expect(json.artifacts).toEqual([]);
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

  it("captures, plans, runs, and shows deterministic execution work", () => {
    const workspace = initializedWorkspace();

    const captureResult = runCli([
      "capture",
      "--workspace",
      workspace,
      "--text",
      "Generate status report",
      "--json"
    ]);
    expect(captureResult.status).toBe(0);
    expect(captureResult.stderr).toBe("");
    const captureJson = parseJson(captureResult.stdout);
    expect(captureJson.ok).toBe(true);
    expect(captureJson.command).toBe("capture");
    expect(captureJson.data.workItem.queue).toBe("work_queue");
    expect(captureJson.data.workItem.work_classification).toBe("autonomous");
    expect(captureJson.data.matchedSkillName).toBe("generate_status_report");

    const workId = captureJson.data.workItem.id;
    const planResult = runCli(["work", "plan", workId, "--workspace", workspace, "--json"]);
    expect(planResult.status).toBe(0);
    const planJson = parseJson(planResult.stdout);
    expect(planJson.ok).toBe(true);
    expect(planJson.command).toBe("work.plan");
    expect(planJson.data.plan.steps[0].skill_name).toBe("generate_status_report");

    const runResult = runCli(["work", "run", workId, "--workspace", workspace, "--plan", planJson.data.plan.id, "--json"]);
    expect(runResult.status).toBe(0);
    const runJson = parseJson(runResult.stdout);
    expect(runJson.ok).toBe(true);
    expect(runJson.command).toBe("work.run");
    expect(runJson.data.run.status).toBe("completed");
    expect(runJson.data.missionLogPath).toMatch(/^mission_logs\//);
    expect(existsSync(path.join(workspace, runJson.data.missionLogPath))).toBe(true);
    expect(existsSync(path.join(workspace, "reports", "status.md"))).toBe(true);

    const showResult = runCli(["run", "show", runJson.data.run.id, "--workspace", workspace, "--json"]);
    expect(showResult.status).toBe(0);
    const showJson = parseJson(showResult.stdout);
    expect(showJson.ok).toBe(true);
    expect(showJson.command).toBe("run.show");
    expect(showJson.data.run.id).toBe(runJson.data.run.id);
    expect(showJson.data.needsOperator).toEqual([]);

    const listResult = runCli(["run", "list", "--workspace", workspace, "--limit", "5", "--json"]);
    expect(listResult.status).toBe(0);
    const listJson = parseJson(listResult.stdout);
    expect(listJson.ok).toBe(true);
    expect(listJson.command).toBe("run.list");
    expect(listJson.data.runs).toHaveLength(1);
    expect(listJson.data.runs[0].id).toBe(runJson.data.run.id);
    expect(listJson.data.runs[0].work_item_title).toBe("Generate status report");
  }, 20_000);

  it("asks natural language intent with JSON output", () => {
    const workspace = initializedWorkspace();

    const result = runCli([
      "ask",
      "Create a new blog site named MartianRover Field Notes.",
      "--workspace",
      workspace,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("ask");
    expect(json.data.intake.resolvedIntent).toBe("InstantiateProject");
    expect(json.data.resolvedIntent.intentId).toBe("InstantiateProject");
    expect(json.data.result.status).toBe("requires_review");
    expect(json.data.reviewItemId).toMatch(/^review_/);
    expect(json.data.workItem).toBeNull();
    expect(json.data.plan).toBeNull();
    expect(json.data.codexInvocations).toHaveLength(0);
  });

  it("emits JSON success for ingress dry-run", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "ingress",
      "process",
      "--workspace",
      workspace,
      "--source",
      `cliDryRun${Date.now()}`,
      "--dry-run",
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("ingress.process");
    expect(json.workspace).toBe(path.resolve(workspace));
    expect(json.data.dryRun).toBe(true);
    expect(json.data.counts.discovered).toBe(0);
  });

  it("pauses captured ambiguous work as Requires Review", () => {
    const workspace = initializedWorkspace();

    const captureResult = runCli([
      "capture",
      "--workspace",
      workspace,
      "--text",
      "Improve Rebuster candidate review flow",
      "--json"
    ]);
    expect(captureResult.status).toBe(0);
    const captureJson = parseJson(captureResult.stdout);
    expect(captureJson.data.workItem.queue).toBe("requires_review");
    expect(captureJson.data.workItem.work_classification).toBe("requires_review");

    const runResult = runCli(["work", "run", captureJson.data.workItem.id, "--workspace", workspace, "--json"]);
    expect(runResult.status).toBe(0);
    const runJson = parseJson(runResult.stdout);
    expect(runJson.data.run.status).toBe("requires_review");
    expect(runJson.data.run.steps[0].status).toBe("requires_review");
  });

  it("queues an execution run when review is approved with --execute", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const { reviewId } = createExecutableReview(workspace, repo);
    mkdirSync(path.join(repo, ".arcadia"), { recursive: true });
    writeFileSync(path.join(repo, ".arcadia", "context-policy.json"), JSON.stringify({ denied_context_paths: ["node_modules/"] }), "utf8");
    writeFileSync(path.join(repo, ".arcadia", "repo-context.md"), "Repo guidance from Arcadia.\n", "utf8");

    const result = runCli([
      "review",
      "approve",
      reviewId,
      "--workspace",
      workspace,
      "--executor",
      "codex",
      "--json"
    ]);

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.data.result.status).toBe("pending_execution");
    expect(json.data.approval).toBeNull();
    expect(json.data.execution).toBeNull();
    expect(json.data.run).toMatchObject({ id: expect.stringContaining("run_") });
  });

  it("worker executes a queued run with built-in Codex adapter and creates follow-up review", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const fakeBin = fakeExecutorBin(["codex"]);
    const { reviewId } = createExecutableReview(workspace, repo);
    mkdirSync(path.join(repo, ".arcadia"), { recursive: true });
    writeFileSync(path.join(repo, ".arcadia", "context-policy.json"), JSON.stringify({ denied_context_paths: ["node_modules/"] }), "utf8");
    writeFileSync(path.join(repo, ".arcadia", "repo-context.md"), "Repo guidance from Arcadia.\n", "utf8");

    const prevPath = process.env["PATH"];
    process.env["PATH"] = `${fakeBin}${path.delimiter}${prevPath ?? ""}`;
    try {
      const result = withDatabase(workspace, (db) =>
        executeApprovedReview(db, { workspace, reviewId, executorName: "codex" })
      );

      expect(result.executor).toBe("codex");
      expect(result.changedFiles).toContain("tracked.txt");
      expect(result.validation[0]).toMatchObject({ command: "test -f tracked.txt", exitStatus: 0 });
      expect(existsSync(result.metadataPath)).toBe(true);

      const prompt = readFileSync(path.join(path.dirname(result.metadataPath), "prompt.md"), "utf8");
      expect(prompt).toContain("Safe implementation mode:");
      expect(prompt).toContain("context-policy.json");
      expect(prompt).toContain("Repo guidance from Arcadia.");

      withDatabase(workspace, (db) => {
        expect(getReviewItem(db, reviewId)?.status).toBe("approved");
        const open = listActionableReviewItems(db);
        expect(open.map((item) => item.id)).toContain(result.followUpReview.id);
        expect(getReviewItem(db, result.followUpReview.id)?.proposed_action).toContain("Executor codex finished");
      });
    } finally {
      process.env["PATH"] = prevPath;
    }
  });

  it("leaves an actionable execution review when approval explicitly skips execution", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const { reviewId } = createExecutableReview(workspace, repo);

    const result = runCli([
      "review",
      "approve",
      reviewId,
      "--workspace",
      workspace,
      "--no-execute",
      "--json"
    ]);

    expect(result.status, result.stderr).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.data.execution).toBeNull();
    expect(json.warnings[0]).toContain("Execution was not run");

    withDatabase(workspace, (db) => {
      const pending = listActionableReviewItems(db).find((item) => item.resolved_intent === "ReviewExecutionPending");
      expect(pending?.proposed_action).toContain(`review approve ${json.data.item.slug} --execute`);
      expect(pending?.context_json).toContain(reviewId);
    });
  });

  it("provides Claude Code and Gemini built-in adapters", () => {
    for (const executor of ["claude-code", "gemini"] as const) {
      const workspace = initializedWorkspace();
      const repo = initializedGitRepo();
      const fakeBin = fakeExecutorBin(["claude", "gemini"]);
      const { reviewId } = createExecutableReview(workspace, repo);

      const prevPath = process.env["PATH"];
      process.env["PATH"] = `${fakeBin}${path.delimiter}${prevPath ?? ""}`;
      try {
        const result = withDatabase(workspace, (db) =>
          executeApprovedReview(db, { workspace, reviewId, executorName: executor })
        );
        expect(result.executor).toBe(executor);
        expect(result.changedFiles).toContain("tracked.txt");
      } finally {
        process.env["PATH"] = prevPath;
      }
    }
  });

  it("supports custom executor config for Aider or OpenCode style CLIs", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const fakeBin = fakeExecutorBin(["aider"]);
    const { reviewId } = createExecutableReview(workspace, repo);
    const configPath = path.join(workspace, "config", "arcadia.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.executors = [
      {
        name: "aider",
        commandTemplate: "aider",
        args: ["--message-file", "{promptFile}"],
        promptMode: "prompt-file",
        workingDirectory: "repo",
        outputCapture: "combined",
        finalOutputFilePath: ".arcadia/final-output.md",
        timeoutMs: 30000,
        environmentAllowlist: ["PATH"]
      }
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    mkdirSync(path.join(repo, ".arcadia"), { recursive: true });

    const prevPath = process.env["PATH"];
    process.env["PATH"] = `${fakeBin}${path.delimiter}${prevPath ?? ""}`;
    try {
      const result = withDatabase(workspace, (db) =>
        executeApprovedReview(db, { workspace, reviewId, executorName: "aider" })
      );
      expect(result.executor).toBe("aider");
      expect(result.finalOutput).toContain("final from aider");
    } finally {
      process.env["PATH"] = prevPath;
    }
  });

  it("refuses execution when the project repo path is invalid", () => {
    const workspace = initializedWorkspace();
    const { reviewId } = createExecutableReview(workspace, path.join(tmpdir(), `arcadia-missing-repo-${Date.now()}`));

    const result = runCli([
      "review",
      "approve",
      reviewId,
      "--workspace",
      workspace,
      "--execute",
      "--json"
    ]);

    expect(result.status).not.toBe(0);
    const json = parseJson(result.stderr);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toContain("repository path is missing or invalid");
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

  it("creates an artifact linked to a project and Action with JSON output", () => {
    const workspace = initializedWorkspace();
    const created = createProject(workspace);
    const workItem = importWorkItem(workspace, {
      title: "Link this artifact",
      queue: "work_queue",
      classification: "codex",
      nextAction: "Produce the artifact"
    });

    const result = runCli([
      "artifact",
      "create",
      "--workspace",
      workspace,
      "--title",
      "New CLI Artifact",
      "--type",
      "document",
      "--status",
      "drafted",
      "--path",
      "artifacts/new-cli-artifact.md",
      "--project",
      created.project.id,
      "--work-item",
      workItem.id,
      "--json"
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("artifact.create");
    expect(json.data.artifact.title).toBe("New CLI Artifact");
    expect(json.data.artifact.artifact_type).toBe("document");
    expect(json.data.artifact.status).toBe("drafted");
    expect(json.data.artifact.path).toBe("artifacts/new-cli-artifact.md");
    expect(json.data.artifact.project_id).toBe(created.project.id);
    expect(json.data.artifact.work_item_id).toBe(workItem.id);

    const listed = parseJson(runCli(["artifact", "list", "--workspace", workspace, "--json"]).stdout);
    expect(listed.data.artifacts.some((artifact: { id: string }) => artifact.id === json.data.artifact.id)).toBe(true);
  });

  it("emits stable JSON for artifact create with an unknown project", () => {
    const workspace = initializedWorkspace();

    const result = runCli([
      "artifact",
      "create",
      "--workspace",
      workspace,
      "--title",
      "Orphan Artifact",
      "--type",
      "document",
      "--project",
      "project_missing",
      "--json"
    ]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("artifact.create");
    expect(json.error.code).toBe("PROJECT_NOT_FOUND");
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
    expect(json.data.workItem.responsibility).toBe("codex");
    expect(json.data.workItem.next_action).toBe("Implement the update");
    expect(json.data.workItem.status).toBe("in_progress");
  });

  it("round-trips --expected-artifact on work update, including clearing it", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Set an expected artifact",
      queue: "work_queue",
      classification: "codex",
      nextAction: "Produce the artifact"
    });

    const set = parseJson(runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--expected-artifact",
      "A published CLI Phase 1 write-up",
      "--json"
    ]).stdout);

    expect(set.ok).toBe(true);
    expect(set.data.updated).toEqual(["expectedArtifact"]);
    expect(set.data.workItem.expected_artifact).toBe("A published CLI Phase 1 write-up");

    const cleared = parseJson(runCli([
      "work",
      "update",
      workItem.id,
      "--workspace",
      workspace,
      "--expected-artifact",
      "none",
      "--json"
    ]).stdout);

    expect(cleared.ok).toBe(true);
    expect(cleared.data.workItem.expected_artifact).toBeNull();
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

  it("emits stable JSON for weekly review date validation errors", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "review",
      "weekly",
      "--workspace",
      workspace,
      "--since",
      "2026-06-10",
      "--until",
      "2026-06-09",
      "--json"
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Review window since date must be on or before until date.");
    expect(json.error.details).toEqual({ since: "2026-06-10", until: "2026-06-09" });
  });

  it("emits stable JSON for malformed weekly review dates", () => {
    const workspace = initializedWorkspace();
    const result = runCli([
      "review",
      "weekly",
      "--workspace",
      workspace,
      "--since",
      "2026-02-30",
      "--json"
    ]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details).toEqual({ field: "since", value: "2026-02-30" });
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

  it("emits stable JSON for duplicate project imports", () => {
    const workspace = initializedWorkspace();
    createProject(workspace);

    const result = runCli([
      "project",
      "import",
      "--workspace",
      workspace,
      "--name",
      "CLI Fixture Project",
      "--mission",
      "Support CLI tests.",
      "--milestone",
      "Initial milestone",
      "--next-action",
      "Exercise the CLI",
      "--classification",
      "codex",
      "--json"
    ]);

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("project.import");
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.message).toBe("Project already exists.");
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
    expect(json.error.message).toContain("Action status must be one of");
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
    expect(json.error.details.fields).toEqual([
      "queue",
      "classification",
      "nextAction",
      "status",
      "effort",
      "expectedArtifact"
    ]);
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

  it("defaults status to the current directory workspace", () => {
    const workspace = initializedWorkspace();
    const result = runCli(["status", "--json"], {}, { cwd: workspace });

    expect(result.status).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("status");
    expect(json.workspace).toBe(realpathSync(workspace));
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

  it("emits stable JSON for weekly review missing workspaces", () => {
    const missingWorkspace = path.join(tmpdir(), `arcadia-missing-review-${Date.now()}`);
    const result = runCli(["review", "weekly", "--workspace", missingWorkspace, "--json"]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.workspace).toBe(path.resolve(missingWorkspace));
    expect(json.error.code).toBe("WORKSPACE_NOT_FOUND");
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

  it("emits stable JSON for weekly review uninitialized databases", () => {
    const workspace = createTempWorkspacePath();
    mkdirSync(workspace, { recursive: true });
    const result = runCli(["review", "weekly", "--workspace", workspace, "--json"]);

    expect(result.status).toBe(3);
    const json = parseJson(result.stderr);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("review.weekly");
    expect(json.error.code).toBe("DATABASE_NOT_INITIALIZED");
  });

  it("emits stable human errors without stack traces", () => {
    const result = runCli(["status", "--workspace", path.join(tmpdir(), "arcadia-nope")]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("Error [WORKSPACE_NOT_FOUND]: Workspace not found.");
    expect(result.stderr).not.toContain("at ");
  });

  it("emits a helpful missing workspace error", () => {
    const result = runCli(["status", "--json"], {}, { configPath: createTempConfigPath() });

    expect(result.status).toBe(2);
    const json = parseJson(result.stderr);
    expect(json.error.code).toBe("USAGE_ERROR");
    expect(json.error.message).toContain("arcadia config set defaultWorkspace <path>");
  });
});

function runCli(
  args: string[],
  env: Record<string, string> = {},
  options: { configPath?: string; cwd?: string } = {}
) {
  const { ARCADIA_WORKSPACE: _arcadiaWorkspace, ...baseEnv } = process.env;
  return spawnSync(tsxBin, [path.join(repoRoot, "src", "cli.ts"), ...args], {
    cwd: options.cwd ?? repoRoot,
    env: { ...baseEnv, ARCADIA_CONFIG_PATH: options.configPath ?? createTempConfigPath(), ...env },
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

function createTempConfigPath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-cli-config-"));
  workspaces.push(directory);
  return path.join(directory, "config.json");
}

function createTempRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-repo-test-"));
  workspaces.push(repo);
  return repo;
}

function initializedGitRepo(): string {
  const repo = createTempRepo();
  writeFileSync(path.join(repo, "tracked.txt"), "initial\n", "utf8");
  spawnSync("git", ["init"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "arcadia@example.test"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "Arcadia Test"], { cwd: repo });
  spawnSync("git", ["add", "tracked.txt"], { cwd: repo });
  spawnSync("git", ["commit", "-m", "initial"], { cwd: repo });
  return repo;
}

function fakeExecutorBin(names: string[]): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-fake-executors-"));
  workspaces.push(directory);
  for (const name of names) {
    const scriptPath = path.join(directory, name);
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "name=$(basename \"$0\")",
        "cat >/dev/null",
        "printf '\\nchanged by %s\\n' \"$name\" >> tracked.txt",
        "mkdir -p .arcadia",
        "printf 'final from %s\\n' \"$name\" > .arcadia/final-output.md",
        "printf 'executor %s complete\\n' \"$name\""
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 }
    );
  }
  return directory;
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

function createExecutableReview(workspace: string, repoPath: string) {
  return withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: `Executor Fixture ${Date.now()} ${Math.random()}`,
      mission: "Exercise review execution.",
      status: "active",
      currentMilestone: "Execution milestone",
      nextAction: "Review the executor output",
      expectedArtifact: "Review execution artifact",
      workClassification: "codex"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      aliases: [],
      repoPath,
      statusSummary: "Executor fixture repository.",
      validationCommands: ["test -f tracked.txt"]
    });
    const review = createReviewItem(db, {
      workItemId: created.workItem.id,
      projectId: created.project.id,
      decisionNeeded: "Approve implementation.",
      recommendation: "Execute in safe implementation mode.",
      sourceInput: "Implement a small tracked-file change.",
      proposedAction: "Modify tracked.txt only.",
      resolvedIntent: "ExecutionRequest",
      confidenceLabel: "high",
      confidence: 0.99
    });
    return { projectId: created.project.id, workItemId: created.workItem.id, reviewId: review.id };
  });
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
