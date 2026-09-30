import { validatePlanAmendmentInput, type PlanAmendmentInput } from "./planAmendmentContract.js";

export interface OperatorScriptDescriptor {
  schema: "arcadia-operator-script-v1";
  id: string;
  title: string;
  script: string;
  problem: string;
  desired_effect: string;
  authority: { does: string[]; never_does: string[] };
  success: { effect: string; next: string };
  failure: { effect: string; next: string };
  repeatable?: boolean;
  planAmendment?: PlanAmendmentInput;
  agentAsk?: { proposal: string; intent: string; targetRef: string | null };
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

/** Exact executable shape: no embedded settlement code or extra command can run. */
export function planAmendmentLauncher(id: string): string {
  if (!slug.test(id)) fail("INVALID_OPERATOR_CONTRACT", "Operator action id must be a lowercase slug.");
  return '#!/usr/bin/env bash\nset -euo pipefail\nlibrary_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"\nrepo="$(cd "$library_dir/../../.." && pwd)"\nexec mise exec -- node "$repo/scripts/run-plan-amendment.mjs" "$library_dir/' + id + '.json" "${1:-}"\n';
}

/** Read-only contract shared by /runs and the library-wide CI gate. */
export function validateOperatorScriptContract(value: unknown, id: string, script: string): OperatorScriptDescriptor {
  if (!value || typeof value !== "object") fail("INVALID_OPERATOR_CONTRACT", "Operator descriptor must be an object.");
  const d = value as OperatorScriptDescriptor;
  if (!slug.test(id) || d.schema !== "arcadia-operator-script-v1" || d.id !== id || d.script !== `${id}.sh` ||
      ![d.title, d.problem, d.desired_effect, d.success?.effect, d.success?.next, d.failure?.effect, d.failure?.next].every(text) ||
      !list(d.authority?.does) || !list(d.authority?.never_does) || (d.repeatable !== undefined && typeof d.repeatable !== "boolean")) {
    fail("INVALID_OPERATOR_CONTRACT", "Operator descriptor is incomplete or does not match its library entry.");
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
