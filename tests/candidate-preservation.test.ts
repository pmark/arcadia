import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import {
  preserveCandidate,
  type CandidatePreservationRemote,
  type CandidatePreservationRequest
} from "../src/sessions/candidatePreservation.js";
import { reserveAgentWorktree } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
const NOW = new Date("2026-09-08T00:00:00.000Z");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function g(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com"
    }
  }).trim();
}

interface Fixture {
  root: string;
  repo: string;
  candidate: string;
  workspace: string;
  branch: string;
  baseRevision: string;
}

function makeFixture(options: { dirty?: boolean; branch?: string } = {}): Fixture {
  const branch = options.branch ?? "claude/task";
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-preserve-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  g(repo, ["config", "user.name", "Test"]);
  g(repo, ["config", "user.email", "test@example.com"]);
  writeFileSync(path.join(repo, "README.md"), "base\n");
  g(repo, ["add", "-A"]);
  g(repo, ["commit", "-m", "base"]);
  const baseRevision = g(repo, ["rev-parse", "main"]);

  const candidate = path.join(root, "candidate");
  g(repo, ["worktree", "add", "-b", branch, candidate, "main"]);
  if (options.dirty !== false) {
    writeFileSync(path.join(candidate, "feature.txt"), "the candidate work\n");
    writeFileSync(path.join(candidate, "README.md"), "base\nmodified by candidate\n");
  }

  const workspace = path.join(root, "ws");
  initWorkspace(workspace);
  withDatabase(workspace, (db) =>
    reserveAgentWorktree(db, { repositoryPath: repo, worktreePath: candidate, branch, now: NOW })
  );

  return { root, repo, candidate, workspace, branch, baseRevision };
}

function request(fixture: Fixture, overrides: Partial<CandidatePreservationRequest> = {}): CandidatePreservationRequest {
  return {
    requestId: "req-1",
    repositoryPath: fixture.repo,
    candidateWorktreePath: fixture.candidate,
    branch: fixture.branch,
    baseBranch: "main",
    baseRevision: fixture.baseRevision,
    actionId: "some-action",
    packetSha256: "packet-sha",
    policyEpoch: 1,
    policyRevision: 1,
    validation: { passed: true, evidenceRef: "tests green" },
    remotePreservation: { authorized: false, reason: "test default" },
    now: NOW,
    ...overrides
  };
}

function commitsAhead(repo: string, branch: string): string[] {
  const out = g(repo, ["log", "--format=%H", `main..${branch}`]);
  return out ? out.split("\n") : [];
}

class FakeRemote implements CandidatePreservationRemote {
  hasRemoteValue = true;
  pushes: Array<{ branch: string }> = [];
  existing: { number: number; url: string } | null = null;
  created: Array<{ branch: string; body: string }> = [];
  updated: Array<{ number: number; body: string }> = [];
  hasRemote() {
    return this.hasRemoteValue;
  }
  push(input: { repositoryPath: string; branch: string }) {
    this.pushes.push({ branch: input.branch });
    return { remote: "origin" };
  }
  findPullRequest() {
    return this.existing;
  }
  upsertDraftPullRequest(input: {
    branch: string;
    body: string;
    existing: { number: number; url: string } | null;
  }) {
    if (input.existing) {
      this.updated.push({ number: input.existing.number, body: input.body });
      return input.existing;
    }
    this.created.push({ branch: input.branch, body: input.body });
    const pr = { number: 42, url: "https://example.test/pull/42" };
    this.existing = pr;
    return pr;
  }
}

/** Insert a minimal repository lease row without the full Session machinery. */
function insertLease(workspace: string, input: { repo: string; worktree: string; branch: string }): void {
  const repo = realpathSync(input.repo);
  const worktree = existsSync(input.worktree) ? realpathSync(input.worktree) : path.resolve(input.worktree);
  withDatabase(workspace, (db) => {
    db.pragma("foreign_keys = OFF");
    const ts = NOW.toISOString();
    db.prepare(
      `INSERT INTO agent_sessions (
        id, project_id, project_slug, repository_path, plan_path, plan_slug, action_id, work_item_id,
        packet_id, packet_path, packet_sha256, authorizing_decisions_json, provider_profile, provider,
        model, base_revision, branch, worktree_path, provider_session_id, display_name,
        terminal_transport, tmux_session_name, status, prepared_at, created_at, updated_at
      ) VALUES (
        'sess-1','proj','proj', ?, 'plan.md','plan','act','wi',
        'pkt','pkt.md','sha','[]','profile','codex-cli',
        'model', 'rev', ?, ?, 'psid','name',
        'tmux','tmux-1','running', ?, ?, ?
      )`
    ).run(repo, input.branch, worktree, ts, ts, ts);
  });
}

describe("candidate preservation (local)", () => {
  it("stages the candidate and records one recoverable LOCAL ONLY commit", () => {
    const fixture = makeFixture();
    const receipt = withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));

    expect(receipt.preservationState).toBe("LOCAL ONLY");
    expect(receipt.pullRequestNumber).toBeNull();
    expect(receipt.retryAction).toContain("Push branch");
    expect(commitsAhead(fixture.repo, fixture.branch)).toEqual([receipt.commitSha]);
    // The commit content is the staged tree, and the candidate is now clean.
    expect(g(fixture.candidate, ["status", "--porcelain"])).toBe("");
    const body = g(fixture.candidate, ["log", "-1", "--format=%B"]);
    expect(body).toContain("Arcadia-Preservation-Request: req-1");
  });

  it("replays the same request id without a duplicate commit", () => {
    const fixture = makeFixture();
    const first = withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));
    const second = withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));

    expect(second.replayed).toBe(true);
    expect(second.commitSha).toBe(first.commitSha);
    expect(commitsAhead(fixture.repo, fixture.branch)).toHaveLength(1);
  });

  it("refuses a replayed request id whose candidate content changed", () => {
    const fixture = makeFixture();
    withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));
    writeFileSync(path.join(fixture.candidate, "feature.txt"), "different work\n");

    expect(() => withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)))).toThrow(
      /replayed with changed inputs|content has since changed/
    );
  });

  it("recovers from a crash after commit but before the receipt persisted", () => {
    const fixture = makeFixture();
    // First attempt commits, then the receipt write "crashes".
    expect(() =>
      withDatabase(fixture.workspace, (db) =>
        preserveCandidate(db, request(fixture), {
          hooks: {
            afterCommit() {
              throw new Error("crash after commit, before receipt");
            }
          }
        })
      )
    ).toThrow("crash after commit");
    expect(commitsAhead(fixture.repo, fixture.branch)).toHaveLength(1);

    // Retry with the same request id: it must find the existing commit by
    // trailer and not create a second one.
    const recovered = withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));
    expect(recovered.preservationState).toBe("LOCAL ONLY");
    expect(commitsAhead(fixture.repo, fixture.branch)).toEqual([recovered.commitSha]);
  });

  it("does not mutate a sibling worktree while preserving one candidate", () => {
    const fixture = makeFixture();
    const other = path.join(fixture.root, "other");
    g(fixture.repo, ["worktree", "add", "-b", "claude/other", other, "main"]);
    writeFileSync(path.join(other, "other.txt"), "other dirty work\n");
    withDatabase(fixture.workspace, (db) =>
      reserveAgentWorktree(db, { repositoryPath: fixture.repo, worktreePath: other, branch: "claude/other", now: NOW })
    );

    withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));

    // The sibling keeps its dirty, uncommitted state and its branch is untouched.
    expect(g(other, ["status", "--porcelain"])).toContain("other.txt");
    expect(commitsAhead(fixture.repo, "claude/other")).toHaveLength(0);
  });

  it("produces a deterministic content fingerprint bound into the receipt", () => {
    const fixture = makeFixture();
    const receipt = withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));
    expect(receipt.candidateFingerprint).toMatch(/^[0-9a-f]{40}$/);
    // The bound fingerprint is exactly the committed tree.
    expect(g(fixture.candidate, ["rev-parse", `${receipt.commitSha}^{tree}`])).toBe(receipt.candidateFingerprint);
  });
});

describe("candidate preservation (refusals)", () => {
  it("refuses without passing validation", () => {
    const fixture = makeFixture();
    expect(() =>
      withDatabase(fixture.workspace, (db) =>
        preserveCandidate(db, request(fixture, { validation: { passed: false, evidenceRef: "none" } }))
      )
    ).toThrow(/no passing validation/);
    expect(commitsAhead(fixture.repo, fixture.branch)).toHaveLength(0);
  });

  it("refuses an unregistered candidate path", () => {
    const fixture = makeFixture();
    const stray = path.join(fixture.root, "stray");
    execFileSync("git", ["init", "-b", "main", stray], { stdio: "ignore" });
    expect(() =>
      withDatabase(fixture.workspace, (db) =>
        preserveCandidate(db, request(fixture, { candidateWorktreePath: stray }))
      )
    ).toThrow(/not a registered worktree/);
  });

  it("refuses when the candidate is on an unexpected branch", () => {
    const fixture = makeFixture();
    expect(() =>
      withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture, { branch: "claude/other-name" })))
    ).toThrow(/unexpected branch|different branch/);
  });

  it("refuses when base history changed since launch", () => {
    const fixture = makeFixture();
    expect(() =>
      withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture, { baseRevision: "deadbeef".repeat(5) })))
    ).toThrow(/base branch history changed/);
  });

  it("refuses when there is no active reservation", () => {
    const fixture = makeFixture();
    withDatabase(fixture.workspace, (db) =>
      db.prepare("DELETE FROM agent_worktree_reservations").run()
    );
    expect(() => withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)))).toThrow(
      /no active reservation/
    );
  });

  it("refuses when another Session holds the repository lease on a different worktree", () => {
    const fixture = makeFixture();
    insertLease(fixture.workspace, { repo: fixture.repo, worktree: path.join(fixture.root, "elsewhere"), branch: "claude/elsewhere" });
    expect(() => withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)))).toThrow(
      /conflicting preservation|different worktree|holds this repository/
    );
  });

  it("allows preservation when the lease belongs to this candidate", () => {
    const fixture = makeFixture();
    insertLease(fixture.workspace, { repo: fixture.repo, worktree: fixture.candidate, branch: fixture.branch });
    const receipt = withDatabase(fixture.workspace, (db) => preserveCandidate(db, request(fixture)));
    expect(receipt.preservationState).toBe("LOCAL ONLY");
  });
});

describe("candidate preservation (remote)", () => {
  it("pushes and opens a draft PR with a QA plan when authorized", () => {
    const fixture = makeFixture();
    const remote = new FakeRemote();
    const receipt = withDatabase(fixture.workspace, (db) =>
      preserveCandidate(
        db,
        request(fixture, { remotePreservation: { authorized: true, qaPlan: "## QA\n1. run tests" } }),
        { remote }
      )
    );
    expect(receipt.preservationState).toBe("IN PR");
    expect(receipt.pullRequestNumber).toBe(42);
    expect(remote.pushes).toEqual([{ branch: fixture.branch }]);
    expect(remote.created[0].body).toContain("## QA");
  });

  it("updates the existing PR instead of creating a second one", () => {
    const fixture = makeFixture();
    const remote = new FakeRemote();
    remote.existing = { number: 7, url: "https://example.test/pull/7" };
    const receipt = withDatabase(fixture.workspace, (db) =>
      preserveCandidate(
        db,
        request(fixture, { remotePreservation: { authorized: true, qaPlan: "updated plan" } }),
        { remote }
      )
    );
    expect(receipt.pullRequestNumber).toBe(7);
    expect(remote.created).toHaveLength(0);
    expect(remote.updated).toEqual([{ number: 7, body: "updated plan" }]);
  });

  it("falls back to LOCAL ONLY when authorized but no remote is reachable", () => {
    const fixture = makeFixture();
    const remote = new FakeRemote();
    remote.hasRemoteValue = false;
    const receipt = withDatabase(fixture.workspace, (db) =>
      preserveCandidate(db, request(fixture, { remotePreservation: { authorized: true, qaPlan: "plan" } }), { remote })
    );
    expect(receipt.preservationState).toBe("LOCAL ONLY");
    expect(receipt.retryAction).toContain("no reachable remote");
    expect(remote.pushes).toHaveLength(0);
  });

  it("recovers a push crash without a duplicate commit or PR", () => {
    const fixture = makeFixture();
    const remote = new FakeRemote();
    expect(() =>
      withDatabase(fixture.workspace, (db) =>
        preserveCandidate(db, request(fixture, { remotePreservation: { authorized: true, qaPlan: "plan" } }), {
          remote,
          hooks: {
            afterPush() {
              throw new Error("crash after push, before PR receipt");
            }
          }
        })
      )
    ).toThrow("crash after push");
    expect(commitsAhead(fixture.repo, fixture.branch)).toHaveLength(1);

    const recovered = withDatabase(fixture.workspace, (db) =>
      preserveCandidate(db, request(fixture, { remotePreservation: { authorized: true, qaPlan: "plan" } }), { remote })
    );
    expect(recovered.preservationState).toBe("IN PR");
    expect(commitsAhead(fixture.repo, fixture.branch)).toHaveLength(1);
    expect(remote.created).toHaveLength(1);
  });
});
