import { mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ArcadiaError, normalizeError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import type { AgentAskProposal } from "../ask/agentAsk.js";
import type { AgentAskSettlementReceipt } from "../ask/settlement.js";
import { runAgentAskSettleCommand } from "../commands/agentAsk.js";
import { refuseInExperimentWorkspace } from "../workspace/experimentGuard.js";
import { validateOperatorScriptContract, type OperatorScriptDescriptor } from "./libraryContract.js";
import { withinPinnedAskSettlementRunner } from "./operatorExecution.js";
import { equal, hash, Refusal, refuse } from "./planAmendmentContract.js";
import { OPERATOR_LIBRARY_RELATIVE, projectLibraryStateDir } from "./projectLibraries.js";
import { claimRunnerLock } from "./runnerLock.js";

export const PINNED_ASK_SETTLEMENT_RECEIPT = "arcadia-agent-ask-settlement-receipt-v1";

export interface PinnedAskSettlementResult {
  schema: typeof PINNED_ASK_SETTLEMENT_RECEIPT;
  id: string;
  pid: number;
  status: "running" | "succeeded" | "failed";
  reason: string;
  message: string;
  next: string;
  runDirectory: string;
  descriptorSha256: string;
  settlement?: AgentAskSettlementReceipt;
}

function atomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, file);
}

/** Arcadia's own library, beside this module: the default home for run state of a Project's library. */
const ARCADIA_LIBRARY = path.resolve(import.meta.dirname, "../..", OPERATOR_LIBRARY_RELATIVE);
export function arcadiaOwnLibrary(): string { return ARCADIA_LIBRARY; }

/**
 * Run state never lands inside a Project checkout: the dashboard passes its
 * state directory; a terminal run of a Project entry uses the same default
 * the dashboard computes. Arcadia's own (git-ignored) library keeps its state
 * beside its entries, as every other runner does.
 */
export function pinnedSettlementStateDir(library: string, project: string, env: NodeJS.ProcessEnv = process.env): string {
  const declared = env.ARCADIA_OPERATOR_SCRIPT_STATE_DIR?.trim();
  if (declared) return path.resolve(declared);
  let arcadia: string | null = null;
  try { arcadia = realpathSync(ARCADIA_LIBRARY); } catch { /* Arcadia's library may not exist yet. */ }
  return arcadia !== null && realpathSync(library) === arcadia ? library : projectLibraryStateDir(ARCADIA_LIBRARY, project);
}

/**
 * Settle exactly the Agent Ask a descriptor pins, through the same canonical
 * settle path as `arcadia agent-ask settle` (preview, then apply that exact
 * fingerprint). Every decision lives here; the generated script only names its
 * descriptor. It refuses another Project's library, a missing or different
 * proposal, a stale fingerprint, and an Ask already settled by anyone else,
 * and replays its own earlier settlement instead of applying twice.
 */
export function runPinnedAskSettlement(descriptorPath: string, env: NodeJS.ProcessEnv = process.env): PinnedAskSettlementResult {
  const resolvedDescriptor = path.resolve(descriptorPath);
  const library = path.dirname(resolvedDescriptor);
  const id = path.basename(resolvedDescriptor, ".json");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error("Invalid operator action id.");
  let result: PinnedAskSettlementResult = {
    schema: PINNED_ASK_SETTLEMENT_RECEIPT, id, pid: process.pid, status: "running", reason: "STARTED",
    message: "Validating the pinned settlement.", next: "Wait for the durable result.", runDirectory: "", descriptorSha256: ""
  };
  let runDirectory = "";
  let latest = "";
  let lock = "";
  let locked = false;
  const save = () => {
    if (runDirectory) atomic(path.join(runDirectory, "receipt.json"), result);
    if (locked) atomic(latest, result);
  };
  try {
    const descriptorBytes = readFileSync(resolvedDescriptor);
    result.descriptorSha256 = hash(descriptorBytes);
    let descriptor: OperatorScriptDescriptor;
    try {
      descriptor = validateOperatorScriptContract(JSON.parse(descriptorBytes.toString("utf8")), id, readFileSync(path.join(library, `${id}.sh`), "utf8"));
    } catch (error) {
      return refuse("INVALID_CONTRACT", error instanceof Error ? error.message : String(error), "Regenerate this action with `arcadia operator-action settle-ask`; do not edit the descriptor by hand.");
    }
    const pin = descriptor.agentAskSettlement;
    const declared = descriptor.agentAsk;
    if (!pin || !declared) return refuse("INVALID_CONTRACT", "This descriptor pins no Agent Ask settlement.");
    const stateDir = pinnedSettlementStateDir(library, pin.project, env);
    runDirectory = path.join(stateDir, "runs", `${new Date().toISOString().replace(/[-:.]/g, "")}-${process.pid}`);
    result = { ...result, runDirectory };
    mkdirSync(runDirectory, { recursive: true });
    latest = path.join(stateDir, "runs", "receipts", `${id}.json`);
    lock = path.join(stateDir, "runs", "receipts", `${id}.lock`);
    claimRunnerLock(lock, "settlement");
    locked = true;
    save();

    let workspace: string;
    try { workspace = resolveReadyWorkspace(env.ARCADIA_WORKSPACE?.trim() || undefined).workspacePath; }
    catch { return refuse("WORKSPACE_UNAVAILABLE", "The configured workspace cannot be opened.", "Restore the configured workspace and retry; no alternative workspace or proposal will be selected."); }
    try { refuseInExperimentWorkspace("operator-script.run", workspace); }
    catch (error) {
      const details = error instanceof ArcadiaError ? error.details : {};
      return refuse("EXPERIMENT_WORKSPACE", error instanceof Error ? error.message : String(error), String(details.alternative ?? "Run operator scripts only against the live workspace."));
    }

    // Read-only checks: the library belongs to the pinned Project, and the proposal is exactly the pinned one.
    const repo = withReadOnlyDatabase(workspace, (db) => {
      const project = getProjectBySlug(db, pin.project);
      const repoPath = project ? getProjectMetadata(db, project.id)?.repo_path?.trim() : null;
      if (!project || !repoPath) refuse("WRONG_PROJECT", `Project ${pin.project} is not registered with a repository in this workspace.`);
      const checkout = realpathSync(repoPath);
      equal(realpathSync(library), realpathSync(path.join(checkout, OPERATOR_LIBRARY_RELATIVE)), "WRONG_LIBRARY", "Library of the pinned Project");
      const row = db.prepare("SELECT proposal_json FROM agent_ask_proposals WHERE request_id = ?").get(declared.proposal) as { proposal_json: string } | undefined;
      if (!row) refuse("PROPOSAL_NOT_FOUND", `Agent Ask ${declared.proposal} is not recorded in this workspace.`, "Preview the Ask first; this action settles only a recorded proposal.");
      const stored = JSON.parse(row.proposal_json) as AgentAskProposal;
      if (stored.fingerprint !== pin.proposalFingerprint) {
        refuse("STALE_FINGERPRINT", `Agent Ask ${declared.proposal} now has preview fingerprint ${stored.fingerprint}, not the pinned ${pin.proposalFingerprint}.`,
          "The proposal changed since this button was generated. Review the new proposal and generate a fresh action; this press changed nothing.");
      }
      equal([stored.normalized.project, stored.normalized.requestId, stored.normalized.intent, stored.normalized.targetRef],
        [pin.project, declared.proposal, declared.intent, declared.targetRef], "ANOTHER_PROPOSAL", "Stored proposal");
      const settled = db.prepare("SELECT receipt_json FROM agent_ask_settlements WHERE proposal_id = ?").get(stored.id) as { receipt_json: string } | undefined;
      if (settled) {
        const receipt = JSON.parse(settled.receipt_json) as AgentAskSettlementReceipt;
        if (receipt.settlementRequestId !== pin.requestId) {
          refuse("ALREADY_SETTLED", `Agent Ask ${declared.proposal} was already settled (${receipt.disposition}) by ${receipt.settlementRequestId}.`,
            "Nothing to do: someone settled it another way. Keep this receipt; this press changed nothing.");
        }
      }
      return checkout;
    });

    const flags = {
      workspace, proposal: declared.proposal, requestId: pin.requestId, disposition: pin.disposition, cwd: repo,
      ...(pin.placement === "top" ? { top: true } : {})
    };
    const run = <T>(work: () => T) => withinPinnedAskSettlementRunner(resolvedDescriptor, work);
    const identity = (receipt: AgentAskSettlementReceipt, label: string) =>
      equal([receipt.proposalRequestId, receipt.settlementRequestId, receipt.projectSlug, receipt.intent, receipt.disposition],
        [declared.proposal, pin.requestId, pin.project, declared.intent, pin.disposition], "ANOTHER_PROPOSAL", label);
    const preview = run(() => runAgentAskSettleCommand(flags).data.receipt);
    atomic(path.join(runDirectory, "preview.json"), preview);
    identity(preview, "Settlement preview");
    let settlement: AgentAskSettlementReceipt;
    if (preview.applied) {
      settlement = preview; // Replay of this action's own settlement request: never applied twice.
    } else {
      equal(hash(readFileSync(resolvedDescriptor)), result.descriptorSha256, "CHANGED_ENVELOPE", "Descriptor after preview");
      const fence = (db: Parameters<NonNullable<Parameters<typeof runAgentAskSettleCommand>[0]["beforeGovernanceWrite"]>>[0]) => {
        equal(hash(readFileSync(resolvedDescriptor)), result.descriptorSha256, "CHANGED_ENVELOPE", "Descriptor at write fence");
        const row = db.prepare("SELECT proposal_json FROM agent_ask_proposals WHERE request_id = ?").get(declared.proposal) as { proposal_json: string } | undefined;
        equal(row ? (JSON.parse(row.proposal_json) as AgentAskProposal).fingerprint : null, pin.proposalFingerprint, "STALE_FINGERPRINT", "Proposal fingerprint at write fence");
      };
      settlement = run(() => runAgentAskSettleCommand({ ...flags, preview: preview.previewFingerprint, apply: true, beforeGovernanceWrite: fence }).data.receipt);
      identity(settlement, "Applied settlement");
    }
    result.settlement = settlement;
    atomic(path.join(runDirectory, "settlement-receipt.json"), settlement);
    if (!settlement.applied || settlement.recovery) {
      refuse("SETTLEMENT_RECOVERY", "The settlement did not finish every durable step.", settlement.recovery?.remedy ?? "Preserve this receipt; retry this same action to verify the canonical settlement without applying twice.");
    }
    result.status = "succeeded";
    result.reason = preview.applied ? "REPLAYED" : "SETTLED";
    const commit = settlement.documentsCommit ? ` Its documents are committed as ${settlement.documentsCommit.slice(0, 12)} in ${repo}; that commit is local only until it is published.` : "";
    result.message = `Agent Ask ${declared.proposal} is ${pin.disposition} (${settlement.id}).${commit}`;
    result.next = settlement.nextActionKey
      ? `Keep this receipt. Next governed Action: ${settlement.nextActionKey}. Nothing was pushed, merged or deployed.`
      : "Keep this receipt. Any Decision this settlement opened is answered on /review or Discord. Nothing was pushed, merged or deployed.";
  } catch (error) {
    result.status = "failed";
    const normalized = normalizeError(error);
    result.reason = error instanceof Refusal ? error.reason
      : ["WORKSPACE_NOT_FOUND", "DATABASE_NOT_INITIALIZED", "SQLITE_WORKSPACE_WRITE_DENIED", "SQLITE_NATIVE_ABI_MISMATCH", "SQLITE_ERROR"].includes(normalized.code)
        ? "WORKSPACE_UNAVAILABLE" : normalized.code === "VALIDATION_ERROR" ? "SETTLEMENT_REFUSED" : "RUNNER_FAILURE";
    result.message = error instanceof Error ? error.message : String(error);
    result.next = error instanceof Refusal ? error.next : "Read the refusal, restore the named precondition, and retry this same action; it never applies twice.";
    if (runDirectory) writeFileSync(path.join(runDirectory, "failure-handoff.txt"), `${result.reason}: ${result.message}\nNext: ${result.next}\n`);
  } finally {
    save();
    if (runDirectory) writeFileSync(path.join(runDirectory, "run.log"), `${result.reason}: ${result.message}\n${result.next}\n`);
    if (locked) unlinkSync(lock);
  }
  return result;
}
