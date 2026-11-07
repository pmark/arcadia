import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { ARMED_WAKE_SCHEMA, type IdleFrontRow } from "../production/idleFront.js";
import {
  KEEPER_DEFAULT_GRACE_MINUTES,
  KEEPER_DEFAULT_HEARTBEAT_MINUTES,
  KEEPER_HEARTBEAT_FILE,
  KEEPER_MAX_HEARTBEAT_MINUTES,
  KEEPER_ROLE,
  MOMENTUM_DEFAULT_IDLE_MINUTES,
  MOMENTUM_MIN_IDLE_MINUTES,
  MOMENTUM_STATE_SCHEMA,
  closingKey,
  decideSlot,
  emptyMomentumState,
  idleAlertMessage,
  idleCloseMessage,
  idleEpisodeKey,
  idleRemedy,
  idleSignal,
  keeperAlertMessage,
  keeperCloseMessage,
  keeperEpisodeKey,
  keeperSignal,
  observeIdle,
  observeKeeper,
  runWindowOf,
  type AlertSlot,
  type IdleObservation,
  type KeeperObservation,
  type MomentumWatchState,
  type RunWindow,
  type SlotTransition
} from "../production/momentumWatch.js";
import { runPingSendCommand } from "./ping.js";
import { readWakeFiles, runProductionIdleFrontCommand } from "./productionIdleFront.js";
import {
  dashboardLink,
  renderProductionLivenessCheckSuccess,
  runProductionLivenessCheckCommand,
  type LivenessPingInput,
  type ProcessRow,
  type ProductionLivenessData,
  type ProductionLivenessDependencies,
  type ProductionLivenessOptions
} from "./productionLiveness.js";

/**
 * The momentum alarm's command half (`src/production/momentumWatch.ts` holds
 * the rules). It runs inside `arcadia production liveness-check`, after the
 * worker check, on that command's existing launchd timer: no new agent, no
 * agent session, no model call. It reads what `production idle-front` reads,
 * read-only, plus the keeper's armed-until file, and writes only its own state
 * file and, on a transition, one outbox row through `arcadia ping`.
 */

const STATE_FILE = "momentum-watch.json";
const PING_AGENT = "Momentum watch";

export interface ProductionMomentumOptions {
  workspace?: string;
  idleMinutes?: number | string;
  keeperGraceMinutes?: number | string;
  dashboardUrl?: string;
  /** Default `<workspace>/.arcadia/armed-wakes`, where idle-front reads armed-until files too. */
  wakesDir?: string;
}

export interface ProductionMomentumDependencies {
  now?: () => number;
  readRow?: (workspacePath: string, now: Date, wakesDir: string) => Promise<IdleFrontRow>;
  listProcesses?: () => ProcessRow[];
  queuePing?: (input: LivenessPingInput) => { id: string };
}

export interface MomentumAlarmResult {
  ping: SlotTransition;
  pingId: string | null;
  message: string | null;
  open: boolean;
}

export interface ProductionMomentumData {
  window: RunWindow;
  idleMinutes: number | null;
  blockerClass: IdleFrontRow["blocker_class"];
  idleObservation: IdleObservation;
  keeperObservation: KeeperObservation;
  idle: MomentumAlarmResult;
  keeper: MomentumAlarmResult;
  thresholds: { idleMinutes: number; keeperGraceMinutes: number };
}

function wholeMinutes(value: number | string | undefined, fallback: number, min: number, max: number, flag: string): number {
  if (value === undefined) return fallback;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < min || minutes > max) {
    throw validationError(`${flag} must be a whole number of minutes from ${min} to ${max}.`, { [flag]: value });
  }
  return minutes;
}

export function parseIdleMinutes(value: number | string | undefined): number {
  return wholeMinutes(value, MOMENTUM_DEFAULT_IDLE_MINUTES, MOMENTUM_MIN_IDLE_MINUTES, 24 * 60, "--idle-minutes");
}

export function parseKeeperGraceMinutes(value: number | string | undefined): number {
  return wholeMinutes(value, KEEPER_DEFAULT_GRACE_MINUTES, 1, 120, "--keeper-grace-minutes");
}

function statePath(workspacePath: string): string {
  return path.join(workspacePath, ".arcadia", STATE_FILE);
}

function validSlot(value: unknown): value is AlertSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<AlertSlot>;
  if (slot.closedAt !== null && typeof slot.closedAt !== "string") return false;
  if (slot.open === null) return true;
  // A half-formed alert would read as "already paged" and silence a real one.
  const open = slot.open as Partial<NonNullable<AlertSlot["open"]>> | undefined;
  return Boolean(open) && typeof open?.pingId === "string" && open.pingId !== "" && typeof open.key === "string"
    && typeof open.alertedAt === "string" && Number.isFinite(Date.parse(open.alertedAt));
}

/** A state that cannot be read restarts both episodes: the cost is a repeated page, never a lost one. */
function readState(workspacePath: string): { state: MomentumWatchState; problem: string | null } {
  let raw: string;
  try {
    raw = readFileSync(statePath(workspacePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: emptyMomentumState(), problem: null };
    return { state: emptyMomentumState(), problem: errorText(error) };
  }
  try {
    const value = JSON.parse(raw) as Partial<MomentumWatchState>;
    if (value.schema !== MOMENTUM_STATE_SCHEMA) throw new Error("unknown schema");
    if (!validSlot(value.idle) || !validSlot(value.keeper)) throw new Error("malformed alert slot");
    return { state: { schema: MOMENTUM_STATE_SCHEMA, idle: value.idle, keeper: value.keeper }, problem: null };
  } catch (error) {
    return { state: emptyMomentumState(), problem: errorText(error) };
  }
}

function writeState(workspacePath: string, state: MomentumWatchState): void {
  const target = statePath(workspacePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
  try { renameSync(temporary, target); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}

async function readRowThroughIdleFront(workspacePath: string, now: Date, wakesDir: string, listProcesses?: () => ProcessRow[]): Promise<IdleFrontRow> {
  const response = await runProductionIdleFrontCommand({ workspace: workspacePath, wakesDir }, { now: () => now, ...(listProcesses ? { listProcesses } : {}) });
  return response.data.row;
}

function queueThroughPing(input: LivenessPingInput): { id: string } {
  return runPingSendCommand(input).data.ping;
}

/**
 * One timer run of both alarms. Each alarm is its own episode: a ping that
 * fails leaves that alarm's state as it was, so the next run retries it, while
 * the other alarm still moves on; the failure is thrown last so launchd's log
 * and the exit code carry it.
 */
export async function runProductionMomentumCheckCommand(
  options: ProductionMomentumOptions,
  dependencies: ProductionMomentumDependencies = {}
): Promise<CommandSuccess<ProductionMomentumData>> {
  const idleMinutes = parseIdleMinutes(options.idleMinutes);
  const keeperGraceMinutes = parseKeeperGraceMinutes(options.keeperGraceMinutes);
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = new Date((dependencies.now ?? Date.now)());
  const wakesDir = path.resolve(options.wakesDir ?? path.join(workspacePath, ".arcadia", "armed-wakes"));
  const { state, problem: stateProblem } = readState(workspacePath);

  const row = await (dependencies.readRow
    ? dependencies.readRow(workspacePath, now, wakesDir)
    : readRowThroughIdleFront(workspacePath, now, wakesDir, dependencies.listProcesses));
  const window = runWindowOf(row);
  const idleObservation = observeIdle(row, window, idleMinutes);
  // Expired files too: the alarm reports the newest heartbeat's age.
  const keeperObservation = observeKeeper(readWakeFiles(wakesDir).wakes, window, now, keeperGraceMinutes);

  const queue = dependencies.queuePing ?? queueThroughPing;
  const failures: string[] = [];
  const next: MomentumWatchState = { schema: MOMENTUM_STATE_SCHEMA, idle: state.idle, keeper: state.keeper };

  const step = (
    slot: AlertSlot,
    transition: SlotTransition,
    alert: () => { message: string; key: string; route: string },
    close: (open: NonNullable<AlertSlot["open"]>) => string,
    label: string
  ): { slot: AlertSlot; result: MomentumAlarmResult } => {
    if (transition === null) return { slot, result: { ping: null, pingId: null, message: null, open: slot.open !== null } };
    const outgoing = transition === "alert"
      ? alert()
      : { message: close(slot.open as NonNullable<AlertSlot["open"]>), key: closingKey((slot.open as NonNullable<AlertSlot["open"]>).pingId), route: "/production" };
    let pingId: string;
    try {
      pingId = queue({
        workspace: workspacePath,
        message: outgoing.message,
        kind: "attention",
        link: dashboardLink(options.dashboardUrl, outgoing.route),
        agent: PING_AGENT,
        episodeKey: outgoing.key,
        episodeAfter: slot.closedAt,
        now
      }).id;
    } catch (error) {
      failures.push(`The ${label} ${transition === "alert" ? "alert" : "recovery"} was not queued and will be retried on the next run: ${errorText(error)}`);
      return { slot, result: { ping: null, pingId: null, message: null, open: slot.open !== null } };
    }
    const changed: AlertSlot = transition === "alert"
      ? { open: { alertedAt: now.toISOString(), pingId, key: outgoing.key }, closedAt: slot.closedAt }
      : { open: null, closedAt: now.toISOString() };
    return { slot: changed, result: { ping: transition, pingId, message: outgoing.message, open: changed.open !== null } };
  };

  const idleStep = step(
    state.idle,
    decideSlot(state.idle, idleSignal(idleObservation)),
    () => ({ message: idleAlertMessage(row, window), key: idleEpisodeKey(row), route: idleRemedy(row).route }),
    (open) => idleCloseMessage(open, idleObservation, window, now),
    "momentum idle"
  );
  next.idle = idleStep.slot;
  const keeperStep = step(
    state.keeper,
    decideSlot(state.keeper, keeperSignal(keeperObservation)),
    () => {
      const stale = keeperObservation as Extract<KeeperObservation, { kind: "stale" }>;
      return { message: keeperAlertMessage(stale, window, now), key: keeperEpisodeKey(stale), route: "/production" };
    },
    (open) => keeperCloseMessage(open, keeperObservation, now),
    "keeper"
  );
  next.keeper = keeperStep.slot;

  if (stateProblem !== null || JSON.stringify(next) !== JSON.stringify(state)) writeState(workspacePath, next);
  if (stateProblem !== null) failures.push(`The momentum state file was unreadable and has been replaced: ${stateProblem}`);
  if (failures.length > 0) throw validationError(failures.join(" "));

  return createSuccess({
    command: "production.momentum-check",
    workspace: workspacePath,
    data: {
      window,
      idleMinutes: row.idle_minutes,
      blockerClass: row.blocker_class,
      idleObservation,
      keeperObservation,
      idle: idleStep.result,
      keeper: keeperStep.result,
      thresholds: { idleMinutes, keeperGraceMinutes }
    }
  });
}

export function renderProductionMomentumLines(data: ProductionMomentumData, stamp = new Date().toISOString()): string[] {
  return [data.idle, data.keeper]
    .filter((result) => result.message !== null)
    .map((result) => `${stamp} queued ping ${result.pingId}: ${result.message}`);
}

export interface LivenessTimerOptions extends ProductionLivenessOptions {
  idleMinutes?: number | string;
  keeperGraceMinutes?: number | string;
}

export interface LivenessTimerData extends ProductionLivenessData {
  /** null when the momentum alarm failed this run; the failure is thrown after both checks ran. */
  momentum: ProductionMomentumData | null;
}

/**
 * `arcadia production liveness-check`: the worker check first, unchanged, then
 * the momentum alarm. Neither can stop the other: a failure in either is
 * collected, and the run throws once, after both, carrying any lines the other
 * queued, so the log keeps every page and the exit code is non-zero.
 */
export async function runProductionLivenessTimerCommand(
  options: LivenessTimerOptions,
  dependencies: { liveness?: ProductionLivenessDependencies; momentum?: ProductionMomentumDependencies } = {}
): Promise<CommandSuccess<LivenessTimerData>> {
  // Refuse bad thresholds before either check runs, so a bad flag never half-runs the timer.
  parseIdleMinutes(options.idleMinutes);
  parseKeeperGraceMinutes(options.keeperGraceMinutes);
  let liveness: CommandSuccess<ProductionLivenessData> | null = null;
  const failures: string[] = [];
  let livenessError: unknown = null;
  try {
    liveness = runProductionLivenessCheckCommand(options, dependencies.liveness);
  } catch (error) {
    livenessError = error;
    failures.push(errorText(error));
  }
  let momentum: CommandSuccess<ProductionMomentumData> | null = null;
  try {
    momentum = await runProductionMomentumCheckCommand(
      { workspace: liveness?.workspace ?? options.workspace, idleMinutes: options.idleMinutes, keeperGraceMinutes: options.keeperGraceMinutes, dashboardUrl: options.dashboardUrl },
      { ...(dependencies.liveness?.now ? { now: dependencies.liveness.now } : {}), ...(dependencies.liveness?.listProcesses ? { listProcesses: dependencies.liveness.listProcesses } : {}), ...dependencies.momentum }
    );
  } catch (error) {
    failures.push(`Momentum alarm: ${errorText(error)}`);
  }
  if (failures.length > 0) {
    // The worker check's own error, unchanged, when it is the only news.
    if (livenessError !== null && failures.length === 1 && (momentum === null || renderProductionMomentumLines(momentum.data).length === 0)) {
      throw livenessError instanceof Error ? livenessError : new Error(String(livenessError));
    }
    const queued = [
      ...(liveness ? renderProductionLivenessCheckSuccess(liveness) : []),
      ...(momentum ? renderProductionMomentumLines(momentum.data) : [])
    ];
    throw validationError([...failures, ...queued].join(" | "));
  }
  const base = liveness as CommandSuccess<ProductionLivenessData>;
  return createSuccess({
    command: "production.liveness-check",
    workspace: base.workspace,
    data: { ...base.data, momentum: momentum?.data ?? null }
  });
}

/** Quiet on a run with nothing to say: launchd keeps this output, once a minute. */
export function renderProductionLivenessTimerSuccess(response: CommandSuccess<LivenessTimerData>): string[] {
  const stamp = new Date().toISOString();
  return [
    ...renderProductionLivenessCheckSuccess(response),
    ...(response.data.momentum ? renderProductionMomentumLines(response.data.momentum, stamp) : [])
  ];
}

export interface KeeperHeartbeatOptions {
  workspace?: string;
  minutes?: number | string;
  session?: string;
  wakesDir?: string;
}

export interface KeeperHeartbeatData {
  file: string;
  session: string | null;
  armedAt: string;
  armedUntil: string;
}

/**
 * `arcadia production keeper-heartbeat`: the Momentum Keeper says "I am live
 * and will wake again by armedUntil". It writes one armed-until file
 * (`arcadia-armed-wake-v1`, deferral D2) atomically and nothing else: no
 * database, no ping, no Project state. A keeper runs it at every wake with
 * `--minutes` covering its next fallback wake.
 */
export function runKeeperHeartbeatCommand(
  options: KeeperHeartbeatOptions,
  dependencies: { now?: () => number } = {}
): CommandSuccess<KeeperHeartbeatData> {
  const minutes = wholeMinutes(options.minutes, KEEPER_DEFAULT_HEARTBEAT_MINUTES, 1, KEEPER_MAX_HEARTBEAT_MINUTES, "--minutes");
  const session = options.session?.trim() ? options.session.trim().slice(0, 120) : null;
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = (dependencies.now ?? Date.now)();
  const directory = path.resolve(options.wakesDir ?? path.join(workspacePath, ".arcadia", "armed-wakes"));
  const file = path.join(directory, KEEPER_HEARTBEAT_FILE);
  const armedAt = new Date(now).toISOString();
  const armedUntil = new Date(now + minutes * 60_000).toISOString();
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ schema: ARMED_WAKE_SCHEMA, session, role: KEEPER_ROLE, armedAt, armedUntil })}\n`, "utf8");
  try { renameSync(temporary, file); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
  return createSuccess({ command: "production.keeper-heartbeat", workspace: workspacePath, data: { file, session, armedAt, armedUntil } });
}

export function renderKeeperHeartbeatSuccess(response: CommandSuccess<KeeperHeartbeatData>): string[] {
  const { armedUntil, file, session } = response.data;
  return [`Keeper heartbeat armed until ${armedUntil}${session ? ` for ${session}` : ""} (${file}). Refresh it at your next wake.`];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
