import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatRequest } from "../apps/discord-bot/src/formatters/requestFormatter.js";
import { runAskCommand, type AskCommandData } from "../src/commands/ask.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import type { CommandSuccess } from "../src/cli/response.js";
import { withDatabase } from "../src/db/connection.js";
import {
  createProjectWithInitialWork,
  getProject,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { stewardshipQualityFixtures, type StewardshipQualityFixture } from "./stewardshipQualityFixtures.js";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("stewardship quality integration fixtures", () => {
  for (const fixture of stewardshipQualityFixtures) {
    it(fixture.name, () => {
      const workspace = initializedWorkspace(fixture);
      const initial = runAskCommand({ workspace, request: fixture.input });
      const response = responseWithPacketIfNeeded(workspace, initial);

      expect(initial.data.stewardship.intentType).toBe(fixture.expect.intentType);
      expect(initial.data.stewardship.recommendedExecutionPath).toBe(fixture.expect.executionPath);
      expect(initial.data.intake.confidenceLabel).toBe(fixture.expect.confidenceLabel);
      expect(initial.data.stewardship.relatedProject?.name ?? null).toBe(fixture.expect.project);

      for (const [slot, expected] of Object.entries(fixture.expect.slots ?? {})) {
        expect(initial.data.intake.extractedFields[slot], `${fixture.name}: ${slot}`).toBe(expected);
      }

      const requestedArtifact = response.data.workItem?.expected_artifact ??
        initial.data.resolvedIntent.expectedArtifact ??
        (initial.data.project ? "Project mission update" : "");
      for (const phrase of fixture.expect.requestedWorkArtifactIncludes ?? []) {
        expect(requestedArtifact, `${fixture.name}: requested artifact`).toContain(phrase);
      }

      for (const phrase of fixture.expect.knownBadPhrasesAbsent ?? []) {
        expect([
          initial.data.intake.extractedFields.value ?? "",
          initial.data.resolvedIntent.expectedArtifact ?? "",
          response.data.workItem?.expected_artifact ?? "",
          initial.data.stewardship.generatedCodexGoalText ?? "",
          initial.data.stewardship.classificationReason
        ].join("\n")).not.toContain(phrase);
      }

      if (fixture.expect.packetIncludes || fixture.expect.packetArtifactIncludes || response.data.codexInvocations.length > 0) {
        const packet = response.data.codexInvocations[0];
        expect(packet, `${fixture.name}: packet`).toBeTruthy();
        const promptPath = path.join(workspace, packet.prompt_path);
        expect(existsSync(promptPath)).toBe(true);
        const prompt = readFileSync(promptPath, "utf8");

        for (const phrase of [
          "## Goal",
          "## Why This Matters",
          "## Original Input",
          "## Stewardship Decision",
          "## Target Project Context",
          "## Current Milestone",
          "## Repository / Path Context",
          "## Operator Context",
          "## Constraints",
          "## Approval Boundaries",
          "## Expected Artifact",
          "## Execution Instruction",
          "## Discovery And Validation",
          "## Final Reporting Requirements",
          ...(fixture.expect.packetIncludes ?? []),
          ...(fixture.expect.packetArtifactIncludes ?? [])
        ]) {
          expect(prompt, `${fixture.name}: packet includes ${phrase}`).toContain(phrase);
        }

        for (const phrase of fixture.expect.knownBadPhrasesAbsent ?? []) {
          expect(prompt, `${fixture.name}: packet excludes ${phrase}`).not.toContain(phrase);
        }
      }

      const discordSummary = formatRequest(response.data);
      expect(discordSummary).toContain("Stewardship:");
      expect(discordSummary).toContain("Next action:");
      expect(discordSummary).toContain("Expected artifact:");
      if (fixture.expect.project) {
        expect(discordSummary).toContain(`Project: ${fixture.expect.project}`);
      }

      if (fixture.name === "mission update stores clean value") {
        const projectId = initial.data.project?.id;
        expect(projectId).toBeTruthy();
        const project = withDatabase(workspace, (db) => getProject(db, projectId ?? ""));
        expect(project?.mission).toBe("Help creators publish evidence-backed posts");
        expect(project?.mission).not.toContain("Change Rebuster");
      }
    });
  }
});

function responseWithPacketIfNeeded(
  workspace: string,
  initial: CommandSuccess<AskCommandData>
): CommandSuccess<AskCommandData> {
  if (initial.data.reviewItemId && initial.data.stewardship.planningRecommended) {
    const approved = runReviewApproveCommand({ workspace, id: initial.data.reviewItemId });
    if (!approved.data.approval) {
      throw new Error(`Expected approval data for ${initial.data.reviewItemId}`);
    }
    return {
      ...approved,
      data: approved.data.approval
    };
  }

  return initial;
}

function initializedWorkspace(fixture: StewardshipQualityFixture): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-stewardship-quality-"));
  workspaces.push(workspace);
  initWorkspace(workspace);

  withDatabase(workspace, (db) => {
    for (const project of fixture.seed.projects) {
      const created = createProjectWithInitialWork(db, {
        name: project.name,
        mission: project.mission,
        goal: project.goal,
        status: "active",
        currentMilestone: project.activeMilestone ?? "Current milestone",
        nextAction: project.nextAction ?? "Continue stewardship hardening.",
        expectedArtifact: "Seed artifact",
        workClassification: "codex"
      });
      upsertProjectMetadata(db, {
        projectId: created.project.id,
        aliases: project.aliases ?? [project.name],
        repoPath: project.repoPath,
        validationCommands: project.validationCommands
      });
    }
  });

  return workspace;
}
