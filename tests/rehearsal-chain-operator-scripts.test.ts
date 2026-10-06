import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { runProjectImportCommand, runProjectMetadataCommand } from "../src/commands/project.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { recordSessionRoleAttemptTerminal } from "../src/sessions/enrollment.js";
import { beginDevelopmentAttempt, requirementIdentity } from "../src/sessions/roleLineage.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { CHAIN_IMPLEMENTATION, CHAIN_KINDS, chainActionIds, chainLibraryIds, completionRequestId } from "../src/operatorActions/rehearsalChain.js";

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
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const impl = path.join(library, "rehearsal-chain");
const RUN6 = "run6-2026-10-06";
const RUN7 = "run7-2026-10-06";
const REPO = "pmark/arcadia-three-action-rehearsal-t1";
const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const PREV_RESET = "reset-three-action-rehearsal-fixture-run5-2026-10-06";
const PREV_G8 = "restore-terminal-off-three-action-rehearsal-run5-2026-10-06";
const PREV_G7 = "grant-production-three-action-rehearsal-run5-2026-10-06";
const A1_BRANCH = "claude/write-start-marker-20261006T032202909Z";
const A2_BRANCH = "claude/transform-start-marker-20261006T032821535Z";
const DESCRIPTION = "Disposable Arcadia three-Action rehearsal fixture (arcadia-three-action-rehearsal-v1); safe to delete after its recorded review.";
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");
const implSource = (file: string) => readFileSync(path.join(impl, file), "utf8");
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

type Reply = { stdout?: string; stderr?: string; status?: number; exec?: string; passthrough?: "probe" | "cli" };
type Replies = Record<string, Reply | Reply[]>;

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
  if (rest[0] === "pnpm") key = "arcadia " + rest.slice(3).filter((a) => !a.startsWith("--")).slice(0, 2).join(" ");
  else if (rest.includes("tsx")) {
    program = fs.readFileSync(0, "utf8");
    const named = [["validateChainParams", "params"], ["runProductionStatusCommand", "production"], ["reconciliationProblems", "reconciliation"], ["getProjectMetadata", "registration"],
      ["renderChainPlan", "render"], ["amendmentProblems", "amendment"], ["session_role_attempts", "lineage"], ["decideFixtureStart", "decide"], ["readChainAskState", "asks"],
      ["completionIdProblems", "completion-ids"], ["fixtureSessions", "sessions"], ["classifyPreservedCandidate", "classify"], ["resolveOperatorGate", "operator-gate"],
      ["syncProjectDocs", "live-sync"], ["checkProviderSignIn", "claude"], ["observeProviderCapacity", "capacity"], ["listActiveAgentSessions", "leases"]].find(([marker]) => program.includes(marker));
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
  process.exit(run.status === null ? 98 : run.status);
}
if (reply.stdout) process.stdout.write(reply.stdout);
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

/** A throwaway Arcadia checkout whose library holds this run's launchers, descriptors, the shared implementation and a parameter file. */
function sandbox(runId: string) {
  const root = temp("arcadia-chain-pair-");
  const checkout = path.join(root, "arcadia");
  const scripts = path.join(checkout, "artifacts", "generated", "operator-scripts");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const workspace = path.join(root, "martianrover");
  mkdirSync(path.join(scripts, "rehearsal-chain", "params"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(path.join(checkout, ".gitignore"), "artifacts/\n");
  writeFileSync(path.join(checkout, "PROJECT.md"), CHECKOUT_PROJECT);
  git(checkout, ["init", "-q", "-b", "main"]);
  const checkoutHead = commitAll(checkout, "init");
  git(root, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
  git(checkout, ["remote", "add", "origin", path.join(root, "origin.git")]);
  git(checkout, ["push", "-q", "-u", "origin", "main"]);
  const ids = chainLibraryIds(runId);
  for (const kind of CHAIN_KINDS) {
    for (const ext of ["sh", "json"]) copyFileSync(path.join(library, `${ids[kind]}.${ext}`), path.join(scripts, `${ids[kind]}.${ext}`));
    chmodSync(path.join(scripts, `${ids[kind]}.sh`), 0o755);
    copyFileSync(path.join(impl, CHAIN_IMPLEMENTATION[kind]), path.join(scripts, "rehearsal-chain", CHAIN_IMPLEMENTATION[kind]));
    chmodSync(path.join(scripts, "rehearsal-chain", CHAIN_IMPLEMENTATION[kind]), 0o755);
  }
  for (const tool of ["mise", "gh", "codex", "pnpm"]) writeFileSync(path.join(bin, tool), FAKE, { mode: 0o755 });
  // Real Git for everything except `push`, which is recorded (marking GitHub main as moved) and never reaches a network.
  writeFileSync(path.join(bin, "git"), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = push ]; then printf 'git %s\\n' "$*" >> "$FAKE_ROOT/calls.log"; echo push >> "$FAKE_ROOT/keys.log"; touch "$FAKE_ROOT/pushed"; exit 0; fi; done\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  for (const file of ["calls.log", "keys.log"]) writeFileSync(path.join(root, file), "");
  writeFileSync(path.join(root, "replies.json"), "{}");
  const tmp = path.join(root, "tmp");
  mkdirSync(tmp);
  const run = (id: string, env: Record<string, string | undefined> = {}, args = ["run"]) => {
    const childEnv: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp, FAKE_ROOT: root, FAKE_ARCADIA_ROOT: repoRoot, FAKE_WORKSPACE: workspace, ...env };
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
  return { root, checkout, checkoutHead, scripts, home, workspace, fixture, tmp, ids, run, runDirs, receipts, receipt, keys, pushes, setReplies };
}
type Box = ReturnType<typeof sandbox>;
const ok = (data: unknown): Reply => ({ stdout: JSON.stringify({ ok: true, data }) });
const status = (desiredState: string, extra: Record<string, unknown> = {}, policy: Record<string, unknown> = {}) => ok({
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
function afterRun5(box: Box, options: { actionCount?: number; extraLocalCommit?: boolean; runId?: string } = {}) {
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
    requiredCommits: [{ commit: box.checkoutHead, why: "the box checkout's own commit" }],
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
const writeParams = (box: Box, runId: string, params: unknown) => writeFileSync(path.join(box.scripts, "rehearsal-chain", "params", `${runId}.json`), JSON.stringify(params, null, 2));
const resetReplies = (box: Box, state: { base: string; a1Tip: string; a2Tip: string }): Replies => ({
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
  [`gh api repos/${REPO}/pulls/5`]: { stdout: JSON.stringify({ state: "open", head: { ref: A1_BRANCH, sha: state.a1Tip } }) },
  [`gh api repos/${REPO}/branches/${A2_BRANCH}`]: { stdout: `${state.a2Tip}\n` },
  [`gh api repos/${REPO}/pulls/6`]: { stdout: JSON.stringify({ state: "open", head: { ref: A2_BRANCH, sha: state.a2Tip } }) }
});
const resetEnv = { ARCADIA_REHEARSAL_GITHUB_REPO: REPO };
const unchanged = (box: Box, localMain: string) => {
  expect(box.pushes()).toEqual([]);
  expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(localMain);
  expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
  expect(box.keys().filter((k) => k.startsWith("arcadia docs sync"))).toEqual([]);
};

describe("rehearsal-chain set: static safety", () => {
  const files = Object.values(CHAIN_IMPLEMENTATION);
  it.each(files)("%s contains no kill, recursive delete, repository delete, force push, history rewrite, pull-request write, Agent Ask settlement or exported workspace", (file) => {
    const text = implSource(file);
    for (const pattern of [/\bkill\b/, /\bpkill\b/, /rm -rf/, /gh repo delete/, /--force\b/, /push\s+(-\S+\s+)*-f\b/, /\+refs\//, /reset --hard/, /\breset --/, /worktree remove/, /branch -[Dfd]\b/, /production reactivate/, /gh pr (merge|close|edit|comment|ready)/, /rebase/, /export ARCADIA_WORKSPACE/, /agent[-_]ask/, /--disposition/, /settleAgentAsk|runAgentAskSettleCommand/]) {
      expect(text, `${file} must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it("only the G7 previews or activates production; G8 alone deactivates (G7 only to undo its own failed activation)", () => {
    for (const file of ["reset.sh", "preflight.sh"]) expect(implSource(file)).not.toMatch(/production (preview|activate|deactivate)/);
    expect(implSource("restore-terminal-off.sh")).not.toMatch(/production (preview|activate)/);
    expect(implSource("grant.sh").split("\n").filter((line) => /arcadia production activate/.test(line))).toHaveLength(1);
  });

  it("the reset pushes only fixture main without force, commits once, moves local main only by compare-and-swap, and validates before any change", () => {
    const text = implSource("reset.sh");
    const pushes = text.split("\n").filter((line) => /\bpush\b/.test(line) && /\bgit\b|\bfx\b/.test(line) && !line.trim().startsWith("#") && !line.includes("echo") && !/refuse "|RECOVERY=/.test(line));
    expect(pushes).toEqual(['  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main']);
    expect(text.split("\n").filter((line) => /\bcommit -q\b/.test(line))).toHaveLength(1);
    // The only ref-moving Git commands: the compare-and-swap move, the working tree following it, and the compare-and-swap undo.
    const refMoves = text.split("\n").filter((line) => !line.trim().startsWith("#") && !/RECOVERY=/.test(line)
      && /\b(fx|git(\s+-C\s+\S+)?)\s+(update-ref|read-tree|checkout|switch|reset|merge(?!-base)|cherry-pick|branch\s+-[fFdDmM]|tag|symbolic-ref\s+HEAD\s+\S)/.test(line));
    expect(refMoves.map((line) => (line.match(/\bfx (update-ref|read-tree) .*$/) ?? [""])[0].slice(0, 50))).toEqual([
      'fx update-ref -m "$SCRIPT_ID: move local main back',
      'fx read-tree -m -u "$LOCAL_MAIN" "$RESET_HEAD"; th',
      'fx update-ref -m "$SCRIPT_ID: undo the local main '
    ]);
    expect(text).toContain('refs/heads/main "$RESET_HEAD" "$LOCAL_MAIN"');
    expect(text).toContain('fx read-tree -m -u "$LOCAL_MAIN" "$RESET_HEAD"');
    const order = ['< "$RUN_DIR/params.mjs"', '< "$RUN_DIR/reconciliation.mjs"', "check_candidates before", '< "$RUN_DIR/render.mjs"', '< "$RUN_DIR/validate-amendment.mjs"', '< "$RUN_DIR/probe-lineage.mjs"', '< "$RUN_DIR/decide.mjs"', '< "$RUN_DIR/probe-live-sync.mjs"', '< "$RUN_DIR/probe-asks.mjs"', '< "$RUN_DIR/completion-ids.mjs"', 'if [[ "$DRY_RUN" == true ]]; then\n  STAGE=dry_run_report', "fx update-ref", "commit -q -m", "push -q origin", "SYNC=\"$(arcadia docs sync"];
    const at = order.map((marker) => text.indexOf(marker));
    expect(at.every((index) => index > -1), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The workspace is never exported or set, and the receipts override is dry-run only.
    expect(text).not.toMatch(/ARCADIA_WORKSPACE=/);
    expect(text).toContain('[[ "$DRY_RUN" == true ]] || refuse "ARCADIA_REHEARSAL_RECEIPTS_DIR is honoured only by --dry-run');
  });

  it("every implementation binds its launcher exactly as the TypeScript renderer writes it", () => {
    for (const kind of CHAIN_KINDS) {
      const text = implSource(CHAIN_IMPLEMENTATION[kind]);
      expect(text).toContain(`IMPL_FILE="${CHAIN_IMPLEMENTATION[kind]}"`);
      expect(text).toContain('"# Rehearsal chain $RUN_PARAM_ID: runs the shared $IMPL_FILE with this run\'s reviewed parameter file and nothing else."');
    }
  });
});

describe("rehearsal-chain set: launchers", () => {
  it.each(CHAIN_KINDS)("%s: --describe prints the descriptor; another entrypoint, a direct run or another parameter file refuses with nothing written", (kind) => {
    const box = sandbox(RUN6);
    const id = box.ids[kind];
    writeParams(box, RUN6, JSON.parse(readFileSync(path.join(impl, "params", `${RUN6}.json`), "utf8")));
    const described = box.run(id, {}, ["--describe"]);
    expect(described.status, described.stderr).toBe(0);
    expect(JSON.parse(described.stdout)).toEqual(JSON.parse(readFileSync(path.join(library, `${id}.json`), "utf8")));
    expect(box.run(id, {}, ["apply"]).status).toBe(2);
    if (kind !== "reset") expect(box.run(id, {}, ["--dry-run"]).status).toBe(2);
    const direct = spawnSync("bash", [path.join(box.scripts, "rehearsal-chain", CHAIN_IMPLEMENTATION[kind]), path.join(box.root, `${RUN6}.json`), "--describe"], { encoding: "utf8" });
    expect(direct.status).toBe(2);
    expect(direct.stderr).toContain("per-run library launcher");
    // A tampered launcher is not this run's published entry.
    writeFileSync(path.join(box.scripts, `${id}.sh`), readFileSync(path.join(box.scripts, `${id}.sh`), "utf8") + "echo extra\n");
    const tampered = box.run(id, {}, ["--describe"]);
    expect(tampered.status).toBe(2);
    expect(tampered.stderr).toContain("not published in this library");
    expect(box.runDirs()).toEqual([]);
  });
});

describe("rehearsal-chain reset", () => {
  it("--dry-run prints the exact planned change against run 5's terminal state and writes nothing", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    const result = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("== DRY RUN: planned fixture change for run 6");
    expect(result.stdout).toContain(`Step 1: move ONLY the clone's local main from ${state.a1Tip} back to GitHub main ${state.base}`);
    expect(result.stdout).toContain(`${A1_BRANCH} (PR #5`);
    expect(result.stdout).toContain(`${A2_BRANCH} (PR #6`);
    expect(result.stdout).toContain(`one commit 'Reset the rehearsal fixture as a 3-Action serial chain for rehearsal run 6' on ${state.base}`);
    for (const id of chainActionIds(3)) expect(result.stdout).toContain(`${id}: completion ${completionRequestId(id, RUN6)}`);
    expect(result.stdout).toContain("+    next_action: Implement MARKER.md containing exactly the line");
    expect(result.stdout).toContain("DRY RUN: no refusal");
    unchanged(box, state.a1Tip);
    // Nothing in the library (its evidence went to a temporary directory), and no CLI production read.
    expect(box.runDirs().map((d) => path.basename(d)).sort()).toEqual(["20261004T165157Z-6269", "20261006T031820Z-74070", "20261006T033451Z-43195"]);
    expect(box.keys().filter((k) => k.startsWith("arcadia production"))).toEqual([]);
    const evidence = readdirSync(box.tmp).filter((d) => d.startsWith("rehearsal-chain-dry-run."));
    expect(evidence).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(box.tmp, evidence[0], "receipt.json"), "utf8"))).toMatchObject({ outcome: "dry_run_ready", mode: "--dry-run", resetState: "move_local_main" });
  });

  it.each([3, 9])("N=%i: moves only local main back, commits the validated chain once, pushes without force, syncs and records the receipt; a rerun refuses", { timeout: 300_000 }, (n) => {
    const runId = n === 3 ? RUN6 : RUN7;
    const box = sandbox(runId);
    const state = afterRun5(box, { actionCount: n, runId });
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const newHead = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    expect(git(box.fixture, ["rev-parse", "refs/heads/main^"])).toBe(state.base);
    expect(git(box.fixture, ["diff", "--name-only", state.base, newHead])).toBe(PLAN_FILE);
    expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
    // The earlier candidates are untouched; f68ec48's stand-in is still on its branch.
    expect(git(box.fixture, ["rev-parse", `refs/heads/${A1_BRANCH}`])).toBe(state.a1Tip);
    expect(git(box.fixture, ["rev-parse", `refs/heads/${A2_BRANCH}`])).toBe(state.a2Tip);
    expect(git(box.fixture, ["reflog", "-1", "--format=%gs", "refs/heads/main@{1}"])).toContain("move local main back to GitHub main");
    expect(box.pushes()).toEqual(["git -C " + box.fixture + " push -q origin refs/heads/main:refs/heads/main"]);
    const { json } = box.receipt(box.ids.reset);
    expect(json).toMatchObject({
      outcome: "succeeded", chainRunId: runId, actionCount: n, newHead, remoteMainAfter: newHead, previousMain: state.base, startingHead: state.a1Tip, localMainBefore: state.a1Tip,
      genesis: state.genesis, githubRepository: REPO, fixtureCommitted: true, localMainMoved: true, githubRepositoryChanged: true, agentAskSettled: false,
      actionIds: chainActionIds(n), completionIds: chainActionIds(n).map((id) => completionRequestId(id, runId)),
      localMainMove: { from: state.a1Tip, to: state.base }
    });
    expect(json.localMainPreservedOn.map((c: { pullRequest: number }) => c.pullRequest)).toEqual([5, 6]);
    expect(json.candidatesAfter).toEqual(json.candidatesBefore);
    expect(json.actions).toHaveLength(n);
    expect(json.actions.slice(0, 3).every((a: { inputRevisionBefore: string; inputRevisionAfter: string }) => a.inputRevisionBefore && a.inputRevisionBefore !== a.inputRevisionAfter)).toBe(true);
    expect(json.actions.slice(3).every((a: { inputRevisionBefore: string | null }) => a.inputRevisionBefore === null)).toBe(true);
    expect(json.liveSyncPreview.map((c: { action: string }) => c.action)).toEqual([...Array(3).fill("update"), ...Array(n - 3).fill("create")]);
    const plan = discoverDocs(box.fixture).docs.find((doc) => doc.type === "plan");
    expect(plan?.type === "plan" && plan.actions.map((a) => a.id)).toEqual(chainActionIds(n));
    // Once is enough.
    const again = box.run(box.ids.reset, resetEnv);
    expect(again.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json.reason).toContain("already succeeded");
    expect(box.pushes()).toHaveLength(1);
  });

  it("refuses, moving nothing, when the integrated local main is not on any earlier candidate", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box, { extraLocalCommit: true });
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "fixture_state", localMainMoved: false, fixtureCommitted: false });
    expect(box.receipt(box.ids.reset).json.reason).toContain("could lose work");
    unchanged(box, state.localMain);
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain("DRY RUN: a real run would REFUSE");
    expect(dry.stdout).toContain("could lose work");
    unchanged(box, state.localMain);
  });

  it("refuses when the clone's local main is not the one the previous terminal Off recorded", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    const params = JSON.parse(JSON.stringify(state.params));
    params.previousRun.bindings.localMain = state.a2Tip;
    writeParams(box, RUN6, params);
    expect(box.run(box.ids.reset, resetEnv).status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "prior_evidence" });
    unchanged(box, state.a1Tip);
  });

  it("refuses a pending fixture proposal without settling it, and the dry run names it", { timeout: 240_000 }, () => {
    const box = sandbox(RUN6);
    const state = afterRun5(box);
    runAgentAskPreviewCommand({ workspace: box.workspace, request: JSON.stringify({
      agent_ask: "v1", request_id: "complete-transform-start-marker-stale", project: "three-action-rehearsal", intent: "complete", target_ref: "action/transform-start-marker",
      candidate_revision: state.a2Tip, evidence: [{ criterion: "x", status: "met" }], desired_result: "Mark transform-start-marker complete."
    }) });
    const dry = box.run(box.ids.reset, resetEnv, ["--dry-run"]);
    expect(dry.status).toBe(1);
    expect(dry.stdout).toContain("complete-transform-start-marker-stale");
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    expect(box.receipt(box.ids.reset).json).toMatchObject({ outcome: "refused", stage: "proposal_gate", agentAskSettled: false });
    unchanged(box, state.a1Tip);
  });

  it("refuses unfilled previous-run bindings (the overnight file before run 6) before reading anything else", { timeout: 120_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")));
    box.setReplies({ "probe": { passthrough: "probe" } });
    const result = box.run(box.ids.reset, resetEnv);
    expect(result.status).not.toBe(0);
    const { json } = box.receipt(box.ids.reset);
    expect(json).toMatchObject({ outcome: "refused", stage: "parameters" });
    expect(json.reason).toContain("UNFILLED previous-run bindings");
    expect(box.keys()).toEqual(["probe params"]);
  });
});

describe("rehearsal-chain G6, G7 and G8", () => {
  it("G6 refuses the run-6 file while its #997 fix commit is UNFILLED, before any observation", { timeout: 120_000 }, () => {
    const box = sandbox(RUN6);
    writeParams(box, RUN6, JSON.parse(readFileSync(path.join(impl, "params", `${RUN6}.json`), "utf8")));
    box.setReplies({ "probe": { passthrough: "probe" } });
    expect(box.run(box.ids.preflight).status).not.toBe(0);
    const { json } = box.receipt(box.ids.preflight);
    expect(json).toMatchObject({ outcome: "refused", stage: "parameters", productionPreviewedOrActivated: false });
    expect(json.reason).toContain("params.requiredCommits[4].commit");
    expect(box.keys()).toEqual(["probe params"]);
  });

  it("G7 refuses outside /runs before any Arcadia command, and refuses unfilled parameters without attempting activation", { timeout: 120_000 }, () => {
    const box = sandbox(RUN6);
    writeParams(box, RUN6, JSON.parse(readFileSync(path.join(impl, "params", `${RUN6}.json`), "utf8")));
    box.setReplies({ "probe": { passthrough: "probe" } });
    expect(box.run(box.ids.grant).status).not.toBe(0);
    expect(box.receipt(box.ids.grant).json).toMatchObject({ outcome: "refused", stage: "launch_context", activated: false, offCleanup: "not_attempted" });
    expect(box.keys()).toEqual([]);
    const runs = { ARCADIA_OPERATOR_SCRIPT_ID: box.ids.grant, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${box.ids.grant}.json`) };
    expect(box.run(box.ids.grant, runs).status).not.toBe(0);
    expect(box.receipt(box.ids.grant).json).toMatchObject({ outcome: "refused", stage: "parameters", activated: false, offCleanup: "not_attempted" });
    expect(box.keys()).toEqual(["probe params"]);
  });

  it("G8 refuses a non-interactive shell, refuses a policy it does not own without turning it Off, and owns only this run's Grant with its exact N-Action scope", { timeout: 240_000 }, () => {
    const box = sandbox(RUN7);
    writeParams(box, RUN7, JSON.parse(readFileSync(path.join(impl, "params", `${RUN7}.json`), "utf8")));
    expect(box.run(box.ids.terminalOff).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ outcome: "refused", stage: "launch_context" });
    expect(box.keys()).toEqual([]);
    const runs = { ARCADIA_OPERATOR_SCRIPT_ID: box.ids.terminalOff, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${box.ids.terminalOff}.json`) };
    const scoped = chainActionIds(9).map((id) => `three-action-rehearsal/${id}`);
    const scope = { projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions: scoped };
    // Run 6's Grant (another run) is not owned, even with a fixture scope.
    box.setReplies({ "arcadia production status": status("active", {}, { authority: { requestId: chainLibraryIds(RUN6).grant }, scope }) });
    expect(box.run(box.ids.terminalOff, runs).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ outcome: "refused", offState: "not_owned" });
    expect(box.keys().filter((k) => k.startsWith("arcadia production deactivate"))).toEqual([]);
    // This run's Grant with only three of its nine Actions is not owned either.
    box.setReplies({ "arcadia production status": status("active", {}, { authority: { requestId: box.ids.grant }, scope: { ...scope, actions: scoped.slice(0, 3) } }) });
    expect(box.run(box.ids.terminalOff, runs).status).not.toBe(0);
    expect(box.receipt(box.ids.terminalOff).json).toMatchObject({ outcome: "refused", offState: "not_owned" });
    // This run's exact Grant is turned Off, the worker logs are copied before any restart (here the
    // reviewed restart path is absent from the box library, so nothing restarts).
    initWorkspace(box.workspace);
    const logs = path.join(box.home, "Library", "Logs", "arcadia-services-1");
    mkdirSync(logs, { recursive: true });
    writeFileSync(path.join(logs, "worker.out.log"), "tick 1\ntick 2\n");
    writeFileSync(path.join(logs, "worker.err.log"), "");
    box.setReplies({
      "arcadia production status": [status("active", {}, { authority: { requestId: box.ids.grant }, scope }), status("inactive")],
      "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }),
      "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
      "probe": { passthrough: "probe" }
    });
    const result = box.run(box.ids.terminalOff, runs);
    expect(result.status).not.toBe(0);
    const { json, dir } = box.receipt(box.ids.terminalOff);
    expect(json).toMatchObject({ outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false, chainRunId: RUN7, actionIds: scoped });
    expect(json.reason).toContain("recover-arcadia-host-services is missing");
    expect(json.workerLogs.map((entry: { source: string }) => path.basename(entry.source)).sort()).toEqual(["worker.err.log", "worker.out.log"]);
    expect(readFileSync(path.join(dir, "evidence", "worker-logs", "arcadia-services-1", "worker.out.log"), "utf8")).toBe("tick 1\ntick 2\n");
    expect(box.keys().filter((k) => k.startsWith("arcadia production deactivate"))).toHaveLength(1);
  });
});

// The run-5 set this replaces for new runs stays byte-for-byte as merged.
it("leaves the run-5 set unchanged", () => {
  const expected = spawnSync("git", ["-C", repoRoot, "diff", "--quiet", "HEAD", "--", ...["reset-three-action-rehearsal-fixture", "preflight-three-action-rehearsal", "grant-production-three-action-rehearsal", "restore-terminal-off-three-action-rehearsal"].flatMap((prefix) =>
    ["sh", "json"].map((ext) => `artifacts/generated/operator-scripts/${prefix}-run5-2026-10-06.${ext}`))]);
  expect(expected.status).toBe(0);
  expect(cpSync).toBeTypeOf("function");
});
