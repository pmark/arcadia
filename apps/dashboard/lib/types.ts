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
  backBurnerItemId: string | null;
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

export interface DashboardReviewItem {
  id: string;
  slug: string;
  displayId: string;
  workItemId: string | null;
  project: string | null;
  goal: string | null;
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
