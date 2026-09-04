import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { discoverDocs } from "../docs/discover.js";
import { isDispatchable, resolveActionReadiness, resolveDispatch } from "../docs/dispatch.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";
import { assertClean, git } from "../git/worktrees.js";

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
  return receipt;
}

function replacePointer(content: string, actionId: string, insertAfterField: string): string {
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

function writePairAtomically(
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
