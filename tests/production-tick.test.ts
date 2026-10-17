import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectIdentityBlock } from "./helpers/identityBlock.js";
import type Database from "better-sqlite3";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { renderProductionStatusSuccess, runProductionStatusCommand } from "../src/commands/production.js";
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
import { buildAgentQueue } from "../src/dispatch/queue.js";
import * as discoverModule from "../src/docs/discover.js";
import { syncProjectDocs } from "../src/docs/sync.js";
import { packetSha256 } from "../src/execution/planningAuthorization.js";
import type { CodingAgentProfile } from "../src/intent/registries.js";
import {
  activateProduction,
  fingerprintProductionScope,
  MECHANICAL_TRANSITIONS,
  normalizeProductionScope,
  PRODUCTION_CONTROL_DEADLINES,
  SIGN_IN_FAILURE_HOLD_MS,
  type ProductionScope
} from "../src/production/policy.js";
import {
  runManagedProductionTick,
  resetProductionRepairBudget,
  listRecentBaseBranchAdvances,
  listLaunchBlockers,
  listOperatorEscalations,
  listProductionAttemptTokens,
  BASE_BRANCH_OBSERVATION_FAILURE_RETRY_MS
} from "../src/production/tick.js";
import { listPendingAgentAskNotifications, listUnsettledAgentAskProposals } from "../src/ask/settlement.js";
import {
  ADMISSION_REFUSAL_MIN_MS,
  ADMISSION_REFUSAL_MIN_TICKS,
  listOpenRedAlerts,
  observeAdmission,
  observeReconcileFailure,
  observeReconcileSuccess,
  safelyRaiseRedAlerts
} from "../src/production/redAlerts.js";
import BetterSqlite3 from "better-sqlite3";
import { sessionLogPath } from "../src/sessions/sessionRecording.js";
import { resolveSessionTimeLimitMs } from "../src/production/sessionLifetime.js";
import { getRepositoryLease, systemTmux, type TmuxAdapter } from "../src/sessions/index.js";
import { getSessionExitReceipt } from "../src/sessions/reconciliation.js";
import { getSchedulingProject } from "../src/scheduling/store.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const profiles: CodingAgentProfile[] = [profile("claude_build", "claude-code-cli")];
const adapters = defaultAdapters as ProviderAdapterRegistry;

class FakeTmux implements TmuxAdapter {
  isAvailable = true;
  failLaunch = false;
  live = new Set<string>();
  launches: Array<{ name: string; cwd: string; command: string; args: string[] }> = [];
  /** Fixture-controlled pane content per Session; capturePane returns "" for any name not present here. */
  paneOutput = new Map<string, string>();
  /** When true, capturePane returns null (a failed/unavailable capture) for every Session. */
  failCapture = false;
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
  capturePane(name: string) {
    if (this.failCapture) return null;
    return this.paneOutput.get(name) ?? "";
  }
  /** Sessions ended through `killSession` (the bounded-lifetime guard), in order. */
  killed: string[] = [];
  /** When true, killSession is a no-op that leaves the Session alive (a failed kill). */
  failKill = false;
  killSession(name: string) {
    this.killed.push(name);
    if (!this.failKill) this.live.delete(name);
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

  it("stops unchanged resumed Sessions at the existing repair budget, preserving their candidate", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    let tickNumber = 0;
    const tick = () => withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + tickNumber++ * 1000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
    }));
    tick();
    const first = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    writeFileSync(path.join(first.worktree_path, "partial.txt"), "first step only\n");
    git(first.worktree_path, ["add", "partial.txt"]);
    git(first.worktree_path, ["commit", "-m", "Partial first Session"]);
    const revision = git(first.worktree_path, ["rev-parse", "HEAD"]).trim();
    tmux.live.delete(first.tmux_session_name);
    tick();
    for (let attempt = 0; attempt < PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction; attempt++) {
      expect(tick().projects.find((p) => p.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
      const resumed = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
      expect(resumed.worktree_path).toBe(first.worktree_path);
      tmux.live.delete(resumed.tmux_session_name);
      tick();
    }
    const result = tick();
    expect(result.projects.find((p) => p.projectSlug === "test-project")?.launch?.outcome).toBe("repair_budget_exhausted");
    expect(tmux.launches).toHaveLength(1 + PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction);
    expect(git(first.worktree_path, ["rev-parse", "HEAD"]).trim()).toBe(revision);
    expect(readFileSync(path.join(first.worktree_path, "partial.txt"), "utf8")).toBe("first step only\n");
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db)))
      .toEqual(expect.arrayContaining([expect.objectContaining({kind: "repair_budget_exhausted"})]));
    // Further ticks neither spend another Session nor lose the retained candidate.
    tick();
    expect(tmux.launches).toHaveLength(1 + PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction);
  });

  it("rolls terminal reconciliation back if retry accounting fails, then records the exit exactly once", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    let tickNumber = 0;
    const tick = () => withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + tickNumber++ * 1000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
    }));
    tick();
    const first = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    writeFileSync(path.join(first.worktree_path, "partial.txt"), "first step\n");
    git(first.worktree_path, ["add", "partial.txt"]);
    git(first.worktree_path, ["commit", "-m", "Partial progress"]);
    tmux.live.delete(first.tmux_session_name); tick(); tick();
    const resumed = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    tmux.live.delete(resumed.tmux_session_name);
    withDatabase(fixture.workspace, (db) => db.exec(`CREATE TRIGGER fail_retry_accounting
      BEFORE INSERT ON production_repair_attempts BEGIN SELECT RAISE(ABORT, 'simulated accounting failure'); END`));
    tick();
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))?.id).toBe(resumed.id);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, resumed.id))).toBeNull();
    withDatabase(fixture.workspace, (db) => db.exec("DROP TRIGGER fail_retry_accounting"));
    tick();
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, resumed.id))?.outcome).toBe("incomplete_resumable");
    tick();
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?")
        .get("test-project/define-contract"))).toEqual({attempts: 1});
  });

  it("refuses before launch, spending nothing, when the Session capability preflight names a wall (A12)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    let tickNumber = 0;
    const tick = () => withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + tickNumber++ * 1000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
      workerCapability: () => [{ wallClass: "workspace_write", evidence: "attempt to write a readonly database", remedy: "Grant workspace write." }]
    }));
    const first = tick().projects.find((p) => p.projectSlug === "test-project")?.launch;
    expect(first?.outcome).toBe("refused");
    expect(first?.reason).toContain("no tokens were spent");
    tick();
    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
    const escalations = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalations.filter((e) => e.kind === "environment_wall")).toHaveLength(1);
    expect(escalations[0]?.remedy).toContain("Grant workspace write.");
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT COUNT(*) AS n FROM production_repair_attempts").get())).toEqual({ n: 0 });
  });

  it("names a launch-side capability wall as one environment_wall blocker, not a silent per-tick refusal (A12)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    let tickNumber = 0;
    const tick = () => withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + tickNumber++ * 1000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
      // The tick's own preflight passes no profile sandbox; only the launch does.
      workerCapability: (_workspace: string, sandbox?: string | null) => sandbox === undefined ? []
        : [{ wallClass: "workspace_write" as const, evidence: "read-only sandbox", remedy: "Use a workspace-write profile." }]
    }));
    expect(tick().projects.find((p) => p.projectSlug === "test-project")?.launch?.outcome).toBe("refused");
    tick();
    expect(tmux.launches).toHaveLength(0);
    const rows = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "environment_wall", remedy: expect.stringContaining("Use a workspace-write profile.") });
  });

  it("replays a no-diff Session that hit workspace-write and sandbox refusals: one named blocker, no second launch (A12)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    let tickNumber = 0;
    const tick = () => withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + tickNumber++ * 1000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
    }));
    tick();
    const first = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    mkdirSync(path.dirname(sessionLogPath(fixture.workspace, first.id)), { recursive: true });
    writeFileSync(sessionLogPath(fixture.workspace, first.id), [
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 11_100_000, output_tokens: 4000 } }),
      "arcadia: SQLITE_WORKSPACE_WRITE_DENIED: attempt to write a readonly database",
      "go test ./... -> operation not permitted (sandbox refused 81 of 84 tests)",
      "preservation launcher produced no receipt"
    ].join("\n"));
    tmux.live.delete(first.tmux_session_name);
    for (let i = 0; i < 4; i++) tick();
    expect(tmux.launches).toHaveLength(1);
    const escalations = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ kind: "budget_exhausted" });
    expect(escalations[0]?.message).toContain("workspace_write");
    expect(escalations[0]?.message).toContain("11100000 input tokens (11100000 uncached + 0 cached)");
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listProductionAttemptTokens(db, "test-project/define-contract")))
      .toEqual([expect.objectContaining({ sessionId: first.id, inputTokens: 11_100_000, cachedInputTokens: 0, outputTokens: 4000 })]);
    const rendered = renderProductionStatusSuccess({
      ok: true, command: "production.status", workspace: fixture.workspace,
      data: {
        read: { status: "unreadable", reason: "fixture" } as never,
        display: { state: "off", label: "Off", observedAt: fixture.now.toISOString() },
        liveAdmissions: 0, admissions: [], baseBranchAdvances: [], launchBlockers: [], operatorEscalations: [],
        attemptTokens: withReadOnlyDatabase(fixture.workspace, (db) => listProductionAttemptTokens(db)),
        offConsequence: "Off.", controlDeadlines: PRODUCTION_CONTROL_DEADLINES
      },
      artifacts: [], warnings: []
    }).join("\n");
    expect(rendered).toContain("test-project/define-contract");
    expect(rendered).toContain("11100000 uncached input, 0 cached input, 4000 output");
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      (db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?").get("test-project/define-contract") as { attempts: number }).attempts))
      .toBeGreaterThanOrEqual(PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction);
  });

  it("clears the no-progress retry count when a resumed candidate actually advances", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    let tickNumber = 0;
    const tick = () => withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux, now: new Date(fixture.now.getTime() + tickNumber++ * 1000),
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
    }));
    const exit = (progress?: string) => {
      const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
      if (progress) {
        writeFileSync(path.join(session.worktree_path, "partial.txt"), progress);
        git(session.worktree_path, ["add", "partial.txt"]);
        git(session.worktree_path, ["commit", "-m", "Partial progress"]);
      }
      tmux.live.delete(session.tmux_session_name);
      tick();
    };
    const attempts = () => withReadOnlyDatabase(fixture.workspace, (db) =>
      (db.prepare("SELECT attempts FROM production_repair_attempts WHERE action_key = ?")
        .get("test-project/define-contract") as {attempts: number} | undefined)?.attempts ?? 0);
    tick(); exit("first step\n");
    tick(); exit(); expect(attempts()).toBe(1);
    tick(); exit("first step\nsecond step\n"); expect(attempts()).toBe(0);
    tick(); exit(); expect(attempts()).toBe(1);
    expect(tick().projects.find((p) => p.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
  });

  it("settles a drafted complete Ask for the pointer instead of launching a Session, when its evidence already covers the Action", () => {
    const fixture = preparedFixture({ secondAction: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    // A previous session did the work and drafted its completion, but ended
    // (or was interrupted) before running the final settle -- exactly the gap
    // this Action closes. The draft's candidate_revision is the commit that
    // produced the artifact; the draft itself lands in a later commit, so by
    // the time the tick runs, HEAD has moved past it only by a governance
    // record, not by anything the evidence validated (Issue #639).
    mkdirSync(path.join(fixture.repo, "docs"), { recursive: true });
    writeFileSync(path.join(fixture.repo, "docs", "contract.md"), "# Contract\n\nDefined by define-contract.\n");
    git(fixture.repo, ["add", "."]);
    git(fixture.repo, ["commit", "-m", "Produce the contract"]);
    const initialHead = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(fixture.repo, ".arcadia", "asks"), { recursive: true });
    writeFileSync(path.join(fixture.repo, ".arcadia", "asks", "agent-ask-complete-define-contract.yaml"), [
      "agent_ask: v1", "request_id: complete-define-contract", "project: test-project", "intent: complete",
      "target_ref: action/define-contract", "desired_result: Accept the completion evidence for define-contract",
      "rationale: The contract file was produced and every criterion is met.",
      `candidate_revision: ${initialHead}`,
      "evidence:", '  - criterion: "The contract exists."', "    status: met", "    note: docs/contract.md was produced.",
      "requested_authority: apply_if_approved", ""
    ].join("\n"));
    git(fixture.repo, ["add", "."]);
    git(fixture.repo, ["commit", "-m", "Draft the contract's completion"]);

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

    const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.launch?.outcome).toBe("auto_settled");
    expect(project.launch?.actionKey).toBe("test-project/define-contract");
    // No coding-agent process was spawned, and no repository lease was taken
    // for one -- the whole point of settling instead of dispatching.
    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
    expect(execFileSync("git", ["show", "HEAD:PROJECT.md"], { cwd: fixture.repo, encoding: "utf8" })).toContain("current_action: second-action");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: fixture.repo, encoding: "utf8" })).toBe("");
  });

  it("logs a refused launch with its code so an operator tailing worker.log can see why nothing starts", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const wrongScope = normalizeProductionScope({ ...productionScope, providers: ["opencode"] });
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-grant-wrong-provider",
        scope: wrongScope,
        scopeFingerprint: fingerprintProductionScope(wrongScope),
        grantedBy: "operator"
      })
    );
    const log = vi.fn();

    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: fixture.now,
        log,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );

    expect(result.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("refused");
    expect(tmux.launches).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/Launch refused for test-project\/define-contract \[provider_not_permitted\]: provider not permitted:/)
    );

    // A transient conflict (capacity/Off/stale-preview/lease) is an expected
    // wait state: no durable escalation is ever recorded for it, tick after
    // tick, exactly as before this capability existed. But an *identical*
    // refusal line is not re-logged on every tick (Issue #559): the durable
    // row in `production_launch_refusal_log`, not a fresh log line each tick,
    // is the fact worth keeping -- otherwise a broken repository logs the
    // same sentence once per ~2s producer tick forever.
    const secondTickLog = vi.fn();
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 60_000),
        log: secondTickLog,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(secondTickLog).not.toHaveBeenCalledWith(expect.stringMatching(/Launch refused/));
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);

    // Once the policy is fixed to permit the packet's bound provider again,
    // the launch succeeds and the refusal-dedup row is cleared -- so a later
    // regression of the same kind is reported fresh, not silently swallowed
    // forever by a stale row.
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-grant-fixed-provider",
        scope: productionScope,
        scopeFingerprint: fingerprintProductionScope(productionScope),
        grantedBy: "operator"
      })
    );
    const thirdTickLog = vi.fn();
    const thirdResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 120_000),
        log: thirdTickLog,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(thirdResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
    expect(thirdTickLog).not.toHaveBeenCalledWith(expect.stringMatching(/Launch refused/));
  });

  it("automatically requests a Decision-gated planning run instead of silently stalling on planning_required (Issue #584), then names the approval wait once after the dwell (A3)", () => {
    const fixture = preparedFixture({ skipPacket: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    // Seed a pre-existing escalation, as if an earlier tick (before this fix,
    // or an earlier attempt) had already surfaced this exact stall to the
    // operator. Proving it clears -- not merely that a fresh one is never
    // created -- is what "clears... through the tick's normal resolution
    // path" actually requires.
    withDatabase(fixture.workspace, (db) =>
      db
        .prepare(
          `INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
             VALUES ('test-project/define-contract', 'planning_required', 'stall', 'remedy', ?, ?)`
        )
        .run(fixture.now.toISOString(), fixture.now.toISOString())
    );
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(1);

    const ticks = [0, 60_000, 120_000].map((offsetMs) => {
      const log = vi.fn();
      const result = withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles,
          adapters,
          tmux,
          now: new Date(fixture.now.getTime() + offsetMs),
          log,
          capacityObservation: fixtureCapacityObservation(),
          agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
      return { result, log };
    });

    for (const { result } of ticks) {
      expect(result.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("refused");
    }
    expect(tmux.launches).toHaveLength(0);

    // The stall is resolved automatically the very first tick that discovers
    // it -- no human or agent had to notice and run `arcadia work plan` by
    // hand. The resulting approval wait is not escalated while it is young,
    // then exactly once after the dwell (A3: the Review item alone hid it).
    expect(ticks[0].log).toHaveBeenCalledWith(
      expect.stringMatching(/Automatically requested a Decision-gated planning run for test-project\/define-contract/)
    );
    expect(ticks[0].log).not.toHaveBeenCalledWith(expect.stringMatching(/Escalated/));
    expect(ticks[1].log).not.toHaveBeenCalledWith(expect.stringMatching(/Escalated/));
    expect(ticks[2].log).toHaveBeenCalledWith(expect.stringMatching(/Escalated test-project\/define-contract .*planning_run_approval_pending/));
    // Only the first tick does the work; once the Decision exists, later
    // ticks find `planning_approval_pending` and never re-invoke `work plan`.
    expect(ticks[1].log).not.toHaveBeenCalledWith(expect.stringMatching(/Automatically/));
    expect(ticks[2].log).not.toHaveBeenCalledWith(expect.stringMatching(/Automatically/));

    // The seeded planning_required row was replaced, in the one-row-per-Action
    // table, by the named approval wait: exactly one blocker, one ping.
    const named = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({ actionKey: "test-project/define-contract", kind: "planning_run_approval_pending" });
    expect(named[0].message).toMatch(/planning-run approval for test-project\/define-contract/);
    expect(named[0].remedy).toMatch(/Press "Approve planning run" on \/todo \(review_item:test-project\/review_/);
    const pings = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT kind, todo_key FROM operator_pings").all()
    ) as Array<{ kind: string; todo_key: string }>;
    expect(pings).toHaveLength(1);
    expect(pings[0]).toMatchObject({ kind: "attention" });
    expect(pings[0].todo_key).toMatch(/^review_item:test-project\/review_/);

    // The approval gate itself is preserved, not bypassed: exactly one open
    // CodexPlanningRunApproval Decision exists, unapproved, for this Action.
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;
    const decisions = withReadOnlyDatabase(fixture.workspace, (db) =>
      db
        .prepare("SELECT resolved_intent, status FROM review_items WHERE work_item_id = ? ORDER BY created_at ASC")
        .all(workItem.id)
    ) as Array<{ resolved_intent: string; status: string }>;
    expect(decisions).toEqual([{ resolved_intent: "CodexPlanningRunApproval", status: "open" }]);
  });

  it.each([
    ["CodexPlanningArtifactAcceptance", "planning_artifact_acceptance_pending", "Accept plan"],
    ["CodexPlanningRetryApproval", "planning_run_approval_pending", "Approve planning retry"]
  ])("names a %s wait once with its button and one ping (A3)", (intent, kind, button) => {
    const fixture = preparedFixture({ skipPacket: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const tick = (offsetMs: number) =>
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles, adapters, tmux, now: new Date(fixture.now.getTime() + offsetMs), log: vi.fn(),
          capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
    tick(0);
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;
    const at = new Date(fixture.now.getTime() + 1_000).toISOString();
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE review_items SET status = 'approved' WHERE work_item_id = ?").run(workItem.id);
      db.prepare(`INSERT INTO review_items (id, work_item_id, status, decision_needed, recommendation, source_input, proposed_action, resolved_intent,
          confidence_label, confidence, missing_fields, context_json, created_at, updated_at)
        SELECT 'review_gate_wait', work_item_id, 'open', 'Gate wait', NULL, source_input, proposed_action, ?,
          confidence_label, confidence, missing_fields, context_json, ?, ? FROM review_items WHERE work_item_id = ? LIMIT 1`)
        .run(intent, at, at, workItem.id);
    });
    tick(70_000);
    tick(140_000);
    tick(150_000);
    const rows = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind });
    expect(rows[0].message).toContain("review item review_gate_wait");
    expect(rows[0].remedy).toContain(`Press "${button}" on /todo`);
    const pings = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT todo_key FROM operator_pings").all()) as Array<{ todo_key: string }>;
    expect(pings).toHaveLength(1);
    expect(pings[0].todo_key).toBe("review_item:test-project/review_gate_wait");
  });

  it("never names a gate that is only an agent-review-flagged deferred item, which /todo hides (A3)", () => {
    const fixture = preparedFixture({ skipPacket: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const tick = (offsetMs: number) =>
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles, adapters, tmux, now: new Date(fixture.now.getTime() + offsetMs), log: vi.fn(),
          capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
    tick(0);
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE review_items SET status = 'deferred', context_json = ? WHERE work_item_id = ?")
        .run(JSON.stringify({ agentReview: { status: "flagged" } }), workItem.id);
    });
    tick(70_000);
    tick(140_000);
    tick(150_000);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT 1 FROM operator_pings").all())).toHaveLength(0);
  });

  it("keeps the tick's gate button labels equal to the dashboard's one-click controls (A3 drift guard)", async () => {
    const { PLANNING_REVIEW_CONTROLS } = await import("../apps/dashboard/lib/approvals.js");
    const { STALLED_PLANNING_GATES } = await import("../src/production/tick.js");
    for (const [intent, gate] of Object.entries(STALLED_PLANNING_GATES)) {
      expect(PLANNING_REVIEW_CONTROLS[intent]?.approveLabel, intent).toBe(gate.button);
    }
  });

  it("names the artifact-validation wait after the run approval, one ping per gate (A3)", () => {
    const fixture = preparedFixture({ skipPacket: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const tick = (offsetMs: number) => {
      const log = vi.fn();
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles, adapters, tmux, now: new Date(fixture.now.getTime() + offsetMs), log,
          capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
      return log;
    };
    const escalations = () => withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    const pings = () => withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT message FROM operator_pings").all()) as Array<{ message: string }>;

    tick(0); // prepares the planning-run approval
    expect(escalations()).toHaveLength(0); // young wait: not escalated yet
    expect(pings()).toHaveLength(0);
    tick(70_000); // the approval wait's own episode starts here
    expect(escalations()).toHaveLength(0);
    tick(140_000);
    expect(escalations().map((row) => row.kind)).toEqual(["planning_run_approval_pending"]);
    expect(pings()).toHaveLength(1);

    // The run was approved and produced its artifact: a validation item is open.
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;
    const at = new Date(fixture.now.getTime() + 90_000).toISOString();
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE review_items SET status = 'approved' WHERE work_item_id = ?").run(workItem.id);
      db.prepare(`INSERT INTO review_items (id, work_item_id, status, decision_needed, recommendation, source_input, proposed_action, resolved_intent,
          confidence_label, confidence, missing_fields, context_json, created_at, updated_at)
        SELECT 'review_validation_wait', work_item_id, 'open', 'Validate the planning artifact', NULL, source_input, proposed_action,
          'codex_planning_artifact_validation', confidence_label, confidence, missing_fields, context_json, ?, ? FROM review_items WHERE work_item_id = ? LIMIT 1`)
        .run(at, at, workItem.id);
    });
    tick(150_000);
    tick(220_000);
    const second = escalations();
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ kind: "planning_artifact_validation_pending" });
    expect(second[0].message).toContain("review item review_validation_wait: planning-artifact validation for test-project/define-contract");
    expect(second[0].remedy).toContain('Press "Retry planning" on /todo');
    // Same gate on later ticks: still one row, no second ping for it.
    tick(250_000);
    tick(280_000);
    expect(escalations()).toHaveLength(1);
    expect(pings()).toHaveLength(2);

    // Answered: the row clears on the first tick after the gate is gone.
    withDatabase(fixture.workspace, (db) => db.prepare("UPDATE review_items SET status = 'approved' WHERE id = 'review_validation_wait'").run());
    tick(310_000);
    expect(escalations().map((row) => row.kind)).not.toContain("planning_artifact_validation_pending");
  });

  it("prunes an escalation left over from an Action that is no longer current", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    // Simulate a stale row: some earlier Action was escalated and then
    // stopped being current by a route this tick never observes directly
    // (e.g. marked done through a `complete` Agent Ask rather than through
    // this tick's own launch success). Nothing in the fixture ever makes
    // "test-project/stale-old-action" current, so the only way this row can
    // disappear is the pruning this test exists to prove.
    withDatabase(fixture.workspace, (db) =>
      db
        .prepare(
          `INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
             VALUES ('test-project/stale-old-action', 'planning_required', 'stale', 'stale remedy', ?, ?)`
        )
        .run(fixture.now.toISOString(), fixture.now.toISOString())
    );

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
    expect(result.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");

    const escalations = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalations).toHaveLength(0);
  });

  it("keeps an escalation during a temporary wait transition for the same Action", () => {
    const fixture = preparedFixture({ skipPacket: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    // Seed a pre-existing escalation directly rather than by running a tick:
    // `planning_required` now resolves itself automatically (see the test
    // above), so this scenario -- an escalation that already exists, from
    // before this fix or from a resolution attempt that genuinely could not
    // help -- must be constructed rather than produced as a side effect. The
    // behavior under test is pruning during a transient wait, independent of
    // how the row got there.
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;
    withDatabase(fixture.workspace, (db) =>
      db
        .prepare(
          `INSERT INTO production_operator_escalations (action_key, kind, message, remedy, first_detected_at, last_seen_at)
             VALUES ('test-project/define-contract', 'planning_required', 'stall', 'remedy', ?, ?)`
        )
        .run(fixture.now.toISOString(), fixture.now.toISOString())
    );

    // A competing managed Run now holds the repository -- `resolveProjectTransition`
    // resolves `dispatch` (and therefore the selected Action) before it ever
    // checks for this, so "wait" is a transient state for the *same* Action,
    // not a pointer change, and must not be read as one.
    recordCompetingManagedRun(fixture.workspace, workItem.id);

    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(result.projects.find((entry) => entry.projectSlug === "test-project")?.launch).toMatchObject({
      attempted: false,
      outcome: "skipped"
    });

    const escalations = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ actionKey: "test-project/define-contract", kind: "planning_required" });
  });

  it("automatically prepares a build packet deterministically when the Action needs no Decision-gated planning run, and reaches launch within a bounded number of ticks", () => {
    // `runWorkPlanCommand` selects the workspace's own registry default build
    // profile (`codex_build`/codex-cli) when the Action carries no execution
    // requirement, which is a different provider than this file's shared
    // `profiles`/`adapters` fixture (claude-code-cli) -- so this test proves
    // capacity for the provider the automatic preparation actually binds to.
    const codexProfiles: CodingAgentProfile[] = [profile("codex_build", "codex-cli")];
    const codexCapacity: ProviderCapacityObservation = {
      generatedAt: "2026-08-30T12:34:56.000Z",
      providers: [{ ...provenCapacity(), providerId: "codex-cli", receipt: { ...provenCapacity().receipt, providerId: "codex-cli", providerLabel: "codex-cli" } }]
    };
    const fixture = preparedFixture({ skipPacket: true, buildAction: true });
    const tmux = new FakeTmux();
    const codexScope = normalizeProductionScope({ ...productionScope, providers: ["codex-cli"] });
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-grant-codex",
        scope: codexScope,
        scopeFingerprint: fingerprintProductionScope(codexScope),
        grantedBy: "operator"
      })
    );
    const log = vi.fn();

    const firstResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles: codexProfiles,
        adapters,
        tmux,
        now: fixture.now,
        log,
        capacityObservation: codexCapacity,
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );

    expect(firstResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("refused");
    expect(tmux.launches).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/Automatically prepared a build packet for test-project\/define-contract/)
    );
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);

    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;

    // No new prompt scheme was invented: the prepared packet's prompt text
    // comes from packets.ts's own `renderPrompt` template, the same one every
    // other packet in this codebase uses.
    const invocation = withReadOnlyDatabase(fixture.workspace, (db) =>
      db
        .prepare(
          "SELECT id, prompt_path FROM codex_invocations WHERE work_item_id = ? AND purpose = 'build' ORDER BY created_at DESC LIMIT 1"
        )
        .get(workItem.id)
    ) as { id: string; prompt_path: string };
    const promptText = readFileSync(path.join(fixture.workspace, invocation.prompt_path), "utf8");
    expect(promptText).toMatch(/^# Arcadia .* Build Packet/);
    expectIdentityBlock(promptText, "codex", "standard");

    const pendingApprovalId = withReadOnlyDatabase(fixture.workspace, (db) =>
      (db
        .prepare(
          "SELECT id FROM review_items WHERE work_item_id = ? AND resolved_intent = 'CodexBuildPacketApproval' AND status = 'open' ORDER BY created_at DESC LIMIT 1"
        )
        .get(workItem.id) as { id: string }).id
    );

    // Until it is approved, the tick must say so where the operator watches
    // (`production status`), naming the exact approval -- not refuse silently
    // as a "stale" packet visible only in the worker log.
    const waitingResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles: codexProfiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 30_000),
        capacityObservation: codexCapacity,
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(waitingResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("refused");
    expect(tmux.launches).toHaveLength(0);
    const waiting = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ actionKey: "test-project/define-contract", kind: "build_packet_approval_pending" });
    expect(waiting[0].remedy).toContain(`arcadia review approve ${pendingApprovalId} --no-execute`);

    // The build packet still needs its own, pre-existing, unrelated approval
    // gate (`CodexBuildPacketApproval`) -- this fix never bypasses it. Approve
    // it exactly as Review already does today, standing in for the operator.
    withDatabase(fixture.workspace, (db) => {
      updateReviewItemStatus(db, pendingApprovalId, { status: "approved", decisionNote: "Fixture approval." });
    });

    const secondResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles: codexProfiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: codexCapacity,
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(secondResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
    expect(tmux.launches).toHaveLength(1);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);
  });

  it("approves a pending build packet itself, then launches, only when the standing policy names packet_approval (Decision 0072)", () => {
    const codexProfiles: CodingAgentProfile[] = [profile("codex_build", "codex-cli")];
    const codexCapacity: ProviderCapacityObservation = {
      generatedAt: "2026-08-30T12:34:56.000Z",
      providers: [{ ...provenCapacity(), providerId: "codex-cli", receipt: { ...provenCapacity().receipt, providerId: "codex-cli", providerLabel: "codex-cli" } }]
    };
    const fixture = preparedFixture({ skipPacket: true, buildAction: true });
    const tmux = new FakeTmux();
    const delegatingScope = normalizeProductionScope({
      ...productionScope,
      providers: ["codex-cli"],
      mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"],
      packetApprovalExpiresAt: "2099-01-01T00:00:00.000Z"
    });
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-grant-packet-approval",
        scope: delegatingScope,
        scopeFingerprint: fingerprintProductionScope(delegatingScope),
        grantedBy: "operator"
      })
    );
    const log = vi.fn();
    const tick = (offsetMs: number) =>
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles: codexProfiles,
          adapters,
          tmux,
          now: new Date(fixture.now.getTime() + offsetMs),
          log,
          capacityObservation: codexCapacity,
          agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );

    tick(0); // prepares the packet; its approval is still open
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;
    const approvalRow = () => withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare(
        "SELECT id, status, decision_note FROM review_items WHERE work_item_id = ? AND resolved_intent = 'CodexBuildPacketApproval' ORDER BY created_at DESC LIMIT 1"
      ).get(workItem.id) as { id: string; status: string; decision_note: string | null }
    );
    expect(approvalRow().status).toBe("open");

    const approving = tick(30_000);
    expect(approving.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.reason).toMatch(/packet_approval delegation/);
    expect(approvalRow().status).toBe("approved");
    expect(approvalRow().decision_note).toMatch(/standing production policy \(revision \d+, epoch \d+\)/);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);
    expect(tmux.launches).toHaveLength(0);

    const launching = tick(60_000);
    expect(launching.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
    expect(tmux.launches).toHaveLength(1);
  });

  it("never approves a packet whose Plan is outside the grant, even when the Action key and packet_approval are in scope", () => {
    const codexProfiles: CodingAgentProfile[] = [profile("codex_build", "codex-cli")];
    const codexCapacity: ProviderCapacityObservation = {
      generatedAt: "2026-08-30T12:34:56.000Z",
      providers: [{ ...provenCapacity(), providerId: "codex-cli", receipt: { ...provenCapacity().receipt, providerId: "codex-cli", providerLabel: "codex-cli" } }]
    };
    const fixture = preparedFixture({ skipPacket: true, buildAction: true });
    const tmux = new FakeTmux();
    const outOfPlanScope = normalizeProductionScope({
      ...productionScope,
      plans: ["test-project/some-other-plan"],
      providers: ["codex-cli"],
      mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"],
      packetApprovalExpiresAt: "2099-01-01T00:00:00.000Z"
    });
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-grant-out-of-plan",
        scope: outOfPlanScope,
        scopeFingerprint: fingerprintProductionScope(outOfPlanScope),
        grantedBy: "operator"
      })
    );
    for (const offsetMs of [0, 30_000, 60_000]) {
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles: codexProfiles,
          adapters,
          tmux,
          now: new Date(fixture.now.getTime() + offsetMs),
          log: vi.fn(),
          capacityObservation: codexCapacity,
          agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
    }
    const approvals = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT status FROM review_items WHERE resolved_intent = 'CodexBuildPacketApproval'").all() as Array<{ status: string }>
    );
    expect(approvals.length).toBeGreaterThan(0);
    expect(approvals.every((row) => row.status !== "approved")).toBe(true);
    expect(tmux.launches).toHaveLength(0);
  });

  it("never approves a packet once the packet_approval delegation has expired (Decision 0072)", () => {
    const codexProfiles: CodingAgentProfile[] = [profile("codex_build", "codex-cli")];
    const codexCapacity: ProviderCapacityObservation = {
      generatedAt: "2026-08-30T12:34:56.000Z",
      providers: [{ ...provenCapacity(), providerId: "codex-cli", receipt: { ...provenCapacity().receipt, providerId: "codex-cli", providerLabel: "codex-cli" } }]
    };
    const fixture = preparedFixture({ skipPacket: true, buildAction: true });
    const tmux = new FakeTmux();
    const expiringScope = normalizeProductionScope({
      ...productionScope,
      providers: ["codex-cli"],
      mechanicalTransitions: ["validation", "acceptance", "pointer", "packet_approval"],
      // Lapses before the second tick, which is the first one that could approve.
      packetApprovalExpiresAt: new Date(fixture.now.getTime() + 10_000).toISOString()
    });
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-grant-expiring-packet-approval",
        scope: expiringScope,
        scopeFingerprint: fingerprintProductionScope(expiringScope),
        grantedBy: "operator"
      })
    );
    for (const offsetMs of [0, 30_000, 60_000]) {
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles: codexProfiles,
          adapters,
          tmux,
          now: new Date(fixture.now.getTime() + offsetMs),
          log: vi.fn(),
          capacityObservation: codexCapacity,
          agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
    }
    const approvals = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT status FROM review_items WHERE resolved_intent = 'CodexBuildPacketApproval'").all() as Array<{ status: string }>
    );
    expect(approvals.length).toBeGreaterThan(0);
    expect(approvals.every((row) => row.status !== "approved")).toBe(true);
    expect(tmux.launches).toHaveLength(0);
  });

  it("refuses packet_approval without an expiry, and an expiry without packet_approval", () => {
    expect(() => normalizeProductionScope({ ...productionScope, mechanicalTransitions: ["packet_approval"] })).toThrow(/needs a strict RFC 3339 UTC expiry/);
    expect(() =>
      normalizeProductionScope({ ...productionScope, mechanicalTransitions: ["packet_approval"], packetApprovalExpiresAt: "2026-02-30T00:00:00Z" })
    ).toThrow(/needs a strict RFC 3339 UTC expiry/);
    expect(() =>
      normalizeProductionScope({ ...productionScope, mechanicalTransitions: ["validation"], packetApprovalExpiresAt: "2099-01-01T00:00:00.000Z" })
    ).toThrow(/needs the packet_approval transition/);
  });

  it("never implies packet_approval: the default grant omits it, and naming it is the only way in", () => {
    expect(MECHANICAL_TRANSITIONS).not.toContain("packet_approval");
    const named = normalizeProductionScope({
      ...productionScope,
      mechanicalTransitions: ["packet_approval"],
      packetApprovalExpiresAt: "2099-01-01T00:00:00.000Z"
    });
    expect(named.mechanicalTransitions).toEqual(["packet_approval"]);
    expect(() => normalizeProductionScope({ ...productionScope, mechanicalTransitions: ["approve_everything" as never] })).toThrow(/Unknown mechanical transition/);
  });

  it("escalates to the operator instead of launching, once, when the Project declares no validation commands", () => {
    // A Project with no validation commands can never have its Session
    // preserved or auto-completed (see preservationValidation.ts and
    // packets.ts), so this refusal is never self-resolving -- unlike
    // `planning_required`, this tick must not keep attempting the same
    // refused launch on every subsequent tick either.
    const fixture = preparedFixture({ noValidationCommands: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const log = vi.fn();

    const firstResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: fixture.now,
        log,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(firstResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("refused");
    expect(tmux.launches).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Escalated test-project\/define-contract to the operator \(no_validation_commands\)/));

    const escalations = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ actionKey: "test-project/define-contract", kind: "no_validation_commands" });
    expect(escalations[0].remedy).toMatch(/arcadia project metadata .* --validation-command/);

    // A second tick, with the escalation already recorded and the Project
    // still declaring no validation commands, skips the launch attempt
    // entirely (a single cheap metadata re-read) rather than repeating the
    // full preview only to rediscover the identical refusal.
    const secondResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(secondResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch).toMatchObject({
      attempted: false,
      outcome: "skipped"
    });
    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(1);

    // Once the operator declares a validation command, the very next tick
    // resolves and launches -- proving the re-read is live, not cached.
    withDatabase(fixture.workspace, (db) => {
      const project = getProjectBySlug(db, "test-project")!;
      upsertProjectMetadata(db, {
        projectId: project.id,
        repoPath: fixture.repo,
        validationCommands: ["node -e \"process.exit(0)\""]
      });
    });
    const thirdResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 120_000),
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(thirdResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
    expect(tmux.launches).toHaveLength(1);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);
  });

  it("escalates a depends_on id that stays unresolved for more than one worker tick, instead of waiting silently", () => {
    // "plan/no-such-plan#no-such-action" names no Plan anywhere in this
    // fixture, so it can never resolve on its own the way an ordinary
    // unfinished dependency would once the other work finishes.
    const fixture = preparedFixture({ dependsOnUnresolved: true, skipPacket: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const log = vi.fn();

    const firstResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: fixture.now,
        log,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(firstResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch).toMatchObject({
      attempted: false,
      outcome: "skipped"
    });
    // The first tick to see this unresolved id only records the sighting -- a
    // reference that is wrong for one tick and fixed before the next must
    // never reach the operator.
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/Escalated/));
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);

    const secondResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 60_000),
        log,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(secondResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch).toMatchObject({
      attempted: false,
      outcome: "skipped"
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/Escalated test-project\/define-contract to the operator \(dependency_unresolved\)/)
    );

    const escalations = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({ actionKey: "test-project/define-contract", kind: "dependency_unresolved" });
    expect(escalations[0].message).toContain("plan/no-such-plan#no-such-action");
    expect(escalations[0].remedy).toContain("plan/no-such-plan#no-such-action");

    // A third tick with the escalation already recorded keeps reporting it,
    // rather than an escalation that only ever fires once.
    const thirdResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 120_000),
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(thirdResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch).toMatchObject({
      attempted: false,
      outcome: "skipped"
    });
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(1);
  });

  it("never binds an automatically prepared build packet to a provider the standing policy does not permit", () => {
    // The workspace's own registry default build profile is `codex_build`
    // (codex-cli) -- see config/defaults/coding-agent-profiles.json -- but
    // this file's shared `profiles`/`productionScope` fixture permits only
    // claude-code-cli. Before requesting a policy-permitted profile up front,
    // automatic preparation would bind the immutable packet to codex-cli
    // anyway, report `build_packet_ready`, and clear the escalation -- and
    // every later tick would then refuse with `provider_not_permitted`
    // forever, invisibly, because that refusal carries no packetLifecycleKind
    // and the packet can never rebind itself (CodeRabbit finding, PR #586).
    const fixture = preparedFixture({ skipPacket: true, buildAction: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const log = vi.fn();

    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: fixture.now,
        log,
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );

    expect(result.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("refused");
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/Automatically prepared a build packet for test-project\/define-contract/)
    );

    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract"))!;
    const invocation = withReadOnlyDatabase(fixture.workspace, (db) =>
      db
        .prepare(
          "SELECT agent_profile FROM codex_invocations WHERE work_item_id = ? AND purpose = 'build' ORDER BY created_at DESC LIMIT 1"
        )
        .get(workItem.id)
    ) as { agent_profile: string };
    expect(invocation.agent_profile).toBe("claude_build");

    // A second tick, with the resulting CodexBuildPacketApproval approved,
    // reaches launch on the permitted provider -- proving the packet was
    // never stuck bound to codex-cli in the first place.
    withDatabase(fixture.workspace, (db) => {
      const approval = db
        .prepare(
          "SELECT id FROM review_items WHERE work_item_id = ? AND resolved_intent = 'CodexBuildPacketApproval' AND status = 'open' ORDER BY created_at DESC LIMIT 1"
        )
        .get(workItem.id) as { id: string };
      updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture approval." });
    });
    const secondResult = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(secondResult.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
    expect(tmux.launches).toHaveLength(1);
  });

  it("reports no escalations, rather than throwing, against a database created before this table existed", () => {
    const fixture = preparedFixture();
    withDatabase(fixture.workspace, (db) => db.exec("DROP TABLE production_operator_escalations"));

    const escalations = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalations).toEqual([]);
  });

  it("refuses a signed-out provider before any lease or admission, and never counts it against the repair budget", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const providerSignIn = () => ({ signedIn: false, remedy: "Run \"claude auth login\" on this worker." });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles,
          adapters,
          tmux,
          now: new Date(fixture.now.getTime() + attempt * 60_000),
          capacityObservation: fixtureCapacityObservation(),
          agentWorktreeRoot: fixture.agentWorktreeRoot,
          providerSignIn
        })
      );
      const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
      // Exceeding maxRepairAttemptsPerAction (2) across these iterations would
      // flip this to "repair_budget_exhausted" if the refusal were wrongly
      // counted as a repair-worthy failure; it stays "refused" every time.
      expect(project.launch?.outcome).toBe("refused");
      expect(project.launch?.reason).toContain("is not signed in for this worker");
    }
    expect(tmux.launches).toHaveLength(0);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))).toBeNull();
  });

  it("surfaces a signed-out provider's refusal in arcadia production status as the Project launch blocker, and clears it once sign-in is restored", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const signedOut = () => ({ signedIn: false, remedy: "Run \"claude auth login\" on this worker." });

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: fixture.now,
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        providerSignIn: signedOut
      })
    );

    const blockers = withReadOnlyDatabase(fixture.workspace, (db) => listLaunchBlockers(db));
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ projectSlug: "test-project", code: "provider_not_signed_in" });
    expect(blockers[0]?.reason).toContain("is not signed in for this worker");

    const rendered = renderProductionStatusSuccess({
      ok: true,
      command: "production.status",
      workspace: fixture.workspace,
      data: {
        read: { status: "unreadable", reason: "fixture" } as never,
        display: { state: "off", label: "Off", observedAt: fixture.now.toISOString() },
        liveAdmissions: 0,
        admissions: [],
        baseBranchAdvances: [],
        launchBlockers: blockers,
        operatorEscalations: [],
        offConsequence: "Off.",
        controlDeadlines: PRODUCTION_CONTROL_DEADLINES
      },
      artifacts: [],
      warnings: []
    }).join("\n");
    expect(rendered).toContain("Launch blocked (1):");
    expect(rendered).toContain("test-project [provider_not_signed_in]");
    expect(rendered).toContain("is not signed in for this worker");

    // The provider is signed in again on the next tick: the launch succeeds
    // and the durable blocker clears rather than lingering with a stale reason.
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listLaunchBlockers(db))).toHaveLength(0);
    expect(tmux.launches).toHaveLength(1);
  });

  it("pings the operator once, naming the provider and remedy, for a repeated sign-in refusal without touching the workspace config", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const configPath = path.join(fixture.workspace, "config");
    const listConfig = () => (existsSync(configPath) ? readdirSync(configPath).sort().join(",") : "");
    const configBefore = listConfig();
    const expired = () => ({ signedIn: false, remedy: "The stored Claude Code login has no refresh token. Run \"claude auth login\" on this worker." });
    for (const offset of [0, 60_000, 120_000]) {
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles, adapters, tmux, now: new Date(fixture.now.getTime() + offset),
          capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
          providerSignIn: expired
        })
      );
    }
    const pings = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT message, kind FROM operator_pings").all() as Array<{ message: string; kind: string }>);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.kind).toBe("attention");
    expect(pings[0]?.message).toContain("is not signed in for this worker");
    expect(pings[0]?.message).toContain("claude auth login");
    expect(tmux.launches).toHaveLength(0);
    expect(listConfig()).toBe(configBefore);
  });

  it("clears a sign-in blocker the moment sign-in is confirmed, even when the launch then fails for an unrelated reason", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const signedOut = () => ({ signedIn: false, remedy: "Run \"claude auth login\" on this worker." });

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: fixture.now,
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        providerSignIn: signedOut
      })
    );
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listLaunchBlockers(db))).toHaveLength(1);

    // Sign-in is now confirmed, but the spawn itself fails for an unrelated
    // reason (a real, repair-worthy defect). The stale sign-in blocker must
    // not linger and keep telling the operator to sign in.
    tmux.failLaunch = true;
    const signedIn = () => ({ signedIn: true, remedy: "unused" });
    const result = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        providerSignIn: signedIn
      })
    );

    const project = result.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(project.launch?.outcome).toBe("failed");
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listLaunchBlockers(db))).toHaveLength(0);
  });

  it("does not schedule or commit a pointer outside the active production scope", () => {
    const fixture = preparedFixture({ secondAction: true });
    const projectPath = path.join(fixture.repo, "PROJECT.md");
    writeFileSync(projectPath, readFileSync(projectPath, "utf8").replace("current_action: define-contract", "current_action: second-action"));
    git(fixture.repo, ["add", "PROJECT.md"]);
    git(fixture.repo, ["commit", "-m", "fixture pointer needs alignment"]);
    const before = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    const narrowed = normalizeProductionScope({ ...productionScope, projects: ["another-project"] });
    withDatabase(fixture.workspace, (db) => activateProduction(db, {
      requestId: "out-of-scope-scheduling", scope: narrowed,
      scopeFingerprint: fingerprintProductionScope(narrowed), grantedBy: "operator"
    }));
    const result = withDatabase(fixture.workspace, (db) => runManagedProductionTick(db, fixture.workspace, {
      profiles, adapters, tmux: new FakeTmux(), now: fixture.now,
      capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
    }));
    expect(result.scheduling?.projects).toEqual([]);
    expect(readFileSync(projectPath, "utf8")).toContain("current_action: second-action");
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(before);
  });

  it("never previews or refuses a launch for a Project outside the active policy scope, while still reconciling its live Session", () => {
    const fixture = preparedFixture({ secondAction: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const first = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: fixture.now,
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(first.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;

    // Re-grant production scoped to a different Project, so test-project is now
    // outside the standing policy while its Session is still live.
    const narrowed = normalizeProductionScope({ ...productionScope, projects: ["another-project"] });
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, {
        requestId: "policy-grant-narrowed",
        scope: narrowed,
        scopeFingerprint: fingerprintProductionScope(narrowed),
        grantedBy: "operator"
      })
    );

    // The candidate makes real, evidenced progress and its tmux dies without
    // ever calling `session reconcile` itself: reconciliation is a safety path
    // and must still notice an out-of-scope Project's dead Session.
    completeActionInWorktree(session.worktree_path, "define-contract");
    recordPassingRun(fixture.workspace, session.work_item_id);
    tmux.live.delete(session.tmux_session_name);

    // Advance the governed base branch independently of the Session worktree,
    // so a tick that still observed out-of-scope Projects would report it.
    writeFileSync(path.join(fixture.repo, "EXTERNAL.md"), "merged externally\n");
    git(fixture.repo, ["add", "EXTERNAL.md"]);
    git(fixture.repo, ["commit", "-m", "external merge"]);

    const log = vi.fn();
    const second = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000),
        log, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const project = second.projects.find((entry) => entry.projectSlug === "test-project")!;
    // Reconciliation still ran: the dead Session is reconciled out of scope.
    // Without scope authority no mechanical completion settles, so the
    // evidenced candidate is classified resumable rather than accepted.
    expect(project.reconciled).toHaveLength(1);
    expect(project.reconciled[0]?.outcome).toBe("incomplete_resumable");
    // Base-branch observation was skipped entirely for the out-of-scope Project.
    expect(project.baseBranchAdvance).toBeNull();
    // But no launch was attempted and no misleading refusal was logged.
    expect(project.launch).toMatchObject({ attempted: false, outcome: "skipped" });
    expect(project.launch?.reason).toMatch(/outside the standing production policy scope/);
    expect(tmux.launches).toHaveLength(1);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/Launch refused/));
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

    // The candidate records criterion-level evidence in a complete Ask, plus
    // an audit Run, and the tmux Session exits (dies)
    // without ever calling `session reconcile` itself -- the exact situation
    // this Action's continuation loop must notice on its own.
    completeActionInWorktree(session.worktree_path, "define-contract");
    mkdirSync(path.join(session.worktree_path, ".arcadia", "asks"), { recursive: true });
    writeFileSync(path.join(session.worktree_path, ".arcadia", "asks", "agent-ask-complete-define-contract.yaml"), JSON.stringify({
      agent_ask: "v1", request_id: "complete-define-contract", project: "test-project", intent: "complete",
      target_ref: "action/define-contract", desired_result: "Record the contract's proven completion.",
      candidate_revision: git(session.worktree_path, ["rev-parse", "HEAD"]).trim(),
      evidence: [{ criterion: "The contract exists.", status: "met", note: "docs/contract.md was produced." }],
      requested_authority: "apply_if_approved"
    }) + "\n");
    git(session.worktree_path, ["add", ".arcadia/asks"]);
    git(session.worktree_path, ["commit", "-m", "draft criterion-level completion evidence"]);
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

  it("never silently reverts a manual reset: no fast-forward while production is Off, and a logged one under an in-scope Active policy (Issue #608)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const log = vi.fn();
    const origin = path.join(fixture.root, "origin.git");
    git(fixture.root, ["clone", "-q", "--bare", fixture.repo, origin]);
    git(fixture.repo, ["remote", "add", "origin", origin]);
    writeFileSync(path.join(fixture.repo, "REMOTE.md"), "on the remote\n");
    git(fixture.repo, ["add", "REMOTE.md"]);
    git(fixture.repo, ["commit", "-qm", "remote tip"]);
    git(fixture.repo, ["push", "-q", "origin", "main"]);
    const remoteTip = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    // The operator's deliberate manual reset of a DB-active Project.
    git(fixture.repo, ["reset", "-q", "--hard", "HEAD~1"]);
    const resetTo = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, log, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(resetTo);

    activatePolicy(fixture);
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), log, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(remoteTip);
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("Fast-forwarded test-project's checkout") && line.includes(`${resetTo} -> ${remoteTip}`))).toBe(true);
  });

  it("detects a base branch advance independent of its own completion signal and records one event with no Mission Log write or commit", () => {
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
    const headBefore = newSha;
    const commitsBefore = git(fixture.repo, ["rev-list", "--count", "HEAD"]).trim();

    const after = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const advance = after.projects[0]?.baseBranchAdvance;
    expect(advance?.changed).toBe(true);
    expect(advance?.newSha).toBe(newSha);

    // The event row is the durable record.
    const events = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT event_type, payload_json FROM events WHERE event_type = 'managed_production.base_branch_advanced'").all()
    ) as Array<{ event_type: string; payload_json: string }>;
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload_json);
    expect(payload.newSha).toBe(newSha);
    expect(payload.projectSlug).toBe("test-project");

    // The dedup row stays authoritative too.
    const observation = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT observed_sha FROM production_base_branch_observations WHERE project_slug = 'test-project'").get()
    ) as { observed_sha: string } | undefined;
    expect(observation?.observed_sha).toBe(newSha);

    // No Mission Log section and no commit: the advance is machine telemetry,
    // not a human narrative entry, and the tick writes nothing to Git.
    expect(existsSync(path.join(fixture.repo, "MISSION_LOG.md"))).toBe(false);
    expect(git(fixture.repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    expect(git(fixture.repo, ["rev-list", "--count", "HEAD"]).trim()).toBe(commitsBefore);

    // A second tick over the unchanged base is a no-op: re-reading its own
    // history as an advance (the self-trigger loop the Mission Log commit used
    // to cause) can no longer happen, and no second event is recorded.
    const stillNoOp = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 120_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(stillNoOp.projects[0]?.baseBranchAdvance?.changed).toBe(false);

    const eventsAfter = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT event_type FROM events WHERE event_type = 'managed_production.base_branch_advanced'").all()
    ) as Array<{ event_type: string }>;
    expect(eventsAfter).toHaveLength(1);
    expect(existsSync(path.join(fixture.repo, "MISSION_LOG.md"))).toBe(false);
  });

  it("surfaces an Agent Ask merged onto the base branch as a pending approval, and reports a broken one once per version", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const lines: string[] = [];
    const tick = (offsetMs: number) => withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + offsetMs), agentWorktreeRoot: fixture.agentWorktreeRoot,
        log: (message) => lines.push(message)
      })
    );
    const pendingIds = () => withReadOnlyDatabase(fixture.workspace, (db) => listUnsettledAgentAskProposals(db).map((row) => row.requestId));
    const asksDir = path.join(fixture.repo, ".arcadia", "asks");

    tick(0);
    expect(pendingIds()).toEqual([]);

    // A cloud session's Asks reach main through a merged pull request; no
    // agent-ask command ever runs on this machine. The complete Ask is left
    // for the worker's own evidence-based settlement, not surfaced.
    mkdirSync(asksDir, { recursive: true });
    writeFileSync(
      path.join(asksDir, "agent-ask-merged-from-cloud.yaml"),
      `${JSON.stringify({ agent_ask: "v1", request_id: "merged-from-cloud", project: "test-project", intent: "log", desired_result: "Record that a cloud session shipped something." })}\n`
    );
    writeFileSync(
      path.join(asksDir, "agent-ask-complete-elsewhere.yaml"),
      `${JSON.stringify({
        agent_ask: "v1", request_id: "complete-elsewhere", project: "test-project", intent: "complete", target_ref: "action/define-contract",
        desired_result: "Complete it.", candidate_revision: "0123456", evidence: [{ criterion: "completion", status: "met", note: "Completed elsewhere." }]
      })}\n`
    );
    writeFileSync(path.join(asksDir, "agent-ask-broken.yaml"), "agent_ask: v1\nintent: log\n");
    git(fixture.repo, ["add", ".arcadia"]);
    git(fixture.repo, ["commit", "-m", "merge cloud asks"]);
    // An Ask that only sits in the working tree was never merged, so it is
    // never surfaced, however valid it is.
    writeFileSync(
      path.join(asksDir, "agent-ask-never-merged.yaml"),
      `${JSON.stringify({ agent_ask: "v1", request_id: "never-merged", project: "test-project", intent: "log", desired_result: "Only on disk." })}\n`
    );

    // With production Off, nothing surfaces on its own.
    const off = tick(30_000);
    expect(off.projects[0]?.askSurfacing ?? null).toBeNull();
    expect(pendingIds()).toEqual([]);

    activatePolicy(fixture);
    const surfaced = tick(60_000);
    expect(surfaced.projects[0]?.askSurfacing?.discovered).toEqual(["merged-from-cloud"]);
    expect(surfaced.projects[0]?.askSurfacing?.failed.map((failure) => path.basename(failure.path))).toEqual(["agent-ask-broken.yaml"]);
    expect(pendingIds()).toEqual(["merged-from-cloud"]);
    expect(lines.filter((line) => line.includes("Surfaced merged Agent Ask merged-from-cloud"))).toHaveLength(1);
    const brokenReports = () => lines.filter((line) => line.includes("agent-ask-broken.yaml") && line.includes("could not be surfaced"));
    expect(brokenReports()).toHaveLength(1);

    // The next tick changes nothing: the Ask is already pending and the broken
    // file's version was already reported.
    const again = tick(120_000);
    expect(again.projects[0]?.askSurfacing?.discovered).toEqual([]);
    expect(pendingIds()).toEqual(["merged-from-cloud"]);
    expect(brokenReports()).toHaveLength(1);

    // Editing the broken file is a new version, reported once more.
    writeFileSync(path.join(asksDir, "agent-ask-broken.yaml"), "agent_ask: v1\nintent: log\nproject: test-project\n");
    git(fixture.repo, ["add", ".arcadia/asks/agent-ask-broken.yaml"]);
    git(fixture.repo, ["commit", "-m", "edit broken ask"]);
    tick(180_000);
    expect(brokenReports()).toHaveLength(2);
    expect(pendingIds()).toEqual(["merged-from-cloud"]);
  });

  it("reports a base advance's previous and new SHA through the read-only production surface", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const previousSha = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    writeFileSync(path.join(fixture.repo, "EXTERNAL.md"), "merged externally\n");
    git(fixture.repo, ["add", "EXTERNAL.md"]);
    git(fixture.repo, ["commit", "-m", "external merge"]);
    const newSha = git(fixture.repo, ["rev-parse", "HEAD"]).trim();

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );

    const records = withReadOnlyDatabase(fixture.workspace, (db) => listRecentBaseBranchAdvances(db));
    expect(records).toHaveLength(1);
    expect(records[0]?.projectSlug).toBe("test-project");
    expect(records[0]?.previousSha).toBe(previousSha);
    expect(records[0]?.newSha).toBe(newSha);

    const rendered = renderProductionStatusSuccess({
      ok: true,
      command: "production.status",
      workspace: fixture.workspace,
      data: {
        read: { status: "unreadable", reason: "fixture" } as never,
        display: { state: "off", label: "Off", observedAt: fixture.now.toISOString() },
        liveAdmissions: 0,
        admissions: [],
        baseBranchAdvances: records,
        launchBlockers: [],
        operatorEscalations: [],
        offConsequence: "Off.",
        controlDeadlines: PRODUCTION_CONTROL_DEADLINES
      },
      artifacts: [],
      warnings: []
    }).join("\n");
    expect(rendered).toContain(previousSha.slice(0, 12));
    expect(rendered).toContain(newSha.slice(0, 12));
  });

  it("logs a repeatedly failing base-branch observation once, not every tick, and retries only after the backoff or an input change", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    const log = vi.fn();
    const failureLines = () =>
      log.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("Base branch observation failed for test-project"));

    // Break `resolveBaseBranch` deterministically: rename the local branch
    // away from main/master with no origin/HEAD configured, so every future
    // `detectBaseBranchAdvance` call for this Project throws the same error
    // until the repository's git state changes.
    git(fixture.repo, ["branch", "-m", "renamed-away"]);

    const first = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, log, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(first.projects[0]?.baseBranchAdvance).toBeNull();
    expect(failureLines()).toHaveLength(1);
    expect(failureLines()[0]).toContain("could not determine the local base branch");

    const failureRow = () =>
      withReadOnlyDatabase(fixture.workspace, (db) =>
        db
          .prepare("SELECT repository_path, message, first_failed_at, last_attempted_at FROM production_base_branch_observation_failures WHERE project_slug = 'test-project'")
          .get()
      ) as { repository_path: string; message: string; first_failed_at: string; last_attempted_at: string } | undefined;
    const recordedAfterFirst = failureRow();
    expect(recordedAfterFirst?.message).toContain("could not determine the local base branch");

    // Two more ticks over the same unresolved failure, well inside the
    // backoff window, must not re-log it -- before this fix, the named line
    // repeated on every ~2s producer tick (observed as "Base branch
    // observation failed for living-songbook" roughly every ~70-85s).
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), log, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 120_000), log, agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(failureLines()).toHaveLength(1);
    // Not re-attempted either: the failure record's own timestamp is untouched.
    expect(failureRow()?.last_attempted_at).toBe(recordedAfterFirst?.last_attempted_at);

    // Once the backoff interval elapses, the tick retries (spends a fresh git
    // spawn) even though nothing about the repository changed -- but an
    // identical outcome is still not re-logged.
    const afterBackoff = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + BASE_BRANCH_OBSERVATION_FAILURE_RETRY_MS + 1_000),
        log,
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(afterBackoff.projects[0]?.baseBranchAdvance).toBeNull();
    expect(failureLines()).toHaveLength(1);
    expect(failureRow()?.last_attempted_at).not.toBe(recordedAfterFirst?.last_attempted_at);

    // Fixing the repository's git state and letting the next backoff-gated
    // attempt run (comfortably past the previous attempt's own backoff
    // window) recovers, and the failure record clears rather than lingering
    // as a stale row.
    git(fixture.repo, ["branch", "-m", "main"]);
    const recovered = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + 2 * BASE_BRANCH_OBSERVATION_FAILURE_RETRY_MS + 5_000),
        log,
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(recovered.projects[0]?.baseBranchAdvance?.changed).toBe(false);
    expect(failureRow()).toBeUndefined();
  });

  it("does not re-walk and re-parse the repository tree once per open Action: discoverDocs call count is independent of the Plan's Action count", () => {
    const countDiscoverDocsCalls = (secondAction: boolean) => {
      const fixture = preparedFixture({ secondAction });
      const tmux = new FakeTmux();
      activatePolicy(fixture);
      const spy = vi.spyOn(discoverModule, "discoverDocs");
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles,
          adapters,
          tmux,
          now: fixture.now,
          capacityObservation: fixtureCapacityObservation(),
          agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
      const calls = spy.mock.calls.length;
      spy.mockRestore();
      return calls;
    };

    // Before this fix, `buildProjectSchedule` re-discovered (walked and
    // YAML-parsed) the whole repository tree once per still-open Action via
    // `resolveActionReadiness`, so the call count scaled with the Plan's
    // Action count. It must now be a small constant per Project per tick.
    const withOneAction = countDiscoverDocsCalls(false);
    const withTwoActions = countDiscoverDocsCalls(true);
    expect(withOneAction).toBeGreaterThan(0);
    expect(withTwoActions).toBe(withOneAction);
  });

  it("buildAgentQueue reads the repository tree a fixed number of times per Project, not once per Action", () => {
    const fixture = preparedFixture({ secondAction: true });
    // Make second-action depend on the still-open define-contract, so
    // inspectProject's second (dependency-blocked) loop -- the one this fix
    // also touched -- is exercised, not only the ready-Action loop.
    const planPath = path.join(fixture.repo, "docs", "plans", "copy-proof.md");
    const plan = readFileSync(planPath, "utf8").replace(
      '      - The second thing exists.\n    decisions: ["0001"]',
      '      - The second thing exists.\n    decisions: ["0001"]\n    depends_on: ["define-contract"]'
    );
    writeFileSync(planPath, plan);

    const spy = vi.spyOn(discoverModule, "discoverDocs");
    const queue = withDatabase(fixture.workspace, (db) => buildAgentQueue(db, { now: fixture.now }));
    const calls = spy.mock.calls.length;
    spy.mockRestore();

    expect(queue.ready.map((entry) => entry.actionId)).toEqual(["define-contract"]);
    expect(queue.attention.some((entry) => entry.actionId === "second-action")).toBe(true);
    // Fixed per-Project cost (resolveDispatch, the operator gate's open-Decision
    // read, resolveReadySet, and inspectProject's own read), not one re-walk
    // per ready or blocked Action -- before this fix it grew with each.
    expect(calls).toBe(4);
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

    // Issue #703 / CodeRabbit PR #708: the escalation must exist the instant
    // the final failed attempt pushes `attempts` to the limit -- not only on
    // a later tick's pre-launch check -- so an Action that becomes
    // ineligible for another launch attempt before that check runs (Off, a
    // paused Project, a competing lease) still leaves the exhausted budget
    // visible to `arcadia production status`.
    const escalationsAfterLastFailure = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    const escalationAfterLastFailure = escalationsAfterLastFailure.find((entry) => entry.actionKey === "test-project/define-contract");
    expect(escalationAfterLastFailure?.kind).toBe("repair_budget_exhausted");
    expect(escalationAfterLastFailure?.remedy).toContain("arcadia production reset-repair-budget test-project/define-contract");

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

    const escalationsBeforeReset = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    const escalation = escalationsBeforeReset.find((entry) => entry.actionKey === "test-project/define-contract");
    expect(escalation?.kind).toBe("repair_budget_exhausted");
    expect(escalation?.remedy).toContain("arcadia production reset-repair-budget test-project/define-contract");

    tmux.failLaunch = false;
    withDatabase(fixture.workspace, (db) => resetProductionRepairBudget(db, "test-project/define-contract"));

    // Resetting the budget also clears the escalation immediately, rather
    // than waiting for the next tick's launch to succeed.
    const escalationsAfterReset = withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db));
    expect(escalationsAfterReset.find((entry) => entry.actionKey === "test-project/define-contract")).toBeUndefined();

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

  it("flags a live Session stalled once its tmux pane and Run state stop changing, without releasing its lease or relaunching", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    const launchTick = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(launchTick.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("launched");
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    tmux.paneOutput.set(session.tmux_session_name, "$ claude is thinking...\n");

    // First observation of a live Session only establishes a baseline -- it
    // must never flag on sight, or every live Session in the portfolio would
    // flag the moment this capability ships.
    const baselineTick = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    expect(baselineTick.projects[0]?.reconciled).toHaveLength(0);
    const afterBaseline = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(afterBaseline.stall_flagged_at).toBeNull();
    expect(afterBaseline.last_activity_at).not.toBeNull();

    // The pane text and Run state never change again. Once the stall deadline
    // has elapsed since the baseline, the Session is flagged -- but its lease
    // (still `status = 'running'`) is untouched, so no relaunch is attempted.
    const stallTick = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux,
        now: new Date(fixture.now.getTime() + 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const stallResult = stallTick.projects.find((entry) => entry.projectSlug === "test-project")!;
    expect(stallResult.reconciled).toHaveLength(0);
    expect(stallResult.launch?.outcome).toBe("skipped");
    expect(stallResult.launch?.reason).toContain(session.id);

    const flagged = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(flagged.stall_flagged_at).not.toBeNull();
    expect(flagged.status).toBe("running");
    expect(tmux.launches).toHaveLength(1);

    const events = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT payload_json FROM events WHERE event_type = 'managed_production.session_stalled'").all()
    ) as Array<{ payload_json: string }>;
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload_json).sessionId).toBe(session.id);

    // A later tick over the same unchanged state does not re-flag or re-record.
    const stillStalledTick = withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux,
        now: new Date(fixture.now.getTime() + 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 120_000),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    expect(stillStalledTick.projects.find((entry) => entry.projectSlug === "test-project")?.launch?.outcome).toBe("skipped");
    const eventsAfter = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT payload_json FROM events WHERE event_type = 'managed_production.session_stalled'").all()
    ) as Array<{ payload_json: string }>;
    expect(eventsAfter).toHaveLength(1);

    // The Session's tmux resumes producing new output: the flag clears, and
    // `sessionView` stops surfacing it as needs-attention.
    tmux.paneOutput.set(session.tmux_session_name, "$ claude wrote a file\n");
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux,
        now: new Date(fixture.now.getTime() + 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 180_000),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const recovered = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(recovered.stall_flagged_at).toBeNull();
  });

  it("never flags a live Session doing real long-running work, even past the stall deadline", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;

    // Every tick sees fresh pane output -- a slow but genuinely working agent,
    // e.g. mid-build or mid-test-suite -- spanning well past the deadline.
    const ticks = 5;
    const stepMs = Math.floor((PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs * 2) / ticks);
    for (let i = 1; i <= ticks; i++) {
      tmux.paneOutput.set(session.tmux_session_name, `$ still working, step ${i}\n`);
      withDatabase(fixture.workspace, (db) =>
        runManagedProductionTick(db, fixture.workspace, {
          profiles, adapters, tmux, now: new Date(fixture.now.getTime() + i * stepMs), agentWorktreeRoot: fixture.agentWorktreeRoot
        })
      );
    }

    const stillWorking = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(stillWorking.stall_flagged_at).toBeNull();
    const events = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT 1 FROM events WHERE event_type = 'managed_production.session_stalled'").all()
    );
    expect(events).toHaveLength(0);
  });

  it("a failed or unavailable pane capture never falsely clears a stall flag or masks a real one", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    tmux.paneOutput.set(session.tmux_session_name, "$ steady state\n");

    // Baseline, then flag stalled with a successful (unchanging) capture.
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux,
        now: new Date(fixture.now.getTime() + 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const flagged = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(flagged.stall_flagged_at).not.toBeNull();

    // Capture starts failing (transiently unavailable) while the Run state
    // still hasn't changed either. A failed capture must not look like a
    // change -- it must neither clear the existing flag nor be needed to
    // sustain it.
    tmux.failCapture = true;
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux,
        now: new Date(fixture.now.getTime() + 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 60_000),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const stillFlagged = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(stillFlagged.stall_flagged_at).not.toBeNull();

    const events = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT 1 FROM events WHERE event_type = 'managed_production.session_stalled'").all()
    );
    // Still exactly one -- capture failure did not cause a second flag/event.
    expect(events).toHaveLength(1);
  });

  it("a first-ever successful pane capture after earlier failures only establishes a baseline, never counted as progress", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    tmux.failCapture = true;

    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: fixture.now, capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;

    // Establishes the overall baseline (last_activity_at) with a failed capture.
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, { profiles, adapters, tmux, now: new Date(fixture.now.getTime() + 60_000), agentWorktreeRoot: fixture.agentWorktreeRoot })
    );

    // Crosses the deadline entirely on failed captures (Run state never
    // changes either), so the Session is flagged on run/receipt grounds alone.
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux,
        now: new Date(fixture.now.getTime() + 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const flagged = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(flagged.stall_flagged_at).not.toBeNull();
    expect(flagged.last_pane_signature).toBeNull();

    // Capture starts succeeding for the very first time. This is our first
    // ever look at the pane, not evidence anything changed -- it must not
    // clear the flag or reset the deadline clock.
    tmux.failCapture = false;
    tmux.paneOutput.set(session.tmux_session_name, "$ whatever was already on screen\n");
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux,
        now: new Date(fixture.now.getTime() + 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 60_000),
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
    const stillFlagged = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    expect(stillFlagged.stall_flagged_at).not.toBeNull();
    expect(stillFlagged.last_pane_signature).not.toBeNull();
  });
});

describe("bounded session lifetime", () => {
  function activateScope(fixture: ReturnType<typeof preparedFixture>, extra: Partial<ProductionScope> = {}) {
    const scope = normalizeProductionScope({ ...productionScope, ...extra });
    withDatabase(fixture.workspace, (db) =>
      activateProduction(db, { requestId: "policy-grant-lifetime", scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator" })
    );
  }
  function tickAtMs(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux, offsetMs: number, capacity = false) {
    return withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + offsetMs),
        capacityObservation: capacity ? fixtureCapacityObservation() : undefined,
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
  }
  function launched(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux) {
    tickAtMs(fixture, tmux, 0, true);
    return withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
  }
  const lease = (fixture: ReturnType<typeof preparedFixture>) => withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo));
  const receiptOf = (fixture: ReturnType<typeof preparedFixture>, id: string) => withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, id));
  const MIN = 60_000;

  it("ends a still-progressing Session at the policy time limit, writes a receipt with the reason, releases the lease and keeps the worktree", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activateScope(fixture, { sessionTimeLimitMs: 30 * MIN });
    const session = launched(fixture, tmux);

    // Fresh output every tick: progressing, within its limit -- never killed.
    tmux.paneOutput.set(session.tmux_session_name, "$ step 1\n");
    tickAtMs(fixture, tmux, 10 * MIN);
    tmux.paneOutput.set(session.tmux_session_name, "$ step 2\n");
    tickAtMs(fixture, tmux, 29 * MIN);
    expect(tmux.killed).toEqual([]);
    expect(lease(fixture)?.id).toBe(session.id);

    tmux.paneOutput.set(session.tmux_session_name, "$ step 3\n");
    tickAtMs(fixture, tmux, 31 * MIN);

    // The stop tick only ends tmux; preserve and reconcile wait for the next
    // tick so the killed process tree can finish writing.
    expect(tmux.killed).toEqual([session.tmux_session_name]);
    expect(lease(fixture)?.id).toBe(session.id);
    expect(receiptOf(fixture, session.id)).toBeNull();
    tickAtMs(fixture, tmux, 32 * MIN);
    expect(lease(fixture)).toBeNull();
    const receipt = receiptOf(fixture, session.id)!;
    expect(receipt.reason).toContain("Stopped by Arcadia");
    expect(receipt.reason).toContain("time limit of 30 minutes");
    expect(JSON.parse(receipt.evidence_json!).stopReason).toContain("time limit");
    // Only tmux was ended: the worktree and its branch are still there.
    expect(existsSync(session.worktree_path)).toBe(true);
    expect(execFileSync("git", ["rev-parse", "--verify", session.branch], { cwd: fixture.repo, encoding: "utf8" }).trim()).not.toBe("");
    const events = withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT payload_json FROM events WHERE event_type = 'managed_production.session_stopped'").all()
    ) as Array<{ payload_json: string }>;
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload_json).kind).toBe("time_limit");
  });

  it("a per-launch time_limit_ms overrides the policy and the default", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activateScope(fixture, { sessionTimeLimitMs: 90 * MIN });
    const session = launched(fixture, tmux);
    withDatabase(fixture.workspace, (db) => db.prepare("UPDATE agent_sessions SET time_limit_ms = ? WHERE id = ?").run(5 * MIN, session.id));

    tmux.paneOutput.set(session.tmux_session_name, "$ step 1\n");
    tickAtMs(fixture, tmux, 6 * MIN);
    expect(tmux.killed).toEqual([session.tmux_session_name]);
    tickAtMs(fixture, tmux, 7 * MIN);
    expect(receiptOf(fixture, session.id)!.reason).toContain("time limit of 5 minutes");
  });

  it.each([
    ["permission_prompt", "Do you want to proceed?\n 1. Yes\n 2. No\n"],
    ["auth_failure", "API Error: 401 authentication_error. Please run /login\n"],
    ["provider_limit", "Claude usage limit reached. Your limit will reset at 5pm.\n"]
  ])("ends a Session whose pane shows a %s that persisted past the stall deadline, and not before", (paneClass, pane) => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const session = launched(fixture, tmux);
    tmux.paneOutput.set(session.tmux_session_name, pane);

    tickAtMs(fixture, tmux, MIN); // baseline
    tickAtMs(fixture, tmux, 10 * MIN); // blocked, but inside the stall deadline
    expect(tmux.killed).toEqual([]);
    expect(lease(fixture)?.id).toBe(session.id);

    const stopAt = MIN + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1;
    tickAtMs(fixture, tmux, stopAt);
    expect(tmux.killed).toEqual([session.tmux_session_name]);
    tickAtMs(fixture, tmux, stopAt + MIN);
    expect(lease(fixture)).toBeNull();
    const receipt = receiptOf(fixture, session.id)!;
    expect(receipt.reason).toContain("Stopped by Arcadia");
    expect(receipt.reason).toContain(paneClass.replace("_", " "));
    expect(existsSync(session.worktree_path)).toBe(true);
  });

  it("ignores a permission prompt in a headless Session's tool output, but still stops it for an auth failure", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const session = launched(fixture, tmux);
    // A headless Session has a recorded log; its pane is tool output.
    mkdirSync(path.dirname(sessionLogPath(fixture.workspace, session.id)), { recursive: true });
    writeFileSync(sessionLogPath(fixture.workspace, session.id), "");
    tmux.paneOutput.set(session.tmux_session_name, "tool_result: if (confirm) { ask('Do you want to proceed?') }\n");
    tickAtMs(fixture, tmux, MIN);
    const late = MIN + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1;
    tickAtMs(fixture, tmux, late);
    expect(tmux.killed).toEqual([]);
    expect(lease(fixture)?.id).toBe(session.id);

    // An auth failure is still blocking for a headless Session.
    tmux.paneOutput.set(session.tmux_session_name, "API Error: 401 authentication_error. Please run /login\n");
    tickAtMs(fixture, tmux, late + MIN);
    tickAtMs(fixture, tmux, late + MIN + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1);
    expect(tmux.killed).toEqual([session.tmux_session_name]);
  });

  it("scans only the last few pane lines: a blocking message buried under later output does not stop a silent Session", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const session = launched(fixture, tmux);
    const buried = "Claude usage limit reached.\n" + Array.from({ length: 12 }, (_, i) => `$ later line ${i}`).join("\n") + "\n";
    tmux.paneOutput.set(session.tmux_session_name, buried);
    tickAtMs(fixture, tmux, MIN);
    tickAtMs(fixture, tmux, MIN + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1);
    expect(tmux.killed).toEqual([]);
  });

  it("treats a kill that did not take as no stop: no event, no stop reason, lease held, retried next tick", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activateScope(fixture, { sessionTimeLimitMs: 30 * MIN });
    const session = launched(fixture, tmux);
    tmux.failKill = true;

    tickAtMs(fixture, tmux, 31 * MIN);
    expect(tmux.killed).toEqual([session.tmux_session_name]);
    expect(lease(fixture)?.stop_reason).toBeNull();
    expect(receiptOf(fixture, session.id)).toBeNull();
    const stoppedEvents = () => withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT 1 FROM events WHERE event_type = 'managed_production.session_stopped'").all());
    expect(stoppedEvents()).toHaveLength(0);

    // The next tick retries; now the kill takes and the stop is recorded.
    tmux.failKill = false;
    tickAtMs(fixture, tmux, 32 * MIN);
    expect(tmux.killed).toHaveLength(2);
    expect(stoppedEvents()).toHaveLength(1);
    expect(lease(fixture)?.stop_reason).toContain("time limit");
    tickAtMs(fixture, tmux, 33 * MIN);
    expect(lease(fixture)).toBeNull();
    expect(receiptOf(fixture, session.id)!.reason).toContain("Stopped by Arcadia");
  });

  it("never ends a progressing Session whose pane tail still carries an old blocking message", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const session = launched(fixture, tmux);
    const stale = "Claude usage limit reached. Your limit will reset at 5pm.\nDo you want to proceed?\n";
    for (let i = 1; i <= 6; i++) {
      tmux.paneOutput.set(session.tmux_session_name, `${stale}$ still working, step ${i}\n`);
      tickAtMs(fixture, tmux, i * 10 * MIN);
    }
    expect(tmux.killed).toEqual([]);
    expect(lease(fixture)?.id).toBe(session.id);
    expect(receiptOf(fixture, session.id)).toBeNull();
  });

  it("leaves a stalled Session with no blocking signal alone until its time limit", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const session = launched(fixture, tmux);
    tmux.paneOutput.set(session.tmux_session_name, "$ claude is thinking...\n");
    tickAtMs(fixture, tmux, MIN);
    tickAtMs(fixture, tmux, MIN + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1);
    expect(lease(fixture)?.stall_flagged_at).not.toBeNull();
    expect(tmux.killed).toEqual([]);

    tickAtMs(fixture, tmux, PRODUCTION_CONTROL_DEADLINES.defaultSessionTimeLimitMs + MIN);
    expect(tmux.killed).toEqual([session.tmux_session_name]);
    tickAtMs(fixture, tmux, PRODUCTION_CONTROL_DEADLINES.defaultSessionTimeLimitMs + 2 * MIN);
    expect(lease(fixture)).toBeNull();
    expect(receiptOf(fixture, session.id)!.reason).toContain("time limit of 120 minutes");
  });

  it("falls back to the default limit when no policy is readable", () => {
    const db = new BetterSqlite3(":memory:");
    expect(resolveSessionTimeLimitMs(db, { time_limit_ms: null })).toBe(PRODUCTION_CONTROL_DEADLINES.defaultSessionTimeLimitMs);
    expect(resolveSessionTimeLimitMs(db, { time_limit_ms: 7 * MIN })).toBe(7 * MIN);
    db.close();
  });
});

describe("a Session that dies on a provider sign-in failure (Issue #1155)", () => {
  const MIN = 60_000;
  const tickAt = (fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux, offsetMs: number, log?: (line: string) => void) =>
    withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles, adapters, tmux, now: new Date(fixture.now.getTime() + offsetMs),
        capacityObservation: fixtureCapacityObservation(), agentWorktreeRoot: fixture.agentWorktreeRoot,
        ...(log ? { log } : {})
      })
    );
  const projectOf = (result: ReturnType<typeof tickAt>) => result.projects.find((entry) => entry.projectSlug === "test-project")!;
  const scheduling = (fixture: ReturnType<typeof preparedFixture>) =>
    withReadOnlyDatabase(fixture.workspace, (db) => getSchedulingProject(db, "test-project"));
  const blockers = (fixture: ReturnType<typeof preparedFixture>) => withReadOnlyDatabase(fixture.workspace, (db) => listLaunchBlockers(db));
  const repairAttempts = (fixture: ReturnType<typeof preparedFixture>) =>
    withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT action_key, attempts FROM production_repair_attempts").all());
  const lease = (fixture: ReturnType<typeof preparedFixture>) => withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo));

  /** The tick launches the Session; it then exits nonzero with `resultText` as its terminal result event. */
  function launchThenExit(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux, resultText: string | null, offsetMs = 0) {
    tickAt(fixture, tmux, offsetMs);
    const session = lease(fixture)!;
    withDatabase(fixture.workspace, (db) => db.prepare("UPDATE agent_sessions SET exit_status = 1 WHERE id = ?").run(session.id));
    if (resultText !== null) {
      mkdirSync(path.dirname(sessionLogPath(fixture.workspace, session.id)), { recursive: true });
      writeFileSync(sessionLogPath(fixture.workspace, session.id), [
        JSON.stringify({ type: "system", subtype: "init" }),
        JSON.stringify({ type: "result", subtype: "success", is_error: true, result: resultText }),
        "arcadia: provider exited with status 1"
      ].join("\n") + "\n");
    }
    tmux.live.delete(session.tmux_session_name);
    return session;
  }
  const SIGNED_OUT = "Failed to authenticate: OAuth session expired and could not be refreshed";

  it("spends no failed-Run budget, does not pause the Project and surfaces a durable sign-in blocker with the remedy", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const session = launchThenExit(fixture, tmux, SIGNED_OUT);
    const log = vi.fn();

    const result = tickAt(fixture, tmux, MIN, log);

    expect(projectOf(result).reconciled).toEqual([{ sessionId: session.id, outcome: "failed_execution" }]);
    expect(scheduling(fixture)).toMatchObject({ failedRuns: 0, pausedReason: null, pausedDecisionId: null });
    const recorded = blockers(fixture);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      projectSlug: "test-project", code: "provider_sign_in_failed",
      actionKey: "test-project/define-contract", observedAt: new Date(fixture.now.getTime() + MIN).toISOString()
    });
    expect(recorded[0].reason).toContain(session.id);
    expect(recorded[0].reason).toContain("claude-code-cli");
    expect(recorded[0].reason).toContain("claude auth login");
    expect(recorded[0].reason).toContain("claude setup-token");
    expect(recorded[0].reason).toContain(new Date(fixture.now.getTime() + MIN + SIGN_IN_FAILURE_HOLD_MS).toISOString());
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Provider sign-in failure for test-project.*not counted against the failed-Run budget/));

    // The same projection `arcadia production status` renders.
    const rendered = renderProductionStatusSuccess({
      ok: true, command: "production.status", workspace: fixture.workspace,
      data: {
        read: { status: "unreadable", reason: "fixture" } as never,
        display: { state: "off", label: "Off", observedAt: fixture.now.toISOString() },
        liveAdmissions: 0, admissions: [], baseBranchAdvances: [], launchBlockers: recorded, operatorEscalations: [],
        offConsequence: "Off.", controlDeadlines: PRODUCTION_CONTROL_DEADLINES
      },
      artifacts: [], warnings: []
    }).join("\n");
    expect(rendered).toContain("test-project [provider_sign_in_failed]");
    expect(rendered).toContain("claude auth login");
  });

  it("launches nothing, reserves no Session and counts no repair attempt inside the hold, then launches again after it", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    launchThenExit(fixture, tmux, SIGNED_OUT);
    tickAt(fixture, tmux, MIN); // reconciles the exit and records the blocker
    const recorded = blockers(fixture)[0];
    expect(tmux.launches).toHaveLength(1);

    for (const offset of [2 * MIN, 5 * MIN, MIN + SIGN_IN_FAILURE_HOLD_MS - 1_000]) {
      const held = projectOf(tickAt(fixture, tmux, offset));
      expect(held.launch).toMatchObject({ attempted: false, outcome: "skipped", actionKey: "test-project/define-contract" });
      expect(held.launch?.reason).toContain(new Date(fixture.now.getTime() + MIN + SIGN_IN_FAILURE_HOLD_MS).toISOString());
      expect(tmux.launches).toHaveLength(1);
      expect(lease(fixture)).toBeNull();
      expect(repairAttempts(fixture)).toEqual([]);
      expect(scheduling(fixture)).toMatchObject({ failedRuns: 0, pausedReason: null });
      // The hold row is neither cleared nor refreshed by a held tick.
      expect(blockers(fixture)).toEqual([recorded]);
    }

    const after = projectOf(tickAt(fixture, tmux, MIN + SIGN_IN_FAILURE_HOLD_MS));
    expect(after.launch).toMatchObject({ attempted: true, outcome: "launched" });
    expect(tmux.launches).toHaveLength(2);
    expect(blockers(fixture)).toEqual([]);
  });

  it("renews the hold when the relaunched Session dies on the same dead login, still without spending the budget", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    launchThenExit(fixture, tmux, SIGNED_OUT);
    tickAt(fixture, tmux, MIN);
    const relaunchAt = MIN + SIGN_IN_FAILURE_HOLD_MS;
    const second = launchThenExit(fixture, tmux, SIGNED_OUT, relaunchAt);
    expect(tmux.launches).toHaveLength(2);

    tickAt(fixture, tmux, relaunchAt + MIN);
    expect(blockers(fixture)[0]).toMatchObject({
      code: "provider_sign_in_failed", observedAt: new Date(fixture.now.getTime() + relaunchAt + MIN).toISOString()
    });
    expect(blockers(fixture)[0].reason).toContain(second.id);
    expect(scheduling(fixture)).toMatchObject({ failedRuns: 0, pausedReason: null });
    const held = projectOf(tickAt(fixture, tmux, relaunchAt + 2 * MIN));
    expect(held.launch).toMatchObject({ attempted: false, outcome: "skipped" });
    expect(tmux.launches).toHaveLength(2);
  });

  it("consumes no development attempt: three sign-in deaths spaced by the hold never exhaust the lineage, and the fourth and fifth launches run (Issue #1243)", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    const developmentAttempts = () => withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT ordinal, status, request_id FROM session_role_attempts WHERE role = 'development' ORDER BY ordinal").all() as Array<{ ordinal: number; status: string; request_id: string }>);
    const HOLD = SIGN_IN_FAILURE_HOLD_MS;

    // Dies at t=1m, t=17m and t=33m: each exit is reconciled one minute after its launch.
    const first = launchThenExit(fixture, tmux, SIGNED_OUT);
    tickAt(fixture, tmux, MIN);
    const lineage = developmentAttempts();
    expect(lineage).toEqual([{ ordinal: 1, status: "running", request_id: expect.any(String) }]);
    const dead = [first.id];
    for (const launchAt of [MIN + HOLD, 2 * MIN + 2 * HOLD]) {
      const relaunched = launchThenExit(fixture, tmux, SIGNED_OUT, launchAt);
      dead.push(relaunched.id);
      tickAt(fixture, tmux, launchAt + MIN);
      // The same live attempt, its ordinal unconsumed, after every sign-in death.
      expect(developmentAttempts()).toEqual(lineage);
      expect(blockers(fixture)[0]).toMatchObject({ code: "provider_sign_in_failed" });
    }
    expect(new Set(dead).size).toBe(3);
    expect(scheduling(fixture)).toMatchObject({ failedRuns: 0, pausedReason: null });

    // t=48m: the fourth launch is not refused attempt_limit_exhausted; it resumes the same attempt.
    const fourthAt = 3 * MIN + 3 * HOLD;
    const fourth = projectOf(tickAt(fixture, tmux, fourthAt));
    expect(fourth.launch).toMatchObject({ attempted: true, outcome: "launched" });
    expect(tmux.launches).toHaveLength(4);
    expect(developmentAttempts()).toEqual(lineage);
    expect(blockers(fixture)).toEqual([]);
    expect(repairAttempts(fixture)).toEqual([]);

    // That one dies on the same dead login too; t=63m launches a fifth, still the one attempt.
    const fourthSession = lease(fixture)!;
    withDatabase(fixture.workspace, (db) => db.prepare("UPDATE agent_sessions SET exit_status = 1 WHERE id = ?").run(fourthSession.id));
    mkdirSync(path.dirname(sessionLogPath(fixture.workspace, fourthSession.id)), { recursive: true });
    writeFileSync(sessionLogPath(fixture.workspace, fourthSession.id), JSON.stringify({ type: "result", is_error: true, result: SIGNED_OUT }) + "\n");
    tmux.live.delete(fourthSession.tmux_session_name);
    tickAt(fixture, tmux, fourthAt + MIN);
    expect(developmentAttempts()).toEqual(lineage);
    const fifth = projectOf(tickAt(fixture, tmux, fourthAt + MIN + HOLD));
    expect(fifth.launch).toMatchObject({ attempted: true, outcome: "launched" });
    expect(tmux.launches).toHaveLength(5);
    expect(developmentAttempts()).toEqual(lineage);
  });

  it("still counts any other failed_execution against the failed-Run budget and records no sign-in blocker", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    // A nonzero exit whose log shows no authentication failure.
    const session = launchThenExit(fixture, tmux, "Prompt is too long");

    const result = tickAt(fixture, tmux, MIN);

    expect(projectOf(result).reconciled).toEqual([{ sessionId: session.id, outcome: "failed_execution" }]);
    expect(withReadOnlyDatabase(fixture.workspace, (db) => getSessionExitReceipt(db, session.id))!.reason).not.toContain("sign-in");
    expect(scheduling(fixture).failedRuns).toBe(1);
    expect(blockers(fixture)).toEqual([]);
    // Unlike a sign-in death, it did consume its development attempt.
    expect(withReadOnlyDatabase(fixture.workspace, (db) =>
      db.prepare("SELECT ordinal, status FROM session_role_attempts WHERE role = 'development'").all())).toEqual([{ ordinal: 1, status: "failed" }]);
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

function recordCompetingManagedRun(workspace: string, workItemId: string): void {
  withDatabase(workspace, (db) => {
    const runId = "run-" + Math.random().toString(36).slice(2);
    db.prepare(
      `INSERT INTO execution_runs (id, work_item_id, plan_id, status, executor_name, pid, summary, created_at, updated_at)
       VALUES (?, ?, NULL, 'pending_execution', 'claude', NULL, 'Fixture competing run.', ?, ?)`
    ).run(runId, workItemId, "2026-08-30T12:00:00.000Z", "2026-08-30T12:00:00.000Z");
  });
}

describe("red alerts from the worker tick", () => {
  function tickAt(fixture: ReturnType<typeof preparedFixture>, tmux: FakeTmux, offsetMs: number, capacity = false) {
    return withDatabase(fixture.workspace, (db) =>
      runManagedProductionTick(db, fixture.workspace, {
        profiles,
        adapters,
        tmux,
        now: new Date(fixture.now.getTime() + offsetMs),
        capacityObservation: capacity ? fixtureCapacityObservation() : undefined,
        agentWorktreeRoot: fixture.agentWorktreeRoot
      })
    );
  }
  const openAlerts = (fixture: ReturnType<typeof preparedFixture>) => withReadOnlyDatabase(fixture.workspace, (db) => listOpenRedAlerts(db));
  const redNotices = (db: Database.Database) => listPendingAgentAskNotifications(db).filter((entry) => entry.requestId?.startsWith("red-alert-"));
  const pendingNotices = (fixture: ReturnType<typeof preparedFixture>) => withDatabase(fixture.workspace, (db) => redNotices(db));

  it("retains real tmux stderr in bounded red-alert evidence and production status JSON without publishing the launch payload", () => {
    const fixture = preparedFixture();
    const bin = path.join(fixture.root, "bin");
    mkdirSync(bin);
    const cause = "known tmux stderr: cannot create server socket";
    const secret = "sk-ant-" + "s".repeat(40);
    const stderr = `${cause}\nCLAUDE_CODE_OAUTH_TOKEN=${secret}\n${"diagnostic noise ".repeat(1000)}`;
    const diagnostic = path.join(fixture.root, "tmux-stderr.txt");
    writeFileSync(diagnostic, stderr);
    const executable = path.join(bin, "tmux");
    writeFileSync(executable, `#!/bin/sh\ncat '${diagnostic}' >&2\nexit 1\n`);
    chmodSync(executable, 0o755);
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);
    const tmux = new FakeTmux();
    // Exercise the actual adapter subprocess and wrapper; only presence checks are fake.
    tmux.launch = input => systemTmux.launch(input);
    activatePolicy(fixture);
    for (let attempt = 0; attempt < PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction; attempt++) {
      const tick = tickAt(fixture, tmux, attempt * 1000, true);
      expect(tick.projects[0].launch?.outcome).toBe("failed");
    }

    const [alert] = openAlerts(fixture);
    const evidence = readFileSync(alert.evidencePath, "utf8");
    const status = runProductionStatusCommand({ workspace: fixture.workspace });
    const json = JSON.stringify(status);
    for (const surface of [evidence, json]) {
      expect(surface).toContain(cause);
      expect(surface).toContain("[redacted]");
      expect(surface).not.toContain(secret);
      expect(surface).not.toContain("immutable build packet");
      expect(surface).not.toContain("Command failed: tmux");
    }
    expect(alert.detail.length).toBeLessThanOrEqual(2400);
    expect(status.data.redAlerts[0].detail).toBe(alert.detail);
    expect(status.data.operatorEscalations[0].message).toContain(cause);
    const lastError = withReadOnlyDatabase(fixture.workspace, db =>
      (db.prepare("SELECT last_error FROM production_repair_attempts").get() as { last_error: string }).last_error);
    expect(lastError.length).toBeLessThanOrEqual(2048);
  });

  it("raises one repair_budget_repeat alert, updates it on repeat, posts once, and clears when the budget is reset", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    tmux.failLaunch = true;
    activatePolicy(fixture);
    for (let attempt = 0; attempt < PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction; attempt++) {
      tickAt(fixture, tmux, attempt * 1000, true);
    }
    const [alert, ...rest] = openAlerts(fixture);
    expect(rest).toHaveLength(0);
    expect(alert.trigger).toBe("repair_budget_repeat");
    expect(alert.actionKey).toBe("test-project/define-contract");
    expect(alert.projectSlug).toBe("test-project");
    expect(alert.detail).toContain("tmux could not start");
    expect(existsSync(alert.evidencePath)).toBe(true);
    expect(readFileSync(alert.evidencePath, "utf8")).toContain("repair_budget_repeat");

    tickAt(fixture, tmux, 10_000, true);
    const [repeated, ...others] = openAlerts(fixture);
    expect(others).toHaveLength(0);
    expect(repeated.id).toBe(alert.id);
    expect(repeated.firstSeenAt).toBe(alert.firstSeenAt);
    expect(repeated.occurrences).toBeGreaterThan(alert.occurrences);

    const notices = pendingNotices(fixture);
    expect(notices).toHaveLength(1);
    expect(notices[0].requestId).toBe(alert.requestId);
    expect(notices[0].desiredResult).toContain("test-project/define-contract");
    expect(notices[0].desiredResult).toContain("repair_budget_repeat");
    expect(notices[0].desiredResult).toContain(alert.evidencePath);

    tmux.failLaunch = false;
    withDatabase(fixture.workspace, (db) => resetProductionRepairBudget(db, "test-project/define-contract"));
    tickAt(fixture, tmux, 20_000, true);
    expect(openAlerts(fixture)).toHaveLength(0);
    expect(pendingNotices(fixture)).toHaveLength(1);
  });

  it("raises one session_stalled alert past the stall window, updates it on repeat, and clears on recovery", () => {
    const fixture = preparedFixture();
    const tmux = new FakeTmux();
    activatePolicy(fixture);
    tickAt(fixture, tmux, 0, true);
    const session = withReadOnlyDatabase(fixture.workspace, (db) => getRepositoryLease(db, fixture.repo))!;
    tmux.paneOutput.set(session.tmux_session_name, "$ claude is thinking...\n");
    tickAt(fixture, tmux, 60_000);
    expect(openAlerts(fixture)).toHaveLength(0);

    const stalledAt = 60_000 + PRODUCTION_CONTROL_DEADLINES.stalledSessionDeadlineMs + 1;
    tickAt(fixture, tmux, stalledAt);
    const [alert, ...rest] = openAlerts(fixture);
    expect(rest).toHaveLength(0);
    expect(alert.trigger).toBe("session_stalled");
    expect(alert.sessionId).toBe(session.id);
    expect(alert.actionKey).toBe(`test-project/${session.action_id}`);
    expect(alert.detail).toContain("stalled");

    tickAt(fixture, tmux, stalledAt + 120_000);
    const [repeated, ...others] = openAlerts(fixture);
    expect(others).toHaveLength(0);
    expect(repeated.id).toBe(alert.id);
    expect(repeated.occurrences).toBe(alert.occurrences + 1);
    expect(pendingNotices(fixture)).toHaveLength(1);

    tmux.paneOutput.set(session.tmux_session_name, "$ claude wrote a file\n");
    tickAt(fixture, tmux, stalledAt + 180_000);
    expect(openAlerts(fixture)).toHaveLength(0);
  });

  describe("scope drift (A6, #1284)", () => {
    const successorPlan = `---
arcadia: v1
type: plan
slug: plan-b
project: test-project
status: active
milestone: Prove the continuous worker tick
current_action: b1
token_impact: medium
token_budget: One bounded Session; all checks are deterministic.
recommended_model: sonnet
recommended_reasoning_effort: high
updated: 2026-08-30
actions:
  - id: b1
    title: Define the successor contract
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: Define the bounded successor contract.
    expected_artifact: docs/b1.md
    acceptance_criteria:
      - The successor contract exists.
    decisions: ["0001"]
---

# Plan B
`;
    function finishScopedPlan(fixture: ReturnType<typeof preparedFixture>) {
      const planPath = path.join(fixture.repo, "docs", "plans", "copy-proof.md");
      writeFileSync(planPath, readFileSync(planPath, "utf8")
        .replace("status: active", "status: complete").replace("current_action: define-contract", "current_action: null")
        .replace("    status: open", "    status: done"));
      writeFileSync(path.join(fixture.repo, "docs", "plans", "plan-b.md"), successorPlan);
      git(fixture.repo, ["add", "."]);
      git(fixture.repo, ["commit", "-qm", "finish scoped plan"]);
    }
    const activeScopeFor = (plans: string[]) => normalizeProductionScope({
      intent: "Prove scope drift.", projects: ["test-project"], plans, actions: [], providers: ["claude-code-cli"],
      maxConcurrentSessions: 1, mechanicalTransitions: ["acceptance", "pointer"]
    });
    function activate(fixture: ReturnType<typeof preparedFixture>, plans: string[]) {
      const scope = activeScopeFor(plans);
      withDatabase(fixture.workspace, (db) => activateProduction(db, {
        requestId: `scope-${plans.join("-")}`, scope, scopeFingerprint: fingerprintProductionScope(scope), grantedBy: "operator"
      }));
    }
    const pointer = (fixture: ReturnType<typeof preparedFixture>) =>
      /active_plan: (\S+)/.exec(readFileSync(path.join(fixture.repo, "PROJECT.md"), "utf8"))![1];

    it("holds the successor Plan while the scope covers the finished Plan: no activation, one alert, no failure", () => {
      const fixture = preparedFixture();
      finishScopedPlan(fixture);
      activate(fixture, ["test-project/copy-proof"]);
      const tmux = new FakeTmux();
      const first = tickAt(fixture, tmux, 0, true);
      const second = tickAt(fixture, tmux, 5_000, true);
      expect(pointer(fixture)).toBe("copy-proof");
      expect(first.projects[0].launch).toMatchObject({ attempted: false, outcome: "skipped" });
      expect(second.projects[0].launch).toMatchObject({ attempted: false, outcome: "skipped" });
      const alerts = openAlerts(fixture).filter((alert) => alert.trigger === "scope_successor_held");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].occurrences).toBe(2);
      expect(alerts[0].detail).toMatch(/Turn production Off/);
    });

    it("still activates the successor when the Active scope covers a different Plan", () => {
      const fixture = preparedFixture();
      finishScopedPlan(fixture);
      activate(fixture, ["test-project/some-other-plan"]);
      tickAt(fixture, new FakeTmux(), 0, true);
      expect(pointer(fixture)).toBe("plan-b");
      expect(openAlerts(fixture).filter((alert) => alert.trigger === "scope_successor_held")).toHaveLength(0);
    });

    it("raises scope_pointer_mismatch through the tick when the pointer leaves the scope, and clears when it returns", () => {
      const fixture = preparedFixture();
      activate(fixture, ["test-project/copy-proof"]);
      writeFileSync(path.join(fixture.repo, "docs", "plans", "plan-b.md"), successorPlan);
      const projectPath = path.join(fixture.repo, "PROJECT.md");
      const original = readFileSync(projectPath, "utf8");
      writeFileSync(projectPath, original.replace("active_plan: copy-proof", "active_plan: plan-b").replace("current_action: define-contract", "current_action: b1"));
      git(fixture.repo, ["add", "."]);
      git(fixture.repo, ["commit", "-qm", "re-point to plan-b"]);
      const tmux = new FakeTmux();
      tickAt(fixture, tmux, 0, true);
      const raised = openAlerts(fixture).filter((alert) => alert.trigger === "scope_pointer_mismatch");
      expect(raised).toHaveLength(1);
      expect(raised[0].detail).toMatch(/test-project\/plan-b.*Turn production Off/s);
      writeFileSync(projectPath, original);
      git(fixture.repo, ["add", "."]);
      git(fixture.repo, ["commit", "-qm", "restore pointer"]);
      tickAt(fixture, tmux, 5_000, true);
      expect(openAlerts(fixture).filter((alert) => alert.trigger === "scope_pointer_mismatch")).toHaveLength(0);
    });
  });

  it("raises one reconcile_failed alert per Session, updates it on repeat, and clears once a reconcile succeeds", () => {
    const fixture = preparedFixture();
    const now = new Date(fixture.now.getTime());
    const session = { id: "session-1", action_id: "define-contract" };
    withDatabase(fixture.workspace, (db) => {
      const ctx = { db, workspace: fixture.workspace, projectSlug: "test-project", now };
      observeReconcileFailure(ctx, { session, error: new Error("boom") });
      observeReconcileFailure({ ...ctx, now: new Date(now.getTime() + 2000) }, { session, error: new Error("boom") });
      observeReconcileFailure(ctx, { session: null, error: new Error("no lease") });
      const alerts = listOpenRedAlerts(db);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].trigger).toBe("reconcile_failed");
      expect(alerts[0].sessionId).toBe("session-1");
      expect(alerts[0].occurrences).toBe(2);
      expect(alerts[0].detail).toContain("boom");
      expect(redNotices(db)).toHaveLength(1);
      observeReconcileSuccess(ctx);
      expect(listOpenRedAlerts(db)).toHaveLength(0);
    });
  });

  it("raises one admission_refused_consecutive alert only past the minimum ticks and duration, and clears when admission succeeds", () => {
    const fixture = preparedFixture();
    const refused = { attempted: true, outcome: "refused" as const, reason: "capacity wait", actionKey: "test-project/define-contract" };
    withDatabase(fixture.workspace, (db) => {
      const at = (ms: number) => ({ db, workspace: fixture.workspace, projectSlug: "test-project", now: new Date(fixture.now.getTime() + ms) });
      // Many ticks but too brief: no alert.
      for (let tick = 0; tick < ADMISSION_REFUSAL_MIN_TICKS + 2; tick++) observeAdmission(at(tick * 2000), refused);
      expect(listOpenRedAlerts(db)).toHaveLength(0);
      // A neutral skipped tick neither breaks nor advances the streak.
      observeAdmission(at(5000), { attempted: false, outcome: "skipped", reason: "lease", actionKey: null });
      // Long enough now: exactly one alert, then a repeat updates it.
      observeAdmission(at(ADMISSION_REFUSAL_MIN_MS), refused);
      observeAdmission(at(ADMISSION_REFUSAL_MIN_MS + 2000), refused);
      const alerts = listOpenRedAlerts(db);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].trigger).toBe("admission_refused_consecutive");
      expect(alerts[0].actionKey).toBe("test-project/define-contract");
      expect(alerts[0].occurrences).toBe(2);
      expect(redNotices(db)).toHaveLength(1);
      observeAdmission(at(ADMISSION_REFUSAL_MIN_MS + 4000), { attempted: true, outcome: "launched", reason: "ok", actionKey: "test-project/define-contract" });
      expect(listOpenRedAlerts(db)).toHaveLength(0);
      // A recurrence is a new episode and posts again.
      for (let tick = 0; tick < ADMISSION_REFUSAL_MIN_TICKS; tick++) observeAdmission(at(ADMISSION_REFUSAL_MIN_MS * 3 + tick), refused);
      observeAdmission(at(ADMISSION_REFUSAL_MIN_MS * 4), refused);
      expect(listOpenRedAlerts(db)).toHaveLength(1);
      expect(redNotices(db)).toHaveLength(2);
    });
  });

  it("logs and swallows an alerting failure instead of failing the tick", () => {
    const logs: string[] = [];
    expect(() => safelyRaiseRedAlerts((message) => logs.push(message), "test", () => { throw new Error("db locked"); })).not.toThrow();
    expect(logs[0]).toContain("db locked");
  });

  it("lists open red alerts before every other section of production status", () => {
    const fixture = preparedFixture();
    activatePolicy(fixture);
    const tmux = new FakeTmux();
    tmux.failLaunch = true;
    for (let attempt = 0; attempt < PRODUCTION_CONTROL_DEADLINES.maxRepairAttemptsPerAction; attempt++) tickAt(fixture, tmux, attempt * 1000, true);
    const lines = withReadOnlyDatabase(fixture.workspace, (db) =>
      renderProductionStatusSuccess({
        command: "production.status",
        workspace: fixture.workspace,
        data: {
          read: { status: "ok", policy: { desiredState: "off", revision: 1, epoch: 1, scope: null } },
          display: { state: "off", label: "Off", observedAt: "now" },
          liveAdmissions: 0,
          admissions: [],
          baseBranchAdvances: [],
          launchBlockers: [],
          operatorEscalations: [],
          redAlerts: listOpenRedAlerts(db),
          offConsequence: "n/a",
          controlDeadlines: PRODUCTION_CONTROL_DEADLINES,
          concurrencyGate: null
        },
        warnings: []
      } as never)
    );
    expect(lines[0]).toBe("RED ALERTS (1)");
    expect(lines.indexOf("Managed production")).toBeGreaterThan(0);
  });
});

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

function preparedFixture(
  options: {
    secondAction?: boolean;
    skipPacket?: boolean;
    buildAction?: boolean;
    noValidationCommands?: boolean;
    dependsOnUnresolved?: boolean;
  } = {}
) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-production-tick-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(
    path.join(repo, "docs", "plans", "copy-proof.md"),
    planDocument(options.secondAction ?? false, options.buildAction ?? false, options.dependsOnUnresolved ?? false)
  );
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
    });
    const approvalId = db
      .prepare("SELECT id FROM review_items WHERE codex_invocation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(packetId) as { id: string };
    updateReviewItemStatus(db, approvalId.id, { status: "approved", decisionNote: "Fixture authority approved." });
  }

  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove the continuous worker tick.", goal: "Prove the continuous worker tick.", status: "active" });
    upsertProjectMetadata(db, {
      projectId: project.id,
      repoPath: repo,
      validationCommands: options.noValidationCommands ? [] : ["node -e \"process.exit(0)\""]
    });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    if (!options.skipPacket) preparePacket(db, "define-contract", project.id);
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

function planDocument(secondAction: boolean, buildAction = false, dependsOnUnresolved = false): string {
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
  // `planStepsForWorkItem` routes an "agent" Action to a `codex_build` step
  // (deterministic, no Decision-gated planning run) only when its title/next
  // action names an implementation verb; everything else -- including the
  // default wording below -- routes to `codex_planning` (Decision-gated).
  const title = buildAction ? "Implement the contract" : "Define the contract";
  const nextAction = buildAction ? "Implement the bounded contract." : "Define the bounded contract.";
  // A reference that can never resolve -- no Plan named "no-such-plan" exists
  // anywhere in this fixture -- so `dependency_unresolved` never self-clears
  // the way an ordinary unfinished dependency does.
  const dependsOn = dependsOnUnresolved ? `\n    depends_on: ["plan/no-such-plan#no-such-action"]` : "";
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
    title: ${title}
    status: open
    responsibility: agent
    effort: session
    clarification: clarified
    next_action: ${nextAction}
    expected_artifact: docs/contract.md
    acceptance_criteria:
      - The contract exists.
    decisions: ["0001"]${dependsOn}${second}
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
