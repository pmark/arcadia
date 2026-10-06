import { spawnSync } from "node:child_process";
import type Database from "better-sqlite3";
import { timelineEvent, type TimelineEvent, type TimelineSource, type TimelineWindow } from "../schema.js";

/** A repository the workspace knows, as a Project's registered checkout. */
export interface TimelineRepository {
  projectSlug: string;
  projectId: string;
  path: string;
}

/**
 * Everything a collector may read. The database handle is opened read-only by
 * the caller; repositories are read with `git` under `GIT_OPTIONAL_LOCKS=0`
 * and no command that writes (no status, fetch, gc or checkout).
 */
export interface CollectorContext {
  workspacePath: string;
  db: Database.Database | null;
  repositories: TimelineRepository[];
  /** project id → slug, for rows that carry only an id. */
  projectSlugById: Map<string, string>;
  /** The repositories' configured user.email values: the operator's local Git identity. */
  operatorEmails: Set<string>;
  window: TimelineWindow;
  /** Per-source cap on rows read, so memory stays bounded however wide the window. */
  maxPerSource: number;
  now: Date;
  git: GitRunner;
  /** Optional network reads (GitHub REST via `gh api`). Off unless asked for. */
  includePullRequests: boolean;
  gh: GhRunner;
}

export interface Collector {
  source: TimelineSource;
  /** What the collector reads, for the design's inventory and for source_error messages. */
  describe: string;
  collect(context: CollectorContext): TimelineEvent[] | Promise<TimelineEvent[]>;
}

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type GitRunner = (cwd: string, args: string[], options?: { input?: string; timeoutMs?: number }) => GitResult;
export type GhRunner = (args: string[], options?: { timeoutMs?: number }) => GitResult;

/** The inherited environment minus variables that would point Git at another repository, index or work tree. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) delete env[name];
  return { ...env, ...READ_ONLY_GIT_ENV };
}

const READ_ONLY_GIT_ENV = {
  // Never take optional locks or refresh the index while reading.
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  // A partial clone must never fetch a missing object while the timeline reads.
  GIT_NO_LAZY_FETCH: "1"
};

export const runGitReadOnly: GitRunner = (cwd, args, options = {}) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeoutMs ?? 20_000,
    maxBuffer: 64 * 1024 * 1024,
    env: gitEnvironment(),
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"]
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: (result.stderr || result.error?.message) ?? ""
  };
};

/**
 * The one GitHub call the timeline makes: `gh api repos/<owner>/<repo>/pulls?<query>`, no flags at all
 * (any flag could set a method, a field or a body), so it is a GET by construction.
 */
export function isAllowedGhCall(args: readonly string[]): boolean {
  return args.length === 2 && args[0] === "api" && /^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pulls\?[A-Za-z0-9_=&.-]*$/.test(args[1]);
}

export const runGhReadOnly: GhRunner = (args, options = {}) => {
  if (!isAllowedGhCall(args)) {
    return { ok: false, stdout: "", stderr: "Refused: the timeline only issues `gh api repos/<owner>/<repo>/pulls?…` GET requests, with no flags." };
  }
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    timeout: options.timeoutMs ?? 15_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: (result.stderr || result.error?.message) ?? ""
  };
};

function catFile(cwd: string, mode: "--batch" | "--batch-check", input: string[], maxBuffer: number, timeoutMs: number): Buffer {
  const result = spawnSync("git", ["cat-file", mode], {
    cwd,
    input: `${input.join("\n")}\n`,
    timeout: timeoutMs,
    maxBuffer,
    env: gitEnvironment(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    throw new Error(`git cat-file ${mode} failed in ${cwd}: ${String(result.stderr ?? "") || result.error?.message || "unknown error"}`.slice(0, 300));
  }
  return result.stdout;
}

/** `<rev>:<path>` → the blob's object id and size (null when absent), through one `git cat-file --batch-check`. */
export function resolveBlobIds(cwd: string, specs: string[], timeoutMs = 20_000): Map<string, { oid: string; size: number } | null> {
  const ids = new Map<string, { oid: string; size: number } | null>();
  if (specs.length === 0) return ids;
  const lines = catFile(cwd, "--batch-check", specs, 16 * 1024 * 1024, timeoutMs).toString("utf8").split("\n");
  specs.forEach((spec, index) => {
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(lines[index] ?? "");
    ids.set(spec, match ? { oid: match[1], size: Number(match[2]) } : null);
  });
  return ids;
}

/**
 * Streams blobs by object id through `git cat-file --batch`, in chunks of at
 * most `chunkBytes`, handing each to `onBlob` and keeping none: a month of a
 * 450 KB Plan's revisions would otherwise not fit one buffer.
 */
export function readBlobsReadOnly(
  cwd: string,
  blobs: Array<{ oid: string; size: number }>,
  onBlob: (oid: string, content: string) => void,
  options: { chunkBytes?: number; timeoutMs?: number } = {}
): void {
  const chunkBytes = options.chunkBytes ?? 32 * 1024 * 1024;
  let chunk: Array<{ oid: string; size: number }> = [];
  let bytes = 0;
  const flush = () => {
    if (chunk.length === 0) return;
    const out = catFile(cwd, "--batch", chunk.map((blob) => blob.oid), bytes + chunk.length * 128 + 1024, options.timeoutMs ?? 30_000);
    let offset = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      const newline = out.indexOf(0x0a, offset);
      if (newline < 0) break;
      const match = /^([0-9a-f]+) blob (\d+)$/.exec(out.subarray(offset, newline).toString("utf8"));
      offset = newline + 1;
      if (!match) continue;
      const size = Number(match[2]);
      onBlob(match[1], out.subarray(offset, offset + size).toString("utf8"));
      offset += size + 1;
    }
    chunk = [];
    bytes = 0;
  };
  for (const blob of blobs) {
    if (bytes + blob.size > chunkBytes) flush();
    chunk.push(blob);
    bytes += blob.size;
  }
  flush();
}

/** True when a table exists; a collector skips a table an older workspace never created. */
export function hasTable(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

export function windowParams(context: CollectorContext): { since: string; until: string; cap: number } {
  return { since: context.window.since.toISOString(), until: context.window.until.toISOString(), cap: context.maxPerSource };
}

export function requireDb(context: CollectorContext): Database.Database {
  if (!context.db) throw new Error("The workspace database is not readable.");
  return context.db;
}

export function projectFromKey(actionKey: string | null | undefined): { project?: string; action?: string } {
  if (!actionKey) return {};
  const [project, action] = actionKey.split("/");
  return action ? { project, action } : { project };
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 10) : "";
}

/** A visible notice that a source hit its per-call cap, so a reader knows older rows were not read. */
export function truncated(source: TimelineSource, what: string, context: CollectorContext): TimelineEvent {
  return timelineEvent({
    id: `${source}:truncated:${what}:${context.window.since.toISOString()}`,
    time: context.window.since,
    clock: "collector",
    source,
    kind: "source.truncated",
    workKind: "observe",
    summary: `Only the newest ${context.maxPerSource} rows of ${what} were read; narrow --since to see older ones`,
    provenance: { event: "the collector's per-source cap was reached" }
  }) as TimelineEvent;
}

/** Appends a truncation notice when a capped query returned the cap. */
export function capped(rows: unknown[], context: CollectorContext, events: TimelineEvent[], source: TimelineSource, what: string): void {
  if (rows.length >= context.maxPerSource) events.push(truncated(source, what, context));
}
