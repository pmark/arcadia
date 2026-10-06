/**
 * Checkpoint replay: does a preserved candidate's host Operator QA plan agree
 * with its pull request as GitHub reports it?
 *
 * Independent QA reads the pull request (GitHub's base, head and changed
 * files), and it reads the Operator QA plan host preservation wrote into the
 * body from the candidate's local Git facts (the launch base revision and the
 * diff from it). When those disagree -- Issue #987: Action 1 integrated into
 * the local base while GitHub's base stayed put, so Action 2's plan diffed from
 * the local base and listed fewer files than the PR -- QA fails the plan after
 * a full model review. This replay finds the same disagreement in seconds,
 * with no model, no network and no GitHub write.
 *
 * It copies the candidate repository into a throwaway mirror (the source is
 * only read), re-renders the plan through host preservation's own
 * `renderPreservedOperatorQaPlan` (the real renderer fed by the same Git
 * reads), and compares what that plan says (its base, its expected changed
 * files and count, its commit) with the PR metadata. Every mismatch is reported
 * with the exact differing values. Exit 0: consistent; 1: mismatch; 2: the
 * replay could not run (bad input, unreadable Git, refused plan).
 *
 * Usage (docs/qa-plan-consistency-replay.md):
 *   node --import tsx scripts/qa-plan-consistency.ts --repo <candidate repo> \
 *     --pr <evidence.json | QA attempt directory> [--receipt <receipt.json>] \
 *     [--commit <sha>] [--base <ref|sha>] [--branch <name>] [--base-branch <name>] \
 *     [--plan-source <json>] [--patch <candidate.patch>] [--json]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderPreservedOperatorQaPlan } from "../src/sessions/candidatePreservation.js";
import { operatorQaPlanSource, type OperatorQaPlanSource } from "../src/sessions/operatorQaPlan.js";

export const QA_PLAN_CONSISTENCY_SCHEMA = "arcadia-qa-plan-consistency-v1";

/** The PR as GitHub reports it: the `gh pr view --json` subset QA's evidence.json records. */
export interface PullRequestMetadata {
  number?: number;
  url?: string;
  baseRefName: string;
  baseRefOid: string;
  headRefName?: string;
  headRefOid: string;
  body?: string;
  files: Array<{ path: string; changeType?: string }>;
}

export interface QaPlanConsistencyInput {
  /** The candidate repository; only read (cloned into a throwaway mirror). */
  repositoryPath: string;
  pullRequest: PullRequestMetadata;
  /** Candidate commit; defaults to the PR head. */
  commit?: string;
  /** Launch base the host used (ref or sha); defaults to the local branch named by the PR base. */
  base?: string;
  /** Where `base` came from, for the report. */
  baseSource?: string;
  branch?: string;
  baseBranch?: string;
  /** Governed plan source; defaults to a placeholder (base and files do not depend on it). */
  planSource?: OperatorQaPlanSource;
  /** The patch the QA reviewer saw (GitHub compare patch), informational. */
  patch?: string;
}

export type Mismatch =
  | { check: "base-branch" | "base-revision" | "head-revision"; plan: string; pullRequest: string }
  | { check: "file-count"; plan: number; pullRequest: number }
  | { check: "files"; onlyInPlan: string[]; onlyInPullRequest: string[] }
  | { check: "file-status"; differences: Array<{ path: string; plan: string; pullRequest: string }> };

export interface QaPlanConsistencyReport {
  schema: typeof QA_PLAN_CONSISTENCY_SCHEMA;
  consistent: boolean;
  candidate: { repository: string; branch: string; commit: string; baseBranch: string; baseRevision: string; baseSource: string };
  plan: {
    baseBranch: string;
    baseRevision: string;
    commit: string;
    fileCount: number;
    files: Array<{ status: string; path: string }>;
    placeholderSource: boolean;
    /** Whether the PR body begins with exactly this re-rendered plan; null without a body. */
    matchesPublishedBody: boolean | null;
  };
  pullRequest: {
    number: number | null;
    url: string | null;
    baseRefName: string;
    baseRefOid: string;
    headRefName: string | null;
    headRefOid: string;
    fileCount: number;
    files: Array<{ changeType: string | null; path: string }>;
  };
  /** Informational: files the reviewer's patch touches, and whether they equal the PR's. */
  patch: { files: string[]; matchesPullRequest: boolean } | null;
  mismatches: Mismatch[];
  durationMs: number;
}

/** A replay that could not run: exit 2, never reported as consistent or inconsistent. */
export class ReplayInputError extends Error {}

const GITHUB_STATUS: Record<string, string> = { ADDED: "A", MODIFIED: "M", DELETED: "D" };

export function checkQaPlanConsistency(input: QaPlanConsistencyInput): QaPlanConsistencyReport {
  const started = Date.now();
  const pr = validatePullRequest(input.pullRequest);
  const source = path.resolve(input.repositoryPath);
  if (!existsSync(source)) throw new ReplayInputError(`Candidate repository ${source} does not exist.`);
  const scratch = mkdtempSync(path.join(tmpdir(), "arcadia-qa-plan-replay-"));
  try {
    // Isolated copy: every later Git read (and the host renderer's) runs here.
    const copy = path.join(scratch, "candidate.git");
    runGit(scratch, ["clone", "--mirror", "--quiet", source, copy]);
    const baseBranch = input.baseBranch ?? pr.baseRefName;
    const branch = input.branch ?? pr.headRefName ?? "(unknown branch)";
    const commit = resolveCommit(copy, input.commit ?? pr.headRefOid, "candidate commit");
    const baseRef = input.base ?? `refs/heads/${baseBranch}`;
    const baseRevision = resolveCommit(copy, baseRef, "base");
    const placeholderSource = input.planSource === undefined;
    const planSource = input.planSource ?? placeholderPlanSource(branch);

    const rendered = renderPreservedOperatorQaPlan(planSource, { repositoryPath: copy, branch, baseBranch, baseRevision, commitSha: commit });
    if (rendered.status === "refused") throw new ReplayInputError(`The host renderer refused the plan: ${rendered.reason}`);
    const plan = parseRenderedPlan(rendered.body);

    const mismatches = compare(plan, pr);
    const patchFiles = input.patch === undefined ? null : patchPaths(input.patch);
    const prPaths = pr.files.map((file) => file.path);
    return {
      schema: QA_PLAN_CONSISTENCY_SCHEMA,
      consistent: mismatches.length === 0,
      candidate: {
        repository: source, branch, commit, baseBranch, baseRevision,
        baseSource: input.baseSource ?? (input.base === undefined ? `local branch ${baseBranch} now` : `--base ${input.base}`)
      },
      plan: {
        ...plan,
        placeholderSource,
        matchesPublishedBody: typeof pr.body === "string" ? (pr.body === rendered.body || pr.body.startsWith(`${rendered.body}\n\n`)) : null
      },
      pullRequest: {
        number: pr.number ?? null,
        url: pr.url ?? null,
        baseRefName: pr.baseRefName,
        baseRefOid: pr.baseRefOid,
        headRefName: pr.headRefName ?? null,
        headRefOid: pr.headRefOid,
        fileCount: pr.files.length,
        files: pr.files.map((file) => ({ changeType: file.changeType ?? null, path: file.path }))
      },
      patch: patchFiles === null ? null : { files: patchFiles, matchesPullRequest: sameSet(patchFiles, prPaths) },
      mismatches,
      durationMs: Date.now() - started
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function compare(plan: ParsedPlan, pr: PullRequestMetadata): Mismatch[] {
  const mismatches: Mismatch[] = [];
  if (plan.baseBranch !== pr.baseRefName) mismatches.push({ check: "base-branch", plan: plan.baseBranch, pullRequest: pr.baseRefName });
  if (plan.baseRevision !== pr.baseRefOid) mismatches.push({ check: "base-revision", plan: plan.baseRevision, pullRequest: pr.baseRefOid });
  if (plan.commit !== pr.headRefOid) mismatches.push({ check: "head-revision", plan: plan.commit, pullRequest: pr.headRefOid });
  if (plan.fileCount !== pr.files.length) mismatches.push({ check: "file-count", plan: plan.fileCount, pullRequest: pr.files.length });
  // A plan over 200 files lists only the first 200; then only the count compares.
  if (plan.files.length !== plan.fileCount) return mismatches;
  const planPaths = new Set(plan.files.map((file) => file.path));
  const prPaths = new Set(pr.files.map((file) => file.path));
  const onlyInPlan = [...planPaths].filter((file) => !prPaths.has(file)).sort();
  const onlyInPullRequest = [...prPaths].filter((file) => !planPaths.has(file)).sort();
  if (onlyInPlan.length > 0 || onlyInPullRequest.length > 0) mismatches.push({ check: "files", onlyInPlan, onlyInPullRequest });
  // Only GitHub's unambiguous change types are compared; RENAMED, COPIED and
  // CHANGED have no single name-status letter under the plan's --no-renames.
  const differences: Array<{ path: string; plan: string; pullRequest: string }> = [];
  for (const file of pr.files) {
    const letter = file.changeType ? GITHUB_STATUS[file.changeType] : undefined;
    const planned = plan.files.find((candidate) => candidate.path === file.path);
    if (letter && planned && !planned.status.startsWith(letter)) {
      differences.push({ path: file.path, plan: planned.status, pullRequest: file.changeType! });
    }
  }
  if (differences.length > 0) mismatches.push({ check: "file-status", differences: differences.sort((a, b) => a.path.localeCompare(b.path)) });
  return mismatches;
}

interface ParsedPlan {
  baseBranch: string;
  baseRevision: string;
  commit: string;
  fileCount: number;
  files: Array<{ status: string; path: string }>;
}

/**
 * What the rendered plan tells the operator: its Base and Candidate lines and
 * the Step 2 "exactly N changed files" list. Read from the renderer's output,
 * not from its inputs, so a fix anywhere in the host rendering path shows here.
 */
export function parseRenderedPlan(body: string): ParsedPlan {
  const lines = body.split("\n");
  const base = codeSpans(lines.find((line) => line.startsWith("- **Base:** ")) ?? "");
  const candidate = codeSpans(lines.find((line) => line.startsWith("- **Candidate:** ")) ?? "");
  const countAt = lines.findIndex((line) => /^- \*\*Expected:\*\* exactly \d+ changed files?/.test(line));
  if (base.length !== 2 || candidate.length !== 2 || countAt < 0) {
    throw new ReplayInputError("The rendered plan has no Base, Candidate or Step 2 changed-file list to compare; the renderer's format changed.");
  }
  const fileCount = Number(/exactly (\d+) changed/.exec(lines[countAt])![1]);
  const files: Array<{ status: string; path: string }> = [];
  for (const line of lines.slice(countAt + 1)) {
    if (!line.startsWith("  - ")) break;
    if (line.startsWith("  - none:")) continue;
    const spans = codeSpans(line);
    if (spans.length !== 2) throw new ReplayInputError(`Unreadable changed-file line in the rendered plan: ${line}`);
    files.push({ status: spans[0], path: spans[1] });
  }
  if (files.length !== Math.min(fileCount, 200)) {
    throw new ReplayInputError(`The rendered plan lists ${files.length} of its ${fileCount} changed files; the renderer's format changed.`);
  }
  return { baseBranch: base[0], baseRevision: base[1], commit: candidate[1], fileCount, files };
}

/** Markdown code spans in one line, as `code()` in operatorQaPlan.ts writes them. */
function codeSpans(line: string): string[] {
  const spans: string[] = [];
  let at = 0;
  while (at < line.length) {
    const open = line.indexOf("`", at);
    if (open < 0) break;
    let width = 0;
    while (line[open + width] === "`") width += 1;
    const fence = "`".repeat(width);
    let close = line.indexOf(fence, open + width);
    while (close >= 0 && line[close + width] === "`") close = line.indexOf(fence, close + width + 1);
    if (close < 0) break;
    let text = line.slice(open + width, close);
    if (text.length > 1 && text.startsWith(" ") && text.endsWith(" ") && text.trim()) text = text.slice(1, -1);
    spans.push(text);
    at = close + width;
  }
  return spans;
}

/** Paths a GitHub compare patch (one mbox message per commit) touches. */
export function patchPaths(patch: string): string[] {
  const found = new Set<string>();
  for (const line of patch.split("\n")) {
    if (!line.startsWith("diff --git ")) continue;
    const rest = line.slice("diff --git ".length);
    const half = (rest.length - 5) / 2;
    const same = Number.isInteger(half) ? rest.slice(2, 2 + half) : null;
    if (same !== null && rest === `a/${same} b/${same}`) {
      found.add(same);
    } else {
      const split = rest.lastIndexOf(" b/");
      if (split > 2) {
        found.add(rest.slice(2, split));
        found.add(rest.slice(split + 3));
      }
    }
  }
  return [...found].sort();
}

function sameSet(left: string[], right: string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function placeholderPlanSource(branch: string): OperatorQaPlanSource {
  return {
    kind: "action-acceptance",
    actionKey: `replay/${branch}`,
    actionTitle: null,
    acceptanceCriteria: ["Replay placeholder: the Action's acceptance criteria were not supplied (--plan-source)."],
    validationCommands: []
  };
}

function validatePullRequest(value: unknown): PullRequestMetadata {
  const pr = value as Partial<PullRequestMetadata> | null;
  if (!pr || typeof pr.baseRefName !== "string" || typeof pr.baseRefOid !== "string" || typeof pr.headRefOid !== "string"
    || !Array.isArray(pr.files) || pr.files.some((file) => typeof file?.path !== "string")) {
    throw new ReplayInputError("PR metadata needs baseRefName, baseRefOid, headRefOid and files[].path, as `gh pr view --json` reports them.");
  }
  return pr as PullRequestMetadata;
}

function resolveCommit(repository: string, ref: string, label: string): string {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], { cwd: repository, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) throw new ReplayInputError(`The ${label} ${ref} is not a commit in the candidate repository.`);
  return result.stdout.trim();
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) {
    throw new ReplayInputError(`git ${args.join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  }
}

// --- CLI --------------------------------------------------------------------

export function formatReport(report: QaPlanConsistencyReport): string {
  const short = (sha: string) => sha.slice(0, 12);
  const lines = [
    `QA plan consistency: ${report.consistent ? "CONSISTENT" : `MISMATCH (${report.mismatches.length} ${report.mismatches.length === 1 ? "finding" : "findings"})`} in ${report.durationMs} ms`,
    `${"Candidate".padEnd(11)}${report.candidate.branch} at ${short(report.candidate.commit)}; host base ${report.candidate.baseBranch} at ${short(report.candidate.baseRevision)} (${report.candidate.baseSource})`,
    `${"Plan".padEnd(11)}base ${report.plan.baseBranch} at ${report.plan.baseRevision}; ${report.plan.fileCount} changed files`,
    `${(report.pullRequest.number === null ? "PR" : `PR #${report.pullRequest.number}`).padEnd(11)}base ${report.pullRequest.baseRefName} at ${report.pullRequest.baseRefOid}; ${report.pullRequest.fileCount} changed files; head ${short(report.pullRequest.headRefOid)}`
  ];
  for (const mismatch of report.mismatches) {
    switch (mismatch.check) {
      case "base-branch":
      case "base-revision":
      case "head-revision":
        lines.push(`- ${mismatch.check}: plan ${mismatch.plan}, PR ${mismatch.pullRequest}`);
        break;
      case "file-count":
        lines.push(`- file-count: plan ${mismatch.plan}, PR ${mismatch.pullRequest}`);
        break;
      case "files":
        if (mismatch.onlyInPlan.length) lines.push(`- files only in the plan: ${mismatch.onlyInPlan.join(", ")}`);
        if (mismatch.onlyInPullRequest.length) lines.push(`- files only in the PR: ${mismatch.onlyInPullRequest.join(", ")}`);
        break;
      case "file-status":
        lines.push(`- file-status: ${mismatch.differences.map((difference) => `${difference.path} plan ${difference.plan}, PR ${difference.pullRequest}`).join("; ")}`);
        break;
    }
  }
  const published = report.plan.matchesPublishedBody;
  lines.push(`Published plan: ${published === null ? "not compared (no PR body)" : published ? "identical to this re-render" : report.plan.placeholderSource ? "differs (expected: placeholder plan source; pass --plan-source)" : "differs from this re-render"}`);
  if (report.patch) lines.push(`Reviewer patch: ${report.patch.files.length} files, ${report.patch.matchesPullRequest ? "same set as the PR files" : "a different set from the PR files"} (informational)`);
  return lines.join("\n");
}

interface CliOptions { [flag: string]: string | true }

function parseArgs(argv: string[]): CliOptions {
  const known = new Set(["--repo", "--pr", "--receipt", "--commit", "--base", "--branch", "--base-branch", "--plan-source", "--patch", "--json"]);
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!known.has(flag)) throw new ReplayInputError(`Unknown argument ${flag}.`);
    if (flag === "--json") { options[flag] = true; continue; }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new ReplayInputError(`${flag} needs a value.`);
    options[flag] = value;
    index += 1;
  }
  return options;
}

function readJson(file: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    throw new ReplayInputError(`Cannot read ${label} ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A receipt row as `sqlite3 -readonly -json` prints it (array or object), or camelCase. */
function readReceipt(file: string): Record<string, string | undefined> {
  const raw = readJson(file, "receipt");
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
  if (!row || typeof row !== "object") throw new ReplayInputError(`Receipt ${file} holds no row.`);
  const pick = (...keys: string[]) => keys.map((key) => row[key]).find((value): value is string => typeof value === "string");
  // The branch the PR was opened against (Issue #987: a stacked PR's base is the
  // previous candidate's branch, not the Project base `base_branch` names). It
  // lives in the receipt JSON (`receipt_json` column, or a receipt object).
  let prBase: unknown = row.prBase;
  if (prBase === undefined && typeof row.receipt_json === "string") {
    try { prBase = (JSON.parse(row.receipt_json) as { prBase?: unknown }).prBase; } catch { /* malformed: fall back to base_branch */ }
  }
  const prBaseBranch = prBase && typeof prBase === "object" && typeof (prBase as { branch?: unknown }).branch === "string"
    ? (prBase as { branch: string }).branch : undefined;
  return {
    repository: pick("repository_path", "repositoryPath"),
    branch: pick("branch"),
    baseBranch: prBaseBranch ?? pick("base_branch", "baseBranch"),
    baseRevision: pick("base_revision", "baseRevision"),
    commit: pick("commit_sha", "commitSha")
  };
}

function readPlanSource(file: string): OperatorQaPlanSource {
  const raw = readJson(file, "plan source") as Record<string, unknown>;
  if (typeof raw?.actionKey !== "string") throw new ReplayInputError(`Plan source ${file} needs actionKey with action.acceptanceCriteria, or an OperatorQaPlanSource.`);
  if (raw.kind === "action-acceptance") {
    return operatorQaPlanSource({
      actionKey: raw.actionKey,
      action: { title: raw.actionTitle, acceptanceCriteria: raw.acceptanceCriteria },
      validationCommands: raw.validationCommands
    });
  }
  return operatorQaPlanSource({
    actionKey: raw.actionKey,
    action: raw.action as { title?: unknown; acceptanceCriteria?: unknown },
    validationCommands: raw.validationCommands
  });
}

export function runCli(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const options = parseArgs(argv);
    const value = (flag: string) => (typeof options[flag] === "string" ? options[flag] : undefined);
    const receipt = value("--receipt") ? readReceipt(value("--receipt")!) : {};
    const prArg = value("--pr");
    if (!prArg) throw new ReplayInputError("--pr <evidence.json | QA attempt directory> is required.");
    const attempt = existsSync(prArg) && statSync(prArg).isDirectory() ? prArg : null;
    const evidencePath = attempt ? path.join(attempt, "evidence.json") : prArg;
    const patchPath = value("--patch") ?? (attempt && existsSync(path.join(attempt, "candidate.patch")) ? path.join(attempt, "candidate.patch") : undefined);
    const repositoryPath = value("--repo") ?? receipt.repository;
    if (!repositoryPath) throw new ReplayInputError("--repo <candidate repository> is required (or a --receipt naming repository_path).");
    const base = value("--base") ?? receipt.baseRevision;
    const report = checkQaPlanConsistency({
      repositoryPath,
      pullRequest: readJson(evidencePath, "PR metadata") as PullRequestMetadata,
      commit: value("--commit") ?? receipt.commit,
      base,
      baseSource: value("--base") ? `--base ${value("--base")}` : receipt.baseRevision ? "receipt base_revision" : undefined,
      branch: value("--branch") ?? receipt.branch,
      baseBranch: value("--base-branch") ?? receipt.baseBranch,
      planSource: value("--plan-source") ? readPlanSource(value("--plan-source")!) : undefined,
      patch: patchPath ? readFileSync(patchPath, "utf8") : undefined
    });
    const stdout = options["--json"] ? `${JSON.stringify(report, null, 2)}\n` : `${formatReport(report)}\n`;
    return { exitCode: report.consistent ? 0 : 1, stdout, stderr: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 2, stdout: "", stderr: `qa-plan-consistency: ${message}\n` };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
