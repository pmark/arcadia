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
import { DECISION_DOC_STATUSES, type DecisionDocStatus, type DocValidationError } from "../docs/types.js";
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
}

export interface DecisionApproveData {
  relativePath: string;
  absolutePath: string;
}

export function runDecisionApproveCommand(options: DecisionApproveOptions): CommandSuccess<DecisionApproveData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const repoRoot = resolveProjectRepo(workspacePath, options.project);
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
  if (existingDoc && existingDoc.type === "decision" && existingDoc.options.length > 0) {
    const chosen = existingDoc.options.find(
      (option) => option.label.trim().toLowerCase() === options.answer.trim().toLowerCase()
    );
    if (!chosen) {
      throw validationError("This Decision offers specific options; answer with one of their labels.", {
        answer: options.answer,
        labels: existingDoc.options.map((option) => option.label)
      });
    }
    answer = chosen.label;
  }

  const updatedContent = setFrontmatterFields(raw, {
    status,
    answer,
    decided: options.decided ?? localDateStamp(),
    updated: localDateStamp()
  });

  failOnValidationErrors(parseDoc(relativePath, absolutePath, updatedContent).errors, "updated");

  writeFileSync(absolutePath, updatedContent, "utf8");

  return createSuccess({
    command: "decision.approve",
    workspace: workspacePath,
    data: { relativePath, absolutePath }
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
  return withDatabase(workspacePath, (db) => {
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
  });
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
  return [`Decision updated.`, `Path: ${response.data.relativePath}`];
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
