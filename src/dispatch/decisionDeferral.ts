import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveActionReadiness, resolveDispatch } from "../docs/dispatch.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";
import type { WorkItemStatus } from "../domain/constants.js";
import { commitOnlyPaths, tryGit } from "../git/worktrees.js";
import { loadActionOrder } from "./order.js";
import { replacePointer } from "./pointer.js";

/**
 * Apply an answered Decision's `defer` consequence in one governed transition.
 *
 * The Decision answer, the Action's parked status, and the governed pointer
 * move are written and committed together, then validated against the
 * post-deferral dispatch state before the commit lands. A retry keyed on the
 * same request id returns the recorded receipt instead of applying twice, so a
 * crash or a failed commit can never leave a committed pointer beside an
 * uncommitted deferred status or an unanswered Decision.
 */

export interface DecisionDeferralConsequence {
  kind: "defer";
  actionId: string;
  actionKey: string;
  planPath: string;
  actionStatusBefore: WorkItemStatus;
  actionStatusAfter: WorkItemStatus;
  pointerBefore: string | null;
  pointerAfter: string | null;
  pointerMoved: boolean;
}

export interface DecisionDeferralReceipt {
  id: string;
  requestId: string;
  decisionId: string;
  decisionPath: string;
  actionKey: string;
  consequence: DecisionDeferralConsequence;
  /** The documents this transition changed, relative to the repository root. */
  changedPaths: string[];
  applied: boolean;
  commitError: string | null;
  createdAt: string;
}

export interface DecisionDeferralResult {
  consequence: DecisionDeferralConsequence;
  receiptId: string | null;
  applied: boolean;
}

export interface DecisionDeferralInput {
  repoRoot: string;
  projectSlug: string;
  decisionId: string;
  actionId: string;
  requestId: string;
  decisionAbsolutePath: string;
  decisionRelativePath: string;
  /** The Decision's frontmatter after the answer is recorded. */
  decisionAfter: string;
  dryRun: boolean;
}

export function applyDecisionDeferral(
  db: Database.Database,
  input: DecisionDeferralInput
): DecisionDeferralResult {
  const existing = loadReceipt(db, input.requestId);
  if (existing) {
    if (existing.decisionId !== input.decisionId) {
      throw validationError("Decision deferral request id was already used for a different Decision.", {
        requestId: input.requestId,
        originalDecision: existing.decisionId,
        requestedDecision: input.decisionId
      });
    }
    if (existing.applied) {
      return { consequence: existing.consequence, receiptId: existing.id, applied: true };
    }
    // A previous attempt wrote the documents but could not commit them. Retry
    // exactly that commit — recomputing from disk would see the already-written
    // state as "no change" and leave the deferral uncommitted forever.
    const retryError = commitDecisionDeferral(input.repoRoot, existing.changedPaths, existing);
    existing.applied = retryError === null;
    existing.commitError = retryError;
    saveReceipt(db, existing);
    if (retryError) throw commitFailure(existing, retryError);
    return { consequence: existing.consequence, receiptId: existing.id, applied: true };
  }

  const { project, plan, action } = resolveTarget(input.repoRoot, input.projectSlug, input.actionId);
  const pointerBefore = project.currentAction ?? plan.currentAction;
  const needsPark = action.status !== "deferred";
  const pointerMoved = needsPark && pointerBefore === action.id;
  const actionKey = `${project.slug}/${action.id}`;

  const nextActionId = pointerMoved
    ? nextEligibleInQueue(input.repoRoot, project.slug, plan, action.id, loadActionOrder(db).positions)
    : null;
  if (pointerMoved && !nextActionId) {
    throw validationError("This Decision defers the current Action, but no other eligible Action can take the pointer.", {
      action: input.actionId,
      remedy: "Make the next queued Action eligible first, or defer this Action once its successor can be dispatched."
    });
  }

  const consequence: DecisionDeferralConsequence = {
    kind: "defer",
    actionId: action.id,
    actionKey,
    planPath: plan.relativePath,
    actionStatusBefore: action.status,
    actionStatusAfter: needsPark ? "deferred" : action.status,
    pointerBefore,
    pointerAfter: pointerMoved ? nextActionId : pointerBefore,
    pointerMoved
  };
  if (input.dryRun) {
    return { consequence, receiptId: null, applied: false };
  }

  const projectAbsolutePath = path.join(input.repoRoot, project.relativePath);
  const planAbsolutePath = path.join(input.repoRoot, plan.relativePath);
  const projectBefore = readFileSync(projectAbsolutePath, "utf8");
  const planBefore = readFileSync(planAbsolutePath, "utf8");
  const decisionBefore = readFileSync(input.decisionAbsolutePath, "utf8");

  let planAfter = planBefore;
  let projectAfter = projectBefore;
  if (needsPark) {
    planAfter = setActionStatus(planAfter, action.id, "deferred");
  }
  if (pointerMoved && nextActionId) {
    planAfter = replacePointer(planAfter, nextActionId, "milestone");
    projectAfter = replacePointer(projectAfter, nextActionId, "active_plan");
  }

  const mutations = [
    { absolutePath: input.decisionAbsolutePath, relativePath: input.decisionRelativePath, before: decisionBefore, after: input.decisionAfter },
    ...(needsPark ? [{ absolutePath: planAbsolutePath, relativePath: plan.relativePath, before: planBefore, after: planAfter }] : []),
    ...(pointerMoved ? [{ absolutePath: projectAbsolutePath, relativePath: project.relativePath, before: projectBefore, after: projectAfter }] : [])
  ];

  // A detached HEAD would accept the commit and lose it the moment HEAD moves.
  if (tryGit(input.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === null) {
    throw validationError("The Project repository is on a detached HEAD, so the deferral commit would be unreachable from any branch.", {
      repoRoot: input.repoRoot,
      actionKey
    });
  }

  writeAllAtomically(mutations);
  try {
    assertPostDeferralDispatch(input.repoRoot, project.slug, consequence, nextActionId);
  } catch (error) {
    restoreAll(mutations);
    throw error;
  }

  const receipt: DecisionDeferralReceipt = {
    id: `decisiondefer_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    requestId: input.requestId,
    decisionId: input.decisionId,
    decisionPath: input.decisionRelativePath,
    actionKey,
    consequence,
    changedPaths: mutations
      .filter((mutation) => sha256(mutation.before) !== sha256(mutation.after))
      .map((mutation) => mutation.relativePath),
    applied: false,
    commitError: null,
    createdAt: new Date().toISOString()
  };

  const commitError = receipt.changedPaths.length > 0
    ? commitDecisionDeferral(input.repoRoot, receipt.changedPaths, receipt)
    : null;

  receipt.applied = commitError === null;
  receipt.commitError = commitError;
  saveReceipt(db, receipt);

  // The documents are already written and the receipt records exactly what
  // happened; a failed commit is reported as a failure at the command rather
  // than a hollow `applied: true`.
  if (commitError) throw commitFailure(receipt, commitError);

  return { consequence, receiptId: receipt.id, applied: true };
}

function commitFailure(receipt: DecisionDeferralReceipt, commitError: string): ReturnType<typeof validationError> {
  return validationError("The Decision answer and the Action deferral were written but could not be committed.", {
    receiptId: receipt.id,
    commitError,
    remedy: "Fix the Git failure (for example a missing user.name/user.email) and re-run the same command with the same --request-id."
  });
}

function resolveTarget(repoRoot: string, projectSlug: string, actionId: string): {
  project: ProjectDoc;
  plan: PlanDoc;
  action: PlanDoc["actions"][number];
} {
  const discovered = discoverDocs(repoRoot);
  const project = discovered.docs.find(
    (doc): doc is ProjectDoc => doc.type === "project" && doc.slug === projectSlug
  );
  if (!project?.activePlan) {
    throw validationError("This Decision defers an Action, but its Project has no active Plan to park it in.", {
      project: projectSlug,
      action: actionId
    });
  }
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc =>
      doc.type === "plan" && doc.project === project.slug && doc.slug === project.activePlan
  );
  if (!plan) {
    throw validationError("This Decision defers an Action, but the Project's active Plan document was not found.", {
      project: projectSlug,
      plan: project.activePlan
    });
  }
  const action = plan.actions.find((candidate) => candidate.id === actionId);
  if (!action) {
    throw validationError("This Decision defers an Action that is not in the Project's active Plan.", {
      action: actionId,
      plan: plan.slug
    });
  }
  return { project, plan, action };
}

/**
 * The documents are written, so dispatch can be asked what it now sees. The
 * parked Action must not be selected, and when the pointer moved it must land
 * on the intended successor with no blocker. Anything else aborts the commit
 * and restores every document.
 */
function assertPostDeferralDispatch(
  repoRoot: string,
  projectSlug: string,
  consequence: DecisionDeferralConsequence,
  nextActionId: string | null
): void {
  const dispatch = resolveDispatch(repoRoot, projectSlug);
  if (!dispatch.context) {
    throw validationError("Deferral did not leave a resolvable current Action.", {
      action: consequence.actionId,
      blockers: dispatch.blockers.map((blocker) => blocker.message),
      operatorQuestion: dispatch.operatorQuestion
    });
  }
  if (dispatch.context.action.id === consequence.actionId) {
    throw validationError("Deferral left the parked Action as the current Action.", {
      action: consequence.actionId
    });
  }
  if (!consequence.pointerMoved) {
    return;
  }
  if (dispatch.context.action.id !== nextActionId || dispatch.blockers.length > 0 || dispatch.operatorQuestion) {
    throw validationError("Deferral did not produce dispatchable checked-in truth for the next Action.", {
      expectedNext: nextActionId,
      actualNext: dispatch.context.action.id,
      blockers: dispatch.blockers.map((blocker) => blocker.message),
      operatorQuestion: dispatch.operatorQuestion
    });
  }
}

function nextEligibleInQueue(
  repoRoot: string,
  projectSlug: string,
  plan: PlanDoc,
  excludeActionId: string,
  positions: Map<string, number>
): string | null {
  const documentRank = new Map(plan.actions.map((action, index) => [action.id, index]));
  const unpositionedBase = plan.actions.length + positions.size;
  const rankOf = (actionId: string): number => {
    const position = positions.get(`${projectSlug}/${actionId}`);
    if (position !== undefined) return position;
    return unpositionedBase + (documentRank.get(actionId) ?? 0);
  };

  const isEligible = (actionId: string): boolean => {
    const action = plan.actions.find((candidate) => candidate.id === actionId);
    if (!action) return false;
    const authorized = action.responsibility === "agent" || action.responsibility === "autonomous";
    if (!authorized) return false;
    const readiness = resolveActionReadiness(repoRoot, projectSlug, actionId);
    return readiness.blockers.length === 0 && readiness.operatorQuestion === null;
  };

  const ordered = plan.actions
    .filter((action) =>
      action.id !== excludeActionId &&
      action.status !== "done" &&
      action.status !== "blocked" &&
      action.status !== "deferred")
    .sort((left, right) => rankOf(left.id) - rankOf(right.id));

  const parkedRank = rankOf(excludeActionId);
  const strictlyAfter = ordered.find((action) => rankOf(action.id) > parkedRank && isEligible(action.id));
  if (strictlyAfter) return strictlyAfter.id;
  const anyEligible = ordered.find((action) => isEligible(action.id));
  return anyEligible?.id ?? null;
}

/** Park one Action by rewriting its `status:` line inside its Plan block. */
function setActionStatus(content: string, actionId: string, status: WorkItemStatus): string {
  const pattern = new RegExp(`(^  - id: ${escapeRegex(actionId)}\\r?$[\\s\\S]*?)(?=^  - id: |^---\\r?$)`, "m");
  const match = content.match(pattern);
  if (!match) {
    throw validationError("Managed Plan Action block was not found.", { actionId });
  }
  const block = match[1];
  if (!/^ {4}status:/m.test(block)) {
    throw validationError("Managed Plan Action has no status field to amend.", { actionId });
  }
  return content.replace(pattern, block.replace(/^ {4}status:.*$/m, `    status: ${status}`));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface FileMutation {
  absolutePath: string;
  relativePath: string;
  before: string;
  after: string;
}

function writeAllAtomically(mutations: FileMutation[]): void {
  const temps: Array<{ absolutePath: string; tempPath: string }> = [];
  for (const mutation of mutations) {
    const tempPath = `${mutation.absolutePath}.arcadia-${process.pid}-${randomUUID()}`;
    writeFileSync(tempPath, mutation.after, "utf8");
    temps.push({ absolutePath: mutation.absolutePath, tempPath });
  }
  const renamed: string[] = [];
  try {
    for (const entry of temps) {
      renameSync(entry.tempPath, entry.absolutePath);
      renamed.push(entry.absolutePath);
    }
  } catch (error) {
    for (const absolutePath of renamed) {
      const mutation = mutations.find((candidate) => candidate.absolutePath === absolutePath);
      if (mutation) writeFileSync(absolutePath, mutation.before, "utf8");
    }
    for (const entry of temps) safeUnlink(entry.tempPath);
    throw error;
  }
}

function restoreAll(mutations: FileMutation[]): void {
  for (const mutation of mutations) {
    writeFileSync(mutation.absolutePath, mutation.before, "utf8");
  }
}

function safeUnlink(filePath: string): void {
  try { unlinkSync(filePath); } catch {}
}

function commitDecisionDeferral(
  repoRoot: string,
  relativePaths: string[],
  receipt: DecisionDeferralReceipt
): string | null {
  const { consequence } = receipt;
  const message = [
    `chore(arcadia): answer Decision ${receipt.decisionId}`,
    "",
    `- ${receipt.decisionPath}: recorded the answer.`,
    `- ${consequence.planPath}: ${consequence.actionKey} status ${consequence.actionStatusBefore} → ${consequence.actionStatusAfter}.`,
    consequence.pointerMoved
      ? `- pointer ${consequence.pointerBefore ?? "none"} → ${consequence.pointerAfter ?? "none"}.`
      : "- pointer unchanged.",
    "",
    `Written by \`arcadia decision approve\` (${receipt.id}).`
  ].join("\n");
  return commitOnlyPaths(repoRoot, relativePaths, message);
}

function loadReceipt(db: Database.Database, requestId: string): DecisionDeferralReceipt | null {
  const row = db.prepare("SELECT receipt_json FROM decision_deferral_receipts WHERE request_id = ?")
    .get(requestId) as { receipt_json: string } | undefined;
  return row ? JSON.parse(row.receipt_json) as DecisionDeferralReceipt : null;
}

function saveReceipt(db: Database.Database, receipt: DecisionDeferralReceipt): void {
  db.prepare(`INSERT OR REPLACE INTO decision_deferral_receipts
    (id, request_id, decision_id, decision_path, action_key, plan_path, applied, receipt_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(receipt.id, receipt.requestId, receipt.decisionId, receipt.decisionPath, receipt.actionKey,
      receipt.consequence.planPath, receipt.applied ? 1 : 0, JSON.stringify(receipt), receipt.createdAt);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
