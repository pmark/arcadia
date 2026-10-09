import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectIdentityBlock } from "./helpers/identityBlock.js";
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
import { launchGuardedHostSession } from "../src/sessions/launch.js";
import type { TmuxAdapter } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

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
  failLaunch = false;
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  available() { return true; }
  hasSession(name: string) { return this.live.has(name); }
  launch(input: { name: string; cwd: string; command: string; args: string[] }) {
    if (this.failLaunch) throw new Error("synthetic spawn failure");
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
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-host-enrollment-")));
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
      invocationId: packetId, workItemId: workItem.id, promptPath, baseRevision: git(repo, ["rev-parse", "HEAD"]).trim(),
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

function failedRows(f: Fixture): number {
  return withReadOnlyDatabase(f.workspace, (db) =>
    (db.prepare("SELECT count(*) count FROM session_enrollments WHERE status = 'failed'").get() as { count: number }).count);
}

function worktrees(f: Fixture): number {
  return git(f.repo, ["worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree ")).length;
}

function refusal(run: () => unknown): ArcadiaError {
  try { run(); } catch (error) { expect(error).toBeInstanceOf(ArcadiaError); return error as ArcadiaError; }
  throw new Error("expected a refusal");
}

describe("host enrollment: managed launch through the guarded launcher", () => {
  it("resolves the governed context on the host, launches once via a committed admission, and replays the Session receipt", () => {
    const f = fixture();
    activate(f);
    const receipt = enroll(f);
    expect(receipt).toMatchObject({
      mode: "managed-launch", projectSlug: "test-project", planSlug: "copy-proof", actionId: "define-contract",
      packet: { invocationId: "codex_host_enrollment_fixture" },
      execution: { provider: "claude-code-cli", model: "sonnet" },
      principal: { kind: "managed-session" },
      admission: { requestId: "enroll:claude:runtime-0001:admission", status: "committed" }
    });
    expect(receipt.canonicalBrief).toContain("Current action: define-contract");
    // The enrolling brief names the identity the selected model (sonnet, Claude's standard
    // tier) commits under; the launched Session starts on the light tier, so its brief names that.
    expectIdentityBlock(receipt.canonicalBrief, "claude", "standard");
    expect(f.tmux.launches).toHaveLength(1);
    expectIdentityBlock(String(f.tmux.launches[0].args.at(-1)), "claude", "light");
    expect(state(f)).toMatchObject({ liveAdmissions: 1, sessions: 1, enrollments: 1, pending: 0 });

    expect(enroll(f)).toEqual(receipt);
    expect(f.tmux.launches).toHaveLength(1);
    expect(state(f)).toMatchObject({ liveAdmissions: 1, sessions: 1, enrollments: 1 });
  });

  it("refuses a changed caller or mode under the same request id before any admission or launch", () => {
    const f = fixture();
    activate(f);
    enroll(f);
    for (const changed of [{ callerId: "claude:runtime-0002" }, { mode: "prepare" as const }]) {
      expect(refusal(() => enroll(f, changed)).details.code).toBe("enrollment_request_changed");
    }
    expect(f.tmux.launches).toHaveLength(1);
    expect(state(f)).toMatchObject({ liveAdmissions: 1, sessions: 1, enrollments: 1 });
  });

  it("never gives a second caller the first caller's running Session (review probe)", () => {
    const f = fixture();
    activate(f);
    const first = enroll(f);
    const error = refusal(() => enroll(f, { requestId: "enroll:claude:runtime-0002", callerId: "claude:runtime-0002" }));
    expect(error.details.code).toBe("action_claimed");
    expect(f.tmux.launches).toHaveLength(1);
    expect(state(f)).toMatchObject({ liveAdmissions: 1, sessions: 1, claims: 1, enrollments: 1, pending: 0 });
    expect(failedRows(f)).toBe(0);
    // The first caller's own replay still returns its receipt.
    expect(enroll(f)).toEqual(first);
  });

  it("refuses enrollment of an Action whose Session the production tick launched", () => {
    const f = fixture();
    activate(f);
    withDatabase(f.workspace, (db) => launchGuardedHostSession({
      db, workspace: f.workspace, repoRoot: f.repo, projectSlug: "test-project", requestId: "worker-tick-test-project-define-contract-1",
      standingPolicy: true, profiles, adapters, tmux: f.tmux, capacityObservation: capacity(),
      agentWorktreeRoot: path.join(f.root, "tick"), providerSignIn: () => ({ signedIn: true, remedy: "" }), now: NOW
    }));
    for (const mode of ["managed-launch", "prepare"] as const) {
      expect(refusal(() => enroll(f, { mode, requestId: `enroll:claude:runtime-${mode}` })).details.code).toBe("action_claimed");
    }
    expect(f.tmux.launches).toHaveLength(1);
    expect(state(f)).toMatchObject({ liveAdmissions: 1, sessions: 1, claims: 1, enrollments: 0, pending: 0 });
  });

  it("guarded launch with reuseOwnLeaseOnly refuses a lease it did not create before any admission", () => {
    const f = fixture();
    activate(f);
    const launch = (requestId: string, reuseOwnLeaseOnly: boolean) => withDatabase(f.workspace, (db) => launchGuardedHostSession({
      db, workspace: f.workspace, repoRoot: f.repo, projectSlug: "test-project", requestId, standingPolicy: true, reuseOwnLeaseOnly,
      profiles, adapters, tmux: f.tmux, capacityObservation: capacity(), agentWorktreeRoot: path.join(f.root, requestId),
      providerSignIn: () => ({ signedIn: true, remedy: "" }), now: NOW
    }));
    const owner = launch("owner-request-0001", false);
    const error = refusal(() => launch("enroll:claude:intruder-01", true));
    expect(error.details).toMatchObject({ code: "action_claimed", sessionId: owner.session.id });
    // Non-enrollment callers keep the unchanged reuse semantics.
    expect(launch("other-caller-0001", false)).toMatchObject({ reused: true, session: { id: owner.session.id } });
    expect(f.tmux.launches).toHaveLength(1);
    expect(withReadOnlyDatabase(f.workspace, (db) => listAdmissions(db)).map((row) => row.requestId)).toEqual(["owner-request-0001:admission"]);
  });

  it("guarded launch with reuseOwnLeaseOnly never resumes its own lease under a later production epoch", () => {
    const f = fixture();
    const first = activate(f);
    const launch = (expectedPolicyEpoch: number) => withDatabase(f.workspace, (db) => launchGuardedHostSession({
      db, workspace: f.workspace, repoRoot: f.repo, projectSlug: "test-project", requestId: "enroll:claude:runtime-0001",
      standingPolicy: true, reuseOwnLeaseOnly: true, expectedPolicyEpoch, profiles, adapters, tmux: f.tmux,
      capacityObservation: capacity(), agentWorktreeRoot: path.join(f.root, "own"),
      providerSignIn: () => ({ signedIn: true, remedy: "" }), now: NOW
    }));
    const epoch = first.policy.epoch;
    const owned = launch(epoch);
    expect(launch(epoch)).toMatchObject({ reused: true, session: { id: owned.session.id } });
    withDatabase(f.workspace, (db) => deactivateProduction(db, { requestId: "off-before-replay" }));
    const later = activate(f, "policy-grant-2");
    expect(refusal(() => launch(later.policy.epoch)).details.code).toBe("stale_epoch");
    expect(f.tmux.launches).toHaveLength(1);
  });

  it("hands back its own Session after a lost receipt even when production is now Off", () => {
    const f = fixture();
    activate(f);
    const receipt = enroll(f);
    withDatabase(f.workspace, (db) => db.prepare("UPDATE session_enrollments SET status = 'pending', receipt_json = NULL").run());
    withDatabase(f.workspace, (db) => deactivateProduction(db, { requestId: "off-after-lost-receipt" }));
    const replay = enroll(f);
    expect(replay.principal).toEqual(receipt.principal);
    expect(replay.admission).toMatchObject({ requestId: "enroll:claude:runtime-0001:admission" });
    expect(f.tmux.launches).toHaveLength(1);
    expect(state(f)).toMatchObject({ sessions: 1, enrollments: 1, pending: 0 });
    // A different caller is still refused while Off, and the Session is not re-issued.
    expect(refusal(() => enroll(f, { requestId: "enroll:claude:runtime-0002", callerId: "claude:runtime-0002" })).details.code)
      .toBe("action_claimed");
  });

  it("commits its own issued admission when it resumes a Session prepared before a host crash", () => {
    const f = fixture();
    activate(f);
    expect(() => enroll(f, { launchTestHooks: { afterSessionPreparedBeforeCommit: () => { throw new Error("host crashed"); } } }))
      .toThrow("host crashed");
    expect(withReadOnlyDatabase(f.workspace, (db) => listAdmissions(db)).map((row) => row.status)).toEqual(["issued"]);
    expect(f.tmux.launches).toHaveLength(0);
    // The crash came before the attempt cutoff: nothing owns the requirement yet.
    expect(attempts(f)).toEqual([]);
    const receipt = enroll(f);
    expect(receipt.admission).toMatchObject({ requestId: "enroll:claude:runtime-0001:admission", status: "committed" });
    expect(f.tmux.launches).toHaveLength(1);
    // The own-lease resume bound exactly one running development attempt to the requirement before starting it.
    expect(attempts(f)).toEqual([{ requirement_id: `test-project/${receipt.planSlug}/define-contract`, role: "development", ordinal: 1, status: "running", mutation_owner: 1 }]);
    // Concurrency limit 1: exactly one live (committed) admission and one Session.
    expect(withReadOnlyDatabase(f.workspace, (db) => listAdmissions(db)).map((row) => row.status)).toEqual(["committed"]);
    expect(state(f)).toMatchObject({ liveAdmissions: 1, sessions: 1, claims: 1, enrollments: 1, pending: 0 });
  });

  it("checks a resumed own lease's reuse refusals before committing its issued admission", () => {
    const f = fixture();
    activate(f);
    expect(() => enroll(f, { launchTestHooks: { afterSessionPreparedBeforeCommit: () => { throw new Error("host crashed"); } } }))
      .toThrow("host crashed");
    // The Project stops declaring validation commands before the replay.
    withDatabase(f.workspace, (db) => {
      const project = db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string };
      upsertProjectMetadata(db, { projectId: project.id, repoPath: f.repo, validationCommands: [] });
    });
    expect(refusal(() => enroll(f)).details.code).toBe("no_validation_commands");
    // The prepared Session never started and its slot was never consumed by the refused reuse.
    expect(withReadOnlyDatabase(f.workspace, (db) => listAdmissions(db)).map((row) => row.status)).toEqual(["issued"]);
    expect(f.tmux.launches).toHaveLength(0);
  });

  it("refuses Off before writing an enrollment, admission, claim or candidate", () => {
    const f = fixture();
    const before = worktrees(f);
    expect(refusal(() => enroll(f)).details.code).toBe("production_off");
    expect(state(f)).toEqual({ liveAdmissions: 0, sessions: 0, claims: 0, enrollments: 0, pending: 0 });
    expect(worktrees(f)).toBe(before);
    expect(f.tmux.launches).toHaveLength(0);
  });

  it("refuses unavailable capacity and missing packet approval without orphans", () => {
    const busy = fixture();
    activate(busy);
    expect(refusal(() => enroll(busy, { capacityObservation: capacity(false) })).details.code).toBe("capacity_unavailable");
    expect(state(busy)).toEqual({ liveAdmissions: 0, sessions: 0, claims: 0, enrollments: 0, pending: 0 });

    const unapproved = fixture({ approvePacket: false });
    activate(unapproved);
    expect(refusal(() => enroll(unapproved)).details.code).toBe("packet_approval_required");
    expect(state(unapproved)).toEqual({ liveAdmissions: 0, sessions: 0, claims: 0, enrollments: 0, pending: 0 });
    expect(unapproved.tmux.launches).toHaveLength(0);
  });

  it("fences a policy epoch that changes between host resolution and admission (Off then On)", () => {
    const f = fixture();
    activate(f);
    const before = worktrees(f);
    const error = refusal(() => enroll(f, {
      // Called by launchGuardedHostSession after preview, before issueAdmission.
      providerSignIn: () => {
        withDatabase(f.workspace, (db) => deactivateProduction(db, { requestId: "off-mid-enroll" }));
        activate(f, "policy-grant-2");
        return { signedIn: true, remedy: "" };
      }
    }));
    expect(error.details.code).toBe("stale_epoch");
    expect(state(f)).toEqual({ liveAdmissions: 0, sessions: 0, claims: 0, enrollments: 0, pending: 0 });
    expect(worktrees(f)).toBe(before);
    expect(f.tmux.launches).toHaveLength(0);
    // The exact request remains replayable under the fresh epoch and launches once.
    expect(enroll(f).principal.kind).toBe("managed-session");
    expect(f.tmux.launches).toHaveLength(1);
  });

  it("releases everything when the launch transport refuses; the settled request never relaunches, a next request launches once", () => {
    const f = fixture();
    activate(f);
    f.tmux.failLaunch = true;
    refusal(() => enroll(f));
    // The failed Session row and its worktree stay as inspectable history (the
    // guarded launcher's own contract); no live admission, lease or enrollment remains.
    expect(state(f)).toMatchObject({ liveAdmissions: 0, sessions: 0, enrollments: 0, pending: 0 });
    f.tmux.failLaunch = false;
    // The terminal admission is never revived by replaying the same request id.
    expect(refusal(() => enroll(f)).details.code).toBe("admission_already_settled");
    expect(f.tmux.launches).toHaveLength(0);
    expect(state(f)).toMatchObject({ liveAdmissions: 0, enrollments: 0, pending: 0 });
    const receipt = enroll(f, { requestId: "enroll:claude:runtime-0001:retry-2", agentWorktreeRoot: path.join(f.root, "agents-retry"), now: () => new Date(NOW.getTime() + 60_000) });
    expect(receipt.principal.kind).toBe("managed-session");
    expect(f.tmux.launches).toHaveLength(1);
    expect(state(f)).toMatchObject({ liveAdmissions: 1, enrollments: 1, pending: 0 });
  });

  it("reconciles a pending managed request after a host restart onto its existing Session without a second launch", () => {
    const f = fixture();
    activate(f);
    const receipt = enroll(f);
    // Simulate a host child that died after launching but before its receipt was stored.
    withDatabase(f.workspace, (db) => db.prepare("UPDATE session_enrollments SET status = 'pending', receipt_json = NULL").run());
    const recovered = enroll(f);
    expect(recovered.principal).toEqual(receipt.principal);
    expect(recovered.admission?.requestId).toBe("enroll:claude:runtime-0001:admission");
    expect(f.tmux.launches).toHaveLength(1);
    expect(state(f)).toMatchObject({ liveAdmissions: 1, sessions: 1, enrollments: 1, pending: 0 });
  });

  it("refuses native adoption on the host with the managed-worker route, creating nothing", () => {
    const f = fixture();
    activate(f);
    const error = refusal(() => enroll(f, { mode: "native-adopt" }));
    expect(error.details).toMatchObject({
      code: "native_runtime_not_supervisable",
      supportedRoute: { mode: "managed-launch", launcher: "arcadia-enroll-broker-claude" }
    });
    expect(state(f)).toEqual({ liveAdmissions: 0, sessions: 0, claims: 0, enrollments: 0, pending: 0 });
  });

  it("refuses a source other than the configured repository root", () => {
    const f = fixture();
    const elsewhere = path.join(f.root, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, "PROJECT.md"), projectDocument);
    expect(refusal(() => enroll(f, { source: elsewhere })).details.code).toBe("enrollment_source_not_repository");
    expect(state(f).enrollments).toBe(0);
  });
});

describe("host enrollment: preparation through strict arcadia go", () => {
  it("returns the canonical candidate with its fenced claim, holds no production authority, and replays", () => {
    const f = fixture();
    const before = worktrees(f);
    const receipt = enroll(f, { mode: "prepare" });
    expect(receipt).toMatchObject({
      mode: "prepare", actionId: "define-contract", admission: null,
      packet: { invocationId: "codex_host_enrollment_fixture" },
      principal: { kind: "prepared" }
    });
    expect(receipt.claim?.generation).toEqual(expect.any(String));
    expect(receipt.principal.worktree).toBe(receipt.claim?.worktree);
    expect(worktrees(f)).toBe(before + 1);
    // Preparation launched nothing and reserved no production admission.
    expect(state(f)).toEqual({ liveAdmissions: 0, sessions: 0, claims: 1, enrollments: 1, pending: 0 });
    expect(f.tmux.launches).toHaveLength(0);

    expect(enroll(f, { mode: "prepare" })).toEqual(receipt);
    expect(worktrees(f)).toBe(before + 1);
  });

  it("refuses a second helper for the claimed Action instead of creating a duplicate principal", () => {
    const f = fixture();
    enroll(f, { mode: "prepare" });
    const before = worktrees(f);
    const error = refusal(() => enroll(f, { mode: "prepare", requestId: "enroll:claude:runtime-0002", callerId: "claude:runtime-0002" }));
    expect(error.details.code).toBe("action_claimed");
    expect(worktrees(f)).toBe(before);
    expect(state(f)).toMatchObject({ claims: 1, enrollments: 1, pending: 0 });
  });

  it("never adopts another caller's claim made after this request's pending row (positive evidence only)", () => {
    const f = fixture();
    // The helper's own go attempt dies before claiming; meanwhile a plain
    // `arcadia go` (another owner) claims the Action. The fixed 2026-08-30
    // pending clock predates that claim, so a timestamp rule would adopt it.
    const foreign = () => runGoCommand({
      repo: f.repo, source: f.repo, apply: true, agent: "claude", workspace: f.workspace, agentWorktreeRoot: path.join(f.root, "manual")
    });
    expect(() => enroll(f, { mode: "prepare", runGo: (options) => {
      if (options.apply) { foreign(); throw new Error("helper go child killed"); }
      return runGoCommand(options);
    } })).toThrow("helper go child killed");
    expect(failedRows(f)).toBe(1);
    const before = worktrees(f);
    // Replay of the failed row: no own marker, so the foreign claim refuses.
    expect(refusal(() => enroll(f, { mode: "prepare" })).details.code).toBe("action_claimed");
    // The same with the row still pending (writer presumed dead after its lease).
    withDatabase(f.workspace, (db) => db.prepare("UPDATE session_enrollments SET status = 'pending', lease_expires_at = ?").run(new Date(NOW.getTime() + 60_000).toISOString()));
    expect(refusal(() => enroll(f, { mode: "prepare" })).details.code).toBe("enrollment_in_progress");
    expect(refusal(() => enroll(f, { mode: "prepare", now: () => new Date(NOW.getTime() + 120_000) })).details.code).toBe("action_claimed");
    expect(state(f)).toMatchObject({ claims: 1, enrollments: 0, pending: 0 });
    expect(failedRows(f)).toBe(1);
    expect(worktrees(f)).toBe(before);
  });

  it("adopts its own claim when go committed it and the adapter then failed", () => {
    const f = fixture();
    const receipt = enroll(f, { mode: "prepare", runGo: (options) => {
      const result = runGoCommand(options);
      if (options.apply) throw new Error("response lost after the claim committed");
      return result;
    } });
    expect(receipt.principal.kind).toBe("prepared");
    expect(receipt.claim?.generation).toEqual(expect.any(String));
    expect(state(f)).toMatchObject({ claims: 1, enrollments: 1, pending: 0 });
    expect(enroll(f, { mode: "prepare" })).toEqual(receipt);
  });

  it("lets a takeover complete while the original go still runs; the original converges on the same receipt", () => {
    const f = fixture();
    let nested: ReturnType<typeof executeHostEnrollment> | undefined;
    let first = true;
    const receipt = enroll(f, { mode: "prepare", pendingLeaseMs: 1_000, runGo: (options) => {
      if (first && options.apply) {
        first = false;
        nested = enroll(f, { mode: "prepare", pendingLeaseMs: 1_000, now: () => new Date(NOW.getTime() + 5_000) });
      }
      return runGoCommand(options);
    } });
    expect(receipt).toEqual(nested);
    expect(state(f)).toMatchObject({ claims: 1, enrollments: 1, pending: 0 });
  });

  it("go refuses an enrollment whose Action the pointer no longer names, before any claim or worktree", () => {
    const f = fixture();
    const before = worktrees(f);
    expect(refusal(() => runGoCommand({
      repo: f.repo, source: f.repo, apply: true, agent: "claude", workspace: f.workspace, strictAction: true,
      agentWorktreeRoot: path.join(f.root, "moved"), enrollment: { requestId: "enroll:claude:runtime-0001", actionId: "moved-away" }
    })).details.code).toBe("enrollment_governance_changed");
    expect(worktrees(f)).toBe(before);
    expect(state(f).claims).toBe(0);
  });

  it("go never activates a Plan or follows a moved pointer for an enrollment, even when activation would select work", () => {
    const f = fixture();
    // The enrolled Action finished; the source pointer no longer names a dispatchable copy of it.
    const plan = path.join(f.repo, "docs", "plans", "copy-proof.md");
    writeFileSync(plan, planDocument.replace("    status: open\n", "    status: done\n"));
    git(f.repo, ["commit", "-qam", "finish define-contract"]);
    const head = git(f.repo, ["rev-parse", "HEAD"]).trim();
    const before = worktrees(f);
    expect(refusal(() => runGoCommand({
      repo: f.repo, source: f.repo, apply: true, agent: "claude", workspace: f.workspace, strictAction: true,
      agentWorktreeRoot: path.join(f.root, "activation"), enrollment: { requestId: "enroll:claude:runtime-0001", actionId: "define-contract" }
    })).details).toMatchObject({ code: "enrollment_governance_changed", expected: "define-contract" });
    expect(git(f.repo, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(worktrees(f)).toBe(before);
    expect(state(f).claims).toBe(0);
  });

  it("recovers a preparation whose receipt was lost after the claim was written", () => {
    const f = fixture();
    const receipt = enroll(f, { mode: "prepare" });
    withDatabase(f.workspace, (db) => db.prepare("UPDATE session_enrollments SET status = 'pending', receipt_json = NULL").run());
    const before = worktrees(f);
    const recovered = enroll(f, { mode: "prepare" });
    expect(recovered.principal).toEqual(receipt.principal);
    expect(recovered.claim).toEqual(receipt.claim);
    expect(worktrees(f)).toBe(before);
  });
});

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
