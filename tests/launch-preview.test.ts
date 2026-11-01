import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import defaultAdapters from "../config/defaults/provider-adapters.json" with { type: "json" };
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
import { activateProduction, fingerprintProductionScope, normalizeProductionScope } from "../src/production/policy.js";
import { prepareSession } from "../src/sessions/index.js";
import { buildLaunchPreview, LAUNCH_ADAPTER_SUPPORT } from "../src/sessions/launchPreview.js";
import { resolvePacketLifecycle } from "../src/sessions/packetLifecycle.js";
import { workItemInputRevision } from "../src/sessions/packetInputRevision.js";
import { runReviewRejectCommand } from "../src/commands/review.js";
import { prepareBuildPacketForAcceptedPlan, runWorkPlanCommand } from "../src/commands/work.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const profiles: CodingAgentProfile[] = [
  profile("codex_build", "codex-cli", "build", "workspace-write"),
  profile("claude_build", "claude-code-cli", "build", "workspace-write")
];

describe("buildLaunchPreview", () => {
  it("reports the missing browser audit capability before launching an existing Codex packet", () => {
    const fixture = preparedFixture({ provider: "codex-cli", model: "gpt-6-sol" });
    const plan = path.join(fixture.repo, "docs/plans/copy-proof.md");
    writeFileSync(plan, planDocument.replace("The contract exists.", "Mobile Lighthouse results are recorded."));
    const preview = withReadOnlyDatabase(fixture.workspace, db => buildLaunchPreview({
      db, workspace: fixture.workspace, repoRoot: fixture.repo, projectSlug: "test-project",
      requestId: "browser-preflight", profiles, adapters: defaultAdapters as ProviderAdapterRegistry
    }));
    expect(preview.ready).toBe(false);
    expect(preview.prerequisites.some(reason => reason.includes("local_browser_audit_unavailable"))).toBe(true);
    withReadOnlyDatabase(fixture.workspace, db => expect(db.prepare("SELECT count(*) AS n FROM agent_sessions").get()).toEqual({ n: 0 }));
  });
  it("is ready, starts no process, and mutates nothing when the packet and its authority are current", () => {
    const fixture = preparedFixture();
    const before = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM agent_sessions").get() as { n: number });

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-1",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );

    expect(preview.prerequisites).toEqual([]);
    expect(preview.ready).toBe(true);
    expect(preview.actionDocRef).toBe("plan/copy-proof#define-contract");
    expect(preview.queueRevision).toBeGreaterThanOrEqual(0);
    expect(preview.baseRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(preview.packet).toMatchObject({ invocationId: fixture.packetId, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(preview.authorizingDecisions).toContain("0001");
    expect(preview.selection).toMatchObject({ provider: "claude-code-cli", model: "sonnet", mappingId: "fixture-map", bindingId: "fixture-binding" });
    expect(preview.selectionRationale).toBeTruthy();
    expect(preview.documentRevisions.projectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.documentRevisions.planSha256).toMatch(/^[a-f0-9]{64}$/);

    const after = withReadOnlyDatabase(fixture.workspace, (db) => db.prepare("SELECT COUNT(*) AS n FROM agent_sessions").get() as { n: number });
    expect(after.n).toBe(before.n);

    const replay = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-1",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(replay.previewFingerprint).toBe(preview.previewFingerprint);
  });

  it("refuses to launch when the Project declares no validation commands, even with a current packet", () => {
    const fixture = preparedFixture({ noValidationCommands: true });

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-no-validation-commands",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );

    expect(preview.ready).toBe(false);
    expect(preview.prerequisites.some((entry) => entry.startsWith("no validation commands"))).toBe(true);
    expect(preview.prerequisites.some((entry) => entry.includes("arcadia project metadata"))).toBe(true);
    expect(preview.prerequisites.some((entry) => entry.includes("--validation-command"))).toBe(true);
  });

  it("names a missing build packet as a prerequisite instead of throwing", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-2",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(false);
    expect(preview.packet).toBeNull();
    expect(preview.packetLifecycle?.kind).toBe("planning_required");
    expect(preview.prerequisites.some((entry) => entry.startsWith("planning required"))).toBe(true);
    expect(preview.prerequisites[0]).toContain("arcadia work plan");
  });

  it("reports a named prerequisite when the packet-bound provider is not permitted by the active production policy", () => {
    const fixture = preparedFixture(); // default packet provider is "claude-code-cli"
    withDatabase(fixture.workspace, (db) => {
      const scope = normalizeProductionScope({
        intent: "Prove policy-provider enforcement at launch preview.",
        projects: ["test-project"],
        plans: ["test-project/copy-proof"],
        actions: [],
        providers: ["codex-cli"],
        maxConcurrentSessions: 1,
        mechanicalTransitions: []
      });
      activateProduction(db, {
        requestId: "policy-mismatch-1",
        scope,
        scopeFingerprint: fingerprintProductionScope(scope),
        grantedBy: "operator"
      });
    });

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-policy-mismatch",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );

    expect(preview.ready).toBe(false);
    const entry = preview.prerequisites.find((candidate) => candidate.startsWith("provider not permitted"));
    expect(entry).toBeTruthy();
    expect(entry).toContain("claude-code-cli");
    expect(entry).toContain("codex-cli");
    expect(entry).toContain("prepare a new build packet");
  });

  it("does not flag a provider mismatch for a packet outside the active policy's scope", () => {
    const fixture = preparedFixture(); // default packet provider is "claude-code-cli"
    withDatabase(fixture.workspace, (db) => {
      const scope = normalizeProductionScope({
        intent: "Prove out-of-scope Projects are never flagged for provider mismatch.",
        projects: ["some-other-project"],
        plans: ["some-other-project/queue-plan"],
        actions: [],
        providers: ["codex-cli"],
        maxConcurrentSessions: 1,
        mechanicalTransitions: []
      });
      activateProduction(db, {
        requestId: "policy-out-of-scope-1",
        scope,
        scopeFingerprint: fingerprintProductionScope(scope),
        grantedBy: "operator"
      });
    });

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-out-of-scope",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );

    expect(preview.ready).toBe(true);
    expect(preview.prerequisites.some((candidate) => candidate.startsWith("provider not permitted"))).toBe(false);
  });

  it("keeps a planning Decision distinct from build authority", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!);
    const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id });
    expect(prepared.data.planningDecision).toBeTruthy();

    const lifecycle = withReadOnlyDatabase(fixture.workspace, (db) =>
      resolvePacketLifecycle(db, getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!, { workspace: fixture.workspace })
    );
    expect(lifecycle).toMatchObject({
      kind: "planning_approval_pending",
      decisionId: prepared.data.planningDecision!.id
    });
    expect(lifecycle.remedy).toContain("planning only, not implementation");
  });

  it("lets an Action be planned again after its planning Decision is rejected", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!);
    const first = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id });
    expect(first.data.planningDecision).toBeTruthy();

    runReviewRejectCommand({ workspace: fixture.workspace, id: first.data.planningDecision!.id });
    // Rejecting moves the Action to requires_review; a docs sync restores it from
    // the plan document, which is what an operator does before planning again.
    withDatabase(fixture.workspace, (db) => {
      db.prepare("UPDATE work_items SET status = 'open', queue = 'work_queue', work_classification = 'agent' WHERE id = ?").run(workItem.id);
    });

    const second = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id });
    expect(second.data.planningDecision).toBeTruthy();
    expect(second.data.planningDecision!.id).not.toBe(first.data.planningDecision!.id);
    expect(second.data.planningDecision!.status).toBe("open");
  });

  it("uses the newest accepted planning Decision, not the oldest", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const { older, newer } = withDatabase(fixture.workspace, (db) => {
      const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
      const createPlanningDecision = (sourceInput: string) =>
        createReviewItem(db, {
          workItemId: workItem.id,
          projectId: workItem.project_id,
          decisionNeeded: "Approve the planning Run.",
          sourceInput,
          proposedAction: "Prepare a planning Artifact.",
          resolvedIntent: "CodexPlanningRunApproval",
          confidenceLabel: "high",
          confidence: 1,
          missingFields: []
        });

      // Backdate the first Decision so the two are unambiguously ordered.
      // listReviewItems sorts by created_at DESC, so `newer` must come first.
      const older = createPlanningDecision("older planning request");
      db.prepare("UPDATE review_items SET created_at = ?, updated_at = ? WHERE id = ?")
        .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", older.id);
      updateReviewItemStatus(db, older.id, { status: "approved", decisionNote: "Finished." });

      const newer = createPlanningDecision("newer planning request");
      updateReviewItemStatus(db, newer.id, { status: "approved", decisionNote: "Accepted." });
      return { older, newer };
    });

    const lifecycle = withReadOnlyDatabase(fixture.workspace, (db) =>
      resolvePacketLifecycle(db, getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!, { workspace: fixture.workspace })
    );

    expect(lifecycle).toMatchObject({ kind: "planning_in_progress", decisionId: newer.id });
    expect(lifecycle.remedy).toContain(newer.slug!);
    expect(lifecycle.remedy).not.toContain(older.slug!);
  });

  it("is Ready after accepting a governed plan whose Action has no execution requirement", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const acceptance = withDatabase(fixture.workspace, (db) => {
      const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
      const decision = createReviewItem(db, {
        workItemId: workItem.id,
        projectId: workItem.project_id,
        decisionNeeded: "Accept the validated planning Artifact.",
        sourceInput: "fixture",
        proposedAction: "Accept the plan.",
        resolvedIntent: "CodexPlanningArtifactAcceptance",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: []
      });
      const packet = prepareBuildPacketForAcceptedPlan(db, fixture.workspace, workItem, decision.id);
      expect(packet.invocation).toMatchObject({
        provider_mapping_id: "bundled-2026-07-25.1",
        provider_binding_id: "codex-terra"
      });
      updateReviewItemStatus(db, decision.id, { status: "approved", decisionNote: "Accepted." });
      return decision;
    });

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-accepted-plan-without-requirement",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );

    expect(preview.prerequisites).toEqual([]);
    expect(preview.ready).toBe(true);
    expect(preview.packetLifecycle?.kind).toBe("build_packet_ready");
    expect(preview.authorizingDecisions).toContain(acceptance.id);
    expect(preview.selection).toMatchObject({ provider: "codex-cli", model: "gpt-5.6-terra" });
  });

  it("reports Ready for an accepted plan once its prepared build approval is approved", () => {
    const fixture = preparedFixture({ skipInvocation: true });
    const approval = withDatabase(fixture.workspace, (db) => {
      const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
      const acceptance = createReviewItem(db, {
        workItemId: workItem.id,
        projectId: workItem.project_id,
        decisionNeeded: "Accept the planning Artifact.",
        sourceInput: "fixture",
        proposedAction: "Accept.",
        resolvedIntent: "CodexPlanningArtifactAcceptance",
        confidenceLabel: "high",
        confidence: 1,
        missingFields: []
      });
      const prepared = prepareBuildPacketForAcceptedPlan(db, fixture.workspace, workItem, acceptance.id);
      expect(prepared.invocation.provider_mapping_id).toBe("bundled-2026-07-25.1");
      return acceptance;
    });
    const preview = () =>
      withReadOnlyDatabase(fixture.workspace, (db) =>
        buildLaunchPreview({
          db,
          workspace: fixture.workspace,
          repoRoot: fixture.repo,
          projectSlug: "test-project",
          requestId: "req-accepted-plan",
          profiles,
          adapters: defaultAdapters as ProviderAdapterRegistry
        })
      );

    expect(preview().ready).toBe(false);
    const pending = preview();
    expect(pending.prerequisites.join("\n")).toContain(`build packet approval pending: Decision ${approval.id}`);
    expect(pending.packetLifecycle).toMatchObject({
      kind: "build_packet_approval_pending",
      decisionId: approval.id,
      remedy: `Approve build packet Decision ${approval.id}: arcadia review approve ${approval.id} --no-execute`
    });

    withDatabase(fixture.workspace, (db) => updateReviewItemStatus(db, approval.id, { status: "rejected", decisionNote: "Rejected." }));
    expect(preview().prerequisites.join("\n")).toContain("no longer approved (rejected)");
    expect(preview().packetLifecycle?.kind).toBe("stale_packet");

    withDatabase(fixture.workspace, (db) => updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Accepted." }));

    const ready = preview();
    expect(ready.prerequisites).toEqual([]);
    expect(ready.ready).toBe(true);
    expect(ready.packetLifecycle?.kind).toBe("build_packet_ready");
  });

  it("names a changed packet's stale authority as a prerequisite instead of throwing", () => {
    const fixture = preparedFixture();
    writeFileSync(path.join(fixture.workspace, "prompts", "codex", fixture.packetId, "prompt.md"), "changed after approval\n");
    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-3",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(false);
    expect(preview.packetLifecycle?.kind).toBe("stale_packet");
    expect(preview.prerequisites.some((entry) => entry.includes("stale") && entry.includes("authority"))).toBe(true);

    // Still stale -- not "approval pending" -- when its approval is open:
    // approving a changed packet would only fail at launch.
    withDatabase(fixture.workspace, (db) => {
      const row = db
        .prepare("SELECT id FROM review_items WHERE context_json LIKE ?")
        .get(`%"buildInvocationId":"${fixture.packetId}"%`) as { id: string };
      updateReviewItemStatus(db, row.id, { status: "open", decisionNote: "Reopened." });
    });
    const reopened = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-3b",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(reopened.packetLifecycle?.kind).toBe("stale_packet");
    expect(reopened.prerequisites.join("\n")).not.toContain("approval pending");
  });

  describe("a declared execution route against old planning history", () => {
    const lifecycleOf = (workspace: string) => withReadOnlyDatabase(workspace, (db) =>
      resolvePacketLifecycle(db, getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!, { workspace }));
    const statusOf = (workspace: string, id: string) => withReadOnlyDatabase(workspace, (db) =>
      (db.prepare("SELECT status FROM review_items WHERE id = ?").get(id) as { status: string }).status);

    it("prepares a build packet, not a planning run, when an approved planning Decision predates execution: build", () => {
      const fixture = preparedFixture({ skipInvocation: true, execution: "build" });
      const history = addPlanningHistory(fixture.workspace, "approved");

      const before = lifecycleOf(fixture.workspace);
      expect(before.kind).toBe("planning_required");
      expect(before.remedy).toContain("execution: build");

      const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!);
      const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id, agentProfile: "claude_build" });
      expect(prepared.data.planningDecision).toBeNull();
      expect(prepared.data.buildInvocation?.purpose).toBe("build");
      expect(prepared.data.buildApproval?.resolved_intent).toBe("CodexBuildPacketApproval");
      expect(lifecycleOf(fixture.workspace)).toMatchObject({ kind: "build_packet_ready", invocationId: prepared.data.buildInvocation!.id });

      // The old planning records stay exactly as they were, as history.
      expect(statusOf(fixture.workspace, history.planning)).toBe("approved");
      expect(statusOf(fixture.workspace, history.validation)).toBe("open");
    });

    it("does not reuse an open planning Decision for an Action that declares execution: build", () => {
      const fixture = preparedFixture({ skipInvocation: true, execution: "build" });
      const history = addPlanningHistory(fixture.workspace, "open");
      expect(lifecycleOf(fixture.workspace).kind).toBe("planning_required");

      const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!);
      const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id, agentProfile: "claude_build" });
      expect(prepared.data.reused).toBe(false);
      expect(prepared.data.planningDecision).toBeNull();
      expect(prepared.data.buildInvocation).toBeTruthy();
      expect(statusOf(fixture.workspace, history.planning)).toBe("open");
    });

    it("still gates a plan-run Action, and an undeclared one, on its approved planning Decision", () => {
      for (const execution of ["plan-run", undefined] as const) {
        const fixture = preparedFixture({ skipInvocation: true, ...(execution ? { execution } : {}) });
        const history = addPlanningHistory(fixture.workspace, "approved");
        expect(lifecycleOf(fixture.workspace)).toMatchObject({ kind: "planning_in_progress", decisionId: history.planning });
      }
    });
  });

  describe("a build packet prepared for an earlier Action input", () => {
    const preview = (fixture: { workspace: string; repo: string }, requestId: string) =>
      withReadOnlyDatabase(fixture.workspace, (db) => buildLaunchPreview({
        db, workspace: fixture.workspace, repoRoot: fixture.repo, projectSlug: "test-project",
        requestId, profiles, adapters: defaultAdapters as ProviderAdapterRegistry
      }));

    it("is a stale packet once the Action's acceptance criteria change, and work plan prepares a fresh one", () => {
      const fixture = preparedFixture({ skipInvocation: true, execution: "build" });
      const workItem = withReadOnlyDatabase(fixture.workspace, (db) => getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!);
      const first = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id, agentProfile: "claude_build" });
      const firstId = first.data.buildInvocation!.id;
      const metadata = JSON.parse(readFileSync(path.join(fixture.workspace, path.dirname(first.data.buildInvocation!.prompt_path), "metadata.json"), "utf8"));
      expect(metadata.actionInputRevision).toBe(workItemInputRevision(workItem));
      withDatabase(fixture.workspace, (db) => updateReviewItemStatus(db, first.data.buildApproval!.id, { status: "approved", decisionNote: "Approved for the old criteria." }));
      expect(preview(fixture, "before-amend").packetLifecycle?.kind).toBe("build_packet_ready");

      const plan = path.join(fixture.repo, "docs/plans/copy-proof.md");
      // A governed amendment: newer `updated:` so the sync applies it.
      writeFileSync(plan, readFileSync(plan, "utf8")
        .replace("The contract exists.", "The contract exists and names its owner.")
        .replace("updated: 2026-08-30", "updated: 2099-01-01"));
      resync(fixture.workspace);

      const stale = preview(fixture, "after-amend");
      expect(stale.ready).toBe(false);
      expect(stale.packet).toBeNull();
      expect(stale.packetLifecycle).toMatchObject({ kind: "stale_packet", invocationId: firstId, supersededInput: true });
      expect(stale.prerequisites.some((entry) => entry.startsWith("stale packet"))).toBe(true);

      const second = runWorkPlanCommand({ workspace: fixture.workspace, workId: workItem.id, agentProfile: "claude_build" });
      expect(second.data.buildInvocation!.id).not.toBe(firstId);
      expect(second.data.buildApproval!.status).toBe("open");
      const fresh = preview(fixture, "after-replan");
      expect(fresh.packetLifecycle).toMatchObject({ kind: "build_packet_approval_pending", invocationId: second.data.buildInvocation!.id });
      // The superseded packet is history, not deleted.
      withReadOnlyDatabase(fixture.workspace, (db) =>
        expect((db.prepare("SELECT status FROM codex_invocations WHERE id = ?").get(firstId) as { status: string }).status).toBe("packet_created"));
    });

    it("fails closed: a packet that records no input revision is stale", () => {
      const fixture = preparedFixture({ omitInputRevision: true });
      const result = preview(fixture, "no-revision");
      expect(result.ready).toBe(false);
      expect(result.packetLifecycle).toMatchObject({ kind: "stale_packet", invocationId: fixture.packetId, supersededInput: true });
    });
  });

  it("names an already-leased repository as a conflicting-execution prerequisite", () => {
    const fixture = preparedFixture();
    const dispatch = resolveDispatch(fixture.repo, "test-project");
    const queriedNames: string[] = [];
    const tmuxStub = {
      available: () => true,
      hasSession: (name: string) => {
        queriedNames.push(name);
        return false;
      },
      launch: () => {
        throw new Error("tmux.launch() should not be called during prepareSession");
      }
    };
    withDatabase(fixture.workspace, (db) =>
      prepareSession({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        dispatch,
        agent: "claude",
        model: "sonnet",
        effort: "high",
        baseRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.repo, encoding: "utf8" }).trim(),
        branch: "claude/held",
        worktreePath: path.join(fixture.root, "held-worktree"),
        now: fixture.now,
        tmux: tmuxStub
      })
    );

    expect(queriedNames.length).toBeGreaterThan(0);
    expect(queriedNames.every((name) => name.startsWith("arcadia-test-project-"))).toBe(true);

    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-4",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(false);
    expect(preview.prerequisites.some((entry) => entry.startsWith("conflicting execution"))).toBe(true);
  });

  it("accepts a packet-selected Codex adapter without silently substituting another provider", () => {
    expect(LAUNCH_ADAPTER_SUPPORT["codex-cli"]).toBe(true);
    const fixture = preparedFixture({ provider: "codex-cli", model: "gpt-5.6-terra", mappingId: "bundled-2026-07-25.1", bindingId: "codex-terra" });
    const preview = withReadOnlyDatabase(fixture.workspace, (db) =>
      buildLaunchPreview({
        db,
        workspace: fixture.workspace,
        repoRoot: fixture.repo,
        projectSlug: "test-project",
        requestId: "req-5",
        profiles,
        adapters: defaultAdapters as ProviderAdapterRegistry
      })
    );
    expect(preview.ready).toBe(true);
    expect(preview.prerequisites).toEqual([]);
    expect(preview.selection?.provider).toBe("codex-cli");
    // Decision 0063: substitution only ever applies before a packet exists.
    // This packet is already bound, so no substitution is ever recorded for
    // it even though a fresh selection ran to validate it against the current
    // registry.
    expect(preview.substitution).toBeNull();
  });
});

function preparedFixture(options?: { skipInvocation?: boolean; provider?: string; model?: string; mappingId?: string; bindingId?: string; noValidationCommands?: boolean; execution?: "build" | "plan-run"; omitInputRevision?: boolean }) {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-launch-preview-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs", "plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDocument);
  writeFileSync(path.join(repo, "docs", "plans", "copy-proof.md"), options?.execution ? withExecutionRoute(planDocument, options.execution) : planDocument);
  writeFileSync(path.join(repo, "docs", "decisions", "0001-authorize.md"), decisionDocument);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "arcadia@example.test"]);
  git(repo, ["config", "user.name", "Arcadia Test"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  initWorkspace(workspace);
  const packetId = "codex_launch_preview_fixture";
  const provider = options?.provider ?? "claude-code-cli";
  const model = options?.model ?? "sonnet";
  const mappingId = options?.mappingId ?? "fixture-map";
  const bindingId = options?.bindingId ?? "fixture-binding";
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, { name: "Test Project", mission: "Prove launch previews.", goal: "Prove launch previews.", status: "active" });
    upsertProjectMetadata(db, {
      projectId: project.id,
      repoPath: repo,
      validationCommands: options?.noValidationCommands ? [] : ["node -e \"process.exit(0)\""]
    });
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not sync");
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    if (options?.skipInvocation) return;
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
        providerSelection: { provider, model, mappingId, bindingId },
        ...(options?.omitInputRevision ? {} : { actionInputRevision: workItemInputRevision(workItem) })
      })
    );
    createCodexInvocation(db, {
      id: packetId,
      purpose: "build",
      agentProfile: provider === "codex-cli" ? "codex_build" : "claude_build",
      workspaceScope: repo,
      command: provider === "codex-cli" ? "codex" : "claude",
      promptPath,
      jsonlOutputPath: `prompts/codex/${packetId}/output.jsonl`,
      finalMessagePath: `prompts/codex/${packetId}/final.md`,
      status: "packet_created",
      workItemId: workItem.id,
      executionProfileJson: JSON.stringify({ schema: "arcadia.execution/v1", profile: "routine_implementation" }),
      providerMappingId: mappingId,
      providerBindingId: bindingId
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
          buildProfile: provider === "codex-cli" ? "codex_build" : "claude_build",
          buildInvocationId: packetId,
          buildPacketPath: promptPath,
          buildPacketSha256: packetSha256(path.join(workspace, promptPath))
        }
      }
    });
    updateReviewItemStatus(db, approval.id, { status: "approved", decisionNote: "Fixture authority approved." });
  });
  return { root, repo, workspace, packetId, now: new Date("2026-08-30T12:34:56.000Z") };
}

function withExecutionRoute(document: string, route: "build" | "plan-run"): string {
  return document.replace("    decisions: [\"0001\"]\n", `    decisions: ["0001"]\n    execution: ${route}\n`);
}

function resync(workspace: string): void {
  withDatabase(workspace, (db) => {
    const project = db.prepare("SELECT * FROM projects LIMIT 1").get() as Parameters<typeof syncProjectDocs>[1];
    const sync = syncProjectDocs(db, project, { apply: true });
    if (sync.errors.length || sync.rejected.length) throw new Error("fixture docs did not re-sync");
  });
}

function addPlanningHistory(workspace: string, planningStatus: "open" | "approved"): { planning: string; validation: string } {
  return withDatabase(workspace, (db) => {
    const workItem = getWorkItemByDocRef(db, "plan/copy-proof#define-contract")!;
    const planning = createReviewItem(db, {
      workItemId: workItem.id,
      projectId: workItem.project_id,
      decisionNeeded: "Approve the planning Run.",
      sourceInput: "run d planning request",
      proposedAction: "Prepare a planning Artifact.",
      resolvedIntent: "CodexPlanningRunApproval",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: []
    });
    if (planningStatus === "approved") updateReviewItemStatus(db, planning.id, { status: "approved", decisionNote: "Run d approved planning." });
    const validation = createReviewItem(db, {
      workItemId: workItem.id,
      projectId: workItem.project_id,
      decisionNeeded: "Validate the planning Artifact.",
      sourceInput: "run d planning artifact",
      proposedAction: "Retry planning.",
      resolvedIntent: "codex_planning_artifact_validation",
      confidenceLabel: "high",
      confidence: 1,
      missingFields: []
    });
    return { planning: planning.id, validation: validation.id };
  });
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function profile(name: string, provider: string, purpose: "planning" | "build", sandbox: "read-only" | "workspace-write"): CodingAgentProfile {
  return {
    name,
    provider,
    package: provider === "codex-cli" ? "@openai/codex" : "@anthropic-ai/claude-code",
    command: provider === "codex-cli" ? "codex" : "claude",
    purpose,
    sandbox,
    args: []
  };
}

const projectDocument = `---
arcadia: v1
type: project
slug: test-project
name: Test Project
status: active
goal: Prove launch previews.
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
question: Authorize this fixture?
answer: Yes.
decided: 2026-08-30
updated: 2026-08-30
---

# Decision
`;
