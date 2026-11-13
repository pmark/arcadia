import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError, type ArcadiaError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { readWakeFiles } from "./productionIdleFront.js";
import { buildLaunchProof, claudeFolderTrust, defaultClaudeStatePath, agentIdSnapshot, discoverBackgroundSession, observeTranscript, type FolderTrust, type LaunchProof } from "../coordinator/launchProof.js";
import { findSessionTranscript } from "../coordinator/sessionIdentity.js";
import { KEEPER_HEARTBEAT_FILE, KEEPER_ROLE } from "../production/momentumWatch.js";

/**
 * `arcadia keeper start|status|stop`: launch, show and stop ONE Momentum Keeper
 * as a background host Claude Code session (`claude --bg --remote-control`).
 * Decision 0188 B lets Rowan or the operator start a keeper; this is only the
 * launcher. It never uses tmux, never takes a prompt or a credential from the
 * command line, and writes one small record under the workspace's .arcadia.
 * It is not wired to production activation.
 *
 * Probe P1/P2 adaptations (Decision 0227 D5 A, #1929): it launches only into an
 * already-trusted folder (a fresh one stops at the trust prompt); under `--bg`
 * `--session-id` is ignored, so it is not passed and the real session id is read
 * from the launch output or `claude agents --json`; the exact brief's SHA-256 is
 * recorded and compared with the transcript's first user message; and the
 * provider, model and effort recorded are the ones the Session shows, never the
 * requested values.
 */

export const KEEPER_RECORD_SCHEMA = "arcadia-keeper-launch-v1" as const;
export const KEEPER_RECORD_FILE = "momentum-keeper-launch.json" as const;
export const KEEPER_LOCK_FILE = "momentum-keeper-launch.lock" as const;
const LOCK_STALE_MS = 5 * 60_000;
export const KEEPER_DEFAULT_MODEL = "sonnet";
export const KEEPER_REMOTE_CONTROL_NAME = "momentum-keeper";
export const KEEPER_BRIEF_RELATIVE = "docs/agent-guidance/momentum-keeper-brief.md";
const SUPERVISOR_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const CLAUDE_TIMEOUT_MS = 60_000;

export interface KeeperRecord {
  schema: typeof KEEPER_RECORD_SCHEMA;
  status: "running" | "stopped";
  sessionId: string;
  /** The id `claude --bg` printed, which `claude stop` takes; the session id when none was recognised. */
  stopId: string;
  name: string;
  remoteControlName: string;
  supervisor: string;
  /** The model REQUESTED. The model the Session actually runs is `proof.observed.model`. */
  model: string;
  /** Recorded since the P1/P2 adaptations; absent on older records. */
  proof?: LaunchProof;
  /** The trusted folder the launch relied on. */
  trustedFolder?: string;
  argv: string[];
  launchedAt: string;
  stoppedAt: string | null;
}

export interface KeeperDependencies {
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  /** Where the caller stands, used only to find the primary checkout; the spawn always runs in that checkout. */
  cwd?: string;
  briefPath?: string;
  /** Claude Code's trusted-folder state; defaults to ~/.claude.json. */
  claudeStatePath?: string;
  /** Claude Code's projects directory (transcripts); defaults to ~/.claude/projects. */
  claudeProjectsDirectory?: string;
  sleep?: (ms: number) => void;
}

/** After a launch, up to this many polls (each KEEPER_POLL_MS) wait for the first reply so the actual model is observed. */
const KEEPER_POLLS = 18;
const KEEPER_POLL_MS = 5_000;
/** `claude agents --json` right after a launch may not list the session yet: a few attempts over a few seconds. */
const KEEPER_LOOKUP_ATTEMPTS = 4;
const KEEPER_LOOKUP_PAUSE_MS = 2_000;

export interface KeeperOptions { workspace?: string; wakesDir?: string }
export interface KeeperStopOptions extends KeeperOptions { forget?: boolean }
export interface KeeperStartOptions extends KeeperOptions { supervisor?: string; model?: string; dryRun?: boolean }

interface ClaudeResult { ok: boolean; stdout: string; error: string }

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) throw validationError(`Could not locate the primary checkout (git ${args.join(" ")} in ${cwd}): ${(result.stderr ?? "").trim() || result.error?.message || `exit ${result.status}`}`);
  return (result.stdout ?? "").trim();
}

/**
 * The primary checkout, whatever directory the caller stands in. A keeper that
 * lives in a task worktree dies when that worktree is retired, so the spawn
 * never runs in a linked worktree: the main worktree is the parent of the
 * common git dir, and a bare or otherwise unusual layout is refused.
 */
export function primaryCheckout(from: string): string {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], from);
  if (path.basename(common) !== ".git") throw validationError(`The git common dir ${common} is not a primary checkout's .git; refusing to run a keeper there.`);
  const primary = path.dirname(common);
  const own = git(["rev-parse", "--path-format=absolute", "--git-dir"], primary);
  if (path.resolve(own) !== path.resolve(common)) throw validationError(`${primary} is a linked worktree, not the primary checkout; refusing to run a keeper there.`);
  return primary;
}

function claude(args: string[], dependencies: KeeperDependencies, cwd: string = primaryCheckout(dependencies.cwd ?? invocationRoot())): ClaudeResult {
  const result = spawnSync("claude", args, {
    cwd,
    env: dependencies.env ?? process.env,
    encoding: "utf8",
    timeout: CLAUDE_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = (result.stdout ?? "").trim();
  if (result.error) return { ok: false, stdout, error: result.error.message };
  if (result.status !== 0) return { ok: false, stdout, error: `claude ${args[0]} exited ${result.status}: ${((result.stderr ?? "").trim() || stdout).slice(0, 400)}` };
  return { ok: true, stdout, error: "" };
}

function recordPath(workspacePath: string): string {
  return path.join(workspacePath, ".arcadia", KEEPER_RECORD_FILE);
}

export function readKeeperRecord(workspacePath: string): KeeperRecord | null {
  let raw: string;
  try {
    raw = readFileSync(recordPath(workspacePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw validationError(`The keeper record is unreadable: ${(error as Error).message}`);
  }
  try {
    const value = JSON.parse(raw) as KeeperRecord;
    if (value.schema !== KEEPER_RECORD_SCHEMA || typeof value.sessionId !== "string" || (value.status !== "running" && value.status !== "stopped")) throw new Error("unknown shape");
    return value;
  } catch (error) {
    throw validationError(`The keeper record ${recordPath(workspacePath)} is malformed (${(error as Error).message}); inspect it and remove it by hand if no keeper runs.`);
  }
}

function writeKeeperRecord(workspacePath: string, record: KeeperRecord): void {
  const target = recordPath(workspacePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  try { renameSync(temporary, target); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}

function lockPath(workspacePath: string): string {
  return path.join(workspacePath, ".arcadia", KEEPER_LOCK_FILE);
}

/** The lock body: who holds it, when it started, and a token only that start knows, so a release removes only its own lock. */
interface LockBody { pid?: unknown; startedAt?: unknown; token?: unknown }

/** Test seams for the lock protocol; production passes none. */
export interface KeeperLockHooks {
  beforeReclaim?: () => void;
  /** Under the reclaim gate, before the stale lock is re-verified and unlinked. */
  afterGateAcquired?: () => void;
  /** Under the reclaim gate, after the gate is taken, before the re-verify. */
  beforeUnlink?: () => void;
}

interface FileIdentity { ino: number; mtimeMs: number }

function identityOf(file: string): FileIdentity | null {
  try {
    const stat = statSync(file);
    return { ino: stat.ino, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function readLockBody(file: string): LockBody | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** True when the pid names a running process. EPERM means it runs under another user, so it is alive too. */
function pidAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A lock is stale only when it is older than the window AND its owner is not running. A live owner always wins. */
function isStale(file: string): boolean {
  const identity = identityOf(file);
  if (identity === null || Date.now() - identity.mtimeMs < LOCK_STALE_MS) return false;
  return !pidAlive(readLockBody(file)?.pid);
}

/**
 * Removes the lock only while its body still carries this start's token. Read-then-unlink is sound here: a live lock is
 * unlinked only by its owner, and a reclaimer unlinks a lock only when its owner is not alive (never this process) and
 * only while it holds the reclaim gate.
 */
function releaseOwn(target: string, token: string): void {
  if (readLockBody(target)?.token !== token) return;
  try { unlinkSync(target); } catch { /* already gone */ }
}

/**
 * Replaces a stale lock. Only the holder of the reclaim gate (`<lock>.reclaim`, exclusive-create) may unlink the lock, and a
 * second reclaimer is refused while the gate exists. Under the gate the lock must still be the exact stale file observed
 * (same inode and mtime, still stale) before it is unlinked and this start's lock is created. A gate left by a crashed
 * reclaimer is never removed automatically: the refusal names it so an operator can remove it by hand.
 */
function claimStale(target: string, observed: FileIdentity, body: string, token: string, hooks: KeeperLockHooks): () => void {
  const gate = `${target}.reclaim`;
  const inProgress = (detail = ""): ArcadiaError => validationError(`Another \`arcadia keeper start\` is in progress (${target}); nothing was launched.${detail}`);
  try {
    writeFileSync(gate, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw inProgress(` A reclaim is under way, or ${gate} was left by a crashed start: if no start is running and that file is older than ten minutes, remove it by hand.`);
    }
    throw validationError(`The keeper start reclaim gate could not be taken: ${(error as Error).message}`);
  }
  try {
    hooks.afterGateAcquired?.();
    hooks.beforeUnlink?.();
    const current = identityOf(target);
    if (current === null || current.ino !== observed.ino || current.mtimeMs !== observed.mtimeMs || !isStale(target)) throw inProgress();
    try {
      unlinkSync(target);
      writeFileSync(target, body, { flag: "wx" });
    } catch {
      // Another starter took the path between the re-verify and the create: refuse, as for a live lock.
      throw inProgress();
    }
    return () => releaseOwn(target, token);
  } finally {
    try { unlinkSync(gate); } catch { /* already gone */ }
  }
}

/**
 * Exclusive-create, so two concurrent starts cannot both pass the guard. A lock is taken only by `wx` create; when one exists
 * and is stale (see isStale), it is replaced under the reclaim gate (see claimStale). No live lock is ever renamed or
 * unlinked by a starter that does not own it.
 */
export function acquireLock(workspacePath: string, now: number, hooks: KeeperLockHooks = {}): () => void {
  const target = lockPath(workspacePath);
  const token = randomUUID();
  const body = `${JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString(), token })}\n`;
  const inProgress = (): ArcadiaError => validationError(`Another \`arcadia keeper start\` is in progress (${target}); nothing was launched.`);
  mkdirSync(path.dirname(target), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(target, body, { flag: "wx" });
      return () => releaseOwn(target, token);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw validationError(`The keeper start lock could not be taken: ${(error as Error).message}`);
    }
    if (attempt > 0) throw inProgress();
    const observed = identityOf(target);
    if (observed === null) continue;
    if (!isStale(target)) throw inProgress();
    hooks.beforeReclaim?.();
    return claimStale(target, observed, body, token, hooks);
  }
  throw inProgress();
}

/** A workspace inside the primary checkout would put the lock and record into the tree and make the checkout dirty. */
function refuseWorkspaceInCheckout(workspacePath: string, checkout: string): void {
  // realpath.native canonicalises letter case on case-insensitive volumes (macOS APFS); the JS realpath does not.
  const relative = path.relative(realpathSync.native(checkout), realpathSync.native(workspacePath));
  if (relative === "" || (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative))) {
    throw validationError(`The workspace ${workspacePath} is inside the primary checkout ${checkout}; its keeper lock and record would make that checkout dirty. Use a workspace outside the checkout.`, { reason: "workspace_in_checkout" });
  }
}

interface Heartbeat { session: string | null; armedUntil: string; live: boolean }

function readHeartbeat(wakesDir: string, now: number): Heartbeat | null {
  const wake = readWakeFiles(wakesDir).wakes
    .filter((candidate) => candidate.source === "heartbeat-file" && candidate.role === KEEPER_ROLE && candidate.armedUntil !== null)
    .sort((a, b) => Date.parse(b.armedUntil as string) - Date.parse(a.armedUntil as string))[0];
  if (!wake) return null;
  return { session: wake.session, armedUntil: wake.armedUntil as string, live: Date.parse(wake.armedUntil as string) > now };
}

/** True/false when `claude agents --json` could be read, else null with the reason. */
function listsSession(record: KeeperRecord, dependencies: KeeperDependencies): { listed: boolean | null; error: string | null } {
  const result = claude(["agents", "--json"], dependencies);
  if (!result.ok) return { listed: null, error: result.error };
  let rows: unknown;
  try { rows = JSON.parse(result.stdout || "[]"); } catch { return { listed: null, error: "claude agents --json printed no JSON" }; }
  if (!Array.isArray(rows)) return { listed: null, error: "claude agents --json did not print an array" };
  // Exact id matches only (never the name, which is the constant launch name an older keeper can share): a substring or a name would let an unrelated session keep a dead keeper "listed".
  const matches = (row: unknown): boolean => {
    if (!row || typeof row !== "object") return false;
    const fields = row as Record<string, unknown>;
    return fields.id === record.stopId || fields.sessionId === record.sessionId || fields.sessionId === record.stopId;
  };
  return { listed: rows.some(matches), error: null };
}

function wakesDirOf(workspacePath: string, options: KeeperOptions): string {
  return path.resolve(options.wakesDir ?? path.join(workspacePath, ".arcadia", "armed-wakes"));
}

function briefFor(supervisor: string, dependencies: KeeperDependencies): string {
  const file = dependencies.briefPath ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", KEEPER_BRIEF_RELATIVE);
  let template: string;
  try { template = readFileSync(file, "utf8"); } catch (error) {
    throw validationError(`The keeper brief ${file} could not be read: ${(error as Error).message}`);
  }
  const marker = template.indexOf("\n---\n");
  if (marker < 0) throw validationError(`The keeper brief ${file} has no "---" line separating the note from the prompt.`);
  return template.slice(marker + 5).trim().replaceAll("{{SUPERVISOR}}", supervisor);
}

export interface KeeperStartData {
  dryRun: boolean;
  argv: string[];
  record: KeeperRecord | null;
  /** Dry run only: what a real start would meet. */
  liveKeeper: string | null;
  /** Whether the launch folder is one Claude Code already trusts; a real start refuses when it is not. */
  trust: FolderTrust;
}

/** Why a keeper counts as live, or null. A live heartbeat alone is enough: it is the alarm's own definition. */
function liveReason(workspacePath: string, options: KeeperOptions, dependencies: KeeperDependencies): string | null {
  const now = (dependencies.now ?? Date.now)();
  const heartbeat = readHeartbeat(wakesDirOf(workspacePath, options), now);
  if (heartbeat?.live) return `a keeper heartbeat is armed until ${heartbeat.armedUntil}${heartbeat.session ? ` (${heartbeat.session})` : ""}`;
  const record = readKeeperRecord(workspacePath);
  if (record?.status === "running") {
    const seen = listsSession(record, dependencies);
    if (seen.listed === null) return `the recorded keeper ${record.stopId} could not be checked against \`claude agents\`: ${seen.error}`;
    if (seen.listed) return `the recorded keeper ${record.stopId} is still listed by \`claude agents\``;
  }
  return null;
}

export function runKeeperStartCommand(options: KeeperStartOptions, dependencies: KeeperDependencies = {}): CommandSuccess<KeeperStartData> {
  const supervisor = options.supervisor?.trim() ?? "";
  if (!SUPERVISOR_PATTERN.test(supervisor)) {
    throw validationError("--supervisor must be the supervising session's id (letters, digits, . _ : -; at most 80 characters).", { "--supervisor": options.supervisor ?? null });
  }
  const model = options.model?.trim() || KEEPER_DEFAULT_MODEL;
  if (!/^[A-Za-z0-9_.:[\]-]{1,80}$/.test(model)) throw validationError("--model must be a model alias or id.", { "--model": model });
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const prompt = briefFor(supervisor, dependencies);
  const name = "♾️ Flynn · keeper starting";
  // `--bg` manages the session id and ignores --session-id (probe P2), so none is passed; the real one is discovered after launch.
  const argv = ["--bg", "--remote-control", KEEPER_REMOTE_CONTROL_NAME, "-n", name, "--model", model, "--permission-mode", "auto", prompt];
  const checkout = primaryCheckout(dependencies.cwd ?? invocationRoot());
  refuseWorkspaceInCheckout(workspacePath, checkout);
  const trust = claudeFolderTrust(checkout, dependencies.claudeStatePath ?? defaultClaudeStatePath(dependencies.env ?? process.env, undefined, checkout));
  if (options.dryRun) {
    const live = liveReason(workspacePath, options, dependencies);
    return createSuccess({ command: "keeper.start", workspace: workspacePath, data: { dryRun: true, argv: ["claude", ...argv], record: null, liveKeeper: live, trust } });
  }
  // Probe P1: an untrusted folder stops at the trust prompt and the keeper never receives its brief. Refuse before launching anything.
  if (!trust.trusted) throw validationError(`The keeper was not started: ${trust.detail}`, { reason: "folder_untrusted" });
  const release = acquireLock(workspacePath, (dependencies.now ?? Date.now)());
  try {
    return launchLocked(workspacePath, options, dependencies, { argv, name, prompt, supervisor, model, checkout, trust });
  } finally {
    release();
  }
}

function launchLocked(
  workspacePath: string,
  options: KeeperStartOptions,
  dependencies: KeeperDependencies,
  launch: { argv: string[]; name: string; prompt: string; supervisor: string; model: string; checkout: string; trust: FolderTrust }
): CommandSuccess<KeeperStartData> {
  const { argv, checkout, model, name, prompt, supervisor, trust } = launch;
  const live = liveReason(workspacePath, options, dependencies);
  if (live !== null) throw validationError(`A Momentum Keeper is already live: ${live}. Run \`arcadia keeper status\`, or \`arcadia keeper stop\` first.`);

  // Snapshot the ids already listed BEFORE launching: only a row that appears afterwards can be this keeper, so an older
  // or foreign session (including an unstopped keeper with the same launch name) can never become the stop target. If the
  // listing cannot be read, nothing is launched: the new session could not be told apart from an old one.
  const before = claude(["agents", "--json"], dependencies, checkout);
  const preexisting = before.ok ? agentIdSnapshot(before.stdout) : null;
  if (preexisting === null) throw validationError(`The keeper was not started: \`claude agents --json\` could not be read before launching${before.ok ? " (not a JSON array)" : ` (${before.error})`}, so a new session could not be told apart from an existing one. Nothing was launched.`, { reason: "agents_unreadable" });

  const launched = claude(argv, dependencies, checkout);
  if (!launched.ok) throw validationError(`The keeper did not start and no record was written: ${launched.error}`);
  // The id is accepted only through `claude agents --json` (launch output is free text, so a printed token is a candidate);
  // --bg ignores --session-id, so the one we might ask for is never used. A freshly launched session may not be listed
  // yet: retry a few times over a few seconds.
  const sleep = dependencies.sleep ?? ((ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); });
  let discovered = discoverBackgroundSession({ launchOutput: launched.stdout, agentsJson: null, name, cwd: checkout, preexisting });
  let listError = "";
  for (let attempt = 0; attempt < KEEPER_LOOKUP_ATTEMPTS; attempt += 1) {
    if (attempt > 0) sleep(KEEPER_LOOKUP_PAUSE_MS);
    const listing = claude(["agents", "--json"], dependencies, checkout);
    listError = listing.ok ? "" : ` (${listing.error})`;
    if (!listing.ok) continue;
    discovered = discoverBackgroundSession({ launchOutput: launched.stdout, agentsJson: listing.stdout, name, cwd: checkout, preexisting });
    if (discovered.verified) break;
  }
  if (!discovered.verified || discovered.stopId === null || discovered.stopId === "") {
    const candidate = discovered.unverifiedPrintedId === null ? "" : ` The launch output contained ${discovered.unverifiedPrintedId}, which no new \`claude agents --json\` row in ${checkout} confirms, so it is not used as a stop target.`;
    throw validationError(`The keeper may be running, but its session could not be verified against \`claude agents --json\`${listError}, so no record was written.${candidate} Inspect \`claude agents\` and stop it by hand if listed.`, { reason: "session_id_undiscovered" });
  }
  // Bounded wait for the transcript to show the delivered brief and the model's first reply; deterministic file reads only.
  const projects = dependencies.claudeProjectsDirectory ?? path.join(homedir(), ".claude", "projects");
  let transcript = { deliveredSha: null as string | null, model: null as string | null, effort: null as string | null };
  // Without a full session UUID there is no transcript to find, so there is nothing to wait for.
  for (let poll = 0; discovered.sessionId !== null && poll < KEEPER_POLLS; poll += 1) {
    const file = discovered.sessionId === null ? null : findSessionTranscript(projects, discovered.sessionId);
    if (file !== null) transcript = observeTranscript(file);
    if (transcript.deliveredSha !== null && transcript.model !== null) break;
    if (poll < KEEPER_POLLS - 1) sleep(KEEPER_POLL_MS);
  }
  const proof = buildLaunchProof({
    transport: "bg", sessionId: discovered.sessionId, brief: prompt, transcript, agent: { model: discovered.model, effort: discovered.effort },
    requestedModel: model, requestedEffort: null, now: new Date((dependencies.now ?? Date.now)())
  });
  if (discovered.sessionId === null) proof.warnings.push("The host listed no full session UUID for the keeper, so its transcript could not be read; delivery and model are unverified.");
  const record: KeeperRecord = {
    schema: KEEPER_RECORD_SCHEMA,
    status: "running",
    sessionId: discovered.sessionId ?? discovered.stopId,
    stopId: discovered.stopId,
    proof,
    trustedFolder: trust.trustedFolder ?? checkout,
    name,
    remoteControlName: KEEPER_REMOTE_CONTROL_NAME,
    supervisor,
    model,
    argv: ["claude", ...argv],
    launchedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
    stoppedAt: null
  };
  writeKeeperRecord(workspacePath, record);
  return createSuccess({ command: "keeper.start", workspace: workspacePath, data: { dryRun: false, argv: record.argv, record, liveKeeper: null, trust } });
}

export function renderKeeperStartSuccess(response: CommandSuccess<KeeperStartData>): string[] {
  const { argv, dryRun, liveKeeper, record, trust } = response.data;
  if (dryRun) {
    return [
      "Dry run: nothing started or written. Exact command:",
      argv.map((part) => (/^[\w./:=@%+,-]+$/.test(part) ? part : JSON.stringify(part))).join(" "),
      trust.trusted ? `Launch folder: trusted (${trust.detail})` : `A real start would refuse: ${trust.detail}`,
      liveKeeper ? `A real start would refuse: ${liveKeeper}.` : "No live keeper: a real start would proceed."
    ];
  }
  const started = record as KeeperRecord;
  const proof = started.proof;
  return [
    `Started ${started.name} (session ${started.stopId}, Remote Control name ${started.remoteControlName}, requested model ${started.model}).`,
    ...(proof ? [
      `Launch proof: brief ${proof.delivered ? "delivered exactly" : "NOT verified as delivered"} (sha ${proof.briefSha.slice(0, 12)}); observed model ${proof.observed.model ?? "unobserved"}, effort ${proof.observed.effort ?? "unobserved"}.`,
      ...proof.warnings.map((warning) => `Warning: ${warning}`)
    ] : []),
    "Next: `arcadia keeper status`; the first heartbeat should appear within about 5 minutes."
  ];
}

export interface KeeperStatusData {
  record: KeeperRecord | null;
  listed: boolean | null;
  listError: string | null;
  heartbeat: Heartbeat | null;
}

export function runKeeperStatusCommand(options: KeeperOptions, dependencies: KeeperDependencies = {}): CommandSuccess<KeeperStatusData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const record = readKeeperRecord(workspacePath);
  const seen = record ? listsSession(record, dependencies) : { listed: null, error: null };
  const heartbeat = readHeartbeat(wakesDirOf(workspacePath, options), (dependencies.now ?? Date.now)());
  return createSuccess({ command: "keeper.status", workspace: workspacePath, data: { record, listed: seen.listed, listError: seen.error, heartbeat } });
}

export function renderKeeperStatusSuccess(response: CommandSuccess<KeeperStatusData>): string[] {
  const { heartbeat, listError, listed, record } = response.data;
  const lines = record
    ? [`Record: ${record.status} ${record.name} (session ${record.stopId}, Remote Control ${record.remoteControlName}, supervisor ${record.supervisor}, launched ${record.launchedAt}${record.stoppedAt ? `, stopped ${record.stoppedAt}` : ""}).`]
    : ["Record: none (no keeper was launched by `arcadia keeper start`)."];
  if (record) lines.push(`claude agents: ${listed === null ? `unknown (${listError})` : listed ? "listed" : "not listed"}.`);
  lines.push(heartbeat ? `Heartbeat: armed until ${heartbeat.armedUntil}${heartbeat.session ? ` (${heartbeat.session})` : ""} — ${heartbeat.live ? "live" : "lapsed"}.` : `Heartbeat: none (${KEEPER_HEARTBEAT_FILE} absent).`);
  return lines;
}

export interface KeeperStopData { record: KeeperRecord; note: string | null }

export function runKeeperStopCommand(options: KeeperStopOptions, dependencies: KeeperDependencies = {}): CommandSuccess<KeeperStopData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const record = readKeeperRecord(workspacePath);
  if (!record) throw validationError("No keeper was launched by `arcadia keeper start` in this workspace; there is nothing to stop.");
  if (record.status === "stopped") throw validationError(`The recorded keeper ${record.stopId} is already stopped (${record.stoppedAt}).`);
  let note: string | null = null;
  if (options.forget) {
    note = "forgotten: marked stopped without calling claude";
  } else {
    const stopped = claude(["stop", record.stopId], dependencies);
    if (!stopped.ok) {
      // The session is already gone: the record is stale, so close it rather than wedge the single-keeper guard.
      if (!/no such|not found|unknown session|no session/i.test(stopped.error)) {
        throw validationError(`\`claude stop ${record.stopId}\` failed and the record is unchanged: ${stopped.error}. If the session is gone, run \`arcadia keeper stop --forget\`.`);
      }
      note = `claude no longer knows the session (${stopped.error.slice(0, 160)}); record closed`;
    }
  }
  const next: KeeperRecord = { ...record, status: "stopped", stoppedAt: new Date((dependencies.now ?? Date.now)()).toISOString() };
  writeKeeperRecord(workspacePath, next);
  return createSuccess({ command: "keeper.stop", workspace: workspacePath, data: { record: next, note } });
}

export function renderKeeperStopSuccess(response: CommandSuccess<KeeperStopData>): string[] {
  const { note, record } = response.data;
  if (note) return [`Marked ${record.name} (session ${record.stopId}) stopped: ${note}.`];
  return [`Stopped ${record.name} (session ${record.stopId}). Its conversation is kept; \`claude attach ${record.stopId}\` resumes it. A live run window pages "keeper not active" once the heartbeat lapses.`];
}
