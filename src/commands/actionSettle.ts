import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveProjectReference } from "../ask/rules.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { resolveDispatch } from "../docs/dispatch.js";
import { runAgentAskPreviewCommand, runAgentAskSettleCommand } from "./agentAsk.js";

/**
 * `arcadia action settle` — one command to complete the current governed Action
 * from accepted operator evidence.
 *
 * The raw path is a five-flag dance: author an Agent Ask YAML with every
 * acceptance criterion verbatim and in order, look up the exact candidate
 * revision (which must equal the Project repository's HEAD), preview it, copy
 * the preview fingerprint, then settle with `--proposal`, `--request-id`,
 * `--disposition`, `--preview`, `--apply`, and `--operator`. Every one of those
 * is derivable, so this command derives them: it reads the current Action's
 * declared criteria, binds the candidate revision, marks each criterion met
 * (completion refuses anything else anyway), previews, and — unless `--dry-run`
 * — settles with operator authority. It composes the existing preview and
 * settle routines rather than reimplementing settlement, so it cannot drift
 * from the canonical writer.
 */

export interface ActionSettleOptions {
  workspace: string;
  /** Project slug. Optional when the workspace has exactly one active Project. */
  project?: string;
  /** `<slug>/<id>` or `<id>`. Optional: defaults to the Project's current Action. */
  action?: string;
  /** One note applied to every criterion. Ignored when notesFile is given. */
  note?: string;
  /** Path to a JSON array of notes aligned to the declared criteria order. */
  notesFile?: string;
  /** Preview only: resolve and validate, but do not settle. */
  dryRun?: boolean;
}

export interface ActionSettleEvidence {
  criterion: string;
  status: "met";
  note: string;
}

export interface ActionSettlePlan {
  projectSlug: string;
  actionId: string;
  actionTitle: string;
  repoRoot: string;
  candidateRevision: string;
  criteria: ActionSettleEvidence[];
  proposalRequestId: string;
  previewFingerprint: string;
  effects: string[];
}

export interface ActionSettleData {
  applied: boolean;
  plan: ActionSettlePlan;
  nextActionKey: string | null;
  receiptId: string | null;
}

interface ResolvedTarget {
  projectSlug: string;
  actionId: string;
  actionTitle: string;
  repoRoot: string;
  criteria: string[];
}

function resolveTarget(workspacePath: string, options: ActionSettleOptions): ResolvedTarget {
  const [refSlug, refId] = options.action?.includes("/")
    ? (options.action.split("/") as [string, string])
    : [undefined, options.action];

  return withReadOnlyDatabase(workspacePath, (db) => {
    const named = options.project ?? refSlug;
    const project = named
      ? resolveProjectReference(db, named)
      : (() => {
          const active = listProjects(db).filter((candidate) => candidate.status === "active");
          if (active.length === 1) return active[0];
          throw validationError("Name the Project to settle in.", {
            activeProjects: active.map((candidate) => candidate.slug),
            remedy: "Pass --project <slug> (or --action <slug/id>)."
          });
        })();
    if (!project) throw validationError("Project was not found in this workspace.", { project: named });
    const slug = project.slug;
    const metadata = getProjectMetadata(db, project.id);
    if (!metadata?.repo_path) {
      throw validationError("Project has no configured repository path.", { project: slug });
    }
    const repoRoot = path.resolve(metadata.repo_path);

    const dispatch = resolveDispatch(repoRoot, slug);
    if (!dispatch.context) {
      throw validationError("The Project does not resolve a current Action to settle.", {
        project: slug,
        blockers: dispatch.blockers.map((blocker) => blocker.message),
        operatorQuestion: dispatch.operatorQuestion,
        remedy: "Repair the governed pointer, or answer its Decision, before settling."
      });
    }
    const action = dispatch.context.action;
    if (refId && refId !== action.id) {
      throw validationError("That Action is not the current one; complete Actions in queue order.", {
        requested: refId,
        currentAction: action.id,
        remedy: `Settle ${slug}/${action.id} first, or wait until the pointer reaches ${refId}.`
      });
    }
    if (action.status === "done") throw validationError("The current Action is already done.", { actionId: action.id });
    if (action.acceptanceCriteria.length === 0) {
      throw validationError("The Action declares no acceptance criteria to bind evidence to.", { actionId: action.id });
    }
    return {
      projectSlug: slug,
      actionId: action.id,
      actionTitle: action.title,
      repoRoot,
      criteria: action.acceptanceCriteria
    };
  });
}

function resolveNotes(criteria: string[], options: ActionSettleOptions, candidateRevision: string): string[] {
  const fallback = options.note?.trim()
    ? options.note.trim()
    : `Operator-accepted via 'arcadia action settle' at ${candidateRevision.slice(0, 12)}.`;
  if (!options.notesFile) return criteria.map(() => fallback);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.resolve(options.notesFile), "utf8"));
  } catch (error) {
    throw validationError("Could not read the notes file as JSON.", {
      notesFile: options.notesFile,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!Array.isArray(parsed) || parsed.length !== criteria.length) {
    throw validationError("The notes file must be a JSON array with one entry per acceptance criterion.", {
      expected: criteria.length,
      received: Array.isArray(parsed) ? parsed.length : typeof parsed
    });
  }
  return parsed.map((entry, index) => {
    const note = typeof entry === "string" ? entry.trim() : "";
    return note || fallback + ` (criterion ${index + 1})`;
  });
}

export function runActionSettleCommand(options: ActionSettleOptions): CommandSuccess<ActionSettleData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const target = resolveTarget(workspacePath, options);
  const candidateRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: target.repoRoot,
    encoding: "utf8"
  }).trim();

  const notes = resolveNotes(target.criteria, options, candidateRevision);
  const evidence: ActionSettleEvidence[] = target.criteria.map((criterion, index) => ({
    criterion,
    status: "met",
    note: notes[index]
  }));

  const askDocument = stringifyYaml({
    agent_ask: "v1",
    request_id: "PLACEHOLDER",
    project: target.projectSlug,
    intent: "complete",
    target_ref: `action/${target.actionId}`,
    candidate_revision: candidateRevision,
    desired_result: `Complete ${target.projectSlug}/${target.actionId} from accepted operator evidence.`,
    requested_authority: "apply_if_approved",
    evidence
  });
  // A content hash makes the request id stable for identical evidence (so a
  // --dry-run and the real settle replay the same proposal) and distinct when
  // the operator edits a note (so the preview is not refused as reused).
  const contentHash = createHash("sha256").update(askDocument).digest("hex").slice(0, 12);
  const proposalRequestId = `complete-${target.projectSlug}-${target.actionId}-${contentHash}`.slice(0, 120);
  const request = askDocument.replace("request_id: PLACEHOLDER", `request_id: ${proposalRequestId}`);

  // Three composed steps, each idempotent: (1) create the proposal, (2) preview
  // the settlement to obtain the fingerprint apply must echo, (3) apply. The
  // settlement's own preview fingerprint — not the proposal's — is what apply
  // checks, so a dry run stops after step 2 and reports exactly that.
  runAgentAskPreviewCommand({ workspace: workspacePath, request, requestId: proposalRequestId });
  const settlementRequestId = `settle-${proposalRequestId}`.slice(0, 120);
  const settlementPreview = runAgentAskSettleCommand({
    workspace: workspacePath,
    proposal: proposalRequestId,
    requestId: settlementRequestId,
    disposition: "accepted"
  });

  const plan: ActionSettlePlan = {
    projectSlug: target.projectSlug,
    actionId: target.actionId,
    actionTitle: target.actionTitle,
    repoRoot: target.repoRoot,
    candidateRevision,
    criteria: evidence,
    proposalRequestId,
    previewFingerprint: settlementPreview.data.receipt.previewFingerprint,
    effects: settlementPreview.data.receipt.effects
  };

  if (options.dryRun) {
    return createSuccess({
      command: "action.settle",
      workspace: workspacePath,
      data: { applied: false, plan, nextActionKey: null, receiptId: null }
    });
  }

  const settle = runAgentAskSettleCommand({
    workspace: workspacePath,
    proposal: proposalRequestId,
    requestId: settlementRequestId,
    disposition: "accepted",
    preview: plan.previewFingerprint,
    apply: true,
    operator: true
  });

  return createSuccess({
    command: "action.settle",
    workspace: workspacePath,
    data: {
      applied: true,
      plan,
      nextActionKey: settle.data.receipt.nextActionKey ?? null,
      receiptId: settle.data.receipt.id
    }
  });
}

export function renderActionSettleSuccess(response: CommandSuccess<ActionSettleData>): string[] {
  const { plan, applied, nextActionKey } = response.data;
  const lines = [
    applied
      ? `Settled ${plan.projectSlug}/${plan.actionId} — done.`
      : `Dry run for ${plan.projectSlug}/${plan.actionId} (nothing settled).`,
    `Action: ${plan.actionTitle}`,
    `Candidate revision: ${plan.candidateRevision.slice(0, 12)} (repo HEAD ${plan.repoRoot})`,
    `Acceptance criteria: ${plan.criteria.length}, all marked met`,
    `Preview fingerprint: ${plan.previewFingerprint}`
  ];
  if (applied) {
    lines.push(`Next action: ${nextActionKey ?? "none — Plan may be complete"}`);
  } else {
    lines.push("Re-run without --dry-run to settle with operator authority.");
  }
  return lines;
}
