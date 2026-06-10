PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mission TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'incubating', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  milestone_id TEXT,
  title TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  queue TEXT NOT NULL CHECK (queue IN ('inbox', 'work_queue', 'needs_mark', 'blocked')),
  work_classification TEXT NOT NULL CHECK (work_classification IN ('autonomous', 'codex', 'needs_mark', 'blocked')),
  next_action TEXT NOT NULL,
  expected_artifact TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'done', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mission_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  milestone_id TEXT,
  work_performed TEXT NOT NULL,
  result TEXT NOT NULL,
  blockers TEXT,
  next_action TEXT NOT NULL,
  artifact_impact TEXT,
  markdown_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  work_item_id TEXT,
  title TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'drafted', 'ready', 'published')),
  path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS skill_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  executor_type TEXT NOT NULL CHECK (executor_type IN ('deterministic', 'codex_planning', 'codex_build', 'mark')),
  safe_to_run INTEGER NOT NULL CHECK (safe_to_run IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_plans (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'completed', 'needs_mark', 'failed')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS execution_plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  command TEXT,
  executor_type TEXT NOT NULL CHECK (executor_type IN ('deterministic', 'codex_planning', 'codex_build', 'mark')),
  safe_to_run INTEGER NOT NULL CHECK (safe_to_run IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'needs_mark', 'failed', 'skipped')),
  needs_mark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES execution_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skill_definitions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS execution_runs (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'needs_mark', 'failed')),
  summary TEXT NOT NULL,
  mission_log_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES execution_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (mission_log_id) REFERENCES mission_logs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS execution_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan_step_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'needs_mark', 'failed', 'skipped')),
  command TEXT,
  output TEXT,
  error TEXT,
  artifact_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_step_id) REFERENCES execution_plan_steps(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES execution_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_work_items_queue ON work_items(queue);
CREATE INDEX IF NOT EXISTS idx_work_items_classification ON work_items(work_classification);
CREATE INDEX IF NOT EXISTS idx_mission_logs_created_at ON mission_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);
CREATE INDEX IF NOT EXISTS idx_execution_plans_work_item_id ON execution_plans(work_item_id);
CREATE INDEX IF NOT EXISTS idx_execution_plan_steps_plan_id ON execution_plan_steps(plan_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_work_item_id ON execution_runs(work_item_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_plan_id ON execution_runs(plan_id);
CREATE INDEX IF NOT EXISTS idx_execution_run_steps_run_id ON execution_run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_run_id ON run_artifacts(run_id);

PRAGMA user_version = 2;
