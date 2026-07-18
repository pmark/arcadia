export interface ArcadiaJsonSuccess<TData> {
  ok: true;
  command: string;
  workspace: string;
  data: TData;
  artifacts: string[];
  warnings: string[];
}

export interface DashboardSnapshotResponse {
  snapshot: DashboardSnapshot;
}

export interface AskResponse {
  ask: {
    id: string;
    raw_request: string;
    resolved_intent: string;
    prompt_packet_path: string | null;
    status: string;
  } | null;
  stewardship?: {
    intentType: string;
    recommendedExecutionPath: string;
    planningRecommended: boolean;
    clarificationRequired: boolean;
    reviewRequired: boolean;
    generatedCodexGoalText: string | null;
    classificationReason: string;
  };
  intake: {
    resolvedIntent: string;
    classification?: string;
    confidence: number;
    confidenceLabel: string;
    proposedAction: string;
    suggestedNextStep?: string | null;
  };
  resolvedIntent: {
    intentId: string;
    matched: boolean;
    outputKind: string;
    workClassification: string;
  };
  result: {
    status: "ignored" | "acted" | "queued" | "requires_review" | "captured";
    summary: string;
  };
  workItem: {
    id: string;
    title: string;
    project_name: string | null;
    milestone_title: string | null;
    queue: string;
    work_classification: string;
  } | null;
  plan: {
    id: string;
    status: string;
    summary: string;
  } | null;
  run: {
    id: string;
    status: string;
    summary: string;
  } | null;
  reviewItemId: string | null;
  decisionId?: string | null;
  backBurnerItemId: string | null;
}

export interface AskFeedbackItem {
  id: string;
  ask_request_id: string;
  decision: "up" | "down";
  note: string | null;
  source_ingress: string | null;
  created_at: string;
}

export interface FeedbackRecordResponse {
  feedback: AskFeedbackItem;
  result: {
    status: "recorded";
    summary: string;
  };
}

export interface FeedbackListResponse {
  items: AskFeedbackItem[];
  counts: {
    up: number;
    down: number;
  };
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

export interface DashboardDailyAdvantage {
  actionId: string;
  projectId: string;
  projectName: string;
  mission: string;
  outcome: string | null;
  milestoneId: string;
  milestoneTitle: string;
  actionTitle: string;
  nextAction: string;
  expectedArtifact: string;
  repositoryPath: string;
  whyItMatters: string;
  whyNow: string;
  status: "ready" | "prepared";
  statusLabel: string;
  decisionId: string | null;
  decisionSlug: string | null;
  packetPath: string | null;
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
  artifactRefs: Array<Record<string, unknown>>;
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

export interface DashboardReviewItem {
  id: string;
  slug: string;
  decisionId: string;
  decisionSlug: string;
  displayId: string;
  workItemId: string | null;
  actionId: string | null;
  projectId: string | null;
  project: string | null;
  goal: string | null;
  outcome: string | null;
  status: string;
  statusLabel: string;
  category: string;
  decisionNeeded: string;
  context: string;
  recommendation: string | null;
  proposedAction: string;
  missingFields: string[];
  options: string[];
  sourceInput: string;
  createdAt: string;
  updatedAt: string;
  resultingAskRequestId: string | null;
  contextJson: string | null;
  resolvedIntent: string;
  packetArtifactId: string | null;
  codexInvocationId: string | null;
  artifactPath: string | null;
  promptPath: string | null;
  finalMessagePath: string | null;
  validationPath: string | null;
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
