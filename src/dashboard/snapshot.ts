import type Database from "better-sqlite3";
import type { RequiresReviewPacket } from "../commands/review.js";
import { reviewPacketForReviewItem } from "../commands/review.js";
import type { ArtifactSummary, BackBurnerItemSummary, ExecutionRunSummary, MilestoneSummary } from "../domain/types.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import {
  buildStatusReportData,
  listBackBurnerItems,
  listActionableReviewItems,
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
    attention: number;
    requiresReview: number;
    backBurner: number;
    activeRuns: number;
    recentRuns: number;
    recentArtifacts: number;
    activityEvents: number;
  };
  projects: DashboardProject[];
  attentionItems: DashboardAttentionItem[];
  activityEvents: DashboardActivityEvent[];
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

export interface DashboardAttentionItem {
  id: string;
  kind: "review" | "codex_packet" | "run" | "blocked_work";
  severity: "action" | "blocked" | "info";
  projectName: string | null;
  reason: string;
  workItemId: string | null;
  workItemTitle: string | null;
  relatedArtifactId: string | null;
  relatedArtifactTitle: string | null;
  relatedArtifactPath: string | null;
  relatedReviewId: string | null;
  relatedReviewSlug: string | null;
  relatedRunId: string | null;
  relatedCodexInvocationId: string | null;
  nextAction: string;
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
  askId: string | null;
  reviewId: string | null;
  reviewSlug: string | null;
  workItemId: string | null;
  workItemTitle: string | null;
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
  projectName: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  workItemTitle: string;
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
    const reviewItems = listActionableReviewItems(db);
    const attentionItems = buildAttentionItems(db, reviewItems.map(toDashboardReviewItem), runs);
    const activityEvents = buildActivityEvents(db, 30);
    const backBurnerItems = listBackBurnerItems(db, "all").filter((item) =>
      item.status === "incubating" || item.status === "opportunistic"
    );
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
        attention: attentionItems.length,
        requiresReview: reviewItems.length,
        backBurner: backBurnerItems.length,
        activeRuns: runs.filter((run) => run.status === "running" || run.status === "needs_mark").length,
        recentRuns: runs.length,
        recentArtifacts: Math.min(artifacts.length, artifactLimit),
        activityEvents: activityEvents.length
      },
      projects,
      attentionItems,
      activityEvents,
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
  const reviewStep = run.steps.find((step) => step.status === "needs_mark");
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
    projectName: run.project_name,
    startedAt: run.created_at,
    updatedAt: run.updated_at,
    completedAt: run.status === "running" ? null : run.updated_at,
    workItemTitle: run.work_item_title,
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
    projectName: artifact.project_name,
    workItemTitle: artifact.work_item_title,
    updatedAt: artifact.updated_at
  };
}

function stepReason(step: ExecutionRunSummary["steps"][number]): string {
  return step.error ?? step.output ?? step.plan_step_title;
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

function buildAttentionItems(
  db: Database.Database,
  reviewItems: DashboardReviewItem[],
  runs: ExecutionRunSummary[]
): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  for (const item of reviewItems) {
    items.push({
      id: `review:${item.id}`,
      kind: "review",
      severity: "action",
      projectName: item.project,
      reason: item.decisionNeeded,
      workItemId: item.workItemId,
      workItemTitle: getWorkItemTitle(db, item.workItemId),
      relatedArtifactId: null,
      relatedArtifactTitle: null,
      relatedArtifactPath: null,
      relatedReviewId: item.id,
      relatedReviewSlug: item.slug,
      relatedRunId: null,
      relatedCodexInvocationId: null,
      nextAction: `Review ${item.slug || item.id} and choose Approve, Reject, or Defer.`,
      primaryActions: reviewActions(item.slug || item.id),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    });
  }

  for (const packet of listPendingCodexPackets(db)) {
    const purposeLabel = packet.purpose === "build" ? "build" : "planning";
    items.push({
      id: `codex:${packet.id}`,
      kind: "codex_packet",
      severity: "action",
      projectName: packet.project_name,
      reason: `Codex ${purposeLabel} packet awaiting review.`,
      workItemId: packet.work_item_id,
      workItemTitle: packet.work_item_title,
      relatedArtifactId: packet.artifact_id,
      relatedArtifactTitle: packet.artifact_title,
      relatedArtifactPath: packet.prompt_path,
      relatedReviewId: null,
      relatedReviewSlug: null,
      relatedRunId: packet.run_id,
      relatedCodexInvocationId: packet.id,
      nextAction: packet.plan_step_id
        ? `Open ${packet.prompt_path}. If approved, run: arcadia work run ${packet.work_item_id} --plan ${packet.plan_id} --allow-codex-${purposeLabel}`
        : `Open ${packet.prompt_path}. If approved, run the existing Codex command recorded in the packet metadata.`,
      primaryActions: [
        {
          label: "View Packet",
          kind: "view",
          command: null,
          href: dashboardFileHref(packet.prompt_path),
          reviewAction: null
        },
        {
          label: "Run Approval Command",
          kind: "command",
          command: packet.plan_step_id
            ? `arcadia work run ${packet.work_item_id} --plan ${packet.plan_id} --allow-codex-${purposeLabel}`
            : packet.command,
          href: null,
          reviewAction: null
        }
      ],
      createdAt: packet.created_at,
      updatedAt: packet.updated_at
    });
  }

  for (const run of runs.filter((candidate) => candidate.status === "failed" || candidate.status === "needs_mark")) {
    const dashboardRun = toDashboardRun(run);
    items.push({
      id: `run:${run.id}`,
      kind: "run",
      severity: run.status === "failed" ? "blocked" : "action",
      projectName: run.project_name,
      reason: run.status === "failed" ? "Execution run failed." : "Execution run requires review.",
      workItemId: run.work_item_id,
      workItemTitle: run.work_item_title,
      relatedArtifactId: run.artifacts[0]?.id ?? null,
      relatedArtifactTitle: run.artifacts[0]?.title ?? null,
      relatedArtifactPath: run.artifacts[0]?.path ?? run.mission_log_path,
      relatedReviewId: null,
      relatedReviewSlug: null,
      relatedRunId: run.id,
      relatedCodexInvocationId: null,
      nextAction: dashboardRun.failureReason ?? dashboardRun.reviewReason ?? "Open the run detail and decide the next step.",
      primaryActions: [
        {
          label: "View Run",
          kind: "command",
          command: `arcadia run show ${run.id}`,
          href: null,
          reviewAction: null
        }
      ],
      createdAt: run.created_at,
      updatedAt: run.updated_at
    });
  }

  for (const workItem of listBlockedWorkItems(db)) {
    items.push({
      id: `blocked-work:${workItem.id}`,
      kind: "blocked_work",
      severity: "blocked",
      projectName: workItem.project_name,
      reason: "Work item is blocked.",
      workItemId: workItem.id,
      workItemTitle: workItem.title,
      relatedArtifactId: null,
      relatedArtifactTitle: null,
      relatedArtifactPath: null,
      relatedReviewId: null,
      relatedReviewSlug: null,
      relatedRunId: null,
      relatedCodexInvocationId: null,
      nextAction: workItem.next_action,
      primaryActions: [
        {
          label: "View Work",
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

function reviewActions(reviewId: string): DashboardAttentionAction[] {
  return [
    { label: "View", kind: "command", command: `arcadia review show ${reviewId}`, href: null, reviewAction: null },
    { label: "Approve", kind: "approve", command: null, href: null, reviewAction: "approve" },
    { label: "Reject", kind: "reject", command: null, href: null, reviewAction: "reject" },
    { label: "Defer", kind: "defer", command: null, href: null, reviewAction: "defer" }
  ];
}

function dashboardFileHref(relativePath: string): string {
  return `/api/file/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
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
  status: string;
  work_item_id: string | null;
  work_item_title: string | null;
  plan_id: string | null;
  plan_step_id: string | null;
  run_id: string | null;
  project_name: string | null;
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
        ci.status,
        ci.work_item_id,
        wi.title AS work_item_title,
        ci.plan_id,
        ci.plan_step_id,
        ci.run_id,
        p.name AS project_name,
        a.id AS artifact_id,
        a.title AS artifact_title,
        ci.created_at,
        ci.updated_at
      FROM codex_invocations ci
      LEFT JOIN work_items wi ON wi.id = ci.work_item_id
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN artifacts a ON a.path = ci.prompt_path
      WHERE ci.status = 'packet_created'
      ORDER BY ci.updated_at DESC, ci.created_at DESC`
    )
    .all() as PendingCodexPacketRow[];
}

interface BlockedWorkItemRow {
  id: string;
  title: string;
  next_action: string;
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
      project_name: string | null;
      created_at: string;
    }>;

  return rows.map((row) =>
    activityEvent({
      id: `work-routed:${row.id}`,
      eventType: "routed_to_work",
      eventLabel: "Routed To Work",
      summary: `${row.title} (${labelStatus(row.queue)}, ${labelWorkClassification(row.work_classification)})`,
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
      project_name: string | null;
      created_at: string;
    }>;

  return rows.map((row) =>
    activityEvent({
      id: `artifact-created:${row.id}`,
      eventType: "artifact_created",
      eventLabel: "Artifact Created",
      summary: row.title,
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
    projectName: input.projectName ?? null,
    askId: input.askId ?? null,
    reviewId: input.reviewId ?? null,
    reviewSlug: input.reviewSlug ?? null,
    workItemId: input.workItemId ?? null,
    workItemTitle: input.workItemTitle ?? null,
    runId: input.runId ?? null,
    artifactId: input.artifactId ?? null,
    artifactPath: input.artifactPath ?? null,
    backBurnerItemId: input.backBurnerItemId ?? null,
    codexInvocationId: input.codexInvocationId ?? null,
    occurredAt: input.occurredAt
  };
}
