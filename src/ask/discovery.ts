import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { normalizeError } from "../cli/errors.js";
import { previewAgentAskRequest } from "./preview.js";

/** Where isolated Agent Ask drafts live, relative to a repository root. Matches `ASK_ISOLATION_DIR` in `sessions/legacyAskRecovery.ts` — duplicated as a literal here rather than imported, since that module is about repairing drift onto a git branch and pulling it in would wire an unrelated git dependency into a plain filesystem scan. */
const AGENT_ASK_ASKS_DIR = ".arcadia/asks";

export interface AgentAskDiscoveryFinding { path: string; requestId: string; }
export interface AgentAskDiscoveryFailure { path: string; error: string; }
export interface AgentAskDiscoveryResult { discovered: AgentAskDiscoveryFinding[]; failed: AgentAskDiscoveryFailure[]; }

export const EMPTY_AGENT_ASK_DISCOVERY: AgentAskDiscoveryResult = { discovered: [], failed: [] };

/**
 * Preview every `<repoRoot>/.arcadia/asks/*.yaml` file whose request id `db`
 * does not yet know, exactly as an explicit `agent-ask preview --file` call
 * would. This is the mechanism named by the Action that created this file:
 * rather than depending on `arcadia go` (not a reliable trigger, since a
 * manual handoff or a differently-triggered environment may never run it) or
 * a dedicated "scan" command an operator has to remember to run, it hooks the
 * one thing every agent-ask command already does when a real Project
 * workspace is available — resolve that workspace and preview something —
 * and piggybacks discovery on that. `runAgentAskPreviewCommand` and
 * `runAgentAskDraftCommand` (which calls preview internally) both call this
 * after their own explicit work succeeds, so a file nobody explicitly asked
 * about yet still gets previewed the next time anything in this repository
 * touches its Agent Ask surface.
 *
 * A file already known — its request id previously previewed with identical
 * content — is silently skipped (not re-reported as "discovered" every time)
 * so this stays cheap to call on every command. A file that fails to
 * validate, or whose request id was already used with different content, is
 * never silently dropped: it comes back in `failed` so the calling command
 * can put it in front of whoever is looking at that command's own output,
 * every time, until someone fixes or removes it.
 */
export function discoverUnprocessedAgentAsks(db: Database.Database, repoRoot: string): AgentAskDiscoveryResult {
  const dir = path.join(repoRoot, AGENT_ASK_ASKS_DIR);
  if (!existsSync(dir)) return EMPTY_AGENT_ASK_DISCOVERY;
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
  const result: AgentAskDiscoveryResult = { discovered: [], failed: [] };
  for (const filePath of files) {
    try {
      const request = readFileSync(filePath, "utf8");
      const { proposal, replayed } = previewAgentAskRequest(db, { request, sourcePath: filePath, repoRoot });
      if (!replayed) result.discovered.push({ path: filePath, requestId: proposal.normalized.requestId });
    } catch (error) {
      result.failed.push({ path: filePath, error: normalizeError(error).message });
    }
  }
  return result;
}
