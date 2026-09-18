import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { projectNotFound, validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getProject, getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import type { ClarificationConfidence, GapType, WorkItemStatus } from "../domain/constants.js";
import { discoverDocs } from "../docs/discover.js";
import { resolveActionReadiness } from "../docs/dispatch.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { parseDoc } from "../docs/parse.js";
import {
  DECISION_DOC_STATUSES,
  type DecisionDocStatus,
  type DecisionOptionDoc,
  type DecisionOptionEffect,
  type DocValidationError,
  type PlanDoc,
  type ProjectDoc
} from "../docs/types.js";
import { loadActionOrder } from "../dispatch/order.js";
import { transitionActionPointer } from "../dispatch/pointer.js";
import { commitOnlyPaths } from "../git/worktrees.js";
import { localDateStamp } from "../utils/time.js";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DECISION_FILENAME = /^(\d{4})-(.+)\.md$/;

/**
 * Every field an agent has actually gotten wrong writing a Decision by hand
 * this session: a status without an answer, an out-of-enum gap_type, and a
 * colon in free text breaking the frontmatter. `runDecisionNewCommand` and
 * `runDecisionApproveCommand` build the frontmatter deterministically and
 * validate it with the same `parseDoc` the CLI's own dispatch path uses
 * before ever writing to disk, so an agent can no longer produce a Decision
 * document that fails validation later. No model call, no full-repository
 * crawl — one file in, one file out.
 */
export interface DecisionNewOptionInput {
  label: string;
  consequence: string;
  recommended?: boolean;
  /** Optional machine-readable consequence a command applies when this option is chosen. */
  effect?: DecisionOptionEffect;
}

export interface DecisionNewOptions {
  workspace: string;
  project: string;
  slug: string;
  question: string;
  gapType?: GapType;
  recommendation?: string;
  confidence?: ClarificationConfidence;
  plan?: string;
  action?: string;
  /** Ordered choices the Decision is between. A Decision filed without any is still valid. */
  options?: DecisionNewOptionInput[];
}

export interface DecisionNewData {
  id: string;
  relativePath: string;
  absolutePath: string;
}

export function runDecisionNewCommand(options: DecisionNewOptions): CommandSuccess<DecisionNewData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  if (!SLUG_PATTERN.test(options.slug)) {
    throw validationError("`slug` must be lowercase kebab-case.", { slug: options.slug });
  }

  const repoRoot = resolveProjectRepo(workspacePath, options.project);
  const decisionsDir = path.join(repoRoot, "docs", "decisions");
  mkdirSync(decisionsDir, { recursive: true });

  const id = nextDecisionId(decisionsDir);
  const absolutePath = path.join(decisionsDir, `${id}-${options.slug}.md`);
  if (existsSync(absolutePath)) {
    throw validationError("A decision file with this id already exists.", { path: absolutePath });
  }

  const gapType = options.gapType ?? "missing-decision";
  const confidence = options.confidence ?? "medium";
  const today = localDateStamp();

  const frontmatter = [
    "---",
    "arcadia: v1",
    "type: decision",
    `id: "${id}"`,
    `slug: ${options.slug}`,
    `project: ${options.project}`,
    "status: open",
    `question: ${yamlScalar(options.question)}`,
    `gap_type: ${gapType}`,
    ...(options.recommendation ? [`recommendation: ${yamlScalar(options.recommendation)}`] : []),
    ...renderOptionsFrontmatter(options.options),
    `confidence: ${confidence}`,
    ...(options.plan ? [`plan: ${options.plan}`] : []),
    ...(options.action ? [`action: ${options.action}`] : []),
    `updated: ${today}`,
    "---"
  ].join("\n");

  const body = [
    "",
    `# Decision ${id}: ${titleFromSlug(options.slug)}`,
    "",
    ...renderOptionsBody(options.options),
    "## Context",
    "",
    options.question,
    "",
    "## Resolution",
    "",
    "Open.",
    ""
  ].join("\n");

  const content = `${frontmatter}\n${body}`;
  const relativePath = path.relative(repoRoot, absolutePath);
  failOnValidationErrors(parseDoc(relativePath, absolutePath, content).errors, "generated");

  writeFileSync(absolutePath, content, "utf8");

  return createSuccess({
    command: "decision.new",
    workspace: workspacePath,
    data: { id, relativePath, absolutePath }
  });
}

export interface DecisionApproveOptions {
  workspace: string;
  project: string;
  /** A decision's numeric id, slug, or exact filename. */
  id: string;
  answer: string;
  decided?: string;
  status?: DecisionDocStatus;
  /**
   * Report the consequence the answer would apply without writing anything.
   * A deferral names exactly which Action it would park and where the pointer
   * would land, so the operator approves a described transition rather than a
   * command whose effect they have to infer.
   */
  dryRun?: boolean;
  /** Idempotency key for the deferral's pointer transition; derived when omitted. */
  requestId?: string;
}

/**
 * What answering one Decision changed in the Project, beyond the Decision file
 * itself. This is Issue #310's missing half: before this, recording an answer
 * never touched the Action it governed, so a parked Action kept dispatching.
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
  /** The canonical pointer-transition receipt, when the pointer moved. */
  pointerReceiptId: string | null;
}

export interface DecisionApproveData {
  relativePath: string;
  absolutePath: string;
  applied: boolean;
  consequence: DecisionDeferralConsequence | null;
}

export function runDecisionApproveCommand(options: DecisionApproveOptions): CommandSuccess<DecisionApproveData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return withDatabase(workspacePath, (db) => {
    const repoRoot = resolveProjectRepoFromDb(db, options.project);
    const decisionsDir = path.join(repoRoot, "docs", "decisions");
    const absolutePath = findDecisionFile(decisionsDir, options.id);
    if (!absolutePath) {
      throw validationError("No decision file matches this id.", { id: options.id });
    }

    const status = options.status ?? "approved";
    if (!(DECISION_DOC_STATUSES as readonly string[]).includes(status)) {
      throw validationError(`status must be one of: ${DECISION_DOC_STATUSES.join(", ")}`, { status });
    }

    const raw = readFileSync(absolutePath, "utf8");
    const relativePath = path.relative(repoRoot, absolutePath);
    const { doc: existingDoc } = parseDoc(relativePath, absolutePath, raw);

    // A Decision that offered specific options records one of them, verbatim —
    // not a paraphrase that happens to mean the same thing. This is what makes
    // "which option was chosen" a fact the file states rather than a guess a
    // future reader makes from free text.
    let answer = options.answer;
    let chosen: DecisionOptionDoc | null = null;
    if (existingDoc && existingDoc.type === "decision" && existingDoc.options.length > 0) {
      chosen = existingDoc.options.find(
        (option) => option.label.trim().toLowerCase() === options.answer.trim().toLowerCase()
      ) ?? null;
      if (!chosen) {
        throw validationError("This Decision offers specific options; answer with one of their labels.", {
          answer: options.answer,
          labels: existingDoc.options.map((option) => option.label)
        });
      }
      answer = chosen.label;
    }

    const decisionDoc = existingDoc && existingDoc.type === "decision" ? existingDoc : null;

    // Applying the chosen option's effect is the point of this command for a
    // governed Action. It runs BEFORE the Decision file is written: the
    // canonical pointer transition refuses a dirty tree, and the Decision edit
    // is exactly what would dirty it.
    let consequence: DecisionDeferralConsequence | null = null;
    if (decisionDoc && chosen?.effect === "defer") {
      if (!decisionDoc.action) {
        throw validationError("This Decision's chosen option defers an Action, but the Decision names no `action:`.", {
          id: decisionDoc.id,
          remedy: "Add `action: <action-id>` to the Decision so its consequence can be applied."
        });
      }
      consequence = applyDeferralConsequence(db, {
        repoRoot,
        projectSlug: decisionDoc.project,
        decisionId: decisionDoc.id,
        actionId: decisionDoc.action,
        requestId: options.requestId ?? `decision-defer-${decisionDoc.id}`,
        dryRun: options.dryRun === true
      });
    }

    const updatedContent = setFrontmatterFields(raw, {
      status,
      answer,
      decided: options.decided ?? localDateStamp(),
      updated: localDateStamp()
    });

    failOnValidationErrors(parseDoc(relativePath, absolutePath, updatedContent).errors, "updated");

    if (options.dryRun) {
      return createSuccess({
        command: "decision.approve",
        workspace: workspacePath,
        data: { relativePath, absolutePath, applied: false, consequence }
      });
    }

    writeFileSync(absolutePath, updatedContent, "utf8");

    // Park the Action in its Plan when the answer deferred it, and land the
    // Decision edit and the Action field change as one commit. A failed commit
    // leaves both written documents recoverable, exactly as the settlement path
    // does; it is never silently dropped.
    // A plain Decision answer keeps its old contract: the Decision file is
    // written and nothing is committed. Only a deferral that actually parked an
    // Action lands, so its Action field change and pointer move are one
    // recoverable commit rather than loose working-tree state.
    if (consequence && consequence.actionStatusBefore !== consequence.actionStatusAfter) {
      const planAbsolutePath = path.join(repoRoot, consequence.planPath);
      const planRaw = readFileSync(planAbsolutePath, "utf8");
      writeFileSync(planAbsolutePath, setActionStatus(planRaw, consequence.actionId, "deferred"), "utf8");
      commitDecisionApproval(repoRoot, [consequence.planPath, relativePath], decisionDoc, consequence);
    }

    return createSuccess({
      command: "decision.approve",
      workspace: workspacePath,
      data: { relativePath, absolutePath, applied: true, consequence }
    });
  });
}

/**
 * Apply a deferral: park the Action the Decision names and, when it was the
 * governed pointer, advance the pointer to the next eligible Action in the
 * explicit queue through the one canonical pointer writer.
 *
 * Refuses rather than half-applying. Every refusal leaves the Decision and the
 * Action exactly as they were, per the Action's own acceptance criterion.
 */
function applyDeferralConsequence(
  db: Parameters<typeof loadActionOrder>[0],
  input: { repoRoot: string; projectSlug: string; decisionId: string; actionId: string; requestId: string; dryRun: boolean }
): DecisionDeferralConsequence {
  const discovered = discoverDocs(input.repoRoot);
  const project = discovered.docs.find(
    (doc): doc is ProjectDoc => doc.type === "project" && doc.slug === input.projectSlug
  );
  if (!project?.activePlan) {
    throw validationError("This Decision defers an Action, but its Project has no active Plan to park it in.", {
      project: input.projectSlug,
      action: input.actionId
    });
  }
  const plan = discovered.docs.find(
    (doc): doc is PlanDoc =>
      doc.type === "plan" && doc.project === project.slug && doc.slug === project.activePlan
  );
  if (!plan) {
    throw validationError("This Decision defers an Action, but the Project's active Plan document was not found.", {
      project: input.projectSlug,
      plan: project.activePlan
    });
  }
  const action = plan.actions.find((candidate) => candidate.id === input.actionId);
  if (!action) {
    throw validationError("This Decision defers an Action that is not in the Project's active Plan.", {
      action: input.actionId,
      plan: plan.slug
    });
  }

  const pointerBefore = project.currentAction ?? plan.currentAction;
  const pointerMoved = pointerBefore === action.id;
  const actionKey = `${project.slug}/${action.id}`;

  // Re-answering an already-deferred Action is idempotent: the Decision file
  // rewrite still happens, but no second Action or pointer effect is produced.
  if (action.status === "deferred") {
    return {
      kind: "defer",
      actionId: action.id,
      actionKey,
      planPath: plan.relativePath,
      actionStatusBefore: "deferred",
      actionStatusAfter: "deferred",
      pointerBefore,
      pointerAfter: pointerBefore,
      pointerMoved: false,
      pointerReceiptId: null
    };
  }

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
    actionStatusAfter: "deferred",
    pointerBefore,
    pointerAfter: pointerMoved ? nextActionId : pointerBefore,
    pointerMoved,
    pointerReceiptId: null
  };
  if (input.dryRun) {
    return consequence;
  }

  if (pointerMoved && nextActionId) {
    const queueRevision = loadActionOrder(db).revision;
    const targetKey = `${project.slug}/${nextActionId}`;
    const preview = transitionActionPointer(db, {
      repoRoot: input.repoRoot,
      projectSlug: project.slug,
      actionId: nextActionId,
      actionKey: targetKey,
      queueRevision,
      requestId: `${input.requestId}:pointer`
    });
    const applied = transitionActionPointer(db, {
      repoRoot: input.repoRoot,
      projectSlug: project.slug,
      actionId: nextActionId,
      actionKey: targetKey,
      queueRevision,
      requestId: `${input.requestId}:pointer`,
      previewFingerprint: preview.previewFingerprint,
      apply: true
    });
    consequence.pointerReceiptId = applied.id;
  }

  return consequence;
}

/**
 * The first Action, in the Project's explicit queue order, that is not done,
 * blocked, deferred, or the Action being parked, and whose own readiness is
 * clear. Unpositioned Actions keep Plan declaration order after positioned
 * ones, so a queue that has never been arranged is still deterministic.
 */
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

  // "Next" means the next eligible Action after the parked one in queue order;
  // if the parked Action was last, the earliest eligible Action takes the
  // pointer rather than leaving it stranded on parked work.
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

function commitDecisionApproval(
  repoRoot: string,
  relativePaths: string[],
  decisionDoc: { id: string; slug: string } | null,
  consequence: DecisionDeferralConsequence | null
): void {
  if (relativePaths.length === 0) return;
  const lines = [`chore(arcadia): answer Decision ${decisionDoc?.id ?? ""}`, ""];
  lines.push(`- ${relativePaths[0]}: recorded the Decision answer.`);
  if (consequence && consequence.actionStatusBefore !== consequence.actionStatusAfter) {
    lines.push(`- ${consequence.planPath}: ${consequence.actionKey} status ${consequence.actionStatusBefore} → ${consequence.actionStatusAfter}.`);
  }
  if (consequence?.pointerMoved) {
    lines.push(
      `- pointer advanced ${consequence.pointerBefore ?? "none"} → ${consequence.pointerAfter ?? "none"}` +
      (consequence.pointerReceiptId ? ` (${consequence.pointerReceiptId})` : "") + "."
    );
  }
  lines.push("", "Written by `arcadia decision approve`.");
  const error = commitOnlyPaths(repoRoot, relativePaths, lines.join("\n"));
  if (error) {
    process.stderr.write(`The Decision answer was written but the Action deferral could not be committed: ${error}\n`);
  }
}

export interface DecisionValidateOptions {
  workspace: string;
  project: string;
  id: string;
}

export interface DecisionValidateData {
  relativePath: string;
  valid: boolean;
  errors: DocValidationError[];
}

export function runDecisionValidateCommand(
  options: DecisionValidateOptions
): CommandSuccess<DecisionValidateData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = resolveProjectRepo(workspacePath, options.project);
  const decisionsDir = path.join(repoRoot, "docs", "decisions");
  const absolutePath = findDecisionFile(decisionsDir, options.id);
  if (!absolutePath) {
    throw validationError("No decision file matches this id.", { id: options.id });
  }

  const raw = readFileSync(absolutePath, "utf8");
  const relativePath = path.relative(repoRoot, absolutePath);
  const { errors } = parseDoc(relativePath, absolutePath, raw);

  return createSuccess({
    command: "decision.validate",
    workspace: workspacePath,
    data: { relativePath, valid: errors.length === 0, errors }
  });
}

function failOnValidationErrors(errors: DocValidationError[], stage: "generated" | "updated"): void {
  if (errors.length > 0) {
    throw validationError(`The ${stage} decision document failed validation; nothing was written.`, { errors });
  }
}

function resolveProjectRepo(workspacePath: string, projectIdOrSlug: string): string {
  return withDatabase(workspacePath, (db) => resolveProjectRepoFromDb(db, projectIdOrSlug));
}

function resolveProjectRepoFromDb(db: Parameters<typeof getProject>[0], projectIdOrSlug: string): string {
  const project = getProject(db, projectIdOrSlug) ?? getProjectBySlug(db, projectIdOrSlug);
  if (!project) {
    throw projectNotFound(projectIdOrSlug);
  }
  const metadata = getProjectMetadata(db, project.id);
  const repoPath = metadata?.repo_path?.trim();
  if (!repoPath) {
    throw validationError("This Project has no repo_path recorded; Decisions have nowhere to be written.", {
      project: projectIdOrSlug
    });
  }
  return repoPath;
}

function nextDecisionId(decisionsDir: string): string {
  let highest = 0;
  if (existsSync(decisionsDir)) {
    for (const entry of readdirSync(decisionsDir)) {
      const match = DECISION_FILENAME.exec(entry);
      if (match) {
        highest = Math.max(highest, Number.parseInt(match[1], 10));
      }
    }
  }
  return String(highest + 1).padStart(4, "0");
}

function findDecisionFile(decisionsDir: string, id: string): string | null {
  if (!existsSync(decisionsDir)) {
    return null;
  }
  const normalized = id.trim().toLowerCase();
  const numeric = /^\d+$/.test(normalized) ? normalized.padStart(4, "0") : null;
  for (const entry of readdirSync(decisionsDir)) {
    const match = DECISION_FILENAME.exec(entry);
    if (!match) {
      continue;
    }
    const [, fileId, fileSlug] = match;
    if (fileId === numeric || fileSlug === normalized || entry === normalized) {
      return path.join(decisionsDir, entry);
    }
  }
  return null;
}

export function renderDecisionNewSuccess(response: CommandSuccess<DecisionNewData>): string[] {
  return [
    `Decision ${response.data.id} created.`,
    `Path: ${response.data.relativePath}`,
    "Status: open"
  ];
}

export function renderDecisionApproveSuccess(response: CommandSuccess<DecisionApproveData>): string[] {
  const { applied, consequence } = response.data;
  const lines = [
    applied ? "Decision updated." : "Decision dry run (nothing written).",
    `Path: ${response.data.relativePath}`
  ];
  if (consequence) {
    lines.push(
      `${applied ? "Parked" : "Would park"} Action ${consequence.actionKey}: ` +
        `status ${consequence.actionStatusBefore} → ${consequence.actionStatusAfter}.`
    );
    if (consequence.pointerMoved) {
      lines.push(
        `${applied ? "Advanced" : "Would advance"} the pointer ` +
          `${consequence.pointerBefore ?? "none"} → ${consequence.pointerAfter ?? "none"}` +
          (consequence.pointerReceiptId ? ` (receipt ${consequence.pointerReceiptId})` : "") + "."
      );
    } else {
      lines.push("The pointer did not move (the deferred Action was not the current Action).");
    }
  }
  return lines;
}

export function renderDecisionValidateSuccess(response: CommandSuccess<DecisionValidateData>): string[] {
  if (response.data.valid) {
    return [`Valid: ${response.data.relativePath}`];
  }
  return [
    `Invalid: ${response.data.relativePath}`,
    ...response.data.errors.map((error) => `  ! [${error.field}]: ${error.message}`)
  ];
}

function renderOptionsFrontmatter(options: DecisionNewOptionInput[] | undefined): string[] {
  if (!options || options.length === 0) {
    return [];
  }
  const lines = ["options:"];
  for (const option of options) {
    lines.push(`  - label: ${yamlScalar(option.label)}`);
    lines.push(`    consequence: ${yamlScalar(option.consequence)}`);
    lines.push(`    recommended: ${option.recommended === true ? "true" : "false"}`);
    if (option.effect) {
      lines.push(`    effect: ${option.effect}`);
    }
  }
  return lines;
}

/**
 * An operator answering a Decision should be able to pick from this list
 * before ever reading the rationale in "## Context" below it.
 */
function renderOptionsBody(options: DecisionNewOptionInput[] | undefined): string[] {
  if (!options || options.length === 0) {
    return [];
  }
  const lines = ["## Options", ""];
  for (const option of options) {
    const suffix = option.recommended ? " (recommended)" : "";
    lines.push(`- **${option.label}**${suffix}: ${option.consequence}`);
  }
  lines.push("");
  return lines;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Targeted field edits on an existing document's frontmatter, rather than a
 * full YAML re-serialize — preserves every field an operator or a prior
 * agent wrote, in the order they wrote it, and only touches the fields this
 * call names. A field not already present is appended.
 */
function setFrontmatterFields(content: string, fields: Record<string, string>): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) {
    throw validationError("Document has no YAML frontmatter block to edit.");
  }
  const [, frontmatter, body] = match;
  const remaining = new Map(Object.entries(fields));

  const nextLines = frontmatter.split(/\r?\n/).map((line) => {
    const fieldMatch = /^([a-z_]+):/.exec(line);
    if (!fieldMatch || !remaining.has(fieldMatch[1])) {
      return line;
    }
    const key = fieldMatch[1];
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}: ${yamlScalar(value)}`;
  });

  for (const [key, value] of remaining) {
    nextLines.push(`${key}: ${yamlScalar(value)}`);
  }

  return `---\n${nextLines.join("\n")}\n---\n${body}`;
}
