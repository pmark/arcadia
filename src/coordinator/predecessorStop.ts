import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { tmuxQueryEnv } from "../sessions/index.js";
import type { StartPressStatus } from "./relay.js";
import { coordinatorPaths } from "./paths.js";
import { listGenerations, newestLaunching, type GenerationRecord } from "./generations.js";

/**
 * Gate 10, the stop half: after `accept` records the successor as custodian and
 * the predecessor's stand-down for exactly that generation exists, stop the
 * predecessor's Session by its exact recorded identity. Nothing is stopped by
 * pattern, by prefix or by role; the successor is never a target.
 *
 * Identity, in order:
 *  - `tmux`: a relay-launched predecessor (it holds a custody token) whose
 *    recorded tmux name is exactly `arcadia-coord-<role>-g<N>` for its own
 *    generation. Before any kill, the live pane must run the recorded
 *    `--session-id` (the same identity relayCoordinatorSessions and START
 *    require); otherwise `identity_mismatch`. Stopped with
 *    `tmux kill-session -t =<name>`, then confirmed gone.
 *  - `bg`: a relay-launched predecessor with a recorded `claude --bg` id
 *    (`backgroundStopId`). Stopped with `claude stop <id>`.
 *  - desktop or unrecorded: no stoppable identity is recorded, so nothing is
 *    guessed. The outcome is `manual_stop_required` with the exact title and
 *    session id, and the operator is pinged once.
 *
 * Probes are tri-state: present, absent or unknown. Only a clean "absent" is
 * `already_stopped`; an unknown answer is `failed` and never terminal.
 *
 * Refusals (`deferred`, nothing stopped): a START press in progress or
 * unreadable, a successor launch in flight, or an unresolved repository. A
 * deferral is not terminal, so a later run may stop the predecessor. Terminal
 * outcomes (stopped, already_stopped, manual_stop_required, identity_mismatch)
 * are not repeated. A repeated non-terminal outcome with the same detail is not
 * pinged again. Custody is never changed here: `accept` already moved it.
 */

export const PREDECESSOR_STOP_SCHEMA = "arcadia-coordinator-predecessor-stop-v1" as const;

export type PredecessorStopOutcome = "stopped" | "already_stopped" | "manual_stop_required" | "identity_mismatch" | "failed" | "deferred";
export type PredecessorStopMethod = "tmux" | "bg" | "desktop" | "unrecorded";
export type TmuxState = "present" | "absent" | "unknown";
export type PaneIdentity = "match" | "mismatch" | "unknown";
export type ClaudeStopResult = { ok: true } | { ok: false; notFound: boolean; error: string };

const TERMINAL: ReadonlySet<PredecessorStopOutcome> = new Set(["stopped", "already_stopped", "manual_stop_required", "identity_mismatch"]);
const SAFE_TMUX_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TMUX_LIMITS = { timeout: 15_000, killSignal: "SIGKILL" as const };

export interface PredecessorStopDeps {
  tmux: {
    /** present, absent (tmux's own "no session" or "no server" answer), or unknown (any other tmux failure). */
    state(name: string): TmuxState;
    /** Ends the named session; throws when tmux refuses, so the caller reports failed. */
    killSession(name: string): void;
    /** Whether the live pane runs the recorded `--session-id`, found through its descendant processes. */
    paneIdentity(name: string, sessionId: string): PaneIdentity;
  };
  /** `claude stop <id>`. Only a notFound answer (the host's own "session not found") counts as already gone. */
  claudeStop(stopId: string): ClaudeStopResult;
  /** Whether a START press is running (or unreadable) in the primary checkout. Required: the interlock cannot be omitted. */
  startPressInProgress(repoRoot: string): StartPressStatus;
  ping(message: string): void;
  now(): Date;
}

export interface PredecessorStopResult {
  outcome: PredecessorStopOutcome;
  predecessor: number;
  successor: number;
  method: PredecessorStopMethod;
  /** The exact command run, or null when none was (already stopped, deferred, manual, mismatch, or failed before a kill). */
  command: string | null;
  detail: string;
  /** The receipt path; null only when the receipt could not be written (see detail). */
  receipt: string | null;
  /** Whether this run pinged the operator. */
  pinged: boolean;
  /** True when a terminal receipt from an earlier run was reported and nothing was run again. */
  reused: boolean;
}

export interface AfterAcceptStop {
  stop: PredecessorStopResult | null;
  /** Set when the stop threw after custody moved. The accept itself has succeeded. */
  error: { reason: "predecessor_stop_failed"; detail: string } | null;
}

interface Receipt {
  schema: typeof PREDECESSOR_STOP_SCHEMA;
  project: string;
  role: string;
  predecessor: { generation: number; method: PredecessorStopMethod; tmuxName: string | null; stopId: string | null; nativeSessionId: string | null; title: string; provider: string; identity: string };
  successor: { generation: number; tmuxName: string | null; nativeSessionId: string | null };
  outcome: PredecessorStopOutcome;
  command: string | null;
  detail: string;
  startedAt: string;
  finishedAt: string;
}

/** Live tmux: `has-session` exits 0 when present; tmux's own "no session" or "no server" answer is absent; anything else is unknown. */
export function systemTmuxState(name: string): TmuxState {
  try {
    execFileSync("tmux", ["has-session", "-t", `=${name}`], { ...TMUX_LIMITS, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", env: tmuxQueryEnv() });
    return "present";
  } catch (error) {
    const failure = error as { status?: unknown; stderr?: unknown; code?: unknown };
    if (failure.code === "ETIMEDOUT") return "unknown";
    const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
    if (typeof failure.status === "number" && failure.status !== 0 && (/can't find session/i.test(stderr) || /no server running/i.test(stderr))) return "absent";
    return "unknown";
  }
}

/** Kills the named tmux session only. A refusal throws; the caller re-probes and reports failed. */
export function systemTmuxKill(name: string): void {
  execFileSync("tmux", ["kill-session", "-t", `=${name}`], { ...TMUX_LIMITS, stdio: "ignore", env: tmuxQueryEnv() });
}

/**
 * Whether the pane of exactly `name` runs `claude --session-id <sessionId>`: the pane pid and its descendants are
 * searched in `ps` output. Any read failure is unknown, never a guess.
 */
export function systemPaneIdentity(name: string, sessionId: string): PaneIdentity {
  if (!SESSION_UUID.test(sessionId)) return "unknown";
  let panePid: number;
  try {
    const out = execFileSync("tmux", ["list-panes", "-t", `=${name}:`, "-F", "#{pane_pid}"], { ...TMUX_LIMITS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: tmuxQueryEnv() });
    panePid = Number(out.split("\n")[0]);
  } catch {
    return "unknown";
  }
  if (!Number.isInteger(panePid) || panePid <= 1) return "unknown";
  let table: string;
  try {
    table = execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } });
  } catch {
    return "unknown";
  }
  const children = new Map<number, number[]>();
  const argv = new Map<number, string>();
  for (const line of table.split("\n")) {
    const row = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!row) continue;
    const pid = Number(row[1]);
    const ppid = Number(row[2]);
    argv.set(pid, row[3]);
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const needle = new RegExp(`(^|\\s)--session-id[ =]${sessionId}(\\s|$)`, "i");
  const queue = [panePid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (needle.test(argv.get(pid) ?? "")) return "match";
    queue.push(...(children.get(pid) ?? []));
  }
  return "mismatch";
}

/** The real `claude stop`, bounded. Exact id only. Only the host's own "session not found" answer is notFound; auth and CLI failures are not. */
export function systemClaudeStop(stopId: string): ClaudeStopResult {
  const result = spawnSync("claude", ["stop", stopId], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { ok: false, notFound: false, error: result.error.message };
  if (result.status === 0) return { ok: true };
  const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
  const notFound = /\b(no such session|session not found)\b/i.test(text) && !/\b(auth|log ?in|credential|permission|unauthori[sz]ed|token)\b/i.test(text);
  return { ok: false, notFound, error: `claude stop exited ${result.status}: ${text.slice(0, 400)}` };
}

/** The real tmux and `claude` dependencies, for the accept command. */
export function systemPredecessorStopTmux(): PredecessorStopDeps["tmux"] {
  return { state: systemTmuxState, killSession: systemTmuxKill, paneIdentity: systemPaneIdentity };
}

function receiptPath(root: string, generation: number): string {
  return path.join(root, `predecessor-stop-g${generation}.json`);
}

function readReceipt(file: string): Receipt | null {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Receipt;
    return value && value.schema === PREDECESSOR_STOP_SCHEMA ? value : null;
  } catch {
    return null;
  }
}

function writeReceipt(root: string, generation: number, receipt: Receipt): { file: string | null; warning: string | null } {
  const target = receiptPath(root, generation);
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, target);
    return { file: target, warning: null };
  } catch (error) {
    return { file: null, warning: `the predecessor-stop receipt could not be written (${error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120)}); the outcome is in this result only` };
  }
}

export interface StopPredecessorInput {
  workspace: string;
  project: string;
  role: string;
  /** The successor generation `accept` just made custodian. */
  successor: number;
  /** The predecessor `accept` marked handed_off (acceptGeneration's `handedOff`). */
  predecessor: number;
  /** The main-checkout root for the START interlock; null when it could not be resolved (a deferral). */
  repoRoot: string | null;
}

/**
 * Stops the handed-off predecessor after accept. Callers hold the relay lock, so
 * a renew cannot launch a successor between the launching check and the stop.
 */
export function stopPredecessorAfterAccept(db: Database.Database, input: StopPredecessorInput, deps: PredecessorStopDeps): PredecessorStopResult {
  const started = deps.now();
  const records = listGenerations(db, input.project, input.role);
  const successor = records.find((row) => row.generation === input.successor);
  const predecessor = records.find((row) => row.generation === input.predecessor);
  const paths = coordinatorPaths(input.workspace, input.project, input.role);
  const base = { predecessor: input.predecessor, successor: input.successor };

  // Only after accept: the successor is custodian, and the predecessor is handed_off with its stand-down for exactly this successor.
  if (!successor || successor.status !== "custodian") {
    return { ...base, outcome: "deferred", method: "unrecorded", command: null, detail: `generation ${input.successor} is not the recorded custodian; nothing is stopped before accept`, receipt: null, pinged: false, reused: false };
  }
  if (!predecessor || predecessor.status !== "handed_off" || predecessor.stoodDownFor !== input.successor) {
    return { ...base, outcome: "deferred", method: "unrecorded", command: null, detail: `generation ${input.predecessor} is not handed_off with its stand-down recorded for generation ${input.successor}; nothing is stopped`, receipt: null, pinged: false, reused: false };
  }

  // A terminal receipt from an earlier run is the answer: nothing runs again, nothing is pinged again.
  const earlier = readReceipt(receiptPath(paths.root, input.predecessor));
  if (earlier && TERMINAL.has(earlier.outcome)) {
    return { ...base, outcome: earlier.outcome, method: earlier.predecessor.method, command: earlier.command, detail: `${earlier.detail} (recorded ${earlier.finishedAt}; not run again)`, receipt: receiptPath(paths.root, input.predecessor), pinged: false, reused: true };
  }

  // A non-terminal outcome with the same detail as the prior receipt is not pinged again.
  const notify = (outcome: PredecessorStopOutcome, detail: string, message: string): boolean => {
    if (earlier && earlier.outcome === outcome && earlier.detail === detail) return false;
    deps.ping(message.slice(0, 500));
    return true;
  };
  const finish = (fields: Pick<Receipt, "outcome" | "command" | "detail" | "predecessor">, pinged: boolean): PredecessorStopResult => {
    const receipt: Receipt = {
      schema: PREDECESSOR_STOP_SCHEMA, project: input.project, role: input.role,
      predecessor: fields.predecessor,
      successor: { generation: input.successor, tmuxName: successor.tmuxName, nativeSessionId: successor.nativeSessionId },
      outcome: fields.outcome, command: fields.command, detail: fields.detail,
      startedAt: started.toISOString(), finishedAt: deps.now().toISOString()
    };
    const written = writeReceipt(paths.root, input.predecessor, receipt);
    const detail = written.warning ? `${fields.detail}; ${written.warning}` : fields.detail;
    return { ...base, outcome: fields.outcome, method: fields.predecessor.method, command: fields.command, detail, receipt: written.file, pinged, reused: false };
  };

  // Refusals: a deferral stops nothing and pings the operator, since the predecessor still holds a live identity.
  const refusal = ((): string | null => {
    if (newestLaunching(db, input.project, input.role)) return "a successor launch of this role is in flight (launching); the predecessor is not stopped during a launch";
    if (input.repoRoot === null) return "the repository could not be resolved, so the START press interlock cannot be checked; pass --repo <primary checkout>";
    const press = deps.startPressInProgress(input.repoRoot);
    if (press.inProgress) return press.unreadable ? `a START press record cannot be read (${press.detail}); the predecessor is not stopped during a press` : `a START press is in progress (${press.detail}); the predecessor is not stopped during a press`;
    return null;
  })();
  if (refusal !== null) {
    const identity = predecessorIdentity(predecessor, input.role, successor);
    const message = `Coordinator relay did not stop the predecessor ${input.role} generation ${predecessor.generation} (${input.project}; successor ${input.successor} accepted): ${refusal}. Stop it by its exact identity when the press or launch is clear.`;
    return finish({ outcome: "deferred", command: null, detail: refusal, predecessor: identity }, notify("deferred", refusal, message));
  }

  const identity = predecessorIdentity(predecessor, input.role, successor);
  if (identity.method === "tmux") {
    const name = identity.tmuxName as string;
    const command = `tmux kill-session -t =${name}`;
    // Every failure here is non-terminal and happens before or after a kill, so the custody is never changed.
    const fail = (detail: string, ranCommand: string | null): PredecessorStopResult =>
      finish({ outcome: "failed", command: ranCommand, detail, predecessor: identity }, notify("failed", detail, `Coordinator relay FAILED to stop the predecessor ${name} (${input.project}): ${detail}`));

    let before: TmuxState;
    try { before = deps.tmux.state(name); } catch (error) {
      return fail(`the tmux probe for ${name} raised an error (${errorText(error)}); nothing was killed and the predecessor may still be running`, null);
    }
    if (before === "unknown") return fail(`the tmux probe for ${name} could not tell whether it is live (probe unknown); nothing was killed`, null);
    if (before === "absent") return finish({ outcome: "already_stopped", command: null, detail: `no live tmux session named ${name}`, predecessor: identity }, false);

    // Identity before any kill: a hand-started or stale session that carries the exact name is not the recorded predecessor.
    const sessionId = identity.nativeSessionId;
    if (!sessionId) {
      const detail = `tmux session ${name} is live but generation ${identity.generation} has no recorded session id to verify it against; nothing was killed`;
      return finish({ outcome: "identity_mismatch", command: null, detail, predecessor: identity }, notify("identity_mismatch", detail, `Coordinator relay refused to stop ${name} (${input.project}): ${detail}. Stop it by hand if it is the predecessor.`));
    }
    let pane: PaneIdentity;
    try { pane = deps.tmux.paneIdentity(name, sessionId); } catch (error) {
      return fail(`the pane identity check for ${name} raised an error (${errorText(error)}); nothing was killed`, null);
    }
    if (pane === "unknown") return fail(`the pane identity of ${name} could not be read; nothing was killed`, null);
    if (pane === "mismatch") {
      const detail = `tmux session ${name} is live but its pane does not run the recorded session ${sessionId} of generation ${identity.generation}; it is not the predecessor, so nothing was killed`;
      return finish({ outcome: "identity_mismatch", command: null, detail, predecessor: identity }, notify("identity_mismatch", detail, `Coordinator relay refused to stop ${name} (${input.project}): the live session does not run the recorded predecessor session ${sessionId}. Nothing was killed.`));
    }

    try { deps.tmux.killSession(name); } catch (error) {
      return fail(`${command} failed (${errorText(error)}); the predecessor is NOT stopped`, command);
    }
    let after: TmuxState;
    try { after = deps.tmux.state(name); } catch (error) {
      return fail(`${command} ran, but the probe afterwards raised an error (${errorText(error)}); the stop is not confirmed`, command);
    }
    if (after === "present") return fail(`${command} ran, but tmux session ${name} is still live; the predecessor is NOT stopped`, command);
    if (after === "unknown") return fail(`${command} ran, but the probe afterwards could not tell whether ${name} is live (probe unknown); the stop is not confirmed`, command);
    return finish({ outcome: "stopped", command, detail: `stopped tmux session ${name} by its exact name`, predecessor: identity }, false);
  }
  if (identity.method === "bg") {
    const stopId = identity.stopId as string;
    const command = `claude stop ${stopId}`;
    let result: ClaudeStopResult;
    try { result = deps.claudeStop(stopId); } catch (error) {
      const detail = `${command} raised an error (${errorText(error)}); the predecessor is NOT confirmed stopped`;
      return finish({ outcome: "failed", command, detail, predecessor: identity }, notify("failed", detail, `Coordinator relay FAILED to stop the predecessor background session ${stopId} (${input.project}): ${detail}`));
    }
    if (result.ok) return finish({ outcome: "stopped", command, detail: `stopped background session ${stopId} by its recorded id`, predecessor: identity }, false);
    if (result.notFound) return finish({ outcome: "already_stopped", command, detail: `claude reports no such session ${stopId}: ${result.error.slice(0, 160)}`, predecessor: identity }, false);
    const detail = `${command} failed: ${result.error.slice(0, 300)}; the predecessor is NOT stopped`;
    return finish({ outcome: "failed", command, detail, predecessor: identity }, notify("failed", detail, `Coordinator relay FAILED to stop the predecessor background session ${stopId} (${input.project}): ${result.error.slice(0, 200)}. Stop it by hand: claude stop ${stopId}`));
  }
  // Desktop or unrecorded: no stoppable identity is recorded, so nothing is guessed. The operator ends it by its exact title and session id.
  const title = identity.title;
  const sessionId = predecessor.nativeSessionId ?? "unrecorded";
  const detail = `generation ${input.predecessor} has no recorded stoppable pane or background id (${identity.method === "desktop" ? "a desktop coordinator" : "not relay-launched"}); end its Session by hand: title "${title}", session ${sessionId}`;
  return finish({ outcome: "manual_stop_required", command: null, detail, predecessor: identity }, notify("manual_stop_required", detail, `Coordinator predecessor ${input.role} generation ${input.predecessor} (${input.project}) is handed off and must be stopped by hand: title "${title}", session ${sessionId}. Nothing was stopped.`));
}

/**
 * The post-accept wrapper. Custody has already moved when this runs, so a throw
 * is turned into `predecessor_stop_failed` for the accept result and never fails
 * the accept.
 */
export function runPredecessorStopAfterAccept(db: Database.Database, input: StopPredecessorInput, deps: PredecessorStopDeps): AfterAcceptStop {
  try {
    return { stop: stopPredecessorAfterAccept(db, input, deps), error: null };
  } catch (error) {
    return {
      stop: null,
      error: {
        reason: "predecessor_stop_failed",
        detail: `custody moved to generation ${input.successor} before the predecessor stop ran, and the stop raised an error (${errorText(error)}); generation ${input.predecessor} may still be running, so check its receipt and stop it by hand if needed`
      }
    };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
}

/**
 * The predecessor's identity as the receipt records it. Only recorded fields
 * decide the method: a desktop coordinator (no custody token) is never stopped,
 * and a relay-launched one is stopped only by the exact tmux name its own
 * generation implies, or by a recorded `--bg` id that is not the successor's.
 */
function predecessorIdentity(record: GenerationRecord, role: string, successor: GenerationRecord): Receipt["predecessor"] & { stopId: string | null; tmuxName: string | null } {
  const title = record.remoteControlName ?? record.identity;
  const base = { generation: record.generation, nativeSessionId: record.nativeSessionId, title, provider: record.provider, identity: record.identity };
  if (!record.relayLaunched) return { ...base, method: "desktop", tmuxName: null, stopId: null };
  if (record.tmuxName) {
    const expected = `arcadia-coord-${role}-g${record.generation}`;
    if (record.tmuxName === expected && SAFE_TMUX_NAME.test(expected) && record.tmuxName !== successor.tmuxName) {
      return { ...base, method: "tmux", tmuxName: record.tmuxName, stopId: null };
    }
    return { ...base, method: "unrecorded", tmuxName: record.tmuxName, stopId: null };
  }
  if (record.backgroundStopId) {
    const stopId = record.backgroundStopId;
    const isSuccessor = stopId === successor.nativeSessionId || stopId === successor.backgroundStopId;
    if (!isSuccessor && SAFE_TMUX_NAME.test(stopId)) return { ...base, method: "bg", tmuxName: null, stopId };
    return { ...base, method: "unrecorded", tmuxName: null, stopId: null };
  }
  return { ...base, method: "unrecorded", tmuxName: null, stopId: null };
}
