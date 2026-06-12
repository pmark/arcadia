import type {
  ArtifactStatus,
  ApprovalGateStatus,
  ApprovalGateType,
  AskRequestStatus,
  CodexInvocationPurpose,
  CodexInvocationStatus,
  ExecutionPlanStatus,
  ExecutionRunStatus,
  ExecutionStepStatus,
  ExecutorType,
  MilestoneStatus,
  ProjectStatus,
  QueueName,
  WorkClassification,
  WorkItemStatus
} from "./constants.js";

export interface Project {
  id: string;
  name: string;
  slug: string;
  mission: string;
  goal: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectMetadata {
  project_id: string;
  aliases: string;
  repo_path: string | null;
  status_summary: string | null;
  validation_commands: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectContext {
  project: Project;
  metadata: ProjectMetadata | null;
  activeMilestone: Milestone | null;
}

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  status: MilestoneStatus;
  created_at: string;
  updated_at: string;
}

export interface MilestoneSummary extends Milestone {
  project_name: string;
}

export interface WorkItem {
  id: string;
  project_id: string | null;
  milestone_id: string | null;
  title: string;
  raw_input: string;
  queue: QueueName;
  work_classification: WorkClassification;
  next_action: string;
  expected_artifact: string | null;
  status: WorkItemStatus;
  created_at: string;
  updated_at: string;
}

export interface MissionLog {
  id: string;
  project_id: string | null;
  milestone_id: string | null;
  work_performed: string;
  result: string;
  blockers: string | null;
  next_action: string;
  artifact_impact: string | null;
  markdown_path: string;
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  id: string;
  project_id: string | null;
  work_item_id: string | null;
  title: string;
  artifact_type: string;
  status: ArtifactStatus;
  path: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  title: string;
  description: string;
  executor_type: ExecutorType;
  safe_to_run: number;
  created_at: string;
  updated_at: string;
}

export interface ExecutionPlan {
  id: string;
  work_item_id: string;
  status: ExecutionPlanStatus;
  summary: string;
  created_at: string;
  updated_at: string;
}

export interface ExecutionPlanStep {
  id: string;
  plan_id: string;
  skill_id: string;
  position: number;
  title: string;
  command: string | null;
  executor_type: ExecutorType;
  safe_to_run: number;
  status: ExecutionStepStatus;
  needs_mark: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutionRun {
  id: string;
  work_item_id: string;
  plan_id: string;
  status: ExecutionRunStatus;
  summary: string;
  mission_log_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutionRunStep {
  id: string;
  run_id: string;
  plan_step_id: string;
  status: ExecutionStepStatus;
  command: string | null;
  output: string | null;
  error: string | null;
  artifact_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunArtifact {
  id: string;
  run_id: string;
  artifact_id: string;
  created_at: string;
}

export interface AskRequest {
  id: string;
  raw_request: string;
  resolved_intent: string;
  registry_version: number;
  output_kind: string;
  work_item_id: string | null;
  plan_id: string | null;
  prompt_packet_path: string | null;
  status: AskRequestStatus;
  created_at: string;
  updated_at: string;
}

export type ReviewItemStatus = "open" | "approved" | "rejected" | "deferred";

export interface ReviewItem {
  id: string;
  ask_request_id: string | null;
  work_item_id: string | null;
  plan_id: string | null;
  project_id: string | null;
  status: ReviewItemStatus;
  decision_needed: string;
  recommendation: string | null;
  source_input: string;
  proposed_action: string;
  resolved_intent: string;
  confidence_label: string;
  confidence: number;
  missing_fields: string;
  context_json: string;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  decision_note: string | null;
  resulting_ask_request_id: string | null;
}

export interface ApprovalGate {
  id: string;
  gate_type: ApprovalGateType;
  reason: string;
  work_item_id: string | null;
  plan_id: string | null;
  plan_step_id: string | null;
  status: ApprovalGateStatus;
  created_at: string;
  updated_at: string;
}

export interface CodexInvocation {
  id: string;
  purpose: CodexInvocationPurpose;
  agent_profile: string;
  workspace_scope: string;
  command: string;
  prompt_path: string;
  jsonl_output_path: string;
  final_message_path: string;
  status: CodexInvocationStatus;
  work_item_id: string | null;
  plan_id: string | null;
  plan_step_id: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CodexTask {
  id: string;
  source: string;
  source_task_id: string;
  title: string;
  status: string;
  url: string | null;
  summary: string | null;
  codex_updated_at: string | null;
  project_id: string | null;
  milestone_id: string | null;
  mission_log_id: string | null;
  last_observed_at: string;
  created_at: string;
  updated_at: string;
}

export interface CodexTaskSummary extends CodexTask {
  project_name: string | null;
  milestone_title: string | null;
  mission_log_path: string | null;
}

export interface ProjectSummary extends Project {
  current_milestone: string | null;
  current_milestone_id: string | null;
  next_action: string | null;
  work_classification: WorkClassification | null;
  expected_artifact: string | null;
}

export interface WorkItemSummary extends WorkItem {
  project_name: string | null;
  milestone_title: string | null;
}

export interface ExecutionPlanStepSummary extends ExecutionPlanStep {
  skill_name: string;
}

export interface ExecutionPlanSummary extends ExecutionPlan {
  steps: ExecutionPlanStepSummary[];
}

export interface ExecutionRunStepSummary extends ExecutionRunStep {
  plan_step_title: string;
  executor_type: ExecutorType;
}

export interface ExecutionRunSummary extends ExecutionRun {
  work_item_title: string;
  plan_summary: string;
  mission_log_path: string | null;
  steps: ExecutionRunStepSummary[];
  artifacts: ArtifactSummary[];
}

export interface MissionLogSummary extends MissionLog {
  project_name: string | null;
  milestone_title: string | null;
}

export interface ArtifactSummary extends Artifact {
  project_name: string | null;
  work_item_title: string | null;
}

export interface AskRequestSummary extends AskRequest {
  work_item_title: string | null;
  plan_summary: string | null;
}

export interface ReviewItemSummary extends ReviewItem {
  project_name: string | null;
  project_goal: string | null;
  work_item_title: string | null;
  plan_summary: string | null;
  resulting_ask_work_item_title: string | null;
}

export interface QueueGroups {
  inbox: WorkItemSummary[];
  work_queue: WorkItemSummary[];
  needs_mark: WorkItemSummary[];
  blocked: WorkItemSummary[];
}

export type ArtifactGroups = Record<ArtifactStatus, ArtifactSummary[]>;

export interface StatusReportData {
  workspacePath: string;
  generatedAt: string;
  projects: ProjectSummary[];
  queues: QueueGroups;
  needsMarkItems: WorkItemSummary[];
  autonomousItems: WorkItemSummary[];
  codexItems: WorkItemSummary[];
  blockedItems: WorkItemSummary[];
  recentlyCompletedWorkItems: WorkItemSummary[];
  recentMissionLogs: MissionLogSummary[];
  upcomingArtifacts: ArtifactSummary[];
  artifactsByStatus: ArtifactGroups;
}

export interface ReviewWindow {
  since: string;
  until: string;
}

export interface SuggestedNextAction {
  sourceType: "project" | "work_item" | "artifact";
  sourceId: string;
  title: string;
  nextAction: string;
}

export interface WeeklyReviewData {
  workspacePath: string;
  generatedAt: string;
  window: ReviewWindow;
  completedWorkItems: WorkItemSummary[];
  missionLogs: MissionLogSummary[];
  blockedItems: WorkItemSummary[];
  needsMarkItems: WorkItemSummary[];
  autonomousItems: WorkItemSummary[];
  codexItems: WorkItemSummary[];
  artifactItems: ArtifactSummary[];
  projectsWithoutOpenNextActions: ProjectSummary[];
  suggestedNextActions: SuggestedNextAction[];
}

export interface CreateProjectInput {
  name: string;
  mission: string;
  goal?: string;
  status: ProjectStatus;
  currentMilestone: string;
  nextAction: string;
  expectedArtifact?: string;
  workClassification: WorkClassification;
}

export interface UpsertProjectInput extends CreateProjectInput {
  id?: string;
}

export interface UpdateProjectInput {
  status?: ProjectStatus;
  mission?: string;
  goal?: string | null;
}

export interface UpsertProjectMetadataInput {
  projectId: string;
  aliases?: string[];
  repoPath?: string | null;
  statusSummary?: string | null;
  validationCommands?: string[];
}

export interface ObservedCodexTaskInput {
  source: "local_goal" | "cloud_task";
  sourceTaskId: string;
  title: string;
  status: string;
  url?: string | null;
  summary?: string | null;
  codexUpdatedAt?: string | null;
}

export interface AssociateCodexTaskInput {
  taskId: string;
  projectId: string;
  milestoneId?: string | null;
}

export interface CreateWorkItemInput {
  projectId?: string | null;
  milestoneId?: string | null;
  title: string;
  rawInput: string;
  queue: QueueName;
  workClassification: WorkClassification;
  nextAction: string;
  expectedArtifact?: string;
  status?: WorkItemStatus;
}

export interface UpdateWorkItemInput {
  queue?: string;
  workClassification?: string;
  nextAction?: string;
  status?: string;
}

export interface UpdateArtifactInput {
  status?: string;
  path?: string | null;
}

export interface CreateMissionLogInput {
  id?: string;
  projectId?: string | null;
  milestoneId?: string | null;
  workPerformed: string;
  result: string;
  blockers?: string;
  nextAction: string;
  artifactImpact?: string;
  markdownPath: string;
}

export interface CreateArtifactInput {
  projectId?: string | null;
  workItemId?: string | null;
  title: string;
  artifactType: string;
  status?: ArtifactStatus;
  path?: string | null;
}

export interface CreateAskRequestInput {
  id?: string;
  rawRequest: string;
  resolvedIntent: string;
  registryVersion: number;
  outputKind: string;
  workItemId?: string | null;
  planId?: string | null;
  promptPacketPath?: string | null;
  status: AskRequestStatus;
}

export interface CreateReviewItemInput {
  askRequestId?: string | null;
  workItemId?: string | null;
  planId?: string | null;
  projectId?: string | null;
  decisionNeeded: string;
  recommendation?: string | null;
  sourceInput: string;
  proposedAction: string;
  resolvedIntent: string;
  confidenceLabel: string;
  confidence: number;
  missingFields?: string[];
  context?: Record<string, unknown>;
}

export interface CreateApprovalGateInput {
  gateType: ApprovalGateType;
  reason: string;
  workItemId?: string | null;
  planId?: string | null;
  planStepId?: string | null;
  status?: ApprovalGateStatus;
}

export interface CreateCodexInvocationInput {
  id?: string;
  purpose: CodexInvocationPurpose;
  agentProfile: string;
  workspaceScope: string;
  command: string;
  promptPath: string;
  jsonlOutputPath: string;
  finalMessagePath: string;
  status?: CodexInvocationStatus;
  workItemId?: string | null;
  planId?: string | null;
  planStepId?: string | null;
  runId?: string | null;
}

export interface CreatedProjectBundle {
  project: Project;
  milestone: Milestone;
  workItem: WorkItem;
  artifact: Artifact | null;
}
