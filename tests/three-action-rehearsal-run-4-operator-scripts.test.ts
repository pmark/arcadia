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
 * The run-4 operator pairs for the disposable three-Action rehearsal: the
 * fixture reset (which keeps run 3's Issue #968 handling, now for exactly run
 * 3's complete proposal), the run-4 G6 preflight, the run-4 G7 Grant and the
 * run-4 G8 terminal Off. Shaped like
 * tests/three-action-rehearsal-run-3-operator-scripts.test.ts: every
 * behavioral case runs a pair copied into a throwaway library with fake `mise`,
 * `gh`, `codex`, `timeout`, `sleep` and a `git` whose `push` is only recorded,
 * so no case reaches GitHub, production policy, a model, a service or the live
 * workspace. Arcadia's discovery, docs sync, requirementIdentity, the dispatch
 * gate, `agent-ask settle` and database reads run for real (passthrough)
 * against a throwaway workspace.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const RESET = "reset-three-action-rehearsal-fixture-run4-2026-10-05";
const G6 = "preflight-three-action-rehearsal-run4-2026-10-05";
const G7 = "grant-production-three-action-rehearsal-run4-2026-10-05";
const G8 = "restore-terminal-off-three-action-rehearsal-run4-2026-10-05";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const RUN3_RESET = "reset-three-action-rehearsal-fixture-run3-2026-10-05";
const RUN3_G6 = "preflight-three-action-rehearsal-run3-2026-10-05";
const RUN3_G7 = "grant-production-three-action-rehearsal-run3-2026-10-05";
const RUN3_G8 = "restore-terminal-off-three-action-rehearsal-run3-2026-10-05";
const RUN2_RESET = "reset-three-action-rehearsal-fixture-2026-10-05";
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
const RUN3_BRANCH = "claude/write-start-marker-20261005T184707757Z";
const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const ACTIONS = ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"];
const constantOf = (id: string, name: string) => {
  const match = source(id).match(new RegExp(`^${name}=(?:'([^']*)'|"([^"$]*)")$`, "m"));
  if (!match) throw new Error(`${id} has no literal ${name}`);
  return match[1] ?? match[2];
};
const ORIGINAL_LINE = constantOf(RUN2_RESET, "OLD_NEXT_ACTION");
const RUN2_LINE = constantOf(RUN2_RESET, "NEW_NEXT_ACTION");
const RUN3_LINE = constantOf(RUN3_RESET, "NEW_NEXT_ACTION");
const OLD_LINE = constantOf(RESET, "OLD_NEXT_ACTION");
const NEW_LINE = constantOf(RESET, "NEW_NEXT_ACTION");
const RUN2_PROPOSAL = constantOf(RUN3_RESET, "RUN2_PROPOSAL");
const RUN3_PROPOSAL = constantOf(RESET, "RUN3_PROPOSAL");
const RUN4_COMPLETION_ID = constantOf(RESET, "RUN4_COMPLETION_ID");
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
  const root = temp("arcadia-run4-pair-");
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
/** Run 3's reset as it landed on the live fixture (same day, so the date line is unchanged). */
const run3Plan = (plan: string) => plan.replace(RUN2_LINE, RUN3_LINE);

const completeAsk = (requestId: string, candidate: string, overrides: Record<string, unknown> = {}) => JSON.stringify({
  agent_ask: "v1", request_id: requestId, project: "three-action-rehearsal", intent: "complete", target_ref: "action/write-start-marker",
  candidate_revision: candidate, evidence: CRITERIA_A.map((criterion) => ({ criterion, status: "met" })), desired_result: "Mark write-start-marker complete.", ...overrides
});
const seedProposal = (box: Box, request: string) => runAgentAskPreviewCommand({ workspace: box.workspace, request }).data;
const unsettled = (box: Box) => withReadOnlyDatabase(box.workspace, (db) => listUnsettledAgentAskProposals(db)).map((row) => row.requestId);
const settlementOf = (box: Box, requestId: string) => withReadOnlyDatabase(box.workspace, (db) => db.prepare(
  "SELECT s.request_id AS settlementRequestId, s.disposition FROM agent_ask_settlements s JOIN agent_ask_proposals p ON p.id = s.proposal_id WHERE p.request_id = ?").get(requestId));

/**
 * The state the run-4 reset meets after run 3: G1's genesis registered in the
 * box workspace (real import, metadata and docs sync), run 1's candidate and
 * passed attempt, run 2's reset commit and candidate (marker and settlement
 * commits) and passed attempt, run 3's reset commit on run 2's and run 3's
 * candidate and passed attempt, the G1, run-3 reset and run-3 G8 receipts, and
 * run 3's pending complete proposal.
 */
function afterRun3(box: Box, options: { pendingRun3Proposal?: boolean } = {}) {
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
  const fixtureCommit = (message: string) => {
    git(fixture, ["add", "-A"]);
    git(fixture, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-q", "-m", message]);
    return git(fixture, ["rev-parse", "HEAD"]);
  };
  /** A preserved candidate on `branch`: the marker and its settlement commit under `proposal`. */
  const candidate = (branch: string, proposal: string) => {
    git(fixture, ["checkout", "-q", "-b", branch]);
    writeFileSync(path.join(fixture, "MARKER.md"), "three-action rehearsal start\n");
    const marker = commitAll(fixture, "Add MARKER.md with rehearsal start marker");
    mkdirSync(path.join(fixture, ".arcadia", "asks", "archive"), { recursive: true });
    writeFileSync(path.join(fixture, ".arcadia", "asks", "archive", `agent-ask-${proposal}.yaml`), completeAsk(proposal, marker) + "\n");
    const tip = commitAll(fixture, `chore(arcadia): settle ${proposal}`);
    git(fixture, ["checkout", "-q", "main"]);
    return { marker, tip };
  };
  // Run 2's reset on fixture main, byte-for-byte as the run-2 reset writes it, then its candidate.
  writeFileSync(path.join(fixture, PLAN_FILE), run2Plan(readFileSync(path.join(fixture, PLAN_FILE), "utf8")));
  const run2Head = fixtureCommit("Reset write-start-marker for three-Action rehearsal run 2");
  const run2 = identityOf(fixture);
  runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true });
  const { marker: run2Marker, tip: run2Tip } = candidate(RUN2_BRANCH, RUN2_PROPOSAL);
  // Run 3's reset on run 2's head, as the run-3 reset writes it on 2026-10-05, then its candidate.
  writeFileSync(path.join(fixture, PLAN_FILE), run3Plan(readFileSync(path.join(fixture, PLAN_FILE), "utf8")));
  const run3Head = fixtureCommit("Reset write-start-marker for three-Action rehearsal run 3");
  const run3 = identityOf(fixture);
  runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true });
  const { marker: run3Marker, tip: run3Tip } = candidate(RUN3_BRANCH, RUN3_PROPOSAL);
  for (const id of [RESET, G6, G7].filter((id) => existsSync(path.join(box.scripts, `${id}.sh`)))) {
    box.rebind(id, [[/^RUN2_HEAD="[0-9a-f]{40}"$/m, `RUN2_HEAD="${run2Head}"`], [/^RUN3_HEAD="[0-9a-f]{40}"$/m, `RUN3_HEAD="${run3Head}"`]]);
  }
  if (existsSync(path.join(box.scripts, `${RESET}.sh`))) {
    box.rebind(RESET, [[/^RUN1_TIP="[0-9a-f]{40}"$/m, `RUN1_TIP="${run1Tip}"`], [/^RUN2_TIP="[0-9a-f]{40}"$/m, `RUN2_TIP="${run2Tip}"`], [/^RUN3_TIP="[0-9a-f]{40}"$/m, `RUN3_TIP="${run3Tip}"`]]);
  }
  withDatabase(box.workspace, (db) => {
    const at = (iso: string) => new Date(iso);
    const pass = (requirement: typeof original, requestId: string, tip: string, sessionId: string, start: string, end: string) => {
      const attempt = beginDevelopmentAttempt(db, { requirement, requestId, retryAuthorized: true, now: at(start) }).attempt;
      recordSessionRoleAttemptTerminal(db, { requestId: attempt.request_id, actorId: attempt.actor_id, status: "passed", targetHead: tip, receipt: { sessionId }, now: at(end) });
    };
    pass(original, "worker-tick-run-1", run1Tip, "session_run_1", "2026-10-04T17:02:45.000Z", "2026-10-04T17:30:00.000Z");
    pass(run2, "worker-tick-run-2", run2Tip, "session_run_2", "2026-10-05T15:51:47.000Z", "2026-10-05T15:55:00.000Z");
    pass(run3, "worker-tick-run-3", run3Tip, "session_run_3", "2026-10-05T18:47:07.000Z", "2026-10-05T18:51:00.000Z");
  });
  writeReceipt(box, "20261004T165157Z-6269", { id: G1, outcome: "succeeded", githubRepository: REPO, rootCommit: genesis });
  const run3ResetReceipt = writeReceipt(box, "20261005T183648Z-77904", { id: RUN3_RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: fixture, genesis, previousMain: run2Head, newHead: run3Head, remoteMainAfter: run3Head });
  writeReceipt(box, "20261005T194025Z-26232", { id: RUN3_G8, runId: "20261005T194025Z-26232", outcome: "succeeded", stage: "complete", offState: "confirmed" });
  if (options.pendingRun3Proposal !== false) seedProposal(box, completeAsk(RUN3_PROPOSAL, run3Marker));
  return { genesis, run1Tip, run2Head, run2Marker, run2Tip, run3Head, run3Marker, run3Tip, projectId, original, run2, run3, run3ResetReceipt };
}
type After = ReturnType<typeof afterRun3>;
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
  [`gh api repos/${REPO}/pulls/2`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN2_BRANCH, sha: state.run2Tip } }) },
  [`gh api repos/${REPO}/branches/${RUN3_BRANCH}`]: { stdout: `${state.run3Tip}\n` },
  [`gh api repos/${REPO}/pulls/3`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN3_BRANCH, sha: state.run3Tip } }) }
});
function resetBox(options: { pendingRun3Proposal?: boolean } = {}) {
  const box = sandboxFor([RESET]);
  const state = afterRun3(box, options);
  box.setReplies(resetReplies(box, state));
  return { box, ...state };
}
const resetEnv = { ARCADIA_REHEARSAL_GITHUB_REPO: REPO };
const settleCalls = (box: Box) => arcadiaCalls(box, "agent-ask", "settle");
const noMutation = (box: Box, run3Head: string) => {
  expect(box.pushes()).toEqual([]);
  expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(run3Head);
  expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
  expect(arcadiaCalls(box, "docs", "sync")).toHaveLength(0);
};
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

// The run-1, run-2 and run-3 pairs, byte for byte as merged: retired from use for run 4, never edited.
const EARLIER_PAIR_SHA256: Record<string, string> = {
  "reset-three-action-rehearsal-fixture-run3-2026-10-05.sh": "403994d5ca64b9db418c47a87dc39b432c8fcc4262b4ba48f3d4dc5000cf73c8",
  "reset-three-action-rehearsal-fixture-run3-2026-10-05.json": "d3b0ebd39134f2cbe07eebaa893b554ef2c31440699d033cb12a254d24cc0ace",
  "preflight-three-action-rehearsal-run3-2026-10-05.sh": "9f5fdecd4ffc5ce13b7dd86abc9359f4b17fa2c8a27391aa3bb6ebc3567d279a",
  "preflight-three-action-rehearsal-run3-2026-10-05.json": "8bfdb1ba9af8faddba5bed73e20cb1ccee4d8b2e9ad662b027cef13bbe4f06d1",
  "grant-production-three-action-rehearsal-run3-2026-10-05.sh": "bcf8cf634fc07dfd6fe83eaa07c64bb2a74b526435da0e5162882667de893556",
  "grant-production-three-action-rehearsal-run3-2026-10-05.json": "4d96358195db04d75dffb04ed18213d7e87cf681b55c5290378761746d754bcb",
  "restore-terminal-off-three-action-rehearsal-run3-2026-10-05.sh": "d1863b223a9e58cfe1e4947ac435376c33f48cdcf5b9fd1f6869556a4be4c72f",
  "restore-terminal-off-three-action-rehearsal-run3-2026-10-05.json": "565716c5216303657d5f781f4929fc8794fccfc5335a4b033e61d1998518b571",
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

describe("run-4 operator pairs: contract and static safety", () => {
  it.each(PAIRS)("%s passes the library contract, describes itself, and rejects any other entrypoint", (id) => {
    const descriptor = descriptorOf(id);
    expect(() => validateOperatorScriptContract(descriptor, id, source(id))).not.toThrow();
    expect(descriptor.id).toBe(id);
    expect(id).toMatch(/-run4-2026-10-05$/);
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

  it("leaves every run-1, run-2 and run-3 pair byte-unchanged", () => {
    for (const [file, expected] of Object.entries(EARLIER_PAIR_SHA256)) expect(sha256(path.join(library, file)), file).toBe(expected);
  });

  it("only the run-4 G7 previews or activates production; the reset and G6 never turn anything Off", () => {
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
    // The only commit is the reset commit, after the gate; nothing else writes fixture history.
    expect(text.split("\n").filter((line) => /\bcommit -q\b/.test(line))).toHaveLength(1);
    const order = ['< "$RUN_DIR/validate-amendment.mjs"', '< "$RUN_DIR/probe-lineage.mjs"', '< "$RUN_DIR/probe-live-sync.mjs"', "read_gate() {", "PREVIEW=\"$(settle_run3)\"", 'settle_run3 --apply --preview "$SUPERSEDE_FINGERPRINT"', "commit -q -m", "push -q origin", "arcadia docs sync"];
    const at = order.map((marker) => text.indexOf(marker));
    expect(at.every((index) => index > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("the reset settles only run 3's declared proposal, rejected, with ARCADIA_WORKSPACE inline on that one command", () => {
    const text = source(RESET);
    expect(descriptorOf(RESET).agentAsk).toEqual({ proposal: RUN3_PROPOSAL, intent: "complete", targetRef: "action/write-start-marker" });
    expect(RUN3_PROPOSAL).toBe("complete-write-start-marker-run3-2026-10-05");
    expect(constantOf(RESET, "SUPERSEDE_REQUEST_ID")).toBe(`${RESET}-reject-run3-complete`);
    const settleLines = text.split("\n").filter((line) => line.includes("agent-ask settle"));
    expect(settleLines).toEqual([
      '  (cd "$ARCADIA_REPO" && ARCADIA_WORKSPACE="$WORKSPACE" timeout 180 mise exec -- pnpm -s arcadia agent-ask settle --proposal "$RUN3_PROPOSAL_ID" --request-id "$SUPERSEDE_REQUEST_ID" --disposition rejected "$@" --json)'
    ]);
    expect(text.split("\n").filter((line) => /\bsettle_run3\b/.test(line) && !line.includes("settle_run3() {")).map((line) => line.trim())).toEqual([
      'PREVIEW="$(settle_run3)" || PREVIEW=""',
      'APPLIED="$(settle_run3 --apply --preview "$SUPERSEDE_FINGERPRINT")" || APPLIED=""'
    ]);
    expect(text.match(/ARCADIA_WORKSPACE=/g)).toHaveLength(1);
    // The proposal row it settles is the one read under exactly RUN3_PROPOSAL, never a run-1 or run-2 id.
    expect(text).toContain('RUN3_PROPOSAL_ID="$(jq -r \'.run3.id\' <<<"$GATE")"');
    expect(text).not.toMatch(/RUN2_PROPOSAL|complete-write-start-marker-2026-10-04/);
  });

  it("the reset's fourth next_action is the original sentence with a run-4 note naming an unused completion id", () => {
    expect(OLD_LINE).toBe(RUN3_LINE);
    for (const earlier of [ORIGINAL_LINE, RUN2_LINE, RUN3_LINE]) expect(NEW_LINE).not.toBe(earlier);
    expect(NEW_LINE.startsWith(ORIGINAL_LINE.slice(0, -1))).toBe(true);
    expect(NEW_LINE.slice(ORIGINAL_LINE.length - 1)).toBe(" (rehearsal run 4, from the run-3 reset fixture main; the run 1, run 2 and run 3 attempts and candidates stay as evidence; record completion under the unused Agent Ask request id complete-write-start-marker-run4-2026-10-05, because complete-write-start-marker-2026-10-05 and complete-write-start-marker-run3-2026-10-05 are already settled).");
    expect(RUN4_COMPLETION_ID).toBe("complete-write-start-marker-run4-2026-10-05");
    expect(NEW_LINE).toContain(RUN4_COMPLETION_ID);
    expect([RUN2_PROPOSAL, RUN3_PROPOSAL]).not.toContain(RUN4_COMPLETION_ID);
  });

  it("the reset pins the live run-3 facts", () => {
    expect(constantOf(RESET, "RUN3_HEAD")).toBe("4375aafeef38f0ee339a300406c8a865dbb916dc");
    expect(constantOf(RESET, "RUN2_HEAD")).toBe("0d3d2cedc5548da41896201688a1dc0210208ea4");
    expect([constantOf(RESET, "RUN1_TIP"), constantOf(RESET, "RUN2_TIP"), constantOf(RESET, "RUN3_TIP")]).toEqual([
      "58bcd9155cf64836994045ca63a7707d8b9ebe75", "7f1390376f4d49215cd29fd98145d40198475613", "50d1eab84e385a5566119831c82f5a6d32e752fd"
    ]);
    expect([constantOf(RESET, "RUN1_BRANCH"), constantOf(RESET, "RUN2_BRANCH"), constantOf(RESET, "RUN3_BRANCH")]).toEqual([RUN1_BRANCH, RUN2_BRANCH, RUN3_BRANCH]);
    expect(constantOf(RESET, "RUN3_G8_ID")).toBe(RUN3_G8);
    expect(constantOf(RESET, "RUN3_G8_MIN_RUN_ID")).toBe("20261005T194025Z-26232");
    expect(constantOf(RESET, "RUN3_RESET_ID")).toBe(RUN3_RESET);
    for (const [name, prefix] of [["ORIGINAL_REVISION", "959a3b12c686"], ["RUN2_REVISION", "7a8dd4f5960f"], ["RUN3_REVISION", "e22c8cfadd0b"]]) {
      expect(constantOf(RESET, name).startsWith(prefix), name).toBe(true);
    }
    // Every earlier branch and pull request is checked before the push and again after it.
    const checks = source(RESET).split("\n").filter((line) => line.startsWith("check_candidate "));
    expect(checks).toEqual([
      'check_candidate "run 1" "$RUN1_BRANCH" "$RUN1_TIP" "$RUN1_PR"', 'check_candidate "run 2" "$RUN2_BRANCH" "$RUN2_TIP" "$RUN2_PR"', 'check_candidate "run 3" "$RUN3_BRANCH" "$RUN3_TIP" "$RUN3_PR"',
      'check_candidate "run 1" "$RUN1_BRANCH" "$RUN1_TIP" "$RUN1_PR"', 'check_candidate "run 2" "$RUN2_BRANCH" "$RUN2_TIP" "$RUN2_PR"', 'check_candidate "run 3" "$RUN3_BRANCH" "$RUN3_TIP" "$RUN3_PR"'
    ]);
    const text = source(RESET);
    expect(text.indexOf('record "candidatesBefore"')).toBeLessThan(text.indexOf("push -q origin"));
    expect(text.indexOf('record "candidatesAfter"')).toBeGreaterThan(text.indexOf("push -q origin"));
  });

  it("the run-4 G7 is the run-3 G7 line for line except its ids, binding and run-4 wording", () => {
    const normalize = (text: string) => text
      .replace(/^# G7 for rehearsal run \d:[\s\S]*?(?=# current policy revision)/m, "")
      .replace(/-run4-2026-10-05/g, "-run3-2026-10-05")
      .replace(/^# Run 3's reset head: the run-4 reset commit's only parent; run 2's reset head is its parent\.\nRUN3_HEAD="[0-9a-f]{40}"\n/m, "")
      .replace(/^# Run 2's reset head: the run-3 reset commit's only parent\.\n/m, "")
      .replace(/^# The run-[34] fixture head:[\s\S]*?\nRESET_RECEIPT=""/m, "RESET_RECEIPT=\"\"")
      .replace(/^jq -e --arg head "\$FIXTURE_HEAD"[\s\S]*?\|\| refuse "the fixture is not exactly one reset commit on [^\n]*\n/m, "<FIXTURE BINDING>\n")
      .replace(/^- fixture: .*$/m, "<FIXTURE LINE>")
      .replace(/run 4/g, "run 3").replace(/run-4/g, "run-3");
    const run3 = normalize(source(RUN3_G7));
    const run4 = normalize(source(G7));
    expect(run4).toBe(run3);
    // The binding itself: run 3's reset head is the only parent, run 2's its parent, genesis below that.
    const text = source(G7);
    expect(constantOf(G7, "RUN3_HEAD")).toBe("4375aafeef38f0ee339a300406c8a865dbb916dc");
    expect(constantOf(G7, "RUN2_HEAD")).toBe("0d3d2cedc5548da41896201688a1dc0210208ea4");
    expect(text).toContain(".previousMain == $run3 and .genesis == $root and .remoteMainAfter == .newHead");
    expect(text).toContain('"$(git -C "$FIXTURE_REPO" rev-parse HEAD^)" == "$RUN3_HEAD"');
    expect(text).toContain('"$(git -C "$FIXTURE_REPO" rev-parse HEAD^^)" == "$RUN2_HEAD"');
    expect(text).toContain('"$(git -C "$FIXTURE_REPO" rev-parse HEAD^^^)" == "$ROOT_COMMIT"');
    expect(text).toContain('"$(git -C "$FIXTURE_REPO" rev-list --count HEAD)" == 4');
    expect(text).toContain(".arcadiaHead == $head and .brokerRevision == $broker");
    // The #925 acknowledgement and authorization the receipt records are run 3's, word for word.
    for (const field of ["record_str authorizes ", "record_str operatorAcknowledgement "]) {
      const line = (script: string) => script.split("\n").filter((l) => l.startsWith(field));
      expect(line(text)).toHaveLength(1);
      expect(line(text)).toEqual(line(source(RUN3_G7)));
    }
  });

  it("the run-4 G7 keeps every G7 safety property under a new request id, with the #925 acknowledgement on the /runs card and the next_after hint", () => {
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
    const run3 = descriptorOf(RUN3_G7);
    expect(descriptor).toMatchObject({ kind: "grant", repeatable: false });
    expect(descriptor.title).toContain("#925");
    expect(descriptor.desired_effect).toMatch(/^Pressing accepts Decision 0058 for these three fixture Actions only \(#925, answered yes in Log operator-answers-rehearsal-run2-2026-10-05 \(commit 133e503dc, clarified by 49b1342a8\) and the operator's chat confirmations of 2026-10-05\): readying the PR, pushing the settled head and reviewer-model spend/);
    expect(descriptor.problem).toMatch(/^OPERATOR ACKNOWLEDGEMENT REQUIRED BEFORE PRESSING .*issues\/925/);
    expect(descriptor.problem).toContain("that answer created no Decision");
    // The acknowledgement opening the /runs card is run 3's, word for word.
    const opening = (text: string) => text.slice(0, text.indexOf("Rehearsal run"));
    expect(opening(descriptor.problem)).toBe(opening(run3.problem));
    expect(descriptor.authority.does[0]).toBe(run3.authority.does[0]);
    expect(descriptor.authority.does.join(" ")).toContain("SIGKILL");
    expect(descriptor.authority.never_does.join(" ")).toMatch(/GitHub merge.*base branch/);
    // Exactly the shape the run-3 G7 carries, with the run-4 ids, every G8 and every reset.
    expect(Object.keys(descriptor.next_after)).toEqual(Object.keys(run3.next_after));
    expect(descriptor.next_after).toEqual({
      id: G6,
      within_minutes: 30,
      voided_by: [G8, RUN3_G8, RUN2_G8, RUN1_G8, "recover-arcadia-host-services", "reinstall-go-broker", RESET, RUN3_RESET, RUN2_RESET],
      when_production: "inactive"
    });
  });

  it("the run-4 G6 keeps every run-3 check and binds the run-4 reset head", () => {
    const run3 = source(RUN3_G6);
    const run4 = source(G6);
    const checks = (text: string) => [...new Set([...text.matchAll(/check ([a-z_]+) (?:pass|refuse)/g)].map((m) => m[1]))];
    expect(checks(run4)).toEqual(checks(run3));
    for (const line of ["installed_release pass", 'REQUIRED_COMMITS="9a9db5e8bfe7b35d0b312fc2f763cc80c2db25f1 0b3686013f0a924c35d58dc7a09c979f1a994c7e"', "CHECK_WAIT_SECONDS=300", 'RUNTIME_PATHS="src scripts apps package.json pnpm-lock.yaml tsconfig.json"', "resolveOperatorGate"]) {
      expect(run4).toContain(line);
    }
    expect(constantOf(G6, "RUN3_HEAD")).toBe("4375aafeef38f0ee339a300406c8a865dbb916dc");
    expect(run4).toContain(".previousMain == $run3 and .genesis == $root");
    expect(run4).toContain('rev-list --count HEAD 2>/dev/null)" == 4');
    expect(run4).not.toMatch(/agent[-_]ask/);
    // Apart from ids, the binding and wording, the run-4 G6 is the run-3 G6.
    const normalize = (text: string) => text.replace(/^# G6 for rehearsal run \d:[\s\S]*?(?=set -Eeuo pipefail)/m, "")
      .replace(/-run4-2026-10-05/g, "-run3-2026-10-05").replace(/^# Run [23]'s reset head:.*\n(RUN3_HEAD=.*\n)?/m, "")
      .replace(/^ {2}# The run-[34] fixture head[\s\S]*?(?=\n {2}if \[\[ -n "\$REPO" \]\]; then)/m, "")
      .replace(/^ {2}elif jq -e --arg head "\$LOCAL_HEAD"[\s\S]*?\n {2}fi\n/m, "<BINDING>\n")
      .replace(/^ {4}check fixture (pass|refuse) .*$/gm, "<FIXTURE $1>")
      .replace(/run 4/g, "run 3").replace(/run-4/g, "run-3");
    expect(normalize(run4)).toBe(normalize(run3));
  });
});

describe("the run-4 reset refuses unsafe input and unsafe state before any settle, commit or push", { timeout: 360_000 }, () => {
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
    ["the descriptor declares run 2's proposal instead", (box) => {
      const file = path.join(box.scripts, `${RESET}.json`);
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), agentAsk: { proposal: RUN2_PROPOSAL, intent: "complete", targetRef: "action/write-start-marker" } }));
    }, "preflight", "does not declare exactly the proposal"],
    ["run 3's terminal Off is not proven (a later G8 refused past its launch guard)", (box) => {
      writeReceipt(box, "20261005T200000Z-2", { id: RUN3_G8, runId: "20261005T200000Z-2", outcome: "refused", stage: "drain", offState: "confirmed" });
    }, "prior_evidence", "terminal Off is not proven"],
    ["the only run-3 G8 success predates run 3's terminal Off", (box) => {
      rmSync(path.join(box.scripts, "runs", "20261005T194025Z-26232"), { recursive: true });
      writeReceipt(box, "20261005T190000Z-3", { id: RUN3_G8, runId: "20261005T190000Z-3", outcome: "succeeded", stage: "complete", offState: "confirmed" });
    }, "prior_evidence", "terminal Off is not proven"],
    ["only run 2's G8 proves an Off", (box) => {
      rmSync(path.join(box.scripts, "runs", "20261005T194025Z-26232"), { recursive: true });
      writeReceipt(box, "20261005T200000Z-5", { id: RUN2_G8, runId: "20261005T200000Z-5", outcome: "succeeded", stage: "complete", offState: "confirmed" });
    }, "prior_evidence", "terminal Off is not proven"],
    ["run 3's reset receipt is missing", (box) => { rmSync(path.join(box.scripts, "runs", "20261005T183648Z-77904"), { recursive: true }); }, "prior_evidence", "run 3's reset is not recorded"],
    ["run 3's reset receipt names another head", (box, state) => {
      writeReceipt(box, "20261005T184000Z-4", { id: RUN3_RESET, outcome: "succeeded", githubRepository: REPO, genesis: state.genesis, previousMain: state.run2Head, newHead: "1".repeat(40), remoteMainAfter: "1".repeat(40) });
    }, "prior_evidence", "run 3's reset is not recorded"],
    ["run 3's reset receipt does not sit on run 2's reset head", (box, state) => {
      writeReceipt(box, "20261005T184000Z-6", { id: RUN3_RESET, outcome: "succeeded", githubRepository: REPO, genesis: state.genesis, previousMain: state.genesis, newHead: state.run3Head, remoteMainAfter: state.run3Head });
    }, "prior_evidence", "run 3's reset is not recorded"],
    ["the fixture is dirty", (box) => { writeFileSync(path.join(box.fixture, "stray.txt"), "x\n"); }, "local_fixture", "dirty or has untracked files"],
    ["the Project is registered from another path", (box, state) => { runProjectMetadataCommand({ workspace: box.workspace, projectId: state.projectId, repoPath: "/elsewhere/fixture" }); }, "registration", "is not registered from"],
    ["the repository lacks G1's description", (box) => box.patchReplies({ [`gh repo view ${REPO}`]: { stdout: JSON.stringify({ visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, description: "someone else's" }) } }), "github_repository", "G1 did not create it"],
    ["pull request #1 moved off run 1's tip", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/pulls/1`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN1_BRANCH, sha: state.genesis } }) } }), "candidates", "pull request #1 is not run 1's candidate"],
    ["pull request #2 moved off run 2's tip", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/pulls/2`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN2_BRANCH, sha: state.run2Marker } }) } }), "candidates", "pull request #2 is not run 2's candidate"],
    ["pull request #3 moved off run 3's tip", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/pulls/3`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN3_BRANCH, sha: state.run3Marker } }) } }), "candidates", "pull request #3 is not run 3's candidate"],
    ["run 3's GitHub branch moved", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/branches/${RUN3_BRANCH}`]: { stdout: `${state.run3Marker}\n` } }), "candidates", `GitHub branch ${RUN3_BRANCH}`],
    ["run 3's local branch moved", (box) => {
      git(box.fixture, ["checkout", "-q", RUN3_BRANCH]);
      writeFileSync(path.join(box.fixture, "MORE.md"), "more\n");
      commitAll(box.fixture, "more");
      git(box.fixture, ["checkout", "-q", "main"]);
    }, "candidates", `local branch ${RUN3_BRANCH}`],
    ["the amended input already has an attempt", (box) => {
      const amended = path.join(temp("arcadia-run4-amended-"), "fixture");
      mkdirSync(amended, { recursive: true });
      renderG1Fixture(amended);
      writeFileSync(path.join(amended, PLAN_FILE), readFileSync(path.join(amended, PLAN_FILE), "utf8").replace(ORIGINAL_LINE, NEW_LINE));
      withDatabase(box.workspace, (db) => beginDevelopmentAttempt(db, { requirement: identityOf(amended), requestId: "worker-tick-early-run-4", retryAuthorized: true, now: new Date() }));
    }, "lineage", "attempts already exist for the amended requirement input"],
    ["run 3's passing Session is still running", (box) => box.patchReplies({ "probe lineage": { stdout: JSON.stringify({ attempts: [], holders: [{ input: "run3", sessionId: "s3", status: "running", worktree: null, preserved: true }] }) } }), "lineage", "could not dispatch past it"],
    ["fixture main is back at run 2's reset head", (box, state) => {
      git(box.fixture, ["update-ref", "refs/heads/main", state.run2Head]);
      git(box.fixture, ["reset", "-q", "--hard", state.run2Head]);
    }, "fixture_state", "are not at run 3's reset head"]
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
    expect(unsettled(box)).toEqual([RUN3_PROPOSAL]);
    expect(box.pushes()).toEqual([]);
    expect(arcadiaCalls(box, "docs", "sync")).toHaveLength(0);
    if (stage !== "local_fixture" && stage !== "fixture_state") noMutation(box, state.run3Head);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)|"pr",|"pulls\/[123]","-X"/);
  });

  it("refuses a reset date before the Plan's own updated: date with the clock remedy", () => {
    const { box, run3Head } = resetBox();
    box.rebind(RESET, [['RESET_DATE="$(date -u +%F)"', 'RESET_DATE="2026-10-04"']]);
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "render_amendment", planUpdatedBefore: "2026-10-05" });
    expect(json.reason).toContain("before the Plan's updated: 2026-10-05");
    expect(json.recovery).toContain("Correct the host clock, or rerun on or after 2026-10-05 UTC");
    expect(settleCalls(box)).toHaveLength(0);
    noMutation(box, run3Head);
  });

  it("refuses an amendment Arcadia's discovery rejects, settling, committing and pushing nothing", () => {
    const { box, run3Head } = resetBox();
    box.rebind(RESET, [[/^NEW_NEXT_ACTION='.*'$/m, `NEW_NEXT_ACTION='    next_action: Implement MARKER.md: broken for run 4.'`]]);
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "validate_amendment" });
    expect(json.reason).toContain("nothing was settled, committed or pushed");
    expect(settleCalls(box)).toHaveLength(0);
    noMutation(box, run3Head);
    expect(discoverDocs(box.checkout).docs.map((doc) => doc.relativePath)).toEqual(["PROJECT.md"]);
  });

  it("refuses an amendment back to run 3's, run 2's or the original text, which would not give a fourth input revision", () => {
    for (const text of [ORIGINAL_LINE, RUN2_LINE, RUN3_LINE]) {
      const { box, run3Head } = resetBox();
      // A later date, so that only the next_action can be what fails.
      box.rebind(RESET, [[/^NEW_NEXT_ACTION='.*'$/m, `NEW_NEXT_ACTION='${text}'`], ['RESET_DATE="$(date -u +%F)"', 'RESET_DATE="2099-01-01"']]);
      expect(box.run(RESET, resetEnv).status).not.toBe(0);
      const { json } = box.receipt(RESET);
      expect(json.stage).toBe("validate_amendment");
      expect(json.reason).toContain("did not give write-start-marker a fourth requirement input revision");
      expect(settleCalls(box)).toHaveLength(0);
      noMutation(box, run3Head);
    }
  });
});

describe("the run-4 reset keeps run 3's Issue #968 handling, now for exactly run 3's proposal", { timeout: 360_000 }, () => {
  it.each([
    ["run 2's", RUN2_PROPOSAL, "run2"],
    ["run 1's", "complete-write-start-marker-2026-10-04", "run1"]
  ])("refuses %s still-pending complete proposal (or any other pending fixture proposal), settling nothing, not even run 3's", (_label, foreign, which) => {
    const { box, run3Head, run1Tip, run2Marker } = resetBox();
    seedProposal(box, completeAsk(foreign, which === "run2" ? run2Marker : run1Tip));
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { dir, json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "proposal_gate", proposalSettledByThisRun: false });
    expect(json.reason).toContain(foreign);
    expect(json.recovery).toContain("This script settles none of them");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain(`No Agent Ask proposal other than ${RUN3_PROPOSAL} was settled.`);
    expect(settleCalls(box)).toHaveLength(0);
    expect(unsettled(box).sort()).toEqual([foreign, RUN3_PROPOSAL].sort());
    noMutation(box, run3Head);
  });

  it("refuses a proposal under run 3's request id that differs from the declared scope, untouched", () => {
    const { box, run3Head, run3Marker } = resetBox({ pendingRun3Proposal: false });
    seedProposal(box, completeAsk(RUN3_PROPOSAL, run3Marker, { target_ref: "plan/autonomous-three-action-rehearsal#write-start-marker" }));
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "proposal_gate" });
    expect(json.reason).toContain("is not run 3's complete Ask as this action declares it");
    expect(settleCalls(box)).toHaveLength(0);
    expect(unsettled(box)).toEqual([RUN3_PROPOSAL]);
    noMutation(box, run3Head);
  });

  it("refuses a rejection preview that would write a document, never applying it", () => {
    const { box, run3Head } = resetBox();
    box.patchReplies({ "arcadia agent-ask settle": ok({ receipt: { applied: false, disposition: "rejected", proposalId: "x", proposalRequestId: RUN3_PROPOSAL, settlementRequestId: SUPERSEDE_REQUEST_ID, previewFingerprint: "a".repeat(64), queueActionKeys: [], review: { documents: [{ path: ".arcadia/asks/x.yaml" }] } } }) });
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "supersede_proposal", proposalSettledByThisRun: false });
    expect(json.reason).toContain("document-free, queue-free rejection");
    expect(settleCalls(box)).toHaveLength(1);
    expect(settleCalls(box)[0].args).not.toContain("--apply");
    expect(unsettled(box)).toEqual([RUN3_PROPOSAL]);
    noMutation(box, run3Head);
  });

  it("records the preview fingerprint when the apply does not land, then a rerun previews afresh and completes", () => {
    const { box, run3Head } = resetBox();
    box.patchReplies({ "arcadia agent-ask settle": [{ passthrough: "cli" }, { status: 1, stdout: JSON.stringify({ ok: false }) }, { passthrough: "cli" }] });
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const first = box.receipt(RESET);
    expect(first.json).toMatchObject({ outcome: "refused", stage: "supersede_proposal", proposalSettledByThisRun: false, fixtureCommitted: false, githubRepositoryChanged: false });
    expect(first.json.supersedePreviewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path.join(first.dir, "failure-handoff.md"), "utf8")).toContain(`did not confirm the apply`);
    expect(unsettled(box)).toEqual([RUN3_PROPOSAL]);
    noMutation(box, run3Head);
    box.patchReplies({ "arcadia agent-ask settle": { passthrough: "cli" } });
    const second = box.run(RESET, resetEnv);
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", proposalSettledByThisRun: true, supersededProposal: { state: "superseded", settlementRequestId: SUPERSEDE_REQUEST_ID } });
    expect(settlementOf(box, RUN3_PROPOSAL)).toEqual({ settlementRequestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" });
  });

  it("reads a landed rejection back when the apply's output is lost", () => {
    const { box } = resetBox();
    box.patchReplies({ "arcadia agent-ask settle": [{ passthrough: "cli" }, { passthrough: "cli", discardOutput: true }] });
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", proposalSettledByThisRun: true, supersededProposal: { state: "superseded" } });
    expect(settlementOf(box, RUN3_PROPOSAL)).toEqual({ settlementRequestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" });
  });

  it("recognizes its own landed rejection on resume after a failed push, settling nothing twice", () => {
    const { box, run3Head } = resetBox();
    expect(box.run(RESET, { ...resetEnv, FAKE_PUSH_FAIL: "1" }).status).not.toBe(0);
    const first = box.receipt(RESET);
    expect(first.json).toMatchObject({ outcome: "refused", stage: "push", fixtureCommitted: true, proposalSettledByThisRun: true, resetState: "at_run3_head" });
    expect(readFileSync(path.join(first.dir, "failure-handoff.md"), "utf8")).toContain("Rerunning recognizes that rejection and does not settle again.");
    const head = git(box.fixture, ["rev-parse", "HEAD"]);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(run3Head);
    const settlesBefore = settleCalls(box).length;
    expect(settlesBefore).toBe(2);
    box.patchReplies({ [`gh api repos/${REPO}/commits/main`]: [{ stdout: `${run3Head}\n` }, { stdout: `${head}\n` }] });
    const second = box.run(RESET, resetEnv);
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({
      outcome: "succeeded", resetState: "committed_unpushed", newHead: head, fixtureCommitted: false, githubRepositoryChanged: true, proposalSettledByThisRun: false,
      supersededProposal: { requestId: RUN3_PROPOSAL, state: "already_superseded", settlementRequestId: SUPERSEDE_REQUEST_ID }
    });
    expect(settleCalls(box)).toHaveLength(settlesBefore);
    expect(box.pushes()).toHaveLength(2);
  });

  it("leaves a proposal already rejected by someone else exactly as it is", () => {
    const { box } = resetBox();
    const fp = (runCli(box, ["agent-ask", "settle", "--proposal", RUN3_PROPOSAL, "--request-id", "operator-rejected-by-hand", "--disposition", "rejected", "--json"]).data.receipt.previewFingerprint) as string;
    runCli(box, ["agent-ask", "settle", "--proposal", RUN3_PROPOSAL, "--request-id", "operator-rejected-by-hand", "--disposition", "rejected", "--apply", "--preview", fp, "--json"]);
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", proposalSettledByThisRun: false, supersededProposal: { state: "rejected_elsewhere", settlement: { requestId: "operator-rejected-by-hand", disposition: "rejected" } } });
    expect(settleCalls(box)).toHaveLength(0);
  });

  const acceptedRun3 = (blocking: unknown[] = []) => ({ "probe proposal-gate": { stdout: JSON.stringify({ blocking, fixturePending: [], run4CompletionUsed: false, fixtureProposals: [], run3: {
    id: "agentask_3c0ffee", requestId: RUN3_PROPOSAL, project: "three-action-rehearsal", intent: "complete", targetRef: "action/write-start-marker",
    settlement: { id: "asksettle_3c0ffee", requestId: RUN3_PROPOSAL, disposition: "accepted" } } }) } });

  it("proceeds, leaving it as it is, when run 3's proposal was accepted on its candidate branch (the live state) and the gate is clear", () => {
    const { box, run3Head } = resetBox();
    box.patchReplies(acceptedRun3());
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "succeeded", proposalSettledByThisRun: false, previousMain: run3Head,
      supersededProposal: { requestId: RUN3_PROPOSAL, proposalId: "agentask_3c0ffee", state: "accepted_elsewhere", previewFingerprint: null, settlement: { disposition: "accepted" } } });
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(run3Head);
    expect(settleCalls(box)).toHaveLength(0);
  });

  it("refuses, settling and committing nothing, when run 3's proposal is accepted but the gate still blocks", () => {
    const { box, run3Head } = resetBox();
    box.patchReplies(acceptedRun3([{ action: "write-start-marker", kind: "agent_ask", id: "agentask_3c0ffee", requestId: RUN3_PROPOSAL, title: "Mark write-start-marker complete." }]));
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "proposal_gate", proposalSettledByThisRun: false });
    expect(json.reason).toContain("still gate the fixture");
    expect(settleCalls(box)).toHaveLength(0);
    noMutation(box, run3Head);
  });

  it("refuses, settling nothing, when the completion request id the run-4 text names is already used", () => {
    const { box, run3Head, run3Marker } = resetBox();
    seedProposal(box, completeAsk(RUN4_COMPLETION_ID, run3Marker));
    const fp = runCli(box, ["agent-ask", "settle", "--proposal", RUN4_COMPLETION_ID, "--request-id", "reject-early-run4-id", "--disposition", "rejected", "--json"]).data.receipt.previewFingerprint as string;
    runCli(box, ["agent-ask", "settle", "--proposal", RUN4_COMPLETION_ID, "--request-id", "reject-early-run4-id", "--disposition", "rejected", "--apply", "--preview", fp, "--json"]);
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "proposal_gate", proposalSettledByThisRun: false });
    expect(json.reason).toContain(`${RUN4_COMPLETION_ID} that the run-4 next_action tells the agent to use is already used`);
    expect(settleCalls(box)).toHaveLength(0);
    expect(unsettled(box)).toEqual([RUN3_PROPOSAL]);
    noMutation(box, run3Head);
  });

  it("proceeds without settling anything when run 3's proposal is absent and nothing gates the fixture", () => {
    const { box } = resetBox({ pendingRun3Proposal: false });
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", supersededProposal: { state: "absent", proposalId: null, previewFingerprint: null }, fixtureProposalsBefore: [], fixtureProposalsAfter: [] });
    expect(settleCalls(box)).toHaveLength(0);
  });
});

function runCli(box: Box, args: string[]) {
  // The box's own HOME and no exported workspace: only the throwaway workspace is ever addressed.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: box.home };
  delete env.VITEST;
  delete env.ARCADIA_WORKSPACE;
  const run = spawnSync(process.execPath, ["--import", "tsx", path.join(repoRoot, "src", "cli.ts"), ...args, "--workspace", box.workspace], { cwd: repoRoot, env, encoding: "utf8", timeout: 60_000 });
  expect(run.status, run.stderr + run.stdout).toBe(0);
  return JSON.parse(run.stdout);
}

describe("the run-4 reset commits one validated line on run 3's head, pushes it without force, syncs docs and records every tip", { timeout: 360_000 }, () => {
  it("resets exactly write-start-marker's next_action, rejects run 3's pending proposal first, leaves all three candidates untouched, and refuses a second application", () => {
    const { box, run2Head, run3Head, genesis, run1Tip, run2Tip, run3Tip, original, run2, run3 } = resetBox();
    // A later run-3 G8 that refused at its launch guard ran nothing and does not void run 3's terminal Off.
    writeReceipt(box, "20261005T200500Z-9", { id: RUN3_G8, runId: "20261005T200500Z-9", outcome: "refused", stage: "launch_context", offState: "unknown" });
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = box.receipt(RESET);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    const amended = identityOf(box.fixture);
    const candidates = [
      { run: "run 1", branch: RUN1_BRANCH, localTip: run1Tip, remoteTip: run1Tip, pullRequest: 1, prTip: run1Tip, prState: "open" },
      { run: "run 2", branch: RUN2_BRANCH, localTip: run2Tip, remoteTip: run2Tip, pullRequest: 2, prTip: run2Tip, prState: "open" },
      { run: "run 3", branch: RUN3_BRANCH, localTip: run3Tip, remoteTip: run3Tip, pullRequest: 3, prTip: run3Tip, prState: "open" }
    ];
    expect(json).toMatchObject({
      outcome: "succeeded", stage: "complete", githubRepository: REPO, fixtureRoot: box.fixture, genesis, previousMain: run3Head, newHead: head, remoteMainAfter: head,
      candidatesBefore: candidates, candidatesAfter: candidates, resetState: "at_run3_head", fixtureCommitted: true, githubRepositoryChanged: true,
      proposalSettledByThisRun: true, productionPreviewedOrActivated: false, grantsTouched: false, planUpdatedBefore: "2026-10-05", run4CompletionRequestId: RUN4_COMPLETION_ID,
      supersededProposal: { requestId: RUN3_PROPOSAL, state: "superseded", settlementRequestId: SUPERSEDE_REQUEST_ID, settlement: { requestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" } },
      fixtureProposalsBefore: [{ requestId: RUN3_PROPOSAL, intent: "complete", targetRef: "action/write-start-marker", disposition: "pending" }],
      fixtureProposalsAfter: [{ requestId: RUN3_PROPOSAL, intent: "complete", targetRef: "action/write-start-marker", disposition: "rejected" }],
      actionTextRevision: { field: "next_action", requirementId: original.requirementId, inputRevisionOriginal: original.inputRevision, inputRevisionBefore: run3.inputRevision, inputRevisionAfter: amended.inputRevision, criteriaFingerprint: original.criteriaFingerprint }
    });
    expect(json.supersededProposal.proposalId).toMatch(/^agentask_/);
    expect(json.supersededProposal.previewFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set([original.inputRevision, run2.inputRevision, run3.inputRevision, amended.inputRevision]).size).toBe(4);
    expect(json.priorAttempts).toEqual([
      { input: "original", role: "development", ordinal: 1, status: "passed" },
      { input: "run2", role: "development", ordinal: 1, status: "passed" },
      { input: "run3", role: "development", ordinal: 1, status: "passed" }
    ]);
    expect(json.priorHolders.map((h: { input: string; sessionId: string }) => [h.input, h.sessionId])).toEqual([["original", "session_run_1"], ["run2", "session_run_2"], ["run3", "session_run_3"]]);
    // One commit on run 3's head touching only the Plan: write-start-marker's next_action (and the date only when the reset's UTC date is later).
    const today = new Date().toISOString().slice(0, 10);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(run3Head);
    expect(git(box.fixture, ["rev-parse", "HEAD^^"])).toBe(run2Head);
    expect(git(box.fixture, ["diff", "--name-only", run3Head, head])).toBe(PLAN_FILE);
    const changed = git(box.fixture, ["diff", "-U0", run3Head, head, "--", PLAN_FILE]).split("\n").filter((line) => /^[-+][^-+]/.test(line));
    expect(changed).toEqual([...(today === "2026-10-05" ? [] : ["-updated: 2026-10-05", `+updated: ${today}`]), `-${OLD_LINE}`, `+${NEW_LINE}`]);
    expect(json.planUpdated).toBe(today);
    expect(git(box.fixture, ["log", "-1", "--format=%an <%ae>%n%s"])).toBe("Arcadia Rehearsal Fixture <rehearsal@localhost>\nReset write-start-marker for three-Action rehearsal run 4");
    expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
    expect(git(box.fixture, ["rev-parse", `refs/heads/${RUN1_BRANCH}`])).toBe(run1Tip);
    expect(git(box.fixture, ["rev-parse", `refs/heads/${RUN2_BRANCH}`])).toBe(run2Tip);
    expect(git(box.fixture, ["rev-parse", `refs/heads/${RUN3_BRANCH}`])).toBe(run3Tip);
    // One push, of fixture main only, never forced; validation, the live dry run and the governed rejection precede it.
    expect(box.pushes()).toHaveLength(1);
    expect(box.pushes()[0]).toMatch(/push -q origin refs\/heads\/main:refs\/heads\/main$/);
    const keys = box.keys();
    const order = ["probe amendment", "probe lineage", "probe live-sync", "probe proposal-gate", "arcadia agent-ask settle", "arcadia agent-ask settle --apply", "push", "arcadia docs sync"].map((key) => keys.indexOf(key));
    expect(order.every((index) => index > -1), JSON.stringify(keys)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Every pull-request read is a GET of #1, #2 or #3; nothing writes GitHub.
    expect(parsedCalls(box).filter((c) => c.tool === "gh").every((c) => c.args[0] === "api" && !c.args.includes("-X") || c.args[0] === "repo" && c.args[1] === "view")).toBe(true);
    // The governed two-phase settle, rejected, of exactly that proposal row, with ARCADIA_WORKSPACE inline.
    const settles = settleCalls(box).map((c) => c.args.slice(c.args.indexOf("arcadia") + 1));
    expect(settles).toEqual([
      ["agent-ask", "settle", "--proposal", json.supersededProposal.proposalId, "--request-id", SUPERSEDE_REQUEST_ID, "--disposition", "rejected", "--json"],
      ["agent-ask", "settle", "--proposal", json.supersededProposal.proposalId, "--request-id", SUPERSEDE_REQUEST_ID, "--disposition", "rejected", "--apply", "--preview", json.supersededProposal.previewFingerprint, "--json"]
    ]);
    expect(box.envLog().map((e) => e.ARCADIA_WORKSPACE)).toEqual([box.workspace, box.workspace]);
    expect(settlementOf(box, RUN3_PROPOSAL)).toEqual({ settlementRequestId: SUPERSEDE_REQUEST_ID, disposition: "rejected" });
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
    const { original, run2, run3 } = resetBox();
    expect(original.inputRevision).toBe(constantOf(RESET, "ORIGINAL_REVISION"));
    expect(run2.inputRevision).toBe(constantOf(RESET, "RUN2_REVISION"));
    expect(run3.inputRevision).toBe(constantOf(RESET, "RUN3_REVISION"));
    expect(original.inputRevision.slice(0, 12)).toBe("959a3b12c686");
    expect(run2.inputRevision.slice(0, 12)).toBe("7a8dd4f5960f");
    expect(run3.inputRevision.slice(0, 12)).toBe("e22c8cfadd0b");
  });
});

describe("docs sync applies a same-day Plan amendment and skips an older one", () => {
  it("proves the date rule the reset relies on, with the real docs sync", () => {
    const box = sandboxFor([]);
    const state = afterRun3(box, { pendingRun3Proposal: false });
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
    expect(state.run3Head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reopens and updates a write-start-marker record marked done earlier the same day (the live state after run 3)", () => {
    const box = sandboxFor([]);
    afterRun3(box, { pendingRun3Proposal: false });
    const file = path.join(box.fixture, PLAN_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const ref = "plan/autonomous-three-action-rehearsal#write-start-marker";
    const row = () => withReadOnlyDatabase(box.workspace, (db) => db.prepare("SELECT status, next_action, updated_at FROM work_items WHERE doc_ref = ?").get(ref) as { status: string; next_action: string; updated_at: string });
    // As run 3's accepted completion left the record: done, earlier on the same UTC day.
    withDatabase(box.workspace, (db) => db.prepare("UPDATE work_items SET status = 'done', updated_at = ? WHERE doc_ref = ?").run(`${today}T00:00:01.000Z`, ref));
    expect(row()).toMatchObject({ status: "done" });
    // The run-4 reset's Plan on the same UTC day, through the real docs sync.
    writeFileSync(file, readFileSync(file, "utf8").replace(OLD_LINE, NEW_LINE).replace(/^updated: .*$/m, `updated: ${today}`));
    const sync = runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true }).data as unknown as { errorCount: number; projects: Array<{ changes: Array<{ entity: string; ref: string; action: string; reason?: string }> }> };
    expect(sync.errorCount).toBe(0);
    const change = sync.projects[0].changes.find((c) => c.entity === "action" && c.ref === ref)!;
    expect(change).toMatchObject({ action: "update" });
    expect(change.reason).toContain("status: done -> open");
    expect(row()).toMatchObject({ status: "open", next_action: NEW_LINE.replace(/^ {4}next_action: /, "") });
  });
});

// ---------------------------------------------------------------------------
// G6 and G7 for run 4 bind the run-4 reset head: one commit on run 3's reset
// head, itself one commit on run 2's, one commit on genesis.

function run4Fixture(box: Box) {
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
  const run3Head = commitAll(fixture, "Reset write-start-marker for three-Action rehearsal run 3");
  writeFileSync(path.join(fixture, "PLAN.md"), "run 4\n");
  const head = commitAll(fixture, "Reset write-start-marker for three-Action rehearsal run 4");
  git(fixture, ["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-first-packet-approval"), "review_1\n");
  for (const id of [G6, G7].filter((id) => existsSync(path.join(box.scripts, `${id}.sh`)))) {
    box.rebind(id, [[/^RUN2_HEAD="[0-9a-f]{40}"$/m, `RUN2_HEAD="${run2Head}"`], [/^RUN3_HEAD="[0-9a-f]{40}"$/m, `RUN3_HEAD="${run3Head}"`]]);
  }
  const resetReceipt = writeReceipt(box, "20261005T210000Z-3", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: fixture, genesis, previousMain: run3Head, newHead: head, remoteMainAfter: head });
  return { genesis, run2Head, run3Head, head, resetReceipt };
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

describe("the run-4 G6 preflight binds the run-4 reset head and keeps every check", { timeout: 360_000 }, () => {
  it("passes and binds the fixture head and reset receipt, checking GitHub main and CI at that head", () => {
    const { box, head } = g6Box();
    const { genesis, head: fixtureHead, resetReceipt } = run4Fixture(box);
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
    ["no run-4 reset receipt exists", (box: Box) => { rmSync(path.join(box.scripts, "runs", "20261005T210000Z-3"), { recursive: true }); }, "no succeeded reset-three-action-rehearsal-fixture-run4-2026-10-05 receipt"],
    ["only a run-3 reset receipt exists", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T210000Z-3", "receipt.json");
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), id: RUN3_RESET }));
    }, "no succeeded reset-three-action-rehearsal-fixture-run4-2026-10-05 receipt"],
    ["the only reset receipt names another repository", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T210000Z-3", "receipt.json");
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), githubRepository: "pmark/arcadia-three-action-rehearsal-other" }));
    }, "no succeeded reset"],
    ["the receipt's previous main is run 2's head, as a run-3 style reset would record", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T210000Z-3", "receipt.json");
      const json = JSON.parse(readFileSync(file, "utf8"));
      writeFileSync(file, JSON.stringify({ ...json, previousMain: git(box.fixture, ["rev-parse", "HEAD^^"]) }));
    }, "does not match the fixture"],
    ["the fixture is a run-3 shaped head (two commits on genesis)", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T210000Z-3", "receipt.json");
      const json = JSON.parse(readFileSync(file, "utf8"));
      const run3Head = git(box.fixture, ["rev-parse", "HEAD^"]);
      git(box.fixture, ["reset", "-q", "--hard", run3Head]);
      writeFileSync(file, JSON.stringify({ ...json, newHead: run3Head, remoteMainAfter: run3Head }));
    }, "does not match the fixture"],
    ["the fixture moved on past the reset head", (box: Box) => { writeFileSync(path.join(box.fixture, "MARKER.md"), "x\n"); commitAll(box.fixture, "later"); }, "does not match the fixture"],
    ["a newer succeeded reset receipt names another head", (box: Box) => {
      writeReceipt(box, "20261005T220000Z-4", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: box.fixture, genesis: "0".repeat(40), previousMain: "0".repeat(40), newHead: "1".repeat(40), remoteMainAfter: "1".repeat(40) });
    }, "does not match the fixture"]
  ])("refuses when %s", (_label, arrange, detail) => {
    const { box, head } = g6Box();
    const { head: fixtureHead } = run4Fixture(box);
    box.setReplies(g6Replies(box, head, fixtureHead));
    arrange(box);
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "reset_receipt")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "reset_receipt").detail).toContain(detail);
    expect(checkOf(box, "fixture")).toMatchObject({ status: "refuse" });
    expect(box.receipt(G6).json.outcome).toBe("refused");
  });

  it("refuses GitHub main at run 3's reset head rather than the run-4 head", () => {
    const { box, head } = g6Box();
    const { run3Head, head: fixtureHead } = run4Fixture(box);
    box.setReplies({ ...g6Replies(box, head, fixtureHead), [`gh api repos/${REPO}/branches/main`]: { stdout: JSON.stringify({ commit: { sha: run3Head }, protected: false }) } });
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "github_repository")).toMatchObject({ status: "refuse" });
  });

  it("keeps the earlier checks: a stale installed release, a paid reviewer login and unavailable capacity refuse", () => {
    const { box, head } = g6Box();
    const { head: fixtureHead } = run4Fixture(box);
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
    const state = afterRun3(box);
    // The run-4 head on the real fixture, as the reset leaves it.
    writeFileSync(path.join(box.fixture, PLAN_FILE), readFileSync(path.join(box.fixture, PLAN_FILE), "utf8").replace(OLD_LINE, NEW_LINE));
    git(box.fixture, ["add", "-A"]);
    git(box.fixture, ["-c", "user.name=Arcadia Rehearsal Fixture", "-c", "user.email=rehearsal@localhost", "commit", "-q", "-m", "Reset write-start-marker for three-Action rehearsal run 4"]);
    const fixtureHead = git(box.fixture, ["rev-parse", "HEAD"]);
    writeReceipt(box, "20261005T210000Z-3", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: box.fixture, genesis: state.genesis, previousMain: state.run3Head, newHead: fixtureHead, remoteMainAfter: fixtureHead });
    box.setReplies({ ...g6Replies(box, head, fixtureHead), "probe operator-gate": { passthrough: "probe" } });
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "operator_gate")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "operator_gate").detail).toContain('"action":"write-start-marker","kind":"agent_ask"');
    expect(unsettled(box)).toEqual([RUN3_PROPOSAL]);
    const fp = runCli(box, ["agent-ask", "settle", "--proposal", RUN3_PROPOSAL, "--request-id", "g6-test-reject", "--disposition", "rejected", "--json"]).data.receipt.previewFingerprint as string;
    runCli(box, ["agent-ask", "settle", "--proposal", RUN3_PROPOSAL, "--request-id", "g6-test-reject", "--disposition", "rejected", "--apply", "--preview", fp, "--json"]);
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
  const { genesis, run2Head, run3Head, head: fixtureHead, resetReceipt } = run4Fixture(box);
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
  return { box, env, actions, head, genesis, run2Head, run3Head, fixtureHead, resetReceipt, g6Receipt };
}
const g7Receipt = (box: Box) => box.receipt(G7);

describe("the run-4 G7 Grant binds the run-4 reset head and keeps every G7 safety property", () => {
  it("refuses outside the /runs launcher without any call", () => {
    const box = sandboxFor([G7]);
    expect(box.run(G7).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ id: G7, outcome: "refused", stage: "launch_context", activated: false });
    expect(box.calls()).toBe("");
  });

  it("refuses the run-3 G7's launch identity", () => {
    const box = sandboxFor([G7]);
    expect(box.run(G7, { ARCADIA_OPERATOR_SCRIPT_ID: RUN3_G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) }).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "launch_context" });
    expect(box.calls()).toBe("");
  });

  it("activates once under its own request id at the run-4 reset head after the replay and two identical previews", () => {
    const { box, env, actions, fixtureHead, genesis, run2Head, run3Head, resetReceipt, g6Receipt } = grantBox();
    const result = box.run(G7, env);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = g7Receipt(box);
    expect(json).toMatchObject({ id: G7, outcome: "succeeded", activated: true, scopeFingerprint: "fp-1", policyRevisionBefore: 33, policyRevisionAfter: 34, githubRepository: REPO, rootCommit: genesis, fixtureHead, resetReceipt, preflightReceipt: g6Receipt });
    expect(json.authorizes).toContain(`at fixture head ${fixtureHead}`);
    expect(json.authorizes).toContain("operator-answers-rehearsal-run2-2026-10-05");
    expect(json.authorizes).toContain("the operator's chat confirmations of 2026-10-05; that answer created no Decision");
    const md = readFileSync(path.join(dir, "receipt.md"), "utf8");
    expect(md).toContain(`run-4 reset head ${fixtureHead} on run 3's reset head ${run3Head}, run 2's reset head ${run2Head} and genesis ${genesis}`);
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
    expect(value("--intent")).toContain("rehearsal run 4");
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

  it("refuses a G6 receipt from the run-3 preflight", () => {
    const { box, env, g6Receipt } = grantBox();
    writeFileSync(g6Receipt, JSON.stringify({ ...JSON.parse(readFileSync(g6Receipt, "utf8")), id: RUN3_G6 }));
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

  it("refuses a fixture that is not exactly the run-4 reset head on run 3's head, never previewing", () => {
    const { box, env } = grantBox();
    writeFileSync(path.join(box.fixture, "MARKER.md"), "x\n");
    commitAll(box.fixture, "later");
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "fixture", activated: false, offCleanup: "not_attempted" });
    expect(g7Receipt(box).json.reason).toContain("is not the run-4 reset head");
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(0);
  });

  it.each(["run2Head", "genesis"] as const)("refuses a reset receipt whose previous main is %s, not run 3's reset head", (field) => {
    const grant = grantBox();
    writeFileSync(grant.resetReceipt, JSON.stringify({ ...JSON.parse(readFileSync(grant.resetReceipt, "utf8")), previousMain: grant[field] }));
    expect(grant.box.run(G7, grant.env).status).not.toBe(0);
    expect(g7Receipt(grant.box).json).toMatchObject({ outcome: "refused", stage: "fixture", activated: false });
    expect(arcadiaCalls(grant.box, "production", "preview")).toHaveLength(0);
  });

  it("refuses a run-3 shaped fixture (the reset head two commits on genesis), never previewing", () => {
    const { box, env, resetReceipt, run3Head } = grantBox();
    git(box.fixture, ["reset", "-q", "--hard", run3Head]);
    writeFileSync(resetReceipt, JSON.stringify({ ...JSON.parse(readFileSync(resetReceipt, "utf8")), newHead: run3Head, remoteMainAfter: run3Head }));
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "fixture", activated: false });
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(0);
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

  it("never turns off another request's Active policy after a failed activate, and names the run-4 G8", () => {
    const { box, env } = grantBox();
    box.patchReplies({ "arcadia production activate": { status: 1 }, "arcadia production status": [status("inactive"), status("inactive"), status("active")] });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ offCleanup: "other_grant_active", activated: false });
    expect(arcadiaCalls(box, "production", "deactivate")).toHaveLength(0);
    expect(readFileSync(path.join(g7Receipt(box).dir, "failure-handoff.md"), "utf8")).toContain("run the run-4 G8");
  });
});

describe("run 4 end to end against fakes: the reset's receipt is the head G6 and G7 bind", { timeout: 360_000 }, () => {
  it("reset (rejecting run 3's proposal), then G6 binds the run-4 head with the gate clear, then G7 accepts that G6 receipt and activates", () => {
    const box = sandboxFor([RESET, G6, G7]);
    const state = afterRun3(box);
    box.setReplies(resetReplies(box, state));
    const reset = box.run(RESET, resetEnv);
    expect(reset.status, reset.stdout + reset.stderr).toBe(0);
    const { dir: resetDir, json: resetJson } = box.receipt(RESET);
    const fixtureHead = resetJson.newHead;
    expect(git(box.fixture, ["rev-parse", "HEAD"])).toBe(fixtureHead);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(state.run3Head);
    expect(git(box.fixture, ["rev-parse", "HEAD^^"])).toBe(state.run2Head);

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
// The run-4 G8: the merged run-3 G8 with only its ownership widened to the
// run-4 G7 request id (run 3's, run 2's and run 1's still accepted), exact fixture scope only.

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

describe("the run-4 G8 owns only a rehearsal G7 policy with the exact fixture scope", () => {
  it("differs from the merged run-3 G8 only in its id and the request ids it owns, keeping its reconciliation and hash pins", () => {
    const run3 = source(RUN3_G8);
    const run4 = source(G8);
    const normalize = (text: string) => text
      .replace(/^# G8 for rehearsal run [34]:[\s\S]*?(?=# G8: restore and prove terminal Off)/m, "")
      .replace(/restore-terminal-off-three-action-rehearsal-run[34]-2026-10-05/g, "<G8>")
      .replace(/^# G8 owns only .*\n/m, "").replace(/^GRANT_ID=.*\n(RUN3_GRANT_ID=.*\n)?(RUN2_GRANT_ID=.*\n)?(RUN1_GRANT_ID=.*\n)?/m, "")
      .replace(/ --arg run3 "\$RUN3_GRANT_ID"/, "").replace(/\$RUN3_GRANT_ID, /g, "")
      .replace(" or .data.read.policy.authority.requestId == $run3", "")
      .replace(/== G8 \(run [34]\): restore/, "== G8: restore");
    expect(normalize(run4)).toBe(normalize(run3));
    // Apart from that one ownership change the scripts have the same lines, and the same count of them.
    expect(run4.split("\n").length - run3.split("\n").length).toBe(2);
    for (const pin of ["RECOVER_SCRIPT_SHA256", "RECOVER_DESCRIPTOR_SHA256", "RESTART_IMPL_SHA256"]) {
      const line = new RegExp(`^${pin}="[0-9a-f]{64}"$`, "m");
      expect(run4.match(line)?.[0]).toBeDefined();
      expect(run4.match(line)?.[0]).toBe(run3.match(line)?.[0]);
    }
    expect(run4).toContain(`GRANT_ID="${G7}"`);
    expect(run4).toContain(`RUN3_GRANT_ID="${RUN3_G7}"`);
    expect(run4).toContain(`RUN2_GRANT_ID="${RUN2_G7}"`);
    expect(run4).toContain(`RUN1_GRANT_ID="${RUN1_G7}"`);
    expect(run4).toContain("classifyPreservedCandidate");
    expect(run4).not.toMatch(/services\.sh restart|launchctl|worker (stop|start)/);
    // The launch guard is the run-3 one, and the descriptor tells the operator where to run it.
    expect(run4).toContain('[[ -t 0 ]] || refuse "launch this action through /runs or from an interactive host terminal"');
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
    ["the run-4 G7 request id with a narrower Action scope", rehearsalActive(G7, REHEARSAL_ACTIONS.slice(0, 2))],
    ["the run-4 G7 request id with another Plan", rehearsalActive(G7, REHEARSAL_ACTIONS, ["three-action-rehearsal/other-plan"])],
    ["the run-3 G7 request id with a narrower Action scope", rehearsalActive(RUN3_G7, REHEARSAL_ACTIONS.slice(1))],
    ["the run-3 reset's id posing as a Grant", rehearsalActive(RUN3_RESET)],
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
    ["run 4's", G7],
    ["run 3's", RUN3_G7],
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
