/**
 * The shell-wiring decisions of the batch merge operator script (#1284), pulled
 * out of scripts/merge-decision-card-batch.ts so they can be tested with fixtures
 * and a scratch git repository. Not imported by the dashboard.
 *
 * What the guard establishes before a single `gh pr merge` can run:
 *  - the descriptor and its launcher are the files at the one expected location
 *    inside the checkout the executing script lives in (realpath-contained);
 *  - the operator-script contract holds for them and the reviewed text names
 *    every pinned PR number and its 7-character head;
 *  - `origin` resolves to the spec's owner/name, so a clone pointed at another
 *    remote cannot pass;
 *  - on a real run, `git fetch origin main` succeeded (a failed fetch is fatal)
 *    and every file the action runs is identical to the FETCHED commit, not to
 *    any pre-existing local ref;
 *  - the files are tracked and unmodified against HEAD.
 *
 * What this is NOT: a trust root. Operator-only execution is enforced by the host
 * permission rules that keep agents from running operator scripts; this guard
 * protects against accidental or unmodified invocation (fetched-main equality,
 * origin slug, contract, text binding). Accepted residuals, none of which the
 * code can stop from inside a checkout the caller controls: forging the fetch
 * transport (environment or config such as GIT_SSH_COMMAND, core.sshCommand,
 * http.proxy, a substituted git binary; the git calls below neutralise the
 * obvious ones but that is hygiene, not a boundary), editing this guard, and
 * importing runBatchMerge directly. Follow-up, not done here: invert the
 * classifier into an allowlist of known-safe paths instead of a denylist.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { validateOperatorScriptContract } from "../operatorActions/libraryContract.js";
import {
  assertBatchExecutionContext,
  parseBatchMergeRequest,
  validateBatchMergeSpec,
  type BatchMergeRequest,
  type BatchMergeSpec,
} from "./batchMerge.js";

export interface GuardGitResult {
  status: number;
  stdout: string;
}
export type GuardGit = (args: string[]) => GuardGitResult;

const GIT_CANDIDATES = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];
const SAFE_PATH = "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin";
/** Config forced on every guard git call so repo or environment config cannot redirect the transport. */
export const GIT_SAFE_ARGS: readonly string[] = ["-c", "core.sshCommand=", "-c", "http.proxy=", "-c", "protocol.ext.allow=never"];

/** The environment git runs with: every GIT_* variable dropped, a fixed PATH, no prompts. */
export function sanitizedGitEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith("GIT_") || key === "PATH") continue;
    out[key] = value;
  }
  out.PATH = SAFE_PATH;
  out.GIT_TERMINAL_PROMPT = "0";
  return out;
}

function gitBinary(): string {
  return GIT_CANDIDATES.find((candidate) => existsSync(candidate)) ?? "git";
}

/** Real git in `cwd`, with the sanitized environment and safe config. A spawn failure is status -1, never a throw. */
export function systemGit(cwd: string): GuardGit {
  return (args) => {
    const r = spawnSync(gitBinary(), ["-C", cwd, ...GIT_SAFE_ARGS, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: sanitizedGitEnv(process.env),
    });
    return { status: typeof r.status === "number" ? r.status : -1, stdout: (r.stdout ?? "").trim() };
  };
}

/** The files the action runs; `<id>` is the card id. Every one must be tracked and match the fetched main. */
export const BATCH_GUARD_TRACKED: readonly string[] = [
  "artifacts/generated/operator-scripts/<id>.json",
  "artifacts/generated/operator-scripts/<id>.sh",
  "scripts/merge-decision-card-batch.ts",
  "src/decisions/batchMerge.ts",
  "src/decisions/batchMergeGuard.ts",
  "src/decisions/card.ts",
  "src/operatorActions/libraryContract.ts",
];

const SLUG = "([A-Za-z0-9][A-Za-z0-9._-]{0,99})\\/([A-Za-z0-9._-]{1,100}?)";
const REMOTE_FORMS = [
  new RegExp(`^https://github\\.com/${SLUG}(?:\\.git)?/?$`),
  new RegExp(`^git@github\\.com:${SLUG}(?:\\.git)?$`),
  new RegExp(`^ssh://git@github\\.com/${SLUG}(?:\\.git)?/?$`),
];

/** owner/name for an https or ssh GitHub remote, or null for anything else (userinfo, other hosts, paths). */
export function parseGitRemoteSlug(url: unknown): string | null {
  if (typeof url !== "string") return null;
  for (const form of REMOTE_FORMS) {
    const m = form.exec(url.trim());
    if (m && m[1] !== "." && m[1] !== ".." && m[2] !== "." && m[2] !== "..") return `${m[1]}/${m[2]}`;
  }
  return null;
}

/**
 * The reviewed text must name every pinned PR and its 7-character head, in both
 * `problem` and one `authority.does` line per PR. Returns a reason, or null when bound.
 */
export function bindDescriptorText(descriptor: unknown, spec: BatchMergeSpec): string | null {
  const d = descriptor as { problem?: unknown; authority?: { does?: unknown } } | null;
  const problem = typeof d?.problem === "string" ? d.problem : "";
  const does = Array.isArray(d?.authority?.does) ? (d.authority.does as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (does.length !== spec.prs.length) return `authority.does lists ${does.length} entries for ${spec.prs.length} pinned PRs.`;
  for (const p of spec.prs) {
    const head7 = p.headSha.slice(0, 7);
    const numberRe = new RegExp(`#${p.number}(?!\\d)`);
    if (!numberRe.test(problem) || !problem.includes(head7)) return `problem does not name #${p.number} at ${head7}.`;
    if (!does.some((line) => numberRe.test(line) && line.includes(head7))) return `authority.does does not name #${p.number} at ${head7}.`;
  }
  return null;
}

export type GuardCode =
  | "operator_context"
  | "path_outside_root"
  | "wrong_location"
  | "descriptor_unreadable"
  | "contract_invalid"
  | "spec_invalid"
  | "request_invalid"
  | "card_id_mismatch"
  | "text_unbound"
  | "remote_mismatch"
  | "untracked"
  | "modified"
  | "fetch_failed"
  | "git_error"
  | "not_on_main";

export type GuardResult =
  | { ok: true; spec: BatchMergeSpec; request: BatchMergeRequest; fetchedSha: string | null }
  | { ok: false; code: GuardCode; message: string };

export interface GuardInput {
  /** The checkout the executing script lives in (from its own import.meta.url), never the descriptor's location. */
  repoRoot: string;
  descriptorPath: string;
  env: Readonly<Record<string, string | undefined>>;
  dryRun: boolean;
  git: GuardGit;
}

const refuse = (code: GuardCode, message: string): GuardResult => ({ ok: false, code, message });
const inside = (root: string, file: string): boolean => {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export function runBatchMergeGuard(input: GuardInput): GuardResult {
  try {
    return guard(input);
  } catch (error) {
    return refuse("git_error", `The guard could not complete: ${error instanceof Error ? error.message : "unreadable error"}`);
  }
}

function guard(input: GuardInput): GuardResult {
  const { git, dryRun } = input;
  let root: string;
  let realDescriptor: string;
  try {
    root = realpathSync(input.repoRoot);
    realDescriptor = realpathSync(input.descriptorPath);
  } catch {
    return refuse("descriptor_unreadable", "The descriptor or checkout root cannot be resolved.");
  }
  if (!inside(root, realDescriptor)) return refuse("path_outside_root", "The descriptor is outside the checkout this script runs from.");
  const scriptId = path.basename(input.descriptorPath, ".json");
  const dir = path.join(root, "artifacts", "generated", "operator-scripts");
  const expectedJson = path.join(dir, `${scriptId}.json`);
  const expectedSh = path.join(dir, `${scriptId}.sh`);
  if (realDescriptor !== expectedJson) return refuse("wrong_location", `The descriptor must be ${expectedJson}.`);
  let realSh: string;
  try {
    realSh = realpathSync(expectedSh);
  } catch {
    return refuse("descriptor_unreadable", "The launcher script is missing.");
  }
  if (realSh !== expectedSh) return refuse("wrong_location", "The launcher script resolves outside its expected location.");

  const envDescriptor = input.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR;
  const envOk =
    input.env.ARCADIA_OPERATOR_SCRIPT_ID === scriptId &&
    typeof envDescriptor === "string" &&
    envDescriptor !== "" &&
    (path.resolve(envDescriptor) === path.resolve(input.descriptorPath) || path.resolve(envDescriptor) === realDescriptor);
  const envCheck = assertBatchExecutionContext({
    scriptId,
    descriptorPath: envOk ? "ok" : "bad",
    env: { ARCADIA_OPERATOR_SCRIPT_ID: scriptId, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: envOk ? "ok" : undefined },
    allTracked: true,
    modifiedLocally: false,
    differsFromOriginMain: false,
    dryRun,
  });
  if (envCheck) return refuse("operator_context", envCheck.message);

  let raw: unknown;
  let shText: string;
  try {
    raw = JSON.parse(readFileSync(realDescriptor, "utf8"));
    shText = readFileSync(realSh, "utf8");
  } catch (error) {
    return refuse("descriptor_unreadable", `The descriptor or launcher could not be read: ${error instanceof Error ? error.message : "unreadable"}`);
  }
  try {
    validateOperatorScriptContract(raw, scriptId, shText);
  } catch (error) {
    return refuse("contract_invalid", error instanceof Error ? error.message : "The operator-script contract failed.");
  }
  const d = raw as { id?: unknown; batchMerge?: unknown; batchMergeRequest?: unknown };
  const specResult = validateBatchMergeSpec(d.batchMerge);
  if (!specResult.ok) return refuse("spec_invalid", `${specResult.refusal.code}: ${specResult.refusal.message}`);
  const spec = specResult.spec;
  if (d.id !== scriptId || spec.cardId !== scriptId) return refuse("card_id_mismatch", "The descriptor id, file name and pinned card id must be one value.");
  const requestResult = parseBatchMergeRequest(d.batchMergeRequest);
  if (!requestResult.ok) return refuse("request_invalid", `${requestResult.refusal.code}: ${requestResult.refusal.message}`);
  const unbound = bindDescriptorText(raw, spec);
  if (unbound) return refuse("text_unbound", `The reviewed descriptor text does not match the pinned spec: ${unbound}`);

  const remote = git(["remote", "get-url", "origin"]);
  const slug = remote.status === 0 ? parseGitRemoteSlug(remote.stdout) : null;
  if (slug === null || slug.toLowerCase() !== spec.repo.toLowerCase()) {
    return refuse("remote_mismatch", `origin must be ${spec.repo}; it resolves to ${remote.status === 0 ? remote.stdout || "(empty)" : "(unreadable)"}.`);
  }

  const tracked = BATCH_GUARD_TRACKED.map((f) => f.replace("<id>", scriptId));
  for (const file of tracked) {
    const r = git(["ls-files", "--error-unmatch", "--", file]);
    if (r.status !== 0) return refuse("untracked", `${file} is not tracked.`);
  }
  const local = git(["diff", "--quiet", "HEAD", "--", ...tracked]);
  if (local.status === 1) return refuse("modified", "This action's files have local modifications.");
  if (local.status !== 0) return refuse("git_error", "git could not compare this action's files with HEAD.");

  let fetchedSha: string | null = null;
  if (!dryRun) {
    // Fatal on failure; and the comparison is against what this fetch returned.
    const fetched = git(["fetch", "origin", "main"]);
    if (fetched.status !== 0) return refuse("fetch_failed", "git fetch origin main failed; refusing to compare against a possibly stale ref.");
    const head = git(["rev-parse", "--verify", "FETCH_HEAD^{commit}"]);
    if (head.status !== 0 || !/^[0-9a-f]{40}$/.test(head.stdout)) return refuse("git_error", "FETCH_HEAD did not resolve to a commit.");
    fetchedSha = head.stdout;
    const diff = git(["diff", "--quiet", fetchedSha, "--", ...tracked]);
    if (diff.status === 1) return refuse("not_on_main", "This action's files differ from the fetched origin/main: only the reviewed, merged version may run.");
    if (diff.status !== 0) return refuse("git_error", "git could not compare this action's files with the fetched main.");
  }
  return { ok: true, spec, request: requestResult.request, fetchedSha };
}
