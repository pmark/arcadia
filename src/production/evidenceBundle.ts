import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { sessionLogPath } from "../sessions/sessionRecording.js";
import { redactSecrets, sanitizeOutput } from "../sessions/validationEvidence.js";
import { redactUrlUserinfo } from "../timeline/collectors/git.js";

/**
 * The evidence bundle written with a red alert: what a later session needs to
 * cut a replay fixture once the moment has passed. A review stop gets its
 * verdict, report and saved prompt; every alert gets the worker log tail; a
 * hang gets a process tree plus `sample` and `lsof` of any child older than 5s
 * (the signature #2084 could not record).
 *
 * Read-only on the host: it never signals a process, restarts anything, calls a
 * model or sends a message. It writes only under
 * `<workspace>/artifacts/generated/red-alerts/`.
 *
 * Best effort and bounded: every read has a size cap, every external command a
 * timeout and a shared wall-clock budget. Nothing here throws. A capture that
 * fails is written down as a stated failure, so an absent file is never
 * ambiguous.
 *
 * Lock safety: `collectHangEvidence` refuses to spawn while the connection it
 * is given is inside a transaction, and `raiseRedAlert` calls it after its own
 * autocommit writes, so a slow `sample` can never hold the write lock.
 */

export const RED_ALERT_EVIDENCE_DIRECTORY = path.join("artifacts", "generated", "red-alerts");
const BUNDLE_SCHEMA = "arcadia-red-alert-bundle/v1";
const HANG_SCHEMA = "arcadia-hang-evidence/v1";

/** A saved report or prompt copied into the bundle; the original stays in place under `artifacts/`. */
export const BUNDLE_FILE_MAX_BYTES = 256 * 1024;
export const LOG_TAIL_MAX_BYTES = 64 * 1024;
const COMMAND_OUTPUT_MAX_BYTES = 256 * 1024;
/** `ps` is parsed whole and only the root's subtree is kept, so its read cap is wider than what is written. */
const PROCESS_TABLE_MAX_BYTES = 4 * 1024 * 1024;
const MANIFEST_STRING_MAX_CHARS = 64 * 1024;
const ATTEMPT_LISTING_MAX_ENTRIES = 64;

/** The age past which a child reads as hung: #2084's reader was 0.8s at most under stress. */
export const HANG_CHILD_MIN_AGE_MS = 5_000;
export const SAMPLE_DURATION_SECONDS = 1;

export interface HangEvidenceLimits {
  minChildAgeMs: number;
  /** Children sampled, leaves first; the rest are counted in `omittedChildren`. */
  maxChildren: number;
  /** Wall clock for the whole collection; no command outlives what remains of it. */
  budgetMs: number;
  processTableTimeoutMs: number;
  lsofTimeoutMs: number;
  /** Duration plus symbolication: about 2s for a small binary, 9s for Node on a loaded host. */
  sampleTimeoutMs: number;
}

export const DEFAULT_HANG_EVIDENCE_LIMITS: Readonly<HangEvidenceLimits> = Object.freeze({
  minChildAgeMs: HANG_CHILD_MIN_AGE_MS,
  maxChildren: 3,
  budgetMs: 12_000,
  processTableTimeoutMs: 2_000,
  lsofTimeoutMs: 2_000,
  sampleTimeoutMs: 10_000
});

/**
 * Fixed, not inherited: a caller's PATH must not choose what the worker runs
 * (CWE-427), and these are where `ps`, `lsof` and `sample` live.
 */
const SYSTEM_COMMAND_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export type CaptureStatus = "captured" | "unavailable" | "failed" | "timed_out" | "skipped";

/** One piece of evidence, or the stated reason it is missing. `file` is relative to the bundle or hang directory. */
export interface CapturedItem {
  status: CaptureStatus;
  file: string | null;
  source: string | null;
  sourceBytes: number | null;
  truncated: boolean;
  note: string | null;
}

export interface HangProcess {
  pid: number;
  ppid: number;
  ageMs: number | null;
  stat: string;
  /** Executable only (`ps -o comm=`): arguments and environment can carry secrets, so they are never read. */
  command: string;
  depth: number;
}

export interface HangTarget {
  pid: number;
  role: "child" | "root";
  command: string;
  ageMs: number | null;
  lsof: CapturedItem;
  sample: CapturedItem;
}

export interface HangEvidence {
  schema: typeof HANG_SCHEMA;
  status: "captured" | "skipped" | "failed";
  note: string | null;
  rootPid: number | null;
  directory: string | null;
  capturedAt: string;
  elapsedMs: number;
  limits: HangEvidenceLimits;
  processTree: CapturedItem;
  processes: HangProcess[];
  targets: HangTarget[];
  omittedChildren: number;
}

export interface HangEvidenceInput {
  workspace: string;
  /** Names the evidence directory under `artifacts/generated/red-alerts/`: the alert id and episode, or the liveness episode. */
  label: string;
  /** The process to walk: the worker for a liveness alert, the pane process for a stalled Session. */
  rootPid: number | null;
  /** Pass the connection in hand: inside a transaction nothing is spawned, and that is stated. */
  db?: Pick<Database.Database, "inTransaction">;
  now?: Date;
  limits?: Partial<HangEvidenceLimits>;
  /** Test seam; defaults to the fixed system path. */
  searchPath?: string;
}

const emptyItem = (status: CaptureStatus, note: string): CapturedItem => ({ status, file: null, source: null, sourceBytes: null, truncated: false, note });

const errorText = (error: unknown): string => scrubText(error instanceof Error ? error.message : String(error));

/* ------------------------------------------------------------------------ */
/* Scrubbing.                                                                */
/* ------------------------------------------------------------------------ */

/** Forms `redactSecrets` leaves alone: a quoted JSON value and a space-separated command-line flag. */
const EXTRA_SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/("[A-Za-z0-9_-]{0,64}(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY)[A-Za-z0-9_-]{0,64}"[ \t]{0,8}:[ \t]{0,8}")[^"]{4,}"/gi, '$1[redacted]"'],
  [/(--?[a-z-]{0,32}(?:token|secret|password|passwd|api-?key)[a-z-]{0,32}[= ]+)[^\s"']{8,}/gi, "$1[redacted]"],
  // A private key whose BEGIN line fell outside the window: a complete key is already gone by this point.
  [/^[\s\S]*-----END [A-Z0-9 ]*PRIVATE KEY-----/, "[redacted private key]"]
];

/** Every text written into a bundle passes through here. Defence in depth, not a guarantee. */
export function scrubText(raw: string): string {
  let text = redactUrlUserinfo(redactSecrets(sanitizeOutput(raw)));
  for (const [pattern, replacement] of EXTRA_SECRET_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    const text = scrubText(value);
    return text.length <= MANIFEST_STRING_MAX_CHARS ? text : `${text.slice(0, MANIFEST_STRING_MAX_CHARS)}… [truncated]`;
  }
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubValue(entry)]));
  return value;
}

/* ------------------------------------------------------------------------ */
/* Bounded reads and external commands.                                      */
/* ------------------------------------------------------------------------ */

interface BoundedRead {
  text: string;
  sourceBytes: number;
  truncated: boolean;
}

/**
 * At most `maxBytes` of a regular file, from its start or its end, cut back to
 * a whole line so a secret split by the cut cannot pass the patterns as a
 * fragment. A symlink, FIFO or directory is refused: opening a FIFO could block.
 * `worker.log` is never rotated, so nothing here reads a whole file blindly.
 */
function readBounded(filePath: string, maxBytes: number, from: "start" | "end"): BoundedRead {
  const fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("not a regular file");
    const length = Math.min(stat.size, maxBytes);
    const truncated = stat.size > maxBytes;
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, from === "start" ? 0 : stat.size - length);
    let text = buffer.subarray(0, read).toString("utf8");
    if (truncated && from === "end") {
      const newline = text.indexOf("\n");
      text = newline >= 0 ? text.slice(newline + 1) : text.replace(/^\S*\s?/, "");
    } else if (truncated) {
      const newline = text.lastIndexOf("\n");
      text = newline >= 0 ? text.slice(0, newline + 1) : text.replace(/\s?\S*$/, "");
    }
    return { text, sourceBytes: stat.size, truncated };
  } finally {
    closeSync(fd);
  }
}

function copyBounded(input: { source: string; directory: string; file: string; maxBytes: number; from: "start" | "end"; sourceLabel: string }): CapturedItem {
  try {
    const read = readBounded(input.source, input.maxBytes, input.from);
    writeFileSync(path.join(input.directory, input.file), scrubText(read.text), { mode: 0o600 });
    return {
      status: "captured",
      file: input.file,
      source: input.sourceLabel,
      sourceBytes: read.sourceBytes,
      truncated: read.truncated,
      note: read.truncated ? `Kept ${input.from === "start" ? "the first" : "the last"} ${input.maxBytes} bytes of ${read.sourceBytes}, cut to a whole line.` : null
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...emptyItem("unavailable", "The file does not exist."), source: input.sourceLabel };
    return { ...emptyItem("failed", `Could not read it: ${errorText(error)}`), source: input.sourceLabel };
  }
}

interface CommandSpec {
  command: string;
  args: string[];
  timeoutMs: number;
  /** The final, scrubbed file, relative to the directory. */
  file: string;
  /** Where the command itself writes its result, if not its stdout. */
  resultFile?: string;
  maxBytes: number;
  absentNote: string;
}

function runBounded(directory: string, searchPath: string, spec: CommandSpec): { item: CapturedItem; output: string | null } {
  const rawPath = path.join(directory, `${spec.file}.raw`);
  const failed = (status: CaptureStatus, note: string): { item: CapturedItem; output: null } => ({ item: { ...emptyItem(status, note), source: spec.command }, output: null });
  let fd: number | null = null;
  try {
    fd = openSync(rawPath, "w", 0o600);
    // Output goes to a regular file, not a pipe: with a pipe, spawnSync waits for EOF, so a
    // grandchild that keeps stdout open would outlive the timeout and block the tick.
    // The environment is a fixed minimum, so nothing it holds can reach a child or its output.
    const result = spawnSync(spec.command, spec.args, {
      stdio: ["ignore", fd, fd],
      timeout: spec.timeoutMs,
      killSignal: "SIGKILL",
      env: Object.assign({} as NodeJS.ProcessEnv, { PATH: searchPath, LC_ALL: "C" })
    });
    closeSync(fd);
    fd = null;
    const spawnError: NodeJS.ErrnoException | undefined = result.error;
    const code = spawnError?.code;
    if (code === "ENOENT") return failed("unavailable", spec.absentNote);
    if (code === "ETIMEDOUT") return failed("timed_out", `\`${spec.command}\` did not finish within ${spec.timeoutMs}ms and was stopped.`);
    if (result.error) return failed("failed", `\`${spec.command}\` could not run: ${errorText(result.error)}`);
    const source = spec.resultFile ? path.join(directory, spec.resultFile) : rawPath;
    if (result.status !== 0) {
      const said = readBounded(rawPath, 512, "start").text.trim().split("\n")[0] ?? "";
      return failed("failed", `\`${spec.command}\` exited ${result.status ?? `on ${result.signal}`}${said ? `: ${scrubText(said)}` : ""}.`);
    }
    const read = readBounded(source, spec.maxBytes, "start");
    const output = scrubText(read.text);
    writeFileSync(path.join(directory, spec.file), output, { mode: 0o600 });
    return {
      item: {
        status: "captured",
        file: spec.file,
        source: spec.command,
        sourceBytes: read.sourceBytes,
        truncated: read.truncated,
        note: read.truncated ? `Kept the first ${spec.maxBytes} bytes of ${read.sourceBytes}, cut to a whole line.` : null
      },
      output
    };
  } catch (error) {
    return failed("failed", `\`${spec.command}\` capture failed: ${errorText(error)}`);
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
    try { rmSync(rawPath, { force: true }); } catch { /* best effort */ }
    if (spec.resultFile && spec.resultFile !== spec.file) {
      try { rmSync(path.join(directory, spec.resultFile), { force: true }); } catch { /* best effort */ }
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Hang evidence.                                                            */
/* ------------------------------------------------------------------------ */

/** `[[dd-]hh:]mm:ss`, as `ps -o etime=` prints it on macOS and Linux. */
export function parseElapsedMs(value: string): number | null {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  return (Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds)) * 1_000;
}

function parseProcessTable(output: string): Array<Omit<HangProcess, "depth">> {
  const rows: Array<Omit<HangProcess, "depth">> = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), ageMs: parseElapsedMs(match[3]), stat: match[4], command: match[5].trim() });
  }
  return rows;
}

/** The root and its descendants, parents before children. A pid that was reused into a cycle is visited once. */
function subtree(rows: ReadonlyArray<Omit<HangProcess, "depth">>, rootPid: number): HangProcess[] {
  const root = rows.find((row) => row.pid === rootPid);
  if (!root) return [];
  const byParent = new Map<number, Array<Omit<HangProcess, "depth">>>();
  for (const row of rows) byParent.set(row.ppid, [...(byParent.get(row.ppid) ?? []), row]);
  const seen = new Set<number>();
  const result: HangProcess[] = [];
  const stack: HangProcess[] = [{ ...root, depth: 0 }];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next.pid)) continue;
    seen.add(next.pid);
    result.push(next);
    for (const child of (byParent.get(next.pid) ?? []).slice().reverse()) stack.push({ ...child, depth: next.depth + 1 });
  }
  return result;
}

const renderProcessTree = (rootPid: number, processes: readonly HangProcess[], minChildAgeMs: number): string =>
  [
    `Process tree under pid ${rootPid}, executable names only (arguments and environment are not read).`,
    `Children older than ${minChildAgeMs}ms are sampled.`,
    "",
    "PID PPID AGE_MS STAT COMMAND",
    ...processes.map((row) => `${"  ".repeat(row.depth)}${row.pid} ${row.ppid} ${row.ageMs ?? "?"} ${row.stat} ${row.command}`),
    ""
  ].join("\n");

function safeLabel(label: string): string {
  const safe = label.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^\.+/, "");
  return safe.length > 0 ? safe.slice(0, 120) : "hang";
}

/**
 * Process tree, then `lsof` and `sample` of every descendant of `rootPid` older
 * than the limit (leaves first, since the hung reader is a leaf), then the root
 * itself. Writes `artifacts/generated/red-alerts/<label>/hang/` including
 * `hang-evidence.json`, and returns the same record. Never throws.
 *
 * Runs in one line from anywhere that knows a pid, so a liveness check outside
 * the worker can call it: `collectHangEvidence({ workspace, label, rootPid: workerPid })`.
 */
export function collectHangEvidence(input: HangEvidenceInput): HangEvidence {
  const startedAt = Date.now();
  const limits: HangEvidenceLimits = { ...DEFAULT_HANG_EVIDENCE_LIMITS, ...input.limits };
  const evidence: HangEvidence = {
    schema: HANG_SCHEMA,
    status: "skipped",
    note: null,
    rootPid: input.rootPid,
    directory: null,
    capturedAt: (input.now ?? new Date(startedAt)).toISOString(),
    elapsedMs: 0,
    limits,
    processTree: emptyItem("skipped", "Not attempted."),
    processes: [],
    targets: [],
    omittedChildren: 0
  };
  let directory: string | null = null;
  try {
    directory = path.join(input.workspace, RED_ALERT_EVIDENCE_DIRECTORY, safeLabel(input.label), "hang");
    mkdirSync(directory, { recursive: true });
    evidence.directory = directory;
    collectInto(directory, input, limits, evidence, startedAt);
  } catch (error) {
    evidence.status = "failed";
    evidence.note = `Hang evidence capture failed: ${errorText(error)}`;
  }
  evidence.elapsedMs = Date.now() - startedAt;
  if (directory) {
    try {
      writeFileSync(path.join(directory, "hang-evidence.json"), `${JSON.stringify(scrubValue(evidence), null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      evidence.status = "failed";
      evidence.note = `${evidence.note ? `${evidence.note} ` : ""}The record could not be written: ${errorText(error)}`;
    }
  }
  return evidence;
}

function collectInto(directory: string, input: HangEvidenceInput, limits: HangEvidenceLimits, evidence: HangEvidence, startedAt: number): void {
  const { rootPid } = input;
  if (input.db?.inTransaction) {
    evidence.note = "Skipped: the caller is inside a database transaction, and spawning here could hold the write lock for seconds.";
    return;
  }
  // Pid 1 is every process on the host; 0 and negatives are process groups to the tools.
  if (rootPid === null || !Number.isInteger(rootPid) || rootPid <= 1) {
    evidence.note = rootPid === null ? "Skipped: no live process is known for this alert." : `Skipped: ${rootPid} is not a process this can examine.`;
    return;
  }
  const searchPath = input.searchPath ?? SYSTEM_COMMAND_PATH;
  const remaining = (): number => limits.budgetMs - (Date.now() - startedAt);
  const budgetNote = `The ${limits.budgetMs}ms capture budget ran out first.`;

  const table = runBounded(directory, searchPath, {
    command: "ps",
    // `comm` never includes arguments, and no `-E`/`e`: `ps` can carry secrets in both.
    // One `-o` per column: on Linux a `=` takes the rest of its argument as the header.
    args: ["-A", "-o", "pid=", "-o", "ppid=", "-o", "etime=", "-o", "stat=", "-o", "comm="],
    timeoutMs: Math.max(1, Math.min(limits.processTableTimeoutMs, remaining())),
    file: "process-table.txt",
    maxBytes: PROCESS_TABLE_MAX_BYTES,
    absentNote: "`ps` is not on this host."
  });
  // The whole host's table is only an input: what stays is this root's subtree.
  try { rmSync(path.join(directory, "process-table.txt"), { force: true }); } catch { /* best effort */ }
  if (table.output === null) {
    evidence.status = "failed";
    evidence.processTree = table.item;
    evidence.note = "No process table, so no child could be chosen to sample.";
    return;
  }
  evidence.processes = subtree(parseProcessTable(table.output), rootPid);
  if (evidence.processes.length === 0) {
    evidence.processTree = { ...emptyItem("unavailable", `Pid ${rootPid} is not in the process table: it has exited.`), source: "ps" };
    evidence.note = "The process was gone before it could be examined.";
    return;
  }
  evidence.status = "captured";
  writeFileSync(path.join(directory, "process-tree.txt"), scrubText(renderProcessTree(rootPid, evidence.processes, limits.minChildAgeMs)), { mode: 0o600 });
  evidence.processTree = { ...table.item, file: "process-tree.txt", note: table.item.truncated ? "The process table was cut at its read cap, so this tree may be incomplete." : null };

  const parents = new Set(evidence.processes.map((row) => row.ppid));
  const children = evidence.processes
    .filter((row) => row.pid !== rootPid && row.pid !== process.pid && row.ageMs !== null && row.ageMs >= limits.minChildAgeMs)
    .sort((a, b) => Number(parents.has(a.pid)) - Number(parents.has(b.pid)) || (b.ageMs ?? 0) - (a.ageMs ?? 0));
  const chosen = children.slice(0, limits.maxChildren);
  evidence.omittedChildren = children.length - chosen.length;
  if (children.length === 0) evidence.note = `No child is older than ${limits.minChildAgeMs}ms.`;

  // A process sampling itself only records this code waiting on `sample`, so the root is included only from outside it.
  const rootRow = evidence.processes[0];
  const targets: HangTarget[] = [
    ...chosen.map((row): HangTarget => ({ pid: row.pid, role: "child", command: row.command, ageMs: row.ageMs, lsof: emptyItem("skipped", budgetNote), sample: emptyItem("skipped", budgetNote) })),
    ...(rootPid === process.pid ? [] : [{ pid: rootPid, role: "root" as const, command: rootRow.command, ageMs: rootRow.ageMs, lsof: emptyItem("skipped", budgetNote), sample: emptyItem("skipped", budgetNote) }])
  ];
  evidence.targets = targets;

  // Every `lsof` first: it is quick, so a slow `sample` cannot cost the open-file list that identified #2084's reader.
  for (const target of targets) {
    const left = remaining();
    if (left <= 0) continue;
    target.lsof = runBounded(directory, searchPath, {
      command: "lsof",
      // Open files only: `lsof` prints the command name, never its arguments or environment.
      args: ["-nP", "-w", "-p", String(target.pid)],
      timeoutMs: Math.min(limits.lsofTimeoutMs, left),
      file: `lsof-${target.pid}.txt`,
      maxBytes: COMMAND_OUTPUT_MAX_BYTES,
      absentNote: "`lsof` is not on this host."
    }).item;
  }
  for (const target of targets) {
    const left = remaining();
    if (left <= 0) continue;
    const resultFile = `sample-${target.pid}.result`;
    target.sample = runBounded(directory, searchPath, {
      command: "sample",
      args: [String(target.pid), String(SAMPLE_DURATION_SECONDS), "-mayDie", "-file", path.join(directory, resultFile)],
      timeoutMs: Math.min(limits.sampleTimeoutMs, left),
      file: `sample-${target.pid}.txt`,
      resultFile,
      maxBytes: COMMAND_OUTPUT_MAX_BYTES,
      absentNote: "`sample` is not on this host: it ships with macOS only."
    }).item;
  }
}

/* ------------------------------------------------------------------------ */
/* The bundle.                                                               */
/* ------------------------------------------------------------------------ */

export interface BundleAlert {
  id: string;
  episode: number;
  trigger: string;
  projectSlug: string;
  actionKey: string | null;
  sessionId: string | null;
  firstSeenAt: string;
  detail: string;
  requestId: string;
}

/** Hang capture for this alert. Present only where a stuck process is the failure. */
export interface HangCaptureRequest {
  rootPid: () => number | null;
  limits?: Partial<HangEvidenceLimits>;
  /** Test seam; defaults to the fixed system path. */
  searchPath?: string;
}

export interface EvidenceBundleInput {
  db: Database.Database;
  workspace: string;
  alert: BundleAlert;
  /** The repair outcome this stop carries, so a later row of another outcome is not read as the stop. */
  stopOutcome?: string | null;
  hang?: HangCaptureRequest;
  now: Date;
}

export interface EvidenceBundleResult {
  status: "written" | "failed";
  note: string | null;
  directory: string;
  manifestFile: string | null;
  reviewStop: unknown;
  reportFile: CapturedItem;
  promptFile: CapturedItem;
  workerLog: CapturedItem;
  sessionLog: CapturedItem | null;
  hang: HangEvidence | null;
}

interface RepairRow {
  request_id: string;
  action_key: string;
  policy_epoch: number;
  round: number;
  failed_session_id: string;
  failed_branch: string;
  failed_head: string;
  start_revision: string;
  pull_request_url: string | null;
  role: string;
  verdict: string;
  summary: string;
  report_path: string | null;
  findings_json: string;
  failed_checks_json: string;
  outcome: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonField(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { unreadable: true, text: value };
  }
}

/** The stop as the repair loop recorded it: its row in `production_review_repairs` and its `production_operator_escalations` entry. */
function readReviewStop(db: Database.Database, actionKey: string, stopOutcome: string | null | undefined): { row: RepairRow | null; escalations: unknown[]; note: string | null } {
  let row: RepairRow | null = null;
  const notes: string[] = [];
  try {
    row = (stopOutcome
      ? db.prepare("SELECT * FROM production_review_repairs WHERE action_key = ? AND outcome = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(actionKey, stopOutcome)
      : db.prepare("SELECT * FROM production_review_repairs WHERE action_key = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1").get(actionKey)) as RepairRow | undefined ?? null;
  } catch (error) {
    notes.push(`The repair record could not be read: ${errorText(error)}`);
  }
  let escalations: unknown[] = [];
  try {
    escalations = db.prepare("SELECT kind, message, remedy, first_detected_at, last_seen_at FROM production_operator_escalations WHERE action_key = ?").all(actionKey);
  } catch (error) {
    notes.push(`The escalation record could not be read: ${errorText(error)}`);
  }
  return { row, escalations, note: notes.length > 0 ? notes.join(" ") : null };
}

/** A path from the database reaches the bundle only if it resolves inside this workspace's `artifacts/`. */
function resolveArtifact(workspace: string, recorded: string): string | null {
  try {
    const root = realpathSync(path.join(workspace, "artifacts"));
    const resolved = realpathSync(path.resolve(workspace, recorded));
    return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
  } catch {
    return null;
  }
}

function listSavedAttempt(directory: string): Array<{ name: string; bytes: number }> {
  return readdirSync(directory)
    .sort()
    .slice(0, ATTEMPT_LISTING_MAX_ENTRIES)
    .flatMap((name) => {
      const stat = lstatSync(path.join(directory, name));
      return stat.isFile() ? [{ name, bytes: stat.size }] : [];
    });
}

function captureSavedAttempt(workspace: string, directory: string, reportPath: string | null): {
  report: CapturedItem;
  prompt: CapturedItem;
  savedAttempt: { directory: string; files: Array<{ name: string; bytes: number }> } | null;
} {
  if (!reportPath) {
    const note = "The verdict recorded no report path.";
    return { report: emptyItem("unavailable", note), prompt: emptyItem("unavailable", note), savedAttempt: null };
  }
  const resolved = resolveArtifact(workspace, reportPath);
  if (!resolved) {
    const report = { ...emptyItem("unavailable", "The report is missing, or resolves outside this workspace's artifacts directory, so it was not read."), source: scrubText(reportPath) };
    return { report, prompt: emptyItem("unavailable", "Saved beside the report, which could not be located."), savedAttempt: null };
  }
  const attemptDirectory = path.dirname(resolved);
  const label = path.dirname(reportPath);
  const report = copyBounded({ source: resolved, directory, file: "verdict-report.md", maxBytes: BUNDLE_FILE_MAX_BYTES, from: "start", sourceLabel: reportPath });
  const prompt = copyBounded({ source: path.join(attemptDirectory, "prompt.md"), directory, file: "prompt.md", maxBytes: BUNDLE_FILE_MAX_BYTES, from: "start", sourceLabel: path.join(label, "prompt.md") });
  let files: Array<{ name: string; bytes: number }> = [];
  try { files = listSavedAttempt(attemptDirectory); } catch { /* the copies above already state what could not be read */ }
  return { report, prompt, savedAttempt: { directory: label, files } };
}

/**
 * Write `<alert id>-e<episode>/` beside the alert's evidence file. Called after
 * the alert and its notification are recorded, so a capture that fails, or a
 * worker killed in the middle of one, costs only the capture. Never throws.
 */
export function writeEvidenceBundle(input: EvidenceBundleInput): EvidenceBundleResult {
  const { alert, workspace } = input;
  const directory = path.join(workspace, RED_ALERT_EVIDENCE_DIRECTORY, `${alert.id}-e${alert.episode}`);
  const notAttempted = emptyItem("skipped", "Not attempted.");
  const result: EvidenceBundleResult = {
    status: "failed",
    note: null,
    directory,
    manifestFile: null,
    reviewStop: null,
    reportFile: notAttempted,
    promptFile: notAttempted,
    workerLog: notAttempted,
    sessionLog: null,
    hang: null
  };
  try {
    mkdirSync(directory, { recursive: true });
    const noAction = "This alert names no Action, so there is no verdict to read.";
    let savedAttempt: ReturnType<typeof captureSavedAttempt>["savedAttempt"] = null;
    let stopNote: string | null = null;
    result.reportFile = emptyItem("unavailable", noAction);
    result.promptFile = emptyItem("unavailable", noAction);
    if (alert.actionKey) {
      const stop = readReviewStop(input.db, alert.actionKey, input.stopOutcome);
      stopNote = stop.note;
      if (stop.row) {
        const { findings_json: findings, failed_checks_json: failedChecks, ...row } = stop.row;
        result.reviewStop = { ...row, findings: parseJsonField(findings), failed_checks: parseJsonField(failedChecks), escalations: stop.escalations };
        const saved = captureSavedAttempt(workspace, directory, stop.row.report_path);
        result.reportFile = saved.report;
        result.promptFile = saved.prompt;
        savedAttempt = saved.savedAttempt;
      } else {
        const none = "No review verdict is recorded for this Action.";
        result.reportFile = emptyItem("unavailable", none);
        result.promptFile = emptyItem("unavailable", none);
        if (stop.escalations.length > 0) result.reviewStop = { escalations: stop.escalations };
      }
    }
    result.workerLog = copyBounded({ source: path.join(workspace, ".arcadia", "worker.log"), directory, file: "worker-log-tail.txt", maxBytes: LOG_TAIL_MAX_BYTES, from: "end", sourceLabel: ".arcadia/worker.log" });
    if (alert.sessionId) {
      result.sessionLog = copyBounded({ source: sessionLogPath(workspace, alert.sessionId), directory, file: "session-log-tail.txt", maxBytes: LOG_TAIL_MAX_BYTES, from: "end", sourceLabel: `.arcadia/sessions/${alert.sessionId}.log` });
    }
    const manifest = (): string => `${JSON.stringify(scrubValue({
      schema: BUNDLE_SCHEMA,
      alert,
      capturedAt: input.now.toISOString(),
      reviewStop: result.reviewStop,
      reviewStopNote: stopNote,
      savedAttempt,
      files: { verdictReport: result.reportFile, prompt: result.promptFile, workerLog: result.workerLog, sessionLog: result.sessionLog },
      hang: result.hang
    }), null, 2)}\n`;
    // Saved before any spawn, so a worker killed during `sample` still leaves the rest.
    writeFileSync(path.join(directory, "bundle.json"), manifest(), { mode: 0o600 });
    result.manifestFile = "bundle.json";
    if (input.hang) {
      const { rootPid, limits, searchPath } = input.hang;
      let pid: number | null = null;
      let pidNote: string | null = null;
      try { pid = rootPid(); } catch (error) { pidNote = `The live process could not be identified: ${errorText(error)}`; }
      result.hang = collectHangEvidence({ workspace, label: path.basename(directory), rootPid: pid, db: input.db, now: input.now, limits, searchPath });
      if (pidNote) result.hang.note = pidNote;
      writeFileSync(path.join(directory, "bundle.json"), manifest(), { mode: 0o600 });
    }
    result.status = "written";
  } catch (error) {
    result.note = `The evidence bundle could not be completed: ${errorText(error)}`;
  }
  return result;
}

function itemLine(label: string, item: CapturedItem): string {
  const where = item.file ?? "not captured";
  const state = item.status === "captured" ? (item.truncated ? "captured, truncated" : "captured") : item.status;
  return `- ${label}: ${where} (${state})${item.note ? `. ${item.note}` : ""}`;
}

/** The section appended to the alert's evidence file: where everything is, and what could not be captured. */
export function renderEvidenceBundleSection(result: EvidenceBundleResult): string {
  const lines = ["", "## Evidence bundle", "", `- Directory: ${result.directory}`, `- Manifest: ${result.manifestFile ?? "not written"}`];
  if (result.note) lines.push(`- Failure: ${result.note}`);
  lines.push(itemLine("Verdict report", result.reportFile), itemLine("Saved prompt", result.promptFile), itemLine("Worker log tail", result.workerLog));
  if (result.sessionLog) lines.push(itemLine("Session log tail", result.sessionLog));
  if (result.hang) {
    lines.push(`- Hang evidence: ${result.hang.directory ?? "not written"} (${result.hang.status}, ${result.hang.targets.length} process(es) examined in ${result.hang.elapsedMs}ms)${result.hang.note ? `. ${result.hang.note}` : ""}`);
    lines.push(`  ${itemLine("Process tree", result.hang.processTree)}`);
    for (const target of result.hang.targets) {
      lines.push(`  - ${target.role} ${target.pid} (${target.command}, ${target.ageMs ?? "?"}ms old)`);
      lines.push(`    ${itemLine("lsof", target.lsof)}`, `    ${itemLine("sample", target.sample)}`);
    }
    if (result.hang.omittedChildren > 0) lines.push(`  - ${result.hang.omittedChildren} older child(ren) not examined: the limit is ${result.hang.limits.maxChildren}.`);
  }
  lines.push("");
  return scrubText(lines.join("\n"));
}
