import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { evaluateDraftOnlyCandidate } from "../src/sessions/draftOnlyCandidate.js";
import { ensureSessionExitReceiptsTable } from "../src/sessions/reconciliation.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-retired-dirty-"));
  roots.push(root);
  const main = path.join(root, "repo");
  mkdirSync(main);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["config", "user.email", "a@example.test"]);
  git(main, ["config", "user.name", "A"]);
  writeFileSync(path.join(main, "README.md"), "x\n");
  git(main, ["add", "."]);
  git(main, ["commit", "-qm", "init"]);
  const worktree = path.join(root, "wt");
  const branch = "claude/stalled-action-20261111T000000000Z";
  git(main, ["worktree", "add", "-q", "-b", branch, worktree]);
  writeFileSync(path.join(worktree, "unsaved.txt"), "real work\n");
  const workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  return { main, worktree, branch, workspace };
}

const lookup = (main: string) => ({
  repositoryPath: main, projectSlug: "p", actionId: "stalled-action", agent: "claude", baseBranch: "main", now: new Date()
});

function recordSession(db: Database.Database, f: ReturnType<typeof fixture>, superseded: string | null) {
  ensureSessionExitReceiptsTable(db);
  db.pragma("foreign_keys = OFF");
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO agent_sessions (id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id, packet_id,
    packet_path, packet_sha256, authorizing_decisions_json, provider_profile, provider, model, base_revision, branch, worktree_path,
    provider_session_id, display_name, terminal_transport, tmux_session_name, status, prepared_at, created_at, updated_at)
    VALUES ('s1','pr','p',?, 'plan.md','plan','stalled-action','wi','pk','pk.md','00','[]','prof','claude','m','base',?,?, 'ps','n','tmux','tmux-s1','completed',?,?,?)`)
    .run(f.main, f.branch, f.worktree, at, at, at);
  db.prepare(`INSERT INTO session_exit_receipts (id, session_id, request_id, outcome, reason, next_action_json, lease_handoff, superseded_by_session_id, is_simulated, created_at, updated_at)
    VALUES ('r1','s1','req1','incomplete_resumable','r','{}',1,?,0,?,?)`).run(superseded, at, at);
}

describe("dirty prepared worktree of a retired handoff (Issue #2492)", () => {
  it("does not refuse a fresh launch when the worktree's Session is retired", () => {
    const f = fixture();
    withDatabase(f.workspace, (db) => {
      recordSession(db, f, "retired:req-retire-1");
      expect(evaluateDraftOnlyCandidate(db, lookup(f.main)).kind).toBe("none");
    });
  });

  it("still refuses a dirty prepared worktree whose Session is not superseded", () => {
    const f = fixture();
    withDatabase(f.workspace, (db) => {
      recordSession(db, f, null);
      expect(evaluateDraftOnlyCandidate(db, lookup(f.main)).kind).toBe("refuse");
    });
  });

  it("still refuses a dirty prepared worktree that no Session describes", () => {
    const f = fixture();
    withDatabase(f.workspace, (db) => {
      expect(evaluateDraftOnlyCandidate(db, lookup(f.main)).kind).toBe("refuse");
    });
  });
});
