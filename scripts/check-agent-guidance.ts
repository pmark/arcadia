import { execFileSync } from "node:child_process";
import path from "node:path";
import { inspectGuidanceDelivery, assertBootstrapBudget } from "../src/projects/agentGuidance.js";
import { readAgentsContextBlock } from "../src/projects/contextSetup.js";

const repoRoot = process.cwd();
assertBootstrapBudget(readAgentsContextBlock());
const paths = execFileSync("git", ["ls-files", "-z", "--", "**/AGENTS.md", "**/AGENTS.override.md", "**/CLAUDE.md"], { cwd: repoRoot, encoding: "utf8" }).split("\0").filter(Boolean);
const directories = [...new Set([repoRoot, ...paths.map((file) => path.dirname(path.join(repoRoot, file)))])];
const evidence = directories.flatMap((cwd) => (["codex", "claude", "opencode"] as const).map((agent) => ({
  cwd: path.relative(repoRoot, cwd) || ".", agent, ...inspectGuidanceDelivery(repoRoot, { cwd, agent })
})));
process.stdout.write(`${JSON.stringify({ schema: "arcadia-guidance-delivery-evidence-v1", evidence }, null, 2)}\n`);
if (evidence.some((entry) => entry.problems.length)) process.exitCode = 1;
