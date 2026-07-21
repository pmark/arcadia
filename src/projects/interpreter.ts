import type Database from "better-sqlite3";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";
import { submitIntelligenceRequest } from "../intelligence/service/jobService.js";
import type { IntelligenceJob, IntelligenceRequest, JsonValue } from "../intelligence/types.js";
import { getProjectMetadata, updateProject, upsertProjectMetadata } from "../db/repositories.js";
import type { Project, ProjectMetadata } from "../domain/types.js";
import type { ProjectStatus } from "../domain/constants.js";
import { PROJECT_STATUSES } from "../domain/constants.js";
import { decodeStringArray } from "./setup.js";

export class ProjectInterpreterUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProjectInterpreterUnavailableError";
  }
}

export class ProjectReplyUnparseableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProjectReplyUnparseableError";
  }
}

export type ProjectOp =
  | { op: "update_status"; status: ProjectStatus }
  | { op: "update_mission"; mission: string }
  | { op: "update_goal"; goal: string }
  | { op: "update_status_summary"; statusSummary: string }
  | { op: "note"; text: string };

export interface ProjectReplyInterpretation {
  ops: ProjectOp[];
  echo: string;
  confidence: number;
  ambiguousQuestion?: string;
}

// See src/orientation/interpreter.ts — identical shape (permissive schema,
// ajv strict:false), same rationale.
const REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["update_status", "update_mission", "update_goal", "update_status_summary", "note"]
          },
          status: { type: "string", enum: [...PROJECT_STATUSES] },
          mission: { type: "string" },
          goal: { type: "string" },
          statusSummary: { type: "string" },
          text: { type: "string" }
        },
        required: ["op"]
      }
    },
    echo: { type: "string" },
    confidence: { type: "number" },
    ambiguousQuestion: { type: "string" }
  },
  required: ["ops", "echo", "confidence"]
};

function buildInterpretationRequest(replyText: string, project: Project, metadata: ProjectMetadata | null): IntelligenceRequest {
  const projectSummary = {
    id: project.id,
    name: project.name,
    mission: project.mission,
    goal: project.goal,
    status: project.status,
    statusSummary: metadata?.status_summary ?? null
  };

  const instructions =
    "You maintain the top-level status of one Arcadia project (not its tasks/milestones — those are managed elsewhere). " +
    "Given the project's current state and a reply from the operator, produce operations to update it. " +
    `Valid ops: {"op":"update_status","status":one of ${JSON.stringify(PROJECT_STATUSES)}}, ` +
    '{"op":"update_mission","mission":string}, {"op":"update_goal","goal":string}, ' +
    '{"op":"update_status_summary","statusSummary":string} (a one-line human status, e.g. what\'s currently true), ' +
    '{"op":"note","text":string} (anything worth recording that isn\'t a structured field change). ' +
    "If the reply is too ambiguous to confidently produce ops, return ops: [] and set ambiguousQuestion to a short clarifying question. " +
    "confidence is 0..1. echo is a one-sentence human-readable summary of what you understood.";

  return {
    idempotencyKey: `project-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operationId: "arcadia.project.interpret-reply",
    clientApp: "arcadia-mission-control",
    capability: "text.generate",
    execution: "local-preferred",
    profile: "fast",
    input: { instructions, project: projectSummary, reply: replyText },
    outputContract: {
      schemaId: "arcadia.project.reply-interpretation.v1",
      schemaVersion: 1,
      jsonSchema: REPLY_JSON_SCHEMA
    },
    template: { id: "arcadia.project.reply-interpretation", version: "1" },
    executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
  };
}

/**
 * Mirrors src/orientation/interpreter.ts's interpretOrientationReply: submits
 * and runs one Intelligence job in-process rather than waiting on the
 * separate worker daemon's poll loop.
 */
export async function interpretProjectReply(
  db: Database.Database,
  workspacePath: string,
  replyText: string,
  project: Project
): Promise<ProjectReplyInterpretation> {
  const metadata = getProjectMetadata(db, project.id);
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const liteLlmClient = createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
    // Same cold-local-model tolerance as the orientation interpreter — see
    // src/orientation/interpreter.ts for why 60s (the client default) isn't
    // enough.
    timeoutMs: 180_000
  });
  const worker = new IntelligenceWorker(repository, liteLlmClient, config, artifactStore);

  const request = buildInterpretationRequest(replyText, project, metadata);
  const { job: submitted } = await submitIntelligenceRequest(repository, request);
  const finished = await worker.runOnce();
  const job: IntelligenceJob | undefined =
    finished?.id === submitted.id ? finished : await repository.findById(submitted.id);

  if (!job) {
    throw new ProjectInterpreterUnavailableError("Project reply job disappeared after submission.");
  }

  if (job.status === "blocked") {
    throw new ProjectInterpreterUnavailableError(
      `Cannot reach the local model right now (${job.error?.code ?? "UNKNOWN"}): ${job.error?.message ?? "no detail"}`
    );
  }

  if (job.status !== "completed") {
    throw new ProjectReplyUnparseableError(
      `Could not interpret the reply (${job.error?.code ?? "UNKNOWN"}): ${job.error?.message ?? "no detail"}`
    );
  }

  const result = job.result as JsonValue as {
    ops: ProjectOp[];
    echo: string;
    confidence: number;
    ambiguousQuestion?: string;
  };

  return {
    ops: result.ops ?? [],
    echo: result.echo,
    confidence: result.confidence,
    ambiguousQuestion: result.ambiguousQuestion
  };
}

export function applyProjectOps(
  db: Database.Database,
  projectId: string,
  ops: ProjectOp[]
): { project: Project; metadata: ProjectMetadata | null } {
  let project: Project | null = null;
  let metadata: ProjectMetadata | null = getProjectMetadata(db, projectId);

  for (const op of ops) {
    switch (op.op) {
      case "update_status":
        project = updateProject(db, projectId, { status: op.status });
        break;
      case "update_mission":
        project = updateProject(db, projectId, { mission: op.mission });
        break;
      case "update_goal":
        project = updateProject(db, projectId, { goal: op.goal });
        break;
      case "update_status_summary":
        metadata = upsertProjectMetadata(db, {
          projectId,
          statusSummary: op.statusSummary,
          aliases: decodeStringArray(metadata?.aliases),
          repoPath: metadata?.repo_path ?? undefined,
          validationCommands: decodeStringArray(metadata?.validation_commands)
        });
        break;
      case "note":
        // Recorded via the caller's event emission only (see
        // commands/project.ts) — no structured field to write, mirrors
        // orientation's "context" op.
        break;
      default:
        break;
    }
  }

  const finalProject = project ?? getFreshProject(db, projectId);
  if (!finalProject) {
    throw new Error(`Project not found after applying ops: ${projectId}`);
  }
  return { project: finalProject, metadata };
}

function getFreshProject(db: Database.Database, projectId: string): Project | null {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | null;
}
