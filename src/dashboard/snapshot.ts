import type { ArtifactSummary, ExecutionRunSummary, MilestoneSummary, WorkItemSummary } from "../domain/types.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import {
  buildStatusReportData,
  listArtifacts,
  listExecutionRuns,
  listMilestones
} from "../db/repositories.js";

export interface DashboardSnapshotOptions {
  workspace: string;
  runLimit?: number;
  artifactLimit?: number;
  milestoneLimit?: number;
}

export interface DashboardSnapshot {
  generatedAt: string;
  workspace: string;
  counts: {
    activeProjects: number;
    pausedProjects: number;
    incubatingProjects: number;
    totalProjects: number;
    requiresReview: number;
    recentRuns: number;
    recentArtifacts: number;
  };
  projects: DashboardProject[];
  currentMilestones: DashboardMilestone[];
  requiresReviewItems: DashboardReviewItem[];
  recentRuns: DashboardRun[];
  recentArtifacts: DashboardArtifact[];
}

export interface DashboardProject {
  id: string;
  name: string;
  mission: string;
  goal: string | null;
  status: string;
  statusLabel: string;
  currentMilestone: string | null;
  currentMilestoneId: string | null;
  nextAction: string | null;
  workClassification: string | null;
  workClassificationLabel: string | null;
  lastArtifact: DashboardArtifact | null;
  updatedAt: string;
}

export interface DashboardMilestone {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
}

export interface DashboardReviewItem {
  id: string;
  title: string;
  projectName: string | null;
  milestoneTitle: string | null;
  nextAction: string;
  expectedArtifact: string | null;
  queue: string;
  queueLabel: string;
  workClassification: string;
  workClassificationLabel: string;
  status: string;
  statusLabel: string;
  updatedAt: string;
}

export interface DashboardRun {
  id: string;
  status: string;
  statusLabel: string;
  startedAt: string;
  completedAt: string | null;
  workItemTitle: string;
  summary: string;
  planSummary: string;
  artifactsProduced: DashboardArtifact[];
  failureReason: string | null;
  reviewReason: string | null;
  missionLogPath: string | null;
}

export interface DashboardArtifact {
  id: string;
  title: string;
  artifactType: string;
  status: string;
  statusLabel: string;
  path: string | null;
  projectName: string | null;
  workItemTitle: string | null;
  updatedAt: string;
}

export function buildDashboardSnapshot(options: DashboardSnapshotOptions): DashboardSnapshot {
  const runLimit = options.runLimit ?? 10;
  const artifactLimit = options.artifactLimit ?? 10;
  const milestoneLimit = options.milestoneLimit ?? 20;

  return withReadOnlyDatabase(options.workspace, (db) => {
    const statusData = buildStatusReportData(db, options.workspace);
    const artifacts = listArtifacts(db);
    const runs = listExecutionRuns(db, runLimit);
    const currentMilestones = listMilestones(db, { status: "active", limit: milestoneLimit });
    const lastArtifactByProject = new Map<string, DashboardArtifact>();

    for (const artifact of artifacts) {
      if (artifact.project_id && !lastArtifactByProject.has(artifact.project_id)) {
        lastArtifactByProject.set(artifact.project_id, toDashboardArtifact(artifact));
      }
    }

    const projects = statusData.projects.map((project) => ({
      id: project.id,
      name: project.name,
      mission: project.mission,
      goal: project.goal,
      status: project.status,
      statusLabel: labelStatus(project.status),
      currentMilestone: project.current_milestone,
      currentMilestoneId: project.current_milestone_id,
      nextAction: project.next_action,
      workClassification: project.work_classification,
      workClassificationLabel: project.work_classification
        ? labelWorkClassification(project.work_classification)
        : null,
      lastArtifact: lastArtifactByProject.get(project.id) ?? null,
      updatedAt: project.updated_at
    }));

    return {
      generatedAt: statusData.generatedAt,
      workspace: options.workspace,
      counts: {
        activeProjects: statusData.projects.filter((project) => project.status === "active").length,
        pausedProjects: statusData.projects.filter((project) => project.status === "paused").length,
        incubatingProjects: statusData.projects.filter((project) => project.status === "incubating").length,
        totalProjects: statusData.projects.length,
        requiresReview: statusData.needsMarkItems.length,
        recentRuns: runs.length,
        recentArtifacts: Math.min(artifacts.length, artifactLimit)
      },
      projects,
      currentMilestones: currentMilestones.map(toDashboardMilestone),
      requiresReviewItems: statusData.needsMarkItems.map(toDashboardReviewItem),
      recentRuns: runs.map(toDashboardRun),
      recentArtifacts: artifacts.slice(0, artifactLimit).map(toDashboardArtifact)
    };
  });
}

function toDashboardMilestone(milestone: MilestoneSummary): DashboardMilestone {
  return {
    id: milestone.id,
    projectId: milestone.project_id,
    projectName: milestone.project_name,
    title: milestone.title,
    status: milestone.status,
    statusLabel: labelStatus(milestone.status),
    updatedAt: milestone.updated_at
  };
}

function toDashboardReviewItem(item: WorkItemSummary): DashboardReviewItem {
  return {
    id: item.id,
    title: item.title,
    projectName: item.project_name,
    milestoneTitle: item.milestone_title,
    nextAction: item.next_action,
    expectedArtifact: item.expected_artifact,
    queue: item.queue,
    queueLabel: labelQueue(item.queue),
    workClassification: item.work_classification,
    workClassificationLabel: labelWorkClassification(item.work_classification),
    status: item.status,
    statusLabel: labelStatus(item.status),
    updatedAt: item.updated_at
  };
}

function toDashboardRun(run: ExecutionRunSummary): DashboardRun {
  const failedStep = run.steps.find((step) => step.status === "failed");
  const reviewStep = run.steps.find((step) => step.status === "needs_mark");

  return {
    id: run.id,
    status: run.status,
    statusLabel: labelStatus(run.status),
    startedAt: run.created_at,
    completedAt: run.status === "running" ? null : run.updated_at,
    workItemTitle: run.work_item_title,
    summary: run.summary,
    planSummary: run.plan_summary,
    artifactsProduced: run.artifacts.map(toDashboardArtifact),
    failureReason: failedStep ? stepReason(failedStep) : null,
    reviewReason: reviewStep ? stepReason(reviewStep) : null,
    missionLogPath: run.mission_log_path
  };
}

function toDashboardArtifact(artifact: ArtifactSummary): DashboardArtifact {
  return {
    id: artifact.id,
    title: artifact.title,
    artifactType: artifact.artifact_type,
    status: artifact.status,
    statusLabel: labelStatus(artifact.status),
    path: artifact.path,
    projectName: artifact.project_name,
    workItemTitle: artifact.work_item_title,
    updatedAt: artifact.updated_at
  };
}

function stepReason(step: ExecutionRunSummary["steps"][number]): string {
  return step.error ?? step.output ?? step.plan_step_title;
}

function labelQueue(queue: string): string {
  if (queue === "needs_mark") {
    return "Requires Review";
  }

  return labelStatus(queue);
}

function labelWorkClassification(classification: string): string {
  if (classification === "needs_mark") {
    return "Requires Review";
  }

  return labelStatus(classification);
}

function labelStatus(status: string): string {
  if (status === "needs_mark") {
    return "Requires Review";
  }

  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
