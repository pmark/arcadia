export interface ArcadiaJsonSuccess<TData> {
  ok: true;
  command: string;
  workspace: string;
  data: TData;
  artifacts: string[];
  warnings: string[];
}

export interface ArcadiaJsonFailure {
  ok: false;
  command: string;
  workspace?: string;
  error: { code: string; message: string; details?: unknown };
}

export interface StatusData {
  projectCount: number;
  activeProjectCount: number;
  runningWorkCount: number;
  queuedWorkCount: number;
  requiresReviewWorkCount: number;
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
  responsibility?: string;
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
    requires_review: WorkItem[];
    blocked: WorkItem[];
  };
}

export interface AgentAskNotificationItem {
  settlementId: string;
  projectSlug: string;
  disposition: "accepted" | "rejected";
  intent: string;
  effects: string[];
  queueActionKey: string | null;
  queuePosition: number | null;
  nextActionKey: string | null;
  createdAt: string;
}

export interface AgentAskNotificationsData {
  notifications: AgentAskNotificationItem[];
}

export interface ExecutionRunStep {
  status: string;
  plan_step_title: string;
  output: string | null;
  error: string | null;
}

export interface ExecutionRun {
  id: string;
  work_item_id?: string | null;
  plan_id?: string | null;
  review_item_id?: string | null;
  executor_name?: string | null;
  status: string;
  summary: string;
  project_name?: string | null;
  work_item_title: string;
  plan_summary: string;
  mission_log_path: string | null;
  pid?: number | null;
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
  needsOperator: string[];
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
  nextAction?: string;
  expectedArtifact?: string | null;
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
  ask: AskRequest | null;
  stewardship?: {
    intentType: string;
    recommendedExecutionPath: string;
    planningRecommended: boolean;
    clarificationRequired: boolean;
    reviewRequired: boolean;
    generatedCodexGoalText: string | null;
    classificationReason: string;
  };
  intake?: {
    resolvedIntent: string;
    classification?: string;
    confidence: number;
    confidenceLabel: string;
    proposedAction: string;
    suggestedNextStep?: string | null;
    project?: {
      id: string;
      name: string;
    } | null;
  };
  resolvedIntent: ResolvedIntent;
  result?: {
    status: string;
    summary: string;
  };
  workItem: WorkItem | null;
  project?: {
    id: string;
    name: string;
  } | null;
  projectSummary?: {
    id: string;
    name: string;
  } | null;
  plan: ExecutionPlan | null;
  approvalGates: ApprovalGate[];
  codexInvocations: CodexInvocation[];
  run: ExecutionRun | null;
  reviewItemId?: string | null;
  decisionId?: string | null;
  decisionSlug?: string | null;
  backBurnerItemId?: string | null;
}

export interface ReviewItem {
  id: string;
  slug: string;
  decisionId?: string;
  decisionSlug?: string;
  workItemId: string | null;
  actionId?: string | null;
  projectId?: string | null;
  project: string | null;
  goal: string | null;
  outcome?: string | null;
  decisionNeeded: string;
  context: string;
  resolvedIntent?: string;
  contextJson?: string | null;
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

export interface ReviewExecutionData {
  executor: string;
  followUpReviewItemId: string;
  followUpReviewSlug: string;
  exitStatus: number | null;
  changedFiles: string[];
  validation: Array<{ command: string; exitStatus: number | null; error: string | null }>;
  finalOutput: string | null;
}

export interface ReviewDecisionData {
  item: ReviewItem;
  result: {
    status: "approved" | "rejected" | "deferred" | "pending_execution";
    summary: string;
  };
  approval: AskData | null;
  execution: ReviewExecutionData | null;
  run: { id: string } | null;
}

export interface ReviewResolveReplyData {
  item: ReviewItem;
  action: "approved" | "rejected" | "deferred" | "feedback_captured";
  selectedOption: string | null;
  feedback: {
    id: string;
    review_id: string;
    review_slug: string;
    feedback_type: string;
    raw_reply: string;
    created_at: string;
  } | null;
  result: ReviewDecisionData["result"] | null;
  approval: AskData | null;
  confirmation: string;
}

export interface ClarifyData {
  applied: boolean;
  evaluated: Array<{
    workItem: { id: string; title: string };
    verdict:
      | { verdict: "clarified"; nextAction: string; actor: string; confidence: string }
      | { verdict: "question_open"; question: string; gapType: string; confidence: string };
  }>;
  applications: Array<{
    workItemId: string;
    clarificationStatus: "clarified" | "question_open";
    decisionId?: string;
    decisionSlug?: string;
  }>;
  skipped: Array<{ workItemId: string; title: string; reason: string }>;
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

export interface OrientationPacket {
  id: string;
  localDate: string;
  body: string;
  entrySnapshot: Array<{ id: string; title: string; stale: boolean }>;
  discordMessageId: string | null;
  createdAt: string;
}

export interface OrientationPacketComposeData {
  packet: OrientationPacket | null;
  alreadySent: boolean;
  aiSummary: { headline: string; paragraph: string } | null;
  memory: { status: string; recordPath: string | null } | null;
}

export interface OrientationPacketMarkSentData {
  packet: OrientationPacket;
}

/**
 * One (scope, cadence, window) the digest run resolved. Mirrors
 * `DigestRunEntry` in the CLI; only the fields delivery actually needs.
 */
export interface DigestRunEntry {
  scope: "project" | "portfolio";
  subject: string;
  period: "day" | "week" | "month";
  windowLabel: string;
  digestId: string | null;
  factCount: number | null;
  status: "composed" | "pending-delivery" | "skipped" | "failed";
  body: string | null;
  error: string | null;
}

export interface DigestRunData {
  entries: DigestRunEntry[];
  /** The subset still awaiting delivery, in composition order. */
  pending: DigestRunEntry[];
}

export interface DigestMarkPostedData {
  digest: { id: string; posted_message_id: string | null };
}

export interface OrientationEntry {
  id: string;
  title: string;
  status: string;
}

export interface OrientationReplyData {
  echo: string;
  confidence: number;
  applied: boolean;
  ambiguousQuestion?: string;
  touchedEntries: OrientationEntry[];
}
