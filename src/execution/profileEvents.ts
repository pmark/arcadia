import type Database from "better-sqlite3";
import {
  CAPABILITY_TIERS,
  evaluateExecutionEscalation,
  REASONING_EFFORTS,
  type ExecutionEscalationTrigger,
  type ExecutionPhase,
  type ResolvedExecutionProfile
} from "./profiles.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";

export type ExecutionProfileEventType =
  | "coding_agent.profile_selected"
  | "coding_agent.profile_escalated"
  | "coding_agent.profile_unsatisfied";

export interface RecordExecutionProfileEventInput {
  eventType: ExecutionProfileEventType;
  workItemId: string;
  runId?: string | null;
  invocationId?: string | null;
  phase: ExecutionPhase;
  reason: string;
  from?: ResolvedExecutionProfile | null;
  to?: ResolvedExecutionProfile | null;
  mappingId?: string | null;
  bindingId?: string | null;
  evidence?: string[];
}

export class ExecutionProfileEscalationRequiredError extends Error {
  public readonly code = "EXECUTION_PROFILE_ESCALATION_REQUIRED";

  public constructor(
    message: string,
    public readonly eventId: string,
    public readonly authorityRequired: boolean
  ) {
    super(message);
    this.name = "ExecutionProfileEscalationRequiredError";
  }
}

export function recordExecutionProfileEvent(
  db: Database.Database,
  input: RecordExecutionProfileEventInput
): string {
  if (input.eventType === "coding_agent.profile_escalated") {
    validateEscalation(input.from, input.to);
  }
  const id = createId("event");
  db.prepare(
    `INSERT INTO events (
      id, event_type, source_module, project_id, work_item_id,
      artifact_id, review_item_id, payload_json, created_at
    ) VALUES (
      @id, @event_type, 'coding_agent_selection', NULL, @work_item_id,
      NULL, NULL, @payload_json, @created_at
    )`
  ).run({
    id,
    event_type: input.eventType,
    work_item_id: input.workItemId,
    payload_json: JSON.stringify({
      schemaVersion: 1,
      runId: input.runId ?? null,
      invocationId: input.invocationId ?? null,
      phase: input.phase,
      reason: input.reason,
      from: input.from ?? null,
      to: input.to ?? null,
      mappingId: input.mappingId ?? null,
      bindingId: input.bindingId ?? null,
      evidence: input.evidence ?? []
    }),
    created_at: nowIso()
  });
  return id;
}

export function stopForExecutionProfileEscalation(
  db: Database.Database,
  input: Omit<RecordExecutionProfileEventInput, "eventType" | "to" | "reason"> & {
    from: ResolvedExecutionProfile;
    triggers: ExecutionEscalationTrigger[];
  }
): never {
  const evaluation = evaluateExecutionEscalation(input.from, input.triggers);
  if (!evaluation.required && !evaluation.authorityRequired) {
    throw new Error("The reported execution characteristics do not require escalation.");
  }
  const reason = `Execution stopped after discovering: ${input.triggers.join(", ")}.`;
  const eventId = recordExecutionProfileEvent(db, {
    ...input,
    eventType: "coding_agent.profile_escalated",
    reason,
    to: evaluation.target,
    evidence: input.evidence ?? []
  });
  throw new ExecutionProfileEscalationRequiredError(
    `${reason} Required profile is ${evaluation.target.capability}/${evaluation.target.effort}.` +
      (evaluation.authorityRequired ? " Separate operator authority is also required." : ""),
    eventId,
    evaluation.authorityRequired
  );
}

function validateEscalation(
  from: ResolvedExecutionProfile | null | undefined,
  to: ResolvedExecutionProfile | null | undefined
): void {
  if (!from || !to) {
    throw new Error("Execution-profile escalation requires both from and to profiles.");
  }
  const capabilityFrom = CAPABILITY_TIERS.indexOf(from.capability);
  const capabilityTo = CAPABILITY_TIERS.indexOf(to.capability);
  const effortFrom = REASONING_EFFORTS.indexOf(from.effort);
  const effortTo = REASONING_EFFORTS.indexOf(to.effort);
  if (capabilityTo < capabilityFrom || effortTo < effortFrom) {
    throw new Error("Execution-profile escalation cannot weaken capability or reasoning effort.");
  }
  if (capabilityTo === capabilityFrom && effortTo === effortFrom) {
    throw new Error("Execution-profile escalation must increase capability or reasoning effort.");
  }
}
