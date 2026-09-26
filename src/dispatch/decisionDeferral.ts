import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveActionReadiness, resolveDispatch } from "../docs/dispatch.js";
import { parseDoc } from "../docs/parse.js";
import type { DecisionDocStatus, PlanDoc, ProjectDoc } from "../docs/types.js";
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
  /**
   * The Decision's recorded answer when the deferral applied. A reversal
   * refuses to re-open the Decision when this no longer matches, so it can never
   * silently clear a newer answer. Null when the deferral was applied before this
   * field existed (such receipts skip the exact-answer check).
   */
  decisionAnswer: string | null;
}

export interface DecisionDeferralReceipt extends DecisionReceiptFields {
  consequence: DecisionDeferralConsequence;
}

/**
 * The consequence of reversing an applied deferral: the Action is revived, the
 * pointer is restored to where it pointed before the deferral, and the Decision
 * is re-opened so dispatch no longer treats the Action as parked.
 */
export interface DecisionReversalConsequence {
  kind: "reverse";
  actionId: string;
  actionKey: string;
  planPath: string;
  actionStatusBefore: WorkItemStatus;
  actionStatusAfter: WorkItemStatus;
  pointerBefore: string | null;
  pointerAfter: string | null;
  pointerMoved: boolean;
  /**
   * True when the deferral moved the pointer but this reversal deliberately
   * left today's pointer in place instead of restoring it, because the
   * pointer had moved on since the deferral and the caller passed
   * `keepPointer`. Distinguishes that case from a deferral that never moved
   * the pointer at all (`pointerMoved: false` and this also `false`).
   */
  pointerLeftInPlace: boolean;
  /**
   * The Project and Plan pointer exactly as observed at the moment this
   * reversal chose to leave them alone (`pointerLeftInPlace: true`), null
   * otherwise. A retry after a failed commit checks the current pointers
   * against these instead of skipping the check entirely, so further drift
   * in between cannot be swept into the retried commit unnoticed.
   */
  pointerLeftAtProject: string | null;
  pointerLeftAtPlan: string | null;
  /** The deferral receipt this reversal undoes. */
  reversesReceiptId: string;
}

export interface DecisionReversalReceipt extends DecisionReceiptFields {
  consequence: DecisionReversalConsequence;
}

/** A stored receipt for either direction of the Decision consequence transition. */
export type DecisionConsequenceReceipt = DecisionDeferralReceipt | DecisionReversalReceipt;

/** Fields every Decision consequence receipt shares. */
interface DecisionReceiptFields {
  id: string;
  requestId: string;
  decisionId: string;
  decisionPath: string;
  actionKey: string;
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
  /** The exact answer recorded on the Decision, so a reversal can detect a newer one. */
  decisionAnswer: string | null;
  dryRun: boolean;
}

export function applyDecisionDeferral(
  db: Database.Database,
  input: DecisionDeferralInput
): DecisionDeferralResult {
  const existing = loadReceipt(db, input.requestId);
  if (existing) {
    if (!isDeferralReceipt(existing)) {
      throw validationError("Decision deferral request id was already used for a different operation.", {
        requestId: input.requestId,
        originalDecision: existing.decisionId,
        requestedDecision: input.decisionId
      });
    }
    if (existing.decisionId !== input.decisionId) {
      throw validationError("Decision deferral request id was already used for a different Decision.", {
        requestId: input.requestId,
        originalDecision: existing.decisionId,
        requestedDecision: input.decisionId
      });
    }
    // A dry run never touches Git, even when an earlier attempt left an
    // unapplied receipt behind. Report the recorded consequence and stop
    // (Issue #315).
    if (input.dryRun) {
      return { consequence: existing.consequence, receiptId: existing.id, applied: false };
    }
    if (existing.applied && receiptReflectedOnDisk(input.repoRoot, input.projectSlug, existing)) {
      return { consequence: existing.consequence, receiptId: existing.id, applied: true };
    }
    if (!existing.applied) {
      // A previous attempt wrote the documents but could not commit them. Retry
      // exactly that commit — recomputing from disk would see the already-written
      // state as "no change" and leave the deferral uncommitted forever. Verify
      // the documents still reflect the recorded transition first, so a retry
      // cannot commit state someone changed in between.
      if (!receiptReflectedOnDisk(input.repoRoot, input.projectSlug, existing)) {
        throw validationError("The deferral's documents changed after the failed commit, so the retry would commit altered state.", {
          receiptId: existing.id,
          remedy: "Restore the deferral's recorded documents, or answer the Decision again from the reconciled state."
        });
      }
      const retryError = commitDecisionDeferral(input.repoRoot, existing.changedPaths, existing);
      existing.applied = retryError === null;
      existing.commitError = retryError;
      saveReceipt(db, existing);
      if (retryError) throw commitFailure(existing, retryError);
      return { consequence: existing.consequence, receiptId: existing.id, applied: true };
    }
    // An applied receipt whose Action has since been revived (or whose pointer
    // has moved on) no longer describes checked-in truth. Fall through to apply
    // the transition again and replace the stale receipt, so re-approving a
    // re-opened Decision is not a silent no-op (Issue #317).
  }

  const { project, plan, action } = resolveTarget(input.repoRoot, input.projectSlug, input.actionId);
  // A completed Action must never be parked: rewriting `done` to `deferred`
  // would write false checked-in truth, and dispatch already excludes done
  // Actions, so the deferral would change nothing it could honestly describe.
  if (action.status === "done") {
    throw validationError("This Decision defers an Action that is already done.", {
      action: action.id,
      status: action.status,
      remedy: "A completed Action cannot be parked. Re-open the Action first, or answer the Decision the other way."
    });
  }
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
    pointerMoved,
    decisionAnswer: input.decisionAnswer
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

function commitFailure(receipt: DecisionConsequenceReceipt, commitError: string): ReturnType<typeof validationError> {
  return validationError(
    receipt.consequence.kind === "reverse"
      ? "The Decision reversal was written but could not be committed."
      : "The Decision answer and the Action deferral were written but could not be committed.",
    {
      receiptId: receipt.id,
      commitError,
      remedy: "Fix the Git failure (for example a missing user.name/user.email) and re-run the same command with the same --request-id."
    }
  );
}

export interface DecisionReversalInput {
  repoRoot: string;
  projectSlug: string;
  decisionId: string;
  decisionAbsolutePath: string;
  decisionRelativePath: string;
  /** The Decision's frontmatter once it is re-opened by this reversal. */
  decisionAfter: string;
  /** The Decision's recorded status, so a reversal can refuse to clear a newer decision. */
  decisionStatus: DecisionDocStatus;
  /** The Decision's recorded answer, so a reversal can refuse to clear a newer one. */
  decisionAnswer: string | null;
  /** The applied deferral this reversal undoes. */
  deferral: DecisionDeferralReceipt;
  requestId: string;
  dryRun: boolean;
  /**
   * Un-park the Action and re-open the Decision without restoring the
   * historical pointer, when the governed pointer has moved since the
   * deferral. Without this, that guard refuses the reversal outright
   * (Issue #656): a deferral old enough for legitimate dispatch to have
   * advanced the pointer past it could never be reversed. Has no effect when
   * the pointer has not moved, since restoring it then is unambiguous.
   */
  keepPointer?: boolean;
}

export interface DecisionReversalResult {
  consequence: DecisionReversalConsequence;
  receiptId: string | null;
  applied: boolean;
}

/**
 * Reverse one applied Decision deferral in a single governed transition: write
 * the re-opened Decision, restore the Action's parked status, and put the
 * pointer back where the deferral found it — all committed together and
 * validated against checked-in truth before the commit lands.
 *
 * It is the exact inverse of `applyDecisionDeferral`, keyed the same way: a
 * retry on the same request id returns the recorded reversal rather than
 * applying twice, and a failed commit is reported at the command instead of a
 * hollow success. It refuses when the world has moved on since the deferral
 * (the Action is no longer parked, or the pointer has advanced past where the
 * deferral left it), so a reversal can never silently discard newer truth.
 *
 * When the pointer has advanced, `input.keepPointer` un-parks the Action and
 * re-opens the Decision anyway, leaving today's pointer untouched instead of
 * restoring the historical one — otherwise a deferral old enough for real
 * dispatch to have legitimately moved past it could never be reversed at all
 * (Issue #656).
 */
export function reverseDecisionDeferral(
  db: Database.Database,
  input: DecisionReversalInput
): DecisionReversalResult {
  // Bind the receipt to the Decision and Project being reversed before anything
  // else, so a foreign receipt can never restore an Action in this Project or
  // re-open a different Decision.
  const { deferral } = input;
  if (deferral.decisionId !== input.decisionId || deferral.decisionPath !== input.decisionRelativePath) {
    throw validationError("This deferral receipt belongs to a different Decision, so it cannot be reversed here.", {
      receiptDecision: deferral.decisionId,
      receiptPath: deferral.decisionPath,
      requestedDecision: input.decisionId,
      requestedPath: input.decisionRelativePath
    });
  }
  if (!deferral.actionKey.startsWith(`${input.projectSlug}/`)) {
    throw validationError("This deferral receipt belongs to a different Project, so it cannot be reversed here.", {
      receiptActionKey: deferral.actionKey,
      project: input.projectSlug
    });
  }

  const existing = loadReceipt(db, input.requestId);
  if (existing) {
    if (!isReversalReceipt(existing) || existing.decisionId !== input.decisionId) {
      throw validationError("Decision reversal request id was already used for a different operation.", {
        requestId: input.requestId,
        originalDecision: existing.decisionId,
        requestedDecision: input.decisionId
      });
    }
    // A reversal request id idempotently keys exactly one deferral. Reusing it
    // for a later deferral of the same Decision must refuse rather than replace
    // the original reversal's receipt.
    if (existing.consequence.reversesReceiptId !== deferral.id) {
      throw validationError("This reversal request id was already used to reverse a different deferral.", {
        requestId: input.requestId,
        originalDeferral: existing.consequence.reversesReceiptId,
        requestedDeferral: deferral.id
      });
    }
    // A dry run never touches Git, even when an earlier attempt left an
    // unapplied receipt behind. Report the recorded reversal and stop.
    if (input.dryRun) {
      return { consequence: existing.consequence, receiptId: existing.id, applied: false };
    }
    if (existing.applied && reversalReflectedOnDisk(input.repoRoot, input.projectSlug, existing)) {
      return { consequence: existing.consequence, receiptId: existing.id, applied: true };
    }
    if (!existing.applied) {
      // The first attempt wrote the documents but could not commit them. Verify
      // they still reflect the recorded reversal before replaying the commit, so
      // a retry cannot commit state someone changed in between.
      if (!reversalReflectedOnDisk(input.repoRoot, input.projectSlug, existing)) {
        throw validationError("The reversal's documents changed after the failed commit, so the retry would commit altered state.", {
          receiptId: existing.id,
          remedy: "Restore the reversal's recorded documents, or reconcile the Action and pointer by hand."
        });
      }
      const retryError = commitDecisionReversal(input.repoRoot, existing.changedPaths, existing);
      existing.applied = retryError === null;
      existing.commitError = retryError;
      saveReceipt(db, existing);
      if (retryError) throw commitFailure(existing, retryError);
      return { consequence: existing.consequence, receiptId: existing.id, applied: true };
    }
    // An applied reversal whose documents have since moved on no longer
    // describes checked-in truth. Fall through and recompute, replacing the
    // stale receipt, so the guards below can refuse with a named reason rather
    // than replay a reversal that no longer matches the repository.
  }

  // Guards, file writes, and the post-write assertion all run under the same
  // workspace write interlock `transitionActionPointer` uses. Without it, a
  // pointer transition landing between this read and its write could be
  // overwritten by the restored receipt pointer. The Git commit stays outside
  // the transaction so a commit failure leaves the written documents for
  // recovery instead of rolling them back over a receipt.
  const prepared = writeTransaction(db, () => {
    const { project, plan, action } = resolveTarget(input.repoRoot, input.projectSlug, deferral.consequence.actionId);
    // The receipt names the Plan it parked the Action in. Resolving the Project's
    // *current* active Plan is only safe when it is still that Plan; otherwise a
    // different Plan holding the same Action id would be changed instead.
    if (plan.relativePath !== deferral.consequence.planPath) {
      throw validationError("The deferral names a different Plan than the Project now has active, so reversing it would change the wrong Plan.", {
        deferralPlan: deferral.consequence.planPath,
        activePlan: plan.relativePath,
        remedy: "Reactivate that Plan, or leave the deferral in place."
      });
    }
    if (action.status !== deferral.consequence.actionStatusAfter) {
      throw validationError("The Action's status has changed since the deferral, so reversing it would discard newer checked-in truth.", {
        action: action.id,
        deferralLeft: deferral.consequence.actionStatusAfter,
        current: action.status,
        remedy: "Reconcile the Action first, or leave the deferral in place."
      });
    }
    // Whether the current pointer still matches exactly where the deferral
    // left it. When it does, restoring the historical pointer is unambiguous
    // and always happens. When it does not, `keepPointer` decides whether to
    // refuse (the default) or un-park the Action without touching today's
    // pointer at all.
    let restorePointer = false;
    let currentPointer: string | null = null;
    let observedProjectPointer: string | null = null;
    let observedPlanPointer: string | null = null;
    if (deferral.consequence.pointerMoved) {
      // Both documents hold the pointer. Comparing only the effective one would
      // let a newer Plan pointer be overwritten by a stale Project pointer.
      const projectPointer = project.currentAction;
      const planPointer = plan.currentAction;
      currentPointer = projectPointer ?? planPointer;
      observedProjectPointer = projectPointer;
      observedPlanPointer = planPointer;
      restorePointer = projectPointer === deferral.consequence.pointerAfter && planPointer === deferral.consequence.pointerAfter;
      if (!restorePointer && !input.keepPointer) {
        throw validationError("The governed pointer has moved since the deferral, so reversing it would discard newer checked-in truth.", {
          deferralLeft: deferral.consequence.pointerAfter,
          projectPointer,
          planPointer,
          remedy: "Reconcile the pointer first, pass --keep-pointer to un-park the Action without touching it, or leave the deferral in place."
        });
      }
    }
    // Re-opening the Decision clears its answer, so refuse when a newer answer has
    // been recorded since the deferral rather than silently discarding it. A
    // receipt written before answers were recorded cannot prove this and skips the
    // exact check.
    if (input.decisionStatus !== "approved") {
      throw validationError("The Decision is no longer recorded as approved, so its deferral cannot be reversed.", {
        decision: input.decisionId,
        status: input.decisionStatus,
        remedy: "Re-answer the Decision, or leave the deferral in place."
      });
    }
    const recordedAnswer = deferral.consequence.decisionAnswer ?? null;
    const currentAnswer = input.decisionAnswer?.trim() ?? "";
    if (recordedAnswer !== null && currentAnswer.toLowerCase() !== recordedAnswer.trim().toLowerCase()) {
      throw validationError("The Decision has been answered differently since the deferral, so reversing it would discard that newer answer.", {
        decision: input.decisionId,
        recordedAnswer,
        currentAnswer: input.decisionAnswer,
        remedy: "Reconcile the Decision first, or leave the deferral in place."
      });
    }

    const pointerWillMove = deferral.consequence.pointerMoved && restorePointer;
    const pointerLeftInPlace = deferral.consequence.pointerMoved && !pointerWillMove;
    const actionKey = `${project.slug}/${action.id}`;
    const consequence: DecisionReversalConsequence = {
      kind: "reverse",
      actionId: action.id,
      actionKey,
      planPath: plan.relativePath,
      actionStatusBefore: deferral.consequence.actionStatusAfter,
      actionStatusAfter: deferral.consequence.actionStatusBefore,
      pointerBefore: deferral.consequence.pointerAfter,
      pointerAfter: pointerLeftInPlace ? currentPointer : deferral.consequence.pointerBefore,
      pointerMoved: pointerWillMove,
      pointerLeftInPlace,
      pointerLeftAtProject: pointerLeftInPlace ? observedProjectPointer : null,
      pointerLeftAtPlan: pointerLeftInPlace ? observedPlanPointer : null,
      reversesReceiptId: deferral.id
    };
    if (input.dryRun) {
      return { consequence, receipt: null as DecisionReversalReceipt | null };
    }

    const projectAbsolutePath = path.join(input.repoRoot, project.relativePath);
    const planAbsolutePath = path.join(input.repoRoot, plan.relativePath);
    const projectBefore = readFileSync(projectAbsolutePath, "utf8");
    const planBefore = readFileSync(planAbsolutePath, "utf8");
    const decisionBefore = readFileSync(input.decisionAbsolutePath, "utf8");

    let planAfter = setActionStatus(planBefore, action.id, consequence.actionStatusAfter);
    let projectAfter = projectBefore;
    if (consequence.pointerMoved && consequence.pointerAfter) {
      planAfter = replacePointer(planAfter, consequence.pointerAfter, "milestone");
      projectAfter = replacePointer(projectAfter, consequence.pointerAfter, "active_plan");
    }

    const mutations = [
      { absolutePath: input.decisionAbsolutePath, relativePath: input.decisionRelativePath, before: decisionBefore, after: input.decisionAfter },
      { absolutePath: planAbsolutePath, relativePath: plan.relativePath, before: planBefore, after: planAfter },
      ...(consequence.pointerMoved ? [{ absolutePath: projectAbsolutePath, relativePath: project.relativePath, before: projectBefore, after: projectAfter }] : [])
    ];

    if (tryGit(input.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === null) {
      throw validationError("The Project repository is on a detached HEAD, so the reversal commit would be unreachable from any branch.", {
        repoRoot: input.repoRoot,
        actionKey
      });
    }

    writeAllAtomically(mutations);
    try {
      assertPostReversalState(input.repoRoot, project.slug, consequence);
    } catch (error) {
      restoreAll(mutations);
      throw error;
    }

    const receipt: DecisionReversalReceipt = {
      id: `decisionrev_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
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
    return { consequence, receipt };
  });

  if (!prepared.receipt) {
    return { consequence: prepared.consequence, receiptId: null, applied: false };
  }
  const receipt = prepared.receipt;
  const commitError = receipt.changedPaths.length > 0
    ? commitDecisionReversal(input.repoRoot, receipt.changedPaths, receipt)
    : null;

  receipt.applied = commitError === null;
  receipt.commitError = commitError;
  saveReceipt(db, receipt);

  if (commitError) throw commitFailure(receipt, commitError);

  return { consequence: prepared.consequence, receiptId: receipt.id, applied: true };
}

/**
 * The latest applied deferral for a Decision, or the named one. A reversal
 * always targets an applied deferral; naming a receipt that is not one is a
 * named refusal rather than a silent no-op.
 */
export function findAppliedDeferralReceipt(
  db: Database.Database,
  decisionId: string,
  receiptId?: string
): DecisionDeferralReceipt | null {
  const rows = (receiptId
    ? db.prepare("SELECT receipt_json FROM decision_deferral_receipts WHERE id = ?").all(receiptId)
    : db.prepare("SELECT receipt_json FROM decision_deferral_receipts WHERE decision_id = ? ORDER BY created_at DESC").all(decisionId)
  ) as Array<{ receipt_json: string }>;
  if (receiptId && rows.length === 0) {
    throw validationError("No Decision consequence receipt matches this id.", { receiptId });
  }
  for (const row of rows) {
    let parsed: DecisionConsequenceReceipt;
    try {
      parsed = JSON.parse(row.receipt_json) as DecisionConsequenceReceipt;
    } catch {
      continue;
    }
    if (isDeferralReceipt(parsed) && parsed.applied) return parsed;
  }
  if (receiptId) {
    throw validationError("This receipt is not an applied deferral, so it cannot be reversed.", { receiptId });
  }
  return null;
}

function isDeferralReceipt(receipt: DecisionConsequenceReceipt): receipt is DecisionDeferralReceipt {
  return receipt.consequence.kind === "defer";
}

function isReversalReceipt(receipt: DecisionConsequenceReceipt): receipt is DecisionReversalReceipt {
  return receipt.consequence.kind === "reverse";
}

/**
 * True when checked-in documents still reflect the receipt's recorded reversal,
 * so replaying its request id is a genuine no-op rather than a fresh transition.
 * Both pointers and the receipt's Plan path are checked, so a retry cannot
 * replay a commit over state that moved on.
 */
function reversalReflectedOnDisk(
  repoRoot: string,
  projectSlug: string,
  receipt: DecisionReversalReceipt
): boolean {
  let target: ReturnType<typeof resolveTarget>;
  try {
    target = resolveTarget(repoRoot, projectSlug, receipt.consequence.actionId);
  } catch {
    return false;
  }
  const { project, plan, action } = target;
  if (plan.relativePath !== receipt.consequence.planPath) {
    return false;
  }
  if (action.status !== receipt.consequence.actionStatusAfter) {
    return false;
  }
  if (receipt.consequence.pointerMoved) {
    if (
      project.currentAction !== receipt.consequence.pointerAfter ||
      plan.currentAction !== receipt.consequence.pointerAfter
    ) {
      return false;
    }
  } else if (receipt.consequence.pointerLeftInPlace) {
    // The pointer was deliberately left untouched, but the receipt still
    // pins the exact value observed at write time, so further drift before a
    // retry is caught here instead of being silently swept into the retried
    // commit alongside the status change.
    if (
      project.currentAction !== receipt.consequence.pointerLeftAtProject ||
      plan.currentAction !== receipt.consequence.pointerLeftAtPlan
    ) {
      return false;
    }
  }
  const decisionAbsolutePath = path.join(repoRoot, receipt.decisionPath);
  if (!existsSync(decisionAbsolutePath)) {
    return false;
  }
  const { doc } = parseDoc(receipt.decisionPath, decisionAbsolutePath, readFileSync(decisionAbsolutePath, "utf8"));
  return doc?.type === "decision" && doc.status === "open";
}

/**
 * The documents are written, so re-read them and assert the reversal produced
 * exactly the intended truth. Anything else aborts the commit and restores
 * every document.
 */
function assertPostReversalState(
  repoRoot: string,
  projectSlug: string,
  consequence: DecisionReversalConsequence
): void {
  const after = resolveTarget(repoRoot, projectSlug, consequence.actionId);
  if (after.action.status !== consequence.actionStatusAfter) {
    throw validationError("Reversal did not restore the Action's status.", {
      action: consequence.actionId,
      expected: consequence.actionStatusAfter,
      actual: after.action.status
    });
  }
  if (consequence.pointerMoved) {
    const pointer = after.project.currentAction ?? after.plan.currentAction;
    if (pointer !== consequence.pointerAfter) {
      throw validationError("Reversal did not restore the governed pointer.", {
        expected: consequence.pointerAfter,
        actual: pointer
      });
    }
  }
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
 * True when checked-in documents still reflect the receipt's recorded
 * consequence, so replaying its request id is a genuine no-op rather than a
 * fresh transition. An Action revived after a deferral no longer matches, which
 * is what lets a re-opened Decision be deferred again (Issue #317).
 *
 * Checks the Decision's post-answer state too, so a retry cannot replay a commit
 * over a Decision that was since answered differently.
 */
function receiptReflectedOnDisk(
  repoRoot: string,
  projectSlug: string,
  receipt: DecisionDeferralReceipt
): boolean {
  let target: ReturnType<typeof resolveTarget>;
  try {
    target = resolveTarget(repoRoot, projectSlug, receipt.consequence.actionId);
  } catch {
    return false;
  }
  const { project, plan, action } = target;
  if (plan.relativePath !== receipt.consequence.planPath) {
    return false;
  }
  if (action.status !== receipt.consequence.actionStatusAfter) {
    return false;
  }
  if (receipt.consequence.pointerMoved) {
    const pointer = project.currentAction ?? plan.currentAction;
    if (pointer !== receipt.consequence.pointerAfter) {
      return false;
    }
  }
  const decisionAbsolutePath = path.join(repoRoot, receipt.decisionPath);
  if (!existsSync(decisionAbsolutePath)) {
    return false;
  }
  const { doc } = parseDoc(receipt.decisionPath, decisionAbsolutePath, readFileSync(decisionAbsolutePath, "utf8"));
  if (!doc || doc.type !== "decision" || doc.status !== "approved") {
    return false;
  }
  const recordedAnswer = receipt.consequence.decisionAnswer ?? null;
  if (recordedAnswer !== null && (doc.answer ?? "").trim().toLowerCase() !== recordedAnswer.trim().toLowerCase()) {
    return false;
  }
  return true;
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

function commitDecisionReversal(
  repoRoot: string,
  relativePaths: string[],
  receipt: DecisionReversalReceipt
): string | null {
  const { consequence } = receipt;
  const message = [
    `chore(arcadia): reverse Decision ${receipt.decisionId} deferral`,
    "",
    `- ${receipt.decisionPath}: re-opened the Decision.`,
    `- ${consequence.planPath}: ${consequence.actionKey} status ${consequence.actionStatusBefore} → ${consequence.actionStatusAfter}.`,
    consequence.pointerMoved
      ? `- pointer ${consequence.pointerBefore ?? "none"} → ${consequence.pointerAfter ?? "none"}.`
      : "- pointer unchanged.",
    "",
    `Written by \`arcadia decision reverse\` (${receipt.id}).`
  ].join("\n");
  return commitOnlyPaths(repoRoot, relativePaths, message);
}

function loadReceipt(db: Database.Database, requestId: string): DecisionConsequenceReceipt | null {
  const row = db.prepare("SELECT receipt_json FROM decision_deferral_receipts WHERE request_id = ?")
    .get(requestId) as { receipt_json: string } | undefined;
  return row ? JSON.parse(row.receipt_json) as DecisionConsequenceReceipt : null;
}

function saveReceipt(db: Database.Database, receipt: DecisionConsequenceReceipt): void {
  db.prepare(`INSERT OR REPLACE INTO decision_deferral_receipts
    (id, request_id, decision_id, decision_path, action_key, plan_path, applied, receipt_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(receipt.id, receipt.requestId, receipt.decisionId, receipt.decisionPath, receipt.actionKey,
      receipt.consequence.planPath, receipt.applied ? 1 : 0, JSON.stringify(receipt), receipt.createdAt);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
