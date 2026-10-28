import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as projectGET } from "../apps/dashboard/app/api/projects/[id]/go-context/route.js";
import { GET as portfolioGET } from "../apps/dashboard/app/api/go-context/route.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function files(root: string): unknown[] {
  return readdirSync(root).sort().map(name => {
    const file = path.join(root, name);
    return [name, statSync(file).isDirectory() ? files(file) : createHash("sha256").update(readFileSync(file)).digest("hex")];
  });
}
function rows(workspace: string) {
  return withReadOnlyDatabase(workspace, db => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(({ name }) =>
    [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]));
}

describe("Go context GET through the actual dashboard CLI subprocess adapter", () => {
  it("reads the configured registry on success and refusal without changing rows, WAL/files, Git or worktree inventory", async () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "arcadia-go-route-"))); roots.push(root);
    const workspace = path.join(root, "workspace"); const repo = path.join(root, "repo"); const home = path.join(root, "home");
    initWorkspace(workspace); mkdirSync(repo); mkdirSync(home); mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
    writeFileSync(path.join(repo, "PROJECT.md"), "---\narcadia: v1\ntype: project\nslug: demo\nname: Demo\nstatus: active\ngoal: Prove observer transport\nactive_plan: main-plan\ncurrent_action: read-go\nupdated: 2026-10-27\n---\n");
    writeFileSync(path.join(repo, "docs", "plans", "main-plan.md"), "---\narcadia: v1\ntype: plan\nslug: main-plan\nproject: demo\nstatus: active\nmilestone: Read Go\ntoken_impact: medium\ntoken_budget: One pass\nrecommended_model: gpt-5.6-terra\ncurrent_action: read-go\nupdated: 2026-10-27\nactions:\n  - id: read-go\n    title: Read Go\n    status: open\n    responsibility: agent\n    clarification: clarified\n    next_action: Render the existing resolver\n    acceptance_criteria: [No writes]\n    depends_on: []\n---\n");
    const ids = withDatabase(workspace, db => {
      const demo = upsertProject(db, { name: "Demo", mission: "Observe", status: "active" });
      upsertProjectMetadata(db, { projectId: demo.id, repoPath: repo });
      const unreadable = upsertProject(db, { name: "Unreadable", mission: "Retain error", status: "active" });
      upsertProjectMetadata(db, { projectId: unreadable.id, repoPath: path.join(root, "absent") });
      return { demo: demo.id, unreadable: unreadable.id };
    });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "--allow-empty", "-m", "fixture"], { cwd: repo });
    vi.stubEnv("ARCADIA_WORKSPACE", workspace); vi.stubEnv("HOME", home); vi.stubEnv("ARCADIA_DASHBOARD_CLI", "");
    const git = () => ["status", "show-ref", "worktree"].map(command => execFileSync("git", command === "status" ? ["status", "--porcelain=v1"] : command === "worktree" ? ["worktree", "list", "--porcelain"] : ["show-ref"], { cwd: repo, encoding: "utf8" }));
    const snapshot = () => ({ rows: rows(workspace), workspaceFiles: files(workspace), repoFiles: files(repo), git: git() });
    const before = snapshot();
    const response = await projectGET(new Request("http://fixture/api/projects/demo/go-context"), { params: Promise.resolve({ id: ids.demo }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: { id: ids.demo }, error: null, resolution: { dispatchable: true, context: { activePlan: "main-plan", action: { id: "read-go" } } } });
    expect(snapshot()).toEqual(before);
    const failure = await projectGET(new Request("http://fixture/api/projects/unknown/go-context"), { params: Promise.resolve({ id: "unknown" }) });
    expect(failure.status).toBeGreaterThanOrEqual(400);
    expect(await failure.json()).toMatchObject({ error: expect.stringContaining("Project not found") });
    expect(snapshot()).toEqual(before);
    const absent = await projectGET(new Request("http://fixture/api/projects/unreadable/go-context"), { params: Promise.resolve({ id: ids.unreadable }) });
    expect(absent.status).toBe(200);
    expect(await absent.json()).toMatchObject({ project: { id: ids.unreadable }, resolution: { dispatchable: false }, discoveryErrors: [{ source: path.join(root, "absent"), operation: "readdir", code: "ENOENT", message: expect.stringContaining("ENOENT") }] });
    expect(snapshot()).toEqual(before);
    const portfolio = await portfolioGET();
    expect(portfolio.status).toBe(200);
    expect(await portfolio.json()).toMatchObject({ projects: [{ project: { id: ids.demo } }, { project: { id: ids.unreadable } }], summary: { total: 2, dispatchable: 1, unreadable: 1 } });
    expect(snapshot()).toEqual(before);
  });
});
