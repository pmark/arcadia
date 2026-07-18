import type Database from "better-sqlite3";
import type { RequiresReviewPacket } from "../commands/review.js";
import { reviewPacketForReviewItem } from "../commands/review.js";
import type { ArtifactSummary, BackBurnerItemSummary, ExecutionRunSummary, MilestoneSummary } from "../domain/types.js";
import { listCapabilities } from "../capabilities/registry.js";
import { listBlogDashboardSites, listBlogReviewItems } from "../capabilities/blogging/repository.js";
import {
  decodeRebusterArtifactRefs,
  listOpenRebusterDecisionEvents,
  listRebusterEvents,
  listRebusterIntegrations,
  type RebusterArtifactRef,
  type RebusterEventSummary,
  type RebusterIntegration
} from "../capabilities/rebuster/repository.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import {
  buildStatusReportData,
  getProjectMetadata,
  getExecutionRun,
  listBackBurnerItems,
  listActionableReviewItems,
  listArtifacts,
  listExecutionRuns,
  listMilestones
} from "../db/repositories.js";
import { CODEX_REPO_PATH_REQUIRED_MESSAGE } from "../projects/setup.js";
import { selectDailyAdvantage, type DashboardDailyAdvantage } from "./dailyAdvantage.js";

export const MISSING_REPO_PATH_WARNING = CODEX_REPO_PATH_REQUIRED_MESSAGE;

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
    attention: number;
    requiresReview: number;
    backBurner: number;
    activeRuns: number;
    recentRuns: number;
    recentArtifacts: number;
    activityEvents: number;
  };
  dailyAdvantage: DashboardDailyAdvantage | null;
  projects: DashboardProject[];
  attentionItems: DashboardAttentionItem[];
  activityEvents: DashboardActivityEvent[];
  capabilities: DashboardCapability[];
  blogging: DashboardBloggingSnapshot;
  rebuster: DashboardRebusterSnapshot;
  currentMilestones: DashboardMilestone[];
  requiresReviewItems: DashboardReviewItem[];
  backBurnerItems: DashboardBackBurnerItem[];
  recentRuns: DashboardRun[];
  recentArtifacts: DashboardArtifact[];
}

export interface DashboardProject {
  id: string;
  name: string;
  mission: string;
  goal: string | null;
  outcome: string | null;
  status: string;
  statusLabel: string;
  currentMilestone: string | null;
  currentMilestoneId: string | null;
  nextAction: string | null;
  workClassification: string | null;
  responsibility: string | null;
  workClassificationLabel: string | null;
  responsibilityLabel: string | null;
  repoPath: string | null;
  statusSummary: string | null;
  validationCommands: string[];
  setupWarnings: string[];
  lastArtifact: DashboardArtifact | null;
  updatedAt: string;
}

export interface DashboardCapability {
  id: string;
  name: string;
  version: string;
  status: "available";
  dashboardSurfaces: string[];
}

export interface DashboardBloggingSnapshot {
  sites: DashboardBlogSite[];
  reviewItems: DashboardBlogReviewItem[];
}

export interface DashboardBlogSite {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  streamKey: string;
  status: string;
  statusLabel: string;
  nextScheduledTitle: string | null;
  nextScheduledFor: string | null;
  draftsNeedingReview: number;
  ideasCount: number;
  postsCount: number;
  latestArtifactPath: string | null;
  updatedAt: string;
}

export interface DashboardBlogReviewItem {
  kind: "post" | "schedule";
  id: string;
  title: string;
  siteId: string;
  siteName: string;
  streamKey: string;
  projectId: string;
  projectName: string;
  status: string;
  statusLabel: string;
  artifactId: string | null;
  artifactPath: string | null;
  reviewItemId: string;
  reviewSlug: string | null;
  decisionNeeded: string;
  updatedAt: string;
}

export interface DashboardRebusterSnapshot {
  connection: DashboardRebusterConnection;
  status: DashboardRebusterStatus;
  decisions: DashboardRebusterDecision[];
  recentEvents: DashboardRebusterEvent[];
}

export interface DashboardRebusterConnection {
  configured: boolean;
  projectId: string | null;
  projectName: string | null;
  repoPath: string | null;
  baseUrl: string | null;
  dashboardUrl: string | null;
  status: "configured" | "unconfigured";
  statusLabel: string;
  statusSummary: string | null;
  lastHealthCheckAt: string | null;
  lastSyncAt: string | null;
  updatedAt: string | null;
}

export interface DashboardRebusterStatus {
  summary: string;
  lastEventType: string | null;
  lastEventAt: string | null;
  openDecisionCount: number;
  recentEventCount: number;
}

export interface DashboardRebusterEvent {
  id: string;
  externalId: string;
  eventType: string;
  eventLabel: string;
  rebusId: string;
  answer: string;
  status: string;
  statusLabel: string;
  summary: string;
  decisionRequired: boolean;
  recommendation: string | null;
  rebusterUrl: string;
  artifactRefs: RebusterArtifactRef[];
  occurredAt: string;
  updatedAt: string;
  projectId: string;
  projectName: string | null;
  reviewItemId: string | null;
  reviewSlug: string | null;
  reviewStatus: string | null;
}

export interface DashboardRebusterDecision {
  id: string;
  externalId: string;
  answer: string;
  status: string;
  statusLabel: string;
  summary: string;
  recommendation: string | null;
  rebusterUrl: string;
  occurredAt: string;
  projectId: string;
  projectName: string | null;
  reviewItemId: string;
  reviewSlug: string | null;
}

export interface DashboardAttentionItem {
  id: string;
  kind: "review" | "codex_packet" | "run" | "blocked_work";
  severity: "action" | "blocked" | "info";
  projectName: string | null;
  projectId: string | null;
  milestone: string | null;
  goal: string | null;
  outcome: string | null;
  status: string;
  statusLabel: string;
  reason: string;
  workItemId: string | null;
  actionId: string | null;
  workItemTitle: string | null;
  actionTitle: string | null;
  expectedArtifact: string | null;
  targetRepositoryRoot: string | null;
  relatedArtifactId: string | null;
  relatedArtifactTitle: string | null;
  relatedArtifactPath: string | null;
  finalArtifactPath: string | null;
  validationPath: string | null;
  relatedReviewId: string | null;
  relatedReviewSlug: string | null;
  relatedDecisionId: string | null;
  relatedDecisionSlug: string | null;
  relatedRunId: string | null;
  relatedCodexInvocationId: string | null;
  nextAction: string;
  interpretation: string | null;
  safetyBoundaries: string[];
  responsibility: string | null;
  primaryActions: DashboardAttentionAction[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardAttentionAction {
  label: string;
  kind: "view" | "approve" | "reject" | "defer" | "command";
  command: string | null;
  href: string | null;
  reviewAction: "approve" | "reject" | "defer" | null;
}

export interface DashboardActivityEvent {
  id: string;
  eventType: string;
  eventLabel: string;
  summary: string;
  projectName: string | null;
  projectId: string | null;
  askId: string | null;
  reviewId: string | null;
  reviewSlug: string | null;
  decisionId: string | null;
  decisionSlug: string | null;
  workItemId: string | null;
  actionId: string | null;
  workItemTitle: string | null;
  actionTitle: string | null;
  runId: string | null;
  artifactId: string | null;
  artifactPath: string | null;
  backBurnerItemId: string | null;
  codexInvocationId: string | null;
  occurredAt: string;
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

export interface DashboardReviewItem extends RequiresReviewPacket {
  displayId: string;
  statusLabel: string;
}

export interface DashboardBackBurnerItem {
  id: string;
  originalInput: string;
  ingressSource: string;
  classification: string;
  confidence: number;
  reason: string;
  status: string;
  statusLabel: string;
  suggestedNextStep: string | null;
  createdAt: string;
  updatedAt: string;
  promotedWorkItemId: string | null;
  promotedWorkItemTitle: string | null;
}

export interface DashboardRun {
  id: string;
  status: string;
  statusLabel: string;
  projectId: string | null;
  projectName: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  workItemTitle: string;
  actionTitle: string;
  summary: string;
  planSummary: string;
  currentStep: string | null;
  latestMessage: string;
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
  projectId: string | null;
  projectName: string | null;
  workItemTitle: string | null;
  actionTitle: string | null;
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
    const reviewItems = listActionableReviewItems(db);
    const bloggingSites = listBlogDashboardSites(db).map(toDashboardBlogSite);
    const bloggingReviewItems = listBlogReviewItems(db).map(toDashboardBlogReviewItem);
    const rebusterIntegrations = listRebusterIntegrations(db);
    const rebusterEvents = listRebusterEvents(db, 10);
    const rebusterDecisions = listOpenRebusterDecisionEvents(db);
    const attentionItems = buildAttentionItems(db, reviewItems.map(toDashboardReviewItem), runs);
    const activityEvents = buildActivityEvents(db, 30);
    const backBurnerItems = listBackBurnerItems(db, "all").filter((item) =>
      item.status === "incubating" || item.status === "opportunistic"
    );
    const dailyAdvantage = selectDailyAdvantage(db);
    const lastArtifactByProject = new Map<string, DashboardArtifact>();

    for (const artifact of artifacts) {
      if (artifact.project_id && !lastArtifactByProject.has(artifact.project_id)) {
        lastArtifactByProject.set(artifact.project_id, toDashboardArtifact(artifact));
      }
    }

    const projects = statusData.projects.map((project) => {
      const metadata = getProjectMetadata(db, project.id);
      const repoPath = metadata?.repo_path ?? null;
      return {
        id: project.id,
        name: project.name,
        mission: project.mission,
        goal: project.goal,
        outcome: project.outcome ?? project.goal,
        status: project.status,
        statusLabel: labelStatus(project.status),
        currentMilestone: project.current_milestone,
        currentMilestoneId: project.current_milestone_id,
        nextAction: project.next_action,
        workClassification: project.work_classification,
        responsibility: project.responsibility ?? project.work_classification,
        workClassificationLabel: project.work_classification
          ? labelWorkClassification(project.work_classification)
          : null,
        responsibilityLabel: (project.responsibility ?? project.work_classification)
          ? labelWorkClassification((project.responsibility ?? project.work_classification) as string)
          : null,
        repoPath,
        statusSummary: metadata?.status_summary ?? null,
        validationCommands: decodeStringArray(metadata?.validation_commands),
        setupWarnings: repoPath ? [] : [MISSING_REPO_PATH_WARNING],
        lastArtifact: lastArtifactByProject.get(project.id) ?? null,
        updatedAt: project.updated_at
      };
    });

    return {
      generatedAt: statusData.generatedAt,
      workspace: options.workspace,
      counts: {
        activeProjects: statusData.projects.filter((project) => project.status === "active").length,
        pausedProjects: statusData.projects.filter((project) => project.status === "paused").length,
        incubatingProjects: statusData.projects.filter((project) => project.status === "incubating").length,
        totalProjects: statusData.projects.length,
        attention: attentionItems.length,
        requiresReview: reviewItems.length,
        backBurner: backBurnerItems.length,
        activeRuns: runs.filter((run) => run.status === "running" || isRequiresReviewStatus(run.status)).length,
        recentRuns: runs.length,
        recentArtifacts: Math.min(artifacts.length, artifactLimit),
        activityEvents: activityEvents.length
      },
      dailyAdvantage,
      projects,
      attentionItems,
      activityEvents,
      capabilities: listCapabilities().map((module) => ({
        id: module.id,
        name: module.name,
        version: module.version,
        status: "available",
        dashboardSurfaces: module.dashboardSurfaces.map((surface) => surface.title)
      })),
      blogging: {
        sites: bloggingSites,
        reviewItems: bloggingReviewItems
      },
      rebuster: toDashboardRebusterSnapshot(db, rebusterIntegrations, rebusterEvents, rebusterDecisions),
      currentMilestones: currentMilestones.map(toDashboardMilestone),
      requiresReviewItems: reviewItems.map(toDashboardReviewItem),
      backBurnerItems: backBurnerItems.map(toDashboardBackBurnerItem),
      recentRuns: runs.map(toDashboardRun),
      recentArtifacts: artifacts.slice(0, artifactLimit).map(toDashboardArtifact)
    };
  });
}

function toDashboardBackBurnerItem(item: BackBurnerItemSummary): DashboardBackBurnerItem {
  return {
    id: item.id,
    originalInput: item.original_input,
    ingressSource: item.ingress_source,
    classification: item.classification,
    confidence: item.confidence,
    reason: item.reason,
    status: item.status,
    statusLabel: labelStatus(item.status),
    suggestedNextStep: item.suggested_next_step,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    promotedWorkItemId: item.promoted_work_item_id,
    promotedWorkItemTitle: item.promoted_work_item_title
  };
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

function toDashboardReviewItem(item: Parameters<typeof reviewPacketForReviewItem>[0]): DashboardReviewItem {
  const packet = reviewPacketForReviewItem(item);
  return {
    ...packet,
    displayId: packet.slug || packet.id,
    statusLabel: labelStatus(packet.status)
  };
}

function toDashboardRun(run: ExecutionRunSummary): DashboardRun {
  const failedStep = run.steps.find((step) => step.status === "failed");
  const reviewStep = run.steps.find((step) => isRequiresReviewStatus(step.status));
  const currentStep =
    run.steps.find((step) => step.status === "running") ??
    failedStep ??
    reviewStep ??
    [...run.steps].reverse().find((step) => step.status === "completed") ??
    run.steps[0] ??
    null;

  return {
    id: run.id,
    status: run.status,
    statusLabel: labelStatus(run.status),
    projectId: run.project_id,
    projectName: run.project_name,
    startedAt: run.created_at,
    updatedAt: run.updated_at,
    completedAt: run.status === "running" ? null : run.updated_at,
    workItemTitle: run.work_item_title,
    actionTitle: run.work_item_title,
    summary: run.summary,
    planSummary: run.plan_summary,
    currentStep: currentStep?.plan_step_title ?? null,
    latestMessage: currentStep ? stepReason(currentStep) : run.summary,
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
    projectId: artifact.project_id,
    projectName: artifact.project_name,
    workItemTitle: artifact.work_item_title,
    actionTitle: artifact.work_item_title,
    updatedAt: artifact.updated_at
  };
}

function toDashboardBlogSite(site: ReturnType<typeof listBlogDashboardSites>[number]): DashboardBlogSite {
  return {
    id: site.id,
    projectId: site.project_id,
    projectName: site.project_name,
    name: site.name,
    streamKey: site.stream_key,
    status: site.status,
    statusLabel: labelStatus(site.status),
    nextScheduledTitle: site.next_scheduled_title,
    nextScheduledFor: site.next_scheduled_for,
    draftsNeedingReview: Number(site.drafts_needing_review),
    ideasCount: Number(site.ideas_count),
    postsCount: Number(site.posts_count),
    latestArtifactPath: site.latest_artifact_path,
    updatedAt: site.updated_at
  };
}

function toDashboardBlogReviewItem(item: ReturnType<typeof listBlogReviewItems>[number]): DashboardBlogReviewItem {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    siteId: item.site_id,
    siteName: item.site_name,
    streamKey: item.stream_key,
    projectId: item.project_id,
    projectName: item.project_name,
    status: item.status,
    statusLabel: labelStatus(item.status),
    artifactId: item.artifact_id,
    artifactPath: item.artifact_path,
    reviewItemId: item.review_item_id,
    reviewSlug: item.review_slug,
    decisionNeeded: item.decision_needed,
    updatedAt: item.updated_at
  };
}

function toDashboardRebusterSnapshot(
  db: Database.Database,
  integrations: RebusterIntegration[],
  events: RebusterEventSummary[],
  decisions: RebusterEventSummary[]
): DashboardRebusterSnapshot {
  const integration = integrations[0] ?? null;
  const latestEvent = events[0] ?? null;
  const connection = integration
    ? {
        configured: true,
        projectId: integration.project_id,
        projectName: projectNameForId(db, integration.project_id),
        repoPath: integration.repo_path,
        baseUrl: integration.base_url,
        dashboardUrl: integration.dashboard_url,
        status: "configured" as const,
        statusLabel: "Configured",
        statusSummary: integration.status_summary,
        lastHealthCheckAt: integration.last_health_check_at,
        lastSyncAt: integration.last_sync_at,
        updatedAt: integration.updated_at
      }
    : {
        configured: false,
        projectId: null,
        projectName: null,
        repoPath: null,
        baseUrl: null,
        dashboardUrl: null,
        status: "unconfigured" as const,
        statusLabel: "Unconfigured",
        statusSummary: null,
        lastHealthCheckAt: null,
        lastSyncAt: null,
        updatedAt: null
      };

  return {
    connection,
    status: {
      summary: integration
        ? latestEvent
          ? latestEvent.summary
          : "Rebuster bridge configured. No events ingested yet."
        : "Rebuster bridge is not configured.",
      lastEventType: latestEvent?.event_type ?? null,
      lastEventAt: latestEvent?.occurred_at ?? null,
      openDecisionCount: decisions.length,
      recentEventCount: events.length
    },
    decisions: decisions.map(toDashboardRebusterDecision),
    recentEvents: events.map(toDashboardRebusterEvent)
  };
}

function toDashboardRebusterEvent(event: RebusterEventSummary): DashboardRebusterEvent {
  return {
    id: event.id,
    externalId: event.external_id,
    eventType: event.event_type,
    eventLabel: labelStatus(event.event_type),
    rebusId: event.rebus_id,
    answer: event.answer,
    status: event.status,
    statusLabel: labelStatus(event.status),
    summary: event.summary,
    decisionRequired: event.decision_required === 1,
    recommendation: event.recommendation,
    rebusterUrl: event.rebuster_url,
    artifactRefs: decodeRebusterArtifactRefs(event.artifact_refs_json),
    occurredAt: event.occurred_at,
    updatedAt: event.updated_at,
    projectId: event.project_id,
    projectName: event.project_name,
    reviewItemId: event.review_item_id,
    reviewSlug: event.review_slug,
    reviewStatus: event.review_status
  };
}

function toDashboardRebusterDecision(event: RebusterEventSummary): DashboardRebusterDecision {
  return {
    id: event.id,
    externalId: event.external_id,
    answer: event.answer,
    status: event.status,
    statusLabel: labelStatus(event.status),
    summary: event.summary,
    recommendation: event.recommendation,
    rebusterUrl: event.rebuster_url,
    occurredAt: event.occurred_at,
    projectId: event.project_id,
    projectName: event.project_name,
    reviewItemId: event.review_item_id ?? "",
    reviewSlug: event.review_slug
  };
}

function stepReason(step: ExecutionRunSummary["steps"][number]): string {
  return step.error ?? step.output ?? step.plan_step_title;
}

function labelWorkClassification(classification: string): string {
  if (isRequiresReviewStatus(classification)) {
    return "Requires Review";
  }

  return labelStatus(classification);
}

function labelStatus(status: string): string {
  if (isRequiresReviewStatus(status)) {
    return "Requires Review";
  }

  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function buildAttentionItems(
  db: Database.Database,
  reviewItems: DashboardReviewItem[],
  runs: ExecutionRunSummary[]
): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  for (const item of reviewItems) {
    const decisionContext = decodeObject(item.contextJson);
    const linkedArtifact = item.packetArtifactId
      ? db.prepare("SELECT id, title, path FROM artifacts WHERE id = ?").get(item.packetArtifactId) as { id: string; title: string; path: string | null } | undefined
      : undefined;
    const linkedInvocation = item.codexInvocationId
      ? db.prepare("SELECT id, prompt_path, final_message_path FROM codex_invocations WHERE id = ?").get(item.codexInvocationId) as { id: string; prompt_path: string; final_message_path: string } | undefined
      : undefined;
    const workContext = item.workItemId
      ? db.prepare(
          `SELECT wi.expected_artifact, wi.next_action, wi.work_classification, m.title AS milestone_title, pm.repo_path
           FROM work_items wi
           LEFT JOIN milestones m ON m.id = wi.milestone_id
           LEFT JOIN project_metadata pm ON pm.project_id = wi.project_id
           WHERE wi.id = ?`
        ).get(item.workItemId) as {
          expected_artifact: string | null;
          next_action: string;
          work_classification: string;
          milestone_title: string | null;
          repo_path: string | null;
        } | undefined
      : undefined;
    const isPlanning = item.resolvedIntent === "CodexPlanningRunApproval" || item.resolvedIntent === "CodexPlanningRetryApproval";
    const isAcceptance = item.resolvedIntent === "CodexPlanningArtifactAcceptance";
    const contextRunId = typeof decisionContext.runId === "string" ? decisionContext.runId : null;
    const contextRun = contextRunId ? getExecutionRun(db, contextRunId) : null;
    const validationPath = typeof decisionContext.validationResultPath === "string"
      ? decisionContext.validationResultPath
      : linkedInvocation
        ? `${linkedInvocation.final_message_path.split("/").slice(0, -1).join("/")}/planning-validation.json`
        : null;
    const missingRepoPath = isMissingRepoPathReview(item);
    items.push({
      id: `review:${item.id}`,
      kind: "review",
      severity: "action",
      projectName: item.project,
      projectId: item.projectId,
      milestone: workContext?.milestone_title ?? null,
      goal: item.goal,
      outcome: item.outcome,
      status: item.status,
      statusLabel: item.statusLabel,
      reason: item.decisionNeeded,
      workItemId: item.workItemId,
      actionId: item.actionId,
      workItemTitle: getWorkItemTitle(db, item.workItemId),
      actionTitle: getWorkItemTitle(db, item.actionId),
      expectedArtifact: typeof decisionContext.expectedArtifact === "string"
        ? decisionContext.expectedArtifact
        : workContext?.expected_artifact ?? null,
      targetRepositoryRoot: workContext?.repo_path ?? null,
      relatedArtifactId: linkedArtifact?.id ?? null,
      relatedArtifactTitle: linkedArtifact?.title ?? null,
      relatedArtifactPath: linkedArtifact?.path ?? null,
      finalArtifactPath: isAcceptance ? linkedArtifact?.path ?? null : null,
      validationPath,
      relatedReviewId: item.id,
      relatedReviewSlug: item.slug,
      relatedDecisionId: item.decisionId,
      relatedDecisionSlug: item.decisionSlug,
      relatedRunId: contextRunId,
      relatedCodexInvocationId: item.codexInvocationId,
      nextAction: workContext?.next_action ?? `Review ${item.slug || item.id} and choose Approve, Reject, or Defer.`,
      interpretation: typeof decisionContext.interpretation === "string" ? decisionContext.interpretation : item.proposedAction,
      safetyBoundaries: Array.isArray(decisionContext.safetyBoundaries)
        ? decisionContext.safetyBoundaries.filter((value): value is string => typeof value === "string")
        : [],
      responsibility: typeof decisionContext.responsibility === "string"
        ? decisionContext.responsibility
        : workContext?.work_classification ?? null,
      primaryActions: [
        ...(missingRepoPath && item.projectId
          ? [projectSetupAction(item.projectId)]
          : []),
        ...(isPlanning
          ? planningReviewActions(item.slug || item.id, linkedArtifact?.path ?? linkedInvocation?.prompt_path ?? null)
          : isAcceptance
            ? acceptanceReviewActions(
                item.slug || item.id,
                linkedArtifact?.path ?? null,
                validationPath,
                contextRun?.mission_log_path ?? null
              )
            : reviewActions(item.slug || item.id))
      ],
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    });
  }

  for (const packet of listPendingCodexPackets(db)) {
    const purposeLabel = packet.purpose === "build" ? "build" : "planning";
    const missingProjectRepositoryPath = Boolean(packet.project_id && !packet.target_repository_root);
    const runCommand = packet.plan_step_id
      ? `arcadia work run ${packet.work_item_id} --plan ${packet.plan_id} --allow-codex-${purposeLabel}`
      : packet.command;
    const validationPath = packet.purpose === "planning"
      ? `${packet.final_message_path.split("/").slice(0, -1).join("/")}/planning-validation.json`
      : null;
    items.push({
      id: `codex:${packet.id}`,
      kind: "codex_packet",
      severity: missingProjectRepositoryPath ? "blocked" : "action",
      projectName: packet.project_name,
      projectId: packet.project_id,
      milestone: packet.milestone_title,
      goal: packet.project_goal,
      outcome: packet.project_goal,
      status: packet.status,
      statusLabel: labelStatus(packet.status),
      reason: missingProjectRepositoryPath
        ? MISSING_REPO_PATH_WARNING
        : `Codex ${purposeLabel} packet awaiting review.`,
      workItemId: packet.work_item_id,
      actionId: packet.work_item_id,
      workItemTitle: packet.work_item_title,
      actionTitle: packet.work_item_title,
      expectedArtifact: packet.expected_artifact,
      targetRepositoryRoot: packet.target_repository_root,
      relatedArtifactId: packet.artifact_id,
      relatedArtifactTitle: packet.artifact_title,
      relatedArtifactPath: packet.prompt_path,
      finalArtifactPath: packet.final_message_path,
      validationPath,
      relatedReviewId: null,
      relatedReviewSlug: null,
      relatedDecisionId: null,
      relatedDecisionSlug: null,
      relatedRunId: packet.run_id,
      relatedCodexInvocationId: packet.id,
      nextAction: missingProjectRepositoryPath
        ? MISSING_REPO_PATH_WARNING
        : packet.plan_step_id
          ? `Open ${packet.prompt_path}. If approved, run: ${runCommand}`
          : `Open ${packet.prompt_path}. If approved, run the existing Codex command recorded in the packet metadata.`,
      interpretation: null,
      safetyBoundaries: [],
      responsibility: null,
      primaryActions: [
        {
          label: "View Packet",
          kind: "view",
          command: null,
          href: dashboardFileHref(packet.prompt_path),
          reviewAction: null
        },
        ...(missingProjectRepositoryPath && packet.project_id
          ? [projectSetupAction(packet.project_id)]
          : []),
        ...(missingProjectRepositoryPath
          ? []
          : [{
              label: "Approve & Run",
              kind: "command" as const,
              command: runCommand,
              href: null,
              reviewAction: null
            }]),
        ...(packet.run_id
          ? [{
              label: "View Run",
              kind: "command" as const,
              command: `arcadia run show ${packet.run_id}`,
              href: null,
              reviewAction: null
            }]
          : []),
        {
          label: "View Final Artifact",
          kind: "view",
          command: null,
          href: dashboardFileHref(packet.final_message_path),
          reviewAction: null
        },
        ...(validationPath
          ? [{
              label: "View Validation",
              kind: "view" as const,
              command: null,
              href: dashboardFileHref(validationPath),
              reviewAction: null
            }]
          : [])
      ],
      createdAt: packet.created_at,
      updatedAt: packet.updated_at
    });
  }

  for (const run of runs.filter((candidate) => candidate.status === "failed" || isRequiresReviewStatus(candidate.status))) {
    const dashboardRun = toDashboardRun(run);
    items.push({
      id: `run:${run.id}`,
      kind: "run",
      severity: run.status === "failed" ? "blocked" : "action",
      projectName: run.project_name,
      projectId: run.project_id,
      milestone: null,
      goal: null,
      outcome: null,
      status: run.status,
      statusLabel: labelStatus(run.status),
      reason: run.status === "failed" ? "Execution run failed." : "Execution run requires review.",
      workItemId: run.work_item_id,
      actionId: run.work_item_id,
      workItemTitle: run.work_item_title,
      actionTitle: run.work_item_title,
      expectedArtifact: null,
      targetRepositoryRoot: null,
      relatedArtifactId: run.artifacts[0]?.id ?? null,
      relatedArtifactTitle: run.artifacts[0]?.title ?? null,
      relatedArtifactPath: run.artifacts[0]?.path ?? run.mission_log_path,
      finalArtifactPath: run.artifacts.find((artifact) => artifact.artifact_type === "planning_artifact")?.path ?? null,
      validationPath: run.artifacts.find((artifact) => artifact.artifact_type === "planning_artifact_validation")?.path ?? null,
      relatedReviewId: null,
      relatedReviewSlug: null,
      relatedDecisionId: null,
      relatedDecisionSlug: null,
      relatedRunId: run.id,
      relatedCodexInvocationId: null,
      nextAction: dashboardRun.failureReason ?? dashboardRun.reviewReason ?? "Open the run detail and decide the next step.",
      interpretation: null,
      safetyBoundaries: [],
      responsibility: run.status === "failed" ? "blocked" : "needs_mark",
      primaryActions: [
        {
          label: "View Run",
          kind: "view",
          command: null,
          href: `/runs/${encodeURIComponent(run.id)}`,
          reviewAction: null
        }
      ],
      createdAt: run.created_at,
      updatedAt: run.updated_at
    });
  }

  const failedRunActionIds = new Set(
    runs.filter((run) => run.status === "failed").map((run) => run.work_item_id).filter((id): id is string => Boolean(id))
  );
  for (const workItem of listBlockedWorkItems(db).filter((candidate) => !failedRunActionIds.has(candidate.id))) {
    items.push({
      id: `blocked-work:${workItem.id}`,
      kind: "blocked_work",
      severity: "blocked",
      projectName: workItem.project_name,
      projectId: workItem.project_id,
      milestone: null,
      goal: null,
      outcome: null,
      status: "blocked",
      statusLabel: "Blocked",
      reason: "Action is blocked.",
      workItemId: workItem.id,
      actionId: workItem.id,
      workItemTitle: workItem.title,
      actionTitle: workItem.title,
      expectedArtifact: null,
      targetRepositoryRoot: null,
      relatedArtifactId: null,
      relatedArtifactTitle: null,
      relatedArtifactPath: null,
      finalArtifactPath: null,
      validationPath: null,
      relatedReviewId: null,
      relatedReviewSlug: null,
      relatedDecisionId: null,
      relatedDecisionSlug: null,
      relatedRunId: null,
      relatedCodexInvocationId: null,
      nextAction: workItem.next_action,
      interpretation: null,
      safetyBoundaries: [],
      responsibility: "blocked",
      primaryActions: [
        {
          label: "View Actions",
          kind: "command",
          command: `arcadia work list`,
          href: null,
          reviewAction: null
        }
      ],
      createdAt: workItem.created_at,
      updatedAt: workItem.updated_at
    });
  }

  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function isRequiresReviewStatus(value: string | null | undefined): boolean {
  return value === "requires_review" || value === "needs_mark";
}

function reviewActions(reviewId: string): DashboardAttentionAction[] {
  return [
    { label: "View", kind: "command", command: `arcadia review show ${reviewId}`, href: null, reviewAction: null },
    { label: "Approve", kind: "approve", command: null, href: null, reviewAction: "approve" },
    { label: "Reject", kind: "reject", command: null, href: null, reviewAction: "reject" },
    { label: "Defer", kind: "defer", command: null, href: null, reviewAction: "defer" }
  ];
}

function planningReviewActions(reviewId: string, packetPath: string | null): DashboardAttentionAction[] {
  return [
    ...(packetPath
      ? [{ label: "View Packet", kind: "view" as const, command: null, href: dashboardFileHref(packetPath), reviewAction: null }]
      : []),
    { label: "Approve & Run", kind: "approve", command: null, href: null, reviewAction: "approve" },
    { label: "Reject", kind: "reject", command: null, href: null, reviewAction: "reject" },
    { label: "Defer", kind: "defer", command: null, href: null, reviewAction: "defer" }
  ];
}

function acceptanceReviewActions(
  reviewId: string,
  planPath: string | null,
  validationPath: string | null,
  logPath: string | null
): DashboardAttentionAction[] {
  return [
    ...(planPath ? [{ label: "View Plan", kind: "view" as const, command: null, href: dashboardFileHref(planPath), reviewAction: null }] : []),
    ...(validationPath ? [{ label: "View Validation", kind: "view" as const, command: null, href: dashboardFileHref(validationPath), reviewAction: null }] : []),
    ...(logPath ? [{ label: "View Log", kind: "view" as const, command: null, href: dashboardFileHref(logPath), reviewAction: null }] : []),
    { label: "Accept Plan", kind: "approve", command: null, href: null, reviewAction: "approve" },
    { label: "Reject", kind: "reject", command: null, href: null, reviewAction: "reject" },
    { label: "Defer", kind: "defer", command: null, href: null, reviewAction: "defer" }
  ];
}

function projectSetupAction(projectId: string): DashboardAttentionAction {
  return {
    label: "Set Repository Path",
    kind: "view",
    command: null,
    href: `/projects/${encodeURIComponent(projectId)}`,
    reviewAction: null
  };
}

function isMissingRepoPathReview(item: DashboardReviewItem): boolean {
  return item.decisionNeeded.includes("repository path") || item.missingFields.includes("repository path");
}

function dashboardFileHref(relativePath: string): string {
  return `/api/file/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function decodeObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function getWorkItemTitle(db: Database.Database, workItemId: string | null): string | null {
  if (!workItemId) {
    return null;
  }

  const row = db.prepare("SELECT title FROM work_items WHERE id = ?").get(workItemId) as { title: string } | undefined;
  return row?.title ?? null;
}

interface PendingCodexPacketRow {
  id: string;
  purpose: "planning" | "build";
  command: string;
  prompt_path: string;
  final_message_path: string;
  status: string;
  work_item_id: string | null;
  work_item_title: string | null;
  expected_artifact: string | null;
  plan_id: string | null;
  plan_step_id: string | null;
  run_id: string | null;
  workspace_scope: string;
  project_id: string | null;
  project_name: string | null;
  project_goal: string | null;
  milestone_title: string | null;
  target_repository_root: string | null;
  artifact_id: string | null;
  artifact_title: string | null;
  created_at: string;
  updated_at: string;
}

function listPendingCodexPackets(db: Database.Database): PendingCodexPacketRow[] {
  return db
    .prepare(
      `SELECT
        ci.id,
        ci.purpose,
        ci.command,
        ci.prompt_path,
        ci.final_message_path,
        ci.status,
        ci.workspace_scope,
        ci.work_item_id,
        wi.title AS work_item_title,
        wi.expected_artifact,
        ci.plan_id,
        ci.plan_step_id,
        ci.run_id,
        p.id AS project_id,
        p.name AS project_name,
        p.goal AS project_goal,
        m.title AS milestone_title,
        pm.repo_path AS target_repository_root,
        a.id AS artifact_id,
        a.title AS artifact_title,
        ci.created_at,
        ci.updated_at
      FROM codex_invocations ci
      LEFT JOIN work_items wi ON wi.id = ci.work_item_id
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN milestones m ON m.id = wi.milestone_id
      LEFT JOIN project_metadata pm ON pm.project_id = p.id
      LEFT JOIN artifacts a ON a.path = ci.prompt_path
      WHERE ci.status = 'packet_created'
        AND NOT EXISTS (
          SELECT 1 FROM review_items ri
          WHERE ri.codex_invocation_id = ci.id
            AND ri.resolved_intent IN ('CodexPlanningRunApproval', 'CodexPlanningRetryApproval')
        )
      ORDER BY ci.updated_at DESC, ci.created_at DESC`
    )
    .all() as PendingCodexPacketRow[];
}

interface BlockedWorkItemRow {
  id: string;
  title: string;
  next_action: string;
  project_id: string | null;
  project_name: string | null;
  created_at: string;
  updated_at: string;
}

function listBlockedWorkItems(db: Database.Database): BlockedWorkItemRow[] {
  return db
    .prepare(
      `SELECT
        wi.id,
        wi.title,
        wi.next_action,
        p.id AS project_id,
        p.name AS project_name,
        wi.created_at,
        wi.updated_at
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      WHERE wi.status = 'blocked' OR wi.queue = 'blocked' OR wi.work_classification = 'blocked'
      ORDER BY wi.updated_at DESC`
    )
    .all() as BlockedWorkItemRow[];
}

function buildActivityEvents(db: Database.Database, limit: number): DashboardActivityEvent[] {
  const events: DashboardActivityEvent[] = [
    ...persistedActivityEvents(db),
    ...askActivityEvents(db),
    ...workActivityEvents(db),
    ...reviewActivityEvents(db),
    ...codexPacketActivityEvents(db),
    ...runActivityEvents(db),
    ...artifactActivityEvents(db),
    ...backBurnerActivityEvents(db)
  ];

  return events
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit);
}

function persistedActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT
        e.id,
        e.event_type,
        e.source_module,
        e.project_id,
        p.name AS project_name,
        e.work_item_id,
        wi.title AS work_item_title,
        e.artifact_id,
        a.path AS artifact_path,
        e.review_item_id,
        ri.slug AS review_slug,
        e.payload_json,
        e.created_at
      FROM events e
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN work_items wi ON wi.id = e.work_item_id
      LEFT JOIN artifacts a ON a.id = e.artifact_id
      LEFT JOIN review_items ri ON ri.id = e.review_item_id
      ORDER BY e.created_at DESC
      LIMIT 30`
    )
    .all() as Array<{
      id: string;
      event_type: string;
      source_module: string | null;
      project_id: string | null;
      project_name: string | null;
      work_item_id: string | null;
      work_item_title: string | null;
      artifact_id: string | null;
      artifact_path: string | null;
      review_item_id: string | null;
      review_slug: string | null;
      payload_json: string;
      created_at: string;
    }>;

  return rows.map((row) =>
    activityEvent({
      id: `event:${row.id}`,
      eventType: row.event_type,
      eventLabel: labelStatus(row.event_type),
      summary: eventSummary(row),
      projectId: row.project_id,
      projectName: row.project_name,
      workItemId: row.work_item_id,
      workItemTitle: row.work_item_title,
      artifactId: row.artifact_id,
      artifactPath: row.artifact_path,
      reviewId: row.review_item_id,
      reviewSlug: row.review_slug,
      occurredAt: row.created_at
    })
  );
}

function eventSummary(row: { event_type: string; source_module: string | null; payload_json: string }): string {
  const payload = parsePayload(row.payload_json);
  const title =
    stringPayload(payload, "summary") ??
    stringPayload(payload, "answer") ??
    stringPayload(payload, "artifactPath") ??
    stringPayload(payload, "name") ??
    stringPayload(payload, "streamKey") ??
    row.event_type;
  return `${row.source_module ?? "core"}: ${title}`;
}

function projectNameForId(db: Database.Database, projectId: string): string | null {
  const row = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  return row?.name ?? null;
}

function askActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT
        ar.id,
        ar.raw_request,
        ar.resolved_intent,
        ar.output_kind,
        ar.stewardship_json,
        ar.work_item_id,
        wi.title AS work_item_title,
        p.id AS project_id,
        p.name AS project_name,
        ar.created_at
      FROM ask_requests ar
      LEFT JOIN work_items wi ON wi.id = ar.work_item_id
      LEFT JOIN projects p ON p.id = wi.project_id
      ORDER BY ar.created_at DESC
      LIMIT 30`
    )
    .all() as Array<{
      id: string;
      raw_request: string;
      resolved_intent: string;
      output_kind: string;
      stewardship_json: string | null;
      work_item_id: string | null;
      work_item_title: string | null;
      project_id: string | null;
      project_name: string | null;
      created_at: string;
    }>;

  return rows.flatMap((row) => {
    const stewardship = parseStewardship(row.stewardship_json);
    return [
      activityEvent({
        id: `ask-received:${row.id}`,
        eventType: "ask_received",
        eventLabel: "Ask Received",
        summary: row.raw_request,
        projectId: row.project_id,
        projectName: row.project_name,
        askId: row.id,
        workItemId: row.work_item_id,
        workItemTitle: row.work_item_title,
        occurredAt: row.created_at
      }),
      activityEvent({
        id: `input-classified:${row.id}`,
        eventType: "input_classified",
        eventLabel: "Input Classified",
        summary: stewardship
          ? `${stewardship.intentType} -> ${stewardship.recommendedExecutionPath}: ${stewardship.classificationReason}`
          : `${row.resolved_intent} -> ${row.output_kind}`,
        projectId: row.project_id,
        projectName: row.project_name,
        askId: row.id,
        workItemId: row.work_item_id,
        workItemTitle: row.work_item_title,
        occurredAt: row.created_at
      })
    ];
  });
}

function workActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT
        wi.id,
        wi.title,
        wi.queue,
        wi.work_classification,
        wi.project_id,
        p.name AS project_name,
        wi.created_at
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      ORDER BY wi.created_at DESC
      LIMIT 30`
    )
    .all() as Array<{
      id: string;
      title: string;
      queue: string;
      work_classification: string;
      project_id: string | null;
      project_name: string | null;
      created_at: string;
    }>;

  return rows.map((row) =>
    activityEvent({
      id: `work-routed:${row.id}`,
      eventType: "routed_to_work",
      eventLabel: "Routed To Work",
      summary: `${row.title} (${labelStatus(row.queue)}, ${labelWorkClassification(row.work_classification)})`,
      projectId: row.project_id,
      projectName: row.project_name,
      workItemId: row.id,
      workItemTitle: row.title,
      occurredAt: row.created_at
    })
  );
}

function reviewActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT
        ri.id,
        ri.slug,
        ri.status,
        ri.decision_needed,
        ri.work_item_id,
        wi.title AS work_item_title,
        p.id AS project_id,
        p.name AS project_name,
        ri.created_at,
        ri.updated_at,
        ri.decided_at
      FROM review_items ri
      LEFT JOIN work_items wi ON wi.id = ri.work_item_id
      LEFT JOIN projects p ON p.id = ri.project_id
      ORDER BY ri.updated_at DESC
      LIMIT 30`
    )
    .all() as Array<{
      id: string;
      slug: string | null;
      status: string;
      decision_needed: string;
      work_item_id: string | null;
      work_item_title: string | null;
      project_id: string | null;
      project_name: string | null;
      created_at: string;
      updated_at: string;
      decided_at: string | null;
    }>;

  return rows.flatMap((row) => {
    const routed = activityEvent({
      id: `routed-to-review:${row.id}`,
      eventType: "routed_to_review",
      eventLabel: "Routed To Review",
      summary: row.decision_needed,
      projectId: row.project_id,
      projectName: row.project_name,
      reviewId: row.id,
      reviewSlug: row.slug,
      workItemId: row.work_item_id,
      workItemTitle: row.work_item_title,
      occurredAt: row.created_at
    });
    const created = activityEvent({
      id: `review-created:${row.id}`,
      eventType: "review_created",
      eventLabel: "Review Created",
      summary: row.decision_needed,
      projectId: row.project_id,
      projectName: row.project_name,
      reviewId: row.id,
      reviewSlug: row.slug,
      workItemId: row.work_item_id,
      workItemTitle: row.work_item_title,
      occurredAt: row.created_at
    });
    if (!row.decided_at || row.status === "open") {
      return [routed, created];
    }
    return [
      routed,
      created,
      activityEvent({
        id: `review-resolved:${row.id}`,
        eventType: "review_resolved",
        eventLabel: "Review Resolved",
        summary: `${row.slug ?? row.id} ${labelStatus(row.status)}`,
        projectId: row.project_id,
        projectName: row.project_name,
        reviewId: row.id,
        reviewSlug: row.slug,
        workItemId: row.work_item_id,
        workItemTitle: row.work_item_title,
        occurredAt: row.decided_at
      })
    ];
  });
}

function codexPacketActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  return db
    .prepare(
      `SELECT
        ci.id,
        ci.purpose,
        ci.prompt_path,
        ci.work_item_id,
        wi.title AS work_item_title,
        p.id AS project_id,
        p.name AS project_name,
        a.id AS artifact_id,
        ar.stewardship_json,
        ci.created_at
      FROM codex_invocations ci
      LEFT JOIN work_items wi ON wi.id = ci.work_item_id
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN artifacts a ON a.path = ci.prompt_path
      LEFT JOIN ask_requests ar ON ar.prompt_packet_path = ci.prompt_path
      ORDER BY ci.created_at DESC
      LIMIT 30`
    )
    .all()
    .map((row) => {
      const packet = row as {
        id: string;
        purpose: string;
        prompt_path: string;
        work_item_id: string | null;
        work_item_title: string | null;
        project_id: string | null;
        project_name: string | null;
        artifact_id: string | null;
        stewardship_json: string | null;
        created_at: string;
      };
      const stewardship = parseStewardship(packet.stewardship_json);
      return activityEvent({
        id: `codex-packet-created:${packet.id}`,
        eventType: "codex_packet_created",
        eventLabel: "Codex Packet Created",
        summary: stewardship?.generatedCodexGoalText
          ? `${labelStatus(packet.purpose)} packet: ${stewardship.generatedCodexGoalText}`
          : `${labelStatus(packet.purpose)} packet: ${packet.prompt_path}`,
        projectId: packet.project_id,
        projectName: packet.project_name,
        workItemId: packet.work_item_id,
        workItemTitle: packet.work_item_title,
        artifactId: packet.artifact_id,
        artifactPath: packet.prompt_path,
        codexInvocationId: packet.id,
        occurredAt: packet.created_at
      });
    });
}

function runActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT
        er.id,
        er.status,
        er.summary,
        er.work_item_id,
        wi.title AS work_item_title,
        p.id AS project_id,
        p.name AS project_name,
        er.created_at,
        er.updated_at
      FROM execution_runs er
      JOIN work_items wi ON wi.id = er.work_item_id
      LEFT JOIN projects p ON p.id = wi.project_id
      ORDER BY er.updated_at DESC
      LIMIT 30`
    )
    .all() as Array<{
      id: string;
      status: string;
      summary: string;
      work_item_id: string;
      work_item_title: string;
      project_id: string | null;
      project_name: string | null;
      created_at: string;
      updated_at: string;
    }>;

  return rows.flatMap((row) => {
    const started = activityEvent({
      id: `run-started:${row.id}`,
      eventType: "execution_started",
      eventLabel: "Execution Started",
      summary: row.work_item_title,
      projectId: row.project_id,
      projectName: row.project_name,
      workItemId: row.work_item_id,
      workItemTitle: row.work_item_title,
      runId: row.id,
      occurredAt: row.created_at
    });
    if (row.status === "running") {
      return [started];
    }
    return [
      started,
      activityEvent({
        id: `run-finished:${row.id}`,
        eventType: row.status === "completed" ? "run_completed" : "run_failed",
        eventLabel: row.status === "completed" ? "Run Completed" : "Run Failed",
        summary: row.summary,
        projectId: row.project_id,
        projectName: row.project_name,
        workItemId: row.work_item_id,
        workItemTitle: row.work_item_title,
        runId: row.id,
        occurredAt: row.updated_at
      })
    ];
  });
}

function artifactActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT
        a.id,
        a.title,
        a.path,
        a.work_item_id,
        wi.title AS work_item_title,
        p.id AS project_id,
        p.name AS project_name,
        a.created_at
      FROM artifacts a
      LEFT JOIN work_items wi ON wi.id = a.work_item_id
      LEFT JOIN projects p ON p.id = a.project_id
      ORDER BY a.created_at DESC
      LIMIT 30`
    )
    .all() as Array<{
      id: string;
      title: string;
      path: string | null;
      work_item_id: string | null;
      work_item_title: string | null;
      project_id: string | null;
      project_name: string | null;
      created_at: string;
    }>;

  return rows.map((row) =>
    activityEvent({
      id: `artifact-created:${row.id}`,
      eventType: "artifact_created",
      eventLabel: "Artifact Created",
      summary: row.title,
      projectId: row.project_id,
      projectName: row.project_name,
      workItemId: row.work_item_id,
      workItemTitle: row.work_item_title,
      artifactId: row.id,
      artifactPath: row.path,
      occurredAt: row.created_at
    })
  );
}

function backBurnerActivityEvents(db: Database.Database): DashboardActivityEvent[] {
  const rows = db
    .prepare(
      `SELECT id, original_input, classification, created_at
       FROM back_burner_items
       ORDER BY created_at DESC
       LIMIT 30`
    )
    .all() as Array<{ id: string; original_input: string; classification: string; created_at: string }>;

  return rows.map((row) =>
    activityEvent({
      id: `back-burner:${row.id}`,
      eventType: "routed_to_back_burner",
      eventLabel: "Routed To Back Burner",
      summary: `${row.classification}: ${row.original_input}`,
      backBurnerItemId: row.id,
      occurredAt: row.created_at
    })
  );
}

function parseStewardship(raw: string | null): {
  intentType: string;
  recommendedExecutionPath: string;
  classificationReason: string;
  generatedCodexGoalText: string | null;
} | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.intentType !== "string" ||
      typeof parsed.recommendedExecutionPath !== "string" ||
      typeof parsed.classificationReason !== "string"
    ) {
      return null;
    }

    return {
      intentType: parsed.intentType,
      recommendedExecutionPath: parsed.recommendedExecutionPath,
      classificationReason: parsed.classificationReason,
      generatedCodexGoalText: typeof parsed.generatedCodexGoalText === "string" ? parsed.generatedCodexGoalText : null
    };
  } catch {
    return null;
  }
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function activityEvent(input: Partial<DashboardActivityEvent> & {
  id: string;
  eventType: string;
  eventLabel: string;
  summary: string;
  occurredAt: string;
}): DashboardActivityEvent {
  return {
    id: input.id,
    eventType: input.eventType,
    eventLabel: input.eventLabel,
    summary: input.summary,
    projectId: input.projectId ?? null,
    projectName: input.projectName ?? null,
    askId: input.askId ?? null,
    reviewId: input.reviewId ?? null,
    reviewSlug: input.reviewSlug ?? null,
    decisionId: input.decisionId ?? input.reviewId ?? null,
    decisionSlug: input.decisionSlug ?? input.reviewSlug ?? null,
    workItemId: input.workItemId ?? null,
    actionId: input.actionId ?? input.workItemId ?? null,
    workItemTitle: input.workItemTitle ?? null,
    actionTitle: input.actionTitle ?? input.workItemTitle ?? null,
    runId: input.runId ?? null,
    artifactId: input.artifactId ?? null,
    artifactPath: input.artifactPath ?? null,
    backBurnerItemId: input.backBurnerItemId ?? null,
    codexInvocationId: input.codexInvocationId ?? null,
    occurredAt: input.occurredAt
  };
}
