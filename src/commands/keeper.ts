import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { readWakeFiles } from "./productionIdleFront.js";
import { KEEPER_HEARTBEAT_FILE, KEEPER_ROLE } from "../production/momentumWatch.js";

/**
 * `arcadia keeper start|status|stop`: launch, show and stop ONE Momentum Keeper
 * as a background host Claude Code session (`claude --bg --remote-control`).
 * Decision 0188 B lets Rowan or the operator start a keeper; this is only the
 * launcher. It never uses tmux, never takes a prompt or a credential from the
 * command line, and writes one small record under the workspace's .arcadia.
 * It is not wired to production activation.
 */

export const KEEPER_RECORD_SCHEMA = "arcadia-keeper-launch-v1" as const;
export const KEEPER_RECORD_FILE = "momentum-keeper-launch.json" as const;
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
  model: string;
  argv: string[];
  launchedAt: string;
  stoppedAt: string | null;
}

export interface KeeperDependencies {
  now?: () => number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  briefPath?: string;
  newSessionId?: () => string;
}

export interface KeeperOptions { workspace?: string; wakesDir?: string }
export interface KeeperStartOptions extends KeeperOptions { supervisor?: string; model?: string; dryRun?: boolean }

interface ClaudeResult { ok: boolean; stdout: string; error: string }

function claude(args: string[], dependencies: KeeperDependencies): ClaudeResult {
  const result = spawnSync("claude", args, {
    cwd: dependencies.cwd ?? invocationRoot(),
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
  const needles = [record.sessionId, record.stopId, record.name];
  return { listed: rows.some((row) => { const text = JSON.stringify(row); return needles.some((needle) => needle !== "" && text.includes(needle)); }), error: null };
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
  const name = `↳ Momentum Keeper · under ${supervisor}`;
  const sessionId = (dependencies.newSessionId ?? randomUUID)();
  const argv = ["--bg", "--remote-control", KEEPER_REMOTE_CONTROL_NAME, "-n", name, "--model", model, "--permission-mode", "auto", "--session-id", sessionId, prompt];
  const live = liveReason(workspacePath, options, dependencies);
  if (options.dryRun) {
    return createSuccess({ command: "keeper.start", workspace: workspacePath, data: { dryRun: true, argv: ["claude", ...argv], record: null, liveKeeper: live } });
  }
  if (live !== null) throw validationError(`A Momentum Keeper is already live: ${live}. Run \`arcadia keeper status\`, or \`arcadia keeper stop\` first.`);

  const launched = claude(argv, dependencies);
  if (!launched.ok) throw validationError(`The keeper did not start and no record was written: ${launched.error}`);
  const printed = launched.stdout.match(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\b/i)?.[0];
  const record: KeeperRecord = {
    schema: KEEPER_RECORD_SCHEMA,
    status: "running",
    sessionId,
    stopId: printed ?? sessionId,
    name,
    remoteControlName: KEEPER_REMOTE_CONTROL_NAME,
    supervisor,
    model,
    argv: ["claude", ...argv],
    launchedAt: new Date((dependencies.now ?? Date.now)()).toISOString(),
    stoppedAt: null
  };
  writeKeeperRecord(workspacePath, record);
  return createSuccess({ command: "keeper.start", workspace: workspacePath, data: { dryRun: false, argv: record.argv, record, liveKeeper: null } });
}

export function renderKeeperStartSuccess(response: CommandSuccess<KeeperStartData>): string[] {
  const { argv, dryRun, liveKeeper, record } = response.data;
  if (dryRun) {
    return [
      "Dry run: nothing started or written. Exact command:",
      argv.map((part) => (/^[\w./:=@%+,-]+$/.test(part) ? part : JSON.stringify(part))).join(" "),
      liveKeeper ? `A real start would refuse: ${liveKeeper}.` : "No live keeper: a real start would proceed."
    ];
  }
  const started = record as KeeperRecord;
  return [`Started ${started.name} (session ${started.stopId}, Remote Control name ${started.remoteControlName}, model ${started.model}).`, "Next: `arcadia keeper status`; the first heartbeat should appear within about 5 minutes."];
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

export interface KeeperStopData { record: KeeperRecord }

export function runKeeperStopCommand(options: KeeperOptions, dependencies: KeeperDependencies = {}): CommandSuccess<KeeperStopData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const record = readKeeperRecord(workspacePath);
  if (!record) throw validationError("No keeper was launched by `arcadia keeper start` in this workspace; there is nothing to stop.");
  if (record.status === "stopped") throw validationError(`The recorded keeper ${record.stopId} is already stopped (${record.stoppedAt}).`);
  const stopped = claude(["stop", record.stopId], dependencies);
  if (!stopped.ok) throw validationError(`\`claude stop ${record.stopId}\` failed and the record is unchanged: ${stopped.error}`);
  const next: KeeperRecord = { ...record, status: "stopped", stoppedAt: new Date((dependencies.now ?? Date.now)()).toISOString() };
  writeKeeperRecord(workspacePath, next);
  return createSuccess({ command: "keeper.stop", workspace: workspacePath, data: { record: next } });
}

export function renderKeeperStopSuccess(response: CommandSuccess<KeeperStopData>): string[] {
  const { record } = response.data;
  return [`Stopped ${record.name} (session ${record.stopId}). Its conversation is kept; \`claude attach ${record.stopId}\` resumes it. A live run window pages "keeper not active" once the heartbeat lapses.`];
}
