import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { PRODUCTION_CONTROL_DEADLINES, readProductionPolicySafely } from "../production/policy.js";
import { PRESERVATION_HEARTBEAT_SCHEMA, readTransportHeartbeat } from "../sessions/transportHeartbeat.js";
import { getWorkspacePaths } from "../workspace/paths.js";
import { runPingSendCommand } from "./ping.js";
import { readTickStartedAt, readWorkerRecord } from "./worker.js";

/**
 * The worker raises every other alert, so a stuck worker raises none (Issue
 * #2084: silent 02:05:30 to 03:08:10 UTC on 2026-11-05 with production Active).
 * This runs on a launchd timer, outside the worker, and pages once per episode.
 *
 * What it reads matters more than anything else here. `worker.pid` is useless:
 * the heartbeat beacon is a separate process that stamps it every 5s through a
 * hang, which is its job (Issue #617). Only the worker's main loop writes the
 * two files used below, so both stop when that loop stops:
 *
 * - `worker.tick-started`, stamped at each tick's start and at each progress
 *   point inside it, removed when the tick ends. Present means a tick is
 *   running, and its age is the time since that tick last proved progress. It
 *   also catches a tick wedged on an await, where the loop's timer still runs.
 * - `preservation.heartbeat`, re-stamped by the loop's own 5s timer and never by
 *   the beacon. It answers between ticks, and covers a worker that has gone.
 *
 * A code review is the one legitimate long block. It runs synchronously inside
 * the tick and took 7 minutes at the median and 12 at p95 in the live log, so a
 * 5-minute limit alone would page on most reviews. Instead, while this worker
 * holds a review's execution claim, the limit moves out to the reviewer's own
 * timeout plus the threshold. Otherwise the longest silence in the Active
 * windows of 2026-11-02 to 2026-11-05 was 194s, not counting the hang and idle
 * waits on the operator.
 *
 * It restarts and kills nothing, and calls no model. It opens the database
 * read-only and writes only one outbox row, through `arcadia ping`, on a
 * transition. That route survives a stuck worker: the Discord bot is its own
 * service, and a ping queued at 02:59:05 in that hang was delivered 5s later.
 */

export const LIVENESS_DEFAULT_STALE_SECONDS = 300;
export const LIVENESS_MIN_STALE_SECONDS = 30;
const STATE_FILE = "production-liveness.json";
const STATE_SCHEMA = "arcadia-production-liveness-v1";
const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:3020";
const PS_TIMEOUT_MS = 5_000;
/** The artifact segments `src/qa/prReview.ts` keeps a Pull Request's reviews under. */
const REVIEW_RECEIPT_SEGMENTS = ["code-review", "qa"];

export type LivenessAlertKind = "stale" | "read_failed";

export interface LivenessState {
  schema: typeof STATE_SCHEMA;
  /** The last confirmed production state; null until one has been read. */
  productionActive: boolean | null;
  openAlert: { kind: LivenessAlertKind; alertedAt: string; pingId: string } | null;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  elapsedSeconds: number;
  command: string;
}

export interface WorkerProgress {
  progressAt: number;
  signal: "tick-marker" | "preservation-heartbeat";
  workerPid: number | null;
}

export type LivenessObservation =
  | { kind: "inactive" }
  | { kind: "fresh"; ageMs: number; limitMs: number; signal: WorkerProgress["signal"]; workerPid: number | null }
  | { kind: "stale"; progressAt: number; ageMs: number; limitMs: number; signal: WorkerProgress["signal"]; workerPid: number | null }
  | { kind: "read_failed"; what: string; reason: string };

export type LivenessPing = "stale_alert" | "read_failed_alert" | "recovered" | "closed_by_off";

/**
 * The state table. Pure, and the only place that decides whether to page. An
 * open alert is cleared only by a line saying so, and a read failure during an
 * open staleness alert adds no page: the operator is already looking.
 */
export function decideLiveness(state: LivenessState, observation: LivenessObservation): {
  ping: LivenessPing | null;
  openAlert: LivenessAlertKind | null;
  productionActive: boolean | null;
  logOnly: string | null;
} {
  const open = state.openAlert?.kind ?? null;
  switch (observation.kind) {
    case "inactive":
      return { ping: open ? "closed_by_off" : null, openAlert: null, productionActive: false, logOnly: null };
    case "fresh":
      return { ping: open ? "recovered" : null, openAlert: null, productionActive: true, logOnly: null };
    case "stale":
      return { ping: open === "stale" ? null : "stale_alert", openAlert: "stale", productionActive: true, logOnly: null };
    case "read_failed": {
      const failure = `Could not read ${observation.what}: ${observation.reason}`;
      if (open) return { ping: null, openAlert: open, productionActive: state.productionActive, logOnly: failure };
      // A confirmed Off has nobody to page about; the failure still reaches the log and the exit code.
      if (state.productionActive === false) return { ping: null, openAlert: null, productionActive: false, logOnly: failure };
      return { ping: "read_failed_alert", openAlert: "read_failed", productionActive: state.productionActive, logOnly: null };
    }
  }
}

function emptyState(): LivenessState {
  return { schema: STATE_SCHEMA, productionActive: null, openAlert: null };
}

function statePath(workspacePath: string): string {
  return path.join(workspacePath, ".arcadia", STATE_FILE);
}

/** A state that cannot be read restarts the episode, so the failure costs a repeated page, never a lost one. */
function readState(workspacePath: string): { state: LivenessState; problem: string | null } {
  let raw: string;
  try {
    raw = readFileSync(statePath(workspacePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: emptyState(), problem: null };
    return { state: emptyState(), problem: errorText(error) };
  }
  try {
    const value = JSON.parse(raw) as Partial<LivenessState>;
    if (value.schema !== STATE_SCHEMA) throw new Error("unknown schema");
    return { state: { schema: STATE_SCHEMA, productionActive: value.productionActive ?? null, openAlert: value.openAlert ?? null }, problem: null };
  } catch (error) {
    return { state: emptyState(), problem: errorText(error) };
  }
}

function writeState(workspacePath: string, state: LivenessState): void {
  const target = statePath(workspacePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
  try { renameSync(temporary, target); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}

/** Only the main loop writes what this reads; see the module comment. Throws when neither signal can be read. */
export function readWorkerProgress(workspacePath: string): WorkerProgress {
  const record = readWorkerRecord(workspacePath);
  const workerPid = record?.pid ?? null;
  const marker = record ? readTickStartedAt(workspacePath, record) : null;
  if (marker !== null) return { progressAt: marker, signal: "tick-marker", workerPid };
  const heartbeat = readTransportHeartbeat(workspacePath);
  if (heartbeat.schema !== PRESERVATION_HEARTBEAT_SCHEMA || typeof heartbeat.at !== "number") {
    throw new Error("the preservation heartbeat is malformed");
  }
  return { progressAt: heartbeat.at, signal: "preservation-heartbeat", workerPid };
}

/** When this worker most recently claimed a review now in progress. A crashed or manual run's claim names another pid. */
export function reviewClaimedAt(workspacePath: string, workerPid: number | null): number | null {
  if (workerPid === null) return null;
  const artifacts = getWorkspacePaths(workspacePath).artifacts;
  const children = (directory: string): string[] => {
    try { return readdirSync(directory).map((name) => path.join(directory, name)); } catch { return []; }
  };
  let newest: number | null = null;
  for (const segment of REVIEW_RECEIPT_SEGMENTS) {
    for (const repository of children(path.join(artifacts, segment, "pull-requests"))) {
      for (const pullRequest of children(repository)) {
        try {
          const owner = JSON.parse(readFileSync(path.join(pullRequest, ".execution-claim", "owner.json"), "utf8")) as { pid?: unknown; claimedAt?: unknown };
          const claimedAt = typeof owner.claimedAt === "string" ? Date.parse(owner.claimedAt) : Number.NaN;
          if (owner.pid === workerPid && Number.isFinite(claimedAt) && (newest === null || claimedAt > newest)) newest = claimedAt;
        } catch { /* no claim here, which is nearly every Pull Request */ }
      }
    }
  }
  return newest;
}

/** Clock skew reads as fresh, as it does for `worker start`: a future stamp is not evidence of a hang. */
export function observeProgress(workspacePath: string, staleMs: number, now: number): LivenessObservation {
  let progress: WorkerProgress;
  try {
    progress = readWorkerProgress(workspacePath);
  } catch (error) {
    return { kind: "read_failed", what: "the worker's progress signal", reason: errorText(error) };
  }
  const ageMs = Math.max(0, now - progress.progressAt);
  const fresh = { signal: progress.signal, workerPid: progress.workerPid };
  if (ageMs < staleMs) return { kind: "fresh", ageMs, limitMs: staleMs, ...fresh };
  // Scanned only past the threshold, so an ordinary run reads no artifacts.
  const claimedAt = reviewClaimedAt(workspacePath, progress.workerPid);
  const limitMs = claimedAt === null
    ? staleMs
    : Math.max(staleMs, claimedAt + PRODUCTION_CONTROL_DEADLINES.tickReviewerTimeoutMs + staleMs - progress.progressAt);
  if (ageMs < limitMs) return { kind: "fresh", ageMs, limitMs, ...fresh };
  return { kind: "stale", progressAt: progress.progressAt, ageMs, limitMs, ...fresh };
}

/** `ps` elapsed time, `[[dd-]hh:]mm:ss`, in seconds; NaN for anything else. */
export function parseElapsed(value: string): number {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(value.trim());
  if (!match) return Number.NaN;
  return Number(match[1] ?? 0) * 86_400 + Number(match[2] ?? 0) * 3_600 + Number(match[3]) * 60 + Number(match[4]);
}

export function listProcesses(): ProcessRow[] {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,etime=,command="], { encoding: "utf8", timeout: PS_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
  const rows: ProcessRow[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), elapsedSeconds: parseElapsed(match[3] ?? ""), command: match[4] ?? "" });
  }
  return rows;
}

const CAPTURE_READER = /(^|\/)[Pp]ython[\d.]*\s+-I\s+-c\b/;

/** The child to name: the #2084 capture reader first, then the oldest. The beacon is expected to outlive any hang. */
export function suspectChild(rows: ProcessRow[], workerPid: number): ProcessRow | null {
  const descendants = new Set<number>([workerPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) { descendants.add(row.pid); grew = true; }
    }
  }
  const candidates = rows.filter((row) => row.pid !== workerPid && descendants.has(row.pid) && !row.command.includes("workerHeartbeatBeacon"));
  const age = (row: ProcessRow) => (Number.isFinite(row.elapsedSeconds) ? row.elapsedSeconds : -1);
  return [...candidates].sort((a, b) => Number(CAPTURE_READER.test(b.command)) - Number(CAPTURE_READER.test(a.command)) || age(b) - age(a))[0] ?? null;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function clockTime(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

function describeChild(child: ProcessRow): string {
  const [program = "", ...rest] = child.command.trim().split(/\s+/);
  const elapsed = Number.isFinite(child.elapsedSeconds) ? `, running ${formatDuration(child.elapsedSeconds * 1000)}` : "";
  return `pid ${child.pid}${elapsed}: ${[path.basename(program), ...rest].join(" ").slice(0, 40)}`;
}

/** Every message fits `arcadia ping`'s 500 characters; the link travels separately. */
export function staleMessage(
  observation: Extract<LivenessObservation, { kind: "stale" }>,
  rows: ProcessRow[] | null
): string {
  const pid = observation.workerPid;
  const alive = pid === null || rows === null ? null : rows.some((row) => row.pid === pid);
  const worker = pid === null ? "No worker record" : alive === false ? `Worker pid ${pid} is gone` : `Worker pid ${pid}`;
  const child = pid === null || rows === null ? null : suspectChild(rows, pid);
  const children = rows === null ? "Children unknown (ps failed)." : child ? `Long-lived child ${describeChild(child)}.` : "No long-lived child.";
  return [
    `🚨 Worker silent ${formatDuration(observation.ageMs)} with production Active: no tick progress since ${clockTime(observation.progressAt)}.`,
    `${worker}. ${children}`,
    "Look: a silent worker.log and a `Python -I -c` child older than a few seconds is #2084. Before any kill, `sample` both and `lsof -p` the child.",
    "Nothing was restarted."
  ].join(" ");
}

function readFailedMessage(observation: Extract<LivenessObservation, { kind: "read_failed" }>): string {
  return `⚠️ The liveness check could not read ${observation.what}, so the worker's progress is unknown while production may be Active: ${observation.reason.replace(/\s+/g, " ").slice(0, 200)}`;
}

function closingMessage(kind: LivenessAlertKind, ping: "recovered" | "closed_by_off", alertedAt: string, now: number): string {
  const open = formatDuration(Math.max(0, now - Date.parse(alertedAt)));
  if (ping === "closed_by_off") {
    return kind === "stale"
      ? `Production went Off ${open} after the worker-silent alert. The watch has closed, and the worker is not confirmed recovered.`
      : `Production is Off and the liveness check can read again, ${open} after its alert.`;
  }
  return kind === "stale"
    ? `✅ Worker progressing again, ${open} after the silent-worker alert.`
    : `✅ The liveness check can read again, ${open} after its alert, and the worker is progressing.`;
}

export interface ProductionLivenessOptions {
  workspace?: string;
  staleSeconds?: number | string;
  dashboardUrl?: string;
}

export interface ProductionLivenessDependencies {
  now?: () => number;
  readProductionActive?: (workspacePath: string) => boolean;
  listProcesses?: () => ProcessRow[];
  queuePing?: (input: { workspace: string; message: string; kind: string; link: string; agent: string }) => { id: string };
}

export interface ProductionLivenessData {
  observation: LivenessObservation;
  ping: LivenessPing | null;
  pingId: string | null;
  message: string | null;
  openAlert: LivenessAlertKind | null;
}

function readProductionActiveFromDatabase(workspacePath: string): boolean {
  return withReadOnlyDatabase(workspacePath, (db) => {
    const read = readProductionPolicySafely(db);
    if (read.status !== "ok") throw new Error(read.reason);
    return read.policy.desiredState === "active";
  });
}

export function parseStaleSeconds(value: number | string | undefined): number {
  if (value === undefined) return LIVENESS_DEFAULT_STALE_SECONDS;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < LIVENESS_MIN_STALE_SECONDS) {
    throw validationError(`--stale-seconds must be a whole number of at least ${LIVENESS_MIN_STALE_SECONDS}.`, { staleSeconds: value });
  }
  return seconds;
}

function queueThroughPing(input: { workspace: string; message: string; kind: string; link: string; agent: string }): { id: string } {
  return runPingSendCommand(input).data.ping;
}

/**
 * One timer run. A failure that reached nobody leaves the state as it was, so
 * the next run retries, and it throws, so launchd's log and the exit code have
 * it even when the database that carries the ping is what failed.
 */
export function runProductionLivenessCheckCommand(
  options: ProductionLivenessOptions,
  dependencies: ProductionLivenessDependencies = {}
): CommandSuccess<ProductionLivenessData> {
  const staleMs = parseStaleSeconds(options.staleSeconds) * 1000;
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = (dependencies.now ?? Date.now)();
  const { state, problem: stateProblem } = readState(workspacePath);

  let observation: LivenessObservation;
  try {
    observation = (dependencies.readProductionActive ?? readProductionActiveFromDatabase)(workspacePath)
      ? observeProgress(workspacePath, staleMs, now)
      : { kind: "inactive" };
  } catch (error) {
    observation = { kind: "read_failed", what: "the production policy", reason: errorText(error) };
  }

  const decision = decideLiveness(state, observation);
  const message = pingMessage(decision.ping, state, observation, now, dependencies.listProcesses ?? listProcesses);
  let pingId: string | null = state.openAlert?.pingId ?? null;
  if (message !== null) {
    const base = (options.dashboardUrl || process.env["ARCADIA_DASHBOARD_URL"] || DEFAULT_DASHBOARD_URL).replace(/\/+$/, "");
    try {
      pingId = (dependencies.queuePing ?? queueThroughPing)({ workspace: workspacePath, message, kind: "attention", link: `${base}/production`, agent: "Liveness check" }).id;
    } catch (error) {
      throw validationError(`The liveness alert was not queued and will be retried on the next run: ${errorText(error)}`, { message });
    }
  }

  const openAlert = decision.openAlert === null
    ? null
    : decision.ping === null && state.openAlert
      ? state.openAlert
      : { kind: decision.openAlert, alertedAt: new Date(now).toISOString(), pingId: pingId ?? "" };
  const next: LivenessState = { schema: STATE_SCHEMA, productionActive: decision.productionActive, openAlert };
  if (stateProblem !== null || JSON.stringify(next) !== JSON.stringify(state)) writeState(workspacePath, next);
  if (stateProblem !== null) throw validationError(`The liveness state file was unreadable and has been replaced: ${stateProblem}`);
  if (decision.logOnly !== null) throw validationError(decision.logOnly, { openAlert: decision.openAlert });

  return createSuccess({
    command: "production.liveness-check",
    workspace: workspacePath,
    data: { observation, ping: decision.ping, pingId: message === null ? null : pingId, message, openAlert: decision.openAlert }
  });
}

function pingMessage(
  ping: LivenessPing | null,
  state: LivenessState,
  observation: LivenessObservation,
  now: number,
  processes: () => ProcessRow[]
): string | null {
  if (ping === "stale_alert" && observation.kind === "stale") {
    let rows: ProcessRow[] | null = null;
    try { rows = processes(); } catch { /* the alert matters more than its detail */ }
    return staleMessage(observation, rows);
  }
  if (ping === "read_failed_alert" && observation.kind === "read_failed") return readFailedMessage(observation);
  if ((ping === "recovered" || ping === "closed_by_off") && state.openAlert) {
    return closingMessage(state.openAlert.kind, ping, state.openAlert.alertedAt, now);
  }
  return null;
}

/** Quiet on a run with nothing to say: launchd keeps this output, once a minute. */
export function renderProductionLivenessCheckSuccess(response: CommandSuccess<ProductionLivenessData>): string[] {
  const { message, pingId } = response.data;
  return message === null ? [] : [`${new Date().toISOString()} queued ping ${pingId}: ${message}`];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
