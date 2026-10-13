import { constants } from "node:fs";
import { mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { resolveWorkspace } from "../../../src/workspace/resolve";
import { getWorkspacePaths } from "../../../src/workspace/paths";
import { isInventoryState } from "./pull-request-inventory-validation";
import type { PullRequestInventoryState } from "./pull-request-inventory-cache";

const MAX_BYTES = 2 * 1024 * 1024;

export async function inventoryPersistenceScope(checkout: string): Promise<{ directory: string; identity: string; workspacePath: string }> {
  const root = await realpath(checkout);
  const workspace = resolveWorkspace({ cwd: root }).workspacePath;
  if (!workspace) throw new Error("No resolved workspace for PR inventory.");
  const workspacePath = await realpath(workspace);
  const paths = getWorkspacePaths(workspacePath);
  const config = await stat(paths.configFile);
  const database = await stat(paths.databaseFile);
  // DB inode/path is stable across ordinary writes; never use DB/WAL mtimes.
  const identity = createHash("sha256").update(JSON.stringify({ version: 1, root, workspacePath,
    config: [config.dev, config.ino, config.size, config.mtimeMs], database: [paths.databaseFile, database.dev, database.ino]
  })).digest("hex");
  return { directory: path.join(root, ".cache", "pr-inventory"), identity, workspacePath };
}

export function createInventoryPersistence({ directory, identity }: { directory: string; identity: string }) {
  const file = path.join(directory, `${identity}.json`);
  function valid(value: unknown): value is PullRequestInventoryState {
    if (!isInventoryState(value) || Date.parse(value.checkedAt) > Date.now()
      || Date.parse(value.snapshot.generatedAt) > Date.now()) return false;
    const only = (record: object, keys: string[]) => Object.keys(record).every(key => keys.includes(key));
    return only(value, ["snapshot", "checkedAt", "stale", "refreshing", "refreshError", "incomplete", "retainedProjectIds"])
      && only(value.snapshot, ["generatedAt", "projectsScanned", "repositories", "pullRequests", "errors", "counts"])
      && only(value.snapshot.counts, ["total", "blocked", "checksFailing", "checksPending", "drafts", "ready", "mergeReady", "unknown"])
      && value.refreshError === null && value.snapshot.counts.ready === 0 && value.snapshot.counts.mergeReady === 0
      && value.snapshot.pullRequests.every(pr => only(pr, ["projectId", "projectName", "repositoryPath", "repository", "number", "title", "url", "state", "isDraft", "mergeStateStatus", "headBranch", "baseBranch", "author", "reviewDecision", "createdAt", "updatedAt", "checks", "readiness", "readinessLabel", "summary", "briefing", "detailsLoaded"])
        && pr.detailsLoaded === false && pr.briefing === null && pr.headBranch === "unknown" && pr.baseBranch === "main"
        && pr.author === null && pr.reviewDecision === null && pr.mergeStateStatus === null
        && pr.checks.every(check => only(check, ["name", "status", "conclusion", "url"])))
      && value.snapshot.errors.every(error => only(error, ["projectId", "projectName", "repositoryPath", "message"]))
      && (value.snapshot.repositories?.every(repo => only(repo, ["projectId", "projectName", "repository", "repositoryPath"])) ?? true);
  }
  async function read(): Promise<PullRequestInventoryState | null> {
    try {
      if (await realpath(directory) !== path.resolve(directory)) return null;
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_BYTES || (info.mode & 0o077) !== 0) return null;
        const envelope: unknown = JSON.parse(await handle.readFile("utf8"));
        if (!envelope || typeof envelope !== "object" || !("scope" in envelope) || envelope.scope !== identity
          || !("version" in envelope) || envelope.version !== 1 || !("inventory" in envelope) || !valid(envelope.inventory)) return null;
        return { ...envelope.inventory, stale: true, refreshing: false, refreshError: null };
      } finally { await handle.close(); }
    } catch { return null; }
  }
  async function write(inventory: PullRequestInventoryState): Promise<void> {
    let temporary: string | null = null;
    try {
      if (!valid(inventory)) return;
      // Persist only known list/CI fields. No source bodies, files, briefing or extra payload fields.
      const snapshot = inventory.snapshot;
      const safe = {
        checkedAt: inventory.checkedAt, incomplete: inventory.incomplete, retainedProjectIds: inventory.retainedProjectIds,
        stale: true, refreshing: false, refreshError: null,
        snapshot: { generatedAt: snapshot.generatedAt, projectsScanned: snapshot.projectsScanned,
          counts: snapshot.counts, errors: snapshot.errors.map(({ projectId, projectName, repositoryPath, message }) => ({ projectId, projectName, repositoryPath, message })),
          repositories: snapshot.repositories?.map(({ projectId, projectName, repository, repositoryPath }) => ({ projectId, projectName, repository, repositoryPath })),
          pullRequests: snapshot.pullRequests.map(({ projectId, projectName, repositoryPath, repository, number, title, url, state, isDraft, createdAt, updatedAt, readiness, readinessLabel, summary, checks }) => ({
            projectId, projectName, repositoryPath, repository, number, title, url, state, isDraft, createdAt, updatedAt, readiness, readinessLabel, summary,
            headBranch: "unknown", baseBranch: "main", author: null, reviewDecision: null, mergeStateStatus: null, detailsLoaded: false, briefing: null,
            checks: checks.map(({ name, status, conclusion, url }) => ({ name, status, conclusion, url }))
          })) }
      };
      const content = JSON.stringify({ version: 1, scope: identity, inventory: safe });
      if (Buffer.byteLength(content) > MAX_BYTES) return;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (await realpath(directory) !== path.resolve(directory)) return;
      temporary = path.join(directory, `${identity}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, file);
      temporary = null;
    } catch { /* Persistence is an optional display cache, never a service prerequisite. */ }
    finally { if (temporary) await unlink(temporary).catch(() => undefined); }
  }
  return { read, write };
}
