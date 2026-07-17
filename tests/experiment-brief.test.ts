import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";
import { runExperimentBriefCommand } from "../src/commands/experiment.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import {
  countRows,
  createBackBurnerItem,
  createProjectWithInitialWork,
  getArtifact,
  getBackBurnerItem,
  getReviewItem,
  getWorkItem
} from "../src/db/repositories.js";
import { localDateStamp } from "../src/utils/time.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("experiment brief command", () => {
  it("creates a linked Action, Markdown Artifact, and Decision from explicit input", () => {
    const workspace = initializedWorkspace();
    const project = seedProject(workspace);

    const response = runExperimentBriefCommand({
      workspace,
      project: project.slug,
      opportunity: "Try a two-step onboarding checklist",
      hypothesis: "A short onboarding checklist will increase first-week project setup completion.",
      metric: "First-week project setup completion rate",
      baseline: "42% completion over the last four setups",
      evidenceNeeded: "Completion counts for the next five new projects and notes on skipped steps.",
      decisionCriteria: "Proceed if completion improves to at least 60% without increasing setup time.",
      recommendedNextAction: "Draft the checklist and ask Mark to approve the experiment."
    });

    expect(response.command).toBe("experiment.brief");
    expect(response.data.project.id).toBe(project.id);
    expect(response.data.workItem.project_id).toBe(project.id);
    expect(response.data.workItem.queue).toBe("requires_review");
    expect(response.data.workItem.work_classification).toBe("requires_review");
    expect(response.data.workItem.expected_artifact).toBe("Experiment brief");
    expect(response.data.artifact.project_id).toBe(project.id);
    expect(response.data.artifact.work_item_id).toBe(response.data.workItem.id);
    expect(response.data.artifact.artifact_type).toBe("experiment_brief");
    expect(response.data.reviewItem.project_id).toBe(project.id);
    expect(response.data.reviewItem.work_item_id).toBe(response.data.workItem.id);
    expect(response.data.reviewItem.artifact_id).toBe(response.data.artifact.id);
    expect(response.data.reviewItem.status).toBe("open");
    expect(response.data.reviewItem.decision_needed).toBe("Approve, revise, defer, or reject this experiment.");

    const expectedPath = [
      "artifacts",
      "experiments",
      `${localDateStamp()}-${project.slug}-try-a-two-step-onboarding-checklist-experiment-brief.md`
    ].join("/");
    expect(response.data.artifactPath).toBe(expectedPath);
    expect(response.artifacts).toEqual([expectedPath]);

    const artifactAbsolutePath = path.join(workspace, expectedPath);
    expect(existsSync(artifactAbsolutePath)).toBe(true);
    expect(readFileSync(artifactAbsolutePath, "utf8")).toBe([
      "Experiment Brief:",
      "",
      "Project",
      "",
      "Arcadia",
      "",
      "Opportunity",
      "",
      "Try a two-step onboarding checklist",
      "",
      "Hypothesis",
      "",
      "A short onboarding checklist will increase first-week project setup completion.",
      "",
      "Primary Metric",
      "",
      "First-week project setup completion rate",
      "",
      "Baseline",
      "",
      "42% completion over the last four setups",
      "",
      "Evidence Needed",
      "",
      "Completion counts for the next five new projects and notes on skipped steps.",
      "",
      "Decision Criteria",
      "",
      "Proceed if completion improves to at least 60% without increasing setup time.",
      "",
      "Project Update Target",
      "",
      "What project state, strategy, milestone, or next action may change if this experiment succeeds or fails.",
      "",
      "Recommended Next Action",
      "",
      "Draft the checklist and ask Mark to approve the experiment.",
      "",
      "Review",
      "",
      "This experiment should not proceed until Mark approves, revises, defers, or rejects it.",
      ""
    ].join("\n"));

    withDatabase(workspace, (db) => {
      expect(countRows(db, "work_items")).toBe(2);
      expect(countRows(db, "artifacts")).toBe(1);
      expect(countRows(db, "review_items")).toBe(1);
      expect(getWorkItem(db, response.data.workItem.id)?.project_id).toBe(project.id);
      expect(getArtifact(db, response.data.artifact.id)?.work_item_id).toBe(response.data.workItem.id);
      expect(getReviewItem(db, response.data.reviewItem.id)?.artifact_path).toBe(expectedPath);
    });

    const snapshot = buildDashboardSnapshot({ workspace });
    expect(snapshot.requiresReviewItems.map((item) => item.id)).toContain(response.data.reviewItem.id);
    expect(snapshot.recentArtifacts.map((artifact) => artifact.path)).toContain(expectedPath);
  });

  it("uses Baseline unknown when baseline is omitted", () => {
    const workspace = initializedWorkspace();
    const project = seedProject(workspace);

    const response = runExperimentBriefCommand({
      workspace,
      project: project.id,
      opportunity: "Test a lighter daily review prompt",
      hypothesis: "A shorter prompt will increase daily review completion.",
      metric: "Daily review completion rate",
      evidenceNeeded: "Seven days of completion observations.",
      decisionCriteria: "Keep the lighter prompt if completion improves.",
      recommendedNextAction: "Prepare the lighter prompt for review."
    });

    expect(readFileSync(path.join(workspace, response.data.artifactPath), "utf8")).toContain(
      "\nBaseline\n\nBaseline unknown\n"
    );
  });

  it("fails for a missing project before writing", () => {
    const workspace = initializedWorkspace();

    expect(() =>
      runExperimentBriefCommand({
        workspace,
        project: "missing-project",
        opportunity: "Try a two-step onboarding checklist",
        hypothesis: "A checklist will help.",
        metric: "Completion rate",
        evidenceNeeded: "Completion evidence.",
        decisionCriteria: "Ship if it improves.",
        recommendedNextAction: "Draft the checklist."
      })
    ).toThrow(/Project not found/);

    expect(existsSync(path.join(workspace, "artifacts", "experiments"))).toBe(false);
    withDatabase(workspace, (db) => {
      expect(countRows(db, "work_items")).toBe(0);
      expect(countRows(db, "artifacts")).toBe(0);
      expect(countRows(db, "review_items")).toBe(0);
    });
  });

  it.each([
    ["opportunity", { opportunity: "   " }, /opportunity is required/],
    ["hypothesis", { hypothesis: "   " }, /hypothesis is required/],
    ["metric", { metric: "   " }, /metric is required/],
    ["evidence needed", { evidenceNeeded: "   " }, /evidence needed is required/],
    ["decision criteria", { decisionCriteria: "   " }, /decision criteria is required/],
    ["recommended next action", { recommendedNextAction: "   " }, /recommended next action is required/]
  ])("fails for empty %s before writing", (_field, override, errorPattern) => {
    const workspace = initializedWorkspace();
    const project = seedProject(workspace);

    expect(() =>
      runExperimentBriefCommand({
        workspace,
        project: project.id,
        opportunity: "Try a two-step onboarding checklist",
        hypothesis: "A checklist will help.",
        metric: "Completion rate",
        evidenceNeeded: "Completion evidence.",
        decisionCriteria: "Ship if it improves.",
        recommendedNextAction: "Draft the checklist.",
        ...override
      })
    ).toThrow(errorPattern);

    expect(existsSync(path.join(workspace, "artifacts", "experiments"))).toBe(false);
    withDatabase(workspace, (db) => {
      expect(countRows(db, "work_items")).toBe(1);
      expect(countRows(db, "artifacts")).toBe(0);
      expect(countRows(db, "review_items")).toBe(0);
    });
  });

  it("promotes a source Back Burner item when provided", () => {
    const workspace = initializedWorkspace();
    const project = seedProject(workspace);
    const backBurnerItem = withDatabase(workspace, (db) =>
      createBackBurnerItem(db, {
        originalInput: "Maybe onboarding is too heavy.",
        ingressSource: "cli.ask",
        classification: "Idea",
        confidence: 0.44,
        reason: "Interesting but not yet actionable.",
        suggestedNextStep: "Turn this into an experiment brief."
      })
    );

    const response = runExperimentBriefCommand({
      workspace,
      project: project.id,
      opportunity: "Reduce onboarding friction",
      hypothesis: "Less setup text will reduce drop-off.",
      metric: "Setup drop-off rate",
      evidenceNeeded: "Before and after setup completion observations.",
      decisionCriteria: "Proceed if drop-off decreases.",
      recommendedNextAction: "Review whether this experiment should run.",
      sourceBackBurnerItemId: backBurnerItem.id
    });

    withDatabase(workspace, (db) => {
      const updated = getBackBurnerItem(db, backBurnerItem.id);
      expect(updated?.status).toBe("promoted");
      expect(updated?.promoted_work_item_id).toBe(response.data.workItem.id);
    });
    expect(response.data.sourceBackBurnerItem?.id).toBe(backBurnerItem.id);
  });

  it("registers arcadia experiment brief in the CLI", () => {
    const program = buildProgram();
    const experiment = program.commands.find((command) => command.name() === "experiment");
    const help = experiment?.helpInformation() ?? "";

    expect(help).toContain("brief");
    expect(help).toContain("Experiment commands");
  });
});

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-experiment-brief-"));
  workspaces.push(workspace);
  initWorkspace(workspace);
  return workspace;
}

function seedProject(workspace: string) {
  return withDatabase(workspace, (db) =>
    createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Maintain momentum across creative projects.",
      goal: "Make experiments reviewable.",
      status: "active",
      currentMilestone: "Experiment Brief v0",
      nextAction: "Define the minimal experiment brief flow.",
      workClassification: "autonomous"
    })
  ).project;
}
