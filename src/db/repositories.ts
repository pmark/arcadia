import type Database from "better-sqlite3";
import {
  ARTIFACT_STATUSES,
  APPROVAL_GATE_STATUSES,
  APPROVAL_GATE_TYPES,
  ASK_REQUEST_STATUSES,
  CODEX_INVOCATION_PURPOSES,
  CODEX_INVOCATION_STATUSES,
  EXECUTION_PLAN_STATUSES,
  EXECUTION_RUN_STATUSES,
  EXECUTION_STEP_STATUSES,
  EXECUTOR_TYPES,
  MILESTONE_STATUSES,
  PROJECT_STATUSES,
  QUEUES,
  WORK_CLASSIFICATIONS,
  WORK_ITEM_STATUSES,
  assertAllowedValue,
  queueForWorkClassification,
  type ArtifactStatus,
  type ApprovalGateStatus,
  type ApprovalGateType,
  type AskRequestStatus,
  type CodexInvocationPurpose,
  type CodexInvocationStatus,
  type ExecutionPlanStatus,
  type ExecutionRunStatus,
  type ExecutionStepStatus,
  type ExecutorType,
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
  ApprovalGate,
  AskRequest,
  AskRequestSummary,
  CodexInvocation,
  CreateApprovalGateInput,
  CreateArtifactInput,
  CreateAskRequestInput,
  CreateCodexInvocationInput,
  CreateMissionLogInput,
  CreateProjectInput,
  CreateWorkItemInput,
  CreatedProjectBundle,
  ExecutionPlan,
  ExecutionPlanStep,
  ExecutionPlanStepSummary,
  ExecutionPlanSummary,
  ExecutionRun,
  ExecutionRunStep,
  ExecutionRunSummary,
  Milestone,
  MilestoneSummary,
  MissionLog,
  MissionLogSummary,
  Project,
  ProjectContext,
  ProjectMetadata,
  ProjectSummary,
  QueueGroups,
  SkillDefinition,
  SuggestedNextAction,
  StatusReportData,
  UpsertProjectMetadataInput,
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

function normalizedUniqueValues(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function encodeStringArray(values: string[] | undefined): string {
  return JSON.stringify(normalizedUniqueValues(values));
}

function decodeStringArray(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean);
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

function normalizeProjectReference(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
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

function validateAskRequestStatus(value: string): AskRequestStatus {
  assertAllowedValue("Ask request status", value, ASK_REQUEST_STATUSES);
  return value;
}

function validateApprovalGateType(value: string): ApprovalGateType {
  assertAllowedValue("Approval gate type", value, APPROVAL_GATE_TYPES);
  return value;
}

function validateApprovalGateStatus(value: string): ApprovalGateStatus {
  assertAllowedValue("Approval gate status", value, APPROVAL_GATE_STATUSES);
  return value;
}

function validateCodexInvocationPurpose(value: string): CodexInvocationPurpose {
  assertAllowedValue("Codex invocation purpose", value, CODEX_INVOCATION_PURPOSES);
  return value;
}

function validateCodexInvocationStatus(value: string): CodexInvocationStatus {
  assertAllowedValue("Codex invocation status", value, CODEX_INVOCATION_STATUSES);
  return value;
}

function validateExecutorType(value: string): ExecutorType {
  assertAllowedValue("Executor type", value, EXECUTOR_TYPES);
  return value;
}

function validateExecutionPlanStatus(value: string): ExecutionPlanStatus {
  assertAllowedValue("Execution plan status", value, EXECUTION_PLAN_STATUSES);
  return value;
}

function validateExecutionRunStatus(value: string): ExecutionRunStatus {
  assertAllowedValue("Execution run status", value, EXECUTION_RUN_STATUSES);
  return value;
}

function validateExecutionStepStatus(value: string): ExecutionStepStatus {
  assertAllowedValue("Execution step status", value, EXECUTION_STEP_STATUSES);
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

export function upsertProjectMetadata(
  db: Database.Database,
  input: UpsertProjectMetadataInput
): ProjectMetadata | null {
  if (!getProject(db, input.projectId)) {
    return null;
  }

  const timestamp = nowIso();
  const existing = getProjectMetadata(db, input.projectId);
  const metadata: ProjectMetadata = {
    project_id: input.projectId,
    aliases: encodeStringArray(input.aliases),
    repo_path: nullable(input.repoPath),
    status_summary: nullable(input.statusSummary),
    validation_commands: encodeStringArray(input.validationCommands),
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO project_metadata (
      project_id, aliases, repo_path, status_summary, validation_commands, created_at, updated_at
    ) VALUES (
      @project_id, @aliases, @repo_path, @status_summary, @validation_commands, @created_at, @updated_at
    )
    ON CONFLICT(project_id) DO UPDATE SET
      aliases = excluded.aliases,
      repo_path = excluded.repo_path,
      status_summary = excluded.status_summary,
      validation_commands = excluded.validation_commands,
      updated_at = excluded.updated_at`
  ).run(metadata);

  return getProjectMetadata(db, input.projectId);
}

export function getProjectMetadata(db: Database.Database, projectId: string): ProjectMetadata | null {
  return (
    (db.prepare("SELECT * FROM project_metadata WHERE project_id = ?").get(projectId) as ProjectMetadata | undefined) ??
    null
  );
}

export function getProjectContext(db: Database.Database, projectId: string): ProjectContext | null {
  const project = getProject(db, projectId);
  if (!project) {
    return null;
  }

  return {
    project,
    metadata: getProjectMetadata(db, projectId),
    activeMilestone: getActiveMilestoneForProject(db, projectId)
  };
}

export function resolveProjectContextFromRequest(db: Database.Database, request: string): ProjectContext | null {
  const normalizedRequest = ` ${normalizeProjectReference(request)} `;
  const matches = listProjects(db).flatMap((project) => {
    const metadata = getProjectMetadata(db, project.id);
    const aliases = decodeStringArray(metadata?.aliases);
    const candidates = normalizedUniqueValues([project.name, ...aliases])
      .map((candidate) => ({
        raw: candidate,
        normalized: normalizeProjectReference(candidate)
      }))
      .filter((candidate) => candidate.normalized.length > 0);
    return candidates
      .filter((candidate) => normalizedRequest.includes(` ${candidate.normalized} `))
      .map((candidate) => ({
        project,
        metadata,
        activeMilestone: getActiveMilestoneForProject(db, project.id),
        matchedAlias: candidate.raw,
        score: candidate.normalized.length
      }));
  });

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) =>
    right.score - left.score ||
    left.project.name.localeCompare(right.project.name) ||
    left.project.id.localeCompare(right.project.id)
  );

  const best = matches[0];
  const ambiguous = matches.find(
    (match) => match.score === best.score && match.project.id !== best.project.id
  );
  if (ambiguous) {
    throw new Error(
      `Project reference is ambiguous: ${best.matchedAlias} matches ${best.project.name} and ${ambiguous.project.name}`
    );
  }

  return {
    project: best.project,
    metadata: best.metadata,
    activeMilestone: best.activeMilestone
  };
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

export function listMilestones(
  db: Database.Database,
  options: { status?: string; limit?: number } = {}
): MilestoneSummary[] {
  const conditions: string[] = [];
  const parameters: Record<string, unknown> = {
    limit: options.limit ?? 10
  };

  if (options.status !== undefined) {
    parameters.status = validateMilestoneStatus(options.status);
    conditions.push("m.status = @status");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return db
    .prepare(
      `SELECT
        m.*,
        p.name AS project_name
      FROM milestones m
      JOIN projects p ON p.id = m.project_id
      ${where}
      ORDER BY m.updated_at DESC, m.created_at DESC
      LIMIT @limit`
    )
    .all(parameters) as MilestoneSummary[];
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

export interface UpsertSkillDefinitionInput {
  name: string;
  title: string;
  description: string;
  executorType: string;
  safeToRun: boolean;
}

export interface CreateExecutionPlanInput {
  workItemId: string;
  summary: string;
  steps: Array<{
    skillName: string;
    title: string;
    command?: string | null;
    executorType: string;
    safeToRun: boolean;
    needsMark?: string | null;
  }>;
}

export interface CreateExecutionRunInput {
  workItemId: string;
  planId: string;
  status: string;
  summary: string;
  missionLogId?: string | null;
  steps: Array<{
    planStepId: string;
    status: string;
    command?: string | null;
    output?: string | null;
    error?: string | null;
    artifactPath?: string | null;
  }>;
  artifactIds?: string[];
}

export function upsertSkillDefinition(db: Database.Database, input: UpsertSkillDefinitionInput): SkillDefinition {
  const timestamp = nowIso();
  const existing = getSkillDefinitionByName(db, input.name);
  const values = {
    id: existing?.id ?? createId("skill"),
    name: required(input.name, "Skill name"),
    title: required(input.title, "Skill title"),
    description: required(input.description, "Skill description"),
    executor_type: validateExecutorType(input.executorType),
    safe_to_run: input.safeToRun ? 1 : 0,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO skill_definitions (
      id, name, title, description, executor_type, safe_to_run, created_at, updated_at
    ) VALUES (
      @id, @name, @title, @description, @executor_type, @safe_to_run, @created_at, @updated_at
    )
    ON CONFLICT(name) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      executor_type = excluded.executor_type,
      safe_to_run = excluded.safe_to_run,
      updated_at = excluded.updated_at`
  ).run(values);

  return getSkillDefinitionByName(db, input.name) as SkillDefinition;
}

export function getSkillDefinitionByName(db: Database.Database, name: string): SkillDefinition | null {
  return (db.prepare("SELECT * FROM skill_definitions WHERE name = ?").get(name) as SkillDefinition | undefined) ?? null;
}

export function createExecutionPlan(db: Database.Database, input: CreateExecutionPlanInput): ExecutionPlanSummary | null {
  if (!getWorkItem(db, input.workItemId)) {
    return null;
  }

  const transaction = db.transaction(() => {
    const timestamp = nowIso();
    const plan: ExecutionPlan = {
      id: createId("executionPlan"),
      work_item_id: input.workItemId,
      status: validateExecutionPlanStatus("planned"),
      summary: required(input.summary, "Execution plan summary"),
      created_at: timestamp,
      updated_at: timestamp
    };

    db.prepare(
      `INSERT INTO execution_plans (id, work_item_id, status, summary, created_at, updated_at)
       VALUES (@id, @work_item_id, @status, @summary, @created_at, @updated_at)`
    ).run(plan);

    for (const [index, step] of input.steps.entries()) {
      const skill = getSkillDefinitionByName(db, step.skillName);
      if (!skill) {
        throw new Error(`Skill is required: ${step.skillName}`);
      }

      const planStep: ExecutionPlanStep = {
        id: createId("executionStep"),
        plan_id: plan.id,
        skill_id: skill.id,
        position: index + 1,
        title: required(step.title, "Execution step title"),
        command: nullable(step.command),
        executor_type: validateExecutorType(step.executorType),
        safe_to_run: step.safeToRun ? 1 : 0,
        status: validateExecutionStepStatus("pending"),
        needs_mark: nullable(step.needsMark),
        created_at: timestamp,
        updated_at: timestamp
      };

      db.prepare(
        `INSERT INTO execution_plan_steps (
          id, plan_id, skill_id, position, title, command, executor_type, safe_to_run,
          status, needs_mark, created_at, updated_at
        ) VALUES (
          @id, @plan_id, @skill_id, @position, @title, @command, @executor_type, @safe_to_run,
          @status, @needs_mark, @created_at, @updated_at
        )`
      ).run(planStep);
    }

    return getExecutionPlan(db, plan.id) as ExecutionPlanSummary;
  });

  return transaction();
}

export function getExecutionPlan(db: Database.Database, id: string): ExecutionPlanSummary | null {
  const plan = (db.prepare("SELECT * FROM execution_plans WHERE id = ?").get(id) as ExecutionPlan | undefined) ?? null;
  if (!plan) {
    return null;
  }

  return { ...plan, steps: listExecutionPlanSteps(db, id) };
}

export function getLatestExecutionPlanForWorkItem(
  db: Database.Database,
  workItemId: string
): ExecutionPlanSummary | null {
  const row = db
    .prepare("SELECT id FROM execution_plans WHERE work_item_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(workItemId) as { id: string } | undefined;

  return row ? getExecutionPlan(db, row.id) : null;
}

export function listExecutionPlanSteps(db: Database.Database, planId: string): ExecutionPlanStepSummary[] {
  return db
    .prepare(
      `SELECT
        eps.*,
        sd.name AS skill_name
      FROM execution_plan_steps eps
      JOIN skill_definitions sd ON sd.id = eps.skill_id
      WHERE eps.plan_id = ?
      ORDER BY eps.position ASC`
    )
    .all(planId) as ExecutionPlanStepSummary[];
}

export function createArtifactRecord(db: Database.Database, input: CreateArtifactInput): Artifact {
  return insertArtifact(db, input, nowIso());
}

export function createAskRequest(db: Database.Database, input: CreateAskRequestInput): AskRequestSummary {
  const timestamp = nowIso();
  const askRequest: AskRequest = {
    id: input.id ?? createId("askRequest"),
    raw_request: required(input.rawRequest, "Ask request"),
    resolved_intent: required(input.resolvedIntent, "Resolved intent"),
    registry_version: input.registryVersion,
    output_kind: required(input.outputKind, "Output kind"),
    work_item_id: input.workItemId ?? null,
    plan_id: input.planId ?? null,
    prompt_packet_path: nullable(input.promptPacketPath),
    status: validateAskRequestStatus(input.status),
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO ask_requests (
      id, raw_request, resolved_intent, registry_version, output_kind, work_item_id,
      plan_id, prompt_packet_path, status, created_at, updated_at
    ) VALUES (
      @id, @raw_request, @resolved_intent, @registry_version, @output_kind, @work_item_id,
      @plan_id, @prompt_packet_path, @status, @created_at, @updated_at
    )`
  ).run(askRequest);

  const created = getAskRequest(db, askRequest.id);
  if (!created) {
    throw new Error(`Ask request could not be created: ${askRequest.id}`);
  }

  return created;
}

export function getAskRequest(db: Database.Database, id: string): AskRequestSummary | null {
  return (
    (db
      .prepare(
        `SELECT
          ar.*,
          wi.title AS work_item_title,
          ep.summary AS plan_summary
        FROM ask_requests ar
        LEFT JOIN work_items wi ON wi.id = ar.work_item_id
        LEFT JOIN execution_plans ep ON ep.id = ar.plan_id
        WHERE ar.id = ?`
      )
      .get(id) as AskRequestSummary | undefined) ?? null
  );
}

export function createApprovalGate(db: Database.Database, input: CreateApprovalGateInput): ApprovalGate {
  const timestamp = nowIso();
  const gate: ApprovalGate = {
    id: createId("approvalGate"),
    gate_type: validateApprovalGateType(input.gateType),
    reason: required(input.reason, "Approval gate reason"),
    work_item_id: input.workItemId ?? null,
    plan_id: input.planId ?? null,
    plan_step_id: input.planStepId ?? null,
    status: validateApprovalGateStatus(input.status ?? "pending"),
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO approval_gates (
      id, gate_type, reason, work_item_id, plan_id, plan_step_id, status, created_at, updated_at
    ) VALUES (
      @id, @gate_type, @reason, @work_item_id, @plan_id, @plan_step_id, @status, @created_at, @updated_at
    )`
  ).run(gate);

  return gate;
}

export function listApprovalGatesForWorkItem(db: Database.Database, workItemId: string): ApprovalGate[] {
  return db
    .prepare("SELECT * FROM approval_gates WHERE work_item_id = ? ORDER BY created_at ASC, id ASC")
    .all(workItemId) as ApprovalGate[];
}

export function createCodexInvocation(
  db: Database.Database,
  input: CreateCodexInvocationInput
): CodexInvocation {
  const timestamp = nowIso();
  const invocation: CodexInvocation = {
    id: input.id ?? createId("codexInvocation"),
    purpose: validateCodexInvocationPurpose(input.purpose),
    agent_profile: required(input.agentProfile, "Agent profile"),
    workspace_scope: required(input.workspaceScope, "Workspace scope"),
    command: required(input.command, "Codex command"),
    prompt_path: required(input.promptPath, "Codex prompt path"),
    jsonl_output_path: required(input.jsonlOutputPath, "Codex JSONL output path"),
    final_message_path: required(input.finalMessagePath, "Codex final message path"),
    status: validateCodexInvocationStatus(input.status ?? "packet_created"),
    work_item_id: input.workItemId ?? null,
    plan_id: input.planId ?? null,
    plan_step_id: input.planStepId ?? null,
    run_id: input.runId ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO codex_invocations (
      id, purpose, agent_profile, workspace_scope, command, prompt_path, jsonl_output_path,
      final_message_path, status, work_item_id, plan_id, plan_step_id, run_id, created_at, updated_at
    ) VALUES (
      @id, @purpose, @agent_profile, @workspace_scope, @command, @prompt_path, @jsonl_output_path,
      @final_message_path, @status, @work_item_id, @plan_id, @plan_step_id, @run_id, @created_at, @updated_at
    )`
  ).run(invocation);

  return invocation;
}

export function listCodexInvocationsForWorkItem(db: Database.Database, workItemId: string): CodexInvocation[] {
  return db
    .prepare("SELECT * FROM codex_invocations WHERE work_item_id = ? ORDER BY created_at ASC, id ASC")
    .all(workItemId) as CodexInvocation[];
}

export function getCodexInvocationForPlan(
  db: Database.Database,
  input: { workItemId: string; planId: string; purpose: string }
): CodexInvocation | null {
  const purpose = validateCodexInvocationPurpose(input.purpose);
  return (
    (db
      .prepare(
        `SELECT * FROM codex_invocations
         WHERE work_item_id = @workItemId AND plan_id = @planId AND purpose = @purpose
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get({ ...input, purpose }) as CodexInvocation | undefined) ?? null
  );
}

export function updateCodexInvocationStatus(
  db: Database.Database,
  id: string,
  status: string
): CodexInvocation | null {
  const invocationStatus = validateCodexInvocationStatus(status);
  const existing = db.prepare("SELECT * FROM codex_invocations WHERE id = ?").get(id) as CodexInvocation | undefined;
  if (!existing) {
    return null;
  }

  db.prepare("UPDATE codex_invocations SET status = ?, updated_at = ? WHERE id = ?").run(
    invocationStatus,
    nowIso(),
    id
  );
  return db.prepare("SELECT * FROM codex_invocations WHERE id = ?").get(id) as CodexInvocation;
}

export function createExecutionRun(db: Database.Database, input: CreateExecutionRunInput): ExecutionRunSummary | null {
  if (!getWorkItem(db, input.workItemId) || !getExecutionPlan(db, input.planId)) {
    return null;
  }

  const transaction = db.transaction(() => {
    const timestamp = nowIso();
    const run: ExecutionRun = {
      id: createId("executionRun"),
      work_item_id: input.workItemId,
      plan_id: input.planId,
      status: validateExecutionRunStatus(input.status),
      summary: required(input.summary, "Execution run summary"),
      mission_log_id: input.missionLogId ?? null,
      created_at: timestamp,
      updated_at: timestamp
    };

    db.prepare(
      `INSERT INTO execution_runs (
        id, work_item_id, plan_id, status, summary, mission_log_id, created_at, updated_at
      ) VALUES (
        @id, @work_item_id, @plan_id, @status, @summary, @mission_log_id, @created_at, @updated_at
      )`
    ).run(run);

    for (const step of input.steps) {
      const runStep: ExecutionRunStep = {
        id: createId("executionRunStep"),
        run_id: run.id,
        plan_step_id: step.planStepId,
        status: validateExecutionStepStatus(step.status),
        command: nullable(step.command),
        output: nullable(step.output),
        error: nullable(step.error),
        artifact_path: nullable(step.artifactPath),
        created_at: timestamp,
        updated_at: timestamp
      };

      db.prepare(
        `INSERT INTO execution_run_steps (
          id, run_id, plan_step_id, status, command, output, error, artifact_path, created_at, updated_at
        ) VALUES (
          @id, @run_id, @plan_step_id, @status, @command, @output, @error, @artifact_path, @created_at, @updated_at
        )`
      ).run(runStep);

      db.prepare("UPDATE execution_plan_steps SET status = ?, updated_at = ? WHERE id = ?").run(
        runStep.status,
        timestamp,
        runStep.plan_step_id
      );
    }

    db.prepare("UPDATE execution_plans SET status = ?, updated_at = ? WHERE id = ?").run(
      run.status === "completed" ? "completed" : run.status,
      timestamp,
      run.plan_id
    );

    for (const artifactId of input.artifactIds ?? []) {
      db.prepare(
        `INSERT INTO run_artifacts (id, run_id, artifact_id, created_at)
         VALUES (@id, @run_id, @artifact_id, @created_at)`
      ).run({
        id: createId("runArtifact"),
        run_id: run.id,
        artifact_id: artifactId,
        created_at: timestamp
      });
    }

    return getExecutionRun(db, run.id) as ExecutionRunSummary;
  });

  return transaction();
}

export function attachMissionLogToExecutionRun(
  db: Database.Database,
  runId: string,
  missionLogId: string
): ExecutionRunSummary | null {
  if (!getExecutionRun(db, runId)) {
    return null;
  }

  db.prepare("UPDATE execution_runs SET mission_log_id = ?, updated_at = ? WHERE id = ?").run(
    missionLogId,
    nowIso(),
    runId
  );
  return getExecutionRun(db, runId);
}

export function getExecutionRun(db: Database.Database, id: string): ExecutionRunSummary | null {
  const run = db
    .prepare(
      `SELECT
        er.*,
        wi.title AS work_item_title,
        ep.summary AS plan_summary,
        ml.markdown_path AS mission_log_path
      FROM execution_runs er
      JOIN work_items wi ON wi.id = er.work_item_id
      JOIN execution_plans ep ON ep.id = er.plan_id
      LEFT JOIN mission_logs ml ON ml.id = er.mission_log_id
      WHERE er.id = ?`
    )
    .get(id) as Omit<ExecutionRunSummary, "steps" | "artifacts"> | undefined;

  if (!run) {
    return null;
  }

  const steps = db
    .prepare(
      `SELECT
        ers.*,
        eps.title AS plan_step_title,
        eps.executor_type AS executor_type
      FROM execution_run_steps ers
      JOIN execution_plan_steps eps ON eps.id = ers.plan_step_id
      WHERE ers.run_id = ?
      ORDER BY ers.created_at ASC, ers.id ASC`
    )
    .all(id) as ExecutionRunSummary["steps"];

  const artifacts = db
    .prepare(
      `SELECT
        a.*,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM run_artifacts ra
      JOIN artifacts a ON a.id = ra.artifact_id
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN work_items wi ON wi.id = a.work_item_id
      WHERE ra.run_id = ?
      ORDER BY ra.created_at ASC`
    )
    .all(id) as ExecutionRunSummary["artifacts"];

  return { ...run, steps, artifacts };
}

export function listExecutionRuns(db: Database.Database, limit = 10): ExecutionRunSummary[] {
  const rows = db
    .prepare("SELECT id FROM execution_runs ORDER BY updated_at DESC, created_at DESC LIMIT ?")
    .all(limit) as Array<{ id: string }>;

  return rows.flatMap((row) => {
    const run = getExecutionRun(db, row.id);
    return run ? [run] : [];
  });
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
  if (
    ![
      "projects",
      "project_metadata",
      "milestones",
      "work_items",
      "mission_logs",
      "artifacts",
      "skill_definitions",
      "execution_plans",
      "execution_plan_steps",
      "execution_runs",
      "execution_run_steps",
      "run_artifacts",
      "ask_requests",
      "approval_gates",
      "codex_invocations"
    ].includes(table)
  ) {
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
