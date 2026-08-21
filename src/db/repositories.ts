import type Database from "better-sqlite3";
import {
  ARTIFACT_STATUSES,
  APPROVAL_GATE_STATUSES,
  APPROVAL_GATE_TYPES,
  ASK_FEEDBACK_DECISIONS,
  ASK_REQUEST_STATUSES,
  BACK_BURNER_FACET_TAGS,
  BACK_BURNER_STATUSES,
  BACK_BURNER_SURFACE_KINDS,
  CLARIFICATION_CONFIDENCE_LEVELS,
  CLARIFICATION_STATUSES,
  CODEX_INVOCATION_PURPOSES,
  CODEX_INVOCATION_STATUSES,
  EXECUTION_PLAN_STATUSES,
  EXECUTION_RUN_STATUSES,
  EXECUTION_STEP_STATUSES,
  EXECUTOR_TYPES,
  GAP_TYPES,
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
  type AskFeedbackDecision,
  type AskRequestStatus,
  type BackBurnerFacetTag,
  type BackBurnerStatus,
  type ClarificationStatus,
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
import { evaluateBackBurnerSurface, isValidSurfaceDate } from "../backBurner/surfacing.js";
import { ORIENTATION_EFFORTS } from "../orientation/types.js";
import type {
  Artifact,
  ArtifactGroups,
  ArtifactSummary,
  ApprovalGate,
  AskFeedback,
  AskRequest,
  AskRequestSummary,
  AssociateCodexTaskInput,
  BackBurnerItem,
  BackBurnerItemSummary,
  CodexInvocation,
  CodexTask,
  CodexTaskSummary,
  CreateApprovalGateInput,
  CreateArtifactInput,
  CreateAskFeedbackInput,
  CreateAskRequestInput,
  CreateBackBurnerItemInput,
  CreateCodexInvocationInput,
  CreateMissionLogInput,
  CreateProjectInput,
  CreateReviewFeedbackInput,
  CreateReviewItemInput,
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
  ObservedCodexTaskInput,
  Project,
  ProjectContext,
  ProjectMetadata,
  ProjectSummary,
  QueueGroups,
  ReviewItem,
  ReviewFeedback,
  ReviewItemStatus,
  ReviewItemSummary,
  SkillDefinition,
  SuggestedNextAction,
  StatusReportData,
  UpsertProjectMetadataInput,
  UpsertProjectInput,
  UpdateProjectInput,
  WeeklyReviewData,
  UpdateArtifactInput,
  UpdateBackBurnerItemInput,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemSummary
} from "../domain/types.js";
import { createId } from "../utils/id.js";
import { slugify } from "../utils/slug.js";
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

function validateEffort(value: string): string {
  assertAllowedValue("Effort", value, ORIENTATION_EFFORTS);
  return value;
}

function validateClarificationStatus(value: string): string {
  assertAllowedValue("Clarification status", value, CLARIFICATION_STATUSES);
  return value;
}

function validateGapType(value: string): string {
  assertAllowedValue("Gap type", value, GAP_TYPES);
  return value;
}

function validateClarificationConfidence(value: string): string {
  assertAllowedValue("Confidence", value, CLARIFICATION_CONFIDENCE_LEVELS);
  return value;
}

/**
 * A parent must exist, must not be the Action itself, and must not already sit
 * below it — otherwise a listing that walks the tree would loop forever. Walking
 * up from the proposed parent catches every cycle, not just the one-hop case.
 */
function assertUsableParent(db: Database.Database, parentId: string, childId: string | null): string {
  const parent = required(parentId, "Parent Action id");

  if (childId && parent === childId) {
    throw new Error("An Action cannot be its own parent");
  }

  if (!db.prepare("SELECT id FROM work_items WHERE id = ?").get(parent)) {
    throw new Error(`Parent Action was not found: ${parent}`);
  }

  if (!childId) {
    return parent;
  }

  const seen = new Set<string>();
  let ancestor: string | null = parent;
  while (ancestor) {
    if (ancestor === childId) {
      throw new Error("An Action cannot be parented to one of its own subtasks");
    }
    if (seen.has(ancestor)) {
      break;
    }
    seen.add(ancestor);
    ancestor = (db.prepare("SELECT parent_work_item_id FROM work_items WHERE id = ?").get(ancestor) as
      | { parent_work_item_id: string | null }
      | undefined)?.parent_work_item_id ?? null;
  }

  return parent;
}

function validateWorkItemStatus(value: string): WorkItemStatus {
  assertAllowedValue("Action status", value, WORK_ITEM_STATUSES);
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

function validateReviewItemStatus(value: string): ReviewItemStatus {
  if (value !== "open" && value !== "approved" && value !== "rejected" && value !== "deferred") {
    throw new Error("Review item status must be one of: open, approved, rejected, deferred");
  }
  return value;
}

function validateBackBurnerStatus(value: string): BackBurnerStatus {
  assertAllowedValue("Back Burner status", value, BACK_BURNER_STATUSES);
  return value;
}

function validateBackBurnerFacetTag(value: string): BackBurnerFacetTag {
  assertAllowedValue("Back Burner facet tag", value, BACK_BURNER_FACET_TAGS);
  return value;
}

function validateAskFeedbackDecision(value: string): AskFeedbackDecision {
  assertAllowedValue("Ask feedback decision", value, ASK_FEEDBACK_DECISIONS);
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

function validateCodexTaskSource(value: string): "local_goal" | "cloud_task" {
  if (value !== "local_goal" && value !== "cloud_task") {
    throw new Error("Codex task source must be one of: local_goal, cloud_task");
  }
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
    slug: slugify(input.name),
    mission: required(input.mission, "Mission"),
    goal: nullable(input.goal),
    outcome: nullable(input.goal),
    status: validateProjectStatus(input.status),
    created_at: timestamp,
    updated_at: timestamp
  };

  const { outcome: _outcome, ...projectRow } = project;
  db.prepare(
    `INSERT INTO projects (id, name, slug, mission, goal, status, created_at, updated_at)
     VALUES (@id, @name, @slug, @mission, @goal, @status, @created_at, @updated_at)`
  ).run(projectRow);

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
    title: required(input.title || titleFromRawInput(rawInput), "Action title"),
    raw_input: rawInput,
    queue,
    work_classification: workClassification,
    next_action: required(input.nextAction, "Next action"),
    expected_artifact: nullable(input.expectedArtifact),
    status,
    // Actions are sized after the fact (`work update --effort`), never guessed
    // at intake — the same optional-and-additive rule the ledger follows.
    effort: null,
    // Callers that know an Action arrives un-clarified say so (`capture` does);
    // everything else leaves NULL, meaning "never evaluated".
    clarification_status: input.clarificationStatus
      ? (validateClarificationStatus(input.clarificationStatus) as ClarificationStatus)
      : null,
    gap_type: null,
    open_question: null,
    clarification_source: null,
    confidence: null,
    parent_work_item_id: input.parentWorkItemId ? assertUsableParent(db, input.parentWorkItemId, null) : null,
    // Set by ingestion via setWorkItemDocRef once the row exists; an Action
    // Arcadia captured itself never gets one.
    doc_ref: null,
    execution_requirement_json: input.executionRequirementJson ?? null,
    acceptance_criteria_json: input.acceptanceCriteriaJson ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO work_items (
      id, project_id, milestone_id, title, raw_input, queue, work_classification,
      next_action, expected_artifact, status, effort, clarification_status, gap_type,
      open_question, clarification_source, confidence, parent_work_item_id, doc_ref,
      execution_requirement_json, acceptance_criteria_json, created_at, updated_at
    ) VALUES (
      @id, @project_id, @milestone_id, @title, @raw_input, @queue, @work_classification,
      @next_action, @expected_artifact, @status, @effort, @clarification_status, @gap_type,
      @open_question, @clarification_source, @confidence, @parent_work_item_id, @doc_ref,
      @execution_requirement_json, @acceptance_criteria_json, @created_at, @updated_at
    )`
  ).run(workItem);

  return { ...workItem, responsibility: workClassification };
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
        rawInput: input.rawInput ?? input.nextAction,
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

export function createWorkItemRecord(db: Database.Database, input: CreateWorkItemInput): WorkItem {
  return insertWorkItem(db, input, nowIso());
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
  return db.prepare("SELECT *, goal AS outcome FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function getProject(db: Database.Database, id: string): Project | null {
  return (db.prepare("SELECT *, goal AS outcome FROM projects WHERE id = ?").get(id) as Project | undefined) ?? null;
}

export function upsertProject(db: Database.Database, input: UpsertProjectInput): Project {
  const timestamp = nowIso();
  const existing = input.id
    ? getProject(db, input.id)
    : listProjects(db).find((project) => project.name.toLowerCase() === input.name.trim().toLowerCase()) ?? null;
  const project: Project = {
    id: existing?.id ?? input.id ?? createId("project"),
    name: required(input.name, "Project name"),
    slug: existing?.slug ?? slugify(input.name),
    mission: required(input.mission, "Mission"),
    goal: nullable(input.goal),
    outcome: nullable(input.goal),
    status: validateProjectStatus(input.status),
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };

  const { outcome: _outcome, ...projectRow } = project;
  db.prepare(
    `INSERT INTO projects (id, name, slug, mission, goal, status, created_at, updated_at)
     VALUES (@id, @name, @slug, @mission, @goal, @status, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       slug = excluded.slug,
       mission = excluded.mission,
       goal = excluded.goal,
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).run(projectRow);

  return getProject(db, project.id) as Project;
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
    repository_url: input.repositoryUrl === undefined ? existing?.repository_url ?? null : nullable(input.repositoryUrl),
    project_template: input.projectTemplate === undefined ? existing?.project_template ?? null : nullable(input.projectTemplate),
    generator_skill: input.generatorSkill === undefined ? existing?.generator_skill ?? null : nullable(input.generatorSkill),
    deployment_target: input.deploymentTarget === undefined ? existing?.deployment_target ?? null : nullable(input.deploymentTarget),
    build_agent: input.buildAgent === undefined ? existing?.build_agent ?? null : nullable(input.buildAgent),
    staging_url: input.stagingUrl === undefined ? existing?.staging_url ?? null : nullable(input.stagingUrl),
    status_summary: nullable(input.statusSummary),
    validation_commands: encodeStringArray(input.validationCommands),
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO project_metadata (
      project_id, aliases, repo_path, repository_url, project_template, generator_skill,
      deployment_target, build_agent, staging_url, status_summary, validation_commands, created_at, updated_at
    ) VALUES (
      @project_id, @aliases, @repo_path, @repository_url, @project_template, @generator_skill,
      @deployment_target, @build_agent, @staging_url, @status_summary, @validation_commands, @created_at, @updated_at
    )
    ON CONFLICT(project_id) DO UPDATE SET
      aliases = excluded.aliases,
      repo_path = excluded.repo_path,
      repository_url = excluded.repository_url,
      project_template = excluded.project_template,
      generator_skill = excluded.generator_skill,
      deployment_target = excluded.deployment_target,
      build_agent = excluded.build_agent,
      staging_url = excluded.staging_url,
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

export function updateProject(db: Database.Database, id: string, input: UpdateProjectInput): Project | null {
  if (!getProject(db, id)) {
    return null;
  }

  const updates: string[] = [];
  const parameters: Record<string, string | null> = { id, updated_at: nowIso() };

  if (input.status !== undefined) {
    parameters.status = validateProjectStatus(input.status);
    updates.push("status = @status");
  }

  if (input.mission !== undefined) {
    parameters.mission = required(input.mission, "Mission");
    updates.push("mission = @mission");
  }

  if (input.goal !== undefined) {
    parameters.goal = nullable(input.goal);
    updates.push("goal = @goal");
  }

  if (updates.length === 0) {
    return getProject(db, id);
  }

  updates.push("updated_at = @updated_at");
  db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = @id`).run(parameters);
  return getProject(db, id);
}

export function updateProjectStatus(db: Database.Database, id: string, status: string): Project | null {
  return updateProject(db, id, { status: validateProjectStatus(status) });
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
        p.goal AS outcome,
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
          ORDER BY wi.updated_at DESC, wi.created_at DESC
          LIMIT 1
        ) AS next_action,
        (
          SELECT wi.work_classification
          FROM work_items wi
          WHERE wi.project_id = p.id AND wi.status != 'done'
          ORDER BY wi.updated_at DESC, wi.created_at DESC
          LIMIT 1
        ) AS work_classification,
        (
          SELECT wi.work_classification
          FROM work_items wi
          WHERE wi.project_id = p.id AND wi.status != 'done'
          ORDER BY wi.updated_at DESC, wi.created_at DESC
          LIMIT 1
        ) AS responsibility,
        (
          SELECT wi.expected_artifact
          FROM work_items wi
          WHERE wi.project_id = p.id AND wi.status != 'done'
          ORDER BY wi.updated_at DESC, wi.created_at DESC
          LIMIT 1
        ) AS expected_artifact
      FROM projects p
      ORDER BY p.created_at DESC`
    )
    .all() as ProjectSummary[];
}

/**
 * Open Actions matching a predicate.
 *
 * Accepts positional parameters (the original callers, which use `?`) or a
 * named-parameter object (scoped callers, which use `@name`); better-sqlite3
 * binds the two differently and will not mix them in one statement.
 */
function listOpenWorkItems(
  db: Database.Database,
  whereSql: string,
  parameters: unknown[] | Record<string, unknown> = []
): WorkItemSummary[] {
  const statement = db.prepare(
    `SELECT
        wi.*,
        wi.work_classification AS responsibility,
        p.name AS project_name,
        m.title AS milestone_title
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN milestones m ON m.id = wi.milestone_id
      WHERE wi.status != 'done' AND (${whereSql})
      ORDER BY wi.created_at DESC`
  );
  return (
    Array.isArray(parameters) ? statement.all(...parameters) : statement.all(parameters)
  ) as WorkItemSummary[];
}

export function listQueueGroups(db: Database.Database): QueueGroups {
  const requiresReview = listOpenWorkItems(db, "wi.queue = ?", ["requires_review"]);
  return {
    inbox: listOpenWorkItems(db, "wi.queue = ?", ["inbox"]),
    work_queue: listOpenWorkItems(db, "wi.queue = ?", ["work_queue"]),
    requires_review: requiresReview,
    blocked: listOpenWorkItems(db, "wi.queue = ?", ["blocked"])
  };
}

export function listRecentlyCompletedWorkItems(db: Database.Database, limit = 10): WorkItemSummary[] {
  return db
    .prepare(
      `SELECT
        wi.*,
        wi.work_classification AS responsibility,
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
        wi.work_classification AS responsibility,
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
          wi.work_classification AS responsibility,
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
  const parameters: Record<string, string | null> = { id };

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

  if (input.effort !== undefined) {
    parameters.effort = input.effort === null ? null : validateEffort(input.effort);
    updates.push("effort = @effort");
  }

  if (input.expectedArtifact !== undefined) {
    parameters.expected_artifact = nullable(input.expectedArtifact);
    updates.push("expected_artifact = @expected_artifact");
  }

  if (input.clarificationStatus !== undefined) {
    parameters.clarification_status =
      input.clarificationStatus === null ? null : validateClarificationStatus(input.clarificationStatus);
    updates.push("clarification_status = @clarification_status");
  }

  if (input.gapType !== undefined) {
    parameters.gap_type = input.gapType === null ? null : validateGapType(input.gapType);
    updates.push("gap_type = @gap_type");
  }

  if (input.openQuestion !== undefined) {
    parameters.open_question = nullable(input.openQuestion);
    updates.push("open_question = @open_question");
  }

  if (input.clarificationSource !== undefined) {
    parameters.clarification_source = nullable(input.clarificationSource);
    updates.push("clarification_source = @clarification_source");
  }

  if (input.confidence !== undefined) {
    parameters.confidence = input.confidence === null ? null : validateClarificationConfidence(input.confidence);
    updates.push("confidence = @confidence");
  }

  if (input.parentWorkItemId !== undefined) {
    parameters.parent_work_item_id =
      input.parentWorkItemId === null ? null : assertUsableParent(db, input.parentWorkItemId, id);
    updates.push("parent_work_item_id = @parent_work_item_id");
  }

  if (input.executionRequirementJson !== undefined) {
    parameters.execution_requirement_json = nullable(input.executionRequirementJson);
    updates.push("execution_requirement_json = @execution_requirement_json");
  }

  if (input.acceptanceCriteriaJson !== undefined) {
    parameters.acceptance_criteria_json = nullable(input.acceptanceCriteriaJson);
    updates.push("acceptance_criteria_json = @acceptance_criteria_json");
  }

  if (updates.length === 0) {
    throw new Error("At least one Action field is required");
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

  if (input.title !== undefined) {
    parameters.title = required(input.title, "Artifact title");
    updates.push("title = @title");
  }

  if (input.artifactType !== undefined) {
    parameters.artifact_type = required(input.artifactType, "Artifact type");
    updates.push("artifact_type = @artifact_type");
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

export function upsertProducedArtifact(
  db: Database.Database,
  input: {
    projectId?: string | null;
    workItemId: string;
    title: string;
    artifactType: string;
    status: string;
    path: string;
    convertPathlessExpected?: boolean;
  }
): ArtifactSummary {
  const normalizedPath = required(input.path, "Artifact path");
  const existing = db.prepare(
    `SELECT id FROM artifacts
     WHERE work_item_id = ? AND path = ?
     ORDER BY created_at ASC LIMIT 1`
  ).get(input.workItemId, normalizedPath) as { id: string } | undefined;
  if (existing) {
    return updateArtifact(db, existing.id, {
      title: input.title,
      artifactType: input.artifactType,
      status: input.status,
      path: normalizedPath
    }) as ArtifactSummary;
  }

  if (input.convertPathlessExpected) {
    const expected = db.prepare(
      `SELECT id FROM artifacts
       WHERE work_item_id = ? AND artifact_type = 'expected_artifact' AND path IS NULL
       ORDER BY created_at ASC LIMIT 1`
    ).get(input.workItemId) as { id: string } | undefined;
    if (expected) {
      return updateArtifact(db, expected.id, {
        title: input.title,
        artifactType: input.artifactType,
        status: input.status,
        path: normalizedPath
      }) as ArtifactSummary;
    }
  }

  const created = createArtifactRecord(db, {
    projectId: input.projectId,
    workItemId: input.workItemId,
    title: input.title,
    artifactType: input.artifactType,
    status: validateArtifactStatus(input.status),
    path: normalizedPath
  });
  return getArtifact(db, created.id) as ArtifactSummary;
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
    needsOperator?: string | null;
  }>;
}

export interface CreateExecutionRunInput {
  workItemId: string;
  planId: string;
  status: string;
  summary: string;
  missionLogId?: string | null;
  reviewItemId?: string | null;
  executorName?: string | null;
  retryOfRunId?: string | null;
  executionProfileJson?: string | null;
  providerMappingId?: string | null;
  providerBindingId?: string | null;
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
        needs_operator: nullable(step.needsOperator),
        created_at: timestamp,
        updated_at: timestamp
      };

      db.prepare(
        `INSERT INTO execution_plan_steps (
          id, plan_id, skill_id, position, title, command, executor_type, safe_to_run,
          status, needs_operator, created_at, updated_at
        ) VALUES (
          @id, @plan_id, @skill_id, @position, @title, @command, @executor_type, @safe_to_run,
          @status, @needs_operator, @created_at, @updated_at
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
    stewardship_json: nullable(input.stewardshipJson),
    work_item_id: input.workItemId ?? null,
    plan_id: input.planId ?? null,
    prompt_packet_path: nullable(input.promptPacketPath),
    status: validateAskRequestStatus(input.status),
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO ask_requests (
      id, raw_request, resolved_intent, registry_version, output_kind, stewardship_json, work_item_id,
      plan_id, prompt_packet_path, status, created_at, updated_at
    ) VALUES (
      @id, @raw_request, @resolved_intent, @registry_version, @output_kind, @stewardship_json, @work_item_id,
      @plan_id, @prompt_packet_path, @status, @created_at, @updated_at
    )`
  ).run(askRequest);

  const created = getAskRequest(db, askRequest.id);
  if (!created) {
    throw new Error(`Ask request could not be created: ${askRequest.id}`);
  }

  return created;
}

export function createReviewItem(db: Database.Database, input: CreateReviewItemInput): ReviewItemSummary {
  const timestamp = nowIso();
  const reviewItem: ReviewItem = {
    id: createId("reviewItem"),
    slug: nextReviewSlug(db),
    ask_request_id: input.askRequestId ?? null,
    work_item_id: input.workItemId ?? null,
    plan_id: input.planId ?? null,
    project_id: input.projectId ?? null,
    artifact_id: input.artifactId ?? null,
    codex_invocation_id: input.codexInvocationId ?? null,
    status: "open",
    decision_needed: required(input.decisionNeeded, "Review decision"),
    recommendation: nullable(input.recommendation),
    source_input: required(input.sourceInput, "Review source input"),
    proposed_action: required(input.proposedAction, "Review proposed action"),
    resolved_intent: required(input.resolvedIntent, "Review resolved intent"),
    confidence_label: required(input.confidenceLabel, "Review confidence label"),
    confidence: input.confidence,
    missing_fields: encodeStringArray(input.missingFields),
    context_json: JSON.stringify(input.context ?? {}),
    created_at: timestamp,
    updated_at: timestamp,
    decided_at: null,
    decision_note: null,
    resulting_ask_request_id: null
  };

  db.prepare(
    `INSERT INTO review_items (
      id, slug, ask_request_id, work_item_id, plan_id, project_id, artifact_id, codex_invocation_id, status, decision_needed,
      recommendation, source_input, proposed_action, resolved_intent, confidence_label,
      confidence, missing_fields, context_json, created_at, updated_at, decided_at,
      decision_note, resulting_ask_request_id
    ) VALUES (
      @id, @slug, @ask_request_id, @work_item_id, @plan_id, @project_id, @artifact_id, @codex_invocation_id, @status, @decision_needed,
      @recommendation, @source_input, @proposed_action, @resolved_intent, @confidence_label,
      @confidence, @missing_fields, @context_json, @created_at, @updated_at, @decided_at,
      @decision_note, @resulting_ask_request_id
    )`
  ).run(reviewItem);

  const created = getReviewItem(db, reviewItem.id);
  if (!created) {
    throw new Error(`Review item could not be created: ${reviewItem.id}`);
  }
  return created;
}

export function getReviewItem(db: Database.Database, id: string): ReviewItemSummary | null {
  return (
    (db
      .prepare(reviewItemSelectSql("WHERE ri.id = ?"))
      .get(id) as ReviewItemSummary | undefined) ?? null
  );
}

export function getReviewItemBySlug(db: Database.Database, slug: string): ReviewItemSummary | null {
  return (
    (db
      .prepare(reviewItemSelectSql("WHERE lower(ri.slug) = lower(?)"))
      .get(slug) as ReviewItemSummary | undefined) ?? null
  );
}

export function listReviewItems(db: Database.Database, status: ReviewItemStatus | "all" = "open"): ReviewItemSummary[] {
  const where = status === "all" ? "" : "WHERE ri.status = ?";
  const parameters = status === "all" ? [] : [status];
  return db
    .prepare(`${reviewItemSelectSql(where)} ORDER BY ri.created_at DESC`)
    .all(...parameters) as ReviewItemSummary[];
}

export function listActionableReviewItems(db: Database.Database): ReviewItemSummary[] {
  return [
    ...listReviewItems(db, "open"),
    ...listReviewItems(db, "deferred")
  ];
}

export function findFollowUpReviewForRun(db: Database.Database, runId: string): ReviewItemSummary | null {
  const row = db
    .prepare(
      `${reviewItemSelectSql(
        `WHERE ri.resolved_intent IN (
           'ReviewExecutionResult',
           'CodexPlanningArtifactAcceptance',
           'codex_planning_artifact_validation',
           'CodexPlanningRetryApproval'
         )
         AND (
           json_extract(ri.context_json, '$.runId') = ?
           OR json_extract(ri.context_json, '$.priorRunId') = ?
         )
         AND ri.status IN ('open', 'deferred')`
      )} ORDER BY ri.created_at DESC LIMIT 1`
    )
    .get(runId, runId) as ReviewItemSummary | undefined;
  return row ?? null;
}

/**
 * Merge fields into a Decision's `context_json` without disturbing whatever
 * is already there. Used to attach structured evidence — per-criterion
 * acceptance results, for example — to a Decision after it was created,
 * rather than requiring every field to be known at creation time.
 */
export function mergeReviewItemContext(db: Database.Database, id: string, patch: Record<string, unknown>): void {
  const row = db.prepare("SELECT context_json FROM review_items WHERE id = ?").get(id) as
    | { context_json: string }
    | undefined;
  if (!row) {
    return;
  }
  let context: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.context_json);
    context = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    context = {};
  }
  db.prepare("UPDATE review_items SET context_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify({ ...context, ...patch }),
    nowIso(),
    id
  );
}

export function updateReviewItemStatus(
  db: Database.Database,
  id: string,
  input: { status: ReviewItemStatus; decisionNote?: string | null; resultingAskRequestId?: string | null }
): ReviewItemSummary | null {
  const timestamp = nowIso();
  db.prepare(
    `UPDATE review_items
     SET status = ?,
         updated_at = ?,
         decided_at = CASE WHEN ? = 'deferred' THEN decided_at ELSE ? END,
         decision_note = ?,
         resulting_ask_request_id = COALESCE(?, resulting_ask_request_id)
     WHERE id = ?`
  ).run(
    validateReviewItemStatus(input.status),
    timestamp,
    input.status,
    timestamp,
    nullable(input.decisionNote),
    input.resultingAskRequestId ?? null,
    id
  );

  return getReviewItem(db, id);
}

export function compareAndSetReviewItemStatus(
  db: Database.Database,
  id: string,
  from: ReviewItemStatus[],
  to: ReviewItemStatus,
  decisionNote?: string | null
): ReviewItemSummary | null {
  const timestamp = nowIso();
  const placeholders = from.map(() => "?").join(", ");
  const result = db.prepare(
    `UPDATE review_items
     SET status = ?, updated_at = ?, decided_at = ?, decision_note = ?
     WHERE id = ? AND status IN (${placeholders})`
  ).run(to, timestamp, to === "deferred" ? null : timestamp, nullable(decisionNote), id, ...from);
  return result.changes === 1 ? getReviewItem(db, id) : null;
}

export function getReviewItemForInvocation(
  db: Database.Database,
  codexInvocationId: string,
  resolvedIntents?: string[]
): ReviewItemSummary | null {
  const intents = resolvedIntents?.length
    ? ` AND ri.resolved_intent IN (${resolvedIntents.map(() => "?").join(", ")})`
    : "";
  return (db.prepare(
    `${reviewItemSelectSql(`WHERE ri.codex_invocation_id = ?${intents}`)}
     ORDER BY ri.created_at DESC LIMIT 1`
  ).get(codexInvocationId, ...(resolvedIntents ?? [])) as ReviewItemSummary | undefined) ?? null;
}

export function createReviewFeedback(db: Database.Database, input: CreateReviewFeedbackInput): ReviewFeedback {
  const timestamp = nowIso();
  const feedback: ReviewFeedback = {
    id: createId("reviewFeedback"),
    review_id: required(input.reviewId, "Review id"),
    review_slug: required(input.reviewSlug, "Review slug"),
    source_input: nullable(input.sourceInput),
    proposed_interpretation: nullable(input.proposedInterpretation),
    feedback_type: required(input.feedbackType, "Review feedback type"),
    raw_reply: required(input.rawReply, "Review feedback reply"),
    created_at: timestamp
  };

  db.prepare(
    `INSERT INTO review_feedback (
      id, review_id, review_slug, source_input, proposed_interpretation,
      feedback_type, raw_reply, created_at
    ) VALUES (
      @id, @review_id, @review_slug, @source_input, @proposed_interpretation,
      @feedback_type, @raw_reply, @created_at
    )`
  ).run(feedback);

  return feedback;
}

export function listReviewFeedback(db: Database.Database, reviewId: string): ReviewFeedback[] {
  return db
    .prepare("SELECT * FROM review_feedback WHERE review_id = ? ORDER BY created_at DESC")
    .all(reviewId) as ReviewFeedback[];
}

export function createBackBurnerItem(
  db: Database.Database,
  input: CreateBackBurnerItemInput
): BackBurnerItemSummary {
  const timestamp = nowIso();
  if (input.projectId && !getProject(db, input.projectId)) {
    throw new Error(`Back Burner Project was not found: ${input.projectId}`);
  }
  const surface = normalizeSurfaceCondition(input.surfaceCondition);
  if (surface.surface_dependency_work_item_id && !getWorkItem(db, surface.surface_dependency_work_item_id)) {
    throw new Error(`Back Burner surface dependency Action was not found: ${surface.surface_dependency_work_item_id}`);
  }
  const facetTags = normalizedUniqueValues(input.facetTags).map(validateBackBurnerFacetTag);
  const item: BackBurnerItem = {
    id: createId("backBurnerItem"),
    original_input: required(input.originalInput, "Back Burner original input"),
    ingress_source: required(input.ingressSource, "Back Burner ingress source"),
    classification: input.classification,
    confidence: input.confidence,
    reason: required(input.reason, "Back Burner reason"),
    status: validateBackBurnerStatus(input.status ?? "incubating"),
    suggested_next_step: nullable(input.suggestedNextStep),
    created_at: timestamp,
    updated_at: timestamp,
    promoted_at: null,
    promoted_work_item_id: null,
    ...surface,
    project_id: input.projectId ?? null,
    source_ref: nullable(input.sourceRef),
    facet_tags_json: JSON.stringify(facetTags)
  };

  db.prepare(
    `INSERT INTO back_burner_items (
      id, original_input, ingress_source, classification, confidence, reason, status,
      suggested_next_step, created_at, updated_at, promoted_at, promoted_work_item_id,
      surface_kind, surface_date, surface_dependency_work_item_id, surface_dependency_status,
      surface_predicate, project_id, source_ref, facet_tags_json
    ) VALUES (
      @id, @original_input, @ingress_source, @classification, @confidence, @reason, @status,
      @suggested_next_step, @created_at, @updated_at, @promoted_at, @promoted_work_item_id,
      @surface_kind, @surface_date, @surface_dependency_work_item_id, @surface_dependency_status,
      @surface_predicate, @project_id, @source_ref, @facet_tags_json
    )`
  ).run(item);

  const created = getBackBurnerItem(db, item.id);
  if (!created) {
    throw new Error(`Back Burner item could not be created: ${item.id}`);
  }
  return created;
}

export function getBackBurnerItem(db: Database.Database, id: string): BackBurnerItemSummary | null {
  const row = db.prepare(backBurnerItemSelectSql("WHERE bbi.id = ?")).get(id) as BackBurnerItemSummary | undefined;
  return row ? hydrateBackBurnerItem(db, row) : null;
}

export interface BackBurnerListFilters {
  fired?: boolean;
  project?: string;
  tag?: BackBurnerFacetTag;
}

export function listBackBurnerItems(
  db: Database.Database,
  status: BackBurnerStatus | "all" = "incubating",
  filters: BackBurnerListFilters = {}
): BackBurnerItemSummary[] {
  if (status !== "all") {
    validateBackBurnerStatus(status);
  }
  if (filters.tag) validateBackBurnerFacetTag(filters.tag);
  const items = (db.prepare(`${backBurnerItemSelectSql("")} ORDER BY bbi.created_at DESC`).all() as BackBurnerItemSummary[])
    .map((item) => hydrateBackBurnerItem(db, item));
  return items.filter((item) =>
    (status === "all" || item.effective_status === status) &&
    (filters.fired === undefined || item.surface_fired === filters.fired) &&
    (!filters.project || item.project_id === filters.project || item.project_slug === filters.project) &&
    (!filters.tag || item.facet_tags.includes(filters.tag))
  );
}

export function updateBackBurnerItem(
  db: Database.Database,
  id: string,
  input: UpdateBackBurnerItemInput
): BackBurnerItemSummary | null {
  const updates: string[] = ["updated_at = @updatedAt"];
  const parameters: Record<string, string | null> = { id, updatedAt: nowIso() };

  if (input.status) {
    updates.push("status = @status");
    parameters.status = validateBackBurnerStatus(input.status);
    if (input.status === "promoted") {
      updates.push("promoted_at = COALESCE(promoted_at, @updatedAt)");
    }
  }

  if (input.promotedWorkItemId !== undefined) {
    updates.push("promoted_work_item_id = @promotedWorkItemId");
    parameters.promotedWorkItemId = input.promotedWorkItemId;
  }

  if (updates.length === 1) {
    throw new Error("At least one Back Burner field is required");
  }

  db.prepare(`UPDATE back_burner_items SET ${updates.join(", ")} WHERE id = @id`).run(parameters);
  return getBackBurnerItem(db, id);
}

function backBurnerItemSelectSql(whereSql: string): string {
  return `SELECT
    bbi.*,
    wi.title AS promoted_work_item_title,
    dep.title AS surface_dependency_title,
    p.name AS project_name,
    p.slug AS project_slug
  FROM back_burner_items bbi
  LEFT JOIN work_items wi ON wi.id = bbi.promoted_work_item_id
  LEFT JOIN work_items dep ON dep.id = bbi.surface_dependency_work_item_id
  LEFT JOIN projects p ON p.id = bbi.project_id
  ${whereSql}`;
}

function hydrateBackBurnerItem(db: Database.Database, item: BackBurnerItemSummary): BackBurnerItemSummary {
  const evaluation = evaluateBackBurnerSurface(db, item);
  const conditioned = item.surface_kind === "date" || item.surface_kind === "dependency" || item.surface_kind === "predicate";
  const effectiveStatus = item.status === "promoted" || item.status === "archived"
    ? item.status
    : conditioned
      ? (evaluation.fired ? "opportunistic" : "incubating")
      : item.status;
  return {
    ...item,
    surface_condition: evaluation.condition,
    surface_fired: evaluation.fired,
    surface_warning: evaluation.warning,
    effective_status: effectiveStatus,
    facet_tags: decodeStringArray(item.facet_tags_json)
      .filter((tag): tag is BackBurnerFacetTag => BACK_BURNER_FACET_TAGS.includes(tag as BackBurnerFacetTag))
  };
}

function normalizeSurfaceCondition(condition: CreateBackBurnerItemInput["surfaceCondition"]): Pick<
  BackBurnerItem,
  "surface_kind" | "surface_date" | "surface_dependency_work_item_id" | "surface_dependency_status" | "surface_predicate"
> {
  const value = condition ?? { kind: "manual" as const };
  assertAllowedValue("Back Burner surface kind", value.kind, BACK_BURNER_SURFACE_KINDS);
  if (value.kind === "date") {
    if (!isValidSurfaceDate(value.date)) throw new Error("Back Burner surface date must be a valid YYYY-MM-DD date");
    return { surface_kind: "date", surface_date: value.date, surface_dependency_work_item_id: null, surface_dependency_status: null, surface_predicate: null };
  }
  if (value.kind === "dependency") {
    const workItemId = required(value.workItemId, "Back Burner surface dependency Action id");
    const status = validateWorkItemStatus(value.status);
    return { surface_kind: "dependency", surface_date: null, surface_dependency_work_item_id: workItemId, surface_dependency_status: status, surface_predicate: null };
  }
  if (value.kind === "predicate") {
    return { surface_kind: "predicate", surface_date: null, surface_dependency_work_item_id: null, surface_dependency_status: null, surface_predicate: required(value.name, "Back Burner surface predicate") };
  }
  return { surface_kind: "manual", surface_date: null, surface_dependency_work_item_id: null, surface_dependency_status: null, surface_predicate: null };
}

function reviewItemSelectSql(whereSql: string): string {
  return `SELECT
    ri.*,
    p.name AS project_name,
    p.goal AS project_goal,
    p.goal AS project_outcome,
    wi.title AS work_item_title,
    ep.summary AS plan_summary,
    resulting_wi.title AS resulting_ask_work_item_title,
    decision_artifact.title AS artifact_title,
    decision_artifact.path AS artifact_path,
    decision_invocation.prompt_path AS codex_prompt_path,
    decision_invocation.final_message_path AS codex_final_message_path
  FROM review_items ri
  LEFT JOIN projects p ON p.id = ri.project_id
  LEFT JOIN work_items wi ON wi.id = ri.work_item_id
  LEFT JOIN execution_plans ep ON ep.id = ri.plan_id
  LEFT JOIN ask_requests resulting_ask ON resulting_ask.id = ri.resulting_ask_request_id
  LEFT JOIN work_items resulting_wi ON resulting_wi.id = resulting_ask.work_item_id
  LEFT JOIN artifacts decision_artifact ON decision_artifact.id = ri.artifact_id
  LEFT JOIN codex_invocations decision_invocation ON decision_invocation.id = ri.codex_invocation_id
  ${whereSql}`;
}

function nextReviewSlug(db: Database.Database): string {
  const rows = db.prepare("SELECT slug FROM review_items WHERE slug IS NOT NULL").all() as Array<{ slug: string }>;
  let highest = 0;
  for (const row of rows) {
    const match = /^R(\d+)$/i.exec(row.slug);
    if (match?.[1]) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return `R${highest + 1}`;
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

export function createAskFeedback(db: Database.Database, input: CreateAskFeedbackInput): AskFeedback {
  const feedback: AskFeedback = {
    id: createId("askFeedback"),
    ask_request_id: required(input.askRequestId, "Ask request id"),
    decision: validateAskFeedbackDecision(input.decision),
    note: nullable(input.note),
    source_ingress: nullable(input.sourceIngress),
    created_at: nowIso()
  };

  db.prepare(
    `INSERT INTO ask_feedback (
      id, ask_request_id, decision, note, source_ingress, created_at
    ) VALUES (
      @id, @ask_request_id, @decision, @note, @source_ingress, @created_at
    )`
  ).run(feedback);

  return feedback;
}

export function listRecentAskFeedback(db: Database.Database, limit = 50): AskFeedback[] {
  return db
    .prepare("SELECT * FROM ask_feedback ORDER BY created_at DESC LIMIT ?")
    .all(limit) as AskFeedback[];
}

export function listApprovalGatesForWorkItem(db: Database.Database, workItemId: string): ApprovalGate[] {
  return db
    .prepare(
      `SELECT * FROM approval_gates
       WHERE work_item_id = ?
       ORDER BY
         CASE gate_type
           WHEN 'credentials_required' THEN 1
           WHEN 'external_deployment' THEN 2
           WHEN 'publication' THEN 3
           WHEN 'destructive_filesystem_changes' THEN 4
           WHEN 'production_data_access' THEN 5
           WHEN 'financial_action' THEN 6
           WHEN 'merge_to_main' THEN 7
           WHEN 'send_email_or_messages' THEN 8
           ELSE 99
         END ASC,
         created_at ASC,
         id ASC`
    )
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
    execution_profile_json: input.executionProfileJson ?? null,
    provider_mapping_id: input.providerMappingId ?? null,
    provider_binding_id: input.providerBindingId ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO codex_invocations (
      id, purpose, agent_profile, workspace_scope, command, prompt_path, jsonl_output_path,
      final_message_path, status, work_item_id, plan_id, plan_step_id, run_id,
      execution_profile_json, provider_mapping_id, provider_binding_id, created_at, updated_at
    ) VALUES (
      @id, @purpose, @agent_profile, @workspace_scope, @command, @prompt_path, @jsonl_output_path,
      @final_message_path, @status, @work_item_id, @plan_id, @plan_step_id, @run_id,
      @execution_profile_json, @provider_mapping_id, @provider_binding_id, @created_at, @updated_at
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

export function getCodexInvocation(db: Database.Database, id: string): CodexInvocation | null {
  return (db.prepare("SELECT * FROM codex_invocations WHERE id = ?").get(id) as CodexInvocation | undefined) ?? null;
}

export function upsertObservedCodexTask(
  db: Database.Database,
  input: ObservedCodexTaskInput
): { task: CodexTaskSummary; previousStatus: string | null } {
  const source = validateCodexTaskSource(input.source);
  const sourceTaskId = required(input.sourceTaskId, "Codex task source id");
  const existing = db
    .prepare("SELECT * FROM codex_tasks WHERE source = ? AND source_task_id = ?")
    .get(source, sourceTaskId) as CodexTask | undefined;
  const timestamp = nowIso();

  if (!existing) {
    const task: CodexTask = {
      id: createId("codexTask"),
      source,
      source_task_id: sourceTaskId,
      title: required(input.title, "Codex task title"),
      status: required(input.status, "Codex task status"),
      url: nullable(input.url),
      summary: nullable(input.summary),
      codex_updated_at: nullable(input.codexUpdatedAt),
      project_id: null,
      milestone_id: null,
      mission_log_id: null,
      last_observed_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp
    };

    db.prepare(
      `INSERT INTO codex_tasks (
        id, source, source_task_id, title, status, url, summary, codex_updated_at,
        project_id, milestone_id, mission_log_id, last_observed_at, created_at, updated_at
      ) VALUES (
        @id, @source, @source_task_id, @title, @status, @url, @summary, @codex_updated_at,
        @project_id, @milestone_id, @mission_log_id, @last_observed_at, @created_at, @updated_at
      )`
    ).run(task);

    return { task: getCodexTask(db, task.id) as CodexTaskSummary, previousStatus: null };
  }

  db.prepare(
    `UPDATE codex_tasks
     SET title = ?, status = ?, url = ?, summary = ?, codex_updated_at = ?,
         last_observed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    required(input.title, "Codex task title"),
    required(input.status, "Codex task status"),
    nullable(input.url),
    nullable(input.summary),
    nullable(input.codexUpdatedAt),
    timestamp,
    timestamp,
    existing.id
  );

  return { task: getCodexTask(db, existing.id) as CodexTaskSummary, previousStatus: existing.status };
}

export function associateCodexTask(db: Database.Database, input: AssociateCodexTaskInput): CodexTaskSummary | null {
  const existing = getCodexTask(db, input.taskId);
  const project = getProject(db, input.projectId);
  if (!existing || !project) {
    return null;
  }

  const milestoneId = input.milestoneId === undefined ? existing.milestone_id : input.milestoneId;
  if (milestoneId && !getMilestone(db, milestoneId)) {
    return null;
  }

  db.prepare("UPDATE codex_tasks SET project_id = ?, milestone_id = ?, updated_at = ? WHERE id = ?").run(
    input.projectId,
    milestoneId ?? null,
    nowIso(),
    input.taskId
  );
  return getCodexTask(db, input.taskId);
}

export function attachMissionLogToCodexTask(
  db: Database.Database,
  taskId: string,
  missionLogId: string
): CodexTaskSummary | null {
  if (!getCodexTask(db, taskId)) {
    return null;
  }

  db.prepare("UPDATE codex_tasks SET mission_log_id = ?, updated_at = ? WHERE id = ?").run(
    missionLogId,
    nowIso(),
    taskId
  );
  return getCodexTask(db, taskId);
}

export function getCodexTask(db: Database.Database, id: string): CodexTaskSummary | null {
  return (
    (db
      .prepare(
        `SELECT
          ct.*,
          p.name AS project_name,
          m.title AS milestone_title,
          ml.markdown_path AS mission_log_path
        FROM codex_tasks ct
        LEFT JOIN projects p ON p.id = ct.project_id
        LEFT JOIN milestones m ON m.id = ct.milestone_id
        LEFT JOIN mission_logs ml ON ml.id = ct.mission_log_id
        WHERE ct.id = ?`
      )
      .get(id) as CodexTaskSummary | undefined) ?? null
  );
}

export function getCodexTaskBySource(
  db: Database.Database,
  source: string,
  sourceTaskId: string
): CodexTaskSummary | null {
  const row = db
    .prepare("SELECT id FROM codex_tasks WHERE source = ? AND source_task_id = ?")
    .get(validateCodexTaskSource(source), sourceTaskId) as { id: string } | undefined;
  return row ? getCodexTask(db, row.id) : null;
}

export function listCodexTasks(db: Database.Database, options: { activeOnly?: boolean } = {}): CodexTaskSummary[] {
  const activeWhere = options.activeOnly
    ? "WHERE lower(ct.status) NOT IN ('complete', 'completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'archived')"
    : "";
  return db
    .prepare(
      `SELECT
        ct.*,
        p.name AS project_name,
        m.title AS milestone_title,
        ml.markdown_path AS mission_log_path
       FROM codex_tasks ct
       LEFT JOIN projects p ON p.id = ct.project_id
       LEFT JOIN milestones m ON m.id = ct.milestone_id
       LEFT JOIN mission_logs ml ON ml.id = ct.mission_log_id
       ${activeWhere}
       ORDER BY ct.last_observed_at DESC, ct.created_at DESC`
    )
    .all() as CodexTaskSummary[];
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
      review_item_id: input.reviewItemId ?? null,
      executor_name: input.executorName ?? null,
      pid: null,
      retry_of_run_id: input.retryOfRunId ?? null,
      execution_profile_json: input.executionProfileJson ?? null,
      provider_mapping_id: input.providerMappingId ?? null,
      provider_binding_id: input.providerBindingId ?? null,
      created_at: timestamp,
      updated_at: timestamp
    };

    db.prepare(
      `INSERT INTO execution_runs (
        id, work_item_id, plan_id, status, summary, mission_log_id, review_item_id,
        executor_name, pid, retry_of_run_id, execution_profile_json,
        provider_mapping_id, provider_binding_id, created_at, updated_at
      ) VALUES (
        @id, @work_item_id, @plan_id, @status, @summary, @mission_log_id, @review_item_id,
        @executor_name, @pid, @retry_of_run_id, @execution_profile_json,
        @provider_mapping_id, @provider_binding_id, @created_at, @updated_at
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
      run.status === "pending_execution" ? "planned" : run.status,
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

export function createReviewExecutionRun(
  db: Database.Database,
  input: {
    reviewItemId: string;
    executorName: string;
    workItemId?: string | null;
    planId?: string | null;
    summary: string;
  }
): ExecutionRunSummary {
  const timestamp = nowIso();
  const run = {
    id: createId("executionRun"),
    work_item_id: input.workItemId ?? null,
    plan_id: input.planId ?? null,
    status: "pending_execution" as const,
    summary: input.summary,
    mission_log_id: null,
    review_item_id: input.reviewItemId,
    executor_name: input.executorName,
    pid: null,
    retry_of_run_id: null,
    created_at: timestamp,
    updated_at: timestamp
  };

  db.prepare(
    `INSERT INTO execution_runs (
      id, work_item_id, plan_id, status, summary, mission_log_id, review_item_id, executor_name, pid, retry_of_run_id, created_at, updated_at
    ) VALUES (
      @id, @work_item_id, @plan_id, @status, @summary, @mission_log_id, @review_item_id, @executor_name, @pid, @retry_of_run_id, @created_at, @updated_at
    )`
  ).run(run);

  return getExecutionRun(db, run.id) as ExecutionRunSummary;
}

export function getExecutionRunByReviewItem(
  db: Database.Database,
  reviewItemId: string
): ExecutionRunSummary | null {
  const row = db.prepare(
    "SELECT id FROM execution_runs WHERE review_item_id = ? ORDER BY created_at ASC LIMIT 1"
  ).get(reviewItemId) as { id: string } | undefined;
  return row ? getExecutionRun(db, row.id) : null;
}

export function attachArtifactToExecutionRun(
  db: Database.Database,
  runId: string,
  artifactId: string
): void {
  db.prepare(
    `INSERT OR IGNORE INTO run_artifacts (id, run_id, artifact_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(createId("runArtifact"), runId, artifactId, nowIso());
}

export function updateExecutionRunStep(
  db: Database.Database,
  runId: string,
  planStepId: string,
  input: {
    status: string;
    command?: string | null;
    output?: string | null;
    error?: string | null;
    artifactPath?: string | null;
  }
): void {
  db.prepare(
    `UPDATE execution_run_steps
     SET status = ?, command = COALESCE(?, command), output = ?, error = ?, artifact_path = ?, updated_at = ?
     WHERE run_id = ? AND plan_step_id = ?`
  ).run(
    validateExecutionStepStatus(input.status),
    nullable(input.command),
    nullable(input.output),
    nullable(input.error),
    nullable(input.artifactPath),
    nowIso(),
    runId,
    planStepId
  );
}

export function claimNextPendingRun(
  db: Database.Database,
  pid: number
): ExecutionRunSummary | null {
  const row = db
    .prepare(
      "SELECT id FROM execution_runs WHERE status = 'pending_execution' ORDER BY created_at ASC LIMIT 1"
    )
    .get() as { id: string } | undefined;

  if (!row) {
    return null;
  }

  const timestamp = nowIso();
  const affected = db
    .prepare(
      "UPDATE execution_runs SET status = 'running', pid = ?, updated_at = ? WHERE id = ? AND status = 'pending_execution'"
    )
    .run(pid, timestamp, row.id);

  if (affected.changes === 0) {
    return null;
  }

  return getExecutionRun(db, row.id);
}

export function updateExecutionRunStatus(
  db: Database.Database,
  runId: string,
  status: "pending_execution" | "running" | "completed" | "requires_review" | "failed",
  extra: { pid?: number | null; summary?: string } = {}
): void {
  const timestamp = nowIso();
  if (extra.summary !== undefined && extra.pid !== undefined) {
    db.prepare("UPDATE execution_runs SET status = ?, pid = ?, summary = ?, updated_at = ? WHERE id = ?").run(
      status, extra.pid, extra.summary, timestamp, runId
    );
  } else if (extra.summary !== undefined) {
    db.prepare("UPDATE execution_runs SET status = ?, summary = ?, updated_at = ? WHERE id = ?").run(
      status, extra.summary, timestamp, runId
    );
  } else if (extra.pid !== undefined) {
    db.prepare("UPDATE execution_runs SET status = ?, pid = ?, updated_at = ? WHERE id = ?").run(
      status, extra.pid, timestamp, runId
    );
  } else {
    db.prepare("UPDATE execution_runs SET status = ?, updated_at = ? WHERE id = ?").run(
      status, timestamp, runId
    );
  }
}

export function listOrphanedRuns(db: Database.Database): Array<{ id: string; pid: number }> {
  return db
    .prepare("SELECT id, pid FROM execution_runs WHERE status = 'running' AND pid IS NOT NULL")
    .all() as Array<{ id: string; pid: number }>;
}

export function getExecutionRun(db: Database.Database, id: string): ExecutionRunSummary | null {
  const run = db
    .prepare(
      `SELECT
        er.*,
        p.id AS project_id,
        p.name AS project_name,
        COALESCE(wi.title, ri.decision_needed, er.summary) AS work_item_title,
        ep.summary AS plan_summary,
        ml.markdown_path AS mission_log_path
      FROM execution_runs er
      LEFT JOIN work_items wi ON wi.id = er.work_item_id
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN execution_plans ep ON ep.id = er.plan_id
      LEFT JOIN mission_logs ml ON ml.id = er.mission_log_id
      LEFT JOIN review_items ri ON ri.id = er.review_item_id
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
    requiresReviewItems: listOpenWorkItems(
      db,
      "wi.queue = 'requires_review' OR wi.work_classification = 'requires_review'"
    ),
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

/**
 * Compile a review window into a report, for one Project or the whole workspace.
 *
 * `projectId` narrows every section to that Project. The pooled workspace view
 * answers "what happened"; the per-Project view answers "did *this* move",
 * which pooling actively hides — one busy Project reads as a productive week
 * while four others sat still.
 */
export function buildWeeklyReviewData(
  db: Database.Database,
  workspacePath: string,
  window: { since: string; until: string },
  projectId?: string | null
): WeeklyReviewData {
  const scope = projectId ?? null;
  // Scoping is applied as an extra predicate rather than by filtering results,
  // so an Action with no Project never leaks into a Project's review.
  const scoped = (whereSql: string) =>
    scope ? `(${whereSql}) AND wi.project_id = @projectId` : whereSql;
  const parameters = scope ? { projectId: scope } : {};

  const completedWorkItems = listCompletedWorkItemsInWindow(db, window, scope);
  const missionLogs = listMissionLogsInWindow(db, window, scope);
  const blockedItems = listOpenWorkItems(
    db,
    scoped("wi.queue = 'blocked' OR wi.work_classification = 'blocked' OR wi.status = 'blocked'"),
    parameters
  );
  const requiresReviewItems = listOpenWorkItems(
    db,
    scoped("wi.queue = 'requires_review' OR wi.work_classification = 'requires_review'"),
    parameters
  );
  const autonomousItems = listOpenWorkItems(
    db,
    scoped("wi.work_classification = 'autonomous' AND wi.queue != 'blocked'"),
    parameters
  );
  const codexItems = listOpenWorkItems(
    db,
    scoped("wi.work_classification = 'codex' AND wi.queue != 'blocked'"),
    parameters
  );
  const artifactItems = listArtifactChangesOrUpcoming(db, window, scope);
  // "Projects with nothing queued" is a portfolio-level observation. Narrowed
  // to one Project it is either itself or empty, which is noise in a report
  // that is already about that Project.
  const projectsWithoutOpenNextActions = scope ? [] : listProjectsWithoutOpenNextActions(db);

  const project = scope ? getProject(db, scope) : null;

  return {
    workspacePath,
    generatedAt: nowIso(),
    window,
    project: project ? { id: project.id, name: project.name, slug: project.slug } : null,
    completedWorkItems,
    missionLogs,
    blockedItems,
    requiresReviewItems,
    autonomousItems,
    codexItems,
    artifactItems,
    projectsWithoutOpenNextActions,
    suggestedNextActions: buildSuggestedNextActions({
      projectsWithoutOpenNextActions,
      requiresReviewItems,
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
      "review_items",
      "review_feedback",
      "back_burner_items",
      "approval_gates",
      "codex_invocations",
      "codex_tasks",
      "capability_migrations",
      "events",
      "blog_sites",
      "blog_ideas",
      "blog_posts",
      "blog_schedules",
      "rebuster_integrations",
      "rebuster_events"
    ].includes(table)
  ) {
    throw new Error(`Unsupported table: ${table}`);
  }

  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function listCompletedWorkItemsInWindow(
  db: Database.Database,
  window: { since: string; until: string },
  projectId: string | null = null
): WorkItemSummary[] {
  return db
    .prepare(
      `SELECT
        wi.*,
        wi.work_classification AS responsibility,
        p.name AS project_name,
        m.title AS milestone_title
      FROM work_items wi
      LEFT JOIN projects p ON p.id = wi.project_id
      LEFT JOIN milestones m ON m.id = wi.milestone_id
      WHERE wi.status = 'done'
        AND substr(wi.updated_at, 1, 10) >= @since
        AND substr(wi.updated_at, 1, 10) <= @until
        AND (@projectId IS NULL OR wi.project_id = @projectId)
      ORDER BY wi.updated_at DESC, wi.created_at DESC, wi.id ASC`
    )
    .all({ ...window, projectId }) as WorkItemSummary[];
}

function listMissionLogsInWindow(
  db: Database.Database,
  window: { since: string; until: string },
  projectId: string | null = null
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
        AND (@projectId IS NULL OR ml.project_id = @projectId)
      ORDER BY ml.created_at DESC, ml.id ASC`
    )
    .all({ ...window, projectId }) as MissionLogSummary[];
}

function listArtifactChangesOrUpcoming(
  db: Database.Database,
  window: { since: string; until: string },
  projectId: string | null = null
): ArtifactSummary[] {
  return db
    .prepare(
      // The three "is this interesting" clauses are OR'd, so they are wrapped
      // before the project scope is AND'ed on — without the parentheses the
      // scope would bind to the last OR branch only and leak other Projects'
      // planned Artifacts into a scoped report.
      `SELECT
        a.*,
        p.name AS project_name,
        wi.title AS work_item_title
      FROM artifacts a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN work_items wi ON wi.id = a.work_item_id
      WHERE (
          a.status IN ('planned', 'drafted', 'ready')
          OR (
            substr(a.created_at, 1, 10) >= @since
            AND substr(a.created_at, 1, 10) <= @until
          )
          OR (
            substr(a.updated_at, 1, 10) >= @since
            AND substr(a.updated_at, 1, 10) <= @until
          )
        )
        AND (@projectId IS NULL OR a.project_id = @projectId)
      ORDER BY a.updated_at DESC, a.created_at DESC, a.id ASC`
    )
    .all({ ...window, projectId }) as ArtifactSummary[];
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
  requiresReviewItems: WorkItemSummary[];
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

  for (const item of input.requiresReviewItems) {
    seenWorkItems.add(item.id);
    suggestions.push(workItemSuggestion(item, "Requires Review"));
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

/**
 * Document-keyed lookups for `docs sync`.
 *
 * Ingestion resolves rows by `doc_ref` and never by title, so rewording a
 * heading updates the row it already owns instead of forking a new one. Rows
 * with a NULL doc_ref — everything Arcadia captured itself — are invisible to
 * these lookups and therefore can never be overwritten by a document.
 * See docs/plans/portfolio-docs-protocol.md.
 */
export function getProjectBySlug(db: Database.Database, slug: string): Project | null {
  return (
    (db.prepare("SELECT * FROM projects WHERE lower(slug) = lower(?)").get(slug) as Project | undefined) ?? null
  );
}

export interface ProofTargetCheck {
  id: string;
  target_id: string;
  project_id: string;
  url: string;
  health_state: "healthy" | "unhealthy";
  http_status: number | null;
  latency_ms: number | null;
  error_message: string | null;
  checked_at: string;
  created_at: string;
}

export interface CreateProofTargetCheckInput {
  targetId: string;
  projectId: string;
  url: string;
  healthState: "healthy" | "unhealthy";
  httpStatus: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
}

export function recordProofTargetCheck(db: Database.Database, input: CreateProofTargetCheckInput): ProofTargetCheck {
  const id = createId("proofTargetCheck");
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO proof_target_checks
       (id, target_id, project_id, url, health_state, http_status, latency_ms, error_message, checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.targetId,
    input.projectId,
    input.url,
    input.healthState,
    input.httpStatus,
    input.latencyMs,
    input.errorMessage,
    timestamp,
    timestamp
  );
  return getProofTargetCheck(db, id)!;
}

export function getProofTargetCheck(db: Database.Database, id: string): ProofTargetCheck | null {
  return (db.prepare("SELECT * FROM proof_target_checks WHERE id = ?").get(id) as ProofTargetCheck | undefined) ?? null;
}

export function getLatestProofTargetCheck(db: Database.Database, targetId: string): ProofTargetCheck | null {
  return (
    (db
      .prepare("SELECT * FROM proof_target_checks WHERE target_id = ? ORDER BY checked_at DESC, created_at DESC LIMIT 1")
      .get(targetId) as ProofTargetCheck | undefined) ?? null
  );
}

export function listLatestProofTargetChecksForProject(db: Database.Database, projectId: string): ProofTargetCheck[] {
  return db
    .prepare(
      `SELECT c.* FROM proof_target_checks c
       INNER JOIN (
         SELECT target_id, MAX(checked_at) AS max_checked_at
         FROM proof_target_checks
         WHERE project_id = ?
         GROUP BY target_id
       ) latest ON latest.target_id = c.target_id AND latest.max_checked_at = c.checked_at
       WHERE c.project_id = ?
       ORDER BY c.target_id`
    )
    .all(projectId, projectId) as ProofTargetCheck[];
}

export function getMilestoneByDocRef(
  db: Database.Database,
  projectId: string,
  docRef: string
): Milestone | null {
  return (
    (db
      .prepare("SELECT * FROM milestones WHERE project_id = ? AND doc_ref = ?")
      .get(projectId, docRef) as Milestone | undefined) ?? null
  );
}

export function getMilestoneByTitle(
  db: Database.Database,
  projectId: string,
  title: string
): Milestone | null {
  return (
    (db
      .prepare("SELECT * FROM milestones WHERE project_id = ? AND lower(title) = lower(?)")
      .get(projectId, title) as Milestone | undefined) ?? null
  );
}

export function setMilestoneDocRef(db: Database.Database, id: string, docRef: string): void {
  db.prepare("UPDATE milestones SET doc_ref = ?, updated_at = ? WHERE id = ?").run(docRef, nowIso(), id);
}

export function updateMilestoneTitle(db: Database.Database, id: string, title: string): void {
  db.prepare("UPDATE milestones SET title = ?, updated_at = ? WHERE id = ?").run(
    required(title, "Milestone title"),
    nowIso(),
    id
  );
}

export function getWorkItemByDocRef(db: Database.Database, docRef: string): WorkItemSummary | null {
  const row = db.prepare("SELECT id FROM work_items WHERE doc_ref = ?").get(docRef) as
    | { id: string }
    | undefined;
  return row ? getWorkItem(db, row.id) : null;
}

export function setWorkItemDocRef(db: Database.Database, id: string, docRef: string): void {
  db.prepare("UPDATE work_items SET doc_ref = ? WHERE id = ?").run(docRef, id);
}

export interface WorkItemDependency {
  workItemId: string;
  title: string;
  status: string;
  docRef: string | null;
}

/** The Actions `workItemId` waits on, in stable title order. */
export function listWorkItemDependencies(db: Database.Database, workItemId: string): WorkItemDependency[] {
  const rows = db
    .prepare(
      `SELECT w.id AS id, w.title AS title, w.status AS status, w.doc_ref AS doc_ref
       FROM work_item_dependencies d
       JOIN work_items w ON w.id = d.depends_on_work_item_id
       WHERE d.work_item_id = ?
       ORDER BY w.title`
    )
    .all(workItemId) as Array<{ id: string; title: string; status: string; doc_ref: string | null }>;

  return rows.map((row) => ({
    workItemId: row.id,
    title: row.title,
    status: row.status,
    docRef: row.doc_ref
  }));
}

/**
 * Make the document-declared edges out of `workItemId` exactly `dependsOnWorkItemIds`.
 *
 * Full replacement rather than insert-only, because documents own intent: an
 * operator who deletes a `depends_on` line is removing the dependency, and an
 * edge that survived that deletion would block dispatch forever with nothing in
 * any file explaining why. Only rows carrying a `doc_ref` are cleared, so an
 * edge recorded outside ingestion is left alone.
 */
export function replaceDocumentWorkItemDependencies(
  db: Database.Database,
  workItemId: string,
  docRef: string,
  dependsOnWorkItemIds: string[]
): void {
  const timestamp = nowIso();

  db.transaction(() => {
    db.prepare("DELETE FROM work_item_dependencies WHERE work_item_id = ? AND doc_ref IS NOT NULL").run(workItemId);

    const insert = db.prepare(
      `INSERT OR REPLACE INTO work_item_dependencies
         (work_item_id, depends_on_work_item_id, doc_ref, created_at)
       VALUES (?, ?, ?, ?)`
    );

    for (const dependsOn of dependsOnWorkItemIds) {
      // A self-edge would make an Action permanently undispatchable. The parser
      // cannot catch it without knowing ids, so refuse it at the write.
      if (dependsOn === workItemId) {
        continue;
      }
      insert.run(workItemId, dependsOn, docRef, timestamp);
    }
  })();
}

export function getReviewItemByDocRef(db: Database.Database, docRef: string): ReviewItemSummary | null {
  const row = db.prepare("SELECT id FROM review_items WHERE doc_ref = ?").get(docRef) as
    | { id: string }
    | undefined;
  return row ? getReviewItem(db, row.id) : null;
}

export function setReviewItemDocRef(db: Database.Database, id: string, docRef: string): void {
  db.prepare("UPDATE review_items SET doc_ref = ? WHERE id = ?").run(docRef, id);
}

export interface UpdateReviewItemFromDocInput {
  decisionNeeded: string;
  recommendation: string | null;
  status: ReviewItemStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  confidenceLabel: string;
  missingFields: string[];
}

/**
 * Rewrite the document-owned fields of a Decision.
 *
 * Deliberately narrow: it touches only what a document is the source of truth
 * for. Execution-side columns (`ask_request_id`, `plan_id`, the Codex links)
 * belong to Arcadia and are never overwritten by a sync.
 */
export function updateReviewItemFromDoc(
  db: Database.Database,
  id: string,
  input: UpdateReviewItemFromDocInput
): ReviewItemSummary | null {
  db.prepare(
    `UPDATE review_items SET
       decision_needed = @decision_needed,
       recommendation = @recommendation,
       status = @status,
       decision_note = @decision_note,
       decided_at = @decided_at,
       confidence_label = @confidence_label,
       missing_fields = @missing_fields,
       updated_at = @updated_at
     WHERE id = @id`
  ).run({
    id,
    decision_needed: required(input.decisionNeeded, "Decision question"),
    recommendation: nullable(input.recommendation),
    status: validateReviewItemStatus(input.status),
    decision_note: nullable(input.decisionNote),
    decided_at: nullable(input.decidedAt),
    confidence_label: required(input.confidenceLabel, "Confidence label"),
    missing_fields: encodeStringArray(input.missingFields),
    updated_at: nowIso()
  });

  return getReviewItem(db, id);
}

export function getMissionLogByDocRef(db: Database.Database, docRef: string): MissionLog | null {
  return (
    (db.prepare("SELECT * FROM mission_logs WHERE doc_ref = ?").get(docRef) as MissionLog | undefined) ?? null
  );
}

export function setMissionLogDocRef(db: Database.Database, id: string, docRef: string): void {
  db.prepare("UPDATE mission_logs SET doc_ref = ? WHERE id = ?").run(docRef, id);
}

export interface UpdateMissionLogFromDocInput {
  workPerformed: string;
  result: string;
  nextAction: string;
  blockers: string | null;
  markdownPath: string;
}

/**
 * Rewrite an ingested mission Log entry from the document that owns it.
 *
 * Deliberately narrow: it touches only the four narrative fields and the path,
 * leaving `project_id`, `milestone_id`, and `artifact_impact` alone. Those are
 * execution state that Arcadia's own flows attach to a Log after the fact, and
 * the division of truth puts execution state on Arcadia's side of the line —
 * a re-sync of the same document must not erase it.
 */
export function updateMissionLogFromDoc(
  db: Database.Database,
  id: string,
  input: UpdateMissionLogFromDocInput
): void {
  db.prepare(
    `UPDATE mission_logs
        SET work_performed = @work_performed,
            result = @result,
            next_action = @next_action,
            blockers = @blockers,
            markdown_path = @markdown_path,
            updated_at = @updated_at
      WHERE id = @id`
  ).run({
    id,
    work_performed: input.workPerformed,
    result: input.result,
    next_action: input.nextAction,
    blockers: input.blockers,
    markdown_path: input.markdownPath,
    updated_at: nowIso()
  });
}

export function findMissionLogByEntry(
  db: Database.Database,
  projectId: string | null,
  markdownPath: string
): MissionLog | null {
  return (
    (db
      .prepare("SELECT * FROM mission_logs WHERE markdown_path = ? AND (project_id IS ? OR project_id = ?)")
      .get(markdownPath, projectId, projectId) as MissionLog | undefined) ?? null
  );
}

export interface PortfolioProjectRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  goal: string | null;
  current_milestone: string | null;
  open_actions: number;
  in_progress_actions: number;
  done_actions: number;
  blocked_actions: number;
  clarified: number;
  unclarified: number;
  question_open: number;
  unevaluated: number;
  open_decisions: number;
  doc_backed_actions: number;
}

/**
 * One row per Project for the executive view.
 *
 * The clarity counts are the point. "12 open Actions" says nothing about
 * whether the portfolio is workable; "3 of them are still unclarified and 2 are
 * waiting on an answer" is the number that decides where the operator's next
 * hour goes. `unevaluated` counts rows that predate clarification entirely
 * (NULL status) and is kept distinct from `unclarified` for the same reason the
 * column does.
 */
export function listPortfolioProjects(db: Database.Database): PortfolioProjectRow[] {
  return db
    .prepare(
      `SELECT
        p.id,
        p.name,
        p.slug,
        p.status,
        p.goal,
        (
          SELECT m.title FROM milestones m
          WHERE m.project_id = p.id AND m.status = 'active'
          ORDER BY m.created_at DESC LIMIT 1
        ) AS current_milestone,
        COALESCE(SUM(CASE WHEN wi.status = 'open' THEN 1 ELSE 0 END), 0) AS open_actions,
        COALESCE(SUM(CASE WHEN wi.status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_actions,
        COALESCE(SUM(CASE WHEN wi.status = 'done' THEN 1 ELSE 0 END), 0) AS done_actions,
        COALESCE(SUM(CASE WHEN wi.status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked_actions,
        COALESCE(SUM(CASE WHEN wi.status != 'done' AND wi.clarification_status = 'clarified' THEN 1 ELSE 0 END), 0) AS clarified,
        COALESCE(SUM(CASE WHEN wi.status != 'done' AND wi.clarification_status = 'unclarified' THEN 1 ELSE 0 END), 0) AS unclarified,
        COALESCE(SUM(CASE WHEN wi.status != 'done' AND wi.clarification_status = 'question_open' THEN 1 ELSE 0 END), 0) AS question_open,
        COALESCE(SUM(CASE WHEN wi.status != 'done' AND wi.clarification_status IS NULL THEN 1 ELSE 0 END), 0) AS unevaluated,
        COALESCE(SUM(CASE WHEN wi.doc_ref IS NOT NULL THEN 1 ELSE 0 END), 0) AS doc_backed_actions,
        (
          SELECT COUNT(*) FROM review_items ri
          WHERE ri.project_id = p.id AND ri.status IN ('open', 'deferred')
        ) AS open_decisions
      FROM projects p
      LEFT JOIN work_items wi ON wi.project_id = p.id
      GROUP BY p.id
      ORDER BY
        CASE p.status WHEN 'active' THEN 0 WHEN 'incubating' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
        p.name COLLATE NOCASE`
    )
    .all() as PortfolioProjectRow[];
}

export interface PortfolioDecisionRow {
  id: string;
  slug: string | null;
  project_name: string | null;
  decision_needed: string;
  status: string;
  created_at: string;
}

/** Every Decision waiting on a human, newest last so the oldest debt reads first. */
export function listPortfolioOpenDecisions(db: Database.Database, limit = 20): PortfolioDecisionRow[] {
  return db
    .prepare(
      `SELECT ri.id, ri.slug, p.name AS project_name, ri.decision_needed, ri.status, ri.created_at
       FROM review_items ri
       LEFT JOIN projects p ON p.id = ri.project_id
       WHERE ri.status IN ('open', 'deferred')
       ORDER BY ri.created_at ASC
       LIMIT ?`
    )
    .all(limit) as PortfolioDecisionRow[];
}
