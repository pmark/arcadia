import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentAskContractCommand, runAgentAskDraftCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject } from "../src/db/repositories.js";
import { isNoProgressExit } from "../src/production/recoverySignals.js";
import { reconcileSessionExit } from "../src/sessions/reconciliation.js";
import {
  PROPOSAL_MAX_BYTES, SESSION_PROPOSAL_EVENT, SESSION_PROPOSAL_SKIPPED_EVENT, recordSessionProposals, sessionProposalDirectory
} from "../src/sessions/sessionProposals.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const savedSession = process.env.ARCADIA_SESSION_ID;
let SESSION = "";
// A launched Session carries the host-set marker; each test stands in for that with its own unique id and root.
beforeEach(() => { SESSION = `session_proposal_${randomUUID().replaceAll("-", "").slice(0, 12)}`; process.env.ARCADIA_SESSION_ID = SESSION; });
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  if (savedSession === undefined) delete process.env.ARCADIA_SESSION_ID; else process.env.ARCADIA_SESSION_ID = savedSession;
});

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** A disposable primary repository with one linked candidate worktree, a unique injected proposal root and a workspace. */
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
  const proposalRoot = path.join(root, "proposals");
  const workspace = path.join(root, "workspace");
  initWorkspace(workspace);
  return { root, primary, worktree, base: git(worktree, ["rev-parse", "HEAD"]), proposalRoot, workspace, none: path.join(root, "none") };
}
type Fixture = ReturnType<typeof fixture>;

const proposal = (id: string) => JSON.stringify({
  agent_ask: "v1", request_id: id, project: "unknown", intent: "proposal", requested_authority: "propose",
  desired_result: "Please review the unattended-run limits.", rationale: "Blocked on a criterion; capture for consideration."
});

const draft = (f: Fixture, id: string) => runAgentAskDraftCommand({ request: proposal(id), dir: f.worktree, workspace: f.none, proposalRoot: f.proposalRoot });

/** What preservation would commit: tracked changes plus untracked, non-ignored files. */
const preservable = (worktree: string) => git(worktree, ["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").filter(Boolean);

function sessionRow(db: import("better-sqlite3").Database, f: Fixture, launchRevision: string | null = null) {
  const project = upsertProject(db, { name: "Proposal Project", mission: "m", goal: "g", status: "active" });
  db.pragma("foreign_keys = OFF");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO agent_sessions (id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id, packet_id, packet_path, packet_sha256,
    authorizing_decisions_json, provider_profile, provider, model, base_revision, launch_revision, branch, worktree_path, provider_session_id, display_name, terminal_transport, tmux_session_name,
    status, prepared_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'docs/plans/p.md', 'p', 'the-action', 'wi', 'pk', 'pk.md', 'sha', '[]', 'prof', 'claude-code-cli', 'sonnet', ?, ?, 'claude/candidate', ?, ?, 'd', 'tmux', ?, 'running', ?, ?, ?)`)
    .run(SESSION, project.id, "proposal-project", f.primary, f.base, launchRevision, f.worktree, `prov-${SESSION}`, `tm-${SESSION}`, now, now, now);
  return { project, sessionId: SESSION };
}

const count = (db: import("better-sqlite3").Database, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const events = (db: import("better-sqlite3").Database, type: string) =>
  (db.prepare("SELECT payload_json FROM events WHERE event_type = ? ORDER BY created_at").all(type) as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json));
const asSession = (f: Fixture) => ({ id: SESSION, project_id: "x", project_slug: "proposal-project", plan_slug: "p", action_id: "the-action", worktree_path: f.worktree });

describe("a Session's proposal draft stays out of its candidate (Issue #1988)", () => {
  it("places the draft under the injected root: not preservable, worktree clean, revision and changed files unchanged", () => {
    const f = fixture();
    const changedBefore = git(f.worktree, ["diff", "--name-only", f.base, "HEAD"]);
    const result = draft(f, "session-proposal-a");
    expect(result.data.path).toBe(path.join(f.proposalRoot, SESSION, "agent-ask-session-proposal-a.yaml"));
    expect(existsSync(result.data.path)).toBe(true);
    expect(existsSync(path.join(f.worktree, ".arcadia", "asks"))).toBe(false);
    expect(preservable(f.worktree).some((file) => file.startsWith(".arcadia/"))).toBe(false);
    expect(git(f.worktree, ["status", "--porcelain"])).toBe("");
    expect(git(f.worktree, ["rev-parse", "HEAD"])).toBe(f.base);
    expect(git(f.worktree, ["diff", "--name-only", f.base, "HEAD"])).toBe(changedBefore);
  });

  it("records the text with Session and Action at exit, readable after the worktree is retired, settling nothing", () => {
    const f = fixture();
    draft(f, "session-proposal-b");
    const text = readFileSync(path.join(f.proposalRoot, SESSION, "agent-ask-session-proposal-b.yaml"), "utf8");
    withDatabase(f.workspace, (db) => {
      sessionRow(db, f);
      const settlementsBefore = count(db, "SELECT COUNT(*) AS n FROM agent_ask_settlements");
      const queueBefore = count(db, "SELECT COUNT(*) AS n FROM action_queue_receipts");
      reconcileSessionExit({ db, sessionId: SESSION, requestId: "reconcile-proposal-b", repoRoot: f.primary, workspace: f.workspace, proposalRoot: f.proposalRoot });
      git(f.primary, ["worktree", "remove", "--force", f.worktree]);
      const recorded = events(db, SESSION_PROPOSAL_EVENT);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ sessionId: SESSION, actionId: "the-action", planSlug: "p", requestId: "session-proposal-b", text });
      expect((db.prepare("SELECT intent_kind FROM agent_ask_proposals WHERE request_id = ?").get("session-proposal-b") as { intent_kind: string }).intent_kind).toBe("proposal");
      expect(count(db, "SELECT COUNT(*) AS n FROM agent_ask_settlements")).toBe(settlementsBefore);
      expect(count(db, "SELECT COUNT(*) AS n FROM action_queue_receipts")).toBe(queueBefore);
      expect(recordSessionProposals(db, asSession(f), f.proposalRoot).every((r) => r.replayed)).toBe(true);
      expect(count(db, `SELECT COUNT(*) AS n FROM events WHERE event_type = '${SESSION_PROPOSAL_EVENT}'`)).toBe(1);
    });
  });

  it("an exit whose only output is the proposal leaves the candidate revision and changes untouched", () => {
    const f = fixture();
    draft(f, "session-proposal-c");
    withDatabase(f.workspace, (db) => {
      sessionRow(db, f);
      const result = reconcileSessionExit({ db, sessionId: SESSION, requestId: "reconcile-proposal-c", repoRoot: f.primary, workspace: f.workspace, proposalRoot: f.proposalRoot });
      expect(result.receipt.candidate_revision).toBe(f.base);
      expect(JSON.parse(result.receipt.evidence_json!).candidateHasChanges).toBe(false);
      expect(result.receipt.outcome).toBe("missing_evidence");
    });
  });

  it("a resumed incomplete_resumable Session whose only output is a proposal counts as a no-progress exit (clean tree, same revision)", () => {
    const f = fixture();
    // The prior Session left committed work; this resumed Session starts from it.
    writeFileSync(path.join(f.worktree, "work.md"), "prior work\n");
    git(f.worktree, ["add", "work.md"]);
    git(f.worktree, ["-c", "user.email=t@example.test", "-c", "user.name=T", "commit", "-q", "-m", "prior"]);
    const launchRevision = git(f.worktree, ["rev-parse", "HEAD"]);
    draft(f, "session-proposal-d");
    withDatabase(f.workspace, (db) => {
      sessionRow(db, f, launchRevision);
      const result = reconcileSessionExit({ db, sessionId: SESSION, requestId: "reconcile-proposal-d", repoRoot: f.primary, workspace: f.workspace, proposalRoot: f.proposalRoot });
      expect(result.receipt.outcome).toBe("incomplete_resumable");
      const clean = git(f.worktree, ["status", "--porcelain"]) === "";
      expect(clean).toBe(true);
      expect(result.receipt.candidate_revision).toBe(launchRevision);
      expect(isNoProgressExit({
        sessionId: SESSION, actionKey: "proposal-project/p#the-action", outcome: result.receipt.outcome, resumed: true,
        baseRevision: f.base, launchRevision, candidateRevision: result.receipt.candidate_revision, worktreeClean: clean, at: result.receipt.created_at
      })).toBe(true);
      expect(events(db, SESSION_PROPOSAL_EVENT)).toHaveLength(1);
    });
  });

  it("outside a launched Session (interactive agent, no or malformed marker) keeps the canonical .arcadia/asks path", () => {
    const f = fixture();
    delete process.env.ARCADIA_SESSION_ID;
    const result = draft(f, "interactive-proposal");
    expect(result.data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-interactive-proposal.yaml"));
    expect(existsSync(path.join(f.proposalRoot, SESSION))).toBe(false);
    process.env.ARCADIA_SESSION_ID = "../escape";
    expect(draft(f, "interactive-proposal-2").data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-interactive-proposal-2.yaml"));
  });

  it("keeps complete and split drafts at their canonical location, even inside a launched Session", () => {
    const f = fixture();
    const head = git(f.worktree, ["rev-parse", "HEAD"]);
    const complete = JSON.stringify({
      agent_ask: "v1", request_id: "session-complete-x", project: "unknown", intent: "complete", target_ref: "action/the-action",
      desired_result: "Record the-action complete.", candidate_revision: head, requested_authority: "apply_if_approved",
      evidence: [{ criterion: "It works.", status: "met", note: "proof" }]
    });
    const done = runAgentAskDraftCommand({ request: complete, dir: f.worktree, workspace: f.none, proposalRoot: f.proposalRoot });
    expect(done.data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-session-complete-x.yaml"));
    expect(preservable(f.worktree)).toContain(".arcadia/asks/agent-ask-session-complete-x.yaml");
    const split = JSON.stringify({ ...runAgentAskContractCommand().data.splitExample, request_id: "session-split-x", candidate_revision: head });
    const s = runAgentAskDraftCommand({ request: split, dir: f.worktree, workspace: f.none, proposalRoot: f.proposalRoot });
    expect(s.data.path).toBe(path.join(f.worktree, ".arcadia", "asks", "agent-ask-session-split-x.yaml"));
  });
});

describe("an unusable proposal location fails loudly and never writes into the candidate", () => {
  const expectRefusal = (f: Fixture, root: string) => {
    let message = "";
    try { runAgentAskDraftCommand({ request: proposal("session-proposal-refused"), dir: f.worktree, workspace: f.none, proposalRoot: root }); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("cannot be used");
    expect(message).toContain("arcadia agent-ask preview");
    expect(message).toContain("Nothing was written to your candidate");
    expect(existsSync(path.join(f.worktree, ".arcadia"))).toBe(false);
    expect(git(f.worktree, ["status", "--porcelain"])).toBe("");
  };

  it("refuses an unwritable root", () => {
    const f = fixture();
    const blocker = path.join(f.root, "a-file");
    writeFileSync(blocker, "x");
    expectRefusal(f, path.join(blocker, "root")); // a path below a regular file cannot be created
  });

  it("refuses a symlinked root and a symlinked Session directory", () => {
    const f = fixture();
    const target = path.join(f.root, "elsewhere");
    mkdirSync(target);
    const linkedRoot = path.join(f.root, "linked-root");
    symlinkSync(target, linkedRoot);
    expectRefusal(f, linkedRoot);
    const root = path.join(f.root, "real-root");
    mkdirSync(root, { mode: 0o700 });
    symlinkSync(target, path.join(root, SESSION));
    expectRefusal(f, root);
  });

  it("refuses a root owned by another user", () => {
    const f = fixture();
    mkdirSync(f.proposalRoot, { mode: 0o700 });
    const uid = process.getuid!();
    vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
    expectRefusal(f, f.proposalRoot);
  });

  it("the host never reads an untrusted root and says so", () => {
    const f = fixture();
    const target = path.join(f.root, "elsewhere");
    mkdirSync(path.join(target, SESSION), { recursive: true });
    writeFileSync(path.join(target, SESSION, "agent-ask-planted.yaml"), proposal("planted"));
    const linkedRoot = path.join(f.root, "linked-root");
    symlinkSync(target, linkedRoot);
    withDatabase(f.workspace, (db) => {
      sessionRow(db, f);
      expect(recordSessionProposals(db, asSession(f), linkedRoot)).toEqual([]);
      expect(events(db, SESSION_PROPOSAL_EVENT)).toHaveLength(0);
      expect(events(db, SESSION_PROPOSAL_SKIPPED_EVENT)[0]).toMatchObject({ sessionId: SESSION, actionId: "the-action", reason: expect.stringContaining("untrusted proposal location") });
    });
  });
});

describe("a draft the host cannot record is visible, not silent", () => {
  function seed(f: Fixture) {
    const dir = sessionProposalDirectory(SESSION, f.proposalRoot);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }
  function skipped(f: Fixture) {
    return withDatabase(f.workspace, (db) => {
      sessionRow(db, f);
      const recorded = recordSessionProposals(db, asSession(f), f.proposalRoot);
      return { recorded, skips: events(db, SESSION_PROPOSAL_SKIPPED_EVENT), kept: events(db, SESSION_PROPOSAL_EVENT) };
    });
  }

  it("skips a symlinked draft", () => {
    const f = fixture();
    const dir = seed(f);
    const real = path.join(f.root, "real.yaml");
    writeFileSync(real, proposal("symlinked"));
    symlinkSync(real, path.join(dir, "agent-ask-symlinked.yaml"));
    const { recorded, skips } = skipped(f);
    expect(recorded).toEqual([]);
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatchObject({ sessionId: SESSION, actionId: "the-action", path: path.join(dir, "agent-ask-symlinked.yaml"), reason: "is a symbolic link" });
  });

  it("skips a draft that is not a regular file", () => {
    const f = fixture();
    const dir = seed(f);
    mkdirSync(path.join(dir, "agent-ask-a-directory.yaml"));
    const { recorded, skips } = skipped(f);
    expect(recorded).toEqual([]);
    expect(skips[0]).toMatchObject({ reason: "is not a regular file" });
  });

  it("skips an oversize draft", () => {
    const f = fixture();
    const dir = seed(f);
    writeFileSync(path.join(dir, "agent-ask-big.yaml"), `${proposal("big")}\n${"#".repeat(PROPOSAL_MAX_BYTES)}`);
    const { recorded, skips } = skipped(f);
    expect(recorded).toEqual([]);
    expect(skips[0].reason).toContain("exceeds");
  });

  it("skips a non-matching name and an invalid Ask, and still records a good one beside them", () => {
    const f = fixture();
    const dir = seed(f);
    writeFileSync(path.join(dir, "notes.txt"), "stray");
    writeFileSync(path.join(dir, "agent-ask-bad.yaml"), "not: [a valid ask");
    writeFileSync(path.join(dir, "agent-ask-good.yaml"), proposal("good"));
    const { recorded, skips, kept } = skipped(f);
    expect(recorded.map((r) => r.requestId)).toEqual(["good"]);
    expect(kept).toHaveLength(1);
    expect(skips.map((s) => s.reason).sort()).toEqual([expect.stringContaining("invalid Agent Ask"), "name is not agent-ask-<request_id>.yaml"].sort());
  });

  it("logs a recording error and leaves the reconcile outcome unchanged", () => {
    const f = fixture();
    draft(f, "session-proposal-e");
    withDatabase(f.workspace, (db) => {
      sessionRow(db, f);
      db.exec("DROP TABLE events");
      db.exec("CREATE TABLE events (id TEXT PRIMARY KEY)"); // present but unusable: the insert throws
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const result = reconcileSessionExit({ db, sessionId: SESSION, requestId: "reconcile-proposal-e", repoRoot: f.primary, workspace: f.workspace, proposalRoot: f.proposalRoot });
      expect(result.receipt.outcome).toBe("missing_evidence");
      expect(write.mock.calls.map((c) => String(c[0])).join("")).toContain(`Session proposal recording failed for ${SESSION}`);
    });
  });
});
