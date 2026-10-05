import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { loadUserConfig, userConfigPath } from "./config.js";
import { getWorkspacePaths } from "./paths.js";

/**
 * The experiment leak check (Decision 0082): a snapshot of everything an
 * experiment workspace must never change — the live workspace's Project count
 * and queue revision, the host-global configuration every workspace shares,
 * and the Arcadia launchd services — taken before and after a session and
 * compared.
 *
 * It is strictly an observer. The live database is opened read-only, the
 * configuration files are reduced to SHA-256 hashes (their content is never
 * stored or printed), and the CLI wrapper records no activity row.
 *
 * Two further fields are attributed rather than compared as leaks: the live
 * workspace's activity rows and the live repository's refs. Other agents and
 * the operator move both all the time (every command against the live
 * workspace records a row; every push, fetch or settlement moves a ref), so a
 * change there is evidence to attribute, never by itself a leak.
 */
export interface LeakSnapshot {
  schema: "arcadia-leak-check-v1";
  takenAt: string;
  liveWorkspace: {
    path: string | null;
    projectCount: number | null;
    queueRevision: number | null;
    /** The live production authorization: a Grant or activation moves it. */
    productionPolicy: { desiredState: string; revision: number; epoch: number } | null;
    /** Durable receipt counters that only production transitions write (never activity rows). */
    productionPolicyReceipts: number | null;
    productionAdmissions: number | null;
    /**
     * Non-null when the live workspace could not be observed. Such a snapshot
     * proves nothing, so the leak check refuses to pass on it.
     */
    error: string | null;
  };
  /** sha256 hex of each file, or null when it does not exist. */
  hashes: {
    userConfig: string | null;
    codexConfig: string | null;
    claudeSettings: string | null;
    /**
     * `~/.claude.json` is rewritten by every running Claude Code session, so
     * its raw hash would change on every check. This hashes only the part the
     * go-broker writes: the sorted list of folders with an accepted trust
     * dialog.
     */
    claudeTrust: string | null;
    /** `~/.arcadia/telemetry/capacity-receipts.json`, written by `production capacity attest`. */
    capacityReceipts: string | null;
  };
  /**
   * The one host-wide go-broker: each release manifest, each `~/.local/bin`
   * launcher (symlink target or bytes) and each managed skill or rule file,
   * keyed by its home-relative path.
   */
  goBroker: Record<string, string>;
  /** `~/Library/LaunchAgents/com.arcadia.*.plist` file name → sha256 of its bytes. */
  launchAgents: Record<string, string>;
  /**
   * Attributed, never a leak by itself: the live `activity_events` row count
   * and newest row, read in the same read-only open. Absent in baselines taken
   * before it existed.
   */
  liveActivity?: LiveActivity;
  /** Attributed, never a leak by itself: the live repository's refs. */
  liveRefs?: LiveRefs;
}

export interface LiveActivity {
  rowCount: number | null;
  /** SQLite rowid of the newest row, i.e. insertion order. */
  newestRowid: number | null;
  newestId: string | null;
  newestCommand: string | null;
  newestOccurredAt: string | null;
  error: string | null;
}

export const LIVE_REF_NAMESPACES = ["refs/heads", "refs/remotes", "refs/tags", "refs/codex"] as const;
/** Above this many refs the snapshot keeps only the counts and the hash. */
export const LIVE_REFS_LIMIT = 5000;

export interface LiveRefs {
  repo: string | null;
  /** Where the repository path came from: `--live-repo`, or the live workspace's registered Arcadia Project. */
  source: "option" | "live workspace" | null;
  counts: { heads: number; remotes: number; tags: number; codex: number } | null;
  /** sha256 of the sorted `<refname> <object>` lines. */
  hash: string | null;
  /** refname → object id, or null above `LIVE_REFS_LIMIT`. */
  refs: Record<string, string> | null;
  error: string | null;
}

/** A change in an attributed field: reported, never counted as a leak. */
export interface AttributedChange {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

/** How many per-ref differences an attributed comparison lists before summarizing the rest. */
const ATTRIBUTED_REF_LIST_LIMIT = 50;

export interface LeakChange {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

export interface LeakCheckInput {
  /** The live workspace; defaults to the user config default, never ARCADIA_WORKSPACE. */
  liveWorkspace?: string;
  /** The live repository whose refs to list; defaults to the live workspace's registered Arcadia Project. */
  liveRepo?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export function takeLeakSnapshot(input: LeakCheckInput = {}): LeakSnapshot {
  const env = input.env ?? process.env;
  const home = path.resolve(input.home ?? os.homedir());
  const configured = input.liveWorkspace ?? loadUserConfig(env).defaultWorkspace ?? null;
  const livePath = configured ? path.resolve(configured) : null;
  const live = livePath
    ? readLiveWorkspace(livePath)
    : { workspace: { ...UNOBSERVED, path: null, error: "no live workspace configured" }, activity: unobservedActivity("no live workspace configured"), arcadiaRepo: null };
  return {
    schema: "arcadia-leak-check-v1",
    takenAt: (input.now ?? new Date()).toISOString(),
    liveWorkspace: live.workspace,
    hashes: {
      userConfig: hashFile(userConfigPath(env)),
      codexConfig: hashFile(path.join(home, ".codex", "config.toml")),
      claudeSettings: hashFile(path.join(home, ".claude", "settings.json")),
      claudeTrust: claudeTrustHash(path.join(home, ".claude.json")),
      capacityReceipts: hashFile(env.ARCADIA_CAPACITY_RECEIPTS_PATH?.trim() || path.join(home, ".arcadia", "telemetry", "capacity-receipts.json"))
    },
    goBroker: goBrokerHashes(home),
    launchAgents: launchAgentHashes(path.join(home, "Library", "LaunchAgents")),
    liveActivity: live.activity,
    liveRefs: input.liveRepo
      ? readLiveRefs(path.resolve(input.liveRepo), "option")
      : live.arcadiaRepo
        ? readLiveRefs(live.arcadiaRepo, "live workspace")
        : { ...UNOBSERVED_REFS, error: "no live repository: pass --live-repo, or register the Arcadia Project's repository in the live workspace" }
  };
}

const UNOBSERVED_REFS = { repo: null, source: null, counts: null, hash: null, refs: null } as const;

function unobservedActivity(error: string): LiveActivity {
  return { rowCount: null, newestRowid: null, newestId: null, newestCommand: null, newestOccurredAt: null, error };
}

const UNOBSERVED = {
  projectCount: null,
  queueRevision: null,
  productionPolicy: null,
  productionPolicyReceipts: null,
  productionAdmissions: null
} as const;

/** Why a snapshot (or a pair) cannot prove the live workspace unchanged, or null when it can. */
export function unverifiableReason(...snapshots: LeakSnapshot[]): string | null {
  for (const snapshot of snapshots) {
    if (snapshot.liveWorkspace.error) return `live workspace ${snapshot.liveWorkspace.path ?? "(none)"} was not observed: ${snapshot.liveWorkspace.error}`;
  }
  return null;
}

export function compareLeakSnapshots(before: LeakSnapshot, after: LeakSnapshot): LeakChange[] {
  const changes: LeakChange[] = [];
  const push = (field: string, a: string | number | null, b: string | number | null) => {
    if (a !== b) changes.push({ field, before: a, after: b });
  };
  push("liveWorkspace.path", before.liveWorkspace.path, after.liveWorkspace.path);
  push("liveWorkspace.projectCount", before.liveWorkspace.projectCount, after.liveWorkspace.projectCount);
  push("liveWorkspace.queueRevision", before.liveWorkspace.queueRevision, after.liveWorkspace.queueRevision);
  push("liveWorkspace.error", before.liveWorkspace.error, after.liveWorkspace.error);
  const policy = (snapshot: LeakSnapshot) => snapshot.liveWorkspace.productionPolicy
    ? JSON.stringify(snapshot.liveWorkspace.productionPolicy)
    : null;
  push("liveWorkspace.productionPolicy", policy(before), policy(after));
  push("liveWorkspace.productionPolicyReceipts", before.liveWorkspace.productionPolicyReceipts ?? null, after.liveWorkspace.productionPolicyReceipts ?? null);
  push("liveWorkspace.productionAdmissions", before.liveWorkspace.productionAdmissions ?? null, after.liveWorkspace.productionAdmissions ?? null);
  const hashKeys = [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])] as Array<keyof LeakSnapshot["hashes"]>;
  for (const key of hashKeys) {
    push(`hashes.${key}`, before.hashes[key] ?? null, after.hashes[key] ?? null);
  }
  const brokerItems = [...new Set([...Object.keys(before.goBroker ?? {}), ...Object.keys(after.goBroker ?? {})])].sort();
  for (const item of brokerItems) {
    push(`goBroker.${item}`, before.goBroker?.[item] ?? null, after.goBroker?.[item] ?? null);
  }
  const plists = [...new Set([...Object.keys(before.launchAgents), ...Object.keys(after.launchAgents)])].sort();
  for (const name of plists) {
    push(`launchAgents.${name}`, before.launchAgents[name] ?? null, after.launchAgents[name] ?? null);
  }
  return changes;
}

/**
 * Differences in the attributed fields. These are evidence to attribute (an
 * agent settling in the live workspace, a push, the operator running a
 * command), never a leak by themselves, so they are kept apart from
 * `compareLeakSnapshots` and never fail the check.
 */
export function compareAttributedFields(before: LeakSnapshot, after: LeakSnapshot): AttributedChange[] {
  const changes: AttributedChange[] = [];
  const push = (field: string, a: string | number | null, b: string | number | null) => {
    if (a !== b) changes.push({ field, before: a, after: b });
  };
  const activityBefore = before.liveActivity ?? null;
  const activityAfter = after.liveActivity ?? null;
  push("liveActivity.rowCount", activityBefore?.rowCount ?? null, activityAfter?.rowCount ?? null);
  push("liveActivity.newestRowid", activityBefore?.newestRowid ?? null, activityAfter?.newestRowid ?? null);
  push("liveActivity.error", activityBefore?.error ?? null, activityAfter?.error ?? null);
  const refsBefore = before.liveRefs ?? null;
  const refsAfter = after.liveRefs ?? null;
  push("liveRefs.repo", refsBefore?.repo ?? null, refsAfter?.repo ?? null);
  push("liveRefs.error", refsBefore?.error ?? null, refsAfter?.error ?? null);
  push("liveRefs.hash", refsBefore?.hash ?? null, refsAfter?.hash ?? null);
  const listBefore = refsBefore?.refs ?? null;
  const listAfter = refsAfter?.refs ?? null;
  if (listBefore && listAfter && refsBefore?.hash !== refsAfter?.hash) {
    const names = [...new Set([...Object.keys(listBefore), ...Object.keys(listAfter)])].sort()
      .filter((name) => listBefore[name] !== listAfter[name]);
    for (const name of names.slice(0, ATTRIBUTED_REF_LIST_LIMIT)) {
      push(`liveRefs.${name}`, listBefore[name] ?? null, listAfter[name] ?? null);
    }
    if (names.length > ATTRIBUTED_REF_LIST_LIMIT) {
      push("liveRefs.moreChangedRefs", 0, names.length - ATTRIBUTED_REF_LIST_LIMIT);
    }
  }
  return changes;
}

export function parseLeakSnapshot(raw: string, source: string): LeakSnapshot {
  const parsed = JSON.parse(raw) as Partial<LeakSnapshot>;
  if (parsed.schema !== "arcadia-leak-check-v1" || !parsed.liveWorkspace || !parsed.hashes || !parsed.launchAgents) {
    throw new Error(`${source} is not an arcadia-leak-check-v1 snapshot.`);
  }
  return parsed as LeakSnapshot;
}

interface LiveWorkspaceRead {
  workspace: LeakSnapshot["liveWorkspace"];
  activity: LiveActivity;
  /** The repository the live workspace registered for the Arcadia Project, if any. */
  arcadiaRepo: string | null;
}

function readLiveWorkspace(livePath: string): LiveWorkspaceRead {
  const databaseFile = getWorkspacePaths(livePath).databaseFile;
  if (!existsSync(databaseFile)) {
    const error = "live workspace database not found";
    return { workspace: { ...UNOBSERVED, path: livePath, error }, activity: unobservedActivity(error), arcadiaRepo: null };
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(databaseFile, { readonly: true, fileMustExist: true });
    const live = db;
    const hasTable = (name: string) => Boolean(live.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
    const count = (table: string) => hasTable(table)
      ? (live.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
      : null;
    const projects = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    const queue = db.prepare("SELECT revision FROM action_queue_state WHERE id = 'portfolio'").get() as { revision: number } | undefined;
    const policy = hasTable("production_policy")
      ? db.prepare("SELECT desired_state AS desiredState, revision, epoch FROM production_policy WHERE id = 'workspace'").get() as
        { desiredState: string; revision: number; epoch: number } | undefined
      : undefined;
    return {
      workspace: {
        path: livePath,
        projectCount: projects.count,
        queueRevision: queue?.revision ?? null,
        productionPolicy: policy ?? null,
        productionPolicyReceipts: count("production_policy_receipts"),
        productionAdmissions: count("production_admissions"),
        error: null
      },
      activity: readActivity(live, hasTable),
      arcadiaRepo: readArcadiaRepo(live, hasTable)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { workspace: { ...UNOBSERVED, path: livePath, error: message }, activity: unobservedActivity(message), arcadiaRepo: null };
  } finally {
    db?.close();
  }
}

/** Never throws: an unreadable activity table is reported, not a reason to call the snapshot unverifiable. */
function readActivity(db: Database.Database, hasTable: (name: string) => boolean): LiveActivity {
  try {
    return readActivityRows(db, hasTable);
  } catch (error) {
    return unobservedActivity(error instanceof Error ? error.message : String(error));
  }
}

function readActivityRows(db: Database.Database, hasTable: (name: string) => boolean): LiveActivity {
  if (!hasTable("activity_events")) return unobservedActivity("no activity_events table");
  const total = db.prepare("SELECT COUNT(*) AS count FROM activity_events").get() as { count: number };
  const newest = db.prepare(
    "SELECT rowid AS rowid, id, command, occurred_at AS occurredAt FROM activity_events ORDER BY rowid DESC LIMIT 1"
  ).get() as { rowid: number; id: string; command: string; occurredAt: string } | undefined;
  return {
    rowCount: total.count,
    newestRowid: newest?.rowid ?? null,
    newestId: newest?.id ?? null,
    newestCommand: newest?.command ?? null,
    newestOccurredAt: newest?.occurredAt ?? null,
    error: null
  };
}

function readArcadiaRepo(db: Database.Database, hasTable: (name: string) => boolean): string | null {
  if (!hasTable("project_metadata") || !hasTable("projects")) return null;
  let row: { repoPath: string } | undefined;
  try {
    row = db.prepare(
    `SELECT m.repo_path AS repoPath FROM project_metadata m JOIN projects p ON p.id = m.project_id
     WHERE p.slug = 'arcadia' AND m.repo_path IS NOT NULL AND m.repo_path != '' LIMIT 1`
    ).get() as { repoPath: string } | undefined;
  } catch {
    return null;
  }
  return row ? path.resolve(row.repoPath) : null;
}

/**
 * The live repository's refs (branches, remote-tracking branches, tags and
 * `refs/codex/*`) by name and target. `for-each-ref` takes no lock and
 * writes nothing; GIT_OPTIONAL_LOCKS=0 keeps it that way.
 */
function readLiveRefs(repo: string, source: "option" | "live workspace"): LiveRefs {
  let output: string;
  try {
    output = execFileSync(
      "git",
      ["-C", repo, "for-each-ref", "--format=%(refname) %(objectname)", ...LIVE_REF_NAMESPACES],
      { encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    const message = typeof stderr === "string" && stderr.trim() ? stderr.trim() : error instanceof Error ? error.message : String(error);
    return { ...UNOBSERVED_REFS, repo, source, error: message };
  }
  const lines = output.split("\n").filter(Boolean).sort();
  const refs: Record<string, string> = {};
  const counts = { heads: 0, remotes: 0, tags: 0, codex: 0 };
  for (const line of lines) {
    const separator = line.lastIndexOf(" ");
    const name = line.slice(0, separator);
    refs[name] = line.slice(separator + 1);
    if (name.startsWith("refs/heads/")) counts.heads += 1;
    else if (name.startsWith("refs/remotes/")) counts.remotes += 1;
    else if (name.startsWith("refs/tags/")) counts.tags += 1;
    else if (name.startsWith("refs/codex/")) counts.codex += 1;
  }
  return {
    repo,
    source,
    counts,
    hash: sha256(lines.join("\n")),
    refs: lines.length <= LIVE_REFS_LIMIT ? refs : null,
    error: null
  };
}

/**
 * Cheap, content-free fingerprints of the go-broker install: release
 * manifests, launchers and the managed skill and rule files. Missing
 * directories contribute nothing.
 */
function goBrokerHashes(home: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const record = (file: string) => {
    const key = path.relative(home, file);
    let stat;
    try { stat = lstatSync(file); } catch { return; }
    if (stat.isSymbolicLink()) hashes[key] = `link:${readlinkSync(file)}`;
    else if (stat.isFile()) hashes[key] = sha256(readFileSync(file));
  };
  const releases = path.join(home, ".local", "share", "arcadia", "go-broker", "releases");
  if (existsSync(releases)) {
    for (const release of readdirSync(releases).filter((entry) => !entry.startsWith(".")).sort()) {
      record(path.join(releases, release, "broker-manifest.json"));
    }
  }
  const bin = path.join(home, ".local", "bin");
  if (existsSync(bin)) {
    for (const entry of readdirSync(bin).filter((name) => /^arcadia-.*-broker/.test(name)).sort()) record(path.join(bin, entry));
  }
  for (const file of [
    path.join(home, ".codex", "skills", "arcadia-go", "SKILL.md"),
    path.join(home, ".codex", "skills", "arcadia-agent-ask", "SKILL.md"),
    path.join(home, ".codex", "rules", "arcadia.rules"),
    path.join(home, ".claude", "skills", "arcadia-go"),
    path.join(home, ".claude", "skills", "arcadia-agent-ask")
  ]) record(file);
  return hashes;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashFile(file: string): string | null {
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}

function claudeTrustHash(file: string): string | null {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  try {
    const state = JSON.parse(raw) as { projects?: Record<string, { hasTrustDialogAccepted?: unknown }> };
    const trusted = Object.entries(state.projects ?? {})
      .filter(([, project]) => project?.hasTrustDialogAccepted === true)
      .map(([folder]) => folder)
      .sort();
    return sha256(JSON.stringify(trusted));
  } catch {
    // Unparseable: fall back to the raw bytes so a change is still visible.
    return `raw:${sha256(raw)}`;
  }
}

function launchAgentHashes(directory: string): Record<string, string> {
  if (!existsSync(directory)) return {};
  const hashes: Record<string, string> = {};
  for (const name of readdirSync(directory).filter((entry) => /^com\.arcadia\..*\.plist$/.test(entry)).sort()) {
    hashes[name] = hashFile(path.join(directory, name)) ?? "";
  }
  return hashes;
}
