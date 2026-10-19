import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { installGuards, mapPath, NET_GUARD, orderMappings, rewriteSnapshotPaths, runProductionReplay, unconfinedPaths, type ReplayReport } from "../scripts/production-replay.js";
import { git, Rehearsal } from "./helpers/rehearsalHarness.js";

const REPLAY_TIMEOUT_MS = 240_000;

/** Content hash of files and directory trees (missing paths hash as absent). */
function treeHash(paths: string[]): string {
  const hash = createHash("sha256");
  const walk = (target: string) => {
    if (!existsSync(target)) { hash.update(`absent ${target}`); return; }
    const stats = statSync(target);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(target).sort()) walk(path.join(target, entry));
    } else {
      hash.update(target);
      hash.update(readFileSync(target));
    }
  };
  for (const target of paths) walk(target);
  return hash.digest("hex");
}

function fingerprint(rehearsal: Rehearsal): { database: string; refs: string; status: string; gitMetadata: string; workspaceFiles: string } {
  // The WAL is checkpointed into the main file by the snapshot's read-only open
  // only if something writes; hash the logical content instead of the bytes.
  const db = new Database(path.join(rehearsal.workspace, "database", "arcadia.sqlite3"), { readonly: true });
  try {
    const hash = createHash("sha256");
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>) {
      hash.update(name);
      for (const row of db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).raw().all()) hash.update(JSON.stringify(row));
    }
    return {
      database: hash.digest("hex"),
      refs: git(rehearsal.repo, ["for-each-ref", "--format=%(objectname) %(refname)"]),
      status: git(rehearsal.repo, ["status", "--porcelain"]),
      // Byte-level Git metadata a replay could touch: the index, config, worktree registrations, the bare origin.
      gitMetadata: treeHash([path.join(rehearsal.repo, ".git", "index"), path.join(rehearsal.repo, ".git", "config"), path.join(rehearsal.repo, ".git", "worktrees"), path.join(rehearsal.root, "origin.git", "refs")]),
      workspaceFiles: treeHash([path.join(rehearsal.workspace, "config"), path.join(rehearsal.workspace, "artifacts")])
    };
  } finally {
    db.close();
  }
}

describe("production replay path mapping", () => {
  it("maps the longest matching prefix and never a sibling sharing its spelling", () => {
    const mappings = [
      { from: "/live/arcadia", to: "/replay/repos/arcadia" },
      { from: "/live/arcadia/.claude/worktrees", to: "/replay/nested" },
      { from: "/home/.claude/worktrees", to: "/replay/agent-worktrees/claude" }
    ];
    expect(orderMappings(mappings)[0].from).toBe("/live/arcadia/.claude/worktrees");
    expect(mapPath("/live/arcadia/src/a.ts", mappings)).toBe("/replay/repos/arcadia/src/a.ts");
    expect(mapPath("/live/arcadia/.claude/worktrees/x", mappings)).toBe("/replay/nested/x");
    expect(mapPath("/live/arcadia-other/x", mappings)).toBe("/live/arcadia-other/x");
    expect(mapPath("/home/.claude/worktrees/run/arcadia", mappings)).toBe("/replay/agent-worktrees/claude/run/arcadia");
  });
});

describe("production replay snapshot rewrite", () => {
  it("remaps every source path but keeps a fingerprinted validation-evidence reference byte-identical", () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-replay-rewrite-")));
    try {
      const file = path.join(dir, "snapshot.sqlite3");
      const db = new Database(file);
      db.exec(`CREATE TABLE candidate_preservation_receipts (id TEXT, candidate_worktree_path TEXT, receipt_json TEXT);
        CREATE TABLE agent_sessions (id TEXT, worktree_path TEXT);
        CREATE TABLE append_only (id TEXT, note TEXT);
        CREATE TRIGGER append_only_no_update BEFORE UPDATE ON append_only BEGIN SELECT RAISE(ABORT, 'append-only'); END;`);
      const evidence = "/live/workspace/artifacts/preservation/s1/check-1/validation.json";
      db.prepare("INSERT INTO candidate_preservation_receipts VALUES (?, ?, ?)").run("r1", "/home/.claude/worktrees/run/arcadia",
        JSON.stringify({ validationEvidenceRef: evidence, repositoryPath: "/live/arcadia" }));
      db.prepare("INSERT INTO agent_sessions VALUES (?, ?)").run("s1", "/home/.claude/worktrees/run/arcadia");
      db.prepare("INSERT INTO append_only VALUES (?, ?)").run("a1", "ran in /live/arcadia");
      db.close();
      const result = rewriteSnapshotPaths(file, [
        { from: "/live/workspace", to: "/replay/workspace" },
        { from: "/live/arcadia", to: "/replay/repos/arcadia" },
        { from: "/home/.claude/worktrees", to: "/replay/agent-worktrees/claude" }
      ]);
      expect(result.remaining).toEqual([]);
      expect(result.kept).toBe(1);
      const check = new Database(file, { readonly: true });
      const receipt = check.prepare("SELECT candidate_worktree_path AS worktree, receipt_json AS json FROM candidate_preservation_receipts").get() as { worktree: string; json: string };
      expect(receipt.worktree).toBe("/replay/agent-worktrees/claude/run/arcadia");
      expect(JSON.parse(receipt.json)).toEqual({ validationEvidenceRef: evidence, repositoryPath: "/replay/repos/arcadia" });
      expect(check.prepare("SELECT note FROM append_only").pluck().get()).toBe("ran in /replay/repos/arcadia");
      // The append-only trigger is restored after the rewrite.
      expect(check.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger'").pluck().get()).toBe(1);
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("production replay guards", () => {
  let root: string;
  let outside: string;
  let effectsLog: string;
  let env: NodeJS.ProcessEnv;
  const effects = () => readFileSync(effectsLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string; detail: string });
  const run = (command: string, args: string[], cwd = root) => spawnSync(command, args, { cwd, env, encoding: "utf8" });

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-replay-guards-")));
    outside = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-replay-outside-")));
    effectsLog = path.join(root, "effects.jsonl");
    writeFileSync(effectsLog, "");
    installGuards(root, effectsLog);
    const netGuard = path.join(root, "bin", "net-guard.mjs");
    writeFileSync(netGuard, NET_GUARD);
    mkdirSync(path.join(root, "repo"));
    env = {
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: root,
      GIT_CONFIG_NOSYSTEM: "1",
      REPLAY_EFFECTS_LOG: effectsLog,
      REPLAY_GH_MODE: "offline",
      REPLAY_GH_RECORDING: path.join(root, "recording.jsonl"),
      NODE_OPTIONS: `--import=${JSON.stringify(pathToFileURL(netGuard).href)}`
    };
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("lets git run inside the root and refuses it outside, through -C, --git-dir, GIT_DIR or a remote path", () => {
    expect(run("git", ["init", "-q", path.join(root, "repo")]).status).toBe(0);
    expect(run("git", ["-C", outside, "init", "-q"]).status).toBe(97);
    expect(run("git", ["status"], outside).status).toBe(97);
    expect(run("git", [`--git-dir=${path.join(outside, ".git")}`, "status"]).status).toBe(97);
    expect(spawnSync("git", ["status"], { cwd: path.join(root, "repo"), env: { ...env, GIT_DIR: path.join(outside, ".git") }, encoding: "utf8" }).status).toBe(97);
    expect(run("git", ["-C", path.join(root, "repo"), "push", outside, "HEAD:refs/heads/x"]).status).toBe(97);
    expect(run("git", ["-C", path.join(root, "repo"), "push", "https://github.com/pmark/arcadia.git", "HEAD"]).status).toBe(97);
    // A URL in a commit message is not a remote.
    expect(run("git", ["-C", path.join(root, "repo"), "-c", "user.name=r", "-c", "user.email=r@r", "commit", "-q", "--allow-empty", "-m", "see https://example.com"]).status).toBe(0);
    expect(existsSync(path.join(outside, ".git"))).toBe(false);
    expect(effects().filter((effect) => effect.kind.startsWith("git:")).map((effect) => effect.kind))
      .toEqual(["git:outside", "git:outside", "git:outside", "git:outside", "git:outside", "git:network"]);
  });

  it("refuses and records every GitHub write, a provider, tmux and the network; an unrecorded read is its own kind", () => {
    writeFileSync(effectsLog, "");
    expect(run("gh", ["pr", "create", "--title", "x"]).status).toBe(1);
    expect(run("gh", ["api", "-XPOST", "repos/pmark/arcadia/issues"]).status).toBe(1);
    expect(run("gh", ["api", "graphql", "-F", "query=@mutation.graphql"]).status).toBe(1);
    expect(run("gh", ["pr", "view", "1"]).status).toBe(1);
    expect(run("claude", ["--print", "hi"]).status).toBe(97);
    expect(run("tmux", ["new-session", "-d"]).status).toBe(97);
    expect(run("tmux", ["has-session", "-t", "x"]).status).toBe(1);
    const fetched = run(process.execPath, ["-e", "fetch('https://example.com').then(() => process.exit(0), () => process.exit(3))"]);
    expect(fetched.status).toBe(3);
    const https = run(process.execPath, ["-e", "try { require('node:https').get('https://example.com'); process.exit(0) } catch { process.exit(4) }"]);
    expect(https.status).toBe(4);
    expect(effects().map((effect) => effect.kind)).toEqual([
      "github:write", "github:write", "github:write", "github:unrecorded-read", "provider:claude", "tmux", "network", "network"
    ]);
  });

  it("refuses a snapshot whose existing operational path no mapping moved into the root", () => {
    const file = path.join(root, "confined.sqlite3");
    const db = new Database(file);
    db.exec("CREATE TABLE agent_sessions (id TEXT, worktree_path TEXT, repository_path TEXT)");
    db.prepare("INSERT INTO agent_sessions VALUES (?, ?, ?)").run("s1", path.join(root, "repo"), "/nonexistent/replay/path");
    db.prepare("INSERT INTO agent_sessions VALUES (?, ?, ?)").run("s2", outside, null);
    db.close();
    expect(unconfinedPaths(file, root)).toEqual([`agent_sessions.worktree_path=${outside}`]);
  });
});

/**
 * Hermetic: the "live" source is the shared two-Action rehearsal fixture
 * (real workspace, real Project repository with a bare origin), granted and
 * then turned Off, exactly the shape the live workspace had when the operator
 * pressed STOP. The replay must predict the launch the grant would cause and
 * leave the source byte-for-byte unchanged.
 */
describe("production replay over a fixture workspace", () => {
  let source: Rehearsal;
  let parent: string;
  let before: ReturnType<typeof fingerprint>;
  let report: ReplayReport;
  const printed: string[] = [];

  beforeAll(() => {
    source = new Rehearsal({ withOrigin: true });
    source.createFixtureRepository();
    source.approve(source.registerProject());
    source.activate("grant-replay-fixture-20261018T000000Z");
    source.deactivate("stop-replay-fixture-20261018T000100Z");
    before = fingerprint(source);
    parent = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-replay-test-")));
    report = runProductionReplay({
      sourceWorkspace: source.workspace,
      grant: "grant-replay-fixture",
      ticks: 4,
      github: "offline",
      parent,
      keep: true,
      print: (line) => printed.push(line)
    });
  }, REPLAY_TIMEOUT_MS);

  afterAll(() => {
    source?.dispose();
    if (parent) rmSync(parent, { recursive: true, force: true });
  });

  it("activates with the grant receipt's scope and predicts the first Action's launch", () => {
    expect(report.grantReceipt).toMatch(/^grant-replay-fixture/);
    expect(report.activation.ok).toBe(true);
    expect(report.stop.reason).toBe("launched");
    expect(report.stop.detail).toContain(source.actionA);
    const launchTick = report.ticks.at(-1)!;
    expect(launchTick.launch).toMatchObject({ outcome: "launched", actionKey: source.actionA });
    // The launch ran in the replay root, never in the source repository.
    expect(report.stop.detail).toContain(report.root);
    expect(report.stop.detail).not.toContain(source.repo);
    expect(printed.join("\n")).toContain("-- tick 1");
  });

  it("requests no external effect and touches nothing in the source", () => {
    for (const tick of report.ticks) expect(tick.effects).toEqual([]);
    expect(fingerprint(source)).toEqual(before);
    expect(report.sourceFingerprint.refs[`${source.projectSlug}:refs/heads/main`]).toBeTruthy();
  });

  it("writes a report into the kept replay root with the final production status", () => {
    const written = JSON.parse(readFileSync(path.join(report.root, "report.json"), "utf8")) as ReplayReport;
    expect(written.stop).toEqual(report.stop);
    expect(written.status).toContain("Managed production");
    expect(report.root.startsWith(parent)).toBe(true);
  });
});
