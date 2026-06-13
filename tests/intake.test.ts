import { describe, expect, it } from "vitest";
import { resolveIntake, type IntakeWorkspaceContext } from "../src/intake/index.js";

const context: IntakeWorkspaceContext = {
  projects: [
    {
      id: "project_rebuster",
      name: "Rebuster",
      goal: "Improve publishing workflows.",
      aliases: ["rebuster app"],
      activeMilestoneId: "milestone_pinterest",
      activeMilestoneTitle: "Pinterest publishing"
    },
    {
      id: "project_midi",
      name: "MIDI Opener",
      goal: "Improve App Store conversion.",
      aliases: ["midi opener app"],
      activeMilestoneId: "milestone_conversion",
      activeMilestoneTitle: "Conversion improvements"
    }
  ]
};

describe("Arcadia Intake", () => {
  it("detects review and status intents deterministically", () => {
    expect(resolveIntake("What needs review?", context).resolvedIntent).toBe("ReviewRequired");
    expect(resolveIntake("What should I focus on today?", context).resolvedIntent).toBe("ShowStatus");
  });

  it("extracts goal updates and fuzzy matches project names", () => {
    const result = resolveIntake("The goal for midi opener app is to improve App Store conversion.", context);

    expect(result.resolvedIntent).toBe("UpdateEntityAttribute");
    expect(result.confidenceLabel).toBe("high");
    expect(result.project?.id).toBe("project_midi");
    expect(result.extractedFields.attribute).toBe("goal");
    expect(result.extractedFields.value).toBe("improve App Store conversion");
    expect(result.action).toMatchObject({
      kind: "update_entity_attribute",
      entityType: "project",
      entityId: "project_midi",
      attribute: "goal",
      value: "improve App Store conversion",
      deterministicHandler: "project.update.goal"
    });
    expect(result.missingFields).toEqual([]);
  });

  it("extracts templated project creation and fuzzy matches templates", () => {
    const result = resolveIntake("Create a NextJS app called Rebuster Admin.", context);

    expect(result.resolvedIntent).toBe("InstantiateProject");
    expect(result.confidenceLabel).toBe("high");
    expect(result.template?.id).toBe("nextjs_web_app");
    expect(result.extractedFields.projectName).toBe("Rebuster Admin");
    expect(result.safeToExecute).toBe(false);
  });

  it("extracts plain project creation without requiring a template", () => {
    const result = resolveIntake("Create a project called Boring Defaults.", context);

    expect(result.resolvedIntent).toBe("CreateProject");
    expect(result.confidenceLabel).toBe("high");
    expect(result.extractedFields.projectName).toBe("Boring Defaults");
    expect(result.action).toMatchObject({ kind: "create_project", projectName: "Boring Defaults" });
    expect(result.safeToExecute).toBe(true);
  });

  it("extracts create-work requests and resolves projects", () => {
    const result = resolveIntake("Add Pinterest publishing support to Rebuster.", context);

    expect(result.resolvedIntent).toBe("CreateWork");
    expect(result.confidenceLabel).toBe("high");
    expect(result.project?.id).toBe("project_rebuster");
    expect(result.extractedFields.action).toBe("Pinterest publishing support");
  });

  it("extracts pause and resume project status requests", () => {
    const paused = resolveIntake("Pause Rebuster.", context);
    const resumed = resolveIntake("Resume midi opener app.", context);

    expect(paused.resolvedIntent).toBe("UpdateEntityAttribute");
    expect(paused.confidenceLabel).toBe("high");
    expect(paused.action).toMatchObject({
      kind: "update_entity_attribute",
      entityId: "project_rebuster",
      attribute: "status",
      value: "paused"
    });
    expect(resumed.resolvedIntent).toBe("UpdateEntityAttribute");
    expect(resumed.confidenceLabel).toBe("high");
    expect(resumed.action).toMatchObject({
      kind: "update_entity_attribute",
      entityId: "project_midi",
      attribute: "status",
      value: "active"
    });
  });

  it("requires review for unsupported attributes and invalid values", () => {
    const unknownAttribute = resolveIntake("Set Rebuster priority to High.", context);
    const invalidStatus = resolveIntake("Set Rebuster status to shipped.", context);

    expect(unknownAttribute.resolvedIntent).toBe("UpdateEntityAttribute");
    expect(unknownAttribute.action).toMatchObject({ kind: "update_entity_attribute", attribute: null });
    expect(unknownAttribute.missingFields).toContain("attribute");
    expect(unknownAttribute.reviewRequired).toBe(true);

    expect(invalidStatus.resolvedIntent).toBe("UpdateEntityAttribute");
    expect(invalidStatus.action).toMatchObject({
      kind: "update_entity_attribute",
      attribute: "status",
      value: "shipped"
    });
    expect(invalidStatus.missingFields).toContain("attributeValue");
    expect(invalidStatus.extractedFields.invalidReason).toContain("status must be one of");
    expect(invalidStatus.reviewRequired).toBe(true);
  });

  it("requires review when a project field is missing", () => {
    const result = resolveIntake("Add Pinterest publishing support to Unknown App.", context);

    expect(result.resolvedIntent).toBe("CreateWork");
    expect(result.confidenceLabel).toBe("medium");
    expect(result.missingFields).toContain("project");
    expect(result.reviewRequired).toBe(true);
  });

  it("captures low-confidence thoughts instead of discarding them", () => {
    const result = resolveIntake("Pinterest might help Rebuster.", context);

    expect(result.resolvedIntent).toBe("CaptureThought");
    expect(result.confidenceLabel).toBe("low");
    expect(result.project?.id).toBe("project_rebuster");
    expect(result.reviewRequired).toBe(true);
  });
});
