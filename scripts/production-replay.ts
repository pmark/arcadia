/**
 * Live-state production replay: predict what the managed-production worker
 * would do if an Active policy were granted right now, without touching the
 * live workspace, its repositories, GitHub, tmux or any provider.
 *
 *   pnpm production-replay --source-workspace <live workspace> --grant <grant request-id prefix>
 *
 * Phase 1 (this process, read-only on the source):
 *   - `sqlite3 .backup` of the source database opened `mode=ro` into a fresh
 *     temporary root; workspace config, prompts and Session logs copied.
 *   - Every path the snapshot holds under the source workspace, an in-scope
 *     Project repository or a coding-agent worktree root is rewritten into the
 *     temporary root; every other Project's repository is pointed at a path
 *     that does not exist, so the tick skips it. The rewrite is verified.
 *   - Each in-scope repository is rebuilt in the temporary root from the
 *     source's objects (Git alternates, read-only) with its local branches,
 *     tags and `origin/*` tips; a local bare `origin` carries the remote tips.
 *     Every agent Session worktree still on disk is recreated at its mapped
 *     path, at the same head, with its uncommitted files copied.
 *
 * Phase 2 (a child process with an isolated environment):
 *   - HOME, Git config and the workspace are the temporary ones
 *     (`ARCADIA_REQUIRE_INLINE_WORKSPACE=1`); PATH starts with guards: `tmux`
 *     (no live sessions), `claude`/`codex`/`opencode` (refused), `git`
 *     (refused outside the temporary root or toward a network URL) and `gh`
 *     (reads answered from a recording, or from the real `gh` with
 *     `--github live`, and recorded; every write refused).
 *   - The policy is activated through the real `production preview` and
 *     `activate` commands with the grant receipt's scope, its expiries rebased
 *     onto the replay clock.
 *   - The real worker iteration runs (preservation requests, then
 *     `runManagedProductionTick`) one simulated minute apart until it
 *     launches, integrates, asks for an external effect, reaches a steady
 *     state or hits `--ticks`; each tick prints its launch outcome, handoff,
 *     log lines and escalation/blocker/red-alert changes.
 *
 * Nothing here grants authority or changes governed state: the temporary
 * root is disposable and is removed unless `--keep` is given.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT), "..");

/** Tables that only log; the tick reads no path from them, and rewriting them costs most of the time. */
const UNREWRITTEN_TABLES = new Set(["activity_events", "intelligence_jobs"]);
/**
 * JSON values hashed into a binding fingerprint (`independentVerdictReadiness`
 * hashes the receipt's `validationEvidenceRef`): rewriting them would make
 * every recorded verdict look stale. They keep their source bytes and are only
 * ever read.
 */
const FINGERPRINTED_JSON = [{ table: "candidate_preservation_receipts", column: "receipt_json", key: "$.validationEvidenceRef" }];
/** Artifact trees too large to copy and never read by the tick. */
const UNCOPIED_ARTIFACTS = new Set(["intelligence", "narration"]);
/** Ignored marker files the tick reads inside a candidate worktree. */
const WORKTREE_MARKERS = [".arcadia-go-request", ".arcadia-preserve-request", ".arcadia-enrollment-request"];
const WORKSPACE_COPIES = ["config", "prompts", "mission_logs", "NORTH_STAR.md", "OPERATOR_CONTEXT.md", path.join(".arcadia", "sessions")];
/** The only host variables the child inherits; everything else (credentials, ARCADIA_*, TMUX, SSH agents) is dropped. */
const INHERITED_ENV = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "USER", "LOGNAME", "SHELL", "TZ", "NODE_PATH"];
/** How long the replay waits for a detached host operation (preservation, go, enrollment) to finish between ticks. */
const HOST_OPERATION_DEADLINE_MS = 180_000;

export interface ReplayOptions {
  sourceWorkspace: string;
  /** Request-id prefix of the activation receipt to replay (the grant card). */
  grant: string;
  ticks?: number;
  /** `offline` answers `gh` reads only from `githubRecording`; `live` runs real read-only `gh` and records it. */
  github?: "offline" | "live";
  githubRecording?: string;
  /** Replay clock start; defaults to the wall clock. */
  now?: string;
  /** Where to create the temporary root; defaults to the OS temporary directory. */
  parent?: string;
  keep?: boolean;
  /** Where to write the JSON report; defaults to `<root>/report.json` (lost unless `keep`). */
  reportPath?: string;
  print?: (line: string) => void;
}

export interface PathMapping {
  from: string;
  to: string;
}

export interface ReplayEffect {
  kind: string;
  detail: string;
}

export interface ReplayTick {
  tick: number;
  at: string;
  launch: { outcome: string; actionKey: string | null; reason: string } | null;
  handoff: { preservation: string; integration: string; integrationKind: string } | null;
  reconciled: Array<{ sessionId: string; outcome: string }>;
  log: string[];
  escalations: { added: string[]; changed: string[]; cleared: string[] };
  blockers: string[];
  redAlerts: string[];
  effects: ReplayEffect[];
}

export interface ReplayReport {
  root: string;
  grantReceipt: string;
  activation: { ok: boolean; detail: string; warnings: string[] };
  ticks: ReplayTick[];
  stop: {
    reason: "launched" | "integrated" | "external_effect" | "unrecorded_github_read" | "steady_state" | "host_operation_timeout" | "tick_limit" | "activation_refused" | "error";
    detail: string;
  };
  /** Effects recorded after the child's last tick (a detached host operation). */
  lateEffects?: ReplayEffect[];
  /** Operator pings the tick queued in the replay database (never sent). */
  pings: string[];
  /** Every refusal, escalation, blocker and red alert the replay predicts, deduplicated. */
  predicted: string[];
  finalEscalations: Array<{ actionKey: string; kind: string; message: string; remedy: string | null }>;
  finalBlockers: Array<{ projectSlug: string; code: string; reason: string; actionKey: string | null }>;
  status: string;
  fidelity: string[];
  sourceFingerprint: { databaseBytes: number; refs: Record<string, string> };
}

interface GrantReceipt {
  requestId: string;
  createdAt: string;
  scope: {
    intent?: string;
    projects: string[];
    plans?: string[];
    actions?: string[];
    providers: string[];
    maxConcurrentSessions?: number;
    mechanicalTransitions?: string[];
    remotePreservation?: boolean;
    integrationGrant?: { decisionRef: string; expiresAt: string; actions?: string[]; mergeThroughPullRequest?: boolean };
    packetApprovalExpiresAt?: string;
  };
  authority: { grantedAt: string; grantedBy?: string; decisionRef?: string };
}

interface Manifest {
  root: string;
  workspace: string;
  receipt: GrantReceipt;
  now: string;
  ticks: number;
  repos: Record<string, string>;
  effectsLog: string;
  fidelity: string[];
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): string {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env ?? process.env, input: options.input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${(result.stderr || result.error?.message || "").trim()}`);
  }
  return result.stdout;
}

/** No optional locks: `git status` against a source checkout must never refresh its index under a live agent. */
const GIT_READ_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };

function git(cwd: string, args: string[], input?: string): string {
  return run("git", ["-c", "core.fsmonitor=false", ...args], { cwd, input, env: GIT_READ_ENV });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Longest source prefix first, so a nested root is never rewritten by its parent's mapping. */
export function orderMappings(mappings: PathMapping[]): PathMapping[] {
  return [...mappings].filter((entry) => entry.from && entry.from !== entry.to).sort((a, b) => b.from.length - a.from.length);
}

export function mapPath(value: string, mappings: PathMapping[]): string {
  for (const { from, to } of orderMappings(mappings)) {
    if (value === from || value.startsWith(`${from}/`)) return `${to}${value.slice(from.length)}`;
  }
  return value;
}

/**
 * Rewrite every TEXT value in the snapshot that contains a mapped prefix.
 * Triggers (append-only receipts) are dropped for the rewrite and restored.
 */
export function rewriteSnapshotPaths(databaseFile: string, mappings: PathMapping[]): { rewritten: number; kept: number; remaining: Array<{ table: string; column: string; from: string; count: number }> } {
  const db = new Database(databaseFile);
  const ordered = orderMappings(mappings);
  let rewritten = 0;
  try {
    const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const triggers = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL").all() as Array<{ sql: string }>;
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
      .map((row) => row.name).filter((name) => !UNREWRITTEN_TABLES.has(name));
    const textColumns = (table: string) => (db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as Array<{ name: string; type: string }>)
      .filter((column) => column.type === "" || /TEXT|CHAR|CLOB|JSON/i.test(column.type)).map((column) => column.name);
    const kept = FINGERPRINTED_JSON.flatMap(({ table, column, key }) => {
      try {
        return (db.prepare(`SELECT rowid AS id, json_extract(${quote(column)}, ?) AS value FROM ${quote(table)} WHERE json_extract(${quote(column)}, ?) IS NOT NULL`).all(key, key) as Array<{ id: number; value: string }>)
          .map((row) => ({ table, column, key, ...row }));
      } catch {
        return [];
      }
    });
    db.transaction(() => {
      for (const name of (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>)) {
        db.exec(`DROP TRIGGER ${quote(name.name)}`);
      }
      for (const table of tables) {
        let columns: string[];
        try { columns = textColumns(table); } catch { continue; }
        for (const column of columns) {
          for (const { from, to } of ordered) {
            try {
              rewritten += db.prepare(`UPDATE ${quote(table)} SET ${quote(column)} = replace(${quote(column)}, ?, ?) WHERE instr(${quote(column)}, ?) > 0`).run(from, to, from).changes;
            } catch {
              // A virtual or read-only shadow table: nothing the tick reads paths from.
            }
          }
        }
      }
      for (const row of kept) {
        db.prepare(`UPDATE ${quote(row.table)} SET ${quote(row.column)} = json_set(${quote(row.column)}, ?, ?) WHERE rowid = ?`).run(row.key, row.value, row.id);
      }
      for (const { sql } of triggers) db.exec(sql);
    })();
    const remaining: Array<{ table: string; column: string; from: string; count: number }> = [];
    for (const table of tables) {
      let columns: string[];
      try { columns = textColumns(table); } catch { continue; }
      for (const column of columns) {
        const exempt = FINGERPRINTED_JSON.filter((entry) => entry.table === table && entry.column === column);
        const value = exempt.reduce((expression, entry) => `json_remove(${expression}, '${entry.key}')`, quote(column));
        for (const { from } of ordered) {
          try {
            const count = (db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)} WHERE instr(${value}, ?) > 0`).get(from) as { n: number }).n;
            if (count > 0) remaining.push({ table, column, from, count });
          } catch {
            // see above
          }
        }
      }
    }
    return { rewritten, kept: kept.length, remaining };
  } finally {
    db.close();
  }
}

/**
 * Every path the worker operates on (Session and reservation worktrees,
 * repositories, preservation receipts) must be inside the replay root or not
 * exist: a path no mapping covered would otherwise let the transport consume a
 * live marker file or run against a live checkout.
 */
export function unconfinedPaths(databaseFile: string, root: string): string[] {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  const columns: Array<[string, string]> = [
    ["agent_sessions", "worktree_path"], ["agent_sessions", "repository_path"],
    ["agent_worktree_reservations", "worktree_path"], ["agent_worktree_reservations", "repository_path"],
    ["project_metadata", "repo_path"],
    ["candidate_preservation_receipts", "repository_path"], ["candidate_preservation_receipts", "candidate_worktree_path"]
  ];
  const found = new Set<string>();
  try {
    for (const [table, column] of columns) {
      let values: string[];
      try {
        values = db.prepare(`SELECT DISTINCT "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL AND trim("${column}") <> ''`).pluck().all() as string[];
      } catch {
        continue;
      }
      for (const value of values) {
        const candidate = value.trim();
        if (candidate === root || candidate.startsWith(`${root}/`)) continue;
        if (existsSync(candidate)) found.add(`${table}.${column}=${candidate}`);
      }
    }
  } finally {
    db.close();
  }
  return [...found];
}

function latestGrantReceipt(databaseFile: string, prefix: string): GrantReceipt {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT request_id, receipt_json, created_at FROM production_policy_receipts WHERE transition IN ('activate', 'reactivate') AND request_id LIKE ? ESCAPE '\\' ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(`${prefix.replace(/[%_]/g, (match) => `\\${match}`)}%`) as { request_id: string; receipt_json: string; created_at: string } | undefined;
    if (!row) throw new Error(`No activation receipt whose request id starts with "${prefix}" in the snapshot.`);
    const receipt = JSON.parse(row.receipt_json) as { scope?: GrantReceipt["scope"]; authority?: GrantReceipt["authority"] };
    if (!receipt.scope || !receipt.authority) throw new Error(`Receipt ${row.request_id} carries no scope/authority.`);
    return { requestId: row.request_id, createdAt: row.created_at, scope: receipt.scope, authority: receipt.authority };
  } finally {
    db.close();
  }
}

function projectRepositories(databaseFile: string): Array<{ slug: string; repoPath: string }> {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("SELECT p.slug AS slug, m.repo_path AS repoPath FROM projects p JOIN project_metadata m ON m.project_id = p.id WHERE m.repo_path IS NOT NULL AND trim(m.repo_path) <> ''").all() as Array<{ slug: string | null; repoPath: string }>)
      .filter((row): row is { slug: string; repoPath: string } => Boolean(row.slug));
  } finally {
    db.close();
  }
}

function sessionWorktrees(databaseFile: string, slugs: string[]): Array<{ id: string; worktree: string; projectSlug: string }> {
  const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT id, worktree_path AS worktree, project_slug AS projectSlug FROM agent_sessions WHERE worktree_path IS NOT NULL AND project_slug IN (${slugs.map(() => "?").join(",") || "''"})`).all(...slugs) as Array<{ id: string; worktree: string; projectSlug: string }>;
    return rows;
  } finally {
    db.close();
  }
}

/** Every ref of a repository by name (read-only). */
function readRefs(repo: string): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const line of git(repo, ["for-each-ref", "--format=%(objectname) %(refname)"]).split("\n")) {
    const [sha, name] = line.split(" ");
    if (sha && name) refs[name] = sha;
  }
  return refs;
}

/** Rebuild one in-scope repository from the source's objects: no write reaches the source. */
function cloneRepository(source: string, target: string, origin: string, fidelity: string[]): void {
  const objects = path.resolve(source, git(source, ["rev-parse", "--git-common-dir"]).trim(), "objects");
  const refs = readRefs(source);
  mkdirSync(path.dirname(origin), { recursive: true });
  git(path.dirname(origin), ["init", "-q", "--bare", origin]);
  writeFileSync(path.join(origin, "objects", "info", "alternates"), `${objects}\n`);
  const originUpdates: string[] = [];
  const localUpdates: string[] = [];
  for (const [name, sha] of Object.entries(refs)) {
    if (name.startsWith("refs/remotes/origin/") && name !== "refs/remotes/origin/HEAD") {
      originUpdates.push(`update refs/heads/${name.slice("refs/remotes/origin/".length)} ${sha}`);
      localUpdates.push(`update ${name} ${sha}`);
    } else if (name.startsWith("refs/heads/") || name.startsWith("refs/tags/")) {
      localUpdates.push(`update ${name} ${sha}`);
      if (name.startsWith("refs/tags/")) originUpdates.push(`update ${name} ${sha}`);
    }
  }
  git(origin, ["update-ref", "--stdin"], `${originUpdates.join("\n")}\n`);
  mkdirSync(target, { recursive: true });
  git(target, ["init", "-q"]);
  writeFileSync(path.join(target, ".git", "objects", "info", "alternates"), `${objects}\n`);
  git(target, ["update-ref", "--stdin"], `${localUpdates.join("\n")}\n`);
  git(target, ["remote", "add", "origin", origin]);
  const branch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd: source, encoding: "utf8", env: GIT_READ_ENV }).stdout.trim();
  const head = git(source, ["rev-parse", "HEAD"]).trim();
  if (branch) {
    git(target, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
    if (refs[`refs/remotes/origin/${branch}`]) {
      git(target, ["config", `branch.${branch}.remote`, "origin"]);
      git(target, ["config", `branch.${branch}.merge`, `refs/heads/${branch}`]);
    }
  } else {
    git(target, ["update-ref", "--no-deref", "HEAD", head]);
  }
  git(target, ["reset", "-q", "--hard", head]);
  const dirty = git(source, ["status", "--porcelain=v1", "--untracked-files=no"]).trim();
  if (dirty) fidelity.push(`${source}: the source checkout has uncommitted tracked changes that are not replayed (${dirty.split("\n").length} paths).`);
}

/** Copy a worktree's uncommitted and untracked files (never node_modules) and its marker files. */
function copyWorktreeState(source: string, target: string): number {
  const entries = git(source, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0");
  let copied = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    if (status.startsWith("R") || status.startsWith("C")) index += 1;
    if (file.split("/").includes("node_modules")) continue;
    copied += copyOne(source, target, file) ? 1 : 0;
  }
  for (const marker of WORKTREE_MARKERS) copied += copyOne(source, target, marker) ? 1 : 0;
  return copied;
}

function copyOne(source: string, target: string, file: string): boolean {
  const from = path.join(source, file);
  const to = path.join(target, file);
  let stats;
  try { stats = lstatSync(from); } catch {
    if (existsSync(to)) { rmSync(to, { recursive: true, force: true }); return true; }
    return false;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  rmSync(to, { recursive: true, force: true });
  if (stats.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else if (stats.isDirectory()) cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  else copyFileSync(from, to);
  return true;
}

function recreateWorktree(clone: string, source: string, target: string, refs: Record<string, string>): void {
  const head = git(source, ["rev-parse", "HEAD"]).trim();
  const branch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd: source, encoding: "utf8", env: GIT_READ_ENV }).stdout.trim();
  mkdirSync(path.dirname(target), { recursive: true });
  if (branch && refs[`refs/heads/${branch}`] === head) {
    git(clone, ["worktree", "add", "-q", "-f", target, branch]);
  } else {
    git(clone, ["worktree", "add", "-q", "-f", "--detach", target, head]);
  }
  copyWorktreeState(source, target);
}

function writeExecutable(file: string, content: string): void {
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

function which(name: string): string | null {
  const result = spawnSync("/usr/bin/which", [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

/** PATH guards for the child: every external seam either answers from the replay or records a refused effect. */
export function installGuards(root: string, effectsLog: string): string {
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const record = (kind: string) => `printf '{"kind":"%s","detail":"%s"}\\n' ${shellQuote(kind)} "$(printf '%s' "$(pwd -P): $*" | tr -d '"\\\\' | tr '\\n' ' ')" >> ${shellQuote(effectsLog)}`;
  // Providers answer the launch preflight's read-only probes like an installed,
  // signed-in CLI (the real flags and sign-in are not replayed); anything else is refused.
  const probes: Record<string, string> = {
    claude: `  --help|-h) echo "Usage: claude [options] --print --output-format --permission-mode --settings --setting-sources --verbose --model"; exit 0 ;;
  --version|-v) echo "0.0.0 (production replay)"; exit 0 ;;
  auth) echo '{"loggedIn":true,"authMethod":"replay"}'; exit 0 ;;`,
    codex: `  --version) echo "codex 0.0.0 (production replay)"; exit 0 ;;
  exec) case "$2" in --help|-h) echo "Usage: codex exec --json --sandbox"; exit 0 ;; esac ;;`,
    opencode: `  --version) echo "0.0.0 (production replay)"; exit 0 ;;`
  };
  for (const [name, answers] of Object.entries(probes)) {
    writeExecutable(path.join(bin, name), `#!/bin/sh\ncase "$1" in\n${answers}\nesac\n${record(`provider:${name}`)}\necho "production replay: refused to run ${name}" >&2\nexit 97\n`);
  }
  writeExecutable(path.join(bin, "tmux"), `#!/bin/sh
case "$1" in
  -V) echo "tmux 3.4 (production replay)"; exit 0 ;;
  has-session) exit 1 ;;
  ls|list-sessions) exit 0 ;;
esac
${record("tmux")}
echo "production replay: refused tmux $*" >&2
exit 97
`);
  const realGit = which("git");
  if (!realGit) throw new Error("git is not on PATH.");
  const roots = [...new Set([root, realpathSync(root)])];
  writeExecutable(path.join(bin, "git"), `#!/bin/sh
# production replay git guard: only the temporary root (cwd, -C, --git-dir,
# --work-tree, GIT_DIR and friends, absolute remote or worktree paths), never a network remote.
inside() { case "$1" in ${roots.map((entry) => `${shellQuote(entry)}|${shellQuote(entry)}/*`).join("|")}) return 0 ;; esac; return 1; }
resolve() {
  case "$1" in /*) t="$1" ;; *) t="$dir/$1" ;; esac
  if r=$(cd "$t" 2>/dev/null && pwd -P); then printf '%s' "$r"; return; fi
  if r=$(cd "$(dirname "$t")" 2>/dev/null && pwd -P); then printf '%s/%s' "$r" "$(basename "$t")"; return; fi
  printf '%s' "$t"
}
outside() { ${record("git:outside")}; echo "production replay: refused git outside the replay root ($1)" >&2; exit 97; }
network() { ${record("git:network")}; echo "production replay: refused git toward a network remote" >&2; exit 97; }
dir=$(pwd -P)
for value in "$GIT_DIR" "$GIT_WORK_TREE" "$GIT_INDEX_FILE" "$GIT_COMMON_DIR" "$GIT_OBJECT_DIRECTORY"; do
  if [ -n "$value" ]; then resolved=$(resolve "$value"); inside "$resolved" || outside "$resolved"; fi
done
prev=""
sub=""
for arg in "$@"; do
  case "$prev" in
    -C) dir=$(resolve "$arg") ;;
    --git-dir|--work-tree) resolved=$(resolve "$arg"); inside "$resolved" || outside "$resolved" ;;
  esac
  case "$arg" in --git-dir=*|--work-tree=*) resolved=$(resolve "\${arg#*=}"); inside "$resolved" || outside "$resolved" ;; esac
  if [ -z "$sub" ]; then
    case "$prev" in -C|-c|--git-dir|--work-tree) ;; *) case "$arg" in -*) ;; *) sub="$arg" ;; esac ;; esac
  else
    case "$sub" in
      push|fetch|pull|clone|ls-remote|remote|worktree|submodule|archive)
        case "$arg" in
          *://*|git@*:*) network ;;
          /*) resolved=$(resolve "$arg"); inside "$resolved" || outside "$resolved" ;;
        esac ;;
    esac
  fi
  prev="$arg"
done
inside "$dir" || outside "$dir"
exec ${shellQuote(realGit)} "$@"
`);
  const realGh = which("gh");
  writeFileSync(path.join(bin, "gh-guard.mjs"), GH_GUARD);
  writeExecutable(path.join(bin, "gh"), `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(bin, "gh-guard.mjs"))} "$@"\n`);
  return realGh ?? "";
}

/**
 * The `gh` guard. Reads: `offline` answers from the recording (JSONL of
 * {args, status, stdout, stderr}); `live` runs the real `gh` with the real HOME
 * and appends to the recording. Anything else is a write: recorded as an
 * effect and refused.
 */
const GH_GUARD = String.raw`import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const env = process.env;
const effect = (kind, detail) => appendFileSync(env.REPLAY_EFFECTS_LOG, JSON.stringify({ kind, detail }) + "\n");
const READ = { pr: ["view", "list", "checks", "diff", "status"], issue: ["view", "list"], repo: ["view"], run: ["list", "view"], project: ["view", "list", "item-list", "field-list"], auth: ["status"], release: ["view", "list"], search: ["prs", "issues"] };
function isRead() {
  const [group, sub] = args;
  if (group === "--version" || group === "version") return true;
  if (group === "api") {
    const rest = args.slice(1);
    const method = rest.find((value, index) => rest[index - 1] === "-X" || rest[index - 1] === "--method")
      ?? rest.find((value) => value.startsWith("--method="))?.slice(9)
      ?? rest.find((value) => /^-X=?[A-Za-z]+$/.test(value))?.replace(/^-X=?/, "");
    if (method && method.toUpperCase() !== "GET") return false;
    const fields = rest.some((value) => ["-f", "-F", "--field", "--raw-field", "--input"].includes(value) || /^--(raw-)?field=/.test(value));
    // A query read from a file cannot be inspected: treated as a write.
    if (rest[0] === "graphql") return !rest.some((value) => /\bmutation\b/.test(value) || /^query=@/.test(value) || value === "--input");
    return !fields || method?.toUpperCase() === "GET";
  }
  return Boolean(READ[group]?.includes(sub));
}
if (!isRead()) {
  effect("github:write", "gh " + args.join(" "));
  process.stderr.write("production replay: refused GitHub write (gh " + args.join(" ") + ")\n");
  process.exit(1);
}
const key = JSON.stringify(args);
if (env.REPLAY_GH_MODE === "live" && env.REPLAY_REAL_GH) {
  const real = spawnSync(env.REPLAY_REAL_GH, args, { encoding: "utf8", env: { PATH: env.REPLAY_REAL_PATH, HOME: env.REPLAY_REAL_HOME, GH_REPO: env.REPLAY_GH_REPO ?? "", GH_PROMPT_DISABLED: "1" }, maxBuffer: 64 * 1024 * 1024 });
  const entry = { args, status: real.status ?? 1, stdout: real.stdout ?? "", stderr: real.stderr ?? "" };
  appendFileSync(env.REPLAY_GH_RECORDING, JSON.stringify(entry) + "\n");
  process.stdout.write(entry.stdout);
  process.stderr.write(entry.stderr);
  process.exit(entry.status);
}
const recorded = existsSync(env.REPLAY_GH_RECORDING ?? "") ? readFileSync(env.REPLAY_GH_RECORDING, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => JSON.stringify(entry.args) === key).at(-1) : null;
if (!recorded) {
  effect("github:unrecorded-read", "gh " + args.join(" "));
  process.stderr.write("production replay: no recorded answer for gh " + args.join(" ") + "\n");
  process.exit(1);
}
process.stdout.write(recorded.stdout);
process.stderr.write(recorded.stderr);
process.exit(recorded.status);
`;

/** Preloaded into the child and every node descendant: no network, every attempt recorded. */
export const NET_GUARD = String.raw`import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
const refuse = (target) => {
  try { appendFileSync(process.env.REPLAY_EFFECTS_LOG, JSON.stringify({ kind: "network", detail: String(target) }) + "\n"); } catch {}
  throw new Error("production replay: network refused");
};
globalThis.fetch = async (input) => refuse(input?.url ?? input?.href ?? input);
for (const module of [http, https]) {
  module.request = (target) => refuse(target?.href ?? target?.host ?? target?.hostname ?? target);
  module.get = module.request;
}
syncBuiltinESMExports();
`;

function githubRepository(repo: string): string | null {
  const url = spawnSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return match ? match[1] : null;
}

/** Phase 1: build the replay root from the source, then run phase 2 in an isolated child. */
export function runProductionReplay(options: ReplayOptions): ReplayReport {
  const print = options.print ?? ((line: string) => process.stdout.write(`${line}\n`));
  const source = realpathSync(path.resolve(options.sourceWorkspace));
  const sourceDatabase = path.join(source, "database", "arcadia.sqlite3");
  if (!existsSync(sourceDatabase)) throw new Error(`No workspace database at ${sourceDatabase}.`);
  const root = realpathSync(mkdtempSync(path.join(options.parent ?? tmpdir(), "arcadia-production-replay-")));
  const fidelity: string[] = [];
  try {
    const workspace = path.join(root, "workspace");
    const databaseFile = path.join(workspace, "database", "arcadia.sqlite3");
    mkdirSync(path.dirname(databaseFile), { recursive: true });
    print(`Replay root: ${root}`);
    const sourceBytes = lstatSync(sourceDatabase).size;
    run("sqlite3", [`file:${sourceDatabase}?mode=ro`, `.backup ${shellQuote(databaseFile)}`]);
    for (const entry of WORKSPACE_COPIES) {
      const from = path.join(source, entry);
      if (existsSync(from)) cpSync(from, path.join(workspace, entry), { recursive: true, verbatimSymlinks: true });
    }
    const artifacts = path.join(source, "artifacts");
    if (existsSync(artifacts)) {
      for (const entry of readdirSync(artifacts)) {
        if (!UNCOPIED_ARTIFACTS.has(entry)) cpSync(path.join(artifacts, entry), path.join(workspace, "artifacts", entry), { recursive: true, verbatimSymlinks: true });
      }
    }
    for (const dir of ["projects", "artifacts", "skills", "reports", "inbox", ".arcadia"]) mkdirSync(path.join(workspace, dir), { recursive: true });

    const receipt = latestGrantReceipt(databaseFile, options.grant);
    print(`Grant receipt: ${receipt.requestId} (${receipt.createdAt})`);
    const inScope = new Set(receipt.scope.projects);
    const repositories = projectRepositories(databaseFile);
    const repos: Record<string, string> = {};
    const mappings: PathMapping[] = [{ from: source, to: workspace }];
    if (options.sourceWorkspace !== source) mappings.push({ from: path.resolve(options.sourceWorkspace), to: workspace });
    for (const { slug, repoPath } of repositories) {
      const target = inScope.has(slug) ? path.join(root, "repos", slug) : path.join(root, "absent", slug);
      mappings.push({ from: repoPath.trim(), to: target });
      if (inScope.has(slug)) repos[slug] = repoPath.trim();
    }
    const realHome = homedir();
    for (const agent of ["claude", "codex", "opencode"]) {
      mappings.push({ from: path.join(realHome, `.${agent}`, "worktrees"), to: path.join(root, "agent-worktrees", agent) });
    }
    const sessions = sessionWorktrees(databaseFile, [...inScope]);
    const rewrite = rewriteSnapshotPaths(databaseFile, mappings);
    if (rewrite.remaining.length > 0) {
      throw new Error(`Path rewrite incomplete; refusing to run a tick that could reach a source path: ${JSON.stringify(rewrite.remaining.slice(0, 5))}`);
    }
    const unconfined = unconfinedPaths(databaseFile, root);
    if (unconfined.length > 0) {
      throw new Error(`Refusing to run: these existing paths in the snapshot are outside the replay root and no mapping covers them: ${unconfined.slice(0, 5).join(", ")}`);
    }
    print(`Snapshot: ${sourceBytes} bytes; ${rewrite.rewritten} values remapped into the replay root.`);
    if (rewrite.kept > 0) fidelity.push(`${rewrite.kept} fingerprinted validation-evidence references keep their source path (read-only), so recorded verdicts stay bound.`);

    const sourceRefs: Record<string, string> = {};
    for (const [slug, repoPath] of Object.entries(repos)) {
      if (!existsSync(repoPath)) { fidelity.push(`${slug}: repository ${repoPath} is missing; the tick will skip it.`); continue; }
      const target = path.join(root, "repos", slug);
      cloneRepository(repoPath, target, path.join(root, "remotes", `${slug}.git`), fidelity);
      const refs = readRefs(repoPath);
      for (const [name, sha] of Object.entries(refs)) sourceRefs[`${slug}:${name}`] = sha;
      let recreated = 0;
      for (const session of sessions.filter((entry) => entry.projectSlug === slug)) {
        // Read before the rewrite: `worktree` is the source path.
        const original = session.worktree;
        const mapped = mapPath(original, mappings);
        if (mapped === original || !mapped.startsWith(`${root}/`) || mapped.startsWith(path.join(root, "absent")) || !existsSync(original) || existsSync(mapped)) continue;
        try {
          recreateWorktree(target, original, mapped, refs);
          recreated += 1;
        } catch (error) {
          fidelity.push(`Session ${session.id}: worktree ${original} could not be recreated (${error instanceof Error ? error.message : String(error)}).`);
        }
      }
      print(`Repository ${slug}: rebuilt from ${repoPath} (${Object.keys(refs).length} refs, ${recreated} Session worktrees recreated).`);
    }
    fidelity.push("No tmux session is live in the replay: a Session the source shows running is reconciled as exited.");
    fidelity.push("Provider capacity, sign-in and the installed CLI's headless flags are simulated as available; the worker capability probe (host heartbeats) is not replayed.");
    fidelity.push(`The replay runs this checkout's source (${spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8", env: GIT_READ_ENV }).stdout.trim() || "unknown revision"}); the installed worker and go-broker may run another revision.`);

    const effectsLog = path.join(root, "effects.jsonl");
    writeFileSync(effectsLog, "");
    const realGh = installGuards(root, effectsLog);
    const home = path.join(root, "home");
    mkdirSync(path.join(home, ".config"), { recursive: true });
    writeFileSync(path.join(home, ".gitconfig"), "[user]\n\tname = Arcadia Production Replay\n\temail = production-replay@arcadia.invalid\n[commit]\n\tgpgsign = false\n[core]\n\tfsmonitor = false\n");
    const recording = options.githubRecording ? path.resolve(options.githubRecording) : path.join(root, "github-recording.jsonl");
    if (!existsSync(recording)) writeFileSync(recording, "");
    const ticks = options.ticks ?? 12;
    const manifest: Manifest = { root, workspace, receipt, now: options.now ?? new Date().toISOString(), ticks, repos, effectsLog, fidelity };
    const manifestFile = path.join(root, "manifest.json");
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    const scratch = path.join(root, "tmp");
    mkdirSync(scratch, { recursive: true });
    const netGuard = path.join(root, "bin", "net-guard.mjs");
    writeFileSync(netGuard, NET_GUARD);
    const env: NodeJS.ProcessEnv = {};
    for (const key of INHERITED_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, {
      TMPDIR: scratch,
      // Every node descendant (preservation, go and enrollment workers) loads the network guard too.
      NODE_OPTIONS: `--import=${JSON.stringify(pathToFileURL(netGuard).href)}`,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      ARCADIA_WORKSPACE: workspace,
      ARCADIA_REQUIRE_INLINE_WORKSPACE: "1",
      ARCADIA_PRESERVATION_HOST_TEST: "",
      REPLAY_EFFECTS_LOG: effectsLog,
      REPLAY_GH_MODE: options.github ?? "offline",
      REPLAY_GH_RECORDING: recording,
      REPLAY_REAL_GH: realGh,
      REPLAY_REAL_HOME: realHome,
      REPLAY_REAL_PATH: process.env.PATH ?? "",
      REPLAY_GH_REPO: Object.values(repos).map(githubRepository).find(Boolean) ?? ""
    });
    // cwd is the replay root, never a checkout: a cwd-relative operation cannot reach the source.
    const child = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), SCRIPT, "--run-prepared", manifestFile], { cwd: root, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    if (child.stdout) for (const line of child.stdout.replace(/\n$/, "").split("\n")) print(line);
    const reportFile = path.join(root, "report.json");
    if (!existsSync(reportFile)) {
      throw new Error(`The replay child wrote no report (exit ${child.status}): ${(child.stderr ?? "").trim().slice(-4000)}`);
    }
    const report = JSON.parse(readFileSync(reportFile, "utf8")) as ReplayReport;
    report.sourceFingerprint = { databaseBytes: sourceBytes, refs: sourceRefs };
    // A detached host operation may record an effect after the child wrote its report.
    const recorded = readFileSync(effectsLog, "utf8").split("\n").filter(Boolean).length;
    const reported = report.ticks.reduce((sum, tick) => sum + tick.effects.length, 0);
    if (recorded > reported) {
      report.lateEffects = readFileSync(effectsLog, "utf8").split("\n").filter(Boolean).slice(reported).map((line) => {
        try { return JSON.parse(line) as ReplayEffect; } catch { return { kind: "unparsed", detail: line }; }
      });
      for (const effect of report.lateEffects) {
        report.predicted.push(`requested external effect (after the last tick) ${effect.kind}: ${effect.detail}`);
        print(`Late effect ${effect.kind}: ${effect.detail.slice(0, 600)}`);
      }
    }
    const destination = options.reportPath ? path.resolve(options.reportPath) : reportFile;
    writeFileSync(destination, JSON.stringify(report, null, 2));
    if (options.reportPath) print(`Report: ${destination}`);
    return report;
  } finally {
    if (!options.keep) {
      // Worktrees registered in the replay clones live under the root; removing it removes them.
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/* ---------------------------------------------------------------- phase 2 */

async function runPrepared(manifestFile: string): Promise<void> {
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Manifest;
  const effectsSeen = { count: 0 };
  const readEffects = (): ReplayEffect[] => {
    const all = readFileSync(manifest.effectsLog, "utf8").split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line) as ReplayEffect; } catch { return { kind: "unparsed", detail: line }; }
    });
    const fresh = all.slice(effectsSeen.count);
    effectsSeen.count = all.length;
    return fresh;
  };

  const { runProductionPreviewCommand, runProductionActivateCommand, runProductionStatusCommand, renderProductionStatusSuccess } = await import("../src/commands/production.js");
  const { withDatabase } = await import("../src/db/connection.js");
  const { loadPhase3Registries } = await import("../src/intent/registries.js");
  const { runManagedProductionTick, listOperatorEscalations, listLaunchBlockers } = await import("../src/production/tick.js");
  const { listOpenRedAlerts } = await import("../src/production/redAlerts.js");
  const { processPreservationRequests } = await import("../src/sessions/preservationTransport.js");

  const out = (line: string) => process.stdout.write(`${line}\n`);
  const workspace = manifest.workspace;
  const start = new Date(manifest.now);
  // An expiry keeps its distance from the original grant; one that was already
  // at or before the grant (a fixture whose clock differs) gets twelve hours.
  const rebase = (iso: string | undefined) => {
    if (!iso) return undefined;
    const span = new Date(iso).getTime() - new Date(manifest.receipt.authority.grantedAt).getTime();
    if (!(span > 0)) manifest.fidelity.push(`Expiry ${iso} was not after the grant; the replay uses twelve hours.`);
    return new Date(start.getTime() + (span > 0 ? span : 12 * 3_600_000)).toISOString();
  };
  const scope = manifest.receipt.scope;
  const report: ReplayReport = {
    root: manifest.root,
    grantReceipt: manifest.receipt.requestId,
    activation: { ok: false, detail: "", warnings: [] },
    ticks: [],
    stop: { reason: "tick_limit", detail: "" },
    predicted: [],
    finalEscalations: [],
    finalBlockers: [],
    pings: [],
    status: "",
    fidelity: manifest.fidelity,
    sourceFingerprint: { databaseBytes: 0, refs: {} }
  };
  const predicted = new Set<string>();
  const finish = () => {
    try {
      report.finalEscalations = withDatabase(workspace, (db) => listOperatorEscalations(db)).map(({ actionKey, kind, message, remedy }) => ({ actionKey, kind, message, remedy }));
      report.finalBlockers = withDatabase(workspace, (db) => listLaunchBlockers(db)).map(({ projectSlug, code, reason, actionKey }) => ({ projectSlug, code, reason, actionKey }));
      report.status = renderProductionStatusSuccess(runProductionStatusCommand({ workspace })).join("\n");
    } catch (error) {
      report.status = `production status failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      report.pings = withDatabase(workspace, (db) => db.prepare("SELECT kind, message FROM operator_pings WHERE rowid > ? ORDER BY rowid").all(pingBase) as Array<{ kind: string; message: string }>)
        .map((ping) => `${ping.kind}: ${ping.message}`);
    } catch {
      report.pings = [];
    }
    for (const ping of report.pings) predicted.add(`would ping the operator (queued only in the replay) ${ping}`);
    report.predicted = [...predicted];
    writeFileSync(path.join(manifest.root, "report.json"), JSON.stringify(report, null, 2));
    out("");
    out(`Stop: ${report.stop.reason}${report.stop.detail ? ` -- ${report.stop.detail}` : ""}`);
    out(`Predicted refusals/escalations (${report.predicted.length}):`);
    for (const entry of report.predicted) out(`  - ${entry}`);
    out("Fidelity notes:");
    for (const entry of report.fidelity) out(`  - ${entry}`);
  };

  // Activation, as the grant card does it: preview, then activate against the previewed revision.
  const base = {
    workspace,
    project: scope.projects,
    provider: scope.providers,
    ...(scope.plans?.length ? { plan: scope.plans } : {}),
    ...(scope.actions?.length ? { action: scope.actions } : {}),
    ...(scope.intent ? { intent: scope.intent } : {}),
    concurrency: String(scope.maxConcurrentSessions ?? 1),
    ...(scope.mechanicalTransitions?.length ? { transitions: scope.mechanicalTransitions.join(",") } : {}),
    ...(scope.remotePreservation ? { remotePreservation: true } : {}),
    ...(scope.integrationGrant ? {
      integrationGrantDecision: scope.integrationGrant.decisionRef,
      integrationGrantExpiresAt: rebase(scope.integrationGrant.expiresAt),
      ...(scope.integrationGrant.actions?.length ? { integrationGrantAction: scope.integrationGrant.actions } : {}),
      ...(scope.integrationGrant.mergeThroughPullRequest ? { integrationGrantMergePullRequest: true } : {})
    } : {}),
    ...(scope.packetApprovalExpiresAt ? { packetApprovalExpiresAt: rebase(scope.packetApprovalExpiresAt) } : {})
  };
  try {
    const preview = runProductionPreviewCommand(base);
    const activated = runProductionActivateCommand({
      ...base,
      requestId: `production-replay-${manifest.receipt.requestId}`.slice(0, 200),
      grantedBy: "production-replay",
      ...(manifest.receipt.authority.decisionRef ? { decision: manifest.receipt.authority.decisionRef } : {}),
      expectedRevision: String(preview.data.preview.expectedRevision)
    });
    report.activation = { ok: true, detail: `${activated.data.result.transition} revision ${activated.data.result.policy.revision}`, warnings: [...preview.warnings, ...activated.warnings] };
    out(`Activation: ok (${report.activation.detail})`);
    for (const warning of report.activation.warnings) { out(`  warning: ${warning}`); predicted.add(`activation warning: ${warning}`); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.activation = { ok: false, detail: message, warnings: [] };
    report.stop = { reason: "activation_refused", detail: message };
    predicted.add(`activation refused: ${message}`);
    out(`Activation: REFUSED -- ${message}`);
    finish();
    return;
  }

  const tmux = {
    live: new Set<string>(),
    launches: [] as Array<{ name: string; cwd: string; command: string; args: string[] }>,
    available: () => true,
    hasSession(name: string) { return this.live.has(name); },
    launch(input: { name: string; cwd: string; command: string; args: string[] }) { this.launches.push({ name: input.name, cwd: input.cwd, command: input.command, args: input.args }); this.live.add(input.name); },
    capturePane(name: string) { return this.live.has(name) ? `replay pane ${name}` : null; }
  };
  const capacityObservation = (provider: string) => ({
    generatedAt: start.toISOString(),
    providers: [{
      providerId: provider, admitted: true, code: null, reason: `${provider}: replay assumes capacity is available.`, unattendedProof: true, retryAfter: null, refreshRequired: false,
      receipt: { version: 1, providerId: provider, providerLabel: provider, profiles: [], accountScope: "production-replay", source: "codex_app_server", evidence: "simulated", unattended: true,
        observedAt: start.toISOString(), observedAgeMs: 0, expiresAt: null, confidence: "observed", freshness: "fresh", usagePolicy: "included", usagePolicyReason: "production replay",
        windows: [], nextResetAt: null, unsupported: [], availability: "available", telemetry: "production replay" }
    }]
  });

  let pingBase = 0;
  try {
    pingBase = withDatabase(workspace, (db) => (db.prepare("SELECT COALESCE(MAX(rowid), 0) AS n FROM operator_pings").get() as { n: number }).n);
  } catch {
    // No ping table: nothing to report.
  }
  let now = start;
  let hostWaitSince: number | null = null;
  let budget = manifest.ticks;
  let previous: Map<string, string> = new Map(withDatabase(workspace, (db) => listOperatorEscalations(db)).map((entry) => [`${entry.actionKey} ${entry.kind}`, entry.message]));
  let lastSignature = "";
  let steady = 0;
  const seenAlerts = new Set<string>();
  for (let n = 1; n <= budget; n += 1) {
    now = new Date(now.getTime() + 60_000);
    const lines: string[] = [];
    const registries = loadPhase3Registries(workspace);
    if (!registries.providerAdapters) {
      report.stop = { reason: "error", detail: "The snapshot has no provider-adapters registry." };
      break;
    }
    const tick: ReplayTick = { tick: n, at: now.toISOString(), launch: null, handoff: null, reconciled: [], log: lines, escalations: { added: [], changed: [], cleared: [] }, blockers: [], redAlerts: [], effects: [] };
    let serviced = false;
    try {
      serviced = withDatabase(workspace, (db) => processPreservationRequests(db, workspace));
      if (serviced) {
        lines.push("(worker) a host operation (preservation, go or enrollment request) is in flight; the managed tick is skipped this iteration");
      } else {
        const result = withDatabase(workspace, (db) => runManagedProductionTick(db, workspace, {
          profiles: registries.codingAgents.profiles,
          adapters: registries.providerAdapters!,
          tmux,
          now,
          clock: () => now,
          capacityObservation: capacityObservation(scope.providers[0] ?? "claude-code-cli") as never,
          providerSignIn: () => ({ signedIn: true, remedy: "" }),
          workerCapability: () => [],
          agentWorktreeRoot: path.join(manifest.root, "agent-worktrees", "new"),
          log: (message) => lines.push(message)
        }));
        for (const project of result.projects) {
          if (!scope.projects.includes(project.projectSlug)) continue;
          if (project.launch) tick.launch = { outcome: project.launch.outcome, actionKey: project.launch.actionKey, reason: project.launch.reason };
          if (project.handoff) {
            tick.handoff = { preservation: describeStep(project.handoff.preservation), integration: describeStep(project.handoff.integration), integrationKind: project.handoff.integration.kind };
          }
          tick.reconciled.push(...project.reconciled);
        }
      }
    } catch (error) {
      lines.push(`Tick error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      predicted.add(`tick error: ${error instanceof Error ? error.message : String(error)}`);
    }
    const escalations = withDatabase(workspace, (db) => listOperatorEscalations(db));
    const current = new Map(escalations.map((entry) => [`${entry.actionKey} ${entry.kind}`, entry.message]));
    for (const [key, message] of current) {
      if (!previous.has(key)) tick.escalations.added.push(`${key}: ${message}`);
      else if (previous.get(key) !== message) tick.escalations.changed.push(`${key}: ${message}`);
    }
    for (const key of previous.keys()) if (!current.has(key)) tick.escalations.cleared.push(key);
    previous = current;
    const inScope = (key: string | null | undefined) => Boolean(key) && scope.projects.some((slug) => key === slug || key!.startsWith(`${slug}/`));
    // Escalations of Projects outside the grant are listed in the report, not predicted for this grant.
    for (const entry of escalations) if (inScope(entry.actionKey)) predicted.add(`escalation ${entry.kind} (${entry.actionKey}): ${entry.message}`);
    tick.blockers = withDatabase(workspace, (db) => listLaunchBlockers(db)).map((entry) => `${entry.projectSlug} ${entry.code}${entry.actionKey ? ` (${entry.actionKey})` : ""}: ${entry.reason}`);
    for (const entry of withDatabase(workspace, (db) => listLaunchBlockers(db))) if (scope.projects.includes(entry.projectSlug)) predicted.add(`launch blocker ${entry.projectSlug} ${entry.code}: ${entry.reason}`);
    for (const alert of withDatabase(workspace, (db) => listOpenRedAlerts(db))) {
      const text = `${alert.trigger} (${alert.actionKey ?? alert.projectSlug}): ${alert.detail}`;
      if (!seenAlerts.has(text)) { seenAlerts.add(text); tick.redAlerts.push(text); if (inScope(alert.actionKey ?? alert.projectSlug)) predicted.add(`red alert ${text}`); }
    }
    tick.effects = readEffects();
    if (tick.launch && tick.launch.outcome !== "launched" && tick.launch.outcome !== "skipped") predicted.add(`launch ${tick.launch.outcome} (${tick.launch.actionKey ?? "-"}): ${tick.launch.reason}`);
    // A detached host operation is awaited in real time; its iterations spend no tick budget.
    const waiting = serviced && tick.effects.length === 0;
    const repeatWait = waiting && hostWaitSince !== null;
    if (!repeatWait) {
      report.ticks.push(tick);
      printTick(out, tick, tmux.launches);
    }
    if (waiting) {
      hostWaitSince ??= Date.now();
      if (Date.now() - hostWaitSince > HOST_OPERATION_DEADLINE_MS) {
        report.stop = { reason: "host_operation_timeout", detail: `a host operation was still in flight after ${HOST_OPERATION_DEADLINE_MS / 1000}s` };
        break;
      }
      budget += 1;
      steady = 0;
      lastSignature = "";
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    hostWaitSince = null;

    if (tick.launch?.outcome === "launched") {
      const launch = tmux.launches.at(-1);
      report.stop = { reason: "launched", detail: `${tick.launch.actionKey}${launch ? ` in ${launch.cwd}: ${launch.command} ${launch.args.join(" ").slice(0, 400)}` : ""}` };
      break;
    }
    if (tick.handoff?.integrationKind === "integrated") {
      report.stop = { reason: "integrated", detail: tick.handoff.integration };
      break;
    }
    if (tick.effects.length > 0) {
      const unrecordedOnly = tick.effects.every((effect) => effect.kind === "github:unrecorded-read");
      report.stop = { reason: unrecordedOnly ? "unrecorded_github_read" : "external_effect", detail: tick.effects.map((effect) => `${effect.kind}: ${effect.detail}`).join("; ").slice(0, 2000) };
      for (const effect of tick.effects) predicted.add(`${effect.kind === "github:unrecorded-read" ? "replay gap (no recorded answer)" : "requested external effect"} ${effect.kind}: ${effect.detail}`);
      break;
    }
    const signature = JSON.stringify([tick.launch?.outcome, tick.launch?.reason, tick.handoff, [...current.keys()].sort(), tick.blockers]);
    steady = signature === lastSignature ? steady + 1 : 0;
    lastSignature = signature;
    if (steady >= 2) {
      report.stop = { reason: "steady_state", detail: `three identical ticks: ${tick.launch ? `launch ${tick.launch.outcome}` : "no launch"}` };
      break;
    }
    if (n === budget) report.stop = { reason: "tick_limit", detail: `${manifest.ticks} ticks` };
  }
  finish();
}

function describeStep(step: unknown): string {
  if (!step || typeof step !== "object") return String(step);
  const record = step as Record<string, unknown>;
  const detail = [record.reason, record.message, record.code].find((value) => typeof value === "string" && value) as string | undefined;
  return `${String(record.kind ?? "?")}${detail ? `: ${detail.slice(0, 300)}` : ""}`;
}

function printTick(out: (line: string) => void, tick: ReplayTick, launches: Array<{ cwd: string; command: string; args: string[] }>): void {
  out(`-- tick ${tick.tick} @ ${tick.at}`);
  if (tick.launch) out(`   launch: ${tick.launch.outcome} ${tick.launch.actionKey ?? ""}${tick.launch.reason ? ` -- ${tick.launch.reason.slice(0, 600)}` : ""}`);
  if (tick.launch?.outcome === "launched" && launches.length) out(`   would start: ${launches.at(-1)!.command} (cwd ${launches.at(-1)!.cwd})`);
  if (tick.handoff) out(`   handoff: preservation ${tick.handoff.preservation}; integration ${tick.handoff.integration}`);
  for (const entry of tick.reconciled) out(`   reconciled ${entry.sessionId}: ${entry.outcome}`);
  for (const line of tick.log) out(`   log: ${line.slice(0, 800)}`);
  for (const entry of tick.escalations.added) out(`   + escalation ${entry.slice(0, 600)}`);
  for (const entry of tick.escalations.changed) out(`   ~ escalation ${entry.slice(0, 600)}`);
  for (const entry of tick.escalations.cleared) out(`   - escalation ${entry}`);
  for (const entry of tick.blockers) out(`   blocker ${entry.slice(0, 600)}`);
  for (const entry of tick.redAlerts) out(`   red alert ${entry.slice(0, 600)}`);
  for (const effect of tick.effects) out(`   EFFECT ${effect.kind}: ${effect.detail.slice(0, 600)}`);
}

/* ------------------------------------------------------------------- CLI */

function parseArgs(argv: string[]): ReplayOptions {
  const options: Partial<ReplayOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${flag} needs a value.`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--source-workspace": options.sourceWorkspace = value(); break;
      case "--grant": options.grant = value(); break;
      case "--ticks": options.ticks = Number(value()); break;
      case "--github": {
        const mode = value();
        if (mode !== "offline" && mode !== "live") throw new Error("--github is offline or live.");
        options.github = mode;
        break;
      }
      case "--github-recording": options.githubRecording = value(); break;
      case "--now": options.now = value(); break;
      case "--parent": options.parent = value(); break;
      case "--report": options.reportPath = value(); break;
      case "--keep": options.keep = true; break;
      case "--help": case "-h":
        process.stdout.write(`Usage: pnpm production-replay --source-workspace <workspace> --grant <request-id prefix> [--ticks 12] [--github offline|live] [--github-recording <jsonl>] [--now <iso>] [--report <file>] [--parent <dir>] [--keep]\n`);
        process.exit(0);
        break;
      default: throw new Error(`Unknown argument ${flag}.`);
    }
  }
  if (!options.sourceWorkspace) throw new Error("--source-workspace is required (name the workspace explicitly; nothing is resolved from user config).");
  if (!options.grant) throw new Error("--grant is required: the request-id prefix of the activation receipt to replay.");
  if (options.ticks !== undefined && !(Number.isInteger(options.ticks) && options.ticks > 0)) throw new Error("--ticks must be a positive integer.");
  return options as ReplayOptions;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SCRIPT)) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--run-prepared" && argv[1]) {
    runPrepared(argv[1]).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(1);
    });
  } else {
    try {
      const report = runProductionReplay(parseArgs(argv));
      process.exitCode = report.stop.reason === "error" ? 1 : 0;
    } catch (error) {
      process.stderr.write(`production replay: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
