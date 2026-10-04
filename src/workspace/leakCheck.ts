import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  };
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
    liveWorkspace: livePath ? readLiveWorkspace(livePath) : { path: null, projectCount: null, queueRevision: null, error: "no live workspace configured" },
    hashes: {
      userConfig: hashFile(userConfigPath(env)),
      codexConfig: hashFile(path.join(home, ".codex", "config.toml")),
      claudeSettings: hashFile(path.join(home, ".claude", "settings.json")),
      claudeTrust: claudeTrustHash(path.join(home, ".claude.json"))
    },
    launchAgents: launchAgentHashes(path.join(home, "Library", "LaunchAgents"))
  };
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
  for (const key of Object.keys(before.hashes) as Array<keyof LeakSnapshot["hashes"]>) {
    push(`hashes.${key}`, before.hashes[key], after.hashes[key]);
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
    return { path: livePath, projectCount: null, queueRevision: null, error: "live workspace database not found" };
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(databaseFile, { readonly: true, fileMustExist: true });
    const projects = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    const queue = db.prepare("SELECT revision FROM action_queue_state WHERE id = 'portfolio'").get() as { revision: number } | undefined;
    return { path: livePath, projectCount: projects.count, queueRevision: queue?.revision ?? null, error: null };
  } catch (error) {
    return { path: livePath, projectCount: null, queueRevision: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
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
