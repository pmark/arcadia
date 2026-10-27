import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderNextSuccess, runNextReadOnlyCommand } from "../src/commands/next.js";
import { runAdvanceCommand } from "../src/commands/advance.js";
import { runGoBroker, type BriefCommandData } from "../src/goBroker.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import * as connections from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import * as sessions from "../src/sessions/index.js";
import { canonicalPath, reserveAgentWorktree } from "../src/sessions/index.js";

const roots: string[] = [];
// Real time: reservations expire 24 h after `now` and some read paths check the wall clock.
const now = new Date();
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(repo: string, ...args: string[]) { return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function doc(root: string, name: string, text: string) { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), text); }
function plan(slug: string, ids: string[], project = "demo") {
  return `---\narcadia: v1\ntype: plan\nslug: ${slug}\nproject: ${project}\nstatus: active\nmilestone: Test milestone\ntoken_impact: small\ntoken_budget: No model calls.\nrecommended_model: gpt-5.6-terra\nupdated: 2026-10-16\n${slug === "selected" ? "current_action: a\n" : ""}actions:\n${ids.map(id => `  - id: ${id}\n    title: Implement ${id}\n    status: open\n    responsibility: agent\n    next_action: Implement ${id}.\n    expected_artifact: Verified source\n    clarification: clarified\n    acceptance_criteria: [A focused test asserts the returned Action id.]\n    depends_on: []\n`).join("")}---\n`;
}
function fixture(crossPlan = false) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-caller-context-")); roots.push(root);
  const repo = path.join(root, "repo"); mkdirSync(repo); git(repo, "init", "-b", "main");
  doc(repo, "PROJECT.md", "---\narcadia: v1\ntype: project\nslug: demo\nname: Demo\nstatus: active\ngoal: Verify caller context\nactive_plan: selected\ncurrent_action: a\nupdated: 2026-10-16\n---\n");
  doc(repo, "docs/plans/selected.md", plan("selected", crossPlan ? ["a", "c"] : ["a", "b", "c"]));
  if (crossPlan) doc(repo, "docs/plans/assigned.md", plan("assigned", ["b"]));
  git(repo, "add", "."); git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
  const caller = path.join(root, "caller"); git(repo, "worktree", "add", "-b", "candidate", caller);
  const workspace = path.join(root, "workspace"); initWorkspace(workspace);
  withDatabase(workspace, db => { const project = upsertProject(db, { name: "Demo", mission: "Fixture", status: "active", currentMilestone: "Test", nextAction: "Verify", workClassification: "agent" }); upsertProjectMetadata(db, { projectId: project.id, repoPath: repo }); });
  const claim = (owner = caller, project = "demo", actionId = "b") => withDatabase(workspace, db => reserveAgentWorktree(db, { repositoryPath: repo, worktreePath: owner, branch: "candidate", project, actionId, now }));
  const read = () => runNextReadOnlyCommand({ workspace, project: "demo", repo: caller, now });
  return { root, repo, caller, workspace, claim, read };
}
function snapshots(f: ReturnType<typeof fixture>) {
  const files = (root: string): Array<[string, string]> => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === ".git") return [];
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? files(full) : [[full, readFileSync(full).toString("base64")]];
  });
  return { documents: files(f.repo), caller: files(f.caller), gitMetadata: files(path.join(f.repo, ".git")), callerGitLink: readFileSync(path.join(f.caller, ".git"), "utf8"), refs: git(f.repo, "show-ref"), worktrees: git(f.repo, "worktree", "list", "--porcelain"),
    rows: withReadOnlyDatabase(f.workspace, db => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all())) };
}
describe("caller-bound read-only Go orientation", () => {
  it.each([false, true])("keeps selected A separate from caller-owned B (cross Plan: %s)", crossPlan => {
    const f = fixture(crossPlan); const claim = f.claim();
    expect(runAdvanceCommand({ workspace: f.workspace, repo: f.caller }).data.transition?.dispatch.context?.action.id).toBe("b");
    const before = snapshots(f); const write = vi.spyOn(connections, "withDatabase");
    const providerNetwork = vi.spyOn(globalThis, "fetch");
    const first = f.read(); expect(first.data.context?.action.id, JSON.stringify(first.data.blockers)).toBe("b");
    expect(first.data.orientation).toMatchObject({ repository: canonicalPath(f.repo), worktree: canonicalPath(f.caller), assigned: { action: "b", claimId: claim.id, plan: crossPlan ? "assigned" : "selected" }, session: null, selected: { context: { action: { id: "a" } } } });
    expect(first.data.dispatchable).toBe(true); expect(f.read()).toEqual(first); expect(write).not.toHaveBeenCalled(); expect(providerNetwork).not.toHaveBeenCalled();
    expect(snapshots(f)).toEqual(before);
    expect(renderNextSuccess(first).join("\n")).toContain("Current action: b");
    expect(renderNextSuccess(first).join("\n")).toContain("no canonical active Session evidence");
    const project = readFileSync(path.join(f.repo, "PROJECT.md"), "utf8").replace("current_action: a", "current_action: c");
    doc(f.repo, "PROJECT.md", project); doc(f.repo, "docs/plans/selected.md", plan("selected", crossPlan ? ["a", "c"] : ["a", "b", "c"]).replace("current_action: a", "current_action: c"));
    expect(f.read().data.context?.action.id).toBe("b"); expect(f.read().data.orientation?.selected.context?.action.id).toBe("c");
  });
  it("renders bounded orientation from metadata-heavy inputs within the supervisor contract", () => {
    const f = fixture(true); f.claim();
    for (let i = 0; i < 80; i++) doc(f.repo, `docs/plans/related-${i}.md`, plan(`related-${i}`, [`related-action-${i}`]));
    const before = snapshots(f);
    const started = performance.now();
    const result = f.read();
    const rendered = renderNextSuccess(result).join("\n");
    expect(performance.now() - started).toBeLessThan(25_000);
    expect(rendered).toContain("Current action: b");
    expect(result.data.orientation).toMatchObject({ assigned: { action: "b" }, selected: { context: { action: { id: "a" } } } });
    expect(result.data.orientation!.ongoing.length).toBeLessThanOrEqual(5);
    expect(result.data.orientation!.relatedPlans.length).toBeLessThanOrEqual(2);
    expect(snapshots(f)).toEqual(before);
  });

  it("does not apply an initial-root selection fence to a caller-owned B reconciliation", () => {
    const f = fixture(true); f.claim();
    const runner = vi.fn((options: { apply?: boolean }) => ({ ok: true, command: "go", data: { applied: options.apply === true }, artifacts: [], warnings: [] }));
    runGoBroker({ source: f.caller, agent: "codex", operation: "go" }, runner as never,
      undefined, undefined, () => f.workspace);
    expect(runner).toHaveBeenCalledTimes(2);
    for (const [options] of runner.mock.calls) {
      expect(options).not.toHaveProperty("initialSelection");
      expect(options).not.toHaveProperty("strictAction");
      expect(options).not.toHaveProperty("enrollment");
    }
    expect(f.read().data.context?.action.id).toBe("b");
    expect(f.read().data.orientation?.selected.context?.action.id).toBe("a");
  });

  it("uses the same assigned Action in advance, next and combined-brief titles", () => {
    const f = fixture(); f.claim();
    expect(runAdvanceCommand({ workspace: f.workspace, repo: f.caller }).data.claimedAction).toBe("b");
    const result = runGoBroker({ source: f.caller, agent: "codex", operation: "brief" }, vi.fn() as never, undefined,
      vi.fn().mockReturnValue({ ok: true, data: { snapshot: {}, attentionLines: [] }, artifacts: [], warnings: [] }), () => f.workspace);
    const data = result.data as BriefCommandData;
    expect(data.next.context?.action.id).toBe("b"); expect(data.dispatchBrief).toContain("Current action: b");
    expect(Object.values(data.sessionTitles).every(title => title.includes("b"))).toBe(true);
  });
  it.each(["none", "foreign", "expired", "cross-project", "missing", "ambiguous", "branch", "generation"])("never invents assignment for %s evidence", kind => {
    const f = fixture();
    if (kind !== "none") f.claim(kind === "foreign" ? f.repo : f.caller, kind === "cross-project" ? "other" : "demo", kind === "missing" ? "absent" : "b");
    if (kind === "expired") withDatabase(f.workspace, db => db.prepare("UPDATE agent_worktree_reservations SET expires_at = ?").run("2000-01-01"));
    if (kind === "branch") withDatabase(f.workspace, db => db.prepare("UPDATE agent_worktree_reservations SET branch = ?").run("other"));
    if (kind === "generation") withDatabase(f.workspace, db => db.prepare("UPDATE agent_worktree_reservations SET claim_generation = NULL").run());
    if (kind === "ambiguous") doc(f.caller, "docs/plans/duplicate.md", plan("duplicate", ["b"]));
    const response = f.read(); expect(response.data.orientation?.assigned).toBeNull(); expect(response.data.orientation?.session).toBeNull();
    expect(response.data.orientation?.selected.context?.action.id).toBe("a");
    if (!["none", "foreign"].includes(kind)) { expect(response.data.dispatchable).toBe(false); expect(response.data.blockers.some(b => b.field === "claimed_action")).toBe(true); }
  });
  it.each(["draft", "active", "complete", "superseded", "deferred", "completed", "blocked"])("separates assigned context from Plan execution eligibility (%s)", status => {
    const f = fixture(true); f.claim();
    doc(f.caller, "docs/plans/assigned.md", plan("assigned", ["b"]).replace("status: active", `status: ${status}`));
    const response = f.read();
    const valid = ["draft", "active", "complete", "superseded"].includes(status);
    expect(response.data.dispatchable).toBe(status === "active");
    if (valid) {
      expect(response.data.context?.action.id).toBe("b");
      expect(response.data.context?.planStatus).toBe(status);
      expect(response.data.orientation?.assigned?.action).toBe("b");
      const selected = runNextReadOnlyCommand({ workspace: f.workspace, project: "demo" });
      expect(selected.data.context?.action.id).toBe("a");
      expect(selected.data.dispatchable).toBe(true);
      if (status !== "active") {
        expect(response.data.blockers.some(blocker => blocker.relativePath === "docs/plans/assigned.md" && blocker.field === "status")).toBe(true);
        expect(response.data.orientation?.nextStep).not.toContain("Continue");
        const advance = runAdvanceCommand({ workspace: f.workspace, repo: f.caller });
        expect(advance.data.transition?.dispatch.context?.action.id).toBe("b");
        expect(advance.data.transition?.kind).not.toBe("launch");
      }
    } else {
      // These are not canonical Plan states: keep the existing parse refusal.
      expect(response.data.blockers.some(blocker => blocker.field === "status")).toBe(true);
      expect(response.data.orientation?.assigned).toBeNull();
    }
  });
  it.each([false, true])("reports only actual canonical Session adapter evidence (conflict: %s)", conflict => {
    const f = fixture(); f.claim();
    vi.spyOn(sessions, "listActiveAgentSessions").mockReturnValue([{ id: "session-known", status: "running",
      repository_path: canonicalPath(f.repo), worktree_path: canonicalPath(f.caller), project_slug: "demo",
      plan_slug: "selected", action_id: conflict ? "a" : "b" } as never]);
    const response = f.read();
    expect(response.data.orientation?.session).toEqual({ id: "session-known", status: "running" });
    expect(response.data.dispatchable).toBe(!conflict);
    if (conflict) expect(response.data.blockers.some(b => b.message.includes("Session and claim evidence conflict"))).toBe(true);
  });
  it("refuses an unknown or cross-Project repository", () => {
    const f = fixture(); expect(() => runNextReadOnlyCommand({ workspace: f.workspace, project: "demo", repo: f.root })).toThrow("repository could not be resolved");
    doc(f.caller, "PROJECT.md", readFileSync(path.join(f.caller, "PROJECT.md"), "utf8").replace("slug: demo", "slug: other")); expect(f.read).toThrow("Caller Project");
  });
  it("retains malformed selected evidence and bounds ownership without exposing secret fields", () => {
    const f = fixture(true); f.claim();
    withDatabase(f.workspace, db => { for (let i = 0; i < 8; i++) db.prepare(`INSERT INTO agent_worktree_reservations
      (id, repository_path, worktree_path, branch, created_at, expires_at, project, action_id, claim_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`other-${i}`, canonicalPath(f.repo), `/missing-${i}`, "SECRET_BRANCH", now.toISOString(), "2099-01-01", "demo", `other-${i}`, "SECRET_GENERATION"); });
    const response = f.read(); expect(response.data.orientation?.ongoingTotal).toBe(9); expect(response.data.orientation?.ongoing).toHaveLength(5);
    expect(JSON.stringify(response)).not.toContain("SECRET_BRANCH"); expect(JSON.stringify(response)).not.toContain("SECRET_GENERATION");
    doc(f.caller, "docs/plans/assigned.md", "---\narcadia: v1\ntype: plan\nactions: [\n---");
    const malformed = f.read(); expect(malformed.data.dispatchable).toBe(false); expect(malformed.data.blockers.length).toBeGreaterThan(0);
  });
});
