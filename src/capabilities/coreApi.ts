import type Database from "better-sqlite3";
import type { CapabilityModule, CoreCapabilityApi, EmitEventInput } from "./core.js";
import { getCapability } from "./registry.js";
import {
  createApprovalGate,
  createArtifactRecord,
  createMissionLog,
  createReviewItem,
  createWorkItemWithOptionalArtifact,
  getProjectContext
} from "../db/repositories.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export function createCoreCapabilityApi(db: Database.Database): CoreCapabilityApi {
  return {
    readProjectContext(projectId) {
      return getProjectContext(db, projectId);
    },
    createWorkItem(input) {
      return createWorkItemWithOptionalArtifact(db, input);
    },
    createReviewItem(input) {
      return createReviewItem(db, input);
    },
    attachArtifact(input) {
      return createArtifactRecord(db, input);
    },
    appendMissionLog(input) {
      return createMissionLog(db, input);
    },
    emitEvent(input) {
      emitEvent(db, input);
    },
    createApprovalGate(input) {
      return createApprovalGate(db, input);
    },
    registerCapability(module) {
      return getCapability(module.id) ?? module;
    }
  };
}

function emitEvent(db: Database.Database, input: EmitEventInput): void {
  db.prepare(
    `INSERT INTO events (
      id, event_type, source_module, project_id, work_item_id, artifact_id,
      review_item_id, payload_json, created_at
    ) VALUES (
      @id, @event_type, @source_module, @project_id, @work_item_id, @artifact_id,
      @review_item_id, @payload_json, @created_at
    )`
  ).run({
    id: createId("event"),
    event_type: input.eventType,
    source_module: input.sourceModule ?? null,
    project_id: input.projectId ?? null,
    work_item_id: input.workItemId ?? null,
    artifact_id: input.artifactId ?? null,
    review_item_id: input.reviewItemId ?? null,
    payload_json: JSON.stringify(input.payload ?? {}),
    created_at: nowIso()
  });
}
