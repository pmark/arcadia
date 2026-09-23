import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import { isDispatchable, resolveDispatch } from "../docs/dispatch.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";
import { assertClean, commitOnlyPaths, git, tryGit } from "../git/worktrees.js";
import { buildAgentQueue } from "./queue.js";
import { loadActionOrder, seedActionOrderFifo, type ActionOrderReceipt } from "./order.js";
import { resolvePlanActivation, projectActionKeys, type PlanActivationResolution } from "./planActivation.js";
import { writePairAtomically } from "./pointer.js";

export interface PlanActivationReceipt {
  id: string;
  requestId: string;
  actionKey: string;
  planSlug: string;
  queueRevision: number;
  previewFingerprint: string;
  repoRoot: string;
  headBefore: string;
  projectPath: string;
  planPath: string;
  previousPlan: string | null;
  previousAction: string | null;
  projectBeforeSha256: string;
  projectAfterSha256: string;
  planBeforeSha256: string;
  planAfterSha256: string;
  applied: boolean;
  /** Set when the pointer pair was written but its commit failed. */
  commitError?: string | null;
  createdAt: string;
}

/**
 * Activate one Plan and make one of its eligible Actions current, with the same
 * preview/apply/receipt discipline `transitionActionPointer` uses for the
 * in-Plan pointer move.
 *
 * Deliberately narrow: it only ever acts on the Action the queue resolver
 * selected and re-resolves that selection at apply time, so a changed document
 * or queue invalidates the preview instead of silently retargeting work. It
 * refuses a candidate whose Plan is not an approved `active` Plan and never
 * activates a `draft` by queue inference.
 */
export function activatePlan(db: Database.Database, input: {
  repoRoot: string;
  projectSlug: string;
  actionKey: string;
  queueRevision: number;
  requestId: string;
  previewFingerprint?: string;
  apply?: boolean;
}): PlanActivationReceipt {
  const existing = db.prepare(
    "SELECT action_key, queue_revision, receipt_json FROM action_queue_pointer_receipts WHERE request_id = ?"
  ).get(input.requestId) as { action_key: string; queue_revision: number; receipt_json: string } | undefined;
  if (existing) {
    if (existing.action_key !== input.actionKey || existing.queue_revision !== input.queueRevision) {
      throw validationError("Plan activation request id was already used for a different operation.", {
        requestId: input.requestId,
        originalActionKey: existing.action_key,
        requestedActionKey: input.actionKey
      });
    }
    return JSON.parse(existing.receipt_json) as PlanActivationReceipt;
  }

  const resolution = resolvePlanActivation({
    repoRoot: input.repoRoot,
    projectSlug: input.projectSlug,
    positions: loadActionOrder(db).positions
  });
  if (resolution.status === "ambiguous") {
    throw validationError("Plan activation is ambiguous; answer the named Decision before advancing.", {
      actionKey: input.actionKey,
      reason: resolution.reason
    });
  }
  if (!resolution.candidate || resolution.candidate.actionKey !== input.actionKey) {
    throw validationError("The explicit queue no longer selects this Action as the next Plan activation.", {
      requested: input.actionKey,
      selected: resolution.candidate?.actionKey ?? null,
      status: resolution.status,
      reason: resolution.reason
    });
  }
  const candidate = resolution.candidate;

  const discovered = discoverDocs(input.repoRoot);
  const project = discovered.docs.find(
    (doc): doc is ProjectDoc => doc.type === "project" && doc.slug.toLowerCase() === input.projectSlug.toLowerCase()
  );
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc =>
      doc.type === "plan" && doc.project.toLowerCase() === input.projectSlug.toLowerCase() && doc.slug === candidate.planSlug
  );
  if (!project || !plan) {
    throw validationError("Plan activation could not resolve its Project and Plan documents.", { actionKey: input.actionKey });
  }

  const projectAbsolutePath = path.join(input.repoRoot, project.relativePath);
  const planAbsolutePath = path.join(input.repoRoot, plan.relativePath);
  const projectBefore = readFileSync(projectAbsolutePath, "utf8");
  const planBefore = readFileSync(planAbsolutePath, "utf8");
  const projectAfter = setFrontmatterField(
    setFrontmatterField(projectBefore, "active_plan", plan.slug),
    "current_action",
    candidate.actionId
  );
  const planAfter = setFrontmatterField(
    setFrontmatterField(planBefore, "status", "active"),
    "current_action",
    candidate.actionId
  );
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
  if (input.apply && input.previewFingerprint !== undefined && input.previewFingerprint !== previewFingerprint) {
    throw validationError("Plan activation apply does not match the current preview.", {
      expectedPreviewFingerprint: previewFingerprint,
      receivedPreviewFingerprint: input.previewFingerprint ?? null,
      remedy: "Preview activation again, then apply that exact fingerprint against the current queue revision."
    });
  }

  const receipt: PlanActivationReceipt = {
    id: `qactivate_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    requestId: input.requestId,
    actionKey: input.actionKey,
    planSlug: plan.slug,
    queueRevision: input.queueRevision,
    previewFingerprint,
    repoRoot: input.repoRoot,
    headBefore,
    projectPath: project.relativePath,
    planPath: plan.relativePath,
    previousPlan: project.activePlan,
    previousAction: project.currentAction ?? plan.currentAction,
    projectBeforeSha256: sha256(projectBefore),
    projectAfterSha256: sha256(projectAfter),
    planBeforeSha256: sha256(planBefore),
    planAfterSha256: sha256(planAfter),
    applied: input.apply === true,
    createdAt: new Date().toISOString()
  };
  if (!input.apply) return receipt;

  assertClean(input.repoRoot, "Project repository");
  if (tryGit(input.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === null) {
    throw validationError("The Project repository is on a detached HEAD, so an activation commit would be unreachable from any branch.", {
      repoRoot: input.repoRoot,
      actionKey: input.actionKey,
      remedy: "Check out a branch in the Project repository before applying the Plan activation."
    });
  }
  writeTransaction(db, () => {
    const currentProject = readFileSync(projectAbsolutePath, "utf8");
    const currentPlan = readFileSync(planAbsolutePath, "utf8");
    if (sha256(currentProject) !== receipt.projectBeforeSha256 || sha256(currentPlan) !== receipt.planBeforeSha256) {
      throw validationError("Plan activation apply does not match the current preview.", {
        expectedPreviewFingerprint: previewFingerprint,
        receivedPreviewFingerprint: input.previewFingerprint ?? null,
        remedy: "Preview activation again, then apply that exact fingerprint against the current queue revision."
      });
    }
    // The queue revision is part of what the preview was computed against. A
    // reorder between preview and apply that leaves this same Action first
    // must still refuse, or the recorded receipt would claim an order the
    // operator never saw.
    const currentOrder = loadActionOrder(db);
    if (currentOrder.revision !== input.queueRevision) {
      throw validationError("Plan activation queue revision changed; refresh before applying.", {
        actionKey: input.actionKey,
        expectedRevision: input.queueRevision,
        actualRevision: currentOrder.revision
      });
    }
    writePairAtomically(projectAbsolutePath, projectBefore, projectAfter, planAbsolutePath, planBefore, planAfter);
    try {
      const dispatch = resolveDispatch(input.repoRoot, input.projectSlug);
      if (!isDispatchable(dispatch) || dispatch.context?.action.id !== candidate.actionId) {
        throw validationError("Plan activation did not produce dispatchable checked-in truth.", {
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
    } catch (error) {
      // Undo inside the workspace write interlock, and only the exact content
      // this call wrote: the CAS re-read above established nobody else moved
      // these files, so a newer concurrent write can never be clobbered.
      restorePairIfUnchanged(projectAbsolutePath, receipt.projectAfterSha256, projectBefore,
        planAbsolutePath, receipt.planAfterSha256, planBefore);
      throw error;
    }
  });
  const changedPaths = [
    receipt.projectBeforeSha256 === receipt.projectAfterSha256 ? null : receipt.projectPath,
    receipt.planBeforeSha256 === receipt.planAfterSha256 ? null : receipt.planPath
  ].filter((relative): relative is string => relative !== null);
  if (changedPaths.length > 0) {
    const commitError = commitActivation(input.repoRoot, changedPaths, receipt);
    if (commitError) {
      receipt.commitError = commitError;
      db.prepare("UPDATE action_queue_pointer_receipts SET receipt_json = ? WHERE id = ?").run(JSON.stringify(receipt), receipt.id);
      process.stderr.write(`Plan activation was written but could not be committed: ${commitError}\n`);
    }
  }
  return receipt;
}

/**
 * Run the one-time FIFO seed when the resolver found approved Actions that
 * have never been ordered, so the very next resolution is determined by the
 * queue rather than by document order. Returns the seed receipt, or null when
 * no seed was needed.
 */
export function seedActivationOrder(db: Database.Database, input: {
  repoRoot: string;
  projectSlug: string;
  requestId: string;
  apply?: boolean;
}): ActionOrderReceipt | null {
  const resolution = resolvePlanActivation({
    repoRoot: input.repoRoot,
    projectSlug: input.projectSlug,
    positions: loadActionOrder(db).positions
  });
  if (resolution.status !== "unordered") return null;
  return seedActionOrderFifo(db, {
    currentKeys: portfolioActionKeys(db),
    requestId: input.requestId,
    apply: input.apply
  });
}

/**
 * Seed the whole portfolio's explicit order in one previewed, reversible
 * operation, independent of which Project is being activated. This is the
 * standalone surface for Decision 0048's one-time FIFO seed.
 */
export function seedActionOrderForPortfolio(db: Database.Database, input: {
  requestId: string;
  apply?: boolean;
}): ActionOrderReceipt {
  return seedActionOrderFifo(db, {
    currentKeys: portfolioActionKeys(db),
    requestId: input.requestId,
    apply: input.apply
  });
}

/**
 * Every approved unfinished Action key the whole portfolio declares, in the
 * order the queue already projects, with Actions from approved Plans that the
 * queue has never shown appended after them.
 *
 * The FIFO seed rewrites the complete position table, so it must receive the
 * complete key set; handing it only one Project's keys would drop every other
 * Project's explicit order.
 */
function portfolioActionKeys(db: Database.Database): string[] {
  const keys = buildAgentQueue(db).ordered.flatMap((entry) => entry.orderKey ? [entry.orderKey] : []);
  const seen = new Set(keys);
  for (const project of listProjects(db).filter((candidate) => candidate.status === "active")) {
    const repoPath = getProjectMetadata(db, project.id)?.repo_path?.trim();
    if (!repoPath || !existsSync(repoPath)) continue;
    for (const key of projectActionKeys(repoPath, project.slug)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

export interface ActivateNextPlanResult {
  queueRevision: number;
  /** The FIFO seed receipt, when unpositioned work had to be frozen first. */
  seed: ActionOrderReceipt | null;
  /** The pointer transition receipt, null when the resolution was not a candidate. */
  activation: PlanActivationReceipt | null;
  resolution: PlanActivationResolution;
}

/**
 * Resolve and (optionally) perform the one cross-Plan activation the explicit
 * queue determines.
 *
 * Preview returns the resolution and, when a seed is required, its preview —
 * it writes nothing. Apply seeds first when needed, then re-resolves so the
 * activation is decided from the freshly-frozen order, and finally writes the
 * pointer pair with a durable receipt. A replay of the same request id returns
 * the same receipts and never advances twice.
 */
export function activateNextPlan(db: Database.Database, input: {
  repoRoot: string;
  projectSlug: string;
  requestId: string;
  apply?: boolean;
}): ActivateNextPlanResult {
  let resolution = resolvePlanActivation({
    repoRoot: input.repoRoot,
    projectSlug: input.projectSlug,
    positions: loadActionOrder(db).positions
  });
  if (resolution.status !== "unordered" && resolution.status !== "candidate") {
    return { queueRevision: loadActionOrder(db).revision, seed: null, activation: null, resolution };
  }
  if (resolution.status === "unordered" && !input.apply) {
    // Preview the seed but do not apply it: applying would bump the queue
    // revision, so an activation preview computed now would be stale.
    const seed = seedActivationOrder(db, { ...input, requestId: `${input.requestId}:seed`, apply: false });
    return { queueRevision: loadActionOrder(db).revision, seed, activation: null, resolution };
  }
  let seed: ActionOrderReceipt | null = null;
  if (resolution.status === "unordered") {
    seed = seedActivationOrder(db, { ...input, requestId: `${input.requestId}:seed`, apply: input.apply });
    resolution = resolvePlanActivation({
      repoRoot: input.repoRoot,
      projectSlug: input.projectSlug,
      positions: loadActionOrder(db).positions
    });
  }
  if (!resolution.candidate || (resolution.status !== "candidate" && resolution.status !== "unordered")) {
    return { queueRevision: loadActionOrder(db).revision, seed, activation: null, resolution };
  }
  const activation = activatePlan(db, {
    repoRoot: input.repoRoot,
    projectSlug: input.projectSlug,
    actionKey: resolution.candidate.actionKey,
    queueRevision: loadActionOrder(db).revision,
    requestId: input.requestId,
    apply: input.apply
  });
  return { queueRevision: loadActionOrder(db).revision, seed, activation, resolution };
}

/** Replace a top-level frontmatter field, inserting it before the closing `---` if absent. */
export function setFrontmatterField(content: string, field: string, value: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw validationError("Managed document has no YAML frontmatter block to update.");
  const lines = match[1].split(/\r?\n/);
  const pattern = new RegExp(`^${field}\\s*:`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index >= 0) {
    lines[index] = `${field}: ${value}`;
  } else {
    lines.push(`${field}: ${value}`);
  }
  return content.replace(match[0], `---\n${lines.join("\n")}\n---`);
}

function commitActivation(repoRoot: string, relativePaths: string[], receipt: PlanActivationReceipt): string | null {
  const message = [
    `chore(arcadia): activate ${receipt.planSlug} at ${receipt.actionKey}`,
    "",
    `- ${receipt.projectPath}: active_plan ${receipt.previousPlan ?? "none"} → ${receipt.planSlug}`,
    `- current_action ${receipt.previousAction ?? "none"} → ${receipt.actionKey}`,
    "",
    `Written by the total Arcadia Go transition resolver (${receipt.id}).`
  ].join("\n");
  return commitOnlyPaths(repoRoot, relativePaths, message);
}

function writeFileSyncSafe(filePath: string, content: string): void {
  try {
    writeFileSync(filePath, content, "utf8");
  } catch {
    // Best-effort restore; the filesystem error is the caller's to surface.
  }
}

/**
 * Restore each document to its pre-write content only when it still holds
 * exactly what this call wrote. A newer concurrent writer's content is left
 * alone, so an aborted activation can never clobber it. Called while the
 * workspace write interlock is held.
 */
function restorePairIfUnchanged(
  projectPath: string,
  projectAfterSha256: string,
  projectBefore: string,
  planPath: string,
  planAfterSha256: string,
  planBefore: string
): void {
  if (currentSha256(projectPath) === projectAfterSha256) writeFileSyncSafe(projectPath, projectBefore);
  if (currentSha256(planPath) === planAfterSha256) writeFileSyncSafe(planPath, planBefore);
}

function currentSha256(filePath: string): string | null {
  try {
    return sha256(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
