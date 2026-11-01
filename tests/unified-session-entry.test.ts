import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { ArcadiaError } from "../src/cli/errors.js";
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
  listAdmissions,
  normalizeProductionScope
} from "../src/production/policy.js";
import { runGoCommand } from "../src/commands/go.js";
import { executeHostEnrollment, type HostEnrollmentInput } from "../src/sessions/hostEnrollment.js";
import { getActiveActionClaim, releaseActionClaim, type TmuxAdapter } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { workItemInputRevision } from "../src/sessions/packetInputRevision.js";

/**
 * The real host enrollment path: host-derived context, strict `arcadia go`
 * for preparation, and the ordinary `launchGuardedHostSession` (with its
 * issueAdmission / commitAdmission) for a managed launch. Only the process
 * spawner (tmux), the capacity observation and the worktree root are faked.
 */
const roots: string[] = [];
const profiles: CodingAgentProfile[] = [profile("codex_build", "codex-cli"), profile("claude_build", "claude-code-cli")];
const adapters = defaultAdapters as ProviderAdapterRegistry;
const NOW = new Date("2026-08-30T12:34:56.000Z");

class FakeTmux implements TmuxAdapter {
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() { return true; }
  hasSession(name: string) { return this.live.has(name); }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    this.launches.push(input);
    this.live.add(input.name);
  }
}

beforeEach(() => vi.stubEnv("CODEX_SANDBOX", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Fixture = ReturnType<typeof fixture>;

function fixture(options: { approvePacket?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-unified-entry-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), planDocument);
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), decisionDocument);
  writeFileSync(path.join(repo, "docs", "decisions", "0002-question.md"), decisionDocument
    .replace('id: "0001"', 'id: "0002"').replace("slug: authorize", "slug: question")
    .replace("status: approved", "status: open").replace("question: Authorize this fixture?", "question: Which fixture color?")
    .replace("answer: Yes.\n", "").replace("decided: 2026-08-30\n", ""));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "initial"]);
  initWorkspace(workspace);
  const packetId = "codex_host_enrollment_fixture";
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove enrollment.", goal: "Prove enrollment.", status: "active" });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo, validationCommands: ["node -e \"process.exit(0)\""] });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    const promptPath = `prompts/codex/${packetId}/prompt.md`;
    mkdirSync(path.join(workspace, path.dirname(promptPath)), { recursive: true });
    writeFileSync(path.join(workspace, promptPath), "immutable build packet\n");
    writeFileSync(path.join(workspace, path.dirname(promptPath), "metadata.json"), JSON.stringify({
      invocationId: packetId, workItemId: workItem.id, actionInputRevision: workItemInputRevision(workItem), promptPath, baseRevision: git(repo, ["rev-parse", "HEAD"]).trim(),
      providerSelection: { provider: "claude-code-cli", model: "sonnet", mappingId: "fixture-map", bindingId: "fixture-binding" }
    }));
    createCodexInvocation(db, {
      id: packetId, purpose: "build", agentProfile: "claude_build", workspaceScope: repo, command: "claude", promptPath,
      jsonlOutputPath: `prompts/codex/${packetId}/output.jsonl`, finalMessagePath: `prompts/codex/${packetId}/final.md`,
      status: "packet_created", workItemId: workItem.id,
      executionProfileJson: JSON.stringify({ schema: "arcadia.execution/v1", profile: "routine_implementation" }),
      providerMappingId: "fixture-map", providerBindingId: "fixture-binding"
    });
    const approval = createReviewItem(db, {
      workItemId: workItem.id, projectId: project.id, codexInvocationId: packetId,
      decisionNeeded: "Approve the promoted build packet.", sourceInput: "fixture", proposedAction: "Launch the fixture Session.",
      resolvedIntent: "CodexPlanningArtifactAcceptance", confidenceLabel: "high", confidence: 1, missingFields: [],
      context: { planningPromotion: {
        actionId: "define-contract", actionDocRef: "plan/copy-proof#define-contract", repoPath: repo, buildProfile: "claude_build",
        buildInvocationId: packetId, buildPacketPath: promptPath, buildPacketSha256: packetSha256(path.join(workspace, promptPath))
      } }
    });
    if (options.approvePacket !== false) updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture authority approved." });
  });
  return { root, repo, workspace, tmux: new FakeTmux() };
}

const scope = normalizeProductionScope({
  intent: "Prove managed enrollment.", projects: ["test-project"], plans: ["test-project/copy-proof"],
  actions: ["test-project/define-contract"], providers: ["claude-code-cli"], maxConcurrentSessions: 1, mechanicalTransitions: []
});

function activate(f: Fixture, requestId = "policy-grant-1") {
  return withDatabase(f.workspace, (db) => activateProduction(db, {
    requestId, scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator"
  }));
}

function capacity(admitted = true): ProviderCapacityObservation {
  const decision = {
    providerId: "claude-code-cli", admitted, code: admitted ? null : "capacity_refused",
    reason: admitted ? "included allowance" : "window exhausted", unattendedProof: admitted, retryAfter: null, refreshRequired: false,
    receipt: {
      version: 1, providerId: "claude-code-cli", providerLabel: "claude-code-cli", profiles: [], accountScope: "test",
      source: "codex_app_server", evidence: "simulated", unattended: true, observedAt: "2026-08-30T12:00:00.000Z", observedAgeMs: 0,
      expiresAt: null, confidence: "observed", freshness: "fresh", usagePolicy: "included", usagePolicyReason: "test fixture",
      windows: [{ label: "5h", usedPercentage: admitted ? 10 : 100, remainingPercentage: admitted ? 90 : 0, resetsAt: null }],
      nextResetAt: null, unsupported: [], availability: admitted ? "available" : "exhausted", telemetry: "test fixture"
    }
  } as unknown as CapacityAdmissionDecision;
  return { generatedAt: "2026-08-30T12:34:56.000Z", providers: [decision] };
}

function attempts(f: Fixture) {
  return withReadOnlyDatabase(f.workspace, (db) =>
    db.prepare("SELECT requirement_id, role, ordinal, status, mutation_owner FROM session_role_attempts ORDER BY created_at, rowid").all());
}

function enroll(f: Fixture, overrides: Partial<HostEnrollmentInput> = {}) {
  return executeHostEnrollment({
    source: f.repo, agent: "claude", requestId: "enroll:claude:runtime-0001", callerId: "claude:runtime-0001",
    mode: "managed-launch", workspace: f.workspace, registries: { profiles, adapters }, tmux: f.tmux,
    capacityObservation: capacity(), agentWorktreeRoot: path.join(f.root, "agents"),
    providerSignIn: () => ({ signedIn: true, remedy: "" }), now: () => NOW,
    ...overrides
  });
}

function state(f: Fixture) {
  return withReadOnlyDatabase(f.workspace, (db) => ({
    liveAdmissions: listAdmissions(db).filter((row) => row.status === "issued" || row.status === "committed").length,
    sessions: (db.prepare("SELECT count(*) count FROM agent_sessions WHERE status IN ('prepared', 'running')").get() as { count: number }).count,
    claims: (db.prepare("SELECT count(*) count FROM agent_worktree_reservations WHERE action_id IS NOT NULL").get() as { count: number }).count,
    // Completed receipts; failed rows are durable identity records, counted by `failedRows`.
    enrollments: (db.prepare("SELECT count(*) count FROM session_enrollments WHERE status = 'completed'").get() as { count: number }).count,
    pending: (db.prepare("SELECT count(*) count FROM session_enrollments WHERE status = 'pending'").get() as { count: number }).count
  }));
}

function worktrees(f: Fixture): number {
  return git(f.repo, ["worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree ")).length;
}

function refusal(run: () => unknown): ArcadiaError {
  try { run(); } catch (error) { expect(error).toBeInstanceOf(ArcadiaError); return error as ArcadiaError; }
  throw new Error("expected a refusal");
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function profile(name: string, provider: string): CodingAgentProfile {
  return {
    name, provider, package: provider === "codex-cli" ? "@openai/codex" : "@anthropic-ai/claude-code",
    command: provider === "codex-cli" ? "codex" : "claude", purpose: "build", sandbox: "workspace-write", args: []
  };
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove enrollment.
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
milestone: Prove the enrollment contract
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

const entryModes = ["prepare", "managed-launch"] as const;
type EntryMode = typeof entryModes[number];
const identity = (mode: EntryMode) => ({
  mode, requestId: `enroll:claude:${mode}-entry`, callerId: `claude:${mode}-entry`
});
const otherMode = (mode: EntryMode): EntryMode => mode === "prepare" ? "managed-launch" : "prepare";

function governance(f: Fixture) {
  return {
    documents: ["PROJECT.md", "docs/plans/copy-proof.md", "docs/decisions/0001-authorize.md", "docs/decisions/0002-question.md"]
      .map(file => readFileSync(path.join(f.repo, file), "utf8")),
    questions: withReadOnlyDatabase(f.workspace, db => db.prepare("SELECT id, status FROM review_items ORDER BY id").all())
  };
}

describe("shared interactive and unattended entry at concurrency one (source fixtures only)", () => {
  it.each(entryModes)("interleaves %s first with the other entry on the same Action and gives only one caller a principal", winner => {
    const f = fixture();
    activate(f); // Disposable policy only; the real host is never touched.
    const before = governance(f);
    const loser = otherMode(winner);
    let overlappingCode: unknown;
    const compete = () => {
      // Re-enter through a separate host DB connection while the winner is
      // pending. Promise.all on this synchronous API would not create a race.
      overlappingCode = refusal(() => enroll(f, identity(loser))).details.code;
    };
    const receipt = enroll(f, {
      ...identity(winner),
      ...(winner === "prepare" ? {
        runGo: options => { compete(); return runGoCommand(options); }
      } : {
        launchTestHooks: { afterSessionPreparedBeforeCommit: compete }
      })
    });
    expect(overlappingCode).toBe(winner === "prepare" ? "enrollment_in_progress" : "action_claimed");
    expect(refusal(() => enroll(f, identity(loser))).details.code).toBe("action_claimed");
    expect(receipt).toMatchObject({
      ...identity(winner), projectSlug: "test-project", planSlug: "copy-proof", actionId: "define-contract",
      execution: { provider: "claude-code-cli", model: "sonnet" },
      principal: { kind: winner === "prepare" ? "prepared" : "managed-session" },
      claim: { generation: expect.any(String) }
    });
    expect(receipt.canonicalBrief).toContain("Current action: define-contract");
    expect(receipt.operatorGates).toEqual(expect.arrayContaining([expect.stringContaining("0002")]));
    expect(receipt.enrollmentId).toBeTruthy();
    expect(enroll(f, identity(winner))).toEqual(receipt);
    expect(refusal(() => enroll(f, { ...identity(winner), callerId: identity(loser).callerId })).details.code)
      .toBe("enrollment_request_changed");
    expect(refusal(() => enroll(f, { ...identity(winner), mode: loser })).details.code)
      .toBe("enrollment_request_changed");
    expect(state(f)).toEqual({
      claims: 1, sessions: winner === "managed-launch" ? 1 : 0,
      liveAdmissions: winner === "managed-launch" ? 1 : 0, enrollments: 1, pending: 0
    });
    expect(worktrees(f)).toBe(2);
    expect(f.tmux.launches).toHaveLength(winner === "managed-launch" ? 1 : 0);
    if (winner === "managed-launch") {
      expect(receipt.admission).toMatchObject({ status: "committed", requestId: `${identity(winner).requestId}:admission` });
      expect(attempts(f)).toEqual([{
        requirement_id: `test-project/${receipt.planSlug}/define-contract`, role: "development",
        ordinal: 1, status: "running", mutation_owner: 1
      }]);
    } else {
      expect(receipt.admission).toBeNull();
      expect(attempts(f)).toEqual([]);
    }
    expect(governance(f)).toEqual(before);
  });

  it.each(entryModes)("recovers %s after an interrupted receipt and host restart without transferring ownership from silence", mode => {
    const f = fixture();
    activate(f);
    // Fail the durable receipt after canonical claim / launch effects have
    // committed, rather than manufacturing a pending enrollment row.
    withDatabase(f.workspace, db => db.exec(`CREATE TRIGGER interrupt_receipt BEFORE UPDATE OF receipt_json ON session_enrollments
      WHEN NEW.receipt_json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'interrupted receipt'); END`));
    expect(() => enroll(f, identity(mode))).toThrow("interrupted receipt");
    expect(state(f)).toMatchObject({ claims: 1, enrollments: 0, pending: 1 });
    const originalClaim = withReadOnlyDatabase(f.workspace, db => getActiveActionClaim(db, f.repo, "test-project", "define-contract", NOW));
    expect(originalClaim?.claim_generation).toBeTruthy();
    const launches = f.tmux.launches.length;
    const candidates = worktrees(f);
    f.tmux.live.clear(); // No tmux liveness is evidence of release.
    const restartedAt = new Date(NOW.getTime() + 400_000); // Beyond the pending request lease, within the Action claim.
    withDatabase(f.workspace, db => {
      db.exec("DROP TRIGGER interrupt_receipt");
      expect(releaseActionClaim(db, {
        repositoryPath: f.repo, project: "test-project", actionId: "define-contract", generation: "stale-generation"
      })).toBe(false);
    });
    // Each executeHostEnrollment invocation reopens the persisted workspace;
    // no in-memory enrollment owner survives into this restarted call.
    const restarted = { now: () => restartedAt };
    expect(refusal(() => enroll(f, { ...identity(otherMode(mode)), ...restarted })).details.code).toBe("action_claimed");
    withDatabase(f.workspace, db => deactivateProduction(db, { requestId: "fixture-off-after-interruption" }));
    const recovered = enroll(f, { ...identity(mode), ...restarted });
    expect(recovered.claim).toEqual({
      id: originalClaim!.id, worktree: originalClaim!.worktree_path, generation: originalClaim!.claim_generation
    });
    expect(recovered.principal.worktree).toBe(originalClaim!.worktree_path);
    expect(enroll(f, { ...identity(mode), ...restarted })).toEqual(recovered);
    expect(refusal(() => enroll(f, { ...identity(otherMode(mode)), ...restarted })).details.code).toBe("action_claimed");
    expect(worktrees(f)).toBe(candidates);
    expect(f.tmux.launches).toHaveLength(launches);
    expect(state(f)).toMatchObject({ claims: 1, enrollments: 1, pending: 0 });
  });

  it("keeps production Off, questions and pointers unchanged while previewing go and preparing an interactive candidate", () => {
    const f = fixture();
    const before = governance(f);
    const preview = runGoCommand({
      repo: f.repo, source: f.repo, agent: "claude", workspace: f.workspace,
      agentWorktreeRoot: path.join(f.root, "agents")
    });
    expect(preview.data.dispatch?.context?.action.id).toBe("define-contract");
    expect(preview.data.applied).toBe(false);
    expect(state(f)).toMatchObject({ claims: 0, sessions: 0, liveAdmissions: 0, enrollments: 0 });
    expect(refusal(() => enroll(f, identity("managed-launch"))).details.code).toBe("production_off");
    const receipt = enroll(f, identity("prepare"));
    expect(receipt.principal.kind).toBe("prepared");
    expect(receipt.admission).toBeNull();
    expect(enroll(f, identity("prepare"))).toEqual(receipt);
    expect(f.tmux.launches).toEqual([]);
    expect(governance(f)).toEqual(before);
    expect(withReadOnlyDatabase(f.workspace, db => db.prepare("SELECT desired_state FROM production_policy").get()))
      .toMatchObject({ desired_state: "inactive" });
  });

  it.each([false, true])("truthfully refuses an unsupervisable native runtime (partial adapter: %s)", partial => {
    const f = fixture();
    const before = governance(f);
    const observe = vi.fn(() => ({ stableIdentity: true, liveness: true, terminalOutcome: false, recovery: false }));
    const error = refusal(() => enroll(f, {
      mode: "native-adopt", requestId: "enroll:claude:native-entry", callerId: "claude:native-entry",
      ...(partial ? { nativeAdapters: { claude: { id: "fixture-native", observe } } } : {})
    }));
    expect(error.details).toMatchObject({
      code: "native_runtime_not_supervisable",
      supportedRoute: { mode: "managed-launch", launcher: "arcadia-enroll-broker-claude" }
    });
    expect(observe).toHaveBeenCalledTimes(partial ? 1 : 0);
    expect(state(f)).toEqual({ claims: 0, sessions: 0, liveAdmissions: 0, enrollments: 0, pending: 0 });
    expect(worktrees(f)).toBe(1);
    expect(f.tmux.launches).toEqual([]);
    expect(governance(f)).toEqual(before);
  });
});
