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
