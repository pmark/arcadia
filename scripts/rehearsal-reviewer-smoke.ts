import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentAskDraftCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { discoverDocs } from "../src/docs/discover.js";
import type { PlanActionDoc, PlanDoc } from "../src/docs/types.js";
import { CHAIN_FIXTURE } from "../src/operatorActions/rehearsalChain.js";
import { runHostCommand, runQaPrReviewCommand, type QaPrReviewDependencies } from "../src/qa/prReview.js";
import { operatorQaPlanSource, renderOperatorQaPlan } from "../src/sessions/operatorQaPlan.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

/**
 * Rehearsal reviewer pre-flight smoke (maintained, N-neutral).
 *
 * Predicts whether the independent QA and code-review verdicts of a rehearsal's
 * Action will pass BEFORE the operator spends an operator-gated step. It builds
 * the rendered Action shape from the fixture itself (the fixture is only
 * cloned, never written), has the REAL `arcadia agent-ask settle` write the
 * settlement commit in a throwaway workspace, checks that commit
 * deterministically, and runs the real `runQaPrReviewCommand` reviewer path (QA
 * and code-review roles) with `gh` stubbed. Dry mode builds everything and runs
 * every deterministic assertion, but never invokes the reviewer model.
 *
 * Usage (see docs/reports/rehearsal-reviewer-smoke/README.md):
 *   mise exec -- node --import tsx scripts/rehearsal-reviewer-smoke.ts [--dry] [--spend-approved]
 *     [--fixture <path>] [--base <rev>] [--action <id>] [--qa <n>] [--code-review <n>]
 *     [--keep-going] [--out <dir>] [--live-workspace <path>]
 *
 * WRITES: only under `--out`. The reviewer path would write the operator's
 * global usage cache (~/.arcadia/telemetry/coding-agent-usage.json) and Claude
 * usage snapshot; for the reviewer phase those two paths are redirected to
 * files under `--out` (seeded with a copy of the current content, so reads are
 * unchanged) and the environment is restored afterwards.
 *
 * READS: the fixture (clone source and `git status`/HEAD checks), the live
 * workspace's preserved QA evidence (`artifacts/qa`), its `config/` reviewer
 * registries (copied into the throwaway workspace) and `artifacts/code-review`
 * listing; the operator's Codex rate-limit state through the Codex
 * app-server probe the availability check runs (a read; the Codex CLI keeps its
 * own state under ~/.codex, which this script does not control); the real host
 * sandbox preflight (a `curl` of api.github.com and `codex sandbox`).
 *
 * STUBS: `gh` (only `pr view --json <fields>`, `pr view --json commits` and the
 * compare patch are served, every other call is refused and fails the run) and
 * `git remote get-url` (answered with the fixture's GitHub name). In dry mode
 * only the two sandbox-preflight commands run for real and the reviewer model
 * process is intercepted; any other host command is refused (fail closed).
 * Settlement runs in process with `operator: true` and the throwaway clone as
 * the control checkout, not from a candidate worktree, with
 * ARCADIA_OPERATOR_SCRIPT_ID/ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR unset for its
 * duration (an exported operator context would refuse this settlement).
 */

export const DEFAULT_FIXTURE = "/Users/pmark/tmp/arcadia-three-action-rehearsal";
export const DEFAULT_LIVE_WORKSPACE = "/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover";
const BASE_SUBJECT = /^(Reopen |Reset the rehearsal fixture)/;
const SHA40 = /^[0-9a-f]{40}$/;
/** Paths a work commit never carries and the settlement commit may only touch. */
const GOVERNED = (file: string): boolean =>
  file.startsWith(".arcadia/") || file === "MISSION_LOG.md" || file === "PROJECT.md" || file.startsWith("docs/plans/");
const SMOKE_IDENTITY = { GIT_AUTHOR_NAME: "Rehearsal Reviewer Smoke", GIT_AUTHOR_EMAIL: "rehearsal-smoke@agents.arcadia.local" };
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class SmokeRefusal extends Error {}

/** The draft/settle step failed; carries what main needs to report a failed `settlement` assertion. */
export class SmokeSettlementFailure extends Error {
  constructor(message: string, readonly context: {
    out: string; mode: "dry" | "live"; fixture: string; liveWorkspace: string; actionId: string; requestId: string; baseRevision: string; before: LiveSnapshot;
  }) {
    super(message);
  }
}

export interface SmokeOptions {
  fixture: string;
  base?: string;
  action?: string;
  qa: number;
  codeReview: number;
  dry: boolean;
  spendApproved: boolean;
  /** Live mode only: keep buying reviewer calls after the first non-pass verdict. */
  keepGoing: boolean;
  out?: string;
  liveWorkspace: string;
}

export interface SmokeAssertion { name: string; pass: boolean; detail: string }

export interface SmokeCandidate {
  /** Stamped by buildSmokeCandidate; a live reviewer phase refuses a candidate not built live. */
  mode: "dry" | "live";
  out: string;
  /** The resolved, read-only fixture; the reviewer workspace registers it as the Project repository. */
  fixture: string;
  /** The throwaway clone holding the work and settlement commits. */
  repo: string;
  repository: string;
  actionId: string;
  requestId: string;
  baseRevision: string;
  workCommit: string;
  headCommit: string;
  headTree: string;
  evidenceSource: string;
  pullRequest: Record<string, unknown> & { url: string; headRefOid: string; baseRefOid: string };
  patch: string;
  commitOids: string[];
  validationCommands: string[];
  assertions: SmokeAssertion[];
  before: LiveSnapshot;
}

export interface LiveSnapshot {
  live: Record<string, string[]>;
  /** mtime and size of each global telemetry file the reviewer path could write, or "absent". */
  telemetry: Record<string, string>;
  fixtureStatus: string;
  fixtureHead: string;
}

export interface ReviewerCall {
  kind: "qa" | "code-review";
  attempt: number;
  verdict: string;
  dry: boolean;
  failed: Array<{ criterion: string; status: string; evidenceHead: string }>;
  findings: string[];
  note: string | null;
  elapsedMs: number;
}

const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string =>
  execFileSync("git", ["-c", "core.quotePath=false", "-C", cwd, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env }
  });
const tryGit = (cwd: string, args: string[]): string | null => { try { return git(cwd, args); } catch { return null; } };

/** Run `run` with some environment variables set (or deleted when undefined), restoring the previous values afterwards. */
export function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  const apply = (values: Record<string, string | undefined>): void => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(overrides);
  try { return run(); } finally { apply(previous); }
}

/** The global files the reviewer path's availability check writes, as availability.ts resolves them. */
export function telemetryPaths(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    ARCADIA_CODING_AGENT_USAGE_CACHE_PATH: env.ARCADIA_CODING_AGENT_USAGE_CACHE_PATH ?? path.join(homedir(), ".arcadia", "telemetry", "coding-agent-usage.json"),
    ARCADIA_CLAUDE_USAGE_PATH: env.ARCADIA_CLAUDE_USAGE_PATH ?? path.join(homedir(), ".arcadia", "telemetry", "claude-code.json")
  };
}

function walkFiles(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walkFiles(full, root) : [`${path.relative(root, full)} (${statSync(full).size}b)`];
  });
}

export function snapshotLive(options: Pick<SmokeOptions, "fixture" | "liveWorkspace">): LiveSnapshot {
  const artifacts = path.join(options.liveWorkspace, "artifacts");
  const telemetry: Record<string, string> = {};
  for (const file of Object.values(telemetryPaths())) {
    try { const stat = statSync(file); telemetry[file] = `${stat.mtimeMs}:${stat.size}`; } catch { telemetry[file] = "absent"; }
  }
  return {
    live: { qa: walkFiles(path.join(artifacts, "qa")), "code-review": walkFiles(path.join(artifacts, "code-review")) },
    telemetry,
    fixtureStatus: tryGit(options.fixture, ["--no-optional-locks", "status", "--porcelain"]) ?? "(unreadable)",
    fixtureHead: tryGit(options.fixture, ["--no-optional-locks", "rev-parse", "HEAD"])?.trim() ?? "(unreadable)"
  };
}

function sameList(a: string[], b: string[]): boolean { return a.length === b.length && a.every((value, i) => value === b[i]); }

/** The "inputs the script must only read" assertion, over a snapshot taken before and one taken now. */
function readOnlyInputsAssertion(before: LiveSnapshot, after: LiveSnapshot): SmokeAssertion {
  const liveSame = Object.keys(before.live).every((key) => sameList(before.live[key], after.live[key] ?? []));
  const telemetrySame = Object.keys(before.telemetry).every((key) => before.telemetry[key] === after.telemetry[key]);
  const fixtureSame = before.fixtureStatus === after.fixtureStatus && before.fixtureHead === after.fixtureHead;
  const detail = [
    `live artifacts ${Object.entries(after.live).map(([key, list]) => `${key}: ${list.length} file(s)`).join(", ")}${liveSame ? "" : " CHANGED"}`,
    `global telemetry ${Object.keys(after.telemetry).length} file(s)${telemetrySame ? " unchanged" : " CHANGED"}`,
    `fixture HEAD ${after.fixtureHead.slice(0, 12)}; status --porcelain ${after.fixtureStatus.trim() === "" ? "clean" : "NOT clean"}${fixtureSame ? " unchanged" : " CHANGED"}`
  ].join("; ");
  return { name: "read-only-inputs-unchanged", pass: liveSame && telemetrySame && fixtureSame, detail };
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realOrResolved(value: string): string {
  try { return realpathSync(value); } catch { return path.resolve(value); }
}

/** The newest preserved attempt's evidence.json whose PR body carries a validation-evidence tail. */
function newestPreservedEvidence(liveWorkspace: string, repository: string): { file: string; evidence: Record<string, any> } | null {
  const root = path.join(liveWorkspace, "artifacts/qa/pull-requests", repository.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"));
  const attempts: Array<{ name: string; file: string }> = [];
  try {
    for (const pr of readdirSync(root)) for (const head of readdirSync(path.join(root, pr))) {
      const dir = path.join(root, pr, head, "attempts");
      if (existsSync(dir)) for (const name of readdirSync(dir)) attempts.push({ name, file: path.join(dir, name, "evidence.json") });
    }
  } catch { return null; }
  for (const attempt of attempts.sort((a, b) => b.name.localeCompare(a.name))) {
    try {
      const evidence = JSON.parse(readFileSync(attempt.file, "utf8"));
      if (typeof evidence.body === "string" && evidence.body.includes("\n\n### Validation evidence")) return { file: attempt.file, evidence };
    } catch { /* walk back */ }
  }
  return null;
}

function githubRepository(fixture: string): string {
  try {
    const configured = JSON.parse(readFileSync(path.join(fixture, ".arcadia-three-action-rehearsal.json"), "utf8")).githubRepository;
    if (typeof configured === "string" && /^[^/\s]+\/[^/\s]+$/.test(configured)) return configured;
  } catch { /* fall back to the remote */ }
  const remote = tryGit(fixture, ["--no-optional-locks", "config", "--get", "remote.origin.url"])?.trim() ?? "";
  const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (match) return match[1];
  throw new SmokeRefusal("The fixture names no GitHub repository: neither .arcadia-three-action-rehearsal.json githubRepository nor a github.com origin remote.");
}

function fixtureValidationCommand(fixture: string): string | null {
  try {
    const value = JSON.parse(readFileSync(path.join(fixture, ".arcadia-three-action-rehearsal.json"), "utf8")).validationCommand;
    return typeof value === "string" && value.trim() ? value : null;
  } catch { return null; }
}

/** Every distinct completion request id (`complete-<action>-<tag>`) the Plan's next_action names, in order. */
export function completionRequestIds(actionId: string, nextAction: string | null): string[] {
  const pattern = new RegExp(`complete-${escapeRegExp(actionId)}-[A-Za-z0-9][A-Za-z0-9._-]*`, "g");
  return [...new Set([...(nextAction ?? "").matchAll(pattern)].map((match) => match[0].replace(/[._-]+$/, "")))];
}

/** The first completion request id the Plan names (kept for callers that need one). */
export function completionRequestId(actionId: string, nextAction: string | null): string | null {
  return completionRequestIds(actionId, nextAction)[0] ?? null;
}

function planAt(repo: string): PlanDoc {
  const found = discoverDocs(repo);
  const plan = found.docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.relativePath === CHAIN_FIXTURE.planFile);
  if (!plan) {
    throw new SmokeRefusal(`No Plan document at ${CHAIN_FIXTURE.planFile}${found.errors.length ? `; discovery errors: ${found.errors.map((e) => `${e.relativePath}: ${e.message}`).join("; ")}` : ""}.`);
  }
  return plan;
}

function assertion(name: string, pass: boolean, detail: string): SmokeAssertion { return { name, pass, detail }; }

/** Steps (a) to (e): clone, work commit, real settlement, deterministic assertions, PR evidence. */
export function buildSmokeCandidate(options: SmokeOptions): SmokeCandidate {
  if (!options.dry && !options.spendApproved) {
    throw new SmokeRefusal("A live run makes real reviewer-model calls (quota or spend) and needs the operator's own yes: pass --spend-approved only after the operator has said yes to that spend. Use --dry to build and check everything without a model call.");
  }
  const mode: "dry" | "live" = options.dry ? "dry" : "live";
  const fixture = path.resolve(options.fixture);
  if (!existsSync(path.join(fixture, ".git"))) throw new SmokeRefusal(`The fixture ${fixture} is not a Git repository.`);
  const repository = githubRepository(fixture);
  const before = snapshotLive({ fixture, liveWorkspace: options.liveWorkspace });

  const out = options.out ? path.resolve(options.out) : mkdtempSync(path.join(tmpdir(), "rehearsal-reviewer-smoke-"));
  for (const [what, protectedPath] of [["the fixture", fixture], ["the live workspace", path.resolve(options.liveWorkspace)]] as const) {
    if (isInside(out, protectedPath) || isInside(realOrResolved(out), realOrResolved(protectedPath))) {
      throw new SmokeRefusal(`--out ${out} is inside ${what} (${protectedPath}); the script writes only under --out, so pass a directory elsewhere.`);
    }
  }
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length > 0) throw new SmokeRefusal(`--out ${out} is not empty; pass a fresh directory.`);

  // (a) clone the fixture; only the clone is ever written. Point its origin at GitHub's name so nothing can reach the fixture.
  const repo = path.join(out, "repo");
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--", fixture, repo], { stdio: ["ignore", "pipe", "pipe"] });
  const tip = git(repo, ["rev-parse", "HEAD"]).trim();
  const branch = tryGit(repo, ["symbolic-ref", "--short", "HEAD"])?.trim() || "main";
  git(repo, ["remote", "set-url", "origin", `https://github.com/${repository}.git`]);
  for (const [key, value] of [["user.name", SMOKE_IDENTITY.GIT_AUTHOR_NAME], ["user.email", SMOKE_IDENTITY.GIT_AUTHOR_EMAIL], ["core.hooksPath", "/dev/null"], ["commit.gpgsign", "false"]]) {
    git(repo, ["config", key, value]);
  }

  const history = git(repo, ["log", "--format=%H%x09%s", tip]).trim().split("\n").map((line) => {
    const [sha, ...subject] = line.split("\t");
    return { sha, subject: subject.join("\t") };
  });
  let baseRevision: string;
  if (options.base) {
    const resolved = tryGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${options.base}^{commit}`])?.trim();
    if (!resolved || !SHA40.test(resolved)) throw new SmokeRefusal(`--base ${options.base} is not a commit in the fixture.`);
    baseRevision = resolved;
  } else {
    const found = history.find((entry) => BASE_SUBJECT.test(entry.subject));
    if (!found) throw new SmokeRefusal("The fixture history has no commit whose subject starts with `Reopen ` or `Reset the rehearsal fixture`; pass --base <rev>.");
    baseRevision = found.sha;
  }
  git(repo, ["checkout", "--quiet", "-B", branch, baseRevision, "--"]);

  const basePlan = planAt(repo);
  const baseActions = basePlan.actions.map((action) => ({ id: action.id, status: action.status, nextAction: action.nextAction }));
  const action: PlanActionDoc | undefined = options.action
    ? basePlan.actions.find((entry) => entry.id === options.action)
    : basePlan.actions.find((entry) => entry.status !== "done");
  if (!action) {
    throw new SmokeRefusal(options.action
      ? `Action ${options.action} is not in ${CHAIN_FIXTURE.planFile} at ${baseRevision.slice(0, 12)}.`
      : `Every Action in ${CHAIN_FIXTURE.planFile} is done at ${baseRevision.slice(0, 12)}; pass --action <id> or --base <rev>.`);
  }
  // The first id next_action names that has no archived Ask at the base; the first named id when every one has.
  const requestIds = completionRequestIds(action.id, action.nextAction);
  const requestId = requestIds.find((id) => tryGit(repo, ["cat-file", "-e", `${baseRevision}:.arcadia/asks/archive/agent-ask-${id}.yaml`]) === null) ?? requestIds[0];
  if (!requestId) {
    throw new SmokeRefusal(`Action ${action.id}'s next_action at ${baseRevision.slice(0, 12)} names no completion request id (complete-${action.id}-<tag>).`);
  }
  if (action.acceptanceCriteria.length === 0) throw new SmokeRefusal(`Action ${action.id} declares no acceptance criteria.`);

  // (b) work commit: the newest merged candidate's product files, replayed as one commit on the base.
  const subject = new RegExp(`^Candidate: ${escapeRegExp(action.id)}( |$)`);
  const candidate = history.find((entry) => subject.test(entry.subject));
  if (!candidate) throw new SmokeRefusal(`The fixture history has no merged candidate commit "Candidate: ${action.id}"; nothing to replay as the work commit.`);
  const changed = git(repo, ["diff", "--name-status", "--no-renames", "-z", `${candidate.sha}^`, candidate.sha, "--"]).split("\0").filter(Boolean);
  const product: Array<{ status: string; path: string }> = [];
  for (let i = 0; i + 1 < changed.length; i += 2) if (!GOVERNED(changed[i + 1])) product.push({ status: changed[i][0], path: changed[i + 1] });
  if (product.length === 0) throw new SmokeRefusal(`Candidate ${candidate.sha.slice(0, 12)} for ${action.id} changes only governed records; it has no product files to replay.`);
  for (const file of product) {
    if (file.status === "D") git(repo, ["rm", "--quiet", "--force", "--", file.path]);
    else git(repo, ["checkout", candidate.sha, "--", file.path]);
  }
  git(repo, ["commit", "--quiet", "-m", `Implement ${action.id} (reviewer smoke replay of ${candidate.sha.slice(0, 12)})`], { ...SMOKE_IDENTITY, GIT_COMMITTER_NAME: SMOKE_IDENTITY.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: SMOKE_IDENTITY.GIT_AUTHOR_EMAIL });
  const workCommit = git(repo, ["rev-parse", "HEAD"]).trim();

  // (c) settlement: the real Agent Ask draft, preview and settle, in a throwaway workspace. Any failure here is a
  // failed deterministic assertion named `settlement`, reported by main with the gate FAIL.
  const failure = { out, mode, fixture, liveWorkspace: options.liveWorkspace, actionId: action.id, requestId, baseRevision, before };
  const ask = [
    "agent_ask: v1", `request_id: ${requestId}`, `project: ${basePlan.project}`, "intent: complete",
    `target_ref: action/${action.id}`, `desired_result: ${JSON.stringify(`Accept the completion evidence for ${action.id}`)}`,
    `rationale: ${JSON.stringify("Reviewer smoke: every declared criterion is met by the replayed candidate.")}`,
    `candidate_revision: ${workCommit}`, "evidence:",
    ...action.acceptanceCriteria.flatMap((criterion) => [
      `  - criterion: ${JSON.stringify(criterion)}`, "    status: met", `    note: ${JSON.stringify("Replayed from the fixture's merged candidate.")}`
    ]),
    "requested_authority: apply_if_approved", ""
  ].join("\n");
  try {
    const workspace = path.join(out, "settle-workspace");
    initWorkspace(workspace);
    const projectDoc = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    const keys = basePlan.actions.map((entry) => `${basePlan.project}/${entry.id}`);
    // An exported operator-script context would make settlement refuse a request outside its descriptor's scope.
    withEnv({ ARCADIA_OPERATOR_SCRIPT_ID: undefined, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: undefined }, () => {
      withDatabase(workspace, (db) => {
        const project = upsertProject(db, {
          name: projectDoc && "name" in projectDoc && typeof projectDoc.name === "string" ? projectDoc.name : basePlan.project,
          mission: "Rehearsal reviewer smoke.", goal: "Predict independent review verdicts.",
          status: "active", currentMilestone: basePlan.milestone ?? "Rehearsal", nextAction: "Keep going.", workClassification: "agent"
        });
        upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
        arrangeActionOrder(db, { currentKeys: keys, order: keys, requestId: "smoke-order", apply: true });
      });
      // The real flow: draft the Ask file into the checkout's own .arcadia/asks/ (untracked) and preview it, so settlement archives it.
      const drafted = runAgentAskDraftCommand({ workspace, dir: repo, request: ask });
      if (!drafted.data.preview) throw new Error(`The drafted Agent Ask could not be previewed: ${JSON.stringify(drafted.data.previewFailure)}`);
      const settleInput = { workspace, proposal: drafted.data.preview.proposal.id, requestId: `settle-${requestId}`, disposition: "accepted" as const };
      const preview = runAgentAskSettleCommand(settleInput);
      runAgentAskSettleCommand({ ...settleInput, preview: preview.data.receipt.previewFingerprint, apply: true, operator: true });
    });
  } catch (error) {
    throw new SmokeSettlementFailure(error instanceof Error ? error.message : String(error), failure);
  }
  const headCommit = git(repo, ["rev-parse", "HEAD"]).trim();
  const headTree = git(repo, ["rev-parse", "HEAD^{tree}"]).trim();

  // (d) deterministic assertions over the settled tree.
  const settledPlan = planAt(repo);
  const settled = settledPlan.actions.find((entry) => entry.id === action.id);
  const expectedNext = `Completed via Agent Ask ${requestId}; no further action.`;
  const settlementFiles = git(repo, ["diff", "--name-only", workCommit, headCommit, "--"]).split("\n").filter(Boolean);
  const stray = settlementFiles.filter((file) => !GOVERNED(file));
  const siblings = baseActions.filter((entry) => entry.id !== action.id && entry.status !== "done");
  const siblingDrift = siblings.filter((entry) => settledPlan.actions.find((a) => a.id === entry.id)?.nextAction !== entry.nextAction);
  const assertions = [
    assertion("settlement", true, `Agent Ask ${requestId} previewed and settled with apply`),
    assertion("action-done", settled?.status === "done", `${action.id} status is ${settled?.status ?? "missing"}`),
    assertion("next-action-completed-form", settled?.nextAction === expectedNext, `next_action is ${JSON.stringify(settled?.nextAction ?? null)}`),
    assertion("pending-siblings-unchanged", siblingDrift.length === 0, `${siblings.length} pending sibling Action(s); changed: ${siblingDrift.map((s) => s.id).join(", ") || "none"}`),
    assertion("settlement-commit-governed-only", headCommit !== workCommit && settlementFiles.length > 0 && stray.length === 0,
      headCommit === workCommit ? "no settlement commit landed" : `${settlementFiles.length} file(s); non-governed: ${stray.join(", ") || "none"}`),
    assertion("settled-checkout-clean", git(repo, ["status", "--porcelain", "--untracked-files=all"]).trim() === "", "git status --porcelain is empty")
  ];

  // (e) PR evidence: the real Operator QA plan renderer plus the newest preserved validation-evidence tail.
  const numberOf = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isInteger(value) ? value : fallback);
  const preserved = newestPreservedEvidence(options.liveWorkspace, repository);
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const headBranch = `claude/${action.id}-${stamp}`;
  const changedFiles = git(repo, ["diff", "--name-status", "--no-renames", "-z", baseRevision, headCommit, "--"]).split("\0").filter(Boolean);
  const files: Array<{ status: string; path: string }> = [];
  for (let i = 0; i + 1 < changedFiles.length; i += 2) files.push({ status: changedFiles[i], path: changedFiles[i + 1] });
  const tailSource = preserved?.evidence.body as string | undefined;
  const oldTail = tailSource ? tailSource.slice(tailSource.indexOf("\n\n### Validation evidence")) : null;
  const commands = fixtureValidationCommand(fixture)
    ? [fixtureValidationCommand(fixture)!]
    : [...(oldTail ?? "").matchAll(/^- \*\*Command:\*\* `(.+)`$/gm)].map((m) => m[1]);
  const rendered = renderOperatorQaPlan(
    operatorQaPlanSource({ actionKey: `${basePlan.project}/${action.id}`, action: { title: action.title, acceptanceCriteria: action.acceptanceCriteria }, validationCommands: commands }),
    {
      branch: headBranch, baseBranch: branch, baseRevision, commitSha: headCommit,
      changedFiles: files.map((file) => ({ status: file.status, path: file.path })),
      pathExists: (file) => !file.startsWith("-") && tryGit(repo, ["cat-file", "-e", `${headCommit}:${file}`]) !== null
    }
  );
  if (rendered.status !== "rendered") throw new SmokeRefusal(`Operator QA plan refused: ${rendered.reason}`);
  let tail: string;
  let evidenceSource: string;
  if (oldTail && preserved) {
    const oldTree = /bound to candidate tree `([0-9a-f]{40})`/.exec(oldTail)?.[1];
    const oldHead = preserved.evidence.headRefOid;
    tail = oldTail;
    // replaceAll with an empty target would interleave the replacement between every character: only 40-hex ids are replaced.
    if (oldTree && SHA40.test(oldTree)) tail = tail.replaceAll(oldTree, headTree).replaceAll(oldTree.slice(0, 12), headTree.slice(0, 12));
    if (typeof oldHead === "string" && SHA40.test(oldHead)) tail = tail.replaceAll(oldHead, headCommit);
    evidenceSource = `preserved attempt evidence ${preserved.file}`;
  } else {
    tail = [
      "", "", "### Validation evidence", "",
      "SYNTHETIC STAND-IN (reviewer smoke): no preserved attempt evidence with a validation record was available, so this section was written by the smoke script, not rendered by host preservation.", "",
      `- **Status:** passed — the declared validation command ran to completion and exited 0 (bound to candidate tree \`${headTree}\`, the tree of candidate commit \`${headCommit}\`).`, "",
      ...(commands.length ? commands.flatMap((command, i) => [`#### Command ${i + 1} of ${commands.length} — passed`, "", `- **Command:** \`${command}\``, "- **Exit code:** `0`", ""]) : [])
    ].join("\n");
    evidenceSource = "SYNTHETIC validation-evidence tail (no preserved attempt evidence found)";
  }
  const numstat = git(repo, ["diff", "--numstat", "--no-renames", baseRevision, headCommit, "--"]).trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
  const changeType: Record<string, string> = { A: "ADDED", M: "MODIFIED", D: "DELETED" };
  const number = numberOf(preserved?.evidence.number, 1);
  const pullRequest = {
    statusCheckRollup: [{ __typename: "CheckRun", conclusion: "SUCCESS", name: "check", status: "COMPLETED", workflowName: "CI" }],
    ...(preserved?.evidence ?? {}),
    number, url: `https://github.com/${repository}/pull/${number}`, title: `Candidate: ${action.id}`, state: "OPEN", isDraft: false,
    mergeStateStatus: "CLEAN", headRefName: headBranch, headRefOid: headCommit, baseRefName: branch, baseRefOid: baseRevision,
    files: files.map((file) => {
      const row = numstat.find((entry) => entry[2] === file.path);
      return { path: file.path, additions: Number(row?.[0]) || 0, deletions: Number(row?.[1]) || 0, changeType: changeType[file.status[0]] ?? "MODIFIED" };
    }),
    body: rendered.body + tail
  } as SmokeCandidate["pullRequest"];
  writeFileSync(path.join(out, "pr-evidence.json"), `${JSON.stringify(pullRequest, null, 2)}\n`, "utf8");
  const patch = git(repo, ["format-patch", "--no-signature", "--stdout", `${baseRevision}..${headCommit}`]);
  writeFileSync(path.join(out, "candidate.patch"), patch, "utf8");
  const commitOids = git(repo, ["rev-list", "--reverse", `${baseRevision}..${headCommit}`]).trim().split("\n").filter(Boolean);

  return {
    mode, out, fixture, repo, repository, actionId: action.id, requestId, baseRevision, workCommit, headCommit, headTree, evidenceSource,
    pullRequest, patch, commitOids, validationCommands: commands, assertions, before
  };
}

type RunCommand = NonNullable<QaPrReviewDependencies["runCommand"]>;

/**
 * The only `gh` calls the reviewer path may make: `pr view --json <fields>`,
 * `pr view --json commits` and the compare patch. Anything else is refused and
 * logged. `git remote get-url` is answered with the fixture's GitHub name.
 * Live: every other host command runs for real. Dry: only the sandbox preflight
 * (the zsh baseline probe and `<codex> sandbox ...`) runs; `<codex> exec` is
 * intercepted; every other command is refused (fail closed) and counted.
 */
export function makeStubbedRunner(candidate: SmokeCandidate, options: { dry: boolean; log: string; onModelIntercept?: () => void; host?: RunCommand }): { runCommand: RunCommand; refused: () => number } {
  if (!options.dry && candidate.mode !== "live") {
    throw new SmokeRefusal("The candidate was built in dry mode; a live reviewer run needs a candidate built live (with --spend-approved).");
  }
  const { pullRequest, patch } = candidate;
  const commitsJson = { commits: candidate.commitOids.map((oid, i) => ({ oid, messageHeadline: `commit ${i + 1}`, authoredDate: new Date().toISOString(), authors: [] })) };
  let refused = 0;
  const refuse = (reason: string): ReturnType<RunCommand> => {
    refused += 1;
    return { status: 1, stdout: "", stderr: `smoke: refused ${reason}`, error: null };
  };
  const runCommand: RunCommand = (input) => {
    const started = Date.now();
    let kind = "";
    let result: ReturnType<RunCommand>;
    const program = path.basename(input.command);
    if (input.command === "git" && input.args[0] === "remote" && input.args[1] === "get-url") {
      kind = "remote-url"; result = { status: 0, stdout: `https://github.com/${candidate.repository}.git\n`, stderr: "", error: null };
    } else if (input.command === "gh") {
      const json = input.args[input.args.indexOf("--json") + 1];
      if (input.args[0] === "pr" && input.args[1] === "view" && json === "commits") { kind = "pr-commits"; result = { status: 0, stdout: JSON.stringify(commitsJson), stderr: "", error: null }; }
      else if (input.args[0] === "pr" && input.args[1] === "view") { kind = "pr-view"; result = { status: 0, stdout: JSON.stringify(pullRequest), stderr: "", error: null }; }
      else if (input.args[0] === "api" && input.args.includes("GET") && String(input.args[3]).includes(`/compare/${pullRequest.baseRefOid}...${pullRequest.headRefOid}`)) {
        kind = "compare"; result = { status: 0, stdout: patch, stderr: "", error: null };
      } else {
        kind = "refused"; result = refuse(`gh call ${input.args.join(" ")}`);
      }
    } else if (options.dry) {
      const baselineProbe = input.command === "/bin/zsh" && input.args[0] === "-c" && input.args[2] === "arcadia-qa-host-baseline";
      const sandboxProbe = program === "codex" && input.args[0] === "sandbox";
      if (program === "codex" && input.args[0] === "exec") {
        kind = "dry-no-model"; options.onModelIntercept?.();
        result = { status: 1, stdout: "", stderr: "smoke dry run: model not invoked", error: "dry run" };
      } else if (baselineProbe || sandboxProbe) {
        result = (options.host ?? runHostCommand)(input);
      } else {
        kind = "refused-dry"; result = refuse(`host command ${input.command} ${input.args.slice(0, 3).join(" ")} (dry mode allows only the sandbox preflight)`);
      }
    } else {
      result = (options.host ?? runHostCommand)(input);
    }
    appendFileSync(options.log, `${JSON.stringify({
      cmd: kind ? `${input.command}(stub:${kind})` : input.command,
      args: input.args.map((arg) => (arg.length > 160 ? `${arg.slice(0, 160)}...` : arg)),
      ms: Date.now() - started, status: result.status, error: result.error, stderrHead: (result.stderr ?? "").slice(0, 600)
    })}\n`);
    return result;
  };
  return { runCommand, refused: () => refused };
}

export interface ReviewerPhaseDeps {
  host?: RunCommand;
  selectReviewer?: QaPrReviewDependencies["selectReviewer"];
  /** False only in tests: use the throwaway workspace's default registries instead of copying the live ones. */
  copyLiveConfig?: boolean;
}

export interface ReviewerPhaseResult {
  calls: ReviewerCall[];
  /** Calls not made because an earlier live call did not pass (and --keep-going was not given). */
  skipped: Array<{ kind: "qa" | "code-review"; attempt: number }>;
  refusedCalls: number;
  logPath: string;
}

/** Step (f): `--qa` QA calls and `--code-review` code-review calls through the real reviewer path. */
export function runReviewerCalls(
  candidate: SmokeCandidate,
  options: Pick<SmokeOptions, "dry" | "qa" | "codeReview" | "liveWorkspace"> & { keepGoing?: boolean },
  deps: ReviewerPhaseDeps = {}
): ReviewerPhaseResult {
  if (!options.dry && candidate.mode !== "live") {
    throw new SmokeRefusal("The candidate was built in dry mode; a live reviewer run needs a candidate built live (with --spend-approved).");
  }
  const workspace = path.join(candidate.out, "review-workspace");
  initWorkspace(workspace);
  const paths = getWorkspacePaths(workspace);
  if (deps.copyLiveConfig !== false) {
    const config = path.join(options.liveWorkspace, "config");
    for (const [name, target] of [["coding-agent-profiles.json", paths.codingAgentProfiles], ["provider-adapters.json", paths.providerAdapters]] as const) {
      if (!existsSync(path.join(config, name))) throw new SmokeRefusal(`The live reviewer configuration ${path.join(config, name)} is missing; cannot select the real reviewer.`);
      copyFileSync(path.join(config, name), target);
    }
  }
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Rehearsal Reviewer Smoke", mission: "Reviewer smoke.", status: "active", currentMilestone: "m", nextAction: "a", workClassification: "agent" });
    // The fixture itself (read only), as the live Project does: the reviewer sandbox preflight proves the repository's
    // .git/HEAD is unreadable from inside the sandbox, which a clone under a temporary directory would spuriously defeat.
    upsertProjectMetadata(db, { projectId: project.id, repoPath: candidate.fixture, validationCommands: candidate.validationCommands });
  });
  const log = path.join(candidate.out, "reviewer-calls.log");
  writeFileSync(log, "");
  let intercepted: boolean;
  const stub = makeStubbedRunner(candidate, { dry: options.dry, log, host: deps.host, onModelIntercept: () => { intercepted = true; } });

  // The availability check writes the operator's global usage cache and Claude usage snapshot. Redirect only those
  // writes under --out, seeded with the current content so reads are unchanged. CODEX_HOME is left alone: the Codex
  // rate-limit state is a real read.
  const telemetryDir = path.join(candidate.out, "telemetry");
  mkdirSync(telemetryDir, { recursive: true });
  const redirect: Record<string, string> = {};
  for (const [variable, real] of Object.entries(telemetryPaths())) {
    const target = path.join(telemetryDir, path.basename(real));
    if (existsSync(real)) copyFileSync(real, target);
    redirect[variable] = target;
  }

  const calls: ReviewerCall[] = [];
  const skipped: ReviewerPhaseResult["skipped"] = [];
  const plan: Array<["qa" | "code-review", number]> = [];
  for (let i = 1; i <= options.qa; i += 1) plan.push(["qa", i]);
  for (let i = 1; i <= options.codeReview; i += 1) plan.push(["code-review", i]);
  withEnv(redirect, () => {
    for (const [kind, attempt] of plan) {
      if (!options.dry && !options.keepGoing && calls.some((call) => call.verdict !== "pass")) {
        skipped.push({ kind, attempt });
        continue;
      }
      intercepted = false;
      const started = Date.now();
      try {
        const { data } = runQaPrReviewCommand(
          { workspace, pullRequest: candidate.pullRequest.url, reviewerTimeoutMs: 15 * 60_000, rerun: true, ...(kind === "code-review" ? { role: "code-review" as const } : {}) },
          { runCommand: stub.runCommand, ...(deps.selectReviewer ? { selectReviewer: deps.selectReviewer } : {}) }
        );
        const failed = data.reviewerUnavailable ? [] : data.checks.filter((check) => check.status !== "pass" && check.status !== "not-applicable")
          .map((check) => ({ criterion: check.name, status: check.status, evidenceHead: check.evidence.replace(/\s+/g, " ").slice(0, 100) }));
        const dry = options.dry && intercepted;
        calls.push({
          kind, attempt, verdict: dry ? "dry" : data.verdict, dry, failed,
          findings: dry ? [] : data.findings.map((finding) => `${finding.severity}: ${finding.title}`),
          note: dry ? "reviewer process intercepted; real preflight passed"
            : data.reviewerUnavailable ? `reviewer unavailable: ${data.reviewerUnavailable.replace(/\s+/g, " ").slice(0, 200)}` : data.varianceReason,
          elapsedMs: Date.now() - started
        });
      } catch (error) {
        calls.push({
          kind, attempt, verdict: "error", dry: false, failed: [], findings: [],
          note: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started
        });
      }
    }
  });
  return { calls, skipped, refusedCalls: stub.refused(), logPath: log };
}

export function renderTable(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): SmokeOptions {
  const options: SmokeOptions = {
    fixture: DEFAULT_FIXTURE, qa: 3, codeReview: 3, dry: env.SMOKE_DRY === "1", spendApproved: false, keepGoing: false, liveWorkspace: DEFAULT_LIVE_WORKSPACE
  };
  const count = (flag: string, value: string | undefined): number => {
    if (value === undefined || !/^[0-9]+$/.test(value) || Number(value) > 20) throw new SmokeRefusal(`${flag} needs a whole number from 0 to 20.`);
    return Number(value);
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new SmokeRefusal(`${flag} needs a value.`);
      i += 1;
      return next;
    };
    if (flag === "--dry") options.dry = true;
    else if (flag === "--spend-approved") options.spendApproved = true;
    else if (flag === "--keep-going") options.keepGoing = true;
    else if (flag === "--fixture") options.fixture = value();
    else if (flag === "--base") options.base = value();
    else if (flag === "--action") options.action = value();
    else if (flag === "--qa") options.qa = count(flag, value());
    else if (flag === "--code-review") options.codeReview = count(flag, value());
    else if (flag === "--out") options.out = value();
    else if (flag === "--live-workspace") options.liveWorkspace = value();
    else throw new SmokeRefusal(`Unknown argument ${flag}. Flags: --fixture --base --action --qa --code-review --dry --spend-approved --keep-going --out --live-workspace.`);
  }
  if (options.qa + options.codeReview === 0) throw new SmokeRefusal("--qa 0 and --code-review 0 reviews nothing, so no gate can be reported; ask for at least one call.");
  return options;
}

export interface MainDeps extends ReviewerPhaseDeps {
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export function main(argv: string[], deps: MainDeps = {}): number {
  const write = (line = ""): void => (deps.out ?? ((text: string) => { process.stdout.write(`${text}\n`); }))(line);
  const fail = (line: string): void => (deps.err ?? ((text: string) => { process.stderr.write(`${text}\n`); }))(line);
  let options: SmokeOptions;
  let candidate: SmokeCandidate;
  try {
    options = parseArgs(argv, deps.env);
    candidate = buildSmokeCandidate(options);
  } catch (error) {
    if (error instanceof SmokeRefusal) { fail(`SMOKE REFUSED: ${error.message}`); return 2; }
    if (error instanceof SmokeSettlementFailure) {
      // The settlement step failed: a failed deterministic assertion, a FAIL gate and a result file, not a stack trace.
      const context = error.context;
      const assertions = [
        assertion("settlement", false, error.message),
        readOnlyInputsAssertion(context.before, snapshotLive({ fixture: context.fixture, liveWorkspace: context.liveWorkspace }))
      ];
      write(`Out dir: ${context.out}`);
      write(`Mode: ${context.mode === "dry" ? "DRY (no model call)" : "LIVE"}`);
      write(`Action ${context.actionId}; completion request id ${context.requestId}; base ${context.baseRevision.slice(0, 12)}`);
      write();
      write("Deterministic assertions");
      for (const entry of assertions) write(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}`);
      write();
      writeFileSync(path.join(context.out, "smoke-result.json"), `${JSON.stringify({ gate: "FAIL", actionId: context.actionId, requestId: context.requestId, baseRevision: context.baseRevision, assertions, calls: [] }, null, 2)}\n`, "utf8");
      write("SMOKE GATE: FAIL");
      return 1;
    }
    fail(`SMOKE ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  write(`Out dir: ${candidate.out}`);
  write(`Mode: ${options.dry ? "DRY (no model call)" : "LIVE (real reviewer-model calls, --spend-approved given)"}`);
  write(`Fixture: ${path.resolve(options.fixture)} (${candidate.repository}); base ${candidate.baseRevision.slice(0, 12)}; Action ${candidate.actionId}; completion request id ${candidate.requestId}`);
  write(`Work commit ${candidate.workCommit.slice(0, 12)}; settled head ${candidate.headCommit.slice(0, 12)}; PR evidence tail: ${candidate.evidenceSource}`);
  write();
  write("Deterministic assertions");

  let reviewer: ReviewerPhaseResult | null = null;
  let reviewerError: string | null = null;
  try {
    reviewer = runReviewerCalls(candidate, options, { host: deps.host, selectReviewer: deps.selectReviewer, copyLiveConfig: deps.copyLiveConfig });
  } catch (error) {
    reviewerError = error instanceof Error ? error.message : String(error);
  }
  const assertions = [...candidate.assertions];
  if (reviewer) assertions.push(assertion("reviewer-calls-allowed", reviewer.refusedCalls === 0, `${reviewer.refusedCalls} refused gh or host call(s); log ${reviewer.logPath}`));
  else assertions.push(assertion("reviewer-phase-ran", false, reviewerError ?? "reviewer phase did not run"));
  assertions.push(readOnlyInputsAssertion(candidate.before, snapshotLive({ fixture: candidate.fixture, liveWorkspace: options.liveWorkspace })));
  for (const entry of assertions) write(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}`);

  write();
  const calls = reviewer?.calls ?? [];
  const skipped = reviewer?.skipped ?? [];
  if (calls.length > 0) {
    write("Reviewer calls");
    renderTable([
      ["call", "attempt", "verdict", "failed criteria (evidence head)"],
      ...calls.map((call) => [call.kind, String(call.attempt), call.verdict,
        call.failed.length ? call.failed.map((f) => `${f.criterion} [${f.status}]: ${f.evidenceHead}`).join(" | ") : (call.note ?? "-")]),
      ...skipped.map((call) => [call.kind, String(call.attempt), "skipped", "not run: an earlier call did not pass (--keep-going buys the rest)"])
    ]).forEach((line) => write(`  ${line}`));
    for (const call of calls) for (const finding of call.findings) write(`  finding (${call.kind} #${call.attempt}) ${finding}`);
    if (skipped.length > 0) write(`  skipped ${skipped.length} call(s): ${skipped.map((call) => `${call.kind} #${call.attempt}`).join(", ")}`);
    write();
  } else if (reviewerError) {
    write(`Reviewer phase refused: ${reviewerError}`);
    write();
  }

  const held = assertions.every((entry) => entry.pass);
  const reached = calls.length > 0 && skipped.length === 0 && calls.every((call) => (options.dry ? call.dry : call.verdict === "pass"));
  const gate = !held || !reached ? "FAIL" : options.dry ? "DRY-OK" : "PASS";
  writeFileSync(path.join(candidate.out, "smoke-result.json"), `${JSON.stringify({
    gate, options, actionId: candidate.actionId, requestId: candidate.requestId,
    baseRevision: candidate.baseRevision, workCommit: candidate.workCommit, headCommit: candidate.headCommit, evidenceSource: candidate.evidenceSource,
    assertions, calls, skipped
  }, null, 2)}\n`, "utf8");
  write(`SMOKE GATE: ${gate}`);
  return gate === "FAIL" ? 1 : 0;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMainModule()) {
  process.exitCode = main(process.argv.slice(2));
}
