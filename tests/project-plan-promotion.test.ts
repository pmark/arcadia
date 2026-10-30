import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDocsSyncCommand } from "../src/commands/docs.js";
import { runSessionPreviewLaunchCommand } from "../src/commands/advance.js";
import * as assignment from "../src/sessions/promotionAssignment.js";
import * as promotionOps from "../src/projects/planningPromotion.js";
import { launchGuardedHostSession } from "../src/sessions/launch.js";
import { loadPhase3Registries } from "../src/intent/registries.js";
import { runProjectPrepareCommand } from "../src/commands/project.js";
import { runReviewApproveCommand, runReviewDeferCommand, runReviewRejectCommand } from "../src/commands/review.js";
import { runWorkPlanCommand, runWorkRunCommand } from "../src/commands/work.js";
import { runWorkerIteration } from "../src/commands/worker.js";
import { buildDashboardSnapshot } from "../src/dashboard/snapshot.js";
import { withDatabase } from "../src/db/connection.js";
import {
  getReviewItem,
  getWorkItem,
  getWorkItemByDocRef,
  listCodexInvocationsForWorkItem,
  listExecutionRuns,
  listReviewItems,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { isDispatchable, resolveDispatch } from "../src/docs/dispatch.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";
import { completePlanningArtifact } from "./planningArtifactValidationFixtures.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("project-idea planning promotion", () => {
  it("promotes one accepted plan Action, prepares one build packet, and is idempotent", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);
    const runCountBeforeAcceptance = withDatabase(fixture.workspace, (db) => listExecutionRuns(db)).length;

    const accepted = runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id });
    const promotion = accepted.data.promotion;

    expect(promotion).toBeTruthy();
    expect(accepted.data.run).toBeNull();
    expect(accepted.data.result.summary).toContain("No Run started");
    expect(promotion?.trigger).toMatch(/^arcadia work run .+ --plan .+ --allow-codex-build --agent-profile codex_build$/);
    expect(existsSync(path.join(fixture.workspace, promotion!.buildPacketPath))).toBe(true);
    expect(withDatabase(fixture.workspace, (db) => listExecutionRuns(db))).toHaveLength(runCountBeforeAcceptance);

    const dispatch = resolveDispatch(fixture.repository, fixture.projectSlug);
    expect(isDispatchable(dispatch)).toBe(true);
    expect(dispatch.context?.action.id).toBe(promotion?.actionDocRef.split("#")[1]);
    expect(dispatch.context?.action.responsibility).toBe("agent");
    expect(dispatch.context?.action.clarification).toBe("clarified");

    const projectDoc = frontmatter(path.join(fixture.repository, "PROJECT.md"));
    const planDoc = frontmatter(path.join(fixture.repository, promotion!.planPath));
    const actions = planDoc.actions as Array<Record<string, unknown>>;
    const planningAction = actions.find((action) => action.id === fixture.planningActionId);
    const promotedActions = actions.filter((action) => action.source === `[planning-promotion:${acceptance.id}]`);
    expect(projectDoc.current_action).toBe(promotedActions[0]?.id);
    expect(planDoc.current_action).toBe(promotedActions[0]?.id);
    expect(planningAction?.status).toBe("done");
    expect(promotedActions).toHaveLength(1);
    expect(promotedActions[0]).toMatchObject({
      status: "open",
      responsibility: "agent",
      clarification: "clarified",
      depends_on: [fixture.planningActionId]
    });
    expect(promotedActions[0]?.acceptance_criteria).toHaveLength(3);

    withDatabase(fixture.workspace, (db) => {
      const promoted = getWorkItemByDocRef(db, promotion!.actionDocRef);
      expect(promoted).toBeTruthy();
      expect(promoted?.status).toBe("open");
      expect(promoted?.work_classification).toBe("agent");
      const invocations = listCodexInvocationsForWorkItem(db, promoted!.id);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toMatchObject({
        id: promotion!.buildInvocationId,
        purpose: "build",
        agent_profile: "codex_build",
        status: "packet_created"
      });
      const context = JSON.parse(getReviewItem(db, acceptance.id)!.context_json) as Record<string, unknown>;
      expect(context.planningPromotion).toMatchObject({
        actionDocRef: promotion!.actionDocRef,
        planningArtifactId: acceptance.artifact_id,
        acceptanceDecisionId: acceptance.id,
        buildInvocationId: promotion!.buildInvocationId,
        trigger: promotion!.trigger
      });
      expect(context.judgedArtifact).toMatchObject({
        artifactId: acceptance.artifact_id,
        artifactPath: acceptance.artifact_path,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
    });

    const packet = readFileSync(path.join(fixture.workspace, promotion!.buildPacketPath), "utf8");
    expect(packet).toContain(fixture.idea);
    expect(packet).toContain(acceptance.artifact_path!);
    expect(packet).toContain(acceptance.id);
    expect(packet).toContain(fixture.repository);
    expect(packet).toContain("codex_build");

    const repeated = runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id });
    expect(repeated.data.promotion).toEqual(promotion);
    const repeatedPlan = frontmatter(path.join(fixture.repository, promotion!.planPath));
    expect((repeatedPlan.actions as Array<Record<string, unknown>>)
      .filter((action) => action.source === `[planning-promotion:${acceptance.id}]`)).toHaveLength(1);
    withDatabase(fixture.workspace, (db) => {
      const promoted = getWorkItemByDocRef(db, promotion!.actionDocRef)!;
      expect(listCodexInvocationsForWorkItem(db, promoted.id)).toHaveLength(1);
    });
  });

  it("reuses the accepted promotion when preparing the promoted Action again", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);
    const promotion = runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id }).data.promotion!;
    const packetPath = path.join(fixture.workspace, promotion.buildPacketPath);
    const packet = readFileSync(packetPath);
    const before = withDatabase(fixture.workspace, (db) => ({
      invocations: listCodexInvocationsForWorkItem(db, promotion.actionId),
      decisions: listReviewItems(db, "all"),
      runs: listExecutionRuns(db)
    }));
    const result = runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId, agentProfile: "codex_build" });
    expect(result.data.plan.id).toBe(promotion.buildPlanId);
    expect(result.data.buildInvocation?.id).toBe(promotion.buildInvocationId);
    expect(readFileSync(packetPath)).toEqual(packet);
    withDatabase(fixture.workspace, (db) => {
      expect(listCodexInvocationsForWorkItem(db, promotion.actionId)).toEqual(before.invocations);
      expect(listReviewItems(db, "all")).toEqual(before.decisions);
      expect(listExecutionRuns(db)).toEqual(before.runs);
    });
  });

  it.each(["packet", "planning-artifact", "binding", "missing-receipt", "missing-marker", "profile", "running", "duplicate"] as const)(
    "refuses stale or spent promoted build preparation: %s", (mode) => {
      const fixture = preparedProjectIdea();
      const acceptance = executePlanningRun(fixture);
      const promotion = runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id }).data.promotion!;
      const packetPath = path.join(fixture.workspace, promotion.buildPacketPath);
      if (mode === "packet") writeFileSync(packetPath, "changed");
      if (mode === "planning-artifact") writeFileSync(path.join(fixture.workspace, promotion.planningArtifactPath), "changed");
      withDatabase(fixture.workspace, (db) => {
        if (mode === "missing-marker") db.prepare("UPDATE work_items SET clarification_source = NULL WHERE id = ?").run(promotion.actionId);
        if (mode === "missing-receipt") db.prepare("UPDATE review_items SET context_json = ? WHERE id = ?").run("{}", acceptance.id);
        if (mode === "binding") {
          const context = JSON.parse(getReviewItem(db, acceptance.id)!.context_json);
          context.planningPromotion.buildPlanId = "wrong";
          db.prepare("UPDATE review_items SET context_json = ? WHERE id = ?").run(JSON.stringify(context), acceptance.id);
        }
        if (mode === "running") db.prepare("UPDATE codex_invocations SET status = ? WHERE id = ?").run("running", promotion.buildInvocationId);
        if (mode === "duplicate") db.prepare("INSERT INTO codex_invocations SELECT 'duplicate', purpose, agent_profile, workspace_scope, command, prompt_path, jsonl_output_path, final_message_path, status, work_item_id, plan_id, plan_step_id, run_id, execution_profile_json, provider_mapping_id, provider_binding_id, created_at, updated_at FROM codex_invocations WHERE id = ?").run(promotion.buildInvocationId);
      });
      const before = withDatabase(fixture.workspace, (db) => ({ invocations: listCodexInvocationsForWorkItem(db, promotion.actionId), decisions: listReviewItems(db, "all"), runs: listExecutionRuns(db) }));
      expect(() => runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId, agentProfile: mode === "profile" ? "claude_build" : "codex_build" })).toThrow(mode === "missing-receipt" ? /Promoted Action has no matching acceptance receipt; preserve its packet and investigate the missing binding\./ : mode === "running" ? /running/ : /./);
      withDatabase(fixture.workspace, (db) => {
        expect(listCodexInvocationsForWorkItem(db, promotion.actionId)).toEqual(before.invocations);
        expect(listReviewItems(db, "all")).toEqual(before.decisions);
        expect(listExecutionRuns(db)).toEqual(before.runs);
      });
    }
  );

  it("prepares one separately approved replacement after a consumed attempt", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);
    const promotion = runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id }).data.promotion!;
    const packet = readFileSync(path.join(fixture.workspace, promotion.buildPacketPath));
    const registryPath = getWorkspacePaths(fixture.workspace).codingAgentProfiles;
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as { profiles: Array<Record<string, unknown>> };
    const profile = registry.profiles.find((item) => item.name === "codex_build")!;
    const fake = path.join(fixture.workspace, "fake-build.cjs");
    writeFileSync(fake, 'process.stdin.resume(); process.stdin.on("end", () => process.exit(1));');
    profile.command = process.execPath;
    profile.args = [fake];
    writeFileSync(registryPath, JSON.stringify(registry));
    const attempted = runWorkRunCommand({ workspace: fixture.workspace, workId: promotion.actionId, plan: promotion.buildPlanId, allowCodexBuild: true, agentProfile: "codex_build" });
    expect(attempted.data.run.status).toBe("failed");
    runDocsSyncCommand({ workspace: fixture.workspace, project: fixture.projectSlug, apply: true });
    const before = withDatabase(fixture.workspace, (db) => ({ original: listCodexInvocationsForWorkItem(db, promotion.actionId), runs: listExecutionRuns(db), acceptance: getReviewItem(db, acceptance.id) }));
    const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId, agentProfile: "codex_build" }).data;
    expect(prepared.plan.id).not.toBe(promotion.buildPlanId);
    expect(prepared.buildInvocation?.id).not.toBe(promotion.buildInvocationId);
    expect(prepared.buildApproval?.status).toBe("open");
    const replacement = readFileSync(path.join(fixture.workspace, prepared.buildInvocation!.prompt_path), "utf8");
    expect(replacement).toContain(fixture.idea);
    expect(replacement).toContain(promotion.planningArtifactPath);
    expect(replacement).toContain(promotion.validationArtifactPath);
    expect(replacement).toContain(acceptance.id);
    expect(readFileSync(path.join(fixture.workspace, promotion.buildPacketPath))).toEqual(packet);
    const repeated = runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId, agentProfile: "codex_build" }).data;
    expect(repeated.plan.id).toBe(prepared.plan.id);
    expect(repeated.buildInvocation?.id).toBe(prepared.buildInvocation?.id);
    expect(repeated.buildApproval?.id).toBe(prepared.buildApproval?.id);
    withDatabase(fixture.workspace, (db) => {
      const invocations = listCodexInvocationsForWorkItem(db, promotion.actionId);
      expect(invocations).toHaveLength(2);
      expect(invocations.find((item) => item.id === promotion.buildInvocationId)).toEqual(before.original[0]);
      expect(listExecutionRuns(db)).toEqual(before.runs);
      expect(getReviewItem(db, acceptance.id)).toEqual(before.acceptance);
    });
  });

  it.each(["deferred", "approved", "rejected"] as const)("respects the current replacement approval state: %s", (status) => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);
    const promotion = runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id }).data.promotion!;
    withDatabase(fixture.workspace, (db) => db.prepare("UPDATE codex_invocations SET status = 'completed' WHERE id = ?").run(promotion.buildInvocationId));
    const prepared = runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId, agentProfile: "codex_build" }).data;
    withDatabase(fixture.workspace, (db) => db.prepare("UPDATE review_items SET status = ? WHERE id = ?").run(status, prepared.buildApproval!.id));
    const runs = withDatabase(fixture.workspace, (db) => listExecutionRuns(db));
    const repeated = runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId, agentProfile: "codex_build" }).data;
    expect(repeated.buildInvocation?.id).toBe(prepared.buildInvocation?.id);
    if (status === "rejected") {
      expect(repeated.buildApproval?.id).not.toBe(prepared.buildApproval?.id);
      expect(repeated.buildApproval?.status).toBe("open");
    } else {
      expect(repeated.buildApproval?.id).toBe(prepared.buildApproval?.id);
      expect(repeated.buildApproval?.status).toBe(status);
    }
    expect(withDatabase(fixture.workspace, (db) => listExecutionRuns(db))).toEqual(runs);
  });

  it.each(["unchanged", "committed legacy", "source changed", "source symlink", "unrelated change", "concurrent change", "packet tampered", "replay altered", "replay unrelated", "replay date"])("binds the accepted promoted Action to a candidate (%s)", scenario => {
    const fixture = preparedProjectIdea();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture.repository, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    git("add", ".");
    git("commit", "-qm", "baseline");
    writeFileSync(path.join(fixture.workspace, "fake-planning-output.md"), completePlanningArtifact.replace(
      "Implement the deterministic planning artifact validator module, read-only artifact validation command, and fixture-driven tests only, with no dashboard or Discord redesign.",
      "Implement the deterministic artifact validator module and fixture-driven tests only, with no dashboard or Discord redesign."
    ));
    const acceptance = executePlanningRun(fixture);
    const legacy = vi.spyOn(assignment, "promotionAssignmentBlock").mockReturnValueOnce(null);
    const promotion = runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id }).data.promotion!;
    legacy.mockRestore();
    const oldPacket = readFileSync(path.join(fixture.workspace, promotion.buildPacketPath));
    // Emulate a previously prepared legacy replacement packet, as in R476.
    const oldReprepare = vi.spyOn(promotionOps, "replayAcceptedPromotionAssignment").mockReturnValueOnce("");
    const prior = runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId });
    oldReprepare.mockRestore();
    runReviewApproveCommand({ workspace: fixture.workspace, id: prior.data.buildApproval!.id, execute: false });
    const priorPacketPath = path.join(fixture.workspace, prior.data.buildInvocation!.prompt_path);
    const priorPacket = readFileSync(priorPacketPath);
    if (scenario === "committed legacy") {
      git("add", "--", "PROJECT.md", promotion.planPath);
      git("commit", "-qm", "fixture accepted records");
    }
    const approvedBase = git("rev-parse", "HEAD");
    if (scenario === "replay altered") writeFileSync(path.join(fixture.repository, promotion.planPath), `${readFileSync(path.join(fixture.repository, promotion.planPath), "utf8")}\nchanged\n`);
    if (scenario === "replay date") {
      for (const file of ["PROJECT.md", promotion.planPath]) {
        const absolute = path.join(fixture.repository, file);
        writeFileSync(absolute, readFileSync(absolute, "utf8").replace(/^updated: .+$/m, "updated: 2001-01-01"));
      }
    }
    if (scenario === "replay unrelated") writeFileSync(path.join(fixture.repository, "unrelated.txt"), "unrelated");
    if (scenario.startsWith("replay ")) {
      expect(() => runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId })).toThrow();
      expect(readFileSync(priorPacketPath)).toEqual(priorPacket);
      return;
    }
    const reviewCountBefore = withDatabase(fixture.workspace, db => listReviewItems(db, "all").length);
    const planned = runWorkPlanCommand({ workspace: fixture.workspace, workId: promotion.actionId });
    expect(readFileSync(priorPacketPath)).toEqual(priorPacket);
    if (scenario === "committed legacy") {
      expect(withDatabase(fixture.workspace, db => listReviewItems(db, "all").length)).toBe(reviewCountBefore);
      expect(planned.data.buildInvocation!.id).toBe(prior.data.buildInvocation!.id);
      expect(planned.data.buildApproval!.id).toBe(prior.data.buildApproval!.id);
    } else {
      expect(planned.data.buildApproval).toBeTruthy();
      expect(planned.data.buildInvocation!.id).not.toBe(prior.data.buildInvocation!.id);
      runReviewApproveCommand({ workspace: fixture.workspace, id: planned.data.buildApproval!.id, execute: false });
    }
    expect(readFileSync(path.join(fixture.workspace, promotion.buildPacketPath))).toEqual(oldPacket);
    const preview = runSessionPreviewLaunchCommand({ workspace: fixture.workspace, repo: fixture.repository, requestId: "promoted-candidate" }).data;
    expect(preview.prerequisites).toEqual([]);
    expect(preview.actionDocRef).toBe(promotion.actionDocRef);
    expect(preview.baseRevision).toBe(approvedBase);
    const packetPath = path.join(fixture.workspace, planned.data.buildInvocation!.prompt_path);
    const packetBefore = readFileSync(packetPath);
    const sourceProject = readFileSync(path.join(fixture.repository, "PROJECT.md"));
    const sourcePlan = readFileSync(path.join(fixture.repository, promotion.planPath));
    const sourceStatus = git("status", "--porcelain");
    const registries = loadPhase3Registries(fixture.workspace);
    const launches: Array<{ cwd: string; args: string[] }> = [];
    const tmux = {
      available: () => true,
      hasSession: () => false,
      launch: (input: { cwd: string; args: string[] }) => { launches.push(input); }
    };
    const mutate = () => {
      const file = path.join(fixture.repository, promotion.planPath);
      if (scenario === "source changed" || scenario === "concurrent change") writeFileSync(file, `${sourcePlan.toString()}\nchanged\n`);
      if (scenario === "packet tampered") writeFileSync(packetPath, "tampered packet");
      if (scenario === "unrelated change") writeFileSync(path.join(fixture.repository, "unrelated.txt"), "unrelated");
      if (scenario === "source symlink") { rmSync(file); symlinkSync(path.join(fixture.repository, "PROJECT.md"), file); }
    };
    const run = () => withDatabase(fixture.workspace, db => launchGuardedHostSession({
      db, workspace: fixture.workspace, repoRoot: fixture.repository, projectSlug: fixture.projectSlug,
      requestId: "promoted-candidate", previewFingerprint: preview.previewFingerprint,
      profiles: registries.codingAgents.profiles, adapters: registries.providerAdapters!, tmux,
      providerSignIn: () => null, agentWorktreeRoot: path.join(path.dirname(fixture.repository), "candidates"),
      testHooks: scenario === "concurrent change" ? { beforeSessionInsert: mutate } : { afterWorktreeCreatedBeforeReservationCommit: mutate }
    }));
    if (scenario !== "unchanged" && scenario !== "committed legacy") {
      expect(run).toThrow();
      expect(launches).toHaveLength(0);
      return;
    }
    const launched = run();
    expect(launches).toHaveLength(1);
    const replay = run();
    expect(replay.reused).toBe(true);
    expect(replay.session.id).toBe(launched.session.id);
    expect(launches).toHaveLength(1);
    expect(launched.session.action_id).toBe(preview.actionId);
    expect(readFileSync(path.join(launched.session.worktree_path, promotion.planPath), "utf8"))
      .toBe(readFileSync(path.join(fixture.repository, promotion.planPath), "utf8"));
    expect(git("rev-parse", "HEAD")).toBe(approvedBase);
    expect(git("status", "--porcelain")).toBe(sourceStatus);
    expect(readFileSync(packetPath)).toEqual(packetBefore);
    expect(readFileSync(path.join(fixture.repository, "PROJECT.md"))).toEqual(sourceProject);
    expect(readFileSync(path.join(fixture.repository, promotion.planPath))).toEqual(sourcePlan);
    withDatabase(fixture.workspace, db => {
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_sessions").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM session_role_attempts WHERE role = 'development'").get()).toEqual({ n: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_worktree_reservations").get()).toEqual({ n: 1 });
    });
  });

  it("projects a validated Artifact as a readable governed plan", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);

    const item = buildDashboardSnapshot({ workspace: fixture.workspace }).requiresReviewItems.find(
      (candidate) => candidate.id === acceptance.id
    );

    expect(item?.planningArtifact).toMatchObject({
      title: "Deterministic Stewardship Artifact Validation Plan",
      idea: fixture.idea,
      milestone: "Plan the first usable build",
      tokenImpact: "small",
      repository: fixture.repository,
      artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(item?.planningArtifact?.tokenBudget).toContain("Reserve model use");
    expect(item?.planningArtifact?.proposedActions).toHaveLength(4);
    expect(item?.planningArtifact?.proposedActions[0]).toContain("Contract extraction");
  });

  it("requires feedback to send a plan back, preserves its Artifact, and reopens planning", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);

    expect(() => runReviewRejectCommand({ workspace: fixture.workspace, id: acceptance.id }))
      .toThrow(/requires feedback/);

    const feedback = "Clarify which validation fixtures prove the first build is complete.";
    const result = runReviewRejectCommand({ workspace: fixture.workspace, id: acceptance.id, feedback });
    expect(result.data.result.summary).toContain(feedback);
    expect(existsSync(path.join(fixture.workspace, acceptance.artifact_path!))).toBe(true);
    expect(frontmatter(path.join(fixture.repository, "PROJECT.md")).current_action).toBe(fixture.planningActionId);

    withDatabase(fixture.workspace, (db) => {
      const decision = getReviewItem(db, acceptance.id)!;
      const context = JSON.parse(decision.context_json) as Record<string, any>;
      expect(decision.status).toBe("rejected");
      expect(context.refinementFeedback).toBe(feedback);
      expect(context.judgedArtifact).toMatchObject({
        artifactId: acceptance.artifact_id,
        artifactPath: acceptance.artifact_path,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      expect(getWorkItem(db, fixture.planningWorkItemId)).toMatchObject({
        queue: "work_queue",
        work_classification: "agent",
        status: "open",
        next_action: expect.stringContaining(feedback)
      });
    });
  });

  it("requires a named trigger to defer a prepared plan and records its judged revision", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);

    expect(() => runReviewDeferCommand({ workspace: fixture.workspace, id: acceptance.id }))
      .toThrow(/requires a named trigger/);

    const trigger = "When the first pilot identifies a second validation strategy.";
    runReviewDeferCommand({ workspace: fixture.workspace, id: acceptance.id, trigger });
    withDatabase(fixture.workspace, (db) => {
      const decision = getReviewItem(db, acceptance.id)!;
      const context = JSON.parse(decision.context_json) as Record<string, any>;
      expect(decision.status).toBe("deferred");
      expect(decision.decision_note).toContain(trigger);
      expect(context.deferralTrigger).toBe(trigger);
      expect(context.judgedArtifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  it("fails closed when the validated planning Artifact changed before acceptance", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);
    const artifactPath = path.join(fixture.workspace, acceptance.artifact_path!);
    writeFileSync(
      artifactPath,
      readFileSync(artifactPath, "utf8").replace(/\n## Smallest Useful Follow-up Codex Goal[\s\S]*$/, "\n"),
      "utf8"
    );

    expect(() => runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id }))
      .toThrow(/no longer defines a valid concrete implementation promotion/);

    const projectDoc = frontmatter(path.join(fixture.repository, "PROJECT.md"));
    expect(projectDoc.current_action).toBe(fixture.planningActionId);
    withDatabase(fixture.workspace, (db) => {
      expect(getReviewItem(db, acceptance.id)?.status).toBe("open");
      expect(getWorkItem(db, fixture.planningWorkItemId)?.status).not.toBe("done");
      expect(listExecutionRuns(db)).toHaveLength(1);
    });
  });

  it("restores both managed pointers when build-packet persistence fails after document promotion", () => {
    const fixture = preparedProjectIdea();
    const acceptance = executePlanningRun(fixture);
    const invalidDecisionPath = path.join(fixture.repository, "docs", "decisions", "invalid.md");
    mkdirSync(path.dirname(invalidDecisionPath), { recursive: true });
    writeFileSync(invalidDecisionPath, "---\narcadia: v1\ntype: decision\n---\n", "utf8");

    expect(() => runReviewApproveCommand({ workspace: fixture.workspace, id: acceptance.id }))
      .toThrow(/Promoted managed documents could not be synchronized/);

    const projectDoc = frontmatter(path.join(fixture.repository, "PROJECT.md"));
    const planDoc = frontmatter(path.join(fixture.repository, "docs", "plans", "workshop-queue-bootstrap.md"));
    expect(projectDoc.current_action).toBe(fixture.planningActionId);
    expect(planDoc.current_action).toBe(fixture.planningActionId);
    expect((planDoc.actions as Array<Record<string, unknown>>)
      .filter((action) => String(action.source ?? "").startsWith("[planning-promotion:"))).toHaveLength(0);
    withDatabase(fixture.workspace, (db) => {
      expect(getReviewItem(db, acceptance.id)?.status).toBe("open");
      expect(getWorkItem(db, fixture.planningWorkItemId)?.status).not.toBe("done");
    });
  });
});

function preparedProjectIdea(): {
  workspace: string;
  repository: string;
  idea: string;
  projectSlug: string;
  planningActionId: string;
  planningWorkItemId: string;
  planningDecisionId: string;
} {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-project-promotion-")));
  temporaryRoots.push(root);
  const workspace = path.join(root, "workspace");
  const repository = path.join(root, "repository");
  initWorkspace(workspace);
  mkdirSync(repository, { recursive: true });
  installFakePlanningAgent(workspace);
  const idea = "A local tool that turns workshop observations into a prioritized improvement queue.";
  const prepared = runProjectPrepareCommand({
    workspace,
    name: "Workshop Queue",
    idea,
    path: repository,
    agentProfile: "claude_planning"
  });
  withDatabase(workspace, (db) => {
    // upsertProjectMetadata resets repo_path (and aliases) to empty when
    // omitted rather than preserving the existing value, so repoPath must be
    // repeated here or `runProjectPrepareCommand`'s own repo-path metadata
    // is wiped out.
    upsertProjectMetadata(db, {
      projectId: prepared.data.project.id,
      repoPath: repository,
      validationCommands: ["node -e \"process.exit(0)\""]
    });
  });
  return {
    workspace,
    repository,
    idea,
    projectSlug: prepared.data.project.slug,
    planningActionId: prepared.data.dispatch.context!.action.id,
    planningWorkItemId: prepared.data.workItem.id,
    planningDecisionId: prepared.data.planning.planningDecision!.id
  };
}

function executePlanningRun(fixture: ReturnType<typeof preparedProjectIdea>) {
  const queued = runReviewApproveCommand({ workspace: fixture.workspace, id: fixture.planningDecisionId });
  withDatabase(fixture.workspace, (db) => runWorkerIteration(db, fixture.workspace, process.pid));
  expect(queued.data.run).toBeTruthy();
  return withDatabase(fixture.workspace, (db) => {
    const decision = listReviewItems(db, "open").find((item) =>
      item.resolved_intent === "CodexPlanningArtifactAcceptance" &&
      item.work_item_id === fixture.planningWorkItemId
    );
    if (!decision) throw new Error("Expected planning Artifact acceptance Decision.");
    return decision;
  });
}

function installFakePlanningAgent(workspace: string): void {
  const paths = getWorkspacePaths(workspace);
  const agentPath = path.join(workspace, "fake-claude-planning.cjs");
  const outputPath = path.join(workspace, "fake-planning-output.md");
  writeFileSync(
    agentPath,
    "const { readFileSync } = require('node:fs'); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: readFileSync(process.argv[2], 'utf8') })));",
    "utf8"
  );
  writeFileSync(outputPath, completePlanningArtifact, "utf8");
  const registry = JSON.parse(readFileSync(paths.codingAgentProfiles, "utf8")) as {
    profiles: Array<Record<string, unknown>>;
  };
  const profile = registry.profiles.find((candidate) => candidate.name === "claude_planning");
  if (!profile) throw new Error("Expected bundled claude_planning profile.");
  profile.command = process.execPath;
  profile.args = [agentPath, outputPath];
  writeFileSync(paths.codingAgentProfiles, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function frontmatter(filePath: string): Record<string, unknown> {
  const text = readFileSync(filePath, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) throw new Error(`Missing frontmatter: ${filePath}`);
  return parseYaml(match[1]) as Record<string, unknown>;
}
