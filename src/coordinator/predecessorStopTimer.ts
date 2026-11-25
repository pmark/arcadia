import type Database from "better-sqlite3";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { queueOperatorPing } from "../ping/operatorPing.js";
import { currentCustodian, immediatePredecessor, listGenerations } from "./generations.js";
import { withRelayLock, type RelayLockDeps } from "./lock.js";
import { coordinatorPaths } from "./paths.js";
import {
  predecessorStopReceiptOutcome,
  registeredPrimaryCheckout,
  stopPredecessorAfterAccept,
  stopPressInterlock,
  systemPredecessorStopTmux,
  type PredecessorStopDeps,
  type PredecessorStopMethod,
  type PredecessorStopOutcome
} from "./predecessorStop.js";

/**
 * #3029 fix A, part 1: the host liveness timer's predecessor stop. `coordinator accept` runs the stop inside the incoming
 * coordinator's sandbox, where tmux can answer `unknown`, so it kills nothing and nothing retries it once custody has
 * moved. This step runs on `arcadia production liveness-check`'s launchd timer, outside any agent sandbox, once a minute.
 *
 * It finds, read-only, each current custodian's immediate predecessor that is `handed_off`, has its stand-down recorded
 * for exactly that custodian, was relay-launched under exactly `arcadia-coord-<role>-g<N>`, has a recorded session id,
 * and has no terminal stop receipt. For each, under the relay lock, it runs predecessorStop.ts's own stop as runner
 * `host-timer`: the same custodian and stand-down checks again, the START press and launch interlocks, the settled
 * tmux probe, the pane-identity check against the recorded `--session-id`, an exact `tmux kill-session -t =<name>`, a
 * confirming probe, and the same receipt (a `failed` one becomes `stopped`, keeping the old one as `supersedes`).
 *
 * Nothing else is a target: no other method (bg, desktop, unrecorded), no older handed-off generation, no successor.
 * A terminal receipt makes a generation no longer a candidate, so later runs probe and kill nothing (idempotent).
 * Deferrals are not paged (the next minute retries); a held relay lock is a deferral too.
 */

export interface PredecessorStopCandidate {
  project: string;
  role: string;
  predecessor: number;
  successor: number;
  tmuxName: string;
}

export interface PredecessorStopTimerEntry {
  project: string;
  role: string;
  predecessor: number;
  successor: number;
  /** `error` only when the step itself threw for this candidate (nothing was confirmed). */
  outcome: PredecessorStopOutcome | "error";
  method: PredecessorStopMethod | null;
  command: string | null;
  detail: string;
  receipt: string | null;
  pinged: boolean;
  /** Set when a page was due but could not be queued; the receipt is still written. */
  pingError: string | null;
}

export interface PredecessorStopTimerData {
  candidates: number;
  results: PredecessorStopTimerEntry[];
}

export interface PredecessorStopTimerDependencies {
  /** Test seam: the stop's host effects. Default: real exact-name tmux, the START interlock, and the operator outbox. */
  stopDeps?: (db: Database.Database) => PredecessorStopDeps;
  /** Test seam: the START interlock's repository. Default: the Project's registered primary checkout, or null (a deferral). */
  repoRoot?: (db: Database.Database, project: string) => string | null;
  lock?: RelayLockDeps;
}

const SAFE_TMUX_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function hasGenerationsTable(db: Database.Database): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'coordinator_generations'").get() !== undefined;
}

/** Read-only: the handed-off predecessors the timer may try to stop now. */
export function findPredecessorStopCandidates(db: Database.Database, workspacePath: string): PredecessorStopCandidate[] {
  if (!hasGenerationsTable(db)) return [];
  const scopes = db.prepare("SELECT DISTINCT project, role FROM coordinator_generations WHERE status = 'custodian' ORDER BY project, role").all() as Array<{ project: string; role: string }>;
  const candidates: PredecessorStopCandidate[] = [];
  for (const { project, role } of scopes) {
    const custodian = currentCustodian(db, project, role);
    if (!custodian) continue;
    const predecessor = immediatePredecessor(listGenerations(db, project, role), custodian);
    if (!predecessor || predecessor.stoodDownAt === null || !predecessor.relayLaunched || !predecessor.nativeSessionId) continue;
    const expected = `arcadia-coord-${role}-g${predecessor.generation}`;
    if (predecessor.tmuxName !== expected || !SAFE_TMUX_NAME.test(expected) || expected === custodian.tmuxName) continue;
    if (predecessorStopReceiptOutcome(coordinatorPaths(workspacePath, project, role).root, predecessor.generation)?.terminal) continue;
    candidates.push({ project, role, predecessor: predecessor.generation, successor: custodian.generation, tmuxName: expected });
  }
  return candidates;
}

function systemStopDeps(db: Database.Database): PredecessorStopDeps {
  return {
    tmux: systemPredecessorStopTmux(),
    // The timer stops tmux panes only (runner host-timer refuses every other method before this could run).
    claudeStop: () => ({ ok: false, notFound: false, error: "the host timer never runs claude stop" }),
    startPressInProgress: stopPressInterlock,
    ping: (message) => { queueOperatorPing(db, { message, kind: "attention", agent: "coordinator-relay" }); },
    now: () => new Date()
  };
}

export function runPredecessorStopTimer(workspacePath: string, deps: PredecessorStopTimerDependencies = {}): PredecessorStopTimerData {
  const candidates = withReadOnlyDatabase(workspacePath, (db) => findPredecessorStopCandidates(db, workspacePath));
  const results: PredecessorStopTimerEntry[] = [];
  for (const candidate of candidates) {
    const { project, role, predecessor, successor } = candidate;
    try {
      const entry = withDatabase(workspacePath, (db) => withRelayLock(coordinatorPaths(workspacePath, project, role).root, (): PredecessorStopTimerEntry => {
        const host = (deps.stopDeps ?? systemStopDeps)(db);
        let pingError: string | null = null;
        // A page that cannot be queued (the hourly cap, say) must not lose the receipt: the outcome is recorded either way.
        const stopDeps: PredecessorStopDeps = { ...host, ping: (message) => { try { host.ping(message); } catch (error) { pingError = errorText(error); } } };
        const repoRoot = (deps.repoRoot ?? registeredPrimaryCheckout)(db, project);
        const result = stopPredecessorAfterAccept(db, { workspace: workspacePath, project, role, successor, predecessor, repoRoot, runner: "host-timer" }, stopDeps);
        return { project, role, predecessor, successor, outcome: result.outcome, method: result.method, command: result.command, detail: result.detail, receipt: result.receipt, pinged: result.pinged && pingError === null, pingError };
      }, deps.lock));
      results.push(entry);
    } catch (error) {
      const held = (error as { details?: { reason?: unknown } }).details?.reason === "relay_lock_held";
      results.push({
        project, role, predecessor, successor, outcome: held ? "deferred" : "error", method: null, command: null,
        detail: held ? `the coordinator relay lock is held (${errorText(error)}); nothing was stopped, and the next timer run retries` : `the predecessor stop raised an error (${errorText(error)}); nothing is confirmed stopped`,
        receipt: null, pinged: false, pingError: null
      });
    }
  }
  return { candidates: candidates.length, results };
}

/** The liveness timer's step: resolves the workspace as the timer's other checks do. */
export function runPredecessorStopTimerStep(options: { workspace?: string }, deps: PredecessorStopTimerDependencies = {}): PredecessorStopTimerData {
  return runPredecessorStopTimer(resolveReadyWorkspace(options.workspace).workspacePath, deps);
}

/** One line per candidate this run acted on; quiet when there was none (launchd keeps this output once a minute). */
export function renderPredecessorStopTimerLines(data: PredecessorStopTimerData, stamp = new Date().toISOString()): string[] {
  return data.results.map((entry) => `${stamp} predecessor ${entry.role} generation ${entry.predecessor} (${entry.project}): ${entry.outcome}. ${entry.detail}${entry.receipt ? ` Receipt: ${entry.receipt}` : ""}${entry.pingError ? ` (page not queued: ${entry.pingError})` : ""}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}
