import path from "node:path";
import { validatePlanAmendmentInput, type PlanAmendmentInput } from "./planAmendmentContract.js";

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
   * Optional sequencing hint for the /actions "Do this next" panel. Declares that
   * this action follows a succeeded run of `id` within `within_minutes`, that a
   * run of any `voided_by` action after that success voids it, and (optionally)
   * that it is only offered while production is inactive. Presentation only: it
   * never relaxes or adds an execution gate; the script still checks everything.
   */
  next_after?: NextAfter;
  planAmendment?: PlanAmendmentInput;
  agentAsk?: { proposal: string; intent: string; targetRef: string | null };
  /**
   * A pinned, rejection-only settlement scope: the script may settle exactly
   * these proposals, each only with disposition `rejected` (enforced at
   * settlement time by `assertOperatorSettlementContract`). A rejection writes
   * nothing about the work; it records the settlement and archives the Ask file.
   * `manifest` and `sha256` name the reviewed list the ids were taken from.
   */
  agentAskRejections?: AgentAskRejections;
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

/** Read-only contract shared by /runs and the library-wide CI gate. */
export function validateOperatorScriptContract(value: unknown, id: string, script: string): OperatorScriptDescriptor {
  if (!value || typeof value !== "object") fail("INVALID_OPERATOR_CONTRACT", "Operator descriptor must be an object.");
  const d = value as OperatorScriptDescriptor;
  if (!slug.test(id) || d.schema !== "arcadia-operator-script-v1" || d.id !== id || d.script !== `${id}.sh` ||
      ![d.title, d.problem, d.desired_effect, d.success?.effect, d.success?.next, d.failure?.effect, d.failure?.next].every(text) ||
      !list(d.authority?.does) || !list(d.authority?.never_does) || (d.repeatable !== undefined && typeof d.repeatable !== "boolean") ||
      (d.kind !== undefined && d.kind !== "grant") || (d.kind === "grant" && d.repeatable === true)) {
    fail("INVALID_OPERATOR_CONTRACT", "Operator descriptor is incomplete or does not match its library entry.");
  }
  if (d.next_after !== undefined) validateNextAfter(d.next_after, id);
  if (d.agentAskRejections !== undefined) {
    if (d.planAmendment !== undefined || d.agentAsk !== undefined) {
      fail("INVALID_OPERATOR_CONTRACT", "A rejection-only scope cannot be combined with agentAsk or planAmendment.");
    }
    validateAgentAskRejections(d.agentAskRejections);
    if (d.repeatable === true) fail("INVALID_OPERATOR_CONTRACT", "A pinned rejection scope must be one-shot.");
    if (script.includes("run-plan-amendment") || script.includes("plan-amendment-worker") || script.includes("withinPlanAmendmentRunner")) {
      fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "The shared runner requires a pinned planAmendment descriptor.");
    }
    return d;
  }
  if (d.planAmendment !== undefined) {
    if (d.agentAsk !== undefined) fail("INVALID_OPERATOR_CONTRACT", "Plan amendments use planAmendment, not a second Agent Ask declaration.");
    try { validatePlanAmendmentInput(d.planAmendment); }
    catch (error) { fail("INVALID_PLAN_AMENDMENT", error instanceof Error ? error.message : String(error)); }
    if (d.repeatable === true) fail("INVALID_PLAN_AMENDMENT", "A Plan-amendment approval must be one-shot.");
    if (script.replace(/\r\n/g, "\n") !== planAmendmentLauncher(id)) {
      fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "Plan-amendment scripts must be exactly the shared runner launcher; bespoke commands are refused.");
    }
  } else {
    if (script.includes("run-plan-amendment") || script.includes("plan-amendment-worker") || script.includes("withinPlanAmendmentRunner")) {
      fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "The shared runner requires a pinned planAmendment descriptor.");
    }
    if (d.agentAsk !== undefined) {
      const a = d.agentAsk;
      if (!a || Object.keys(a).sort().join(",") !== "intent,proposal,targetRef" || !slug.test(a.proposal) || !intents.includes(a.intent) ||
          !(a.targetRef === null || text(a.targetRef))) fail("INVALID_OPERATOR_CONTRACT", "Agent Ask declaration needs the exact proposal, intent and targetRef.");
      if (a.intent === "plan" && a.targetRef !== null) fail("PLAN_AMENDMENT_RUNNER_REQUIRED", "Existing-Plan amendments require planAmendment and the shared runner.");
    } else if (/agent[-_]ask|runAgentAskSettleCommand|settleAgentAsk/.test(script)) {
      fail("UNDECLARED_OPERATOR_SETTLEMENT", "Agent Ask operator scripts must declare their proposal, intent and targetRef; Plan amendments must use the shared runner.");
    }
  }
  return d;
}
