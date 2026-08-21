import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import {
  projectInterpreterUnavailable,
  projectNotFound,
  projectReplyAmbiguous,
  projectReplyUnparseable,
  validationError
} from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { withDatabase } from "../db/connection.js";
import {
  createMissionLog,
  createProjectWithInitialWork,
  getProject,
  getProjectMetadata,
  getWorkItem,
  listProjects,
  listProjectSummaries,
  setWorkItemDocRef,
  updateProject,
  updateWorkItem,
  upsertProjectMetadata
} from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import { isDispatchable, resolveDispatch, type DispatchResolution } from "../docs/dispatch.js";
import { actionDocRef } from "../docs/types.js";
import { listMonitoredProjects } from "./workMonitor.js";
import {
  applyProjectOps,
  interpretProjectReply,
  ProjectInterpreterUnavailableError,
  ProjectReplyUnparseableError
} from "../projects/interpreter.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import { WORK_CLASSIFICATION_LABELS, type ProjectStatus, type WorkClassification } from "../domain/constants.js";
import { localDateStamp } from "../utils/time.js";
import type { CreatedProjectBundle, MissionLog, Project, ProjectMetadata, ProjectSummary } from "../domain/types.js";
import { buildMissionLogRelativePath, writeMissionLogMarkdown } from "../markdown/missionLog.js";
import { promptForProjectCreate } from "../prompts/index.js";
import { setupArcadiaProjectContext, type SetupProjectContextResult } from "../projects/contextSetup.js";
import { seedControlDocuments, type SeedControlDocumentsResult } from "../projects/controlDocuments.js";
import { decodeStringArray, updateProjectSetup } from "../projects/setup.js";
import { slugify } from "../utils/slug.js";
import { getWorkspacePaths, resolveWorkspacePath, toWorkspaceRelativePath } from "../workspace/paths.js";
import { runWorkPlanCommand, type WorkPlanCommandData } from "./work.js";

const DEFAULT_PROJECT_MISSION = "Mission needs definition.";
const DEFAULT_PROJECT_MILESTONE = "Define the project direction.";
const DEFAULT_PROJECT_NEXT_ACTION = "Clarify the project mission and first concrete next action.";

export interface ProjectCreateCommandData {
  project: CreatedProjectBundle["project"];
  milestone: CreatedProjectBundle["milestone"];
  workItem: CreatedProjectBundle["workItem"];
  missionLog: MissionLog;
  metadata: ProjectMetadata | null;
  projectPath: string;
  templateUsed: string | null;
}

export interface ProjectPrepareCommandData {
  classification: {
    intentType: "Project Work";
    executionPath: "Plan First";
    responsibility: "codex";
  };
  project: CreatedProjectBundle["project"];
  milestone: CreatedProjectBundle["milestone"];
  workItem: NonNullable<ReturnType<typeof getWorkItem>>;
  projectPath: string;
  controlDocuments: SeedControlDocumentsResult;
  dispatch: DispatchResolution;
  planning: WorkPlanCommandData;
  trigger: string;
}

/**
 * Convert an explicit software-Project idea into the exact governed planning
 * Action Arcadia already knows how to approve and run.
 *
 * The explicit command is the classification boundary: unlike generic `ask`,
 * this input cannot be mistaken for a Back Burner thought. It still invokes no
 * model. The output is an immutable planning packet plus the Decision that can
 * trigger one read-only planning Run.
 */
export function runProjectPrepareCommand(options: {
  workspace: string;
  name: string;
  idea: string;
  path?: string;
  agentProfile?: string;
}): CommandSuccess<ProjectPrepareCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const name = options.name.trim();
  const idea = options.idea.trim();
  if (!name) {
    throw validationError("Project name is required.");
  }
  if (!idea) {
    throw validationError("Project idea is required.");
  }

  const slug = slugify(name);
  const projectPath = resolveProjectFilesystemPath(workspacePath, slug, options.path);
  assertProjectPreparationTargetAvailable(workspacePath, name, slug, projectPath);

  const created = withDatabase(workspacePath, (db) => {
    const bundle = createProjectWithInitialWork(db, {
      name,
      mission: `Turn the captured ${name} idea into a useful, validated product.`,
      goal: idea,
      status: "active",
      currentMilestone: "Plan the first usable build",
      nextAction: `Plan the first usable build for ${name}`,
      rawInput: idea,
      expectedArtifact: `Accepted implementation plan for ${name}`,
      workClassification: "codex"
    });
    const workItem = updateWorkItem(db, bundle.workItem.id, {
      effort: "session",
      clarificationStatus: "clarified",
      clarificationSource: "Explicit project idea supplied to arcadia project prepare.",
      confidence: "high",
      acceptanceCriteriaJson: JSON.stringify([
        "The planning Artifact defines ordered implementation phases and the smallest useful first build.",
        "The planning Artifact names repository impact, validation strategy, risks, open questions, and approval requirements.",
        "The planning Artifact ends with one concrete implementation Action suitable for a coding agent."
      ])
    });
    if (!workItem) {
      throw validationError("Initial planning Action could not be prepared.", { project: name });
    }
    upsertProjectMetadata(db, {
      projectId: bundle.project.id,
      aliases: [bundle.project.slug],
      repoPath: projectPath,
      statusSummary: "Project idea captured; read-only coding-agent planning awaits approval.",
      validationCommands: []
    });
    return { ...bundle, workItem };
  });

  mkdirSync(projectPath, { recursive: true });
  const controlDocuments = seedControlDocuments({
    repoPath: projectPath,
    project: created.project,
    milestoneTitle: created.milestone.title,
    workItems: [created.workItem],
    hasProjectDocument: false,
    hasPlanDocument: false
  });
  if (!controlDocuments.plan || !controlDocuments.projectDocument || !controlDocuments.planSlug || !controlDocuments.currentActionId) {
    throw validationError("Project control documents could not be created.", { projectPath, controlDocuments });
  }
  const planSlug = controlDocuments.planSlug;
  const currentActionId = controlDocuments.currentActionId;

  withDatabase(workspacePath, (db) => {
    setWorkItemDocRef(
      db,
      created.workItem.id,
      actionDocRef(planSlug, currentActionId)
    );
  });
  createInitialProjectMissionLog(workspacePath, created.project, created.milestone);
  withDatabase(workspacePath, (db) =>
    setupArcadiaProjectContext({ db, projectIdentifier: created.project.id })
  );

  const dispatch = resolveDispatch(projectPath, created.project.slug);
  if (!isDispatchable(dispatch)) {
    throw validationError("Prepared Project did not resolve to a dispatchable planning Action.", {
      projectPath,
      blockers: dispatch.blockers
    });
  }

  const planningResponse = runWorkPlanCommand({
    workspace: workspacePath,
    workId: created.workItem.id,
    agentProfile: options.agentProfile
  });
  const decision = planningResponse.data.planningDecision;
  if (!decision) {
    throw validationError("Planning preparation did not create its approval Decision.", {
      actionId: created.workItem.id,
      planId: planningResponse.data.plan.id
    });
  }

  const trigger = `arcadia review approve ${decision.slug ?? decision.id}`;
  return createSuccess({
    command: "project.prepare",
    workspace: workspacePath,
    data: {
      classification: {
        intentType: "Project Work",
        executionPath: "Plan First",
        responsibility: "codex"
      },
      project: created.project,
      milestone: created.milestone,
      workItem: getPreparedWorkItem(workspacePath, created.workItem.id),
      projectPath,
      controlDocuments,
      dispatch,
      planning: planningResponse.data,
      trigger
    },
    artifacts: [
      controlDocuments.projectDocument,
      controlDocuments.plan,
      ...(planningResponse.artifacts ?? [])
    ]
  });
}

export async function runProjectCreateCommand(options: {
  workspace: string;
  name?: string;
  path?: string;
}): Promise<CommandSuccess<ProjectCreateCommandData>> {
  if (options.name) {
    return createProjectWithDefaults({
      workspace: options.workspace,
      name: options.name,
      path: options.path
    });
  }

  const workspacePath = resolveWorkspacePath(options.workspace);
  const input = await promptForProjectCreate();
  const result = withDatabase(workspacePath, (db) => createProjectWithInitialWork(db, input));

  return createSuccess({
    command: "project.create",
    workspace: workspacePath,
    data: {
      ...result,
      missionLog: createInitialProjectMissionLog(workspacePath, result.project, result.milestone),
      metadata: null,
      projectPath: "",
      templateUsed: null
    }
  });
}

export interface ProjectListCommandData {
  projects: ProjectSummary[];
}

export interface ProjectShowCommandData {
  project: ProjectSummary;
}

export interface ProjectImportCommandData {
  project: CreatedProjectBundle["project"];
  milestone: CreatedProjectBundle["milestone"];
  workItem: CreatedProjectBundle["workItem"];
}

export interface ProjectUpdateCommandData {
  project: Project;
  updated: string[];
}

export interface ProjectMetadataCommandData {
  metadata: ProjectMetadata;
}

export interface ProjectSetupContextCommandData {
  repoPath: string;
  project: SetupProjectContextResult["project"];
  files: SetupProjectContextResult["files"];
  controlDocuments: SetupProjectContextResult["controlDocuments"];
  context: SetupProjectContextResult["context"];
}

export interface ProjectSetupContextAllResult {
  projectId: string;
  projectName: string;
  repoPath: string | null;
  status: "updated" | "skipped" | "failed";
  detail: string;
  files: SetupProjectContextResult["files"] | null;
  controlDocuments: SetupProjectContextResult["controlDocuments"] | null;
}

export interface ProjectSetupContextAllCommandData {
  results: ProjectSetupContextAllResult[];
  summary: { updated: number; skipped: number; failed: number };
}

export function createProjectWithDefaults(options: {
  workspace: string;
  name: string;
  path?: string;
}): CommandSuccess<ProjectCreateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const name = options.name.trim();
  if (!name) {
    throw validationError("Project name is required.");
  }

  const slug = slugify(name);
  const projectPath = resolveProjectFilesystemPath(workspacePath, slug, options.path);
  const created = withDatabase(workspacePath, (db) => {
    const existing = listProjects(db).find((project) => project.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      throw validationError("Project already exists.", { projectId: existing.id, name: existing.name });
    }

    const bundle = createProjectWithInitialWork(db, {
      name,
      mission: DEFAULT_PROJECT_MISSION,
      status: "incubating",
      currentMilestone: DEFAULT_PROJECT_MILESTONE,
      nextAction: DEFAULT_PROJECT_NEXT_ACTION,
      workClassification: "autonomous"
    });

    const metadata = upsertProjectMetadata(db, {
      projectId: bundle.project.id,
      aliases: [bundle.project.slug],
      repoPath: projectPath,
      statusSummary: "Project created with built-in defaults.",
      validationCommands: []
    });

    return { ...bundle, metadata };
  });

  const templateUsed = materializeProjectFiles({
    workspacePath,
    projectPath,
    project: created.project,
    nextAction: created.workItem.next_action
  });
  const missionLog = createInitialProjectMissionLog(workspacePath, created.project, created.milestone);

  return createSuccess({
    command: "project.create",
    workspace: workspacePath,
    data: {
      project: created.project,
      milestone: created.milestone,
      workItem: created.workItem,
      missionLog,
      metadata: created.metadata,
      projectPath,
      templateUsed
    },
    artifacts: [
      projectPath,
      path.join(workspacePath, missionLog.markdown_path)
    ]
  });
}

export function runProjectListCommand(options: { workspace: string }): CommandSuccess<ProjectListCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const projects = withDatabase(workspacePath, listProjectSummaries);

  return createSuccess({
    command: "project.list",
    workspace: workspacePath,
    data: { projects }
  });
}

export function runProjectShowCommand(options: {
  workspace: string;
  projectId: string;
}): CommandSuccess<ProjectShowCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const project = withDatabase(workspacePath, (db) =>
    listProjectSummaries(db).find((candidate) => candidate.id === options.projectId) ?? null
  );

  if (!project) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.show",
    workspace: workspacePath,
    data: { project }
  });
}

export function runProjectImportCommand(options: {
  workspace: string;
  name: string;
  mission: string;
  status: string;
  goal?: string;
  milestone: string;
  nextAction: string;
  classification: string;
  expectedArtifact?: string;
}): CommandSuccess<ProjectImportCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const created = withDatabase(workspacePath, (db) => {
    const existing = listProjects(db).find((project) => project.name.toLowerCase() === options.name.trim().toLowerCase());
    if (existing) {
      throw validationError("Project already exists.", { projectId: existing.id, name: existing.name });
    }

    return createProjectWithInitialWork(db, {
      name: options.name,
      mission: options.mission,
      goal: options.goal,
      status: options.status as ProjectStatus,
      currentMilestone: options.milestone,
      nextAction: options.nextAction,
      expectedArtifact: options.expectedArtifact,
      workClassification: options.classification as WorkClassification
    });
  });

  return createSuccess({
    command: "project.import",
    workspace: workspacePath,
    data: {
      project: created.project,
      milestone: created.milestone,
      workItem: created.workItem
    }
  });
}

export function runProjectUpdateCommand(options: {
  workspace: string;
  projectId: string;
  status?: string;
  mission?: string;
  goal?: string;
}): CommandSuccess<ProjectUpdateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const updated: string[] = [];
  if (options.status !== undefined) {
    updated.push("status");
  }
  if (options.mission !== undefined) {
    updated.push("mission");
  }
  if (options.goal !== undefined) {
    updated.push("goal");
  }
  if (updated.length === 0) {
    throw validationError("At least one project field is required.", { fields: ["status", "mission", "goal"] });
  }
  if (options.goal !== undefined) {
    const project = withDatabase(workspacePath, (db) =>
      updateProject(db, options.projectId, {
        status: options.status as ProjectStatus | undefined,
        mission: options.mission,
        goal: options.goal
      })
    );

    if (!project) {
      throw projectNotFound(options.projectId);
    }

    return createSuccess({
      command: "project.update",
      workspace: workspacePath,
      data: { project, updated }
    });
  }

  const result = withDatabase(workspacePath, (db) =>
    updateProjectSetup(db, {
      projectId: options.projectId,
      status: options.status,
      mission: options.mission
    })
  );

  if (!result) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.update",
    workspace: workspacePath,
    data: { project: result.project, updated }
  });
}

export function runProjectMetadataCommand(options: {
  workspace: string;
  projectId: string;
  aliases?: string[];
  repoPath?: string;
  statusSummary?: string;
  validationCommands?: string[];
}): CommandSuccess<ProjectMetadataCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const metadata = withDatabase(workspacePath, (db) => {
    if (options.aliases !== undefined || options.statusSummary !== undefined) {
      const existing = getProjectMetadata(db, options.projectId);
      return upsertProjectMetadata(db, {
        projectId: options.projectId,
        aliases: options.aliases ?? decodeStringArray(existing?.aliases),
        repoPath: options.repoPath ?? existing?.repo_path ?? null,
        statusSummary: options.statusSummary ?? existing?.status_summary ?? null,
        validationCommands: options.validationCommands ?? decodeStringArray(existing?.validation_commands)
      });
    }

    const result = updateProjectSetup(db, {
      projectId: options.projectId,
      repoPath: options.repoPath,
      validationCommands: options.validationCommands
    });

    return result?.metadata ?? null;
  });

  if (!metadata) {
    throw projectNotFound(options.projectId);
  }

  return createSuccess({
    command: "project.metadata",
    workspace: workspacePath,
    data: { metadata }
  });
}

export function runProjectSetupContextCommand(options: {
  workspace?: string;
  projectId?: string;
  repoPath?: string;
}): CommandSuccess<ProjectSetupContextCommandData> {
  if (!options.projectId && !options.repoPath) {
    throw validationError("Project identifier or --repo is required.");
  }

  // A bare `--repo` still opens the workspace when there is one, because
  // seeding the work pointer needs the Project this path is registered as, and
  // setup used to skip that lookup whenever a path was supplied -- which is how
  // `--repo` and a project id could adopt the same repository and produce
  // different results. It stays optional there: adopting a repository from
  // outside a workspace is a real use, and it writes the governance files
  // exactly as before, seeding nothing.
  const workspacePath = options.repoPath
    ? readyWorkspaceOrNull(options.workspace)
    : resolveReadyWorkspace(options.workspace).workspacePath;
  const setup = workspacePath
    ? withDatabase(workspacePath, (db) =>
        setupArcadiaProjectContext({
          db,
          projectIdentifier: options.repoPath ? undefined : options.projectId,
          repoPath: options.repoPath
        })
      )
    : setupArcadiaProjectContext({ repoPath: options.repoPath });

  return createSuccess({
    command: "project.setup-context",
    workspace: workspacePath ?? undefined,
    data: {
      repoPath: setup.repoPath,
      project: setup.project,
      files: setup.files,
      controlDocuments: setup.controlDocuments,
      context: setup.context
    },
    // A null entry means setup deliberately did not write that file -- an
    // unreadable source Constitution, or a CLAUDE.md holding project-authored
    // content. Those are not Artifacts, so they are not reported as produced.
    artifacts: Object.values(setup.files).filter((file): file is string => file !== null)
  });
}

export function runProjectSetupContextAllCommand(options: {
  workspace?: string;
}): CommandSuccess<ProjectSetupContextAllCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const results: ProjectSetupContextAllResult[] = listMonitoredProjects(db).map((project) => {
      if (!project.repositoryPath) {
        return {
          projectId: project.id,
          projectName: project.name,
          repoPath: null,
          status: "skipped",
          detail: "No repository path is configured.",
          files: null,
          controlDocuments: null
        };
      }
      try {
        // By id, not by path: this loop already knows which Project each
        // repository is, and passing the path alone would make setup rediscover
        // it -- or fail to, and skip seeding the work pointer for the whole
        // portfolio at once.
        const setup = setupArcadiaProjectContext({ db, projectIdentifier: project.id });
        return {
          projectId: project.id,
          projectName: project.name,
          repoPath: setup.repoPath,
          status: "updated",
          detail: "Context refreshed.",
          files: setup.files,
          controlDocuments: setup.controlDocuments
        };
      } catch (error) {
        return {
          projectId: project.id,
          projectName: project.name,
          repoPath: project.repositoryPath,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
          files: null,
          controlDocuments: null
        };
      }
    });

    return createSuccess({
      command: "project.setup-context-all",
      workspace: workspacePath,
      data: {
        results,
        summary: {
          updated: results.filter((result) => result.status === "updated").length,
          skipped: results.filter((result) => result.status === "skipped").length,
          failed: results.filter((result) => result.status === "failed").length
        }
      },
      artifacts: results.flatMap((result) =>
        result.files ? Object.values(result.files).filter((file): file is string => file !== null) : []
      )
    });
  } finally {
    db.close();
  }
}

export function renderProjectListSuccess(response: CommandSuccess<ProjectListCommandData>): string[] {
  if (response.data.projects.length === 0) {
    return ["No projects yet."];
  }

  const lines: string[] = [];
  for (const project of response.data.projects) {
    const classification = project.work_classification
      ? WORK_CLASSIFICATION_LABELS[project.work_classification]
      : "Unclassified";
    lines.push(`${project.name} (${project.status})`);
    lines.push(`  Mission: ${project.mission}`);
    lines.push(`  Outcome: ${project.outcome ?? project.goal ?? "None"}`);
    lines.push(`  Milestone: ${project.current_milestone ?? "None"}`);
    lines.push(`  Next action: ${project.next_action ?? "None"}`);
    lines.push(`  Responsibility: ${classification}`);
  }

  return lines;
}

export function renderProjectShowSuccess(response: CommandSuccess<ProjectShowCommandData>): string[] {
  const project = response.data.project;
  const classification = project.work_classification
    ? WORK_CLASSIFICATION_LABELS[project.work_classification]
    : "Unclassified";

  return [
    `Project: ${project.name}`,
    `ID: ${project.id}`,
    `Status: ${project.status}`,
    `Mission: ${project.mission}`,
    `Outcome: ${project.outcome ?? project.goal ?? "None"}`,
    `Current milestone: ${project.current_milestone ?? "None"}`,
    `Next action: ${project.next_action ?? "None"}`,
    `Responsibility: ${classification}`,
    `Expected artifact: ${project.expected_artifact ?? "None"}`
  ];
}

export function renderProjectImportSuccess(response: CommandSuccess<ProjectImportCommandData>): string[] {
  return [
    `Created project: ${response.data.project.name}`,
    `Project: ${response.data.project.id}`,
    `Outcome: ${response.data.project.goal ?? "None"}`,
    `Milestone: ${response.data.milestone.title}`,
    `Action: ${response.data.workItem.id}`
  ];
}

export function renderProjectCreateSuccess(response: CommandSuccess<ProjectCreateCommandData>): string[] {
  return [
    `Created project: ${response.data.project.name}`,
    `Project: ${response.data.project.id}`,
    `Slug: ${response.data.project.slug}`,
    `Status: ${response.data.project.status}`,
    `Path: ${response.data.projectPath || "None"}`,
    `Template: ${response.data.templateUsed ?? "Built-in defaults"}`,
    `Mission: ${response.data.project.mission}`,
    `Mission log: ${response.data.missionLog.markdown_path}`,
    `Next action: ${response.data.workItem.next_action}`
  ];
}

export function renderProjectPrepareSuccess(response: CommandSuccess<ProjectPrepareCommandData>): string[] {
  const decision = response.data.planning.planningDecision;
  return [
    `Prepared project idea: ${response.data.project.name}`,
    `Project: ${response.data.project.id} (${response.data.project.status})`,
    `Repository: ${response.data.projectPath}`,
    `Classification: ${response.data.classification.intentType}`,
    `Execution path: ${response.data.classification.executionPath}`,
    `Responsibility: ${WORK_CLASSIFICATION_LABELS[response.data.classification.responsibility]}`,
    `Planning Action: ${response.data.workItem.title} (${response.data.workItem.id})`,
    `Managed plan: ${response.data.controlDocuments.plan}`,
    `Planning packet: ${response.data.planning.packetArtifact?.path ?? "Unavailable"}`,
    `Planning Decision: ${decision?.slug ?? decision?.id ?? "Unavailable"}`,
    "No model or implementation agent was invoked.",
    `Trigger: ${response.data.trigger}`
  ];
}

export function renderProjectUpdateSuccess(response: CommandSuccess<ProjectUpdateCommandData>): string[] {
  return [
    `Updated project: ${response.data.project.name}`,
    `ID: ${response.data.project.id}`,
    `Mission: ${response.data.project.mission}`,
    `Outcome: ${response.data.project.goal ?? "None"}`,
    `Status: ${response.data.project.status}`
  ];
}

export function renderProjectMetadataSuccess(response: CommandSuccess<ProjectMetadataCommandData>): string[] {
  return [
    `Updated project metadata: ${response.data.metadata.project_id}`,
    `Aliases: ${decodeStringArray(response.data.metadata.aliases).join(", ") || "None"}`,
    `Repository: ${response.data.metadata.repo_path ?? "None"}`,
    `Validation: ${decodeStringArray(response.data.metadata.validation_commands).join(", ") || "None"}`
  ];
}

export function renderProjectSetupContextSuccess(response: CommandSuccess<ProjectSetupContextCommandData>): string[] {
  return [
    `Arcadia context setup: ${response.data.repoPath}`,
    `Project: ${response.data.project?.name ?? "None (--repo)"}`,
    `Agent policy: ${response.data.files.agentPolicy}`,
    `Repo context: ${response.data.files.repoContext}`,
    `Context policy: ${response.data.files.contextPolicy}`,
    `AGENTS.md: ${response.data.files.agents}`,
    `CONSTITUTION.md: ${response.data.files.constitution ?? "Not written — the adopted CONSTITUTION.md could not be read."}`,
    `Continuation protocol: ${response.data.files.continuationProtocol ?? "Not written — the adopted protocol could not be read."}`,
    // A declined CLAUDE.md must be said out loud. Setup leaving a file alone and
    // setup being unable to touch it look identical on disk, and the operator is
    // the only one who can decide what happens to their own agent instructions.
    response.data.files.claude
      ? `CLAUDE.md: ${response.data.files.claude}`
      : "CLAUDE.md: Left unchanged — it holds project-authored content. Move any shared rules into AGENTS.md, then reduce CLAUDE.md to `@AGENTS.md`.",
    ...renderControlDocuments(response.data.controlDocuments)
  ];
}

/**
 * The work pointer half of adoption, said out loud.
 *
 * A run that writes every governance file and no `PROJECT.md` looks like a
 * success and leaves the repository undispatchable, which is the defect this
 * whole path exists to close. Reporting both what was written and what was
 * deliberately left alone is what keeps that from being silent again.
 */
function renderControlDocuments(controlDocuments: SetupProjectContextResult["controlDocuments"]): string[] {
  return [
    controlDocuments.projectDocument
      ? `PROJECT.md: ${controlDocuments.projectDocument}`
      : "PROJECT.md: Not written.",
    controlDocuments.plan ? `Plan: ${controlDocuments.plan}` : "Plan: Not written.",
    ...controlDocuments.skipped.map((reason) => `  ${reason}`)
  ];
}

export function renderProjectSetupContextAllSuccess(response: CommandSuccess<ProjectSetupContextAllCommandData>): string[] {
  const { results, summary } = response.data;
  const lines = [
    "Arcadia context setup: all configured project repositories",
    `Updated: ${summary.updated}  Skipped: ${summary.skipped}  Failed: ${summary.failed}`
  ];
  if (results.length === 0) {
    lines.push("No projects found.");
    return lines;
  }
  for (const result of results) {
    if (result.status === "updated") {
      lines.push(`- ${result.projectName}: updated (${result.repoPath})`);
      for (const line of result.controlDocuments ? renderControlDocuments(result.controlDocuments) : []) {
        lines.push(`  ${line}`);
      }
    } else if (result.status === "skipped") {
      lines.push(`- ${result.projectName}: skipped — ${result.detail}`);
    } else {
      lines.push(`- ${result.projectName}: FAILED — ${result.detail}`);
    }
  }
  return lines;
}

/**
 * The workspace, when one is both configured and initialized.
 *
 * Adoption by repository path must not require a workspace, so a missing or
 * unready one is an absence rather than a failure here. Every other caller
 * still uses `resolveReadyWorkspace`, which refuses.
 */
function readyWorkspaceOrNull(workspace?: string): string | null {
  try {
    return resolveReadyWorkspace(workspace).workspacePath;
  } catch {
    return null;
  }
}

function resolveProjectFilesystemPath(workspacePath: string, slug: string, providedPath?: string): string {
  if (providedPath?.trim()) {
    return path.resolve(providedPath);
  }

  return path.join(getWorkspacePaths(workspacePath).projects, slug);
}

function assertProjectPreparationTargetAvailable(
  workspacePath: string,
  name: string,
  slug: string,
  projectPath: string
): void {
  const targetIdentity = repositoryIdentity(projectPath);
  const conflict = withDatabase(workspacePath, (db) => {
    for (const project of listProjects(db)) {
      if (project.name.toLowerCase() === name.toLowerCase() || project.slug === slug) {
        return { kind: "project", projectId: project.id, name: project.name };
      }
      const metadata = getProjectMetadata(db, project.id);
      if (metadata?.repo_path && repositoryIdentity(metadata.repo_path) === targetIdentity) {
        return { kind: "repository", projectId: project.id, name: project.name };
      }
    }
    return null;
  });
  if (conflict) {
    throw validationError("Project name or repository is already registered.", {
      ...conflict,
      projectPath
    });
  }

  if (existsSync(path.join(projectPath, "PROJECT.md"))) {
    throw validationError("Repository already contains PROJECT.md; Arcadia will not replace its work pointer.", {
      projectPath
    });
  }
  if (!existsSync(projectPath)) {
    return;
  }

  const discovery = discoverDocs(projectPath);
  const governing = discovery.docs.filter((doc) => doc.type === "project" || doc.type === "plan");
  if (governing.length > 0 || discovery.rejected.length > 0) {
    throw validationError("Repository already contains Arcadia control documents; preparation will not overwrite them.", {
      projectPath,
      documents: governing.map((doc) => doc.relativePath),
      rejected: discovery.rejected
    });
  }
  const bootstrapPlan = path.join(projectPath, "docs", "plans", `${slug}-bootstrap.md`);
  if (existsSync(bootstrapPlan)) {
    throw validationError("Repository already contains the bootstrap plan path; preparation will not overwrite it.", {
      projectPath,
      bootstrapPlan
    });
  }
}

function repositoryIdentity(repositoryPath: string): string {
  try {
    return realpathSync(repositoryPath);
  } catch {
    return path.resolve(repositoryPath);
  }
}

function getPreparedWorkItem(workspacePath: string, workItemId: string): NonNullable<ReturnType<typeof getWorkItem>> {
  const workItem = withDatabase(workspacePath, (db) => getWorkItem(db, workItemId));
  if (!workItem) {
    throw validationError("Prepared planning Action disappeared.", { workItemId });
  }
  return workItem;
}

function materializeProjectFiles(input: {
  workspacePath: string;
  projectPath: string;
  project: Project;
  nextAction: string;
}): string | null {
  mkdirSync(input.projectPath, { recursive: true });
  const template = findProjectTemplate(input.workspacePath);
  if (template) {
    copyTemplateFiles(template, input.projectPath);
    return toWorkspaceRelativePath(input.workspacePath, template);
  }

  // Seeded as managed documents so a new Project is ingestable by `docs sync`
  // from the moment it exists. `writeFileIfMissing` means this never overwrites
  // a document the operator has already written — the protocol stays one-way.
  const today = localDateStamp(new Date());
  writeFileIfMissing(
    path.join(input.projectPath, "PROJECT.md"),
    [
      "---",
      "arcadia: v1",
      "type: project",
      `slug: ${input.project.slug}`,
      `name: ${yamlScalar(input.project.name)}`,
      `status: ${input.project.status}`,
      `goal: ${yamlScalar(input.project.mission)}`,
      `updated: ${today}`,
      "---",
      "",
      `# ${input.project.name}`,
      "",
      "## Mission",
      "",
      input.project.mission,
      "",
      "## Next Action",
      "",
      input.nextAction,
      ""
    ].join("\n")
  );
  writeFileIfMissing(
    path.join(input.projectPath, "MISSION_LOG.md"),
    [
      "---",
      "arcadia: v1",
      "type: log",
      `slug: ${input.project.slug}-mission-log`,
      `project: ${input.project.slug}`,
      `updated: ${today}`,
      "---",
      "",
      `# Mission Log: ${input.project.name}`,
      "",
      `## ${today} — Project created`,
      "",
      "- **Did:** Created the Project with Arcadia built-in defaults.",
      `- **Result:** ${input.project.name} exists with a first Action.`,
      `- **Next:** ${input.nextAction}`,
      "- **Blockers:** none",
      ""
    ].join("\n")
  );
  return null;
}

/**
 * Quote a scalar only when it would otherwise change meaning — a project name
 * or mission containing `: ` is the single most common way generated
 * frontmatter becomes unparseable.
 */
function yamlScalar(value: string): string {
  const trimmed = value.trim();
  return /[:#]|^[-?&*!|>%@`"']/.test(trimmed) ? JSON.stringify(trimmed) : trimmed;
}

function findProjectTemplate(workspacePath: string): string | null {
  const candidates = [
    path.join(workspacePath, "templates", "project"),
    path.join(workspacePath, "templates", "default-project")
  ];

  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory()) ?? null;
}

function copyTemplateFiles(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyTemplateFiles(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile() && !existsSync(destinationPath)) {
      mkdirSync(path.dirname(destinationPath), { recursive: true });
      copyFileSync(sourcePath, destinationPath);
    }
  }
}

function writeFileIfMissing(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    return;
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

export interface ProjectReplyData {
  echo: string;
  confidence: number;
  applied: boolean;
  project: Project;
  metadata: ProjectMetadata | null;
}

/**
 * The Project tower's correction loop — mirrors
 * runOrientationReplyCommand (src/commands/orientation.ts) exactly: one
 * Intelligence call interprets free text into typed ops, applied
 * all-or-nothing, ambiguous/unparseable/interpreter-unavailable all leave
 * the project untouched.
 */
export async function runProjectReplyCommand(options: {
  workspace: string;
  projectId: string;
  text: string;
  source?: "cli" | "dashboard";
}): Promise<CommandSuccess<ProjectReplyData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const project = getProject(db, options.projectId);
    if (!project) {
      throw projectNotFound(options.projectId);
    }

    let interpretation;
    try {
      interpretation = await interpretProjectReply(db, workspacePath, options.text, project);
    } catch (error) {
      if (error instanceof ProjectInterpreterUnavailableError) {
        throw projectInterpreterUnavailable(error.message);
      }
      if (error instanceof ProjectReplyUnparseableError) {
        throw projectReplyUnparseable(error.message);
      }
      throw error;
    }

    if (interpretation.ops.length === 0 && interpretation.ambiguousQuestion) {
      emitProjectEvent(db, "project.reply.ambiguous", project.id, { question: interpretation.ambiguousQuestion });
      throw projectReplyAmbiguous(interpretation.ambiguousQuestion);
    }

    const { project: updatedProject, metadata } = applyProjectOps(db, project.id, interpretation.ops);
    for (const op of interpretation.ops) {
      emitProjectEvent(db, `project.reply.op.${op.op}`, project.id, { op });
    }

    return createSuccess({
      command: "project.reply",
      workspace: workspacePath,
      data: {
        echo: interpretation.echo,
        confidence: interpretation.confidence,
        applied: true,
        project: updatedProject,
        metadata
      }
    });
  } finally {
    db.close();
  }
}

function emitProjectEvent(db: ReturnType<typeof openDatabase>, eventType: string, projectId: string, payload: Record<string, unknown>): void {
  db.prepare(
    `INSERT INTO events (id, event_type, source_module, project_id, work_item_id, artifact_id, review_item_id, payload_json, created_at)
     VALUES (@id, @event_type, 'mission_control', @project_id, NULL, NULL, NULL, @payload_json, @created_at)`
  ).run({
    id: createId("event"),
    event_type: eventType,
    project_id: projectId,
    payload_json: JSON.stringify(payload),
    created_at: nowIso()
  });
}

export function renderProjectReplySuccess(response: CommandSuccess<ProjectReplyData>): string[] {
  return [response.data.echo, `Project ${response.data.project.id} updated.`];
}

function createInitialProjectMissionLog(workspacePath: string, project: Project, milestone: CreatedProjectBundle["milestone"]): MissionLog {
  const missionLog = withDatabase(workspacePath, (db) => {
    const logId = `log_${project.id}_created`;
    return createMissionLog(db, {
      id: logId,
      projectId: project.id,
      milestoneId: milestone.id,
      workPerformed: "Created the project with Arcadia defaults.",
      result: "Project exists in SQLite and has starter project files.",
      nextAction: DEFAULT_PROJECT_NEXT_ACTION,
      artifactImpact: `Created starter project state for ${project.name}.`,
      markdownPath: buildMissionLogRelativePath(workspacePath, project.name, logId)
    });
  });
  writeMissionLogMarkdown(workspacePath, { missionLog, project, milestone });
  return missionLog;
}
