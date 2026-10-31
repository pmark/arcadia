// A scripted stand-in for scripts/run-plan-amendment.mjs: on success it makes the same kind of change the real
// activation settlement does (a docs-only governance commit pushed to origin main); on failure it prints a failed receipt.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.FAKE_ROOT;
const args = process.argv.slice(2);
appendFileSync(path.join(root, "calls.log"), JSON.stringify({ tool: "plan-runner", args, cwd: process.cwd(), operatorId: process.env.ARCADIA_OPERATOR_SCRIPT_ID ?? null }) + "\n");
const state = JSON.parse(readFileSync(path.join(root, "state.json"), "utf8"));
const git = (...a) => execFileSync("git", a, { cwd: state.repository, encoding: "utf8" }).trim();
if (args.length !== 2 || args[1] !== "run") { process.stderr.write("usage: run-plan-amendment <descriptor> run\n"); process.exit(64); }
if (state.planRunner.mode === "fail") {
  process.stdout.write(JSON.stringify({ status: "failed", reason: "BASE_NOT_SYNCHRONIZED", message: "Checkout versus origin base differs." }) + "\n");
  process.exit(1);
}
const plan = path.join(state.repository, "docs", "plans", `${state.plan}.md`);
writeFileSync(plan, readFileSync(plan, "utf8").replace(/^status: draft$/m, "status: active"));
const project = path.join(state.repository, "PROJECT.md");
writeFileSync(project, readFileSync(project, "utf8").replace(/^active_plan: .*$/m, `active_plan: ${state.plan}`));
git("add", "-A");
git("commit", "-m", "Activate the pinned Plan");
git("push", "origin", "HEAD:refs/heads/main");
process.stdout.write(JSON.stringify({ status: "succeeded", reason: "SETTLED_AND_PUBLISHED", runDirectory: path.join(root, "runner-run") }) + "\n");
