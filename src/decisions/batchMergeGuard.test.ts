import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildBatchMergeCard, buildBatchMergeDescriptor, type BatchPrFacts } from "./batchMerge.js";
import {
  BATCH_GUARD_TRACKED,
  bindDescriptorText,
  parseGitRemoteSlug,
  GIT_SAFE_ARGS,
  runBatchMergeGuard,
  sanitizedGitEnv,
  systemGit,
  type GuardGit,
} from "./batchMergeGuard.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const sha = (c: string) => c.repeat(40);
function pr(number: number): BatchPrFacts {
  const head = sha(String(number));
  return {
    number,
    title: `PR ${number}`,
    headSha: head,
    baseRef: "main",
    headRef: `branch-${number}`,
    files: ["src/x.ts"],
    changedFiles: 1,
    why: "",
    decisions: [],
    reviews: [{ verdict: "APPROVED", headSha: head }],
    checks: [{ name: "ci", conclusion: "SUCCESS" }],
    requiredChecks: ["ci"],
    state: "open",
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

/** A committed scratch checkout with a published descriptor and launcher, plus a bare "origin". */
function fixture(opts: { origin?: "bare" | "bad" } = {}) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "batch-guard-")));
  scratch.push(base);
  const root = path.join(base, "checkout");
  const bare = path.join(base, "origin.git");
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@example.test"]);
  git(root, ["config", "user.name", "t"]);
  const built = buildBatchMergeCard({ prs: [pr(1), pr(2)], now: NOW, expires: "2026-10-13T12:00:00Z" });
  if (!built.ok) throw new Error("fixture card refused");
  const id = built.spec.cardId;
  const dir = path.join(root, "artifacts/generated/operator-scripts");
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "src/decisions"), { recursive: true });
  mkdirSync(path.join(root, "src/operatorActions"), { recursive: true });
  const descriptor = buildBatchMergeDescriptor(built.spec, built.items);
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(descriptor, null, 2));
  writeFileSync(path.join(dir, `${id}.sh`), "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n");
  for (const file of BATCH_GUARD_TRACKED) {
    const target = path.join(root, file.replace("<id>", id));
    mkdirSync(path.dirname(target), { recursive: true });
    if (!file.includes("<id>")) writeFileSync(target, `// ${file}\n`);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  if (opts.origin === "bad") {
    // An origin that cannot be fetched (nothing listens on port 1); the slug is supplied by the wrapper.
    git(root, ["remote", "add", "origin", "ssh://git@127.0.0.1:1/pmark/arcadia.git"]);
  } else {
    git(root, ["remote", "add", "origin", bare]);
    git(root, ["push", "-q", "origin", "main"]);
  }
  const descriptorPath = path.join(dir, `${id}.json`);
  const real = systemGit(root);
  // Report the remote as the pinned repo so the slug check passes while fetch still hits `bare`.
  const withSlug: GuardGit = (args) =>
    args[0] === "remote" && args[1] === "get-url" ? { status: 0, stdout: "https://github.com/pmark/arcadia.git" } : real(args);
  const env = { ARCADIA_OPERATOR_SCRIPT_ID: id, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: descriptorPath };
  return { base, root, id, descriptorPath, descriptor, built, real, withSlug, env, dir };
}

describe("remote slug parsing", () => {
  it.each([
    ["https://github.com/pmark/arcadia.git", "pmark/arcadia"],
    ["https://github.com/pmark/arcadia", "pmark/arcadia"],
    ["git@github.com:pmark/arcadia.git", "pmark/arcadia"],
    ["ssh://git@github.com/pmark/arcadia.git", "pmark/arcadia"],
  ])("%s -> %s", (url, slug) => expect(parseGitRemoteSlug(url)).toBe(slug));
  it.each([
    "https://evil.example/pmark/arcadia.git",
    "https://github.com.evil.example/pmark/arcadia",
    "/local/path/arcadia.git",
    "https://github.com/pmark/arcadia/extra",
    "https://user:pw@github.com/pmark/arcadia",
    "",
  ])("refuses %j", (url) => expect(parseGitRemoteSlug(url)).toBeNull());
});

describe("descriptor text binding", () => {
  const f = fixture();
  it("accepts a descriptor that names every PR and its 7-char head", () => {
    expect(bindDescriptorText(f.descriptor, f.built.spec)).toBeNull();
  });
  it("refuses when a pinned PR number or head is missing from the reviewed text", () => {
    const tamperedHead = JSON.parse(JSON.stringify(f.descriptor)) as { authority: { does: string[] } };
    tamperedHead.authority.does[1] = "Merge PR #2 at head 2222222-not-the-pin".replace("2222222", "9999999");
    expect(bindDescriptorText(tamperedHead, f.built.spec)).toMatch(/#2/);
    const dropped = JSON.parse(JSON.stringify(f.descriptor)) as { problem: string };
    dropped.problem = "Merge some PRs";
    expect(bindDescriptorText(dropped, f.built.spec)).not.toBeNull();
  });
});

describe("guard against a scratch git repo (B4')", () => {
  it("passes for the published, tracked, fetched and unmodified checkout", () => {
    const f = fixture();
    const r = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: false, git: f.withSlug });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.cardId).toBe(f.id);
      expect(r.request.heads).toHaveLength(2);
      expect(r.fetchedSha).toMatch(/^[0-9a-f]{40}$/);
    }
  });
  it("a failed fetch of origin is fatal on a real run (never a swallowed null)", () => {
    const f = fixture({ origin: "bad" });
    const r = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: false, git: f.withSlug });
    expect(r).toMatchObject({ ok: false, code: "fetch_failed" });
  });
  it("a hostile GIT_SSH_COMMAND in the environment never reaches the fetch", () => {
    const f = fixture({ origin: "bad" });
    const marker = path.join(f.base, "hostile-ran");
    const hook = path.join(f.base, "hook.sh");
    writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });
    const saved = { ssh: process.env.GIT_SSH_COMMAND, proxy: process.env.GIT_PROXY_COMMAND };
    process.env.GIT_SSH_COMMAND = hook;
    process.env.GIT_PROXY_COMMAND = hook;
    try {
      const r = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: false, git: f.withSlug });
      expect(r).toMatchObject({ ok: false, code: "fetch_failed" });
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (saved.ssh === undefined) delete process.env.GIT_SSH_COMMAND;
      else process.env.GIT_SSH_COMMAND = saved.ssh;
      if (saved.proxy === undefined) delete process.env.GIT_PROXY_COMMAND;
      else process.env.GIT_PROXY_COMMAND = saved.proxy;
    }
  });
  it("sanitizedGitEnv drops transport, location and config overrides and the base args neutralise config", () => {
    const env = sanitizedGitEnv({
      PATH: "/evil", HOME: "/h", GIT_SSH_COMMAND: "x", GIT_SSH: "x", GIT_PROXY_COMMAND: "x", GIT_EXEC_PATH: "/x", GIT_DIR: "/x",
      GIT_WORK_TREE: "/x", GIT_CONFIG_GLOBAL: "/x", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "a", GIT_ALTERNATE_OBJECT_DIRECTORIES: "/x",
      GIT_FUTURE_THING: "x", KEEP: "1",
    });
    expect(Object.keys(env).filter((k) => k.startsWith("GIT_") && k !== "GIT_TERMINAL_PROMPT")).toEqual([]);
    expect(env.PATH).not.toContain("/evil");
    expect(env.HOME).toBe("/h");
    expect(GIT_SAFE_ARGS).toEqual(expect.arrayContaining(["core.sshCommand=", "http.proxy=", "protocol.ext.allow=never"]));
  });
  it("compares to the fetched sha, not a stale local origin/main ref", () => {
    const f = fixture();
    // Local origin/main matches HEAD; the real origin has since moved with a different tracked file.
    git(f.root, ["fetch", "-q", "origin", "main"]);
    const other = path.join(f.base, "other");
    execFileSync("git", ["clone", "-q", path.join(f.base, "origin.git"), other]);
    git(other, ["config", "user.email", "t@example.test"]);
    git(other, ["config", "user.name", "t"]);
    writeFileSync(path.join(other, "src/decisions/batchMerge.ts"), "// changed upstream\n");
    git(other, ["commit", "-qam", "upstream change"]);
    git(other, ["push", "-q", "origin", "main"]);
    const r = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: false, git: f.withSlug });
    expect(r).toMatchObject({ ok: false, code: "not_on_main" });
    const dry = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: true, git: f.withSlug });
    expect(dry.ok).toBe(true);
  });
  it("refuses an origin that is not the pinned repo", () => {
    const f = fixture();
    const evil: GuardGit = (args) =>
      args[0] === "remote" ? { status: 0, stdout: "https://github.com/someone/else.git" } : f.real(args);
    const r = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: true, git: evil });
    expect(r).toMatchObject({ ok: false, code: "remote_mismatch" });
    const local: GuardGit = (args) => (args[0] === "remote" ? { status: 0, stdout: path.join(f.base, "origin.git") } : f.real(args));
    expect(runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: true, git: local })).toMatchObject({
      ok: false,
      code: "remote_mismatch",
    });
  });
  it("refuses a descriptor outside the executing script's checkout or at the wrong location", () => {
    const f = fixture();
    const g = fixture();
    const r = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: g.descriptorPath, env: { ...f.env, ARCADIA_OPERATOR_SCRIPT_DESCRIPTOR: g.descriptorPath, ARCADIA_OPERATOR_SCRIPT_ID: g.id }, dryRun: true, git: f.withSlug });
    expect(r).toMatchObject({ ok: false, code: "path_outside_root" });
    const link = path.join(f.base, "link.json");
    symlinkSync(f.descriptorPath, link);
    const viaLink = runBatchMergeGuard({ repoRoot: f.root, descriptorPath: link, env: f.env, dryRun: true, git: f.withSlug });
    expect(viaLink.ok).toBe(false);
  });
  it("refuses a missing operator context, an untracked descriptor and local modifications", () => {
    const f = fixture();
    expect(runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: {}, dryRun: true, git: f.withSlug })).toMatchObject({
      ok: false,
      code: "operator_context",
    });
    writeFileSync(path.join(f.root, "src/decisions/batchMerge.ts"), "// edited\n");
    expect(runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: true, git: f.withSlug })).toMatchObject({
      ok: false,
      code: "modified",
    });
    git(f.root, ["checkout", "--", "src/decisions/batchMerge.ts"]);
    git(f.root, ["rm", "-q", "--cached", `artifacts/generated/operator-scripts/${f.id}.sh`]);
    expect(runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: true, git: f.withSlug })).toMatchObject({
      ok: false,
      code: "untracked",
    });
  });
  it("runs the operator-script contract and refuses a descriptor whose text no longer matches the spec", () => {
    const f = fixture();
    const broken = { ...(f.descriptor), title: "" };
    writeFileSync(f.descriptorPath, JSON.stringify(broken));
    git(f.root, ["commit", "-qam", "break"]);
    expect(runBatchMergeGuard({ repoRoot: f.root, descriptorPath: f.descriptorPath, env: f.env, dryRun: true, git: f.withSlug })).toMatchObject({
      ok: false,
      code: "contract_invalid",
    });
    const g = fixture();
    const unbound = JSON.parse(JSON.stringify(g.descriptor)) as { problem: string; desired_effect: string; authority: { does: string[] } };
    unbound.authority.does = unbound.authority.does.map((line) => line.replace(/head \w{7}\w+/, "head deadbee"));
    writeFileSync(g.descriptorPath, JSON.stringify(unbound));
    git(g.root, ["commit", "-qam", "unbind"]);
    expect(runBatchMergeGuard({ repoRoot: g.root, descriptorPath: g.descriptorPath, env: g.env, dryRun: true, git: g.withSlug })).toMatchObject({
      ok: false,
      code: "text_unbound",
    });
  });
});
