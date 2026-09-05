import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";

export const AGENT_ASK_INTENTS = ["auto", "outcome", "milestone", "plan", "proposal", "decision", "action", "artifact", "log", "project_update", "complete"] as const;
export type AgentAskIntent = (typeof AGENT_ASK_INTENTS)[number];
export type AgentAskAuthority = "propose" | "apply_if_approved";
export const AGENT_ASK_AUTHORITIES = ["propose", "apply_if_approved"] as const;
export interface NormalizedAgentAskAction {
  id: string | null;
  desiredResult: string;
  acceptance: string[];
  dependencies: string[];
  references: string[];
  targetRef: string | null;
}
/** A choice a filed `decision` Ask offers, carried through to the Decision document's own `options` list. */
export interface NormalizedAgentAskOption { label: string; consequence: string; recommended: boolean; }
/**
 * One declared acceptance criterion's disposition, offered as evidence for a
 * `complete` Ask. Never "unknown" or free text: a criterion this evidence
 * does not affirmatively call `met` refuses completion, per
 * `docs/proposals/complete-managed-action-from-evidence.md` — passing tests or
 * a merged PR alone never imply acceptance.
 */
export type AgentAskEvidenceStatus = "met" | "failed" | "skipped";
export interface NormalizedAgentAskEvidence { criterion: string; status: AgentAskEvidenceStatus; note: string | null; }
export interface NormalizedAgentAsk { version: "v1"; format: "strict" | "natural"; requestId: string; project: string; intent: AgentAskIntent; desiredResult: string; rationale: string | null; acceptance: string[]; dependencies: string[]; references: string[]; actions: NormalizedAgentAskAction[]; targetRef: string | null; requestedAuthority: AgentAskAuthority; options: NormalizedAgentAskOption[]; candidateRevision: string | null; evidence: NormalizedAgentAskEvidence[]; }
export interface AgentAskEffect { operation: "interpret" | "create" | "update"; targetKind: Exclude<AgentAskIntent, "auto"> | "interpretation"; targetRef: string | null; fields: Record<string, unknown>; status: "proposed"; authority: "operator_acceptance_required"; }
export interface AgentAskProposal { id: string; captureId: string; normalized: NormalizedAgentAsk; effects: AgentAskEffect[]; requiredDecisions: string[]; unchanged: string[]; conflicts: string[]; refused: string[]; managedDocumentTransition: { required: boolean; status: "withheld_until_acceptance"; authority: "checked_in_documents" }; queueConsequence: "none_until_accepted"; writes: { captureReceipt: true; proposalReceipt: true; projectChanges: false }; nonActions: string[]; fingerprint: string; createdAt: string; }

export const STRICT_FIELDS = new Set(["agent_ask", "request_id", "project", "intent", "desired_result", "rationale", "acceptance", "dependencies", "references", "actions", "options", "target_ref", "requested_authority", "candidate_revision", "evidence"]);
export const STRICT_OPTION_FIELDS = new Set(["label", "consequence", "recommended"]);
export const STRICT_ACTION_FIELDS = new Set(["id", "desired_result", "acceptance", "dependencies", "references", "target_ref"]);
export const STRICT_EVIDENCE_FIELDS = new Set(["criterion", "status", "note"]);
export const AGENT_ASK_EVIDENCE_STATUSES = ["met", "failed", "skipped"] as const;
export const CANDIDATE_REVISION_PATTERN = /^[0-9a-f]{7,40}$/i;
// An explicit id is the agent stating the handle operators will type into
// `advance queue reorder` and `depends_on`. It must look like every other
// plan-authored Action id, so it is validated here rather than at settlement.
export const ACTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ACTION_ID_MAX_LENGTH = 64;

export function normalizeAgentAsk(input: { request: string; requestId?: string; project?: string }): NormalizedAgentAsk {
  const request = input.request.trim();
  if (!request) throw validationError("Agent Ask desired result is required.");
  let parsed: unknown;
  try { parsed = parseYaml(request); } catch (error) {
    if (/^\s*agent_ask\s*:/m.test(request)) throw validationError("Agent Ask v1 contains invalid YAML.", { reason: error instanceof Error ? error.message : String(error) });
    parsed = null;
  }
  const strict = isRecord(parsed) && Object.hasOwn(parsed, "agent_ask");
  if (!strict) {
    const requestId = requiredText(input.requestId, "Natural Agent Ask requires --request-id.");
    return { version: "v1", format: "natural", requestId, project: input.project?.trim() || "unknown", intent: "auto", desiredResult: request, rationale: null, acceptance: [], dependencies: [], references: [], actions: [], targetRef: null, requestedAuthority: "propose", options: [], candidateRevision: null, evidence: [] };
  }
  const data = parsed as Record<string, unknown>;
  const unknown = Object.keys(data).filter((key) => !STRICT_FIELDS.has(key));
  if (unknown.length) throw validationError("Agent Ask v1 contains unknown fields.", { fields: unknown.sort() });
  if (data.agent_ask !== "v1") throw validationError("Agent Ask version must be v1.");
  const intent = requiredText(data.intent ?? "auto", "Agent Ask intent is required.") as AgentAskIntent;
  if (!AGENT_ASK_INTENTS.includes(intent)) throw validationError("Agent Ask intent is unsupported.", { intent, allowed: AGENT_ASK_INTENTS });
  const authority = requiredText(data.requested_authority ?? "propose", "Requested authority is required.") as AgentAskAuthority;
  if (!(["propose", "apply_if_approved"] as string[]).includes(authority)) throw validationError("Agent Ask cannot claim or expand execution authority.", { requestedAuthority: authority });
  const actions = actionList(data.actions);
  const targetRef = optionalText(data.target_ref);
  if (intent === "plan" && !targetRef && actions.length === 0) {
    throw validationError("A new Plan Agent Ask requires at least one governed Action.");
  }
  if (actions.length > 0 && !(["action", "plan"] as string[]).includes(intent)) {
    throw validationError("Agent Ask actions are only supported for action or plan intent.");
  }
  if (actions.length > 0 && targetRef && intent === "action") {
    throw validationError("A multi-Action Agent Ask cannot also amend one Action target_ref.");
  }
  const options = optionList(data.options);
  if (options.length > 0 && intent !== "decision") {
    throw validationError("Agent Ask options are only supported for decision intent.");
  }
  if (intent === "complete" && !targetRef) {
    throw validationError("A complete Agent Ask requires target_ref naming the Action.");
  }
  if (intent === "complete" && actions.length > 0) {
    throw validationError("A complete Agent Ask does not create or amend other Actions.");
  }
  const candidateRevision = optionalText(data.candidate_revision);
  if (candidateRevision !== null && intent !== "complete") {
    throw validationError("Agent Ask candidate_revision is only supported for complete intent.");
  }
  if (intent === "complete" && !candidateRevision) {
    throw validationError("A complete Agent Ask requires candidate_revision.");
  }
  if (candidateRevision !== null && !CANDIDATE_REVISION_PATTERN.test(candidateRevision)) {
    throw validationError("Agent Ask candidate_revision must be a git commit sha.", { candidateRevision });
  }
  const evidence = evidenceList(data.evidence);
  if (evidence.length > 0 && intent !== "complete") {
    throw validationError("Agent Ask evidence is only supported for complete intent.");
  }
  if (intent === "complete" && evidence.length === 0) {
    throw validationError("A complete Agent Ask requires at least one evidence entry.");
  }
  return { version: "v1", format: "strict", requestId: requiredText(data.request_id, "Agent Ask request_id is required."), project: optionalText(data.project) ?? "unknown", intent, desiredResult: requiredText(data.desired_result, "Agent Ask desired_result is required."), rationale: optionalText(data.rationale), acceptance: stringList(data.acceptance, "acceptance"), dependencies: stringList(data.dependencies, "dependencies"), references: stringList(data.references, "references"), actions, targetRef, requestedAuthority: authority, options, candidateRevision, evidence };
}

export function agentAskFingerprint(request: string, normalized: NormalizedAgentAsk): string { return createHash("sha256").update(JSON.stringify({ request, normalized })).digest("hex"); }
export function buildAgentAskEffects(normalized: NormalizedAgentAsk): { effects: AgentAskEffect[]; requiredDecisions: string[] } {
  const requiredDecisions: string[] = [];
  if (normalized.project === "unknown") requiredDecisions.push("Choose the destination Project.");
  if (normalized.intent === "auto") requiredDecisions.push("Confirm the proposed Arcadia structure after interpretation.");
  if (normalized.requestedAuthority === "apply_if_approved") requiredDecisions.push("Accept the exact preview before apply.");
  const targetKind = normalized.intent === "auto" ? "interpretation" : normalized.intent;
  const proposedItems = normalized.actions.length > 0 ? normalized.actions : [{ desiredResult: normalized.desiredResult, acceptance: normalized.acceptance, dependencies: normalized.dependencies, references: normalized.references, targetRef: null }];
  const effects = proposedItems.map((item) => {
    const itemTargetRef = item.targetRef ?? normalized.targetRef;
    const operation = normalized.intent === "auto" ? "interpret" : itemTargetRef || ["outcome", "project_update"].includes(normalized.intent) ? "update" : "create";
    const fields: Record<string, unknown> = { project: normalized.project, desiredResult: item.desiredResult, rationale: normalized.rationale, acceptance: item.acceptance, dependencies: item.dependencies, references: item.references };
    if (normalized.intent === "decision") { fields.status = "open"; fields.options = normalized.options; }
    return { operation, targetKind, targetRef: itemTargetRef, fields, status: "proposed", authority: "operator_acceptance_required" } satisfies AgentAskEffect;
  });
  return { effects, requiredDecisions };
}
export function stableProposalId(fingerprint: string): string { return `agentask_${fingerprint.slice(0, 18)}`; }
export function requiresManagedDocumentTransition(intent: AgentAskIntent): boolean { return ["outcome", "milestone", "plan", "decision", "action", "log", "project_update", "complete"].includes(intent); }
function requiredText(value: unknown, message: string): string { if (typeof value !== "string" || !value.trim()) throw validationError(message); return value.trim(); }
function optionalText(value: unknown): string | null { if (value === undefined || value === null) return null; if (typeof value !== "string") throw validationError("Agent Ask text fields must be strings."); return value.trim() || null; }
function stringList(value: unknown, field: string): string[] { if (value === undefined || value === null) return []; if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw validationError(`Agent Ask ${field} must be a list of non-empty strings.`); return value.map((item) => (item as string).trim()); }
function actionList(value: unknown): NormalizedAgentAskAction[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length === 0) throw validationError("Agent Ask actions must be a non-empty list.");
  return value.map((item, index) => {
    if (!isRecord(item)) throw validationError("Each Agent Ask action must be an object.", { index });
    const unknown = Object.keys(item).filter((key) => !STRICT_ACTION_FIELDS.has(key));
    if (unknown.length > 0) throw validationError("Agent Ask action contains unknown fields.", { index, fields: unknown.sort() });
    return {
      id: actionId(item.id, index),
      desiredResult: requiredText(item.desired_result, `Agent Ask actions[${index}].desired_result is required.`),
      acceptance: stringList(item.acceptance, `actions[${index}].acceptance`),
      dependencies: stringList(item.dependencies, `actions[${index}].dependencies`),
      references: stringList(item.references, `actions[${index}].references`),
      targetRef: optionalText(item.target_ref)
    };
  });
}
function optionList(value: unknown): NormalizedAgentAskOption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length === 0) throw validationError("Agent Ask options must be a non-empty list.");
  let recommendedCount = 0;
  const options = value.map((item, index) => {
    if (!isRecord(item)) throw validationError("Each Agent Ask option must be an object.", { index });
    const unknown = Object.keys(item).filter((key) => !STRICT_OPTION_FIELDS.has(key));
    if (unknown.length > 0) throw validationError("Agent Ask option contains unknown fields.", { index, fields: unknown.sort() });
    const recommended = item.recommended === undefined ? false : item.recommended;
    if (typeof recommended !== "boolean") throw validationError("Agent Ask options[].recommended must be true or false.", { index });
    if (recommended) recommendedCount += 1;
    return {
      label: requiredText(item.label, `Agent Ask options[${index}].label is required.`),
      consequence: requiredText(item.consequence, `Agent Ask options[${index}].consequence is required.`),
      recommended
    };
  });
  if (recommendedCount > 1) throw validationError("At most one Agent Ask option may be marked recommended.");
  return options;
}
function evidenceList(value: unknown): NormalizedAgentAskEvidence[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length === 0) throw validationError("Agent Ask evidence must be a non-empty list.");
  return value.map((item, index) => {
    if (!isRecord(item)) throw validationError("Each Agent Ask evidence entry must be an object.", { index });
    const unknown = Object.keys(item).filter((key) => !STRICT_EVIDENCE_FIELDS.has(key));
    if (unknown.length > 0) throw validationError("Agent Ask evidence entry contains unknown fields.", { index, fields: unknown.sort() });
    const status = requiredText(item.status, `Agent Ask evidence[${index}].status is required.`);
    if (!(AGENT_ASK_EVIDENCE_STATUSES as readonly string[]).includes(status)) {
      throw validationError("Agent Ask evidence status must be met, failed, or skipped.", { index, status });
    }
    return {
      criterion: requiredText(item.criterion, `Agent Ask evidence[${index}].criterion is required.`),
      status: status as AgentAskEvidenceStatus,
      note: optionalText(item.note)
    };
  });
}
function actionId(value: unknown, index: number): string | null {
  const id = optionalText(value);
  if (id === null) return null;
  if (!ACTION_ID_PATTERN.test(id) || id.length > ACTION_ID_MAX_LENGTH) {
    throw validationError("Agent Ask action id must be a lowercase hyphenated slug.", { index, id, maxLength: ACTION_ID_MAX_LENGTH });
  }
  return id;
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
