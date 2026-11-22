import path from "node:path";
import { runPingSendCommand } from "../src/commands/ping.js";
import { duplicateDecisionIdPing, findDecisionIdClashes, originDecisionFiles, systemDecisionGit } from "../src/decisions/decisionIds.js";

// Host-side companion to `pnpm check:decision-ids`, which fails the push to main in CI but cannot reach the
// operator's ping outbox. Reads current origin main and, when two Decision files share an id (grandfathered
// pairs aside), queues exactly one ping naming both files: the episode key makes every rerun over the same pair a no-op.
const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
const files = originDecisionFiles(systemDecisionGit(root));
if (!files) {
  process.stderr.write("origin/main Decision files could not be read, so a duplicate Decision id cannot be ruled out\n");
  process.exit(1);
}
const ping = duplicateDecisionIdPing(findDecisionIdClashes(files));
if (!ping) {
  process.stdout.write(`origin main Decision ids unique (grandfathered pairs aside): ${files.length} files\n`);
} else {
  const queued = runPingSendCommand({
    workspace: process.env["ARCADIA_WORKSPACE"] ?? "",
    message: ping.message,
    kind: "attention",
    agent: "Decision id check",
    episodeKey: ping.episodeKey
  });
  process.stderr.write(`${ping.message} (ping ${queued.data.ping.id}${queued.data.deduplicated ? ", already queued" : ""})\n`);
  process.exit(1);
}
