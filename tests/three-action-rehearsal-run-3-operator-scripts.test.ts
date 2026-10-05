import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { runProjectImportCommand, runProjectMetadataCommand } from "../src/commands/project.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { resolveOperatorGate } from "../src/ask/operatorGate.js";
import { listUnsettledAgentAskProposals } from "../src/ask/settlement.js";
import { discoverDocs } from "../src/docs/discover.js";
import { recordSessionRoleAttemptTerminal } from "../src/sessions/enrollment.js";
import { beginDevelopmentAttempt, requirementIdentity } from "../src/sessions/roleLineage.js";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * The run-3 operator pairs for the disposable three-Action rehearsal: the
 * fixture reset (which also closes the Issue #968 gap by rejecting exactly run
 * 2's pending complete proposal), the run-3 G6 preflight, the run-3 G7 Grant
 * and the run-3 G8 terminal Off. Shaped like
 * tests/three-action-rehearsal-run-2-operator-scripts.test.ts: every
 * behavioral case runs a pair copied into a throwaway library with fake `mise`,
 * `gh`, `codex`, `timeout`, `sleep` and a `git` whose `push` is only recorded,
 * so no case reaches GitHub, production policy, a model, a service or the live
 * workspace. Arcadia's discovery, docs sync, requirementIdentity, the dispatch
 * gate, `agent-ask settle` and database reads run for real (passthrough)
 * against a throwaway workspace.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const RESET = "reset-three-action-rehearsal-fixture-run3-2026-10-05";
const G6 = "preflight-three-action-rehearsal-run3-2026-10-05";
const G7 = "grant-production-three-action-rehearsal-run3-2026-10-05";
const G8 = "restore-terminal-off-three-action-rehearsal-run3-2026-10-05";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const RUN2_RESET = "reset-three-action-rehearsal-fixture-2026-10-05";
const RUN2_G6 = "preflight-three-action-rehearsal-2026-10-05";
const RUN2_G7 = "grant-production-three-action-rehearsal-2026-10-05";
const RUN2_G8 = "restore-terminal-off-three-action-rehearsal-2026-10-05";
const RUN1_G7 = "grant-production-three-action-rehearsal-2026-10-04";
const RUN1_G8 = "restore-terminal-off-three-action-rehearsal-2026-10-04";
const PAIRS = [RESET, G6, G7, G8];
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");
const descriptorOf = (id: string) => JSON.parse(readFileSync(path.join(library, `${id}.json`), "utf8"));
const REPO = "pmark/arcadia-three-action-rehearsal-t1";
const RUN1_BRANCH = "claude/write-start-marker-20261004T170245861Z";
const RUN2_BRANCH = "claude/write-start-marker-20261005T155147519Z";
const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const ACTIONS = ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"];
const constantOf = (id: string, name: string) => {
  const match = source(id).match(new RegExp(`^${name}=(?:'([^']*)'|"([^"$]*)")$`, "m"));
  if (!match) throw new Error(`${id} has no literal ${name}`);
  return match[1] ?? match[2];
};
const ORIGINAL_LINE = constantOf(RUN2_RESET, "OLD_NEXT_ACTION");
const RUN2_LINE = constantOf(RUN2_RESET, "NEW_NEXT_ACTION");
const OLD_LINE = constantOf(RESET, "OLD_NEXT_ACTION");
const NEW_LINE = constantOf(RESET, "NEW_NEXT_ACTION");
const RUN2_PROPOSAL = constantOf(RESET, "RUN2_PROPOSAL");
const SUPERSEDE_REQUEST_ID = constantOf(RESET, "SUPERSEDE_REQUEST_ID");
const DESCRIPTION = "Disposable Arcadia three-Action rehearsal fixture (arcadia-three-action-rehearsal-v1); safe to delete after its recorded review.";
const CRITERIA_A = [
  'MARKER.md exists and contains exactly the line "three-action rehearsal start" followed by a trailing newline, with no other content.',
  "The genesis check node scripts/check-rehearsal.mjs passes."
];

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

type Reply = { stdout?: string; stderr?: string; status?: number; exec?: string; passthrough?: "probe" | "cli"; discardOutput?: boolean };
type Replies = Record<string, Reply | Reply[]>;

// Fake CLIs answer from a JSON table; an array is consumed in order and its
// last entry repeats. Every call is appended to calls.log; `arcadia agent-ask`
// calls also record the ARCADIA_WORKSPACE they ran with in env.log.
const FAKE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const root = process.env.FAKE_ROOT, name = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(path.join(root, "calls.log"), name + " " + JSON.stringify(args) + "\\n");
const replies = JSON.parse(fs.readFileSync(path.join(root, "replies.json"), "utf8"));
let key = name + " " + args.join(" ");
let program = "";
if (name === "mise") {
  const rest = args.slice(2);
  if (rest[0] === "pnpm") key = "arcadia " + rest.slice(3).filter((a) => !a.startsWith("--")).slice(0, 2).join(" ");
  else if (rest.includes("tsx")) {
    program = fs.readFileSync(0, "utf8");
    key = program.includes("fixtureSessions") ? "probe sessions" : program.includes("classifyPreservedCandidate") ? "probe classify"
      : program.includes("requirementIdentity") ? "probe amendment" : program.includes("getProjectMetadata") ? "probe registration"
      : program.includes("session_role_attempts") ? "probe lineage" : program.includes("listUnsettledAgentAskProposals") ? "probe proposal-gate"
      : program.includes("resolveOperatorGate") ? "probe operator-gate" : program.includes("syncProjectDocs") ? "probe live-sync"
      : program.includes("checkProviderSignIn") ? "probe claude" : program.includes("observeProviderCapacity") ? "probe capacity" : "probe leases";
  } else key = "node preflight";
}
if (key.startsWith("arcadia agent-ask")) fs.appendFileSync(path.join(root, "env.log"), JSON.stringify({ key, apply: args.includes("--apply"), ARCADIA_WORKSPACE: process.env.ARCADIA_WORKSPACE ?? null }) + "\\n");
fs.appendFileSync(path.join(root, "keys.log"), key + (key.startsWith("arcadia agent-ask") && args.includes("--apply") ? " --apply" : "") + "\\n");
const match = Object.keys(replies).filter((k) => key.startsWith(k)).sort((a, b) => b.length - a.length)[0];
let reply = match === undefined ? { status: 97, stderr: "unexpected call: " + key } : replies[match];
if (Array.isArray(reply)) {
  const counter = path.join(root, "counter-" + Buffer.from(match).toString("hex"));
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  reply = reply[Math.min(n, reply.length - 1)];
}
if (reply.exec) reply = { ...reply, stdout: require("child_process").execSync(reply.exec, { encoding: "utf8" }) };
if (reply.passthrough) {
  const env = { ...process.env };
  delete env.VITEST;
  const real = process.env.FAKE_ARCADIA_ROOT;
  const argv = reply.passthrough === "probe"
    ? ["--import", "tsx", "--input-type=module", "-", ...args.slice(args.indexOf("-") + 1)]
    : ["--import", "tsx", path.join(real, "src", "cli.ts"), ...args.slice(args.indexOf("arcadia") + 1), "--workspace", process.env.FAKE_WORKSPACE];
  const run = require("child_process").spawnSync(process.execPath, argv, { cwd: real, input: program, env, encoding: "utf8", timeout: 60000 });
  if (reply.discardOutput) process.exit(1);
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  process.exit(run.status === null ? 98 : run.status);
}
if (reply.stdout) process.stdout.write(reply.stdout.replace(/[{][{]arg:([^}]+)[}][}]/g, (_m, flag) => args[args.indexOf(flag) + 1] ?? ""));
if (reply.stderr) process.stderr.write(reply.stderr);
process.exit(reply.status ?? 0);
`;

function git(cwd: string, args: string[]) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}
const commitAll = (cwd: string, message: string) => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
};
const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
const CHECKOUT_PROJECT = "---\narcadia: v1\ntype: project\nslug: arcadia\nname: Arcadia\nstatus: active\ngoal: Checkout under test.\noutcome: Checkout under test.\nmilestone: Test\nupdated: 2026-10-05\n---\n\n# Arcadia\n";

/** A throwaway Arcadia checkout whose library holds copies of the named pairs. */
function sandboxFor(ids: string[]) {
  const root = temp("arcadia-run3-pair-");
  const checkout = path.join(root, "arcadia");
  const scripts = path.join(checkout, "artifacts", "generated", "operator-scripts");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const workspace = path.join(root, "martianrover");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(path.join(checkout, ".gitignore"), "artifacts/\n");
  writeFileSync(path.join(checkout, "PROJECT.md"), CHECKOUT_PROJECT);
  git(checkout, ["init", "-q", "-b", "main"]);
  commitAll(checkout, "init");
  git(root, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
  git(checkout, ["remote", "add", "origin", path.join(root, "origin.git")]);
  git(checkout, ["push", "-q", "-u", "origin", "main"]);
  for (const id of ids) {
    copyFileSync(path.join(library, `${id}.sh`), path.join(scripts, `${id}.sh`));
    chmodSync(path.join(scripts, `${id}.sh`), 0o755);
    copyFileSync(path.join(library, `${id}.json`), path.join(scripts, `${id}.json`));
  }
  for (const tool of ["mise", "gh", "codex", "pnpm"]) writeFileSync(path.join(bin, tool), FAKE, { mode: 0o755 });
  // Real Git for everything except `push`, which is recorded (and fails on demand) and never reaches a network.
  writeFileSync(path.join(bin, "git"), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = push ]; then printf 'git %s\\n' "$*" >> "$FAKE_ROOT/calls.log"; echo push >> "$FAKE_ROOT/keys.log"; [ -n "$FAKE_PUSH_FAIL" ] && exit 1; exit 0; fi; done\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(path.join(root, "replies.json"), "{}");
  writeFileSync(path.join(root, "calls.log"), "");
  writeFileSync(path.join(root, "keys.log"), "");
  writeFileSync(path.join(root, "env.log"), "");
  const run = (id: string, env: Record<string, string | undefined> = {}, args = ["run"]) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_ROOT: root, FAKE_ARCADIA_ROOT: repoRoot, FAKE_WORKSPACE: workspace, ...env
    };
    for (const key of ["CODEX_SANDBOX", "ARCADIA_OPERATOR_SCRIPT_ID", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", "ANTHROPIC_API_KEY", "ARCADIA_REHEARSAL_GITHUB_REPO", "ARCADIA_WORKSPACE", "FAKE_PUSH_FAIL"]) {
      if (!(key in env)) delete childEnv[key];
    }
    return spawnSync("bash", [path.join(scripts, `${id}.sh`), ...args], { env: childEnv, encoding: "utf8", timeout: 180_000 });
  };
  const runDirs = () => existsSync(path.join(scripts, "runs")) ? readdirSync(path.join(scripts, "runs")).sort().map((d) => path.join(scripts, "runs", d)) : [];
  const receipt = (id: string) => {
    const own = runDirs().filter((d) => existsSync(path.join(d, "receipt.json")))
      .map((d) => ({ dir: d, json: JSON.parse(readFileSync(path.join(d, "receipt.json"), "utf8")) })).filter((r) => r.json.id === id);
    if (own.length === 0) throw new Error(`no ${id} receipt`);
    return own[own.length - 1];
  };
  const calls = () => readFileSync(path.join(root, "calls.log"), "utf8");
  const keys = () => readFileSync(path.join(root, "keys.log"), "utf8").trim().split("\n").filter(Boolean);
  const envLog = () => readFileSync(path.join(root, "env.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { key: string; apply: boolean; ARCADIA_WORKSPACE: string | null });
  const pushes = () => calls().split("\n").filter((line) => line.startsWith("git "));
  const setReplies = (replies: Replies) => {
    for (const file of readdirSync(root).filter((f) => f.startsWith("counter-"))) rmSync(path.join(root, file));
    writeFileSync(path.join(root, "replies.json"), JSON.stringify(replies));
  };
  const patchReplies = (patch: Replies) => setReplies({ ...JSON.parse(readFileSync(path.join(root, "replies.json"), "utf8")), ...patch });
  const rebind = (id: string, replace: Array<[RegExp | string, string]>) => {
    const script = path.join(scripts, `${id}.sh`);
    let text = readFileSync(script, "utf8");
    for (const [pattern, value] of replace) {
      expect(typeof pattern === "string" ? text.includes(pattern) : pattern.test(text), String(pattern)).toBe(true);
      text = text.replace(pattern, value);
    }
    writeFileSync(script, text);
  };
  const fixture = path.join(home, "tmp", "arcadia-three-action-rehearsal");
  return { root, checkout, scripts, home, workspace, fixture, run, runDirs, receipt, calls, keys, envLog, pushes, setReplies, patchReplies, rebind };
}
type Box = ReturnType<typeof sandboxFor>;
const parsedCalls = (box: Box) => box.calls().trim().split("\n").filter((line) => line && !line.startsWith("git "))
  .map((line) => ({ tool: line.slice(0, line.indexOf(" ")), args: JSON.parse(line.slice(line.indexOf(" ") + 1)) as string[] }));
const arcadiaCalls = (box: Box, noun: string, verb: string) => parsedCalls(box).filter((c) => c.tool === "mise" && c.args[3] === "-s" && c.args[5] === noun && c.args[6] === verb);
const ok = (data: unknown): Reply => ({ stdout: JSON.stringify({ ok: true, data }) });
const status = (desiredState: string, extra: Record<string, unknown> = {}) => ok({
  read: { status: "ok", policy: { desiredState, revision: 33, epoch: 3, authority: desiredState === "active" ? { requestId: "some-grant" } : null } },
  liveAdmissions: 0, ...extra
});
const writeReceipt = (box: Box, dir: string, json: Record<string, unknown>) => {
  mkdirSync(path.join(box.scripts, "runs", dir), { recursive: true });
  writeFileSync(path.join(box.scripts, "runs", dir, "receipt.json"), JSON.stringify(json));
  // The scripts resolve their own directory physically (pwd -P), as receipts record it.
  return realpathSync(path.join(box.scripts, "runs", dir, "receipt.json"));
};

/** G1's genesis, rendered from G1's own heredocs into the box's fixture path. */
function renderG1Fixture(directory: string) {
  const script = source(G1);
  const constants = script.slice(0, script.indexOf('case "${1:-run}" in')).split("\n").filter((line) => /^[A-Z_]+=/.test(line) && !line.includes("$(")).join("\n");
  const end = "} # end render_fixture";
  const start = script.indexOf("render_fixture() {");
  const program = [constants, `REPO=${JSON.stringify(REPO)}`, "FIXTURE_DATE=2026-10-04", script.slice(start, script.indexOf(end) + end.length), `render_fixture ${JSON.stringify(directory)}`].join("\n");
  const run = spawnSync("bash", ["-c", program], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
}
const actionsOf = (root: string) => {
  const plan = discoverDocs(root).docs.find((doc) => doc.type === "plan");
  if (plan?.type !== "plan") throw new Error("no Plan");
  return plan.actions;
};
const identityOf = (root: string) => requirementIdentity({ projectSlug: "three-action-rehearsal", planSlug: "autonomous-three-action-rehearsal", action: actionsOf(root)[0] });
/** Run 2's reset as it landed on the live fixture: its next_action line and `updated: 2026-10-05`. */
const run2Plan = (plan: string) => plan.replace(ORIGINAL_LINE, RUN2_LINE).replace(/^updated: \d{4}-\d{2}-\d{2}$/m, "updated: 2026-10-05");

const completeAsk = (requestId: string, candidate: string, overrides: Record<string, unknown> = {}) => JSON.stringify({
  agent_ask: "v1", request_id: requestId, project: "three-action-rehearsal", intent: "complete", target_ref: "action/write-start-marker",
  candidate_revision: candidate, evidence: CRITERIA_A.map((criterion) => ({ criterion, status: "met" })), desired_result: "Mark write-start-marker complete.", ...overrides
});
const seedProposal = (box: Box, request: string) => runAgentAskPreviewCommand({ workspace: box.workspace, request }).data;
const unsettled = (box: Box) => withReadOnlyDatabase(box.workspace, (db) => listUnsettledAgentAskProposals(db)).map((row) => row.requestId);
const settlementOf = (box: Box, requestId: string) => withReadOnlyDatabase(box.workspace, (db) => db.prepare(
  "SELECT s.request_id AS settlementRequestId, s.disposition FROM agent_ask_settlements s JOIN agent_ask_proposals p ON p.id = s.proposal_id WHERE p.request_id = ?").get(requestId));

/**
 * The state the run-3 reset meets after run 2: G1's genesis registered in the
 * box workspace (real import, metadata and docs sync), run 1's candidate and
 * passed attempt, run 2's reset commit on main, run 2's candidate (marker and
 * settlement commits) and passed attempt, the G1, run-2 reset and run-2 G8
 * receipts, and run 2's pending complete proposal.
 */
function afterRun2(box: Box, options: { pendingRun2Proposal?: boolean } = {}) {
  initWorkspace(box.workspace);
  const fixture = box.fixture;
  mkdirSync(fixture, { recursive: true });
  renderG1Fixture(fixture);
  git(fixture, ["init", "-q", "-b", "main"]);
  const genesis = commitAll(fixture, "Bootstrap three-Action rehearsal fixture");
  git(fixture, ["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  const imported = runProjectImportCommand({ workspace: box.workspace, name: "Three Action Rehearsal", mission: "Disposable three-Action rehearsal fixture.", status: "active", milestone: "Run the bounded three-Action rehearsal", nextAction: "Import fixture documents", classification: "agent" });
  const projectId = imported.data.project.id;
  expect(imported.data.project.slug).toBe("three-action-rehearsal");
  runProjectMetadataCommand({ workspace: box.workspace, projectId, repoPath: fixture, validationCommands: ["node scripts/check-rehearsal.mjs"] });
  expect((runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true }).data as unknown as { errorCount: number }).errorCount).toBe(0);
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-project-id"), `${projectId}\n`);
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-first-packet-approval"), "review_1\n");
  const original = identityOf(fixture);
  // Run 1's candidate: a branch off genesis carrying the marker.
  git(fixture, ["checkout", "-q", "-b", RUN1_BRANCH]);
  writeFileSync(path.join(fixture, "MARKER.md"), "three-action rehearsal start\n");
  const run1Tip = commitAll(fixture, "Implement write-start-marker");
  git(fixture, ["checkout", "-q", "main"]);
  // Run 2's reset on fixture main, byte-for-byte as the run-2 reset writes it.
  writeFileSync(path.join(fixture, PLAN_FILE), run2Plan(readFileSync(path.join(fixture, PLAN_FILE), "utf8")));
  git(fixture, ["add", "-A"]);
  git(fixture, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-q", "-m", "Reset write-start-marker for three-Action rehearsal run 2"]);
  const run2Head = git(fixture, ["rev-parse", "HEAD"]);
  const run2 = identityOf(fixture);
  runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true });
  // Run 2's candidate: the marker and its settlement commit on the run-2 head.
  git(fixture, ["checkout", "-q", "-b", RUN2_BRANCH]);
  writeFileSync(path.join(fixture, "MARKER.md"), "three-action rehearsal start\n");
  const run2Marker = commitAll(fixture, "Add MARKER.md with rehearsal start marker");
  mkdirSync(path.join(fixture, ".arcadia", "asks", "archive"), { recursive: true });
  writeFileSync(path.join(fixture, ".arcadia", "asks", "archive", `agent-ask-${RUN2_PROPOSAL}.yaml`), completeAsk(RUN2_PROPOSAL, run2Marker) + "\n");
  const run2Tip = commitAll(fixture, `chore(arcadia): settle ${RUN2_PROPOSAL}`);
  git(fixture, ["checkout", "-q", "main"]);
  for (const id of [RESET, G6, G7].filter((id) => existsSync(path.join(box.scripts, `${id}.sh`)))) {
    box.rebind(id, [[/^RUN2_HEAD="[0-9a-f]{40}"$/m, `RUN2_HEAD="${run2Head}"`]]);
  }
  if (existsSync(path.join(box.scripts, `${RESET}.sh`))) {
    box.rebind(RESET, [[/^RUN1_TIP="[0-9a-f]{40}"$/m, `RUN1_TIP="${run1Tip}"`], [/^RUN2_TIP="[0-9a-f]{40}"$/m, `RUN2_TIP="${run2Tip}"`]]);
  }
  withDatabase(box.workspace, (db) => {
    const at = (iso: string) => new Date(iso);
    const one = beginDevelopmentAttempt(db, { requirement: original, requestId: "worker-tick-run-1", retryAuthorized: true, now: at("2026-10-04T17:02:45.000Z") }).attempt;
    recordSessionRoleAttemptTerminal(db, { requestId: one.request_id, actorId: one.actor_id, status: "passed", targetHead: run1Tip, receipt: { sessionId: "session_run_1" }, now: at("2026-10-04T17:30:00.000Z") });
    const two = beginDevelopmentAttempt(db, { requirement: run2, requestId: "worker-tick-run-2", retryAuthorized: true, now: at("2026-10-05T15:51:47.000Z") }).attempt;
    recordSessionRoleAttemptTerminal(db, { requestId: two.request_id, actorId: two.actor_id, status: "passed", targetHead: run2Tip, receipt: { sessionId: "session_run_2" }, now: at("2026-10-05T15:55:00.000Z") });
  });
  writeReceipt(box, "20261004T165157Z-6269", { id: G1, outcome: "succeeded", githubRepository: REPO, rootCommit: genesis });
  const run2ResetReceipt = writeReceipt(box, "20261005T153000Z-1", { id: RUN2_RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: fixture, previousMain: genesis, newHead: run2Head, remoteMainAfter: run2Head });
  writeReceipt(box, "20261005T160050Z-46759", { id: RUN2_G8, runId: "20261005T160050Z-46759", outcome: "succeeded", stage: "complete", offState: "confirmed" });
  if (options.pendingRun2Proposal !== false) seedProposal(box, completeAsk(RUN2_PROPOSAL, run2Marker));
  return { genesis, run1Tip, run2Head, run2Marker, run2Tip, projectId, original, run2, run2ResetReceipt };
}
type After = ReturnType<typeof afterRun2>;
const resetReplies = (box: Box, state: After): Replies => ({
  "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
  "arcadia production status": status("inactive"),
  "probe registration": { passthrough: "probe" },
  "probe amendment": { passthrough: "probe" },
  "probe lineage": { passthrough: "probe" },
  "probe live-sync": { passthrough: "probe" },
  "probe proposal-gate": { passthrough: "probe" },
  "arcadia agent-ask settle": { passthrough: "cli" },
  "arcadia docs sync": { passthrough: "cli" },
  "arcadia work list": { passthrough: "cli" },
  "gh api user": { stdout: "pmark\n" },
  [`gh repo view ${REPO}`]: { stdout: JSON.stringify({ name: "arcadia-three-action-rehearsal-t1", owner: { login: "pmark" }, visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, description: DESCRIPTION }) },
  // GitHub main is the local main this fake pushed to: the fake `git push` records but never moves anything.
  [`gh api repos/${REPO}/commits/main`]: { exec: 'git -C "$HOME/tmp/arcadia-three-action-rehearsal" rev-parse refs/heads/main' },
  [`gh api repos/${REPO}/branches/${RUN1_BRANCH}`]: { stdout: `${state.run1Tip}\n` },
  [`gh api repos/${REPO}/pulls/1`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN1_BRANCH, sha: state.run1Tip } }) },
  [`gh api repos/${REPO}/branches/${RUN2_BRANCH}`]: { stdout: `${state.run2Tip}\n` },
  [`gh api repos/${REPO}/pulls/2`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN2_BRANCH, sha: state.run2Tip } }) }
});
function resetBox(options: { pendingRun2Proposal?: boolean } = {}) {
  const box = sandboxFor([RESET]);
  const state = afterRun2(box, options);
  box.setReplies(resetReplies(box, state));
  return { box, ...state };
}
const resetEnv = { ARCADIA_REHEARSAL_GITHUB_REPO: REPO };
const settleCalls = (box: Box) => arcadiaCalls(box, "agent-ask", "settle");
const noMutation = (box: Box, run2Head: string) => {
  expect(box.pushes()).toEqual([]);
  expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(run2Head);
  expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
  expect(arcadiaCalls(box, "docs", "sync")).toHaveLength(0);
};
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

// The run-1 and run-2 pairs, byte for byte as merged: retired from use for run 3, never edited.
const EARLIER_PAIR_SHA256: Record<string, string> = {
  "reset-three-action-rehearsal-fixture-2026-10-05.sh": "93b401928fcfe15a84f1d4d178f2adbc7606ae75d062a221d6cda71e1a65f508",
  "reset-three-action-rehearsal-fixture-2026-10-05.json": "9bc64110c087c9d96a36a2a7c79fbfd05a36a2a212d52ba064ca43469b13876f",
  "preflight-three-action-rehearsal-2026-10-05.sh": "e0e2b9374d1c1bf2e6a8d5902a5967dd979941333cc7627dc2487373c77fb602",
  "preflight-three-action-rehearsal-2026-10-05.json": "9fbca8d13062673f2fab9d5e5a1a7f70fa9d235c67d438a9c505ea236e6bf69a",
  "grant-production-three-action-rehearsal-2026-10-05.sh": "7d89254b6b1b595c686ba56f5915858c639d80702eac8cc5ccbc506932000517",
  "grant-production-three-action-rehearsal-2026-10-05.json": "bc74cbe0ed69f4144fe3d06c2c2f22f8fd12c6b9cbb984c191f55d6b83d71436",
  "restore-terminal-off-three-action-rehearsal-2026-10-05.sh": "f3d07d36a604fc6d449cbecd1af3d745c42543f9e83a514eaadac09196ed5e9c",
  "restore-terminal-off-three-action-rehearsal-2026-10-05.json": "0fb6a791d0191f4ade46ec0eae0a7edd1dcfb1920b5f2c999314bafde9a00f3c",
  "preflight-three-action-rehearsal-2026-10-04.sh": "fef9f7f605943a63593a3f6ecf4d75ddfda1850c2b4319d88d433f363842ae79",
  "preflight-three-action-rehearsal-2026-10-04.json": "58587656c668e0b31417b487d0032c88d5de30e19a30416df9038c03bc3556b7",
  "grant-production-three-action-rehearsal-2026-10-04.sh": "591dec1c69a64fc12bf98e5c2013bfa1f8fc0655f2017436502c1b817eb623a9",
  "grant-production-three-action-rehearsal-2026-10-04.json": "e4a5c665c7cfd79a1a7b794225ff67dd3d4fc88b4a021617371fe169c5672f27",
  "restore-terminal-off-three-action-rehearsal-2026-10-04.sh": "816fa853d029694811a9af620b22ef322b375f212a4baf7539bac9f93821a2aa",
  "restore-terminal-off-three-action-rehearsal-2026-10-04.json": "89bcabc5122df1173ccf2557d14e56f99490231d9ded48ebcab0d66678d9fe85"
};

describe("run-3 operator pairs: contract and static safety", () => {
  it.each(PAIRS)("%s passes the library contract, describes itself, and rejects any other entrypoint", (id) => {
    const descriptor = descriptorOf(id);
    expect(() => validateOperatorScriptContract(descriptor, id, source(id))).not.toThrow();
    expect(descriptor.id).toBe(id);
    expect(id).toMatch(/-run3-2026-10-05$/);
    const box = sandboxFor([id]);
    const described = box.run(id, {}, ["--describe"]);
    expect(described.status).toBe(0);
    expect(JSON.parse(described.stdout)).toEqual(descriptor);
    expect(box.run(id, {}, ["apply"]).status).toBe(2);
    expect(box.runDirs()).toEqual([]);
  });

  it.each(PAIRS)("%s contains no raw kill, recursive delete, repository delete, force push, history rewrite, pull-request write or exported workspace", (id) => {
    const text = source(id);
    for (const pattern of [/\bkill\b/, /\bpkill\b/, /rm -rf/, /gh repo delete/, /--force\b/, /push\s+(-\S+\s+)*-f\b/, /\+refs\//, /reset --hard/, /worktree remove/, /branch -D/, /production reactivate/, /gh pr (merge|close|edit|comment|ready)/, /rebase/, /export ARCADIA_WORKSPACE/, /--disposition accepted/]) {
      expect(text, `${id} must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it("leaves every run-1 and run-2 pair byte-unchanged", () => {
    for (const [file, expected] of Object.entries(EARLIER_PAIR_SHA256)) expect(sha256(path.join(library, file)), file).toBe(expected);
  });

  it("only the run-3 G7 previews or activates production; the reset and G6 never turn anything Off", () => {
    for (const id of [RESET, G6]) expect(source(id)).not.toMatch(/production (preview|activate|deactivate)/);
    expect(source(G8)).not.toMatch(/production (preview|activate)/);
  });

  it("the reset is one-shot, pushes only fixture main without force, and validates, then settles, before its only commit and push", () => {
    const descriptor = descriptorOf(RESET);
    expect(descriptor.repeatable).toBe(false);
    expect(descriptor.kind).toBeUndefined();
    const text = source(RESET);
    const pushes = text.split("\n").filter((line) => /(\bgit\b|\bfx\b).*\bpush\b/.test(line) && !line.trim().startsWith("#") && !line.includes("echo") && !/refuse "/.test(line));
    expect(pushes).toEqual(['  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main']);
    expect(text).not.toMatch(/\bfx\s+push\b/);
    const order = ['< "$RUN_DIR/validate-amendment.mjs"', '< "$RUN_DIR/probe-lineage.mjs"', '< "$RUN_DIR/probe-live-sync.mjs"', "read_gate() {", "PREVIEW=\"$(settle_run2)\"", 'settle_run2 --apply --preview "$SUPERSEDE_FINGERPRINT"', "commit -q -m", "push -q origin", "arcadia docs sync"];
    const at = order.map((marker) => text.indexOf(marker));
    expect(at.every((index) => index > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("the reset settles only run 2's declared proposal, rejected, with ARCADIA_WORKSPACE inline on that one command", () => {
    const text = source(RESET);
    expect(descriptorOf(RESET).agentAsk).toEqual({ proposal: RUN2_PROPOSAL, intent: "complete", targetRef: "action/write-start-marker" });
    expect(RUN2_PROPOSAL).toBe("complete-write-start-marker-2026-10-05");
    const settleLines = text.split("\n").filter((line) => line.includes("agent-ask settle"));
    expect(settleLines).toEqual([
      '  (cd "$ARCADIA_REPO" && ARCADIA_WORKSPACE="$WORKSPACE" timeout 180 mise exec -- pnpm -s arcadia agent-ask settle --proposal "$RUN2_PROPOSAL_ID" --request-id "$SUPERSEDE_REQUEST_ID" --disposition rejected "$@" --json)'
    ]);
    expect(text.split("\n").filter((line) => /\bsettle_run2\b/.test(line) && !line.includes("settle_run2() {")).map((line) => line.trim())).toEqual([
      'PREVIEW="$(settle_run2)" || PREVIEW=""',
      'APPLIED="$(settle_run2 --apply --preview "$SUPERSEDE_FINGERPRINT")" || APPLIED=""'
    ]);
    expect(text.match(/ARCADIA_WORKSPACE=/g)).toHaveLength(1);
  });

  it("the reset's third next_action is the original sentence with a run-3 note, distinct from run 2's", () => {
    expect(OLD_LINE).toBe(RUN2_LINE);
    expect(NEW_LINE).not.toBe(ORIGINAL_LINE);
    expect(NEW_LINE).not.toBe(RUN2_LINE);
    expect(NEW_LINE.startsWith(ORIGINAL_LINE.slice(0, -1))).toBe(true);
    expect(NEW_LINE.slice(ORIGINAL_LINE.length - 1)).toBe(" (rehearsal run 3, from the run-2 reset fixture main; the run 1 and run 2 attempts and candidates stay as evidence).");
  });

  it("the run-3 G7 is the run-2 G7 line for line except its ids, binding, run-3 wording and the fuller #925 citation", () => {
    const normalize = (text: string) => text
      .replace(/^# G7 for rehearsal run \d:[\s\S]*?(?=# current policy revision)/m, "")
      .replace(/-run3-2026-10-05/g, "-2026-10-05")
      .replace(/^# Run 2's reset head: the run-3 reset commit's only parent\.\nRUN2_HEAD="[0-9a-f]{40}"\n/m, "")
      .replace(/^# The run-[23] fixture head:[\s\S]*?\nRESET_RECEIPT=""/m, "RESET_RECEIPT=\"\"")
      .replace(/^jq -e --arg head "\$FIXTURE_HEAD"[\s\S]*?\|\| refuse "the fixture is not exactly one reset commit on [^\n]*\n/m, "<FIXTURE BINDING>\n")
      .replace(/ and the operator's chat confirmations of 2026-10-05; that answer created no Decision/g, "")
      .replace(/ and the\noperator's chat confirmations of 2026-10-05; that answer created no Decision/g, "")
      .replace(/run-3 reset head \$FIXTURE_HEAD on run 2's reset head \$RUN2_HEAD and genesis/, "reset head $FIXTURE_HEAD on genesis")
      .replace(/\), from the\nTerminal panel or \/runs, for terminal Off\./, ") for terminal Off.").replace(/ from the Terminal panel or \/runs/g, "")
      .replace(/run-3 reset fixture head/g, "reset fixture head").replace(/run 3/g, "run 2").replace(/run-3/g, "run-2");
    const run2 = normalize(source(RUN2_G7));
    const run3 = normalize(source(G7));
    expect(run3).toBe(run2);
    // The binding itself: run 2's reset head is the only parent, genesis its parent.
    const text = source(G7);
    expect(text).toContain(".previousMain == $run2 and .genesis == $root and .remoteMainAfter == .newHead");
    expect(text).toContain('"$(git -C "$FIXTURE_REPO" rev-parse HEAD^)" == "$RUN2_HEAD"');
    expect(text).toContain('"$(git -C "$FIXTURE_REPO" rev-list --count HEAD)" == 3');
    expect(text).toContain(".arcadiaHead == $head and .brokerRevision == $broker");
  });

  it("the run-3 G7 keeps every G7 safety property under a new request id, with the #925 acknowledgement on the /runs card and the next_after hint", () => {
    const text = source(G7);
    expect(text).toContain(`SCRIPT_ID="${G7}"`);
    expect(text).toContain(`PREFLIGHT_ID="${G6}"`);
    expect(text).toContain(`RESET_ID="${RESET}"`);
    const activate = text.indexOf("arcadia production activate");
    expect(text.split("arcadia production activate").length).toBe(2);
    expect(text.split("arcadia production preview").length).toBe(3);
    for (const before of ["rehearsal-three-action.test.ts", "PREFLIGHT_ID", "RESET_ID", "arcadia production preview", "scopeFingerprint"]) {
      expect(text.indexOf(before)).toBeGreaterThan(-1);
      expect(text.indexOf(before)).toBeLessThan(activate);
    }
    for (const flag of ["--remote-preservation", "--concurrency 1", '--packet-approval-expires-at "$EXPIRES"', '--integration-grant-decision "$INTEGRATION_DECISION"', '--expected-revision "$REVISION"', '--request-id "$SCRIPT_ID"']) {
      expect(text).toContain(flag);
    }
    expect(text.match(/--integration-grant-action "\$PROJECT\/\$ACTION_[ABC]"/g)).toHaveLength(3);
    expect(text).toContain("GRANT_HOURS=12");
    expect(text).toContain("PREFLIGHT_MAX_AGE_SECONDS=1800");
    const descriptor = descriptorOf(G7);
    expect(descriptor).toMatchObject({ kind: "grant", repeatable: false });
    expect(descriptor.title).toContain("#925");
    expect(descriptor.desired_effect).toMatch(/^Pressing accepts Decision 0058 for these three fixture Actions only \(#925, answered yes in Log operator-answers-rehearsal-run2-2026-10-05 \(commit 133e503dc, clarified by 49b1342a8\) and the operator's chat confirmations of 2026-10-05\): readying the PR, pushing the settled head and reviewer-model spend/);
    expect(descriptor.problem).toMatch(/^OPERATOR ACKNOWLEDGEMENT REQUIRED BEFORE PRESSING .*issues\/925/);
    expect(descriptor.problem).toContain("that answer created no Decision");
    expect(descriptor.authority.does[0]).toContain("#925");
    expect(descriptor.authority.does.join(" ")).toContain("SIGKILL");
    expect(descriptor.authority.never_does.join(" ")).toMatch(/GitHub merge.*base branch/);
    // Exactly the shape the run-2 G7 carries, with the run-3 ids and every G8.
    expect(Object.keys(descriptor.next_after)).toEqual(Object.keys(descriptorOf(RUN2_G7).next_after));
    expect(descriptor.next_after).toEqual({
      id: G6,
      within_minutes: 30,
      voided_by: [G8, RUN2_G8, RUN1_G8, "recover-arcadia-host-services", "reinstall-go-broker", RESET],
      when_production: "inactive"
    });
  });

  it("the run-3 G6 keeps every run-2 check and adds the read-only dispatch-gate check", () => {
    const run2 = source(RUN2_G6);
    const run3 = source(G6);
    const checks = (text: string) => [...new Set([...text.matchAll(/check ([a-z_]+) (?:pass|refuse)/g)].map((m) => m[1]))];
    expect(checks(run3)).toEqual([...checks(run2).slice(0, checks(run2).indexOf("fixture_leases") + 1), "operator_gate", ...checks(run2).slice(checks(run2).indexOf("fixture_leases") + 1)]);
    for (const line of ["installed_release pass", 'REQUIRED_COMMITS="9a9db5e8bfe7b35d0b312fc2f763cc80c2db25f1 0b3686013f0a924c35d58dc7a09c979f1a994c7e"', "CHECK_WAIT_SECONDS=300", 'RUNTIME_PATHS="src scripts apps package.json pnpm-lock.yaml tsconfig.json"']) {
      expect(run3).toContain(line);
    }
    expect(run3).not.toMatch(/agent[-_]ask/);
  });
});

describe("the run-3 reset refuses unsafe input and unsafe state before any settle, commit or push", () => {
  it("refuses without the operator-supplied repository before any call", () => {
    const box = sandboxFor([RESET]);
    expect(box.run(RESET).status).not.toBe(0);
    const { dir, json } = box.receipt(RESET);
    expect(json).toMatchObject({ id: RESET, outcome: "refused", stage: "parameters", productionPreviewedOrActivated: false, grantsTouched: false, fixtureCommitted: false, githubRepositoryChanged: false, proposalSettledByThisRun: false });
    expect(json.reason).toContain("ARCADIA_REHEARSAL_GITHUB_REPO is required");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("This run made no fixture commit and no push.");
    expect(box.calls()).toBe("");
  });

  const cases: Array<[string, (box: Box, state: After) => Record<string, string> | void, string, string]> = [
    ["production is Active", (box) => box.patchReplies({ "arcadia production status": status("active") }), "preflight", "must be readable, Inactive and have zero live admissions"],
    ["the workspace is exported", () => ({ ARCADIA_WORKSPACE: "/w/martianrover" }), "preflight", "unset ARCADIA_WORKSPACE"],
    ["the descriptor declares another proposal", (box) => {
      const file = path.join(box.scripts, `${RESET}.json`);
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), agentAsk: { proposal: "complete-write-start-marker-2026-10-04", intent: "complete", targetRef: "action/write-start-marker" } }));
    }, "preflight", "does not declare exactly the proposal"],
    ["run 2's terminal Off is not proven (a later G8 refused past its launch guard)", (box) => {
      writeReceipt(box, "20261005T170000Z-2", { id: RUN2_G8, runId: "20261005T170000Z-2", outcome: "refused", stage: "drain", offState: "confirmed" });
    }, "prior_evidence", "terminal Off is not proven"],
    ["the only run-2 G8 success predates run 2's terminal Off", (box) => {
      rmSync(path.join(box.scripts, "runs", "20261005T160050Z-46759"), { recursive: true });
      writeReceipt(box, "20261005T140000Z-3", { id: RUN2_G8, runId: "20261005T140000Z-3", outcome: "succeeded", stage: "complete", offState: "confirmed" });
    }, "prior_evidence", "terminal Off is not proven"],
    ["run 2's reset receipt is missing", (box) => { rmSync(path.join(box.scripts, "runs", "20261005T153000Z-1"), { recursive: true }); }, "prior_evidence", "run 2's reset is not recorded"],
    ["run 2's reset receipt names another head", (box, state) => {
      writeReceipt(box, "20261005T154000Z-4", { id: RUN2_RESET, outcome: "succeeded", githubRepository: REPO, previousMain: state.genesis, newHead: "1".repeat(40), remoteMainAfter: "1".repeat(40) });
    }, "prior_evidence", "run 2's reset is not recorded"],
    ["the fixture is dirty", (box) => { writeFileSync(path.join(box.fixture, "stray.txt"), "x\n"); }, "local_fixture", "dirty or has untracked files"],
    ["the Project is registered from another path", (box, state) => { runProjectMetadataCommand({ workspace: box.workspace, projectId: state.projectId, repoPath: "/elsewhere/fixture" }); }, "registration", "is not registered from"],
    ["the repository lacks G1's description", (box) => box.patchReplies({ [`gh repo view ${REPO}`]: { stdout: JSON.stringify({ visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, description: "someone else's" }) } }), "github_repository", "G1 did not create it"],
    ["pull request #1 moved off run 1's tip", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/pulls/1`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN1_BRANCH, sha: state.genesis } }) } }), "candidates", "pull request #1 is not run 1's candidate"],
    ["pull request #2 moved off run 2's tip", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/pulls/2`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN2_BRANCH, sha: state.run2Marker } }) } }), "candidates", "pull request #2 is not run 2's candidate"],
    ["run 2's GitHub branch moved", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/branches/${RUN2_BRANCH}`]: { stdout: `${state.run2Marker}\n` } }), "candidates", "GitHub branch claude/write-start-marker-20261005T155147519Z"],
    ["run 2's local branch moved", (box) => {
      git(box.fixture, ["checkout", "-q", RUN2_BRANCH]);
      writeFileSync(path.join(box.fixture, "MORE.md"), "more\n");
      commitAll(box.fixture, "more");
      git(box.fixture, ["checkout", "-q", "main"]);
    }, "candidates", "local branch claude/write-start-marker-20261005T155147519Z"],
    ["the amended input already has an attempt", (box) => {
      const amended = path.join(temp("arcadia-run3-amended-"), "fixture");
      mkdirSync(amended, { recursive: true });
      renderG1Fixture(amended);
      writeFileSync(path.join(amended, PLAN_FILE), readFileSync(path.join(amended, PLAN_FILE), "utf8").replace(ORIGINAL_LINE, NEW_LINE));
      withDatabase(box.workspace, (db) => beginDevelopmentAttempt(db, { requirement: identityOf(amended), requestId: "worker-tick-early-run-3", retryAuthorized: true, now: new Date() }));
    }, "lineage", "attempts already exist for the amended requirement input"],
    ["run 2's passing Session is still running", (box) => box.patchReplies({ "probe lineage": { stdout: JSON.stringify({ attempts: [], holders: [{ input: "run2", sessionId: "s2", status: "running", worktree: null, preserved: true }] }) } }), "lineage", "could not dispatch past it"],
    ["fixture main is back at genesis", (box, state) => {
      git(box.fixture, ["update-ref", "refs/heads/main", state.genesis]);
      git(box.fixture, ["reset", "-q", "--hard", state.genesis]);
    }, "fixture_state", "are not at run 2's reset head"]
  ];
  it.each(cases)("refuses when %s, with no settle, commit, push or docs sync", (_label, arrange, stage, reason) => {
    const { box, ...state } = resetBox();
    const env = arrange(box, state) ?? {};
    expect(box.run(RESET, { ...resetEnv, ...env }).status).not.toBe(0);
    const { dir, json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage, fixtureCommitted: false, githubRepositoryChanged: false, proposalSettledByThisRun: false, productionPreviewedOrActivated: false });
    expect(json.reason).toContain(reason);
    expect(existsSync(path.join(dir, "failure-handoff.md"))).toBe(true);
    expect(settleCalls(box)).toHaveLength(0);
    expect(unsettled(box)).toEqual([RUN2_PROPOSAL]);
    expect(box.pushes()).toEqual([]);
    expect(arcadiaCalls(box, "docs", "sync")).toHaveLength(0);
    if (stage !== "local_fixture" && stage !== "fixture_state") noMutation(box, state.run2Head);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)|"pr",|"pulls\/[12]","-X"/);
  });

  it("refuses a reset date before the Plan's own updated: date with the clock remedy", () => {
    const { box, run2Head } = resetBox();
    box.rebind(RESET, [['RESET_DATE="$(date -u +%F)"', 'RESET_DATE="2026-10-04"']]);
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "render_amendment", planUpdatedBefore: "2026-10-05" });
    expect(json.reason).toContain("before the Plan's updated: 2026-10-05");
    expect(json.recovery).toContain("Correct the host clock, or rerun on or after 2026-10-05 UTC");
    expect(settleCalls(box)).toHaveLength(0);
    noMutation(box, run2Head);
  });

  it("refuses an amendment Arcadia's discovery rejects, settling, committing and pushing nothing", () => {
    const { box, run2Head } = resetBox();
    box.rebind(RESET, [[/^NEW_NEXT_ACTION='.*'$/m, `NEW_NEXT_ACTION='    next_action: Implement MARKER.md: broken for run 3.'`]]);
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "validate_amendment" });
    expect(json.reason).toContain("nothing was settled, committed or pushed");
    expect(settleCalls(box)).toHaveLength(0);
    noMutation(box, run2Head);
    expect(discoverDocs(box.checkout).docs.map((doc) => doc.relativePath)).toEqual(["PROJECT.md"]);
  });

  it("refuses an amendment back to run 2's or the original text, which would not give a third input revision", () => {
    for (const [text, stage, reason] of [
      [ORIGINAL_LINE, "validate_amendment", "did not give write-start-marker a third requirement input revision"],
      // Run 2's own text: only the (later) date would change.
      [RUN2_LINE, "validate_amendment", "did not give write-start-marker a third requirement input revision"]
    ]) {
      const { box, run2Head } = resetBox();
      box.rebind(RESET, [[/^NEW_NEXT_ACTION='.*'$/m, `NEW_NEXT_ACTION='${text}'`], ['RESET_DATE="$(date -u +%F)"', 'RESET_DATE="2099-01-01"']]);
      expect(box.run(RESET, resetEnv).status).not.toBe(0);
      const { json } = box.receipt(RESET);
      expect(json.stage).toBe(stage);
      expect(json.reason).toContain(reason);
      expect(settleCalls(box)).toHaveLength(0);
      noMutation(box, run2Head);
    }
  });
});

describe("the run-3 reset closes Issue #968 by rejecting exactly run 2's pending proposal", () => {
  it("refuses any other pending fixture proposal, settling nothing, even run 2's", () => {
    const { box, run2Head, run1Tip } = resetBox();
    seedProposal(box, completeAsk("complete-write-start-marker-2026-10-04", run1Tip));
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { dir, json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "proposal_gate", proposalSettledByThisRun: false });
    expect(json.reason).toContain("complete-write-start-marker-2026-10-04");
    expect(json.recovery).toContain("This script settles none of them");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("No Agent Ask proposal other than complete-write-start-marker-2026-10-05 was settled.");
    expect(settleCalls(box)).toHaveLength(0);
    expect(unsettled(box).sort()).toEqual(["complete-write-start-marker-2026-10-04", RUN2_PROPOSAL]);
    noMutation(box, run2Head);
  });

  it("refuses a proposal under run 2's request id that differs from the declared scope, untouched", () => {
    const { box, run2Head, run2Marker } = resetBox({ pendingRun2Proposal: false });
    seedProposal(box, completeAsk(RUN2_PROPOSAL, run2Marker, { target_ref: "plan/autonomous-three-action-rehearsal#write-start-marker" }));
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "proposal_gate" });
    expect(json.reason).toContain("is not run 2's complete Ask as this action declares it");
    expect(settleCalls(box)).toHaveLength(0);
    expect(unsettled(box)).toEqual([RUN2_PROPOSAL]);
    noMutation(box, run2Head);
  });

  it("refuses a rejection preview that would write a document, never applying it", () => {
    const { box, run2Head } = resetBox();
    box.patchReplies({ "arcadia agent-ask settle": ok({ receipt: { applied: false, disposition: "rejected", proposalId: "x", proposalRequestId: RUN2_PROPOSAL, settlementRequestId: SUPERSEDE_REQUEST_ID, previewFingerprint: "a".repeat(64), queueActionKeys: [], review: { documents: [{ path: ".arcadia/asks/x.yaml" }] } } }) });
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "supersede_proposal", proposalSettledByThisRun: false });
    expect(json.reason).toContain("document-free, queue-free rejection");
    expect(settleCalls(box)).toHaveLength(1);
    expect(settleCalls(box)[0].args).not.toContain("--apply");
    expect(unsettled(box)).toEqual([RUN2_PROPOSAL]);
    noMutation(box, run2Head);
  });

  it("records the preview fingerprint when the apply does not land, then a rerun previews afresh and completes", () => {
    const { box, run2Head } = resetBox();
    box.patchReplies({ "arcadia agent-ask settle": [{ passthrough: "cli" }, { status: 1, stdout: JSON.stringify({ ok: false }) }, { passthrough: "cli" }] });
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const first = box.receipt(RESET);
    expect(first.json).toMatchObject({ outcome: "refused", stage: "supersede_proposal", proposalSettledByThisRun: false, fixtureCommitted: false, githubRepositoryChanged: false });
    expect(first.json.supersedePreviewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path.join(first.dir, "failure-handoff.md"), "utf8")).toContain(`did not confirm the apply`);
    expect(unsettled(box)).toEqual([RUN2_PROPOSAL]);
    noMutation(box, run2Head);
    box.patchReplies({ "arcadia agent-ask settle": { passthrough: "cli" } });
    const second = box.run(RESET, resetEnv);
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", proposalSettledByThisRun: true, supersededProposal: { state: "superseded", settlementRequestId: SUPERSEDE_REQUEST_ID } });
    expect(settlementOf(box, RUN2_PROPOSAL)).toEqual({ settlementRequestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" });
  });

  it("reads a landed rejection back when the apply's output is lost", () => {
    const { box } = resetBox();
    box.patchReplies({ "arcadia agent-ask settle": [{ passthrough: "cli" }, { passthrough: "cli", discardOutput: true }] });
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", proposalSettledByThisRun: true, supersededProposal: { state: "superseded" } });
    expect(settlementOf(box, RUN2_PROPOSAL)).toEqual({ settlementRequestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" });
  });

  it("recognizes its own landed rejection on resume after a failed push, settling nothing twice", () => {
    const { box, run2Head } = resetBox();
    expect(box.run(RESET, { ...resetEnv, FAKE_PUSH_FAIL: "1" }).status).not.toBe(0);
    const first = box.receipt(RESET);
    expect(first.json).toMatchObject({ outcome: "refused", stage: "push", fixtureCommitted: true, proposalSettledByThisRun: true, resetState: "at_run2_head" });
    expect(readFileSync(path.join(first.dir, "failure-handoff.md"), "utf8")).toContain("Rerunning recognizes that rejection and does not settle again.");
    const head = git(box.fixture, ["rev-parse", "HEAD"]);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(run2Head);
    const settlesBefore = settleCalls(box).length;
    expect(settlesBefore).toBe(2);
    box.patchReplies({ [`gh api repos/${REPO}/commits/main`]: [{ stdout: `${run2Head}\n` }, { stdout: `${head}\n` }] });
    const second = box.run(RESET, resetEnv);
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({
      outcome: "succeeded", resetState: "committed_unpushed", newHead: head, fixtureCommitted: false, githubRepositoryChanged: true, proposalSettledByThisRun: false,
      supersededProposal: { requestId: RUN2_PROPOSAL, state: "already_superseded", settlementRequestId: SUPERSEDE_REQUEST_ID }
    });
    expect(settleCalls(box)).toHaveLength(settlesBefore);
    expect(box.pushes()).toHaveLength(2);
  });

  it("leaves a proposal already settled by someone else exactly as it is", () => {
    const { box } = resetBox();
    const fp = (runCli(box, ["agent-ask", "settle", "--proposal", RUN2_PROPOSAL, "--request-id", "operator-rejected-by-hand", "--disposition", "rejected", "--json"]).data.receipt.previewFingerprint) as string;
    runCli(box, ["agent-ask", "settle", "--proposal", RUN2_PROPOSAL, "--request-id", "operator-rejected-by-hand", "--disposition", "rejected", "--apply", "--preview", fp, "--json"]);
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", proposalSettledByThisRun: false, supersededProposal: { state: "settled_elsewhere", settlement: { requestId: "operator-rejected-by-hand", disposition: "rejected" } } });
    expect(settleCalls(box)).toHaveLength(0);
  });

  it("proceeds without settling anything when run 2's proposal is absent and nothing gates the fixture", () => {
    const { box } = resetBox({ pendingRun2Proposal: false });
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", supersededProposal: { state: "absent", proposalId: null, previewFingerprint: null } });
    expect(settleCalls(box)).toHaveLength(0);
  });
});

function runCli(box: Box, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VITEST;
  const run = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "src", "cli.ts"), ...args, "--workspace", box.workspace], { cwd: repoRoot, env, encoding: "utf8", timeout: 60_000 });
  expect(run.status, run.stderr + run.stdout).toBe(0);
  return JSON.parse(run.stdout);
}

describe("the run-3 reset commits one validated line on run 2's head, pushes it without force, syncs docs and records every tip", () => {
  it("resets exactly write-start-marker's next_action, rejects run 2's proposal first, leaves both candidates untouched, and refuses a second application", () => {
    const { box, run2Head, genesis, run1Tip, run2Tip, original, run2 } = resetBox();
    // A later run-2 G8 that refused at its launch guard ran nothing and does not void run 2's terminal Off.
    writeReceipt(box, "20261005T170500Z-9", { id: RUN2_G8, runId: "20261005T170500Z-9", outcome: "refused", stage: "launch_context", offState: "unknown" });
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = box.receipt(RESET);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    const amended = identityOf(box.fixture);
    const candidates = [
      { run: "run 1", branch: RUN1_BRANCH, localTip: run1Tip, remoteTip: run1Tip, pullRequest: 1, prTip: run1Tip, prState: "open" },
      { run: "run 2", branch: RUN2_BRANCH, localTip: run2Tip, remoteTip: run2Tip, pullRequest: 2, prTip: run2Tip, prState: "open" }
    ];
    expect(json).toMatchObject({
      outcome: "succeeded", stage: "complete", githubRepository: REPO, fixtureRoot: box.fixture, genesis, previousMain: run2Head, newHead: head, remoteMainAfter: head,
      candidatesBefore: candidates, candidatesAfter: candidates, resetState: "at_run2_head", fixtureCommitted: true, githubRepositoryChanged: true,
      proposalSettledByThisRun: true, productionPreviewedOrActivated: false, grantsTouched: false, planUpdatedBefore: "2026-10-05",
      supersededProposal: { requestId: RUN2_PROPOSAL, state: "superseded", settlementRequestId: SUPERSEDE_REQUEST_ID, settlement: { requestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" } },
      actionTextRevision: { field: "next_action", requirementId: original.requirementId, inputRevisionOriginal: original.inputRevision, inputRevisionBefore: run2.inputRevision, inputRevisionAfter: amended.inputRevision, criteriaFingerprint: original.criteriaFingerprint }
    });
    expect(json.supersededProposal.proposalId).toMatch(/^agentask_/);
    expect(json.supersededProposal.previewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([original.inputRevision, run2.inputRevision, amended.inputRevision]).size).toBe(3);
    expect(json.priorAttempts).toEqual([
      { input: "original", role: "development", ordinal: 1, status: "passed" },
      { input: "run2", role: "development", ordinal: 1, status: "passed" }
    ]);
    expect(json.priorHolders.map((h: { input: string; sessionId: string }) => [h.input, h.sessionId])).toEqual([["original", "session_run_1"], ["run2", "session_run_2"]]);
    // One commit on run 2's head touching only the Plan: write-start-marker's next_action (and the date only when the reset's UTC date is later).
    const today = new Date().toISOString().slice(0, 10);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(run2Head);
    expect(git(box.fixture, ["diff", "--name-only", run2Head, head])).toBe(PLAN_FILE);
    const changed = git(box.fixture, ["diff", "-U0", run2Head, head, "--", PLAN_FILE]).split("\n").filter((line) => /^[-+][^-+]/.test(line));
    expect(changed).toEqual([...(today === "2026-10-05" ? [] : ["-updated: 2026-10-05", `+updated: ${today}`]), `-${OLD_LINE}`, `+${NEW_LINE}`]);
    expect(json.planUpdated).toBe(today);
    expect(git(box.fixture, ["log", "-1", "--format=%an <%ae>%n%s"])).toBe("Arcadia Rehearsal Fixture <rehearsal@localhost>\nReset write-start-marker for three-Action rehearsal run 3");
    expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
    expect(git(box.fixture, ["rev-parse", `refs/heads/${RUN1_BRANCH}`])).toBe(run1Tip);
    expect(git(box.fixture, ["rev-parse", `refs/heads/${RUN2_BRANCH}`])).toBe(run2Tip);
    // One push, of fixture main only, never forced; validation, the live dry run and the governed rejection precede it.
    expect(box.pushes()).toHaveLength(1);
    expect(box.pushes()[0]).toMatch(/push -q origin refs\/heads\/main:refs\/heads\/main$/);
    const keys = box.keys();
    const order = ["probe amendment", "probe lineage", "probe live-sync", "probe proposal-gate", "arcadia agent-ask settle", "arcadia agent-ask settle --apply", "push", "arcadia docs sync"].map((key) => keys.indexOf(key));
    expect(order.every((index) => index > -1), JSON.stringify(keys)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The governed two-phase settle, rejected, of exactly that proposal row, with ARCADIA_WORKSPACE inline.
    const settles = settleCalls(box).map((c) => c.args.slice(c.args.indexOf("arcadia") + 1));
    expect(settles).toEqual([
      ["agent-ask", "settle", "--proposal", json.supersededProposal.proposalId, "--request-id", SUPERSEDE_REQUEST_ID, "--disposition", "rejected", "--json"],
      ["agent-ask", "settle", "--proposal", json.supersededProposal.proposalId, "--request-id", SUPERSEDE_REQUEST_ID, "--disposition", "rejected", "--apply", "--preview", json.supersededProposal.previewFingerprint, "--json"]
    ]);
    expect(box.envLog().map((e) => e.ARCADIA_WORKSPACE)).toEqual([box.workspace, box.workspace]);
    expect(settlementOf(box, RUN2_PROPOSAL)).toEqual({ settlementRequestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" });
    // The dispatch gate (the one resolveProjectTransition consults) no longer blocks the amended Action.
    const gate = withReadOnlyDatabase(box.workspace, (db) => resolveOperatorGate({ db, repoRoot: box.fixture, projectSlug: "three-action-rehearsal", selectedActionId: "write-start-marker" }));
    expect(gate.blocking).toEqual([]);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)/);
    // The live dry run and the real docs sync both applied the amendment as an update, not skipped as older.
    expect(JSON.parse(readFileSync(path.join(dir, "live-sync-preview.json"), "utf8")).liveDryRun.actions.find((a: { ref: string }) => a.ref.endsWith("#write-start-marker")).action).toBe("update");
    const changes = JSON.parse(readFileSync(path.join(dir, "docs-sync.json"), "utf8")).data.projects[0].changes as Array<{ entity: string; ref: string; action: string }>;
    expect(changes.filter((c) => c.entity === "action").map((c) => [c.ref.split("#")[1], c.action])).toEqual([["write-start-marker", "update"], ["transform-start-marker", "unchanged"], ["verify-final-rehearsal", "unchanged"]]);
    expect(discoverDocs(box.checkout).docs.map((doc) => doc.relativePath)).toEqual(["PROJECT.md"]);

    // Repeatable only in its refusing form: a second press refuses as already reset, before any proposal step.
    const again = box.run(RESET, resetEnv);
    expect(again.status).not.toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "refused", stage: "fixture_state", resetState: "already_reset", fixtureCommitted: false, githubRepositoryChanged: false, proposalSettledByThisRun: false });
    expect(settleCalls(box)).toHaveLength(2);
    expect(box.pushes()).toHaveLength(1);
  });

  it("matches the live fixture's recorded input revisions, so the pinned constants describe this exact Plan", () => {
    const { original, run2 } = resetBox();
    expect(original.inputRevision).toBe(constantOf(RESET, "ORIGINAL_REVISION"));
    expect(run2.inputRevision).toBe(constantOf(RESET, "RUN2_REVISION"));
    expect(original.inputRevision.slice(0, 12)).toBe("959a3b12c686");
    expect(run2.inputRevision.slice(0, 12)).toBe("7a8dd4f5960f");
  });
});

describe("docs sync applies a same-day Plan amendment and skips an older one", () => {
  it("proves the date rule the reset relies on, with the real docs sync", () => {
    const box = sandboxFor([]);
    const state = afterRun2(box, { pendingRun2Proposal: false });
    const file = path.join(box.fixture, PLAN_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    const sync = () => (runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true }).data as unknown as { projects: Array<{ changes: Array<{ entity: string; ref: string; action: string; reason?: string }> }> })
      .projects[0].changes.find((c) => c.entity === "action" && c.ref.endsWith("#write-start-marker"))!;
    // The record now carries today's date (the box synced it today).
    const base = readFileSync(file, "utf8").replace(/^updated: .*$/m, `updated: ${today}`);
    writeFileSync(file, base);
    sync();
    // An older Plan date is skipped as older than the record, with errorCount still 0.
    writeFileSync(file, base.replace(OLD_LINE, NEW_LINE).replace(`updated: ${today}`, `updated: ${yesterday}`));
    expect(sync()).toMatchObject({ action: "skipped" });
    expect(sync().reason).toContain("older than the record");
    // The same date as the record applies.
    writeFileSync(file, base.replace(OLD_LINE, NEW_LINE));
    expect(sync()).toMatchObject({ action: "update" });
    expect(state.run2Head).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// G6 and G7 for run 3 bind the run-3 reset head: one commit on run 2's reset
// head, itself one commit on genesis.

function run3Fixture(box: Box) {
  const fixture = box.fixture;
  mkdirSync(fixture, { recursive: true });
  writeFileSync(path.join(fixture, ".arcadia-three-action-rehearsal.json"), JSON.stringify({
    schema: "arcadia-three-action-rehearsal-fixture-v1", githubRepository: REPO, fixtureProject: "three-action-rehearsal",
    fixturePlan: "autonomous-three-action-rehearsal", actions: ACTIONS, provider: "claude-code-cli", agentProfile: "claude_build", validationCommand: "node scripts/check-rehearsal.mjs"
  }));
  git(fixture, ["init", "-q", "-b", "main"]);
  const genesis = commitAll(fixture, "genesis");
  writeFileSync(path.join(fixture, "PLAN.md"), "run 2\n");
  const run2Head = commitAll(fixture, "Reset write-start-marker for three-Action rehearsal run 2");
  writeFileSync(path.join(fixture, "PLAN.md"), "run 3\n");
  const head = commitAll(fixture, "Reset write-start-marker for three-Action rehearsal run 3");
  git(fixture, ["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-first-packet-approval"), "review_1\n");
  for (const id of [G6, G7].filter((id) => existsSync(path.join(box.scripts, `${id}.sh`)))) box.rebind(id, [[/^RUN2_HEAD="[0-9a-f]{40}"$/m, `RUN2_HEAD="${run2Head}"`]]);
  const resetReceipt = writeReceipt(box, "20261005T170000Z-3", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: fixture, genesis, previousMain: run2Head, newHead: head, remoteMainAfter: head });
  return { genesis, run2Head, head, resetReceipt };
}
const passingCapacity = { admitted: true, unattendedProof: true, freshness: "fresh", confidence: "observed", usagePolicy: "included", evidence: "real", availability: "available" };
function g6Replies(box: Box, head: string, fixtureHead: string): Replies {
  return {
    "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
    "arcadia production status": status("inactive"),
    "arcadia go-broker status": ok({ ready: true, revision: head, preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
    "arcadia worker status": { stdout: "Worker: running (PID 7)\n" },
    "probe leases": { stdout: JSON.stringify({ active: 0, fixtureActive: [] }) },
    "probe operator-gate": { stdout: JSON.stringify({ blocking: [] }) },
    "probe claude": { stdout: JSON.stringify({ verdict: "signed_in" }) },
    "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_planning"], codex: passingCapacity }) },
    "codex --version": { stdout: "codex 1.0\n" },
    "codex login status": { stdout: "Logged in using ChatGPT\n" },
    "gh auth status": { status: 0 },
    [`gh api repos/${REPO}`]: { stdout: JSON.stringify({ private: true, archived: false, fork: false, default_branch: "main", permissions: { push: true } }) },
    [`gh api repos/${REPO}/branches/main`]: { stdout: JSON.stringify({ commit: { sha: fixtureHead }, protected: false }) },
    [`gh api repos/${REPO}/commits/${fixtureHead}/check-runs`]: { stdout: JSON.stringify({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] }) }
  };
}
function g6Box(box = sandboxFor([G6])) {
  const head = git(box.checkout, ["rev-parse", "HEAD"]);
  box.rebind(G6, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`], [/^CHECK_WAIT_SECONDS=300$/m, "CHECK_WAIT_SECONDS=0"]]);
  return { box, head };
}
const checkOf = (box: Box, name: string) => box.receipt(G6).json.checks.find((c: { name: string }) => c.name === name);
const G6_CHECKS = [
  "arcadia_checkout", "remote_main", "installed_features", "workspace", "production_status", "installed_release", "host_transports", "worker",
  "reset_receipt", "fixture", "fixture_leases", "operator_gate", "claude_worker_token", "codex_reviewer_login", "codex_reviewer_profile", "codex_capacity", "github_auth", "github_repository", "github_checks"
];

describe("the run-3 G6 preflight binds the run-3 reset head and keeps every check", () => {
  it("passes and binds the fixture head and reset receipt, checking GitHub main and CI at that head", () => {
    const { box, head } = g6Box();
    const { genesis, head: fixtureHead, resetReceipt } = run3Fixture(box);
    box.setReplies(g6Replies(box, head, fixtureHead));
    const result = box.run(G6);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { json } = box.receipt(G6);
    expect(json.checks.filter((c: { status: string }) => c.status !== "pass")).toEqual([]);
    expect(json.checks.map((c: { name: string }) => c.name)).toEqual(G6_CHECKS);
    expect(json).toMatchObject({ outcome: "succeeded", arcadiaHead: head, brokerRevision: head, githubRepository: REPO, rootCommit: genesis, fixtureHead, resetReceipt, workspace: box.workspace, policyRevision: 33 });
    expect(box.calls()).toContain(`"repos/${REPO}/commits/${fixtureHead}/check-runs"`);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)/);
    expect(result.stdout).toContain(G7);
  });

  it.each([
    ["no run-3 reset receipt exists", (box: Box) => { rmSync(path.join(box.scripts, "runs", "20261005T170000Z-3"), { recursive: true }); }, "no succeeded reset-three-action-rehearsal-fixture-run3-2026-10-05 receipt"],
    ["only a run-2 reset receipt exists", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T170000Z-3", "receipt.json");
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), id: RUN2_RESET }));
    }, "no succeeded reset-three-action-rehearsal-fixture-run3-2026-10-05 receipt"],
    ["the only reset receipt names another repository", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T170000Z-3", "receipt.json");
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), githubRepository: "pmark/arcadia-three-action-rehearsal-other" }));
    }, "no succeeded reset"],
    ["the receipt's previous main is genesis, as a run-2 style reset would record", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T170000Z-3", "receipt.json");
      const json = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(file, JSON.stringify({ ...json, previousMain: json.genesis }));
    }, "does not match the fixture"],
    ["the fixture moved on past the reset head", (box: Box) => { writeFileSync(path.join(box.fixture, "MARKER.md"), "x\n"); commitAll(box.fixture, "later"); }, "does not match the fixture"],
    ["a newer succeeded reset receipt names another head", (box: Box) => {
      writeReceipt(box, "20261005T180000Z-4", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: box.fixture, genesis: "0".repeat(40), previousMain: "0".repeat(40), newHead: "1".repeat(40), remoteMainAfter: "1".repeat(40) });
    }, "does not match the fixture"]
  ])("refuses when %s", (_label, arrange, detail) => {
    const { box, head } = g6Box();
    const { head: fixtureHead } = run3Fixture(box);
    box.setReplies(g6Replies(box, head, fixtureHead));
    arrange(box);
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "reset_receipt")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "reset_receipt").detail).toContain(detail);
    expect(checkOf(box, "fixture")).toMatchObject({ status: "refuse" });
    expect(box.receipt(G6).json.outcome).toBe("refused");
  });

  it("refuses GitHub main at run 2's reset head rather than the run-3 head", () => {
    const { box, head } = g6Box();
    const { run2Head, head: fixtureHead } = run3Fixture(box);
    box.setReplies({ ...g6Replies(box, head, fixtureHead), [`gh api repos/${REPO}/branches/main`]: { stdout: JSON.stringify({ commit: { sha: run2Head }, protected: false }) } });
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "github_repository")).toMatchObject({ status: "refuse" });
  });

  it("keeps the earlier checks: a stale installed release, a paid reviewer login and unavailable capacity refuse", () => {
    const { box, head } = g6Box();
    const { head: fixtureHead } = run3Fixture(box);
    box.setReplies({
      ...g6Replies(box, head, fixtureHead),
      "arcadia go-broker status": ok({ ready: true, revision: "f".repeat(40), preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
      "codex login status": { stdout: "Logged in using an API key - sk-***\n" },
      "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_planning"], codex: { ...passingCapacity, availability: "usage_limited" } }) }
    });
    expect(box.run(G6).status).not.toBe(0);
    const verdicts = Object.fromEntries(box.receipt(G6).json.checks.map((c: { name: string; status: string }) => [c.name, c.status]));
    expect(verdicts).toMatchObject({ installed_release: "refuse", codex_reviewer_login: "refuse", codex_capacity: "refuse", reset_receipt: "pass", fixture: "pass", operator_gate: "pass" });
  });

  it("refuses, through the real dispatch gate, while a pending proposal names a fixture Action, and passes once nothing does", () => {
    const { box, head } = g6Box();
    const state = afterRun2(box);
    // The run-3 head on the real fixture, as the reset leaves it.
    writeFileSync(path.join(box.fixture, PLAN_FILE), readFileSync(path.join(box.fixture, PLAN_FILE), "utf8").replace(OLD_LINE, NEW_LINE));
    git(box.fixture, ["add", "-A"]);
    git(box.fixture, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-q", "-m", "Reset write-start-marker for three-Action rehearsal run 3"]);
    const fixtureHead = git(box.fixture, ["rev-parse", "HEAD"]);
    writeReceipt(box, "20261005T170000Z-3", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: box.fixture, genesis: state.genesis, previousMain: state.run2Head, newHead: fixtureHead, remoteMainAfter: fixtureHead });
    box.setReplies({ ...g6Replies(box, head, fixtureHead), "probe operator-gate": { passthrough: "probe" } });
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "operator_gate")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "operator_gate").detail).toContain('"action":"write-start-marker","kind":"agent_ask"');
    expect(unsettled(box)).toEqual([RUN2_PROPOSAL]);
    const fp = runCli(box, ["agent-ask", "settle", "--proposal", RUN2_PROPOSAL, "--request-id", "g6-test-reject", "--disposition", "rejected", "--json"]).data.receipt.previewFingerprint as string;
    runCli(box, ["agent-ask", "settle", "--proposal", RUN2_PROPOSAL, "--request-id", "g6-test-reject", "--disposition", "rejected", "--apply", "--preview", fp, "--json"]);
    const passed = box.run(G6);
    expect(passed.status, passed.stdout + passed.stderr).toBe(0);
    expect(checkOf(box, "operator_gate")).toMatchObject({ status: "pass" });
  });
});

function grantBox(previewScope: Record<string, unknown> = {}) {
  const box = sandboxFor([G7]);
  mkdirSync(path.join(box.checkout, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(box.checkout, "docs", "decisions", "0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"), "---\nstatus: approved\n---\n");
  const head = commitAll(box.checkout, "decision");
  git(box.checkout, ["push", "-q", "origin", "main"]);
  box.rebind(G7, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`]]);
  const { genesis, run2Head, head: fixtureHead, resetReceipt } = run3Fixture(box);
  const g6Receipt = writeReceipt(box, "20261005T171000Z-5", {
    id: G6, outcome: "succeeded", finishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), arcadiaHead: head, brokerRevision: head,
    githubRepository: REPO, rootCommit: genesis, fixtureHead, resetReceipt, workspace: box.workspace, policyRevision: 33
  });
  const actions = ACTIONS.map((a) => `three-action-rehearsal/${a}`);
  const scope = {
    projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions,
    providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"],
    remotePreservation: true, packetApprovalExpiresAt: "{{arg:--packet-approval-expires-at}}",
    integrationGrant: { decisionRef: "0058", expiresAt: "{{arg:--integration-grant-expires-at}}", actions }, ...previewScope
  };
  box.setReplies({
    "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
    "arcadia go-broker status": ok({ ready: true, revision: head, preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
    "arcadia production status": status("inactive"),
    "probe leases": { stdout: JSON.stringify({ active: 0, fixtureActive: [] }) },
    "node preflight": { stdout: "Hermetic three-Action rehearsal passed\n" },
    "arcadia production preview": ok({ preview: { expectedRevision: 33, scope, scopeFingerprint: "fp-1", unmatched: { projects: [], plans: [] } } }),
    "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 34, authority: { requestId: G7, scopeFingerprint: "fp-1" } } } }),
    "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } })
  });
  const env = { ARCADIA_OPERATOR_SCRIPT_ID: G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) };
  return { box, env, actions, head, genesis, run2Head, fixtureHead, resetReceipt, g6Receipt };
}
const g7Receipt = (box: Box) => box.receipt(G7);

describe("the run-3 G7 Grant binds the run-3 reset head and keeps every G7 safety property", () => {
  it("refuses outside the /runs launcher without any call", () => {
    const box = sandboxFor([G7]);
    expect(box.run(G7).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ id: G7, outcome: "refused", stage: "launch_context", activated: false });
    expect(box.calls()).toBe("");
  });

  it("refuses the run-2 G7's launch identity", () => {
    const box = sandboxFor([G7]);
    expect(box.run(G7, { ARCADIA_OPERATOR_SCRIPT_ID: RUN2_G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) }).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "launch_context" });
    expect(box.calls()).toBe("");
  });

  it("activates once under its own request id at the run-3 reset head after the replay and two identical previews", () => {
    const { box, env, actions, fixtureHead, genesis, run2Head, resetReceipt, g6Receipt } = grantBox();
    const result = box.run(G7, env);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = g7Receipt(box);
    expect(json).toMatchObject({ id: G7, outcome: "succeeded", activated: true, scopeFingerprint: "fp-1", policyRevisionBefore: 33, policyRevisionAfter: 34, githubRepository: REPO, rootCommit: genesis, fixtureHead, resetReceipt, preflightReceipt: g6Receipt });
    expect(json.authorizes).toContain(`at fixture head ${fixtureHead}`);
    expect(json.authorizes).toContain("operator-answers-rehearsal-run2-2026-10-05");
    expect(json.authorizes).toContain("the operator's chat confirmations of 2026-10-05; that answer created no Decision");
    const md = readFileSync(path.join(dir, "receipt.md"), "utf8");
    expect(md).toContain(`run-3 reset head ${fixtureHead} on run 2's reset head ${run2Head} and genesis ${genesis}`);
    expect(md).toContain("#925");
    expect(md).toContain(G8);
    const [activate] = arcadiaCalls(box, "production", "activate");
    expect(arcadiaCalls(box, "production", "activate")).toHaveLength(1);
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(2);
    const args = activate.args;
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--request-id")).toBe(G7);
    expect(value("--expected-revision")).toBe("33");
    expect(args).toContain("--remote-preservation");
    expect(value("--integration-grant-decision")).toBe("0058");
    expect(args.filter((_a, i) => args[i - 1] === "--integration-grant-action")).toEqual(actions);
    expect(args.filter((_a, i) => args[i - 1] === "--action")).toEqual(actions);
    const expiry = Date.parse(value("--packet-approval-expires-at"));
    expect(expiry - Date.now()).toBeGreaterThan(11 * 3600e3);
    expect(expiry - Date.now()).toBeLessThanOrEqual(12 * 3600e3);
    expect(value("--integration-grant-expires-at")).toBe(value("--packet-approval-expires-at"));
    expect(value("--intent")).toContain("rehearsal run 3");
    const order = parsedCalls(box).map((c) => (c.args[2] === "node" && !c.args.includes("tsx") ? "replay" : c.args.slice(5, 7).join(" ")));
    expect(order.indexOf("replay")).toBeLessThan(order.indexOf("production preview"));
  });

  it.each([
    ["fixtureHead", "1111111111111111111111111111111111111111"],
    ["resetReceipt", "/elsewhere/receipt.json"],
    ["rootCommit", "2222222222222222222222222222222222222222"],
    ["arcadiaHead", "3333333333333333333333333333333333333333"],
    ["brokerRevision", "4444444444444444444444444444444444444444"],
    ["workspace", "/elsewhere/martianrover"]
  ])("refuses a G6 receipt bound to a different %s before any replay or preview", (field, value) => {
    const { box, env, g6Receipt } = grantBox();
    writeFileSync(g6Receipt, JSON.stringify({ ...JSON.parse(readFileSync(g6Receipt, "utf8")), [field]: value }));
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json.reason).toContain("different main, release, workspace, fixture or reset head");
    expect(parsedCalls(box).some((c) => c.args[2] === "node" && !c.args.includes("tsx"))).toBe(false);
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(0);
  });

  it("refuses a G6 receipt from the run-2 preflight", () => {
    const { box, env, g6Receipt } = grantBox();
    writeFileSync(g6Receipt, JSON.stringify({ ...JSON.parse(readFileSync(g6Receipt, "utf8")), id: RUN2_G6 }));
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json.reason).toContain("no G6 preflight receipt exists");
  });

  it("refuses a stale G6 receipt", () => {
    const { box, env, g6Receipt } = grantBox();
    writeFileSync(g6Receipt, JSON.stringify({ ...JSON.parse(readFileSync(g6Receipt, "utf8")), finishedAt: new Date(Date.now() - 31 * 60e3).toISOString().replace(/\.\d{3}Z$/, "Z") }));
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json.reason).toMatch(/G6 preflight is \d+s old/);
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(0);
  });

  it("refuses a fixture that is not exactly the run-3 reset head on run 2's head, never previewing", () => {
    const { box, env } = grantBox();
    writeFileSync(path.join(box.fixture, "MARKER.md"), "x\n");
    commitAll(box.fixture, "later");
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "fixture", activated: false, offCleanup: "not_attempted" });
    expect(g7Receipt(box).json.reason).toContain("is not the run-3 reset head");
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(0);
  });

  it("refuses a reset receipt whose previous main is not run 2's reset head", () => {
    const { box, env, resetReceipt, genesis } = grantBox();
    writeFileSync(resetReceipt, JSON.stringify({ ...JSON.parse(readFileSync(resetReceipt, "utf8")), previousMain: genesis }));
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "fixture" });
  });

  it("refuses when its own request id is already recorded in production policy", () => {
    const { box, env } = grantBox();
    box.patchReplies({ "arcadia production status": ok({ read: { status: "ok", policy: { desiredState: "inactive", revision: 33, epoch: 3, authority: { requestId: G7 } } }, liveAdmissions: 0 }) });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json.reason).toContain("one-shot and is not reapplied");
    expect(arcadiaCalls(box, "production", "activate")).toHaveLength(0);
  });

  it("refuses when the fingerprint changes between the two previews", () => {
    const { box, env } = grantBox();
    const replies = JSON.parse(readFileSync(path.join(box.root, "replies.json"), "utf8"));
    const first = replies["arcadia production preview"];
    box.patchReplies({ "arcadia production preview": [first, { stdout: first.stdout.replace('"scopeFingerprint":"fp-1"', '"scopeFingerprint":"fp-2"') }] });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "preview_recheck", activated: false });
    expect(arcadiaCalls(box, "production", "activate")).toHaveLength(0);
  });

  it("refuses a preview whose scope is not exactly the three fixture Actions", () => {
    const { box, env } = grantBox({ actions: ["three-action-rehearsal/write-start-marker"] });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "preview", activated: false });
    expect(arcadiaCalls(box, "production", "activate")).toHaveLength(0);
  });

  it("returns only its own Grant to Off when the activated fingerprint differs", () => {
    const { box, env } = grantBox();
    box.patchReplies({
      "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 34, authority: { requestId: G7, scopeFingerprint: "fp-other" } } } }),
      "arcadia production status": [status("inactive"), status("inactive"), ok({ read: { status: "ok", policy: { desiredState: "active", revision: 34, epoch: 4, authority: { requestId: G7 } } }, liveAdmissions: 0 })]
    });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "activate", activated: true, offCleanup: "returned_off" });
    const [off] = arcadiaCalls(box, "production", "deactivate");
    expect(off.args[off.args.indexOf("--request-id") + 1]).toMatch(new RegExp(`^${G7}-.*-off$`));
  });

  it("never turns off another request's Active policy after a failed activate, and names the run-3 G8", () => {
    const { box, env } = grantBox();
    box.patchReplies({ "arcadia production activate": { status: 1 }, "arcadia production status": [status("inactive"), status("inactive"), status("active")] });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ offCleanup: "other_grant_active", activated: false });
    expect(arcadiaCalls(box, "production", "deactivate")).toHaveLength(0);
    expect(readFileSync(path.join(g7Receipt(box).dir, "failure-handoff.md"), "utf8")).toContain("run the run-3 G8");
  });
});

describe("run 3 end to end against fakes: the reset's receipt is the head G6 and G7 bind", () => {
  it("reset (rejecting run 2's proposal), then G6 binds the run-3 head with the gate clear, then G7 accepts that G6 receipt and activates", () => {
    const box = sandboxFor([RESET, G6, G7]);
    const state = afterRun2(box);
    box.setReplies(resetReplies(box, state));
    const reset = box.run(RESET, resetEnv);
    expect(reset.status, reset.stdout + reset.stderr).toBe(0);
    const { dir: resetDir, json: resetJson } = box.receipt(RESET);
    const fixtureHead = resetJson.newHead;
    expect(git(box.fixture, ["rev-parse", "HEAD"])).toBe(fixtureHead);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(state.run2Head);

    mkdirSync(path.join(box.checkout, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(box.checkout, "docs", "decisions", "0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"), "---\nstatus: approved\n---\n");
    const head = commitAll(box.checkout, "decision");
    git(box.checkout, ["push", "-q", "origin", "main"]);
    box.rebind(G6, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`], [/^CHECK_WAIT_SECONDS=300$/m, "CHECK_WAIT_SECONDS=0"]]);
    box.rebind(G7, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`]]);
    box.setReplies({ ...g6Replies(box, head, fixtureHead), "probe operator-gate": { passthrough: "probe" } });
    const g6 = box.run(G6);
    expect(g6.status, g6.stdout + g6.stderr).toBe(0);
    expect(box.receipt(G6).json).toMatchObject({ outcome: "succeeded", fixtureHead, rootCommit: state.genesis, resetReceipt: realpathSync(path.join(resetDir, "receipt.json")) });
    expect(checkOf(box, "operator_gate")).toMatchObject({ status: "pass" });

    const actions = ACTIONS.map((a) => `three-action-rehearsal/${a}`);
    box.patchReplies({
      "node preflight": { stdout: "Hermetic three-Action rehearsal passed\n" },
      "arcadia production preview": ok({ preview: { expectedRevision: 33, scopeFingerprint: "fp-1", unmatched: { projects: [], plans: [] }, scope: {
        projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions, providers: ["claude-code-cli"], maxConcurrentSessions: 1,
        mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"], remotePreservation: true, packetApprovalExpiresAt: "{{arg:--packet-approval-expires-at}}",
        integrationGrant: { decisionRef: "0058", expiresAt: "{{arg:--integration-grant-expires-at}}", actions } } } }),
      "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 34, authority: { requestId: G7, scopeFingerprint: "fp-1" } } } })
    });
    const g7 = box.run(G7, { ARCADIA_OPERATOR_SCRIPT_ID: G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) });
    expect(g7.status, g7.stdout + g7.stderr).toBe(0);
    expect(box.receipt(G7).json).toMatchObject({ outcome: "succeeded", activated: true, fixtureHead, resetReceipt: realpathSync(path.join(resetDir, "receipt.json")) });
  });
});

// ---------------------------------------------------------------------------
// The run-3 G8: the merged run-2 G8 with only its ownership widened to the
// run-3 G7 request id (run 2's and run 1's still accepted), exact fixture scope only.

const realRecover = {
  "recover-arcadia-host-services.sh": readFileSync(path.join(library, "recover-arcadia-host-services.sh"), "utf8"),
  "recover-arcadia-host-services.json": readFileSync(path.join(library, "recover-arcadia-host-services.json"), "utf8")
};
const REHEARSAL_ACTIONS = ACTIONS.map((a) => `three-action-rehearsal/${a}`);
const rehearsalActive = (requestId: string, actions = REHEARSAL_ACTIONS, plans = ["three-action-rehearsal/autonomous-three-action-rehearsal"]) => ok({
  read: { status: "ok", policy: { desiredState: "active", revision: 34, epoch: 4, authority: { requestId },
    scope: { projects: ["three-action-rehearsal"], plans, actions, providers: ["claude-code-cli"] } } },
  liveAdmissions: 0
});
const g8Env = (box: Box) => ({ ARCADIA_OPERATOR_SCRIPT_ID: G8, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G8}.json`) });
const quiet = { stdout: JSON.stringify({ active: [], fixtureSessions: [] }) };
function g8Box(withRecover = false) {
  const box = sandboxFor([G8]);
  if (withRecover) for (const [name, content] of Object.entries(realRecover)) writeFileSync(path.join(box.scripts, name), content, { mode: 0o755 });
  return box;
}

describe("the run-3 G8 owns only a rehearsal G7 policy with the exact fixture scope", () => {
  it("differs from the merged run-2 G8 only in its id and the request ids it owns, keeping its reconciliation and hash pins", () => {
    const run2 = source(RUN2_G8);
    const run3 = source(G8);
    const normalize = (text: string) => text
      .replace(/^# G8 for rehearsal run [23]:[\s\S]*?(?=# G8: restore and prove terminal Off)/m, "")
      .replace(/restore-terminal-off-three-action-rehearsal-(run3-)?2026-10-05/g, "<G8>")
      .replace(/^# G8 owns only .*\n/m, "").replace(/^GRANT_ID=.*\n(RUN2_GRANT_ID=.*\n)?(RUN1_GRANT_ID=.*\n)?/m, "")
      .replace(/ --arg run2 "\$RUN2_GRANT_ID"/, "").replace(/ --arg run1 "\$RUN1_GRANT_ID"/, "")
      .replace(/(, )?\$RUN2_GRANT_ID( or)?/g, "").replace(/ or \$RUN1_GRANT_ID/g, "").replace(/\$GRANT_ID,? \$RUN1_GRANT_ID/g, "$GRANT_ID")
      .replace(" or .data.read.policy.authority.requestId == $run2", "").replace(" or .data.read.policy.authority.requestId == $run1", "")
      .replace(/== G8 \(run [23]\): restore/, "== G8: restore");
    expect(normalize(run3)).toBe(normalize(run2));
    for (const pin of ["RECOVER_SCRIPT_SHA256", "RECOVER_DESCRIPTOR_SHA256", "RESTART_IMPL_SHA256"]) {
      const line = new RegExp(`^${pin}="[0-9a-f]{64}"$`, "m");
      expect(run3.match(line)?.[0]).toBe(run2.match(line)?.[0]);
    }
    expect(run3).toContain(`GRANT_ID="${G7}"`);
    expect(run3).toContain(`RUN2_GRANT_ID="${RUN2_G7}"`);
    expect(run3).toContain(`RUN1_GRANT_ID="${RUN1_G7}"`);
    expect(run3).toContain("classifyPreservedCandidate");
    expect(run3).not.toMatch(/services\.sh restart|launchctl|worker (stop|start)/);
    // The launch guard is the run-2 one, and the descriptor tells the operator where to run it.
    expect(run3).toContain('[[ -t 0 ]] || refuse "launch this action through /runs or from an interactive host terminal"');
    const descriptor = descriptorOf(G8);
    expect(descriptor.title).toContain("Terminal panel or /runs, never a non-interactive shell");
    expect(descriptor.problem).toContain("'launch this action through /runs or from an interactive host terminal'");
    expect(descriptor.authority.does[0]).toContain("Terminal panel");
  });

  it("refuses from a non-interactive shell outside the /runs launcher without any call", () => {
    const box = g8Box();
    expect(box.run(G8).status).not.toBe(0);
    const { json } = box.receipt(G8);
    expect(json).toMatchObject({ id: G8, outcome: "refused", stage: "launch_context", restarted: false });
    expect(json.reason).toBe("launch this action through /runs or from an interactive host terminal");
    expect(box.calls()).toBe("");
  });

  it.each([
    ["an unrelated request id", rehearsalActive("some-other-grant")],
    ["the run-3 G7 request id with a narrower Action scope", rehearsalActive(G7, REHEARSAL_ACTIONS.slice(0, 2))],
    ["the run-3 G7 request id with another Plan", rehearsalActive(G7, REHEARSAL_ACTIONS, ["three-action-rehearsal/other-plan"])],
    ["the run-2 G7 request id with a narrower Action scope", rehearsalActive(RUN2_G7, REHEARSAL_ACTIONS.slice(1))],
    ["the run-1 G7 request id with a narrower Action scope", rehearsalActive(RUN1_G7, REHEARSAL_ACTIONS.slice(1))],
    ["a policy with no scope", status("active")]
  ])("refuses an Active policy under %s without deactivating it", (_label, active) => {
    const box = g8Box(true);
    box.setReplies({ "arcadia production status": active, "probe sessions": quiet });
    expect(box.run(G8, g8Env(box)).status).not.toBe(0);
    const { dir, json } = box.receipt(G8);
    expect(json).toMatchObject({ outcome: "refused", stage: "production_off", offState: "not_owned", restarted: false });
    expect(json.reason).toContain("G8 does not own it");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("G8 did NOT turn it Off");
    expect(box.calls()).not.toMatch(/deactivate/);
  });

  it.each([
    ["run 3's", G7],
    ["run 2's", RUN2_G7],
    ["run 1's", RUN1_G7]
  ])("turns %s exact G7 policy Off through deactivate first, before resolving the workspace", (_label, requestId) => {
    const box = g8Box();
    box.setReplies({
      "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
      "arcadia production status": [rehearsalActive(requestId), status("inactive")],
      "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }),
      "probe sessions": quiet
    });
    expect(box.run(G8, g8Env(box)).status).not.toBe(0);
    const { dir, json } = box.receipt(G8);
    // The library here has no recover pair, so it stops at the pinned restart path after a confirmed Off.
    expect(json).toMatchObject({ outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false });
    expect(readFileSync(path.join(dir, "intervention-ledger.jsonl"), "utf8")).toContain(`revoked active policy ${requestId}`);
    const verbs = parsedCalls(box).filter((c) => c.tool === "mise" && c.args[3] === "-s").map((c) => c.args.slice(5, 7).join(" "));
    expect(verbs.filter((v) => v === "production deactivate")).toHaveLength(1);
    expect(verbs.indexOf("production deactivate")).toBeLessThan(verbs.indexOf("workspace resolve"));
    const [off] = arcadiaCalls(box, "production", "deactivate");
    expect(off.args[off.args.indexOf("--request-id") + 1]).toMatch(new RegExp(`^${G8}-`));
  });

  it("refuses changed restart bytes after a quiet Inactive observation, without running them", () => {
    const box = g8Box();
    writeFileSync(path.join(box.scripts, "recover-arcadia-host-services.json"), realRecover["recover-arcadia-host-services.json"]);
    writeFileSync(path.join(box.scripts, "recover-arcadia-host-services.sh"), realRecover["recover-arcadia-host-services.sh"] + "# changed\n", { mode: 0o755 });
    box.setReplies({ "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }), "arcadia production status": status("inactive"), "probe sessions": quiet });
    expect(box.run(G8, g8Env(box)).status).not.toBe(0);
    expect(box.receipt(G8).json).toMatchObject({ outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false });
    expect(box.receipt(G8).json.reason).toContain("differs from its reviewed bytes");
  });
});
