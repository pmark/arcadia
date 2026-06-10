import type Database from "better-sqlite3";
import {
  ARTIFACT_STATUSES,
  MILESTONE_STATUSES,
  PROJECT_STATUSES,
  QUEUES,
  WORK_CLASSIFICATIONS,
  WORK_ITEM_STATUSES,
  assertAllowedValue,
  queueForWorkClassification,
  type ArtifactStatus,
  type MilestoneStatus,
  type ProjectStatus,
  type QueueName,
  type WorkClassification,
  type WorkItemStatus
} from "../domain/constants.js";
import type {
  Artifact,
  ArtifactGroups,
  ArtifactSummary,
  CreateArtifactInput,
  CreateMissionLogInput,
  CreateProjectInput,
  CreateWorkItemInput,
  CreatedProjectBundle,
  Milestone,
  MissionLog,
  MissionLogSummary,
  Project,
  ProjectSummary,
  QueueGroups,
  SuggestedNextAction,
  StatusReportData,
  WeeklyReviewData,
  UpdateArtifactInput,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemSummary
} from "../domain/types.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

function nullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  return trimmed;
}

function titleFromRawInput(rawInput: string): string {
  return required(rawInput, "Raw input").split(/\r?\n/)[0]?.trim().slice(0, 120) || "Untitled work";
}

function validateProjectStatus(value: string): ProjectStatus {
  assertAllowedValue("Project status", value, PROJECT_STATUSES);
  return value;
}

function validateMilestoneStatus(value: string): MilestoneStatus {
  assertAllowedValue("Milestone status", value, MILESTONE_STATUSES);
  return value;
}

function validateQueue(value: string): QueueName {
  assertAllowedValue("Queue", value, QUEUES);
  return value;
}

function validateWorkClassification(value: string): WorkClassification {
  assertAllowedValue("Work classification", value, WORK_CLASSIFICATIONS);
  return value;
}

function validateWorkItemStatus(value: string): WorkItemStatus {
  assertAllowedValue("Work item status", value, WORK_ITEM_STATUSES);
  return value;
}

function validateArtifactStatus(value: string): ArtifactStatus {
  assertAllowedValue("Artifact status", value, ARTIFACT_STATUSES);
  return value;
}

function insertProject(db: Database.Database, input: CreateProjectInput, timestamp: string): Project {
  const project: Project = {
    id: createId("project"),
    name: required(input.name, "Project name"),
    mission: required(input.mission, "Mission"),
    status: validateProjectStatus(input.status),
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO projects (id, name, mission, status, created_at, updated_at)
     VALUES (@id, @name, @mission, @status, @created_at, @updated_at)`
  ).run(project);

  return project;
}

function insertMilestone(
  db: Database.Database,
  projectId: string,
  title: string,
  status: MilestoneStatus,
  timestamp: string
): Milestone {
  const milestone: Milestone = {
    id: createId("milestone"),
    project_id: projectId,
    title: required(title, "Milestone"),
    status: validateMilestoneStatus(status),
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO milestones (id, project_id, title, status, created_at, updated_at)
     VALUES (@id, @project_id, @title, @status, @created_at, @updated_at)`
  ).run(milestone);

  return milestone;
}

function insertWorkItem(db: Database.Database, input: CreateWorkItemInput, timestamp: string): WorkItem {
  const queue = validateQueue(input.queue);
  const workClassification = validateWorkClassification(input.workClassification);
  const status = validateWorkItemStatus(input.status ?? (queue === "blocked" ? "blocked" : "open"));
  const rawInput = required(input.rawInput, "Raw input");

  const workItem: WorkItem = {
    id: createId("workItem"),
    project_id: input.projectId ?? null,
    milestone_id: input.milestoneId ?? null,
    title: required(input.title || titleFromRawInput(rawInput), "Work item title"),
    raw_input: rawInput,
    queue,
    work_classification: workClassification,
    next_action: required(input.nextAction, "Next action"),
    expected_artifact: nullable(input.expectedArtifact),
    status,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO work_items (
      id, project_id, milestone_id, title, raw_input, queue, work_classification,
      next_action, expected_artifact, status, created_at, updated_at
    ) VALUES (
      @id, @project_id, @milestone_id, @title, @raw_input, @queue, @work_classification,
      @next_action, @expected_artifact, @status, @created_at, @updated_at
    )`
  ).run(workItem);

  return workItem;
}

function insertArtifact(db: Database.Database, input: CreateArtifactInput, timestamp: string): Artifact {
  const artifact: Artifact = {
    id: createId("artifact"),
    project_id: input.projectId ?? null,
    work_item_id: input.workItemId ?? null,
    title: required(input.title, "Artifact title"),
    artifact_type: required(input.artifactType, "Artifact type"),
    status: validateArtifactStatus(input.status ?? "planned"),
    path: input.path ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO artifacts (
      id, project_id, work_item_id, title, artifact_type, status, path, created_at, updated_at
    ) VALUES (
      @id, @project_id, @work_item_id, @title, @artifact_type, @status, @path, @created_at, @updated_at
    )`
  ).run(artifact);

  return artifact;
}

export function createProjectWithInitialWork(
  db: Database.Database,
  input: CreateProjectInput
): CreatedProjectBundle {
  const transaction = db.transaction(() => {
    const timestamp = nowIso();
    const project = insertProject(db, input, timestamp);
    const milestone = insertMilestone(db, project.id, input.currentMilestone, "active", timestamp);
    const expectedArtifact = nullable(input.expectedArtifact);
    const workItem = insertWorkItem(
      db,
      {
        projectId: project.id,
        milestoneId: milestone.id,
        title: input.nextAction,
        rawInput: input.nextAction,
        queue: queueForWorkClassification(validateWorkClassification(input.workClassification)),
        workClassification: input.workClassification,
        nextAction: input.nextAction,
        expectedArtifact: expectedArtifact ?? undefined
      },
      timestamp
    );
    const artifact = expectedArtifact
      ? insertArtifact(
          db,
          {
            projectId: project.id,
            workItemId: workItem.id,
            title: expectedArtifact,
            artifactType: "expected_artifact",
            status: "planned"
          },
          timestamp
        )
      : null;

    return { project, milestone, workItem, artifact };
  });

  return transaction();
}

export function createWorkItemWithOptionalArtifact(
  db: Database.Database,
  input: CreateWorkItemInput
): { workItem: WorkItem; artifact: Artifact | null } {
  const transaction = db.transaction(() => {
    const timestamp = nowIso();
    const workItem = insertWorkItem(db, input, timestamp);
    const expectedArtifact = nullable(input.expectedArtifact);
    const artifact = expectedArtifact
      ? insertArtifact(
          db,
          {
            projectId: input.projectId ?? null,
            workItemId: workItem.id,
            title: expectedArtifact,
            artifactType: "expected_artifact",
            status: "planned"
          },
          timestamp
        )
      : null;

    return { workItem, artifact };
  });

  return transaction();
}

export function createMissionLog(db: Database.Database, input: CreateMissionLogInput): MissionLog {
  const timestamp = nowIso();
  const missionLog: MissionLog = {
    id: input.id ?? createId("missionLog"),
    project_id: input.projectId ?? null,
    milestone_id: input.milestoneId ?? null,
    work_performed: required(input.workPerformed, "Work performed"),
    result: required(input.result, "Result"),
    blockers: nullable(input.blockers),
    next_action: required(input.nextAction, "Next action"),
    artifact_impact: nullable(input.artifactImpact),
    markdown_path: required(input.markdownPath, "Markdown path"),
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO mission_logs (
      id, project_id, milestone_id, work_performed, result, blockers, next_action,
      artifact_impact, markdown_path, created_at, updated_at
    ) VALUES (
      @id, @project_id, @milestone_id, @work_performed, @result, @blockers, @next_action,
      @artifact_impact, @markdown_path, @created_at, @updated_at
    )`
  ).run(missionLog);

  return missionLog;
}

export function listProjects(db: Database.Database): Project[] {
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function getProject(db: Database.Database, id: string): Project | null {
  return (db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined) ?? null;
}

export function updateProjectStatus(db: Database.Database, id: string, status: string): Project | null {
  const projectStatus = validateProjectStatus(status);

  if (!getProject(db, id)) {
    return null;
  }

  db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(projectStatus, nowIso(), id);
  return getProject(db, id);
}

export function getMilestone(db: Database.Database, id: string): Milestone | null {
  return (db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as Milestone | undefined) ?? null;
}

export function createMilestoneForProject(
  db: Database.Database,
  projectId: string,
  title: string,
  status = "active"
): Milestone | null {
  const milestoneStatus = validateMilestoneStatus(status);

  if (!getProject(db, projectId)) {
    return null;
  }

  return insertMilestone(db, projectId, title, milestoneStatus, nowIso());
}

export function updateMilestoneStatus(db: Database.Database, id: string, status: string): Milestone | null {
  const milestoneStatus = validateMilestoneStatus(status);

  if (!getMilestone(db, id)) {
    return null;
  }

  db.prepare("UPDATE milestones SET status = ?, updated_at = ? WHERE id = ?").run(milestoneStatus, nowIso(), id);
  return getMilestone(db, id);
}

export function completeMilestone(db: Database.Database, id: string): Milestone | null {
  return updateMilestoneStatus(db, id, "completed");
}

export function listMilestonesForProject(db: Database.Database, projectId: string): Milestone[] {
  return db
    .prepare("SELECT * FROM milestones WHERE project_id = ? ORDER BY status = 'active' DESC, created_at DESC")
    .all(projectId) as Milestone[];
}

export function getActiveMilestoneForProject(db: Database.Database, projectId: string): Milestone | null {
  return (
    (db
      .prepare("SELECT * FROM milestones WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
      .get(projectId) as Milestone | undefined) ?? null
  );
}

export function listProjectSummaries(db: Database.Database): ProjectSummary[] {
  return db
    .prepare(
      `SELECT
        p.*,
        (
          SELECT m.title
          FROM milestones m
          WHERE m.project_id = p.id AND m.status = 'active'
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS current_milestone,
        (
          SELECT m.id
          FROM milestones m
          WHERE m.project_id = p.id AND m.status = 'active'
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS current_milestone_id,
        (
          SELECT wi.next_action
          FROM work_items wi
          WHERE wi.project_id = p.id AND wi.status != 'done'
          ORDER BY wi.created_at DESC
          LIMIT 1
        ) AS next_action,
        (
          SELECT wi.work_classification
          FROM work_items wi
          WHERE wi.project_id = p.id AND wi.status != 'done'
          ORDER BY wi.created_at DESC
          LIMIT 1
        ) AS work_classification,
        (
          SELECT wi.expected_artifact
          FROM work_items wi
          WHERE wi.project_id = p.id AND wi.status != 'done'
          ORDER BY wi.created_at DESC
          LIMIT 1
        ) AS expected_artifact
      FROM projects p
      ORDER BY p.created_at DESC`
    )
    .all() as ProjectSummary[];
}

function listOpenWorkItems(db: Database.Database, whereSql: string, parameters: unknown[] = []): WorkItemSummary[] {
  return db
    .prepare(
      `SELECT
        wi.*,
        p.name AS project_name,
        m.title AS milestone_title
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN milestones m ON m.id = wi.milestone_id
      WHERE wi.status != 'done' AND (${whereSql})
      ORDER BY wi.created_at DESC`
    )
    .all(...parameters) as WorkItemSummary[];
}

export function listQueueGroups(db: Database.Database): QueueGroups {
  return {
    inbox: listOpenWorkItems(db, "wi.queue = ?", ["inbox"]),
    work_queue: listOpenWorkItems(db, "wi.queue = ?", ["work_queue"]),
    needs_mark: listOpenWorkItems(db, "wi.queue = ?", ["needs_mark"]),
    blocked: listOpenWorkItems(db, "wi.queue = ?", ["blocked"])
  };
}

export function listRecentlyCompletedWorkItems(db: Database.Database, limit = 10): WorkItemSummary[] {
  return db
    .prepare(
      `SELECT
        wi.*,
        p.name AS project_name,
        m.title AS milestone_title
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN milestones m ON m.id = wi.milestone_id
      WHERE wi.status = 'done'
      ORDER BY wi.updated_at DESC, wi.created_at DESC
      LIMIT ?`
    )
    .all(limit) as WorkItemSummary[];
}

export function listWorkItems(db: Database.Database): WorkItemSummary[] {
  return db
    .prepare(
      `SELECT
        wi.*,
        p.name AS project_name,
        m.title AS milestone_title
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN milestones m ON m.id = wi.milestone_id
      ORDER BY wi.status = 'done' ASC, wi.updated_at DESC, wi.created_at DESC`
    )
    .all() as WorkItemSummary[];
}

export function getWorkItem(db: Database.Database, id: string): WorkItemSummary | null {
  return (
    (db
      .prepare(
        `SELECT
          wi.*,
          p.name AS project_name,
          m.title AS milestone_title
        FROM work_items wi
        LEFT JOIN projects p ON p.id = wi.project_id
        LEFT JOIN milestones m ON m.id = wi.milestone_id
        WHERE wi.id = ?`
      )
      .get(id) as WorkItemSummary | undefined) ?? null
  );
}

export function updateWorkItem(
  db: Database.Database,
  id: string,
  input: UpdateWorkItemInput
): WorkItemSummary | null {
  const updates: string[] = [];
  const parameters: Record<string, string> = { id };

  if (input.queue !== undefined) {
    parameters.queue = validateQueue(input.queue);
    updates.push("queue = @queue");
  }

  if (input.workClassification !== undefined) {
    parameters.work_classification = validateWorkClassification(input.workClassification);
    updates.push("work_classification = @work_classification");
  }

  if (input.nextAction !== undefined) {
    parameters.next_action = required(input.nextAction, "Next action");
    updates.push("next_action = @next_action");
  }

  if (input.status !== undefined) {
    parameters.status = validateWorkItemStatus(input.status);
    updates.push("status = @status");
  }

  if (updates.length === 0) {
    throw new Error("At least one work item field is required");
  }

  if (!getWorkItem(db, id)) {
    return null;
  }

  parameters.updated_at = nowIso();
  updates.push("updated_at = @updated_at");

  db.prepare(`UPDATE work_items SET ${updates.join(", ")} WHERE id = @id`).run(parameters);
  return getWorkItem(db, id);
}

export function completeWorkItem(db: Database.Database, id: string): WorkItemSummary | null {
  return updateWorkItem(db, id, { status: "done" });
}

export function listArtifacts(db: Database.Database): ArtifactSummary[] {
  return db
    .prepare(
      `SELECT
        a.*,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM artifacts a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN work_items wi ON wi.id = a.work_item_id
      ORDER BY a.updated_at DESC, a.created_at DESC`
    )
    .all() as ArtifactSummary[];
}

export function getArtifact(db: Database.Database, id: string): ArtifactSummary | null {
  return (
    (db
      .prepare(
        `SELECT
          a.*,
          p.name AS project_name,
          wi.title AS work_item_title
        FROM artifacts a
        LEFT JOIN projects p ON p.id = a.project_id
        LEFT JOIN work_items wi ON wi.id = a.work_item_id
        WHERE a.id = ?`
      )
      .get(id) as ArtifactSummary | undefined) ?? null
  );
}

export function updateArtifact(
  db: Database.Database,
  id: string,
  input: UpdateArtifactInput
): ArtifactSummary | null {
  const updates: string[] = [];
  const parameters: Record<string, string | null> = { id };

  if (input.status !== undefined) {
    parameters.status = validateArtifactStatus(input.status);
    updates.push("status = @status");
  }

  if (input.path !== undefined) {
    parameters.path = nullable(input.path);
    updates.push("path = @path");
  }

  if (updates.length === 0) {
    throw new Error("At least one artifact field is required");
  }

  if (!getArtifact(db, id)) {
    return null;
  }

  parameters.updated_at = nowIso();
  updates.push("updated_at = @updated_at");

  db.prepare(`UPDATE artifacts SET ${updates.join(", ")} WHERE id = @id`).run(parameters);
  return getArtifact(db, id);
}

export function listArtifactsByStatus(db: Database.Database): ArtifactGroups {
  const groups: ArtifactGroups = {
    planned: [],
    drafted: [],
    ready: [],
    published: []
  };

  for (const artifact of listArtifacts(db)) {
    groups[artifact.status].push(artifact);
  }

  return groups;
}

export function listRecentMissionLogs(db: Database.Database, limit = 10): MissionLogSummary[] {
  return db
    .prepare(
      `SELECT
        ml.*,
        p.name AS project_name,
        m.title AS milestone_title
      FROM mission_logs ml
      LEFT JOIN projects p ON p.id = ml.project_id
      LEFT JOIN milestones m ON m.id = ml.milestone_id
      ORDER BY ml.created_at DESC
      LIMIT ?`
    )
    .all(limit) as MissionLogSummary[];
}

export function listUpcomingArtifacts(db: Database.Database, limit = 20): ArtifactSummary[] {
  return db
    .prepare(
      `SELECT
        a.*,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM artifacts a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN work_items wi ON wi.id = a.work_item_id
      WHERE a.status IN ('planned', 'drafted', 'ready')
      ORDER BY a.created_at DESC
      LIMIT ?`
    )
    .all(limit) as ArtifactSummary[];
}

export function buildStatusReportData(db: Database.Database, workspacePath: string): StatusReportData {
  return {
    workspacePath,
    generatedAt: nowIso(),
    projects: listProjectSummaries(db),
    queues: listQueueGroups(db),
    needsMarkItems: listOpenWorkItems(db, "wi.queue = 'needs_mark' OR wi.work_classification = 'needs_mark'"),
    autonomousItems: listOpenWorkItems(
      db,
      "wi.work_classification = 'autonomous' AND wi.queue != 'blocked'"
    ),
    codexItems: listOpenWorkItems(db, "wi.work_classification = 'codex' AND wi.queue != 'blocked'"),
    blockedItems: listOpenWorkItems(
      db,
      "wi.queue = 'blocked' OR wi.work_classification = 'blocked' OR wi.status = 'blocked'"
    ),
    recentlyCompletedWorkItems: listRecentlyCompletedWorkItems(db),
    recentMissionLogs: listRecentMissionLogs(db),
    upcomingArtifacts: listUpcomingArtifacts(db),
    artifactsByStatus: listArtifactsByStatus(db)
  };
}

export function buildWeeklyReviewData(
  db: Database.Database,
  workspacePath: string,
  window: { since: string; until: string }
): WeeklyReviewData {
  const completedWorkItems = listCompletedWorkItemsInWindow(db, window);
  const missionLogs = listMissionLogsInWindow(db, window);
  const blockedItems = listOpenWorkItems(
    db,
    "wi.queue = 'blocked' OR wi.work_classification = 'blocked' OR wi.status = 'blocked'"
  );
  const needsMarkItems = listOpenWorkItems(db, "wi.queue = 'needs_mark' OR wi.work_classification = 'needs_mark'");
  const autonomousItems = listOpenWorkItems(
    db,
    "wi.work_classification = 'autonomous' AND wi.queue != 'blocked'"
  );
  const codexItems = listOpenWorkItems(db, "wi.work_classification = 'codex' AND wi.queue != 'blocked'");
  const artifactItems = listArtifactChangesOrUpcoming(db, window);
  const projectsWithoutOpenNextActions = listProjectsWithoutOpenNextActions(db);

  return {
    workspacePath,
    generatedAt: nowIso(),
    window,
    completedWorkItems,
    missionLogs,
    blockedItems,
    needsMarkItems,
    autonomousItems,
    codexItems,
    artifactItems,
    projectsWithoutOpenNextActions,
    suggestedNextActions: buildSuggestedNextActions({
      projectsWithoutOpenNextActions,
      needsMarkItems,
      blockedItems,
      codexItems,
      autonomousItems,
      artifactItems
    })
  };
}

export function countRows(db: Database.Database, table: string): number {
  if (!["projects", "milestones", "work_items", "mission_logs", "artifacts"].includes(table)) {
    throw new Error(`Unsupported table: ${table}`);
  }

  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function listCompletedWorkItemsInWindow(
  db: Database.Database,
  window: { since: string; until: string }
): WorkItemSummary[] {
  return db
    .prepare(
      `SELECT
        wi.*,
        p.name AS project_name,
        m.title AS milestone_title
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN milestones m ON m.id = wi.milestone_id
      WHERE wi.status = 'done'
        AND substr(wi.updated_at, 1, 10) >= @since
        AND substr(wi.updated_at, 1, 10) <= @until
      ORDER BY wi.updated_at DESC, wi.created_at DESC, wi.id ASC`
    )
    .all(window) as WorkItemSummary[];
}

function listMissionLogsInWindow(
  db: Database.Database,
  window: { since: string; until: string }
): MissionLogSummary[] {
  return db
    .prepare(
      `SELECT
        ml.*,
        p.name AS project_name,
        m.title AS milestone_title
      FROM mission_logs ml
      LEFT JOIN projects p ON p.id = ml.project_id
      LEFT JOIN milestones m ON m.id = ml.milestone_id
      WHERE substr(ml.created_at, 1, 10) >= @since
        AND substr(ml.created_at, 1, 10) <= @until
      ORDER BY ml.created_at DESC, ml.id ASC`
    )
    .all(window) as MissionLogSummary[];
}

function listArtifactChangesOrUpcoming(
  db: Database.Database,
  window: { since: string; until: string }
): ArtifactSummary[] {
  return db
    .prepare(
      `SELECT
        a.*,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM artifacts a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN work_items wi ON wi.id = a.work_item_id
      WHERE a.status IN ('planned', 'drafted', 'ready')
        OR (
          substr(a.created_at, 1, 10) >= @since
          AND substr(a.created_at, 1, 10) <= @until
        )
        OR (
          substr(a.updated_at, 1, 10) >= @since
          AND substr(a.updated_at, 1, 10) <= @until
        )
      ORDER BY a.updated_at DESC, a.created_at DESC, a.id ASC`
    )
    .all(window) as ArtifactSummary[];
}

function listProjectsWithoutOpenNextActions(db: Database.Database): ProjectSummary[] {
  return db
    .prepare(
      `SELECT
        p.*,
        (
          SELECT m.title
          FROM milestones m
          WHERE m.project_id = p.id AND m.status = 'active'
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS current_milestone,
        (
          SELECT m.id
          FROM milestones m
          WHERE m.project_id = p.id AND m.status = 'active'
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS current_milestone_id,
        NULL AS next_action,
        NULL AS work_classification,
        NULL AS expected_artifact
      FROM projects p
      WHERE p.status != 'completed'
        AND NOT EXISTS (
          SELECT 1
          FROM work_items wi
          WHERE wi.project_id = p.id AND wi.status != 'done'
        )
      ORDER BY p.created_at DESC, p.id ASC`
    )
    .all() as ProjectSummary[];
}

function buildSuggestedNextActions(input: {
  projectsWithoutOpenNextActions: ProjectSummary[];
  needsMarkItems: WorkItemSummary[];
  blockedItems: WorkItemSummary[];
  codexItems: WorkItemSummary[];
  autonomousItems: WorkItemSummary[];
  artifactItems: ArtifactSummary[];
}): SuggestedNextAction[] {
  const suggestions: SuggestedNextAction[] = [];
  const seenWorkItems = new Set<string>();

  for (const project of input.projectsWithoutOpenNextActions) {
    suggestions.push({
      sourceType: "project",
      sourceId: project.id,
      title: project.name,
      nextAction: `Define an open next action for ${project.name}.`
    });
  }

  for (const item of input.needsMarkItems) {
    seenWorkItems.add(item.id);
    suggestions.push(workItemSuggestion(item, "Needs Mark"));
  }

  for (const item of input.blockedItems) {
    if (seenWorkItems.has(item.id)) {
      continue;
    }
    seenWorkItems.add(item.id);
    suggestions.push(workItemSuggestion(item, "Blocked"));
  }

  for (const item of [...input.codexItems, ...input.autonomousItems]) {
    if (seenWorkItems.has(item.id)) {
      continue;
    }
    seenWorkItems.add(item.id);
    suggestions.push(workItemSuggestion(item, "Open"));
  }

  for (const artifact of input.artifactItems) {
    if (artifact.status === "published") {
      continue;
    }
    suggestions.push({
      sourceType: "artifact",
      sourceId: artifact.id,
      title: artifact.title,
      nextAction: `Advance artifact "${artifact.title}" from ${artifact.status}.`
    });
  }

  return suggestions;
}

function workItemSuggestion(item: WorkItemSummary, prefix: string): SuggestedNextAction {
  return {
    sourceType: "work_item",
    sourceId: item.id,
    title: item.title,
    nextAction: `${prefix}: ${item.next_action}`
  };
}
