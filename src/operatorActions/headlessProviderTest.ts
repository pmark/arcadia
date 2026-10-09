import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { runGoCommand } from "../commands/go.js";
import { runPreserveCommand } from "../commands/preserve.js";
import { withDatabase } from "../db/connection.js";
import { getWorkItemByDocRef, listCodexInvocationsForWorkItem } from "../db/repositories.js";
import { seedFixtureActionBuildPacket } from "../fixtures/zeroPromptRehearsal.js";
import { loadModelTierRegistry, modelTierOverridePath, sessionStartBinding } from "../codingAgents/modelTiers.js";
import { getSession, type AgentSession, type TmuxAdapter } from "../sessions/index.js";
import { checkLaunchPrerequisites } from "../sessions/launchPreflight.js";
import { claudePreservationDenied, describeClaudeResult, extractDiagnosis, parseClaudeStream } from "./headlessProviderDiagnosis.js";
import { recordExitScriptPath, type SessionRecording } from "../sessions/sessionRecording.js";

/**
 * The headless-provider test behind the operator action
 * `test-headless-provider-single-action`. The operator presses it to learn
 * whether each coding-agent CLI (Codex, OpenCode and Claude Code), tried
 * independently on its own fresh fixture, can complete one trivial governed
 * Action with no human input.
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
 * (`codex exec ... --sandbox workspace-write`, `opencode run ...`,
 * `claude --print --output-format stream-json ... --settings <file>
 * --setting-sources ""`) that a standing-policy launch would use.
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

export type ProviderName = "codex" | "opencode" | "claude";
/** Every provider is tried, in this order, each on its own fresh fixture; a failure never stops the next. */
export const PROVIDER_ORDER: ProviderName[] = ["codex", "opencode", "claude"];
const PROVIDER_PROFILE: Record<ProviderName, string> = { codex: "codex_build", opencode: "opencode_build", claude: "claude_build" };
const PROVIDER_ADAPTER: Record<ProviderName, string> = { codex: "codex-cli", opencode: "opencode-cli", claude: "claude-code-cli" };

/** Parse `codex,opencode,claude` (any non-empty subset, no duplicates) or throw a usage error naming the problem. */
export function parseProviderList(text: string): ProviderName[] {
  const names = text.split(",").map((name) => name.trim()).filter((name) => name.length > 0);
  if (names.length === 0) throw new Error("--providers needs at least one of codex, opencode, claude");
  const unknown = names.filter((name) => !(PROVIDER_ORDER as string[]).includes(name));
  if (unknown.length > 0) throw new Error(`unknown provider ${unknown.join(", ")}; choose from ${PROVIDER_ORDER.join(", ")}`);
  if (new Set(names).size !== names.length) throw new Error("--providers lists a provider twice");
  return names as ProviderName[];
}

export interface CriterionResult {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

/** One failed criterion with the first relevant error lines of that provider's log, so a failure is diagnosable from the receipt alone. */
export interface FailureDetail {
  criterion: string;
  label: string;
  detail: string;
  logLines: string[];
}

export interface ProviderResult {
  provider: ProviderName;
  /** SKIPPED: a precondition (binary, sign-in, posture flags) was missing, so this provider was not run; `reason` says which. */
  outcome: "PASS" | "FAIL" | "SKIPPED";
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
  /** Every failed criterion (or the setup failure) with the first relevant error lines from this provider's log. */
  failureDetails: FailureDetail[];
  /** How the model was chosen: the registry's start tier, or an operator override. */
  modelSource: "start-tier" | "override" | null;
  /** Claude only: the allow rules written to the per-session settings file the launch passes with --settings. */
  permissionAllowList: string[] | null;
  /** Information only; never a criterion. */
  gitdir: GitdirReport | null;
  sessionReconcile: { exitCode: number | null; summary: string } | null;
  askFile: string | null;
  workspaceKept: string | null;
  /** What the agent itself delivered, separate from what the host's preservation step added. */
  agentPart: { pass: boolean } | null;
  hostPart: HostPart | null;
  /**
   * "agent": the agent committed everything itself. "agent_and_host": the host step's commit is there. "agent_host_failed": the host
   * step ran and refused, and the agent's own part is complete. "agent_only": the host step could not run in an experiment workspace.
   */
  passKind: "agent" | "agent_and_host" | "agent_host_failed" | "agent_only" | null;
}

export interface HostPart {
  /** The candidate was left uncommitted, so the host's turn matters. */
  needed: boolean;
  attempted: boolean;
  /** "host_failed": attempted and refused (or errored) without leaving a commit. "not_exercised": the step could not run here at all. */
  outcome: "not_needed" | "preserved" | "host_failed" | "not_exercised";
  detail: string;
  commit: string | null;
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
  /** The providers to try, in order (default: all three). Each runs independently on its own fresh fixture. */
  providers?: ProviderName[];
  /** Per-provider model overrides (default: each provider's start-tier model). */
  models?: Partial<Record<ProviderName, string>>;
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
  /** Test seam: the host's preservation step (default: the worker's own runPreserveCommand). */
  hostPreserve?: HostPreserve;
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

/** The CLI writes success JSON to stdout and failure JSON (`--json`) to stderr (src/cli/response.ts), so read stdout first, then stderr. */
export function parseCliJson(stdout: string, stderr: string): any {
  for (const text of [stdout, stderr]) {
    try { return JSON.parse(text); } catch { /* not JSON output */ }
  }
  return null;
}

/** The changed leak-check fields in a `workspace leak-check --baseline --json` result, or null when they cannot be read. */
export function leakCheckChangedFields(json: any): string[] | null {
  const changes = json?.error?.details?.changes;
  return Array.isArray(changes) ? changes.map((change: { field?: unknown }) => String(change?.field ?? "?")) : null;
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
  const json = parseCliJson(run.stdout ?? "", run.stderr ?? "");
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

const PROVIDER_BINARY: Record<ProviderName, string> = { codex: "codex", opencode: "opencode", claude: "claude" };

export interface ProviderPrecondition { ok: boolean; message: string; binary: string | null; warning?: string }

/** The environment a provider (and Arcadia's own launch preflight on its behalf) runs in. */
function providerEnvironment(context: Pick<Context, "searchPath" | "env">): NodeJS.ProcessEnv {
  return { ...sanitizedEnv(context.env), PATH: context.searchPath };
}

/**
 * Whether one provider can be tried at all: its binary is on PATH, it is signed in, and the installed CLI carries the flags its
 * headless posture needs (the same launch preflight `go --launch` runs). A failure here marks only this provider SKIPPED.
 */
export function checkProviderPrecondition(context: Pick<Context, "searchPath" | "env">, provider: ProviderName): ProviderPrecondition {
  const name = PROVIDER_BINARY[provider];
  const binary = findExecutable(name, context.searchPath);
  if (!binary) return { ok: false, binary: null, message: `${name} was not found on PATH (searched ${context.searchPath}); install it and sign in as the operator, then rerun` };
  const env = providerEnvironment(context);
  const args = provider === "codex" ? ["login", "status"] : provider === "claude" ? ["auth", "status", "--json"] : ["auth", "list"];
  const probe = spawnSync(binary, args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], env });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`.replace(ANSI, "").trim();
  const command = `${name} ${args.join(" ")}`;
  const failure = probe.error ? probe.error.message : probe.status !== 0 ? `exit ${probe.status}` : null;
  let result: ProviderPrecondition;
  if (provider === "codex") {
    result = failure
      ? { ok: false, binary, message: `${command} failed (${failure}): ${output.slice(0, 200) || "no output"}; sign in as the operator (codex login) and rerun` }
      : { ok: true, binary, message: `${command} succeeded` };
  } else if (provider === "claude") {
    // `claude auth status --json` reports loggedIn (it reads CLAUDE_CODE_OAUTH_TOKEN, the credentials file and the keychain); a
    // token in the environment is itself a credential. The workspace token file is not read here: it belongs to the live workspace.
    let loggedIn: boolean | null = null;
    try { const parsed = JSON.parse(probe.stdout ?? ""); if (typeof parsed.loggedIn === "boolean") loggedIn = parsed.loggedIn; } catch { /* unparsable */ }
    if (loggedIn === true) result = { ok: true, binary, message: `${command} reports loggedIn` };
    else if (context.env.CLAUDE_CODE_OAUTH_TOKEN) result = { ok: true, binary, message: `${command} did not confirm a login, but CLAUDE_CODE_OAUTH_TOKEN is set in the environment` };
    else result = { ok: false, binary, message: loggedIn === false
      ? `${command} reports not logged in; sign in as the operator (claude auth login, or claude setup-token with CLAUDE_CODE_OAUTH_TOKEN set) and rerun`
      : `${command} could not confirm a sign-in (${failure ?? "unparsable output"}: ${output.slice(0, 160) || "no output"}); sign in as the operator (claude auth login) and rerun` };
  } else if (!failure && /\b0 credentials\b/i.test(output)) {
    // OpenCode's credential listing is not a documented contract. Refuse only on its one clear signal, "0 credentials";
    // anything else uncertain (an unknown subcommand, a changed format) warns and lets the attempt itself decide.
    result = { ok: false, binary, message: `${command} lists no credentials; sign in with opencode auth login and rerun` };
  } else if (failure) {
    const warning = `${command} could not confirm a sign-in (${failure}: ${output.slice(0, 120) || "no output"}); proceeding, the attempt itself will show whether OpenCode is signed in`;
    result = { ok: true, binary, message: warning, warning };
  } else {
    result = { ok: true, binary, message: `${command} succeeded` };
  }
  if (!result.ok) return result;
  // Posture flags: the installed CLI must know the headless flags the launch passes (Arcadia's own launch preflight, run against this environment).
  try {
    checkLaunchPrerequisites({ provider: PROVIDER_ADAPTER[provider], headless: true, env });
  } catch (error) {
    return { ok: false, binary, message: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
  }
  return result;
}

// ---------------------------------------------------------------------------
// One provider attempt
// ---------------------------------------------------------------------------

function newResult(provider: ProviderName): ProviderResult {
  return {
    provider, outcome: "FAIL", reason: null, model: null, effort: null, command: null, exitCode: null, signal: null, timedOut: false,
    durationMs: null, logPath: null, candidateBranch: null, candidateWorktree: null, criteria: [], failureDetails: [], modelSource: null,
    permissionAllowList: null, gitdir: null, sessionReconcile: null,
    askFile: null, workspaceKept: null, agentPart: null, hostPart: null, passKind: null
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

/**
 * An operator's `--model-<provider>` override, written to the experiment workspace's own `config/coding-agent-models.json` (the
 * documented per-workspace override) so the Session starts on that model through the normal start-tier resolution. A model the
 * registry already binds in a tier is chosen by starting on that tier (a model bound in two tiers makes the agent's identity
 * ambiguous, which the launch refuses); any other model replaces the light-tier binding. Each provider has its own workspace, so
 * the start tier is this one agent's. The live workspace's config is never read or written.
 */
function setStartModelOverride(workspace: string, provider: ProviderName, model: string): void {
  const file = modelTierOverridePath(workspace);
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = (() => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } })();
  const registry = loadModelTierRegistry(workspace);
  const tier = (["light", "standard", "heavy"] as const).find((candidate) => registry.tiers[candidate][provider]?.model === model);
  if (tier) {
    writeFileSync(file, JSON.stringify({ ...existing, sessionStartTier: tier }, null, 2) + "\n");
    return;
  }
  const light = { ...(existing.tiers?.light ?? {}), [provider]: { model, effort: "e1_brief" } };
  writeFileSync(file, JSON.stringify({ ...existing, tiers: { ...(existing.tiers ?? {}), light } }, null, 2) + "\n");
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

/**
 * OpenCode's non-interactive `run` auto-rejects every permission that would need a prompt, and the first tool call in this test's
 * candidate worktree was refused as `external_directory` (run 20261009T135444Z-90379): the worktree lives under the macOS temporary
 * directory (/private/var/folders/...), which the operator's own allowlist (which covers /tmp, ~/tmp and ~/.opencode, where real
 * Sessions' worktrees live) does not name. This grants the one directory tree the test created, for this one process, through
 * OpenCode's documented OPENCODE_CONFIG_CONTENT (a final local-scope merge); ~/.config/opencode is never read or written.
 * Both spellings of the path are granted because /var is a symlink to /private/var.
 */
export function opencodeSessionConfig(root: string, worktree: string): string {
  const spellings = (p: string): string[] => [p, p.replace(/^\/private(\/var\/)/, "$1"), p.startsWith("/var/") ? `/private${p}` : p];
  const external: Record<string, "allow"> = {};
  for (const directory of [root, worktree]) for (const spelling of spellings(directory)) external[`${spelling}/**`] = "allow";
  return JSON.stringify({ permission: { external_directory: external } });
}

/** `--config projects."<path>".trust_level="trusted"` for each path, placed before the final argument (the brief). */
export function codexTrustOverrideArgs(paths: string[]): string[] {
  return [...new Set(paths)].flatMap((p) => ["--config", `projects.${JSON.stringify(p)}.trust_level="trusted"`]);
}

export function withCodexTrustOverrides(args: string[], paths: string[]): string[] {
  return [...args.slice(0, -1), ...codexTrustOverrideArgs(paths), ...args.slice(-1)];
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
      "Placement alone does not make a commit possible: on a real run (20261009T135444Z-90379) Codex's workspace-write sandbox denied creating Git's worktree index.lock although this gitdir sits inside $TMPDIR, because it keeps .git directories read-only even inside writable roots. " +
      "So an agent in that sandbox cannot commit, and the commit is the host's preservation step."
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

const EXPECTED_MARKER = FIXTURE_MARKER_LINE + "\n";

/** What the agent itself delivered, judged before the host takes its turn. */
interface AgentPart {
  criteria: CriterionResult[];
  /** The agent left a complete-intent Ask under .arcadia/asks/ and left it unsettled (the host settles it). */
  draftedAsk: boolean;
  askPass: boolean;
  markerExact: boolean;
  /** Worktree-relative path of the one drafted Ask this part accepted; the only untracked file the commit criterion tolerates. */
  acceptedDraftPath: string | null;
}

function evaluateAgentPart(context: Context, result: ProviderResult, input: {
  workspace: string; worktree: string;
  run: { exitCode: number | null; signal: string | null; timedOut: boolean; durationMs: number }; timeoutMs: number;
}): AgentPart {
  const { worktree } = input;
  const criteria: CriterionResult[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => criteria.push({ id, label, pass, detail });
  // Claude's stream-json ends with a result event that can say is_error even when the process exits 0.
  const claudeStream = result.provider === "claude" ? parseClaudeStream(readLog(result.logPath)) : null;
  const claudeErrored = claudeStream?.result != null && (claudeStream.result.isError || (claudeStream.result.subtype !== null && claudeStream.result.subtype !== "success"));
  add("exit", `provider exited 0 within the ${formatCap(input.timeoutMs)} cap`,
    input.run.exitCode === 0 && !input.run.timedOut && !claudeErrored,
    (input.run.timedOut ? `timed out after ${Math.round(input.run.durationMs / 1000)}s` : `exit ${input.run.exitCode ?? "none"}${input.run.signal ? ` (${input.run.signal})` : ""} after ${Math.round(input.run.durationMs / 1000)}s`)
      + (claudeStream ? `; ${describeClaudeResult(claudeStream)}` : ""));

  let marker: string | null = null;
  try { marker = readFileSync(path.join(worktree, "MARKER.md"), "utf8"); } catch { /* absent */ }
  add("file", "MARKER.md exists with exactly the expected line", marker === EXPECTED_MARKER, marker === null ? "MARKER.md is absent" : marker === EXPECTED_MARKER ? "content matches" : `unexpected content ${JSON.stringify(marker.slice(0, 80))}`);

  const validation = spawnSync(process.execPath, ["scripts/check-fixture.mjs"], { cwd: worktree, encoding: "utf8", timeout: 30_000 });
  add("validation", `${FIXTURE_VALIDATION} passes`, validation.status === 0 && marker === EXPECTED_MARKER,
    validation.status === 0 ? (marker === EXPECTED_MARKER ? "fixture check ok" : "check passes only because MARKER.md is absent or wrong") : (validation.stderr || validation.stdout || "check failed").trim().slice(0, 200));

  const wanted = planCriteria(worktree);
  const criterionComplete = (ask: Record<string, unknown>): boolean => {
    const evidence: Array<{ criterion?: string; status?: string }> = Array.isArray(ask.evidence) ? ask.evidence : [];
    return evidence.length === wanted.length && wanted.every((criterion, index) => evidence[index]?.criterion === criterion && evidence[index]?.status === "met");
  };
  const head = rawGit(worktree, ["rev-parse", "HEAD"])?.trim() ?? null;
  const dirtyAll = rawGit(worktree, ["status", "--porcelain"]);
  const actionStatus = withDatabase(input.workspace, (db) => getWorkItemByDocRef(db, `plan/${FIXTURE_PLAN}#${FIXTURE_ACTION}`)?.status ?? null);
  let askDetail = "no Agent Ask file under .arcadia/asks/";
  let askPass = false;
  let draftedAsk = false;
  let acceptedDraftPath: string | null = null;
  for (const file of findDraftedAsks(worktree)) {
    const relative = path.relative(worktree, file);
    const ask = readAsk(file);
    if (!ask || ask.intent !== "complete") { askDetail = `${relative} is not a complete-intent Ask`; continue; }
    result.askFile = file;
    const complete = criterionComplete(ask);
    const revision = typeof ask.candidate_revision === "string" ? ask.candidate_revision : null;
    const settled = relative.split(path.sep).includes("archive");
    if (!settled) {
      draftedAsk = true;
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
      askPass = complete && ancestor && atRevision === EXPECTED_MARKER && done && clean;
      askDetail = `settled ${relative}: ${complete ? "every criterion met, verbatim and in order" : `evidence does not match the ${wanted.length} declared criteria`}; ` +
        `candidate_revision ${ancestor ? "is an ancestor of HEAD" : "is not an ancestor of HEAD"} and ${atRevision === EXPECTED_MARKER ? "holds the exact MARKER.md" : "does not hold the exact MARKER.md"}; ` +
        `Action status in the experiment database: ${actionStatus ?? "unknown"}; tree ${clean ? "clean" : "not clean"}`;
    }
    if (askPass) { acceptedDraftPath = settled ? null : relative; break; }
  }
  add("ask", "a criterion-complete completion Agent Ask was drafted (preview accepts it) or settled (Action complete)", askPass, askDetail);
  return { criteria, draftedAsk, askPass, markerExact: marker === EXPECTED_MARKER, acceptedDraftPath };
}

export function commitState(worktree: string, baseRevision: string, expectedBranch: string, acceptedDraftPath: string | null) {
  // The one drafted completion Ask this run accepted legitimately sits untracked until the host settles it; nothing else may be dirty.
  const dirty = rawGit(worktree, ["status", "--porcelain", "--untracked-files=all", "--", ".", ...(acceptedDraftPath ? [`:(exclude,literal)${acceptedDraftPath}`] : [])]);
  const commits = rawGit(worktree, ["rev-list", "--count", `${baseRevision}..HEAD`]);
  const committedMarker = rawGit(worktree, ["show", "HEAD:MARKER.md"]);
  const branch = rawGit(worktree, ["branch", "--show-current"])?.trim() ?? null;
  const commitCount = commits === null ? 0 : Number(commits.trim());
  const onBranch = branch === expectedBranch;
  const clean = dirty !== null && dirty.trim() === "";
  const pass = commitCount >= 1 && committedMarker === EXPECTED_MARKER && onBranch && clean;
  const detail = commits === null ? "git could not read the candidate branch"
    : `${commitCount} commit(s) beyond the base on ${branch ?? "no branch"}${onBranch ? "" : ` (expected ${expectedBranch})`}; HEAD ${committedMarker === null ? "has no MARKER.md" : committedMarker === EXPECTED_MARKER ? "carries the exact MARKER.md" : "carries a different MARKER.md"}; ` +
      `${dirty === null ? "status unreadable" : clean ? "tree clean" : `uncommitted changes: ${dirty.trim().split("\n").slice(0, 3).join("; ")}`}`;
  return { pass, detail, commitCount, uncommittedOnly: commitCount === 0 && dirty !== null && dirty.trim() === "?? MARKER.md" };
}

/** The exact refusal the worker-less broker prints (src/sessions/preservationTransport.ts); case-sensitive on purpose. */
export const BROKER_REFUSAL_TEXT = "Protected preservation request path is unavailable";

/**
 * The agent's own attempt at host preservation (the brief's step 2) was refused because no worker exists in an experiment workspace.
 * Evidence must be command output, not wording the brief or the agent supplied: a Codex `--json` command_execution event for the
 * broker whose output carries the exact refusal, or (OpenCode's plain log) the broker's name and the exact refusal on one line.
 */
export function brokerRefusalInLog(log: string): boolean {
  for (const line of log.split("\n")) {
    if (!line.includes(BROKER_REFUSAL_TEXT)) continue;
    let event: { type?: string; item?: { type?: string; command?: string; aggregated_output?: string; output?: string } } | null = null;
    try { event = JSON.parse(line); } catch { /* a plain-text log line */ }
    if (event) {
      const item = event.item;
      const output = item?.aggregated_output ?? item?.output ?? "";
      if (item?.type === "command_execution" && (item.command ?? "").includes("arcadia-preserve-broker") && output.includes(BROKER_REFUSAL_TEXT)) return true;
    } else if (line.includes("arcadia-preserve-broker")) {
      return true;
    }
  }
  return false;
}

function readLog(logPath: string | null): string {
  if (!logPath) return "";
  try { return readFileSync(logPath, "utf8"); } catch { return ""; }
}

/**
 * Why the agent itself could not commit, as evidence from its own log, or null: the broker's exact refusal (Codex, OpenCode), or for
 * Claude a permission denial of `git commit`/`git add`/the broker (its headless allow list carries only the validation commands and
 * `agent-ask draft`, so the agent drafts the Ask and the host preserves).
 */
export function preservationBlockedEvidence(provider: ProviderName, log: string): string | null {
  if (brokerRefusalInLog(log)) return "the agent's own broker call was refused because an experiment workspace has no worker";
  if (provider === "claude") {
    const denied = claudePreservationDenied(log);
    if (denied) return `the agent's own commit/broker call was refused by the headless permission posture (\`${denied}\`), which allows only the validation commands and the Ask draft`;
  }
  return null;
}

/**
 * The host's turn: the same preservation the worker runs for a Session that exited with an uncommitted candidate.
 * `ran` is false when the step could not run in this environment at all (no Seatbelt host, validation skipped, no production
 * authority), true when it ran and refused or errored.
 */
export type HostPreserve = (input: { workspace: string; worktree: string }) => { ok: boolean; ran: boolean; detail: string; commit: string | null };

/** Errors that mean "this environment cannot run the step", as opposed to "the step ran and said no". */
function hostStepCouldNotRun(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (/requires current scoped production validation authority|requires the macOS Seatbelt host/.test(message)) return true;
  const checks = (error as { details?: { checks?: Array<{ status?: string }> } })?.details?.checks;
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => check.status === "skipped");
}

export const defaultHostPreserve: HostPreserve = ({ workspace, worktree }) => {
  try {
    const response = runPreserveCommand({ source: worktree, workspace });
    const receipt = response.data.receipt;
    return { ok: true, ran: true, commit: receipt.commitSha, detail: `runPreserveCommand preserved commit ${receipt.commitSha.slice(0, 12)} (${receipt.preservationState}${receipt.retryAction ? `; ${receipt.retryAction}` : ""})` };
  } catch (error) {
    return { ok: false, ran: !hostStepCouldNotRun(error), commit: null, detail: (error instanceof Error ? error.message : String(error)).slice(0, 400) };
  }
};

/**
 * The commit criterion and the host's turn. Runs after the Session was reconciled (which releases its repository lease), so the
 * host step takes the preservation path for a finished, unleased candidate: `arcadia preserve`'s manual-handoff binding, which
 * authorizes local preservation only. The worker's leased path needs an Active production policy scoped to the Action, which an
 * experiment workspace can never hold (activation is guarded), so that path refuses here and the fallback below applies.
 */
function finishEvaluation(context: Context, result: ProviderResult, agent: AgentPart, before: ReturnType<typeof commitState>, input: {
  workspace: string; worktree: string; baseRevision: string; branch: string;
}): void {
  const host: HostPart = { needed: false, attempted: false, outcome: "not_needed", detail: "the agent committed its own work", commit: null };
  let commit = before;
  if (!before.pass && before.commitCount === 0) {
    // The agent could not commit (Codex's workspace-write sandbox denies Git's index.lock, and the brief routes preservation through
    // the host). If it did everything else, play the host's role with the same code the worker runs, then judge the commit.
    host.needed = true;
    if (agent.markerExact && agent.draftedAsk && before.uncommittedOnly) {
      host.attempted = true;
      let done: ReturnType<HostPreserve>;
      try {
        done = (context.options.hostPreserve ?? defaultHostPreserve)({ workspace: input.workspace, worktree: input.worktree });
      } catch (error) {
        done = { ok: false, ran: true, commit: null, detail: `the host step threw: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` };
      }
      host.detail = done.detail;
      commit = commitState(input.worktree, input.baseRevision, input.branch, agent.acceptedDraftPath);
      // What counts is what is on the branch afterwards: a step that committed and then threw still preserved the candidate.
      host.commit = commit.pass ? (done.commit ?? rawGit(input.worktree, ["rev-parse", "HEAD"])?.trim() ?? null) : null;
      host.outcome = commit.pass ? "preserved" : done.ran ? "host_failed" : "not_exercised";
      if (commit.pass && !done.ok) host.detail = `the candidate was committed but the step then reported: ${done.detail}`;
      context.log(`host preservation (${result.provider}): ${host.outcome}: ${host.detail}`);
    } else {
      host.outcome = "not_exercised";
      host.detail = "the candidate was not in the shape host preservation needs (exact MARKER.md untracked, drafted Ask left)";
    }
  }
  let label = "a clean commit with MARKER.md exists on the candidate branch";
  let pass = commit.pass;
  let detail = commit.detail;
  if (host.outcome === "preserved") {
    detail = `committed by host preservation, not by the agent: ${commit.detail}; ${host.detail}`;
  } else if (!commit.pass && host.needed && agent.askPass && agent.draftedAsk && agent.markerExact && commit.uncommittedOnly
    && preservationBlockedEvidence(result.provider, readLog(result.logPath))) {
    // Host preservation could not complete in an experiment workspace, but the agent did its whole part: an uncommitted exact candidate,
    // a criterion-complete drafted Ask and the evidence of why it could not commit itself (the broker refusal the missing worker explains,
    // or Claude's headless allow list refusing the commit and the broker). Say which way the host step went.
    pass = true;
    const refused = host.outcome === "host_failed";
    label = `a commit exists on the candidate branch (agent part; host preservation ${refused ? "attempted and refused" : "not exercised"})`;
    detail = `PASS (agent); host preservation ${refused ? "attempted and refused" : "not exercised"}: ${host.detail}; ${preservationBlockedEvidence(result.provider, readLog(result.logPath))}; ${commit.detail}`;
  }
  const criteria = [...agent.criteria];
  criteria.splice(3, 0, { id: "commit", label, pass, detail });
  result.criteria = criteria;
  const agentIds = new Set(["exit", "file", "validation", "ask"]);
  result.agentPart = { pass: criteria.filter((entry) => agentIds.has(entry.id)).every((entry) => entry.pass) && (host.outcome === "not_needed" ? commit.pass : true) };
  result.hostPart = host;
  result.passKind = !criteria.every((entry) => entry.pass) ? null
    : host.outcome === "not_needed" ? "agent"
    : host.outcome === "preserved" ? "agent_and_host"
    : host.outcome === "host_failed" ? "agent_host_failed"
    : "agent_only";
}

/**
 * The Claude launch must carry the exact headless posture `buildSessionLaunch` writes: a per-session `--settings` file and an empty
 * `--setting-sources`, with an allow list that covers the fixture's validation command (the Project's declared validation command,
 * registered in the fixture) and `arcadia agent-ask draft`. Returns the allow list, or refuses naming what is missing.
 */
function verifyClaudePosture(context: Context, args: string[]): string[] {
  const flagValue = (flag: string): string | undefined => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const settingsFile = flagValue("--settings");
  if (!settingsFile || flagValue("--setting-sources") !== "") {
    throw new Refusal("prepare", "the Claude launch does not carry --settings <per-session file> with --setting-sources \"\"; refusing to run Claude with the operator's ambient settings");
  }
  let allow: string[];
  try {
    allow = JSON.parse(readFileSync(settingsFile, "utf8"))?.permissions?.allow ?? [];
  } catch (error) {
    throw new Refusal("prepare", `the per-session Claude settings file ${settingsFile} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const required = [`Bash(${FIXTURE_VALIDATION})`, "Bash(arcadia agent-ask draft:*)"];
  const missing = required.filter((rule) => !allow.includes(rule));
  if (missing.length > 0) {
    throw new Refusal("prepare", `the per-session Claude settings allow list (${settingsFile}) lacks ${missing.join(" and ")}; the headless agent could not run the fixture check or draft its completion Ask`);
  }
  context.log(`claude (claude): per-session settings ${settingsFile} allow ${allow.join(", ")}; --setting-sources "" (no user or project settings)`);
  return allow;
}

/** Fill `failureDetails`: each failed criterion (or the setup failure) with the first relevant error lines from this provider's log. */
function attachFailureDetails(result: ProviderResult): void {
  if (result.outcome !== "FAIL") return;
  const log = readLog(result.logPath);
  const lines = extractDiagnosis(log);
  const logLines = lines.length > 0 ? lines : [log.trim() === "" ? "(the provider log is empty: the provider never produced output)" : `(no error-like lines found; read ${result.logPath} from the top)`];
  const failed = result.criteria.filter((criterion) => !criterion.pass);
  result.failureDetails = failed.length > 0
    ? failed.map((criterion) => ({ criterion: criterion.id, label: criterion.label, detail: criterion.detail, logLines }))
    : [{ criterion: "setup", label: "the attempt did not reach a judged result", detail: result.reason ?? "unknown", logLines }];
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

  try {
    mustArcadia(context, null, ["init", "--profile", "experiment", workspace, "--json"], "experiment workspace init");
    setBuildProfile(workspace, PROVIDER_PROFILE[provider]);
    const override = context.options.models?.[provider]?.trim() || null;
    if (override) setStartModelOverride(workspace, provider, override);
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
    const packetModel = withDatabase(workspace, (db) => {
      const item = getWorkItemByDocRef(db, `plan/${FIXTURE_PLAN}#${FIXTURE_ACTION}`);
      const invocation = item ? listCodexInvocationsForWorkItem(db, item.id).filter((c) => c.purpose === "build" && c.status === "packet_created").at(-1) : null;
      if (!invocation) return null;
      const metadata = JSON.parse(readFileSync(path.join(path.dirname(path.join(workspace, invocation.prompt_path)), "metadata.json"), "utf8"));
      return (metadata.providerSelection?.model as string | undefined) ?? null;
    });
    if (!packetModel) throw new Refusal("setup", "the seeded build packet names no provider model");
    // No --model: the Session starts on the registry's start-tier model for this agent (light by default), exactly as a production
    // launch does, with the packet's model as its escalation target. An operator override replaces the start-tier binding in the
    // experiment workspace's own coding-agent-models config.
    const startModel = sessionStartBinding(provider, loadModelTierRegistry(workspace))?.model ?? packetModel;
    result.modelSource = override ? "override" : "start-tier";
    context.log(`prepare (${provider}): build packet ${packet.invocationId} seeded (plan model ${packetModel}); Session starts on ${startModel} (${override ? "operator override" : "start tier"})`);

    // `go --apply` needs a fresh worker heartbeat; the experiment guard forbids starting a worker.
    writeHeartbeat(workspace, Date.now());
    const recording = new RecordingTmux();
    const go = runGoCommand({
      repo: fixture, apply: true, agent: provider, launch: true, workspace,
      agentWorktreeRoot: path.join(workspace, "projects", "worktrees"), tmux: recording,
      // The launch preflight (binary, sign-in, headless flags) runs against the provider's own environment, not this process's.
      preflightEnv: providerEnvironment(context)
    });
    const session: AgentSession | null = go.data.session;
    if (!session) throw new Refusal("prepare", "go --apply prepared no Session for the fixture Action");
    const worktree = realOrSelf(session.worktree_path);
    result.candidateBranch = session.branch;
    result.candidateWorktree = worktree;
    result.effort = session.effort;
    result.model = session.model;
    if (session.model !== startModel) throw new Refusal("prepare", `the Session was prepared on ${session.model}, not the expected start model ${startModel}`);
    context.log(`model (${provider}): ${session.model}, effort ${session.effort ?? "default"} (${override ? "operator override" : "start tier"})`);
    context.log(`prepare (${provider}): candidate ${session.branch} at ${worktree} (go --apply --agent ${provider} --launch; process boundary recorded, nothing started yet)`);

    // `go --launch` is headless by default: the recorded launch is the shipped builder's unattended argv
    // (codex exec ... --sandbox workspace-write, opencode run ...), exactly what a standing-policy launch runs.
    const launched = recording.launches.at(-1);
    if (!launched) throw new Refusal("prepare", "go --launch recorded no launch for the Session");
    result.command = [launched.command, ...(provider === "codex" ? withCodexTrustOverrides(launched.args, [fixture, worktree]) : launched.args).map((arg) => (arg.length > 120 && (arg.includes("\n") || arg.length > 400) ? `${arg.slice(0, 40).replaceAll("\n", " ")}...[${arg.length} chars]` : arg))].join(" ");
    context.log(`launch (${provider}): ${result.command}`);
    if (provider === "claude") result.permissionAllowList = verifyClaudePosture(context, launched.args);
    // Run the argv directly rather than through tmux's recording wrapper: this test waits on the provider process itself, and a
    // descendant that keeps the wrapper's pipe open must not look like a hang. The wrapper's one durable effect, the provider's
    // exit code in agent_sessions.exit_status, is recorded below with the shipped script, so reconcile sees what it sees in production.
    // Codex persists `[projects."<repo>"] trust_level = "trusted"` to ~/.codex/config.toml for a new project directory (seen on
    // operator run 20261009T135444Z-90379 as a changed hashes.codexConfig). Declaring the trust per invocation for exactly this
    // fixture's paths is the way to try to stop the experiment touching host config; it is unverified whether Codex then skips the write.
    const runnable = provider === "codex"
      ? { command: launched.command, args: withCodexTrustOverrides(launched.args, [fixture, worktree]) }
      : { command: launched.command, args: launched.args };
    if (provider === "codex") context.log(`codex (${provider}): per-invocation --config trust override for ${[fixture, worktree].join(" and ")}`);

    result.gitdir = computeGitdirReport(context, worktree);
    context.log(`gitdir (${provider}): worktree gitdir ${result.gitdir.worktreeGitDir} inside writable roots: ${result.gitdir.worktreeGitDirInsideWritableRoots}; common gitdir ${result.gitdir.commonGitDir} inside: ${result.gitdir.commonGitDirInsideWritableRoots}`);

    const shimDirectory = path.join(attemptRoot, "bin");
    writeArcadiaShim(shimDirectory, workspace, context);
    const env: NodeJS.ProcessEnv = {
      ...sanitizedEnv(context.env), PATH: buildPath(context.env.PATH, [shimDirectory], context.options.toolDirectories),
      // Both the provider and anything it runs resolve this experiment workspace, never the live default.
      ARCADIA_WORKSPACE: workspace,
      // spawn's cwd option does not update PWD, and tools read PWD to learn where they are; under tmux the shell sets it.
      PWD: worktree,
      ...(provider === "opencode" ? { OPENCODE_CONFIG_CONTENT: opencodeSessionConfig(attemptRoot, worktree) } : {})
    };
    if (provider === "opencode") context.log(`opencode (${provider}): per-session permission grant for ${attemptRoot} via OPENCODE_CONFIG_CONTENT (the operator's own config is untouched)`);
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

    // The agent's part is judged where the agent left it: before the host reconciles or preserves anything.
    const agent = evaluateAgentPart(context, result, { workspace, worktree, run, timeoutMs });
    const candidateAtExit = commitState(worktree, session.base_revision, session.branch, agent.acceptedDraftPath);

    // The host's reconcile of the finished Session (its outcome is information only; it also releases the repository lease).
    const reconcile = arcadia(context, workspace, ["session", "reconcile", session.id, "--repo", fixture, "--request-id", `${context.options.runId}-${provider}`, "--json"]);
    const reconcileFile = path.join(context.options.runDirectory, `session-reconcile-${provider}.json`);
    writeFileSync(reconcileFile, reconcile.stdout || reconcile.stderr);
    result.sessionReconcile = { exitCode: reconcile.status, summary: summarizeReconcile(reconcile, reconcileFile) };
    const stillThere = withDatabase(workspace, (db) => getSession(db, session.id));
    context.log(`session reconcile (${provider}, information only): exit ${reconcile.status}; session row ${stillThere?.status ?? "missing"}`);
    finishEvaluation(context, result, agent, candidateAtExit, { workspace, worktree, baseRevision: session.base_revision, branch: session.branch });
    result.outcome = result.criteria.every((criterion) => criterion.pass) ? "PASS" : "FAIL";
  } catch (error) {
    result.outcome = "FAIL";
    result.reason = error instanceof Error ? error.message : String(error);
    if (error instanceof Refusal) result.reason = `${error.stage}: ${error.message}`;
    context.log(`error (${provider}): ${result.reason}`);
  }
  attachFailureDetails(result);
  return result;
}

// ---------------------------------------------------------------------------
// Orchestration, table and receipt
// ---------------------------------------------------------------------------

/** How many of a failed criterion's log lines the printed table shows (the receipt keeps them all). */
const TABLE_DIAGNOSIS_LINES = 3;

export function formatTable(results: ProviderResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    if (result.outcome === "SKIPPED") {
      lines.push(`${result.provider}: SKIPPED - ${result.reason ?? "a precondition was missing"}`);
      continue;
    }
    const kind = result.outcome !== "PASS" ? ""
      : result.passKind === "agent_only" ? " (agent); host preservation not exercised"
      : result.passKind === "agent_host_failed" ? " (agent); host preservation attempted and refused"
      : result.passKind === "agent_and_host" ? " (agent + host preservation)" : "";
    const model = result.model ? ` (${result.model}${result.modelSource === "override" ? ", operator override" : ""})` : "";
    lines.push(`${result.provider}${model}: ${result.outcome}${kind}${result.reason ? ` - ${result.reason}` : ""}`);
    if (result.agentPart && result.hostPart) {
      lines.push(`  agent part: ${result.agentPart.pass ? "PASS" : "FAIL"}   host part: ${result.hostPart.outcome === "not_needed" ? "not needed (the agent committed)" : result.hostPart.outcome === "preserved" ? `preserved ${result.hostPart.commit?.slice(0, 12) ?? ""} (${result.hostPart.detail})` : `${result.hostPart.outcome.replace("_", " ")}: ${result.hostPart.detail}`}`);
    }
    // The provider's log lines are the same for every failed criterion, so the table shows them once, under the first failed one
    // (the receipt's failureDetails carries them for each).
    let shownLogLines = false;
    for (const criterion of result.criteria) {
      lines.push(`  ${criterion.pass ? "PASS" : "FAIL"}  ${criterion.label}  [${criterion.detail}]`);
      if (!criterion.pass && !shownLogLines) {
        shownLogLines = true;
        const detail = result.failureDetails.find((entry) => entry.criterion === criterion.id);
        for (const logLine of (detail?.logLines ?? []).slice(0, TABLE_DIAGNOSIS_LINES)) lines.push(`        log> ${logLine}`);
      }
    }
    if (result.criteria.length === 0) {
      for (const detail of result.failureDetails) for (const logLine of detail.logLines.slice(0, TABLE_DIAGNOSIS_LINES)) lines.push(`        log> ${logLine}`);
    }
    if (result.gitdir) {
      lines.push(`  info  worktree gitdir inside sandbox-writable roots: ${result.gitdir.worktreeGitDirInsideWritableRoots} (${result.gitdir.worktreeGitDir}); common gitdir inside: ${result.gitdir.commonGitDirInsideWritableRoots}`);
    }
    if (result.permissionAllowList) lines.push(`  info  claude allow list: ${result.permissionAllowList.join(", ")}`);
    if (result.sessionReconcile) lines.push(`  info  session reconcile exit ${result.sessionReconcile.exitCode}: ${result.sessionReconcile.summary}`);
    if (result.logPath) lines.push(`  info  provider log ${result.logPath}`);
  }
  return lines.join("\n");
}

/** One line per provider: outcome and the model it ran on. */
export function formatOverview(results: ProviderResult[]): string {
  return results.map((result) => `${result.provider}: ${result.outcome}${result.outcome === "PASS" && result.passKind && result.passKind !== "agent" ? ` (${result.passKind})` : ""}, model ${result.model ?? "none (not run)"}`).join("; ");
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
    models: Object.fromEntries(outcome.providers.map((result) => [result.provider, result.model])),
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
    "Give this handoff, the run log and the provider logs listed above to a coding agent and ask it to diagnose the first failing criterion of each provider " +
      "(the `log>` lines and the receipt's failureDetails carry the first relevant error lines from that provider's log). " +
      "A provider that exits non-zero, writes nothing or never drafts the completion Ask is a finding about that provider's unattended launch, not a reason to rerun blindly. " +
      "A SKIPPED provider names the missing precondition. Rerun with --keep to inspect the fixture workspace and candidate worktree afterwards, and --providers <name> to rerun just one."
  ];
  writeFileSync(path.join(options.runDirectory, "failure-handoff.md"), lines.join("\n") + "\n");
}

interface LiveSnapshot { ok: boolean; changed: boolean | null; changedFields: string[] | null; detail: string }

function liveSnapshot(context: Context, args: string[]): LiveSnapshot {
  if (context.options.liveLeakCheck === false) return { ok: false, changed: null, changedFields: null, detail: "skipped" };
  const run = arcadia(context, null, ["workspace", "leak-check", ...args, "--json"]);
  if (run.status === null) return { ok: false, changed: null, changedFields: null, detail: "leak-check did not run" };
  const changedFields = leakCheckChangedFields(run.json);
  return { ok: run.status === 0, changed: args.includes("--baseline") ? run.status !== 0 : null, changedFields, detail: (run.stdout.trim() || run.stderr.trim()).slice(0, 6000) };
}

/** The one leak-check field the operator ruled (2026-10-09) is not a Decision 0082 stop condition: Codex's project-trust entry. */
export const CODEX_TRUST_FIELD = "hashes.codexConfig";
export const CODEX_TRUST_NOTE = "Codex trust entry (operator ruled 2026-10-09: not a stop condition)";

/** Split a leak-check difference into the ruled-on Codex trust entry and everything else (still a possible stop condition). */
export function classifyLeakChanges(changed: boolean | null, fields: string[] | null): { codexTrustEntry: boolean; otherChanges: string[] } {
  if (!changed) return { codexTrustEntry: false, otherChanges: [] };
  if (!fields || fields.length === 0) return { codexTrustEntry: false, otherChanges: ["(the leak check reported a change but its fields could not be read)"] };
  return { codexTrustEntry: fields.includes(CODEX_TRUST_FIELD), otherChanges: fields.filter((field) => field !== CODEX_TRUST_FIELD) };
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
    // Each provider's preconditions (binary, sign-in, posture flags) are its own: a missing one skips only that provider.
    const runnable: ProviderName[] = [];
    for (const provider of order) {
      const precondition = checkProviderPrecondition(context, provider);
      context.log(`precondition (${provider}): ${precondition.ok ? "ok" : "SKIPPED"}: ${precondition.message}`);
      if (precondition.ok) { runnable.push(provider); continue; }
      const skipped = newResult(provider);
      skipped.outcome = "SKIPPED";
      skipped.reason = precondition.message;
      providers.push(skipped);
    }
    // Refuse before creating anything when no provider can run at all.
    if (runnable.length === 0) {
      throw new Refusal("preconditions", `no selected provider can run: ${providers.map((result) => `${result.provider}: ${result.reason}`).join("; ")}`);
    }

    const base = options.tempBase ?? options.env?.TMPDIR ?? tmpdir();
    mkdirSync(base, { recursive: true });
    tempRoot = realpathSync(mkdtempSync(path.join(base, TEMP_PREFIX)));
    context.log(`temporary root: ${tempRoot}${options.keep ? " (kept: --keep)" : " (removed at the end)"}`);
    const before = path.join(options.runDirectory, "live-workspace-before.json");
    const snapshot = liveSnapshot(context, ["--record", before]);
    context.log(`live workspace snapshot (read-only): ${snapshot.ok ? "recorded" : snapshot.detail}`);

    // SIGINT/SIGTERM (a /runs stop, a closed terminal) stop the provider's whole process group, start no later provider and still write the receipt.
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
      // Every runnable provider is tried, in order, each on its own fresh fixture; a pass or a failure never changes whether the next runs.
      for (const provider of runnable) {
        if (context.interrupted) break;
        const result = await runProviderAttempt(context, provider, tempRoot, date);
        if (options.keep) result.workspaceKept = path.join(tempRoot, provider);
        providers.push(result);
        context.log("");
        context.log(formatTable([result]));
        context.log("");
      }
    } finally {
      for (const [signal, handler] of handlers) source.off(signal, handler);
    }
    // A signal that arrived mid-run leaves later providers unstarted: they still appear in the receipt, as SKIPPED.
    for (const provider of runnable) {
      if (!providers.some((result) => result.provider === provider)) {
        const unstarted = newResult(provider);
        unstarted.outcome = "SKIPPED";
        unstarted.reason = `interrupted by ${context.interrupted ?? "a signal"} before this provider started`;
        providers.push(unstarted);
      }
    }
    providers.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));

    const after = snapshot.ok ? liveSnapshot(context, ["--baseline", before]) : snapshot;
    // Decision 0082's stop condition is any change to the live workspace attributable to an experiment, so a difference is
    // never waved through: other sessions legitimately write there, but each change must be attributed before the next experiment.
    // The operator ruled (2026-10-09) that Codex's project-trust entry in ~/.codex/config.toml is not a stop condition; any other change still is.
    const liveChanged = snapshot.ok ? after.changed : null;
    const leak = classifyLeakChanges(liveChanged, after.changedFields);
    context.log(snapshot.ok
      ? !liveChanged
        ? "live workspace comparison: unchanged"
        : leak.otherChanges.length > 0
          ? `LIVE WORKSPACE CHANGED during this run (${leak.otherChanges.join(", ")}): attribute every change (other sessions or services, versus this experiment) before any further experiment; an experiment-caused write is a possible Decision 0082 stop condition. See live-workspace-before.json and the receipt.`
          : "live workspace comparison: only the Codex trust entry changed"
      : "live workspace comparison: skipped");
    if (leak.codexTrustEntry) context.log(`${CODEX_TRUST_NOTE}: ${CODEX_TRUST_FIELD} changed (Codex persists a project-trust entry for a new directory in ~/.codex/config.toml). Recorded, not acted on.`);
    context.log("== Summary ==");
    context.log(formatTable(providers));
    context.log(`models: ${formatOverview(providers)}`);
    const passed = providers.filter((result) => result.outcome === "PASS");
    const outcome = context.interrupted ? "failed" : passed.length > 0 ? "succeeded" : "failed";
    const tally = (name: ProviderResult["outcome"]) => providers.filter((result) => result.outcome === name).map((result) => result.provider);
    const reason = context.interrupted ? `interrupted by ${context.interrupted}`
      : passed.length > 0 ? `${tally("PASS").join(", ")} completed the fixture Action headlessly${tally("FAIL").length ? `; ${tally("FAIL").join(", ")} failed` : ""}${tally("SKIPPED").length ? `; ${tally("SKIPPED").join(", ")} skipped` : ""}`
      : "no provider passed every criterion";
    return finish(outcome, context.interrupted ? "interrupted" : "complete", reason, {
      liveWorkspaceSnapshot: {
        recorded: snapshot.ok, changedDuringRun: liveChanged, changedFields: after.changedFields,
        codexTrustEntry: leak.codexTrustEntry ? CODEX_TRUST_NOTE : null,
        otherChanges: leak.otherChanges,
        actionRequired: leak.otherChanges.length > 0 ? "attribute before any further experiment (possible Decision 0082 stop condition)" : null,
        detail: after.detail.slice(0, 1500)
      },
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
