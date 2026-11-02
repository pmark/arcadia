import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgentAskContractCommand, runAgentAskDraftCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import { reconcileSessionExit } from "../src/sessions/reconciliation.js";
import { SESSION_PROPOSAL_EVENT, recordSessionProposals, sessionProposalDirectories } from "../src/sessions/sessionProposals.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const SESSION = "session_proposal_1";
const savedSession = process.env.ARCADIA_SESSION_ID;
// A launched Session carries the host-set marker; the tests stand in for that environment.
beforeEach(() => { process.env.ARCADIA_SESSION_ID = SESSION; for (const d of sessionProposalDirectories(SESSION)) rmSync(d, { recursive: true, force: true }); });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  for (const d of sessionProposalDirectories(SESSION)) rmSync(d, { recursive: true, force: true });
  if (savedSession === undefined) delete process.env.ARCADIA_SESSION_ID; else process.env.ARCADIA_SESSION_ID = savedSession;
});

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A disposable primary repository with one linked candidate worktree at `<root>/candidate/arcadia`. */
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-session-proposal-")));
  roots.push(root);
  const primary = path.join(root, "primary");
  mkdirSync(primary);
  git(primary, ["init", "-q", "-b", "main"]);
  git(primary, ["config", "user.email", "t@example.test"]);
  git(primary, ["config", "user.name", "T"]);
  writeFileSync(path.join(primary, "README.md"), "base\n");
  git(primary, ["add", "."]);
  git(primary, ["commit", "-q", "-m", "base"]);
  const worktree = path.join(root, "candidate", "arcadia");
  git(primary, ["worktree", "add", "-q", "-b", "claude/candidate", worktree, "HEAD"]);
  return { root, primary, worktree, base: git(worktree, ["rev-parse", "HEAD"]) };
}

const proposal = (id: string) => JSON.stringify({
  agent_ask: "v1", request_id: id, project: "unknown", intent: "proposal", requested_authority: "propose",
  desired_result: "Please review the unattended-run limits.", rationale: "Blocked on a criterion; capture for consideration."
});

/** What preservation would commit: tracked changes plus untracked, non-ignored files. */
const preservable = (worktree: string) => git(worktree, ["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter(Boolean);

function sessionRow(db: import("better-sqlite3").Database, worktree: string, base: string) {
  const project = upsertProject(db, { name: "Proposal Project", mission: "m", goal: "g", status: "active" });
  db.pragma("foreign_keys = OFF");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_sessions (id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id, packet_id, packet_path, packet_sha256,
    authorizing_decisions_json, provider_profile, provider, model, base_revision, branch, worktree_path, provider_session_id, display_name, terminal_transport, tmux_session_name,
    status, prepared_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'docs/plans/p.md', 'p', 'the-action', 'wi', 'pk', 'pk.md', 'sha', '[]', 'prof', 'claude-code-cli', 'sonnet', ?, 'claude/candidate', ?, 'prov', 'd', 'tmux', 'tm-1', 'running', ?, ?, ?)`)
    .run(SESSION, project.id, "proposal-project", path.dirname(path.dirname(worktree)), base, worktree, now, now, now);
  return { project, sessionId: "session_proposal_1" };
}

describe("a Session's proposal draft stays out of its candidate (Issue #1988)", () => {
  it("places the draft beside the worktree: not preservable, worktree clean, revision and changed files unchanged", () => {
    const f = fixture();
    const changedBefore = git(f.worktree, ["diff", "--name-only", f.base, "HEAD"]);
    const result = runAgentAskDraftCommand({ request: proposal("session-proposal-a"), dir: f.worktree, workspace: path.join(f.root, "none") });
    const expected = result.data.path;
    expect(sessionProposalDirectories(SESSION).map((d) => path.join(d, "agent-ask-session-proposal-a.yaml"))).toContain(expected);
    expect(existsSync(expected)).toBe(true);
    expect(existsSync(path.join(f.worktree, ".arcadia", "asks"))).toBe(false);
    expect(path.relative(f.worktree, expected).startsWith("..")).toBe(true);
    expect(preservable(f.worktree).some((file) => file.startsWith(".arcadia/"))).toBe(false);
    expect(git(f.worktree, ["status", "--porcelain"])).toBe("");
    expect(git(f.worktree, ["rev-parse", "HEAD"])).toBe(f.base);
    expect(git(f.worktree, ["diff", "--name-only", f.base, "HEAD"])).toBe(changedBefore);
  });

  it("records the text with Session and Action at exit, readable after the worktree is retired, settling nothing", () => {
    const f = fixture();
    const workspace = path.join(f.root, "workspace");
    initWorkspace(workspace);
    runAgentAskDraftCommand({ request: proposal("session-proposal-b"), dir: f.worktree, workspace: path.join(f.root, "none") });
    const text = readFileSync(sessionProposalDirectories(SESSION).map((d) => path.join(d, "agent-ask-session-proposal-b.yaml")).find((p) => existsSync(p)) ?? "", "utf8");
    withDatabase(workspace, (db) => {
      const { sessionId } = sessionRow(db, f.worktree, f.base);
      const settlementsBefore = (db.prepare("SELECT COUNT(*) AS n FROM agent_ask_settlements").get() as { n: number }).n;
      const queueBefore = (db.prepare("SELECT COUNT(*) AS n FROM action_queue_receipts").get() as { n: number }).n;
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-proposal-b", repoRoot: f.primary, workspace });
      // retire the worktree: the record must not depend on it
      git(f.primary, ["worktree", "remove", "--force", f.worktree]);
      const events = db.prepare("SELECT payload_json FROM events WHERE event_type = ?").all(SESSION_PROPOSAL_EVENT) as Array<{ payload_json: string }>;
      expect(events).toHaveLength(1);
      const payload = JSON.parse(events[0].payload_json);
      expect(payload).toMatchObject({ sessionId, actionId: "the-action", planSlug: "p", requestId: "session-proposal-b", text });
      const row = db.prepare("SELECT intent_kind FROM agent_ask_proposals WHERE request_id = ?").get("session-proposal-b") as { intent_kind: string };
      expect(row.intent_kind).toBe("proposal");
      expect((db.prepare("SELECT COUNT(*) AS n FROM agent_ask_settlements").get() as { n: number }).n).toBe(settlementsBefore);
      expect((db.prepare("SELECT COUNT(*) AS n FROM action_queue_receipts").get() as { n: number }).n).toBe(queueBefore);
      // replay records nothing twice
      expect(recordSessionProposals(db, { id: sessionId, project_id: "x", project_slug: "proposal-project", plan_slug: "p", action_id: "the-action", worktree_path: f.worktree }).every((r) => r.replayed)).toBe(true);
      expect(db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type = ?").get(SESSION_PROPOSAL_EVENT)).toEqual({ n: 1 });
    });
  });

  it("an exit whose only output is the proposal leaves the candidate revision and changes untouched", () => {
    const f = fixture();
    const workspace = path.join(f.root, "workspace");
    initWorkspace(workspace);
    runAgentAskDraftCommand({ request: proposal("session-proposal-c"), dir: f.worktree, workspace: path.join(f.root, "none") });
    withDatabase(workspace, (db) => {
      const { sessionId } = sessionRow(db, f.worktree, f.base);
      const result = reconcileSessionExit({ db, sessionId, requestId: "reconcile-proposal-c", repoRoot: f.primary, workspace });
      expect(result.receipt.candidate_revision).toBe(f.base);
      const evidence = JSON.parse(result.receipt.evidence_json!);
      expect(evidence.candidateHasChanges).toBe(false);
      expect(result.receipt.outcome).toBe("missing_evidence");
    });
  });

  it("outside a launched Session (interactive agent, no marker) keeps the canonical .arcadia/asks path", () => {
    const f = fixture();
    delete process.env.ARCADIA_SESSION_ID;
    const result = runAgentAskDraftCommand({ request: proposal("interactive-proposal"), dir: f.worktree, workspace: path.join(f.root, "none") });
    expect(result.data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-interactive-proposal.yaml"));
    expect(sessionProposalDirectories(SESSION).some((d) => existsSync(path.join(d, "agent-ask-interactive-proposal.yaml")))).toBe(false);
    process.env.ARCADIA_SESSION_ID = "../escape";
    const odd = runAgentAskDraftCommand({ request: proposal("interactive-proposal-2"), dir: f.worktree, workspace: path.join(f.root, "none") });
    expect(odd.data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-interactive-proposal-2.yaml"));
  });

  it("keeps complete and split drafts at their canonical location", () => {
    const f = fixture();
    const head = git(f.worktree, ["rev-parse", "HEAD"]);
    const complete = JSON.stringify({
      agent_ask: "v1", request_id: "session-complete-x", project: "unknown", intent: "complete", target_ref: "action/the-action",
      desired_result: "Record the-action complete.", candidate_revision: head, requested_authority: "apply_if_approved",
      evidence: [{ criterion: "It works.", status: "met", note: "proof" }]
    });
    const done = runAgentAskDraftCommand({ request: complete, dir: f.worktree, workspace: path.join(f.root, "none") });
    expect(done.data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-session-complete-x.yaml"));
    expect(preservable(f.worktree)).toContain(".arcadia/asks/agent-ask-session-complete-x.yaml");
    const split = JSON.stringify({ ...runAgentAskContractCommand().data.splitExample, request_id: "session-split-x", candidate_revision: head });
    const s = runAgentAskDraftCommand({ request: split, dir: f.worktree, workspace: path.join(f.root, "none") });
    expect(s.data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-session-split-x.yaml"));
  });
});
