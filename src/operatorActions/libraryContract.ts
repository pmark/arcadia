import path from "node:path";
import { validatePlanActivationInput, validatePlanAmendmentInput, type PlanActivationInput, type PlanAmendmentInput } from "./planAmendmentContract.js";
import { validateWorkspaceConfigEditInput, workspaceConfigEditLauncher, type WorkspaceConfigEditInput } from "./workspaceConfigEditContract.js";

export interface OperatorScriptDescriptor {
  schema: "arcadia-operator-script-v1";
  id: string;
  /** Optional presentation and audit tag for a bounded authority Grant. */
  kind?: "grant";
  title: string;
  script: string;
  problem: string;
  desired_effect: string;
  authority: { does: string[]; never_does: string[] };
  success: { effect: string; next: string };
  failure: { effect: string; next: string };
  repeatable?: boolean;
  /**
   * When a Grant is repeatable, the instant (ISO 8601, UTC) after which its
   * script refuses. A Grant without one stays one-shot (Issue #1532).
   */
  expires_at?: string;
  /**
   * Optional sequencing hint for the /actions "Do this next" panel. Declares that
   * this action follows a succeeded run of `id` within `within_minutes`, that a
   * run of any `voided_by` action after that success voids it, and (optionally)
   * that it is only offered while production is inactive. Presentation only: it
   * never relaxes or adds an execution gate; the script still checks everything.
   */
  next_after?: NextAfter;
  planAmendment?: PlanAmendmentInput;
  /** A pinned one-shot activation of a draft Plan; it runs through the same shared runner. */
  planActivation?: PlanActivationInput;
  agentAsk?: { proposal: string; intent: string; targetRef: string | null };
  /** A pinned one-shot removal of one allowlisted workspace-config field; it runs only through the shared worker launcher. */
  workspaceConfigEdit?: WorkspaceConfigEditInput;
  /**
   * A pinned, rejection-only settlement scope: the script may settle exactly
   * these proposals, each only with disposition `rejected` (enforced at
   * settlement time by `assertOperatorSettlementContract`). A rejection writes
   * nothing about the work; it records the settlement and archives the Ask file.
   * `manifest` and `sha256` name the reviewed list the ids were taken from.
   */
  agentAskRejections?: AgentAskRejections;
  /**
   * The registered Project slug that publishes this entry. Required for an
   * entry in a Project's own library (it is how that library opts an entry in
   * to /actions); optional in Arcadia's library.
   */
  project?: string;
  /**
   * A pinned one-shot settlement of exactly the `agentAsk` it declares: the
   * Project, the proposal's full preview fingerprint, the settlement request
   * id, the disposition and the queue placement. It runs only through the
   * shared `pinnedAskSettlementLauncher`; the runner refuses a stale
   * fingerprint, another proposal and an Ask someone else already settled.
   */
  agentAskSettlement?: AgentAskSettlementPin;
}
export interface AgentAskSettlementPin {
  schema: "arcadia-agent-ask-settlement-v1";
  project: string;
  proposalFingerprint: string;
  requestId: string;
  disposition: "accepted" | "rejected";
  placement: "top" | null;
}
export interface AgentAskRejections {
  manifest: string;
  sha256: string;
  proposals: string[];
}
export interface NextAfter {
  id: string;
  within_minutes: number;
  voided_by?: string[];
  when_production?: "inactive";
}
export class OperatorScriptContractError extends Error {
  readonly next = "Use the shared Plan-amendment descriptor and canonical launcher, then run pnpm check:operator-scripts before publishing.";
  constructor(public reason: string, message: string) { super(message); }
}
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const list = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const intents = ["auto", "outcome", "milestone", "plan", "action", "decision", "artifact", "log", "proposal", "project_update", "complete", "split"];
const fail = (reason: string, message: string): never => { throw new OperatorScriptContractError(reason, message); };
const MAX_DECLARED_REJECTIONS = 500;

function validateAgentAskRejections(value: unknown): void {
  const r = value as AgentAskRejections;
  const repoRelative = (v: unknown) => text(v) && !path.isAbsolute(v) && !v.split(/[\\/]/).includes("..") && v.endsWith(".json");
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).sort().join(",") !== "manifest,proposals,sha256" ||
      !repoRelative(r.manifest) || typeof r.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.sha256) ||
      !Array.isArray(r.proposals) || r.proposals.length === 0 || r.proposals.length > MAX_DECLARED_REJECTIONS ||
      !r.proposals.every((id) => typeof id === "string" && /^agentask_[0-9a-f]{8,64}$/.test(id)) ||
      new Set(r.proposals).size !== r.proposals.length) {
    fail("INVALID_OPERATOR_CONTRACT", `agentAskRejections needs exactly manifest (a repository-relative .json path), sha256 (64 lowercase hex) and 1 to ${MAX_DECLARED_REJECTIONS} distinct agentask_ proposal ids.`);
  }
}

/** Exact executable shape: no embedded settlement code or extra command can run. */
export function planAmendmentLauncher(id: string): string {
  if (!slug.test(id)) fail("INVALID_OPERATOR_CONTRACT", "Operator action id must be a lowercase slug.");
  return '#!/usr/bin/env bash\nset -euo pipefail\nlibrary_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nrepo="$(cd "$library_dir/../../.." && pwd)"\nexec mise exec -- node "$repo/scripts/run-plan-amendment.mjs" "$library_dir/' + id + '.json" "${1:-}"\n';
}

/**
 * Exact executable shape for a pinned Agent Ask settlement. It works from any
 * Project's library: it runs Arcadia's shared runner from Arcadia's checkout
 * (`ARCADIA_REPO`, defaulting to the same path the `arcadia` launcher uses),
 * and passes only this entry's own descriptor. No settlement logic lives here.
 */
export function pinnedAskSettlementLauncher(id: string): string {
  if (!slug.test(id)) fail("INVALID_OPERATOR_CONTRACT", "Operator action id must be a lowercase slug.");
  return '#!/usr/bin/env bash\nset -euo pipefail\nlibrary_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\narcadia_repo="${ARCADIA_REPO:-$HOME/Dev/MR/Arcadia/arcadia}"\ncd "$arcadia_repo"\nexec mise exec -- node --import tsx "$arcadia_repo/scripts/settle-pinned-ask.ts" "$library_dir/' + id + '.json" "${1:-}"\n';
}

const settlementPinKeys = ["disposition", "placement", "project", "proposalFingerprint", "requestId", "schema"];
function validateAgentAskSettlement(d: OperatorScriptDescriptor, id: string, script: string): void {
  const p = d.agentAskSettlement as AgentAskSettlementPin;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join(",") !== settlementPinKeys.join(",") ||
      p.schema !== "arcadia-agent-ask-settlement-v1" || !slug.test(p.project) || typeof p.proposalFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(p.proposalFingerprint) || !slug.test(p.requestId) ||
      (p.disposition !== "accepted" && p.disposition !== "rejected") || (p.placement !== null && p.placement !== "top") ||
      (p.disposition === "rejected" && p.placement !== null)) {
    fail("INVALID_AGENT_ASK_SETTLEMENT", "agentAskSettlement needs exactly schema arcadia-agent-ask-settlement-v1, a Project slug, the proposal's 64-hex preview fingerprint, a settlement requestId slug, disposition accepted or rejected, and placement null or \"top\" (null when rejected).");
  }
  if (d.agentAsk === undefined) fail("INVALID_AGENT_ASK_SETTLEMENT", "A pinned settlement must also declare its agentAsk proposal, intent and targetRef.");
  if (d.project !== p.project) fail("INVALID_AGENT_ASK_SETTLEMENT", "A pinned settlement must name the same project at the top level and in its pin.");
  if (p.requestId === d.agentAsk!.proposal) fail("INVALID_AGENT_ASK_SETTLEMENT", "The settlement requestId must differ from the proposal's request id.");
  // The runner passes no operator, so a complete-intent settlement would be recorded as deterministic proof.
  if (d.agentAsk!.intent === "complete") fail("INVALID_AGENT_ASK_SETTLEMENT", "A complete-intent Ask is settled by the agent that proves it, not by a pinned operator button.");
  if (d.repeatable === true || d.kind !== undefined || d.expires_at !== undefined || d.next_after !== undefined) {
    fail("INVALID_AGENT_ASK_SETTLEMENT", "A pinned settlement is one-shot: no repeatable, kind, expires_at or next_after.");
  }
  if (script.replace(/\r\n/g, "\n") !== pinnedAskSettlementLauncher(id)) {
    fail("AGENT_ASK_SETTLEMENT_RUNNER_REQUIRED", "Pinned Agent Ask settlement scripts must be exactly the shared launcher; bespoke commands are refused.");
  }
}

const nextAfterKeys = new Set(["id", "within_minutes", "voided_by", "when_production"]);
function validateNextAfter(value: unknown, id: string): void {
  const n = value as NextAfter;
  if (!n || typeof n !== "object" || Array.isArray(n) || Object.keys(n).some((key) => !nextAfterKeys.has(key)) ||
      !slug.test(n.id) || n.id === id || !Number.isInteger(n.within_minutes) || n.within_minutes < 1 || n.within_minutes > 1440 ||
      (n.voided_by !== undefined && (!Array.isArray(n.voided_by) || !n.voided_by.every((entry) => slug.test(entry) && entry !== id && entry !== n.id) ||
        new Set(n.voided_by).size !== n.voided_by.length)) ||
      (n.when_production !== undefined && n.when_production !== "inactive")) {
    fail("INVALID_OPERATOR_CONTRACT", "next_after needs a different prerequisite id, whole within_minutes from 1 to 1440, distinct voided_by ids other than this action and its prerequisite, and when_production \"inactive\" if set.");
  }
}

/** A UTC ISO 8601 instant, e.g. 2026-10-25T00:00:00Z or 2026-10-02T18:45:00.000Z. */
const isIsoInstant = (v: unknown): boolean => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * The extra rule for an entry in a registered Project's own library (not Arcadia's). It is published only
 * when it names that Project. It may not use a runner whose launcher resolves `$library_dir/../../..`
 * (Plan amendment, Plan activation, workspace-config edit): in a Project checkout that would run the
 * Project's file of the same name instead of Arcadia's governed runner. Its `next_after` would name
 * another library's ids. It may settle an Agent Ask only through the pinned `agentAskSettlement`, whose
 * runner binds the Ask to this Project: a plain `agentAsk` scope or an `agentAskRejections` list names
 * request ids only, so it could settle another Project's Asks under this Project's badge.
 * Call it on the raw descriptor before full validation.
 */
export function assertProjectLibraryEntry(value: unknown, project: string): void {
  const d = (value && typeof value === "object" ? value : {}) as Partial<OperatorScriptDescriptor>;
  if (d.project !== project) fail("UNPUBLISHED_PROJECT_ENTRY", `This entry does not declare project "${project}", so it is not published to /actions.`);
  if (d.planAmendment !== undefined || d.planActivation !== undefined || d.workspaceConfigEdit !== undefined || d.next_after !== undefined) {
    fail("UNSUPPORTED_PROJECT_ENTRY", "A Project library entry cannot use planAmendment, planActivation, workspaceConfigEdit or next_after; those runners and hints exist only in Arcadia's library.");
  }
  if (d.agentAskRejections !== undefined || (d.agentAsk !== undefined && d.agentAskSettlement === undefined)) {
    fail("UNSUPPORTED_PROJECT_ENTRY", "A Project library entry settles an Agent Ask only through a pinned agentAskSettlement (arcadia operator-action settle-ask); a plain agentAsk scope or agentAskRejections is refused there.");
  }
}

/** Read-only contract shared by /runs and the library-wide CI gate. */
export function validateOperatorScriptContract(value: unknown, id: string, script: string): OperatorScriptDescriptor {
  if (!value || typeof value !== "object") fail("INVALID_OPERATOR_CONTRACT", "Operator descriptor must be an object.");
  const d = value as OperatorScriptDescriptor;
  if (!slug.test(id) || d.schema !== "arcadia-operator-script-v1" || d.id !== id || d.script !== `${id}.sh` ||
      ![d.title, d.problem, d.desired_effect, d.success?.effect, d.success?.next, d.failure?.effect, d.failure?.next].every(text) ||
      !list(d.authority?.does) || !list(d.authority?.never_does) || (d.repeatable !== undefined && typeof d.repeatable !== "boolean") ||
      (d.kind !== undefined && d.kind !== "grant") || (d.expires_at !== undefined && !isIsoInstant(d.expires_at)) ||
      (d.kind === "grant" && d.repeatable === true && d.expires_at === undefined)) {
    fail("INVALID_OPERATOR_CONTRACT", "Operator descriptor is incomplete or does not match its library entry.");
  }
  if (d.next_after !== undefined) validateNextAfter(d.next_after, id);
  if (d.project !== undefined && (typeof d.project !== "string" || !slug.test(d.project))) {
    fail("INVALID_OPERATOR_CONTRACT", "project must be a registered Project slug.");
  }
  if (d.agentAskSettlement === undefined && script.includes("settle-pinned-ask")) {
    fail("AGENT_ASK_SETTLEMENT_RUNNER_REQUIRED", "The shared Agent Ask settlement runner requires a pinned agentAskSettlement descriptor.");
  }
  if (d.agentAskSettlement !== undefined && (d.workspaceConfigEdit !== undefined || d.agentAskRejections !== undefined ||
      d.planAmendment !== undefined || d.planActivation !== undefined)) {
    fail("INVALID_AGENT_ASK_SETTLEMENT", "A pinned Agent Ask settlement cannot be combined with another settlement or edit scope.");
  }
  if (d.agentAskSettlement !== undefined && d.agentAsk === undefined) {
    fail("INVALID_AGENT_ASK_SETTLEMENT", "A pinned settlement must also declare its agentAsk proposal, intent and targetRef.");
  }
  if (d.workspaceConfigEdit !== undefined) {
    if (d.planAmendment !== undefined || d.planActivation !== undefined || d.agentAsk !== undefined || d.agentAskRejections !== undefined) {
      fail("INVALID_OPERATOR_CONTRACT", "A workspace-config edit cannot be combined with a settlement scope.");
    }
    try { validateWorkspaceConfigEditInput(d.workspaceConfigEdit); }
    catch (error) { fail("INVALID_WORKSPACE_CONFIG_EDIT", error instanceof Error ? error.message : String(error)); }
    if (d.repeatable === true || d.kind !== undefined) fail("INVALID_WORKSPACE_CONFIG_EDIT", "A workspace-config edit is one-shot and is not a grant.");
    if (script.replace(/\r\n/g, "\n") !== workspaceConfigEditLauncher(id)) {
      fail("WORKSPACE_CONFIG_EDIT_RUNNER_REQUIRED", "Workspace-config edit scripts must be exactly the shared worker launcher; bespoke commands are refused.");
    }
    return d;
  }
  if (script.includes("workspace-config-edit-worker") || script.includes("runWorkspaceConfigEdit")) {
    fail("WORKSPACE_CONFIG_EDIT_RUNNER_REQUIRED", "The workspace-config worker requires a pinned workspaceConfigEdit descriptor.");
  }
  if (d.agentAskRejections !== undefined) {
    if (d.planAmendment !== undefined || d.planActivation !== undefined || d.agentAsk !== undefined) {
      fail("INVALID_OPERATOR_CONTRACT", "A rejection-only scope cannot be combined with agentAsk, planAmendment or planActivation.");
    }
    validateAgentAskRejections(d.agentAskRejections);
    if (d.repeatable === true) fail("INVALID_OPERATOR_CONTRACT", "A pinned rejection scope must be one-shot.");
    if (script.includes("run-plan-amendment") || script.includes("plan-amendment-worker") || script.includes("withinPlanAmendmentRunner")) {
      fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "The shared runner requires a pinned planAmendment or planActivation descriptor.");
    }
    return d;
  }
  if (d.planAmendment !== undefined || d.planActivation !== undefined) {
    if (d.agentAsk !== undefined) fail("INVALID_OPERATOR_CONTRACT", "Plan amendments use planAmendment or planActivation, not a second Agent Ask declaration.");
    if (d.planAmendment !== undefined && d.planActivation !== undefined) fail("INVALID_OPERATOR_CONTRACT", "Pin exactly one of planAmendment or planActivation.");
    try { if (d.planActivation !== undefined) validatePlanActivationInput(d.planActivation); else validatePlanAmendmentInput(d.planAmendment!); }
    catch (error) { fail("INVALID_PLAN_AMENDMENT", error instanceof Error ? error.message : String(error)); }
    if (d.repeatable === true) fail("INVALID_PLAN_AMENDMENT", "A Plan-amendment or activation approval must be one-shot.");
    if (script.replace(/\r\n/g, "\n") !== planAmendmentLauncher(id)) {
      fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "Plan-amendment scripts must be exactly the shared runner launcher; bespoke commands are refused.");
    }
  } else {
    if (script.includes("run-plan-amendment") || script.includes("plan-amendment-worker") || script.includes("withinPlanAmendmentRunner")) {
      fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "The shared runner requires a pinned planAmendment or planActivation descriptor.");
    }
    if (d.agentAsk !== undefined) {
      const a = d.agentAsk;
      if (!a || Object.keys(a).sort().join(",") !== "intent,proposal,targetRef" || !slug.test(a.proposal) || !intents.includes(a.intent) ||
          !(a.targetRef === null || text(a.targetRef))) fail("INVALID_OPERATOR_CONTRACT", "Agent Ask declaration needs the exact proposal, intent and targetRef.");
      if (a.intent === "plan" && a.targetRef !== null) fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "Existing-Plan amendments require planAmendment (or planActivation) and the shared runner.");
      if (d.agentAskSettlement !== undefined) validateAgentAskSettlement(d, id, script);
    } else if (/agent[-_]ask|runAgentAskSettleCommand|settleAgentAsk/.test(script)) {
      fail("UNDECLARED_OPERATOR_SETTLEMENT", "Agent Ask operator scripts must declare their proposal, intent and targetRef; Plan amendments must use the shared runner.");
    }
  }
  return d;
}
