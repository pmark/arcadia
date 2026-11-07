import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import {
  COORDINATOR_BUDGET_SCHEMA,
  budgetEpisodeKey,
  budgetPingMessage,
  coordinatorRoleOfTitle,
  decidePage,
  emptyBudgetState,
  handoffDue,
  levelOf,
  markPaged,
  nextStepFor,
  readClaudeTranscript,
  readCodexRollout,
  sessionKey,
  type BudgetLevel,
  type ClaudeWindowHint,
  type CoordinatorAgent,
  type CoordinatorBudgetMarker,
  type CoordinatorBudgetState,
  type CoordinatorRole,
  type PageLevel,
  type PagedRecord,
  type SessionRead
} from "../coordinators/budget.js";
import { runPingSendCommand } from "./ping.js";
import { dashboardLink, type LivenessPingInput } from "./productionLiveness.js";

/**
 * The coordinator budget's command half (`src/coordinators/budget.ts` holds the
 * rules). `runCoordinatorBudgetCheck` runs inside `arcadia production
 * liveness-check`, after the worker check and the momentum alarm, on that
 * command's existing launchd timer: no new agent, no session, no model call.
 * It reads the host's own transcript files read-only and writes only its own
 * state file, one marker per coordinator past a threshold and, on a new
 * threshold, one outbox row through `arcadia ping`. It never starts, stops or
 * messages a session. `arcadia coordinator budget` is the read-only view a
 * coordinator runs on its own turn.
 */

const BUDGET_DIR = "coordinator-budget";
const STATE_FILE = "state.json";
const PING_AGENT = "Coordinator budget";
/** A transcript untouched this long is not a live coordinator: a waiting coordinator still wakes within 55 minutes. */
export const COORDINATOR_LIVE_MINUTES = 120;
/** State for a session not seen for a week is dropped. */
const STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** The title is re-appended on every turn, so the tail finds it; a megabyte covers a large tool result. */
const TITLE_TAIL_BYTES = 1024 * 1024;

export interface BudgetSources {
  /** `~/.claude/projects`; null skips Claude. */
  claudeProjectsDir: string | null;
  /** `~/.codex` (or CODEX_HOME); null skips Codex. */
  codexHome: string | null;
  /** The status-line capture Arcadia already reads for provider usage; null skips it. */
  claudeStatusLinePath: string | null;
}

/**
 * The host's own paths. A test process never reads a developer's real
 * sessions unless it names a directory, as `availability.ts` does for its
 * telemetry cache.
 */
export function defaultBudgetSources(env: NodeJS.ProcessEnv = process.env): BudgetSources {
  const isolated = Boolean(env["VITEST"]);
  const home = os.homedir();
  return {
    claudeProjectsDir: env["ARCADIA_CLAUDE_PROJECTS_DIR"] ?? (isolated ? null : path.join(home, ".claude", "projects")),
    codexHome: env["ARCADIA_CODEX_HOME"] ?? (isolated ? null : env["CODEX_HOME"] ?? path.join(home, ".codex")),
    claudeStatusLinePath: env["ARCADIA_CLAUDE_USAGE_PATH"] ?? (isolated ? null : path.join(home, ".arcadia", "telemetry", "claude-code.json"))
  };
}

export interface DiscoveredSession {
  read: SessionRead & { sessionId: string };
  role: CoordinatorRole | null;
  transcript: string;
  fileAgeMinutes: number;
}

export interface Discovery {
  sessions: DiscoveredSession[];
  /** Unreadable sources, by path; a missing provider directory is not a problem. */
  problems: string[];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function readTail(file: string, bytes: number): string {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const content = buffer.toString("utf8");
    // A cut first line is partial; drop it.
    return start > 0 ? content.slice(content.indexOf("\n") + 1) : content;
  } finally {
    closeSync(fd);
  }
}

function lastClaudeTitle(tail: string): string | null {
  const lines = tail.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes("\"custom-title\"")) continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown; customTitle?: unknown };
      if (entry.type === "custom-title" && typeof entry.customTitle === "string") return entry.customTitle;
    } catch { /* a torn line; keep looking */ }
  }
  return null;
}

function readStatusLineHint(file: string | null): ClaudeWindowHint | null {
  if (!file) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { session_id?: unknown; context_window?: { context_window_size?: unknown } };
    const size = raw.context_window?.context_window_size;
    return {
      sessionId: typeof raw.session_id === "string" ? raw.session_id : null,
      windowSize: typeof size === "number" && Number.isFinite(size) && size > 0 ? size : null
    };
  } catch {
    return null;
  }
}

interface DiscoverOptions {
  now: Date;
  liveMinutes?: number;
  /** Also measure this session id when it is not coordinator-titled (the read-only command's `--session`). */
  alsoSession?: string | null;
}

function discoverClaude(sources: BudgetSources, options: DiscoverOptions, problems: string[]): DiscoveredSession[] {
  const root = sources.claudeProjectsDir;
  if (!root) return [];
  const liveMs = (options.liveMinutes ?? COORDINATOR_LIVE_MINUTES) * 60_000;
  let directories: string[];
  try {
    directories = readdirSync(root);
  } catch (error) {
    if (!isMissing(error)) problems.push(`Claude transcripts at ${root} could not be listed: ${errorText(error)}`);
    return [];
  }
  const hint = readStatusLineHint(sources.claudeStatusLinePath);
  const found: DiscoveredSession[] = [];
  for (const directory of directories) {
    const folder = path.join(root, directory);
    let names: string[];
    try {
      names = readdirSync(folder).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue; // a file, or a folder going away
    }
    for (const name of names) {
      const file = path.join(folder, name);
      const fileSessionId = name.slice(0, -".jsonl".length);
      const wanted = options.alsoSession === fileSessionId;
      try {
        const age = options.now.getTime() - statSync(file).mtimeMs;
        if (age > liveMs && !wanted) continue;
        const title = lastClaudeTitle(readTail(file, TITLE_TAIL_BYTES));
        const role = coordinatorRoleOfTitle(title);
        if (!role && !wanted) continue;
        const read = readClaudeTranscript(readFileSync(file, "utf8"), { statusLine: hint });
        found.push({ read: { ...read, title: read.title ?? title, sessionId: read.sessionId ?? fileSessionId }, role, transcript: file, fileAgeMinutes: fileAgeMinutes(file, options.now) });
      } catch (error) {
        if (!isMissing(error)) problems.push(`Claude transcript ${file} could not be read: ${errorText(error)}`);
      }
    }
  }
  return found;
}

function fileAgeMinutes(file: string, now: Date): number {
  try {
    const stats = statSync(file);
    const born = Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs;
    return Math.max(0, (now.getTime() - born) / 60_000);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function codexTitles(codexHome: string, problems: string[]): Map<string, string> {
  const titles = new Map<string, string>();
  const index = path.join(codexHome, "session_index.jsonl");
  let content: string;
  try {
    content = readFileSync(index, "utf8");
  } catch (error) {
    if (!isMissing(error)) problems.push(`Codex session index ${index} could not be read: ${errorText(error)}`);
    return titles;
  }
  for (const line of content.split("\n")) {
    if (line === "") continue;
    try {
      const entry = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
      if (typeof entry.id === "string" && typeof entry.thread_name === "string") titles.set(entry.id, entry.thread_name);
    } catch { /* a torn line */ }
  }
  return titles;
}

function listRollouts(directory: string, depth: number, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory() && depth > 0) listRollouts(full, depth - 1, out);
    else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) out.push(full);
  }
}

function discoverCodex(sources: BudgetSources, options: DiscoverOptions, problems: string[]): DiscoveredSession[] {
  const home = sources.codexHome;
  if (!home) return [];
  const titles = codexTitles(home, problems);
  const liveMs = (options.liveMinutes ?? COORDINATOR_LIVE_MINUTES) * 60_000;
  const wantedIds = new Set([...titles].filter(([, title]) => coordinatorRoleOfTitle(title)).map(([id]) => id));
  if (options.alsoSession) wantedIds.add(options.alsoSession);
  if (wantedIds.size === 0) return [];
  const files: string[] = [];
  listRollouts(path.join(home, "sessions"), 3, files);
  const found: DiscoveredSession[] = [];
  for (const file of files) {
    const id = [...wantedIds].find((candidate) => file.endsWith(`-${candidate}.jsonl`));
    if (!id) continue;
    try {
      const age = options.now.getTime() - statSync(file).mtimeMs;
      if (age > liveMs && id !== options.alsoSession) continue;
      const title = titles.get(id) ?? null;
      const read = readCodexRollout(readFileSync(file, "utf8"), title);
      found.push({ read: { ...read, sessionId: read.sessionId ?? id }, role: coordinatorRoleOfTitle(title), transcript: file, fileAgeMinutes: fileAgeMinutes(file, options.now) });
    } catch (error) {
      if (!isMissing(error)) problems.push(`Codex rollout ${file} could not be read: ${errorText(error)}`);
    }
  }
  return found;
}

/** Every live coordinator on this host, by title, measured from its own file. Read-only. */
export function discoverCoordinators(sources: BudgetSources, options: DiscoverOptions): Discovery {
  const problems: string[] = [];
  const sessions = [...discoverClaude(sources, options, problems), ...discoverCodex(sources, options, problems)]
    .sort((a, b) => sessionKey(a.read.agent, a.read.sessionId).localeCompare(sessionKey(b.read.agent, b.read.sessionId)));
  return { sessions, problems };
}

function budgetDir(workspacePath: string): string {
  return path.join(workspacePath, ".arcadia", BUDGET_DIR);
}

export function markerPath(workspacePath: string, agent: CoordinatorAgent, sessionId: string): string {
  return path.join(budgetDir(workspacePath), `${agent}-${sessionId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

function writeAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try { renameSync(temporary, file); } finally { try { unlinkSync(temporary); } catch { /* renamed */ } }
}

function validPaged(value: unknown): value is Partial<Record<PageLevel, PagedRecord>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([level, entry]) =>
    ["prepare", "due", "forced", "unmeasured"].includes(level)
    && Boolean(entry) && typeof (entry as PagedRecord).pingId === "string" && (entry as PagedRecord).pingId !== ""
    && typeof (entry as PagedRecord).at === "string");
}

/** A state that cannot be read starts over: the outbox's episode key still stops a repeated page. */
function readState(workspacePath: string): { state: CoordinatorBudgetState; problem: string | null } {
  const file = path.join(budgetDir(workspacePath), STATE_FILE);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    return { state: emptyBudgetState(), problem: isMissing(error) ? null : errorText(error) };
  }
  try {
    const value = JSON.parse(raw) as Partial<CoordinatorBudgetState>;
    if (value.schema !== COORDINATOR_BUDGET_SCHEMA) throw new Error("unknown schema");
    if (!value.sessions || typeof value.sessions !== "object") throw new Error("malformed sessions");
    for (const session of Object.values(value.sessions)) {
      if (!session || typeof session.sessionId !== "string" || !validPaged(session.paged)) throw new Error("malformed session entry");
    }
    return { state: { schema: COORDINATOR_BUDGET_SCHEMA, sessions: value.sessions }, problem: null };
  } catch (error) {
    return { state: emptyBudgetState(), problem: errorText(error) };
  }
}

export interface CoordinatorBudgetRow {
  agent: CoordinatorAgent;
  sessionId: string;
  title: string | null;
  role: CoordinatorRole | null;
  model: string | null;
  level: BudgetLevel;
  handoffDue: boolean;
  percent: number | null;
  tokens: number | null;
  window: number | null;
  unmeasuredReason: string | null;
  transcript: string;
  marker: string | null;
  /** This run's page, when one was queued. */
  page: PageLevel | null;
  pingId: string | null;
  message: string | null;
  pings: Partial<Record<PageLevel, PagedRecord>>;
}

export interface CoordinatorBudgetCheckData {
  coordinators: CoordinatorBudgetRow[];
  problems: string[];
}

export interface CoordinatorBudgetDependencies {
  now?: () => number;
  sources?: BudgetSources;
  queuePing?: (input: LivenessPingInput) => { id: string };
}

export interface CoordinatorBudgetCheckOptions {
  workspace?: string;
  dashboardUrl?: string;
}

function rowOf(found: DiscoveredSession, marker: string | null, pings: Partial<Record<PageLevel, PagedRecord>>): CoordinatorBudgetRow {
  const { read } = found;
  const level = levelOf(read.occupancy);
  return {
    agent: read.agent,
    sessionId: read.sessionId,
    title: read.title,
    role: found.role,
    model: read.model,
    level,
    handoffDue: handoffDue(level),
    percent: read.occupancy.kind === "measured" ? Math.round(read.occupancy.percent * 10) / 10 : null,
    tokens: read.occupancy.kind === "measured" ? read.occupancy.tokens : null,
    window: read.occupancy.kind === "measured" ? read.occupancy.window : null,
    unmeasuredReason: read.occupancy.kind === "unmeasured" ? read.occupancy.reason : null,
    transcript: found.transcript,
    marker,
    page: null,
    pingId: null,
    message: null,
    pings
  };
}

function queueThroughPing(input: LivenessPingInput): { id: string } {
  return runPingSendCommand(input).data.ping;
}

/**
 * One timer run: measure every live coordinator, page each new threshold
 * once, and keep each coordinator's marker current. A ping that fails leaves
 * that session's paged set as it was, so the next run retries it, while the
 * other sessions still move on; failures are thrown last, so launchd's log and
 * the exit code carry them.
 */
export function runCoordinatorBudgetCheck(
  options: CoordinatorBudgetCheckOptions,
  dependencies: CoordinatorBudgetDependencies = {}
): CommandSuccess<CoordinatorBudgetCheckData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = new Date((dependencies.now ?? Date.now)());
  const sources = dependencies.sources ?? defaultBudgetSources();
  const { state, problem: stateProblem } = readState(workspacePath);
  const discovery = discoverCoordinators(sources, { now });
  const queue = dependencies.queuePing ?? queueThroughPing;
  const failures: string[] = [];
  const next: CoordinatorBudgetState = { schema: COORDINATOR_BUDGET_SCHEMA, sessions: {} };
  const rows: CoordinatorBudgetRow[] = [];

  for (const found of discovery.sessions) {
    if (!found.role) continue;
    const { read } = found;
    const key = sessionKey(read.agent, read.sessionId);
    const previous = state.sessions[key];
    const decision = decidePage(previous, read, { fileAgeMinutes: found.fileAgeMinutes });
    let paged = decision.paged;
    let page: PageLevel | null = null;
    let pingId: string | null = null;
    let message: string | null = null;
    if (decision.page) {
      const outgoing = budgetPingMessage(read, decision.page);
      try {
        pingId = queue({
          workspace: workspacePath,
          message: outgoing,
          kind: "attention",
          link: dashboardLink(options.dashboardUrl, "/production"),
          agent: PING_AGENT,
          episodeKey: budgetEpisodeKey(read.agent, read.sessionId, decision.page),
          episodeAfter: read.episodeStart,
          now
        }).id;
        paged = markPaged(paged, decision.page, { pingId, at: now.toISOString() });
        page = decision.page;
        message = outgoing;
      } catch (error) {
        failures.push(`The ${decision.page} page for ${key} was not queued and will be retried on the next run: ${errorText(error)}`);
        paged = previous && previous.episodeStart === read.episodeStart ? previous.paged : {};
      }
    }
    const level = levelOf(read.occupancy);
    const marker = markerPath(workspacePath, read.agent, read.sessionId);
    const row = rowOf(found, level === "ok" ? null : marker, paged);
    try {
      if (level === "ok") {
        if (existsSync(marker)) unlinkSync(marker);
      } else {
        const body: CoordinatorBudgetMarker = {
          schema: COORDINATOR_BUDGET_SCHEMA,
          agent: read.agent,
          session_id: read.sessionId,
          title: read.title,
          role: found.role,
          level,
          handoff_due: handoffDue(level),
          percent: row.percent,
          tokens: row.tokens,
          window: row.window,
          unmeasured_reason: row.unmeasuredReason,
          measured_at: now.toISOString(),
          transcript: found.transcript,
          next_step: nextStepFor(level),
          pings: paged
        };
        writeAtomic(marker, body);
      }
    } catch (error) {
      failures.push(`The budget marker for ${key} could not be written: ${errorText(error)}`);
    }
    next.sessions[key] = { agent: read.agent, sessionId: read.sessionId, title: read.title, episodeStart: read.episodeStart, paged, lastSeen: now.toISOString() };
    rows.push({ ...row, page, pingId, message });
  }

  // Keep a week of sessions not seen this run, so a coordinator that pauses past the live window never pages a threshold twice.
  for (const [key, session] of Object.entries(state.sessions)) {
    if (next.sessions[key]) continue;
    if (now.getTime() - Date.parse(session.lastSeen) < STATE_RETENTION_MS) next.sessions[key] = session;
  }
  const stateFile = path.join(budgetDir(workspacePath), STATE_FILE);
  if (stateProblem !== null || JSON.stringify(stripSeen(next)) !== JSON.stringify(stripSeen(state))) {
    try { writeAtomic(stateFile, next); } catch (error) { failures.push(`The coordinator budget state could not be written: ${errorText(error)}`); }
  }
  if (stateProblem !== null) failures.push(`The coordinator budget state file was unreadable and has been replaced: ${stateProblem}`);
  failures.push(...discovery.problems);
  if (failures.length > 0) {
    const queued = rows.filter((row) => row.message).map((row) => `queued ping ${row.pingId}: ${row.message}`);
    throw validationError([...failures, ...queued].join(" "));
  }
  return createSuccess({ command: "production.coordinator-budget", workspace: workspacePath, data: { coordinators: rows, problems: discovery.problems } });
}

/** `lastSeen` moves every run; the file is rewritten only when something else changed, or hourly so retention works. */
function stripSeen(state: CoordinatorBudgetState): unknown {
  return Object.fromEntries(Object.entries(state.sessions).map(([key, session]) => [key, { ...session, lastSeen: session.lastSeen.slice(0, 13) }]));
}

export function renderCoordinatorBudgetCheckLines(data: CoordinatorBudgetCheckData, stamp = new Date().toISOString()): string[] {
  return data.coordinators.filter((row) => row.message).map((row) => `${stamp} queued ping ${row.pingId}: ${row.message}`);
}

export interface CoordinatorBudgetViewOptions {
  workspace?: string;
  session?: string;
}

export interface CoordinatorBudgetViewData {
  /** The session asking: `--session`, else the host's own session id from the environment. */
  self: string | null;
  selfRow: CoordinatorBudgetRow | null;
  coordinators: CoordinatorBudgetRow[];
  problems: string[];
}

function readMarker(file: string): CoordinatorBudgetMarker | null {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as CoordinatorBudgetMarker;
    return value.schema === COORDINATOR_BUDGET_SCHEMA ? value : null;
  } catch {
    return null;
  }
}

/**
 * `arcadia coordinator budget`: measure every live coordinator now and show
 * the pages already sent, from the timer's markers. Read-only: it writes no
 * file, row or ping. A coordinator runs it at each wake; `--session` defaults
 * to the host's own session id (CLAUDE_CODE_SESSION_ID or CODEX_THREAD_ID).
 */
export function runCoordinatorBudgetCommand(
  options: CoordinatorBudgetViewOptions,
  dependencies: { now?: () => number; sources?: BudgetSources; env?: NodeJS.ProcessEnv } = {}
): CommandSuccess<CoordinatorBudgetViewData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const env = dependencies.env ?? process.env;
  const now = new Date((dependencies.now ?? Date.now)());
  const self = options.session?.trim() || env["CLAUDE_CODE_SESSION_ID"]?.trim() || env["CODEX_THREAD_ID"]?.trim() || null;
  if (self !== null && !/^[A-Za-z0-9._-]{1,128}$/.test(self)) throw validationError("--session must be a session id.", { session: self });
  const discovery = discoverCoordinators(dependencies.sources ?? defaultBudgetSources(env), { now, alsoSession: self });
  const rows = discovery.sessions.map((found) => {
    const marker = markerPath(workspacePath, found.read.agent, found.read.sessionId);
    const written = readMarker(marker);
    return rowOf(found, written ? marker : null, written?.pings ?? {});
  });
  const selfRow = self ? rows.find((row) => row.sessionId === self) ?? null : null;
  return createSuccess({
    command: "coordinator.budget",
    workspace: workspacePath,
    data: { self, selfRow, coordinators: rows.filter((row) => row.role !== null), problems: discovery.problems }
  });
}

function describe(row: CoordinatorBudgetRow): string {
  const name = row.title ?? `${row.agent} session`;
  const reading = row.percent !== null && row.tokens !== null && row.window !== null
    ? `${Math.floor(row.percent)}% context (${row.tokens.toLocaleString("en-US")} of ${row.window.toLocaleString("en-US")} tokens)`
    : `context unmeasured (${row.unmeasuredReason ?? "unknown"})`;
  const pinged = Object.keys(row.pings);
  return `${name} [${row.agent} ${row.sessionId}]: ${reading} · ${row.level}${pinged.length > 0 ? ` · paged: ${pinged.join(", ")}` : ""}`;
}

export function renderCoordinatorBudgetSuccess(response: CommandSuccess<CoordinatorBudgetViewData>): string[] {
  const { self, selfRow, coordinators, problems } = response.data;
  const lines: string[] = [];
  if (selfRow) {
    const banner = selfRow.level === "ok" ? "Budget OK" : selfRow.level === "prepare" ? "👆 HANDOFF PREPARE" : selfRow.level === "forced" ? "👆👆👆 HANDOFF OVERDUE" : "👆👆 HANDOFF DUE";
    lines.push(`${banner} for this session: ${describe(selfRow)}. ${nextStepFor(selfRow.level)}`);
  } else if (self) {
    lines.push(`This session (${self}) has no transcript this command can read, so its budget is unmeasured.`);
  }
  if (coordinators.length === 0) lines.push(`No live coordinator (a ⭐ or 🚦 title, written to within ${COORDINATOR_LIVE_MINUTES} min) was found.`);
  for (const row of coordinators) lines.push(`- ${describe(row)}`);
  for (const problem of problems) lines.push(`Problem: ${problem}`);
  return lines;
}
