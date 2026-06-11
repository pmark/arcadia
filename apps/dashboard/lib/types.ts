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
