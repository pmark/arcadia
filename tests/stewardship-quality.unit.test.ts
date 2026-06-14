import { describe, expect, it } from "vitest";
import { resolveIntent } from "../src/intent/resolver.js";
import { resolveIntake, type IntakeWorkspaceContext } from "../src/intake/index.js";
import { stewardIntent } from "../src/stewardship/index.js";
import { defaultProjects, stewardshipQualityFixtures, type StewardshipQualityFixture } from "./stewardshipQualityFixtures.js";

describe("stewardship quality unit fixtures", () => {
  for (const fixture of stewardshipQualityFixtures) {
    it(fixture.name, () => {
      const context = intakeContextForFixture(fixture);
      const intake = resolveIntake(fixture.input, context);
      const resolved = resolveIntent(fixture.input, emptyRegistries());
      const stewardship = stewardIntent({
        rawInput: fixture.input,
        intake,
        resolved: resolvedFromIntakeForUnit(fixture.input, intake),
        workspaceContext: context
      });

      expect(stewardship.intentType).toBe(fixture.expect.intentType);
      expect(stewardship.recommendedExecutionPath).toBe(fixture.expect.executionPath);
      expect(intake.confidenceLabel).toBe(fixture.expect.confidenceLabel);
      expect(stewardship.relatedProject?.name ?? null).toBe(fixture.expect.project);

      if (fixture.expect.clarificationRequired !== undefined) {
        expect(stewardship.clarificationRequired).toBe(fixture.expect.clarificationRequired);
      }

      if (fixture.expect.reviewRequired !== undefined) {
        expect(stewardship.reviewRequired).toBe(fixture.expect.reviewRequired);
      }

      if (fixture.expect.planningRecommended !== undefined) {
        expect(stewardship.planningRecommended).toBe(fixture.expect.planningRecommended);
      }

      for (const [slot, expected] of Object.entries(fixture.expect.slots ?? {})) {
        expect(intake.extractedFields[slot], `${fixture.name}: ${slot}`).toBe(expected);
      }

      for (const phrase of fixture.expect.knownBadPhrasesAbsent ?? []) {
        expect([
          intake.extractedFields.value ?? "",
          intake.proposedAction,
          stewardship.generatedCodexGoalText ?? "",
          stewardship.classificationReason
        ].join("\n")).not.toContain(phrase);
      }

      if (stewardship.recommendedExecutionPath === "Execute Directly") {
        expect(stewardship.classificationReason).not.toMatch(/project needs confirmation/i);
      }

      expect(resolved).toBeTruthy();
    });
  }
});

function intakeContextForFixture(fixture: StewardshipQualityFixture): IntakeWorkspaceContext {
  return {
    projects: fixture.seed.projects.map((project, index) => ({
      id: `project_${project.name.toLowerCase().replaceAll(/\W+/g, "_") || index}`,
      name: project.name,
      goal: project.goal ?? null,
      aliases: project.aliases ?? [project.name],
      activeMilestoneId: project.activeMilestone ? `milestone_${index}` : null,
      activeMilestoneTitle: project.activeMilestone ?? null
    })),
    recentActivity: fixture.seed.recentActivity?.map((activity, index) => {
      const project = fixture.seed.projects.find((candidate) => candidate.name === activity.project);
      return {
        id: `recent_${index}`,
        projectId: project ? `project_${project.name.toLowerCase().replaceAll(/\W+/g, "_")}` : null,
        projectName: activity.project,
        title: activity.title
      };
    })
  };
}

function resolvedFromIntakeForUnit(input: string, intake: ReturnType<typeof resolveIntake>): ReturnType<typeof resolveIntent> {
  const resolved = resolveIntent(input, emptyRegistries());
  if (intake.action.kind !== "create_work") {
    return resolved;
  }

  return {
    ...resolved,
    intentId: intake.resolvedIntent,
    matched: intake.confidenceLabel === "high",
    title: intake.action.title,
    outputKind: "codex_build_packet",
    workClassification: "codex",
    expectedArtifact: intake.extractedFields.requestedArtifact ?? "Requested work artifact",
    slots: intake.extractedFields,
    codexPurpose: "build"
  };
}

function emptyRegistries(): Parameters<typeof resolveIntent>[1] {
  return {
    intents: { version: 1, intents: [] },
    templates: { version: 1, templates: [] },
    codingAgents: { version: 1, profiles: [] }
  };
}

expect(defaultProjects.length).toBeGreaterThan(0);
