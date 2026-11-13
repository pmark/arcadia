import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { TmuxAdapter } from "../sessions/index.js";
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
 *    generation. Stopped with `tmux kill-session -t =<name>`, then confirmed
 *    gone with `has-session`; a session still live after the kill is `failed`.
 *  - `bg`: a predecessor with a recorded `claude --bg` id (`backgroundStopId`).
 *    Stopped with `claude stop <id>`.
 *  - desktop or unrecorded: no stoppable identity is recorded, so nothing is
 *    guessed. The outcome is `manual_stop_required` with the exact title and
 *    session id, and the operator is pinged once.
 *
 * Refusals (`deferred`, nothing stopped): a START press in progress or
 * unreadable, a successor launch in flight, or an unresolved repository. A
 * deferral is not terminal, so a later run may stop the predecessor. A
 * receipt beside the generations records each run. Terminal outcomes (stopped,
 * already_stopped, manual_stop_required) are not repeated, so a second run
 * reports the first result and pings nothing new. A failed stop is reported as
 * failed, never as success. Custody is never changed here: `accept` already
 * moved it.
 */

export const PREDECESSOR_STOP_SCHEMA = "arcadia-coordinator-predecessor-stop-v1" as const;

export type PredecessorStopOutcome = "stopped" | "already_stopped" | "manual_stop_required" | "failed" | "deferred";
export type PredecessorStopMethod = "tmux" | "bg" | "desktop" | "unrecorded";

const TERMINAL: ReadonlySet<PredecessorStopOutcome> = new Set(["stopped", "already_stopped", "manual_stop_required"]);
const SAFE_TMUX_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface PredecessorStopDeps {
  tmux: Pick<TmuxAdapter, "hasSession" | "killSession">;
  /** `claude stop <id>`; an error whose text says the host no longer knows the session is reported as already gone. */
  claudeStop(stopId: string): { ok: true } | { ok: false; error: string };
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
  /** The exact command run, or null when none was (already stopped, deferred, manual). */
  command: string | null;
  detail: string;
  /** The receipt path; null only when the receipt could not be written (see detail). */
  receipt: string | null;
  /** Whether this run pinged the operator. */
  pinged: boolean;
  /** True when a terminal receipt from an earlier run was reported and nothing was run again. */
  reused: boolean;
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

/** The real `claude stop`, bounded. Exact id only; never a name or a pattern. */
export function systemClaudeStop(stopId: string): { ok: true } | { ok: false; error: string } {
  const result = spawnSync("claude", ["stop", stopId], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: `claude stop exited ${result.status}: ${((result.stderr ?? "").trim() || (result.stdout ?? "").trim()).slice(0, 400)}` };
  return { ok: true };
}

const GONE_TEXT = /no such|not found|unknown session|no session/i;

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

  const pingOnce = (message: string): boolean => { deps.ping(message.slice(0, 500)); return true; };
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
    const pinged = pingOnce(`Coordinator relay did not stop the predecessor ${input.role} generation ${predecessor.generation} (${input.project}; successor ${input.successor} accepted): ${refusal}. Stop it by its exact identity when the press or launch is clear.`);
    return finish({ outcome: "deferred", command: null, detail: refusal, predecessor: identity }, pinged);
  }

  const identity = predecessorIdentity(predecessor, input.role, successor);
  if (identity.method === "tmux") {
    const name = identity.tmuxName as string;
    try {
      if (!deps.tmux.hasSession(name)) {
        return finish({ outcome: "already_stopped", command: null, detail: `no live tmux session named ${name}`, predecessor: identity }, false);
      }
      const command = `tmux kill-session -t =${name}`;
      deps.tmux.killSession?.(name);
      if (deps.tmux.hasSession(name)) {
        const detail = `${command} ran, but tmux session ${name} is still live; the predecessor is NOT stopped`;
        return finish({ outcome: "failed", command, detail, predecessor: identity }, pingOnce(`Coordinator relay FAILED to stop the predecessor ${name} (${input.project}); it is still running after kill-session. Stop it by hand: tmux kill-session -t =${name}`));
      }
      return finish({ outcome: "stopped", command, detail: `stopped tmux session ${name} by its exact name`, predecessor: identity }, false);
    } catch (error) {
      const detail = `stopping tmux session ${name} raised an error (${error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)}); the predecessor may still be running`;
      return finish({ outcome: "failed", command: `tmux kill-session -t =${name}`, detail, predecessor: identity }, pingOnce(`Coordinator relay FAILED to stop the predecessor ${name} (${input.project}): ${detail}`));
    }
  }
  if (identity.method === "bg") {
    const stopId = identity.stopId as string;
    const command = `claude stop ${stopId}`;
    const result = deps.claudeStop(stopId);
    if (result.ok) return finish({ outcome: "stopped", command, detail: `stopped background session ${stopId} by its recorded id`, predecessor: identity }, false);
    if (GONE_TEXT.test(result.error)) return finish({ outcome: "already_stopped", command, detail: `claude no longer knows background session ${stopId} (${result.error.slice(0, 160)})`, predecessor: identity }, false);
    const detail = `${command} failed: ${result.error.slice(0, 300)}; the predecessor is NOT stopped`;
    return finish({ outcome: "failed", command, detail, predecessor: identity }, pingOnce(`Coordinator relay FAILED to stop the predecessor background session ${stopId} (${input.project}): ${result.error.slice(0, 200)}. Stop it by hand: claude stop ${stopId}`));
  }
  // Desktop or unrecorded: no stoppable identity is recorded, so nothing is guessed. The operator ends it by its exact title and session id.
  const title = identity.title;
  const sessionId = predecessor.nativeSessionId ?? "unrecorded";
  const detail = `generation ${input.predecessor} has no recorded stoppable pane or background id (${identity.method === "desktop" ? "a desktop coordinator" : "not relay-launched"}); end its Session by hand: title "${title}", session ${sessionId}`;
  return finish({ outcome: "manual_stop_required", command: null, detail, predecessor: identity }, pingOnce(`Coordinator predecessor ${input.role} generation ${input.predecessor} (${input.project}) is handed off and must be stopped by hand: title "${title}", session ${sessionId}. Nothing was stopped.`));
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
