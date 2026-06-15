import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { runWorkRunCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createExecutionPlan,
  createProjectWithInitialWork,
  getWorkItem,
  listArtifacts,
  listReviewItems
} from "../src/db/repositories.js";
import { ensureBuiltInSkills } from "../src/execution/skills.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import {
  completePlanningArtifact,
  completePlanningPacket,
  planningArtifactValidationFixtures
} from "./planningArtifactValidationFixtures.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("Codex planning artifact validation workflow", () => {
  it("validates passing planning artifacts and preserves completion behavior", () => {
    const workspace = initializedWorkspace();
    const fixture = setupCodexRun(workspace, {
      purpose: "planning",
      agentOutput: completePlanningArtifact
    });

    const result = runWorkRunCommand({
      workspace,
      workId: fixture.workItemId,
      plan: fixture.planId,
      allowCodexPlanning: true
    });

    expect(result.data.run.status).toBe("completed");
    expect(result.data.run.steps[0].status).toBe("completed");
    expect(result.data.run.steps[0].artifact_path).toBe(fixture.finalRelativePath);
    expect(result.data.run.steps[0].output).toContain("Planning artifact validation passed");
    expect(withDatabase(workspace, (db) => getWorkItem(db, fixture.workItemId)?.status)).toBe("done");
    expect(withDatabase(workspace, (db) => listReviewItems(db, "all"))).toHaveLength(0);

    const sidecar = readValidationSidecar(workspace, fixture.validationRelativePath);
    expect(sidecar.status).toBe("passed");
    expect(sidecar.validation.passed).toBe(true);
    expect(result.data.run.artifacts.some((artifact) => artifact.path === fixture.validationRelativePath)).toBe(true);
  });

  it("surfaces failed planning validation through Requires Review", () => {
    const workspace = initializedWorkspace();
    const failingArtifact = planningArtifactValidationFixtures.find((fixture) =>
      fixture.expect.failures.includes("missing_ordered_phases")
    )?.artifactText;
    if (!failingArtifact) {
      throw new Error("Expected missing ordered phases fixture.");
    }
    const fixture = setupCodexRun(workspace, {
      purpose: "planning",
      agentOutput: failingArtifact
    });

    const result = runWorkRunCommand({
      workspace,
      workId: fixture.workItemId,
      plan: fixture.planId,
      allowCodexPlanning: true
    });

    expect(result.data.run.status).toBe("requires_review");
    expect(result.data.run.steps[0].status).toBe("requires_review");
    expect(result.data.run.steps[0].error).toContain("Planning artifact validation failed");
    expect(withDatabase(workspace, (db) => getWorkItem(db, fixture.workItemId)?.queue)).toBe("requires_review");

    const reviewItems = withDatabase(workspace, (db) => listReviewItems(db, "all"));
    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0].decision_needed).toContain("Planning artifact validation failed");
    expect(reviewItems[0].decision_needed).toContain("missing_ordered_phases");
    expect(reviewItems[0].recommendation).toContain(fixture.validationRelativePath);

    const sidecar = readValidationSidecar(workspace, fixture.validationRelativePath);
    expect(sidecar.status).toBe("failed");
    expect(sidecar.validation.failures.map((failure: { code: string }) => failure.code)).toContain("missing_ordered_phases");
  });

  it("retains validation warnings without blocking completion", () => {
    const workspace = initializedWorkspace();
    const warningArtifact = planningArtifactValidationFixtures.find((fixture) =>
      fixture.expect.warnings.includes("vague_recommended_next_action")
    )?.artifactText;
    if (!warningArtifact) {
      throw new Error("Expected vague next action fixture.");
    }
    const fixture = setupCodexRun(workspace, {
      purpose: "planning",
      agentOutput: warningArtifact
    });

    const result = runWorkRunCommand({
      workspace,
      workId: fixture.workItemId,
      plan: fixture.planId,
      allowCodexPlanning: true
    });

    expect(result.data.run.status).toBe("completed");
    expect(result.data.run.steps[0].output).toContain("1 warnings");
    expect(withDatabase(workspace, (db) => listReviewItems(db, "all"))).toHaveLength(0);

    const sidecar = readValidationSidecar(workspace, fixture.validationRelativePath);
    expect(sidecar.status).toBe("passed");
    expect(sidecar.validation.warnings.map((warning: { code: string }) => warning.code)).toContain(
      "vague_recommended_next_action"
    );
  });

  it("reports validation not run when a planning packet file is missing", () => {
    const workspace = initializedWorkspace();
    const fixture = setupCodexRun(workspace, {
      purpose: "planning",
      agentOutput: completePlanningArtifact
    });
    unlinkSync(path.join(workspace, fixture.promptRelativePath));

    const result = runWorkRunCommand({
      workspace,
      workId: fixture.workItemId,
      plan: fixture.planId,
      allowCodexPlanning: true
    });

    expect(result.data.run.status).toBe("failed");
    expect(result.data.run.steps[0].error).toContain("Planning artifact validation not run");
    expect(result.data.run.steps[0].error).toContain("packet file is missing");

    const sidecar = readValidationSidecar(workspace, fixture.validationRelativePath);
    expect(sidecar.status).toBe("not_run");
    expect(sidecar.validation).toBeNull();
  });

  it("keeps the standalone validate-planning CLI working", () => {
    const workspace = initializedWorkspace();
    const packetPath = path.join(workspace, "packet.md");
    const artifactPath = path.join(workspace, "final.md");
    writeFileSync(packetPath, completePlanningPacket, "utf8");
    writeFileSync(artifactPath, completePlanningArtifact, "utf8");

    const result = spawnSync(
      tsxBin,
      [
        path.join(repoRoot, "src", "cli.ts"),
        "artifact",
        "validate-planning",
        "--workspace",
        workspace,
        "--packet",
        packetPath,
        "--artifact",
        artifactPath,
        "--json"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as { command: string; data: { validation: { passed: boolean } } };
    expect(json.command).toBe("artifact.validate-planning");
    expect(json.data.validation.passed).toBe(true);
  });

  it("does not force non-planning Codex artifacts through planning validation", () => {
    const workspace = initializedWorkspace();
    const failingArtifact = planningArtifactValidationFixtures.find((fixture) =>
      fixture.expect.failures.includes("missing_ordered_phases")
    )?.artifactText;
    if (!failingArtifact) {
      throw new Error("Expected missing ordered phases fixture.");
    }
    const fixture = setupCodexRun(workspace, {
      purpose: "build",
      agentOutput: failingArtifact
    });

    const result = runWorkRunCommand({
      workspace,
      workId: fixture.workItemId,
      plan: fixture.planId,
      allowCodexBuild: true
    });

    expect(result.data.run.status).toBe("completed");
    expect(result.data.run.steps[0].output).not.toContain("Planning artifact validation");
    expect(existsSync(path.join(workspace, fixture.validationRelativePath))).toBe(false);
    expect(withDatabase(workspace, (db) => listReviewItems(db, "all"))).toHaveLength(0);
    expect(withDatabase(workspace, (db) =>
      listArtifacts(db).filter((artifact) => artifact.artifact_type === "planning_artifact_validation")
    )).toHaveLength(0);
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-planning-workflow-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function setupCodexRun(
  workspace: string,
  input: { purpose: "planning" | "build"; agentOutput: string }
): {
  workItemId: string;
  planId: string;
  promptRelativePath: string;
  finalRelativePath: string;
  validationRelativePath: string;
} {
  const paths = getWorkspacePaths(workspace);
  const agentPath = path.join(workspace, `fake-${input.purpose}-agent.cjs`);
  const outputPath = path.join(workspace, `fake-${input.purpose}-output.md`);
  writeFileSync(
    agentPath,
    "const { readFileSync } = require('node:fs'); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(readFileSync(process.argv[2], 'utf8')));",
    "utf8"
  );
  writeFileSync(outputPath, input.agentOutput, "utf8");
  writeFileSync(
    paths.codingAgentProfiles,
    `${JSON.stringify({
      version: 1,
      profiles: [{
        name: `fake_${input.purpose}`,
        provider: "fake-agent",
        package: "local",
        command: process.execPath,
        purpose: input.purpose,
        sandbox: input.purpose === "planning" ? "read-only" : "workspace-write",
        args: [agentPath, outputPath]
      }]
    }, null, 2)}\n`,
    "utf8"
  );

  return withDatabase(workspace, (db) => {
    ensureBuiltInSkills(db);
    const created = createProjectWithInitialWork(db, {
      name: "Planning Validation Project",
      mission: "Keep planning artifacts deterministic.",
      goal: "Validate Codex planning output.",
      status: "active",
      currentMilestone: "Planning validation",
      nextAction: input.purpose === "planning" ? "Prepare planning artifact" : "Prepare build artifact",
      workClassification: "codex"
    });
    const workItem = getWorkItem(db, created.workItem.id);
    if (!workItem) {
      throw new Error("Expected work item.");
    }
    const plan = createExecutionPlan(db, {
      workItemId: workItem.id,
      summary: `Run ${input.purpose} Codex step.`,
      steps: [{
        skillName: input.purpose === "planning" ? "codex_planning" : "codex_build",
        title: `Run Codex ${input.purpose}`,
        command: null,
        executorType: input.purpose === "planning" ? "codex_planning" : "codex_build",
        safeToRun: false,
        needsMark: null
      }]
    });
    if (!plan) {
      throw new Error("Expected execution plan.");
    }

    const invocationId = `codex_${input.purpose}_workflow`;
    const packetDir = path.join(workspace, "prompts", "codex", invocationId);
    mkdirSync(packetDir, { recursive: true });
    const promptRelativePath = path.join("prompts", "codex", invocationId, "prompt.md");
    const outputRelativePath = path.join("prompts", "codex", invocationId, "output.jsonl");
    const finalRelativePath = path.join("prompts", "codex", invocationId, "final.md");
    const validationRelativePath = path.join("prompts", "codex", invocationId, "planning-validation.json");
    writeFileSync(path.join(workspace, promptRelativePath), completePlanningPacket, "utf8");
    writeFileSync(path.join(workspace, outputRelativePath), "", "utf8");
    writeFileSync(path.join(workspace, finalRelativePath), "Codex has not been invoked yet.\n", "utf8");

    createCodexInvocation(db, {
      id: invocationId,
      purpose: input.purpose,
      agentProfile: `fake_${input.purpose}`,
      workspaceScope: workspace,
      command: `${process.execPath} ${agentPath} ${outputPath}`,
      promptPath: promptRelativePath,
      jsonlOutputPath: outputRelativePath,
      finalMessagePath: finalRelativePath,
      status: "packet_created",
      workItemId: workItem.id,
      planId: plan.id,
      planStepId: plan.steps[0].id
    });

    return {
      workItemId: workItem.id,
      planId: plan.id,
      promptRelativePath,
      finalRelativePath,
      validationRelativePath
    };
  });
}

function readValidationSidecar(workspace: string, relativePath: string): any {
  return JSON.parse(readFileSync(path.join(workspace, relativePath), "utf8"));
}
