import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { activateNextPlan, activatePlan } from "../src/dispatch/planActivationApply.js";
import { resolvePlanActivation } from "../src/dispatch/planActivation.js";
import { seedActionOrderFifo } from "../src/dispatch/order.js";
import { buildAgentQueue } from "../src/dispatch/queue.js";
import { runGoCommand } from "../src/commands/go.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveDispatch } from "../src/docs/dispatch.js";
import { resolveProjectTransition } from "../src/sessions/index.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "arcadia-plan-activation-"));
  temporary.push(directory);
  return directory;
}

function writeDoc(repoRoot: string, relativePath: string, content: string): void {
  const absolute = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function projectDoc(input: {
  activePlan?: string | null;
  currentAction?: string | null;
} = {}): string {
  return [
    "---",
    "arcadia: v1",
    "type: project",
    "slug: demo",
    "name: Demo",
    "status: active",
    "goal: Exercise total Plan activation.",
    "milestone: Activation milestone",
    ...(input.activePlan === null ? [] : [`active_plan: ${input.activePlan ?? "plan-a"}`]),
    ...(input.currentAction === null ? [] : [`current_action: ${input.currentAction ?? "a1"}`]),
    "updated: 2026-09-20",
    "---",
    "",
    "# Demo",
    ""
  ].join("\n");
}

interface ActionFixture {
  id: string;
  status?: string;
  responsibility?: string;
  dependsOn?: string[];
  decisions?: string[];
  clarification?: string;
}

function planDoc(input: {
  slug: string;
  status?: string;
  actions: ActionFixture[];
}): string {
  const actions = input.actions.flatMap((action) => [
    `  - id: ${action.id}`,
    `    title: Action ${action.id}`,
    `    status: ${action.status ?? "open"}`,
    `    responsibility: ${action.responsibility ?? "agent"}`,
    `    next_action: Implement ${action.id}.`,
    `    expected_artifact: Evidence for ${action.id}`,
    `    clarification: ${action.clarification ?? "clarified"}`,
    "    acceptance_criteria:",
    `      - ${action.id} is done.`,
    `    depends_on: [${(action.dependsOn ?? []).join(", ")}]`,
    `    decisions: [${(action.decisions ?? []).join(", ")}]`
  ]);
  return [
    "---",
    "arcadia: v1",
    "type: plan",
    "slug: " + input.slug,
    "project: demo",
    `status: ${input.status ?? "active"}`,
    "milestone: Activation milestone",
    "token_impact: medium",
    "token_budget: One bounded implementation pass; validation is deterministic.",
    "recommended_model: gpt-5.6-terra",
    "recommended_reasoning_effort: high",
    "updated: 2026-09-20",
    "actions:",
    ...actions,
    "---",
    "",
    `# ${input.slug}`,
    ""
  ].join("\n");
}

function workspace(repoRoot: string): string {
  const directory = path.join(scratch(), "workspace");
  initWorkspace(directory);
  withDatabase(directory, (db) => {
    const project = upsertProject(db, {
      name: "Demo",
      mission: "Exercise total Plan activation.",
      status: "active",
      currentMilestone: "Activation milestone",
      nextAction: "Advance the pointer.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repoRoot });
  });
  return directory;
}

function commitFixture(repoRoot: string): void {
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "activation@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Activation Test"], { cwd: repoRoot });
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "Add activation fixture"], { cwd: repoRoot });
}

const positions = (entries: Array<[string, number]>): Map<string, number> => new Map(entries);

describe("resolvePlanActivation", () => {
  it("activates the next Plan when the active Plan is complete", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));

    const resolution = resolvePlanActivation({ repoRoot: repo, projectSlug: "demo", positions: positions([["demo/b1", 0]]) });

    expect(resolution.status).toBe("candidate");
    expect(resolution.candidate).toMatchObject({ actionKey: "demo/b1", planSlug: "plan-b" });
    expect(resolution.reason).toContain("plan-b");
  });

  it("activates the queued Plan when PROJECT.md declares no active Plan", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: null, currentAction: null }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));

    const resolution = resolvePlanActivation({ repoRoot: repo, projectSlug: "demo", positions: positions([["demo/b1", 0]]) });

    expect(resolution.status).toBe("candidate");
    expect(resolution.candidate?.actionKey).toBe("demo/b1");
  });

  it("repairs a dangling active-Plan pointer from the explicit queue", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "missing-plan", currentAction: "b1" }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));

    const resolution = resolvePlanActivation({ repoRoot: repo, projectSlug: "demo", positions: positions([["demo/b1", 0]]) });

    expect(resolution.status).toBe("candidate");
    expect(resolution.candidate?.actionKey).toBe("demo/b1");
    expect(resolution.activePlan).toBe("missing-plan");
  });

  it("selects the eligible Action highest in the explicit queue across Plans", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }, { id: "b2" }] }));
    writeDoc(repo, "docs/plans/plan-c.md", planDoc({ slug: "plan-c", actions: [{ id: "c1" }] }));

    const resolution = resolvePlanActivation({
      repoRoot: repo,
      projectSlug: "demo",
      positions: positions([["demo/b1", 2], ["demo/b2", 1], ["demo/c1", 0]])
    });

    expect(resolution.status).toBe("candidate");
    expect(resolution.candidate?.actionKey).toBe("demo/c1");
  });

  it("filters a higher blocked or review-gated candidate without changing queue priority", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({
      slug: "plan-a",
      actions: [{ id: "a1", status: "done" }, { id: "a2", status: "blocked" }]
    }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({
      slug: "plan-b",
      actions: [{ id: "b1" }]
    }));

    const resolution = resolvePlanActivation({
      repoRoot: repo,
      projectSlug: "demo",
      positions: positions([["demo/a2", 0], ["demo/b1", 1]])
    });

    expect(resolution.status).toBe("candidate");
    expect(resolution.candidate?.actionKey).toBe("demo/b1");
    expect(resolution.ranked.map((action) => action.actionKey)).toEqual(["demo/b1"]);
  });

  it("reports unordered legacy candidates so a FIFO seed runs first", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));

    const resolution = resolvePlanActivation({ repoRoot: repo, projectSlug: "demo", positions: positions([]) });

    expect(resolution.status).toBe("unordered");
    expect(resolution.unpositioned.map((action) => action.actionKey)).toEqual(["demo/b1"]);
    expect(resolution.candidate?.actionKey).toBe("demo/b1");
  });

  it("reports a genuine queue ambiguity instead of guessing", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }, { id: "b2" }] }));

    const resolution = resolvePlanActivation({
      repoRoot: repo,
      projectSlug: "demo",
      positions: positions([["demo/b1", 0], ["demo/b2", 0]])
    });

    expect(resolution.status).toBe("ambiguous");
    expect(resolution.reason).toContain("ranks");
  });

  it("reports a Project with no remaining work", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));

    const resolution = resolvePlanActivation({ repoRoot: repo, projectSlug: "demo", positions: positions([]) });

    expect(resolution.status).toBe("none");
    expect(resolution.remainingWork).toBe(false);
  });
});

describe("activateNextPlan", () => {
  it("seeds unpositioned work, activates the queued Plan, and is idempotent", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));
    commitFixture(repo);
    const workspacePath = workspace(repo);

    const applied = withDatabase(workspacePath, (db) =>
      activateNextPlan(db, { repoRoot: repo, projectSlug: "demo", requestId: "activation-1", apply: true }));

    expect(applied.seed?.operation).toEqual({ kind: "seed" });
    expect(applied.activation?.actionKey).toBe("demo/b1");
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("active_plan: plan-b");
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("current_action: b1");
    const dispatch = resolveDispatch(repo, "demo");
    expect(dispatch.context?.action.id).toBe("b1");

    const replay = withDatabase(workspacePath, (db) =>
      activateNextPlan(db, { repoRoot: repo, projectSlug: "demo", requestId: "activation-1", apply: true }));
    expect(replay.activation).toEqual(applied.activation);
  });

  it("previews an activation without writing the pointer", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));
    commitFixture(repo);
    const workspacePath = workspace(repo);

    const preview = withDatabase(workspacePath, (db) =>
      activateNextPlan(db, { repoRoot: repo, projectSlug: "demo", requestId: "activation-preview", apply: false }));

    expect(preview.activation).toBeNull();
    expect(preview.resolution.candidate?.actionKey).toBe("demo/b1");
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("active_plan: plan-a");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim()).toBe("");
  });

  it("activates an already-ordered candidate and commits the pointer pair", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));
    commitFixture(repo);
    const workspacePath = workspace(repo);
    withDatabase(workspacePath, (db) =>
      seedActionOrderFifo(db, { currentKeys: ["demo/b1"], requestId: "seed-first", apply: true }));

    const preview = withDatabase(workspacePath, (db) =>
      activateNextPlan(db, { repoRoot: repo, projectSlug: "demo", requestId: "activation-order", apply: false }));
    const applied = withDatabase(workspacePath, (db) =>
      activateNextPlan(db, { repoRoot: repo, projectSlug: "demo", requestId: "activation-order", apply: true }));

    expect(applied.activation?.applied).toBe(true);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim()).toBe("");
    const names = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], { cwd: repo, encoding: "utf8" }).trim().split("\n");
    expect(names).toEqual(["PROJECT.md", "docs/plans/plan-b.md"]);
    expect(preview.activation?.applied).toBe(false);
    expect(preview.activation?.actionKey).toBe("demo/b1");
  });
});

describe("resolveProjectTransition at a Plan boundary", () => {
  it("reports an activate transition naming the queued successor", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));
    const workspacePath = workspace(repo);

    const transition = withDatabase(workspacePath, (db) =>
      resolveProjectTransition({ repoRoot: repo, projectSlug: "demo", db }));

    expect(transition.kind).toBe("activate");
    expect(transition.activation?.candidate?.actionKey).toBe("demo/b1");
  });

  it("reports milestone completion when no Plan has remaining work", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    const workspacePath = workspace(repo);

    const transition = withDatabase(workspacePath, (db) =>
      resolveProjectTransition({ repoRoot: repo, projectSlug: "demo", db }));

    expect(transition.kind).toBe("complete_milestone");
  });
});

describe("arcadia go cross-Plan activation", () => {
  it("activates the queued Plan and prepares the next Action's worktree in one go invocation", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));
    commitFixture(repo);
    const workspacePath = workspace(repo);

    const result = runGoCommand({
      repo,
      source: repo,
      apply: true,
      agent: "codex",
      workspace: workspacePath,
      agentWorktreeRoot: path.join(scratch(), "worktrees")
    });

    expect(result.data.applied).toBe(true);
    expect(result.data.activation?.seed?.applied).toBe(true);
    expect(result.data.activation?.activation?.actionKey).toBe("demo/b1");
    expect(result.data.dispatchable).toBe(true);
    expect(result.data.dispatch.context?.action.id).toBe("b1");
    expect(result.data.nextWorktree?.branch).toContain("b1");
    expect(readFileSync(path.join(repo, "PROJECT.md"), "utf8")).toContain("active_plan: plan-b");
  });
});

describe("queue projection across approved Plans", () => {
  it("lists a ready Action from a non-active approved Plan and lets the seed order it", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));
    const workspacePath = workspace(repo);

    const queue = withDatabase(workspacePath, (db) => buildAgentQueue(db));
    expect(queue.ordered.map((entry) => entry.orderKey)).toContain("demo/b1");
    expect(queue.ready.find((entry) => entry.actionId === "b1")).toMatchObject({
      planSlug: "plan-b",
      pointerAuthorized: false,
      reason: expect.stringContaining("waiting_for_pointer")
    });
    expect(queue.orderValid).toBe(false);

    const seeded = withDatabase(workspacePath, (db) =>
      seedActionOrderFifo(db, { currentKeys: ["demo/b1", "demo/a1"], requestId: "seed-queue", apply: true }));
    expect(seeded.applied).toBe(true);
    const after = withDatabase(workspacePath, (db) => buildAgentQueue(db));
    expect(after.orderValid).toBe(true);
    expect(after.nextActionKey).toBeNull();
  });
});

describe("activatePlan receipts", () => {  it("rebuilds a deterministic queue revision and refuses a stale fingerprint", () => {
    const repo = scratch();
    writeDoc(repo, "PROJECT.md", projectDoc({ activePlan: "plan-a", currentAction: "a1" }));
    writeDoc(repo, "docs/plans/plan-a.md", planDoc({ slug: "plan-a", actions: [{ id: "a1", status: "done" }] }));
    writeDoc(repo, "docs/plans/plan-b.md", planDoc({ slug: "plan-b", actions: [{ id: "b1" }] }));
    commitFixture(repo);
    const workspacePath = workspace(repo);
    withDatabase(workspacePath, (db) => seedActionOrderFifo(db, { currentKeys: ["demo/b1"], requestId: "seed-2", apply: true }));

    const revision = withDatabase(workspacePath, (db) => buildAgentQueue(db).revision);
    const preview = withDatabase(workspacePath, (db) =>
      activatePlan(db, { repoRoot: repo, projectSlug: "demo", actionKey: "demo/b1", queueRevision: revision, requestId: "apply-1" }));

    expect(discoverDocs(repo).docs.some((doc) => doc.type === "plan" && doc.slug === "plan-b")).toBe(true);
    expect(() => withDatabase(workspacePath, (db) =>
      activatePlan(db, {
        repoRoot: repo,
        projectSlug: "demo",
        actionKey: "demo/b1",
        queueRevision: revision,
        requestId: "apply-1",
        previewFingerprint: "deadbeef",
        apply: true
      }))).toThrow(/does not match the current preview/);

    const applied = withDatabase(workspacePath, (db) =>
      activatePlan(db, {
        repoRoot: repo,
        projectSlug: "demo",
        actionKey: "demo/b1",
        queueRevision: revision,
        requestId: "apply-1",
        previewFingerprint: preview.previewFingerprint,
        apply: true
      }));
    expect(applied.applied).toBe(true);
  });
});
