import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * The G1, G6, G7 and G8 operator pairs for the disposable three-Action
 * rehearsal. Every behavioral case runs a pair copied into a throwaway
 * library with fake `mise`, `gh`, `codex`, `timeout` and `sleep` on PATH, so
 * no case reaches GitHub, production policy, a model or a service.
 */
const repoRoot = path.resolve(import.meta.dirname, "..");
const library = path.join(repoRoot, "artifacts", "generated", "operator-scripts");
const G1 = "prepare-three-action-rehearsal-fixture-2026-10-04";
const G6 = "preflight-three-action-rehearsal-2026-10-04";
const G7 = "grant-production-three-action-rehearsal-2026-10-04";
const G8 = "restore-terminal-off-three-action-rehearsal-2026-10-04";
const PAIRS = [G1, G6, G7, G8];
const source = (id: string) => readFileSync(path.join(library, `${id}.sh`), "utf8");

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
const temp = (prefix: string) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

type Reply = { stdout?: string; stderr?: string; status?: number };
type Replies = Record<string, Reply | Reply[]>;

// Fake CLIs answer from a JSON table; an array is consumed in order and its
// last entry repeats. Every call is appended to calls.log.
const FAKE = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const root = process.env.FAKE_ROOT, name = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(path.join(root, "calls.log"), name + " " + JSON.stringify(args) + "\\n");
const replies = JSON.parse(fs.readFileSync(path.join(root, "replies.json"), "utf8"));
let key = name + " " + args.join(" ");
if (name === "mise") {
  const rest = args.slice(2);
  if (rest[0] === "pnpm") key = "arcadia " + rest.slice(3).filter((a) => !a.startsWith("--")).slice(0, 2).join(" ");
  else if (rest.includes("tsx")) {
    const program = fs.readFileSync(0, "utf8");
    key = program.includes("fixtureSessions") ? "probe sessions" : program.includes("checkProviderSignIn") ? "probe claude"
      : program.includes("observeProviderCapacity") ? "probe capacity" : "probe leases";
  } else key = "node preflight";
}
const match = Object.keys(replies).filter((k) => key === k || key.startsWith(k + " ")).sort((a, b) => b.length - a.length)[0];
let reply = match === undefined ? { status: 97, stderr: "unexpected call: " + key } : replies[match];
if (Array.isArray(reply)) {
  const counter = path.join(root, "counter-" + Buffer.from(match).toString("hex"));
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  reply = reply[Math.min(n, reply.length - 1)];
}
// "{{arg:--flag}}" in a reply is replaced by the value that followed --flag.
if (reply.stdout) process.stdout.write(reply.stdout.replace(/[{][{]arg:([^}]+)[}][}]/g, (_m, flag) => args[args.indexOf(flag) + 1] ?? ""));
if (reply.stderr) process.stderr.write(reply.stderr);
process.exit(reply.status ?? 0);
`;

function git(cwd: string, args: string[]) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

/** A throwaway Arcadia checkout whose library holds one copied pair. */
function sandboxFor(id: string, replies: Replies, extraLibraryFiles: Record<string, string> = {}) {
  const root = temp("arcadia-three-action-pair-");
  const checkout = path.join(root, "arcadia");
  const scripts = path.join(checkout, "artifacts", "generated", "operator-scripts");
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  mkdirSync(home);
  mkdirSync(path.join(checkout, "scripts"));
  writeFileSync(path.join(checkout, ".gitignore"), "artifacts/\n");
  writeFileSync(path.join(checkout, "scripts", "services.sh"), "#!/bin/sh\necho 'worker: running (pid 1)'\n", { mode: 0o755 });
  git(checkout, ["init", "-q", "-b", "main"]);
  git(checkout, ["-c", "user.name=t", "-c", "user.email=t@t.test", "add", "-A"]);
  git(checkout, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", "init"]);
  git(checkout, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  copyFileSync(path.join(library, `${id}.sh`), path.join(scripts, `${id}.sh`));
  chmodSync(path.join(scripts, `${id}.sh`), 0o755);
  copyFileSync(path.join(library, `${id}.json`), path.join(scripts, `${id}.json`));
  for (const [name, content] of Object.entries(extraLibraryFiles)) writeFileSync(path.join(scripts, name), content, { mode: 0o755 });
  for (const tool of ["mise", "gh", "codex"]) writeFileSync(path.join(bin, tool), FAKE, { mode: 0o755 });
  writeFileSync(path.join(bin, "timeout"), "#!/bin/sh\nshift\nexec \"$@\"\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(path.join(root, "replies.json"), JSON.stringify(replies));
  writeFileSync(path.join(root, "calls.log"), "");
  const run = (env: Record<string, string | undefined> = {}, args = ["run"]) => {
    const childEnv: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_ROOT: root, ...env };
    for (const key of ["CODEX_SANDBOX", "ARCADIA_OPERATOR_SCRIPT_ID", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", "ANTHROPIC_API_KEY", "ARCADIA_REHEARSAL_GITHUB_REPO"]) {
      if (!(key in env)) delete childEnv[key];
    }
    return spawnSync("bash", [path.join(scripts, `${id}.sh`), ...args], { env: childEnv, encoding: "utf8", timeout: 60_000 });
  };
  const runDirs = () => existsSync(path.join(scripts, "runs")) ? readdirSync(path.join(scripts, "runs")).map((d) => path.join(scripts, "runs", d)) : [];
  const receipt = () => {
    const [dir] = runDirs();
    return { dir, json: JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8")) };
  };
  const calls = () => readFileSync(path.join(root, "calls.log"), "utf8");
  return { root, checkout, scripts, home, run, runDirs, receipt, calls };
}

const ok = (data: unknown): Reply => ({ stdout: JSON.stringify({ ok: true, data }) });
const status = (desiredState: string, extra: Record<string, unknown> = {}) => ok({
  read: { status: "ok", policy: { desiredState, revision: 5, epoch: 3, authority: desiredState === "active" ? { requestId: "some-grant" } : null } },
  liveAdmissions: 0, ...extra
});
const workspaceReply = (root: string) => ok({ source: "user config", workspacePath: path.join(root, "martianrover") });

describe("three-Action rehearsal operator pairs: contract and static safety", () => {
  it.each(PAIRS)("%s passes the library contract, describes itself, and rejects any other entrypoint", (id) => {
    const descriptor = JSON.parse(readFileSync(path.join(library, `${id}.json`), "utf8"));
    expect(() => validateOperatorScriptContract(descriptor, id, source(id))).not.toThrow();
    const box = sandboxFor(id, {});
    const described = box.run({}, ["--describe"]);
    expect(described.status).toBe(0);
    expect(JSON.parse(described.stdout)).toEqual(descriptor);
    expect(box.run({}, ["apply"]).status).toBe(2);
    expect(box.runDirs()).toEqual([]);
  });

  it.each(PAIRS)("%s contains no raw kill, recursive delete, repository delete, force push or history rewrite", (id) => {
    const text = source(id);
    for (const pattern of [/\bkill\b/, /\bpkill\b/, /rm -rf/, /gh repo delete/, /--force\b/, /push\s+(-\S+\s+)*-f\b/, /reset --hard/, /worktree remove/, /branch -D/, /production reactivate/, /gh pr merge/]) {
      expect(text, `${id} must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it("only G7 previews or activates production, and G6 never turns anything Off", () => {
    for (const id of [G1, G6, G8]) expect(source(id)).not.toMatch(/production (preview|activate)/);
    expect(source(G6)).not.toMatch(/production deactivate/);
  });

  it("G7 activates exactly once, after the hermetic replay, the fresh G6 receipt and a matching preview, with the bound scope", () => {
    const text = source(G7);
    const activate = text.indexOf("arcadia production activate");
    expect(text.split("arcadia production activate").length).toBe(2);
    for (const before of ["rehearsal-three-action.test.ts", "PREFLIGHT_ID", "arcadia production preview", "scopeFingerprint"]) {
      expect(text.indexOf(before)).toBeGreaterThan(-1);
      expect(text.indexOf(before)).toBeLessThan(activate);
    }
    expect(text).toContain("--remote-preservation");
    expect(text).toContain("--concurrency 1");
    expect(text).toContain('--packet-approval-expires-at "$EXPIRES"');
    expect(text).toContain('--integration-grant-decision "$INTEGRATION_DECISION"');
    expect(text.match(/--integration-grant-action "\$PROJECT\/\$ACTION_[ABC]"/g)).toHaveLength(3);
    expect(text).toContain('--expected-revision "$REVISION"');
    expect(text).not.toMatch(/--expected-revision\s+\d/);
    const descriptor = JSON.parse(readFileSync(path.join(library, `${G7}.json`), "utf8"));
    expect(descriptor.kind).toBe("grant");
    expect(descriptor.repeatable).toBe(false);
    expect(descriptor.operator_acknowledgement).toContain("issues/925");
    expect(descriptor.authority.never_does.join(" ")).toMatch(/GitHub merge.*base branch/);
  });

  it("G8 restarts only through the hash-pinned reviewed host-service action", () => {
    const text = source(G8);
    expect(text).toContain("recover-arcadia-host-services");
    expect(text).toMatch(/RECOVER_SCRIPT_SHA256="[0-9a-f]{64}"/);
    expect(text).not.toMatch(/services\.sh restart|launchctl|worker (stop|start)/);
  });
});

describe("G1 fixture preparation refuses unsafe or missing input with a receipt", () => {
  it("refuses without the operator-supplied repository before touching GitHub or Arcadia", () => {
    const box = sandboxFor(G1, {});
    const result = box.run();
    expect(result.status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ id: G1, outcome: "refused", stage: "parameters", productionPreviewedOrActivated: false });
    expect(json.reason).toContain("ARCADIA_REHEARSAL_GITHUB_REPO is required");
    expect(existsSync(path.join(dir, "failure-handoff.md"))).toBe(true);
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("No GitHub repository was created");
    expect(box.calls()).toBe("");
  });

  it.each(["pmark/arcadia", "pmark/arcadia-three-action-rehearsal/extra", "-bad/arcadia-three-action-rehearsal", "pmark/arcadia-three-action-rehearsal-UPPER", "noslash"])(
    "refuses the unsafe identifier %s", (identifier) => {
      const box = sandboxFor(G1, {});
      expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: identifier }).status).not.toBe(0);
      expect(box.receipt().json).toMatchObject({ outcome: "refused", stage: "parameters" });
      expect(box.calls()).toBe("");
    });

  const ready = (repoView: Reply, extra: Replies = {}): Replies => ({
    "arcadia production status": status("inactive"),
    "gh api user": { stdout: "pmark\n" },
    "gh repo view": repoView,
    ...extra
  });
  const view = (fields: Record<string, unknown>): Reply => ({ stdout: JSON.stringify({ name: "x", owner: { login: "pmark" }, visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, isEmpty: false, description: "someone else's", ...fields }) });

  it.each([
    ["a public repository", view({ visibility: "PUBLIC", isPrivate: false }), "is not private"],
    ["an archived repository", view({ isArchived: true }), "archived or a fork"],
    ["a foreign non-empty private repository", view({}), "not a repository this script created"],
    ["an unknown GitHub answer", { status: 1, stderr: "HTTP 502: bad gateway" }, "unknown is not absent"]
  ])("refuses %s without creating, pushing or writing a local fixture", (_label, repoView, reason) => {
    const box = sandboxFor(G1, ready(repoView));
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: "pmark/arcadia-three-action-rehearsal-t1" }).status).not.toBe(0);
    const { json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "github_repository", githubRepositoryChanged: false });
    expect(json.reason).toContain(reason);
    expect(box.calls()).not.toMatch(/repo","create|"push"/);
    expect(existsSync(path.join(box.home, "tmp", "arcadia-three-action-rehearsal"))).toBe(false);
  });

  it("refuses a repository owned by someone other than the authenticated user", () => {
    const box = sandboxFor(G1, ready(view({}), { "gh api user": { stdout: "someone-else\n" } }));
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: "pmark/arcadia-three-action-rehearsal" }).status).not.toBe(0);
    expect(box.receipt().json).toMatchObject({ outcome: "refused", stage: "github_identity" });
  });

  it("refuses while production is Active", () => {
    const box = sandboxFor(G1, ready(view({}), { "arcadia production status": status("active") }));
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: "pmark/arcadia-three-action-rehearsal" }).status).not.toBe(0);
    expect(box.receipt().json.reason).toContain("must be Inactive");
    expect(box.calls()).not.toContain("gh ");
  });
});

describe("G6 preflight refuses unknown, stale, paid or unavailable evidence", () => {
  const replies = (root: string): Replies => ({
    "arcadia workspace resolve": workspaceReply(root),
    "arcadia production status": status("inactive"),
    "arcadia go-broker status": { status: 1, stdout: JSON.stringify({ ok: false }) },
    "arcadia worker status": { stdout: "Worker: not running (no pidfile)\n" },
    "probe leases": { stdout: JSON.stringify({ active: 0, fixtureActive: [] }) },
    "probe claude": { stdout: JSON.stringify({ verdict: "signed_out" }) },
    "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_planning"], codex: { admitted: true, freshness: "stale", confidence: "observed", usagePolicy: "included", evidence: "observed", availability: "available" } }) },
    "codex --version": { stdout: "codex 1.0\n" },
    "codex login status": { stdout: "Logged in using an API key - sk-***\n" },
    "gh auth status": { status: 0 }
  });

  it("records every check, refuses the bad ones, and never previews, activates or turns anything Off", () => {
    const box = sandboxFor(G6, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify(replies(box.root)));
    expect(box.run().status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ id: G6, outcome: "refused", stage: "verdict", productionPreviewedOrActivated: false, policyRevision: 5 });
    const verdicts = Object.fromEntries(json.checks.map((c: { name: string; status: string }) => [c.name, c.status]));
    expect(verdicts).toMatchObject({
      arcadia_checkout: "pass", installed_features: "refuse", workspace: "pass", production_status: "pass",
      installed_release: "refuse", worker: "refuse", fixture: "refuse", fixture_leases: "pass",
      claude_worker_token: "refuse", codex_reviewer_login: "refuse", codex_reviewer_profile: "pass",
      codex_capacity: "refuse", github_auth: "pass", github_repository: "refuse"
    });
    expect(json.checks.find((c: { name: string }) => c.name === "codex_reviewer_login").detail).toContain("paid");
    expect(existsSync(path.join(dir, "failure-handoff.md"))).toBe(true);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)/);
  });

  it("refuses a set ANTHROPIC_API_KEY without ever reading its value into the log or receipt", () => {
    const box = sandboxFor(G6, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({ ...replies(box.root), "probe claude": { stdout: JSON.stringify({ verdict: "signed_in" }) } }));
    expect(box.run({ ANTHROPIC_API_KEY: "sk-ant-secret-value-123" }).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json.checks.find((c: { name: string }) => c.name === "claude_worker_token")).toMatchObject({ status: "refuse" });
    for (const file of ["run.log", "receipt.json"]) expect(readFileSync(path.join(dir, file), "utf8")).not.toContain("sk-ant-secret-value-123");
  });

  const probeProgram = (id: string, file: string) => source(id).split(`cat > "$RUN_DIR/${file}" <<'NODE'\n`)[1].split("\nNODE")[0];
  const runProbe = (program: string, args: string[]) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.VITEST;
    return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-", ...args], { cwd: repoRoot, input: program, env, encoding: "utf8", timeout: 30_000 });
  };

  it("reports only the worker-context Claude Code verdict, never the token", () => {
    const workspace = temp("arcadia-g6-claude-");
    mkdirSync(path.join(workspace, "config"), { mode: 0o700 });
    const token = path.join(workspace, "config", "claude-code-oauth-token");
    writeFileSync(token, "sk-ant-oat-never-print-this", { mode: 0o600 });
    const signedIn = runProbe(probeProgram(G6, "probe-claude-sign-in.mjs"), [workspace]);
    expect(JSON.parse(signedIn.stdout)).toEqual({ verdict: "signed_in" });
    expect(signedIn.stdout + signedIn.stderr).not.toContain("never-print-this");
    chmodSync(token, 0o644);
    const refused = runProbe(probeProgram(G6, "probe-claude-sign-in.mjs"), [workspace]);
    expect(JSON.parse(refused.stdout)).toEqual({ verdict: "signed_out" });
    expect(refused.stdout + refused.stderr).not.toContain("never-print-this");
  });

  it("observes leases and fixture Sessions read-only against a real workspace database", () => {
    const workspace = path.join(temp("arcadia-g6-db-"), "workspace");
    initWorkspace(workspace);
    const leases = runProbe(probeProgram(G6, "probe-leases.mjs"), [workspace, "three-action-rehearsal"]);
    expect(JSON.parse(leases.stdout)).toEqual({ active: 0, fixtureActive: [] });
    const sessions = runProbe(probeProgram(G8, "probe-sessions.mjs"), [workspace, "three-action-rehearsal"]);
    expect(JSON.parse(sessions.stdout)).toEqual({ active: [], fixtureSessions: [] });
  });
});

describe("G7 Grant refuses before preview when its preconditions are missing", () => {
  it("refuses outside the /runs launcher without any Arcadia call", () => {
    const box = sandboxFor(G7, {});
    expect(box.run().status).not.toBe(0);
    expect(box.receipt().json).toMatchObject({ id: G7, outcome: "refused", stage: "launch_context", activated: false });
    expect(box.calls()).toBe("");
  });

  it("refuses an agent sandbox even through the launcher", () => {
    const box = sandboxFor(G7, {});
    const env = { ARCADIA_OPERATOR_SCRIPT_ID: G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`), CODEX_SANDBOX: "seatbelt" };
    expect(box.run(env).status).not.toBe(0);
    expect(box.receipt().json.reason).toContain("host-only");
  });

  it("refuses when main lacks the installed features, never reaching preview or activation", () => {
    const box = sandboxFor(G7, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({ "arcadia workspace resolve": workspaceReply(box.root) }));
    const env = { ARCADIA_OPERATOR_SCRIPT_ID: G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) };
    expect(box.run(env).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "preconditions", activated: false, offCleanup: "not_needed" });
    expect(json.reason).toContain("lacks required commit");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("The Grant was not applied");
    expect(box.calls()).not.toMatch(/production/);
  });
});

describe("G7 host replay of the hermetic three-Action rehearsal", () => {
  const program = source(G7).split("<<'PREFLIGHT'\n")[1].split("\nPREFLIGHT")[0];
  const TICK = "launches ... (the tick readying each PR and running both host review commands)";
  const report = (titles: Array<[string, string]>, failed = 0) => JSON.stringify({
    numFailedTests: failed, testResults: [{ assertionResults: titles.map(([title, s]) => ({ title, status: s })) }]
  });

  function replay(fakePnpm: string, options: { sandbox?: string; timeout?: number; reportParent?: boolean } = {}) {
    const directory = temp("arcadia-g7-replay-");
    writeFileSync(path.join(directory, "pnpm"), `#!/bin/sh\n${fakePnpm}\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${directory}:${process.env.PATH}`, ARCADIA_OPERATOR_SCRIPT_ID: "live-g7", ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: "/operator/live-g7.json" };
    delete env.CODEX_SANDBOX;
    if (options.sandbox) env.CODEX_SANDBOX = options.sandbox;
    let input = options.timeout ? program.replace("300_000", String(options.timeout)) : program;
    if (options.reportParent) input = input.replace("console.log(`Hermetic", "console.log(JSON.stringify({ id: process.env.ARCADIA_OPERATOR_SCRIPT_ID, descriptor: process.env.ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR })); console.log(`Hermetic");
    const reportPath = path.join(directory, "report.json");
    const result = spawnSync(process.execPath, ["--input-type=module", "-", directory, reportPath], { input, env, encoding: "utf8", timeout: 10_000 });
    return { directory, reportPath, result };
  }
  // The fake writes the JSON report the real vitest run would write, to the path it was given.
  const writesReport = (json: string, extra = "") => `${extra}\nfor a in "$@"; do case "$a" in --outputFile.json=*) printf '%s' '${json}' > "\${a#--outputFile.json=}";; esac; done`;

  it("refuses an agent sandbox before running any replay process", () => {
    const { directory, result } = replay("touch invoked", { sandbox: "seatbelt" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("host operator-action library");
    expect(existsSync(path.join(directory, "invoked"))).toBe(false);
  });

  it("propagates a failed replay so the Grant cannot continue", () => {
    const { result } = replay("echo replay-failed >&2\nexit 7");
    expect(result.status).toBe(7);
  });

  it("runs the exact suite with host validation, bounded discovery and isolated operator context, and requires every variant including the tick", () => {
    const passing = report([["simulated", "passed"], ["host commands", "passed"], [TICK, "passed"]]);
    const fake = writesReport(passing, 'test "$ARCADIA_PRESERVATION_HOST_TEST" = 1 || exit 9\ntest -z "${ARCADIA_OPERATOR_SCRIPT_ID+x}" || exit 10\ntest -z "${ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR+x}" || exit 11\nprintf "%s\\n" "$@" > "$(dirname "$0")/args"');
    const { directory, reportPath, result } = replay(fake, { reportParent: true });
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(directory, "args"), "utf8").trim().split("\n")).toEqual([
      "exec", "vitest", "run", "--dir", "tests", "rehearsal-three-action.test.ts", "--reporter=default", "--reporter=json", `--outputFile.json=${reportPath}`
    ]);
    expect(JSON.parse(result.stdout.split("\n")[0])).toEqual({ id: "live-g7", descriptor: "/operator/live-g7.json" });
  });

  it.each([
    ["the tick variant is missing", report([["simulated", "passed"], ["host commands", "passed"], ["other", "passed"]])],
    ["a variant was skipped", report([["simulated", "passed"], ["host commands", "skipped"], [TICK, "passed"]])],
    ["a test failed", report([["simulated", "passed"], ["host commands", "passed"], [TICK, "passed"]], 1)]
  ])("refuses when %s even though vitest exited zero", (_label, json) => {
    const { result } = replay(writesReport(json));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tick-driven review variant");
  });

  it("refuses when the replay wrote no report", () => {
    const { result } = replay("exit 0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no readable JSON report");
  });

  it("refuses a replay that exceeds its process deadline", () => {
    const { result } = replay("sleep 1", { timeout: 20 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ETIMEDOUT");
  });
});

describe("G8 terminal Off uses only governed paths and never discards work", () => {
  const quiet = { stdout: JSON.stringify({ active: [], fixtureSessions: [] }) };

  it("records an already-Inactive Off, proves quiet observations, then refuses an absent reviewed restart path", () => {
    const box = sandboxFor(G8, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root), "arcadia production status": status("inactive"), "probe sessions": quiet
    }));
    expect(box.run().status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ id: G8, outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false, rawProcessSignals: 0, candidatesDiscarded: 0, offRevision: 5, offEpoch: 3 });
    expect(json.reason).toContain("missing from the library");
    const ledger = readFileSync(path.join(dir, "intervention-ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line).intervention);
    expect(ledger).toEqual(["none", "observation", "stopped"]);
    expect(readFileSync(path.join(dir, "observations-drain.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(existsSync(path.join(dir, "inactive-receipt.json"))).toBe(true);
    expect(box.calls()).not.toMatch(/deactivate/);
  });

  it("turns an Active policy Off through deactivate first, and refuses a recover action whose bytes differ from review", () => {
    const box = sandboxFor(G8, {}, {
      "recover-arcadia-host-services.sh": "#!/bin/sh\ntouch \"$(dirname \"$0\")/recover-ran\"\n",
      "recover-arcadia-host-services.json": "{}\n"
    });
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia production status": [status("active"), status("inactive")],
      "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }),
      "probe sessions": quiet
    }));
    expect(box.run().status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false });
    expect(json.reason).toContain("differs from its reviewed bytes");
    expect(existsSync(path.join(box.scripts, "recover-ran"))).toBe(false);
    const ledger = readFileSync(path.join(dir, "intervention-ledger.jsonl"), "utf8");
    expect(ledger).toContain("revoked active policy some-grant");
    expect(box.calls()).toMatch(/"production","deactivate","--request-id","restore-terminal-off-three-action-rehearsal-2026-10-04-/);
  });

  it("refuses with Off confirmed when live work does not drain within the bound, never killing it", () => {
    const box = sandboxFor(G8, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia production status": status("inactive", { liveAdmissions: 1 }),
      "probe sessions": { stdout: JSON.stringify({ active: [{ id: "s1", project: "three-action-rehearsal", action: "write-start-marker", status: "running" }], fixtureSessions: [] }) }
    }));
    // A one-second drain bound keeps the case fast; `sleep` is a no-op fake.
    const script = path.join(box.scripts, `${G8}.sh`);
    writeFileSync(script, readFileSync(script, "utf8").replace("DRAIN_DEADLINE_SECONDS=1800", "DRAIN_DEADLINE_SECONDS=1"));
    expect(box.run().status).not.toBe(0);
    const { json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "drain", offState: "confirmed", restarted: false });
    expect(json.reason).toContain("nothing was killed");
  });
});

// ---------------------------------------------------------------------------
// Happy paths. The copied script's pinned constants (installed-feature commits,
// reviewed restart hashes) are rebound to the throwaway checkout, exactly as
// the drain bound is above; every other byte is the reviewed script.

const FIXTURE_REPO_ID = "pmark/arcadia-three-action-rehearsal-t1";
const commitAll = (cwd: string, message: string) => {
  git(cwd, ["add", "-A"]);
  git(cwd, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
};
function createFixture(home: string) {
  const fixture = path.join(home, "tmp", "arcadia-three-action-rehearsal");
  mkdirSync(fixture, { recursive: true });
  writeFileSync(path.join(fixture, ".arcadia-three-action-rehearsal.json"), JSON.stringify({
    schema: "arcadia-three-action-rehearsal-fixture-v1", githubRepository: FIXTURE_REPO_ID, fixtureProject: "three-action-rehearsal",
    fixturePlan: "autonomous-three-action-rehearsal", actions: ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"],
    provider: "claude-code-cli", agentProfile: "claude_build", validationCommand: "node scripts/check-rehearsal.mjs"
  }));
  git(fixture, ["init", "-q", "-b", "main"]);
  const root = commitAll(fixture, "genesis");
  git(fixture, ["remote", "add", "origin", `https://github.com/${FIXTURE_REPO_ID}.git`]);
  writeFileSync(path.join(fixture, ".git", "arcadia-three-action-first-packet-approval"), "review_1\n");
  return { fixture, root };
}
const rebind = (box: ReturnType<typeof sandboxFor>, id: string, replace: Array<[RegExp, string]>) => {
  const script = path.join(box.scripts, `${id}.sh`);
  let text = readFileSync(script, "utf8");
  for (const [pattern, value] of replace) {
    expect(text, String(pattern)).toMatch(pattern);
    text = text.replace(pattern, value);
  }
  writeFileSync(script, text);
};
const parsedCalls = (box: ReturnType<typeof sandboxFor>) => box.calls().trim().split("\n").filter(Boolean)
  .map((line) => ({ tool: line.slice(0, line.indexOf(" ")), args: JSON.parse(line.slice(line.indexOf(" ") + 1)) as string[] }));
const arcadiaCalls = (box: ReturnType<typeof sandboxFor>, verb: string) => parsedCalls(box).filter((c) => c.tool === "mise" && c.args[3] === "-s" && c.args[5] === "production" && c.args[6] === verb);

describe("G7 Grant previews and activates only the exact bound scope", () => {
  function grantBox(previewScope: Record<string, unknown> = {}, activationFingerprint = "fp-1") {
    const box = sandboxFor(G7, {});
    mkdirSync(path.join(box.checkout, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(box.checkout, "docs", "decisions", "0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"), "---\nstatus: approved\n---\n");
    const head = commitAll(box.checkout, "decision");
    git(box.checkout, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    rebind(box, G7, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`]]);
    const { root } = createFixture(box.home);
    const workspace = path.join(box.root, "martianrover");
    const g6 = path.join(box.scripts, "runs", "20000101T000000Z-1");
    mkdirSync(g6, { recursive: true });
    writeFileSync(path.join(g6, "receipt.json"), JSON.stringify({
      id: G6, outcome: "succeeded", finishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), arcadiaHead: head, brokerRevision: head,
      githubRepository: FIXTURE_REPO_ID, rootCommit: root, workspace, policyRevision: 5
    }));
    const actions = ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"].map((a) => `three-action-rehearsal/${a}`);
    const scope = {
      projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions,
      providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"],
      remotePreservation: true, packetApprovalExpiresAt: "{{arg:--packet-approval-expires-at}}",
      integrationGrant: { decisionRef: "0058", expiresAt: "{{arg:--integration-grant-expires-at}}", actions }, ...previewScope
    };
    const own = ok({ read: { status: "ok", policy: { desiredState: "active", revision: 6, epoch: 4, authority: { requestId: G7 } } }, liveAdmissions: 0 });
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia go-broker status": ok({ ready: true, revision: head, preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
      "arcadia production status": [status("inactive"), own],
      "node preflight": { stdout: "Hermetic three-Action rehearsal passed\n" },
      "arcadia production preview": ok({ preview: { expectedRevision: 5, scope, scopeFingerprint: "fp-1", unmatched: { projects: [], plans: [] } } }),
      "arcadia production activate": ok({ result: { policy: { desiredState: "active", revision: 6, authority: { requestId: G7, scopeFingerprint: activationFingerprint } } } }),
      "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } })
    }));
    const env = { ARCADIA_OPERATOR_SCRIPT_ID: G7, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G7}.json`) };
    return { box, env, actions };
  }

  it("replays the rehearsal, previews at the current revision, and activates the previewed fingerprint once", () => {
    const { box, env, actions } = grantBox();
    const result = box.run(env);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const [, dir] = box.runDirs().sort();
    const json = JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8"));
    expect(json).toMatchObject({ id: G7, outcome: "succeeded", activated: true, scopeFingerprint: "fp-1", policyRevisionBefore: 5, policyRevisionAfter: 6, githubRepository: FIXTURE_REPO_ID });
    expect(json.neverAuthorizes).toContain("GitHub merge, a base-branch push");
    expect(readFileSync(path.join(dir, "receipt.md"), "utf8")).toContain("#925");
    const order = parsedCalls(box).map((c) => (c.args[2] === "node" ? "replay" : c.args.slice(5, 7).join(" ")));
    expect(order.indexOf("replay")).toBeLessThan(order.indexOf("production preview"));
    expect(order.indexOf("production preview")).toBeLessThan(order.indexOf("production activate"));
    const [activate] = arcadiaCalls(box, "activate");
    expect(arcadiaCalls(box, "activate")).toHaveLength(1);
    const args = activate.args;
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args).toContain("--remote-preservation");
    expect(value("--expected-revision")).toBe("5");
    expect(value("--request-id")).toBe(G7);
    expect(value("--concurrency")).toBe("1");
    expect(value("--provider")).toBe("claude-code-cli");
    expect(value("--transitions")).toBe("validation,acceptance,pointer,packet_approval");
    expect(value("--integration-grant-decision")).toBe("0058");
    expect(args.filter((_a, i) => args[i - 1] === "--integration-grant-action")).toEqual(actions);
    expect(args.filter((_a, i) => args[i - 1] === "--action")).toEqual(actions);
    const expiry = Date.parse(value("--packet-approval-expires-at"));
    expect(expiry - Date.now()).toBeGreaterThan(11 * 3600e3);
    expect(expiry - Date.now()).toBeLessThanOrEqual(12 * 3600e3);
    expect(value("--integration-grant-expires-at")).toBe(value("--packet-approval-expires-at"));
    expect(arcadiaCalls(box, "deactivate")).toHaveLength(0);
  });

  it("refuses a preview without remote preservation and never activates", () => {
    const { box, env } = grantBox({ remotePreservation: undefined });
    expect(box.run(env).status).not.toBe(0);
    const [, dir] = box.runDirs().sort();
    expect(JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8"))).toMatchObject({ outcome: "refused", stage: "preview", activated: false });
    expect(arcadiaCalls(box, "activate")).toHaveLength(0);
  });

  it("returns only its own Grant to Off when the active fingerprint differs from the preview", () => {
    const { box, env } = grantBox({}, "fp-other");
    expect(box.run(env).status).not.toBe(0);
    const [, dir] = box.runDirs().sort();
    expect(JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8"))).toMatchObject({ outcome: "refused", stage: "activate", activated: true, offCleanup: "returned_off" });
    const [off] = arcadiaCalls(box, "deactivate");
    expect(off.args[off.args.indexOf("--request-id") + 1]).toMatch(new RegExp(`^${G7}-.*-off$`));
  });

  it("refuses a stale G6 receipt", () => {
    const { box, env } = grantBox();
    const receiptPath = path.join(box.scripts, "runs", "20000101T000000Z-1", "receipt.json");
    const stale = JSON.parse(readFileSync(receiptPath, "utf8"));
    writeFileSync(receiptPath, JSON.stringify({ ...stale, finishedAt: "2026-01-01T00:00:00Z" }));
    expect(box.run(env).status).not.toBe(0);
    const [, dir] = box.runDirs().sort();
    expect(JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8")).reason).toMatch(/G6 preflight is \d+s old/);
    expect(parsedCalls(box).some((c) => c.args[2] === "node")).toBe(false);
  });
});

describe("G8 proves terminal Off through the reviewed restart and reconciles committed work", () => {
  function offBox(preserveSecond: boolean) {
    const recover = "#!/bin/sh\ntest \"$ARCADIA_WORKSPACE\" != \"\" || exit 8\ntest -z \"${ARCADIA_OPERATOR_SCRIPT_ID+x}\" || exit 9\ntouch \"$(dirname \"$0\")/recover-ran\"\n";
    const box = sandboxFor(G8, {}, { "recover-arcadia-host-services.sh": recover, "recover-arcadia-host-services.json": "{}\n" });
    const digest = (name: string) => {
      const run = spawnSync(process.execPath, ["-e", `process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(${JSON.stringify(path.join(box.scripts, name))})).digest("hex"))`]);
      return run.stdout.toString();
    };
    rebind(box, G8, [
      [/RECOVER_SCRIPT_SHA256="[0-9a-f]{64}"/, `RECOVER_SCRIPT_SHA256="${digest("recover-arcadia-host-services.sh")}"`],
      [/RECOVER_DESCRIPTOR_SHA256="[0-9a-f]{64}"/, `RECOVER_DESCRIPTOR_SHA256="${digest("recover-arcadia-host-services.json")}"`]
    ]);
    const { fixture, root } = createFixture(box.home);
    // Session 1 integrated into fixture main; Session 2 left a committed candidate.
    writeFileSync(path.join(fixture, "MARKER.md"), "three-action rehearsal start\n");
    const integrated = commitAll(fixture, "A");
    const candidate = path.join(box.root, "candidate-b");
    git(box.root, ["clone", "-q", fixture, candidate]);
    writeFileSync(path.join(candidate, "MARKER.md"), "three-action rehearsal start\nTHREE-ACTION REHEARSAL START\n");
    const candidateTip = commitAll(candidate, "B");
    const sessions = [
      { id: "s1", action_id: "write-start-marker", status: "completed", branch: "agent/a", worktree_path: path.join(box.root, "gone"), base_revision: root, preservation: null },
      { id: "s2", action_id: "transform-start-marker", status: "completed", branch: "agent/b", worktree_path: candidate, base_revision: integrated, preservation: preserveSecond ? { commit_sha: candidateTip, preservation_state: "IN PR", pull_request_url: "https://github.com/x/pull/2" } : null },
      { id: "s3", action_id: "verify-final-rehearsal", status: "failed", branch: "agent/c", worktree_path: path.join(box.root, "never"), base_revision: candidateTip, preservation: null }
    ];
    git(fixture, ["branch", "agent/a", integrated]);
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia production status": status("inactive"),
      "arcadia worker status": { stdout: "Worker: running (PID 42)\n" },
      "probe sessions": { stdout: JSON.stringify({ active: [], fixtureSessions: sessions }) }
    }));
    return { box, candidate, candidateTip };
  }

  it("restarts once through the pinned path, observes quiet before and after, and writes the receipts and ledger", () => {
    const { box } = offBox(true);
    const result = box.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ id: G8, outcome: "succeeded", offState: "confirmed", restarted: true, rawProcessSignals: 0, candidatesDiscarded: 0 });
    expect(existsSync(path.join(box.scripts, "recover-ran"))).toBe(true);
    const restart = JSON.parse(readFileSync(path.join(dir, "restart-receipt.json"), "utf8"));
    expect(restart).toMatchObject({ path: "recover-arcadia-host-services", exitStatus: 0, workerAfter: "Worker: running (PID 42)" });
    const states = readFileSync(path.join(dir, "work-reconciliation.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).state);
    expect(states).toEqual(["integrated", "preserved", "no_committed_work"]);
    const ledger = readFileSync(path.join(dir, "intervention-ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).intervention);
    expect(ledger).toEqual(["none", "observation", "service_restart", "observation", "completed"]);
    expect(readFileSync(path.join(dir, "observations-post_restart.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("refuses unreconciled committed work and leaves the candidate exactly as it was", () => {
    const { box, candidate, candidateTip } = offBox(false);
    expect(box.run().status).not.toBe(0);
    const { json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "reconcile_work", offState: "confirmed", restarted: true });
    expect(json.reason).toContain("retained untouched");
    expect(git(candidate, ["rev-parse", "HEAD"])).toBe(candidateTip);
    expect(git(candidate, ["status", "--porcelain"])).toBe("");
  });
});
