import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
 * Action will pass BEFORE the operator spends a G7 press. It builds the
 * rendered Action shape from the fixture itself (the fixture is only cloned,
 * never written), has the REAL `arcadia agent-ask settle` write the settlement
 * commit in a throwaway workspace, checks that commit deterministically, and
 * runs the real `runQaPrReviewCommand` reviewer path (QA and code-review roles)
 * with `gh` stubbed. Dry mode builds everything and runs every deterministic
 * assertion, but never invokes the reviewer model.
 *
 * Usage (see docs/reports/rehearsal-reviewer-smoke/README.md):
 *   mise exec -- node --import tsx scripts/rehearsal-reviewer-smoke.ts [--dry] [--spend-approved]
 *     [--fixture <path>] [--base <rev>] [--action <id>] [--qa <n>] [--code-review <n>]
 *     [--out <dir>] [--live-workspace <path>]
 *
 * Writes only under `--out`. Reads, never writes, the fixture and the live
 * workspace (preserved attempt evidence, reviewer configuration).
 */

export const DEFAULT_FIXTURE = "/Users/pmark/tmp/arcadia-three-action-rehearsal";
export const DEFAULT_LIVE_WORKSPACE = "/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover";
const BASE_SUBJECT = /^(Reopen |Reset the rehearsal fixture)/;
/** Paths a work commit never carries and the settlement commit may only touch. */
const GOVERNED = (file: string): boolean =>
  file.startsWith(".arcadia/") || file === "MISSION_LOG.md" || file === "PROJECT.md" || file.startsWith("docs/plans/");
const SMOKE_IDENTITY = { GIT_AUTHOR_NAME: "Rehearsal Reviewer Smoke", GIT_AUTHOR_EMAIL: "rehearsal-smoke@agents.arcadia.local" };

export class SmokeRefusal extends Error {}

export interface SmokeOptions {
  fixture: string;
  base?: string;
  action?: string;
  qa: number;
  codeReview: number;
  dry: boolean;
  spendApproved: boolean;
  out?: string;
  liveWorkspace: string;
}

export interface SmokeAssertion { name: string; pass: boolean; detail: string }

export interface SmokeCandidate {
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

export interface LiveSnapshot { live: Record<string, string[]>; fixtureStatus: string; fixtureHead: string }

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

function walkFiles(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walkFiles(full, root) : [`${path.relative(root, full)} (${statSync(full).size}b)`];
  });
}

export function snapshotLive(options: Pick<SmokeOptions, "fixture" | "liveWorkspace">): LiveSnapshot {
  const artifacts = path.join(options.liveWorkspace, "artifacts");
  return {
    live: { qa: walkFiles(path.join(artifacts, "qa")), "code-review": walkFiles(path.join(artifacts, "code-review")) },
    fixtureStatus: tryGit(options.fixture, ["--no-optional-locks", "status", "--porcelain"]) ?? "(unreadable)",
    fixtureHead: tryGit(options.fixture, ["--no-optional-locks", "rev-parse", "HEAD"])?.trim() ?? "(unreadable)"
  };
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

/** The completion request id the Plan's next_action names (`complete-<action>-<tag>`). */
export function completionRequestId(actionId: string, nextAction: string | null): string | null {
  const escaped = actionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`complete-${escaped}-[A-Za-z0-9][A-Za-z0-9._-]*`).exec(nextAction ?? "");
  return match ? match[0].replace(/[._-]+$/, "") : null;
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
  const fixture = path.resolve(options.fixture);
  if (!existsSync(path.join(fixture, ".git"))) throw new SmokeRefusal(`The fixture ${fixture} is not a Git repository.`);
  const repository = githubRepository(fixture);
  const before = snapshotLive({ fixture, liveWorkspace: options.liveWorkspace });

  const out = options.out ? path.resolve(options.out) : mkdtempSync(path.join(tmpdir(), "rehearsal-reviewer-smoke-"));
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length > 0) throw new SmokeRefusal(`--out ${out} is not empty; pass a fresh directory.`);

  // (a) clone the fixture; only the clone is ever written. Point its origin at GitHub's name so nothing can reach the fixture.
  const repo = path.join(out, "repo");
  execFileSync("git", ["clone", "--quiet", "--no-hardlinks", fixture, repo], { stdio: ["ignore", "pipe", "pipe"] });
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
    const resolved = tryGit(repo, ["rev-parse", "--verify", "--quiet", `${options.base}^{commit}`])?.trim();
    if (!resolved) throw new SmokeRefusal(`--base ${options.base} is not a commit in the fixture.`);
    baseRevision = resolved;
  } else {
    const found = history.find((entry) => BASE_SUBJECT.test(entry.subject));
    if (!found) throw new SmokeRefusal("The fixture history has no commit whose subject starts with `Reopen ` or `Reset the rehearsal fixture`; pass --base <rev>.");
    baseRevision = found.sha;
  }
  git(repo, ["checkout", "--quiet", "-B", branch, baseRevision]);

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
  const requestId = completionRequestId(action.id, action.nextAction);
  if (!requestId) {
    throw new SmokeRefusal(`Action ${action.id}'s next_action at ${baseRevision.slice(0, 12)} names no completion request id (complete-${action.id}-<tag>).`);
  }
  if (action.acceptanceCriteria.length === 0) throw new SmokeRefusal(`Action ${action.id} declares no acceptance criteria.`);

  // (b) work commit: the newest merged candidate's product files, replayed as one commit on the base.
  const subject = new RegExp(`^Candidate: ${action.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
  const candidate = history.find((entry) => subject.test(entry.subject));
  if (!candidate) throw new SmokeRefusal(`The fixture history has no merged candidate commit "Candidate: ${action.id}"; nothing to replay as the work commit.`);
  const changed = git(repo, ["diff", "--name-status", "--no-renames", "-z", `${candidate.sha}^`, candidate.sha]).split("\0").filter(Boolean);
  const product: Array<{ status: string; path: string }> = [];
  for (let i = 0; i + 1 < changed.length; i += 2) if (!GOVERNED(changed[i + 1])) product.push({ status: changed[i][0], path: changed[i + 1] });
  if (product.length === 0) throw new SmokeRefusal(`Candidate ${candidate.sha.slice(0, 12)} for ${action.id} changes only governed records; it has no product files to replay.`);
  for (const file of product) {
    if (file.status === "D") git(repo, ["rm", "--quiet", "--force", "--", file.path]);
    else git(repo, ["checkout", candidate.sha, "--", file.path]);
  }
  git(repo, ["commit", "--quiet", "-m", `Implement ${action.id} (reviewer smoke replay of ${candidate.sha.slice(0, 12)})`], { ...SMOKE_IDENTITY, GIT_COMMITTER_NAME: SMOKE_IDENTITY.GIT_AUTHOR_NAME, GIT_COMMITTER_EMAIL: SMOKE_IDENTITY.GIT_AUTHOR_EMAIL });
  const workCommit = git(repo, ["rev-parse", "HEAD"]).trim();

  // (c) settlement: the real Agent Ask preview and settle, in a throwaway workspace.
  const workspace = path.join(out, "settle-workspace");
  initWorkspace(workspace);
  const projectDoc = discoverDocs(repo).docs.find((doc) => doc.type === "project");
  const keys = basePlan.actions.map((entry) => `${basePlan.project}/${entry.id}`);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: projectDoc && "name" in projectDoc && typeof projectDoc.name === "string" ? projectDoc.name : basePlan.project,
      mission: "Rehearsal reviewer smoke.", goal: "Predict independent review verdicts.",
      status: "active", currentMilestone: basePlan.milestone ?? "Rehearsal", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, { currentKeys: keys, order: keys, requestId: "smoke-order", apply: true });
  });
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
  // The real flow: draft the Ask file into the checkout's own .arcadia/asks/ (untracked) and preview it, so settlement archives it.
  const drafted = runAgentAskDraftCommand({ workspace, dir: repo, request: ask });
  if (!drafted.data.preview) throw new SmokeRefusal(`The drafted Agent Ask could not be previewed: ${JSON.stringify(drafted.data.previewFailure)}`);
  const settleInput = { workspace, proposal: drafted.data.preview.proposal.id, requestId: `settle-${requestId}`, disposition: "accepted" as const };
  const preview = runAgentAskSettleCommand(settleInput);
  runAgentAskSettleCommand({ ...settleInput, preview: preview.data.receipt.previewFingerprint, apply: true, operator: true });
  const headCommit = git(repo, ["rev-parse", "HEAD"]).trim();
  const headTree = git(repo, ["rev-parse", "HEAD^{tree}"]).trim();

  // (d) deterministic assertions over the settled tree.
  const settledPlan = planAt(repo);
  const settled = settledPlan.actions.find((entry) => entry.id === action.id);
  const expectedNext = `Completed via Agent Ask ${requestId}; no further action.`;
  const settlementFiles = git(repo, ["diff", "--name-only", workCommit, headCommit]).split("\n").filter(Boolean);
  const stray = settlementFiles.filter((file) => !GOVERNED(file));
  const siblings = baseActions.filter((entry) => entry.id !== action.id && entry.status !== "done");
  const siblingDrift = siblings.filter((entry) => settledPlan.actions.find((a) => a.id === entry.id)?.nextAction !== entry.nextAction);
  const assertions = [
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
  const changedFiles = git(repo, ["diff", "--name-status", "--no-renames", "-z", baseRevision, headCommit]).split("\0").filter(Boolean);
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
    tail = oldTail;
    if (oldTree) tail = tail.replaceAll(oldTree, headTree).replaceAll(oldTree.slice(0, 12), headTree.slice(0, 12));
    if (typeof preserved.evidence.headRefOid === "string") tail = tail.replaceAll(preserved.evidence.headRefOid, headCommit);
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
  const numstat = git(repo, ["diff", "--numstat", "--no-renames", baseRevision, headCommit]).trim().split("\n").filter(Boolean).map((line) => line.split("\t"));
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
    out, fixture, repo, repository, actionId: action.id, requestId, baseRevision, workCommit, headCommit, headTree, evidenceSource,
    pullRequest, patch, commitOids, validationCommands: commands, assertions, before
  };
}

type RunCommand = NonNullable<QaPrReviewDependencies["runCommand"]>;

/**
 * The only `gh` calls the reviewer path may make: `pr view --json <fields>`,
 * `pr view --json commits` and the compare patch. Anything else is refused and logged.
 * `git remote get-url` is answered with the fixture's GitHub name; every other
 * host command runs for real, except the reviewer model process in dry mode.
 */
export function makeStubbedRunner(candidate: SmokeCandidate, options: { dry: boolean; log: string; onModelIntercept?: () => void; host?: RunCommand }): { runCommand: RunCommand; refused: () => number } {
  const { pullRequest, patch } = candidate;
  const commitsJson = { commits: candidate.commitOids.map((oid, i) => ({ oid, messageHeadline: `commit ${i + 1}`, authoredDate: new Date().toISOString(), authors: [] })) };
  let refused = 0;
  const runCommand: RunCommand = (input) => {
    const started = Date.now();
    let kind = "";
    let result: ReturnType<RunCommand>;
    if (input.command === "git" && input.args[0] === "remote" && input.args[1] === "get-url") {
      kind = "remote-url"; result = { status: 0, stdout: `https://github.com/${candidate.repository}.git\n`, stderr: "", error: null };
    } else if (input.command === "gh") {
      const json = input.args[input.args.indexOf("--json") + 1];
      if (input.args[0] === "pr" && input.args[1] === "view" && json === "commits") { kind = "pr-commits"; result = { status: 0, stdout: JSON.stringify(commitsJson), stderr: "", error: null }; }
      else if (input.args[0] === "pr" && input.args[1] === "view") { kind = "pr-view"; result = { status: 0, stdout: JSON.stringify(pullRequest), stderr: "", error: null }; }
      else if (input.args[0] === "api" && input.args.includes("GET") && String(input.args[3]).includes(`/compare/${pullRequest.baseRefOid}...${pullRequest.headRefOid}`)) {
        kind = "compare"; result = { status: 0, stdout: patch, stderr: "", error: null };
      } else {
        kind = "refused"; refused += 1;
        result = { status: 1, stdout: "", stderr: `smoke: refused gh call ${input.args.join(" ")}`, error: null };
      }
    } else if (options.dry && input.args[0] === "exec") {
      kind = "dry-no-model"; options.onModelIntercept?.();
      result = { status: 1, stdout: "", stderr: "smoke dry run: model not invoked", error: "dry run" };
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

/** Step (f): `--qa` QA calls and `--code-review` code-review calls through the real reviewer path. */
export function runReviewerCalls(
  candidate: SmokeCandidate,
  options: Pick<SmokeOptions, "dry" | "qa" | "codeReview" | "liveWorkspace">,
  deps: { host?: RunCommand; selectReviewer?: QaPrReviewDependencies["selectReviewer"]; copyLiveConfig?: boolean } = {}
): { calls: ReviewerCall[]; refusedGhCalls: number; logPath: string } {
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

  const calls: ReviewerCall[] = [];
  const plan: Array<["qa" | "code-review", number]> = [];
  for (let i = 1; i <= options.qa; i += 1) plan.push(["qa", i]);
  for (let i = 1; i <= options.codeReview; i += 1) plan.push(["code-review", i]);
  for (const [kind, attempt] of plan) {
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
  return { calls, refusedGhCalls: stub.refused(), logPath: log };
}

function sameList(a: string[], b: string[]): boolean { return a.length === b.length && a.every((value, i) => value === b[i]); }

export function renderTable(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): SmokeOptions {
  const options: SmokeOptions = {
    fixture: DEFAULT_FIXTURE, qa: 3, codeReview: 3, dry: env.SMOKE_DRY === "1", spendApproved: false, liveWorkspace: DEFAULT_LIVE_WORKSPACE
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
    else if (flag === "--fixture") options.fixture = value();
    else if (flag === "--base") options.base = value();
    else if (flag === "--action") options.action = value();
    else if (flag === "--qa") options.qa = count(flag, value());
    else if (flag === "--code-review") options.codeReview = count(flag, value());
    else if (flag === "--out") options.out = value();
    else if (flag === "--live-workspace") options.liveWorkspace = value();
    else throw new SmokeRefusal(`Unknown argument ${flag}. Flags: --fixture --base --action --qa --code-review --dry --spend-approved --out --live-workspace.`);
  }
  if (!options.dry && options.qa + options.codeReview === 0) throw new SmokeRefusal("A live run with --qa 0 and --code-review 0 reviews nothing.");
  return options;
}

export function main(argv: string[]): number {
  const write = (line = ""): void => { process.stdout.write(`${line}\n`); };
  let options: SmokeOptions;
  let candidate: SmokeCandidate;
  try {
    options = parseArgs(argv);
    candidate = buildSmokeCandidate(options);
  } catch (error) {
    if (error instanceof SmokeRefusal) { process.stderr.write(`SMOKE REFUSED: ${error.message}\n`); return 2; }
    throw error;
  }
  write(`Out dir: ${candidate.out}`);
  write(`Mode: ${options.dry ? "DRY (no model call)" : "LIVE (real reviewer-model calls, --spend-approved given)"}`);
  write(`Fixture: ${path.resolve(options.fixture)} (${candidate.repository}); base ${candidate.baseRevision.slice(0, 12)}; Action ${candidate.actionId}; completion request id ${candidate.requestId}`);
  write(`Work commit ${candidate.workCommit.slice(0, 12)}; settled head ${candidate.headCommit.slice(0, 12)}; PR evidence tail: ${candidate.evidenceSource}`);
  write();
  write("Deterministic assertions");

  let reviewer: ReturnType<typeof runReviewerCalls> | null = null;
  let reviewerError: string | null = null;
  try {
    reviewer = runReviewerCalls(candidate, options);
  } catch (error) {
    reviewerError = error instanceof Error ? error.message : String(error);
  }
  const assertions = [...candidate.assertions];
  if (reviewer) assertions.push(assertion("reviewer-gh-calls-served", reviewer.refusedGhCalls === 0, `${reviewer.refusedGhCalls} refused gh call(s); log ${reviewer.logPath}`));
  else assertions.push(assertion("reviewer-phase-ran", false, reviewerError ?? "reviewer phase did not run"));

  const after = snapshotLive(options);
  const unchanged = Object.keys(candidate.before.live).every((key) => sameList(candidate.before.live[key], after.live[key] ?? []))
    && candidate.before.fixtureStatus === after.fixtureStatus && candidate.before.fixtureHead === after.fixtureHead;
  assertions.push(assertion("read-only-inputs-unchanged", unchanged,
    `live artifacts ${Object.entries(after.live).map(([key, list]) => `${key}: ${list.length} file(s)`).join(", ")}; fixture HEAD ${after.fixtureHead.slice(0, 12)}; fixture status --porcelain ${after.fixtureStatus.trim() === "" ? "clean" : "NOT clean"}; ${unchanged ? "unchanged" : "CHANGED"}`));
  for (const entry of assertions) write(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}`);

  write();
  const calls = reviewer?.calls ?? [];
  if (calls.length > 0) {
    write("Reviewer calls");
    renderTable([
      ["call", "attempt", "verdict", "failed criteria (evidence head)"],
      ...calls.map((call) => [call.kind, String(call.attempt), call.verdict,
        call.failed.length ? call.failed.map((f) => `${f.criterion} [${f.status}]: ${f.evidenceHead}`).join(" | ") : (call.note ?? "-")])
    ]).forEach((line) => write(`  ${line}`));
    for (const call of calls) for (const finding of call.findings) write(`  finding (${call.kind} #${call.attempt}) ${finding}`);
    write();
  } else if (reviewerError) {
    write(`Reviewer phase refused: ${reviewerError}`);
    write();
  }

  const held = assertions.every((entry) => entry.pass);
  const reached = calls.every((call) => (options.dry ? call.dry : call.verdict === "pass"));
  const gate = !held || !reached ? "FAIL" : options.dry ? "DRY-OK" : "PASS";
  writeFileSync(path.join(candidate.out, "smoke-result.json"), `${JSON.stringify({
    gate, options: { ...options, spendApproved: options.spendApproved }, actionId: candidate.actionId, requestId: candidate.requestId,
    baseRevision: candidate.baseRevision, workCommit: candidate.workCommit, headCommit: candidate.headCommit, evidenceSource: candidate.evidenceSource,
    assertions, calls
  }, null, 2)}\n`, "utf8");
  write(`SMOKE GATE: ${gate}`);
  return gate === "FAIL" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
