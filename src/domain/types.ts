import type {
  ArtifactStatus,
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
  mission: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Milestone {
  id: string;
  project_id: string;
  title: string;
  status: MilestoneStatus;
  created_at: string;
  updated_at: string;
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
  status: ProjectStatus;
  currentMilestone: string;
  nextAction: string;
  expectedArtifact?: string;
  workClassification: WorkClassification;
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

export interface CreatedProjectBundle {
  project: Project;
  milestone: Milestone;
  workItem: WorkItem;
  artifact: Artifact | null;
}
