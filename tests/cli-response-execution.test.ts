import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, withDatabase } from "../src/db/connection.js";
import { captureAskEnvelope } from "../src/ask/captureEnvelope.js";
import { claimNextPendingRun, createAskRequest, createProjectWithInitialWork, createReviewItem, getExecutionRun, getProjectMetadata, getReviewItem, getWorkItem, listActionableReviewItems, updateExecutionRunStatus, upsertProjectMetadata } from "../src/db/repositories.js";
import { executeApprovedReview } from "../src/execution/reviewExecutor.js";
import { approvedReviewScopeSha256 } from "../src/execution/approvedReviewScope.js";
import { runAskCommand } from "../src/commands/ask.js";
import { renderAskTrailSuccess, runAskShowCommand } from "../src/commands/askTrail.js";
import { runReviewApproveCommand, runReviewDeferCommand, runReviewRejectCommand } from "../src/commands/review.js";
import { createExecutableReview, createNeutralCwd, createProject, createTempRepo, createTempWorkspacePath, fakeExecutorBin, importWorkItem, initializedGitRepo, initializedWorkspace, parseJson, runCli, cleanupTrackedPaths } from "./cli-response-fixture.js";

afterEach(cleanupTrackedPaths);

describe("CLI response contract — execution and review", () => {
  it("does not recommend approval recovery for partial rejection or deferral", () => {
    for (const disposition of ["reject", "defer"] as const) {
      const workspace = initializedWorkspace();
      const repo = initializedGitRepo();
      const { reviewId } = createExecutableReview(workspace, repo);
      const capture = withDatabase(workspace, (db) => captureAskEnvelope(db, {
        requestId: `partial-${disposition}`,
        originalText: `${disposition} ${reviewId}`,
        ingressSource: "ask"
      }));
      withDatabase(workspace, (db) => db.prepare(
        "UPDATE ask_capture_envelopes SET status = 'partial', related_review_id = ? WHERE id = ?"
      ).run(reviewId, capture.id));
      if (disposition === "reject") runReviewRejectCommand({ workspace, id: reviewId });
      else runReviewDeferCommand({ workspace, id: reviewId });
      const shown = runAskShowCommand({ workspace, id: capture.requestId });
      const text = renderAskTrailSuccess(shown).join("\n");
      expect(text).not.toContain(`arcadia review approve ${reviewId} --execute`);
      expect(text).toContain("original reply");
    }
  });

  it("keeps an earlier approval claim from overriding a captured reject or defer reply", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const project = createProject(workspace);
    withDatabase(workspace, (db) => upsertProjectMetadata(db, {
      projectId: project.project.id,
      aliases: ["CLI Fixture Project"],
      repoPath: repo,
      statusSummary: "Fixture repo.",
      validationCommands: ["test -f HelloWorld.txt"]
    }));
    const sourceInput = 'Implement HelloWorld.txt in CLI Fixture Project, containing exactly the bytes "Hello World!\\n". Change no other project files.';
    const reviewId = withDatabase(workspace, (db) => {
      const ask = createAskRequest(db, {
        rawRequest: sourceInput,
        resolvedIntent: "CreateWork",
        registryVersion: 1,
        outputKind: "requires_review",
        status: "requires_review"
      });
      return createReviewItem(db, {
        askRequestId: ask.id,
        projectId: project.project.id,
        decisionNeeded: "Approve this scoped Action.",
        recommendation: "Approve the exact requested file.",
        sourceInput,
        proposedAction: sourceInput,
        resolvedIntent: "CreateWork",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      }).id;
    });
    withDatabase(workspace, (db) => db.exec(
      "CREATE TRIGGER refuse_claim_run BEFORE INSERT ON execution_runs BEGIN SELECT RAISE(ABORT, 'claim run refused'); END"
    ));
    expect(() => runReviewApproveCommand({ workspace, id: reviewId, execute: true, executor: "codex" })).toThrow(/claim run refused/);
    withDatabase(workspace, (db) => db.exec("DROP TRIGGER refuse_claim_run"));
    const claim = withDatabase(workspace, (db) => db.prepare(
      "SELECT work_item_id, plan_id FROM review_approval_claims WHERE review_item_id = ?"
    ).get(reviewId) as { work_item_id: string; plan_id: string } | undefined);
    expect(claim?.work_item_id).toBeTruthy();
    expect(claim?.plan_id).toBeTruthy();

    for (const disposition of ["reject", "defer"] as const) {
      const nextStatus = disposition === "reject" ? "rejected" : "deferred";
      const triggerName = `refuse_${disposition}_before_resolve`;
      withDatabase(workspace, (db) => db.exec(
        `CREATE TRIGGER ${triggerName} BEFORE UPDATE OF status ON review_items WHEN NEW.id = '${reviewId}' AND NEW.status = '${nextStatus}' BEGIN SELECT RAISE(ABORT, '${disposition} blocked before resolver'); END`
      ));
      const requestId = `partial-${disposition}-with-claim`;
      expect(() => runAskCommand({
        workspace,
        request: `${disposition} ${reviewId}`,
        requestId,
        adapterMetadata: { reviewId }
      })).toThrow(`${disposition} blocked before resolver`);
      withDatabase(workspace, (db) => db.exec(`DROP TRIGGER ${triggerName}`));
      const shown = runAskShowCommand({ workspace, id: requestId });
      expect(shown.data.capture).toMatchObject({ status: "partial", relatedReviewId: reviewId });
      expect(shown.data.capture?.outcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "approval_claim", id: reviewId }),
        expect.objectContaining({ kind: "action", id: claim?.work_item_id }),
        expect.objectContaining({ kind: "plan", id: claim?.plan_id })
      ]));
      expect(withDatabase(workspace, (db) => getReviewItem(db, reviewId))).toMatchObject({ status: "open" });
      const trailText = renderAskTrailSuccess(shown).join("\n");
      expect(trailText).toContain("existing approval claim");
      expect(trailText).not.toContain(`arcadia review approve ${reviewId} --execute`);
      expect(withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM execution_runs").get() as { n: number }).n).toBe(0);
    }
  });

  it("pins explicit Project routing to the request id and shows the original Project on replay", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const projects = withDatabase(workspace, (db) => ["Route Project A", "Route Project B"].map((name) =>
      createProjectWithInitialWork(db, {
        name,
        mission: "Exercise capture routing identity.",
        status: "active",
        currentMilestone: "Routing milestone",
        nextAction: "Check routed request",
        expectedArtifact: "Routing evidence",
        workClassification: "agent"
      }).project
    ));
    for (const project of projects) withDatabase(workspace, (db) => upsertProjectMetadata(db, {
      projectId: project.id,
      aliases: [project.name],
      repoPath: repo,
      statusSummary: `${project.name} fixture repo.`,
      validationCommands: ["test -f HelloWorld.txt"]
    }));
    const request = 'Implement HelloWorld.txt, containing exactly the bytes "Hello World!\\n".';
    const first = runAskCommand({ workspace, project: projects[0].name, request, requestId: "explicit-route-pin" });
    const originalReview = withDatabase(workspace, (db) => getReviewItem(db, first.data.reviewItemId as string));
    expect(originalReview?.project_id).toBe(projects[0].id);
    const shown = runAskShowCommand({ workspace, id: "explicit-route-pin" });
    expect(renderAskTrailSuccess(shown).join("\n")).toContain(projects[0].name);

    const sameProjectReplay = runAskCommand({ workspace, project: projects[0].name, request, requestId: "explicit-route-pin" });
    expect(sameProjectReplay.data.captureEnvelope.id).toBe(first.data.captureEnvelope.id);
    expect(() => runAskCommand({ workspace, project: projects[1].name, request, requestId: "explicit-route-pin" }))
      .toThrow(/different routing choices/);
    expect(withDatabase(workspace, (db) => getReviewItem(db, first.data.reviewItemId as string)?.project_id)).toBe(projects[0].id);
    const freshRequest = 'Implement Greeting.txt, containing exactly the bytes "Hello!\\n".';
    const freshSameProject = runAskCommand({ workspace, project: projects[0].name, request: freshRequest, requestId: "explicit-route-fresh" });
    expect(freshSameProject.data.captureEnvelope.id).not.toBe(first.data.captureEnvelope.id);
    expect(withDatabase(workspace, (db) => getReviewItem(db, freshSameProject.data.reviewItemId as string)?.project_id)).toBe(projects[0].id);
  });

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
      "/Users/operator/Dev/MR/Rebuster/rebuster",
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
    expect(json.data.metadata.repo_path).toBe("/Users/operator/Dev/MR/Rebuster/rebuster");
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
    const approval = parseJson(runCli(["review", "approve", reviewId, "--workspace", workspace, "--executor", "codex", "--json"]).stdout);
    mkdirSync(path.join(repo, ".arcadia"), { recursive: true });
    writeFileSync(path.join(repo, ".arcadia", "context-policy.json"), JSON.stringify({ denied_context_paths: ["node_modules/"] }), "utf8");
    writeFileSync(path.join(repo, ".arcadia", "repo-context.md"), "Repo guidance from Arcadia.\n", "utf8");

    const prevPath = process.env["PATH"];
    process.env["PATH"] = `${fakeBin}${path.delimiter}${prevPath ?? ""}`;
    try {
      const result = withDatabase(workspace, (db) =>
        executeApprovedReview(db, { workspace, reviewId, executorName: "codex", runId: approval.data.run.id })
      );

      expect(result.executor).toBe("codex");
      expect(result.changedFiles).toContain("tracked.txt");
      expect(result.validation[0]).toMatchObject({ command: "test -f tracked.txt", exitStatus: 0 });
      expect(existsSync(result.metadataPath)).toBe(true);

      const prompt = readFileSync(path.join(path.dirname(result.metadataPath), "prompt.md"), "utf8");
      expect(prompt).toContain("Safe implementation mode:");
      expect(prompt).toContain("context-policy.json");
      expect(prompt).toContain("Repo guidance from Arcadia.");
      expect(prompt).toContain(`Approval receipt: ${approval.data.run.id}`);
      expect(prompt).not.toContain("Decision needed:");
      expect(prompt).not.toContain("Recommendation:");

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

  it("refuses to execute an open review without its queued approval receipt", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const { reviewId } = createExecutableReview(workspace, repo);
    expect(() => withDatabase(workspace, (db) => executeApprovedReview(db, { workspace, reviewId, executorName: "codex" })))
      .toThrow(/current approved Run receipt/);
  });

  it("claims only the explicitly selected pending Run and never claims it twice", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const first = createExecutableReview(workspace, repo);
    const second = createExecutableReview(workspace, repo);
    const firstRunId = parseJson(runCli(["review", "approve", first.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;
    const secondRunId = parseJson(runCli(["review", "approve", second.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;

    withDatabase(workspace, (db) => {
      const selected = claimNextPendingRun(db, 11001, secondRunId);
      expect(selected?.id).toBe(secondRunId);
      expect(getExecutionRun(db, secondRunId)?.status).toBe("running");
      expect(getExecutionRun(db, firstRunId)?.status).toBe("pending_execution");
      expect(claimNextPendingRun(db, 11002, secondRunId)).toBeNull();
      expect(getExecutionRun(db, firstRunId)?.status).toBe("pending_execution");
    });
  });

  it("omitted selector falls back to the legacy oldest-pending FIFO claim", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const older = createExecutableReview(workspace, repo);
    const newer = createExecutableReview(workspace, repo);
    const olderRunId = parseJson(runCli(["review", "approve", older.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;
    const newerRunId = parseJson(runCli(["review", "approve", newer.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;

    withDatabase(workspace, (db) => {
      db.prepare("UPDATE execution_runs SET created_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", olderRunId);
      db.prepare("UPDATE execution_runs SET created_at = ? WHERE id = ?").run("2020-01-02T00:00:00.000Z", newerRunId);

      expect(claimNextPendingRun(db, 21001)?.id).toBe(olderRunId);
      expect(getExecutionRun(db, olderRunId)?.status).toBe("running");
      expect(getExecutionRun(db, newerRunId)?.status).toBe("pending_execution");
    });
  });

  it.each(["", "   ", "\t\n"])(
    "an explicitly supplied blank selector %j returns no claim and never falls back to FIFO (#1404 regression)",
    (blankSelector) => {
      const workspace = initializedWorkspace();
      const repo = initializedGitRepo();
      const fixture = createExecutableReview(workspace, repo);
      const runId = parseJson(runCli(["review", "approve", fixture.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;

      withDatabase(workspace, (db) => {
        const before = getExecutionRun(db, runId);
        expect(claimNextPendingRun(db, 22001, blankSelector)).toBeNull();
        const after = getExecutionRun(db, runId);
        expect(after?.status).toBe("pending_execution");
        expect(after?.pid).toBe(before?.pid);
        expect(after?.updated_at).toBe(before?.updated_at);
      });
    }
  );

  it("an explicitly supplied unknown selector returns no claim without touching unrelated pending Runs", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const fixture = createExecutableReview(workspace, repo);
    const runId = parseJson(runCli(["review", "approve", fixture.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;

    withDatabase(workspace, (db) => {
      const before = getExecutionRun(db, runId);
      expect(claimNextPendingRun(db, 22002, "run_does-not-exist")).toBeNull();
      const after = getExecutionRun(db, runId);
      expect(after?.status).toBe("pending_execution");
      expect(after?.pid).toBe(before?.pid);
      expect(after?.updated_at).toBe(before?.updated_at);
    });
  });

  it.each(["running", "completed", "failed"] as const)(
    "an explicit selector targeting a %s Run returns no claim and leaves it and unrelated Runs unchanged",
    (status) => {
      const workspace = initializedWorkspace();
      const repo = initializedGitRepo();
      const target = createExecutableReview(workspace, repo);
      const unrelated = createExecutableReview(workspace, repo);
      const targetRunId = parseJson(runCli(["review", "approve", target.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;
      const unrelatedRunId = parseJson(runCli(["review", "approve", unrelated.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;

      withDatabase(workspace, (db) => {
        if (status === "running") {
          expect(claimNextPendingRun(db, 23001, targetRunId)?.id).toBe(targetRunId);
        } else {
          updateExecutionRunStatus(db, targetRunId, status, { summary: `forced ${status} for test` });
        }
        const targetBefore = getExecutionRun(db, targetRunId);
        const unrelatedBefore = getExecutionRun(db, unrelatedRunId);

        expect(claimNextPendingRun(db, 23002, targetRunId)).toBeNull();

        const targetAfter = getExecutionRun(db, targetRunId);
        expect(targetAfter?.status).toBe(targetBefore?.status);
        expect(targetAfter?.pid).toBe(targetBefore?.pid);
        expect(targetAfter?.updated_at).toBe(targetBefore?.updated_at);

        const unrelatedAfter = getExecutionRun(db, unrelatedRunId);
        expect(unrelatedAfter?.status).toBe(unrelatedBefore?.status);
        expect(unrelatedAfter?.pid).toBe(unrelatedBefore?.pid);
        expect(unrelatedAfter?.updated_at).toBe(unrelatedBefore?.updated_at);
      });
    }
  );

  it("a duplicate claim attempt from a second, competing database connection loses and leaves exactly one claimant", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const fixture = createExecutableReview(workspace, repo);
    const runId = parseJson(runCli(["review", "approve", fixture.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;

    const dbA = openDatabase(workspace);
    const dbB = openDatabase(workspace);
    try {
      const claimedByA = claimNextPendingRun(dbA, 24001, runId);
      const claimedByB = claimNextPendingRun(dbB, 24002, runId);

      expect(claimedByA?.id).toBe(runId);
      expect(claimedByB).toBeNull();

      const final = getExecutionRun(dbA, runId);
      expect(final?.status).toBe("running");
      expect(final?.pid).toBe(24001);
    } finally {
      dbA.close();
      dbB.close();
    }
  });

  it("refuses a queued receipt after its Review approval is revoked", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const { reviewId } = createExecutableReview(workspace, repo);
    const approval = parseJson(runCli(["review", "approve", reviewId, "--workspace", workspace, "--executor", "codex", "--json"]).stdout);
    withDatabase(workspace, (db) => {
      db.prepare("UPDATE review_items SET status = 'rejected' WHERE id = ?").run(reviewId);
      expect(() => executeApprovedReview(db, { workspace, reviewId, runId: approval.data.run.id }))
        .toThrow(/current approved Run receipt/);
    });
  });

  it("refuses Run receipts with a mismatched Review, Action, or Plan", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const first = createExecutableReview(workspace, repo);
    const second = createExecutableReview(workspace, repo);
    const firstRun = parseJson(runCli(["review", "approve", first.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;
    const secondRun = parseJson(runCli(["review", "approve", second.reviewId, "--workspace", workspace, "--json"]).stdout).data.run.id as string;

    withDatabase(workspace, (db) => {
      expect(() => executeApprovedReview(db, { workspace, reviewId: first.reviewId, runId: secondRun }))
        .toThrow(/current approved Run receipt/);
      const bound = getExecutionRun(db, firstRun);
      const otherReview = getReviewItem(db, second.reviewId);
      expect(bound).toBeTruthy();
      expect(otherReview?.work_item_id).toBeTruthy();
      db.prepare("UPDATE execution_runs SET work_item_id = ? WHERE id = ?").run(otherReview?.work_item_id, firstRun);
      expect(() => executeApprovedReview(db, { workspace, reviewId: first.reviewId, runId: firstRun }))
        .toThrow(/current approved Run receipt/);
      if (otherReview?.plan_id) {
        db.prepare("UPDATE execution_runs SET work_item_id = ?, plan_id = ? WHERE id = ?")
          .run(bound?.work_item_id, otherReview.plan_id, firstRun);
        expect(() => executeApprovedReview(db, { workspace, reviewId: first.reviewId, runId: firstRun }))
          .toThrow(/current approved Run receipt/);
      }
    });
  });

  it("includes the packet Plan-summary fallback in the approved scope fingerprint", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const { reviewId } = createExecutableReview(workspace, repo);
    withDatabase(workspace, (db) => {
      const review = getReviewItem(db, reviewId);
      expect(review).toBeTruthy();
      const withoutPlan = { ...review!, plan_id: null, plan_summary: "fallback A" };
      expect(approvedReviewScopeSha256(db, withoutPlan)).not.toBe(
        approvedReviewScopeSha256(db, { ...withoutPlan, plan_summary: "fallback B" })
      );
    });
  });

  it("carries a real approved HelloWorld Ask through its Action, Run, packet, and Artifact", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const project = createProject(workspace);
    withDatabase(workspace, (db) => upsertProjectMetadata(db, {
        projectId: project.project.id,
        aliases: ["CLI Fixture Project"],
        repoPath: repo,
        statusSummary: "HelloWorld fixture repo.",
        validationCommands: ["test -f HelloWorld.txt"]
      }));
    const request = 'Implement HelloWorld.txt in CLI Fixture Project, containing exactly the bytes "Hello World!\\n". Change no other project files.';
    const first = runAskCommand({ workspace, project: "CLI Fixture Project", request });
    expect(first.data.reviewItemId).toBeTruthy();

    const approved = runAskCommand({
      workspace,
      request: `approve ${first.data.reviewItemId}`,
      adapterMetadata: { reviewId: first.data.reviewItemId },
      executeReview: false
    });
    expect(approved.ok).toBe(true);
    const approvedAction = withDatabase(workspace, (db) => {
      const review = getReviewItem(db, first.data.reviewItemId as string);
      return review?.work_item_id ? getWorkItem(db, review.work_item_id) : null;
    });
    expect(approvedAction?.expected_artifact).toBe("HelloWorld.txt");
    const expectedArtifactRow = withDatabase(workspace, (db) => db.prepare(
      "SELECT title, artifact_type, status FROM artifacts WHERE work_item_id = ?"
    ).get(approvedAction?.id) as { title: string; artifact_type: string; status: string } | undefined);
    expect(expectedArtifactRow).toEqual({ title: "HelloWorld.txt", artifact_type: "expected_artifact", status: "planned" });
    const executionDecision = withDatabase(workspace, (db) =>
      listActionableReviewItems(db).find((item) => item.resolved_intent === "ReviewExecutionPending")
    );
    expect(executionDecision).toBeTruthy();
    const approvedReviewId = first.data.reviewItemId as string;
    const queued = runReviewApproveCommand({ workspace, id: executionDecision?.id as string, execute: true, executor: "codex" });
    expect(queued.data.run?.id).toBeTruthy();
    const secondExecutionDecision = withDatabase(workspace, (db) => {
      const approvedReview = getReviewItem(db, approvedReviewId);
      expect(approvedReview).toBeTruthy();
      return createReviewItem(db, {
        askRequestId: approvedReview?.ask_request_id,
        workItemId: approvedReview?.work_item_id,
        planId: approvedReview?.plan_id,
        projectId: approvedReview?.project_id,
        decisionNeeded: "Execute approved work.",
        recommendation: "Approve this item to run the executor.",
        sourceInput: approvedReview?.source_input ?? "",
        proposedAction: "Run the exact approved scope.",
        resolvedIntent: "ReviewExecutionPending",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: { originalReviewId: approvedReviewId }
      });
    });
    const laterQueued = runReviewApproveCommand({ workspace, id: secondExecutionDecision.id, execute: true, executor: "codex" });
    expect(laterQueued.data.run?.id).toBeTruthy();
    expect(laterQueued.data.run?.id).not.toBe(queued.data.run?.id);
    expect(() => withDatabase(workspace, (db) => executeApprovedReview(db, {
      workspace,
      reviewId: executionDecision?.id as string,
      executorName: "codex",
      runId: queued.data.run?.id
    }))).toThrow(/approval is stale or missing its approved scope fingerprint/);
    const approvedContext = withDatabase(workspace, (db) => getReviewItem(db, approvedReviewId)?.context_json);
    withDatabase(workspace, (db) => db.prepare("UPDATE review_items SET context_json = '{broken' WHERE id = ?").run(approvedReviewId));
    expect(() => withDatabase(workspace, (db) => executeApprovedReview(db, {
      workspace,
      reviewId: secondExecutionDecision.id,
      executorName: "codex",
      runId: laterQueued.data.run?.id
    }))).toThrow(/approval is stale or missing its approved scope fingerprint/);
    withDatabase(workspace, (db) => db.prepare("UPDATE review_items SET context_json = ? WHERE id = ?")
      .run(approvedContext, approvedReviewId));
    withDatabase(workspace, (db) => db.prepare("UPDATE work_items SET expected_artifact = ? WHERE id = ?")
      .run("HelloWorld.txt and another file", approvedAction?.id));
    expect(() => withDatabase(workspace, (db) => executeApprovedReview(db, {
      workspace,
      reviewId: secondExecutionDecision.id,
      executorName: "codex",
      runId: laterQueued.data.run?.id
    }))).toThrow(/approval is stale or missing its approved scope fingerprint/);

    const fakeBin = fakeExecutorBin(["codex"]);
    const executorCalls = path.join(fakeBin, "calls");
    writeFileSync(path.join(fakeBin, "codex"), [
      "#!/bin/sh",
      "cat >/dev/null",
      `printf x >> '${executorCalls}'`,
      "printf 'Hello World!\\n' > HelloWorld.txt",
      "printf 'created HelloWorld.txt\\n'"
    ].join("\n"), { encoding: "utf8", mode: 0o755 });
    const prevPath = process.env["PATH"];
    process.env["PATH"] = `${fakeBin}${path.delimiter}${prevPath ?? ""}`;
    try {
      expect(existsSync(executorCalls)).toBe(false);
      withDatabase(workspace, (db) => db.prepare("UPDATE work_items SET expected_artifact = ? WHERE id = ?")
        .run("HelloWorld.txt", approvedAction?.id));
      const execution = withDatabase(workspace, (db) => executeApprovedReview(db, {
        workspace,
        reviewId: secondExecutionDecision.id,
        executorName: "codex",
        runId: laterQueued.data.run?.id
      }));
      expect(readFileSync(path.join(repo, "HelloWorld.txt"), "utf8")).toBe("Hello World!\n");
      expect(execution.changedFiles).toEqual(["HelloWorld.txt"]);
      const prompt = readFileSync(path.join(path.dirname(execution.metadataPath), "prompt.md"), "utf8");
      expect(prompt).toContain(`Approval receipt: ${laterQueued.data.run?.id}`);
      expect(prompt).toContain("Approved artifact scope: HelloWorld.txt");
      expect(prompt).toContain(request);
      expect(execution.artifact).toBeTruthy();
      expect(readFileSync(executorCalls, "utf8")).toBe("x");
      withDatabase(workspace, (db) => db.prepare("UPDATE execution_runs SET status = 'completed' WHERE id = ?").run(laterQueued.data.run?.id));
      expect(() => withDatabase(workspace, (db) => executeApprovedReview(db, {
        workspace,
        reviewId: secondExecutionDecision.id,
        executorName: "codex",
        runId: laterQueued.data.run?.id
      }))).toThrow(/current approved Run receipt/);
      expect(readFileSync(executorCalls, "utf8")).toBe("x");
    } finally {
      process.env["PATH"] = prevPath;
    }
  });

  it("resumes the same CreateWork Action and Plan when queue insertion fails after approval", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const project = createProject(workspace);
    withDatabase(workspace, (db) => upsertProjectMetadata(db, {
      projectId: project.project.id,
      aliases: ["CLI Fixture Project"],
      repoPath: repo,
      statusSummary: "HelloWorld fixture repo.",
      validationCommands: ["test -f HelloWorld.txt"]
    }));
    const sourceInput = 'Implement HelloWorld.txt in CLI Fixture Project, containing exactly the bytes "Hello World!\\n". Change no other project files.';
    const reviewId = withDatabase(workspace, (db) => {
      const ask = createAskRequest(db, {
        rawRequest: sourceInput,
        resolvedIntent: "CreateWork",
        registryVersion: 1,
        outputKind: "requires_review",
        status: "requires_review"
      });
      return createReviewItem(db, {
        askRequestId: ask.id,
        projectId: project.project.id,
        decisionNeeded: "Approve this scoped Ask-created Action.",
        recommendation: "Approve the exact requested file.",
        sourceInput,
        proposedAction: sourceInput,
        resolvedIntent: "CreateWork",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      }).id;
    });
    const actionsBefore = withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM work_items").get() as { n: number }).n;
    const plansBefore = withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM execution_plans").get() as { n: number }).n;
    const runsBefore = withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM execution_runs").get() as { n: number }).n;
    withDatabase(workspace, (db) => db.exec(
      "CREATE TRIGGER no_execution_run BEFORE INSERT ON execution_runs BEGIN SELECT RAISE(ABORT, 'run row refused'); END"
    ));
    expect(() => runReviewApproveCommand({ workspace, id: reviewId, execute: true, executor: "codex" }))
      .toThrow(/run row refused/);
    withDatabase(workspace, (db) => db.exec("DROP TRIGGER no_execution_run"));
    const claim = withDatabase(workspace, (db) => db.prepare(
      "SELECT work_item_id, plan_id FROM review_approval_claims WHERE review_item_id = ?"
    ).get(reviewId) as { work_item_id: string; plan_id: string } | undefined);
    expect(claim?.work_item_id).toBeTruthy();
    expect(claim?.plan_id).toBeTruthy();
    expect(withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM work_items").get() as { n: number }).n).toBe(actionsBefore + 1);
    expect(withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM execution_runs").get() as { n: number }).n).toBe(runsBefore);

    const retried = runReviewApproveCommand({ workspace, id: reviewId, execute: true, executor: "codex" });
    expect(retried.data.run?.id).toBeTruthy();
    expect(withDatabase(workspace, (db) => db.prepare(
      "SELECT work_item_id, plan_id FROM execution_runs WHERE id = ?"
    ).get(retried.data.run?.id))).toEqual(claim);
    expect(withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM execution_runs").get() as { n: number }).n).toBe(runsBefore + 1);
    expect(withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM work_items").get() as { n: number }).n).toBe(actionsBefore + 1);
    expect(withDatabase(workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM execution_plans").get() as { n: number }).n).toBe(plansBefore + 1);
  });

  it("shows and safely resumes a public idempotent Ask approval after Run insertion fails", () => {
    const workspace = initializedWorkspace();
    const repo = initializedGitRepo();
    const project = createProject(workspace);
    withDatabase(workspace, (db) => upsertProjectMetadata(db, {
      projectId: project.project.id,
      aliases: ["CLI Fixture Project"],
      repoPath: repo,
      statusSummary: "HelloWorld fixture repo.",
      validationCommands: ["test -f HelloWorld.txt"]
    }));
    const sourceInput = 'Implement HelloWorld.txt in CLI Fixture Project, containing exactly the bytes "Hello World!\\n". Change no other project files.';
    const original = runAskCommand({ workspace, project: "CLI Fixture Project", request: sourceInput, requestId: "original-ask" });
    const reviewId = original.data.reviewItemId as string;
    expect(reviewId).toMatch(/^review_/);
    const counts = () => withDatabase(workspace, (db) => ({
      actions: (db.prepare("SELECT COUNT(*) AS n FROM work_items").get() as { n: number }).n,
      plans: (db.prepare("SELECT COUNT(*) AS n FROM execution_plans").get() as { n: number }).n,
      runs: (db.prepare("SELECT COUNT(*) AS n FROM execution_runs").get() as { n: number }).n
    }));
    const before = counts();
    withDatabase(workspace, (db) => db.exec(
      "CREATE TRIGGER no_public_approval_run BEFORE INSERT ON execution_runs BEGIN SELECT RAISE(ABORT, 'public run row refused'); END"
    ));
    expect(() => runAskCommand({
      workspace,
      request: `approve ${reviewId}`,
      requestId: "approval-request-retry",
      adapterMetadata: { reviewId },
      executeReview: true,
      reviewExecutor: "codex"
    })).toThrow(/public run row refused/);
    withDatabase(workspace, (db) => db.exec("DROP TRIGGER no_public_approval_run"));

    const claim = withDatabase(workspace, (db) => db.prepare(
      "SELECT work_item_id, plan_id FROM review_approval_claims WHERE review_item_id = ?"
    ).get(reviewId) as { work_item_id: string; plan_id: string } | undefined);
    expect(claim?.work_item_id).toBeTruthy();
    expect(claim?.plan_id).toBeTruthy();
    const failedShow = runAskShowCommand({ workspace, id: "approval-request-retry" });
    expect(failedShow.data.capture).toMatchObject({ status: "partial", relatedReviewId: reviewId });
    expect(failedShow.data.capture?.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "decision", id: reviewId }),
      expect.objectContaining({ kind: "action", id: claim?.work_item_id }),
      expect.objectContaining({ kind: "plan", id: claim?.plan_id })
    ]));
    expect(failedShow.data.capture?.outcomes).toContainEqual(expect.objectContaining({ kind: "approval_claim", id: reviewId }));
    expect(renderAskTrailSuccess(failedShow).join("\n")).toContain("existing approval claim");
    expect(renderAskTrailSuccess(failedShow).join("\n")).not.toContain(`arcadia review approve ${reviewId} --execute`);

    const exactRetry = runAskCommand({
      workspace,
      request: `approve ${reviewId}`,
      requestId: "approval-request-retry",
      adapterMetadata: { reviewId },
      executeReview: true,
      reviewExecutor: "codex"
    });
    expect(exactRetry.data.result.status).toBe("ignored");
    expect(counts()).toEqual({ actions: before.actions + 1, plans: before.plans + 1, runs: before.runs });

    const resumed = runAskCommand({
      workspace,
      request: `approve ${reviewId}`,
      requestId: "approval-request-recovery",
      adapterMetadata: { reviewId },
      executeReview: true,
      reviewExecutor: "codex"
    });
    expect(resumed.data.run?.id).toBeTruthy();
    expect(withDatabase(workspace, (db) => db.prepare(
      "SELECT work_item_id, plan_id FROM execution_runs WHERE id = ?"
    ).get(resumed.data.run?.id))).toEqual(claim);
    expect(counts()).toEqual({ actions: before.actions + 1, plans: before.plans + 1, runs: before.runs + 1 });
    const recoveredShow = runAskShowCommand({ workspace, id: "approval-request-retry" });
    expect(recoveredShow.data.capture?.outcomes).toContainEqual(expect.objectContaining({ kind: "run", id: resumed.data.run?.id }));
    expect(renderAskTrailSuccess(recoveredShow).join("\n")).toContain("already has Run");
  });

  it("refuses an Ask approval that conflicts with a pre-attached Action", () => {
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

    expect(result.status).not.toBe(0);
    expect(parseJson(result.stderr).error.message).toContain("without its originating Ask");
  });

  it("provides Claude Code and Gemini built-in adapters", () => {
    for (const executor of ["claude-code", "gemini"] as const) {
      const workspace = initializedWorkspace();
      const repo = initializedGitRepo();
      const fakeBin = fakeExecutorBin(["claude", "gemini"]);
      const { reviewId } = createExecutableReview(workspace, repo);
      const approval = parseJson(runCli(["review", "approve", reviewId, "--workspace", workspace, "--executor", executor, "--json"]).stdout);

      const prevPath = process.env["PATH"];
      process.env["PATH"] = `${fakeBin}${path.delimiter}${prevPath ?? ""}`;
      try {
        const result = withDatabase(workspace, (db) =>
          executeApprovedReview(db, { workspace, reviewId, executorName: executor, runId: approval.data.run.id })
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
    const approval = parseJson(runCli(["review", "approve", reviewId, "--workspace", workspace, "--executor", "aider", "--json"]).stdout);
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
        executeApprovedReview(db, { workspace, reviewId, executorName: "aider", runId: approval.data.run.id })
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
