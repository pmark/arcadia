import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { validationError } from "../src/cli/errors.js";
import { runProductionPreviewCommand } from "../src/commands/production.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createReviewItem,
  getWorkItemByDocRef,
  upsertProject,
  upsertProjectMetadata,
  updateReviewItemStatus
} from "../src/db/repositories.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import { activateProduction, fingerprintProductionScope, normalizeIntegrationGrant, normalizeProductionScope, type ProductionScope } from "../src/production/policy.js";
import { integrateSessionCandidate, preserveSessionCandidate } from "../src/production/sessionHandoff.js";
import { runManagedProductionTick } from "../src/production/tick.js";
import { snapshotCandidate } from "../src/sessions/candidateSnapshot.js";
import { getRepositoryLease, type TmuxAdapter } from "../src/sessions/index.js";
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
  capturePane() {
    return null;
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

describe("preserve-on-exit and integrate", () => {
  it("preserves, integrates under a valid grant, completes, and admits the next Action in the same tick", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
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
    expect(project.handoff?.integration).toMatchObject({ kind: "integrated", baseBranch: "main" });
    expect(project.reconciled[0]?.outcome).toBe("accepted_completion");
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

  it("refuses to preserve when the Project declares no objective validation_commands", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture, scopeWith({ decisionRef: "0058", expiresAt: "2099-01-01T00:00:00.000Z", actions: [] }));
    const session = launchFirstSession(fixture, tmux);
    finishCandidate(fixture, tmux, session);

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
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
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
