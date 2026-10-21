/**
 * Live-state production replay: predict what the managed-production worker
 * would do if an Active policy were granted right now, without touching the
 * live workspace, its repositories, GitHub, tmux or any provider.
 *
 *   pnpm production-replay --source-workspace <live workspace> --grant <grant request-id prefix>
 *   pnpm production-replay --source-workspace <live workspace> --card <operator-script id>
 *
 * `--card` predicts a card that was never pressed: the activation is built
 * from the card's script (its pinned scope, provider, transitions, integration
 * grant and concurrency; expiries are press-time plus the card's hours) and
 * activated exactly as a press would. It is labelled "built from card
 * descriptor, not a press receipt" and is no evidence the card would pass its
 * own preconditions.
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
import { CODE_REVIEW_PR_CRITERIA, QA_PR_REVIEW_CRITERIA } from "../src/qa/reviewCriteria.js";

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
  /** Request-id prefix of the activation receipt to replay (the grant card). Exactly one of `grant` and `card`. */
  grant?: string;
  /** Id of a Grant operator-script card never pressed: the activation is built from its script. */
  card?: string;
  /** Directory holding the card's `<id>.sh`; defaults to this checkout's operator-script library. */
  cardDir?: string;
  ticks?: number;
  /** `offline` answers `gh` reads only from `githubRecording`; `live` runs real read-only `gh` and records it. */
  github?: "offline" | "live";
  githubRecording?: string;
  /** Replay clock start; defaults to the wall clock. */
  now?: string;
  /** Where to create the temporary root; defaults to the OS temporary directory. */
  parent?: string;
  keep?: boolean;
  /** Extra source directories that hold Session worktrees (beyond `~/.<agent>/worktrees`), each recreated under the root. */
  worktreeRoots?: string[];
  /** Where to write the JSON report; defaults to `<root>/report.json` (lost unless `keep`). */
  reportPath?: string;
  print?: (line: string) => void;
  /**
   * SIMULATION ONLY: the independent reviewer (`codex exec` and its sandbox
   * probe) answers with this verdict instead of being refused. `pass` passes
   * every criterion; `fail-repairable` fails Correctness with one ordinary
   * finding (no authority wording), the shape the repair loop launches for.
   * It predicts what the worker does with such a verdict, never the verdict.
   */
  simulateVerdict?: SimulatedVerdict;
  /**
   * SIMULATION ONLY: `gh pr ready`, `ready --undo`, `comment`, `close`, `edit`
   * and `merge` succeed without reaching GitHub; later `gh pr view` reads see
   * the simulated draft/state. `gh project item-edit` (the tick's board status
   * sync), `project item-add` and Action mirror `issue create/edit/comment/close`
   * also succeed with fake ids/URLs and no state kept. Every other write is still
   * refused.
   */
  simulateGithubWrites?: boolean;
  /**
   * Continue past launch. Instead of starting the agent CLI, the replay
   * produces the Session's result and lets the real tick reconcile, validate,
   * settle, preserve, open a (simulated) pull request, review, worker-merge
   * (simulated; fast-forwards only the replay's local bare origin) and launch
   * the next Action.
   *   - `scripted`: the fast-rehearsal ScriptedExecutor (tests/fast-rehearsal/helpers/executor.ts)
   *     writes `executorFiles[actionId]` (default: one marker file), commits under the
   *     launch identity and drafts and settles a complete `complete` Agent Ask in the worktree.
   *   - `candidate:<ref>`: the Session's worktree branch is reset to a commit that exists in the
   *     source repository (a branch, tag or sha, e.g. a preserved PR commit); nothing is drafted.
   * Pull requests are then simulated (`gh pr create`/`view`/`list`/compare patch/`ready`/`edit`/`merge`)
   * with a green required-check rollup on the exact head, which needs `simulateGithubWrites`.
   */
  executor?: "scripted" | `candidate:${string}`;
  /** Files the scripted executor writes, per Action id (the part of the key after the Project slug). */
  executorFiles?: Record<string, Record<string, string>>;
  /**
   * `simulated` (default): reviewers answer `simulateVerdict` or are refused as before.
   * `real`: the real code-review and QA reviewer (`codex exec`, read-only sandbox) run against the
   * replay's simulated pull-request evidence; tokens are spent and nothing is posted to GitHub.
   */
  reviewers?: "real" | "simulated";
  /**
   * Predict a change before it merges: a commit, branch or tag of the source repository (a fetched `pull/N/head`)
   * is merged into the replay's `origin/<base>` (the local bare origin and the clone's remote-tracking ref only; no
   * push to GitHub and no change to the source), so the tick runs on top of it.
   */
  mergeIntoBase?: string;
}

export type SimulatedVerdict = "pass" | "fail-repairable";

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
  /** What `--executor` did for a Session launched this tick. */
  executor?: string;
}

export interface ReplayReport {
  root: string;
  grantReceipt: string;
  activation: { ok: boolean; detail: string; warnings: string[]; source?: "press-receipt" | "card-descriptor" };
  ticks: ReplayTick[];
  stop: {
    reason: "launched" | "integrated" | "all_merged" | "external_effect" | "unrecorded_github_read" | "steady_state" | "host_operation_timeout" | "tick_limit" | "activation_refused" | "error";
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
  /** `card-descriptor`: synthesized from an unpressed card's script, not read from a press receipt. */
  source?: "press-receipt" | "card-descriptor";
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
  executor?: "scripted" | `candidate:${string}`;
  executorFiles?: Record<string, Record<string, string>>;
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

function clearPreservationClaims(databaseFile: string): number {
  const db = new Database(databaseFile);
  try {
    return db.prepare("DELETE FROM candidate_preservation_claims").run().changes;
  } catch {
    return 0;
  } finally {
    db.close();
  }
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

/** The scalar `NAME="value"` assignments and the `ACTIONS=( ... )` array of a card script's code lines. */
function cardScriptFields(script: string): { values: Record<string, string>; actions: string[]; code: string } {
  const code = script.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  const values: Record<string, string> = {};
  for (const match of code.matchAll(/^([A-Z][A-Z0-9_]*)=(?:"([^"\n]*)"|(\d+))\s*$/gm)) values[match[1]] = match[2] ?? match[3];
  const actions: string[] = [];
  const block = /^ACTIONS=\(\s*\n([\s\S]*?)^\)/m.exec(code);
  if (block) for (const line of block[1].split("\n")) if (line.trim()) actions.push(line.trim());
  return { values, actions, code };
}

/**
 * The scope a card's press would activate, read from its script's pinned
 * fields (the descriptor JSON only carries prose). Expiries are `now` plus the
 * card's packet-approval hours, as the card computes them at press time.
 * Refuses anything it cannot read faithfully rather than guessing.
 */
export function cardGrantReceipt(card: string, now: string, cardDir?: string): GrantReceipt {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(card)) throw new Error(`Card id "${card}" is not a plain operator-script id.`);
  const dir = cardDir ? path.resolve(cardDir) : path.join(REPO_ROOT, "artifacts", "generated", "operator-scripts");
  const scriptFile = path.join(dir, `${card}.sh`);
  const descriptorFile = path.join(dir, `${card}.json`);
  if (!existsSync(scriptFile) || !existsSync(descriptorFile)) throw new Error(`Card ${card}: ${card}.sh and ${card}.json must both exist in ${dir}.`);
  const descriptor = JSON.parse(readFileSync(descriptorFile, "utf8")) as { id?: string; kind?: string };
  if (descriptor.id !== card) throw new Error(`Card ${card}: its descriptor names id "${descriptor.id}".`);
  if (descriptor.kind !== "grant") throw new Error(`Card ${card} is a "${descriptor.kind}" card; only a grant card activates production.`);
  const { values, actions, code: allCode } = cardScriptFields(readFileSync(scriptFile, "utf8"));
  // Flags count only on the card's real invocation: `ARGS=(...)`/`ARGS+=(...)` lines and `production preview|activate` lines.
  const code = allCode.split("\n").filter((line) => /^\s*ARGS\+?=\(/.test(line) || /\bproduction\s+(preview|activate)\b/.test(line)).join("\n");
  if (values.CARD_EXPIRES_AT) {
    const expires = Date.parse(values.CARD_EXPIRES_AT);
    if (Number.isNaN(expires)) throw new Error(`Card ${card}: CARD_EXPIRES_AT "${values.CARD_EXPIRES_AT}" is not a date.`);
    if (new Date(now).getTime() >= expires) throw new Error(`Card ${card} expired at ${values.CARD_EXPIRES_AT}; the card itself would refuse ("ask for a fresh card").`);
  }
  for (const name of ["PROJECT", "PLAN", "PROVIDER", "TRANSITIONS"]) {
    if (!values[name]) throw new Error(`Card ${card}: its script does not pin ${name} as a plain quoted value.`);
    if (/[$`\\]/.test(values[name])) throw new Error(`Card ${card}: ${name} is computed, not pinned.`);
  }
  if (code.includes('--integration-grant-action "')) throw new Error(`Card ${card} names integration-grant Actions; the replay does not model them.`);
  let concurrencyValue = 1;
  const concurrencyFlag = /--concurrency\s+("?)([^\s")]+)\1/.exec(code);
  if (concurrencyFlag) {
    const raw = concurrencyFlag[2];
    const variable = /^\$\{?([A-Z][A-Z0-9_]*)\}?$/.exec(raw);
    const resolved = variable ? values[variable[1]] : raw;
    if (resolved === undefined || !/^\d+$/.test(resolved) || Number(resolved) < 1) {
      throw new Error(`Card ${card}: --concurrency ${raw} does not resolve to a pinned positive integer.`);
    }
    concurrencyValue = Number(resolved);
  }
  const decision = values.INTEGRATION_DECISION;
  const hours = Number(values.PACKET_APPROVAL_HOURS ?? 24);
  if (!(hours > 0)) throw new Error(`Card ${card}: PACKET_APPROVAL_HOURS is not positive.`);
  const expiresAt = new Date(new Date(now).getTime() + hours * 3_600_000).toISOString();
  const transitions = values.TRANSITIONS.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (code.includes("--integration-grant-decision") && !decision) throw new Error(`Card ${card}: an integration grant without a pinned INTEGRATION_DECISION.`);
  const scope: GrantReceipt["scope"] = {
    ...(values.INTENT ? { intent: values.INTENT } : {}),
    projects: [values.PROJECT],
    plans: [`${values.PROJECT}/${values.PLAN}`],
    ...(actions.length ? { actions: actions.map((id) => `${values.PROJECT}/${id}`) } : {}),
    providers: [values.PROVIDER],
    maxConcurrentSessions: concurrencyValue,
    mechanicalTransitions: transitions,
    ...(code.includes("--remote-preservation") ? { remotePreservation: true } : {}),
    ...(code.includes("--integration-grant-decision") ? {
      integrationGrant: { decisionRef: decision, expiresAt, ...(code.includes("--integration-grant-merge-pull-request") ? { mergeThroughPullRequest: true } : {}) }
    } : {}),
    ...(code.includes("--packet-approval-expires-at") ? { packetApprovalExpiresAt: expiresAt } : {})
  };
  return {
    requestId: `${card}-card-descriptor`,
    createdAt: now,
    scope,
    authority: { grantedAt: now, ...(values.SPEND_DECISION ? { decisionRef: values.SPEND_DECISION } : {}), grantedBy: "production-replay" },
    source: "card-descriptor"
  };
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
export function installGuards(root: string, effectsLog: string, simulateVerdict?: SimulatedVerdict, realCodex?: string): string {
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const record = (kind: string) => `printf '{"kind":"%s","detail":"%s"}\\n' ${shellQuote(kind)} "$(printf '%s' "$(pwd -P): $replay_args" | tr -d '"\\\\' | tr '\\n' ' ')" >> ${shellQuote(effectsLog)}`;
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
  if (simulateVerdict) {
    // SIMULATION ONLY (--simulate-verdict): the reviewer's sandbox probe and
    // `codex exec` answer from simulated-reviewer.mjs instead of refusing. The
    // reviewer runs with a stripped environment, so the verdict and the
    // effects log are baked into the guard rather than read from it.
    const simulatedReviewer = path.join(bin, "simulated-reviewer.mjs");
    writeFileSync(simulatedReviewer, SIMULATED_REVIEWER);
    writeFileSync(path.join(bin, "review-criteria.json"), JSON.stringify({ "code-review": CODE_REVIEW_PR_CRITERIA, qa: QA_PR_REVIEW_CRITERIA }));
    probes.codex = `  --version) echo "codex 0.0.0 (production replay)"; exit 0 ;;
  sandbox) printf 'sandbox-evidence-readable\\nsandbox-home-denied\\nsandbox-repository-denied\\nsandbox-network-denied\\n'; exit 0 ;;
  app-server) exit 1 ;;`;
    // The reviewer's Codex rate-limit read (\`codex app-server\`) reports nothing in a simulation.
    probes.codex += `
  exec) case "$2" in --help|-h) echo "Usage: codex exec --json --sandbox"; exit 0 ;; esac
    exec ${shellQuote(process.execPath)} ${shellQuote(simulatedReviewer)} ${shellQuote(simulateVerdict)} ${shellQuote(effectsLog)} "$@" ;;`;
  }
  for (const [name, answers] of Object.entries(probes)) {
    if (name === "codex" && realCodex) {
      // --reviewers real: the real Codex CLI (sandbox probe and `codex exec`), read-only; nothing else of the host is exposed.
      writeExecutable(path.join(bin, name), `#!/bin/sh\nexec ${shellQuote(realCodex)} "$@"\n`);
      continue;
    }
    writeExecutable(path.join(bin, name), `#!/bin/sh\nreplay_args="$*"\ncase "$1" in\n${answers}\nesac\n${record(`provider:${name}`)}\necho "production replay: refused to run ${name}" >&2\nexit 97\n`);
  }
  writeExecutable(path.join(bin, "tmux"), `#!/bin/sh
replay_args="$*"
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
# --work-tree, GIT_DIR and friends, path-valued -c keys, --output/-o, remote,
# worktree and clone paths), never a network remote.
replay_args="$*"
inside() { case "$1" in */../*|*/..|../*|..) return 1 ;; esac; case "$1" in ${roots.map((entry) => `${shellQuote(entry)}|${shellQuote(entry)}/*`).join("|")}) return 0 ;; esac; return 1; }
resolve() {
  case "$1" in /*) t="$1" ;; *) t="$dir/$1" ;; esac
  if r=$(cd "$t" 2>/dev/null && pwd -P); then printf '%s' "$r"; return; fi
  if r=$(cd "$(dirname "$t")" 2>/dev/null && pwd -P); then printf '%s/%s' "$r" "$(basename "$t")"; return; fi
  # Unresolvable: returned raw, and inside() refuses any ".." in it.
  printf '%s' "$t"
}
outside() { ${record("git:outside")}; echo "production replay: refused git outside the replay root ($1)" >&2; exit 97; }
network() { ${record("git:network")}; echo "production replay: refused git toward a network remote ($1)" >&2; exit 97; }
check() { resolved=$(resolve "$1"); inside "$resolved" || outside "$resolved"; }
dir=$(pwd -P)
# SIMULATION ONLY: the review command matches a PR to its Project by origin's
# GitHub URL; the replay's origin is a local bare clone, so name the source's.
if [ -n "$REPLAY_SIMULATE_VERDICT" ] && [ -n "$REPLAY_GH_REPO" ] && [ "$replay_args" = "remote get-url origin" ] && inside "$dir"; then
  echo "https://github.com/$REPLAY_GH_REPO.git"; exit 0
fi
for value in "$GIT_DIR" "$GIT_WORK_TREE" "$GIT_INDEX_FILE" "$GIT_COMMON_DIR" "$GIT_OBJECT_DIRECTORY"; do
  [ -n "$value" ] && check "$value"
done
prev=""
sub=""
positional=0
for arg in "$@"; do
  case "$prev" in
    -C) dir=$(resolve "$arg") ;;
    --git-dir|--work-tree|-o|--output) check "$arg" ;;
    -c)
      key=$(printf '%s' "\${arg%%=*}" | tr '[:upper:]' '[:lower:]')
      value="\${arg#*=}"
      case "$key" in
        *.insteadof|*.pushinsteadof|remote.*.url|remote.*.pushurl|core.sshcommand|core.gitproxy) network "$arg" ;;
        core.hookspath|core.worktree|core.excludesfile|core.attributesfile) [ "$value" = "/dev/null" ] || check "$value" ;;
      esac ;;
  esac
  case "$arg" in --git-dir=*|--work-tree=*|--output=*) check "\${arg#*=}" ;; esac
  if [ -z "$sub" ]; then
    case "$prev" in -C|-c|--git-dir|--work-tree) ;; *) case "$arg" in -*) ;; *) sub="$arg" ;; esac ;; esac
  else
    case "$arg" in -*) ;; *)
      positional=$((positional + 1))
      case "$sub" in push|fetch|pull|clone|ls-remote|remote|submodule) case "$arg" in *://*|git@*:*) network "$arg" ;; esac ;; esac
      case "$sub" in
        push|fetch|pull|clone|ls-remote)
          # The remote: a named remote, or a local path that must be inside the root; host:path is the network.
          if [ "$positional" = 1 ]; then
            case "$arg" in
              */*|.*) check "$arg" ;;
              *:*) network "$arg" ;;
            esac
          fi
          [ "$sub" = clone ] && check "$arg" ;;
        remote|worktree|submodule|archive|bundle|format-patch)
          case "$arg" in /*|.*|*/*) check "$arg" ;; esac ;;
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
const GH_GUARD = String.raw`import { appendFileSync, existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
// Written synchronously: process.exit() right after an async pipe write drops
// whatever is still buffered (a large "gh run view --log-failed" was cut off).
const writeOut = (text) => { if (text) writeSync(1, text); };
const writeErr = (text) => { if (text) writeSync(2, text); };
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
// SIMULATION ONLY (REPLAY_SIMULATE_GH_WRITES): pull-request lifecycle writes
// succeed without GitHub, and later reads of that PR see the simulated state.
const overlayFile = env.REPLAY_GH_OVERLAY;
const readOverlay = () => { try { return JSON.parse(readFileSync(overlayFile, "utf8")); } catch { return {}; } };
// SIMULATION ONLY (REPLAY_SIMULATE_PRS, with --executor): pull requests live in a registry. \`pr create\` registers one
// (head and base are branches of the replay's local bare origin); reads are built from that origin's objects with a
// green required-check rollup on the exact head; \`pr merge\` fast-forwards ONLY the local bare origin, never GitHub.
const simPrs = env.REPLAY_SIMULATE_PRS === "1" && env.REPLAY_SIMULATE_GH_WRITES === "1" && overlayFile;
const prFile = (overlayFile || "") + ".prs";
const readPrs = () => { try { return JSON.parse(readFileSync(prFile, "utf8")); } catch { return {}; } };
const gitOut = (cwd, ...a) => { const r = spawnSync("git", a, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }); return r.status === 0 ? r.stdout : null; };
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function findPr(prs, ref) {
  if (!ref) return null;
  const text = String(ref);
  const number = /^\d+$/.test(text) ? text : (/\/pull\/(\d+)/.exec(text) || [])[1];
  if (number && prs[number]) return prs[number];
  return Object.values(prs).filter((pr) => pr.headRefName === text).at(-1) || null;
}
function prFacts(pr) {
  const rev = (ref) => (gitOut(pr.bare, "rev-parse", "--verify", "-q", ref) || "").trim();
  const head = pr.state === "MERGED" ? pr.mergedHead : rev("refs/heads/" + pr.headRefName);
  const baseTip = rev("refs/heads/" + pr.baseRefName);
  const mergeBase = pr.state === "MERGED" ? baseTip : (gitOut(pr.bare, "merge-base", baseTip, head) || "").trim();
  const files = (gitOut(pr.bare, "diff", "--numstat", mergeBase + ".." + head) || "").split("\n").filter(Boolean).map((line) => {
    const [add, del, ...rest] = line.split("\t");
    return { path: rest.join("\t"), additions: Number(add) || 0, deletions: Number(del) || 0 };
  });
  const oids = (gitOut(pr.bare, "rev-list", "--reverse", mergeBase + ".." + head) || "").split("\n").filter(Boolean);
  return {
    number: pr.number, title: pr.title, url: pr.url, state: pr.state, isDraft: pr.isDraft, body: pr.body,
    headRefName: pr.headRefName, headRefOid: head, baseRefName: pr.baseRefName, baseRefOid: baseTip,
    mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", isCrossRepository: false, files, commits: oids.map((oid) => ({ oid })),
    mergeCommit: pr.state === "MERGED" ? { oid: head } : null,
    statusCheckRollup: [{ __typename: "CheckRun", name: "replay-required-checks", workflowName: "production replay (simulated green on the exact head)", status: "COMPLETED", conclusion: "SUCCESS" }]
  };
}
const pickFields = (facts) => { const wanted = (flag("--json") || "").split(",").filter(Boolean); return Object.fromEntries(wanted.filter((key) => key in facts).map((key) => [key, facts[key]])); };
if (simPrs && args[0] === "pr") {
  const prs = readPrs();
  const save = () => writeFileSync(prFile, JSON.stringify(prs));
  const simulated = () => effect("simulated:github-write", "gh " + args.join(" "));
  if (args[1] === "create") {
    const bare = (gitOut(process.cwd(), "config", "--get", "remote.origin.url") || "").trim();
    const repo = flag("--repo") || env.REPLAY_GH_REPO || "simulated/replay";
    const number = 910000 + Object.keys(prs).length + 1;
    prs[number] = { number, url: "https://github.com/" + repo + "/pull/" + number, repo, bare, headRefName: flag("--head"), baseRefName: flag("--base") || "main", title: flag("--title") || "", body: flag("--body") || "", isDraft: args.includes("--draft"), state: "OPEN" };
    save(); simulated();
    writeOut(prs[number].url + "\n");
    process.exit(0);
  }
  const pr = findPr(prs, args[2]);
  if (pr) {
    if (args[1] === "view") { writeOut(JSON.stringify(pickFields(prFacts(pr))) + "\n"); process.exit(0); }
    if (["ready", "edit", "comment", "close", "merge"].includes(args[1])) {
      simulated();
      if (args[1] === "ready") pr.isDraft = args.includes("--undo");
      if (args[1] === "edit" && flag("--body") !== undefined) pr.body = flag("--body");
      if (args[1] === "edit" && flag("--title") !== undefined) pr.title = flag("--title");
      if (args[1] === "close") pr.state = "CLOSED";
      if (args[1] === "merge") {
        const head = (gitOut(pr.bare, "rev-parse", "--verify", "-q", "refs/heads/" + pr.headRefName) || "").trim();
        const base = (gitOut(pr.bare, "rev-parse", "--verify", "-q", "refs/heads/" + pr.baseRefName) || "").trim();
        const match = flag("--match-head-commit");
        if (pr.state !== "OPEN" || pr.isDraft) { writeErr("simulated merge refused: pull request is " + pr.state + (pr.isDraft ? " (draft)" : "") + "\n"); process.exit(1); }
        if (match && match !== head) { writeErr("simulated merge refused: head " + head + " does not match --match-head-commit " + match + "\n"); process.exit(1); }
        if (gitOut(pr.bare, "merge-base", "--is-ancestor", base, head) === null) { writeErr("simulated merge refused: base " + base + " is not an ancestor of head " + head + " (replay fast-forwards only)\n"); process.exit(1); }
        if (gitOut(pr.bare, "update-ref", "refs/heads/" + pr.baseRefName, head, base) === null) { writeErr("simulated merge could not move the local origin\n"); process.exit(1); }
        pr.state = "MERGED"; pr.mergedHead = head;
      }
      save();
      process.exit(0);
    }
  }
  // No simulated PR matches: offline, the replay's own branches have no PR yet (the recording cannot know them);
  // live, the real gh answers for PRs that exist on GitHub.
  if (args[1] === "view" && !pr && env.REPLAY_GH_MODE !== "live") { writeErr("no pull requests found for " + String(args[2]) + "\n"); process.exit(1); }
  if (args[1] === "list") {
    const matches = Object.values(prs).filter((entry) => (!flag("--head") || entry.headRefName === flag("--head")) && (!flag("--state") || flag("--state") === "all" || entry.state.toLowerCase() === flag("--state")));
    if (matches.length || env.REPLAY_GH_MODE !== "live") { writeOut(JSON.stringify(matches.map((entry) => pickFields(prFacts(entry)))) + "\n"); process.exit(0); }
  }
}
if (simPrs && args[0] === "api") {
  const compare = args.map((value) => /compare\/([0-9a-f]{7,64})\.\.\.([0-9a-f]{7,64})/.exec(value)).find(Boolean);
  if (compare) {
    for (const entry of Object.values(readPrs())) {
      const patch = gitOut(entry.bare, "format-patch", "--stdout", "--no-signature", compare[1] + "..." + compare[2]);
      if (patch) { writeOut(patch); process.exit(0); }
    }
  }
}
const SIMULATED_PR_WRITES = ["ready", "comment", "close", "edit", "merge"];
if (!isRead() && env.REPLAY_SIMULATE_GH_WRITES === "1" && args[0] === "pr" && SIMULATED_PR_WRITES.includes(args[1]) && args[2]) {
  const overlay = readOverlay();
  const pr = overlay[args[2]] ?? {};
  if (args[1] === "ready") pr.isDraft = args.includes("--undo");
  if (args[1] === "close") pr.state = "CLOSED";
  if (args[1] === "merge") pr.state = "MERGED";
  overlay[args[2]] = pr;
  writeFileSync(overlayFile, JSON.stringify(overlay));
  effect("simulated:github-write", "gh " + args.join(" "));
  process.exit(0);
}
// The tick's board status sync edits a Project item; nothing parses its stdout.
if (!isRead() && env.REPLAY_SIMULATE_GH_WRITES === "1" && args[0] === "project" && args[1] === "item-edit") {
  effect("simulated:github-write", "gh " + args.join(" "));
  process.exit(0);
}
// The tick mirrors an Action as a GitHub Issue: \`issue create\` (stdout parsed for the URL), then
// \`project item-add\` (stdout parsed for the item id). Both answer fake, unique values; nothing is created.
if (!isRead() && env.REPLAY_SIMULATE_GH_WRITES === "1" && args[0] === "issue" && ["create", "edit", "comment", "close"].includes(args[1])) {
  effect("simulated:github-write", "gh " + args.join(" "));
  if (args[1] === "create") {
    const repo = args[args.indexOf("--repo") + 1] || env.REPLAY_GH_REPO || "simulated/replay";
    const counter = (overlayFile || "") + ".issues";
    let n = 900000;
    try { n = Number(readFileSync(counter, "utf8")) + 1; } catch {}
    try { writeFileSync(counter, String(n)); } catch {}
    writeOut("https://github.com/" + repo + "/issues/" + n + "\n");
  }
  process.exit(0);
}
if (!isRead() && env.REPLAY_SIMULATE_GH_WRITES === "1" && args[0] === "project" && args[1] === "item-add") {
  effect("simulated:github-write", "gh " + args.join(" "));
  writeOut(JSON.stringify({ id: "PVTI_SIMULATED_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6) }) + "\n");
  process.exit(0);
}
// Board ordering sync: only the position mutation of an item is simulated; stdout is not parsed.
if (!isRead() && env.REPLAY_SIMULATE_GH_WRITES === "1" && args[0] === "api" && args[1] === "graphql" && args.some((value) => /^query=mutation\b[^]*\bupdateProjectV2ItemPosition\(/.test(value))) {
  effect("simulated:github-write", "gh " + args.join(" "));
  writeOut(JSON.stringify({ data: { updateProjectV2ItemPosition: { items: { totalCount: 1 } } } }) + "\n");
  process.exit(0);
}
const overlaid = (stdout) => {
  if (args[0] !== "pr" || args[1] !== "view" || !overlayFile) return stdout;
  try {
    const view = JSON.parse(stdout);
    if (!view || typeof view !== "object") return stdout;
    // Keyed by URL: a read by number (--repo) is matched through the URL it returns.
    const pr = readOverlay()[typeof view.url === "string" ? view.url : args[2]] ?? readOverlay()[args[2]];
    if (!pr) return stdout;
    for (const key of ["isDraft", "state"]) if (key in pr && key in view) view[key] = pr[key];
    return JSON.stringify(view) + "\n";
  } catch { return stdout; }
};
if (!isRead()) {
  effect("github:write", "gh " + args.join(" "));
  writeErr("production replay: refused GitHub write (gh " + args.join(" ") + ")\n");
  process.exit(1);
}
const key = JSON.stringify(args);
if (env.REPLAY_GH_MODE === "live" && env.REPLAY_REAL_GH) {
  const real = spawnSync(env.REPLAY_REAL_GH, args, { encoding: "utf8", env: { PATH: env.REPLAY_REAL_PATH, HOME: env.REPLAY_REAL_HOME, GH_REPO: env.REPLAY_GH_REPO ?? "", GH_PROMPT_DISABLED: "1" }, maxBuffer: 64 * 1024 * 1024 });
  const entry = { args, status: real.status ?? 1, stdout: real.stdout ?? "", stderr: real.stderr ?? "" };
  appendFileSync(env.REPLAY_GH_RECORDING, JSON.stringify(entry) + "\n");
  writeOut(overlaid(entry.stdout));
  writeErr(entry.stderr);
  process.exit(entry.status);
}
const recorded = existsSync(env.REPLAY_GH_RECORDING ?? "") ? readFileSync(env.REPLAY_GH_RECORDING, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => JSON.stringify(entry.args) === key).at(-1) : null;
if (!recorded) {
  effect("github:unrecorded-read", "gh " + args.join(" "));
  writeErr("production replay: no recorded answer for gh " + args.join(" ") + "\n");
  process.exit(1);
}
writeOut(overlaid(recorded.stdout));
writeErr(recorded.stderr);
process.exit(recorded.status);
`;

/**
 * SIMULATION ONLY: the reviewer `codex exec` under --simulate-verdict (argv: verdict, effects log, codex args).
 * It reads the prompt (stdin) for the role, writes a schema-valid verdict to
 * `--output-last-message` and records a `simulated:reviewer` effect. It says
 * nothing about what the real reviewer would judge.
 */
const SIMULATED_REVIEWER = String.raw`import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const [simulated, effectsLog, ...args] = process.argv.slice(2);
const prompt = readFileSync(0, "utf8");
const role = prompt.includes("Exact-Head Code Review") ? "code-review" : "qa";
const criteria = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "review-criteria.json"), "utf8"))[role];
const fail = simulated === "fail-repairable" && role === "code-review";
const verdict = {
  verdict: fail ? "fail" : "pass",
  summary: fail ? "SIMULATED verdict (production replay): one repairable defect." : "SIMULATED verdict (production replay): no defect.",
  findings: fail ? [{ severity: "medium", title: "SIMULATED repairable defect", evidence: "Simulated by the production replay; no reviewer ran.", recommendation: "Fix the simulated defect." }] : [],
  checks: criteria.map((criterion) => ({ criterion: criterion.id, name: criterion.name, status: fail && criterion.id === "correctness" ? "fail" : "pass",
    evidence: "SIMULATED by the production replay; no reviewer judged " + criterion.name + "." })),
  residualRisks: []
};
writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify(verdict) + "\n");
appendFileSync(effectsLog, JSON.stringify({ kind: "simulated:reviewer", detail: role + " " + verdict.verdict }) + "\n");
process.stdout.write('{"type":"task.completed"}\n');
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
  if (options.executor !== undefined && options.executor !== "scripted" && !(typeof options.executor === "string" && /^candidate:\S+$/.test(options.executor))) {
    throw new Error("--executor is scripted or candidate:<ref>.");
  }
  if (options.reviewers !== undefined && options.reviewers !== "real" && options.reviewers !== "simulated") throw new Error("--reviewers is real or simulated.");
  if (options.executor && !options.simulateGithubWrites) throw new Error("--executor needs --simulate-github-writes: the pull request it opens and merges is simulated.");
  const realCodex = options.reviewers === "real" ? which("codex") : null;
  if (options.reviewers === "real" && !realCodex) throw new Error("--reviewers real needs the codex CLI on PATH.");
  if (options.reviewers === "real" && options.simulateVerdict) throw new Error("--reviewers real and --simulate-verdict are alternatives.");
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

    let receipt: GrantReceipt;
    if (options.card) {
      receipt = cardGrantReceipt(options.card, options.now ?? new Date().toISOString(), options.cardDir);
      print(`Activation built from card descriptor ${options.card}, not a press receipt: its pinned scope is activated as a press would, but none of the card's own preconditions (Decisions, capacity gate, sign-in, release) were checked.`);
      fidelity.push(`ACTIVATION BUILT FROM CARD DESCRIPTOR ${options.card}, NOT A PRESS RECEIPT: scope read from the card's script; expiries are the replay clock plus the card's hours; the card's preconditions were not run.`);
    } else {
      receipt = latestGrantReceipt(databaseFile, options.grant!);
      print(`Grant receipt: ${receipt.requestId} (${receipt.createdAt})`);
    }
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
    (options.worktreeRoots ?? []).forEach((from, index) => mappings.push({ from: path.resolve(from), to: path.join(root, "agent-worktrees", `extra-${index}`) }));
    const sessions = sessionWorktrees(databaseFile, [...inScope]);
    const rewrite = rewriteSnapshotPaths(databaseFile, mappings);
    if (rewrite.remaining.length > 0) {
      throw new Error(`Path rewrite incomplete; refusing to run a tick that could reach a source path: ${JSON.stringify(rewrite.remaining.slice(0, 5))}`);
    }
    // A live claim names a live host process; it would hold the replay's preservation for its whole lease.
    const claims = clearPreservationClaims(databaseFile);
    if (claims > 0) fidelity.push(`${claims} preservation claim(s) from the source were cleared; the replay's own worker claims afresh.`);
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
      if (options.executor?.startsWith("candidate:")) {
        // The candidate commit (a preserved PR head, say) is pinned in the replay clone under a private ref.
        const wanted = options.executor.slice("candidate:".length);
        const sha = git(repoPath, ["rev-parse", "--verify", "-q", `${wanted}^{commit}`]).trim();
        if (!sha) throw new Error(`--executor candidate:${wanted} does not resolve to a commit in ${repoPath}.`);
        git(target, ["update-ref", "refs/replay/candidate", sha]);
        fidelity.push(`EXECUTOR candidate:${wanted}: each Session's branch is reset to ${sha.slice(0, 12)}; no Ask is drafted by the replay.`);
      }
      if (options.mergeIntoBase) {
        const sha = git(repoPath, ["rev-parse", "--verify", "-q", `${options.mergeIntoBase}^{commit}`]).trim();
        const baseBranch = spawnSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], { cwd: repoPath, encoding: "utf8", env: GIT_READ_ENV }).stdout.trim() || "main";
        const tip = refs[`refs/remotes/origin/${baseBranch}`] ?? refs[`refs/heads/${baseBranch}`];
        if (!tip) throw new Error(`--merge-into-base: ${slug} has no origin/${baseBranch} to merge onto.`);
        const tree = git(target, ["merge-tree", "--write-tree", tip, sha]).split("\n")[0].trim();
        const merged = git(target, ["-c", "user.name=Production Replay", "-c", "user.email=production-replay@arcadia.invalid", "-c", "commit.gpgsign=false", "commit-tree", tree, "-p", tip, "-p", sha, "-m", `Production replay: merge ${options.mergeIntoBase} into origin/${baseBranch}`]).trim();
        git(target, ["push", "-q", "--force", path.join(root, "remotes", `${slug}.git`), `${merged}:refs/heads/${baseBranch}`]);
        git(target, ["update-ref", `refs/remotes/origin/${baseBranch}`, merged]);
        fidelity.push(`MERGE-INTO-BASE: ${options.mergeIntoBase} (${sha.slice(0, 12)}) is merged into the replay's origin/${baseBranch} (${tip.slice(0, 12)} -> ${merged.slice(0, 12)}); nothing was pushed to GitHub.`);
        print(`Merged ${options.mergeIntoBase} into the replay's origin/${baseBranch}.`);
      }
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
    const realGh = installGuards(root, effectsLog, options.simulateVerdict, realCodex ?? undefined);
    const home = path.join(root, "home");
    mkdirSync(path.join(home, ".config"), { recursive: true });
    writeFileSync(path.join(home, ".gitconfig"), "[user]\n\tname = Arcadia Production Replay\n\temail = production-replay@arcadia.invalid\n[commit]\n\tgpgsign = false\n[core]\n\tfsmonitor = false\n");
    const recording = options.githubRecording ? path.resolve(options.githubRecording) : path.join(root, "github-recording.jsonl");
    if (!existsSync(recording)) writeFileSync(recording, "");
    const manifest: Manifest = {
      root, workspace, receipt, now: options.now ?? new Date().toISOString(), ticks: options.ticks ?? (options.executor ? 80 : 12), repos, effectsLog, fidelity,
      ...(options.executor ? { executor: options.executor } : {}), ...(options.executorFiles ? { executorFiles: options.executorFiles } : {})
    };
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
      REPLAY_GH_REPO: Object.values(repos).map(githubRepository).find(Boolean) ?? "",
      REPLAY_SIMULATE_VERDICT: options.simulateVerdict ?? "",
      REPLAY_SIMULATE_GH_WRITES: options.simulateGithubWrites ? "1" : "",
      REPLAY_SIMULATE_PRS: options.executor ? "1" : "",
      REPLAY_GH_OVERLAY: path.join(root, "github-overlay.json")
    });
    if (options.simulateVerdict) {
      // The reviewer preflight's host baseline proves the home probe file is
      // readable outside the sandbox; the replay home gets a placeholder (no credential).
      mkdirSync(path.join(home, ".codex"), { recursive: true });
      writeFileSync(path.join(home, ".codex", "auth.json"), "{\"productionReplay\":\"placeholder; no credential\"}\n");
      print(`SIMULATION: every independent reviewer verdict is simulated as "${options.simulateVerdict}"; the real reviewer never runs and may judge otherwise.`);
      fidelity.push(`SIMULATION: reviewer verdicts are simulated as "${options.simulateVerdict}" (--simulate-verdict); they predict what the worker does with such a verdict, not the verdict. \`git remote get-url origin\` in a replay repository answers the source's GitHub URL so the review command can match the PR.`);
    }
    if (options.reviewers === "real") {
      // The reviewer's boundary probe needs ~/.codex/auth.json readable outside its sandbox and denied inside: the replay home links to the host's.
      symlinkSync(path.join(realHome, ".codex"), path.join(home, ".codex"));
      print("REVIEWERS: the real code-review and QA reviewers (codex exec, read-only sandbox) run against the replay's simulated pull-request evidence; tokens are spent, nothing is posted.");
      fidelity.push("REVIEWERS REAL (--reviewers real): verdicts come from the real read-only reviewers over the replay's simulated PR evidence (patch from the local origin, green simulated checks); the replay home links the host's ~/.codex for sign-in.");
    }
    if (options.executor) {
      print(`EXECUTOR ${options.executor}: the Session's result is produced by the replay, then the real tick reconciles, validates, settles, preserves, opens a SIMULATED PR, reviews and worker-merges (simulated; only the replay's local origin moves).`);
      fidelity.push(`SIMULATION: --executor ${options.executor}; the pull request is simulated: required checks are green on the exact head by construction, \`gh pr merge\` fast-forwards only the replay's local bare origin, and branch protection, CI and conflicts are not replayed.`);
    }
    if (options.simulateGithubWrites) {
      print("SIMULATION: gh pr ready/comment/close/edit/merge and gh project item-edit/item-add and gh issue create/edit/comment/close (Action mirror Issues) succeed without GitHub; later PR reads see the simulated state.");
      fidelity.push("SIMULATION: pull-request writes (ready, comment, close, edit, merge) project item-edit/item-add and Action mirror Issue writes (issue create/edit/comment/close) were simulated (--simulate-github-writes); GitHub's own response (checks re-running, branch protection, merge conflicts) is not.");
    }
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

  const activationSource = manifest.receipt.source ?? "press-receipt";
  // A card's scope names every pinned Action; like the card, only those still open in the Plan are scoped.
  if (activationSource === "card-descriptor" && scope.actions?.length && scope.plans?.length) {
    try {
      const { discoverDocs } = await import("../src/docs/discover.js");
      const [projectSlug, planSlug] = scope.plans[0].split("/");
      const repo = path.join(manifest.root, "repos", projectSlug);
      const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.project === projectSlug && doc.slug === planSlug) as { actions: Array<{ id: string; status: string }> } | undefined;
      if (!plan) throw new Error(`Plan ${scope.plans[0]} is not in the replay repository.`);
      const known = new Set(plan.actions.map((action) => action.id));
      const missing = scope.actions.filter((key) => !known.has(key.slice(key.indexOf("/") + 1)));
      if (missing.length) throw new Error(`pinned Action(s) not in the Plan at the replay repository's checkout, where the card would refuse: ${missing.join(", ")}`);
      const open = new Set(plan.actions.filter((action) => action.status !== "done").map((action) => action.id));
      const kept = scope.actions.filter((key) => open.has(key.slice(key.indexOf("/") + 1)));
      if (!kept.length) throw new Error("every pinned Action is already done; the card would refuse.");
      if (kept.length !== scope.actions.length) manifest.fidelity.push(`Card scope narrowed to the still-open pinned Actions (${kept.length} of ${scope.actions.length}), as the card does at press time.`);
      scope.actions = kept;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.activation = { ok: false, detail: message, warnings: [], source: activationSource };
      report.stop = { reason: "activation_refused", detail: message };
      predicted.add(`activation refused: ${message}`);
      out(`Activation (built from card descriptor, not a press receipt): REFUSED -- ${message}`);
      finish();
      return;
    }
  }
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
    report.activation = { ok: true, detail: `${activated.data.result.transition} revision ${activated.data.result.policy.revision}`, warnings: [...preview.warnings, ...activated.warnings], source: activationSource };
    out(`Activation: ok (${report.activation.detail})${activationSource === "card-descriptor" ? " -- built from card descriptor, not a press receipt" : ""}`);
    for (const warning of report.activation.warnings) { out(`  warning: ${warning}`); predicted.add(`activation warning: ${warning}`); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.activation = { ok: false, detail: message, warnings: [], source: activationSource };
    report.stop = { reason: "activation_refused", detail: message };
    predicted.add(`activation refused: ${message}`);
    out(`Activation: REFUSED -- ${message}${activationSource === "card-descriptor" ? " (built from card descriptor, not a press receipt)" : ""}`);
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

  /** Pinned Actions not yet done in the replay repository's Plan; null when the scope names no Plan to read. */
  const unmergedPinnedActions = async (): Promise<string[] | null> => {
    if (!scope.plans?.length) return null;
    try {
      const { discoverDocs } = await import("../src/docs/discover.js");
      const [projectSlug, planSlug] = scope.plans[0].split("/");
      const plan = discoverDocs(path.join(manifest.root, "repos", projectSlug)).docs.find((doc) => doc.type === "plan" && doc.project === projectSlug && doc.slug === planSlug) as { actions: Array<{ id: string; status: string }> } | undefined;
      if (!plan) return null;
      const pinned = scope.actions?.length ? new Set(scope.actions.map((key) => key.slice(key.indexOf("/") + 1))) : null;
      return plan.actions.filter((action) => (!pinned || pinned.has(action.id)) && action.status !== "done").map((action) => action.id);
    } catch {
      return null;
    }
  };
  /** --executor: produce the launched Session's result in its worktree, then the caller ends its pane. */
  const runExecutor = async (launch: { name: string; cwd: string; command: string; args: string[] }): Promise<string> => {
    try {
      if (manifest.executor === "scripted") {
        const { ScriptedExecutor } = await import("../tests/fast-rehearsal/helpers/executor.js");
        const { PhaseRecorder } = await import("../tests/fast-rehearsal/helpers/report.js");
        const recorder = new PhaseRecorder("production-replay", path.join(manifest.root, "executor.json"), (text: string) => text);
        const executor = new ScriptedExecutor(workspace, recorder, path.join(manifest.root, "unreachable-from-the-agent-sandbox"));
        const brief = launch.args.at(-1) ?? "";
        const action = /^Action: (.+)$/m.exec(brief)?.[1]?.trim() ?? "";
        const files = manifest.executorFiles?.[action] ?? manifest.executorFiles?.[action.slice(action.indexOf("/") + 1)] ?? { "REPLAY_SCRIPTED_WORK.md": `Scripted Session work for ${action} (production replay).\n` };
        const result = executor.run(launch, { files, validation: "true" }, "clean");
        return `scripted executor finished ${result.brief.action}: work ${result.workCommit.slice(0, 12)}, settlement ${result.settlementCommit?.slice(0, 12) ?? "none"}, head ${result.finalHead.slice(0, 12)}${result.settleWarnings.length ? `, settle warnings: ${result.settleWarnings.join("; ")}` : ""}`;
      }
      const reset = spawnSync("git", ["reset", "--hard", "-q", "refs/replay/candidate"], { cwd: launch.cwd, encoding: "utf8" });
      if (reset.status !== 0) throw new Error(`git reset --hard refs/replay/candidate failed in ${launch.cwd}: ${reset.stderr.trim()}`);
      return `${manifest.executor}: ${launch.cwd} reset to ${spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: launch.cwd, encoding: "utf8" }).stdout.trim()}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      predicted.add(`executor failed (${manifest.executor}): ${message}`);
      return `FAILED ${manifest.executor}: ${message.slice(0, 1500)}`;
    }
  };

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
        lines.push("(worker) a preservation request is in flight; the managed tick is skipped this iteration (go and enrollment workers are not awaited; their effects surface as late effects)");
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
    if (manifest.executor && tick.launch?.outcome === "launched" && tmux.launches.length > 0) {
      tick.executor = await runExecutor(tmux.launches.at(-1)!);
      tmux.live.delete(tmux.launches.at(-1)!.name);
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

    if (manifest.executor) {
      const unmerged = await unmergedPinnedActions();
      if (unmerged !== null && unmerged.length === 0) {
        report.stop = { reason: "all_merged", detail: `every pinned Action is done in the replay repository after ${n} ticks (merges simulated)` };
        for (const effect of tick.effects) if (effect.kind.startsWith("simulated:")) predicted.add(`SIMULATED ${effect.kind}: ${effect.detail}`);
        break;
      }
    }
    if (tick.launch?.outcome === "launched" && !manifest.executor) {
      const launch = tmux.launches.at(-1);
      report.stop = { reason: "launched", detail: `${tick.launch.actionKey}${launch ? ` in ${launch.cwd}: ${launch.command} ${launch.args.join(" ").slice(0, 400)}` : ""}` };
      break;
    }
    if (tick.handoff?.integrationKind === "integrated" && !manifest.executor) {
      report.stop = { reason: "integrated", detail: tick.handoff.integration };
      break;
    }
    // A simulated effect (--simulate-verdict, --simulate-github-writes) was answered, so it does not stop the replay.
    const stopping = tick.effects.filter((effect) => !effect.kind.startsWith("simulated:"));
    for (const effect of tick.effects) if (effect.kind.startsWith("simulated:")) predicted.add(`SIMULATED ${effect.kind}: ${effect.detail}`);
    if (stopping.length > 0) {
      const unrecordedOnly = stopping.every((effect) => effect.kind === "github:unrecorded-read");
      report.stop = { reason: unrecordedOnly ? "unrecorded_github_read" : "external_effect", detail: stopping.map((effect) => `${effect.kind}: ${effect.detail}`).join("; ").slice(0, 2000) };
      for (const effect of stopping) predicted.add(`${effect.kind === "github:unrecorded-read" ? "replay gap (no recorded answer)" : "requested external effect"} ${effect.kind}: ${effect.detail}`);
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
  if (tick.executor) out(`   executor: ${tick.executor}`);
  if (tick.launch?.outcome === "launched" && launches.length) out(`   would start: ${launches.at(-1)!.command} (cwd ${launches.at(-1)!.cwd})`);
  if (tick.handoff) out(`   handoff: preservation ${tick.handoff.preservation}; integration ${tick.handoff.integration}`);
  for (const entry of tick.reconciled) out(`   reconciled ${entry.sessionId}: ${entry.outcome}`);
  for (const line of tick.log) out(`   log: ${line.slice(0, 800)}`);
  for (const entry of tick.escalations.added) out(`   + escalation ${entry.slice(0, 600)}`);
  for (const entry of tick.escalations.changed) out(`   ~ escalation ${entry.slice(0, 600)}`);
  for (const entry of tick.escalations.cleared) out(`   - escalation ${entry}`);
  for (const entry of tick.blockers) out(`   blocker ${entry.slice(0, 600)}`);
  for (const entry of tick.redAlerts) out(`   red alert ${entry.slice(0, 600)}`);
  for (const effect of tick.effects) out(`   ${effect.kind.startsWith("simulated:") ? "SIMULATED" : "EFFECT"} ${effect.kind}: ${effect.detail.slice(0, 600)}`);
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
      case "--card": options.card = value(); break;
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
      case "--simulate-verdict": {
        const verdict = value();
        if (verdict !== "pass" && verdict !== "fail-repairable") throw new Error("--simulate-verdict is pass or fail-repairable.");
        options.simulateVerdict = verdict;
        break;
      }
      case "--simulate-github-writes": options.simulateGithubWrites = true; break;
      case "--executor": {
        const executor = value();
        if (executor !== "scripted" && !/^candidate:\S+$/.test(executor)) throw new Error("--executor is scripted or candidate:<ref>.");
        options.executor = executor as ReplayOptions["executor"];
        break;
      }
      case "--executor-files": options.executorFiles = JSON.parse(readFileSync(value(), "utf8")) as ReplayOptions["executorFiles"]; break;
      case "--merge-into-base": options.mergeIntoBase = value(); break;
      case "--reviewers": {
        const reviewers = value();
        if (reviewers !== "real" && reviewers !== "simulated") throw new Error("--reviewers is real or simulated.");
        options.reviewers = reviewers;
        break;
      }
      case "--help": case "-h":
        process.stdout.write(`Usage: pnpm production-replay --source-workspace <workspace> (--grant <request-id prefix> | --card <grant operator-script id>) [--ticks 12] [--github offline|live] [--github-recording <jsonl>] [--now <iso>] [--report <file>] [--parent <dir>] [--keep] [--simulate-verdict pass|fail-repairable] [--simulate-github-writes] [--executor scripted|candidate:<ref>] [--executor-files <json>] [--reviewers real|simulated] [--merge-into-base <ref>]\n`
          + "  --simulate-verdict and --simulate-github-writes are SIMULATIONS: they show what the worker does next, never what the reviewer or GitHub would do.\n"
          + "  --executor continues past launch (Session result produced by the replay, simulated PR and merge); --reviewers real runs the real read-only reviewers over the simulated PR evidence (spends tokens).\n");
        process.exit(0);
        break;
      default: throw new Error(`Unknown argument ${flag}.`);
    }
  }
  if (!options.sourceWorkspace) throw new Error("--source-workspace is required (name the workspace explicitly; nothing is resolved from user config).");
  if (!options.grant && !options.card) throw new Error("--grant (the request-id prefix of the activation receipt to replay) or --card (a Grant card never pressed) is required.");
  if (options.grant && options.card) throw new Error("--grant and --card are alternatives; give one.");
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
