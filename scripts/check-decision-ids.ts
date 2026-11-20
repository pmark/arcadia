import { execFileSync } from "node:child_process";
import path from "node:path";
import { describeDecisionIdClash, findDecisionIdClashes } from "../src/decisions/decisionIds.js";

// Deterministic, read-only: fails when two tracked docs/decisions files share an id, naming both files.
// The historical pairs are grandfathered in src/decisions/decisionIds.ts. In CI this runs on the pull-request
// merge commit (so a pair against its base fails the pull request) and on every push to main.
const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
const tracked = execFileSync("git", ["ls-files", "docs/decisions"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const clashes = findDecisionIdClashes(tracked);
if (clashes.length > 0) {
  const message = clashes.map(describeDecisionIdClash).join("; ");
  process.stderr.write(`${process.env.GITHUB_ACTIONS ? "::error title=Duplicate Decision id::" : ""}${message}. Renumber the newer file to the next free id.\n`);
  process.exit(1);
}
process.stdout.write(`decision ids unique (grandfathered pairs aside): ${tracked.length} files\n`);
