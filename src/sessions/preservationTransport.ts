import { randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { ArcadiaError, validationError } from "../cli/errors.js";
import type { GoBrokerAgent } from "../goBroker.js";
import { git } from "../git/worktrees.js";
import { executeHostGo, goTransportFailure } from "./goRequestExecutor.js";
import { GO_REQUEST_FILE, GO_RESPONSE_TIMEOUT_MS, type GoTransportResult } from "./goRequestProtocol.js";
import { runPreserveCommand } from "../commands/preserve.js";
import { getProjectMetadata, listProjects } from "../db/repositories.js";
import { requireResolvedWorkspace } from "../workspace/resolve.js";
import { PRESERVATION_REQUEST_FILE } from "./candidateSnapshot.js";
import type { AgentSession } from "./index.js";

const HEARTBEAT = ".arcadia/preservation.heartbeat";
const runningGoSources = new Set<string>();
const NONCE = /^[a-f0-9-]{36}$/;
const responsePath = (workspace: string, session: string, nonce: string) =>
  path.join(workspace, "artifacts", "preservation", session, `${nonce}.json`);
const goResponsePath = (workspace: string, nonce: string) =>
  path.join(workspace, "artifacts", "go-requests", `${nonce}.json`);

interface TransportHeartbeat {
  schema: "arcadia-preservation-transport-v1";
  at: number;
  sessions: Array<{ id: string; worktree: string }>;
  repositories?: Array<{ path: string; projectSlug: string }>;
  goRequests?: boolean;
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

export function agentGoTransportReady(workspace: string): boolean {
  try { return preservationTransportReady(workspace) && readHeartbeat(workspace).goRequests === true; }
  catch { return false; }
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
  if (!agentGoTransportReady(workspace)) throw validationError("Protected Arcadia go request path is unavailable. Start the updated Arcadia worker on the host before requesting go.");
  const routes = readHeartbeat(workspace);
  const route = routes.sessions.find(s => s.worktree === current)
    ?? routes.repositories?.find(repository => repository.path === current);
  if (!route) throw validationError("No host-worker route registers this Arcadia go source.", {
    source: current,
    remedy: "Run arcadia worker start for the configured workspace, or start from a Project repository root or prepared Session worktree."
  });
  const nonce = randomUUID();
  const request = path.join(current, GO_REQUEST_FILE);
  assertUntrackedGoRequest(current);
  const fd = openSync(request, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify({ nonce, agent })); } finally { closeSync(fd); }
  const response = goResponsePath(workspace, nonce);
  const deadline = Date.now() + GO_RESPONSE_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (existsSync(response)) {
        const result = JSON.parse(readFileSync(response, "utf8")) as GoTransportResult;
        if (!result.ok) throw new ArcadiaError(result.error.code, result.error.message, result.error.exitCode, result.error.details);
        return result.response;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw validationError("Protected Arcadia go response timed out; inspect source state and the host worker before retrying.", {
      source: current, response, remedy: "The request wait ended; go may already have started. Inspect the host result and worktrees before retrying."
    });
  } finally {
    // Remove only this caller's untracked request, never another caller's or a
    // tracked file. A process crash may leave it behind; cleanliness and capture
    // also exclude this reserved untracked name.
    try {
      assertUntrackedGoRequest(current);
      if (readGoRequest(request)?.nonce === nonce) unlinkSync(request);
    } catch { /* Worker may already have consumed it or retired the source. */ }
  }
}

function assertUntrackedGoRequest(source: string): void {
  if (git(source, ["ls-files", "--", GO_REQUEST_FILE])) {
    throw validationError("The go transport file must not be tracked.", { source, remedy: "Remove the reserved transport filename from version control before requesting go." });
  }
}

/** Called by the existing worker, on its host, before ordinary Run admission.
 * The workspace and candidate paths come from registered leases, not requests. */
export function processPreservationRequests(db: Database.Database, workspace: string): void {
  if (process.env.CODEX_SANDBOX) throw validationError("The preservation consumer must run on the host.");
  mkdirSync(path.join(workspace, ".arcadia"), { recursive: true });
  const leases = db.prepare("SELECT * FROM agent_sessions WHERE status IN ('prepared','running')").all() as AgentSession[];
  const repositories = listProjects(db)
    .filter(project => project.status === "active")
    .flatMap(project => {
      try {
        const repo = getProjectMetadata(db, project.id)?.repo_path?.trim();
        return repo ? [{ path: realpathSync(repo), projectSlug: project.slug }] : [];
      } catch { return []; } // One missing/inaccessible Project cannot stop all Sessions.
    });
  const heartbeat = path.join(workspace, HEARTBEAT);
  writeFileSync(`${heartbeat}.${process.pid}.tmp`, JSON.stringify({
    schema: "arcadia-preservation-transport-v1",
    at: Date.now(),
    sessions: leases.map(s => ({ id: s.id, worktree: s.worktree_path })),
    repositories,
    goRequests: true
  }));
  renameSync(`${heartbeat}.${process.pid}.tmp`, heartbeat);
  for (const repository of repositories) processGoRequest({ workspace, source: repository.path });
  for (const lease of leases) {
    processGoRequest({ workspace, source: lease.worktree_path });
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

function readGoRequest(request: string): { nonce: string; agent: GoBrokerAgent } | undefined {
  try {
    const fd = openSync(request, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 160) return;
      const bytes = Buffer.alloc(161);
      const length = readSync(fd, bytes, 0, bytes.length, 0);
      if (length > 160) return;
      const value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
      if (Object.keys(value).sort().join() !== "agent,nonce" || !NONCE.test(value.nonce)) return;
      if (value.agent !== "codex" && value.agent !== "claude") return;
      return { nonce: value.nonce, agent: value.agent };
    } finally { closeSync(fd); }
  } catch { return; }
}

function writeGoResponse(response: string, result: GoTransportResult): void {
  mkdirSync(path.dirname(response), { recursive: true });
  writeFileSync(`${response}.tmp`, JSON.stringify(result), { mode: 0o600 });
  renameSync(`${response}.tmp`, response);
}

function processGoRequest(input: { workspace: string; source: string }): void {
  if (runningGoSources.has(input.source)) return;
  const request = path.join(input.source, GO_REQUEST_FILE);
  const value = readGoRequest(request);
  if (!value) return;
  const { nonce, agent } = value;
  const response = goResponsePath(input.workspace, nonce);
  try { assertUntrackedGoRequest(input.source); }
  catch (error) { writeGoResponse(response, goTransportFailure(error)); return; }
  // Consume the transport file before canonical Git cleanliness checks. Keeping
  // it in the source would make every otherwise-clean request refuse itself.
  // Only the worker that removes the request may run the controller.
  try { unlinkSync(request); } catch { return; }
  if (existsSync(response)) return;
  runningGoSources.add(input.source);
  void Promise.resolve().then(() => executeHostGo(input.source, agent))
    .catch(goTransportFailure)
    .then(result => writeGoResponse(response, result))
    .catch(error => { process.stderr.write(`Could not write host go response: ${String(error)}\n`); })
    .finally(() => runningGoSources.delete(input.source));
}
