import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AgentAskProposal } from "../ask/agentAsk.js";
import type { AgentAskSettlementReceipt } from "../ask/settlement.js";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { sharesRepository } from "../git/worktrees.js";
import { pinnedAskSettlementLauncher, validateOperatorScriptContract, type OperatorScriptDescriptor } from "../operatorActions/libraryContract.js";
import { arcadiaOwnLibrary } from "../operatorActions/pinnedAskSettlement.js";
import { OPERATOR_LIBRARY_RELATIVE, projectLibraryKey } from "../operatorActions/projectLibraries.js";
import { runAgentAskSettleCommand } from "./agentAsk.js";

export interface OperatorActionSettleAskData {
  /** The key /actions and /api/operator-script use for this entry. */
  key: string;
  id: string;
  project: string;
  proposal: string;
  disposition: "accepted" | "rejected";
  placement: "top" | null;
  /** Library directory written: the caller's own checkout of the Project's repository. */
  library: string;
  descriptorPath: string;
  scriptPath: string;
  /** False when an identical pair was already there. */
  written: boolean;
  actionsPath: string;
  previewEffects: string[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const clip = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/**
 * Write a validated, pinned one-shot settlement button for one recorded Agent
 * Ask into the caller's own checkout of that Project's library. It reads the
 * workspace and previews the settlement (which writes nothing) so a bad pin
 * fails here, not on the operator's phone. Generating grants no authority:
 * only the operator's press settles.
 */
export function runOperatorActionSettleAskCommand(options: {
  workspace?: string; project: string; proposal: string; fingerprint: string; disposition: string; top?: boolean; id?: string; dir: string;
}): CommandSuccess<OperatorActionSettleAskData> {
  if (!SLUG.test(options.project)) throw validationError("--project must be a registered Project slug.");
  const fingerprint = options.fingerprint.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw validationError("--fingerprint must be the proposal's full 64-hex preview fingerprint (agent-ask preview prints it).");
  if (options.disposition !== "accepted" && options.disposition !== "rejected") throw validationError("--disposition must be accepted or rejected.");
  const disposition = options.disposition;
  if (disposition === "rejected" && options.top) throw validationError("A rejection places nothing in the queue; drop --top.");
  const placement = options.top ? "top" as const : null;
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  const found = withReadOnlyDatabase(workspacePath, (db) => {
    const project = getProjectBySlug(db, options.project);
    const repoPath = project ? getProjectMetadata(db, project.id)?.repo_path?.trim() : null;
    if (!project || !repoPath) throw validationError(`Project ${options.project} is not registered with a repository in this workspace.`);
    const row = db.prepare("SELECT proposal_json FROM agent_ask_proposals WHERE request_id = ? OR id = ?").get(options.proposal, options.proposal) as { proposal_json: string } | undefined;
    if (!row) throw validationError(`Agent Ask ${options.proposal} is not recorded in this workspace. Preview it first (arcadia agent-ask preview).`);
    const proposal = JSON.parse(row.proposal_json) as AgentAskProposal;
    const settled = db.prepare("SELECT receipt_json FROM agent_ask_settlements WHERE proposal_id = ?").get(proposal.id) as { receipt_json: string } | undefined;
    if (settled) throw validationError(`Agent Ask ${proposal.normalized.requestId} is already settled (${(JSON.parse(settled.receipt_json) as AgentAskSettlementReceipt).settlementRequestId}); no button is needed.`, { reason: "ALREADY_SETTLED" });
    return { repoPath: realpathSync(repoPath), proposal };
  });
  const { proposal } = found;
  const ask = proposal.normalized;
  if (proposal.fingerprint !== fingerprint) {
    throw validationError(`Agent Ask ${ask.requestId} has preview fingerprint ${proposal.fingerprint}, not ${fingerprint}. Review the current proposal before pinning it.`, { reason: "STALE_FINGERPRINT" });
  }
  if (ask.project !== options.project) throw validationError(`Agent Ask ${ask.requestId} belongs to ${ask.project}, not ${options.project}.`);
  if (ask.intent === "plan" && ask.targetRef !== null) {
    throw validationError("An existing-Plan amendment settles only through the shared Plan-amendment runner (planAmendment), which this command does not generate. File it as a proposal or ask the operator.", { reason: "PLAN_AMENDMENT_RUNNER_REQUIRED" });
  }

  // The caller's own checkout (main or a worktree) of the Project's repository receives the pair.
  let callerRoot: string;
  try { callerRoot = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: options.dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()); }
  catch { throw validationError(`${options.dir} is not inside a Git checkout.`); }
  if (!sharesRepository(callerRoot, found.repoPath)) {
    throw validationError(`${callerRoot} is not a checkout of ${options.project}'s repository (${found.repoPath}). Run this from that Project's worktree.`, { reason: "WRONG_REPOSITORY" });
  }

  const requestId = `settle-${ask.requestId}`;
  const id = options.id ?? `${disposition === "accepted" ? "settle" : "reject"}-${ask.requestId}`;
  if (!SLUG.test(id) || id.length > 120) throw validationError("The action id must be a lowercase slug of at most 120 characters; pass --id.");

  // Preview exactly what the button will run (from the Project's main checkout); it writes nothing.
  const preview = runAgentAskSettleCommand({
    workspace: workspacePath, proposal: ask.requestId, requestId, disposition, cwd: found.repoPath, ...(placement ? { top: true } : {})
  }).data.receipt;
  if (preview.applied) throw validationError(`Settlement request ${requestId} was already applied; no button is needed.`, { reason: "ALREADY_SETTLED" });

  const verb = disposition === "accepted" ? "Accept" : "Reject";
  const settleCommand = `arcadia agent-ask settle --proposal ${ask.requestId} --request-id ${requestId} --disposition ${disposition}${placement ? " --top" : ""}`;
  const descriptor: OperatorScriptDescriptor = {
    schema: "arcadia-operator-script-v1",
    id,
    title: clip(`${verb} ${options.project} Ask: ${ask.desiredResult}`, 120),
    script: `${id}.sh`,
    project: options.project,
    repeatable: false,
    problem: clip(`Agent Ask ${ask.requestId} (${ask.intent}) waits for your settlement. ${ask.desiredResult}${ask.rationale ? ` Why: ${ask.rationale}` : ""}`, 900),
    desired_effect: clip(`Settle ${ask.requestId} as ${disposition}${placement ? " at the top of the queue" : ""} through the canonical settle path. Previewed effects: ${preview.effects.join("; ") || "none"}.`, 600),
    agentAsk: { proposal: ask.requestId, intent: ask.intent, targetRef: ask.targetRef },
    agentAskSettlement: {
      schema: "arcadia-agent-ask-settlement-v1",
      project: options.project,
      proposalFingerprint: fingerprint,
      requestId,
      disposition,
      placement
    },
    authority: {
      does: [
        `Refuse unless the configured live (non-experiment) workspace registers Project ${options.project} with this library in its repository`,
        `Refuse unless Agent Ask ${ask.requestId} is recorded with preview fingerprint ${fingerprint} and intent ${ask.intent}, and nobody else has settled it`,
        `Preview, then apply exactly that preview: the same canonical path as \`${settleCommand}\`, run in ${options.project}'s main checkout, which commits the managed documents the settlement changes there`,
        "Keep the preview, settlement receipt and run log in a timestamped runs/ directory outside the Project checkout"
      ],
      never_does: [
        "Push, merge, deploy, publish, message anyone, spend or use a credential",
        "Settle any other proposal, or change the pinned disposition, placement or fingerprint",
        "Answer a Decision the settlement opens; that stays on /review or Discord",
        "Settle twice: a second press replays the recorded settlement"
      ]
    },
    success: {
      effect: `${ask.requestId} is ${disposition} and the receipt is kept. Any settlement commit stays local to ${options.project}'s main checkout until it is published.`,
      next: "Answer any Decision it opened on /review or Discord; publish the local settlement commit through the Project's normal path."
    },
    failure: {
      effect: "Nothing is settled when the fingerprint is stale, the proposal is missing or already settled another way, the workspace is unavailable, or settlement refuses.",
      next: "Read the receipt's reason. A stale fingerprint or another settlement needs a fresh review and a newly generated button; a host failure can be retried with this same button."
    }
  };

  const library = path.join(callerRoot, OPERATOR_LIBRARY_RELATIVE);
  const descriptorPath = path.join(library, `${id}.json`);
  const scriptPath = path.join(library, `${id}.sh`);
  const descriptorText = JSON.stringify(descriptor, null, 2) + "\n";
  const scriptText = pinnedAskSettlementLauncher(id);
  validateOperatorScriptContract(JSON.parse(descriptorText), id, scriptText);
  const existing = (file: string) => existsSync(file) ? readFileSync(file, "utf8") : null;
  const [currentDescriptor, currentScript] = [existing(descriptorPath), existing(scriptPath)];
  if ((currentDescriptor !== null && currentDescriptor !== descriptorText) || (currentScript !== null && currentScript !== scriptText)) {
    throw validationError(`${id} already exists in ${library} with different content. Pass a new --id instead of overwriting a published action.`, { reason: "ENTRY_EXISTS" });
  }
  const written = currentDescriptor === null || currentScript === null;
  mkdirSync(library, { recursive: true });
  if (currentDescriptor === null) writeFileSync(descriptorPath, descriptorText);
  if (currentScript === null) writeFileSync(scriptPath, scriptText, { mode: 0o755 });
  chmodSync(scriptPath, 0o755);

  const isArcadiaLibrary = (): boolean => {
    try { return realpathSync(path.join(found.repoPath, OPERATOR_LIBRARY_RELATIVE)) === realpathSync(arcadiaOwnLibrary()); } catch { return false; }
  };
  // Arcadia's own library keeps bare ids on /actions; every other Project's entry is <project>--<id>.
  const key = isArcadiaLibrary() ? id : projectLibraryKey(options.project, id);
  return createSuccess({
    command: "operator-action.settle-ask",
    workspace: workspacePath,
    data: {
      key, id, project: options.project, proposal: ask.requestId, disposition, placement, library, descriptorPath, scriptPath, written,
      actionsPath: `/actions/${key}`, previewEffects: preview.effects
    },
    artifacts: [descriptorPath, scriptPath]
  });
}

export function renderOperatorActionSettleAskSuccess(response: CommandSuccess<OperatorActionSettleAskData>): string[] {
  const data = response.data;
  return [
    `${data.written ? "Wrote" : "Already present"}: ${data.descriptorPath}`,
    `Script: ${data.scriptPath}`,
    `Pins ${data.project} Ask ${data.proposal} -> ${data.disposition}${data.placement ? " (--top)" : ""}. Previewed effects: ${data.previewEffects.join("; ") || "none"}.`,
    `Commit both files in this checkout and open a PR. Once it is in ${data.project}'s main checkout, /actions shows it at ${data.actionsPath}.`,
    "Generating a button grants nothing: only the operator's press settles."
  ];
}
