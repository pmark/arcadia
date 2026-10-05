import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDocsSyncCommand } from "../src/commands/docs.js";
import { runProjectImportCommand, runProjectMetadataCommand } from "../src/commands/project.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { recordSessionRoleAttemptTerminal } from "../src/sessions/enrollment.js";
import { beginDevelopmentAttempt, requirementIdentity } from "../src/sessions/roleLineage.js";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * The run-2 operator pairs for the disposable three-Action rehearsal: the
 * fixture reset, the run-2 G6 preflight, the run-2 G7 Grant and the run-2 G8
 * terminal Off. Copied from
 * and shaped like tests/three-action-rehearsal-operator-scripts.test.ts: every
 * behavioral case runs a pair copied into a throwaway library with fake
 * `mise`, `gh`, `codex`, `timeout`, `sleep` and a `git` whose `push` is only
 * recorded, so no case reaches GitHub, production policy, a model or a service.
 * Arcadia's discovery, docs sync, requirementIdentity and database reads run
 * for real (passthrough) against a throwaway workspace.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const RESET = "reset-three-action-rehearsal-fixture-2026-10-05";
const G6 = "preflight-three-action-rehearsal-2026-10-05";
const G7 = "grant-production-three-action-rehearsal-2026-10-05";
const G8 = "restore-terminal-off-three-action-rehearsal-2026-10-05";
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const RUN1_G8 = "restore-terminal-off-three-action-rehearsal-2026-10-04";
const RUN1_PAIRS = [G1, "preflight-three-action-rehearsal-2026-10-04", "grant-production-three-action-rehearsal-2026-10-04", RUN1_G8];
const PAIRS = [RESET, G6, G7, G8];
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");
const descriptorOf = (id: string) => JSON.parse(readFileSync(path.join(library, `${id}.json`), "utf8"));
const REPO = "pmark/arcadia-three-action-rehearsal-t1";
const RUN1_BRANCH = "claude/write-start-marker-20261004T170245861Z";
const PLAN_FILE = "docs/plans/autonomous-three-action-rehearsal.md";
const ACTIONS = ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"];
const resetConstant = (name: string) => source(RESET).match(new RegExp(`^${name}='([^']*)'$`, "m"))![1];
const OLD_LINE = resetConstant("OLD_NEXT_ACTION");
const NEW_LINE = resetConstant("NEW_NEXT_ACTION");
const DESCRIPTION = "Disposable Arcadia three-Action rehearsal fixture (arcadia-three-action-rehearsal-v1); safe to delete after its recorded review.";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

type Reply = { stdout?: string; stderr?: string; status?: number; exec?: string; passthrough?: "probe" | "cli" };
type Replies = Record<string, Reply | Reply[]>;

// Fake CLIs answer from a JSON table; an array is consumed in order and its
// last entry repeats. Every call is appended to calls.log.
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
      : program.includes("session_role_attempts") ? "probe lineage" : program.includes("checkProviderSignIn") ? "probe claude"
      : program.includes("observeProviderCapacity") ? "probe capacity" : "probe leases";
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
if (reply.exec) reply = { ...reply, stdout: require("child_process").execSync(reply.exec, { encoding: "utf8" }) };
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
  const root = temp("arcadia-run2-pair-");
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
  const run = (id: string, env: Record<string, string | undefined> = {}, args = ["run"]) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_ROOT: root, FAKE_ARCADIA_ROOT: repoRoot, FAKE_WORKSPACE: workspace, ...env
    };
    for (const key of ["CODEX_SANDBOX", "ARCADIA_OPERATOR_SCRIPT_ID", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", "ANTHROPIC_API_KEY", "ARCADIA_REHEARSAL_GITHUB_REPO", "ARCADIA_WORKSPACE", "FAKE_PUSH_FAIL"]) {
      if (!(key in env)) delete childEnv[key];
    }
    return spawnSync("bash", [path.join(scripts, `${id}.sh`), ...args], { env: childEnv, encoding: "utf8", timeout: 120_000 });
  };
  const runDirs = () => existsSync(path.join(scripts, "runs")) ? readdirSync(path.join(scripts, "runs")).sort().map((d) => path.join(scripts, "runs", d)) : [];
  const receipt = (id: string) => {
    const own = runDirs().filter((d) => existsSync(path.join(d, "receipt.json")))
      .map((d) => ({ dir: d, json: JSON.parse(readFileSync(path.join(d, "receipt.json"), "utf8")) })).filter((r) => r.json.id === id);
    if (own.length === 0) throw new Error(`no ${id} receipt`);
    return own[own.length - 1];
  };
  const calls = () => readFileSync(path.join(root, "calls.log"), "utf8");
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
  return { root, checkout, scripts, home, workspace, fixture, run, runDirs, receipt, calls, pushes, setReplies, patchReplies, rebind };
}
type Box = ReturnType<typeof sandboxFor>;
const parsedCalls = (box: Box) => box.calls().trim().split("\n").filter((line) => line && !line.startsWith("git "))
  .map((line) => ({ tool: line.slice(0, line.indexOf(" ")), args: JSON.parse(line.slice(line.indexOf(" ") + 1)) as string[] }));
const arcadiaCalls = (box: Box, noun: string, verb: string) => parsedCalls(box).filter((c) => c.tool === "mise" && c.args[3] === "-s" && c.args[5] === noun && c.args[6] === verb);
const ok = (data: unknown): Reply => ({ stdout: JSON.stringify({ ok: true, data }) });
const status = (desiredState: string, extra: Record<string, unknown> = {}) => ok({
  read: { status: "ok", policy: { desiredState, revision: 5, epoch: 3, authority: desiredState === "active" ? { requestId: "some-grant" } : null } },
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

/**
 * The state the reset meets after run 1: G1's genesis pushed and registered in
 * the box workspace (real import, metadata and docs sync), run 1's candidate
 * branch and its PR, a passed development attempt for the original input, a
 * succeeded G1 receipt and a succeeded run-1 G8 receipt.
 */
function afterRun1(box: Box) {
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
  // Run 1's candidate: a branch off genesis carrying the marker.
  git(fixture, ["checkout", "-q", "-b", RUN1_BRANCH]);
  writeFileSync(path.join(fixture, "MARKER.md"), "three-action rehearsal start\n");
  const candidateTip = commitAll(fixture, "Implement write-start-marker");
  git(fixture, ["checkout", "-q", "main"]);
  box.rebind(RESET, [[/^RUN1_TIP="[0-9a-f]{40}"$/m, `RUN1_TIP="${candidateTip}"`]]);
  const original = identityOf(fixture);
  withDatabase(box.workspace, (db) => {
    const now = new Date("2026-10-04T17:02:45.000Z");
    const attempt = beginDevelopmentAttempt(db, { requirement: original, requestId: "worker-tick-run-1", retryAuthorized: true, now }).attempt;
    recordSessionRoleAttemptTerminal(db, { requestId: attempt.request_id, actorId: attempt.actor_id, status: "passed", targetHead: candidateTip, receipt: { sessionId: "session_run_1" }, now });
  });
  writeReceipt(box, "20261004T165157Z-6269", { id: G1, outcome: "succeeded", githubRepository: REPO, rootCommit: genesis });
  writeReceipt(box, "20261005T050000Z-1", { id: RUN1_G8, outcome: "succeeded", offState: "confirmed" });
  return { genesis, candidateTip, projectId, original };
}
const resetReplies = (box: Box, candidateTip: string): Replies => ({
  "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
  "arcadia production status": status("inactive"),
  "probe registration": { passthrough: "probe" },
  "probe amendment": { passthrough: "probe" },
  "probe lineage": { passthrough: "probe" },
  "arcadia docs sync": { passthrough: "cli" },
  "arcadia work list": { passthrough: "cli" },
  "gh api user": { stdout: "pmark\n" },
  [`gh repo view ${REPO}`]: { stdout: JSON.stringify({ name: "arcadia-three-action-rehearsal-t1", owner: { login: "pmark" }, visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, description: DESCRIPTION }) },
  // GitHub main is the local main this fake pushed to: the fake `git push` records but never moves anything.
  [`gh api repos/${REPO}/commits/main`]: { exec: 'git -C "$HOME/tmp/arcadia-three-action-rehearsal" rev-parse refs/heads/main' },
  [`gh api repos/${REPO}/branches/${RUN1_BRANCH}`]: { stdout: `${candidateTip}\n` },
  [`gh api repos/${REPO}/pulls/1`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN1_BRANCH, sha: candidateTip } }) }
});
function resetBox() {
  const box = sandboxFor([RESET]);
  const state = afterRun1(box);
  box.setReplies(resetReplies(box, state.candidateTip));
  return { box, ...state };
}
const resetEnv = { ARCADIA_REHEARSAL_GITHUB_REPO: REPO };
const noMutation = (box: Box, genesis: string) => {
  expect(box.pushes()).toEqual([]);
  expect(git(box.fixture, ["rev-parse", "refs/heads/main"])).toBe(genesis);
  expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
  expect(arcadiaCalls(box, "docs", "sync")).toHaveLength(0);
};

describe("run-2 operator pairs: contract and static safety", () => {
  it.each(PAIRS)("%s passes the library contract, describes itself, and rejects any other entrypoint", (id) => {
    const descriptor = descriptorOf(id);
    expect(() => validateOperatorScriptContract(descriptor, id, source(id))).not.toThrow();
    const box = sandboxFor([id]);
    const described = box.run(id, {}, ["--describe"]);
    expect(described.status).toBe(0);
    expect(JSON.parse(described.stdout)).toEqual(descriptor);
    expect(box.run(id, {}, ["apply"]).status).toBe(2);
    expect(box.runDirs()).toEqual([]);
  });

  it.each(PAIRS)("%s contains no raw kill, recursive delete, repository delete, force push, history rewrite or pull-request write", (id) => {
    const text = source(id);
    for (const pattern of [/\bkill\b/, /\bpkill\b/, /rm -rf/, /gh repo delete/, /--force\b/, /push\s+(-\S+\s+)*-f\b/, /\+refs\//, /reset --hard/, /worktree remove/, /branch -D/, /production reactivate/, /gh pr (merge|close|edit|comment|ready)/, /rebase/]) {
      expect(text, `${id} must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it("only the run-2 G7 previews or activates production; the reset and G6 never turn anything Off", () => {
    for (const id of [RESET, G6]) expect(source(id)).not.toMatch(/production (preview|activate|deactivate)/);
    expect(source(G8)).not.toMatch(/production (preview|activate)/);
  });

  it("the reset is one-shot, pushes only fixture main without force, and validates before its only commit and push", () => {
    const descriptor = descriptorOf(RESET);
    expect(descriptor.repeatable).toBe(false);
    expect(descriptor.kind).toBeUndefined();
    const text = source(RESET);
    // Through git itself or the script's `fx` (git -C fixture) wrapper.
    const pushes = text.split("\n").filter((line) => /(\bgit\b|\bfx\b).*\bpush\b/.test(line) && !line.trim().startsWith("#") && !line.includes("echo") && !/refuse "/.test(line));
    expect(pushes).toEqual(['  timeout 120 git -C "$FIXTURE_REPO" push -q origin refs/heads/main:refs/heads/main']);
    expect(text).not.toMatch(/\bfx\s+push\b/);
    const validation = text.indexOf('< "$RUN_DIR/validate-amendment.mjs"');
    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(text.indexOf("commit -q -m"));
    expect(text.indexOf("commit -q -m")).toBeLessThan(text.indexOf("push -q origin"));
    expect(text.indexOf("arcadia docs sync")).toBeGreaterThan(text.indexOf("push -q origin"));
  });

  it("the run-2 G7 keeps every G7 safety property under a new request id, with the #925 acknowledgement on the /runs card citing the recorded answer", () => {
    const text = source(G7);
    expect(text).toContain('SCRIPT_ID="grant-production-three-action-rehearsal-2026-10-05"');
    expect(text).toContain('PREFLIGHT_ID="preflight-three-action-rehearsal-2026-10-05"');
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
    expect(descriptor.desired_effect).toMatch(/^Pressing accepts Decision 0058 for these three fixture Actions only \(#925, answered yes in Log operator-answers-rehearsal-run2-2026-10-05 \(commit 133e503dc, clarified by 49b1342a8\)\): readying the PR, pushing the settled head and reviewer-model spend/);
    expect(descriptor.problem).toMatch(/^OPERATOR ACKNOWLEDGEMENT REQUIRED BEFORE PRESSING .*issues\/925/);
    expect(descriptor.problem).toContain("that answer created no Decision");
    expect(descriptor.authority.does[0]).toContain("#925");
    expect(descriptor.authority.does.join(" ")).toContain("SIGKILL");
    expect(descriptor.authority.never_does.join(" ")).toMatch(/GitHub merge.*base branch/);
  });

  it("leaves every run-1 pair in place for its own receipts and audit trail", () => {
    for (const id of RUN1_PAIRS) expect(() => validateOperatorScriptContract(descriptorOf(id), id, source(id))).not.toThrow();
    expect(source("grant-production-three-action-rehearsal-2026-10-04")).toContain('SCRIPT_ID="grant-production-three-action-rehearsal-2026-10-04"');
  });
});

describe("the reset refuses unsafe input and unsafe state before any commit or push", () => {
  it("refuses without the operator-supplied repository before any call", () => {
    const box = sandboxFor([RESET]);
    expect(box.run(RESET).status).not.toBe(0);
    const { dir, json } = box.receipt(RESET);
    expect(json).toMatchObject({ id: RESET, outcome: "refused", stage: "parameters", productionPreviewedOrActivated: false, grantsTouched: false, fixtureCommitted: false, githubRepositoryChanged: false });
    expect(json.reason).toContain("ARCADIA_REHEARSAL_GITHUB_REPO is required");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("This run made no fixture commit and no push.");
    expect(box.calls()).toBe("");
  });

  it.each(["pmark/arcadia", "pmark/arcadia-three-action-rehearsal/extra", "-bad/arcadia-three-action-rehearsal", "noslash"])("refuses the unsafe identifier %s", (identifier) => {
    const box = sandboxFor([RESET]);
    expect(box.run(RESET, { ARCADIA_REHEARSAL_GITHUB_REPO: identifier }).status).not.toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "refused", stage: "parameters" });
    expect(box.calls()).toBe("");
  });

  const cases: Array<[string, (box: Box, state: ReturnType<typeof afterRun1>) => Record<string, string> | void, string, string]> = [
    ["production is Active", (box) => box.patchReplies({ "arcadia production status": status("active") }), "preflight", "must be readable, Inactive and have zero live admissions"],
    ["production has a live admission", (box) => box.patchReplies({ "arcadia production status": status("inactive", { liveAdmissions: 1 }) }), "preflight", "zero live admissions"],
    ["the workspace is exported", () => ({ ARCADIA_WORKSPACE: "/w/martianrover" }), "preflight", "unset ARCADIA_WORKSPACE"],
    ["run 1's terminal Off is not proven", (box) => { writeReceipt(box, "20261005T060000Z-2", { id: RUN1_G8, outcome: "refused", offState: "confirmed" }); }, "run1_evidence", "terminal Off is not proven"],
    ["no G1 receipt names this repository", (box) => { rmSync(path.join(box.scripts, "runs", "20261004T165157Z-6269"), { recursive: true }); }, "run1_evidence", "no succeeded G1"],
    ["the fixture is dirty", (box) => { writeFileSync(path.join(box.fixture, "stray.txt"), "x\n"); }, "local_fixture", "dirty or has untracked files"],
    ["the Project is registered from another path", (box, state) => { runProjectMetadataCommand({ workspace: box.workspace, projectId: state.projectId, repoPath: "/elsewhere/fixture" }); }, "registration", "is not registered from"],
    ["the repository lacks G1's description", (box) => box.patchReplies({ [`gh repo view ${REPO}`]: { stdout: JSON.stringify({ visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, description: "someone else's" }) } }), "github_repository", "G1 did not create it"],
    ["the repository is public", (box) => box.patchReplies({ [`gh repo view ${REPO}`]: { stdout: JSON.stringify({ visibility: "PUBLIC", isPrivate: false, isArchived: false, isFork: false, description: DESCRIPTION }) } }), "github_repository", "is not private"],
    ["the owner is not the gh user", (box) => box.patchReplies({ "gh api user": { stdout: "someone-else\n" } }), "github_repository", "not the authenticated GitHub user"],
    ["pull request #1 moved off run 1's tip", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/pulls/1`]: { stdout: JSON.stringify({ state: "open", head: { ref: RUN1_BRANCH, sha: state.genesis } }) } }), "run1_candidate", "pull request #1 is not run 1's candidate"],
    ["the GitHub candidate branch moved", (box, state) => box.patchReplies({ [`gh api repos/${REPO}/branches/${RUN1_BRANCH}`]: { stdout: `${state.genesis}\n` } }), "run1_candidate", "GitHub branch"],
    ["the local candidate branch moved", (box) => {
      git(box.fixture, ["checkout", "-q", RUN1_BRANCH]);
      writeFileSync(path.join(box.fixture, "MORE.md"), "more\n");
      commitAll(box.fixture, "more");
      git(box.fixture, ["checkout", "-q", "main"]);
    }, "run1_candidate", "local branch"],
    ["GitHub main is not local main", (box) => box.patchReplies({ [`gh api repos/${REPO}/commits/main`]: { stdout: "1111111111111111111111111111111111111111\n" } }), "fixture_state", "are not at genesis"],
    ["the amended input already has an attempt", (box, state) => {
      const amended = path.join(temp("arcadia-run2-amended-"), "fixture");
      mkdirSync(amended, { recursive: true });
      renderG1Fixture(amended);
      writeFileSync(path.join(amended, PLAN_FILE), readFileSync(path.join(amended, PLAN_FILE), "utf8").replace(OLD_LINE, NEW_LINE));
      withDatabase(box.workspace, (db) => beginDevelopmentAttempt(db, { requirement: identityOf(amended), requestId: "worker-tick-early-run-2", retryAuthorized: true, now: new Date() }));
      expect(state.original.inputRevision).not.toBe(identityOf(amended).inputRevision);
    }, "lineage", "attempts already exist for the amended requirement input"]
  ];
  it.each(cases)("refuses when %s, with no commit, push or docs sync", (_label, arrange, stage, reason) => {
    const { box, ...state } = resetBox();
    const { genesis } = state;
    const env = arrange(box, state) ?? {};
    expect(box.run(RESET, { ...resetEnv, ...env }).status).not.toBe(0);
    const { dir, json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage, fixtureCommitted: false, githubRepositoryChanged: false, productionPreviewedOrActivated: false });
    expect(json.reason).toContain(reason);
    expect(existsSync(path.join(dir, "failure-handoff.md"))).toBe(true);
    if (stage !== "local_fixture") noMutation(box, genesis);
    else expect(box.pushes()).toEqual([]);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)|"pr",|"pulls\/1","-X"/);
  });

  it("refuses a resume whose reset commit differs from the validated render by even one byte", () => {
    const { box, genesis } = resetBox();
    expect(box.run(RESET, { ...resetEnv, FAKE_PUSH_FAIL: "1" }).status).not.toBe(0);
    // Rewrite the unpushed commit with an extra blank line in the Plan (same subject, same parent).
    const file = path.join(box.fixture, PLAN_FILE);
    writeFileSync(file, readFileSync(file, "utf8") + "\n");
    git(box.fixture, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "--amend", "--no-edit", "-a"]);
    const tampered = git(box.fixture, ["rev-parse", "HEAD"]);
    box.patchReplies({ [`gh api repos/${REPO}/commits/main`]: { stdout: `${genesis}\n` } });
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "refused", stage: "fixture_state" });
    expect(box.pushes()).toHaveLength(1);
    expect(git(box.fixture, ["rev-parse", "HEAD"])).toBe(tampered);
  });

  it("refuses when fixture main moved by another path, naming the recovery and never rewriting history", () => {
    const { box } = resetBox();
    writeFileSync(path.join(box.fixture, "MARKER.md"), "three-action rehearsal start\n");
    const moved = commitAll(box.fixture, "integrated elsewhere");
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "fixture_state" });
    expect(json.recovery).toContain("never rewrites history");
    expect(box.pushes()).toEqual([]);
    expect(git(box.fixture, ["rev-parse", "HEAD"])).toBe(moved);
  });
});

describe("the reset validates the amendment with Arcadia's own code before any commit or push", () => {
  it("refuses an amendment that Arcadia's discovery rejects, leaving fixture main at genesis and pushing nothing", () => {
    const { box, genesis } = resetBox();
    // An unquoted ': ' inside the plain YAML scalar makes the Plan invalid.
    box.rebind(RESET, [[/^NEW_NEXT_ACTION='.*'$/m, `NEW_NEXT_ACTION='    next_action: Implement MARKER.md: broken for run 2.'`]]);
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { dir, json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "validate_amendment", fixtureCommitted: false, githubRepositoryChanged: false });
    expect(json.reason).toContain("nothing was committed or pushed");
    expect(json.reason).toMatch(/Invalid YAML|docs sync error|not discovered/);
    noMutation(box, genesis);
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("This run made no fixture commit and no push.");
    // The rendered amendment stays in dot-directories the checkout's discovery skips.
    expect(discoverDocs(box.checkout).docs.map((doc) => doc.relativePath)).toEqual(["PROJECT.md"]);
  });

  it("refuses an edit that does not change the requirement input revision (the title), or changes more than next_action", () => {
    const { box, genesis } = resetBox();
    const title = '    title: Implement MARKER.md containing exactly the line "three-action rehearsal start" plus a trailing newline.';
    box.rebind(RESET, [
      [/^OLD_NEXT_ACTION='.*'$/m, `OLD_NEXT_ACTION='${title}'`],
      [/^NEW_NEXT_ACTION='.*'$/m, `NEW_NEXT_ACTION='${title.slice(0, -1)} for run 2.'`]
    ]);
    expect(box.run(RESET, resetEnv).status).not.toBe(0);
    const { json } = box.receipt(RESET);
    expect(json).toMatchObject({ outcome: "refused", stage: "validate_amendment" });
    expect(json.reason).toContain("did not change the requirement input revision of write-start-marker");
    expect(json.reason).toContain("changed write-start-marker beyond its next_action");
    noMutation(box, genesis);
  });
});

describe("the reset commits one validated line, pushes it without force, syncs docs and records the new fixture head", () => {
  it("resets exactly write-start-marker's next_action, leaves run 1's candidate untouched, and refuses a second application", () => {
    const { box, genesis, candidateTip, original } = resetBox();
    const result = box.run(RESET, resetEnv);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = box.receipt(RESET);
    const head = git(box.fixture, ["rev-parse", "refs/heads/main"]);
    const amended = identityOf(box.fixture);
    expect(json).toMatchObject({
      outcome: "succeeded", stage: "complete", githubRepository: REPO, fixtureRoot: box.fixture, previousMain: genesis, newHead: head, remoteMainAfter: head,
      candidateBranch: RUN1_BRANCH, candidateTip, prTip: candidateTip, pullRequest: 1, resetState: "at_genesis", fixtureCommitted: true, githubRepositoryChanged: true,
      productionPreviewedOrActivated: false, grantsTouched: false,
      actionTextRevision: { field: "next_action", requirementId: original.requirementId, inputRevisionBefore: original.inputRevision, inputRevisionAfter: amended.inputRevision, criteriaFingerprint: original.criteriaFingerprint }
    });
    expect(amended.inputRevision).not.toBe(original.inputRevision);
    expect(json.run1Attempts).toEqual([{ input: "previous", role: "development", ordinal: 1, status: "passed" }]);
    // One commit on genesis touching only the Plan: write-start-marker's next_action and the Plan's updated: date.
    const today = new Date().toISOString().slice(0, 10);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(genesis);
    expect(git(box.fixture, ["diff", "--name-only", genesis, head])).toBe(PLAN_FILE);
    const changed = git(box.fixture, ["diff", "-U0", genesis, head, "--", PLAN_FILE]).split("\n").filter((line) => /^[-+][^-+]/.test(line));
    expect(changed).toEqual(["-updated: 2026-10-04", `+updated: ${today}`, `-${OLD_LINE}`, `+${NEW_LINE}`]);
    expect(json.planUpdated).toBe(today);
    expect(git(box.fixture, ["log", "-1", "--format=%an <%ae>%n%s"])).toBe("Arcadia Rehearsal Fixture <rehearsal@localhost>\nReset write-start-marker for three-Action rehearsal run 2");
    expect(git(box.fixture, ["status", "--porcelain"])).toBe("");
    // Run 1's candidate is exactly where it was.
    expect(git(box.fixture, ["rev-parse", `refs/heads/${RUN1_BRANCH}`])).toBe(candidateTip);
    // One push, of fixture main only, never forced, after validation and before docs sync.
    expect(box.pushes()).toHaveLength(1);
    expect(box.pushes()[0]).toMatch(/push -q origin refs\/heads\/main:refs\/heads\/main$/);
    // Every fake call in order: validation and the lineage read precede the push; docs sync follows it.
    const keys = readFileSync(path.join(box.root, "keys.log"), "utf8").trim().split("\n");
    expect(keys.indexOf("probe amendment")).toBeGreaterThan(-1);
    expect(keys.indexOf("probe amendment")).toBeLessThan(keys.indexOf("probe lineage"));
    expect(keys.indexOf("probe lineage")).toBeLessThan(keys.indexOf("push"));
    expect(keys.indexOf("push")).toBeLessThan(keys.indexOf("arcadia docs sync"));
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)/);
    // The real docs sync applied the amended Plan with zero errors, and the synced Action carries the new text.
    expect(JSON.parse(readFileSync(path.join(dir, "docs-sync.json"), "utf8")).data.errorCount).toBe(0);
    // ...and actually updated write-start-marker: the Plan's bumped updated: date keeps it from being skipped as older than the record.
    const changes = JSON.parse(readFileSync(path.join(dir, "docs-sync.json"), "utf8")).data.projects[0].changes as Array<{ entity: string; ref: string; action: string }>;
    expect(changes.filter((c) => c.entity === "action").map((c) => [c.ref.split("#")[1], c.action])).toEqual([["write-start-marker", "update"], ["transform-start-marker", "unchanged"], ["verify-final-rehearsal", "unchanged"]]);
    expect(discoverDocs(box.checkout).docs.map((doc) => doc.relativePath)).toEqual(["PROJECT.md"]);

    // Repeatable only in its refusing form: a second press refuses as already reset.
    const again = box.run(RESET, resetEnv);
    expect(again.status).not.toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "refused", stage: "fixture_state", resetState: "already_reset", fixtureCommitted: false, githubRepositoryChanged: false });
    expect(box.receipt(RESET).json.reason).toContain("already succeeded");
    expect(box.pushes()).toHaveLength(1);
    expect(git(box.fixture, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("resumes a reset commit whose push failed by re-validating that exact commit and pushing it, even on a later UTC date", () => {
    const { box, genesis } = resetBox();
    // The failed first run happened on another UTC date than the resume.
    box.rebind(RESET, [['RESET_DATE="$(date -u +%F)"', 'RESET_DATE="2099-01-01"']]);
    expect(box.run(RESET, { ...resetEnv, FAKE_PUSH_FAIL: "1" }).status).not.toBe(0);
    box.rebind(RESET, [['RESET_DATE="2099-01-01"', 'RESET_DATE="$(date -u +%F)"']]);
    expect(git(box.fixture, ["show", `HEAD:${PLAN_FILE}`])).toContain("\nupdated: 2099-01-01\n");
    const first = box.receipt(RESET);
    expect(first.json).toMatchObject({ outcome: "refused", stage: "push", fixtureCommitted: true, resetState: "at_genesis" });
    expect(readFileSync(path.join(first.dir, "failure-handoff.md"), "utf8")).toContain("Fixture state found at the start of this run: at_genesis.");
    const head = git(box.fixture, ["rev-parse", "HEAD"]);
    expect(git(box.fixture, ["rev-parse", "HEAD^"])).toBe(genesis);
    // GitHub main still reads genesis: the push never landed.
    box.patchReplies({ [`gh api repos/${REPO}/commits/main`]: [{ stdout: `${genesis}\n` }, { stdout: `${head}\n` }] });
    const second = box.run(RESET, resetEnv);
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(box.receipt(RESET).json).toMatchObject({ outcome: "succeeded", resetState: "committed_unpushed", newHead: head, previousMain: genesis, fixtureCommitted: false, githubRepositoryChanged: true, planUpdated: "2099-01-01" });
    expect(git(box.fixture, ["rev-parse", "HEAD"])).toBe(head);
    expect(box.pushes()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// G6 and G7 for run 2 bind the reset head. The fixture here is genesis plus
// the reset's own commit; the reset receipt is written the way the reset
// writes it (the end-to-end case below uses the reset's real receipt).

function resetFixture(box: Box) {
  const fixture = box.fixture;
  mkdirSync(fixture, { recursive: true });
  writeFileSync(path.join(fixture, ".arcadia-three-action-rehearsal.json"), JSON.stringify({
    schema: "arcadia-three-action-rehearsal-fixture-v1", githubRepository: REPO, fixtureProject: "three-action-rehearsal",
    fixturePlan: "autonomous-three-action-rehearsal", actions: ACTIONS, provider: "claude-code-cli", agentProfile: "claude_build", validationCommand: "node scripts/check-rehearsal.mjs"
  }));
  git(fixture, ["init", "-q", "-b", "main"]);
  const genesis = commitAll(fixture, "genesis");
  writeFileSync(path.join(fixture, "PLAN.md"), "run 2\n");
  const head = commitAll(fixture, "Reset write-start-marker for three-Action rehearsal run 2");
  git(fixture, ["remote", "add", "origin", `https://github.com/${REPO}.git`]);
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-first-packet-approval"), "review_1\n");
  const resetReceipt = writeReceipt(box, "20261005T080000Z-3", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: fixture, previousMain: genesis, newHead: head, remoteMainAfter: head });
  return { genesis, head, resetReceipt };
}
const passingCapacity = { admitted: true, unattendedProof: true, freshness: "fresh", confidence: "observed", usagePolicy: "included", evidence: "real", availability: "available" };
function g6Replies(box: Box, head: string, fixtureHead: string): Replies {
  return {
    "arcadia workspace resolve": ok({ source: "user config", workspacePath: box.workspace }),
    "arcadia production status": status("inactive"),
    "arcadia go-broker status": ok({ ready: true, revision: head, preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
    "arcadia worker status": { stdout: "Worker: running (PID 7)\n" },
    "probe leases": { stdout: JSON.stringify({ active: 0, fixtureActive: [] }) },
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

describe("the run-2 G6 preflight binds the reset head and keeps every check", () => {
  it("passes and binds the fixture head and reset receipt, checking GitHub main and CI at the reset head", () => {
    const { box, head } = g6Box();
    const { genesis, head: fixtureHead, resetReceipt } = resetFixture(box);
    box.setReplies(g6Replies(box, head, fixtureHead));
    const result = box.run(G6);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { json } = box.receipt(G6);
    expect(json.checks.filter((c: { status: string }) => c.status !== "pass")).toEqual([]);
    expect(json.checks.map((c: { name: string }) => c.name)).toEqual([
      "arcadia_checkout", "remote_main", "installed_features", "workspace", "production_status", "installed_release", "host_transports", "worker",
      "reset_receipt", "fixture", "fixture_leases", "claude_worker_token", "codex_reviewer_login", "codex_reviewer_profile", "codex_capacity", "github_auth", "github_repository", "github_checks"
    ]);
    expect(json).toMatchObject({ outcome: "succeeded", arcadiaHead: head, brokerRevision: head, githubRepository: REPO, rootCommit: genesis, fixtureHead, resetReceipt, workspace: box.workspace, policyRevision: 5 });
    expect(box.calls()).toContain(`"repos/${REPO}/commits/${fixtureHead}/check-runs"`);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)/);
  });

  it.each([
    ["no reset receipt exists", (box: Box) => { rmSync(path.join(box.scripts, "runs", "20261005T080000Z-3"), { recursive: true }); }, "no succeeded reset-three-action-rehearsal-fixture-2026-10-05 receipt"],
    ["the only reset receipt names another repository", (box: Box) => {
      const file = path.join(box.scripts, "runs", "20261005T080000Z-3", "receipt.json");
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), githubRepository: "pmark/arcadia-three-action-rehearsal-other" }));
    }, "no succeeded reset"],
    ["the fixture moved on past the reset head", (box: Box) => { writeFileSync(path.join(box.fixture, "MARKER.md"), "x\n"); commitAll(box.fixture, "later"); }, "does not match the fixture"],
    ["a newer succeeded reset receipt names another head", (box: Box) => {
      writeReceipt(box, "20261005T090000Z-4", { id: RESET, outcome: "succeeded", githubRepository: REPO, fixtureRoot: box.fixture, previousMain: "0".repeat(40), newHead: "1".repeat(40), remoteMainAfter: "1".repeat(40) });
    }, "does not match the fixture"]
  ])("refuses when %s", (_label, arrange, detail) => {
    const { box, head } = g6Box();
    const { head: fixtureHead } = resetFixture(box);
    box.setReplies(g6Replies(box, head, fixtureHead));
    arrange(box);
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "reset_receipt")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "reset_receipt").detail).toContain(detail);
    expect(checkOf(box, "fixture")).toMatchObject({ status: "refuse" });
    expect(box.receipt(G6).json.outcome).toBe("refused");
  });

  it("refuses GitHub main at genesis rather than the reset head", () => {
    const { box, head } = g6Box();
    const { genesis, head: fixtureHead } = resetFixture(box);
    box.setReplies({ ...g6Replies(box, head, fixtureHead), [`gh api repos/${REPO}/branches/main`]: { stdout: JSON.stringify({ commit: { sha: genesis }, protected: false }) } });
    expect(box.run(G6).status).not.toBe(0);
    expect(checkOf(box, "github_repository")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "github_repository").detail).toContain(`reset head ${fixtureHead}`);
  });

  it("keeps the 2026-10-04 checks: a stale installed release, a paid reviewer login and unavailable capacity refuse", () => {
    const { box, head } = g6Box();
    const { head: fixtureHead } = resetFixture(box);
    box.setReplies({
      ...g6Replies(box, head, fixtureHead),
      "arcadia go-broker status": { status: 1, stdout: JSON.stringify({ ok: false }) },
      "codex login status": { stdout: "Logged in using an API key - sk-***\n" },
      "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_planning"], codex: { ...passingCapacity, availability: "usage_limited" } }) }
    });
    expect(box.run(G6).status).not.toBe(0);
    const verdicts = Object.fromEntries(box.receipt(G6).json.checks.map((c: { name: string; status: string }) => [c.name, c.status]));
    expect(verdicts).toMatchObject({ installed_release: "refuse", codex_reviewer_login: "refuse", codex_capacity: "refuse", reset_receipt: "pass", fixture: "pass" });
  });
});

function grantBox(previewScope: Record<string, unknown> = {}) {
  const box = sandboxFor([G7]);
  mkdirSync(path.join(box.checkout, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(box.checkout, "docs", "decisions", "0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"), "---\nstatus: approved\n---\n");
  const head = commitAll(box.checkout, "decision");
  git(box.checkout, ["push", "-q", "origin", "main"]);
  box.rebind(G7, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`]]);
  const { genesis, head: fixtureHead, resetReceipt } = resetFixture(box);
  const g6Receipt = writeReceipt(box, "20261005T153000Z-5", {
    id: G6, outcome: "succeeded", finishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), arcadiaHead: head, brokerRevision: head,
    githubRepository: REPO, rootCommit: genesis, fixtureHead, resetReceipt, workspace: box.workspace, policyRevision: 5
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
    "arcadia production preview": ok({ preview: { expectedRevision: 5, scope, scopeFingerprint: "fp-1", unmatched: { projects: [], plans: [] } } }),
    "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 6, authority: { requestId: G7, scopeFingerprint: "fp-1" } } } }),
    "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } })
  });
  const env = { ARCADIA_OPERATOR_SCRIPT_ID: G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) };
  return { box, env, actions, head, genesis, fixtureHead, resetReceipt, g6Receipt };
}
const g7Receipt = (box: Box) => box.receipt(G7);

describe("the run-2 G7 Grant binds the reset head and keeps every G7 safety property", () => {
  it("refuses outside the /runs launcher without any call", () => {
    const box = sandboxFor([G7]);
    expect(box.run(G7).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ id: G7, outcome: "refused", stage: "launch_context", activated: false });
    expect(box.calls()).toBe("");
  });

  it("activates once under its own request id at the reset head after the replay and two identical previews", () => {
    const { box, env, actions, fixtureHead, genesis, resetReceipt, g6Receipt } = grantBox();
    const result = box.run(G7, env);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = g7Receipt(box);
    expect(json).toMatchObject({ id: G7, outcome: "succeeded", activated: true, scopeFingerprint: "fp-1", policyRevisionBefore: 5, policyRevisionAfter: 6, githubRepository: REPO, rootCommit: genesis, fixtureHead, resetReceipt, preflightReceipt: g6Receipt });
    expect(json.authorizes).toContain(`at fixture head ${fixtureHead}`);
    expect(json.authorizes).toContain("operator-answers-rehearsal-run2-2026-10-05");
    const md = readFileSync(path.join(dir, "receipt.md"), "utf8");
    expect(md).toContain(`reset head ${fixtureHead} on genesis ${genesis}`);
    expect(md).toContain("#925");
    const [activate] = arcadiaCalls(box, "production", "activate");
    expect(arcadiaCalls(box, "production", "activate")).toHaveLength(1);
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(2);
    const args = activate.args;
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(value("--request-id")).toBe(G7);
    expect(value("--expected-revision")).toBe("5");
    expect(args).toContain("--remote-preservation");
    expect(value("--integration-grant-decision")).toBe("0058");
    expect(args.filter((_a, i) => args[i - 1] === "--integration-grant-action")).toEqual(actions);
    expect(args.filter((_a, i) => args[i - 1] === "--action")).toEqual(actions);
    const expiry = Date.parse(value("--packet-approval-expires-at"));
    expect(expiry - Date.now()).toBeGreaterThan(11 * 3600e3);
    expect(expiry - Date.now()).toBeLessThanOrEqual(12 * 3600e3);
    expect(value("--integration-grant-expires-at")).toBe(value("--packet-approval-expires-at"));
    const order = parsedCalls(box).map((c) => (c.args[2] === "node" && !c.args.includes("tsx") ? "replay" : c.args.slice(5, 7).join(" ")));
    expect(order.indexOf("replay")).toBeLessThan(order.indexOf("production preview"));
  });

  it.each([
    ["fixtureHead", "1111111111111111111111111111111111111111"],
    ["resetReceipt", "/elsewhere/receipt.json"],
    ["rootCommit", "2222222222222222222222222222222222222222"]
  ])("refuses a G6 receipt bound to a different %s before any replay or preview", (field, value) => {
    const { box, env, g6Receipt } = grantBox();
    writeFileSync(g6Receipt, JSON.stringify({ ...JSON.parse(readFileSync(g6Receipt, "utf8")), [field]: value }));
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json.reason).toContain("different main, release, workspace, fixture or reset head");
    expect(parsedCalls(box).some((c) => c.args[2] === "node" && !c.args.includes("tsx"))).toBe(false);
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(0);
  });

  it("refuses a G6 receipt from the 2026-10-04 preflight", () => {
    const { box, env, g6Receipt } = grantBox();
    writeFileSync(g6Receipt, JSON.stringify({ ...JSON.parse(readFileSync(g6Receipt, "utf8")), id: "preflight-three-action-rehearsal-2026-10-04" }));
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json.reason).toContain("no G6 preflight receipt exists");
  });

  it("refuses a fixture that is not exactly the reset head, never previewing", () => {
    const { box, env } = grantBox();
    writeFileSync(path.join(box.fixture, "MARKER.md"), "x\n");
    commitAll(box.fixture, "later");
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "fixture", activated: false, offCleanup: "not_attempted" });
    expect(g7Receipt(box).json.reason).toContain("is not the reset head");
    expect(arcadiaCalls(box, "production", "preview")).toHaveLength(0);
  });

  it("refuses when its own request id is already recorded in production policy", () => {
    const { box, env } = grantBox();
    box.patchReplies({ "arcadia production status": ok({ read: { status: "ok", policy: { desiredState: "inactive", revision: 5, epoch: 3, authority: { requestId: G7 } } }, liveAdmissions: 0 }) });
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
      "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 6, authority: { requestId: G7, scopeFingerprint: "fp-other" } } } }),
      "arcadia production status": [status("inactive"), status("inactive"), ok({ read: { status: "ok", policy: { desiredState: "active", revision: 6, epoch: 4, authority: { requestId: G7 } } }, liveAdmissions: 0 })]
    });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "activate", activated: true, offCleanup: "returned_off" });
    const [off] = arcadiaCalls(box, "production", "deactivate");
    expect(off.args[off.args.indexOf("--request-id") + 1]).toMatch(new RegExp(`^${G7}-.*-off$`));
  });

  it("never turns off another request's Active policy after a failed activate", () => {
    const { box, env } = grantBox();
    box.patchReplies({ "arcadia production activate": { status: 1 }, "arcadia production status": [status("inactive"), status("inactive"), status("active")] });
    expect(box.run(G7, env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ offCleanup: "other_grant_active", activated: false });
    expect(arcadiaCalls(box, "production", "deactivate")).toHaveLength(0);
  });
});

describe("run 2 end to end against fakes: the reset's receipt is the head G6 and G7 bind", () => {
  it("reset, then G6 binds the reset head from the reset's own receipt, then G7 accepts that G6 receipt and activates", () => {
    const box = sandboxFor([RESET, G6, G7]);
    const { genesis, candidateTip } = afterRun1(box);
    box.setReplies(resetReplies(box, candidateTip));
    const reset = box.run(RESET, resetEnv);
    expect(reset.status, reset.stdout + reset.stderr).toBe(0);
    const { dir: resetDir, json: resetJson } = box.receipt(RESET);
    const fixtureHead = resetJson.newHead;
    expect(git(box.fixture, ["rev-parse", "HEAD"])).toBe(fixtureHead);

    mkdirSync(path.join(box.checkout, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(box.checkout, "docs", "decisions", "0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"), "---\nstatus: approved\n---\n");
    const head = commitAll(box.checkout, "decision");
    git(box.checkout, ["push", "-q", "origin", "main"]);
    box.rebind(G6, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`], [/^CHECK_WAIT_SECONDS=300$/m, "CHECK_WAIT_SECONDS=0"]]);
    box.rebind(G7, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`]]);
    box.setReplies(g6Replies(box, head, fixtureHead));
    const g6 = box.run(G6);
    expect(g6.status, g6.stdout + g6.stderr).toBe(0);
    expect(box.receipt(G6).json).toMatchObject({ outcome: "succeeded", fixtureHead, rootCommit: genesis, resetReceipt: realpathSync(path.join(resetDir, "receipt.json")) });

    const actions = ACTIONS.map((a) => `three-action-rehearsal/${a}`);
    box.patchReplies({
      "node preflight": { stdout: "Hermetic three-Action rehearsal passed\n" },
      "arcadia production preview": ok({ preview: { expectedRevision: 5, scopeFingerprint: "fp-1", unmatched: { projects: [], plans: [] }, scope: {
        projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions, providers: ["claude-code-cli"], maxConcurrentSessions: 1,
        mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"], remotePreservation: true, packetApprovalExpiresAt: "{{arg:--packet-approval-expires-at}}",
        integrationGrant: { decisionRef: "0058", expiresAt: "{{arg:--integration-grant-expires-at}}", actions } } } }),
      "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 6, authority: { requestId: G7, scopeFingerprint: "fp-1" } } } })
    });
    const g7 = box.run(G7, { ARCADIA_OPERATOR_SCRIPT_ID: G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) });
    expect(g7.status, g7.stdout + g7.stderr).toBe(0);
    expect(box.receipt(G7).json).toMatchObject({ outcome: "succeeded", activated: true, fixtureHead, resetReceipt: realpathSync(path.join(resetDir, "receipt.json")) });
  });
});

// ---------------------------------------------------------------------------
// The run-2 G8 variant: the merged 2026-10-04 G8 with only its ownership widened
// to the run-2 G7 request id (run 1's still accepted), exact fixture scope only.

const realRecover = {
  "recover-arcadia-host-services.sh": readFileSync(path.join(library, "recover-arcadia-host-services.sh"), "utf8"),
  "recover-arcadia-host-services.json": readFileSync(path.join(library, "recover-arcadia-host-services.json"), "utf8")
};
const REHEARSAL_ACTIONS = ACTIONS.map((a) => `three-action-rehearsal/${a}`);
const rehearsalActive = (requestId: string, actions = REHEARSAL_ACTIONS, plans = ["three-action-rehearsal/autonomous-three-action-rehearsal"]) => ok({
  read: { status: "ok", policy: { desiredState: "active", revision: 6, epoch: 4, authority: { requestId },
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

describe("the run-2 G8 owns only a rehearsal G7 policy with the exact fixture scope", () => {
  it("differs from the merged 2026-10-04 G8 only in its id and the request ids it owns, keeping its reconciliation and hash pins", () => {
    const run1 = source(RUN1_G8);
    const run2 = source(G8);
    const normalize = (text: string) => text
      .replace(/^# G8 for rehearsal run 2:.*\n(#.*\n){3}/m, "")
      .replace(/restore-terminal-off-three-action-rehearsal-2026-10-0[45]/g, "<G8>")
      .replace(/^# G8 owns only .*\n/m, "").replace(/^GRANT_ID=.*\n(RUN1_GRANT_ID=.*\n)?/m, "")
      .replace(/ or \$RUN1_GRANT_ID/g, "").replace(/ --arg run1 "\$RUN1_GRANT_ID"/, "")
      .replace("(.data.read.policy.authority.requestId == $id or .data.read.policy.authority.requestId == $run1)", ".data.read.policy.authority.requestId == $id")
      .replace("== G8 (run 2): restore", "== G8: restore");
    expect(normalize(run2)).toBe(normalize(run1));
    for (const pin of ["RECOVER_SCRIPT_SHA256", "RECOVER_DESCRIPTOR_SHA256", "RESTART_IMPL_SHA256"]) {
      const line = new RegExp(`^${pin}="[0-9a-f]{64}"$`, "m");
      expect(run2.match(line)?.[0]).toBe(run1.match(line)?.[0]);
    }
    expect(run2).toContain('GRANT_ID="grant-production-three-action-rehearsal-2026-10-05"');
    expect(run2).toContain('RUN1_GRANT_ID="grant-production-three-action-rehearsal-2026-10-04"');
    expect(run2).toContain("classifyPreservedCandidate");
    expect(run2).not.toMatch(/services\.sh restart|launchctl|worker (stop|start)/);
  });

  it("refuses outside the /runs launcher or a terminal without any call", () => {
    const box = g8Box();
    expect(box.run(G8).status).not.toBe(0);
    expect(box.receipt(G8).json).toMatchObject({ id: G8, outcome: "refused", stage: "launch_context", restarted: false });
    expect(box.calls()).toBe("");
  });

  it.each([
    ["an unrelated request id", rehearsalActive("some-other-grant")],
    ["the run-2 G7 request id with a narrower Action scope", rehearsalActive(G7, REHEARSAL_ACTIONS.slice(0, 2))],
    ["the run-2 G7 request id with another Plan", rehearsalActive(G7, REHEARSAL_ACTIONS, ["three-action-rehearsal/other-plan"])],
    ["the run-1 G7 request id with a narrower Action scope", rehearsalActive("grant-production-three-action-rehearsal-2026-10-04", REHEARSAL_ACTIONS.slice(1))],
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
    ["run 2's", G7],
    ["run 1's", "grant-production-three-action-rehearsal-2026-10-04"]
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
