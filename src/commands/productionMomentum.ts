import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { currentCustodian } from "../coordinator/generations.js";
import { findSessionTranscript } from "../coordinator/sessionIdentity.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { ARMED_WAKE_SCHEMA, type IdleFrontRow } from "../production/idleFront.js";
import {
  CUSTODIAN_ROLE,
  DUTY_READY_FLOOR_DEFAULT,
  DUTY_READY_FLOOR_MAX,
  decideDuty,
  dutyAlertMessage,
  dutyCloseMessage,
  emptyDutySlot,
  type CustodianLiveness,
  type DutyEpisodeRecord,
  type DutyInput,
  type DutySlot
} from "../production/dutyAlarms.js";
import { readProductionPolicySafely } from "../production/policy.js";
import {
  KEEPER_DEFAULT_GRACE_MINUTES,
  KEEPER_DEFAULT_HEARTBEAT_MINUTES,
  KEEPER_HEARTBEAT_FILE,
  KEEPER_MAX_HEARTBEAT_MINUTES,
  KEEPER_ROLE,
  MOMENTUM_DEFAULT_IDLE_MINUTES,
  MOMENTUM_MIN_IDLE_MINUTES,
  MOMENTUM_CHECK_FAILING_MINUTES,
  MOMENTUM_STATE_SCHEMA,
  checkAlertMessage,
  checkCloseMessage,
  checkFailingKey,
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
import {
  renderCoordinatorBudgetCheckLines,
  runCoordinatorBudgetCheck,
  type CoordinatorBudgetCheckData,
  type CoordinatorBudgetDependencies
} from "./coordinatorBudget.js";
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
/** Duty pings name their own agent, so the operator can tell a duty page from an idle or keeper page. */
const DUTY_PING_AGENT = "Duty alarm";

export interface ProductionMomentumOptions {
  workspace?: string;
  idleMinutes?: number | string;
  keeperGraceMinutes?: number | string;
  readyFloor?: number | string;
  /** `--duty-off-alarm`: page Off with nothing eligible. Off by default, so a quiet night pages nobody. */
  dutyOffAlarm?: boolean;
  dashboardUrl?: string;
  /** Default `<workspace>/.arcadia/armed-wakes`, where idle-front reads armed-until files too. */
  wakesDir?: string;
}

export interface ProductionMomentumDependencies {
  now?: () => number;
  readRow?: (workspacePath: string, now: Date, wakesDir: string) => Promise<IdleFrontRow>;
  listProcesses?: () => ProcessRow[];
  queuePing?: (input: LivenessPingInput) => { id: string };
  /** Test seam: the custodian's liveness; defaults to the coordinator's own transcript signal. */
  readCustodian?: (workspacePath: string) => CustodianLiveness;
}

/** The momentum state plus the duty slot; a state file written before duty alarms reads as an empty duty slot. */
type MomentumState = MomentumWatchState & { duty: DutySlot };

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
  check: MomentumAlarmResult;
  /** The duty alarm (no custodian, Off with nothing eligible, ready below the floor); one episode at a time. */
  duty: MomentumAlarmResult;
  thresholds: { idleMinutes: number; keeperGraceMinutes: number; readyFloor: number };
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

export function parseReadyFloor(value: number | string | undefined): number {
  return wholeMinutes(value, DUTY_READY_FLOOR_DEFAULT, 1, DUTY_READY_FLOOR_MAX, "--ready-floor");
}

/**
 * Custodian liveness from the coordinator's own signal: the newest write to the
 * current `rowan` custodian's transcript, the same test `coordinator` uses for a
 * live Session. Read-only. Any failure is unknown, never silent.
 */
export function readCustodianLiveness(workspacePath: string, projectsDirectory = path.join(homedir(), ".claude", "projects")): CustodianLiveness {
  try {
    return withReadOnlyDatabase(workspacePath, (db) => {
      const read = readProductionPolicySafely(db);
      if (read.status !== "ok") return { readable: false, lastLiveAt: null, reason: read.reason };
      let newest: number | null = null;
      for (const project of read.policy.scope?.projects ?? []) {
        const custodian = currentCustodian(db, project, CUSTODIAN_ROLE);
        if (!custodian?.nativeSessionId) continue;
        const transcript = findSessionTranscript(projectsDirectory, custodian.nativeSessionId);
        if (transcript === null) continue;
        const modified = statSync(transcript).mtimeMs;
        if (newest === null || modified > newest) newest = modified;
      }
      return { readable: true, lastLiveAt: newest, reason: null };
    });
  } catch (error) {
    return { readable: false, lastLiveAt: null, reason: errorText(error) };
  }
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

function emptyState(): MomentumState {
  return { ...emptyMomentumState(), duty: emptyDutySlot() };
}

function validAdmissions(value: unknown): value is NonNullable<DutySlot["admissions"]> {
  const admissions = value as Partial<NonNullable<DutySlot["admissions"]>> | null | undefined;
  return !!admissions && typeof admissions.count === "number" && typeof admissions.changedAt === "string" && Number.isFinite(Date.parse(admissions.changedAt));
}

function validDuty(value: unknown): value is DutySlot {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const slot = value as Partial<DutySlot>;
  if (slot.closedAt !== null && slot.closedAt !== undefined && typeof slot.closedAt !== "string") return false;
  if (slot.open === null || slot.open === undefined) return true;
  const open = slot.open as Partial<DutyEpisodeRecord>;
  return typeof open.cause === "string" && Array.isArray(open.contributing) && typeof open.key === "string"
    && typeof open.startedAt === "string" && Number.isFinite(Date.parse(open.startedAt))
    && typeof open.owner === "string" && typeof open.nextEvent === "string";
}

/** A state that cannot be read restarts every episode: the cost is a repeated page, never a lost one. */
function readState(workspacePath: string): { state: MomentumState; problem: string | null } {
  let raw: string;
  try {
    raw = readFileSync(statePath(workspacePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: emptyState(), problem: null };
    return { state: emptyState(), problem: errorText(error) };
  }
  try {
    const value = JSON.parse(raw) as Partial<MomentumState>;
    if (value.schema !== MOMENTUM_STATE_SCHEMA) throw new Error("unknown schema");
    if (!validSlot(value.idle) || !validSlot(value.keeper) || !validSlot(value.check)) throw new Error("malformed alert slot");
    if (!validDuty(value.duty)) throw new Error("malformed duty slot");
    const since = value.checkFailingSince ?? null;
    if (since !== null && !(typeof since === "string" && Number.isFinite(Date.parse(since)))) throw new Error("malformed checkFailingSince");
    const duty: DutySlot = value.duty
      ? { open: value.duty.open ?? null, closedAt: value.duty.closedAt ?? null, admissions: validAdmissions(value.duty.admissions) ? value.duty.admissions : null }
      : emptyDutySlot();
    return { state: { schema: MOMENTUM_STATE_SCHEMA, idle: value.idle, keeper: value.keeper, check: value.check, checkFailingSince: since, duty }, problem: null };
  } catch (error) {
    return { state: emptyState(), problem: errorText(error) };
  }
}

function writeState(workspacePath: string, state: MomentumState): void {
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
  const readyFloor = parseReadyFloor(options.readyFloor);
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = new Date((dependencies.now ?? Date.now)());
  const wakesDir = path.resolve(options.wakesDir ?? path.join(workspacePath, ".arcadia", "armed-wakes"));
  const { state, problem: stateProblem } = readState(workspacePath);

  let row: IdleFrontRow | null = null;
  let readProblem: string | null = null;
  try {
    row = await (dependencies.readRow
      ? dependencies.readRow(workspacePath, now, wakesDir)
      : readRowThroughIdleFront(workspacePath, now, wakesDir, dependencies.listProcesses));
  } catch (error) {
    readProblem = errorText(error);
  }

  const queue = dependencies.queuePing ?? queueThroughPing;
  const failures: string[] = [];
  const next: MomentumState = { ...state };

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

  // The alarm's own blindness pages after an unbroken stretch of failed reads, and closes on the first good one.
  const failingSince = readProblem === null ? null : state.checkFailingSince ?? now.toISOString();
  next.checkFailingSince = failingSince;
  const blindFor = failingSince === null ? 0 : now.getTime() - Date.parse(failingSince);
  const checkStep = step(
    state.check,
    decideSlot(state.check, readProblem === null ? "clear" : blindFor >= MOMENTUM_CHECK_FAILING_MINUTES * 60_000 ? "alarm" : "hold"),
    () => ({ message: checkAlertMessage(failingSince as string, readProblem as string, now), key: checkFailingKey(failingSince as string), route: "/production" }),
    (open) => checkCloseMessage(open, now),
    "momentum check"
  );
  next.check = checkStep.slot;
  if (row === null) {
    writeState(workspacePath, next);
    failures.push(`The momentum check could not read the critical path, so the idle and keeper alarms held: ${readProblem}`);
    if (stateProblem !== null) failures.push(`The momentum state file was unreadable and has been replaced: ${stateProblem}`);
    throw validationError([...failures, ...(checkStep.result.message ? [`queued ping ${checkStep.result.pingId}: ${checkStep.result.message}`] : [])].join(" "));
  }
  const readRow = row;
  const window = runWindowOf(readRow);
  const idleObservation = observeIdle(readRow, window, idleMinutes);
  // Expired files too: the alarm reports the newest heartbeat's age.
  const keeperObservation = observeKeeper(readWakeFiles(wakesDir).wakes, window, now, keeperGraceMinutes);

  const idleStep = step(
    state.idle,
    decideSlot(state.idle, idleSignal(idleObservation)),
    () => ({ message: idleAlertMessage(readRow, window), key: idleEpisodeKey(readRow), route: idleRemedy(readRow).route }),
    (open) => idleCloseMessage(open, idleObservation, window, now),
    "momentum idle"
  );
  next.idle = idleStep.slot;
  const keeperStep = step(
    state.keeper,
    decideSlot(state.keeper, keeperSignal(keeperObservation)),
    () => {
      const stale = keeperObservation as Extract<KeeperObservation, { kind: "stale" }>;
      return { message: keeperAlertMessage(stale, window, now), key: keeperEpisodeKey(stale, now), route: "/production" };
    },
    (open) => keeperCloseMessage(open, keeperObservation, now),
    "keeper"
  );
  next.keeper = keeperStep.slot;

  // The duty alarm: one open episode per root condition, paged on open and once on close. Its
  // own state and outbox key, but the same queue, state file and failure handling as the other alarms.
  const dutyPrior = state.duty.open;
  const custodian = (dependencies.readCustodian ?? readCustodianLiveness)(workspacePath);
  const liveAdmissions = readRow.critical_path.live_admissions;
  // When the live-admission set last changed: the healthy window is capped from there (HEALTHY_MAX_SILENCE_MINUTES).
  const admissions = state.duty.admissions && state.duty.admissions.count === liveAdmissions
    ? state.duty.admissions
    : { count: liveAdmissions, changedAt: now.toISOString() };
  const duty = decideDuty(dutyPrior, {
    now: now.getTime(),
    readyCount: readRow.ready_actions,
    floor: readyFloor,
    production: readRow.critical_path.state === "unreadable" || readRow.critical_path.desired_state === null
      ? "unknown"
      : readRow.critical_path.desired_state === "active" ? "active" : "off",
    eligibleCount: readRow.ready_actions,
    offNothingAlarm: options.dutyOffAlarm === true,
    custodian,
    running: {
      count: liveAdmissions,
      // The read model has no per-Action activity clock; "moving with admissions" is the signal, capped by the change time.
      lastActivityAt: readRow.critical_path.state === "moving" && liveAdmissions > 0 ? Date.parse(admissions.changedAt) : null
    }
  } satisfies DutyInput);
  let dutyResult: MomentumAlarmResult = { ping: null, pingId: null, message: null, open: dutyPrior !== null };
  let nextDuty: DutySlot = { open: duty.next, closedAt: state.duty.closedAt, admissions };
  if (duty.transition === "open" || duty.transition === "close") {
    const priorPingId = dutyPrior?.delivery?.pingId ?? "unqueued";
    const opening = duty.next as DutyEpisodeRecord;
    const message = duty.transition === "open" ? dutyAlertMessage(opening, now) : dutyCloseMessage(dutyPrior as DutyEpisodeRecord, priorPingId, now);
    if (duty.transition === "open") {
      // The episode is written before its page is queued. If the queue succeeds and a later write fails, the next
      // run finds it undelivered and queues it again under the same key, which the outbox dedupes.
      writeState(workspacePath, { ...next, duty: { open: opening, closedAt: state.duty.closedAt, admissions } });
    }
    try {
      const pingId = queue({
        workspace: workspacePath,
        message,
        kind: "attention",
        link: dashboardLink(options.dashboardUrl, "/production"),
        agent: DUTY_PING_AGENT,
        episodeKey: duty.transition === "open" ? opening.key : closingKey(priorPingId),
        episodeAfter: state.duty.closedAt,
        now
      }).id;
      nextDuty = duty.transition === "open"
        ? { open: { ...opening, delivery: { pingId, queuedAt: now.toISOString() } }, closedAt: state.duty.closedAt, admissions }
        : { open: null, closedAt: now.toISOString(), admissions };
      dutyResult = { ping: duty.transition === "open" ? "alert" : "close", pingId, message, open: nextDuty.open !== null };
    } catch (error) {
      // A failed open keeps the recorded, undelivered episode, so the next run re-queues it under the same key;
      // a failed close keeps the open episode, so the next run retries the close.
      nextDuty = { open: duty.transition === "open" ? opening : dutyPrior, closedAt: state.duty.closedAt, admissions };
      failures.push(`The duty ${duty.transition === "open" ? "alarm" : "recovery"} was not queued and will be retried on the next run: ${errorText(error)}`);
    }
  }
  next.duty = nextDuty;

  if (stateProblem !== null || JSON.stringify(next) !== JSON.stringify(state)) writeState(workspacePath, next);
  if (stateProblem !== null) failures.push(`The momentum state file was unreadable and has been replaced: ${stateProblem}`);
  if (failures.length > 0) throw validationError(failures.join(" "));

  return createSuccess({
    command: "production.momentum-check",
    workspace: workspacePath,
    data: {
      window,
      idleMinutes: readRow.idle_minutes,
      blockerClass: readRow.blocker_class,
      idleObservation,
      keeperObservation,
      idle: idleStep.result,
      keeper: keeperStep.result,
      check: checkStep.result,
      duty: dutyResult,
      thresholds: { idleMinutes, keeperGraceMinutes, readyFloor }
    }
  });
}

export function renderProductionMomentumLines(data: ProductionMomentumData, stamp = new Date().toISOString()): string[] {
  return [data.check, data.idle, data.keeper, data.duty]
    .filter((result) => result.message !== null)
    .map((result) => `${stamp} queued ping ${result.pingId}: ${result.message}`);
}

export interface LivenessTimerOptions extends ProductionLivenessOptions {
  idleMinutes?: number | string;
  keeperGraceMinutes?: number | string;
  readyFloor?: number | string;
  dutyOffAlarm?: boolean;
}

export interface LivenessTimerData extends ProductionLivenessData {
  /** null when the momentum alarm failed this run; the failure is thrown after every check ran. */
  momentum: ProductionMomentumData | null;
  /** The coordinator context budget (#2242); null when it failed this run. */
  coordinatorBudget: CoordinatorBudgetCheckData | null;
}

/**
 * `arcadia production liveness-check`: the worker check first, unchanged, then
 * the momentum alarm, then the coordinator context budget (#2242). None can
 * stop another: a failure in any is collected, and the run throws once, after
 * all three, carrying any lines the others queued, so the log keeps every page
 * and the exit code is non-zero.
 */
export async function runProductionLivenessTimerCommand(
  options: LivenessTimerOptions,
  dependencies: { liveness?: ProductionLivenessDependencies; momentum?: ProductionMomentumDependencies; budget?: CoordinatorBudgetDependencies } = {}
): Promise<CommandSuccess<LivenessTimerData>> {
  // Refuse bad thresholds before either check runs, so a bad flag never half-runs the timer.
  parseIdleMinutes(options.idleMinutes);
  parseKeeperGraceMinutes(options.keeperGraceMinutes);
  parseReadyFloor(options.readyFloor);
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
      { workspace: liveness?.workspace ?? options.workspace, idleMinutes: options.idleMinutes, keeperGraceMinutes: options.keeperGraceMinutes, readyFloor: options.readyFloor, dutyOffAlarm: options.dutyOffAlarm, dashboardUrl: options.dashboardUrl },
      { ...(dependencies.liveness?.now ? { now: dependencies.liveness.now } : {}), ...(dependencies.liveness?.listProcesses ? { listProcesses: dependencies.liveness.listProcesses } : {}), ...dependencies.momentum }
    );
  } catch (error) {
    failures.push(`Momentum alarm: ${errorText(error)}`);
  }
  let budget: CommandSuccess<CoordinatorBudgetCheckData> | null = null;
  try {
    budget = runCoordinatorBudgetCheck(
      { workspace: liveness?.workspace ?? options.workspace, dashboardUrl: options.dashboardUrl },
      { ...(dependencies.liveness?.now ? { now: dependencies.liveness.now } : {}), ...dependencies.budget }
    );
  } catch (error) {
    failures.push(`Coordinator budget: ${errorText(error)}`);
  }
  if (failures.length > 0) {
    // The worker check's own error, unchanged, when it is the only news.
    if (livenessError !== null && failures.length === 1
      && (momentum === null || renderProductionMomentumLines(momentum.data).length === 0)
      && (budget === null || renderCoordinatorBudgetCheckLines(budget.data).length === 0)) {
      throw livenessError instanceof Error ? livenessError : new Error(String(livenessError));
    }
    const queued = [
      ...(liveness ? renderProductionLivenessCheckSuccess(liveness) : []),
      ...(momentum ? renderProductionMomentumLines(momentum.data) : []),
      ...(budget ? renderCoordinatorBudgetCheckLines(budget.data) : [])
    ];
    throw validationError([...failures, ...queued].join(" | "));
  }
  const base = liveness as CommandSuccess<ProductionLivenessData>;
  return createSuccess({
    command: "production.liveness-check",
    workspace: base.workspace,
    data: { ...base.data, momentum: momentum?.data ?? null, coordinatorBudget: budget?.data ?? null }
  });
}

/** Quiet on a run with nothing to say: launchd keeps this output, once a minute. */
export function renderProductionLivenessTimerSuccess(response: CommandSuccess<LivenessTimerData>): string[] {
  const stamp = new Date().toISOString();
  return [
    ...renderProductionLivenessCheckSuccess(response),
    ...(response.data.momentum ? renderProductionMomentumLines(response.data.momentum, stamp) : []),
    ...(response.data.coordinatorBudget ? renderCoordinatorBudgetCheckLines(response.data.coordinatorBudget, stamp) : [])
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
 * (`arcadia-armed-wake-v1`, deferral D2) atomically: no
 * ping and no Project state (the CLI records its usual activity row). A keeper runs it at every wake with
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
