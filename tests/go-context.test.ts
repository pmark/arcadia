import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGoContextCommand } from "../src/commands/goContext.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import * as connection from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import { isDispatchable, resolveDispatch } from "../src/docs/dispatch.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const tracking = vi.hoisted(() => ({
  active: false, opened: [] as boolean[], writes: [] as string[], processes: [] as string[],
  failure: null as null | { operation: "readdirSync" | "statSync" | "readFileSync"; file: string; code: string }
}));
vi.mock("better-sqlite3", async original => {
  const Actual = (await original<typeof import("better-sqlite3")>()).default;
  return { default: class extends Actual {
    constructor(file: string, options?: import("better-sqlite3").Options) {
      if (tracking.active) tracking.opened.push(Boolean(options?.readonly));
      super(file, options);
    }
  } };
});
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  const result = { ...actual };
  for (const operation of ["readdirSync", "statSync", "readFileSync"] as const) {
    Object.assign(result, { [operation]: (...args: unknown[]) => {
      if (tracking.failure?.operation === operation && String(args[0]) === tracking.failure.file) {
        throw Object.assign(new Error(`${tracking.failure.code}: fixture ${operation} '${String(args[0])}'`), { code: tracking.failure.code });
      }
      return Reflect.apply(actual[operation], actual, args);
    } });
  }
  for (const operation of ["writeFileSync", "appendFileSync", "mkdirSync", "renameSync", "unlinkSync", "rmSync", "symlinkSync"] as const) {
    Object.assign(result, { [operation]: (...args: unknown[]) => {
      if (tracking.active) tracking.writes.push(operation);
      return Reflect.apply(actual[operation], actual, args);
    } });
  }
  return result;
});
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  const result = { ...actual };
  for (const operation of ["execFileSync", "execSync", "spawnSync", "spawn", "execFile", "exec"] as const) {
    Object.assign(result, { [operation]: (...args: unknown[]) => {
      if (tracking.active) tracking.processes.push(`${operation}:${String(args[0])}`);
      return Reflect.apply(actual[operation], actual, args);
    } });
  }
  return result;
});

let root: string;
let workspace: string;
let repo: string;
let projectId: string;
const now = new Date("2030-01-01T00:00:00.000Z");
function write(relative: string, text: string) {
  const file = path.join(repo, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
beforeEach(() => {
  tracking.active = false; tracking.failure = null;
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-go-context-")));
  workspace = path.join(root, "ws"); repo = path.join(root, "repo");
  initWorkspace(workspace); mkdirSync(repo);
  write("PROJECT.md", "---\narcadia: v1\ntype: project\nslug: demo\nname: Demo\nstatus: active\ngoal: Prove observation\nactive_plan: go-plan\ncurrent_action: show-go\nupdated: 2026-10-27\n---\n");
  write("docs/plans/go-plan.md", "---\narcadia: v1\ntype: plan\nslug: go-plan\nproject: demo\nstatus: active\nmilestone: Read Go\ntoken_impact: medium\ntoken_budget: One bounded pass\nrecommended_model: gpt-5.6-terra\ncurrent_action: show-go\nupdated: 2026-10-27\nactions:\n  - id: show-go\n    title: Show Go\n    status: open\n    responsibility: agent\n    next_action: Render Go\n    clarification: clarified\n    acceptance_criteria: [The read performs zero writes]\n    depends_on: []\n---\n");
  withDatabase(workspace, db => {
    const project = upsertProject(db, { name: "Demo", mission: "Observe", status: "active" });
    projectId = project.id;
    upsertProjectMetadata(db, { projectId, repoPath: repo });
  });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "--allow-empty", "-m", "fixture"], { cwd: repo });
});
afterEach(() => { tracking.active = false; tracking.failure = null; vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

function databaseSnapshot() {
  return withReadOnlyDatabase(workspace, db => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    return names.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]);
  });
}
function fileSnapshot(directory: string): unknown[] {
  return readdirSync(directory).sort().flatMap(entry => {
    const file = path.join(directory, entry);
    return statSync(file).isDirectory() ? [[file, fileSnapshot(file)]] : [[file, createHash("sha256").update(readFileSync(file)).digest("hex")]];
  });
}

describe("journal-free Project Go observer", () => {
  it("uses real read-only SQLite, deterministic canonical resolution, and leaves all rows, files, refs and worktrees unchanged", () => {
    const before = { db: databaseSnapshot(), files: fileSnapshot(repo), git: execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" }) };
    const writable = vi.spyOn(connection, "withDatabase");
    tracking.opened = []; tracking.writes = []; tracking.processes = []; tracking.active = true;
    const first = runGoContextCommand({ workspace, project: projectId, now });
    const second = runGoContextCommand({ workspace, project: projectId, now });
    tracking.active = false;
    expect(first).toEqual(second);
    expect(first.data.projects[0].resolution).toMatchObject({ dispatchable: true, context: { activePlan: "go-plan", action: { id: "show-go" } } });
    expect(first.data.projects[0].source).toBe("managed-documents+canonical-workspace");
    expect(first.data.projects[0].observedAt).toBe(now.toISOString());
    expect(writable).not.toHaveBeenCalled();
    expect(tracking.opened.length).toBeGreaterThan(0); expect(tracking.opened.every(Boolean)).toBe(true);
    expect(tracking.writes).toEqual([]); expect(tracking.processes).toEqual([]);
    expect({ db: databaseSnapshot(), files: fileSnapshot(repo), git: execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" }) }).toEqual(before);
  });

  it("retains every configured Project, including duplicate repositories, inactive rows, missing roots, files and unset paths", () => {
    const notDirectory = path.join(root, "file"); writeFileSync(notDirectory, "x");
    withDatabase(workspace, db => {
      for (const [name, repoPath, status] of [["Missing", path.join(root, "missing"), "active"], ["File", notDirectory, "active"], ["Unset", null, "active"], ["Duplicate", repo, "paused"]] as const) {
        const project = upsertProject(db, { name, mission: "Keep registry evidence", status });
        if (repoPath) upsertProjectMetadata(db, { projectId: project.id, repoPath });
      }
    });
    const result = runGoContextCommand({ workspace, now }).data;
    expect(result.projects.map(row => row.project.slug)).toEqual(["demo", "duplicate", "file", "missing", "unset"]);
    expect(result.summary).toMatchObject({ total: 5, dispatchable: 1, unreadable: 3 });
    expect(result.projects.find(row => row.project.slug === "unset")?.error?.message).toContain("no repo_path");
    for (const slug of ["file", "missing"]) {
      const row = result.projects.find(row => row.project.slug === slug)!;
      expect(row.resolution?.dispatchable).toBe(false);
      expect(row.discoveryErrors[0]).toMatchObject({ operation: "readdir", source: row.repoRoot });
      expect(row.discoveryErrors[0].message).toMatch(/ENOENT|ENOTDIR/);
    }
    expect(() => runGoContextCommand({ workspace, project: "unknown", now })).toThrow("Project not found");
  });

  it.each([
    ["readdirSync", "", "EACCES"], ["readdirSync", "docs", "EACCES"],
    ["readdirSync", "docs/plans", "EIO"], ["statSync", "docs/plans/go-plan.md", "ENOENT"],
    ["readFileSync", "docs/plans/go-plan.md", "EACCES"], ["readFileSync", "PROJECT.md", "EIO"]
  ] as const)("retains exact %s failure at %s and the shared resolver refuses dispatch", (operation, relative, code) => {
    const before = { db: databaseSnapshot(), files: fileSnapshot(repo) };
    const file = path.join(repo, relative);
    tracking.failure = { operation, file, code };
    tracking.opened = []; tracking.writes = []; tracking.processes = []; tracking.active = true;
    const row = runGoContextCommand({ workspace, project: projectId, now }).data.projects[0];
    expect(row.discoveryErrors).toContainEqual({ source: file, relativePath: relative || ".", operation: operation === "readdirSync" ? "readdir" : operation === "statSync" ? "stat" : "read", code,
      message: `${code}: fixture ${operation} '${file}'` });
    expect(row.resolution?.blockers[0].message).toBe(`${code}: fixture ${operation} '${file}'`);
    expect(row.resolution?.dispatchable).toBe(false);
    expect(isDispatchable(resolveDispatch(repo, "demo"))).toBe(false);
    expect(discoverDocs(repo).ioErrors?.[0].source).toBe(file);
    tracking.active = false;
    expect(tracking.opened.every(Boolean)).toBe(true);
    expect(tracking.writes).toEqual([]); expect(tracking.processes).toEqual([]);
    tracking.failure = null;
    expect({ db: databaseSnapshot(), files: fileSnapshot(repo) }).toEqual(before);
  });

  it("fails closed when an unreadable directory hides evidence while the selected Plan remains readable", () => {
    mkdirSync(path.join(repo, "docs", "decisions"));
    tracking.failure = { operation: "readdirSync", file: path.join(repo, "docs", "decisions"), code: "EACCES" };
    const row = runGoContextCommand({ workspace, project: projectId, now }).data.projects[0];
    expect(row.resolution?.context?.action.id).toBe("show-go");
    expect(row.resolution?.dispatchable).toBe(false);
    expect(row.resolution?.blockers[0].field).toBe("discovery.readdir");
  });

  it("preserves supporting-document parse policy while refusing unreadable evidence", () => {
    write("docs/reports/support.md", "---\narcadia: v1\ntype: plan\nslug: broken\n---\n");
    expect(discoverDocs(repo).errors.length).toBeGreaterThan(0);
    expect(runGoContextCommand({ workspace, project: projectId, now }).data.projects[0].resolution?.dispatchable).toBe(true);
    tracking.failure = { operation: "readFileSync", file: path.join(repo, "docs/reports/support.md"), code: "EIO" };
    expect(runGoContextCommand({ workspace, project: projectId, now }).data.projects[0].resolution?.dispatchable).toBe(false);
  });

  it("reports only current canonical claims and Sessions without probing their providers", () => {
    withDatabase(workspace, db => {
      db.prepare(`INSERT INTO agent_worktree_reservations(id,repository_path,worktree_path,branch,project,action_id,created_at,expires_at)
        VALUES ('claim', ?, ?, 'agent/fixture', 'demo', 'show-go', '2029-12-31', '2030-01-02')`).run(repo, path.join(root, "candidate"));
      db.pragma("foreign_keys = OFF");
      db.prepare(`INSERT INTO agent_sessions(id,project_id,project_slug,repository_path,plan_path,plan_slug,action_id,work_item_id,packet_id,packet_path,packet_sha256,authorizing_decisions_json,provider_profile,provider,model,base_revision,branch,worktree_path,provider_session_id,display_name,terminal_transport,tmux_session_name,status,prepared_at,created_at,updated_at)
        VALUES ('session', ?, 'demo', ?, 'docs/plans/go-plan.md', 'go-plan', 'show-go', 'fixture-work', 'fixture-packet', '/packet', 'sha', '[]', 'fixture', 'codex', 'fixture', 'base', 'agent/fixture', ?, 'provider-fixture', 'Fixture', 'tmux', 'fixture', 'running', '2029-12-31', '2029-12-31', '2029-12-31')`).run(projectId, repo, path.join(root, "candidate"));
    });
    const row = runGoContextCommand({ workspace, project: projectId, now }).data.projects[0];
    expect(row.ownership).toEqual({ source: "canonical-workspace", observedAt: now.toISOString(), claimsKnown: true, sessionsKnown: true,
      claims: [{ id: "claim", action: "show-go", status: "reserved", expiresAt: "2030-01-02" }],
      sessions: [{ id: "session", plan: "go-plan", action: "show-go", status: "running" }] });
    const expired = runGoContextCommand({ workspace, project: projectId, now: new Date("2030-01-03T00:00:00Z") }).data.projects[0];
    expect(expired.ownership.claims).toEqual([]);
    expect(expired.ownership.sessions).toHaveLength(1);
  });

  it("keeps the existing operator question, blockers and exact remedy instead of deriving another gate", () => {
    write("docs/decisions/0100-observe.md", "---\narcadia: v1\ntype: decision\nid: '0100'\nslug: 0100-observe\nproject: demo\nstatus: open\naction: show-go\nquestion: Should this fixture proceed?\nupdated: 2026-10-27\noptions:\n  - label: Proceed\n    consequence: The fixture may proceed.\n---\n# Proceed?\n");
    const row = runGoContextCommand({ workspace, project: projectId, now }).data.projects[0];
    expect(row.resolution?.dispatchable).toBe(false);
    expect(row.resolution?.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("Should this fixture proceed?"), remedy: expect.stringContaining("0100") })]));
  });

  it("labels missing legacy ownership tables unknown rather than claiming no workers", () => {
    withDatabase(workspace, db => { db.exec("DROP TABLE agent_sessions; DROP TABLE agent_worktree_reservations;"); });
    const row = runGoContextCommand({ workspace, project: projectId, now }).data.projects[0];
    expect(row.ownership).toMatchObject({ claimsKnown: false, sessionsKnown: false, claims: [], sessions: [] });
  });
});
