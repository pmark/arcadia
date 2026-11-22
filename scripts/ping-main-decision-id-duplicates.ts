import path from "node:path";
import { runPingSendCommand } from "../src/commands/ping.js";
import { checkMainDecisionIds, originDecisionFiles, systemDecisionGit } from "../src/decisions/decisionIds.js";

// Host-side companion to `pnpm check:decision-ids`, which fails the push to main in CI but cannot reach the
// operator's ping outbox. Reads current origin main and, when two Decision files share an id (grandfathered
// pairs aside), queues exactly one ping naming both files: the episode key makes every rerun over the same pair a no-op.
// Needs ARCADIA_WORKSPACE (exit 2 without it). Nothing schedules this script yet: Issue #2951.
const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
const result = checkMainDecisionIds({
  workspace: process.env["ARCADIA_WORKSPACE"],
  files: originDecisionFiles(systemDecisionGit(root)),
  send: (ping) => {
    const queued = runPingSendCommand({
      workspace: ping.workspace,
      message: ping.message,
      kind: "attention",
      agent: "Decision id check",
      episodeKey: ping.episodeKey
    });
    return { pingId: queued.data.ping.id, deduplicated: queued.data.deduplicated };
  }
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
