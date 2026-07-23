import type Database from "better-sqlite3";
import type { ApprovalGateType } from "../domain/constants.js";
import type {
  Artifact,
  ApprovalGate,
  CreateApprovalGateInput,
  CreateArtifactInput,
  CreateMissionLogInput,
  CreateReviewItemInput,
  CreateWorkItemInput,
  MissionLog,
  ProjectContext,
  ReviewItemSummary,
  WorkItem
} from "../domain/types.js";

export type CapabilityPermission = "autonomous" | "codex" | "requires_review" | "blocked";

export interface CapabilityMigration {
  id: string;
  sql: string;
}

export interface CapabilityCommand {
  id: string;
  title: string;
  permission: CapabilityPermission;
  approvalGates: ApprovalGateType[];
}

export interface CapabilityEventHandler {
  eventType: string;
  handlerId: string;
}

export interface CapabilityArtifactType {
  type: string;
  title: string;
}

export interface CapabilityDashboardSurface {
  id: string;
  title: string;
}

export interface CapabilityModule {
  id: string;
  name: string;
  version: string;
  migrations: CapabilityMigration[];
  commands: CapabilityCommand[];
  eventHandlers: CapabilityEventHandler[];
  permissions: CapabilityPermission[];
  artifactTypes: CapabilityArtifactType[];
  dashboardSurfaces: CapabilityDashboardSurface[];
  mcp?: {
    tools?: string[];
    resources?: string[];
  };
}

export interface EmitEventInput {
  eventType: string;
  sourceModule?: string | null;
  projectId?: string | null;
  workItemId?: string | null;
  artifactId?: string | null;
  reviewItemId?: string | null;
  payload?: Record<string, unknown>;
}

export interface CoreCapabilityApi {
  readProjectContext(projectId: string): ProjectContext | null;
  createWorkItem(input: CreateWorkItemInput): { workItem: WorkItem; artifact: Artifact | null };
  createReviewItem(input: CreateReviewItemInput): ReviewItemSummary;
  attachArtifact(input: CreateArtifactInput): Artifact;
  appendMissionLog(input: CreateMissionLogInput): MissionLog;
  emitEvent(input: EmitEventInput): void;
  createApprovalGate(input: CreateApprovalGateInput): ApprovalGate;
  registerCapability(module: CapabilityModule): CapabilityModule;
}

export interface CapabilityRuntime {
  db: Database.Database;
  workspacePath: string;
  core: CoreCapabilityApi;
}
