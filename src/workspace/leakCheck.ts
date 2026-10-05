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
}

export interface LeakChange {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

export interface LeakCheckInput {
  /** The live workspace; defaults to the user config default, never ARCADIA_WORKSPACE. */
  liveWorkspace?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export function takeLeakSnapshot(input: LeakCheckInput = {}): LeakSnapshot {
  const env = input.env ?? process.env;
  const home = path.resolve(input.home ?? os.homedir());
  const configured = input.liveWorkspace ?? loadUserConfig(env).defaultWorkspace ?? null;
  const livePath = configured ? path.resolve(configured) : null;
  return {
    schema: "arcadia-leak-check-v1",
    takenAt: (input.now ?? new Date()).toISOString(),
    liveWorkspace: livePath ? readLiveWorkspace(livePath) : { ...UNOBSERVED, path: null, error: "no live workspace configured" },
    hashes: {
      userConfig: hashFile(userConfigPath(env)),
      codexConfig: hashFile(path.join(home, ".codex", "config.toml")),
      claudeSettings: hashFile(path.join(home, ".claude", "settings.json")),
      claudeTrust: claudeTrustHash(path.join(home, ".claude.json")),
      capacityReceipts: hashFile(env.ARCADIA_CAPACITY_RECEIPTS_PATH?.trim() || path.join(home, ".arcadia", "telemetry", "capacity-receipts.json"))
    },
    goBroker: goBrokerHashes(home),
    launchAgents: launchAgentHashes(path.join(home, "Library", "LaunchAgents"))
  };
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

export function parseLeakSnapshot(raw: string, source: string): LeakSnapshot {
  const parsed = JSON.parse(raw) as Partial<LeakSnapshot>;
  if (parsed.schema !== "arcadia-leak-check-v1" || !parsed.liveWorkspace || !parsed.hashes || !parsed.launchAgents) {
    throw new Error(`${source} is not an arcadia-leak-check-v1 snapshot.`);
  }
  return parsed as LeakSnapshot;
}

function readLiveWorkspace(livePath: string): LeakSnapshot["liveWorkspace"] {
  const databaseFile = getWorkspacePaths(livePath).databaseFile;
  if (!existsSync(databaseFile)) {
    return { ...UNOBSERVED, path: livePath, error: "live workspace database not found" };
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
      path: livePath,
      projectCount: projects.count,
      queueRevision: queue?.revision ?? null,
      productionPolicy: policy ?? null,
      productionPolicyReceipts: count("production_policy_receipts"),
      productionAdmissions: count("production_admissions"),
      error: null
    };
  } catch (error) {
    return { ...UNOBSERVED, path: livePath, error: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
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
