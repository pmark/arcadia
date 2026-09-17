import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { getProjectMetadata, getReviewItem, listActionableReviewItems, upsertProjectMetadata } from "../src/db/repositories.js";
import { executeApprovedReview } from "../src/execution/reviewExecutor.js";
import { createExecutableReview, createNeutralCwd, createProject, createTempRepo, createTempWorkspacePath, fakeExecutorBin, importWorkItem, initializedGitRepo, initializedWorkspace, parseJson, runCli, cleanupTrackedPaths } from "./cli-response-fixture.js";

afterEach(cleanupTrackedPaths);

describe("CLI response contract — execution and review", () => {
  it("emits a usage error for project create when no workspace is configured", () => {
    const projectPath = createTempWorkspacePath();

    // Workspace discovery includes repository-local markers, independently of user config.
    const result = runCli(
      ["project", "create", "Boring Defaults", projectPath, "--json"],
      {},
      { cwd: createNeutralCwd() }
    );

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

    const byRepo = runCli(
      ["project", "setup-context", "--repo", repo, "--json"],
      {},
      { cwd: createNeutralCwd() }
    );

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
  }, 45_000);

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
      classification: "agent",
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
      "agent",
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
    expect(json.data.workItem.work_classification).toBe("agent");
    expect(json.data.workItem.responsibility).toBe("agent");
    expect(json.data.workItem.next_action).toBe("Implement the update");
    expect(json.data.workItem.status).toBe("in_progress");
  });

  it("round-trips --expected-artifact on work update, including clearing it", () => {
    const workspace = initializedWorkspace();
    const workItem = importWorkItem(workspace, {
      title: "Set an expected artifact",
      queue: "work_queue",
      classification: "agent",
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

});
