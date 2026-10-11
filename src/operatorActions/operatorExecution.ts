import { readFileSync } from "node:fs";
import path from "node:path";
import type { NormalizedAgentAsk } from "../ask/agentAsk.js";
import { validationError } from "../cli/errors.js";
import { OperatorScriptContractError, validateOperatorScriptContract } from "./libraryContract.js";

let activeRunnerDescriptor: string | null = null;
/** Synchronous, in-process scope: a CLI flag or inherited environment cannot claim this. */
export function withinPlanAmendmentRunner<T>(descriptorPath: string, run: () => T): T {
  const previous = activeRunnerDescriptor;
  activeRunnerDescriptor = path.resolve(descriptorPath);
  try { return run(); } finally { activeRunnerDescriptor = previous; }
}

/** Called before previews, applies and replay returns in the canonical settlement path. */
export function assertOperatorSettlementContract(
  ask: NormalizedAgentAsk,
  settlement: { proposalId: string; disposition: string } | null = null
): void {
  const id = process.env.ARCADIA_OPERATOR_SCRIPT_ID;
  const descriptorPath = process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR;
  if (id === undefined && descriptorPath === undefined) return; // Ordinary manual/candidate CLI authority is unchanged.
  const next = "Prepare this operator action with the shared runner and pinned descriptor; do not clear its execution context or substitute a proposal.";
  const refuse = (reason: string, message: string): never => { throw validationError(message, { reason, next }); };
  if (!id || !descriptorPath) return refuse("INVALID_OPERATOR_CONTEXT", "Operator execution context is incomplete.");
  const file = path.resolve(descriptorPath);
  if (path.basename(file) !== `${id}.json`) refuse("INVALID_OPERATOR_CONTEXT", "Operator execution context does not match its descriptor.");
  let descriptor: ReturnType<typeof validateOperatorScriptContract>;
  try {
    descriptor = validateOperatorScriptContract(JSON.parse(readFileSync(file, "utf8")), id,
      readFileSync(path.join(path.dirname(file), `${id}.sh`), "utf8"));
  } catch (error) {
    return refuse(error instanceof OperatorScriptContractError ? error.reason : "INVALID_OPERATOR_CONTEXT",
      error instanceof Error ? error.message : String(error));
  }
  if (descriptor.agentAskRejections) {
    // Rejection-only scope: exactly the pinned proposals, each only rejected. Checked before the
    // intent branches, so a pinned Plan-amendment Ask may be rejected but never accepted here.
    if (!settlement || settlement.disposition !== "rejected" || !descriptor.agentAskRejections.proposals.includes(settlement.proposalId)) {
      refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", "This operator action may only reject the proposals its descriptor pins.");
    }
    return;
  }
  if (ask.intent === "plan" && ask.targetRef !== null) {
    if (activeRunnerDescriptor !== file || !descriptor.planAmendment) {
      return refuse("PLAN_AMENDMENT_RUNNER_REQUIRED", "Operator-script Plan amendments must settle through the shared runner.");
    }
    const input = descriptor.planAmendment;
    if (ask.requestId !== input.ask.proposal || ask.project !== input.envelope.project || ask.targetRef !== `plan/${input.envelope.plan}`) {
      refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", "The actual Plan amendment differs from the pinned operator action.");
    }
  } else {
    const declared = descriptor.agentAsk;
    if (!declared || ask.requestId !== declared.proposal || ask.intent !== declared.intent || ask.targetRef !== declared.targetRef) {
      refuse("OPERATOR_SETTLEMENT_SCOPE_MISMATCH", "The actual Agent Ask differs from the operator descriptor's declared scope.");
    }
  }
}
