import { randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { runPreserveCommand } from "../commands/preserve.js";
import { requireResolvedWorkspace } from "../workspace/resolve.js";
import { PRESERVATION_REQUEST_FILE } from "./candidateSnapshot.js";
import type { AgentSession } from "./index.js";

const HEARTBEAT = ".arcadia/preservation.heartbeat";
const NONCE = /^[a-f0-9-]{36}$/;
const responsePath = (workspace: string, session: string, nonce: string) =>
  path.join(workspace, "artifacts", "preservation", session, `${nonce}.json`);

export function preservationTransportReady(workspace: string): boolean {
  try {
    const value = JSON.parse(readFileSync(path.join(workspace, HEARTBEAT), "utf8"));
    return value.schema === "arcadia-preservation-transport-v1" && Date.now() - value.at >= 0 && Date.now() - value.at < 15_000;
  } catch { return false; }
}

/** The sandbox can request only preservation of its registered cwd. No commands,
 * evidence, source paths or authority flags cross this boundary. Results are
 * read from the protected workspace, never an agent-writable response file. */
export async function requestCandidatePreservation(source: string) {
  const workspace = requireResolvedWorkspace({ cwd: source });
  const candidate = realpathSync(source);
  if (!preservationTransportReady(workspace)) throw validationError("Protected preservation request path is unavailable. Start the updated Arcadia worker on the host before requesting preservation.");
  // Read a host-owned projection, not SQLite: readonly WAL opens can still
  // require shared-memory coordination writes that the sandbox rightly denies.
  const routes = JSON.parse(readFileSync(path.join(workspace, HEARTBEAT), "utf8"));
  const lease = (routes.sessions as Array<{ id: string; worktree: string }>).find(s => s.worktree === candidate);
  if (!lease) throw validationError("No prepared or running Session registers this preservation worktree.");
  const nonce = randomUUID();
  const request = path.join(candidate, PRESERVATION_REQUEST_FILE);
  const fd = openSync(request, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify({ nonce })); } finally { closeSync(fd); }
  const response = responsePath(workspace, lease.id, nonce);
  const deadline = Date.now() + 1_230_000; // ten bounded two-minute checks plus transport margin
  while (Date.now() < deadline) {
    if (existsSync(response)) {
      const result = JSON.parse(readFileSync(response, "utf8"));
      if (!result.ok) throw validationError(result.error);
      return result.response;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw validationError("Protected preservation response timed out; retain candidate and inspect the host worker. Retry is safe.");
}

/** Called by the existing worker, on its host, before ordinary Run admission.
 * The workspace and candidate paths come from registered leases, not requests. */
export function processPreservationRequests(db: Database.Database, workspace: string): void {
  if (process.env.CODEX_SANDBOX) throw validationError("The preservation consumer must run on the host.");
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  const leases = db.prepare("SELECT * FROM agent_sessions WHERE status IN ('prepared','running')").all() as AgentSession[];
  const heartbeat = path.join(workspace, HEARTBEAT);
  writeFileSync(`${heartbeat}.${process.pid}.tmp`, JSON.stringify({ schema: "arcadia-preservation-transport-v1", at: Date.now(), sessions: leases.map(s => ({ id: s.id, worktree: s.worktree_path })) }));
  renameSync(`${heartbeat}.${process.pid}.tmp`, heartbeat);
  for (const lease of leases) {
    const request = path.join(lease.worktree_path, PRESERVATION_REQUEST_FILE);
    if (!existsSync(request)) continue;
    let nonce: string;
    try {
      const fd = openSync(request, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 128) continue;
        const value = JSON.parse(readFileSync(fd, "utf8"));
        if (Object.keys(value).join() !== "nonce" || !NONCE.test(value.nonce)) continue;
        nonce = value.nonce;
      } finally { closeSync(fd); }
    } catch { continue; }
    const response = responsePath(workspace, lease.id, nonce);
    if (existsSync(response)) continue;
    // Brief ownership transaction only. Never hold a workspace write lock while
    // running checks: Off and other Projects must remain responsive.
    const token = randomUUID();
    const claimed = db.transaction(() => {
      const owner = db.prepare("SELECT pid FROM candidate_preservation_claims WHERE session_id = ?").get(lease.id) as { pid: number } | undefined;
      if (owner) {
        try { process.kill(owner.pid, 0); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
      }
      db.prepare("INSERT OR REPLACE INTO candidate_preservation_claims VALUES (?, ?, ?)").run(lease.id, process.pid, token);
      return true;
    }).immediate();
    if (!claimed) continue;
    try {
      let result;
      try { result = { ok: true, response: runPreserveCommand({ source: lease.worktree_path, workspace, db }) }; }
      catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
      mkdirSync(path.dirname(response), { recursive: true });
      writeFileSync(`${response}.tmp`, JSON.stringify(result), { mode: 0o600 });
      renameSync(`${response}.tmp`, response);
    } finally {
      db.prepare("DELETE FROM candidate_preservation_claims WHERE session_id = ? AND token = ?").run(lease.id, token);
    }
  }
}
