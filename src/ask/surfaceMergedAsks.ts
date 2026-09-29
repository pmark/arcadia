import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { tryGit } from "../git/worktrees.js";
import { AGENT_ASK_ASKS_DIR, discoverUnprocessedAgentAsks, type AgentAskDiscoveryFailure } from "./discovery.js";

export interface MergedAskSurfacing {
  /** Request ids previewed for the first time this tick; each is now a pending approval. */
  discovered: string[];
  /** Every Ask file that could not be previewed this tick, reported or not. */
  failed: AgentAskDiscoveryFailure[];
}

const WORKER_SETTLED_INTENTS = new Set<string>(["complete"]);

/** Create the table that remembers which version of a broken Ask file was already logged. */
function ensureSurfacingFailureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_ask_discovery_failures (
      project_slug TEXT NOT NULL,
      path TEXT NOT NULL,
      content_sha TEXT NOT NULL,
      message TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (project_slug, path, content_sha)
    );
  `);
}

/** Git's blob id for `content`, so a working-tree file can be matched to a committed one without spawning `git hash-object`. */
function gitBlobSha(content: Buffer): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

/**
 * The blob id of every Ask file committed at `baseSha`, keyed by absolute path,
 * or null when the tree cannot be read.
 */
function committedAskBlobs(repoRoot: string, baseSha: string): Map<string, string> | null {
  const listing = tryGit(repoRoot, ["ls-tree", "-z", baseSha, "--", `${AGENT_ASK_ASKS_DIR}/`]);
  if (listing === null) return null;
  const blobs = new Map<string, string>();
  for (const entry of listing.split("\0")) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
    if (match) blobs.set(path.join(repoRoot, match[2]), match[1]);
  }
  return blobs;
}

/** Whether `filePath` is byte-identical to its blob in `blobs`. */
function isCommittedAt(blobs: Map<string, string>, filePath: string): boolean {
  const committed = blobs.get(filePath);
  if (!committed) return false;
  try {
    return gitBlobSha(readFileSync(filePath)) === committed;
  } catch {
    return false;
  }
}

/** A content hash of `filePath`, identifying one version of an Ask file for once-per-version failure logging. */
function contentSha(filePath: string): string {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return "unreadable";
  }
}

/**
 * Preview every `.arcadia/asks/` file committed on a Project's freshly
 * fast-forwarded base branch, so an Ask that reached it through a merged pull request becomes
 * a pending approval on the dashboard's Needs You surface without anyone
 * running an `agent-ask` command on the operator's machine. Discovery itself
 * is the canonical routine every `agent-ask` command already calls; this only
 * adds a caller that runs unattended.
 *
 * Only a file whose working-tree content is byte-identical to its blob at the
 * observed base commit `baseSha` is considered: an untracked, locally edited,
 * or other-branch Ask never becomes a pending approval merely by sitting in
 * the checkout. When the base tree cannot be read, nothing is surfaced.
 *
 * A file that cannot be previewed (malformed, or a request id reused with
 * different content) is logged once per content version, never silently
 * dropped and never repeated every tick. Editing the file produces a new
 * version, which is reported again.
 */
export function surfaceMergedAgentAsks(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; baseSha: string; now: Date; log: (message: string) => void }
): MergedAskSurfacing {
  const committed = committedAskBlobs(input.repoRoot, input.baseSha);
  if (committed === null) {
    input.log(`Agent Ask surfacing skipped for ${input.projectSlug}: could not read ${AGENT_ASK_ASKS_DIR} at ${input.baseSha}.`);
    return { discovered: [], failed: [] };
  }
  // `complete` Asks are settled by the worker itself from their evidence
  // (`attemptAutoSettlePendingCompletion`), not by the operator. Previewing
  // one would turn it into a pending proposal that pauses dispatch of the very
  // Action it completes. `split` has no worker settlement path, so it is
  // surfaced for the operator like any other intent.
  const result = discoverUnprocessedAgentAsks(db, input.repoRoot, {
    includeFile: (filePath) => isCommittedAt(committed, filePath),
    shouldPreview: (ask) => !WORKER_SETTLED_INTENTS.has(ask.intent)
  });
  for (const found of result.discovered) {
    input.log(`Surfaced merged Agent Ask ${found.requestId} for ${input.projectSlug} as a pending approval (${found.path}).`);
  }
  if (result.failed.length > 0) {
    ensureSurfacingFailureTable(db);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO production_ask_discovery_failures (project_slug, path, content_sha, message, first_seen_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const failure of result.failed) {
      const inserted = insert.run(input.projectSlug, failure.path, contentSha(failure.path), failure.error, input.now.toISOString());
      if (inserted.changes > 0) {
        input.log(`Agent Ask ${failure.path} for ${input.projectSlug} could not be surfaced: ${failure.error}`);
      }
    }
  }
  return { discovered: result.discovered.map((found) => found.requestId), failed: result.failed };
}
