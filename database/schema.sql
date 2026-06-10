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

CREATE INDEX IF NOT EXISTS idx_milestones_project_id ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items(project_id);
CREATE INDEX IF NOT EXISTS idx_work_items_queue ON work_items(queue);
CREATE INDEX IF NOT EXISTS idx_work_items_classification ON work_items(work_classification);
CREATE INDEX IF NOT EXISTS idx_mission_logs_created_at ON mission_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_status ON artifacts(status);

PRAGMA user_version = 1;
