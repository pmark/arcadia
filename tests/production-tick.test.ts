import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
import type { CapacityAdmissionDecision, ProviderCapacityObservation } from "../src/codingAgents/capacity.js";
import type { ProviderAdapterRegistry } from "../src/codingAgents/providerAdapters.js";
import { renderProductionStatusSuccess } from "../src/commands/production.js";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import {
  createCodexInvocation,
  createReviewItem,
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
  normalizeProductionScope,
  PRODUCTION_CONTROL_DEADLINES,
  type ProductionScope
} from "../src/production/policy.js";
import {
  runManagedProductionTick,
  resetProductionRepairBudget,
  listRecentBaseBranchAdvances,
  listLaunchBlockers,
  listOperatorEscalations,
  BASE_BRANCH_OBSERVATION_FAILURE_RETRY_MS
} from "../src/production/tick.js";
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

  it("settles a drafted complete Ask for the pointer instead of launching a Session, when its evidence already covers the Action", () => {
    const fixture = preparedFixture({ secondAction: true });
    const tmux = new FakeTmux();
    activatePolicy(fixture);

    // A previous session did the work and drafted its completion, but ended
    // (or was interrupted) before running the final settle -- exactly the gap
    // this Action closes. The draft's candidate_revision is the repository's
    // initial commit; the artifact and draft themselves land in a later
    // commit, so by the time the tick runs, HEAD has moved past it purely
    // because that later commit landed, not because anything diverged.
    const initialHead = git(fixture.repo, ["rev-parse", "HEAD"]).trim();
    mkdirSync(path.join(fixture.repo, "docs"), { recursive: true });
    writeFileSync(path.join(fixture.repo, "docs", "contract.md"), "# Contract\n\nDefined by define-contract.\n");
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
    git(fixture.repo, ["commit", "-m", "Produce the contract and draft its completion"]);

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
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Launch refused for test-project\/define-contract \[provider_not_permitted\]/));

    // A transient conflict (capacity/Off/stale-preview/lease) is an expected
    // wait state: no durable escalation is ever recorded for it, tick after
    // tick, exactly as before this capability existed.
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
    expect(secondTickLog).toHaveBeenCalledWith(expect.stringMatching(/Launch refused for test-project\/define-contract \[provider_not_permitted\]/));
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);
  });

  it("automatically requests a Decision-gated planning run instead of silently stalling on planning_required (Issue #584), and never escalates it to the operator", () => {
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
    // hand -- and it is never escalated, on this or any later tick, because
    // the resulting Decision is already operator-visible through Review.
    expect(ticks[0].log).toHaveBeenCalledWith(
      expect.stringMatching(/Automatically requested a Decision-gated planning run for test-project\/define-contract/)
    );
    for (const { log } of ticks) {
      expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/Escalated/));
    }
    // Only the first tick does the work; once the Decision exists, later
    // ticks find `planning_approval_pending` and never re-invoke `work plan`.
    expect(ticks[1].log).not.toHaveBeenCalledWith(expect.stringMatching(/Automatically/));
    expect(ticks[2].log).not.toHaveBeenCalledWith(expect.stringMatching(/Automatically/));

    // The pre-existing escalation seeded above is gone: it cleared through the
    // tick's ordinary escalate/clear branch (the resolved kind is no longer in
    // the non-self-resolving set), not a bespoke clearing path.
    expect(withReadOnlyDatabase(fixture.workspace, (db) => listOperatorEscalations(db))).toHaveLength(0);

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

    // The build packet still needs its own, pre-existing, unrelated approval
    // gate (`CodexBuildPacketApproval`) -- this fix never bypasses it. Approve
    // it exactly as Review already does today, standing in for the operator.
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
    // Fixed per-Project cost (resolveDispatch, resolveReadySet, and
    // inspectProject's own read), not one re-walk per ready or blocked
    // Action -- before this fix it grew with each.
    expect(calls).toBe(3);
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

function preparedFixture(options: { secondAction?: boolean; skipPacket?: boolean; buildAction?: boolean } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-production-tick-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), planDocument(options.secondAction ?? false, options.buildAction ?? false));
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
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
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

function planDocument(secondAction: boolean, buildAction = false): string {
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
