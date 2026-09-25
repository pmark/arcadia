import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { validationError } from "../cli/errors.js";

export const AGENT_ASK_INTENTS = ["auto", "outcome", "milestone", "plan", "proposal", "decision", "action", "artifact", "log", "project_update", "complete", "split"] as const;
export type AgentAskIntent = (typeof AGENT_ASK_INTENTS)[number];
export type AgentAskAuthority = "propose" | "apply_if_approved";
export const AGENT_ASK_AUTHORITIES = ["propose", "apply_if_approved"] as const;
/**
 * Which Constitution gate question the filer judges fires for a `decision`
 * Ask (CONSTITUTION.md's Authority section, first two of its three
 * questions): could a reasonable person choose differently
 * (`reasonable_disagreement`), or does the move resist reversal or reach
 * outside the work at hand (`resists_reversal`). Settlement refuses to open a
 * Decision when this is omitted and the request names no approval boundary —
 * see `resolveDecisionGateQuestion` in `../ask/settlement.js`.
 */
export const AGENT_ASK_GATE_QUESTIONS = ["reasonable_disagreement", "resists_reversal"] as const;
export type AgentAskGateQuestion = (typeof AGENT_ASK_GATE_QUESTIONS)[number];
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
export interface NormalizedAgentAsk { version: "v1"; format: "strict" | "natural"; requestId: string; project: string; intent: AgentAskIntent; desiredResult: string; rationale: string | null; acceptance: string[]; dependencies: string[]; references: string[]; actions: NormalizedAgentAskAction[]; targetRef: string | null; requestedAuthority: AgentAskAuthority; options: NormalizedAgentAskOption[]; candidateRevision: string | null; evidence: NormalizedAgentAskEvidence[]; gateQuestion: AgentAskGateQuestion | null; }
export interface AgentAskEffect { operation: "interpret" | "create" | "update"; targetKind: Exclude<AgentAskIntent, "auto"> | "interpretation"; targetRef: string | null; fields: Record<string, unknown>; status: "proposed"; authority: "operator_acceptance_required"; }
export interface AgentAskProposal { id: string; captureId: string; normalized: NormalizedAgentAsk; effects: AgentAskEffect[]; requiredDecisions: string[]; unchanged: string[]; conflicts: string[]; refused: string[]; managedDocumentTransition: { required: boolean; status: "withheld_until_acceptance"; authority: "checked_in_documents" }; queueConsequence: "none_until_accepted"; writes: { captureReceipt: true; proposalReceipt: true; projectChanges: false }; nonActions: string[]; fingerprint: string; createdAt: string;
  /**
   * The absolute path this Ask was read from via `--file`, when known. A
   * terminal settlement uses this to archive the source `.arcadia/asks/`
   * file automatically — see `settleAgentAsk`'s archive step. Never set for
   * an Ask supplied as inline text, and settlement only acts on it when it
   * resolves inside the settling repository's own `.arcadia/asks/` directory.
   */
  sourcePath: string | null;
}

export const STRICT_FIELDS = new Set(["agent_ask", "request_id", "project", "intent", "desired_result", "rationale", "acceptance", "dependencies", "references", "actions", "options", "target_ref", "requested_authority", "candidate_revision", "evidence", "gate_question"]);
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
    return { version: "v1", format: "natural", requestId, project: input.project?.trim() || "unknown", intent: "auto", desiredResult: request, rationale: null, acceptance: [], dependencies: [], references: [], actions: [], targetRef: null, requestedAuthority: "propose", options: [], candidateRevision: null, evidence: [], gateQuestion: null };
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
  const rawTargetRef = optionalText(data.target_ref);
  const targetRef = intent === "project_update" ? rawTargetRef?.toLowerCase() ?? null : rawTargetRef;
  if (intent === "plan" && !targetRef && actions.length === 0) {
    throw validationError("A new Plan Agent Ask requires at least one governed Action.");
  }
  if (actions.length > 0 && !(["action", "plan", "split"] as string[]).includes(intent)) {
    throw validationError("Agent Ask actions are only supported for action, plan, or split intent.");
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
  if (intent === "split" && !targetRef) {
    throw validationError("A split Agent Ask requires target_ref naming the Action to narrow.");
  }
  if (intent === "split" && actions.length === 0) {
    throw validationError("A split Agent Ask requires at least one remainder Action for the unfinished work.");
  }
  if (intent === "split" && actions.some((action) => action.targetRef !== null)) {
    throw validationError("A split Agent Ask's remainder Actions must be new; none may carry target_ref.");
  }
  const candidateRevision = optionalText(data.candidate_revision);
  if (candidateRevision !== null && !(["complete", "split"] as string[]).includes(intent)) {
    throw validationError("Agent Ask candidate_revision is only supported for complete or split intent.");
  }
  if ((intent === "complete" || intent === "split") && !candidateRevision) {
    throw validationError(`A ${intent} Agent Ask requires candidate_revision.`);
  }
  if (candidateRevision !== null && !CANDIDATE_REVISION_PATTERN.test(candidateRevision)) {
    throw validationError("Agent Ask candidate_revision must be a git commit sha.", { candidateRevision });
  }
  const evidence = evidenceList(data.evidence);
  if (evidence.length > 0 && !(["complete", "split"] as string[]).includes(intent)) {
    throw validationError("Agent Ask evidence is only supported for complete or split intent.");
  }
  if ((intent === "complete" || intent === "split") && evidence.length === 0) {
    throw validationError(`A ${intent} Agent Ask requires at least one evidence entry.`);
  }
  const acceptance = stringList(data.acceptance, "acceptance");
  if (intent === "split" && acceptance.length === 0) {
    throw validationError("A split Agent Ask requires acceptance naming the narrowed criteria the finished slice actually met.");
  }
  const gateQuestion = optionalText(data.gate_question);
  if (gateQuestion !== null && intent !== "decision") {
    throw validationError("Agent Ask gate_question is only supported for decision intent.");
  }
  if (gateQuestion !== null && !(AGENT_ASK_GATE_QUESTIONS as readonly string[]).includes(gateQuestion)) {
    throw validationError("Agent Ask gate_question must be reasonable_disagreement or resists_reversal.", { gateQuestion, allowed: AGENT_ASK_GATE_QUESTIONS });
  }
  return { version: "v1", format: "strict", requestId: requiredText(data.request_id, "Agent Ask request_id is required."), project: optionalText(data.project) ?? "unknown", intent, desiredResult: requiredText(data.desired_result, "Agent Ask desired_result is required."), rationale: optionalText(data.rationale), acceptance, dependencies: stringList(data.dependencies, "dependencies"), references: stringList(data.references, "references"), actions, targetRef, requestedAuthority: authority, options, candidateRevision, evidence, gateQuestion: gateQuestion as AgentAskGateQuestion | null };
}

export function agentAskFingerprint(request: string, normalized: NormalizedAgentAsk): string { return createHash("sha256").update(JSON.stringify({ request, normalized })).digest("hex"); }
/** The Project fields a `project_update` Ask can actually apply. */
const PROJECT_UPDATE_TARGETS = new Set(["outcome", "milestone"]);

/** One existing checked-in Plan, Action, or Decision a natural Ask's free text can resolve against. */
export interface AgentAskTargetCandidate { kind: "plan" | "action" | "decision"; targetRef: string; label: string; }
/** The Plan slugs, Action ids, and Decision ids already present in the destination Project's checked-in documents. */
export interface AgentAskTargetContext {
  plans: Array<{ slug: string }>;
  actions: Array<{ id: string; planSlug: string }>;
  decisions: Array<{ id: string; slug: string }>;
}
export interface AgentAskTargetResolution { resolved: AgentAskTargetCandidate | null; considered: AgentAskTargetCandidate[]; }

/**
 * Resolve a natural Ask's free text against identifiers the repository
 * already has, deterministically and with zero model calls. Only an exact
 * identifier — a Plan slug, an Action id, or a Decision id/slug — already
 * present in a checked-in document counts; nothing is inferred.
 *
 * An Action is the most specific target, so a matched Action wins over a
 * merely co-mentioned Plan or Decision. A Plan reference that names a
 * *different* Plan than the matched Action's own is a genuine conflict, not
 * extra context, and refuses resolution rather than guessing which one the
 * author meant. The same rule applies one level down: more than one distinct
 * Plan or more than one distinct Decision reference is ambiguous.
 *
 * A Plan slug or Action id only counts as a candidate when it is a
 * multi-segment hyphenated slug (every real one in this repository is —
 * `build-guided-understanding-session`, `reject-malformed-rows`). A
 * single bare word is indistinguishable from ordinary prose (an Action
 * literally id'd `existing` would match "Review the existing process"),
 * so it never participates in resolution and the interpretation path is
 * kept instead.
 */
export function resolveNaturalAgentAskTarget(text: string, context: AgentAskTargetContext): AgentAskTargetResolution {
  const mentions = (identifier: string): boolean => {
    if (!identifier) return false;
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A numeric Decision id must reject adjacent letters too, not just
    // adjacent digits — otherwise "x0001" would match Decision 0001.
    const boundary = /^[0-9]+$/.test(identifier) ? "[a-z0-9]" : "[a-z0-9-]";
    return new RegExp(`(?<!${boundary})${escaped}(?!${boundary})`, "i").test(text);
  };
  const actionMatches: AgentAskTargetCandidate[] = context.actions
    .filter((action) => action.id.includes("-") && mentions(action.id))
    .map((action) => ({ kind: "action", targetRef: `plan/${action.planSlug}#${action.id}`, label: `Action ${action.id} in Plan ${action.planSlug}` }));
  const planMatches: AgentAskTargetCandidate[] = context.plans
    .filter((plan) => plan.slug.includes("-") && mentions(plan.slug))
    .map((plan) => ({ kind: "plan", targetRef: `plan/${plan.slug}`, label: `Plan ${plan.slug}` }));
  const decisionMatches: AgentAskTargetCandidate[] = context.decisions
    .filter((decision) => mentions(decision.id) || mentions(decision.slug))
    .map((decision) => ({ kind: "decision", targetRef: decision.id, label: `Decision ${decision.id} (${decision.slug})` }));
  const considered = [...actionMatches, ...planMatches, ...decisionMatches];

  if (actionMatches.length === 1) {
    const resolvedAction = actionMatches[0];
    const actionPlanRef = resolvedAction.targetRef.slice(0, resolvedAction.targetRef.indexOf("#"));
    const conflictingPlans = planMatches.filter((candidatePlan) => candidatePlan.targetRef !== actionPlanRef);
    if (conflictingPlans.length > 0) return { resolved: null, considered };
    return { resolved: resolvedAction, considered };
  }
  if (actionMatches.length === 0 && planMatches.length === 1) return { resolved: planMatches[0], considered };
  if (actionMatches.length === 0 && planMatches.length === 0 && decisionMatches.length === 1) return { resolved: decisionMatches[0], considered };
  return { resolved: null, considered };
}

export function buildAgentAskEffects(normalized: NormalizedAgentAsk, resolution?: AgentAskTargetResolution | null): { effects: AgentAskEffect[]; requiredDecisions: string[] } {
  const requiredDecisions: string[] = [];
  // A `project_update` naming a field with no apply path used to settle into an
  // open Decision: "How should this Project update be applied: ...". Nothing
  // could act on it. Approving it recorded an answer and changed no Project
  // field, because no code maps an arbitrary field name to a write, so the
  // question sat open indefinitely (R183 / Decision 0046, Issue #351).
  // Refusing here — during preview, before anything is written — costs the
  // author one corrected Ask and names the fields that do work.
  if (normalized.intent === "project_update") {
    const requested = (normalized.targetRef ?? "").trim();
    if (!PROJECT_UPDATE_TARGETS.has(requested)) {
      throw validationError(
        "Agent Ask project_update names a Project field Arcadia has no apply path for, so settling it could not change anything.",
        {
          targetRef: normalized.targetRef ?? null,
          supported: [...PROJECT_UPDATE_TARGETS],
          remedy: "Use target_ref: outcome or milestone, or choose the intent that owns the field — `action` or `plan` for Plan work, `decision` to ask the operator a question."
        }
      );
    }
  }
  if (normalized.project === "unknown") requiredDecisions.push("Choose the destination Project.");
  const resolved = normalized.intent === "auto" ? (resolution?.resolved ?? null) : null;
  if (normalized.intent === "auto") {
    requiredDecisions.push(resolved
      ? `Confirm the proposed effect against ${resolved.label} before it changes anything.`
      : "Confirm the proposed Arcadia structure after interpretation.");
  }
  if (normalized.requestedAuthority === "apply_if_approved") requiredDecisions.push("Accept the exact preview before apply.");
  const targetKind = normalized.intent === "auto" ? (resolved?.kind ?? "interpretation") : normalized.intent;
  const proposedItems = normalized.actions.length > 0 ? normalized.actions : [{ desiredResult: normalized.desiredResult, acceptance: normalized.acceptance, dependencies: normalized.dependencies, references: normalized.references, targetRef: null }];
  const effects = proposedItems.map((item) => {
    const itemTargetRef = resolved ? resolved.targetRef : (item.targetRef ?? normalized.targetRef);
    const operation = resolved ? "update" : normalized.intent === "auto" ? "interpret" : itemTargetRef || ["outcome", "project_update"].includes(normalized.intent) ? "update" : "create";
    const fields: Record<string, unknown> = { project: normalized.project, desiredResult: item.desiredResult, rationale: normalized.rationale, acceptance: item.acceptance, dependencies: item.dependencies, references: item.references };
    if (normalized.intent === "decision") { fields.status = "open"; fields.options = normalized.options; }
    if (resolved) { fields.resolvedIdentifier = resolved.targetRef; fields.resolvedLabel = resolved.label; }
    return { operation, targetKind, targetRef: itemTargetRef, fields, status: "proposed", authority: "operator_acceptance_required" } satisfies AgentAskEffect;
  });
  return { effects, requiredDecisions };
}
export function stableProposalId(fingerprint: string): string { return `agentask_${fingerprint.slice(0, 18)}`; }
export function requiresManagedDocumentTransition(intent: AgentAskIntent): boolean { return ["outcome", "milestone", "plan", "decision", "action", "log", "project_update", "complete", "split"].includes(intent); }
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
