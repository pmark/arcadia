export interface ArcadiaJsonSuccess<TData> {
  ok: true;
  command: string;
  workspace: string;
  data: TData;
  artifacts: string[];
  warnings: string[];
}

export interface StatusData {
  projectCount: number;
  activeProjectCount: number;
  runningWorkCount: number;
  queuedWorkCount: number;
  needsMarkCount: number;
  requiresReviewCount: number;
  autonomousCount: number;
  codexCount: number;
  blockedCount: number;
  recentMissionLogCount: number;
  recentArtifactCount: number;
  reportPath: string;
}

export interface WorkItem {
  id: string;
  title: string;
  raw_input?: string;
  project_id?: string | null;
  milestone_id?: string | null;
  queue: string;
  work_classification: string;
  next_action: string;
  expected_artifact: string | null;
  status: string;
  project_name: string | null;
  milestone_title: string | null;
}

export interface QueueData {
  queues: {
    inbox: WorkItem[];
    work_queue: WorkItem[];
    needs_mark: WorkItem[];
    blocked: WorkItem[];
  };
}

export interface ExecutionRunStep {
  status: string;
  plan_step_title: string;
  output: string | null;
  error: string | null;
}

export interface ExecutionRun {
  id: string;
  work_item_id?: string;
  plan_id?: string;
  status: string;
  summary: string;
  work_item_title: string;
  plan_summary: string;
  mission_log_path: string | null;
  created_at: string;
  updated_at: string;
  steps: ExecutionRunStep[];
  artifacts: Array<{ id: string; title: string; path: string | null }>;
}

export interface RunListData {
  runs: ExecutionRun[];
}

export interface RunShowData {
  run: ExecutionRun;
  needsMark: string[];
}

export interface Milestone {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MilestoneListData {
  milestones: Milestone[];
}

export interface AskRequest {
  id: string;
  raw_request: string;
  resolved_intent: string;
  prompt_packet_path: string | null;
  status: string;
}

export interface ResolvedIntent {
  intentId: string;
  matched: boolean;
  outputKind: string;
  workClassification: string;
}

export interface ExecutionPlan {
  id: string;
  status: string;
  summary: string;
}

export interface ApprovalGate {
  id: string;
  gate_type: string;
  reason: string;
  status: string;
}

export interface CodexInvocation {
  id: string;
  purpose: string;
  workspace_scope: string;
  prompt_path: string;
  status: string;
}

export interface AskData {
  ask: AskRequest;
  intake?: {
    resolvedIntent: string;
    confidence: number;
    confidenceLabel: string;
    proposedAction: string;
  };
  resolvedIntent: ResolvedIntent;
  result?: {
    status: string;
    summary: string;
  };
  workItem: WorkItem | null;
  plan: ExecutionPlan | null;
  approvalGates: ApprovalGate[];
  codexInvocations: CodexInvocation[];
  run: ExecutionRun | null;
  reviewItemId?: string | null;
}

export interface ReviewItem {
  id: string;
  workItemId: string | null;
  project: string | null;
  goal: string | null;
  decisionNeeded: string;
  context: string;
  recommendation: string | null;
  options: string[];
  sourceInput: string;
  resultingAskRequestId: string | null;
}

export interface ReviewData {
  count: number;
  items: ReviewItem[];
}

export interface ReviewShowData {
  item: ReviewItem;
}

export interface ReviewDecisionData {
  item: ReviewItem;
  result: {
    status: "approved" | "rejected" | "deferred";
    summary: string;
  };
  approval: AskData | null;
}

export interface CodexTask {
  id: string;
  source: string;
  source_task_id: string;
  title: string;
  status: string;
  url: string | null;
  summary: string | null;
  project_id: string | null;
  milestone_id: string | null;
  mission_log_id: string | null;
  project_name: string | null;
  milestone_title: string | null;
  mission_log_path: string | null;
  last_observed_at: string;
}

export interface CodexListData {
  tasks: CodexTask[];
  observedCount: number;
  missionLogPaths: string[];
}
