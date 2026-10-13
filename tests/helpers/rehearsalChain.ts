import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect } from "vitest";
import { runDocsSyncCommand } from "../../src/commands/docs.js";
import { runProjectImportCommand, runProjectMetadataCommand } from "../../src/commands/project.js";
import { withDatabase } from "../../src/db/connection.js";
import { discoverDocs } from "../../src/docs/discover.js";
import { recordSessionRoleAttemptTerminal } from "../../src/sessions/enrollment.js";
import { beginDevelopmentAttempt, requirementIdentity } from "../../src/sessions/roleLineage.js";
import { initWorkspace } from "../../src/workspace/initWorkspace.js";
import { CHAIN_IMPLEMENTATION, CHAIN_KINDS, REQUIRED_COMMIT_FLOOR, chainLibraryIds } from "../../src/operatorActions/rehearsalChain.js";


/**
 * Behavioral and static tests of the rehearsal-chain operator script set
 * (artifacts/generated/operator-scripts/rehearsal-chain/*.sh behind its per-run
 * launchers). Every behavioral case runs the real shared implementation and the
 * real launcher, copied into a throwaway library with fake `mise`, `gh`,
 * `codex`, `timeout`, `sleep` and a `git` whose `push` is only recorded, so no
 * case reaches GitHub, production policy, a model, a service or the live
 * workspace. Arcadia's parameter validation, Plan rendering, discovery, docs
 * sync, requirementIdentity, the dispatch gate and database reads run for real
 * (passthrough) against a throwaway workspace. Like the run-5 suites, run it
 * unsandboxed: the scripts' log tee needs /dev/fd.
 */
export const repoRoot = path.resolve(import.meta.dirname, "../..");
export const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
export const impl = path.join(library, "rehearsal-chain");
export const RUN6 = "run6-2026-10-06";
export const RUN7 = "run7-2026-10-06";
export const REPO = "pmark/arcadia-three-action-rehearsal-t1";
export const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const DECISION_0058 = "docs/decisions/0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md";
const PREV_RESET = "reset-three-action-rehearsal-fixture-run5-2026-10-06";
const PREV_G8 = "restore-terminal-off-three-action-rehearsal-run5-2026-10-06";
const PREV_G7 = "grant-production-three-action-rehearsal-run5-2026-10-06";
export const A1_BRANCH = "claude/write-start-marker-20261006T032202909Z";
export const A2_BRANCH = "claude/transform-start-marker-20261006T032821535Z";
const DESCRIPTION = "Disposable Arcadia three-Action rehearsal fixture (arcadia-three-action-rehearsal-v1); safe to delete after its recorded review.";
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");
export const implSource = (file: string) => readFileSync(path.join(impl, file), "utf8");
const constantOf = (id: string, name: string) => {
  const match = source(id).match(new RegExp(`^${name}=(?:'([^']*)'|"([^"$]*)")$`, "m"));
  if (!match) throw new Error(`${id} has no literal ${name}`);
  return match[1] ?? match[2];
};
const ORIGINAL_LINE = constantOf("reset-three-action-rehearsal-fixture-2026-10-05", "OLD_NEXT_ACTION");
const RUN5_LINE = constantOf(PREV_RESET, "NEW_NEXT_ACTION");

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

export type Reply = { stdout?: string; stderr?: string; status?: number; exec?: string; passthrough?: "probe" | "cli" };
export type Replies = Record<string, Reply | Reply[]>;

// Fake CLIs answer from a JSON table (longest matching key prefix); an array is consumed in
// order and its last entry repeats. Every call is appended to calls.log and its key to keys.log.
const FAKE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const root = process.env.FAKE_ROOT, name = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(path.join(root, "calls.log"), name + " " + JSON.stringify(args) + "\\n");
const replies = JSON.parse(fs.readFileSync(path.join(root, "replies.json"), "utf8"));
let key = name + " " + args.join(" ");
let program = "";
if (name === "mise") {
  const rest = args.slice(2);
  if (rest[0] === "pnpm") {
    const words = rest.slice(3).filter((a) => !a.startsWith("--"));
    key = "arcadia " + words.slice(0, 2).join(" ") + (words[0] === "advance" && words[1] === "queue" && words[2] === "arrange" ? " arrange" : "");
  }
  else if (rest.includes("tsx")) {
    program = fs.readFileSync(0, "utf8");
    const named = [["validateChainParams", "params"], ["runProductionStatusCommand", "production"], ["reconciliationProblems", "reconciliation"], ["getProjectMetadata", "registration"],
      ["renderChainPlan", "render"], ["amendmentProblems", "amendment"], ["session_role_attempts", "lineage"], ["decideFixtureStart", "decide"], ["readChainAskState", "asks"],
      ["completionIdProblems", "completion-ids"], ["fixtureSessions", "sessions"], ["classifyPreservedCandidate", "classify"], ["resolveOperatorGate", "operator-gate"],
      ["syncProjectDocs", "live-sync"], ["checkProviderSignIn", "claude"], ["observeCodexCapacityLive", "capacity"], ["listActiveAgentSessions", "leases"],
      ["buildAgentQueue", "queue-read"], ["planChainQueueOrder", "queue-plan"], ["chainQueueProblems", "queue-verify"]].find(([marker]) => program.includes(marker));
    key = "probe " + (named ? named[1] : "other");
  } else key = "node preflight";
}
fs.appendFileSync(path.join(root, "keys.log"), key + "\\n");
const match = Object.keys(replies).filter((k) => key.startsWith(k)).sort((a, b) => b.length - a.length)[0];
let reply = match === undefined ? { status: 97, stderr: "unexpected call: " + key } : replies[match];
if (Array.isArray(reply)) {
  const counter = path.join(root, "counter-" + Buffer.from(match).toString("hex"));
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  reply = reply[Math.min(n, reply.length - 1)];
}
if (reply.exec) reply = { ...reply, stdout: require("child_process").execSync(reply.exec, { encoding: "utf8", shell: "/bin/sh" }) };
if (reply.passthrough) {
  const env = { ...process.env };
  delete env.VITEST;
  const real = process.env.FAKE_ARCADIA_ROOT;
  const argv = reply.passthrough === "probe"
    ? ["--import", "tsx", "--input-type=module", "-", ...args.slice(args.indexOf("-") + 1)]
    : ["--import", "tsx", path.join(real, "src", "cli.ts"), ...args.slice(args.indexOf("arcadia") + 1), "--workspace", process.env.FAKE_WORKSPACE];
  const run = require("child_process").spawnSync(process.execPath, argv, { cwd: real, input: program, env, encoding: "utf8", timeout: 60000 });
  process.stdout.write(run.stdout || "");
  process.stderr.write(run.stderr || "");
  // Not process.exit: a large answer (the real queue is over a pipe's 64 KB) must drain before the fake exits.
  process.exitCode = run.status === null ? 98 : run.status;
  return;
}
if (reply.stdout) process.stdout.write(reply.stdout.replace(/[{][{]arg:([^}]+)[}][}]/g, (_m, flag) => args[args.indexOf(flag) + 1] ?? ""));
if (reply.stderr) process.stderr.write(reply.stderr);
process.exit(reply.status ?? 0);
`;

export function git(cwd: string, args: string[]) {
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

/** A throwaway Arcadia checkout whose library holds this run's launchers, descriptors, the shared implementation and a parameter file. */
export function sandbox(runId: string, options: { clone?: boolean } = {}) {
  const root = temp("arcadia-chain-pair-");
  const checkout = path.join(root, "arcadia");
  const scripts = path.join(checkout, "artifacts", "generated", "operator-scripts");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const workspace = path.join(root, "martianrover");
  let checkoutHead: string;
  if (options.clone) {
    // A self-contained checkout (no history of this repository is needed, so it works in a shallow
    // CI clone) carrying the Decision 0058 record G7 reads, with origin pointing at itself so G6's and
    // G7's level-with-origin and ls-remote checks run for real. The required-commit floor's own commits
    // are not objects here: the box git answers only `merge-base --is-ancestor <floor commit> HEAD` in
    // this checkout (recording each such check in floor.log, which the test asserts), and runs every
    // other command for real.
    mkdirSync(path.join(checkout, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(checkout, ".gitignore"), "artifacts/\n");
    writeFileSync(path.join(checkout, "PROJECT.md"), CHECKOUT_PROJECT);
    copyFileSync(path.join(repoRoot, DECISION_0058), path.join(checkout, DECISION_0058));
    git(checkout, ["init", "-q", "-b", "main"]);
    checkoutHead = commitAll(checkout, "init");
    git(checkout, ["remote", "add", "origin", checkout]);
    git(checkout, ["fetch", "-q", "origin"]);
  } else {
    mkdirSync(checkout, { recursive: true });
    writeFileSync(path.join(checkout, ".gitignore"), "artifacts/\n");
    writeFileSync(path.join(checkout, "PROJECT.md"), CHECKOUT_PROJECT);
    git(checkout, ["init", "-q", "-b", "main"]);
    checkoutHead = commitAll(checkout, "init");
    git(root, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
    git(checkout, ["remote", "add", "origin", path.join(root, "origin.git")]);
    git(checkout, ["push", "-q", "-u", "origin", "main"]);
  }
  mkdirSync(path.join(scripts, "rehearsal-chain", "params"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(home);
  const ids = chainLibraryIds(runId);
  for (const kind of CHAIN_KINDS) {
    for (const ext of ["sh", "json"]) copyFileSync(path.join(library, `${ids[kind]}.${ext}`), path.join(scripts, `${ids[kind]}.${ext}`));
    chmodSync(path.join(scripts, `${ids[kind]}.sh`), 0o755);
    copyFileSync(path.join(impl, CHAIN_IMPLEMENTATION[kind]), path.join(scripts, "rehearsal-chain", CHAIN_IMPLEMENTATION[kind]));
    chmodSync(path.join(scripts, "rehearsal-chain", CHAIN_IMPLEMENTATION[kind]), 0o755);
  }
  for (const tool of ["mise", "gh", "codex", "pnpm"]) writeFileSync(path.join(bin, tool), FAKE, { mode: 0o755 });
  // Real Git for everything except `push`, which is recorded (marking GitHub main as moved) and never reaches a network.
  writeFileSync(path.join(bin, "git"), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = push ]; then printf 'git %s\\n' "$*" >> "$FAKE_ROOT/calls.log"; echo push >> "$FAKE_ROOT/keys.log"; touch "$FAKE_ROOT/pushed"; exit 0; fi; done\n`
    + `if [ -n "$FAKE_FLOOR" ] && [ $# -eq 6 ] && [ "$1" = -C ] && [ "$2" = "$FAKE_CHECKOUT" ] && [ "$3" = merge-base ] && [ "$4" = --is-ancestor ] && [ "$6" = HEAD ]; then case " $FAKE_FLOOR " in *" $5 "*) echo "$5" >> "$FAKE_ROOT/floor.log"; exit 0;; esac; fi\n`
    + `exec ${JSON.stringify(REAL_GIT)} "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  for (const file of ["calls.log", "keys.log"]) writeFileSync(path.join(root, file), "");
  writeFileSync(path.join(root, "replies.json"), "{}");
  const tmp = path.join(root, "tmp");
  mkdirSync(tmp);
  const run = (id: string, env: Record<string, string | undefined> = {}, args = ["run"]) => {
    const floor = options.clone ? { FAKE_FLOOR: Object.keys(REQUIRED_COMMIT_FLOOR).join(" "), FAKE_CHECKOUT: realpathSync(checkout) } : {};
    const childEnv: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp, FAKE_ROOT: root, FAKE_ARCADIA_ROOT: repoRoot, FAKE_WORKSPACE: workspace, ...floor, ...env };
    for (const key of ["CODEX_SANDBOX", "ARCADIA_OPERATOR_SCRIPT_ID", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", "ANTHROPIC_API_KEY", "ARCADIA_REHEARSAL_GITHUB_REPO", "ARCADIA_WORKSPACE", "ARCADIA_REHEARSAL_RECEIPTS_DIR"]) {
      if (!(key in env)) delete childEnv[key];
    }
    return spawnSync("bash", [path.join(scripts, `${id}.sh`), ...args], { env: childEnv, encoding: "utf8", timeout: 240_000, input: "" });
  };
  const runDirs = () => existsSync(path.join(scripts, "runs")) ? readdirSync(path.join(scripts, "runs")).sort().map((d) => path.join(scripts, "runs", d)) : [];
  const receipts = (id: string) => runDirs().filter((d) => existsSync(path.join(d, "receipt.json")))
    .map((d) => ({ dir: d, json: JSON.parse(readFileSync(path.join(d, "receipt.json"), "utf8")) })).filter((r) => r.json.id === id);
  const receipt = (id: string) => { const own = receipts(id); if (own.length === 0) throw new Error(`no ${id} receipt`); return own[own.length - 1]; };
  const keys = () => readFileSync(path.join(root, "keys.log"), "utf8").trim().split("\n").filter(Boolean);
  const pushes = () => readFileSync(path.join(root, "calls.log"), "utf8").split("\n").filter((line) => line.startsWith("git "));
  const setReplies = (replies: Replies) => {
    for (const file of readdirSync(root).filter((f) => f.startsWith("counter-"))) rmSync(path.join(root, file));
    writeFileSync(path.join(root, "replies.json"), JSON.stringify(replies));
  };
  const fixture = path.join(home, "tmp", "arcadia-three-action-rehearsal");
  /** Commit the library (force-added: artifacts/ is ignored), as a reviewed merge would. */
  const commitLibrary = () => {
    git(checkout, ["add", "-f", "artifacts/generated/operator-scripts"]);
    if (spawnSync("git", ["-C", checkout, "diff", "--cached", "--quiet"]).status !== 0) git(checkout, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", "library"]);
    if (options.clone) git(checkout, ["fetch", "-q", "origin"]);
    else git(checkout, ["push", "-q", "origin", "main"]);
    return git(checkout, ["rev-parse", "HEAD"]);
  };
  return { root, checkout, checkoutHead, commitLibrary, scripts, home, workspace, fixture, tmp, ids, run, runDirs, receipts, receipt, keys, pushes, setReplies };
}
export type Box = ReturnType<typeof sandbox>;
export const ok = (data: unknown): Reply => ({ stdout: JSON.stringify({ ok: true, data }) });
export const status = (desiredState: string, extra: Record<string, unknown> = {}, policy: Record<string, unknown> = {}) => ok({
  read: { status: "ok", policy: { desiredState, revision: 33, epoch: 3, authority: null, ...policy } }, liveAdmissions: 0, ...extra
});

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
const identityOf = (root: string, index: number) => {
  const plan = discoverDocs(root).docs.find((doc) => doc.type === "plan");
  if (plan?.type !== "plan") throw new Error("no Plan");
  return requirementIdentity({ projectSlug: "three-action-rehearsal", planSlug: "autonomous-three-action-rehearsal", action: plan.actions[index] });
};

/**
 * Run 5's terminal state in the box: G1's genesis registered (real import, metadata and docs
 * sync), run 5's reset commit on it (the base GitHub main holds), Action 1's candidate (marker and
 * settlement) integrated by local fast-forward of the clone's main only, Action 2's candidate on
 * top of it, both with passed development attempts, and run 5's reset and G8 receipts with the
 * G8's work reconciliation.
 */
export function afterRun5(box: Box, options: { actionCount?: number; extraLocalCommit?: boolean; runId?: string; projectText?: (text: string) => string } = {}) {
  initWorkspace(box.workspace);
  const fixture = box.fixture;
  mkdirSync(fixture, { recursive: true });
  renderG1Fixture(fixture);
  git(fixture, ["init", "-q", "-b", "main"]);
  const genesis = commitAll(fixture, "Bootstrap three-Action rehearsal fixture");
  git(fixture, ["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  const imported = runProjectImportCommand({ workspace: box.workspace, name: "Three Action Rehearsal", mission: "Disposable three-Action rehearsal fixture.", status: "active", milestone: "Run the bounded three-Action rehearsal", nextAction: "Import fixture documents", classification: "agent" });
  const projectId = imported.data.project.id;
  runProjectMetadataCommand({ workspace: box.workspace, projectId, repoPath: fixture, validationCommands: ["node scripts/check-rehearsal.mjs"] });
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-project-id"), `${projectId}\n`);
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-first-packet-approval"), "review_1\n");
  const plan = readFileSync(path.join(fixture, PLAN_FILE), "utf8");
  writeFileSync(path.join(fixture, PLAN_FILE), plan.replace(ORIGINAL_LINE, RUN5_LINE).replace(/^updated: \d{4}-\d{2}-\d{2}$/m, "updated: 2026-10-06"));
  if (options.projectText) writeFileSync(path.join(fixture, "PROJECT.md"), options.projectText(readFileSync(path.join(fixture, "PROJECT.md"), "utf8")));
  const base = commitAll(fixture, "Reset write-start-marker for three-Action rehearsal run 5");
  expect((runDocsSyncCommand({ workspace: box.workspace, project: "three-action-rehearsal", apply: true }).data as unknown as { errorCount: number }).errorCount).toBe(0);
  const a1Identity = identityOf(fixture, 0);
  const a2Identity = identityOf(fixture, 1);
  git(fixture, ["checkout", "-q", "-b", A1_BRANCH]);
  writeFileSync(path.join(fixture, "MARKER.md"), "three-action rehearsal start\n");
  commitAll(fixture, "Add MARKER.md (run 5)");
  mkdirSync(path.join(fixture, ".arcadia", "asks", "archive"), { recursive: true });
  writeFileSync(path.join(fixture, ".arcadia", "asks", "archive", "agent-ask-complete-write-start-marker-run5-2026-10-06.yaml"), "agent_ask: v1\n");
  const a1Tip = commitAll(fixture, "chore(arcadia): settle complete-write-start-marker-run5-2026-10-06");
  git(fixture, ["checkout", "-q", "-b", A2_BRANCH]);
  writeFileSync(path.join(fixture, "MARKER.md"), "three-action rehearsal start\nTHREE-ACTION REHEARSAL START\n");
  const a2Tip = commitAll(fixture, "Append transformed start marker");
  git(fixture, ["checkout", "-q", "main"]);
  // Action 1 integrated by local fast-forward only.
  git(fixture, ["merge", "-q", "--ff-only", A1_BRANCH]);
  let localMain = a1Tip;
  if (options.extraLocalCommit) {
    writeFileSync(path.join(fixture, "STRAY.md"), "not on any candidate\n");
    localMain = commitAll(fixture, "Unpreserved local commit");
  }
  withDatabase(box.workspace, (db) => {
    const pass = (requirement: typeof a1Identity, requestId: string, tip: string, sessionId: string) => {
      const attempt = beginDevelopmentAttempt(db, { requirement, requestId, retryAuthorized: true, now: new Date("2026-10-06T03:22:00.000Z") }).attempt;
      recordSessionRoleAttemptTerminal(db, { requestId: attempt.request_id, actorId: attempt.actor_id, status: "passed", targetHead: tip, receipt: { sessionId }, now: new Date("2026-10-06T03:27:00.000Z") });
    };
    pass(a1Identity, "worker-tick-run-5-a1", a1Tip, "session_run5_a1");
    pass(a2Identity, "worker-tick-run-5-a2", a2Tip, "session_run5_a2");
  });
  const writeReceipt = (dir: string, json: Record<string, unknown>) => {
    mkdirSync(path.join(box.scripts, "runs", dir), { recursive: true });
    writeFileSync(path.join(box.scripts, "runs", dir, "receipt.json"), JSON.stringify(json));
    return realpathSync(path.join(box.scripts, "runs", dir, "receipt.json"));
  };
  writeReceipt("20261004T165157Z-6269", { id: G1, outcome: "succeeded", githubRepository: REPO, rootCommit: genesis });
  writeReceipt("20261006T031820Z-74070", { id: PREV_RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: fixture, genesis, newHead: base, remoteMainAfter: base });
  writeReceipt("20261006T033451Z-43195", { id: PREV_G8, runId: "20261006T033451Z-43195", outcome: "succeeded", stage: "complete", offState: "confirmed", fixtureMain: localMain });
  writeFileSync(path.join(box.scripts, "runs", "20261006T033451Z-43195", "work-reconciliation.jsonl"), [
    { session: "session_run5_a1", action: "write-start-marker", state: options.extraLocalCommit ? "integrated" : "integrated", tip: a1Tip, branch: A1_BRANCH, pullRequest: `https://github.com/${REPO}/pull/5`, preservedCommit: a1Tip },
    { session: "session_run5_a2", action: "transform-start-marker", state: "preserved", tip: a2Tip, branch: A2_BRANCH, pullRequest: `https://github.com/${REPO}/pull/6`, preservedCommit: a2Tip }
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  const runId = options.runId ?? RUN6;
  const params = {
    schema: "arcadia-rehearsal-chain-run-v1", runId, runLabel: `run ${runId.slice(3, 4)}`, actionCount: options.actionCount ?? 3,
    requiredCommits: Object.entries(REQUIRED_COMMIT_FLOOR).map(([commit, why]) => ({ commit, why })),
    previousRun: {
      label: "run 5", resetId: PREV_RESET, terminalOffId: PREV_G8, grantId: PREV_G7,
      bindings: { resetRunId: "20261006T031820Z-74070", resetHead: base, terminalOffRunId: "20261006T033451Z-43195", localMain,
        candidates: [{ branch: A1_BRANCH, tip: a1Tip, pullRequest: 5 }, { branch: A2_BRANCH, tip: a2Tip, pullRequest: 6 }] }
    }
  };
  writeParams(box, runId, params);
  box.setReplies(resetReplies(box, { base, a1Tip, a2Tip }));
  return { genesis, base, a1Tip, a2Tip, localMain, params, projectId };
}
/** Run 7's reviewed file as it was before run 6's receipts existed: every previous-run binding UNFILLED (fail-closed). */
export const unfilledRun7 = () => {
  const params = JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8"));
  Object.assign(params.previousRun.bindings, { resetRunId: "UNFILLED: x", resetHead: "UNFILLED: x", terminalOffRunId: "UNFILLED: x", localMain: "UNFILLED: x" });
  params.previousRun.bindings.candidates.push({ branch: "UNFILLED: x", tip: "UNFILLED", pullRequest: "UNFILLED" });
  return params;
};
export const writeParams = (box: Box, runId: string, params: unknown, commit = true) => {
  writeFileSync(path.join(box.scripts, "rehearsal-chain", "params", `${runId}.json`), JSON.stringify(params, null, 2));
  if (commit) box.commitLibrary();
};
export const resetReplies = (box: Box, state: { base: string; a1Tip: string; a2Tip: string }): Replies => ({
  "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
  "arcadia production status": status("inactive"),
  "probe": { passthrough: "probe" },
  "arcadia docs sync": { passthrough: "cli" },
  "arcadia work list": { passthrough: "cli" },
  "gh api user": { stdout: "pmark\n" },
  [`gh repo view ${REPO}`]: { stdout: JSON.stringify({ name: "arcadia-three-action-rehearsal-t1", owner: { login: "pmark" }, visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, description: DESCRIPTION }) },
  // GitHub main stays at the base until the fake push, then follows the clone's local main.
  [`gh api repos/${REPO}/commits/main`]: { exec: `if [ -f "$FAKE_ROOT/pushed" ]; then git -C "$HOME/tmp/arcadia-three-action-rehearsal" rev-parse refs/heads/main; else echo ${state.base}; fi` },
  [`gh api repos/${REPO}/branches/${A1_BRANCH}`]: { stdout: `${state.a1Tip}\n` },
  [`gh api repos/${REPO}/pulls/5`]: { stdout: JSON.stringify({ state: "open", head: { ref: A1_BRANCH, sha: state.a1Tip }, base: { ref: "main" } }) },
  [`gh api repos/${REPO}/branches/${A2_BRANCH}`]: { stdout: `${state.a2Tip}\n` },
  [`gh api repos/${REPO}/pulls/6`]: { stdout: JSON.stringify({ state: "open", head: { ref: A2_BRANCH, sha: state.a2Tip }, base: { ref: "main" } }) },
  "arcadia advance queue": { passthrough: "cli" }
});
export const resetEnv = { ARCADIA_REHEARSAL_GITHUB_REPO: REPO };
export const unchanged = (box: Box, localMain: string) => {
  expect(box.pushes()).toEqual([]);
  expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(localMain);
  expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
  expect(box.keys().filter((k) => k.startsWith("arcadia docs sync"))).toEqual([]);
};

export const writeG7Receipt = (box: Box, actionIds: string[], dir = "20261006T230000Z-1", fields: Record<string, unknown> = { outcome: "succeeded", stage: "complete", activated: true }) => {
  mkdirSync(path.join(box.scripts, "runs", dir), { recursive: true });
  writeFileSync(path.join(box.scripts, "runs", dir, "receipt.json"), JSON.stringify({ id: box.ids.grant, runId: dir, chainRunId: RUN7, actionIds, ...fields }));
  return realpathSync(path.join(box.scripts, "runs", dir, "receipt.json"));
};

/** Every answer G6 needs from the box's fake CLIs once the reset has pushed: all passing, the queue and capacity read for real or by the fakes below. */
export const CODEX_ANSWER = [
  JSON.stringify({ id: 1, result: { userAgent: "codex" } }),
  JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: { usedPercent: 30, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86_400 }, planType: "plus" } } })
].join("\n") + "\n";
export const liveRead = (attempt = 1) => ({ ok: true, maxAttempts: 3, deadlineMs: 20_000, attempts: [...Array.from({ length: attempt - 1 }, (_, i) => ({ attempt: i + 1, ok: false, failure: { kind: "timeout", exitStatus: null, signal: "SIGTERM", detail: "did not answer" } })), { attempt, ok: true }] });
export function chainG6Replies(box: Box, state: { base: string; a1Tip: string; a2Tip: string }, newHead: string, head: string): Replies {
  return {
    ...resetReplies(box, state),
    [`gh api repos/${REPO}/commits/main`]: { stdout: `${newHead}\n` },
    "arcadia go-broker status": ok({ ready: true, revision: head, preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
    "arcadia worker status": { stdout: "Worker: running (fresh heartbeat)\n" },
    "probe claude": { stdout: JSON.stringify({ verdict: "signed_in" }) },
    "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_review"], liveRead: liveRead(), codex: { admitted: true, freshness: "fresh", confidence: "observed", usagePolicy: "included", evidence: "real", availability: "available", unattendedProof: "observed" } }) },
    "codex --version": { stdout: "codex 1.0\n" },
    "codex login status": { stdout: "Logged in using ChatGPT\n" },
    "gh auth status": { stdout: "ok\n" },
    [`gh api repos/${REPO}`]: { stdout: JSON.stringify({ private: true, archived: false, fork: false, permissions: { push: true }, default_branch: "main" }) },
    [`gh api repos/${REPO}/branches/main`]: { stdout: JSON.stringify({ commit: { sha: newHead }, protected: false }) },
    [`gh api repos/${REPO}/commits/${newHead}/check-runs`]: { stdout: JSON.stringify({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] }) }
  };
}
