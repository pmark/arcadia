import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import { isDispatchable, resolveActionReadiness, resolveDispatch } from "../docs/dispatch.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";
import { assertClean, commitOnlyPaths, git, tryGit } from "../git/worktrees.js";

export interface PointerTransitionReceipt {
  id: string;
  requestId: string;
  actionKey: string;
  queueRevision: number;
  previewFingerprint: string;
  repoRoot: string;
  headBefore: string;
  projectPath: string;
  planPath: string;
  previousAction: string | null;
  nextAction: string;
  projectBeforeSha256: string;
  projectAfterSha256: string;
  planBeforeSha256: string;
  planAfterSha256: string;
  applied: boolean;
  /** Set when the pointer was written but its commit failed, so the operator is
   * told at the command instead of at the next refused settlement. Absent on a
   * successful commit (and on any receipt written before this field existed). */
  commitError?: string | null;
  createdAt: string;
}

export function transitionActionPointer(db: Database.Database, input: {
  repoRoot: string;
  projectSlug: string;
  actionId: string;
  actionKey: string;
  queueRevision: number;
  requestId: string;
  previewFingerprint?: string;
  apply?: boolean;
}): PointerTransitionReceipt {
  const existing = db.prepare("SELECT action_key, queue_revision, receipt_json FROM action_queue_pointer_receipts WHERE request_id = ?")
    .get(input.requestId) as { action_key: string; queue_revision: number; receipt_json: string } | undefined;
  if (existing) {
    if (existing.action_key !== input.actionKey || existing.queue_revision !== input.queueRevision) {
      throw validationError("Pointer transition request id was already used for a different operation.", {
        requestId: input.requestId,
        originalActionKey: existing.action_key,
        requestedActionKey: input.actionKey
      });
    }
    return JSON.parse(existing.receipt_json) as PointerTransitionReceipt;
  }
  const discovered = discoverDocs(input.repoRoot);
  const project = discovered.docs.find(
    (doc): doc is ProjectDoc => doc.type === "project" && doc.slug === input.projectSlug
  );
  if (!project || !project.activePlan) {
    throw validationError("Queued Action has no resolvable active Project plan.", { actionKey: input.actionKey });
  }
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc => doc.type === "plan" && doc.project === project.slug && doc.slug === project.activePlan
  );
  if (!plan || !plan.actions.some((action) => action.id === input.actionId && action.status !== "done")) {
    throw validationError("Queued Action is not unfinished work in the Project's active Plan.", { actionKey: input.actionKey });
  }
  const readiness = resolveActionReadiness(input.repoRoot, input.projectSlug, input.actionId);
  const responsibility = readiness.action?.responsibility;
  if (readiness.blockers.length > 0 || readiness.operatorQuestion || (responsibility !== "agent" && responsibility !== "autonomous")) {
    throw validationError("Queued Action is not eligible to become the governed pointer.", {
      actionKey: input.actionKey,
      responsibility,
      operatorQuestion: readiness.operatorQuestion,
      blockers: readiness.blockers
    });
  }

  const projectAbsolutePath = path.join(input.repoRoot, project.relativePath);
  const planAbsolutePath = path.join(input.repoRoot, plan.relativePath);
  const projectBefore = readFileSync(projectAbsolutePath, "utf8");
  const planBefore = readFileSync(planAbsolutePath, "utf8");
  const projectAfter = replacePointer(projectBefore, input.actionId, "active_plan");
  const planAfter = replacePointer(planBefore, input.actionId, "milestone");
  const headBefore = git(input.repoRoot, ["rev-parse", "HEAD"]).trim();
  const previewFingerprint = sha256(JSON.stringify({
    actionKey: input.actionKey,
    queueRevision: input.queueRevision,
    headBefore,
    projectBefore: sha256(projectBefore),
    projectAfter: sha256(projectAfter),
    planBefore: sha256(planBefore),
    planAfter: sha256(planAfter)
  }));
  if (input.apply && input.previewFingerprint !== previewFingerprint) {
    throw validationError("Pointer transition apply does not match the current preview.", {
      expectedPreviewFingerprint: previewFingerprint,
      receivedPreviewFingerprint: input.previewFingerprint ?? null,
      remedy: "Preview make-next again, then apply that exact fingerprint against the current queue revision."
    });
  }
  const receipt: PointerTransitionReceipt = {
    id: `qpointer_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    requestId: input.requestId,
    actionKey: input.actionKey,
    queueRevision: input.queueRevision,
    previewFingerprint,
    repoRoot: input.repoRoot,
    headBefore,
    projectPath: project.relativePath,
    planPath: plan.relativePath,
    previousAction: project.currentAction ?? plan.currentAction,
    nextAction: input.actionId,
    projectBeforeSha256: sha256(projectBefore),
    projectAfterSha256: sha256(projectAfter),
    planBeforeSha256: sha256(planBefore),
    planAfterSha256: sha256(planAfter),
    applied: input.apply === true,
    createdAt: new Date().toISOString()
  };
  if (!input.apply) return receipt;

  assertClean(input.repoRoot, "Project repository");
  // A detached HEAD would accept the commit and then lose it the moment HEAD
  // moves: the receipt would claim the governed pointer is durable from a commit
  // no branch reaches. Refuse before writing rather than report a hollow commit.
  if (tryGit(input.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === null) {
    throw validationError("The Project repository is on a detached HEAD, so a pointer commit would be unreachable from any branch.", {
      repoRoot: input.repoRoot,
      actionKey: input.actionKey,
      remedy: "Check out a branch in the Project repository before applying the pointer transition."
    });
  }
  try {
    db.transaction(() => {
      writePairAtomically(projectAbsolutePath, projectBefore, projectAfter, planAbsolutePath, planBefore, planAfter);
      const dispatch = resolveDispatch(input.repoRoot, input.projectSlug);
      if (!isDispatchable(dispatch) || dispatch.context?.action.id !== input.actionId) {
        throw validationError("Pointer transition did not produce dispatchable checked-in truth.", {
          actionKey: input.actionKey,
          blockers: dispatch.blockers,
          operatorQuestion: dispatch.operatorQuestion
        });
      }
      db.prepare(`INSERT INTO action_queue_pointer_receipts
        (id, request_id, action_key, fingerprint, queue_revision, repo_root, head_before, receipt_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(receipt.id, receipt.requestId, receipt.actionKey, previewFingerprint, input.queueRevision,
          input.repoRoot, headBefore, JSON.stringify(receipt), receipt.createdAt);
    })();
  } catch (error) {
    restorePair(projectAbsolutePath, projectBefore, planAbsolutePath, planBefore);
    throw error;
  }
  // Commit after the database transaction and outside its rollback handler, the
  // same split `commitSettlementOutput` uses: a Git failure must leave the
  // written documents intact for recovery rather than restore them over a
  // receipt that already claims they were applied.
  const changedPaths = [
    receipt.projectBeforeSha256 === receipt.projectAfterSha256 ? null : receipt.projectPath,
    receipt.planBeforeSha256 === receipt.planAfterSha256 ? null : receipt.planPath
  ].filter((relative): relative is string => relative !== null);
  if (changedPaths.length > 0) {
    const commitError = commitPointerTransition(input.repoRoot, changedPaths, receipt);
    if (commitError) {
      // The transition is already durable in the database and the working tree;
      // only landing it in Git failed. Record that on the receipt and say so at
      // the command, so the next clean-tree-gated settlement is not the first
      // place the operator learns the pointer was never committed.
      receipt.commitError = commitError;
      db.prepare("UPDATE action_queue_pointer_receipts SET receipt_json = ? WHERE id = ?").run(JSON.stringify(receipt), receipt.id);
      process.stderr.write(`The governed pointer was written but could not be committed: ${commitError}\n`);
    }
  }
  return receipt;
}

export interface PointerPairWriteReceipt {
  headBefore: string;
  attempts: number;
  /** True when a concurrent writer changed a document and this re-read it. */
  retried: boolean;
  projectBeforeSha256: string;
  projectAfterSha256: string;
  planBeforeSha256: string;
  planAfterSha256: string;
}

/**
 * Write the PROJECT.md + Plan pair atomically, re-reading both documents and
 * re-applying a pinned change whenever another writer changed either one since
 * the change was resolved.
 *
 * This is `transitionActionPointer`'s compare-and-set discipline — headBefore
 * plus both documents' content hashes, verified against fresh content at write
 * time — reused for the settlement path, without its eligibility rules: the
 * caller has already resolved the target, so a compare-and-set failure retries
 * against that same target rather than re-deriving one from fresh queue state,
 * which could silently retarget a different Action.
 *
 * `projectAfter`/`planAfter` are idempotent, target-pinned transforms, not the
 * resolved output: a retry re-reads only the base content for a fresh diff, so
 * a concurrent writer's unrelated change survives instead of being overwritten
 * by a stale computed result. `writePairAtomically` still performs the two
 * renames together, so a retry can never leave the documents pointing at
 * different Actions.
 */
export function writePointerPairWithCompareAndSet(input: {
  repoRoot: string;
  projectPath: string;
  planPath: string;
  projectBefore: string;
  planBefore: string;
  projectAfter: (current: string) => string;
  planAfter: (current: string) => string;
  /** Bound on re-reads when another writer keeps changing the documents. */
  maxAttempts?: number;
}): PointerPairWriteReceipt {
  const maxAttempts = input.maxAttempts ?? 5;
  const headBefore = git(input.repoRoot, ["rev-parse", "HEAD"]).trim();
  let expectedProject = sha256(input.projectBefore);
  let expectedPlan = sha256(input.planBefore);
  for (let attempt = 1; ; attempt += 1) {
    const projectCurrent = readFileSync(input.projectPath, "utf8");
    const planCurrent = readFileSync(input.planPath, "utf8");
    const projectCurrentSha = sha256(projectCurrent);
    const planCurrentSha = sha256(planCurrent);
    if (projectCurrentSha === expectedProject && planCurrentSha === expectedPlan) {
      const projectAfter = input.projectAfter(projectCurrent);
      const planAfter = input.planAfter(planCurrent);
      writePairAtomically(input.projectPath, projectCurrent, projectAfter, input.planPath, planCurrent, planAfter);
      return {
        headBefore,
        attempts: attempt,
        retried: attempt > 1,
        projectBeforeSha256: projectCurrentSha,
        projectAfterSha256: sha256(projectAfter),
        planBeforeSha256: planCurrentSha,
        planAfterSha256: sha256(planAfter)
      };
    }
    if (attempt >= maxAttempts) {
      throw validationError("Settlement pointer write kept losing the race to a concurrent writer.", {
        attempts: attempt,
        projectPath: input.projectPath,
        planPath: input.planPath,
        remedy: "Retry the settlement; the PROJECT.md/Plan pair kept changing underneath it."
      });
    }
    // A concurrent writer moved one of the documents between this settlement's
    // resolution read and now. Re-read and re-apply the same pinned change.
    expectedProject = projectCurrentSha;
    expectedPlan = planCurrentSha;
  }
}

/**
 * Commit the pointer documents one transition wrote, on whatever branch the
 * command ran from, and never push. Paths are passed explicitly so nothing
 * outside this transition can be swept into the commit, even though
 * `assertClean` already established there was nothing else to sweep. Returns
 * null on success or a message on failure; the caller records and surfaces it.
 */
function commitPointerTransition(
  repoRoot: string,
  relativePaths: string[],
  receipt: PointerTransitionReceipt
): string | null {
  const message = [
    `chore(arcadia): point at ${receipt.nextAction}`,
    "",
    `- ${receipt.projectPath}: current_action ${receipt.previousAction ?? "none"} → ${receipt.nextAction}`,
    `- ${receipt.planPath}: current_action → ${receipt.nextAction}`,
    "",
    `Written by \`arcadia advance queue make-next --apply\` (${receipt.id}).`
  ].join("\n");
  return commitOnlyPaths(repoRoot, relativePaths, message);
}

export function replacePointer(content: string, actionId: string, insertAfterField: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw validationError("Managed document has no YAML frontmatter block to update.");
  const lines = match[1].split(/\r?\n/);
  const currentIndex = lines.findIndex((line) => /^current_action\s*:/.test(line));
  if (currentIndex >= 0) {
    lines[currentIndex] = `current_action: ${actionId}`;
  } else {
    const insertAfter = lines.findIndex((line) => new RegExp(`^${insertAfterField}\\s*:`).test(line));
    if (insertAfter < 0) throw validationError("Managed document has no stable field beside which to insert current_action.");
    lines.splice(insertAfter + 1, 0, `current_action: ${actionId}`);
  }
  return content.replace(match[0], `---\n${lines.join("\n")}\n---`);
}

export function writePairAtomically(
  projectPath: string,
  projectBefore: string,
  projectAfter: string,
  planPath: string,
  planBefore: string,
  planAfter: string
): void {
  const projectTemp = `${projectPath}.arcadia-${process.pid}-${randomUUID()}`;
  const planTemp = `${planPath}.arcadia-${process.pid}-${randomUUID()}`;
  writeFileSync(projectTemp, projectAfter, "utf8");
  writeFileSync(planTemp, planAfter, "utf8");
  try {
    renameSync(projectTemp, projectPath);
    renameSync(planTemp, planPath);
  } catch (error) {
    restorePair(projectPath, projectBefore, planPath, planBefore);
    safeUnlink(projectTemp);
    safeUnlink(planTemp);
    throw error;
  }
}

function restorePair(projectPath: string, projectContent: string, planPath: string, planContent: string): void {
  writeFileSync(projectPath, projectContent, "utf8");
  writeFileSync(planPath, planContent, "utf8");
}

function safeUnlink(filePath: string): void {
  try { unlinkSync(filePath); } catch {}
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
