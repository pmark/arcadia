import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";

export const AGENT_ASK_INTENTS = ["auto", "outcome", "milestone", "plan", "proposal", "decision", "action", "artifact", "log", "project_update"] as const;
export type AgentAskIntent = (typeof AGENT_ASK_INTENTS)[number];
export type AgentAskAuthority = "propose" | "apply_if_approved";
export interface NormalizedAgentAsk { version: "v1"; format: "strict" | "natural"; requestId: string; project: string; intent: AgentAskIntent; desiredResult: string; rationale: string | null; acceptance: string[]; dependencies: string[]; targetRef: string | null; requestedAuthority: AgentAskAuthority; }
export interface AgentAskEffect { operation: "interpret" | "create" | "update"; targetKind: Exclude<AgentAskIntent, "auto"> | "interpretation"; targetRef: string | null; fields: Record<string, unknown>; status: "proposed"; authority: "operator_acceptance_required"; }
export interface AgentAskProposal { id: string; captureId: string; normalized: NormalizedAgentAsk; effects: AgentAskEffect[]; requiredDecisions: string[]; unchanged: string[]; conflicts: string[]; refused: string[]; managedDocumentTransition: { required: boolean; status: "withheld_until_acceptance"; authority: "checked_in_documents" }; queueConsequence: "none_until_accepted"; writes: { captureReceipt: true; proposalReceipt: true; projectChanges: false }; nonActions: string[]; fingerprint: string; createdAt: string; }

const STRICT_FIELDS = new Set(["agent_ask", "request_id", "project", "intent", "desired_result", "rationale", "acceptance", "dependencies", "target_ref", "requested_authority"]);

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
    return { version: "v1", format: "natural", requestId, project: input.project?.trim() || "unknown", intent: "auto", desiredResult: request, rationale: null, acceptance: [], dependencies: [], targetRef: null, requestedAuthority: "propose" };
  }
  const data = parsed as Record<string, unknown>;
  const unknown = Object.keys(data).filter((key) => !STRICT_FIELDS.has(key));
  if (unknown.length) throw validationError("Agent Ask v1 contains unknown fields.", { fields: unknown.sort() });
  if (data.agent_ask !== "v1") throw validationError("Agent Ask version must be v1.");
  const intent = requiredText(data.intent ?? "auto", "Agent Ask intent is required.") as AgentAskIntent;
  if (!AGENT_ASK_INTENTS.includes(intent)) throw validationError("Agent Ask intent is unsupported.", { intent, allowed: AGENT_ASK_INTENTS });
  const authority = requiredText(data.requested_authority ?? "propose", "Requested authority is required.") as AgentAskAuthority;
  if (!(["propose", "apply_if_approved"] as string[]).includes(authority)) throw validationError("Agent Ask cannot claim or expand execution authority.", { requestedAuthority: authority });
  return { version: "v1", format: "strict", requestId: requiredText(data.request_id, "Agent Ask request_id is required."), project: optionalText(data.project) ?? "unknown", intent, desiredResult: requiredText(data.desired_result, "Agent Ask desired_result is required."), rationale: optionalText(data.rationale), acceptance: stringList(data.acceptance, "acceptance"), dependencies: stringList(data.dependencies, "dependencies"), targetRef: optionalText(data.target_ref), requestedAuthority: authority };
}

export function agentAskFingerprint(request: string, normalized: NormalizedAgentAsk): string { return createHash("sha256").update(JSON.stringify({ request, normalized })).digest("hex"); }
export function buildAgentAskEffects(normalized: NormalizedAgentAsk): { effects: AgentAskEffect[]; requiredDecisions: string[] } {
  const requiredDecisions: string[] = [];
  if (normalized.project === "unknown") requiredDecisions.push("Choose the destination Project.");
  if (normalized.intent === "auto") requiredDecisions.push("Confirm the proposed Arcadia structure after interpretation.");
  if (normalized.requestedAuthority === "apply_if_approved") requiredDecisions.push("Accept the exact preview before apply.");
  const targetKind = normalized.intent === "auto" ? "interpretation" : normalized.intent;
  const operation = normalized.intent === "auto" ? "interpret" : normalized.targetRef || ["outcome", "project_update"].includes(normalized.intent) ? "update" : "create";
  const fields: Record<string, unknown> = { project: normalized.project, desiredResult: normalized.desiredResult, rationale: normalized.rationale, acceptance: normalized.acceptance, dependencies: normalized.dependencies };
  if (normalized.intent === "decision") fields.status = "open";
  return { effects: [{ operation, targetKind, targetRef: normalized.targetRef, fields, status: "proposed", authority: "operator_acceptance_required" }], requiredDecisions };
}
export function stableProposalId(fingerprint: string): string { return `agentask_${fingerprint.slice(0, 18)}`; }
export function requiresManagedDocumentTransition(intent: AgentAskIntent): boolean { return ["outcome", "milestone", "plan", "decision", "action", "log", "project_update"].includes(intent); }
function requiredText(value: unknown, message: string): string { if (typeof value !== "string" || !value.trim()) throw validationError(message); return value.trim(); }
function optionalText(value: unknown): string | null { if (value === undefined || value === null) return null; if (typeof value !== "string") throw validationError("Agent Ask text fields must be strings."); return value.trim() || null; }
function stringList(value: unknown, field: string): string[] { if (value === undefined || value === null) return []; if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw validationError(`Agent Ask ${field} must be a list of non-empty strings.`); return value.map((item) => (item as string).trim()); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
