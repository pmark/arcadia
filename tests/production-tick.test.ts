import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
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
import {
  activateProduction,
  deactivateProduction,
  fingerprintProductionScope,
  normalizeProductionScope,
  PRODUCTION_CONTROL_DEADLINES,
  type ProductionScope
} from "../src/production/policy.js";
import { runManagedProductionTick, resetProductionRepairBudget } from "../src/production/tick.js";
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
  failLaunch = false;
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() {
    return this.isAvailable;
  }
  hasSession(name: string) {
    return this.live.has(name);
  }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    if (this.failLaunch) throw new Error("synthetic spawn failure");
    this.launches.push(input);
    this.live.add(input.name);
  }
}

const productionScope: ProductionScope = normalizeProductionScope({
  intent: "Prove the continuous worker tick.",
  projects: ["test-project"],
  plans: ["test-project/copy-proof"],
  actions: ["test-project/define-contract", "test-project/second-action"],
  providers: ["claude-code-cli"],
  maxConcurrentSessions: 10,
  mechanicalTransitions: ["acceptance", "pointer"]
});

function activatePolicy(fixture: ReturnType<typeof preparedFixture>, requestId = "policy-grant-1") {
  return withDatabase(fixture.workspace, (db) =>
    activateProduction(db, {
      requestId,
      scope: productionScope,
      scopeFingerprint: fingerprintProductionScope(productionScope),
      grantedBy: "operator"
    })
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
      version: 1,
      providerId: "claude-code-cli",
      providerLabel: "claude-code-cli",
      profiles: [],
      accountScope: "test",
      source: "codex_app_server",
      evidence: "simulated",
      unattended: true,
      observedAt: "2026-08-30T12:00:00.000Z",
      observedAgeMs: 0,
      expiresAt: null,
      confidence: "observed",
      freshness: "fresh",
      usagePolicy: "included",
      usagePolicyReason: "test fixture",
      windows: [{ label: "5h", usedPercentage: 10, remainingPercentage: 90, resetsAt: null }],
      nextResetAt: null,
      unsupported: [],
      availability: "available",
      telemetry: "test fixture"
    }
  };
}

function fixtureCapacityObservation(): ProviderCapacityObservation {
  return { generatedAt: "2026-08-30T12:34:56.000Z", providers: [provenCapacity()] };
}

describe("runManagedProductionTick", () => {
  it("does nothing when managed production is Inactive", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();

    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );

    expect(result.policyActive).toBe(false);
    expect(result.projects[0]?.launch).toBeNull();
    expect(tmux.launches).toHaveLength(0);
  });

  it("re-stamps the transport heartbeat between per-Project steps so a long blocking tick cannot starve it", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const heartbeat = vi.fn();

    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, heartbeat, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );

    expect(result.projects).toHaveLength(1);
    expect(heartbeat.mock.calls.length).toBeGreaterThanOrEqual(result.projects.length * 3);
    expect(tmux.launches).toHaveLength(0);
  });

  it("admits and launches the next eligible Action under the standing policy with no operator click", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: fixture.now,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );

    expect(result.policyActive).toBe(true);
    const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.launch?.outcome).toBe("launched");
    expect(project.launch?.actionKey).toBe("test-project/define-contract");
    expect(tmux.launches).toHaveLength(1);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).not.toBeNull();
  });

  it("skips a repository that already holds a lease rather than launching a second Session", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(tmux.launches).toHaveLength(1);

    const second = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const project = second.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.launch?.outcome).toBe("skipped");
    expect(tmux.launches).toHaveLength(1);
  });

  it("reconciles a dead Session into an accepted completion, and once its PR is merged the next tick launches the next eligible Action with no new click", () => {
    const fixture = preparedFixture({ secondAction: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const first = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const firstLaunch = first.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(firstLaunch.launch?.outcome).toBe("launched");
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;

    // The candidate makes real, evidenced progress: a passing Run recorded
    // against the Session's own worktree, and the tmux Session exiting (dying)
    // without ever calling `session reconcile` itself -- the exact situation
    // this Action's continuation loop must notice on its own.
    completeActionInWorktree(session.worktree_path, "define-contract");
    recordPassingRun(fixture.workspace, session.work_item_id);
    tmux.live.delete(session.tmux_session_name);

    const second = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const secondResult = second.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(secondResult.reconciled).toHaveLength(1);
    // Automatic mechanical completion settled onto the candidate's own
    // worktree/branch; the checked-in base repository has not merged that PR
    // yet, so this tick's own launch attempt still only sees the old pointer.
    expect(secondResult.reconciled[0]?.outcome).toBe("accepted_completion");
    expect(secondResult.launch?.outcome).toBe("skipped");

    // The operator (or bound CI) merges the candidate's PR -- an approval
    // boundary this worker never crosses itself.
    git(fixture.repo, ["fetch", session.worktree_path, session.branch]);
    git(fixture.repo, ["merge", "--ff-only", "FETCH_HEAD"]);

    const third = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 120_000), capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const thirdResult = third.projects.find((entry) => entry.projectSlug === "test-project")!;
    // No new human session, chat, or Launch click: the very next tick after
    // the merge landed launches the next eligible Action on its own.
    expect(thirdResult.baseBranchAdvance?.changed).toBe(true);
    expect(thirdResult.launch?.outcome).toBe("launched");
    expect(thirdResult.launch?.actionKey).toBe("test-project/second-action");
    expect(tmux.launches).toHaveLength(2);
  });

  it("detects a base branch advance independent of its own completion signal and records an event and a MISSION_LOG line", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();

    const before = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(before.projects[0]?.baseBranchAdvance?.changed).toBe(false);

    // Simulate a PR merging onto main by a means entirely outside this
    // worker's own admission/completion pipeline.
    writeFileSync(path.join(fixture.repo, "EXTERNAL.md"), "merged externally\n");
    git(fixture.repo, ["add", "EXTERNAL.md"]);
    git(fixture.repo, ["commit", "-m", "external merge"]);
    const newSha = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    const after = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const advance = after.projects[0]?.baseBranchAdvance;
    expect(advance?.changed).toBe(true);
    expect(advance?.newSha).toBe(newSha);

    const events = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT event_type, payload_json FROM events WHERE event_type = 'managed_production.base_branch_advanced'").all()
    ) as Array<{ event_type: string; payload_json: string }>;
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payload_json);
    expect(payload.newSha).toBe(newSha);
    expect(payload.projectSlug).toBe("test-project");

    const missionLog = readFileSync(path.join(fixture.repo, "MISSION_LOG.md"), "utf8");
    expect(missionLog).toContain("Base branch advanced");
    expect(missionLog).toContain(newSha.slice(0, 12));

    // The MISSION_LOG append above is itself a commit onto `baseBranch`,
    // which moves it again. A tick that re-reads that self-made commit as
    // yet another "advance" would record a second event and a second
    // MISSION_LOG entry forever, with no external change required -- this is
    // exactly the self-triggering loop that produced thousands of spurious
    // `chore(arcadia): record base branch advance` commits in production.
    const stillNoOp = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 120_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(stillNoOp.projects[0]?.baseBranchAdvance?.changed).toBe(false);

    const eventsAfter = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT event_type FROM events WHERE event_type = 'managed_production.base_branch_advanced'").all()
    ) as Array<{ event_type: string }>;
    expect(eventsAfter).toHaveLength(1);

    const missionLogAfter = readFileSync(path.join(fixture.repo, "MISSION_LOG.md"), "utf8");
    expect(missionLogAfter).toBe(missionLog);
  });

  it("stops retrying an Action after its repair budget is exhausted, then resumes once the budget is reset", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    tmux.failLaunch = true;
    activatePolicy(fixture);

    for (let attempt = 0; attempt < PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction; attempt++) {
      const result = withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles,
          adapters,
          tmux,
          now: new Date(fixture.now.getTime() + attempt * 1000),
          capacityObservation: fixtureCapacityObservation(),
          agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
      const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
      expect(project.launch?.outcome).toBe("failed");
    }
    expect(tmux.launches).toHaveLength(0);

    const exhausted = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 10_000),
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const exhaustedProject = exhausted.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(exhaustedProject.launch?.outcome).toBe("repair_budget_exhausted");

    tmux.failLaunch = false;
    withDatabase(fixture.workspace, (db) => resetProductionRepairBudget(db, "test-project/define-contract"));
    const recovered = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 20_000),
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const recoveredProject = recovered.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(recoveredProject.launch?.outcome).toBe("launched");
  });
});

function recordPassingRun(workspace: string, workItemId: string): void {
  withDatabase(workspace, (db) => {
    const runId = "run-" + Math.random().toString(36).slice(2);
    db.prepare(
      `INSERT INTO execution_runs (id, work_item_id, plan_id, status, executor_name, pid, summary, created_at, updated_at)
       VALUES (?, ?, NULL, 'completed', 'claude', NULL, 'Fixture passing run.', ?, ?)`
    ).run(runId, workItemId, "2026-08-30T12:00:00.000Z", "2026-08-30T12:00:00.000Z");
  });
}

/**
 * Leaves the Action's own status untouched: `attemptAutomaticCompletion`
 * itself is what marks an Action done, by settling a `complete` Agent Ask
 * onto this exact candidate. This only produces the real, evidenced artifact
 * the Action promised, distinguishable from the base revision.
 */
function completeActionInWorktree(worktreePath: string, actionId: string): void {
  writeFileSync(path.join(worktreePath, "docs", "contract.md"), `# Contract\n\nDefined by ${actionId}.\n`);
  git(worktreePath, ["add", "."]);
  git(worktreePath, ["commit", "-m", `complete ${actionId}`]);
}

function preparedFixture(options: { secondAction?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-production-tick-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), planDocument(options.secondAction ?? false));
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), decisionDocument);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);
  const provider = "claude-code-cli";
  const model = "sonnet";
  const profileName = "claude_build";

  function preparePacket(db: Database.Database, actionId: string, projectId: string) {
    const packetId = `production_tick_fixture_${actionId}`;
    const workItem = getWorkItemByDocRef(db, `plan/copy-proof#${actionId}`)!;
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    const baseRevision = git(repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(
      path.join(workspace, path.dirname(promptPath), "metadata.json"),
      JSON.stringify({
        invocationId: packetId,
        workItemId: workItem.id,
        promptPath,
        baseRevision,
        providerSelection: { provider, model, mappingId: "fixture-map", bindingId: "fixture-binding" }
      })
    );
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: profileName,
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
    createReviewItem(db, {
      workItemId: workItem.id,
      projectId,
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
          actionId,
          actionDocRef: `plan/copy-proof#${actionId}`,
          repoPath: repo,
          buildProfile: profileName,
          buildInvocationId: packetId,
          buildPacketPath: promptPath,
          buildPacketSha256: packetSha256(path.join(workspace, promptPath))
        }
      }
    }).id;
    const approvalId = db
      .prepare("SELECT id FROM review_items WHERE codex_invocation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(packetId) as { id: string };
    updateReviewItemStatus(db, approvalId.id, { status: "approved", decisionNote: "Fixture authority approved." });
  }

  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove the continuous worker tick.", goal: "Prove the continuous worker tick.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    preparePacket(db, "define-contract", project.id);
    if (options.secondAction) preparePacket(db, "second-action", project.id);
  });
  return {
    root,
    repo,
    workspace,
    now: new Date("2026-08-30T12:34:56.000Z"),
    agentWorktreeRoot: path.join(root, "agent-worktrees")
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function profile(name: string, provider: string): CodingAgentProfile {
  return {
    name,
    provider,
    package: "@anthropic-ai/claude-code",
    command: "claude",
    purpose: "build",
    sandbox: "workspace-write",
    args: []
  };
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove the continuous worker tick.
active_plan: copy-proof
current_action: define-contract
updated: 2026-08-30
---

# Test Project
`;

function planDocument(secondAction: boolean): string {
  const second = secondAction
    ? `
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
    decisions: ["0001"]`
    : "";
  return `---
arcadia: v1
type: plan
slug: copy-proof
project: test-project
status: active
milestone: Prove the continuous worker tick
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
    decisions: ["0001"]${second}
---

# Copy proof
`;
}

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
