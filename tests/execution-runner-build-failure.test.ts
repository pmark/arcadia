import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runProjectImportCommand } from "../src/commands/project.js";
import { runWorkPlanCommand, runWorkRunCommand } from "../src/commands/work.js";
import { withDatabase } from "../src/db/connection.js";
import { updateReviewItemStatus, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";
import { getWorkspacePaths } from "../src/workspace/paths.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A "coding agent" that always fails, so `executeCodexStep` takes the
 * `result.status !== 0` branch for a `codex_build` step.
 */
function installFailingBuildAgent(workspace: string, failure: "exit" | "is_error" | "subtype" = "exit"): void {
  const paths = getWorkspacePaths(workspace);
  const agentPath = path.join(workspace, "fake-failing-build-agent.cjs");
  writeFileSync(
    agentPath,
    failure === "exit"
      ? "process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('simulated executor failure'); process.exitCode = 1; });"
      : `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(JSON.stringify({ type: "result", subtype: failure === "subtype" ? "error_max_turns" : "success", is_error: failure === "is_error", result: "simulated provider failure" }))}); });`,
    "utf8"
  );
  const registry = JSON.parse(readFileSync(paths.codingAgentProfiles, "utf8")) as {
    profiles: Array<Record<string, unknown>>;
  };
  const profile = registry.profiles.find((candidate) => candidate.name === "claude_build");
  if (!profile) throw new Error("Expected bundled claude_build profile.");
  profile.command = process.execPath;
  profile.args = [agentPath];
  writeFileSync(paths.codingAgentProfiles, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

describe("executeCodexStep build-purpose failure", () => {
  it.each(["exit", "is_error", "subtype"] as const)("records build failure without duplicate diagnostic artifacts for %s", (failure) => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-runner-build-failure-"));
    temporaryRoots.push(root);
    const workspace = path.join(root, "workspace");
    const repository = path.join(root, "repository");
    initWorkspace(workspace);
    mkdirSync(repository, { recursive: true });
    installFailingBuildAgent(workspace, failure);

    const imported = runProjectImportCommand({
      workspace,
      name: "Runner Build Failure Fixture",
      mission: "Reproduce the run_artifacts duplicate-id bug for a failing codex_build step.",
      status: "active",
      milestone: "Reproduce the bug",
      nextAction: "Implement a one-line marker file.",
      classification: "agent"
    });
    const workId = imported.data.workItem.id;
    const projectId = imported.data.project.id;

    withDatabase(workspace, (db) => {
      upsertProjectMetadata(db, { projectId, repoPath: repository, validationCommands: ["node -e \"process.exit(0)\""] });
    });

    const planned = runWorkPlanCommand({ workspace, workId, agentProfile: "claude_build" });
    expect(planned.data.plan.steps).toHaveLength(1);
    expect(planned.data.plan.steps[0].executor_type).toBe("codex_build");
    expect(planned.data.buildInvocation).toMatchObject({
      purpose: "build",
      agent_profile: "claude_build",
      status: "packet_created",
      work_item_id: workId,
      plan_id: planned.data.plan.id
    });
    expect(planned.data.buildPacketArtifact).toMatchObject({
      artifact_type: "codex_prompt_packet",
      work_item_id: workId,
      path: planned.data.buildInvocation?.prompt_path
    });
    expect(planned.data.buildApproval).toMatchObject({
      status: "open",
      resolved_intent: "CodexBuildPacketApproval",
      codex_invocation_id: planned.data.buildInvocation?.id,
      artifact_id: planned.data.buildPacketArtifact?.id
    });
    expect(planned.data.buildApproval?.context_json).toContain('"planningPromotion"');

    const runCount = withDatabase(workspace, (db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM execution_runs").get() as { count: number }).count
    );
    expect(runCount).toBe(0);

    // Before the fix, `work plan` created a brand-new execution plan (and
    // therefore a brand-new packet, invocation, and open Decision) on every
    // call, because the idempotency checks were keyed off a plan id that
    // never stayed stable across repeat calls.
    const replanned = runWorkPlanCommand({ workspace, workId, agentProfile: "claude_build" });
    expect(replanned.data.plan.id).toBe(planned.data.plan.id);
    expect(replanned.data.buildInvocation?.id).toBe(planned.data.buildInvocation?.id);
    expect(replanned.data.buildPacketArtifact?.id).toBe(planned.data.buildPacketArtifact?.id);
    expect(replanned.data.buildApproval?.id).toBe(planned.data.buildApproval?.id);

    const planCount = withDatabase(workspace, (db) =>
      (db.prepare("SELECT COUNT(*) AS count FROM execution_plans WHERE work_item_id = ?").get(workId) as { count: number }).count
    );
    expect(planCount).toBe(1);

    const approvalCount = withDatabase(workspace, (db) =>
      (db.prepare(
        "SELECT COUNT(*) AS count FROM review_items WHERE work_item_id = ? AND resolved_intent = 'CodexBuildPacketApproval'"
      ).get(workId) as { count: number }).count
    );
    expect(approvalCount).toBe(1);

    // Before the fix, this threw SQLITE_ERROR (UNIQUE constraint failed:
    // run_artifacts.run_id, run_artifacts.artifact_id) instead of returning
    // a clean "failed" run, because the diagnostic artifact was listed both
    // as the step's primary `artifact` and inside `additionalArtifacts`.
    const result = runWorkRunCommand({ workspace, workId, allowCodexBuild: true, agentProfile: "claude_build" });
    expect(result.data.run.status).toBe("failed");
    expect(result.data.run.work_item_id).toBe(workId);
    if (failure !== "exit") {
      withDatabase(workspace, (db) => {
        const invocation = db.prepare("SELECT status FROM codex_invocations WHERE id = ?").get(planned.data.buildInvocation!.id) as { status: string };
        expect(invocation.status).toBe("failed");
        const step = db.prepare("SELECT status, error, command FROM execution_run_steps WHERE run_id = ?").get(result.data.run.id) as { status: string; error: string; command: string };
        expect(step.command).toContain(process.execPath);
        expect(step.command).toContain("fake-failing-build-agent.cjs");
        expect(step.status).toBe("failed");
        expect(step.error).toContain("simulated provider failure");
        const artifacts = db.prepare("SELECT artifact_type, status FROM artifacts WHERE work_item_id = ?").all(workId) as Array<{ artifact_type: string; status: string }>;
        expect(artifacts).toEqual(expect.arrayContaining([
          { artifact_type: "planning_executor_diagnostic", status: "drafted" },
          { artifact_type: "planning_partial_artifact", status: "drafted" }
        ]));
      });
      expect(readFileSync(path.join(workspace, planned.data.buildInvocation!.jsonl_output_path), "utf8")).toContain('"type":"result"');
    }
  });

  it("re-planning an Action whose build packet is already approved keeps that approval instead of revoking it (Issue #709)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-work-plan-approved-"));
    temporaryRoots.push(root);
    const workspace = path.join(root, "workspace");
    const repository = path.join(root, "repository");
    initWorkspace(workspace);
    mkdirSync(repository, { recursive: true });

    const imported = runProjectImportCommand({
      workspace,
      name: "Approved Packet Replan Fixture",
      mission: "Prove re-planning never revokes an approved build packet.",
      status: "active",
      milestone: "Prove it",
      nextAction: "Implement a one-line marker file.",
      classification: "agent"
    });
    const workId = imported.data.workItem.id;
    withDatabase(workspace, (db) => {
      upsertProjectMetadata(db, { projectId: imported.data.project.id, repoPath: repository, validationCommands: ["node -e \"process.exit(0)\""] });
    });

    const planned = runWorkPlanCommand({ workspace, workId });
    const approvalId = planned.data.buildApproval!.id;
    withDatabase(workspace, (db) => updateReviewItemStatus(db, approvalId, { status: "approved", decisionNote: "Operator approved the packet." }));

    // The launch path trusts the newest promotion review for the packet, so a
    // fresh open review opened here would silently de-authorize it.
    const replanned = runWorkPlanCommand({ workspace, workId });
    expect(replanned.data.buildInvocation?.id).toBe(planned.data.buildInvocation?.id);
    expect(replanned.data.buildApproval?.id).toBe(approvalId);
    expect(replanned.data.buildApproval?.status).toBe("approved");
    const approvals = withDatabase(workspace, (db) =>
      db.prepare(
        "SELECT id, status FROM review_items WHERE work_item_id = ? AND resolved_intent = 'CodexBuildPacketApproval'"
      ).all(workId) as Array<{ id: string; status: string }>
    );
    expect(approvals).toEqual([{ id: approvalId, status: "approved" }]);

    // The newest review decides, as it does for the launch path: an older
    // approval does not outrank a newer rejection.
    withDatabase(workspace, (db) => updateReviewItemStatus(db, approvalId, { status: "rejected", decisionNote: "Rejected." }));
    const afterRejection = runWorkPlanCommand({ workspace, workId });
    const replacementId = afterRejection.data.buildApproval!.id;
    expect(replacementId).not.toBe(approvalId);
    expect(afterRejection.data.buildApproval?.status).toBe("open");
    withDatabase(workspace, (db) => {
      updateReviewItemStatus(db, approvalId, { status: "approved", decisionNote: "Older approval." });
      updateReviewItemStatus(db, replacementId, { status: "rejected", decisionNote: "Newer rejection." });
    });
    const afterNewerRejection = runWorkPlanCommand({ workspace, workId });
    expect(afterNewerRejection.data.buildApproval?.id).not.toBe(approvalId);
    expect(afterNewerRejection.data.buildApproval?.status).toBe("open");
  });

  it("seeds a build packet with the requested coding-agent profile", () => {
    const root = mkdtempSync(path.join(tmpdir(), "arcadia-work-plan-profile-"));
    temporaryRoots.push(root);
    const workspace = path.join(root, "workspace");
    const repository = path.join(root, "repository");
    initWorkspace(workspace);
    mkdirSync(repository, { recursive: true });

    const imported = runProjectImportCommand({
      workspace,
      name: "Work Plan Profile Fixture",
      mission: "Prove work plan honours a requested build profile.",
      status: "active",
      milestone: "Prove the requested build profile reaches the packet",
      nextAction: "Implement a one-line marker file.",
      classification: "agent"
    });
    const workId = imported.data.workItem.id;
    const projectId = imported.data.project.id;

    withDatabase(workspace, (db) => {
      upsertProjectMetadata(db, { projectId, repoPath: repository, validationCommands: ["node -e \"process.exit(0)\""] });
    });

    // Before this fix, the managed-build branch dropped the requested profile,
    // so the packet silently took the workspace default build profile
    // (codex_build) and a standing grant scoped to another provider refused it
    // at admission.
    const planned = runWorkPlanCommand({ workspace, workId, agentProfile: "opencode_build" });
    expect(planned.data.buildInvocation).toMatchObject({
      purpose: "build",
      status: "packet_created",
      agent_profile: "opencode_build",
      work_item_id: workId,
      plan_id: planned.data.plan.id
    });
  });
});
