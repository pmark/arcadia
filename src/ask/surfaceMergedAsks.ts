import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { discoverUnprocessedAgentAsks, type AgentAskDiscoveryFailure } from "./discovery.js";

export interface MergedAskSurfacing {
  /** Request ids previewed for the first time this tick; each is now a pending approval. */
  discovered: string[];
  /** Every Ask file that could not be previewed this tick, reported or not. */
  failed: AgentAskDiscoveryFailure[];
}

const WORKER_SETTLED_INTENTS = new Set<string>(["complete", "split"]);

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

function contentSha(filePath: string): string {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return "unreadable";
  }
}

/**
 * Preview every `.arcadia/asks/` file on a Project's freshly fast-forwarded
 * base branch, so an Ask that reached it through a merged pull request becomes
 * a pending approval on the dashboard's Needs You surface without anyone
 * running an `agent-ask` command on the operator's machine. Discovery itself
 * is the canonical routine every `agent-ask` command already calls; this only
 * adds a caller that runs unattended.
 *
 * A file that cannot be previewed (malformed, or a request id reused with
 * different content) is logged once per content version, never silently
 * dropped and never repeated every tick. Editing the file produces a new
 * version, which is reported again.
 */
export function surfaceMergedAgentAsks(
  db: Database.Database,
  input: { repoRoot: string; projectSlug: string; now: Date; log: (message: string) => void }
): MergedAskSurfacing {
  // `complete` and `split` Asks are settled by the worker itself from their
  // evidence (`attemptAutoSettlePendingCompletion`), not by the operator.
  // Previewing one would turn it into a pending proposal that pauses dispatch
  // of the very Action it completes.
  const result = discoverUnprocessedAgentAsks(db, input.repoRoot, {
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
