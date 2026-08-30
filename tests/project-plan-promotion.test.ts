import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { runProjectPrepareCommand } from "../src/commands/project.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { runWorkerIteration } from "../src/commands/worker.js";
import { withDatabase } from "../src/db/connection.js";
import {
  getReviewItem,
  getWorkItem,
  getWorkItemByDocRef,
  listCodexInvocationsForWorkItem,
  listExecutionRuns,
  listReviewItems
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
    expect(dispatch.context?.action.responsibility).toBe("codex");
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
      responsibility: "codex",
      clarification: "clarified",
      depends_on: [fixture.planningActionId]
    });
    expect(promotedActions[0]?.acceptance_criteria).toHaveLength(3);

    withDatabase(fixture.workspace, (db) => {
      const promoted = getWorkItemByDocRef(db, promotion!.actionDocRef);
      expect(promoted).toBeTruthy();
      expect(promoted?.status).toBe("open");
      expect(promoted?.work_classification).toBe("codex");
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
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-project-promotion-"));
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
