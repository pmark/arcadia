import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { runGoCommand } from "../commands/go.js";
import { withDatabase } from "../db/connection.js";
import { getWorkItemByDocRef, listCodexInvocationsForWorkItem } from "../db/repositories.js";
import { seedFixtureActionBuildPacket } from "../fixtures/zeroPromptRehearsal.js";
import { getSession, type AgentSession, type TmuxAdapter } from "../sessions/index.js";
import { recordExitScriptPath, type SessionRecording } from "../sessions/sessionRecording.js";

/**
 * The headless-provider test behind the operator action
 * `test-headless-provider-single-action`. The operator presses it to learn
 * whether a coding-agent CLI (Codex, then OpenCode) can complete one trivial
 * governed Action with no human input.
 *
 * Everything happens inside a fresh Decision 0082 experiment workspace and a
 * one-Action fixture repository with no remote, both under a temporary
 * directory. The live workspace is never addressed: every Arcadia call names
 * the experiment workspace explicitly, and the provider process gets it as its
 * own environment (never exported to any shell). Nothing here installs,
 * starts or restarts a service, writes provider configuration or
 * authentication, reaches GitHub, or settles a live record.
 *
 * The unattended command line comes from the shipped builder
 * (`buildSessionLaunch`), not a hand copy: `go --apply --launch` runs through a
 * recording process boundary that starts nothing, and the recorded Session is
 * rebuilt with an admission marker so the builder returns the headless argv
 * (`codex exec ... --sandbox workspace-write`, `opencode run ...`) that a
 * standing-policy launch would use.
 */

/** Decision 0082 lets experiment workspaces exist until this UTC date (inclusive). */
export const EXPERIMENT_WINDOW_LAST_DAY = "2026-10-18";
export const FIXTURE_PROJECT = "headless-fixture";
export const FIXTURE_PLAN = "headless-marker";
export const FIXTURE_ACTION = "write-headless-marker";
export const FIXTURE_MARKER_LINE = "headless provider marker";
export const FIXTURE_VALIDATION = "node scripts/check-fixture.mjs";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15 * 60 * 1000;
const TEMP_PREFIX = "arcadia-headless-provider-test-";
const HEARTBEAT_SCHEMA = "arcadia-preservation-transport-v1";
/** Stripped from every child: an operator-script context must not leak into Arcadia commands or the provider. */
const OPERATOR_CONTEXT_PREFIX = "ARCADIA_OPERATOR_SCRIPT_";

export type ProviderName = "codex" | "opencode";
export const PROVIDER_ORDER: ProviderName[] = ["codex", "opencode"];
const PROVIDER_PROFILE: Record<ProviderName, string> = { codex: "codex_build", opencode: "opencode_build" };

export interface CriterionResult {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface ProviderResult {
  provider: ProviderName;
  outcome: "PASS" | "FAIL" | "REFUSED";
  reason: string | null;
  model: string | null;
  effort: string | null;
  command: string | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number | null;
  logPath: string | null;
  candidateBranch: string | null;
  candidateWorktree: string | null;
  criteria: CriterionResult[];
  /** Information only; never a criterion. */
  gitdir: GitdirReport | null;
  sessionReconcile: { exitCode: number | null; summary: string } | null;
  askFile: string | null;
  workspaceKept: string | null;
}

export interface GitdirReport {
  worktreeGitDir: string;
  commonGitDir: string;
  writableRoots: string[];
  worktreeGitDirInsideWritableRoots: boolean;
  commonGitDirInsideWritableRoots: boolean;
  note: string;
}

export interface HeadlessTestOptions {
  /** Arcadia checkout whose CLI and library the test runs (the library's own checkout). */
  repoRoot: string;
  /** `runs/<id>/` directory: run.log, provider logs, receipt. Always kept. */
  runDirectory: string;
  runId: string;
  scriptId: string;
  keep: boolean;
  providerTimeoutMs?: number;
  /** Test seam; the operator action runs both in order. */
  providers?: ProviderName[];
  /** Test seam: where temporary roots are made (default: the OS temp directory). */
  tempBase?: string;
  /** Test seam: skip the read-only live-workspace snapshot comparison. */
  liveLeakCheck?: boolean;
  /** Test seam. */
  now?: () => Date;
  /** Test seam: environment the run starts from (default process.env). */
  env?: NodeJS.ProcessEnv;
  /** Test seam: the extra directories appended to PATH (default: the usual operator tool directories). */
  toolDirectories?: string[];
  /** Test seam: where SIGINT/SIGTERM arrive from (default: this process). */
  signalSource?: Pick<NodeJS.EventEmitter, "on" | "off">;
  /** Test seam: kill grace after the timeout. */
  killGraceMs?: number;
  out?: (line: string) => void;
}

export interface HeadlessTestOutcome {
  outcome: "succeeded" | "failed" | "refused";
  stage: string;
  reason: string;
  providers: ProviderResult[];
  receiptPath: string;
}

class Refusal extends Error {
  constructor(public stage: string, message: string) { super(message); }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export function renderFixtureFiles(date: string, model: string): Record<string, string> {
  return {
    "AGENTS.md": `# AGENTS\n\nDisposable Arcadia headless-provider test fixture (Decision 0082). No remote.\nNever push, merge, deploy or publish.\n`,
    "CONSTITUTION.md": `# CONSTITUTION\n\nDisposable fixture. Make only the change the Action asks for. Never push, merge,\ndeploy, publish, spend or edit the Project pointer.\n`,
    "PROJECT.md": `---
arcadia: v1
type: project
slug: ${FIXTURE_PROJECT}
name: Headless Fixture
status: active
goal: Disposable fixture proving a headless coding agent can complete one governed Action with no human input.
outcome: A headless provider writes MARKER.md, passes the fixture check, commits it and drafts a completion Ask.
milestone: Complete the one marker Action
active_plan: ${FIXTURE_PLAN}
current_action: ${FIXTURE_ACTION}
updated: ${date}
---

# Headless Fixture

Disposable experiment fixture (Decision 0082).
`,
    [`docs/plans/${FIXTURE_PLAN}.md`]: `---
arcadia: v1
type: plan
slug: ${FIXTURE_PLAN}
project: ${FIXTURE_PROJECT}
status: active
milestone: Complete the one marker Action
token_impact: small
token_budget: One trivial file-edit Action performed by the headless provider itself.
updated: ${date}
actions:
  - id: ${FIXTURE_ACTION}
    title: Write MARKER.md containing exactly the line "${FIXTURE_MARKER_LINE}" plus a trailing newline.
    status: open
    responsibility: agent
    effort: session
    next_action: Write MARKER.md containing exactly the line "${FIXTURE_MARKER_LINE}" plus a trailing newline.
    expected_artifact: MARKER.md
    clarification: clarified
    confidence: high
    acceptance_criteria:
      - MARKER.md exists and contains exactly the line "${FIXTURE_MARKER_LINE}" followed by a trailing newline, with no other content.
      - The genesis check ${FIXTURE_VALIDATION} passes.
    depends_on: []
    decisions: []
questions: []
decisions: []
recommended_model: ${model}
recommended_reasoning_effort: low
current_action: ${FIXTURE_ACTION}
---

# Headless marker

Disposable fixture Plan with exactly one Action.
`,
    "scripts/check-fixture.mjs": `// Genesis validation for the headless-provider fixture.
import { existsSync, readFileSync } from "node:fs";
if (existsSync("MARKER.md")) {
  const text = readFileSync("MARKER.md", "utf8");
  if (text !== ${JSON.stringify(FIXTURE_MARKER_LINE + "\n")}) {
    console.error("MARKER.md must contain exactly ${FIXTURE_MARKER_LINE} and a trailing newline: " + JSON.stringify(text));
    process.exit(1);
  }
}
console.log("fixture check ok");
`
  };
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/** Directories an operator's login PATH has but a launchd-started dashboard may lack. */
function operatorToolDirectories(): string[] {
  const home = homedir();
  return ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local", "share", "mise", "shims"), path.join(home, ".local", "bin"), path.join(home, ".opencode", "bin"), path.join(home, ".codex", "bin")];
}

/** Caller PATH first (a stub or the operator's own choice wins), then the usual tool directories. */
export function buildPath(base: string | undefined, prefix: string[] = [], toolDirectories: string[] = operatorToolDirectories()): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of [...prefix, ...(base ?? "").split(path.delimiter), ...toolDirectories, "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
    if (entry && !seen.has(entry)) { seen.add(entry); entries.push(entry); }
  }
  return entries.join(path.delimiter);
}

export function sanitizedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    // The operator-script markers fence settlement authority; ARCADIA_WORKSPACE must be this test's own, never inherited.
    if (key.startsWith(OPERATOR_CONTEXT_PREFIX) || key === "ARCADIA_WORKSPACE" || key === "ARCADIA_REQUIRE_INLINE_WORKSPACE") continue;
    env[key] = value;
  }
  return env;
}

export function findExecutable(name: string, searchPath: string): string | null {
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    try {
      if (statSync(candidate).isFile()) { execFileSync("test", ["-x", candidate]); return candidate; }
    } catch { /* try the next directory */ }
  }
  return null;
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env ?? process.env }).trim();
}

// eslint-disable-next-line no-control-regex -- strips terminal colour codes from provider output
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const realOrSelf = (p: string): string => { try { return realpathSync(p); } catch { return path.resolve(p); } };

// ---------------------------------------------------------------------------
// Context for one run
// ---------------------------------------------------------------------------

interface Context {
  options: HeadlessTestOptions;
  env: NodeJS.ProcessEnv;
  searchPath: string;
  now: () => Date;
  log: (line: string) => void;
  tsxImport: string;
  cli: string;
  /** Set when the launcher received SIGINT/SIGTERM; no later provider is started. */
  interrupted: string | null;
  /** Stops the provider process group currently running, if any. */
  stopActive: ((signal: NodeJS.Signals) => void) | null;
}

function makeContext(options: HeadlessTestOptions): Context {
  const env = options.env ?? process.env;
  const log = (line: string) => {
    appendFileSync(path.join(options.runDirectory, "run.log"), line + "\n");
    (options.out ?? ((l: string) => process.stdout.write(l + "\n")))(line);
  };
  const repoRoot = realpathSync(options.repoRoot);
  let tsxImport: string;
  try {
    tsxImport = pathToFileURL(createRequire(path.join(repoRoot, "package.json")).resolve("tsx/esm")).href;
  } catch {
    throw new Refusal("preconditions", `tsx is not installed in ${repoRoot}; run pnpm install in the Arcadia checkout first`);
  }
  return {
    options, env, now: options.now ?? (() => new Date()), log, tsxImport,
    searchPath: buildPath(env.PATH, [], options.toolDirectories),
    cli: path.join(repoRoot, "src", "cli.ts"),
    interrupted: null,
    stopActive: null
  };
}

interface CliResult { status: number | null; stdout: string; stderr: string; json: any }

/** Run one Arcadia CLI command against an explicit workspace; the live workspace is never resolved. */
function arcadia(context: Context, workspace: string | null, args: string[], extraEnv: NodeJS.ProcessEnv = {}): CliResult {
  const run = spawnSync(process.execPath, ["--import", context.tsxImport, context.cli, ...args], {
    cwd: path.dirname(path.dirname(context.cli)),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...sanitizedEnv(context.env), PATH: context.searchPath, ...(workspace ? { ARCADIA_WORKSPACE: workspace, ARCADIA_REQUIRE_INLINE_WORKSPACE: "1" } : {}), ...extraEnv }
  });
  let json: any = null;
  try { json = JSON.parse(run.stdout); } catch { /* not JSON output */ }
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", json };
}

function mustArcadia(context: Context, workspace: string | null, args: string[], what: string): CliResult {
  const result = arcadia(context, workspace, args);
  if (result.status !== 0 || (result.json && result.json.ok === false)) {
    const detail = (result.json?.error?.message ?? result.stderr.trim().split("\n").slice(-3).join(" ") ?? "").slice(0, 400);
    throw new Refusal("setup", `${what} failed (exit ${result.status}): ${detail}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

const PROVIDER_BINARY: Record<ProviderName, string> = { codex: "codex", opencode: "opencode" };

export interface ProviderPrecondition { ok: boolean; message: string; binary: string | null; warning?: string }

export function checkProviderPrecondition(context: Pick<Context, "searchPath" | "env">, provider: ProviderName): ProviderPrecondition {
  const name = PROVIDER_BINARY[provider];
  const binary = findExecutable(name, context.searchPath);
  if (!binary) return { ok: false, binary: null, message: `${name} was not found on PATH (searched ${context.searchPath}); install it and sign in as the operator, then rerun` };
  const args = provider === "codex" ? ["login", "status"] : ["auth", "list"];
  const probe = spawnSync(binary, args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], env: { ...sanitizedEnv(context.env), PATH: context.searchPath } });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.replace(ANSI, "").trim();
  const command = `${name} ${args.join(" ")}`;
  const failure = probe.error ? probe.error.message : probe.status !== 0 ? `exit ${probe.status}` : null;
  if (provider === "codex") {
    if (failure) return { ok: false, binary, message: `${command} failed (${failure}): ${output.slice(0, 200) || "no output"}; sign in as the operator (codex login) and rerun` };
    return { ok: true, binary, message: `${command} succeeded` };
  }
  // OpenCode's credential listing is not a documented contract. Refuse only on its one clear signal, "0 credentials";
  // anything else uncertain (an unknown subcommand, a changed format) warns and lets the attempt itself decide.
  if (!failure && /\b0 credentials\b/i.test(output)) {
    return { ok: false, binary, message: `${command} lists no credentials; sign in with opencode auth login and rerun` };
  }
  if (failure) {
    const warning = `${command} could not confirm a sign-in (${failure}: ${output.slice(0, 120) || "no output"}); proceeding, the attempt itself will show whether OpenCode is signed in`;
    return { ok: true, binary, message: warning, warning };
  }
  return { ok: true, binary, message: `${command} succeeded` };
}

// ---------------------------------------------------------------------------
// One provider attempt
// ---------------------------------------------------------------------------

function newResult(provider: ProviderName): ProviderResult {
  return {
    provider, outcome: "FAIL", reason: null, model: null, effort: null, command: null, exitCode: null, signal: null, timedOut: false,
    durationMs: null, logPath: null, candidateBranch: null, candidateWorktree: null, criteria: [], gitdir: null, sessionReconcile: null,
    askFile: null, workspaceKept: null
  };
}

function writeHeartbeat(workspace: string, now: number): void {
  const file = path.join(workspace, ".arcadia", "preservation.heartbeat");
  mkdirSync(path.dirname(file), { recursive: true });
  // The experiment guard forbids `worker start`, so the freshness evidence `go --apply` requires is written directly.
  writeFileSync(file, JSON.stringify({ schema: HEARTBEAT_SCHEMA, at: now, sessions: [], goRequests: true, goRequestsAt: now }));
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

function writeArcadiaShim(directory: string, workspace: string, context: Context): void {
  mkdirSync(directory, { recursive: true });
  const shim = path.join(directory, "arcadia");
  // The shim pins the experiment workspace itself, so no `arcadia` command the provider runs can fall back to the live default
  // even if the provider's shell drops its environment; REQUIRE_INLINE makes an unnamed fallback fail instead of resolving.
  writeFileSync(shim, `#!/bin/sh\nARCADIA_WORKSPACE=${shellQuote(workspace)}\nARCADIA_REQUIRE_INLINE_WORKSPACE=1\nexport ARCADIA_WORKSPACE ARCADIA_REQUIRE_INLINE_WORKSPACE\nexec ${shellQuote(process.execPath)} --import ${shellQuote(context.tsxImport)} ${shellQuote(context.cli)} "$@"\n`);
  chmodSync(shim, 0o755);
}

/** The cheapest enabled binding the experiment workspace's own provider config offers this build profile. */
function bindingModelFor(workspace: string, profile: string): string {
  const config = JSON.parse(readFileSync(path.join(workspace, "config", "provider-adapters.json"), "utf8"));
  const bindings = (config.bindings as Array<{ enabled?: boolean; model?: string; costRank?: number; agentProfiles?: string[] }>)
    .filter((binding) => binding.enabled !== false && binding.model && binding.agentProfiles?.includes(profile))
    .sort((a, b) => (a.costRank ?? 99) - (b.costRank ?? 99));
  if (!bindings[0]?.model) throw new Refusal("setup", `the workspace provider config has no enabled binding for profile ${profile}`);
  return bindings[0].model;
}

function setBuildProfile(workspace: string, profile: string): void {
  const file = path.join(workspace, "config", "coding-agent-profiles.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  config.defaults = { ...config.defaults, build: profile };
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

function fixtureGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env, GIT_AUTHOR_NAME: "Arcadia headless fixture", GIT_AUTHOR_EMAIL: "fixture@headless.invalid",
    GIT_COMMITTER_NAME: "Arcadia headless fixture", GIT_COMMITTER_EMAIL: "fixture@headless.invalid"
  };
}

function createFixture(context: Context, workspace: string, date: string, model: string): string {
  const fixture = path.join(workspace, "projects", FIXTURE_PROJECT);
  for (const [relative, content] of Object.entries(renderFixtureFiles(date, model))) {
    const target = path.join(fixture, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const env = fixtureGitEnv();
  git(fixture, ["init", "-q", "-b", "main"], env);
  git(fixture, ["config", "commit.gpgsign", "false"], env);
  git(fixture, ["add", "-A"], env);
  git(fixture, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "Genesis: headless-provider test fixture"], env);
  if (git(fixture, ["remote"], env) !== "") throw new Refusal("setup", "the fixture repository unexpectedly has a remote");
  context.log(`fixture: ${fixture} (genesis ${git(fixture, ["rev-parse", "--short", "HEAD"], env)}, no remote)`);
  return fixture;
}

class RecordingTmux implements TmuxAdapter {
  launches: Array<{ name: string; cwd: string; command: string; args: string[]; record?: SessionRecording }> = [];
  available(): boolean { return true; }
  hasSession(): boolean { return false; }
  launch(input: { name: string; cwd: string; command: string; args: string[]; record?: SessionRecording }): void { this.launches.push(input); }
}

function computeGitdirReport(context: Context, worktree: string): GitdirReport {
  const worktreeGitDir = realOrSelf(git(worktree, ["rev-parse", "--absolute-git-dir"]));
  const commonRaw = git(worktree, ["rev-parse", "--git-common-dir"]);
  const commonGitDir = realOrSelf(path.isAbsolute(commonRaw) ? commonRaw : path.join(worktree, commonRaw));
  const roots = [...new Set([realOrSelf(worktree), realOrSelf(context.env.TMPDIR || tmpdir()), realOrSelf("/tmp")])];
  const worktreeIn = roots.some((root) => inside(root, worktreeGitDir));
  const commonIn = roots.some((root) => inside(root, commonGitDir));
  return {
    worktreeGitDir, commonGitDir, writableRoots: roots,
    worktreeGitDirInsideWritableRoots: worktreeIn,
    commonGitDirInsideWritableRoots: commonIn,
    note: "Roots are the documented Codex workspace-write defaults (the --cd directory, $TMPDIR and /tmp); the operator's own Codex config (extra writable_roots) is not read. " +
      "This fixture lives under the temporary directory, so a commit can succeed here even where a real repository's gitdir (outside ~/.codex/worktrees) would be denied."
  };
}

function summarizeReconcile(result: CliResult, file: string): string {
  const data = result.json?.data;
  const text = data
    ? JSON.stringify(data, (key, value) => (typeof value === "string" && value.length > 80 ? `${value.slice(0, 77)}...` : key === "session" ? undefined : value))
    : (result.json?.error?.message ?? result.stderr.trim().split("\n").slice(-2).join(" "));
  return `${String(text).slice(0, 300)} (full output ${file})`;
}

function formatCap(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)}-minute` : `${Math.round(ms / 1000)}-second`;
}

function findDraftedAsks(worktree: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    let entries: string[];
    try { entries = readdirSync(directory); } catch { return; }
    for (const entry of entries.sort()) {
      const full = path.join(directory, entry);
      let stats;
      try { stats = statSync(full); } catch { continue; }
      if (stats.isDirectory()) walk(full);
      else if (/\.(ya?ml|json)$/i.test(entry)) found.push(full);
    }
  };
  walk(path.join(worktree, ".arcadia", "asks"));
  return found;
}

function readAsk(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = parseYaml(readFileSync(file, "utf8"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch { return null; }
}

function planCriteria(worktree: string): string[] {
  const text = readFileSync(path.join(worktree, "docs", "plans", `${FIXTURE_PLAN}.md`), "utf8");
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const plan = parseYaml(front) as { actions?: Array<{ id: string; acceptance_criteria?: string[] }> };
  return plan.actions?.find((action) => action.id === FIXTURE_ACTION)?.acceptance_criteria ?? [];
}

async function runProviderProcess(context: Context, input: {
  provider: ProviderName; command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; logPath: string; timeoutMs: number;
}): Promise<{ exitCode: number | null; signal: string | null; timedOut: boolean; durationMs: number }> {
  const started = Date.now();
  const graceMs = context.options.killGraceMs ?? 10_000;
  return new Promise((resolve) => {
    const child = spawn(input.command, input.args, { cwd: input.cwd, env: input.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let timedOut = false;
    let settled = false;
    const sink = (chunk: Buffer) => {
      appendFileSync(input.logPath, chunk);
      process.stdout.write(chunk);
    };
    child.stdout?.on("data", sink);
    child.stderr?.on("data", sink);
    const killGroup = (signal: NodeJS.Signals) => {
      try { process.kill(-child.pid!, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
    };
    context.stopActive = (signal) => {
      appendFileSync(input.logPath, `\n[headless-provider-test] ${signal} received by the test; stopping the process group\n`);
      killGroup(signal);
      setTimeout(() => killGroup("SIGKILL"), graceMs).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      appendFileSync(input.logPath, `\n[headless-provider-test] timeout after ${input.timeoutMs} ms; stopping the process group\n`);
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), graceMs).unref();
    }, input.timeoutMs);
    const finish = (exitCode: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.stopActive = null;
      resolve({ exitCode, signal, timedOut, durationMs: Date.now() - started });
    };
    child.once("error", (error) => {
      appendFileSync(input.logPath, `[headless-provider-test] could not start ${input.command}: ${error.message}\n`);
      finish(null, null);
    });
    // The process exiting is the result. A descendant that kept the output pipes open must not look like a hang or a timeout:
    // sweep the group so those handles close, give the pipes a moment to drain, then resolve.
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      killGroup("SIGKILL");
      const drain = setTimeout(() => finish(code, signal), 2_000);
      drain.unref();
      child.once("close", () => { clearTimeout(drain); finish(code, signal); });
    });
  });
}

function rawGit(cwd: string, args: string[]): string | null {
  try { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch { return null; }
}

/** Completion states a work item reaches once its `complete` Ask settled. */
const DONE_STATES = new Set(["done", "completed", "complete"]);

function evaluate(context: Context, result: ProviderResult, input: {
  workspace: string; worktree: string; baseRevision: string; branch: string;
  run: { exitCode: number | null; signal: string | null; timedOut: boolean; durationMs: number }; timeoutMs: number;
}): void {
  const { worktree } = input;
  const criteria: CriterionResult[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => criteria.push({ id, label, pass, detail });
  add("exit", `provider exited 0 within the ${formatCap(input.timeoutMs)} cap`,
    input.run.exitCode === 0 && !input.run.timedOut,
    input.run.timedOut ? `timed out after ${Math.round(input.run.durationMs / 1000)}s` : `exit ${input.run.exitCode ?? "none"}${input.run.signal ? ` (${input.run.signal})` : ""} after ${Math.round(input.run.durationMs / 1000)}s`);

  let marker: string | null = null;
  try { marker = readFileSync(path.join(worktree, "MARKER.md"), "utf8"); } catch { /* absent */ }
  const expected = FIXTURE_MARKER_LINE + "\n";
  add("file", "MARKER.md exists with exactly the expected line", marker === expected, marker === null ? "MARKER.md is absent" : marker === expected ? "content matches" : `unexpected content ${JSON.stringify(marker.slice(0, 80))}`);

  const validation = spawnSync(process.execPath, ["scripts/check-fixture.mjs"], { cwd: worktree, encoding: "utf8", timeout: 30_000 });
  add("validation", `${FIXTURE_VALIDATION} passes`, validation.status === 0 && marker === expected,
    validation.status === 0 ? (marker === expected ? "fixture check ok" : "check passes only because MARKER.md is absent or wrong") : (validation.stderr || validation.stdout || "check failed").trim().slice(0, 200));

  // A drafted completion Ask legitimately sits untracked under .arcadia/asks/ until the host settles it; nothing else may be dirty.
  const dirty = rawGit(worktree, ["status", "--porcelain", "--", ".", ":(exclude).arcadia/asks"]);
  const dirtyAll = rawGit(worktree, ["status", "--porcelain"]);
  const commits = rawGit(worktree, ["rev-list", "--count", `${input.baseRevision}..HEAD`]);
  const committedMarker = rawGit(worktree, ["show", "HEAD:MARKER.md"]);
  const branch = rawGit(worktree, ["branch", "--show-current"])?.trim() ?? null;
  const commitCount = commits === null ? 0 : Number(commits.trim());
  const onBranch = branch === input.branch;
  add("commit", "a clean commit with MARKER.md exists on the candidate branch",
    commitCount >= 1 && committedMarker === expected && onBranch && dirty !== null && dirty.trim() === "",
    commits === null ? "git could not read the candidate branch"
      : `${commitCount} commit(s) beyond the base on ${branch ?? "no branch"}${onBranch ? "" : ` (expected ${input.branch})`}; HEAD ${committedMarker === null ? "has no MARKER.md" : committedMarker === expected ? "carries the exact MARKER.md" : "carries a different MARKER.md"}; ` +
        `${dirty === null ? "status unreadable" : dirty.trim() === "" ? "tree clean" : `uncommitted changes: ${dirty.trim().split("\n").slice(0, 3).join("; ")}`}`);

  const wanted = planCriteria(worktree);
  const criterionComplete = (ask: Record<string, unknown>): boolean => {
    const evidence: Array<{ criterion?: string; status?: string }> = Array.isArray(ask.evidence) ? ask.evidence : [];
    return evidence.length === wanted.length && wanted.every((criterion, index) => evidence[index]?.criterion === criterion && evidence[index]?.status === "met");
  };
  const head = rawGit(worktree, ["rev-parse", "HEAD"])?.trim() ?? null;
  const actionStatus = withDatabase(input.workspace, (db) => getWorkItemByDocRef(db, `plan/${FIXTURE_PLAN}#${FIXTURE_ACTION}`)?.status ?? null);
  let askDetail = "no Agent Ask file under .arcadia/asks/";
  let askPass = false;
  for (const file of findDraftedAsks(worktree)) {
    const relative = path.relative(worktree, file);
    const ask = readAsk(file);
    if (!ask || ask.intent !== "complete") { askDetail = `${relative} is not a complete-intent Ask`; continue; }
    result.askFile = file;
    const complete = criterionComplete(ask);
    const revision = typeof ask.candidate_revision === "string" ? ask.candidate_revision : null;
    const settled = relative.split(path.sep).includes("archive");
    if (!settled) {
      // Drafted and left for the host: the Ask names the candidate's HEAD and preview accepts it.
      const preview = arcadia(context, input.workspace, ["agent-ask", "preview", "--file", file, "--dir", worktree, "--json"]);
      const accepted = preview.status === 0 && preview.json?.ok === true;
      const revisionMatches = revision !== null && head !== null && head === revision;
      askPass = complete && revisionMatches && accepted;
      askDetail = `drafted ${relative}: ${complete ? "every criterion met, verbatim and in order" : `evidence does not match the ${wanted.length} declared criteria`}; ` +
        `candidate_revision ${revisionMatches ? "equals HEAD" : "does not equal HEAD"}; preview ${accepted ? "accepted" : `refused (${(preview.json?.error?.message ?? preview.stderr.trim().split("\n").slice(-1)[0] ?? "").slice(0, 160)})`}`;
    } else {
      // Settled by the agent (the brief's first choice): settlement archived the Ask in its own commit, so HEAD moved past the
      // candidate revision. Accept it when that revision is still an ancestor holding the exact MARKER.md, the Action is complete
      // in the experiment database and the tree is entirely clean.
      const ancestor = revision !== null && spawnSync("git", ["-C", worktree, "merge-base", "--is-ancestor", revision, "HEAD"]).status === 0;
      const atRevision = revision !== null ? rawGit(worktree, ["show", `${revision}:MARKER.md`]) : null;
      const done = actionStatus !== null && DONE_STATES.has(actionStatus);
      const clean = dirtyAll !== null && dirtyAll.trim() === "";
      askPass = complete && ancestor && atRevision === expected && done && clean;
      askDetail = `settled ${relative}: ${complete ? "every criterion met, verbatim and in order" : `evidence does not match the ${wanted.length} declared criteria`}; ` +
        `candidate_revision ${ancestor ? "is an ancestor of HEAD" : "is not an ancestor of HEAD"} and ${atRevision === expected ? "holds the exact MARKER.md" : "does not hold the exact MARKER.md"}; ` +
        `Action status in the experiment database: ${actionStatus ?? "unknown"}; tree ${clean ? "clean" : "not clean"}`;
    }
    if (askPass) break;
  }
  add("ask", "a criterion-complete completion Agent Ask was drafted (preview accepts it) or settled (Action complete)", askPass, askDetail);
  result.criteria = criteria;
}

async function runProviderAttempt(context: Context, provider: ProviderName, tempRoot: string, date: string): Promise<ProviderResult> {
  const result = newResult(provider);
  const timeoutMs = context.options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const attemptRoot = path.join(tempRoot, provider);
  const workspace = path.join(attemptRoot, `exp-headless-${provider}`);
  const logPath = path.join(context.options.runDirectory, `${provider}.log`);
  result.logPath = logPath;
  writeFileSync(logPath, "");
  mkdirSync(attemptRoot, { recursive: true });
  const precondition = checkProviderPrecondition(context, provider);
  context.log(`precondition (${provider}): ${precondition.message}`);
  if (!precondition.ok) { result.outcome = "REFUSED"; result.reason = precondition.message; return result; }

  try {
    mustArcadia(context, null, ["init", "--profile", "experiment", workspace, "--json"], "experiment workspace init");
    setBuildProfile(workspace, PROVIDER_PROFILE[provider]);
    const fixture = createFixture(context, workspace, date, bindingModelFor(workspace, PROVIDER_PROFILE[provider]));

    const imported = mustArcadia(context, workspace, ["project", "import", "--name", "Headless Fixture", "--mission", "Disposable headless-provider test fixture.",
      "--outcome", "Disposable test fixture.", "--milestone", "Complete the one marker Action", "--next-action", "Import fixture documents",
      "--responsibility", "agent", "--status", "active", "--json"], "project import");
    const projectId: string | undefined = imported.json?.data?.project?.id;
    if (!projectId || imported.json?.data?.project?.slug !== FIXTURE_PROJECT) throw new Refusal("setup", "project import did not create the fixture Project");
    mustArcadia(context, workspace, ["project", "metadata", projectId, "--repo-path", fixture, "--validation-command", FIXTURE_VALIDATION, "--json"], "project metadata");
    const sync = mustArcadia(context, workspace, ["docs", "sync", "--project", FIXTURE_PROJECT, "--apply", "--json"], "docs sync");
    if (sync.json?.data?.errorCount !== 0) throw new Refusal("setup", `docs sync reported ${sync.json?.data?.errorCount} error(s) for the fixture: ${JSON.stringify((sync.json?.data?.projects ?? []).flatMap((project: any) => project.errors ?? [])).slice(0, 400)}`);

    const packet = withDatabase(workspace, (db) => seedFixtureActionBuildPacket(db, workspace, { projectId, projectSlug: FIXTURE_PROJECT, planSlug: FIXTURE_PLAN, actionId: FIXTURE_ACTION }));
    const model = withDatabase(workspace, (db) => {
      const item = getWorkItemByDocRef(db, `plan/${FIXTURE_PLAN}#${FIXTURE_ACTION}`);
      const invocation = item ? listCodexInvocationsForWorkItem(db, item.id).filter((c) => c.purpose === "build" && c.status === "packet_created").at(-1) : null;
      if (!invocation) return null;
      const metadata = JSON.parse(readFileSync(path.join(path.dirname(path.join(workspace, invocation.prompt_path)), "metadata.json"), "utf8"));
      return (metadata.providerSelection?.model as string | undefined) ?? null;
    });
    if (!model) throw new Refusal("setup", "the seeded build packet names no provider model");
    result.model = model;
    context.log(`prepare (${provider}): build packet ${packet.invocationId} seeded; pinned model ${model}`);

    // `go --apply` needs a fresh worker heartbeat; the experiment guard forbids starting a worker.
    writeHeartbeat(workspace, Date.now());
    const recording = new RecordingTmux();
    const go = runGoCommand({
      repo: fixture, apply: true, agent: provider, launch: true, model, workspace,
      agentWorktreeRoot: path.join(workspace, "projects", "worktrees"), tmux: recording
    });
    const session: AgentSession | null = go.data.session;
    if (!session) throw new Refusal("prepare", "go --apply prepared no Session for the fixture Action");
    const worktree = realOrSelf(session.worktree_path);
    result.candidateBranch = session.branch;
    result.candidateWorktree = worktree;
    result.effort = session.effort;
    context.log(`prepare (${provider}): candidate ${session.branch} at ${worktree} (go --apply --agent ${provider} --launch; process boundary recorded, nothing started yet)`);

    // `go --launch` is headless by default: the recorded launch is the shipped builder's unattended argv
    // (codex exec ... --sandbox workspace-write, opencode run ...), exactly what a standing-policy launch runs.
    const launched = recording.launches.at(-1);
    if (!launched) throw new Refusal("prepare", "go --launch recorded no launch for the Session");
    result.command = [launched.command, ...launched.args.map((arg) => (arg.length > 120 ? `${arg.slice(0, 40).replaceAll("\n", " ")}...[${arg.length} chars]` : arg))].join(" ");
    context.log(`launch (${provider}): ${result.command}`);
    // Run the argv directly rather than through tmux's recording wrapper: this test waits on the provider process itself, and a
    // descendant that keeps the wrapper's pipe open must not look like a hang. The wrapper's one durable effect, the provider's
    // exit code in agent_sessions.exit_status, is recorded below with the shipped script, so reconcile sees what it sees in production.
    const runnable = { command: launched.command, args: launched.args };

    result.gitdir = computeGitdirReport(context, worktree);
    context.log(`gitdir (${provider}): worktree gitdir ${result.gitdir.worktreeGitDir} inside writable roots: ${result.gitdir.worktreeGitDirInsideWritableRoots}; common gitdir ${result.gitdir.commonGitDir} inside: ${result.gitdir.commonGitDirInsideWritableRoots}`);

    const shimDirectory = path.join(attemptRoot, "bin");
    writeArcadiaShim(shimDirectory, workspace, context);
    const env: NodeJS.ProcessEnv = {
      ...sanitizedEnv(context.env), PATH: buildPath(context.env.PATH, [shimDirectory], context.options.toolDirectories),
      // Both the provider and anything it runs resolve this experiment workspace, never the live default.
      ARCADIA_WORKSPACE: workspace
    };
    if (context.interrupted) throw new Refusal("interrupted", `${context.interrupted} received before the provider started`);
    context.log(`run (${provider}): headless, cap ${formatCap(timeoutMs)}, log ${logPath}`);
    const run = await runProviderProcess(context, { provider, command: runnable.command, args: runnable.args, cwd: worktree, env, logPath, timeoutMs });
    result.exitCode = run.exitCode;
    result.signal = run.signal;
    result.timedOut = run.timedOut;
    result.durationMs = run.durationMs;
    if (launched.record) {
      const recorded = spawnSync(process.execPath, [recordExitScriptPath(), "--db", launched.record.databaseFile, "--session-id", session.id, "--exit-status", String(run.exitCode ?? 1)], { encoding: "utf8" });
      if (recorded.status !== 0) context.log(`could not record the exit status for the Session: ${recorded.stderr.trim()}`);
    }

    evaluate(context, result, { workspace, worktree, baseRevision: session.base_revision, branch: session.branch, run, timeoutMs });

    // Information only: what the host would make of the finished Session.
    const reconcile = arcadia(context, workspace, ["session", "reconcile", session.id, "--repo", fixture, "--request-id", `${context.options.runId}-${provider}`, "--json"]);
    const reconcileFile = path.join(context.options.runDirectory, `session-reconcile-${provider}.json`);
    writeFileSync(reconcileFile, reconcile.stdout || reconcile.stderr);
    result.sessionReconcile = { exitCode: reconcile.status, summary: summarizeReconcile(reconcile, reconcileFile) };
    const stillThere = withDatabase(workspace, (db) => getSession(db, session.id));
    context.log(`session reconcile (${provider}, information only): exit ${reconcile.status}; session row ${stillThere?.status ?? "missing"}`);
    result.outcome = result.criteria.every((criterion) => criterion.pass) ? "PASS" : "FAIL";
  } catch (error) {
    result.outcome = "FAIL";
    result.reason = error instanceof Error ? error.message : String(error);
    if (error instanceof Refusal) result.reason = `${error.stage}: ${error.message}`;
    context.log(`error (${provider}): ${result.reason}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Orchestration, table and receipt
// ---------------------------------------------------------------------------

export function formatTable(results: ProviderResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`${result.provider}${result.model ? ` (${result.model})` : ""}: ${result.outcome}${result.reason ? ` - ${result.reason}` : ""}`);
    for (const criterion of result.criteria) lines.push(`  ${criterion.pass ? "PASS" : "FAIL"}  ${criterion.label}  [${criterion.detail}]`);
    if (result.gitdir) {
      lines.push(`  info  worktree gitdir inside sandbox-writable roots: ${result.gitdir.worktreeGitDirInsideWritableRoots} (${result.gitdir.worktreeGitDir}); common gitdir inside: ${result.gitdir.commonGitDirInsideWritableRoots}`);
    }
    if (result.sessionReconcile) lines.push(`  info  session reconcile exit ${result.sessionReconcile.exitCode}: ${result.sessionReconcile.summary}`);
    if (result.logPath) lines.push(`  info  provider log ${result.logPath}`);
  }
  return lines.join("\n");
}

function jsonReceipt(options: HeadlessTestOptions, startedAt: string, outcome: HeadlessTestOutcome, extra: Record<string, unknown>): string {
  const receiptPath = path.join(options.runDirectory, "receipt.json");
  writeFileSync(receiptPath, JSON.stringify({
    schema: "arcadia-operator-run-receipt-v1",
    id: options.scriptId,
    runId: options.runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    outcome: outcome.outcome,
    stage: outcome.stage,
    reason: outcome.reason,
    runLog: path.join(options.runDirectory, "run.log"),
    liveWorkspaceAddressed: false,
    providers: outcome.providers,
    ...extra
  }, null, 2) + "\n");
  return receiptPath;
}

function writeFailureHandoff(options: HeadlessTestOptions, outcome: HeadlessTestOutcome): void {
  const lines = [
    "# Operator-script failure handoff", "",
    `- id: ${options.scriptId}`, `- run: ${options.runId}`, `- outcome: ${outcome.outcome} at stage ${outcome.stage}`,
    `- reason: ${outcome.reason}`, `- run log: ${path.join(options.runDirectory, "run.log")}`, `- receipt: ${outcome.receiptPath}`, "",
    "No provider completed the fixture Action headlessly, or the test could not start. The live workspace, production, services, GitHub and provider configuration were not touched.",
    "", "## Results", "", "```", formatTable(outcome.providers) || "(no provider was attempted)", "```", "",
    "## Next step", "",
    "Give this handoff, the run log and the provider logs listed above to a coding agent and ask it to diagnose the first failing criterion. " +
      "A provider that exits non-zero, writes nothing or never drafts the completion Ask is a finding about that provider's unattended launch, not a reason to rerun blindly. " +
      "Rerun with --keep to inspect the fixture workspace and candidate worktree afterwards."
  ];
  writeFileSync(path.join(options.runDirectory, "failure-handoff.md"), lines.join("\n") + "\n");
}

function liveSnapshot(context: Context, args: string[]): { ok: boolean; changed: boolean | null; detail: string } {
  if (context.options.liveLeakCheck === false) return { ok: false, changed: null, detail: "skipped" };
  const run = arcadia(context, null, ["workspace", "leak-check", ...args, "--json"]);
  if (run.status === null) return { ok: false, changed: null, detail: "leak-check did not run" };
  return { ok: run.status === 0, changed: args.includes("--baseline") ? run.status !== 0 : null, detail: (run.stdout.trim() || run.stderr.trim()).slice(0, 600) };
}

export async function runHeadlessProviderTest(options: HeadlessTestOptions): Promise<HeadlessTestOutcome> {
  mkdirSync(options.runDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const providers: ProviderResult[] = [];
  let tempRoot: string | null = null;
  let context: Context | null = null;
  const finish = (outcome: "succeeded" | "failed" | "refused", stage: string, reason: string, extra: Record<string, unknown> = {}): HeadlessTestOutcome => {
    const result: HeadlessTestOutcome = { outcome, stage, reason, providers, receiptPath: path.join(options.runDirectory, "receipt.json") };
    result.receiptPath = jsonReceipt(options, startedAt, result, { keep: options.keep, ...extra });
    if (outcome !== "succeeded") writeFailureHandoff(options, result);
    return result;
  };
  try {
    context = makeContext(options);
    const date = context.now().toISOString().slice(0, 10);
    context.log(`== Headless provider single-Action test (experiment fixture, Decision 0082) ==`);
    if (date > EXPERIMENT_WINDOW_LAST_DAY) {
      throw new Refusal("preconditions", `Decision 0082's experiment window ended ${EXPERIMENT_WINDOW_LAST_DAY}; it is ${date}. No experiment workspace may be created until a new Decision extends it`);
    }
    const order = options.providers ?? PROVIDER_ORDER;
    // Refuse before creating anything when the first provider cannot run at all.
    const first = checkProviderPrecondition(context, order[0]);
    if (!first.ok) throw new Refusal("preconditions", first.message);

    const base = options.tempBase ?? options.env?.TMPDIR ?? tmpdir();
    mkdirSync(base, { recursive: true });
    tempRoot = realpathSync(mkdtempSync(path.join(base, TEMP_PREFIX)));
    context.log(`temporary root: ${tempRoot}${options.keep ? " (kept: --keep)" : " (removed at the end)"}`);
    const before = path.join(options.runDirectory, "live-workspace-before.json");
    const snapshot = liveSnapshot(context, ["--record", before]);
    context.log(`live workspace snapshot (read-only): ${snapshot.ok ? "recorded" : snapshot.detail}`);

    // SIGINT/SIGTERM (a /runs stop, a closed terminal) stop the provider's whole process group, skip any fallback and still write the receipt.
    const live = context;
    const onSignal = (signal: NodeJS.Signals) => () => {
      live.interrupted = signal;
      live.log(`${signal} received: stopping the provider and finishing with a receipt`);
      live.stopActive?.("SIGTERM");
    };
    const source = options.signalSource ?? process;
    const handlers: Array<[NodeJS.Signals, () => void]> = (["SIGINT", "SIGTERM"] as const).map((signal) => [signal, onSignal(signal)]);
    for (const [signal, handler] of handlers) source.on(signal, handler);
    try {
      for (const provider of order) {
        if (context.interrupted) break;
        const result = await runProviderAttempt(context, provider, tempRoot, date);
        if (options.keep) result.workspaceKept = path.join(tempRoot, provider);
        providers.push(result);
        context.log("");
        context.log(formatTable([result]));
        context.log("");
        if (result.outcome === "PASS") break;
        if (provider !== order[order.length - 1] && !context.interrupted) context.log(`${provider} did not pass; trying ${order[order.indexOf(provider) + 1]} on a fresh fixture.`);
      }
    } finally {
      for (const [signal, handler] of handlers) source.off(signal, handler);
    }

    const after = snapshot.ok ? liveSnapshot(context, ["--baseline", before]) : snapshot;
    // Decision 0082's stop condition is any change to the live workspace attributable to an experiment, so a difference is
    // never waved through: other sessions legitimately write there, but each change must be attributed before the next experiment.
    const liveChanged = snapshot.ok ? after.changed : null;
    context.log(snapshot.ok
      ? liveChanged
        ? "LIVE WORKSPACE CHANGED during this run: attribute every change (other sessions or services, versus this experiment) before any further experiment; an experiment-caused write is a Decision 0082 stop condition. See live-workspace-before.json and the receipt."
        : "live workspace comparison: unchanged"
      : "live workspace comparison: skipped");
    context.log("== Summary ==");
    context.log(formatTable(providers));
    const passed = providers.find((result) => result.outcome === "PASS");
    const outcome = context.interrupted ? "failed" : passed ? "succeeded" : "failed";
    const reason = context.interrupted ? `interrupted by ${context.interrupted}` : passed ? `${passed.provider} completed the fixture Action headlessly` : "no provider passed every criterion";
    return finish(outcome, context.interrupted ? "interrupted" : "complete", reason, {
      liveWorkspaceSnapshot: { recorded: snapshot.ok, changedDuringRun: liveChanged, actionRequired: liveChanged ? "attribute before any further experiment (Decision 0082 stop condition)" : null, detail: after.detail },
      tempRoot: options.keep ? tempRoot : null
    });
  } catch (error) {
    const stage = error instanceof Refusal ? error.stage : "unexpected";
    const reason = error instanceof Error ? error.message : String(error);
    context?.log(`REFUSED: ${reason}`);
    if (!context) appendFileSync(path.join(options.runDirectory, "run.log"), `REFUSED: ${reason}\n`);
    return finish(error instanceof Refusal ? "refused" : "failed", stage, reason, { tempRoot: options.keep ? tempRoot : null });
  } finally {
    if (tempRoot && !options.keep && path.basename(tempRoot).startsWith(TEMP_PREFIX)) {
      rmSync(tempRoot, { recursive: true, force: true });
      context?.log(`cleaned up ${tempRoot}; logs and receipt are kept in ${options.runDirectory}`);
    } else if (tempRoot) {
      context?.log(`kept ${tempRoot}`);
    }
  }
}
