import { blockerRemedyFor } from "./blockerRemedies.js";
import { normalizeTime, timelineEvent, type TimelineEvent } from "../timeline/schema.js";

/**
 * Momentum Keeper Layer 1: the read-only idle-front check.
 *
 * One deterministic row per check that says whether the unattended-production
 * critical path is moving and, when it is not, how many minutes it has been
 * idle by cause. Pure: every input is passed in, and nothing here reads a
 * clock, a file, a process or a database. The thin command
 * (`src/commands/productionIdleFront.ts`) gathers the inputs from the existing
 * readers (`arcadia production status`'s data, the worker-merge rows, the
 * timeline's production and ping collectors, the process list and the
 * armed-wake files of deferral D2 in `docs/design/session-notifications.md`).
 *
 * The primary measure is critical-path idle minutes. Only critical-path
 * records feed it: a side front (a review, a helper's commit, an Ask) is never
 * an input, so it can never offset idle time.
 *
 * Idle time runs from `blocked_since` to the check and is split so the parts
 * always sum to the whole:
 *
 * - from `tap_ready` on: **waiting on the operator** (a ready one-tap item is
 *   in front of them);
 * - before the first detection evidence recorded strictly after the block
 *   began (an operator-granted policy receipt, or a ping naming a scope Action
 *   or production): **detection lag**;
 * - the rest: **no ready work** when the scope has nothing left to run, else
 *   **no route** (somebody knows, but no tap is ready yet). With no known
 *   scope the rest has no honest cause, so the split is null.
 *
 * One operator-bound blocker on any scope Action marks the whole path
 * blocked, even while another scope Action is admitted: production runs the
 * scope serially, so a stopped Action holds the path.
 *
 * It grants nothing, pings nobody and writes nothing.
 */

export const IDLE_FRONT_ROW_SCHEMA = "arcadia-idle-front-row-v1" as const;
/** The armed-until heartbeat a waiter may write (deferral D2). This module only reads it. */
export const ARMED_WAKE_SCHEMA = "arcadia-armed-wake-v1" as const;
/**
 * A tick releases one admission and issues the next within about a minute;
 * the longest silence between ticks in the Active windows of 2026-11-02 to 05
 * was 194s (`src/commands/productionLiveness.ts`). Inside this grace an Active
 * run with nothing admitted still reads as moving.
 */
export const ACTIVE_IDLE_GRACE_MS = 5 * 60_000;
/**
 * The longest wait anyone arms today is 6 h (`wait-for-event.sh pr`, Signal's
 * night handoff); `timeline --wait` defaults to 110 minutes. An armed-until
 * further ahead than this is not believed.
 */
export const MAX_ARMED_HORIZON_MS = 6 * 3_600_000;

export type CriticalPathState = "moving" | "blocked" | "inactive" | "unreadable";
export type BlockerClass = "none" | "no_route" | "waiting_on_operator" | "no_ready_work" | "unknown" | "unreadable";
export type IdleCause = "detection_lag" | "no_route" | "waiting_on_operator" | "no_ready_work";
export type IdleMinutesByCause = Record<IdleCause, number>;

export interface IdleFrontBlocker {
  source: "escalation" | "red_alert" | "launch_blocker";
  /** Action key, or the Project for a Project-wide launch blocker. */
  key: string;
  kind: string;
  since: string;
  /** False only when the remedy registry says the worker resolves it itself. */
  operatorBound: boolean;
  /** True when the registry gives it a one-click clear: a tap is ready from `since`. */
  tapReady: boolean;
}

export interface ArmedWake {
  session: string | null;
  role: string | null;
  armedAt: string | null;
  /** null for a running waiter process: armed while it runs. */
  armedUntil: string | null;
  source: "heartbeat-file" | "process";
  evidence: string;
}

export interface IdleFrontInput {
  now: Date;
  production: {
    readable: boolean;
    reason: string | null;
    desiredState: "active" | "inactive" | null;
    revision: number | null;
    epoch: number | null;
    policyUpdatedAt: string | null;
    liveAdmissions: number;
    label: string;
  };
  /** The active scope's Actions, or the retained configuration's while Inactive. */
  scopeActions: string[];
  /** Action keys the worker has merged. */
  mergedActions: string[];
  /** When the critical path last moved: merges, admission stages, an activation. */
  movements: string[];
  blockers: IdleFrontBlocker[];
  /** Records showing someone learned of the path's state: pings and policy changes. */
  detections: Array<{ at: string; evidence: string }>;
  wakes: ArmedWake[];
  /** Sessions or roles that should hold an armed wake. */
  expectWakes: string[];
  /** False when the process list could not be read; default true. */
  processesReadable?: boolean;
  /** Caller-supplied times for what no reader here can see yet (a published START card). */
  hints: { tapReadyAt?: string; routeAt?: string };
}

export interface IdleFrontRow {
  schema: typeof IDLE_FRONT_ROW_SCHEMA;
  ts: string;
  critical_path: {
    state: CriticalPathState;
    label: string;
    desired_state: "active" | "inactive" | null;
    revision: number | null;
    epoch: number | null;
    live_admissions: number;
  };
  blocker_class: BlockerClass;
  blocked_since: string | null;
  detected_at: string | null;
  route_at: string | null;
  tap_ready: string | null;
  /** Scope Actions not yet merged; null when no scope is known. */
  ready_actions: number | null;
  blockers: IdleFrontBlocker[];
  /** null when the state could not be read: never a false zero. */
  idle_minutes: number | null;
  idle_minutes_by_cause: IdleMinutesByCause | null;
  armed_wakes: ArmedWake[];
  /** null when the process list was unreadable and no heartbeat file is live: unknown, never a false healthy. */
  no_armed_wake: boolean | null;
  missing_wakes: string[];
  notes: string[];
}

const ZERO: IdleMinutesByCause = Object.freeze({ detection_lag: 0, no_route: 0, waiting_on_operator: 0, no_ready_work: 0 });

function ms(time: string | null | undefined): number | null {
  if (!time) return null;
  const value = Date.parse(time);
  return Number.isFinite(value) ? value : null;
}

/** Whole tenths of a minute, so the parts of a split sum exactly to the total. */
function tenths(span: number): number {
  return Math.round(Math.max(0, span) / 6_000);
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function liveWakes(wakes: ArmedWake[], now: number, notes: string[]): ArmedWake[] {
  return wakes.filter((wake) => {
    if (wake.source === "process") return true;
    const until = ms(wake.armedUntil);
    if (until !== null && until > now + MAX_ARMED_HORIZON_MS) {
      notes.push(`${wake.evidence}: armedUntil ${wake.armedUntil} is beyond the ${MAX_ARMED_HORIZON_MS / 3_600_000} h horizon; ignored.`);
      return false;
    }
    return until !== null && until > now;
  });
}

export function classifyIdleFront(input: IdleFrontInput): IdleFrontRow {
  const now = input.now.getTime();
  const { production } = input;
  const notes: string[] = [];
  const armed = liveWakes(input.wakes, now, notes);
  const missing = input.expectWakes.filter((name) => !armed.some((wake) => wake.session === name || wake.role === name));
  const merged = new Set(input.mergedActions);
  const ready = input.scopeActions.length > 0 ? input.scopeActions.filter((action) => !merged.has(action)).length : null;
  const processesReadable = input.processesReadable !== false;
  if (!processesReadable) notes.push("The process list could not be read; running waiters are unknown.");
  const base = {
    schema: IDLE_FRONT_ROW_SCHEMA,
    ts: input.now.toISOString(),
    critical_path: {
      state: "moving" as CriticalPathState,
      label: production.label,
      desired_state: production.desiredState,
      revision: production.revision,
      epoch: production.epoch,
      live_admissions: production.liveAdmissions
    },
    ready_actions: ready,
    blockers: input.blockers,
    armed_wakes: armed,
    no_armed_wake: armed.length > 0 ? false : processesReadable ? true : null,
    missing_wakes: missing,
    notes
  };
  const routeHint = ms(input.hints.routeAt);

  if (!production.readable) {
    notes.push(`Production state unreadable${production.reason ? `: ${production.reason}` : ""}. This is not all clear.`);
    return { ...base, critical_path: { ...base.critical_path, state: "unreadable" }, blocker_class: "unreadable", blocked_since: null, detected_at: null, route_at: null, tap_ready: null, idle_minutes: null, idle_minutes_by_cause: null };
  }

  const operatorBlockers = input.blockers.filter((blocker) => blocker.operatorBound);
  const active = production.desiredState === "active";
  const lastMovement = input.movements.map(ms).filter((value): value is number => value !== null && value <= now).reduce<number | null>((max, value) => (max === null || value > max ? value : max), null);

  const state: CriticalPathState = active ? "blocked" : "inactive";
  const unmeasured = (note: string): IdleFrontRow => {
    notes.push(note);
    return { ...base, critical_path: { ...base.critical_path, state }, blocker_class: operatorBlockers.length > 0 ? "no_route" : "unknown", blocked_since: null, detected_at: null, route_at: iso(routeHint), tap_ready: null, idle_minutes: null, idle_minutes_by_cause: null };
  };

  let blockedSince: number;
  let tapReady: number | null = ms(input.hints.tapReadyAt);
  if (operatorBlockers.length > 0) {
    const sinces = operatorBlockers.map((blocker) => ms(blocker.since));
    if (sinces.some((since) => since === null)) return unmeasured("A blocker's start time is unreadable; idle minutes are unknown, not zero.");
    blockedSince = Math.min(...sinces.map((since) => since ?? now));
    for (const blocker of operatorBlockers) {
      const since = ms(blocker.since);
      if (blocker.tapReady && since !== null && (tapReady === null || since < tapReady)) tapReady = since;
    }
  } else if (active && production.liveAdmissions > 0) {
    return { ...base, blocker_class: "none", blocked_since: null, detected_at: null, route_at: iso(routeHint), tap_ready: null, idle_minutes: 0, idle_minutes_by_cause: { ...ZERO } };
  } else {
    if (lastMovement === null) return unmeasured("No movement record found (no merge, admission or activation); idle minutes are unknown, not zero.");
    blockedSince = lastMovement;
    if (active && now - blockedSince < ACTIVE_IDLE_GRACE_MS) {
      notes.push("Active with nothing admitted, inside the between-ticks grace.");
      return { ...base, blocker_class: "none", blocked_since: null, detected_at: null, route_at: iso(routeHint), tap_ready: null, idle_minutes: 0, idle_minutes_by_cause: { ...ZERO } };
    }
  }

  // Strictly after: the record that set blocked_since (an activation's own receipt) is not someone noticing the stall.
  const detected = input.detections.map((detection) => ms(detection.at)).filter((value): value is number => value !== null && value > blockedSince && value <= now).reduce<number | null>((min, value) => (min === null || value < min ? value : min), null);
  const tap = tapReady === null ? null : Math.min(now, Math.max(blockedSince, tapReady));
  const lagEnd = Math.min(detected ?? now, tap ?? now);
  const restEnd = tap ?? now;
  const scopeUnknown = ready === null && operatorBlockers.length === 0;
  const noReadyWork = ready === 0 && operatorBlockers.length === 0;
  const lag = tenths(lagEnd - blockedSince);
  const rest = tenths(restEnd - lagEnd);
  const operator = tap === null ? 0 : tenths(now - tap);
  const blockerClass: BlockerClass = tap !== null ? "waiting_on_operator" : scopeUnknown ? "unknown" : noReadyWork ? "no_ready_work" : "no_route";
  if (scopeUnknown) notes.push("No scope is known (none active, none retained); the cause split is unknown.");
  return {
    ...base,
    critical_path: { ...base.critical_path, state },
    blocker_class: blockerClass,
    blocked_since: iso(blockedSince),
    detected_at: iso(detected),
    route_at: iso(routeHint ?? tap),
    tap_ready: iso(tap),
    idle_minutes: (lag + rest + operator) / 10,
    idle_minutes_by_cause: scopeUnknown
      ? null
      : { detection_lag: lag / 10, no_route: noReadyWork ? 0 : rest / 10, waiting_on_operator: operator / 10, no_ready_work: noReadyWork ? rest / 10 : 0 }
  };
}

/** The slice of `ProductionStatusData` (src/commands/production.ts) this check reads. */
export interface IdleFrontStatusView {
  read:
    | { status: "ok"; policy: { desiredState: string; revision: number; epoch: number; updatedAt: string; scope: { actions: string[] } | null } }
    | { status: "unavailable"; reason: string };
  display: { label: string };
  liveAdmissions: number;
  admissions: Array<{ issuedAt: string | null; committedAt: string | null; releasedAt: string | null }>;
  operatorEscalations: Array<{ actionKey: string; kind: string; firstDetectedAt: string }>;
  redAlerts: Array<{ actionKey: string | null; projectSlug: string; trigger: string; firstSeenAt: string }>;
  launchBlockers: Array<{ projectSlug: string; code: string; actionKey: string | null; observedAt: string }>;
  inactiveConfiguration: { scope: { actions: string[] } } | null;
}

export interface IdleFrontExtras {
  now: Date;
  merges: Array<{ action_key: string; outcome: string; updated_at: string }>;
  detections?: IdleFrontInput["detections"];
  wakes?: ArmedWake[];
  expectWakes?: string[];
  hints?: IdleFrontInput["hints"];
}

function blockerFor(source: IdleFrontBlocker["source"], key: string, kind: string, since: string): IdleFrontBlocker {
  const remedy = blockerRemedyFor(kind);
  // An unregistered kind counts as the operator's: an unknown stop is never read as self-resolving.
  return { source, key, kind, since, operatorBound: remedy?.remedyActionId !== "worker-resolves", tapReady: remedy?.oneClick === true };
}

/** Maps the existing production status read onto the classifier's input. Pure. */
export function idleFrontInputFromStatus(status: IdleFrontStatusView, extras: IdleFrontExtras): IdleFrontInput {
  const policy = status.read.status === "ok" ? status.read.policy : null;
  const active = policy?.desiredState === "active";
  const movements: string[] = [];
  // Activation moves the path; an Off does not, so an Inactive gap runs from the last real progress.
  if (policy && active) movements.push(policy.updatedAt);
  for (const admission of status.admissions) {
    for (const time of [admission.issuedAt, admission.committedAt, admission.releasedAt]) if (time) movements.push(time);
  }
  const mergedActions: string[] = [];
  for (const merge of extras.merges) {
    if (merge.outcome !== "merged") continue;
    movements.push(merge.updated_at);
    if (!mergedActions.includes(merge.action_key)) mergedActions.push(merge.action_key);
  }
  const scopeActions = policy?.scope?.actions ?? status.inactiveConfiguration?.scope.actions ?? [];
  // Only the scope is the critical path: a stale escalation on another Plan's Action never blocks it.
  const inScope = new Set([...scopeActions, ...scopeActions.map((action) => action.split("/")[0] ?? action)]);
  const blockers: IdleFrontBlocker[] = [
    ...status.operatorEscalations.map((row) => blockerFor("escalation", row.actionKey, row.kind, row.firstDetectedAt)),
    ...status.redAlerts.map((row) => blockerFor("red_alert", row.actionKey ?? row.projectSlug, row.trigger, row.firstSeenAt)),
    ...status.launchBlockers.map((row) => blockerFor("launch_blocker", row.actionKey ?? row.projectSlug, row.code, row.observedAt))
  ].filter((blocker) => inScope.has(blocker.key));
  return {
    now: extras.now,
    production: {
      readable: policy !== null,
      reason: status.read.status === "ok" ? null : status.read.reason,
      desiredState: policy ? (active ? "active" : "inactive") : null,
      revision: policy?.revision ?? null,
      epoch: policy?.epoch ?? null,
      policyUpdatedAt: policy?.updatedAt ?? null,
      liveAdmissions: status.liveAdmissions,
      label: status.display.label
    },
    scopeActions,
    mergedActions,
    movements,
    blockers,
    detections: extras.detections ?? [],
    wakes: extras.wakes ?? [],
    expectWakes: extras.expectWakes ?? [],
    hints: extras.hints ?? {}
  };
}

/** Waiter scripts that exist today: the session-notifications waiter, Signal's quiet watch and the Issue watcher. */
const WAITER_SCRIPTS = new Set(["wait-for-event.sh", "quiet-watch.sh", "comms-watch-issue.mjs"]);
const INTERPRETERS = new Set(["bash", "sh", "zsh", "node"]);

function basename(token: string): string {
  return token.slice(token.lastIndexOf("/") + 1);
}

/**
 * Whether one `ps` command line is a running waiter. Anchored on argv, not a
 * substring: the program is an interpreter running a waiter script (or the
 * script itself), or Arcadia's CLI running `timeline --wait`. An editor or
 * pager on a script, a `-c` wrapper, and a `timeline --wait` naming another
 * `--workspace` are not this workspace's armed wake.
 */
function isWaiter(command: string, workspacePath: string | null): boolean {
  const argv = command.trim().split(/\s+/);
  const program = basename(argv[0] ?? "");
  if (WAITER_SCRIPTS.has(program)) return true;
  if (!INTERPRETERS.has(program) && program !== "arcadia") return false;
  if (argv.includes("-c") || argv.includes("-e") || argv.includes("--eval")) return false;
  const script = argv.slice(1).find((token) => !token.startsWith("-"));
  if (program !== "arcadia" && script && WAITER_SCRIPTS.has(basename(script))) return true;
  const timeline = argv.indexOf("timeline");
  if (timeline < 0 || !argv.slice(timeline + 1).includes("--wait")) return false;
  if (program !== "arcadia" && !argv.slice(1, timeline).some((token) => /(^|\/)(cli\.(js|ts)|arcadia)$/.test(token))) return false;
  const flag = argv.indexOf("--workspace", timeline);
  const named = flag >= 0 ? argv[flag + 1] : undefined;
  return !named || workspacePath === null || named.replace(/\/+$/, "") === workspacePath.replace(/\/+$/, "");
}

export function wakesFromProcesses(rows: Array<{ pid: number; command: string }>, workspacePath: string | null = null): ArmedWake[] {
  return rows
    .filter((row) => isWaiter(row.command, workspacePath))
    .map((row) => ({ session: null, role: null, armedAt: null, armedUntil: null, source: "process" as const, evidence: `pid ${row.pid}: ${row.command.slice(0, 160)}` }));
}

/**
 * Detection evidence from timeline events, critical-path records only: a
 * policy receipt the operator granted (an automated Terminal Off has no
 * grantor and detects nothing), and a ping whose text names a scope Action or
 * production. Any other ping is a side front and cannot end detection lag.
 */
export function detectionsFromTimeline(events: TimelineEvent[], scopeActions: string[]): IdleFrontInput["detections"] {
  const names = scopeActions.flatMap((action) => [action, action.slice(action.indexOf("/") + 1)]).filter(Boolean);
  return events
    .filter((event) => {
      if (event.kind.startsWith("production.policy.")) return event.actor.tool === "operator";
      if (event.kind !== "ping.created") return false;
      return /\bproduction\b/i.test(event.summary) || names.some((name) => event.summary.includes(name));
    })
    .map((event) => ({ at: event.time, evidence: event.evidence[0]?.value ?? event.id }));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reads one armed-until heartbeat file. The file is data written by a waiter, never an instruction. */
export function parseArmedWakeFile(name: string, content: string): { ok: true; wake: ArmedWake } | { ok: false; problem: string } {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { ok: false, problem: `${name}: not JSON` };
  }
  if (!value || typeof value !== "object" || value.schema !== ARMED_WAKE_SCHEMA) return { ok: false, problem: `${name}: schema is not ${ARMED_WAKE_SCHEMA}` };
  const armedUntil = normalizeTime(text(value.armedUntil));
  if (!armedUntil) return { ok: false, problem: `${name}: armedUntil is not a time` };
  return {
    ok: true,
    wake: { session: text(value.session), role: text(value.role), armedAt: normalizeTime(text(value.armedAt)), armedUntil, source: "heartbeat-file", evidence: name }
  };
}

/**
 * The row as timeline events (`arcadia-timeline-event-v1`), for stdout only.
 * No collector reads them back: storing them would need a new writer, which
 * this check deliberately does not add.
 */
export function idleFrontTimelineEvents(row: IdleFrontRow, workspace: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const idle = row.idle_minutes ?? 0;
  const causes = row.idle_minutes_by_cause
    ? Object.entries(row.idle_minutes_by_cause).filter(([, value]) => value > 0).map(([cause, value]) => `${cause} ${value}`).join(", ")
    : "";
  const check = timelineEvent({
    id: `timeline:idle-front:${row.ts}`,
    time: row.ts,
    clock: "collector",
    source: "timeline",
    kind: "momentum.idle_front.check",
    workKind: "observe",
    summary: row.critical_path.state === "moving"
      ? `Critical path moving (${row.critical_path.label})`
      : row.critical_path.state === "unreadable"
        ? `Critical path unreadable (${row.critical_path.label}); not all clear`
        : `Critical path ${row.critical_path.state}, ${row.blocker_class}, idle ${idle} min since ${row.blocked_since}${causes ? ` (${causes})` : ""}`,
    subjects: { workspace },
    attention: row.critical_path.state !== "moving",
    evidence: row.blockers.map((blocker) => ({ kind: "row" as const, value: `${blocker.source}:${blocker.key}:${blocker.kind}` })),
    provenance: { event: "arcadia production idle-front: production status, worker merges, production and ping timeline records; read-only" }
  });
  if (check) events.push(check);
  if (row.no_armed_wake !== false || row.missing_wakes.length > 0) {
    const wake = timelineEvent({
      id: `timeline:no-armed-wake:${row.ts}`,
      time: row.ts,
      clock: "collector",
      source: "timeline",
      kind: "momentum.no_armed_wake",
      workKind: "observe",
      summary: row.no_armed_wake === null
        ? "Armed wake unknown: the process list was unreadable and no armed-until file is live"
        : row.no_armed_wake
          ? "No armed wake: no waiter process and no unexpired armed-until file"
          : `No armed wake for ${row.missing_wakes.join(", ")}`,
      subjects: { workspace },
      attention: true,
      evidence: row.armed_wakes.map((wake) => ({ kind: "row" as const, value: wake.evidence })),
      provenance: { event: "waiter processes and armed-until files (deferral D2, docs/design/session-notifications.md)" }
    });
    if (wake) events.push(wake);
  }
  return events;
}
