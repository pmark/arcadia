import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { getProjectBySlug, getProjectMetadata } from "../db/repositories.js";
import { tmuxQueryEnv } from "../sessions/index.js";
import { startPressInProgressIn, type StartPressStatus } from "./relay.js";
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
 * Probes are tri-state: present, absent or unknown. A session is called absent
 * only when two probes in a row say so (`settledTmuxState`); a present or unknown
 * answer on either probe is never `already_stopped`, and unknown is `failed`.
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
/** `multiple_panes`: the session has more than one pane across its windows, while the relay launches exactly one (START's own check). */
export type PaneIdentity = "match" | "mismatch" | "multiple_panes" | "unknown";
export type ClaudeStopResult = { ok: true } | { ok: false; notFound: boolean; error: string };
/** Who ran the stop: `accept` (inside the incoming coordinator's own Session) or the host liveness timer (#3029 fix A). */
export type PredecessorStopRunner = "accept" | "host-timer";

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
    /** Whether the session's one live pane runs the recorded `--session-id`, found through its descendant processes. */
    paneIdentity(name: string, sessionId: string): PaneIdentity;
  };
  /** `claude stop <id>`. Only a notFound answer (the host's own "session not found") counts as already gone. */
  claudeStop(stopId: string): ClaudeStopResult;
  /** Whether a START press is running (or unreadable) in the primary checkout. Required: the interlock cannot be omitted. */
  startPressInProgress(repoRoot: string): StartPressStatus;
  /**
   * Queues an operator page. `episode.key` (text the message contains) makes it one page per episode, whatever its age:
   * the outbox reuses an earlier row from the same agent that contains the key (queueOperatorPing's `episodeKey`).
   */
  ping(message: string, episode?: { key: string }): void;
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
  /** Who wrote this receipt; a receipt written before #3029 has none and was written by accept. */
  runner?: PredecessorStopRunner;
  /** The non-terminal receipt this one replaced (for example accept's sandboxed `failed`), kept as evidence. */
  supersedes?: { outcome: PredecessorStopOutcome; detail: string; finishedAt: string; runner: PredecessorStopRunner };
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
 * Whether exactly `name` is one pane that runs `claude --session-id <sessionId>`: the pane pid and its descendants are
 * searched in `ps` output. Every pane of every window is listed (`-s`), because `kill-session` ends them all: more than
 * one pane is `multiple_panes` (START's pane_runs_session also requires exactly one), never a match on the first pane.
 * Any read failure, or no pane at all, is unknown, never a guess.
 */
export function systemPaneIdentity(name: string, sessionId: string): PaneIdentity {
  if (!SESSION_UUID.test(sessionId)) return "unknown";
  let panes: string[];
  try {
    const out = execFileSync("tmux", ["list-panes", "-s", "-t", `=${name}:`, "-F", "#{pane_pid}"], { ...TMUX_LIMITS, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: tmuxQueryEnv() });
    panes = out.split("\n").filter((line) => line.length > 0);
  } catch {
    return "unknown";
  }
  if (panes.length > 1) return "multiple_panes";
  if (panes.length === 0 || !/^\d+$/.test(panes[0])) return "unknown";
  const panePid = Number(panes[0]);
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

/** Absent only when two probes in a row say so; a present or unknown answer is returned as it is. */
function settledTmuxState(tmux: PredecessorStopDeps["tmux"], name: string): TmuxState {
  const first = tmux.state(name);
  return first === "absent" ? tmux.state(name) : first;
}

/**
 * The START press interlock reads `<repo>/artifacts/generated/operator-scripts`, and a wrong root reads as "no press".
 * So the repository must BE git's primary worktree (the first `git worktree list` entry, compared by realpath). Null for
 * a missing path, a path that is not a checkout, a linked worktree, or a subdirectory of the primary: the stop then defers.
 */
export function verifiedPrimaryCheckout(candidate: string | null): string | null {
  if (candidate === null) return null;
  let real: string;
  try { real = realpathSync(candidate); } catch { return null; }
  let listing: string;
  try {
    listing = execFileSync("git", ["-C", real, "worktree", "list", "--porcelain"], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
  const first = listing.split("\n").find((line) => line.startsWith("worktree "));
  if (!first) return null;
  let primary: string;
  try { primary = realpathSync(first.slice("worktree ".length)); } catch { return null; }
  return primary === real ? real : null;
}

/**
 * The Project's registered primary checkout: `project_metadata.repo_path` for the project with this slug, which must
 * itself be a primary worktree. This is the same registration planning promotion and plan activation read. Null when
 * the Project is unknown, has no registered path, or the registered path is not a primary checkout on disk.
 */
export function registeredPrimaryCheckout(db: Database.Database, projectSlug: string): string | null {
  const project = getProjectBySlug(db, projectSlug);
  if (!project) return null;
  const registered = getProjectMetadata(db, project.id)?.repo_path?.trim();
  if (!registered) return null;
  return verifiedPrimaryCheckout(registered);
}

/**
 * The repository the START press interlock may read, bound to the PROJECT rather than to where the CLI runs.
 * It is the Project's registered primary checkout, and only when `explicit` (an explicit --repo, if given) or else
 * `cwdPrimary` (the primary of the checkout the command runs in) resolves to that same registered checkout. Any other
 * clone, linked worktree, unresolvable path, or a Project without a registered checkout yields null: the stop defers
 * as `interlock_repository_unbound`.
 */
export function interlockRepository(explicit: string | undefined, cwdPrimary: string | null, registered: string | null): string | null {
  if (registered === null) return null;
  const candidate = explicit === undefined ? cwdPrimary : verifiedPrimaryCheckout(explicit);
  return candidate !== null && candidate === registered ? registered : null;
}

/**
 * The stop path's START interlock. A missing operator-scripts library is unknown (unreadable), never "no press":
 * startPressInProgressIn reads a missing directory as no press, which is only safe for a checkout that has none.
 * The shared reader is unchanged for other callers (renew uses it too; see the PR body).
 */
export function stopPressInterlock(repo: string): StartPressStatus {
  const library = path.join(repo, "artifacts", "generated", "operator-scripts");
  if (!existsSync(library)) return { inProgress: true, unreadable: true, detail: `${library} does not exist, so the START press state cannot be read` };
  // A library without its runs/operator directory (or with that name as a file) is an unexpected shape: unknown, never "no press".
  const runs = path.join(library, "runs", "operator");
  const isDirectory = ((): boolean => { try { return statSync(runs).isDirectory(); } catch { return false; } })();
  if (!isDirectory) return { inProgress: true, unreadable: true, detail: `${runs} is missing or not a directory, so the START press state cannot be read` };
  return startPressInProgressIn(library);
}

function receiptPath(root: string, generation: number): string {
  return path.join(root, `predecessor-stop-g${generation}.json`);
}

/** The recorded outcome of generation N's stop receipt under `root` (a coordinator role directory); null when there is none or it is unreadable. */
export function predecessorStopReceiptOutcome(root: string, generation: number): { outcome: PredecessorStopOutcome; terminal: boolean } | null {
  const receipt = readReceipt(receiptPath(root, generation));
  return receipt ? { outcome: receipt.outcome, terminal: TERMINAL.has(receipt.outcome) } : null;
}

/**
 * What START's relay-sessions answer reads for a handed-off predecessor (#3029 fix A): `none` (no receipt yet),
 * `recorded` (a valid receipt, terminal or not), or `unreadable` (a file exists but is not a valid receipt, or the path
 * could not be resolved). START tolerates the live predecessor only while the timer will still act on it, so only `none`
 * and a non-terminal `recorded` keep that tolerance.
 */
export type PredecessorStopReceiptState =
  | { state: "none" }
  | { state: "recorded"; outcome: PredecessorStopOutcome; terminal: boolean }
  | { state: "unreadable"; detail: string };

export function predecessorStopReceiptState(root: string, generation: number): PredecessorStopReceiptState {
  const file = receiptPath(root, generation);
  if (!existsSync(file)) return { state: "none" };
  const receipt = readReceipt(file);
  if (!receipt || typeof receipt.outcome !== "string") return { state: "unreadable", detail: `${file} is not a readable ${PREDECESSOR_STOP_SCHEMA} receipt` };
  return { state: "recorded", outcome: receipt.outcome, terminal: TERMINAL.has(receipt.outcome) };
}

/** The receipt lookup relay-sessions passes to relayCoordinatorSessions for one workspace and Project. A path error is unreadable. */
export function workspacePredecessorStopReceipts(workspacePath: string, project: string): (role: string, generation: number) => PredecessorStopReceiptState {
  return (role, generation) => {
    try { return predecessorStopReceiptState(coordinatorPaths(workspacePath, project, role).root, generation); } catch (error) {
      return { state: "unreadable", detail: `the stop receipt path could not be resolved (${errorText(error)})` };
    }
  };
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
  /**
   * Default `accept`. The host timer (`host-timer`) acts only on the exact-name tmux method: any other method returns
   * `deferred` with no receipt, no command and no page (accept already reported it). Its deferrals are not paged either,
   * since the timer retries every minute; its other outcomes are paged as accept's are.
   */
  runner?: PredecessorStopRunner;
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

  const runner: PredecessorStopRunner = input.runner ?? "accept";
  // The host timer stops only a tmux pane under the exact generation name; bg, desktop and unrecorded stay accept's report.
  const timerMethod = runner === "host-timer" ? predecessorIdentity(predecessor, input.role, successor).method : null;
  if (timerMethod !== null && timerMethod !== "tmux") {
    return { ...base, outcome: "deferred", method: timerMethod, command: null, detail: `generation ${input.predecessor} has no exact-name tmux identity (arcadia-coord-${input.role}-g${input.predecessor}); the host timer stops nothing else`, receipt: null, pinged: false, reused: false };
  }

  // A non-terminal outcome with the same detail as the prior receipt is not pinged again; the timer's deferrals are never pinged.
  const notify = (outcome: PredecessorStopOutcome, detail: string, message: string): boolean => {
    if (earlier && earlier.outcome === outcome && earlier.detail === detail) return false;
    if (runner === "host-timer" && outcome === "deferred") return false;
    deps.ping(message.slice(0, 500));
    return true;
  };
  const finish = (fields: Pick<Receipt, "outcome" | "command" | "detail" | "predecessor">, pinged: boolean): PredecessorStopResult => {
    const receipt: Receipt = {
      schema: PREDECESSOR_STOP_SCHEMA, project: input.project, role: input.role,
      predecessor: fields.predecessor,
      successor: { generation: input.successor, tmuxName: successor.tmuxName, nativeSessionId: successor.nativeSessionId },
      outcome: fields.outcome, command: fields.command, detail: fields.detail,
      startedAt: started.toISOString(), finishedAt: deps.now().toISOString(),
      runner,
      // The first non-terminal receipt is kept (accept's own failure, say), not each minute's deferral that followed it.
      ...(earlier ? { supersedes: earlier.supersedes ?? { outcome: earlier.outcome, detail: earlier.detail, finishedAt: earlier.finishedAt, runner: earlier.runner ?? "accept" } } : {})
    };
    const written = writeReceipt(paths.root, input.predecessor, receipt);
    const detail = written.warning ? `${fields.detail}; ${written.warning}` : fields.detail;
    return { ...base, outcome: fields.outcome, method: fields.predecessor.method, command: fields.command, detail, receipt: written.file, pinged, reused: false };
  };

  // The predecessor and the successor can never share a session id: that would make the successor a target. Refused before anything else.
  if (predecessor.nativeSessionId !== null && predecessor.nativeSessionId === successor.nativeSessionId) {
    const detail = `generation ${input.predecessor} records the same session id as successor ${input.successor}; refused so the successor is never targeted`;
    return finish({ outcome: "identity_mismatch", command: null, detail, predecessor: predecessorIdentity(predecessor, input.role, successor) }, notify("identity_mismatch", detail, `Coordinator relay refused to stop generation ${input.predecessor} (${input.project}): ${detail}. Nothing was killed.`));
  }

  // Refusals: a deferral stops nothing and pings the operator, since the predecessor still holds a live identity.
  const refusal = ((): string | null => {
    if (newestLaunching(db, input.project, input.role)) return "a successor launch of this role is in flight (launching); the predecessor is not stopped during a launch";
    if (input.repoRoot === null) return "interlock_repository_unbound: the START press interlock is bound to the Project's registered primary checkout, which is not resolvable here or does not match --repo or the current checkout (another clone, a linked worktree, an unregistered Project or an unknown path is refused)";
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
    try { before = settledTmuxState(deps.tmux, name); } catch (error) {
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
    // kill-session ends every window, so a session with a second pane or window (other work, or a stranger) is never killed.
    if (pane === "multiple_panes") return fail(`tmux session ${name} has more than one pane across its windows, and the relay launches exactly one; kill-session would end them all, so nothing was killed`, null);
    if (pane === "mismatch") {
      const detail = `tmux session ${name} is live but its pane does not run the recorded session ${sessionId} of generation ${identity.generation}; it is not the predecessor, so nothing was killed`;
      return finish({ outcome: "identity_mismatch", command: null, detail, predecessor: identity }, notify("identity_mismatch", detail, `Coordinator relay refused to stop ${name} (${input.project}): the live session does not run the recorded predecessor session ${sessionId}. Nothing was killed.`));
    }

    try { deps.tmux.killSession(name); } catch (error) {
      return fail(`${command} failed (${errorText(error)}); the predecessor is NOT stopped`, command);
    }
    let after: TmuxState;
    try { after = settledTmuxState(deps.tmux, name); } catch (error) {
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
