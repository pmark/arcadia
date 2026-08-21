import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatRequiresReviewNotificationItem } from "../apps/discord-bot/src/formatters/requiresReviewFormatter.js";
import { runAskCommand } from "../src/commands/ask.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { runWorkerIteration } from "../src/commands/worker.js";
import { withDatabase } from "../src/db/connection.js";
import {
  getExecutionRun,
  getProject,
  getProjectMetadata,
  getReviewItem,
  listApprovalGatesForWorkItem
} from "../src/db/repositories.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { updateProjectSetup } from "../src/projects/setup.js";
import {
  deployApprovedProjectProposal,
  parseWorkersDeploymentUrl,
  type StagingCommandResult
} from "../src/projects/stagingDeployment.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Project idea to staging proposal", () => {
  it("turns the demo sentence into one populated, deep-linked, queueable proposal", () => {
    const workspace = initializedWorkspace();
    const asked = runAskCommand({
      workspace,
      request: "Create a MartianRover Field Notes blog site"
    });

    expect(asked.data.result).toMatchObject({ status: "requires_review" });
    expect(asked.data.project).toMatchObject({ name: "MartianRover Field Notes", status: "incubating" });
    expect(asked.data.workItem?.clarification_status).toBe("clarified");
    expect(asked.data.approvalGates).toHaveLength(4);
    expect(existsSync(path.join(workspace, "projects", "martianrover-field-notes"))).toBe(true);

    const projectId = asked.data.project!.id;
    const reviewId = asked.data.reviewItemId!;
    withDatabase(workspace, (db) => {
      const metadata = getProjectMetadata(db, projectId);
      expect(metadata).toMatchObject({
        repository_url: null,
        project_template: "astro_field_notes_cloudflare",
        generator_skill: "create-astro-site",
        deployment_target: "Cloudflare Workers staging environment",
        build_agent: "codex",
        staging_url: null
      });
      updateProjectSetup(db, {
        projectId,
        repositoryUrl: "https://github.com/martianrover/field-notes",
        buildAgent: "claude-code"
      });
      expect(getReviewItem(db, reviewId)?.missing_fields).toBe("[]");
    });

    const review = withDatabase(workspace, (db) => getReviewItem(db, reviewId)!);
    const discord = formatRequiresReviewNotificationItem({
      id: review.id,
      slug: review.slug,
      workItemId: review.work_item_id,
      projectId: review.project_id,
      project: review.project_name,
      goal: review.project_goal,
      decisionNeeded: review.decision_needed,
      context: review.context,
      contextJson: review.context_json,
      resolvedIntent: review.resolved_intent,
      recommendation: review.recommendation,
      options: ["approve", "reject", "defer"],
      sourceInput: review.source_input,
      resultingAskRequestId: review.resulting_ask_request_id
    }, "http://arcadia.local:3020");
    expect(discord).toContain(`/projects/${projectId}`);

    const approved = runReviewApproveCommand({ workspace, id: reviewId, execute: false });
    expect(approved.data.result.status).toBe("pending_execution");
    expect(approved.data.run?.id).toMatch(/^run_/);
    withDatabase(workspace, (db) => {
      expect(getExecutionRun(db, approved.data.run!.id)?.executor_name).toBe("claude-code");
      expect(listApprovalGatesForWorkItem(db, asked.data.workItem!.id).every((gate) => gate.status === "approved")).toBe(true);
    });

    const snapshot = buildDashboardSnapshot({ workspace });
    expect(snapshot.projects.find((project) => project.id === projectId)).toMatchObject({
      repositoryUrl: "https://github.com/martianrover/field-notes",
      generatorSkill: "create-astro-site",
      buildAgent: "claude-code",
      stagingUrl: null
    });
  });

  it("persists a successful deterministic Cloudflare Workers staging result", () => {
    const workspace = initializedWorkspace();
    const asked = runAskCommand({ workspace, request: "Create a MartianRover Field Notes blog site" });
    const projectId = asked.data.project!.id;
    const calls: string[][] = [];
    const runner = (_command: string, args: string[]): StagingCommandResult => {
      calls.push(args);
      return {
        status: 0,
        stdout: "Uploaded martianrover-field-notes-staging\nhttps://martianrover-field-notes-staging.arcadia-test.workers.dev",
        stderr: "",
        error: null
      };
    };
    const deployment = withDatabase(workspace, (db) => deployApprovedProjectProposal(db, {
      projectId,
      workItemId: asked.data.workItem!.id,
      repoPath: path.join(workspace, "projects", "martianrover-field-notes"),
      run: runner
    }));

    expect(deployment.url).toBe("https://martianrover-field-notes-staging.arcadia-test.workers.dev");
    expect(deployment.artifact.title).toContain(deployment.url);
    expect(calls).toEqual([["exec", "wrangler", "deploy", "--env", "staging"]]);
    withDatabase(workspace, (db) => {
      expect(getProjectMetadata(db, projectId)?.staging_url).toBe(deployment.url);
      expect(getProject(db, projectId)?.status).toBe("active");
    });
  });

  it("runs the approved Codex scaffold, validates it, deploys staging, and completes the Action", () => {
    const workspace = initializedWorkspace();
    const asked = runAskCommand({ workspace, request: "Create a MartianRover Field Notes blog site" });
    withDatabase(workspace, (db) => updateProjectSetup(db, {
      projectId: asked.data.project!.id,
      repositoryUrl: "https://github.com/martianrover/field-notes",
      buildAgent: "codex"
    }));
    const approved = runReviewApproveCommand({ workspace, id: asked.data.reviewItemId!, execute: false });
    const fakeBin = fakeProjectBuildBin();
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath ?? ""}`;
    try {
      const finished = withDatabase(workspace, (db) => runWorkerIteration(db, workspace, 43210));
      expect(finished?.id).toBe(approved.data.run?.id);
      expect(finished?.status).toBe("completed");
      expect(finished?.summary).toContain("https://martianrover-field-notes-staging.arcadia-test.workers.dev");
      expect(finished?.artifacts.some((artifact) => artifact.title.includes("Live staging URL"))).toBe(true);
      const executionArtifact = finished?.artifacts.find((artifact) => artifact.artifact_type === "review_execution");
      const executionMetadata = JSON.parse(readFileSync(path.join(workspace, executionArtifact!.path!), "utf8")) as {
        command: string[];
        artifacts: string[];
      };
      expect(executionMetadata.command).toContain("sandbox_workspace_write.network_access=true");
      const promptPath = executionMetadata.artifacts.find((artifactPath) => artifactPath.endsWith("prompt.md"));
      const prompt = readFileSync(path.join(workspace, promptPath!), "utf8");
      expect(prompt).toContain("$create-astro-site");
      expect(prompt).toContain("env.staging.workers_dev true");
      withDatabase(workspace, (db) => {
        expect(getProjectMetadata(db, asked.data.project!.id)?.staging_url)
          .toBe("https://martianrover-field-notes-staging.arcadia-test.workers.dev");
        expect(asked.data.workItem && db.prepare("SELECT status FROM work_items WHERE id = ?").get(asked.data.workItem.id))
          .toMatchObject({ status: "done" });
      });
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("refuses to invent a live URL when Wrangler output has none", () => {
    expect(parseWorkersDeploymentUrl("Deployment complete: https://field-notes.example.workers.dev", "field-notes")).toBeNull();
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-project-proposal-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function fakeProjectBuildBin(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-project-proposal-bin-"));
  workspaces.push(directory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "codex"), [
    "#!/bin/sh",
    "cat >/dev/null",
    "mkdir -p src/pages",
    "printf '%s\\n' '<h1>MartianRover Field Notes</h1>' > src/pages/index.astro",
    "printf '%s\\n' '{\"name\":\"field-notes\",\"scripts\":{\"build\":\"astro build\"}}' > package.json",
    "printf '%s\\n' '{\"name\":\"martianrover-field-notes\",\"compatibility_date\":\"2026-08-20\",\"assets\":{\"directory\":\"./dist\"},\"env\":{\"staging\":{\"workers_dev\":true}}}' > wrangler.jsonc",
    "printf '%s\\n' 'scaffold complete'"
  ].join("\n"), { encoding: "utf8", mode: 0o755 });
  writeFileSync(path.join(directory, "pnpm"), [
    "#!/bin/sh",
    "case \"$*\" in",
    "  'run build') mkdir -p dist; printf '%s\\n' '<h1>built</h1>' > dist/index.html ;;",
    "  *'wrangler deploy --env staging'*) printf '%s\\n' 'Uploaded martianrover-field-notes-staging'; printf '%s\\n' 'https://martianrover-field-notes-staging.arcadia-test.workers.dev' ;;",
    "  *) printf '%s\\n' \"unexpected pnpm args: $*\" >&2; exit 2 ;;",
    "esac"
  ].join("\n"), { encoding: "utf8", mode: 0o755 });
  return directory;
}
