import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";
import {
  PROJECT_STATUSES,
  QUEUES,
  WORK_CLASSIFICATIONS,
  type ProjectStatus,
  type QueueName,
  type WorkClassification
} from "../domain/constants.js";
import type { CreateProjectInput, CreateWorkItemInput, Milestone, Project } from "../domain/types.js";

const NO_SELECTION = "__none__";

export async function promptForProjectCreate(): Promise<CreateProjectInput> {
  intro("Create Arcadia project");

  const input: CreateProjectInput = {
    name: await promptRequiredText("Project name"),
    mission: await promptRequiredText("Mission"),
    goal: await promptOptionalText("Goal"),
    status: await promptProjectStatus("Status"),
    currentMilestone: await promptRequiredText("Current milestone"),
    nextAction: await promptRequiredText("Next action"),
    expectedArtifact: await promptOptionalText("Expected artifact"),
    workClassification: await promptWorkClassification("Work classification")
  };

  outro("Project captured");
  return input;
}

export async function promptForInboxItem(projects: Project[], milestones: Milestone[]): Promise<CreateWorkItemInput> {
  intro("Add inbox item");
  const rawInput = await promptRequiredText("Raw input");
  const projectId = await promptOptionalProject(projects, "Project");
  const milestoneId = projectId
    ? await promptOptionalMilestone(
        milestones.filter((milestone) => milestone.project_id === projectId),
        "Milestone"
      )
    : null;
  const queue = await promptQueue("Queue");
  const workClassification = await promptWorkClassification("Work classification");
  const nextAction = await promptRequiredText("Next action");
  const expectedArtifact = await promptOptionalText("Expected artifact");

  outro("Inbox item captured");
  return {
    projectId,
    milestoneId,
    title: rawInput.split(/\r?\n/)[0]?.trim() || "Inbox item",
    rawInput,
    queue,
    workClassification,
    nextAction,
    expectedArtifact
  };
}

export async function promptForMissionLog(projects: Project[], milestones: Milestone[]) {
  intro("Create mission log");

  const projectId = await promptRequiredProject(projects, "Project");
  const milestoneId = await promptOptionalMilestone(
    milestones.filter((milestone) => milestone.project_id === projectId),
    "Milestone"
  );
  const workPerformed = await promptRequiredText("Work performed");
  const result = await promptRequiredText("Result");
  const blockers = await promptOptionalText("Blockers");
  const nextAction = await promptRequiredText("Next action");
  const artifactImpact = await promptOptionalText("Artifact impact");

  outro("Mission log captured");
  return {
    projectId,
    milestoneId,
    workPerformed,
    result,
    blockers,
    nextAction,
    artifactImpact
  };
}

async function promptRequiredText(message: string): Promise<string> {
  const value = await text({
    message,
    validate(input) {
      if (!input?.trim()) {
        return "Required";
      }

      return undefined;
    }
  });

  return unwrapPromptValue(value).trim();
}

async function promptOptionalText(message: string): Promise<string | undefined> {
  const value = await text({ message });
  const unwrapped = unwrapPromptValue(value).trim();
  return unwrapped || undefined;
}

async function promptProjectStatus(message: string): Promise<ProjectStatus> {
  const value = await select({
    message,
    options: PROJECT_STATUSES.map((status) => ({ value: status, label: status }))
  });

  return unwrapPromptValue(value) as ProjectStatus;
}

async function promptQueue(message: string): Promise<QueueName> {
  const value = await select({
    message,
    options: QUEUES.map((queue) => ({ value: queue, label: queue }))
  });

  return unwrapPromptValue(value) as QueueName;
}

async function promptWorkClassification(message: string): Promise<WorkClassification> {
  const value = await select({
    message,
    options: WORK_CLASSIFICATIONS.map((classification) => ({ value: classification, label: classification }))
  });

  return unwrapPromptValue(value) as WorkClassification;
}

async function promptOptionalProject(projects: Project[], message: string): Promise<string | null> {
  if (projects.length === 0) {
    return null;
  }

  const value = await select({
    message,
    options: [
      { value: NO_SELECTION, label: "No project" },
      ...projects.map((project) => ({ value: project.id, label: project.name }))
    ]
  });

  const unwrapped = unwrapPromptValue(value);
  return unwrapped === NO_SELECTION ? null : unwrapped;
}

async function promptRequiredProject(projects: Project[], message: string): Promise<string> {
  if (projects.length === 0) {
    throw new Error("Create a project before creating a mission log.");
  }

  const value = await select({
    message,
    options: projects.map((project) => ({ value: project.id, label: project.name }))
  });

  return unwrapPromptValue(value);
}

async function promptOptionalMilestone(milestones: Milestone[], message: string): Promise<string | null> {
  if (milestones.length === 0) {
    return null;
  }

  const value = await select({
    message,
    options: [
      { value: NO_SELECTION, label: "No milestone" },
      ...milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))
    ]
  });

  const unwrapped = unwrapPromptValue(value);
  return unwrapped === NO_SELECTION ? null : unwrapped;
}

function unwrapPromptValue(value: string | symbol): string {
  if (isCancel(value)) {
    cancel("Cancelled");
    process.exit(1);
  }

  return String(value);
}
