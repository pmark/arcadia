// Pre-flight (run 8, Action 1 / PR #9 shape): real `arcadia qa pr` reviewer path over a simulated PR built from the run-8 rendered fixture tree.
// Only `gh` is stubbed (pr view <fields>, pr view --json commits, api compare patch); any other gh call is refused.
// Usage: smoke.mts <label>
import { copyFileSync, readdirSync, statSync, writeFileSync, appendFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
const SRC = process.env.SMOKE_SRC!;
const [label] = process.argv.slice(2);
const S = path.dirname(new URL(import.meta.url).pathname);
const repository = "pmark/arcadia-three-action-rehearsal-20261004";
const FIXTURE = "/Users/pmark/tmp/arcadia-three-action-rehearsal";
const pr = JSON.parse(readFileSync(path.join(S, "pr9-run8-evidence.json"), "utf8"));
const patch = readFileSync(path.join(S, "candidate.patch"), "utf8");
const base = pr.baseRefOid as string;
const oids = readFileSync(path.join(S, "commits.txt"), "utf8").trim().split("\n");
const commitsJson = { commits: oids.map((oid, i) => ({ oid, messageHeadline: `commit ${i + 1}`, authoredDate: "2026-10-06T03:25:00Z", authors: [] })) };

const { runQaPrReviewCommand, runHostCommand } = await import(`${SRC}/qa/prReview.ts`);
const { initWorkspace } = await import(`${SRC}/workspace/initWorkspace.ts`);
const { getWorkspacePaths } = await import(`${SRC}/workspace/paths.ts`);
const { withDatabase } = await import(`${SRC}/db/connection.ts`);
const { upsertProject, upsertProjectMetadata } = await import(`${SRC}/db/repositories.ts`);
const ws = path.join(S, `ws-${label}`);
const log = path.join(S, `calls-${label}.log`);
if (existsSync(ws)) rmSync(ws, { recursive: true, force: true });
writeFileSync(log, "");
initWorkspace(ws);
const paths = getWorkspacePaths(ws);
const real = "/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover/config";
copyFileSync(path.join(real, "coding-agent-profiles.json"), paths.codingAgentProfiles);
copyFileSync(path.join(real, "provider-adapters.json"), paths.providerAdapters);
withDatabase(ws, (db: any) => {
  const p = upsertProject(db, { name: "Three Action Rehearsal", mission: "Reviewer smoke", status: "active", currentMilestone: "m", nextAction: "a", workClassification: "agent" });
  upsertProjectMetadata(db, { projectId: p.id, repoPath: FIXTURE, validationCommands: ["node scripts/check-rehearsal.mjs"] });
});

const runCommand = (input: any) => {
  const started = Date.now();
  let result: any;
  let kind = "";
  if (input.command === "gh") {
    const json = input.args[input.args.indexOf("--json") + 1];
    if (input.args[0] === "pr" && input.args[1] === "view" && json === "commits") { kind = "pr-commits"; result = { status: 0, stdout: JSON.stringify(commitsJson), stderr: "", error: null }; }
    else if (input.args[0] === "pr" && input.args[1] === "view") { kind = "pr-view"; result = { status: 0, stdout: JSON.stringify(pr), stderr: "", error: null }; }
    else if (input.args[0] === "api" && input.args.includes("GET") && String(input.args[3]).includes(`/compare/${base}...${pr.headRefOid}`)) { kind = "compare"; result = { status: 0, stdout: patch, stderr: "", error: null }; }
    else { kind = "refused"; result = { status: 1, stdout: "", stderr: `smoke: refused gh call ${input.args.join(" ")}`, error: null }; }
  } else if (process.env.SMOKE_DRY === "1" && input.args[0] === "exec") {
    kind = "dry-no-model"; result = { status: 1, stdout: "", stderr: "smoke dry run: model not invoked", error: "dry run" };
  } else {
    result = runHostCommand(input);
  }
  const ms = Date.now() - started;
  appendFileSync(log, `${JSON.stringify({ cmd: kind ? `${input.command}(stub:${kind})` : input.command, args: input.args.map((a: string) => a.length > 160 ? a.slice(0, 160) + "..." : a), cwd: input.cwd, ms, status: result.status, error: result.error, stderrHead: (result.stderr ?? "").slice(0, 600) })}\n`);
  return result;
};

const t0 = Date.now();
try {
  const res = runQaPrReviewCommand({ workspace: ws, pullRequest: pr.url, reviewerTimeoutMs: 15 * 60_000 }, { runCommand });
  const d = res.data;
  console.log(JSON.stringify({
    elapsedMs: Date.now() - t0, verdict: d.verdict, reviewerUnavailable: d.reviewerUnavailable, summary: d.summary,
    reviewer: d.reviewer, findings: d.findings, checks: d.checks, residualRisks: d.residualRisks, reportPath: d.reportPath,
    decisionStatus: d.decision?.status
  }, null, 2));
} catch (error: any) {
  console.log(JSON.stringify({ elapsedMs: Date.now() - t0, threw: error?.message, details: error?.details }, null, 2));
}
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [`${path.relative(ws, p)} (${statSync(p).size}b)`];
});
console.log(walk(paths.artifacts).join("\n"));
