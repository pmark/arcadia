import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDashboardRunsCommand } from "../src/commands/dashboard.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { withDatabase } from "../src/db/connection.js";
import { ensureBuiltInSkills } from "../src/execution/skills.js";
import { createCodexInvocation, createProjectWithInitialWork, getWorkItem } from "../src/db/repositories.js";
import { ensureSessionExitReceiptsTable } from "../src/sessions/reconciliation.js";
import { ensureCandidatePreservationTable } from "../src/sessions/candidatePreservation.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-dashboard-runs-"));
  temporary.push(root);
  const target = path.join(root, "workspace");
  initWorkspace(target);
  withDatabase(target, () => undefined);
  return target;
}

describe("dashboard runs", () => {
  it("returns only the active read model by default", () => {
    const response = runDashboardRunsCommand({ workspace: workspace() });
    expect(response.data.runs).toMatchObject({ activeAgentSessions: [], activeExecutionRuns: [], recentRuns: [] });
  });

  it("accepts an explicit zero and a positive limit", () => {
    const target = workspace();
    expect(runDashboardRunsCommand({ workspace: target, limit: "0" }).data.runs.recentRuns).toEqual([]);
    expect(runDashboardRunsCommand({ workspace: target, limit: "10" }).data.runs.recentRuns).toEqual([]);
  });

  it.each(["abc", "-1", "1.5", ""])("rejects an invalid --limit of %j instead of treating it as absent", (limit) => {
    expect(() => runDashboardRunsCommand({ workspace: workspace(), limit })).toThrow(/--limit must be a whole number/);
  });

  it.each(["abc", "-1", ""])("rejects an invalid --sessions of %j", (sessions) => {
    expect(() => runDashboardRunsCommand({ workspace: workspace(), sessions })).toThrow(/--sessions must be a whole number/);
  });

  it("lists finished Sessions with their exit code, reconciled outcome and preserved PR only when asked", () => {
    const target = workspace();
    withDatabase(target, (db) => {
      ensureBuiltInSkills(db);
      const created = createProjectWithInitialWork(db, {
        name: "Exit facts", mission: "Show how Sessions ended.", status: "active",
        currentMilestone: "Proof", nextAction: "Build proof", workClassification: "agent"
      });
      const work = getWorkItem(db, created.workItem.id)!;
      createCodexInvocation(db, {
        id: "packet_exit_facts", purpose: "build", agentProfile: "claude_build", workspaceScope: "/tmp/exit-facts",
        command: "claude", promptPath: "prompts/p.md", jsonlOutputPath: "prompts/p.jsonl",
        finalMessagePath: "prompts/p-final.md", status: "packet_created", workItemId: work.id
      });
      const insert = db.prepare(`INSERT INTO agent_sessions (
          id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id,
          packet_id, packet_path, packet_sha256, authorizing_decisions_json, execution_profile_json,
          provider_profile, provider, model, effort, provider_mapping_id, provider_binding_id,
          base_revision, branch, worktree_path, provider_session_id, display_name, terminal_transport,
          tmux_session_name, host, status, prepared_at, started_at, ended_at, exit_status, created_at, updated_at
        ) VALUES (
          @id, @project_id, @project_slug, '/tmp/exit-facts-repo', 'docs/plans/p.md', 'p', @action_id, @work_item_id,
          'packet_exit_facts', 'prompts/p.md', 'sha', '[]', NULL,
          'claude_build', 'claude-code-cli', 'sonnet', 'high', NULL, NULL,
          '0000000', @branch, '/tmp/exit-facts-worktree', @id, 'Exit facts', 'tmux',
          @tmux, 'host.local', @status, @prepared_at, @prepared_at, @ended_at, @exit_status, @prepared_at, @prepared_at
        )`);
      const base = { project_id: created.project.id, project_slug: created.project.slug, work_item_id: work.id };
      insert.run({ ...base, id: "s_old", action_id: "a-old", branch: "claude/old", tmux: "t-old", status: "failed",
        prepared_at: "2026-01-01T00:00:00.000Z", ended_at: "2026-01-01T00:10:00.000Z", exit_status: 1 });
      insert.run({ ...base, id: "s_new", action_id: "a-new", branch: "claude/new", tmux: "t-new", status: "completed",
        prepared_at: "2026-01-02T00:00:00.000Z", ended_at: "2026-01-02T00:30:00.000Z", exit_status: 0 });
      insert.run({ ...base, id: "s_live", action_id: "a-live", branch: "claude/live", tmux: "t-live", status: "running",
        prepared_at: "2026-01-03T00:00:00.000Z", ended_at: null, exit_status: null });
      ensureSessionExitReceiptsTable(db);
      db.prepare(`INSERT INTO session_exit_receipts (id, session_id, request_id, outcome, reason, next_action_json, created_at, updated_at)
        VALUES ('r1', 's_new', 'req-1', 'accepted_completion', 'The Action is recorded done.', '{}', '2026-01-02T00:31:00.000Z', '2026-01-02T00:31:00.000Z')`).run();
      ensureCandidatePreservationTable(db);
      db.prepare(`INSERT INTO candidate_preservation_receipts (
          id, request_id, repository_path, candidate_worktree_path, branch, base_branch, base_revision, action_id, packet_sha256,
          policy_epoch, policy_revision, candidate_fingerprint, commit_sha, preservation_state, pushed_remote,
          pull_request_number, pull_request_url, retry_action, receipt_json, created_at
        ) VALUES ('p1', 'preq-1', '/tmp/exit-facts-repo', '/tmp/exit-facts-worktree', 'claude/new', 'main', 'abc', 'a-new', 'sha',
          1, 1, 'fp', 'def', 'IN PR', 'origin', 7, 'https://github.com/example/repo/pull/7', NULL, '{}', '2026-01-02T00:32:00.000Z')`).run();
    });

    expect(runDashboardRunsCommand({ workspace: target }).data.runs.recentAgentSessions).toEqual([]);
    const runs = runDashboardRunsCommand({ workspace: target, sessions: "5" }).data.runs;
    expect(runs.activeAgentSessions.map((session) => session.id)).toEqual(["s_live"]);
    expect(runs.recentAgentSessions.map((session) => session.id)).toEqual(["s_new", "s_old"]);
    expect(runs.recentAgentSessions[0]).toMatchObject({
      exitStatus: 0,
      endedAt: "2026-01-02T00:30:00.000Z",
      exitOutcome: "accepted_completion",
      pullRequestUrl: "https://github.com/example/repo/pull/7"
    });
    expect(runs.recentAgentSessions[1]).toMatchObject({ exitStatus: 1, exitOutcome: null, pullRequestUrl: null });
  });
});
