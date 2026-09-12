import { randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import { runGoBroker, type GoBrokerAgent } from "../goBroker.js";
import { runPreserveCommand } from "../commands/preserve.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { requireResolvedWorkspace } from "../workspace/resolve.js";
import { PRESERVATION_REQUEST_FILE } from "./candidateSnapshot.js";
import type { AgentSession } from "./index.js";

const HEARTBEAT = ".arcadia/preservation.heartbeat";
const GO_REQUEST_FILE = ".arcadia-go-request";
const NONCE = /^[a-f0-9-]{36}$/;
const responsePath = (workspace: string, session: string, nonce: string) =>
  path.join(workspace, "artifacts", "preservation", session, `${nonce}.json`);
const goResponsePath = (workspace: string, nonce: string) =>
  path.join(workspace, "artifacts", "go-requests", `${nonce}.json`);

interface TransportHeartbeat {
  schema: "arcadia-preservation-transport-v1";
  at: number;
  sessions: Array<{ id: string; worktree: string; repository: string }>;
  repositories?: Array<{ path: string; projectSlug: string }>;
}

export function preservationTransportReady(workspace: string): boolean {
  try {
    const value = JSON.parse(readFileSync(path.join(workspace, HEARTBEAT), "utf8"));
    return value.schema === "arcadia-preservation-transport-v1" && Date.now() - value.at >= 0 && Date.now() - value.at < 15_000;
  } catch { return false; }
}

function readHeartbeat(workspace: string): TransportHeartbeat {
  return JSON.parse(readFileSync(path.join(workspace, HEARTBEAT), "utf8")) as TransportHeartbeat;
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
  const routes = readHeartbeat(workspace);
  const lease = routes.sessions.find(s => s.worktree === candidate);
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

/** The sandbox can ask the host worker to perform canonical `arcadia go` for
 * either the current registered candidate worktree or a configured Project
 * repository root. The request supplies only a nonce and the fixed provider
 * baked into the launcher; the host derives repo/source from its heartbeat. */
export async function requestAgentGo(source: string, agent: GoBrokerAgent) {
  const workspace = requireResolvedWorkspace({ cwd: source });
  const current = realpathSync(source);
  if (!preservationTransportReady(workspace)) throw validationError("Protected Arcadia go request path is unavailable. Start the updated Arcadia worker on the host before requesting go.");
  const routes = readHeartbeat(workspace);
  const route = routes.sessions.find(s => s.worktree === current)
    ?? routes.repositories?.find(repository => repository.path === current);
  if (!route) throw validationError("No host-worker route registers this Arcadia go source.", {
    source: current,
    remedy: "Run arcadia worker start for the configured workspace, or start from a Project repository root or prepared Session worktree."
  });
  const nonce = randomUUID();
  const request = path.join(current, GO_REQUEST_FILE);
  const fd = openSync(request, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify({ nonce, agent })); } finally { closeSync(fd); }
  const response = goResponsePath(workspace, nonce);
  const deadline = Date.now() + 1_230_000;
  while (Date.now() < deadline) {
    if (existsSync(response)) {
      const result = JSON.parse(readFileSync(response, "utf8"));
      if (!result.ok) throw validationError(result.error);
      return result.response;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw validationError("Protected Arcadia go response timed out; retain source state and inspect the host worker. Retry is safe.");
}

/** Called by the existing worker, on its host, before ordinary Run admission.
 * The workspace and candidate paths come from registered leases, not requests. */
export function processPreservationRequests(db: Database.Database, workspace: string): void {
  if (process.env.CODEX_SANDBOX) throw validationError("The preservation consumer must run on the host.");
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  const leases = db.prepare("SELECT * FROM agent_sessions WHERE status IN ('prepared','running')").all() as AgentSession[];
  const repositories = listProjects(db)
    .flatMap(project => {
      const repo = getProjectMetadata(db, project.id)?.repo_path?.trim();
      if (!repo || !existsSync(repo)) return [];
      return [{ path: realpathSync(repo), projectSlug: project.slug }];
    });
  const heartbeat = path.join(workspace, HEARTBEAT);
  writeFileSync(`${heartbeat}.${process.pid}.tmp`, JSON.stringify({
    schema: "arcadia-preservation-transport-v1",
    at: Date.now(),
    sessions: leases.map(s => ({ id: s.id, worktree: s.worktree_path, repository: s.repository_path })),
    repositories
  }));
  renameSync(`${heartbeat}.${process.pid}.tmp`, heartbeat);
  for (const repository of repositories) processGoRequest({ workspace, source: repository.path, repository: repository.path });
  for (const lease of leases) {
    processGoRequest({ workspace, source: lease.worktree_path, repository: lease.repository_path });
    const request = path.join(lease.worktree_path, PRESERVATION_REQUEST_FILE);
    if (!existsSync(request)) continue;
    let nonce: string;
    try {
      const fd = openSync(request, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 128) continue;
        const bytes = Buffer.alloc(129);
        const length = readSync(fd, bytes, 0, bytes.length, 0);
        if (length > 128) continue;
        const value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
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

function processGoRequest(input: { workspace: string; source: string; repository: string }): void {
  const request = path.join(input.source, GO_REQUEST_FILE);
  if (!existsSync(request)) return;
  let nonce: string;
  let agent: GoBrokerAgent;
  try {
    const fd = openSync(request, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 160) return;
      const bytes = Buffer.alloc(161);
      const length = readSync(fd, bytes, 0, bytes.length, 0);
      if (length > 160) return;
      const value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
      if (Object.keys(value).sort().join() !== "agent,nonce" || !NONCE.test(value.nonce)) return;
      if (value.agent !== "codex" && value.agent !== "claude") return;
      nonce = value.nonce;
      agent = value.agent;
    } finally { closeSync(fd); }
  } catch { return; }
  const response = goResponsePath(input.workspace, nonce);
  if (existsSync(response)) return;
  let result;
  try { result = { ok: true, response: runGoBroker({ source: input.source, agent, operation: "go" }) }; }
  catch (error) { result = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  mkdirSync(path.dirname(response), { recursive: true });
  writeFileSync(`${response}.tmp`, JSON.stringify(result), { mode: 0o600 });
  renameSync(`${response}.tmp`, response);
}
