import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { ArcadiaError } from "../cli/errors.js";
import { writeTransaction } from "../db/connection.js";
import {
  buildCapsule,
  hashSnapshotFile,
  snapshotPath,
  writeImmutableSnapshot,
  writeLiveCapsule,
  type Capsule,
  type CapsuleCustodian,
  type CapsuleSources
} from "./capsule.js";
import { withRelayLock, type RelayLockDeps } from "./lock.js";
import { coordinatorPaths, ensureCoordinatorDirectories, type CoordinatorPaths } from "./paths.js";
import { readCoordinatorState } from "./state.js";

/**
 * Coordinator custody (design section c). A coordinator holds no Action claim,
 * and `agent_sessions` cannot hold it (its Action and packet columns are NOT
 * NULL), so each handoff generation is one row here, keyed by Project, role and
 * generation. The row is the custody record; peer-watch never reads it.
 */
export const GENERATION_STATUSES = ["launching", "custodian", "handed_off", "failed"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** A complete `launching` claim younger than this refuses any further launch. */
export const CLAIM_LAUNCHING_FRESH_MS = 15 * 60 * 1000;
/** `accept` needs a passing `verify` on the same snapshot sha within this window. */
export const ACCEPT_VERIFY_WINDOW_MS = 10 * 60 * 1000;

/** Set by the relay's launcher on the coordinator's process tree; child commands inherit them. */
export const COORDINATOR_ENV = {
  role: "ARCADIA_COORDINATOR_ROLE",
  generation: "ARCADIA_COORDINATOR_GENERATION",
  token: "ARCADIA_COORDINATOR_TOKEN"
} as const;

/** The exact commands the custody guard covers (design section c, step 5). */
export type GuardedCommand = "note" | "subscribe" | "subscribe-from-snapshot" | "hold" | "renew" | "accept" | "ping";

export function ensureCoordinatorGenerationsTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS coordinator_generations (
    project TEXT NOT NULL,
    role TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    status TEXT NOT NULL CHECK (status IN ('launching', 'custodian', 'handed_off', 'failed')),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    tier TEXT NOT NULL,
    identity TEXT NOT NULL,
    native_session_id TEXT,
    transcript_path TEXT,
    tmux_name TEXT,
    remote_control_name TEXT,
    brief_path TEXT,
    brief_sha TEXT,
    snapshot_path TEXT,
    snapshot_sha TEXT,
    token_hash TEXT,
    verified_sha TEXT,
    verified_at TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    accepted_at TEXT,
    PRIMARY KEY (project, role, generation)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_coordinator_generations_one_custodian
    ON coordinator_generations(project, role) WHERE status = 'custodian';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_coordinator_generations_one_launching
    ON coordinator_generations(project, role) WHERE status = 'launching';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_coordinator_generations_token
    ON coordinator_generations(token_hash) WHERE token_hash IS NOT NULL;`);
}

interface Row {
  project: string; role: string; generation: number; status: GenerationStatus;
  provider: string; model: string; tier: string; identity: string;
  native_session_id: string | null; transcript_path: string | null; tmux_name: string | null; remote_control_name: string | null;
  brief_path: string | null; brief_sha: string | null; snapshot_path: string | null; snapshot_sha: string | null;
  token_hash: string | null; verified_sha: string | null; verified_at: string | null; failure_reason: string | null;
  created_at: string; updated_at: string; accepted_at: string | null;
}

export interface GenerationRecord {
  project: string; role: string; generation: number; status: GenerationStatus;
  provider: string; model: string; tier: string; identity: string;
  nativeSessionId: string | null; transcriptPath: string | null; tmuxName: string | null; remoteControlName: string | null;
  briefPath: string | null; briefSha: string | null; snapshotPath: string | null; snapshotSha: string | null;
  /** Whether the relay issued this generation a custody token (relay-launched). Never the token. */
  relayLaunched: boolean;
  verifiedSha: string | null; verifiedAt: string | null; failureReason: string | null;
  createdAt: string; updatedAt: string; acceptedAt: string | null;
}

function toRecord(row: Row): GenerationRecord {
  return {
    project: row.project, role: row.role, generation: row.generation, status: row.status,
    provider: row.provider, model: row.model, tier: row.tier, identity: row.identity,
    nativeSessionId: row.native_session_id, transcriptPath: row.transcript_path, tmuxName: row.tmux_name, remoteControlName: row.remote_control_name,
    briefPath: row.brief_path, briefSha: row.brief_sha, snapshotPath: row.snapshot_path, snapshotSha: row.snapshot_sha,
    relayLaunched: row.token_hash !== null,
    verifiedSha: row.verified_sha, verifiedAt: row.verified_at, failureReason: row.failure_reason,
    createdAt: row.created_at, updatedAt: row.updated_at, acceptedAt: row.accepted_at
  };
}

export function listGenerations(db: Database.Database, project: string, role: string): GenerationRecord[] {
  return (db.prepare("SELECT * FROM coordinator_generations WHERE project = ? AND role = ? ORDER BY generation").all(project, role) as Row[]).map(toRecord);
}

export function currentCustodian(db: Database.Database, project: string, role: string): GenerationRecord | null {
  const row = db.prepare("SELECT * FROM coordinator_generations WHERE project = ? AND role = ? AND status = 'custodian'").get(project, role) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function newestLaunching(db: Database.Database, project: string, role: string): GenerationRecord | null {
  const row = db.prepare("SELECT * FROM coordinator_generations WHERE project = ? AND role = ? AND status = 'launching'").get(project, role) as Row | undefined;
  return row ? toRecord(row) : null;
}

function maxGeneration(db: Database.Database, project: string, role: string): number {
  const row = db.prepare("SELECT MAX(generation) AS max FROM coordinator_generations WHERE project = ? AND role = ?").get(project, role) as { max: number | null };
  return row.max ?? 0;
}

export function custodianOf(record: GenerationRecord | null): CapsuleCustodian | null {
  if (!record) return null;
  return {
    provider: record.provider, model: record.model, tier: record.tier, identity: record.identity,
    sessionId: record.nativeSessionId, transcriptPath: record.transcriptPath, tmuxName: record.tmuxName, remoteControlName: record.remoteControlName
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function appendLog(paths: CoordinatorPaths, event: string, fields: Record<string, unknown>, now: Date): void {
  ensureCoordinatorDirectories(paths);
  appendFileSync(paths.generationsLog, `${JSON.stringify({ at: now.toISOString(), event, ...fields })}\n`, { mode: 0o600 });
}

function refused(message: string, reason: string, details: Record<string, unknown> = {}): ArcadiaError {
  return new ArcadiaError("VALIDATION_ERROR", message, 2, { reason, ...details });
}

export interface GenerationIdentity {
  provider: string; model: string; tier: string; identity: string;
  nativeSessionId?: string | null; transcriptPath?: string | null;
}

/**
 * Records an existing coordinator (for example a desktop session the relay did
 * not launch) as generation 1 custodian. It carries no custody token, so the
 * fence cannot cover it (design section c, step 6). Change 1's `register` is
 * the intended caller; it refuses when any generation already exists.
 */
export function seedCustodianGeneration(
  db: Database.Database,
  workspace: string,
  input: GenerationIdentity & { project: string; role: string; now?: Date; lock?: RelayLockDeps }
): GenerationRecord {
  const now = input.now ?? new Date();
  const paths = coordinatorPaths(workspace, input.project, input.role);
  return withRelayLock(paths.root, () => {
    const record = writeTransaction(db, () => {
      if (maxGeneration(db, input.project, input.role) > 0) {
        throw refused(`${input.role} for ${input.project} already has generations; a custodian is seeded only once.`, "generation_exists");
      }
      const at = now.toISOString();
      db.prepare(`INSERT INTO coordinator_generations (project, role, generation, status, provider, model, tier, identity,
        native_session_id, transcript_path, created_at, updated_at, accepted_at)
        VALUES (?, ?, 1, 'custodian', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.project, input.role, input.provider, input.model, input.tier, input.identity,
          input.nativeSessionId ?? null, input.transcriptPath ?? null, at, at, at);
      return listGenerations(db, input.project, input.role)[0];
    });
    appendLog(paths, "custodian_seeded", { generation: 1, provider: input.provider, model: input.model }, now);
    return record;
  }, input.lock);
}

function markFailed(db: Database.Database, paths: CoordinatorPaths, project: string, role: string, generation: number, reason: string, now: Date): void {
  const changed = db.prepare(`UPDATE coordinator_generations SET status = 'failed', failure_reason = ?, updated_at = ?
    WHERE project = ? AND role = ? AND generation = ? AND status = 'launching'`).run(reason, now.toISOString(), project, role, generation).changes;
  if (changed > 0) appendLog(paths, "failed", { generation, reason }, now);
}

/**
 * Half-recorded claim recovery (design section c, step 1): a `launching` row
 * whose snapshot file is missing or does not hash to the recorded sha is
 * marked `failed` with reason `claim_incomplete`. A complete row is never
 * touched. Callers hold the relay lock.
 */
function recoverIncompleteClaims(db: Database.Database, paths: CoordinatorPaths, project: string, role: string, now: Date): number[] {
  const recovered: number[] = [];
  const launching = newestLaunching(db, project, role);
  if (launching && hashSnapshotFile(launching.snapshotPath) !== launching.snapshotSha) {
    writeTransaction(db, () => markFailed(db, paths, project, role, launching.generation, "claim_incomplete", now));
    recovered.push(launching.generation);
  }
  return recovered;
}

export interface ClaimInput extends GenerationIdentity {
  project: string;
  role: string;
  tmuxName: string;
  remoteControlName?: string | null;
  briefPath?: string | null;
  briefSha?: string | null;
  directives?: string[];
  sources: CapsuleSources;
  now?: Date;
  lock?: RelayLockDeps;
}

export interface ClaimResult {
  generation: number;
  snapshotPath: string;
  snapshotSha: string;
  /** Returned once, for the launcher to set as ARCADIA_COORDINATOR_TOKEN; stored only as a hash. */
  token: string;
  recovered: number[];
}

/**
 * Claims generation N+1 atomically (design section c, step 1). Under the relay
 * lock it first recovers half-recorded claims, refuses while a complete claim
 * is still `launching`, writes the immutable snapshot, and only then appends
 * the `launching` row with that snapshot's sha. It launches nothing: the relay
 * launch is change 3 and needs the standing Decision.
 */
export function claimNextGeneration(db: Database.Database, workspace: string, input: ClaimInput): ClaimResult {
  const now = input.now ?? new Date();
  const paths = coordinatorPaths(workspace, input.project, input.role);
  return withRelayLock(paths.root, () => {
    const recovered = recoverIncompleteClaims(db, paths, input.project, input.role, now);
    const launching = newestLaunching(db, input.project, input.role);
    if (launching) {
      const ageMs = now.getTime() - Date.parse(launching.createdAt);
      if (ageMs < CLAIM_LAUNCHING_FRESH_MS) {
        throw refused(`Generation ${launching.generation} of ${input.role} is still launching (${Math.round(ageMs / 60_000)} min old); no further launch until it is accepted or fails.`, "launch_in_progress", { generation: launching.generation });
      }
      throw refused(`Generation ${launching.generation} of ${input.role} is launching but unresolved after ${Math.round(ageMs / 60_000)} min; mark it failed (no acceptance) before claiming again.`, "launching_unresolved", { generation: launching.generation });
    }
    const generation = maxGeneration(db, input.project, input.role) + 1;
    const custodian: CapsuleCustodian = {
      provider: input.provider, model: input.model, tier: input.tier, identity: input.identity,
      sessionId: input.nativeSessionId ?? null, transcriptPath: input.transcriptPath ?? null,
      tmuxName: input.tmuxName, remoteControlName: input.remoteControlName ?? null
    };
    const capsule = buildCapsule({
      project: input.project, role: input.role, generation, custodian,
      assignment: { briefPath: input.briefPath ?? null, briefSha: input.briefSha ?? null, directives: input.directives ?? [] },
      state: readCoordinatorState(paths), sources: input.sources, now
    });
    const snapshot = writeImmutableSnapshot(paths, generation, capsule);
    const token = randomBytes(24).toString("hex");
    const at = now.toISOString();
    writeTransaction(db, () => {
      db.prepare(`INSERT INTO coordinator_generations (project, role, generation, status, provider, model, tier, identity,
        native_session_id, transcript_path, tmux_name, remote_control_name, brief_path, brief_sha, snapshot_path, snapshot_sha,
        token_hash, created_at, updated_at)
        VALUES (?, ?, ?, 'launching', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.project, input.role, generation, input.provider, input.model, input.tier, input.identity,
          input.nativeSessionId ?? null, input.transcriptPath ?? null, input.tmuxName, input.remoteControlName ?? null,
          input.briefPath ?? null, input.briefSha ?? null, snapshot.path, snapshot.sha, hashToken(token), at, at);
    });
    appendLog(paths, "launching", { generation, snapshotSha: snapshot.sha, provider: input.provider, model: input.model, tmuxName: input.tmuxName }, now);
    return { generation, snapshotPath: snapshot.path, snapshotSha: snapshot.sha, token, recovered };
  }, input.lock);
}

/** Marks a `launching` generation failed (design step 7). Custody stays with the predecessor. */
export function failGeneration(
  db: Database.Database,
  workspace: string,
  input: { project: string; role: string; generation: number; reason: string; now?: Date; lock?: RelayLockDeps }
): void {
  const now = input.now ?? new Date();
  const paths = coordinatorPaths(workspace, input.project, input.role);
  withRelayLock(paths.root, () => writeTransaction(db, () => markFailed(db, paths, input.project, input.role, input.generation, input.reason, now)), input.lock);
}

/** Records a passing `verify` (its only write), which `accept` requires. */
export function recordVerifyPass(db: Database.Database, project: string, role: string, generation: number, sha: string, now: Date): void {
  db.prepare(`UPDATE coordinator_generations SET verified_sha = ?, verified_at = ?, updated_at = ?
    WHERE project = ? AND role = ? AND generation = ? AND status = 'launching'`)
    .run(sha, now.toISOString(), now.toISOString(), project, role, generation);
}

export type CustodyAdmission =
  | { kind: "unfenced" }
  | { kind: "custodian"; generation: GenerationRecord }
  | { kind: "incoming"; generation: GenerationRecord };

function tokenMatches(row: Row, token: string): boolean {
  if (!row.token_hash || token === "") return false;
  const left = Buffer.from(row.token_hash, "hex");
  const right = Buffer.from(hashToken(token), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function describeCustodians(db: Database.Database, role: string, project: string | undefined): string {
  const rows = (project
    ? db.prepare("SELECT * FROM coordinator_generations WHERE role = ? AND project = ? AND status = 'custodian'").all(role, project)
    : db.prepare("SELECT * FROM coordinator_generations WHERE role = ? AND status = 'custodian'").all(role)) as Row[];
  if (rows.length === 0) return `no generation of ${role} holds custody`;
  return rows.map((row) => `${role} custody for ${row.project} is held by generation ${row.generation}${row.native_session_id ? ` (session ${row.native_session_id})` : ""}`).join("; ");
}

/**
 * The one custody guard (design section c, step 5). A caller with no
 * coordinator identity is not fenced. A caller whose role is set must be the
 * current custodian, with the exception of the incoming generation, which is
 * admitted for exactly `subscribe --from-snapshot` and `accept`: only for the
 * newest `launching` row, only with its token and its snapshot sha, and for
 * `accept` only after a passing `verify` on that sha within 10 minutes. The
 * commands that take this exception call it under the relay lock. The fence
 * guards against mistakes; it is not a security boundary.
 */
export function assertCoordinatorCustody(
  db: Database.Database,
  input: { command: GuardedCommand; env?: NodeJS.ProcessEnv; project?: string; role?: string; snapshotSha?: string; now?: Date }
): CustodyAdmission {
  const env = input.env ?? process.env;
  const role = env[COORDINATOR_ENV.role];
  if (!role) return { kind: "unfenced" };
  const now = input.now ?? new Date();
  const generation = Number(env[COORDINATOR_ENV.generation]);
  const token = env[COORDINATOR_ENV.token] ?? "";
  const label = input.command === "subscribe-from-snapshot" ? "subscribe --from-snapshot" : input.command;
  const candidates = Number.isInteger(generation)
    ? db.prepare("SELECT * FROM coordinator_generations WHERE role = ? AND generation = ?").all(role, generation) as Row[]
    : [];
  const row = candidates.find((candidate) => tokenMatches(candidate, token) && (!input.project || candidate.project === input.project));
  const deny = (why: string) => refused(
    `Coordinator custody refused for ${label}: ${why}; ${describeCustodians(db, role, row?.project ?? input.project)}. Stand down: the custodian runs this.`,
    "coordinator_custody_refused",
    { command: input.command, role, generation: Number.isInteger(generation) ? generation : null }
  );
  if (!row) throw deny(`this caller (${role} generation ${Number.isInteger(generation) ? generation : "unset"}) holds no matching custody token`);
  if (input.role && input.role !== row.role) throw deny(`this caller is ${row.role}, not ${input.role}`);
  if (row.status === "custodian") return { kind: "custodian", generation: toRecord(row) };
  if (row.status === "launching" && (input.command === "subscribe-from-snapshot" || input.command === "accept")) {
    if (row.generation !== maxGeneration(db, row.project, row.role)) throw deny(`generation ${row.generation} is not the newest generation`);
    if (!input.snapshotSha || input.snapshotSha !== row.snapshot_sha) {
      throw deny(`the snapshot sha does not match generation ${row.generation}'s pinned snapshot`);
    }
    if (input.command === "accept") {
      const fresh = row.verified_sha === input.snapshotSha && row.verified_at !== null && now.getTime() - Date.parse(row.verified_at) <= ACCEPT_VERIFY_WINDOW_MS;
      if (!fresh) {
        throw refused(`accept needs a passing \`arcadia coordinator verify --generation ${row.generation}\` on snapshot ${input.snapshotSha} within the last 10 minutes; run verify, then accept.`, "verify_required", { generation: row.generation });
      }
    }
    return { kind: "incoming", generation: toRecord(row) };
  }
  throw deny(`this caller is generation ${row.generation} (${row.status})`);
}

/**
 * `accept` (design step 5): one locked write marks N+1 custodian and N
 * `handed_off`. From then on the guarded commands refuse N. Callers hold the
 * relay lock and have passed `assertCoordinatorCustody({ command: "accept" })`.
 */
export function acceptGeneration(db: Database.Database, paths: CoordinatorPaths, incoming: GenerationRecord, now: Date): { custodian: number; handedOff: number | null } {
  const at = now.toISOString();
  const handedOff = writeTransaction(db, () => {
    const previous = currentCustodian(db, incoming.project, incoming.role);
    if (previous) {
      db.prepare("UPDATE coordinator_generations SET status = 'handed_off', updated_at = ? WHERE project = ? AND role = ? AND generation = ?")
        .run(at, incoming.project, incoming.role, previous.generation);
    }
    const changed = db.prepare(`UPDATE coordinator_generations SET status = 'custodian', accepted_at = ?, updated_at = ?
      WHERE project = ? AND role = ? AND generation = ? AND status = 'launching'`).run(at, at, incoming.project, incoming.role, incoming.generation).changes;
    if (changed !== 1) throw refused(`Generation ${incoming.generation} is no longer launching; nothing was accepted.`, "not_launching");
    return previous?.generation ?? null;
  });
  appendLog(paths, "accepted", { generation: incoming.generation, handedOff }, now);
  if (existsSync(paths.live)) {
    const live = JSON.parse(readFileSync(paths.live, "utf8")) as Capsule;
    writeLiveCapsule(paths, { ...live, generation: incoming.generation, custodian: custodianOf({ ...incoming, status: "custodian" }) });
  }
  return { custodian: incoming.generation, handedOff };
}

export function snapshotFileFor(paths: CoordinatorPaths, generation: number): string {
  return snapshotPath(paths, generation);
}
