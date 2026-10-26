import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { runSessionReconcileCommand } from "../src/commands/advance.js";
import { runGoCommand } from "../src/commands/go.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { createCodexInvocation, createReviewExecutionRun, createReviewItem, getWorkItemByDocRef, updateExecutionRunStatus, upsertProject, upsertProjectMetadata, updateReviewItemStatus } from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { activateProduction, countLiveAdmissions, fingerprintProductionScope, issueAdmission, normalizeProductionScope, readProductionPolicy, type ProductionScope } from "../src/production/policy.js";
import { previewAgentAskRequest } from "../src/ask/preview.js";
import { settleAgentAsk } from "../src/ask/settlement.js";
import { getActiveActionClaim, getActiveWorktreeReservation, getSession, prepareSession, resolveProjectTransition, type TmuxAdapter } from "../src/sessions/index.js";
import { buildLaunchPreview } from "../src/sessions/launchPreview.js";
import { launchGuardedHostSession } from "../src/sessions/launch.js";
import { completionEvidenceForReview, getResumableLeaseHandoff, getSessionExitReceipt, reconcileSessionExit } from "../src/sessions/reconciliation.js";
import { MAX_IDENTICAL_PRESERVATION_REFUSALS } from "../src/sessions/preservationRefusalBudget.js";
import { ensureCandidatePreservationTable, refreshPreservedPullRequestBody, type CandidatePreservationReceipt } from "../src/sessions/candidatePreservation.js";
import { sessionLogPath } from "../src/sessions/sessionRecording.js";
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
    const dispatch = resolveProjectTransition({ repoRoot: fixture.repo, projectSlug: "test-project", db: undefined }).dispatch;
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

  it("names a headless Claude authentication failure from the Session log as a provider sign-in failure (Issue #1155)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launch(fixture, tmux);
    const sessionId = launched.data.session!.id;
    tmux.live = false;
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET exit_status = 1 WHERE id = ?").run(sessionId);
    });
    const logFile = sessionLogPath(fixture.workspace, sessionId);
    mkdirSync(path.dirname(logFile), { recursive: true });
    writeFileSync(logFile, [
      JSON.stringify({ type: "system", subtype: "init", model: "haiku" }),
      JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" }),
      "arcadia: provider exited with status 1"
    ].join("\n") + "\n");

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-1155", repoRoot: fixture.repo, workspace: fixture.workspace })
    );
    expect(result.receipt.outcome).toBe("failed_execution");
    expect(result.receipt.reason).toContain("Provider sign-in failure");
    expect(result.receipt.reason).toContain("claude auth login");
    expect(JSON.parse(result.receipt.evidence_json!).providerFailure).toMatchObject({ kind: "sign_in", provider: "claude-code-cli" });
  });

  it.each([
    ["a provider sign-in failure leaves the live development attempt live, so a relaunch resumes it (Issue #1243)",
      "Failed to authenticate: OAuth session expired and could not be refreshed", "running"],
    ["any other nonzero exit settles the development attempt failed", "Prompt is too long", "failed"]
  ])("%s", (_name, resultText, expectedStatus) => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const sessionId = launchCompletionFixture(fixture, tmux).data.session.id;
    tmux.live = false;
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE agent_sessions SET exit_status = 1 WHERE id = ?").run(sessionId);
    });
    const logFile = sessionLogPath(fixture.workspace, sessionId);
    mkdirSync(path.dirname(logFile), { recursive: true });
    writeFileSync(logFile, JSON.stringify({ type: "result", subtype: "success", is_error: true, result: resultText }) + "\n");
    const attempts = () => withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT ordinal, status FROM session_role_attempts WHERE role = 'development'").all());
    expect(attempts()).toEqual([{ ordinal: 1, status: "running" }]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-1243", repoRoot: fixture.repo, workspace: fixture.workspace })
    );

    expect(result.receipt.outcome).toBe("failed_execution");
    expect(attempts()).toEqual([{ ordinal: 1, status: expectedStatus }]);
  });

  it("keeps the generic reason when the log has no error result event, or an error result that is not authentication", () => {
    for (const lines of [
      [JSON.stringify({ type: "assistant", message: "Failed to authenticate the user in the test" })],
      [JSON.stringify({ type: "result", is_error: true, result: "Prompt is too long" })],
      [JSON.stringify({ type: "result", is_error: true, result: "API Error: 403 permission_error: insufficient_scope for this key" })]
    ]) {
      const fixture = preparedFixture();
      const tmux = new FakeTmux();
      const launched = launch(fixture, tmux);
      const sessionId = launched.data.session!.id;
      tmux.live = false;
      withDatabase(fixture.workspace, (db) => {
        db.prepare("UPDATE agent_sessions SET exit_status = 1 WHERE id = ?").run(sessionId);
      });
      const logFile = sessionLogPath(fixture.workspace, sessionId);
      mkdirSync(path.dirname(logFile), { recursive: true });
      writeFileSync(logFile, lines.join("\n") + "\n");
      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId, requestId: "reconcile-1155-neg", repoRoot: fixture.repo, workspace: fixture.workspace })
      );
      expect(result.receipt.reason).toBe("The Session exited with a nonzero status (1).");
    }
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

describe("reconcileSessionExit releases a committed production admission (Issue #610)", () => {
  const admissionScope: ProductionScope = normalizeProductionScope({
    intent: "Prove a completed Session's admission is released, not leaked.",
    projects: ["test-project"],
    plans: ["test-project/copy-proof"],
    actions: ["test-project/define-contract"],
    providers: ["claude-code-cli"],
    maxConcurrentSessions: 1,
    mechanicalTransitions: []
  });

  function admissionProfiles(): CodingAgentProfile[] {
    return [{
      name: "claude_build", provider: "claude-code-cli", package: "@anthropic-ai/claude-code",
      command: "claude", purpose: "build", sandbox: "workspace-write", args: []
    }];
  }

  function admissionCapacity(): ProviderCapacityObservation {
    const decision: CapacityAdmissionDecision = {
      providerId: "claude-code-cli", admitted: true, code: null, reason: "included allowance", unattendedProof: true,
      retryAfter: null, refreshRequired: false,
      receipt: {
        version: 1, providerId: "claude-code-cli", providerLabel: "claude-code-cli", profiles: [], accountScope: "test",
        source: "codex_app_server", evidence: "simulated", unattended: true, observedAt: "2026-08-30T12:00:00.000Z",
        observedAgeMs: 0, expiresAt: null, confidence: "observed", freshness: "fresh", usagePolicy: "included",
        usagePolicyReason: "test fixture", windows: [{ label: "5h", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
        nextResetAt: null, unsupported: [], availability: "available", telemetry: "test fixture"
      }
    };
    return { generatedAt: "2026-08-30T12:34:56.000Z", providers: [decision] };
  }

  it("with maxConcurrentSessions 1: one Session launches, completes, and a second admission is granted on the next tick instead of refused concurrency_limit", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-610", scope: admissionScope,
        scopeFingerprint: fingerprintProductionScope(admissionScope), grantedBy: "operator"
      })
    );

    const launched = withDatabase(fixture.workspace, (db) =>
      launchGuardedHostSession({
        db, workspace: fixture.workspace, repoRoot: fixture.repo, projectSlug: "test-project",
        requestId: "610-launch-1", standingPolicy: true, profiles: admissionProfiles(), adapters: defaultAdapters as ProviderAdapterRegistry,
        now: fixture.now, tmux, agentWorktreeRoot: path.join(fixture.root, "610-launch-1"),
        capacityObservation: admissionCapacity()
      })
    );
    expect(launched.admission?.status).toBe("committed");
    const sessionId = launched.session.id;
    const linked = withReadOnlyDatabase(fixture.workspace, (db) => getSession(db, sessionId));
    expect(linked?.admission_request_id).toBe(launched.admission?.requestId);

    // The Session's process has exited with nothing to show for it -- a
    // "missing evidence" terminal outcome, exactly like any other clean-but-
    // unaccepted exit. What matters for Issue #610 is only that reconciliation
    // moves the Session off `prepared`/`running`, which is what should free
    // its admission regardless of which terminal outcome it lands on.
    tmux.live = false;
    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "610-reconcile-1", repoRoot: fixture.repo })
    );
    expect(result.receipt.outcome).toBe("missing_evidence");

    const releasedAdmission = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT status FROM production_admissions WHERE request_id = ?").get(launched.admission!.requestId)
    ) as { status: string } | undefined;
    expect(releasedAdmission?.status).toBe("released");

    // Before the fix, this admission stayed "committed" forever, so
    // countLiveAdmissions kept reporting 1 live slot under a policy of 1 --
    // permanently refusing every further launch with concurrency_limit.
    const policyState = withReadOnlyDatabase(fixture.workspace, (db) => readProductionPolicy(db));
    const live = withReadOnlyDatabase(fixture.workspace, (db) => countLiveAdmissions(db, policyState.epoch, fixture.now.toISOString()));
    expect(live).toBe(0);

    const nextAdmission = withDatabase(fixture.workspace, (db) =>
      issueAdmission(db, {
        requestId: "610-launch-2:admission", actionKey: "test-project/define-contract", projectSlug: "test-project",
        planSlug: "copy-proof", provider: "claude-code-cli", capacity: admissionCapacity().providers[0], now: fixture.now
      })
    );
    expect(nextAdmission.admitted).toBe(true);
    expect(nextAdmission.code).not.toBe("concurrency_limit");
  });
});

describe("reconcileSessionExit automatic production completion", () => {
  it.each(["completed", "running"] as const)("does not invent criterion evidence from a %s Run under an acceptance Grant", (runStatus) => {
    const fixture = preparedFixture({ responsibility: "agent", acceptanceCriteria: [
      "The contract exists.", "The contract documents the recovery procedure."
    ] });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    // This Run predates the candidate change; a running Run has not passed.
    // Neither supplies evidence of the missing recovery text.
    withDatabase(fixture.workspace, (db) => {
      const session = getSession(db, sessionId)!;
      const run = createReviewExecutionRun(db, {
        reviewItemId: fixture.approvalId, executorName: "test", workItemId: session.work_item_id, summary: "Unrelated build."
      });
      updateExecutionRunStatus(db, run.id, runStatus, { summary: "Unrelated build." });
      const scope = productionScope();
      activateProduction(db, { requestId: "grant-no-invented-evidence", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" });
    });
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "contract without recovery procedure"]);
    const before = git(worktreePath, ["rev-parse", "HEAD"]).trim();
    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-no-invented-evidence", repoRoot: fixture.repo })
    );
    expect(result.receipt.outcome).toBe("incomplete_resumable");
    expect(git(worktreePath, ["rev-parse", "HEAD"]).trim()).toBe(before);
    expect(discoverDocs(worktreePath).docs.find((doc) => doc.type === "plan" && doc.slug === "copy-proof"))
      .toMatchObject({ status: "active", currentAction: "define-contract" });
    expect(withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT COUNT(*) AS count FROM agent_ask_settlements").get()))
      .toEqual({ count: 0 });
  });

  it("settles real drafted criterion evidence under an acceptance Grant and replays the same receipt", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    draftCompleteInWorktree(worktreePath, "The contract exists.");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-m", "preserve contract and criterion evidence"]);
    withDatabase(fixture.workspace, (db) => {
      const scope = productionScope();
      activateProduction(db, { requestId: "grant-drafted-completion", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" });
    });
    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-drafted-grant", repoRoot: fixture.repo })
    );
    expect(result.receipt.outcome).toBe("accepted_completion");
    expect(result.receipt.reason).toContain("drafted complete Ask");
    expect(result.receipt.run_id).toBeNull();
    expect(discoverDocs(worktreePath).docs.find((doc) => doc.type === "plan" && doc.slug === "copy-proof"))
      .toMatchObject({ status: "complete" });
    const receipts = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT receipt_json FROM agent_ask_settlements").all()) as { receipt_json: string }[];
    expect(receipts).toHaveLength(1);
    expect(JSON.parse(receipts[0].receipt_json).authority.kind).toBe("deterministic_proof");
    expect(git(worktreePath, ["status", "--porcelain"])).toBe("");
    const replay = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-drafted-grant-retry", repoRoot: fixture.repo })
    );
    expect(replay.receipt.id).toBe(result.receipt.id);
    expect(replay.created).toBe(false);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT COUNT(*) AS count FROM agent_ask_settlements").get())).toEqual({ count: 1 });
  });

  it("accepts a completion the Session settled on its own candidate by the brief's protocol, with no Run recorded", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);
    settleCompleteFromWorktree(fixture, worktreePath, "self-settle-define-contract");

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-self-settled", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("accepted_completion");
    expect(result.receipt.reason).toMatch(/settled its own governed completion on its candidate \(settlement /);
    expect(result.receipt.run_id).toBeNull();
    expect(result.nextMove.kind).not.toBe("unknown");
  });

  it("settles the drafted complete Ask a sandboxed Session left on its preserved candidate, with no Run recorded", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    draftCompleteInWorktree(worktreePath, "The contract exists.");
    // Host preservation commits the sandboxed agent's uncommitted tree, draft included.
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-m", "preserve candidate"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-drafted", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("accepted_completion");
    expect(result.receipt.reason).toMatch(/Settled the Session's drafted complete Ask on its candidate/);
    expect(result.receipt.run_id).toBeNull();
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: worktreePath, encoding: "utf8" })).toBe("");
  });

  it("leaves a drafted complete Ask whose evidence does not cover the criteria unsettled", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    draftCompleteInWorktree(worktreePath, "Something else was done.");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-m", "preserve candidate"]);

    // A generic passing Run must not override the canonical draft's refusal.
    withDatabase(fixture.workspace, (db) => {
      const session = getSession(db, sessionId)!;
      const run = createReviewExecutionRun(db, { reviewItemId: fixture.approvalId, executorName: "test", workItemId: session.work_item_id, summary: "Build passed." });
      updateExecutionRunStatus(db, run.id, "completed", { summary: "Build passed." });
      const scope = productionScope();
      activateProduction(db, { requestId: "grant-invalid-draft", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" });
    });
    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-drafted-wrong", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
  });

  // Contract 20 false-agent-completion quality gate (Issue #555), owned by the
  // Action `prove-contract-20-completion-gate`. The evidence below is verbatim
  // and every criterion says `met`; only the declared Artifact is missing, so
  // the claim is false and must be refused, not accepted from the claim alone.
  it("refuses a drafted complete Ask whose verbatim met evidence is false because the declared Artifact was never produced (contract 20, #555)", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    draftCompleteInWorktree(worktreePath, "The contract exists.");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-m", "claim completion without the work"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-false-drafted", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
    expect(result.receipt.outcome).not.toBe("accepted_completion");
    expect(existsSync(path.join(worktreePath, "contract.md"))).toBe(false);
    expect(readFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), "utf8")).toMatch(/id: define-contract[\s\S]*?status: open/);
  });

  // Issue #1599, the live shape of 2026-10-19: a sandboxed Session drafted a
  // complete Ask with verbatim `met` evidence for a criterion naming its own
  // new test file, the host preserved it, and reconciliation accepted it
  // although that test failed -- no test ran before acceptance. The named
  // test now runs (under Seatbelt, with the Arcadia checkout's installed
  // vitest standing in for the Project's) before the draft settles. Under
  // ARCADIA_PRESERVATION_HOST_TEST=1 on macOS (outside any agent sandbox,
  // since Seatbelt cannot nest) the checks run confined; otherwise the same
  // checks run unconfined, the harness's convention for preservation.
  describe("pre-acceptance validation of the named test files (#1599)", () => {
    const criterion = "tests/contract.test.ts passes and asserts the contract.";
    const confined = process.platform === "darwin" && process.env.ARCADIA_PRESERVATION_HOST_TEST === "1";
    const completionValidation = { dependencyRoot: process.cwd(), ...(confined ? {} : { unconfinedForTests: true }) };

    function namedTestCandidate(testBody: string | ((workspace: string) => string), nextAction = false) {
      const fixture = preparedFixture({ responsibility: "agent", acceptanceCriteria: [criterion], nextAction });
      const tmux = new FakeTmux();
      const launched = launchCompletionFixture(fixture, tmux);
      const worktreePath = launched.data.session.worktree_path;
      tmux.live = false;
      writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
      writeFileSync(path.join(worktreePath, "package.json"), `${JSON.stringify({ name: "fixture", private: true, type: "module", devDependencies: { vitest: "*" } })}\n`);
      mkdirSync(path.join(worktreePath, "tests"), { recursive: true });
      writeFileSync(path.join(worktreePath, "tests", "contract.test.ts"), `import { expect, it } from "vitest";\n${typeof testBody === "string" ? testBody : testBody(fixture.workspace)}\n`);
      draftCompleteInWorktree(worktreePath, criterion);
      git(worktreePath, ["add", "."]);
      git(worktreePath, ["commit", "-m", "preserve candidate"]);
      return { fixture, sessionId: launched.data.session.id, worktreePath };
    }

    it("does not accept a drafted completion whose named test fails: resumable, and the reason names the failing test", () => {
      const { fixture, sessionId, worktreePath } = namedTestCandidate(`it("asserts the contract @here \`x\`", () => { expect(1 + 1).toBe(3); });`);

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId, requestId: "reconcile-named-test-fails", repoRoot: fixture.repo, workspace: fixture.workspace, completionValidation })
      );

      expect(result.receipt.outcome).toBe("incomplete_resumable");
      expect(result.receipt.lease_handoff).toBe(1);
      expect(result.receipt.reason).toContain("the Action's declared validation did not pass on the candidate");
      expect(result.receipt.reason).toContain("tests/contract.test.ts > asserts the contract");
      // Untrusted test text is neutralized: no mention, no code span.
      expect(result.receipt.reason).not.toMatch(/@here|`x`/);
      expect(readFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), "utf8")).toMatch(/id: define-contract[\s\S]*?status: open/);
      const handoff = withReadOnlyDatabase(fixture.workspace, (db) => getResumableLeaseHandoff(db, fixture.repo));
      expect(handoff?.session.id).toBe(sessionId);
      expect(handoff?.receipt.reason).toContain("tests/contract.test.ts > asserts the contract");
    });

    it("accepts the drafted completion once its named test passes", () => {
      const { fixture, sessionId, worktreePath } = namedTestCandidate(`it("asserts the contract", () => { expect(1 + 1).toBe(2); });`, true);

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId, requestId: "reconcile-named-test-passes", repoRoot: fixture.repo, workspace: fixture.workspace, completionValidation })
      );

      expect(result.receipt.outcome).toBe("accepted_completion");
      expect(result.receipt.reason).toMatch(/Settled the Session's drafted complete Ask on its candidate/);
      expect(JSON.parse(result.receipt.evidence_json!).completionValidation).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const head = git(worktreePath, ["rev-parse", "HEAD"]);
      const review = () => withReadOnlyDatabase(fixture.workspace, db => completionEvidenceForReview(db, fixture.workspace, getSession(db, sessionId)!, git(worktreePath, ["rev-parse", "HEAD"]).trim()));
      expect(review()).toMatchObject({ status: "verified", record: { outcome: "passed", reports: [{ file: "tests/contract.test.ts", tests: [{ name: "asserts the contract", status: "passed" }] }] } });
      const preservedTree = review();
      if (preservedTree.status !== "verified") throw new Error("retained record missing");
      let publishedBody = "";
      withDatabase(fixture.workspace, db => {
        const session = getSession(db, sessionId)!;
        const preservedCommit = git(worktreePath, ["rev-parse", "HEAD^"]).trim();
        const receipt: CandidatePreservationReceipt = { id: "fixture_preservation", requestId: "fixture_preservation", repositoryPath: session.repository_path,
          candidateWorktreePath: session.worktree_path, branch: session.branch, baseBranch: "main", baseRevision: session.base_revision,
          actionId: session.action_id, packetSha256: session.packet_sha256, policyEpoch: 1, policyRevision: 1,
          candidateFingerprint: preservedTree.record.tree, validationEvidenceRef: "/missing/legacy-validation.json", commitSha: preservedCommit,
          preservationState: "IN PR", pushedRemote: "origin", pullRequestNumber: 1, pullRequestUrl: "https://github.com/fixture/fixture/pull/1",
          retryAction: null, createdAt: session.created_at, replayed: false };
        ensureCandidatePreservationTable(db);
        db.prepare(`INSERT INTO candidate_preservation_receipts
          (id,request_id,repository_path,candidate_worktree_path,branch,base_branch,base_revision,action_id,packet_sha256,policy_epoch,policy_revision,candidate_fingerprint,commit_sha,preservation_state,receipt_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(receipt.id, receipt.requestId, receipt.repositoryPath, receipt.candidateWorktreePath, receipt.branch,
            receipt.baseBranch, receipt.baseRevision, receipt.actionId, receipt.packetSha256, 1, 1, receipt.candidateFingerprint, receipt.commitSha, receipt.preservationState, JSON.stringify(receipt), receipt.createdAt);
        expect(refreshPreservedPullRequestBody(db, { requestId: receipt.requestId, headSha: head.trim(), sessionId, workspace: fixture.workspace,
          plan: { kind: "action-acceptance", actionKey: "test-project/define-contract", actionTitle: "Define contract", acceptanceCriteria: [criterion], validationCommands: ["true"] } },
          { upsertDraftPullRequest: input => { publishedBody = input.body; return { number: 1, url: receipt.pullRequestUrl! }; } })).toBe(true);
        const stored = db.prepare("SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?").get(receipt.requestId) as { receipt_json: string };
        expect(JSON.parse(stored.receipt_json).completionValidation).toEqual(JSON.parse(result.receipt.evidence_json!).completionValidation);
      });
      expect(publishedBody).toContain("Completion execution evidence");
      expect(publishedBody).toContain('"status": "verified"');
      expect(publishedBody).toContain("asserts the contract");
      // A later code commit remains an ancestor but is no longer the validated tree.
      writeFileSync(path.join(worktreePath, "contract.md"), "Changed after validation.\n");
      git(worktreePath, ["commit", "-qam", "post-validation change"]);
      expect(review().status).toBe("unavailable");
      expect(head).not.toBe(git(worktreePath, ["rev-parse", "HEAD"]));
    });

    // Candidate test code must not read the workspace (its database) or the
    // host user's home (~/.arcadia, other checkouts): a test that asserts both
    // reads are refused passes only inside the confinement.
    it.runIf(confined)("keeps the workspace database and the host home unreadable to candidate tests", () => {
      const databaseIn = (workspace: string) => {
        const database = readdirSync(workspace, { recursive: true, withFileTypes: true })
          .find((entry) => entry.isFile() && /\.(?:db|sqlite3?)$/.test(entry.name));
        if (!database) throw new Error("fixture workspace has no database file");
        return path.join(database.parentPath, database.name);
      };
      const { fixture, sessionId } = namedTestCandidate((workspace) => `import { readFileSync, readdirSync } from "node:fs";
it("asserts the contract", () => {
  expect(() => readFileSync(${JSON.stringify(databaseIn(workspace))})).toThrow();
  expect(() => readdirSync(${JSON.stringify(homedir())})).toThrow();
  expect(() => readdirSync(${JSON.stringify(path.join(homedir(), ".arcadia"))})).toThrow();
});`);

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId, requestId: "reconcile-named-test-reads", repoRoot: fixture.repo, workspace: fixture.workspace, completionValidation })
      );

      expect(result.receipt.reason).toMatch(/Settled the Session's drafted complete Ask on its candidate/);
      expect(result.receipt.outcome).toBe("accepted_completion");
    });

    it("refuses, never passes, a named test that does not finish within the bound; a repeated timeout holds for the operator", () => {
      const { fixture, sessionId } = namedTestCandidate(`it("asserts the contract", () => new Promise(() => {}), 600_000);`);
      const reconcileAgain = (n: number) => {
        withDatabase(fixture.workspace, (db) => {
          db.prepare("DELETE FROM session_exit_receipts WHERE session_id = ?").run(sessionId);
          db.prepare("UPDATE agent_sessions SET status = 'running', ended_at = NULL WHERE id = ?").run(sessionId);
        });
        return withDatabase(fixture.workspace, (db) =>
          reconcileSessionExit({ db, sessionId, requestId: `reconcile-named-test-hangs-${n}`, repoRoot: fixture.repo, workspace: fixture.workspace, completionValidation: { ...completionValidation, timeoutMs: 15_000 } })
        ).receipt;
      };

      // Issue #1613: one timeout may be load or one hung test: still resumable, no hold.
      const first = reconcileAgain(1);
      expect(first.outcome).toBe("incomplete_resumable");
      expect(first.reason).toContain("did not finish within 15s");
      expect(first.reason).toContain("tests/contract.test.ts (timed out)");
      expect(first.lease_handoff).toBe(1);
      expect(JSON.parse(first.evidence_json ?? "{}").completionHold).toBeUndefined();
      // The second identical timeout is a host fault: one named hold, no resumable handoff.
      const second = reconcileAgain(2);
      expect(second.lease_handoff).toBe(0);
      expect(JSON.parse(second.evidence_json ?? "{}").completionHold).toMatchObject({ kind: "completion_validation_unavailable" });
    });

    // Issue #1613: errors from the candidate's own content stay ordinary resumable refusals.
    it("keeps a candidate-content validation refusal resumable, never a host-fault hold", () => {
      const noRunner = namedTestCandidate(`it("asserts the contract", () => { expect(1).toBe(1); });`);
      writeFileSync(path.join(noRunner.worktreePath, "package.json"), `${JSON.stringify({ name: "fixture", private: true, type: "module" })}\n`);
      git(noRunner.worktreePath, ["commit", "-qam", "drop the declared runner"]);
      const tracked = namedTestCandidate(`it("asserts the contract", () => { expect(1).toBe(1); });`);
      mkdirSync(path.join(tracked.worktreePath, "node_modules", "evil"), { recursive: true });
      writeFileSync(path.join(tracked.worktreePath, "node_modules", "evil", "index.js"), "module.exports = 1;\n");
      git(tracked.worktreePath, ["add", "-f", "node_modules"]);
      git(tracked.worktreePath, ["commit", "-qm", "track node_modules"]);
      for (const candidate of [noRunner, tracked]) {
        const { receipt } = withDatabase(candidate.fixture.workspace, (db) =>
          reconcileSessionExit({ db, sessionId: candidate.sessionId, requestId: "reconcile-candidate-content", repoRoot: candidate.fixture.repo, workspace: candidate.fixture.workspace, completionValidation })
        );
        expect(receipt.outcome).toBe("incomplete_resumable");
        expect(receipt.reason).toContain("Pre-acceptance validation");
        expect(receipt.lease_handoff).toBe(1);
        expect(JSON.parse(receipt.evidence_json ?? "{}").completionHold).toBeUndefined();
      }
    });

    // Issue #1613: `arcadia session reconcile` (not the tick) records the escalation too.
    it("records the operator escalation when a host-fault hold is reconciled outside the tick", () => {
      const { fixture, sessionId } = namedTestCandidate(`it("asserts the contract", () => { expect(1).toBe(1); });`);
      withDatabase(fixture.workspace, (db) => {
        const project = db.prepare("SELECT id FROM projects WHERE slug = 'test-project'").get() as { id: string };
        upsertProjectMetadata(db, { projectId: project.id, repoPath: fixture.repo, validationCommands: [] });
      });
      const response = runSessionReconcileCommand({ workspace: fixture.workspace, repo: fixture.repo, session: sessionId, requestId: "reconcile-outside-tick" });
      expect(response.data.receipt.lease_handoff).toBe(0);
      const escalation = withReadOnlyDatabase(fixture.workspace, (db) =>
        db.prepare("SELECT kind, remedy FROM production_operator_escalations WHERE action_key = 'test-project/define-contract'").get()) as { kind: string; remedy: string } | undefined;
      expect(escalation).toMatchObject({ kind: "completion_validation_unavailable" });
      expect(escalation!.remedy).toContain("reset-repair-budget");
    });

    // Issue #1613: the same drafted-completion refusal, repeated across relaunches of one Action,
    // stops for the operator at the existing identical-refusal limit.
    it("stops offering resumption once the identical drafted-completion refusal repeats the identical-refusal limit", () => {
      const { fixture, sessionId } = namedTestCandidate(`it("asserts the contract", () => { expect(1 + 1).toBe(3); });`);
      const receipts = [] as Array<{ lease_handoff: number; evidence_json: string | null }>;
      for (let attempt = 1; attempt <= MAX_IDENTICAL_PRESERVATION_REFUSALS; attempt += 1) {
        // Each pass stands for one more relaunch of the same Action exiting with the same draft: forget the
        // previous receipt and let the Session be reconciled again (a real relaunch is a new Session id).
        withDatabase(fixture.workspace, (db) => {
          db.prepare("DELETE FROM session_exit_receipts WHERE session_id = ?").run(sessionId);
          db.prepare("UPDATE agent_sessions SET status = 'running', ended_at = NULL WHERE id = ?").run(sessionId);
        });
        const result = withDatabase(fixture.workspace, (db) =>
          reconcileSessionExit({ db, sessionId, requestId: `reconcile-repeat-${attempt}`, repoRoot: fixture.repo, workspace: fixture.workspace, completionValidation })
        );
        receipts.push(result.receipt);
      }
      expect(receipts.slice(0, -1).map((receipt) => receipt.lease_handoff)).toEqual(receipts.slice(0, -1).map(() => 1));
      const last = receipts[receipts.length - 1];
      expect(last.lease_handoff).toBe(0);
      expect(JSON.parse(last.evidence_json ?? "{}").completionHold).toMatchObject({ kind: "completion_refused_repeatedly" });
    });
  });

  // Issue #1608, the live shape of 2026-10-20: the drafted evidence marked
  // "touches only <test file>" met while the candidate also changed product
  // code, and it settled. The scope clause is now judged against the
  // candidate's own diff (governed records excluded) before the draft settles.
  describe("scope criterion check against the candidate's diff (#1608)", () => {
    const criterion = "contract.md exists; the change touches only contract.md.";

    function scopedCandidate(extra: Record<string, string>) {
      const fixture = preparedFixture({ responsibility: "agent", acceptanceCriteria: [criterion] });
      const tmux = new FakeTmux();
      const launched = launchCompletionFixture(fixture, tmux);
      const worktreePath = launched.data.session.worktree_path;
      tmux.live = false;
      writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
      for (const [file, body] of Object.entries(extra)) {
        mkdirSync(path.dirname(path.join(worktreePath, file)), { recursive: true });
        writeFileSync(path.join(worktreePath, file), body);
      }
      draftCompleteInWorktree(worktreePath, criterion);
      git(worktreePath, ["add", "."]);
      git(worktreePath, ["commit", "-m", "preserve candidate"]);
      return { fixture, sessionId: launched.data.session.id, worktreePath };
    }

    it("does not accept a drafted completion whose diff leaves the scope it marks met: resumable, naming the out-of-scope file", () => {
      const { fixture, sessionId, worktreePath } = scopedCandidate({ "src/product.ts": "export const changed = true;\n", "src/`@here`.ts": "x\n" });

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId, requestId: "reconcile-scope-violated", repoRoot: fixture.repo, workspace: fixture.workspace })
      );

      expect(result.receipt.outcome).toBe("incomplete_resumable");
      expect(result.receipt.lease_handoff).toBe(1);
      expect(result.receipt.reason).toContain("Scope check refused the completion");
      expect(result.receipt.reason).toContain("allows only contract.md, but the candidate also changes");
      expect(result.receipt.reason).toContain("src/product.ts");
      // A candidate-chosen file name is neutralized: no mention, no code span.
      expect(result.receipt.reason).not.toMatch(/@here|`/);
      expect(readFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), "utf8")).toMatch(/id: define-contract[\s\S]*?status: open/);
    });

    it("(#1615) names a scratch file the Session left uncommitted and host preservation swept in, still refusing it", () => {
      const fixture = preparedFixture({ responsibility: "agent", acceptanceCriteria: [criterion] });
      const tmux = new FakeTmux();
      const launched = launchCompletionFixture(fixture, tmux);
      const worktreePath = launched.data.session.worktree_path;
      tmux.live = false;
      writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
      git(worktreePath, ["add", "contract.md"]);
      git(worktreePath, ["commit", "-m", "define the contract"]);
      draftCompleteInWorktree(worktreePath, criterion);
      writeFileSync(path.join(worktreePath, "scratch-notes.txt"), "scratch\n");
      git(worktreePath, ["add", "."]);
      git(worktreePath, ["commit", "-m", "chore(candidate): preserve define-contract candidate for handoff\n\nArcadia-Preservation-Request: preserve-stray"]);

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId: launched.data.session.id, requestId: "reconcile-stray-file", repoRoot: fixture.repo, workspace: fixture.workspace })
      );

      expect(result.receipt.outcome).toBe("incomplete_resumable");
      expect(result.receipt.reason).toContain("Scope check refused the completion");
      expect(result.receipt.reason).toMatch(/Stray untracked file left uncommitted by the Session[^.]*: scratch-notes\.txt/);
    });

    it("(#1615) does not call a file the Session itself committed a stray", () => {
      const { fixture, sessionId } = scopedCandidate({ "src/product.ts": "export const changed = true;\n" });
      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId, requestId: "reconcile-not-stray", repoRoot: fixture.repo, workspace: fixture.workspace })
      );
      expect(result.receipt.reason).toContain("src/product.ts");
      expect(result.receipt.reason).not.toContain("Stray untracked");
    });

    it("(#1615) a completion the Session settled itself still faces the scope check against the base's criteria", () => {
      const fixture = preparedFixture({ responsibility: "agent", acceptanceCriteria: [criterion] });
      const tmux = new FakeTmux();
      const launched = launchCompletionFixture(fixture, tmux);
      const worktreePath = launched.data.session.worktree_path;
      tmux.live = false;
      writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
      mkdirSync(path.join(worktreePath, "src"), { recursive: true });
      writeFileSync(path.join(worktreePath, "src", "product.ts"), "export const changed = true;\n");
      git(worktreePath, ["add", "."]);
      git(worktreePath, ["commit", "-m", "define the contract and more"]);
      settleCompleteFromWorktree(fixture, worktreePath, "self-settle-out-of-scope", criterion);

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId: launched.data.session.id, requestId: "reconcile-self-settled-scope", repoRoot: fixture.repo, workspace: fixture.workspace })
      );

      expect(result.receipt.outcome).not.toBe("accepted_completion");
      expect(result.receipt.reason).toContain("Scope check refused the completion");
      expect(result.receipt.reason).toContain("src/product.ts");
      expect(result.receipt.reason).not.toContain("docs/plans");
      // Governance already recorded the completion, so the Session cannot repair it: no relaunch, the operator decides.
      expect(result.receipt.lease_handoff).toBe(0);
      expect(result.receipt.reason).toContain("already settled");
      expect(result.receipt.evidence_json).toContain("completionSettlementNotInCandidate");
      expect(result.receipt.evidence_json).toContain("self_settled_refused");
    });

    it("(#1615) accepts a self-settled completion that stays in scope, the settlement's own records excused", () => {
      const fixture = preparedFixture({ responsibility: "agent", acceptanceCriteria: [criterion] });
      const tmux = new FakeTmux();
      const launched = launchCompletionFixture(fixture, tmux);
      const worktreePath = launched.data.session.worktree_path;
      tmux.live = false;
      writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
      git(worktreePath, ["add", "."]);
      git(worktreePath, ["commit", "-m", "define the contract"]);
      settleCompleteFromWorktree(fixture, worktreePath, "self-settle-in-scope", criterion);

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId: launched.data.session.id, requestId: "reconcile-self-settled-in-scope", repoRoot: fixture.repo, workspace: fixture.workspace })
      );

      expect(result.receipt.outcome).toBe("accepted_completion");
    });

    it("judges the base's criteria: a candidate that drops its own scope criterion from its Plan copy is still refused", () => {
      const fixture = preparedFixture({ responsibility: "agent", acceptanceCriteria: [criterion] });
      const tmux = new FakeTmux();
      const launched = launchCompletionFixture(fixture, tmux);
      const worktreePath = launched.data.session.worktree_path;
      tmux.live = false;
      const planPath = path.join(worktreePath, "docs", "plans", "copy-proof.md");
      const plan = readFileSync(planPath, "utf8");
      expect(plan).toContain(criterion);
      writeFileSync(planPath, plan.replace(criterion, "contract.md exists."));
      writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
      mkdirSync(path.join(worktreePath, "docs", "decisions"), { recursive: true });
      writeFileSync(path.join(worktreePath, "docs", "decisions", "9999-self-approved.md"), "smuggled\n");
      mkdirSync(path.join(worktreePath, ".arcadia", "asks", "nested"), { recursive: true });
      writeFileSync(path.join(worktreePath, ".arcadia", "asks", "nested", "payload.ts"), "smuggled\n");
      draftCompleteInWorktree(worktreePath, "contract.md exists.");
      git(worktreePath, ["add", "."]);
      git(worktreePath, ["commit", "-m", "preserve candidate"]);

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId: launched.data.session.id, requestId: "reconcile-scope-plan-edited", repoRoot: fixture.repo, workspace: fixture.workspace })
      );

      expect(result.receipt.outcome).toBe("incomplete_resumable");
      expect(result.receipt.reason).toContain("Scope check refused the completion");
      expect(result.receipt.reason).toContain("docs/plans/copy-proof.md");
      expect(result.receipt.reason).toContain("docs/decisions/9999-self-approved.md");
      // Only a completion draft directly in .arcadia/asks/ is exempt.
      expect(result.receipt.reason).toContain(".arcadia/asks/nested/payload.ts");
    });

    it("accepts the drafted completion when only the scoped file and the Session's own completion draft change", () => {
      const { fixture, sessionId } = scopedCandidate({});

      const result = withDatabase(fixture.workspace, (db) =>
        reconcileSessionExit({ db, sessionId, requestId: "reconcile-scope-held", repoRoot: fixture.repo, workspace: fixture.workspace })
      );

      expect(result.receipt.outcome).toBe("accepted_completion");
      expect(result.receipt.reason).toMatch(/Settled the Session's drafted complete Ask on its candidate/);
    });
  });

  it("refuses to settle a self-completion whose verbatim met evidence is false because the declared Artifact is missing (contract 20, #555)", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;

    expect(() => settleCompleteFromWorktree(fixture, worktreePath, "false-self-settle")).toThrow();
    expect(readFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), "utf8")).toMatch(/id: define-contract[\s\S]*?status: open/);
  });

  it("never accepts a candidate whose Plan claims done without a settlement behind it", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    const planPath = path.join(worktreePath, "docs", "plans", "copy-proof.md");
    writeFileSync(planPath, readFileSync(planPath, "utf8").replace(/(- id: define-contract[\s\S]*?status: )open/, "$1done"));
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-m", "claim done by hand"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-hand-edited", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
  });

  it("never accepts a self-settled completion when the work changed after the settled revision", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);
    settleCompleteFromWorktree(fixture, worktreePath, "self-settle-then-change-work");
    writeFileSync(path.join(worktreePath, "contract.md"), "Changed after acceptance.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "change the accepted work"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-changed-after", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
  });

  it("never accepts a settlement whose own commit is not on this candidate, even when the candidate claims done", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);
    const evidenceRevision = git(worktreePath, ["rev-parse", "HEAD"]).trim();
    settleCompleteFromWorktree(fixture, worktreePath, "self-settle-elsewhere");
    // Keep the settled Plan text, but drop the settlement commit itself: the
    // candidate now carries only a managed-record edit on top of the evidence.
    const plan = readFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), "utf8");
    git(worktreePath, ["reset", "-q", "--hard", evidenceRevision]);
    writeFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), plan);
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-m", "claim done without the settlement commit"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-settled-elsewhere", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
  });

  it("never accepts a settlement whose candidate_revision is not in this candidate's history", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "The contract exists.\n");
    git(worktreePath, ["add", "contract.md"]);
    git(worktreePath, ["commit", "-m", "define the contract"]);
    settleCompleteFromWorktree(fixture, worktreePath, "self-settle-then-rewrite");
    // Rewrite the candidate so the settled revision is no longer its ancestor,
    // keeping the Plan's done status (a candidate that replaced the evidence).
    const plan = readFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), "utf8");
    const baseRevision = launched.data.session.base_revision;
    git(worktreePath, ["reset", "-q", "--hard", baseRevision]);
    writeFileSync(path.join(worktreePath, "docs", "plans", "copy-proof.md"), plan);
    writeFileSync(path.join(worktreePath, "contract.md"), "A different contract.\n");
    git(worktreePath, ["add", "."]);
    git(worktreePath, ["commit", "-m", "replace the evidence"]);

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-rewritten", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
  });

  it("releases the Action claim of a Session that exited with nothing to resume, so the same Action can be dispatched again", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getActiveActionClaim(db, fixture.repo, "test-project", "define-contract", fixture.now))).not.toBeNull();

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-release-claim", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("missing_evidence");
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getActiveActionClaim(db, fixture.repo, "test-project", "define-contract", fixture.now))).toBeNull();
    // The worktree reservation itself survives, so `tidy` still will not retire the worktree.
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getActiveWorktreeReservation(db, fixture.repo, worktreePath, fixture.now))).not.toBeNull();
  });

  it("keeps the Action claim of a Session whose candidate can be resumed", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
    tmux.live = false;
    writeFileSync(path.join(worktreePath, "contract.md"), "draft\n");

    const result = withDatabase(fixture.workspace, (db) =>
      reconcileSessionExit({ db, sessionId, requestId: "reconcile-keep-claim", repoRoot: fixture.repo })
    );

    expect(result.receipt.outcome).toBe("incomplete_resumable");
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getActiveActionClaim(db, fixture.repo, "test-project", "define-contract", fixture.now))?.worktree_path).toBe(worktreePath);
  });

  it("leaves the Session incomplete_resumable when no standing production policy delegates mechanical acceptance", () => {
    const fixture = preparedFixture({ responsibility: "agent" });
    const tmux = new FakeTmux();
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
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
    const launched = launchCompletionFixture(fixture, tmux);
    const sessionId = launched.data.session.id;
    const worktreePath = launched.data.session.worktree_path;
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

  it("clears a stale different-Action candidate once its worktree is discarded exactly as the refusal instructs, instead of refusing forever", () => {
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
      reconcileSessionExit({ db, sessionId, requestId: "resume-2b", repoRoot: fixture.repo })
    );

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

    // Discard the stale candidate exactly as the refusal's own remedy says:
    // "discard it (remove its worktree and branch)".
    git(fixture.repo, ["worktree", "remove", "--force", worktreePath]);
    git(fixture.repo, ["branch", "-D", branch]);
    expect(existsSync(worktreePath)).toBe(false);

    const result = runGoCommand({
      repo: fixture.repo,
      source: fixture.repo,
      apply: true,
      agent: "claude",
      model: fixture.model,
      workspace: fixture.workspace,
      agentWorktreeRoot: path.join(fixture.root, "second-attempt-after-discard"),
      now: new Date(fixture.now.getTime() + 1000),
      tmux: new FakeTmux()
    });

    expect(result.data.nextWorktree?.path).not.toBe(worktreePath);
    expect(existsSync(result.data.nextWorktree!.path)).toBe(true);
  });

  it("lets prepareSession (the automated launch path) past a different Action's handoff only once its worktree is discarded, and closes that handoff", () => {
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
      reconcileSessionExit({ db, sessionId, requestId: "resume-697", repoRoot: fixture.repo })
    );
    // The two-action rehearsal's shape: the handoff belongs to an Action the
    // Plan has since retired, and the live pointer names a replacement.
    withDatabase(fixture.workspace, (db) =>
      db.prepare("UPDATE agent_sessions SET action_id = 'retired-contract' WHERE id = ?").run(sessionId)
    );

    const dispatch = resolveProjectTransition({ repoRoot: fixture.repo, projectSlug: "test-project", db: undefined }).dispatch;
    const baseRevision = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const prepare = (suffix: string) => {
      const nextWorktree = path.join(fixture.root, suffix);
      git(fixture.repo, ["worktree", "add", "-b", `claude/${suffix}`, nextWorktree, "HEAD"]);
      return withDatabase(fixture.workspace, (db) => prepareSession({
        db, workspace: fixture.workspace, repoRoot: fixture.repo, dispatch,
        agent: "claude", model: fixture.model, effort: "high", baseRevision,
        branch: `claude/${suffix}`, worktreePath: nextWorktree, now: new Date(), tmux: new FakeTmux()
      }));
    };

    // Still on disk: it may hold real work, so it keeps blocking.
    expect(() => prepare("while-candidate-exists")).toThrow(/different Action/);

    git(fixture.repo, ["worktree", "remove", "--force", worktreePath]);
    git(fixture.repo, ["branch", "-D", branch]);

    const prepared = prepare("after-discard");
    expect(prepared.action_id).toBe("define-contract");
    const receipt = withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, sessionId));
    expect(receipt?.superseded_by_session_id).toBe(prepared.id);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getResumableLeaseHandoff(db, fixture.repo))).toBeNull();
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

// Completion regressions exercise the canonical launch directly in temporary
// repositories, without invoking the sandbox-protected Go handoff command.
function launchCompletionFixture(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux) {
  const profiles: CodingAgentProfile[] = [{ name: "claude_build", provider: "claude-code-cli", package: "@anthropic-ai/claude-code", command: "claude", purpose: "build", sandbox: "workspace-write", args: [] }];
  const session = withDatabase(fixture.workspace, (db) => {
    const input = { db, workspace: fixture.workspace, repoRoot: fixture.repo, projectSlug: "test-project", requestId: "completion-launch", profiles, adapters: defaultAdapters as ProviderAdapterRegistry, now: fixture.now, tmux };
    const preview = buildLaunchPreview(input);
    return launchGuardedHostSession({ ...input, previewFingerprint: preview.previewFingerprint, agentWorktreeRoot: path.join(fixture.root, "completion-launch") }).session;
  });
  return { data: { session } };
}

function preparedFixture(options: { responsibility?: string; acceptanceCriteria?: string[]; nextAction?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-reconcile-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  let fixturePlan = options.responsibility ? planDocument.replace("responsibility: codex", `responsibility: ${options.responsibility}`) : planDocument;
  if (options.acceptanceCriteria) {
    fixturePlan = fixturePlan.replace("      - The contract exists.", options.acceptanceCriteria.map((criterion) => `      - ${criterion}`).join("\n"));
  }
  if (options.nextAction) fixturePlan = fixturePlan.replace("\n---\n", `
  - id: next-contract
    title: Define the next contract
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Define the next contract.
    expected_artifact: next.md
    acceptance_criteria:
      - The next contract exists.
    decisions: ["0001"]
---
`);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), fixturePlan);
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
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: ["node -e \"process.exit(0)\""] });
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

/** All a sandboxed agent can do: draft its `complete` Ask as compact JSON in the worktree, uncommitted. */
function draftCompleteInWorktree(worktreePath: string, criterion: string): void {
  mkdirSync(path.join(worktreePath, ".arcadia", "asks"), { recursive: true });
  writeFileSync(path.join(worktreePath, ".arcadia", "asks", "agent-ask-complete-define-contract.yaml"), `${JSON.stringify({
    agent_ask: "v1", request_id: "complete-define-contract", project: "test-project", intent: "complete",
    target_ref: "action/define-contract", desired_result: "Record define-contract complete.",
    candidate_revision: git(worktreePath, ["rev-parse", "HEAD"]).trim(),
    evidence: [{ criterion, status: "met", note: "contract.md" }],
    requested_authority: "apply_if_approved"
  })}\n`);
}

/** What the Action brief tells an agent to do last: settle `complete` from inside its candidate. */
function settleCompleteFromWorktree(fixture: ReturnType<typeof preparedFixture>, worktreePath: string, requestId: string, criterion = "The contract exists."): void {
  const request = JSON.stringify({
    agent_ask: "v1", request_id: requestId, project: "test-project", intent: "complete",
    target_ref: "action/define-contract", desired_result: "Record define-contract complete.",
    candidate_revision: git(worktreePath, ["rev-parse", "HEAD"]).trim(),
    evidence: [{ criterion, status: "met", note: "contract.md" }],
    requested_authority: "apply_if_approved"
  });
  withDatabase(fixture.workspace, (db) => {
    const proposal = previewAgentAskRequest(db, { request, requestId, project: "test-project" });
    const preview = settleAgentAsk(db, { proposalRef: proposal.proposal.id, settlementRequestId: requestId, disposition: "accepted", cwd: worktreePath });
    settleAgentAsk(db, {
      proposalRef: proposal.proposal.id, settlementRequestId: requestId, disposition: "accepted",
      previewFingerprint: preview.previewFingerprint, apply: true, cwd: worktreePath
    });
  });
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
    expected_artifact: contract.md
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
