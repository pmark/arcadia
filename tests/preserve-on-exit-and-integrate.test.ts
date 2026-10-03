import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { preservationGitTimeout, validationError } from "../src/cli/errors.js";
import { runProductionPreviewCommand } from "../src/commands/production.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createReviewItem,
  getProjectBySlug,
  getWorkItemByDocRef,
  upsertProject,
  upsertProjectMetadata,
  updateReviewItemStatus
} from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { activateProduction, deactivateProduction, fingerprintProductionScope, normalizeIntegrationGrant, normalizeProductionScope, type ProductionScope } from "../src/production/policy.js";
import { integrateSessionCandidate, preserveSessionCandidate } from "../src/production/sessionHandoff.js";
import { runManagedProductionTick } from "../src/production/tick.js";
import { snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { getRepositoryLease, getSession, type TmuxAdapter } from "../src/sessions/index.js";
import { beginIndependentVerdict, finishIndependentVerdict } from "../src/sessions/roleLineage.js";
import { preserveCandidate } from "../src/sessions/candidatePreservation.js";
import {
  getPreservationIndexLockAttempts, getPreservationTimeoutAttempts, guardPreservationTimeouts,
  MAX_IDENTICAL_PRESERVATION_REFUSALS, MAX_IDENTICAL_PRESERVATION_TIMEOUTS
} from "../src/sessions/preservationRefusalBudget.js";
import { preservationIndexLocked, preservationIndexLockMalformed } from "../src/sessions/preservationStages.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const profiles: CodingAgentProfile[] = [profile("claude_build", "claude-code-cli")];
const adapters = defaultAdapters as ProviderAdapterRegistry;

class FakeTmux implements TmuxAdapter {
  isAvailable = true;
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() {
    return this.isAvailable;
  }
  hasSession(name: string) {
    return this.live.has(name);
  }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    this.launches.push(input);
    this.live.add(input.name);
  }
}

function scopeWith(grant: ProductionScope["integrationGrant"]): ProductionScope {
  return normalizeProductionScope({
    intent: "Preserve and integrate a finished Session candidate.",
    projects: ["test-project"],
    plans: ["test-project/copy-proof"],
    actions: ["test-project/define-contract", "test-project/second-action"],
    providers: ["claude-code-cli"],
    maxConcurrentSessions: 10,
    mechanicalTransitions: ["validation", "acceptance", "pointer"],
    ...(grant ? { integrationGrant: grant } : {})
  });
}

function activatePolicy(fixture: Fixture, scope: ProductionScope, requestId = "policy-grant-1") {
  return withDatabase(fixture.workspace, (db) =>
    activateProduction(db, { requestId, scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" })
  );
}

function provenCapacity(): CapacityAdmissionDecision {
  return {
    providerId: "claude-code-cli",
    admitted: true,
    code: null,
    reason: "claude-code-cli reported included allowance.",
    unattendedProof: true,
    retryAfter: null,
    refreshRequired: false,
    receipt: {
      version: 1, providerId: "claude-code-cli", providerLabel: "claude-code-cli", profiles: [],
      accountScope: "test", source: "codex_app_server", evidence: "simulated", unattended: true,
      observedAt: "2026-08-30T12:00:00.000Z", observedAgeMs: 0, expiresAt: null, confidence: "observed",
      freshness: "fresh", usagePolicy: "included", usagePolicyReason: "test fixture",
      windows: [{ label: "5h", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
      nextResetAt: null, unsupported: [], availability: "available", telemetry: "test fixture"
    }
  };
}

function fixtureCapacityObservation(): ProviderCapacityObservation {
  return { generatedAt: "2026-08-30T12:34:56.000Z", providers: [provenCapacity()] };
}

/** A validator stand-in for the Seatbelt producer: real fingerprint, injected pass/fail. */
function fixtureValidator(passed = true) {
  return (_db: Database.Database, _workspace: string, lease: { id: string; worktree_path: string }) => {
    if (!passed) throw validationError("Declared preservation validation failed (fixture).");
    return { passed: true, evidenceRef: `fixture:${lease.id}`, candidateFingerprint: snapshotCandidate(lease.worktree_path), binding: {} };
  };
}

function launchFirstSession(fixture: Fixture, tmux: FakeTmux) {
  const result = withDatabase(fixture.workspace, (db) =>
    runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: fixture.now,
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
    })
  );
  expect(result.projects[0]?.launch?.outcome).toBe("launched");
  return withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
}

function finishCandidate(fixture: Fixture, tmux: FakeTmux, session: { worktree_path: string; work_item_id: string; tmux_session_name: string }) {
  writeFileSync(path.join(session.worktree_path, "docs", "contract.md"), "# Contract\n\nBounded and real.\n");
  mkdirSync(path.join(session.worktree_path, ".arcadia", "asks"), { recursive: true });
  writeFileSync(path.join(session.worktree_path, ".arcadia", "asks", "agent-ask-complete-define-contract.yaml"), JSON.stringify({
    agent_ask: "v1", request_id: "complete-define-contract", project: "test-project", intent: "complete",
    target_ref: "action/define-contract", desired_result: "Record criterion-level completion.",
    candidate_revision: git(session.worktree_path, ["rev-parse", "HEAD"]).trim(),
    evidence: [{ criterion: "The contract exists.", status: "met", note: "docs/contract.md was produced." }],
    requested_authority: "apply_if_approved"
  }) + "\n");
  git(session.worktree_path, ["add", "."]);
  git(session.worktree_path, ["commit", "-m", "complete define-contract"]);
  withDatabase(fixture.workspace, (db) => {
    db.prepare(
      `INSERT INTO execution_runs (id, work_item_id, plan_id, status, executor_name, pid, summary, created_at, updated_at)
       VALUES (?, ?, NULL, 'completed', 'claude', NULL, 'Fixture passing run.', ?, ?)`
    ).run("run-" + Math.random().toString(36).slice(2), session.work_item_id, "2026-08-30T12:00:00.000Z", "2026-08-30T12:00:00.000Z");
  });
  tmux.live.delete(session.tmux_session_name);
}

/**
 * An independent reviewer, separate from the developer Session, recording an
 * exact-head code review and QA verdict through the host seam. The exit tick
 * must have preserved the candidate first: readiness refuses before that.
 */
function reviewIndependently(fixture: Fixture, sessionId: string, verdict: "passed" | "failed" = "passed") {
  withDatabase(fixture.workspace, (db) => {
    const session = getSession(db, sessionId)!;
    for (const role of ["code-review", "qa"] as const) {
      const requestId = `${role}-fixture-${sessionId.replaceAll("_", "-")}-${Math.random().toString(36).slice(2, 8)}`;
      const actorId = `${role}-reviewer:fixture`;
      beginIndependentVerdict(db, { role, session, repoRoot: fixture.repo, requestId, actorId, executionCwd: fixture.workspace, now: fixture.now });
      finishIndependentVerdict(db, { requestId, actorId, session, repoRoot: fixture.repo, verdict, receipt: { reviewer: actorId }, now: fixture.now });
    }
  });
}

function interruptedHandoff(expiresAt = "2099-01-01T00:00:00.000Z") {
  const fixture = preparedFixture();
  const tmux = new FakeTmux();
  activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt, actions: [] }));
  const session = launchFirstSession(fixture, tmux);
  finishCandidate(fixture, tmux, session);
  const baseBefore = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
  const first = withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
    profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 30_000),
    capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
    handoff: { preserve: { validate: fixtureValidator(true) } }
  }));
  expect(first.projects[0]?.reconciled[0]?.outcome).toBe("accepted_completion");
  expect(first.projects[0]?.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/current independent verdicts/) });
  reviewIndependently(fixture, session.id);
  const interrupted = withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
    profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
    capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
    handoff: { integrate: { fastForward: () => {
      throw new Error("injected interruption before integration");
    } } }
  }));
  expect(interrupted.projects[0]?.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/injected interruption/) });
  expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
  return { fixture, tmux, session, baseBefore };
}

function retryHandoff(fixture: Fixture, tmux: FakeTmux, validationPassed = true) {
  return withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
    profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 120_000),
    capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
    handoff: { preserve: { validate: fixtureValidator(validationPassed) },
      integrate: { fastForward: ({ repoRoot, commitSha }) => git(repoRoot, ["merge", "--ff-only", commitSha]) } }
  })).projects[0];
}

function completedWhileOff() {
  const fixture = preparedFixture();
  const tmux = new FakeTmux();
  activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
  const session = launchFirstSession(fixture, tmux);
  finishCandidate(fixture, tmux, session);
  const baseBefore = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
  withDatabase(fixture.workspace, (db) => deactivateProduction(db, {
    requestId: "off-before-terminal-preservation", now: new Date(fixture.now.getTime() + 30_000)
  }));
  const offTick = withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
    profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
    capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
    handoff: { preserve: { validate: fixtureValidator(true) } }
  }));
  expect(offTick.projects[0]?.reconciled[0]?.outcome).toBe("accepted_completion");
  expect(offTick.projects[0]?.handoff?.preservation.kind).toBe("refused");
  expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
  return { fixture, tmux, session, baseBefore };
}

describe("preserve-on-exit and integrate", () => {
  it("validates and preserves an Off-completed terminal candidate only after a fresh exact Grant, then integrates it once", () => {
    const { fixture, tmux, session, baseBefore } = completedWhileOff();
    const stillOff = retryHandoff(fixture, tmux);
    expect(stillOff.handoff?.integration.kind).toBe("refused");
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }), "fresh-terminal-grant");
    const preservedOnly = retryHandoff(fixture, tmux);
    expect(preservedOnly.handoff?.preservation.kind).toBe("preserved");
    expect(preservedOnly.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/current independent verdicts/) });
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
    reviewIndependently(fixture, session.id);
    const recovered = retryHandoff(fixture, tmux);
    expect(recovered.handoff?.preservation.kind).toBe("preserved");
    expect(recovered.handoff?.integration.kind).toBe("integrated");
    expect(recovered.launch?.actionKey).toBe("test-project/second-action");
    expect(tmux.launches).toHaveLength(2);
    const receipt = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare(
      "SELECT receipt_json FROM candidate_preservation_receipts WHERE request_id = ?"
    ).get(`worker-tick-preserve-${session.id}`) as { receipt_json: string } | undefined);
    expect(receipt).toBeDefined();
    expect(JSON.parse(receipt!.receipt_json)).toMatchObject({ terminalSessionId: session.id });
    const integratedHead = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    expect(retryHandoff(fixture, tmux).handoff).toBeNull();
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(integratedHead);
    expect(tmux.launches).toHaveLength(2);
  });

  it("refuses an Off-completed candidate if host validation fails or the candidate changed", () => {
    const failed = completedWhileOff();
    activatePolicy(failed.fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }), "fresh-failed-validation");
    const validation = withDatabase(failed.fixture.workspace, (db) => runManagedProductionTick(db, failed.fixture.workspace, {
      profiles, adapters, tmux: failed.tmux, now: new Date(failed.fixture.now.getTime() + 120_000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: failed.fixture.agentWorktreeRoot,
      handoff: { preserve: { validate: fixtureValidator(false) } }
    })).projects[0];
    expect(validation.handoff?.integration.kind).toBe("refused");
    expect(git(failed.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(failed.baseBefore);
    expect(failed.tmux.launches).toHaveLength(1);

    const changed = completedWhileOff();
    activatePolicy(changed.fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }), "fresh-changed-candidate");
    writeFileSync(path.join(changed.session.worktree_path, "CHANGED.md"), "after terminal settlement\n");
    git(changed.session.worktree_path, ["add", "CHANGED.md"]);
    git(changed.session.worktree_path, ["commit", "-m", "change terminal candidate"]);
    const drift = retryHandoff(changed.fixture, changed.tmux);
    expect(drift.handoff?.integration.kind).toBe("refused");
    expect(git(changed.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(changed.baseBefore);
    expect(changed.tmux.launches).toHaveLength(1);
  });

  it("refuses terminal preservation before committing when the validated tree differs from the settlement tree", () => {
    const { fixture, tmux, session, baseBefore } = completedWhileOff();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }), "fresh-dirty-candidate");
    const terminalHead = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    writeFileSync(path.join(session.worktree_path, "CHANGED.md"), "uncommitted after settlement\n");
    const retry = retryHandoff(fixture, tmux);
    expect(retry.handoff?.integration.kind).toBe("refused");
    expect(git(session.worktree_path, ["rev-parse", "HEAD"]).trim()).toBe(terminalHead);
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
    expect(tmux.launches).toHaveLength(1);
  });

  it("refuses unpreserved terminal recovery when the fresh Grant expires or narrows", () => {
    const expired = completedWhileOff();
    activatePolicy(expired.fixture, scopeWith({ decisionRef: "0058", expiresAt: new Date(expired.fixture.now.getTime() + 90_000).toISOString(), actions: [] }), "expired-terminal-grant");
    expect(retryHandoff(expired.fixture, expired.tmux).handoff?.integration.kind).toBe("refused");
    expect(git(expired.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(expired.baseBefore);

    const narrowed = completedWhileOff();
    const scope = normalizeProductionScope({
      intent: "Only the dependent Action remains in scope.", projects: ["test-project"], plans: ["test-project/copy-proof"],
      actions: ["test-project/second-action"], providers: ["claude-code-cli"], maxConcurrentSessions: 1,
      mechanicalTransitions: ["validation", "acceptance", "pointer"],
      integrationGrant: { decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: ["test-project/second-action"] }
    });
    activatePolicy(narrowed.fixture, scope, "narrowed-terminal-grant");
    expect(retryHandoff(narrowed.fixture, narrowed.tmux).handoff?.integration.kind).toBe("refused");
    expect(git(narrowed.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(narrowed.baseBefore);
  });

  it("refuses an unpreserved terminal candidate after its base diverges", () => {
    const { fixture, tmux } = completedWhileOff();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }), "fresh-divergent-grant");
    writeFileSync(path.join(fixture.repo, "DIVERGED.md"), "base changed independently\n");
    git(fixture.repo, ["add", "DIVERGED.md"]);
    git(fixture.repo, ["commit", "-m", "diverge before terminal recovery"]);
    const divergentHead = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    expect(retryHandoff(fixture, tmux).handoff?.integration.kind).toBe("refused");
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(divergentHead);
    expect(tmux.launches).toHaveLength(1);
  });
  it("recovers an unchanged completed candidate after an interrupted integration without another Session", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);
    let integrations = 0;
    const exited = withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 30_000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
      handoff: { preserve: { validate: fixtureValidator(true) }, integrate: { fastForward: () => { integrations += 1; } } }
    }));
    expect(exited.projects[0]?.reconciled[0]?.outcome).toBe("accepted_completion");
    // No verdicts yet: the integration primitive is never reached.
    expect(exited.projects[0]?.handoff?.integration.kind).toBe("refused");
    expect(integrations).toBe(0);
    reviewIndependently(fixture, session.id);
    const first = withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
      handoff: { integrate: { fastForward: () => {
        integrations += 1;
        throw new Error("injected interruption before integration");
      } } }
    }));
    expect(first.projects[0]?.handoff?.integration.kind).toBe("refused");
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
    expect(integrations).toBe(1);
    const retry = withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 120_000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
      handoff: { integrate: { fastForward: ({ repoRoot, commitSha }) => {
        integrations += 1;
        git(repoRoot, ["merge", "--ff-only", commitSha]);
      } } }
    }));
    expect(retry.projects[0]?.handoff?.integration.kind).toBe("integrated");
    expect(integrations).toBe(2);
    expect(retry.projects[0]?.launch?.actionKey).toBe("test-project/second-action");
    expect(tmux.launches).toHaveLength(2);
    const baseAfter = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const repeat = retryHandoff(fixture, tmux);
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseAfter);
    expect(repeat.handoff).toBeNull();
    expect(tmux.launches).toHaveLength(2);
  });

  it("refuses terminal recovery while production is Off", () => {
    const { fixture, tmux, baseBefore } = interruptedHandoff();
    withDatabase(fixture.workspace, (db) => deactivateProduction(db, { requestId: "off-before-recovery", now: new Date(fixture.now.getTime() + 90_000) }));
    const retry = retryHandoff(fixture, tmux);
    expect(retry.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/Inactive/) });
    expect(retry.launch).toBeNull();
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
    expect(tmux.launches).toHaveLength(1);
  });

  it("refuses terminal recovery after the exact Grant expires or its Action scope drifts", () => {
    const expiring = interruptedHandoff(new Date(Date.parse("2026-08-30T12:34:56.000Z") + 90_000).toISOString());
    const expired = retryHandoff(expiring.fixture, expiring.tmux);
    expect(expired.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/expired/) });
    expect(git(expiring.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(expiring.baseBefore);

    const drifted = interruptedHandoff();
    withDatabase(drifted.fixture.workspace, (db) => {
      deactivateProduction(db, { requestId: "off-before-scope-drift", now: new Date(drifted.fixture.now.getTime() + 90_000) });
    });
    const narrowed = normalizeProductionScope({
      intent: "Only the dependent Action remains in scope.", projects: ["test-project"], plans: ["test-project/copy-proof"],
      actions: ["test-project/second-action"], providers: ["claude-code-cli"], maxConcurrentSessions: 1,
      mechanicalTransitions: ["validation", "acceptance", "pointer"],
      integrationGrant: { decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: ["test-project/second-action"] }
    });
    activatePolicy(drifted.fixture, narrowed, "narrowed-grant");
    const refused = retryHandoff(drifted.fixture, drifted.tmux);
    expect(refused.handoff?.integration.kind).toBe("refused");
    expect(git(drifted.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(drifted.baseBefore);
    expect(drifted.tmux.launches).toHaveLength(1);
  });

  it("refuses recovery without a preservation receipt when renewed host validation fails", () => {
    const { fixture, tmux, session, baseBefore } = interruptedHandoff();
    withDatabase(fixture.workspace, (db) => db.prepare("DELETE FROM candidate_preservation_receipts WHERE request_id = ?")
      .run(`worker-tick-preserve-${session.id}`));
    const retry = retryHandoff(fixture, tmux, false);
    expect(retry.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/validation/i) });
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
    expect(tmux.launches).toHaveLength(1);
  });

  it("refuses a changed candidate HEAD or branch after terminal completion", () => {
    const changed = interruptedHandoff();
    writeFileSync(path.join(changed.session.worktree_path, "CHANGED.md"), "after settlement\n");
    git(changed.session.worktree_path, ["add", "CHANGED.md"]);
    git(changed.session.worktree_path, ["commit", "-m", "change completed candidate"]);
    const changedRetry = retryHandoff(changed.fixture, changed.tmux);
    expect(changedRetry.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/differs.*settlement/) });
    expect(git(changed.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(changed.baseBefore);

    const switched = interruptedHandoff();
    git(switched.session.worktree_path, ["switch", "-c", "codex/changed-candidate-branch"]);
    const switchedRetry = retryHandoff(switched.fixture, switched.tmux);
    expect(switchedRetry.handoff?.integration.kind).toBe("refused");
    expect(git(switched.fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(switched.baseBefore);
  });

  it("refuses recovery when the governed base diverges after settlement", () => {
    const { fixture, tmux } = interruptedHandoff();
    writeFileSync(path.join(fixture.repo, "DIVERGED.md"), "separate base work\n");
    git(fixture.repo, ["add", "DIVERGED.md"]);
    git(fixture.repo, ["commit", "-m", "diverge base"]);
    const baseAfter = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const retry = retryHandoff(fixture, tmux);
    expect(retry.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/cannot fast-forward/) });
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseAfter);
    expect(tmux.launches).toHaveLength(1);
  });

  it("preserves and completes on exit, then integrates under a valid grant once independent verdicts are current and admits the next Action in that tick", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);
    const baseBefore = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const exited = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 30_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        handoff: { preserve: { validate: fixtureValidator(true) } }
      })
    ).projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(exited.handoff?.preservation.kind).toBe("preserved");
    expect(exited.reconciled[0]?.outcome).toBe("accepted_completion");
    expect(exited.handoff?.integration).toMatchObject({ kind: "refused", reason: expect.stringMatching(/current independent verdicts/) });
    expect(exited.launch?.outcome).not.toBe("launched");
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);

    reviewIndependently(fixture, session.id);
    const second = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const project = second.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.handoff?.integration).toMatchObject({ kind: "integrated", baseBranch: "main" });
    expect(project.launch?.outcome).toBe("launched");
    expect(project.launch?.actionKey).toBe("test-project/second-action");

    // The governed base branch now carries the candidate's own commit.
    const base = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    expect(base).not.toBe(baseBefore);
    expect(git(fixture.repo, ["log", "--format=%s", "-n", "5"])).toContain("complete define-contract");
    expect(existsSync(path.join(fixture.repo, "docs", "contract.md"))).toBe(true);
  });

  it("preserves but stops before integration when no grant is recorded, reporting the operator merge command", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith(undefined));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);
    const baseBefore = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const second = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        handoff: { preserve: { validate: fixtureValidator(true) } }
      })
    );
    const project = second.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.handoff?.preservation.kind).toBe("preserved");
    expect(project.handoff?.integration.kind).toBe("refused");
    expect((project.handoff?.integration as { operatorMergeCommand: string }).operatorMergeCommand).toContain("merge --ff-only");
    expect(project.launch?.outcome).toBe("skipped");
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
    expect(existsSync(session.worktree_path)).toBe(true);
  });

  it("preserves but refuses integration when reconciliation does not complete the Action", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    // A committed candidate with no passing Run reconciles as incomplete_resumable,
    // so no governed completion settles and nothing may be integrated.
    writeFileSync(path.join(session.worktree_path, "docs", "contract.md"), "# Contract\n\nUnproven.\n");
    git(session.worktree_path, ["add", "."]);
    git(session.worktree_path, ["commit", "-m", "unproven candidate"]);
    tmux.live.delete(session.tmux_session_name);
    const baseBefore = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const second = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        handoff: { preserve: { validate: fixtureValidator(true) } }
      })
    );
    const project = second.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.handoff?.preservation.kind).toBe("preserved");
    expect(project.handoff?.integration.kind).toBe("refused");
    expect((project.handoff?.integration as { reason: string }).reason).toMatch(/governed completion/);
    expect(project.reconciled[0]?.outcome).toBe("incomplete_resumable");
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
  });

  it("refuses an expired grant and leaves every candidate file in place", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2020-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);
    const baseBefore = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const result = withDatabase(fixture.workspace, (db) =>
      integrateSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now })
    );
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/expired/i);
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseBefore);
    expect(existsSync(path.join(session.worktree_path, "docs", "contract.md"))).toBe(true);
  });

  it("refuses a grant that does not name this Action", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: ["test-project/second-action"] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);

    const result = withDatabase(fixture.workspace, (db) =>
      integrateSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now })
    );
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toContain("does not name test-project/define-contract");
  });

  it("refuses a divergent base and preserves all work", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);

    // Move the governed base independently so neither branch contains the other.
    writeFileSync(path.join(fixture.repo, "docs", "contract.md"), "# Contract\n\nA different, conflicting definition.\n");
    git(fixture.repo, ["add", "."]);
    git(fixture.repo, ["commit", "-m", "conflicting base move"]);
    const baseHead = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const result = withDatabase(fixture.workspace, (db) =>
      integrateSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now })
    );
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/cannot fast-forward/i);
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseHead);
    expect(existsSync(session.worktree_path)).toBe(true);
  });

  it("reports an already-integrated candidate as such and never duplicates the merge", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);

    const first = withDatabase(fixture.workspace, (db) =>
      integrateSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now })
    );
    expect(first.kind).toBe("integrated");
    const baseAfter = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const second = withDatabase(fixture.workspace, (db) =>
      integrateSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now })
    );
    expect(second.kind).toBe("already_integrated");
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(baseAfter);
  });

  it("replays an already-preserved candidate instead of committing it twice", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);
    const validate = fixtureValidator(true);

    const first = withDatabase(fixture.workspace, (db) =>
      preserveSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now }, { validate })
    );
    const second = withDatabase(fixture.workspace, (db) =>
      preserveSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now }, { validate })
    );
    expect(first.kind).toBe("preserved");
    expect(second).toMatchObject({ kind: "preserved", replayed: true });
    expect((second as { commitSha: string }).commitSha).toBe((first as { commitSha: string }).commitSha);
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT COUNT(*) AS n FROM candidate_preservation_receipts").get()
    )).toEqual({ n: 1 });
  });

  it("refuses to preserve when host-side validation fails, and keeps the candidate", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);

    const result = withDatabase(fixture.workspace, (db) =>
      preserveSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now }, { validate: fixtureValidator(false) })
    );
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/failed/i);
    expect(existsSync(session.worktree_path)).toBe(true);
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT COUNT(*) AS n FROM candidate_preservation_receipts").get()
    )).toEqual({ n: 0 });
  });

  it("bounds a Session's identical preservation refusals across ticks and reconciles it as a non-resumable incomplete exit", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    writeFileSync(path.join(session.worktree_path, "docs", "contract.md"), "# Contract\n\nUnproven.\n");
    git(session.worktree_path, ["add", "."]);
    git(session.worktree_path, ["commit", "-m", "unproven candidate"]);
    tmux.live.delete(session.tmux_session_name);

    // Simulate the agent itself having already retried `arcadia preserve`
    // from inside the Session before its tmux died: every attempt refuses for
    // the same fixture reason, so this pre-loads the identical-refusal budget
    // to one short of its limit.
    withDatabase(fixture.workspace, (db) => {
      for (let attempt = 1; attempt < MAX_IDENTICAL_PRESERVATION_REFUSALS; attempt++) {
        const step = preserveSessionCandidate(
          { db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now },
          { validate: fixtureValidator(false) }
        );
        expect(step).toMatchObject({ kind: "refused", identicalRefusalLimitReached: false });
      }
    });

    // The tick's own attempt is the one that exhausts the budget: the
    // preservation step reports the limit reached, and the Session is
    // reconciled as `incomplete_resumable` but not offered for automatic
    // resumption, so a future tick cannot launch a fresh Session into the
    // same failure forever.
    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        handoff: { preserve: { validate: fixtureValidator(false) } }
      })
    );
    const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.handoff?.preservation).toMatchObject({ kind: "refused", identicalRefusalLimitReached: true });
    expect(project.reconciled[0]?.outcome).toBe("incomplete_resumable");
    const receipt = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT lease_handoff FROM session_exit_receipts WHERE session_id = ?").get(session.id)
    ) as { lease_handoff: number };
    expect(receipt.lease_handoff).toBe(0);
  });

  it("shares one timeout budget with the CLI, counts index_locked separately, and a managed success clears both", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);
    const candidateHead = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    const indexBefore = candidateIndex(session.worktree_path);
    let failWith: (() => Error) | null = managedTimeout;
    const preserve: typeof preserveCandidate = (...args) => {
      if (failWith) throw failWith();
      return preserveCandidate(...args);
    };
    const attempt = () => withDatabase(fixture.workspace, (db) =>
      preserveSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now },
        { validate: fixtureValidator(true), preserve }));
    const counts = () => withDatabase(fixture.workspace, (db) => ({
      timeouts: getPreservationTimeoutAttempts(db, session.id), locks: getPreservationIndexLockAttempts(db, session.id)
    }));

    // The CLI broker has already timed out once for this Session id.
    withDatabase(fixture.workspace, (db) => {
      expect(() => guardPreservationTimeouts(db, session.id, fixture.now, () => { throw managedTimeout(); })).toThrow(/preservation budget/);
    });
    expect(counts()).toEqual({ timeouts: 1, locks: 0 });

    // A managed timeout counts against the same budget.
    expect(attempt()).toMatchObject({ kind: "refused", identicalRefusalLimitReached: false });
    expect(counts()).toEqual({ timeouts: 2, locks: 0 });
    // A managed index_locked refusal is counted on its own budget.
    failWith = () => preservationIndexLocked(path.join(session.worktree_path, ".git", "index.lock"), 10);
    expect(attempt()).toMatchObject({ kind: "refused", identicalRefusalLimitReached: false });
    expect(counts()).toEqual({ timeouts: 2, locks: 1 });
    // Neither refusal touched the candidate.
    expect(git(session.worktree_path, ["rev-parse", "HEAD"]).trim()).toBe(candidateHead);
    expect(candidateIndex(session.worktree_path)).toBe(indexBefore);

    // A successful managed preservation clears timeout:<session.id> and the lock count.
    failWith = null;
    expect(attempt()).toMatchObject({ kind: "preserved" });
    expect(counts()).toEqual({ timeouts: 0, locks: 0 });

    // So the next timeout is the first consecutive one again.
    failWith = managedTimeout;
    expect(attempt()).toMatchObject({ kind: "refused", identicalRefusalLimitReached: false });
    expect(counts()).toEqual({ timeouts: 1, locks: 0 });
  });

  it("stops automatic retries after ten identical timeouts across CLI and managed attempts, retaining the candidate and its receipts", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    writeFileSync(path.join(session.worktree_path, "docs", "contract.md"), "# Contract\n\nTimed out.\n");
    git(session.worktree_path, ["add", "."]);
    git(session.worktree_path, ["commit", "-m", "candidate that keeps timing out"]);
    writeFileSync(path.join(session.worktree_path, "docs", "pending.md"), "uncommitted candidate work\n");
    tmux.live.delete(session.tmux_session_name);
    const candidateHead = git(session.worktree_path, ["rev-parse", "HEAD"]).trim();
    const indexBefore = candidateIndex(session.worktree_path);
    const statusBefore = git(session.worktree_path, ["status", "--porcelain"]);
    const preserve: typeof preserveCandidate = () => { throw managedTimeout(); };

    withDatabase(fixture.workspace, (db) => {
      for (let attempt = 1; attempt < MAX_IDENTICAL_PRESERVATION_TIMEOUTS; attempt += 1) {
        if (attempt % 2) {
          expect(() => guardPreservationTimeouts(db, session.id, fixture.now, () => { throw managedTimeout(); })).toThrow(/preservation budget/);
        } else {
          expect(preserveSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now },
            { validate: fixtureValidator(true), preserve })).toMatchObject({ kind: "refused", identicalRefusalLimitReached: false });
        }
        expect(getPreservationTimeoutAttempts(db, session.id)).toBe(attempt);
      }
    });

    // The tick's own attempt is the tenth identical timeout: it stops.
    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        handoff: { preserve: { validate: fixtureValidator(true), preserve } }
      })
    );
    const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.handoff?.preservation).toMatchObject({ kind: "refused", identicalRefusalLimitReached: true,
      detail: { identicalTimeoutLimitReached: true, retryable: false, attempts: MAX_IDENTICAL_PRESERVATION_TIMEOUTS, stage: "preserve.commit" } });
    expect(project.reconciled[0]?.outcome).toBe("incomplete_resumable");
    const exitReceipt = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT session_id, outcome, candidate_revision, lease_handoff FROM session_exit_receipts WHERE session_id = ?").get(session.id)
    ) as { session_id: string; outcome: string; candidate_revision: string; lease_handoff: number };
    expect(exitReceipt).toMatchObject({ outcome: "incomplete_resumable", lease_handoff: 0 });
    const budgetRows = withDatabase(fixture.workspace, (db) => {
      expect(getPreservationTimeoutAttempts(db, session.id)).toBe(MAX_IDENTICAL_PRESERVATION_TIMEOUTS);
      return db.prepare("SELECT subject_id, attempts, last_reason FROM preservation_refusal_attempts ORDER BY subject_id").all();
    });

    // The original candidate commit, index and uncommitted work are untouched.
    expect(git(session.worktree_path, ["rev-parse", "HEAD"]).trim()).toBe(candidateHead);
    expect(git(fixture.repo, ["rev-parse", `refs/heads/${session.branch}`]).trim()).toBe(candidateHead);
    expect(candidateIndex(session.worktree_path)).toBe(indexBefore);
    expect(git(session.worktree_path, ["status", "--porcelain"])).toBe(statusBefore);

    const receipts = {
      schema: "arcadia.evidence/managed-preservation-timeout-reset/v1",
      sessionId: session.id,
      handoff: project.handoff,
      reconciled: project.reconciled,
      exitReceipt,
      budgetRows,
      candidate: { head: candidateHead, branch: session.branch, status: statusBefore, indexUnchanged: true }
    };
    expect(receipts.budgetRows).toContainEqual(expect.objectContaining({ subject_id: `timeout:${session.id}`, attempts: MAX_IDENTICAL_PRESERVATION_TIMEOUTS }));
    if (process.env.ARCADIA_EVIDENCE_OUT) writeFileSync(process.env.ARCADIA_EVIDENCE_OUT, JSON.stringify(receipts, null, 2) + "\n");
  });

  it("withholds automatic resumption on a non-retryable malformed index lock through the real tick", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    writeFileSync(path.join(session.worktree_path, "docs", "contract.md"), "# Contract\n\nBlocked by a malformed lock.\n");
    git(session.worktree_path, ["add", "."]);
    git(session.worktree_path, ["commit", "-m", "candidate blocked by a malformed lock"]);
    tmux.live.delete(session.tmux_session_name);
    const preserve: typeof preserveCandidate = () => {
      throw preservationIndexLockMalformed(path.join(session.worktree_path, ".git", "index.lock"), "directory");
    };
    // The very first attempt: no budget is exhausted, yet a resumed Session
    // (a new id with a zero count) would only hit the same lock again.
    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        handoff: { preserve: { validate: fixtureValidator(true), preserve } }
      })
    );
    const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.handoff?.preservation).toMatchObject({ kind: "refused", identicalRefusalLimitReached: true,
      detail: { reason: "index_lock_malformed", retryable: false, lockKind: "directory" } });
    expect(project.reconciled[0]?.outcome).toBe("incomplete_resumable");
    const receipt = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT lease_handoff FROM session_exit_receipts WHERE session_id = ?").get(session.id)
    ) as { lease_handoff: number };
    expect(receipt.lease_handoff).toBe(0);
  });

  it("refuses to preserve when the Project declares no objective validation_commands", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);
    // The launch itself already refuses a Project with no declared
    // validation commands (see launch-preview.test.ts and packets.ts), so
    // this scenario -- a live candidate whose Project ends up with none --
    // can now only arise from an operator clearing them after a Session
    // already launched with some declared. Simulate exactly that, rather
    // than the no-longer-reachable "launched with none from the start".
    withDatabase(fixture.workspace, (db) => {
      const project = getProjectBySlug(db, "test-project")!;
      upsertProjectMetadata(db, { projectId: project.id, validationCommands: [] });
    });

    const result = withDatabase(fixture.workspace, (db) =>
      preserveSessionCandidate({ db, workspace: fixture.workspace, repoRoot: fixture.repo, session, now: fixture.now })
    );
    expect(result.kind).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/validation_commands/);
    expect(existsSync(session.worktree_path)).toBe(true);
  });
});

describe("candidate-integration grant", () => {
  it("round-trips a complete grant and refuses half of one", () => {
    expect(normalizeIntegrationGrant({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }))
      .toEqual({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] });
    expect(() => normalizeIntegrationGrant({ decisionRef: "0058", expiresAt: "", actions: [] })).toThrow(/expiry/);
    expect(() => normalizeIntegrationGrant({ decisionRef: "", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] })).toThrow(/Decision/);
  });

  it("changes the scope fingerprint only when a grant is actually present", () => {
    const without = scopeWith(undefined);
    const withGrant = scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] });
    expect(fingerprintProductionScope(without)).not.toBe(fingerprintProductionScope(withGrant));
    expect(fingerprintProductionScope(scopeWith(undefined))).toBe(fingerprintProductionScope(without));
  });

  it("records the grant through the operator preview surface and refuses half of one", () => {
    const fixture = preparedFixture();
    const response = runProductionPreviewCommand({
      workspace: fixture.workspace,
      project: ["test-project"],
      provider: ["claude-code-cli"],
      plan: ["test-project/copy-proof"],
      intent: "Integrate finished candidates without an operator merge.",
      integrationGrantDecision: "0058",
      integrationGrantExpiresAt: "2099-01-01T00:00:00.000Z"
    });
    expect(response.data.preview.scope.integrationGrant).toEqual({
      decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: []
    });
    expect(() =>
      runProductionPreviewCommand({
        workspace: fixture.workspace,
        project: ["test-project"],
        provider: ["claude-code-cli"],
        intent: "x",
        integrationGrantDecision: "0058"
      })
    ).toThrow(/integration-grant-expires-at/);
  });
});

// --- fixture -----------------------------------------------------------------
function preparedFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-integrate-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), planDocument);
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), decisionDocument);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);

  function preparePacket(db: Database.Database, actionId: string, projectId: string) {
    const packetId = `integrate_fixture_${actionId}`;
    const workItem = getWorkItemByDocRef(db, `plan/copy-proof#${actionId}`)!;
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    const baseRevision = git(repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(
      path.join(workspace, path.dirname(promptPath), "metadata.json"),
      JSON.stringify({
        invocationId: packetId, workItemId: workItem.id, promptPath, baseRevision,
        providerSelection: { provider: "claude-code-cli", model: "sonnet", mappingId: "fixture-map", bindingId: "fixture-binding" }
      })
    );
    createCodexInvocation(db, {
      id: packetId, purpose: "build", agentProfile: "claude_build", workspaceScope: repo, command: "claude",
      promptPath, jsonlOutputPath: `prompts/codex/${packetId}/output.jsonl`, finalMessagePath: `prompts/codex/${packetId}/final.md`,
      status: "packet_created", workItemId: workItem.id,
      executionProfileJson: JSON.stringify({ schema: "arcadia.execution/v1", profile: "routine_implementation" }),
      providerMappingId: "fixture-map", providerBindingId: "fixture-binding"
    });
    createReviewItem(db, {
      workItemId: workItem.id, projectId, codexInvocationId: packetId,
      decisionNeeded: "Approve the promoted build packet.", sourceInput: "fixture",
      proposedAction: "Launch the fixture Session.", resolvedIntent: "CodexPlanningArtifactAcceptance",
      confidenceLabel: "high", confidence: 1, missingFields: [],
      context: {
        planningPromotion: {
          actionId, actionDocRef: `plan/copy-proof#${actionId}`, repoPath: repo, buildProfile: "claude_build",
          buildInvocationId: packetId, buildPacketPath: promptPath, buildPacketSha256: packetSha256(path.join(workspace, promptPath))
        }
      }
    });
    const approvalId = db.prepare("SELECT id FROM review_items WHERE codex_invocation_id = ? ORDER BY created_at DESC LIMIT 1").get(packetId) as { id: string };
    updateReviewItemStatus(db, approvalId.id, { status: "approved", decisionNote: "Fixture authority approved." });
  }

  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Integrate a candidate.", goal: "Integrate a candidate.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: ["node -e \"process.exit(0)\""] });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    preparePacket(db, "define-contract", project.id);
    preparePacket(db, "second-action", project.id);
  });
  return { root, repo, workspace, now: new Date("2026-08-30T12:34:56.000Z"), agentWorktreeRoot: path.join(root, "agent-worktrees") };
}

type Fixture = ReturnType<typeof preparedFixture>;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** The candidate's real index bytes, read without refreshing its stat cache. */
function candidateIndex(worktree: string): string {
  return readFileSync(path.join(git(worktree, ["rev-parse", "--absolute-git-dir"]).trim(), "index")).toString("base64");
}

/** The typed retryable timeout a stalled preserve-stage Git call raises. */
function managedTimeout() {
  return preservationGitTimeout("git update-ref exceeded its 1 ms preservation budget at stage preserve.commit; retry the same protected launcher.", {
    reason: "timeout", command: "git", gitSubcommand: "update-ref", args: ["update-ref"], cwd: "/candidate", timeoutMs: 1,
    stage: "preserve.commit", remedy: "Retry the same fixed protected launcher unchanged."
  });
}

function profile(name: string, provider: string): CodingAgentProfile {
  return { name, provider, package: "@anthropic-ai/claude-code", command: "claude", purpose: "build", sandbox: "workspace-write", args: [] };
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Integrate a candidate.
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
milestone: Integrate a candidate
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
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Define the bounded contract.
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
    decisions: ["0001"]
  - id: second-action
    title: Second action
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Do the second thing.
    expected_artifact: docs/second.md
    acceptance_criteria:
      - The second thing exists.
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
question: Authorize this fixture?
answer: Yes.
decided: 2026-08-30
updated: 2026-08-30
---

# Decision
`;
