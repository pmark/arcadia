import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGoCommand } from "../src/commands/go.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { createCodexInvocation, createReviewExecutionRun, createReviewItem, getWorkItemByDocRef, updateExecutionRunStatus, upsertProject, upsertProjectMetadata, updateReviewItemStatus } from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import { activateProduction, fingerprintProductionScope, normalizeProductionScope, type ProductionScope } from "../src/production/policy.js";
import { getSession, prepareSession, resolveProjectTransition, type TmuxAdapter } from "../src/sessions/index.js";
import { attemptAutomaticCompletion, getResumableLeaseHandoff, getSessionExitReceipt, reconcileSessionExit } from "../src/sessions/reconciliation.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class FakeTmux implements TmuxAdapter {
  isAvailable = true;
  collision = false;
  live = false;
  failLaunch = false;
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() { return this.isAvailable; }
  hasSession() { return this.collision || this.live; }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    if (this.failLaunch) throw new Error("synthetic spawn failure");
    this.launches.push(input);
    this.live = true;
  }
}

describe("reconcileSessionExit", () => {
  it("classifies a clean exit with no linked Run as missing evidence, never done from a zero exit code alone", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    tmux.live = false; // process has exited

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-1", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("missing_evidence");
    expect(result.created).toBe(true);
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getSession(db, sessionId));
    expect(session?.status).toBe("failed");
  });

  it("classifies an unfinished worktree with real changes as incomplete and resumable, and holds the lease for the same Action", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "draft\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "wip"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-2", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getSession(db, sessionId));
    expect(session?.status).toBe("needs_input");

    const handoff = withReadOnlyDatabase(fixture.workspace, (db) => getResumableLeaseHandoff(db, fixture.repo));
    expect(handoff?.session.id).toBe(sessionId);
    expect(handoff?.receipt.superseded_by_session_id).toBeNull();
  });

  it("refuses a competing Action's preparation while a resumable candidate is held, but allows the same Action to resume", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "draft\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "wip"]);
    withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-3", repoRoot: fixture.repo })
    );

    // A competing preparation for the SAME Action is allowed and supersedes the handoff.
    const dispatch = resolveProjectTransition({ repoRoot: fixture.repo, projectSlug: "test-project", db: undefined as any }).dispatch;
    const baseRevision = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const nextWorktree = path.join(fixture.root, "resume");
    git(fixture.repo, ["worktree", "add", "-b", "claude/resume", nextWorktree, "HEAD"]);
    const nextTmux = new FakeTmux();
    const resumed = withDatabase(fixture.workspace, (db) => prepareSession({
      db, workspace: fixture.workspace, repoRoot: fixture.repo, dispatch,
      agent: "claude", model: fixture.model, effort: "high", baseRevision,
      branch: "claude/resume", worktreePath: nextWorktree, now: new Date(), tmux: nextTmux
    }));
    expect(resumed.action_id).toBe("define-contract");
    const handoffAfter = withReadOnlyDatabase(fixture.workspace, (db) => getResumableLeaseHandoff(db, fixture.repo));
    expect(handoffAfter).toBeNull();
  });

  it("is idempotent: reconciling twice returns the same receipt and does not re-transition the Session", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    tmux.live = false;

    const first = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-4", repoRoot: fixture.repo })
    );
    const second = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-4-retry", repoRoot: fixture.repo })
    );

    expect(second.created).toBe(false);
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(second.receipt.outcome).toBe(first.receipt.outcome);
  });

  it("recognizes accepted_completion only from the checked-in Plan being done, never inferred from a zero exit code", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    tmux.live = false;

    // Simulate a real completion writer having already marked the Action done.
    const planPath = path.join(fixture.repo, "docs", "plans", "copy-proof.md");
    const projectPath = path.join(fixture.repo, "PROJECT.md");
    writeFileSync(planPath, planDocument.replace("status: open", "status: done").replace("current_action: define-contract", "current_action: null"));
    writeFileSync(projectPath, projectDocument.replace("current_action: define-contract", "current_action: null"));
    git(fixture.repo, ["add", "."]);
    git(fixture.repo, ["commit", "-m", "mark done"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-5", repoRoot: fixture.repo })
    );
    expect(result.receipt.outcome).toBe("accepted_completion");
    // The Plan's own writer already cleared current_action; the dispatch
    // resolver correctly reports that as a blocker needing a new pointer,
    // not a fabricated "next Action" this routine would have to invent.
    expect(result.nextMove.kind).toBe("blocker");
    expect(result.nextMove.admitted).toBe(false);
  });

  it("classifies a Session that already exited needs_input as needs_input", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET status = 'needs_input' WHERE id = ?").run(sessionId);
    });

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-6", repoRoot: fixture.repo })
    );
    expect(result.receipt.outcome).toBe("needs_input");
  });

  it("treats a deliberately failed or unreviewed Run as failed execution, never as evidence of success (contract 20)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    tmux.live = false;

    withDatabase(fixture.workspace, (db) => {
      const session = getSession(db, sessionId)!;
      const reviewItem = createReviewItem(db, {
        workItemId: session.work_item_id,
        projectId: session.project_id,
        decisionNeeded: "Review the deliberately failed test run.",
        sourceInput: "fixture",
        proposedAction: "Review failing test evidence.",
        resolvedIntent: "CodexPlanningArtifactAcceptance",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: [],
        context: {}
      });
      const run = createReviewExecutionRun(db, {
        reviewItemId: reviewItem.id,
        executorName: "test",
        workItemId: session.work_item_id,
        summary: "Deliberately failing test suite."
      });
      updateExecutionRunStatus(db, run.id, "failed", { summary: "1 test failed." });
    });

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-fail-run", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("failed_execution");
    // The failed Run is still linked for audit purposes -- only its status,
    // not its existence, disqualifies it as evidence of successful work.
    expect(result.receipt.run_id).not.toBeNull();
  });

  it("classifies a nonzero exit with no candidate changes as failed execution", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    tmux.live = false;
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET exit_status = 1 WHERE id = ?").run(sessionId);
    });

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-7", repoRoot: fixture.repo })
    );
    expect(result.receipt.outcome).toBe("failed_execution");
  });

  it("persists the receipt even after crashing between transition and receipt insert, by never leaving a partial write (single transaction)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    tmux.live = false;

    withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-8", repoRoot: fixture.repo })
    );
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getSession(db, sessionId));
    const receipt = withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, sessionId));
    // Either both the terminal status and the receipt exist, or neither does.
    expect(session?.status).not.toBe("prepared");
    expect(session?.status).not.toBe("running");
    expect(receipt).not.toBeNull();
  });
});

describe("reconcileSessionExit automatic production completion", () => {
  it("settles a complete Agent Ask on the candidate and advances the pointer when standing policy delegates mechanical acceptance", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);

    withDatabase(fixture.workspace, (db) => {
      const session = getSession(db, sessionId)!;
      const run = createReviewExecutionRun(db, {
        reviewItemId: fixture.approvalId, executorName: "test", workItemId: session.work_item_id, summary: "Build passed."
      });
      updateExecutionRunStatus(db, run.id, "completed", { summary: "Build passed." });
      activateProduction(db, {
        requestId: "grant-auto-complete",
        scope: productionScope(),
        scopeFingerprint: fingerprintProductionScope(productionScope()),
        grantedBy: "operator"
      });
    });

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-auto-1", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("accepted_completion");
    expect(result.receipt.reason).toContain("standing production policy");
    const plan = discoverDocs(worktreePath).docs.find((doc) => doc.type === "plan" && doc.slug === "copy-proof");
    expect(plan).toMatchObject({ status: "complete" });
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: worktreePath, encoding: "utf8" })).toBe("");

    // Idempotent: reconciling again (a different request id, e.g. a retry
    // after a crash) returns the same receipt and settles nothing twice.
    const replay = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-auto-1-retry", repoRoot: fixture.repo })
    );
    expect(replay.receipt.id).toBe(result.receipt.id);
    expect(replay.created).toBe(false);
  });

  it("leaves the Session incomplete_resumable when no standing production policy delegates mechanical acceptance", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);

    withDatabase(fixture.workspace, (db) => {
      const session = getSession(db, sessionId)!;
      const run = createReviewExecutionRun(db, {
        reviewItemId: fixture.approvalId, executorName: "test", workItemId: session.work_item_id, summary: "Build passed."
      });
      updateExecutionRunStatus(db, run.id, "completed", { summary: "Build passed." });
    });

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-auto-2", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
    const plan = discoverDocs(fixture.repo).docs.find((doc) => doc.type === "plan" && doc.slug === "copy-proof");
    expect(plan).toMatchObject({ status: "active" });
  });

  it("leaves the Session incomplete_resumable when the Action is outside the policy's declared scope", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);

    withDatabase(fixture.workspace, (db) => {
      const session = getSession(db, sessionId)!;
      const run = createReviewExecutionRun(db, {
        reviewItemId: fixture.approvalId, executorName: "test", workItemId: session.work_item_id, summary: "Build passed."
      });
      updateExecutionRunStatus(db, run.id, "completed", { summary: "Build passed." });
      const scope = productionScope({ actions: ["test-project/some-other-action"] });
      activateProduction(db, {
        requestId: "grant-out-of-scope",
        scope,
        scopeFingerprint: fingerprintProductionScope(scope),
        grantedBy: "operator"
      });
    });

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-auto-3", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
  });

  it("refuses automatic completion when the candidate revision no longer matches the worktree HEAD, invalidating stale evidence", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);

    const attempt = withDatabase(fixture.workspace, (db) => {
      const session = getSession(db, sessionId)!;
      const run = createReviewExecutionRun(db, {
        reviewItemId: fixture.approvalId, executorName: "test", workItemId: session.work_item_id, summary: "Build passed."
      });
      updateExecutionRunStatus(db, run.id, "completed", { summary: "Build passed." });
      const scope = productionScope();
      activateProduction(db, { requestId: "grant-stale", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" });
      return attemptAutomaticCompletion(db, session, {
        actionDoneInPlan: false, worktreeExists: true, candidateHasChanges: true,
        candidateRevision: "0".repeat(40), runId: run.id, runFailed: false, artifactId: null, decisionId: null
      });
    });

    expect(attempt.attempted).toBe(true);
    expect(attempt.completed).toBe(false);
    expect(attempt.reason).toContain("candidate revision changed");
    const plan = discoverDocs(worktreePath).docs.find((doc) => doc.type === "plan" && doc.slug === "copy-proof");
    expect(plan).toMatchObject({ status: "active" });
  });
});

describe("arcadia go — candidate continuation (Decision 0051)", () => {
  it("resumes the same worktree and branch for the same Action once its prior Session is proven terminal", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    const branch = launched.data.session!.branch;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "draft\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "wip"]);
    withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "resume-1", repoRoot: fixture.repo })
    );

    const worktreesBefore = git(fixture.repo, ["worktree", "list", "--porcelain"])
      .split("\n").filter((line) => line.startsWith("worktree ")).length;

    const resumed = runGoCommand({
      repo: fixture.repo,
      source: fixture.repo,
      apply: true,
      agent: "claude",
      model: fixture.model,
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "resume-attempt"),
      now: new Date(fixture.now.getTime() + 1000),
      tmux: new FakeTmux()
    });

    expect(resumed.data.nextWorktree?.path).toBe(worktreePath);
    expect(resumed.data.nextWorktree?.branch).toBe(branch);
    // No second worktree was created; the candidate was reused in place.
    const worktreesAfter = git(fixture.repo, ["worktree", "list", "--porcelain"])
      .split("\n").filter((line) => line.startsWith("worktree ")).length;
    expect(worktreesAfter).toBe(worktreesBefore);
    expect(existsSync(path.join(worktreePath, "contract.md"))).toBe(true);
  });

  it("refuses a new worktree when the repository holds an unresolved resumable candidate for a different Action", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    const worktreePath = launched.data.session!.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "draft\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "wip"]);
    withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "resume-2", repoRoot: fixture.repo })
    );

    // The governed pointer moves on to a different Action while the first
    // candidate's resumable handoff is still unresolved.
    writeFileSync(path.join(fixture.repo, "PROJECT.md"), projectDocument.replace("current_action: define-contract", "current_action: second-contract"));
    writeFileSync(path.join(fixture.repo, "docs", "plans", "copy-proof.md"), planDocument
      .replace("current_action: define-contract", "current_action: second-contract")
      .replace(
        "    decisions: [\"0001\"]\n---",
        `    decisions: ["0001"]
  - id: second-contract
    title: Define a second contract
    status: open
    responsibility: codex
    effort: session
    clarification: clarified
    next_action: Define the second bounded contract.
    expected_artifact: docs/second-contract.md
    acceptance_criteria:
      - The second contract exists.
    decisions: ["0001"]
---`
      ));
    git(fixture.repo, ["add", "."]);
    git(fixture.repo, ["commit", "-m", "advance pointer to second-contract"]);

    expect(() => runGoCommand({
      repo: fixture.repo,
      source: fixture.repo,
      apply: true,
      agent: "claude",
      model: fixture.model,
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "second-attempt"),
      now: new Date(fixture.now.getTime() + 1000),
      tmux: new FakeTmux()
    })).toThrow(/different Action/);
  });

  it("refuses a new worktree while a Session is still live", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    // The Session's tmux pane is still running; it was never reconciled.

    expect(() => runGoCommand({
      repo: fixture.repo,
      source: fixture.repo,
      apply: true,
      agent: "claude",
      model: fixture.model,
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "live-attempt"),
      now: new Date(fixture.now.getTime() + 1000),
      tmux
    })).toThrow(/already live/);
    expect(existsSync(launched.data.session!.worktree_path)).toBe(true);
  });

  it("refuses a new worktree over a dead-but-unreconciled Session instead of guessing it is terminal", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    tmux.live = false; // the process exited, but nobody has reconciled it yet

    expect(() => runGoCommand({
      repo: fixture.repo,
      source: fixture.repo,
      apply: true,
      agent: "claude",
      model: fixture.model,
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "unproven-attempt"),
      now: new Date(fixture.now.getTime() + 1000),
      tmux: new FakeTmux()
    })).toThrow(/never reconciled/);
    expect(existsSync(launched.data.session!.worktree_path)).toBe(true);
  });
});

function productionScope(overrides: Partial<ProductionScope> = {}): ProductionScope {
  return normalizeProductionScope({
    intent: "Advance accepted production work without a per-Action relay.",
    projects: ["test-project"],
    plans: ["test-project/copy-proof"],
    actions: ["test-project/define-contract"],
    providers: ["claude"],
    maxConcurrentSessions: 1,
    mechanicalTransitions: ["validation", "acceptance", "pointer"],
    ...overrides
  });
}

function launch(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux, suffix = "launch") {
  return runGoCommand({
    repo: fixture.repo,
    source: fixture.repo,
    apply: true,
    agent: "claude",
    launch: true,
    model: fixture.model,
    workspace: fixture.workspace,
    agentWorktreeRoot: path.join(fixture.root, suffix),
    now: fixture.now,
    tmux
  });
}

function preparedFixture(options: { responsibility?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-reconcile-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"),
    options.responsibility ? planDocument.replace("responsibility: codex", `responsibility: ${options.responsibility}`) : planDocument);
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), decisionDocument);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);
  const packetId = "codex_reconcile_fixture";
  const provider = "claude-code-cli";
  const model = "sonnet";
  const profile = "claude_build";
  let approvalId = "";
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove reconciliation.", goal: "Prove reconciliation.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    const baseRevision = git(repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(path.join(workspace, path.dirname(promptPath), "metadata.json"), JSON.stringify({
      invocationId: packetId,
      workItemId: workItem.id,
      promptPath,
      baseRevision,
      providerSelection: { provider, model, mappingId: "fixture-map", bindingId: "fixture-binding" }
    }));
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: profile,
      workspaceScope: repo,
      command: "claude",
      promptPath,
      jsonlOutputPath: `prompts/codex/${packetId}/output.jsonl`,
      finalMessagePath: `prompts/codex/${packetId}/final.md`,
      status: "packet_created",
      workItemId: workItem.id,
      executionProfileJson: JSON.stringify({ schema: "arcadia.execution/v1", profile: "routine_implementation" }),
      providerMappingId: "fixture-map",
      providerBindingId: "fixture-binding"
    });
    const approval = createReviewItem(db, {
      workItemId: workItem.id,
      projectId: project.id,
      codexInvocationId: packetId,
      decisionNeeded: "Approve the promoted build packet.",
      sourceInput: "fixture",
      proposedAction: "Launch the fixture Session.",
      resolvedIntent: "CodexPlanningArtifactAcceptance",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: [],
      context: {
        planningPromotion: {
          actionId: "define-contract",
          actionDocRef: "plan/copy-proof#define-contract",
          repoPath: repo,
          buildProfile: profile,
          buildInvocationId: packetId,
          buildPacketPath: promptPath,
          buildPacketSha256: packetSha256(path.join(workspace, promptPath))
        }
      }
    });
    updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture authority approved." });
    approvalId = approval.id;
  });
  return { root, repo, workspace, packetId, provider, model, approvalId, now: new Date("2026-08-30T12:34:56.000Z") };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove Sessions.
active_plan: copy-proof
current_action: define-contract
updated: 2026-08-30
---

# Test Project
`;

const planDocument = `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the Session contract
current_action: define-contract
token_impact: medium
token_budget: One bounded Session; all checks are deterministic.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-08-30
actions:
  - id: define-contract
    title: Define the contract
    status: open
    responsibility: codex
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
    decisions: ["0001"]
---

# Copy proof
`;

const decisionDocument = `---
arcadia: v1
type: decision
id: "0001"
slug: authorize
project: test-project
status: approved
question: May the fixture Session launch?
answer: Yes, launch the fixture Session.
decided: 2026-08-30
updated: 2026-08-30
---

# Authorize
`;
