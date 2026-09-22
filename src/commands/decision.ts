import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { projectNotFound, validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { getProject, getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import type { ClarificationConfidence, GapType } from "../domain/constants.js";
import { yamlScalar } from "../docs/frontmatter.js";
import { parseDoc } from "../docs/parse.js";
import {
  DECISION_DOC_STATUSES,
  type DecisionDocStatus,
  type DecisionOptionDoc,
  type DecisionOptionEffect,
  type DocValidationError
} from "../docs/types.js";
import { applyDecisionDeferral, findAppliedDeferralReceipt, reverseDecisionDeferral, type DecisionDeferralConsequence, type DecisionReversalConsequence } from "../dispatch/decisionDeferral.js";
import { projectCheckoutFor } from "../git/worktrees.js";
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

export interface DecisionApproveData {
  relativePath: string;
  absolutePath: string;
  applied: boolean;
  /** What answering changed beyond the Decision file, when it deferred an Action. */
  consequence: DecisionDeferralConsequence | null;
  /** The durable deferral receipt id, when the answer applied a deferral. */
  receiptId: string | null;
}

/**
 * The state a Decision document will hold once an answer is recorded, computed
 * without writing anything.
 */
export interface PreparedDecisionAnswer {
  relativePath: string;
  absolutePath: string;
  /** Content as it is on disk now, so a caller can restore it after a later failure. */
  before: string;
  /** Content to write. */
  after: string;
  /** The offered option that was chosen, when the Decision offered any. */
  chosen: DecisionOptionDoc | null;
  /** The answer as recorded — an offered option's exact label when there were options. */
  answer: string;
  decisionId: string | null;
}

/**
 * Resolve a Decision document and compute the content that records `answer`,
 * refusing with a named reason when that cannot be done.
 *
 * This exists so that every path which answers a Decision writes the same
 * document the same way. `arcadia decision approve` and `arcadia review
 * approve` used to disagree: one wrote the checked-in document, the other
 * wrote only the workspace database and reported success, which left the file
 * saying `status: open` for a Decision the operator had already answered
 * (Issue #351, seen on Decisions 0058 and 0061).
 *
 * It writes nothing. The caller decides when to commit the returned content,
 * which lets a caller that also mutates the database order the two so they
 * cannot disagree.
 */
export function prepareDecisionAnswer(
  db: Parameters<typeof getProject>[0],
  input: {
    projectIdOrSlug: string;
    /** Decision id, slug, or filename — whatever `findDecisionFile` can match. */
    decisionRef: string;
    answer: string;
    status?: DecisionDocStatus;
    decided?: string;
  }
): PreparedDecisionAnswer {
  const recorded = input.answer.trim();
  if (!recorded) {
    throw validationError("Recording a Decision answer requires the answer text.", { decision: input.decisionRef });
  }

  const status = input.status ?? "approved";
  if (!(DECISION_DOC_STATUSES as readonly string[]).includes(status)) {
    throw validationError(`status must be one of: ${DECISION_DOC_STATUSES.join(", ")}`, { status });
  }

  const repoRoot = resolveProjectRepoFromDb(db, input.projectIdOrSlug);
  const decisionsDir = path.join(repoRoot, "docs", "decisions");
  const absolutePath = findDecisionFile(decisionsDir, input.decisionRef);
  if (!absolutePath) {
    throw validationError("No decision file matches this id.", {
      id: input.decisionRef,
      decision: input.decisionRef,
      decisionsDir,
      remedy: "This item names a Decision document that is not in the repository. Create it, or correct the reference, before recording an answer."
    });
  }

  const before = readFileSync(absolutePath, "utf8");
  const relativePath = path.relative(repoRoot, absolutePath);
  const { doc: existingDoc } = parseDoc(relativePath, absolutePath, before);
  const decisionDoc = existingDoc && existingDoc.type === "decision" ? existingDoc : null;

  // A Decision that offered specific options records one of them, verbatim —
  // not a paraphrase that happens to mean the same thing. This is what makes
  // "which option was chosen" a fact the file states rather than a guess a
  // future reader makes from free text.
  let answer = recorded;
  let chosen: DecisionOptionDoc | null = null;
  if (decisionDoc && decisionDoc.options.length > 0) {
    chosen = decisionDoc.options.find(
      (option) => option.label.trim().toLowerCase() === recorded.toLowerCase()
    ) ?? null;
    if (!chosen) {
      throw validationError("This Decision offers specific options; answer with one of their labels.", {
        answer: recorded,
        labels: decisionDoc.options.map((option) => option.label)
      });
    }
    answer = chosen.label;
  }

  const after = setFrontmatterFields(before, {
    status,
    answer,
    decided: input.decided ?? localDateStamp(),
    updated: localDateStamp()
  });

  failOnValidationErrors(parseDoc(relativePath, absolutePath, after).errors, "updated");

  return { relativePath, absolutePath, before, after, chosen, answer, decisionId: decisionDoc?.id ?? null };
}

export function runDecisionApproveCommand(options: DecisionApproveOptions): CommandSuccess<DecisionApproveData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return withDatabase(workspacePath, (db) => {
    const repoRoot = resolveProjectRepoFromDb(db, options.project);
    const status = options.status ?? "approved";
    const prepared = prepareDecisionAnswer(db, {
      projectIdOrSlug: options.project,
      decisionRef: options.id,
      answer: options.answer,
      status,
      decided: options.decided
    });
    const { relativePath, absolutePath, after: updatedContent, chosen } = prepared;
    const parsedDecision = parseDoc(relativePath, absolutePath, prepared.before).doc;
    const decisionDoc = parsedDecision && parsedDecision.type === "decision" ? parsedDecision : null;

    // Applying the chosen option's effect is the point of this command for a
    // governed Action. The Decision answer, the Action's parked status, and the
    // pointer move are written and committed together by one transition, then
    // validated against the post-deferral dispatch state before the commit.
    if (decisionDoc && chosen?.effect === "defer") {
      // Dispatch only honors a deferring Decision while its recorded status is
      // `approved` (`deferringDecisionFor`). Applying the effect under any other
      // status would write a parked Action and a moved pointer that no approved
      // Decision backs, so refuse the contradictory combination here (Issue #316).
      if (status !== "approved") {
        throw validationError(
          "This Decision's chosen option defers an Action, but the recorded status is not `approved`.",
          {
            id: decisionDoc.id,
            status,
            remedy: "Re-run with `--status approved`, or record the answer without the deferring option."
          }
        );
      }
      if (!decisionDoc.action) {
        throw validationError("This Decision's chosen option defers an Action, but the Decision names no `action:`.", {
          id: decisionDoc.id,
          remedy: "Add `action: <action-id>` to the Decision so its consequence can be applied."
        });
      }
      const result = applyDecisionDeferral(db, {
        repoRoot,
        projectSlug: decisionDoc.project,
        decisionId: decisionDoc.id,
        actionId: decisionDoc.action,
        requestId: options.requestId ?? `decision-defer-${decisionDoc.id}`,
        decisionAbsolutePath: absolutePath,
        decisionRelativePath: relativePath,
        decisionAfter: updatedContent,
        decisionAnswer: prepared.answer,
        dryRun: options.dryRun === true
      });
      return createSuccess({
        command: "decision.approve",
        workspace: workspacePath,
        data: {
          relativePath,
          absolutePath,
          applied: result.applied,
          consequence: result.consequence,
          receiptId: result.receiptId
        }
      });
    }

    if (options.dryRun) {
      return createSuccess({
        command: "decision.approve",
        workspace: workspacePath,
        data: { relativePath, absolutePath, applied: false, consequence: null, receiptId: null }
      });
    }

    // A plain Decision answer keeps its old contract: the Decision file is
    // written and nothing is committed. Only an applied deferral lands, so its
    // Action field change and pointer move are one recoverable commit.
    writeFileSync(absolutePath, updatedContent, "utf8");

    return createSuccess({
      command: "decision.approve",
      workspace: workspacePath,
      data: { relativePath, absolutePath, applied: true, consequence: null, receiptId: null }
    });
  });
}

export interface DecisionReverseOptions {
  workspace: string;
  project: string;
  /** A decision's numeric id, slug, or exact filename. */
  id: string;
  /** A specific deferral receipt to reverse; defaults to the latest applied one. */
  receipt?: string;
  /** Report the reversal without writing anything. */
  dryRun?: boolean;
  /** Idempotency key for the reversal transition; derived when omitted. */
  requestId?: string;
}

export interface DecisionReverseData {
  relativePath: string;
  absolutePath: string;
  applied: boolean;
  /** What reversing changed beyond the Decision file, when it reversed a deferral. */
  consequence: DecisionReversalConsequence | null;
  /** The durable reversal receipt id, when the reversal applied. */
  receiptId: string | null;
}

/**
 * Reverse an applied deferral in one governed transition, so a one-command
 * revival exists instead of restoring the before-state by hand. It re-opens the
 * Decision, un-parks the Action, and restores the pointer, writing and
 * committing all of it together. `--dry-run` previews it; a retry on the same
 * request id returns the recorded receipt; and it refuses, with a named reason
 * and nothing written, when the Action or pointer has moved on since the
 * deferral.
 */
export function runDecisionReverseCommand(options: DecisionReverseOptions): CommandSuccess<DecisionReverseData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  return withDatabase(workspacePath, (db) => {
    const repoRoot = resolveProjectRepoFromDb(db, options.project);
    const decisionsDir = path.join(repoRoot, "docs", "decisions");
    const absolutePath = findDecisionFile(decisionsDir, options.id);
    if (!absolutePath) {
      throw validationError("No decision file matches this id.", {
        id: options.id,
        decision: options.id,
        decisionsDir,
        remedy: "This item names a Decision document that is not in the repository. Create it, or correct the reference, before reversing it."
      });
    }

    const before = readFileSync(absolutePath, "utf8");
    const relativePath = path.relative(repoRoot, absolutePath);
    const { doc: parsed } = parseDoc(relativePath, absolutePath, before);
    const decisionDoc = parsed && parsed.type === "decision" ? parsed : null;
    if (!decisionDoc) {
      throw validationError("This file is not a valid Decision document, so its deferral cannot be reversed.", {
        path: relativePath
      });
    }

    const deferral = findAppliedDeferralReceipt(db, decisionDoc.id, options.receipt);
    if (!deferral) {
      throw validationError("This Decision has no applied deferral to reverse.", {
        id: decisionDoc.id,
        remedy: "Answer the Decision with a deferring option first, or name an applied --receipt."
      });
    }

    const requestId = options.requestId ?? `decision-reverse-${deferral.id}`;
    const decisionAfter = reopenDecision(before);
    failOnValidationErrors(parseDoc(relativePath, absolutePath, decisionAfter).errors, "updated");

    const result = reverseDecisionDeferral(db, {
      repoRoot,
      projectSlug: decisionDoc.project,
      decisionId: decisionDoc.id,
      decisionAbsolutePath: absolutePath,
      decisionRelativePath: relativePath,
      decisionAfter,
      decisionStatus: decisionDoc.status,
      decisionAnswer: decisionDoc.answer,
      deferral,
      requestId,
      dryRun: options.dryRun === true
    });

    return createSuccess({
      command: "decision.reverse",
      workspace: workspacePath,
      data: {
        relativePath,
        absolutePath,
        applied: result.applied,
        consequence: result.consequence,
        receiptId: result.receiptId
      }
    });
  });
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

/**
 * The checkout this command should read and write Decisions in.
 *
 * A Project records one `repo_path`, normally the main checkout, but a
 * Decision raised during an Action's Session lives on that Session's candidate
 * branch and exists nowhere else until the pull request merges. Resolving
 * `repo_path` unconditionally made such a Decision unanswerable from the one
 * place it exists: `decision approve` reported "No decision file matches this
 * id" while the file sat in the current worktree. `projectCheckoutFor` is the
 * same resolution `agent-ask settle` already uses, so a Decision is answered
 * where it lives and the answer ships in that Action's pull request.
 */
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
  return projectCheckoutFor(repoPath, process.cwd());
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
  const { applied, consequence, receiptId } = response.data;
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
          `${consequence.pointerBefore ?? "none"} → ${consequence.pointerAfter ?? "none"}.`
      );
    } else {
      lines.push("The pointer did not move (the deferred Action was not the current Action).");
    }
    if (receiptId) {
      lines.push(`Receipt: ${receiptId}`);
    }
  }
  return lines;
}

export function renderDecisionReverseSuccess(response: CommandSuccess<DecisionReverseData>): string[] {
  const { applied, consequence, receiptId } = response.data;
  const lines = [
    applied ? "Decision reversal applied." : "Decision reversal dry run (nothing written).",
    `Path: ${response.data.relativePath}`
  ];
  if (consequence) {
    lines.push(
      `${applied ? "Restored" : "Would restore"} Action ${consequence.actionKey}: ` +
        `status ${consequence.actionStatusBefore} → ${consequence.actionStatusAfter}.`
    );
    if (consequence.pointerMoved) {
      lines.push(
        `${applied ? "Restored" : "Would restore"} the pointer ` +
          `${consequence.pointerBefore ?? "none"} → ${consequence.pointerAfter ?? "none"}.`
      );
    } else {
      lines.push("The pointer did not move (the deferred Action was not the current Action).");
    }
    if (receiptId) {
      lines.push(`Receipt: ${receiptId}`);
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
 * Re-open an answered Decision: clear the answer and decided date, set status
 * back to `open`, and refresh `updated`. This is what makes a reversed deferral
 * stop parking its Action, since dispatch only honors a deferring Decision while
 * its recorded status is `approved`.
 */
function reopenDecision(content: string): string {
  return setFrontmatterFields(content, { status: "open", updated: localDateStamp() }, ["answer", "decided"]);
}

/**
 * Targeted field edits on an existing document's frontmatter, rather than a
 * full YAML re-serialize — preserves every field an operator or a prior
 * agent wrote, in the order they wrote it, and only touches the fields this
 * call names. A field not already present is appended; a field named in
 * `remove` is deleted.
 */
function setFrontmatterFields(content: string, fields: Record<string, string>, remove: string[] = []): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) {
    throw validationError("Document has no YAML frontmatter block to edit.");
  }
  const [, frontmatter, body] = match;
  const remaining = new Map(Object.entries(fields));
  const removed = new Set(remove);

  const nextLines: string[] = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const fieldMatch = /^([a-z_]+):/.exec(line);
    if (fieldMatch && removed.has(fieldMatch[1])) {
      continue;
    }
    if (!fieldMatch || !remaining.has(fieldMatch[1])) {
      nextLines.push(line);
      continue;
    }
    const key = fieldMatch[1];
    const value = remaining.get(key)!;
    remaining.delete(key);
    nextLines.push(`${key}: ${yamlScalar(value)}`);
  }

  for (const [key, value] of remaining) {
    if (removed.has(key)) {
      continue;
    }
    nextLines.push(`${key}: ${yamlScalar(value)}`);
  }

  return `---\n${nextLines.join("\n")}\n---\n${body}`;
}
