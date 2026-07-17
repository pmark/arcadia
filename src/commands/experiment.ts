import { projectNotFound, validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  createArtifactRecord,
  createReviewItem,
  createWorkItemRecord,
  getBackBurnerItem,
  getProject,
  getProjectMetadata,
  listProjects,
  updateBackBurnerItem
} from "../db/repositories.js";
import type { Artifact, BackBurnerItemSummary, Project, ReviewItemSummary, WorkItem } from "../domain/types.js";
import {
  buildExperimentBriefRelativePath,
  renderExperimentBriefMarkdown,
  writeExperimentBriefMarkdown
} from "../markdown/experimentBrief.js";

export interface ExperimentBriefOptions {
  workspace: string;
  project: string;
  opportunity: string;
  hypothesis: string;
  metric: string;
  baseline?: string;
  evidenceNeeded: string;
  decisionCriteria: string;
  recommendedNextAction: string;
  sourceBackBurnerItemId?: string;
}

export interface ExperimentBriefCommandData {
  project: Project;
  workItem: WorkItem;
  artifact: Artifact;
  reviewItem: ReviewItemSummary;
  artifactPath: string;
  sourceBackBurnerItem: BackBurnerItemSummary | null;
}

interface NormalizedExperimentBriefInput {
  projectIdentifier: string;
  opportunity: string;
  hypothesis: string;
  metric: string;
  baseline: string;
  evidenceNeeded: string;
  decisionCriteria: string;
  recommendedNextAction: string;
  sourceBackBurnerItemId: string | null;
}

export function runExperimentBriefCommand(
  options: ExperimentBriefOptions
): CommandSuccess<ExperimentBriefCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const input = normalizeExperimentBriefOptions(options);

  const created = withDatabase(workspacePath, (db) => {
    const project = resolveProject(db, input.projectIdentifier);
    if (!project) {
      throw projectNotFound(input.projectIdentifier);
    }

    const sourceBackBurnerItem = input.sourceBackBurnerItemId
      ? getBackBurnerItem(db, input.sourceBackBurnerItemId)
      : null;
    if (input.sourceBackBurnerItemId && !sourceBackBurnerItem) {
      throw validationError("Back Burner item was not found.", { id: input.sourceBackBurnerItemId });
    }
    if (sourceBackBurnerItem?.status === "promoted") {
      throw validationError("Back Burner item is already promoted.", { id: sourceBackBurnerItem.id });
    }

    const relativeArtifactPath = buildExperimentBriefRelativePath({
      projectSlug: project.slug,
      opportunity: input.opportunity
    });
    const markdown = renderExperimentBriefMarkdown({
      project,
      opportunity: input.opportunity,
      hypothesis: input.hypothesis,
      metric: input.metric,
      baseline: input.baseline,
      evidenceNeeded: input.evidenceNeeded,
      decisionCriteria: input.decisionCriteria,
      recommendedNextAction: input.recommendedNextAction
    });

    const result = db.transaction(() => {
      const workItem = createWorkItemRecord(db, {
        projectId: project.id,
        title: `Review experiment brief: ${input.opportunity}`,
        rawInput: input.opportunity,
        queue: "requires_review",
        workClassification: "requires_review",
        nextAction: input.recommendedNextAction,
        expectedArtifact: "Experiment brief"
      });
      const artifact = createArtifactRecord(db, {
        projectId: project.id,
        workItemId: workItem.id,
        title: "Experiment brief",
        artifactType: "experiment_brief",
        status: "drafted",
        path: relativeArtifactPath
      });
      const reviewItem = createReviewItem(db, {
        projectId: project.id,
        workItemId: workItem.id,
        artifactId: artifact.id,
        decisionNeeded: "Approve, revise, defer, or reject this experiment.",
        recommendation: input.recommendedNextAction,
        sourceInput: input.opportunity,
        proposedAction: "Review the experiment brief and decide whether the experiment should proceed.",
        resolvedIntent: "ExperimentBriefReview",
        confidenceLabel: "deterministic",
        confidence: 1,
        context: {
          opportunity: input.opportunity,
          hypothesis: input.hypothesis,
          metric: input.metric,
          baseline: input.baseline,
          evidenceNeeded: input.evidenceNeeded,
          decisionCriteria: input.decisionCriteria,
          recommendedNextAction: input.recommendedNextAction,
          sourceBackBurnerItemId: sourceBackBurnerItem?.id ?? null
        }
      });
      const updatedSourceBackBurnerItem = sourceBackBurnerItem
        ? updateBackBurnerItem(db, sourceBackBurnerItem.id, {
            status: "promoted",
            promotedWorkItemId: workItem.id
          })
        : null;

      return {
        project,
        workItem,
        artifact,
        reviewItem,
        artifactPath: relativeArtifactPath,
        markdown,
        sourceBackBurnerItem: updatedSourceBackBurnerItem
      };
    })();

    writeExperimentBriefMarkdown(workspacePath, result.artifactPath, result.markdown);

    return result;
  });

  return createSuccess({
    command: "experiment.brief",
    workspace: workspacePath,
    data: {
      project: created.project,
      workItem: created.workItem,
      artifact: created.artifact,
      reviewItem: created.reviewItem,
      artifactPath: created.artifactPath,
      sourceBackBurnerItem: created.sourceBackBurnerItem
    },
    artifacts: [created.artifactPath]
  });
}

export function renderExperimentBriefSuccess(response: CommandSuccess<ExperimentBriefCommandData>): string[] {
  return [
    "Experiment brief created.",
    `Project: ${response.data.project.name}`,
    `Action: ${response.data.workItem.id}`,
    `Artifact: ${response.data.artifactPath}`,
    `Decision: ${response.data.reviewItem.slug ?? response.data.reviewItem.id}`,
    `Source Back Burner item: ${response.data.sourceBackBurnerItem?.id ?? "None"}`
  ];
}

function normalizeExperimentBriefOptions(options: ExperimentBriefOptions): NormalizedExperimentBriefInput {
  return {
    projectIdentifier: requiredField("project", options.project),
    opportunity: requiredField("opportunity", options.opportunity),
    hypothesis: requiredField("hypothesis", options.hypothesis),
    metric: requiredField("metric", options.metric),
    baseline: options.baseline?.trim() || "Baseline unknown",
    evidenceNeeded: requiredField("evidence needed", options.evidenceNeeded),
    decisionCriteria: requiredField("decision criteria", options.decisionCriteria),
    recommendedNextAction: requiredField("recommended next action", options.recommendedNextAction),
    sourceBackBurnerItemId: options.sourceBackBurnerItemId?.trim() || null
  };
}

function requiredField(label: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw validationError(`${label} is required.`, { field: label });
  }
  return trimmed;
}

function resolveProject(db: Parameters<typeof getProject>[0], identifier: string): Project | null {
  const byId = getProject(db, identifier);
  if (byId) {
    return byId;
  }

  const normalized = identifier.trim().toLowerCase();
  const matches = listProjects(db).filter((project) => {
    const metadata = getProjectMetadata(db, project.id);
    const aliases = decodeStringArray(metadata?.aliases);
    return [project.slug, project.name, ...aliases].some((candidate) => candidate.toLowerCase() === normalized);
  });

  if (matches.length > 1) {
    throw validationError("Project identifier is ambiguous.", {
      project: identifier,
      matches: matches.map((project) => project.id)
    });
  }

  return matches[0] ?? null;
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}
