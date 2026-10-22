/** One-shot operator recovery, using the existing guarded QA executor. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withReadOnlyDatabase } from "../src/db/connection.js";
import { resolveReadyWorkspace } from "../src/cli/workspace.js";
import { readProductionPolicySafely } from "../src/production/policy.js";
import { verdictAttemptLimit } from "../src/sessions/roleLineage.js";
import { classifyPullRequestChecks, runQaPrReviewCommand, type PullRequestCheckRun } from "../src/qa/prReview.js";

const id = "recover-qa-1662-20261022";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const library = path.join(root, "artifacts/generated/operator-scripts");
const head = "cff844a22093fbbf4c0a29408502718ab91d047a";
const url = "https://github.com/pmark/arcadia/pull/1662";
const plan = "arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider";
const action = "cover-mail-ack-receipt-kind-collision";
const requirement = `arcadia/${plan}/${action}`;
const inputRevision = "04991ec7485bf6ff4bdbce6183a44591108922de2f817ea602228b3992dbe99d";
const bodySha256 = "5057d7d18cb5f4046d0a0a0ee743ac50686c71e74399a5cd93fb59216a7f3bf4";
const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: root, encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024 }).trim();
const refuse = (reason: string): never => { throw new Error(`Recovery refused: ${reason}`); };

interface RecoveryTerminal { ordinal: number; status: string; target_head: string | null; input_revision: string; terminal_receipt_json: string | null }
export function assertRecoveryTerminal(terminal: RecoveryTerminal | undefined, artifactId: string): void {
  const receipt = terminal?.terminal_receipt_json ? JSON.parse(terminal.terminal_receipt_json) as { artifactId?: string; headSha?: string; verdict?: string } : null;
  if (!terminal || terminal.ordinal !== 4 || terminal.status !== "passed" || terminal.target_head !== head || terminal.input_revision !== inputRevision
    || receipt?.artifactId !== artifactId || receipt.headSha !== head || receipt.verdict !== "pass") refuse("returned QA pass lacks matching canonical passed attempt 4");
}

export async function runQa1662Recovery() {
  if (process.env.ARCADIA_OPERATOR_SCRIPT_ID !== id || process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR !== path.join(library, `${id}.json`)) refuse("launch only from this card in the operator-action library");
  if (process.env.CODEX_SANDBOX) refuse("host operator action only");
  if (Date.now() >= Date.parse("2026-10-26T00:00:00Z")) refuse("card expired");
  if (run("git", ["branch", "--show-current"]) !== "main" || run("git", ["status", "--porcelain"])) refuse("main must be clean");
  const sourceHead = run("git", ["rev-parse", "HEAD"]);
  if (run("git", ["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0] !== sourceHead) refuse("main differs from remote");
  for (const file of [`artifacts/generated/operator-scripts/${id}.sh`, `artifacts/generated/operator-scripts/${id}.json`, "scripts/qa-recovery-1662.ts"]) {
    if (run("git", ["show", `HEAD:${file}`]) !== readFileSync(path.join(root, file), "utf8").trim()) refuse("unreviewed recovery source");
  }
  const { workspacePath } = resolveReadyWorkspace(undefined);
  const assertAuthority = () => withReadOnlyDatabase(workspacePath, db => {
    const read = readProductionPolicySafely(db);
    if (read.status !== "ok") return refuse("unreadable production policy");
    const policy = read.policy;
    if (policy.desiredState !== "active" || !policy.scope) return refuse("production is Off; this card never activates it");
    const scope = policy.scope;
    if (!scope.projects.includes("arcadia") || !scope.plans.includes(`arcadia/${plan}`) || !scope.actions.includes(`arcadia/${action}`)
      || scope.providers.length !== 1 || scope.providers[0] !== "claude-code-cli" || scope.maxConcurrentSessions !== 1) refuse("Active scope does not cover the pinned Claude Action");
    const rows = db.prepare("SELECT role, ordinal, status, target_head FROM session_role_attempts WHERE requirement_id = ? AND input_revision = ? ORDER BY ordinal").all(requirement, inputRevision) as {role: string; ordinal: number; status: string; target_head: string | null}[];
    const qa = rows.filter(row => row.role === "qa");
    if (qa.length !== 3 || qa.at(-1)?.ordinal !== 3 || qa.at(-1)?.status !== "failed") refuse("QA lineage moved; never repeat an uncertain attempt");
    if (rows.some(row => row.status === "pending" || row.status === "running")) refuse("live role attempt exists");
    if (verdictAttemptLimit(db, requirement, inputRevision, "qa") !== 7) refuse("QA limit changed");
    const review = rows.filter(row => row.role === "code-review").at(-1);
    if (review?.ordinal !== 5 || review.status !== "passed" || review.target_head !== head) refuse("code-review binding moved");
    return { revision: policy.revision, epoch: policy.epoch };
  });
  const authority = assertAuthority();
  const readPinnedPr = () => JSON.parse(run("gh", ["pr", "view", url, "--json", "headRefOid,body,state,isDraft,statusCheckRollup"])) as { headRefOid: string; body: string; state: string; isDraft: boolean; statusCheckRollup: PullRequestCheckRun[] };
  const pr = readPinnedPr();
  if (pr.headRefOid !== head || pr.state !== "OPEN" || createHash("sha256").update(pr.body).digest("hex") !== bodySha256) refuse("candidate head or repaired QA plan moved");
  const required = ["lint", "dashboard", "e2e", ...Array.from({length: 8}, (_, i) => `unit-shard-${i + 1}`), ...Array.from({length: 4}, (_, i) => `unit-${i + 1}`)];
  const assertCi = (candidate: typeof pr) => {
    if (required.some(name => !candidate.statusCheckRollup.some(check => check.name === name))
      || classifyPullRequestChecks(candidate.statusCheckRollup).state !== "green") refuse("required CI not green");
  };
  assertCi(pr);
  const latest = assertAuthority();
  if (authority.revision !== latest.revision || authority.epoch !== latest.epoch) refuse("production authority changed during preparation");
  const runDir = path.join(library, "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`);
  mkdirSync(runDir, { recursive: true });
  // Exclusive durable marker precedes side effects. Failure/unknown outcomes never
  // permit another attempt via this card; preserve the receipt for diagnosis.
  closeSync(openSync(path.join(library, `${id}.started`), "wx", 0o600));
  writeFileSync(path.join(runDir, "preflight.json"), JSON.stringify({ head, authority, observedAt: new Date().toISOString() }));
  try {
    const beforeReady = readPinnedPr();
    if (beforeReady.headRefOid !== head || createHash("sha256").update(beforeReady.body).digest("hex") !== bodySha256) refuse("candidate changed immediately before readiness");
    assertCi(beforeReady);
    const beforeReadyAuthority = assertAuthority();
    if (beforeReadyAuthority.revision !== authority.revision || beforeReadyAuthority.epoch !== authority.epoch) refuse("production authority changed immediately before readiness");
    // GitHub has no conditional ready mutation: a remote push can race it.
    // QA still receives the approved pin and refuses drift before allocation.
    if (beforeReady.isDraft) run("gh", ["pr", "ready", url]);
    const currentAuthority = assertAuthority();
    if (currentAuthority.revision !== authority.revision || currentAuthority.epoch !== authority.epoch) refuse("production authority changed after readiness");
    const result = runQaPrReviewCommand({ workspace: workspacePath, pullRequest: url, rerun: true, reviewerTimeoutMs: 300_000, expectedCandidate: { headSha: head, bodySha256, inputRevision, maxOrdinal: 4 } });
    writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2));
    if (result.data.verdict !== "pass" || result.data.candidate.headSha !== head) refuse("QA did not pass for the pinned head; preserve report and stop");
    const terminal = withReadOnlyDatabase(workspacePath, db => db.prepare("SELECT ordinal, status, target_head, input_revision, terminal_receipt_json FROM session_role_attempts WHERE requirement_id = ? AND input_revision = ? AND role = 'qa' ORDER BY ordinal DESC LIMIT 1").get(requirement, inputRevision)) as RecoveryTerminal | undefined;
    assertRecoveryTerminal(terminal, result.data.artifact.id);
    console.log(JSON.stringify(result));
  } catch (error) {
    writeFileSync(path.join(runDir, "failure-handoff.md"), `Recovery did not establish success. Do not retry this card or reset attempts. Inspect result.json if present and canonical QA ordinal 4. Production was not changed by this card.\n${error instanceof Error ? error.message : "unknown failure"}\n`);
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runQa1662Recovery().catch(error => { console.error(error instanceof Error ? error.message : "Recovery failed"); process.exitCode = 1; });
}
