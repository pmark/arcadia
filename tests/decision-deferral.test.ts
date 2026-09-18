import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDecisionApproveCommand, runDecisionNewCommand, runDecisionValidateCommand } from "../src/commands/decision.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { resolveDispatch, resolveReadySet } from "../src/docs/dispatch.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface Fixture {
  workspace: string;
  repo: string;
  decisionId: string;
}

/**
 * A Project whose active Plan is `[done-first, park-me, after]` with the
 * explicit queue in that order, and an approved-by-answer Decision naming
 * `park-me` whose chosen option carries `effect: defer`.
 */
function fixture(options: {
  decisionAction?: string;
  planActions?: Array<{ id: string; status: string }>;
  decisionStatus?: "open" | "approved";
} = {}): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-decision-deferral-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });

  const actions = options.planActions ?? [
    { id: "done-first", status: "done" },
    { id: "park-me", status: "open" },
    { id: "after", status: "open" }
  ];
  const actionBlocks = actions.flatMap((action) => [
    `  - id: ${action.id}`,
    `    title: Action ${action.id}`,
    `    status: ${action.status}`,
    "    responsibility: agent",
    "    effort: session",
    `    next_action: Finish ${action.id}.`,
    `    expected_artifact: Proof for ${action.id}`,
    "    clarification: clarified",
    "    confidence: high",
    "    acceptance_criteria:",
    `      - ${action.id} is finished.`,
    "    depends_on: []",
    "    decisions: []",
    "    references: []"
  ]);

  writeFileSync(path.join(repo, "PROJECT.md"), [
    "---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Exercise the deferral apply path.", "milestone: Deferral", "active_plan: defer-plan",
    "current_action: park-me", "updated: 2026-09-18", "---", "", "# Demo", ""
  ].join("\n"), "utf8");

  writeFileSync(path.join(repo, "docs/plans/defer-plan.md"), [
    "---", "arcadia: v1", "type: plan", "slug: defer-plan", "project: demo", "status: active",
    "milestone: Deferral", "current_action: park-me", "token_impact: small",
    "token_budget: Deterministic apply path only.", "recommended_model: gpt-5.6-terra",
    "updated: 2026-09-18", "actions:", ...actionBlocks, "questions: []", "---", "", "# Defer plan", ""
  ].join("\n"), "utf8");

  writeFileSync(path.join(repo, "docs/decisions/0057-defer-park-me.md"), [
    "---", "arcadia: v1", "type: decision", 'id: "0057"', "slug: defer-park-me", "project: demo",
    `status: ${options.decisionStatus ?? "open"}`, "question: Defer the current Action?", "confidence: high", "plan: defer-plan",
    `action: ${options.decisionAction ?? "park-me"}`, "updated: 2026-09-18",
    ...(options.decisionStatus === "approved" ? ["answer: Defer until later", "decided: 2026-09-18"] : []),
    "options:", "  - label: Defer until later", "    consequence: The Action stops dispatching.",
    "    recommended: true", "    effect: defer",
    "  - label: Keep it dispatchable", "    consequence: It keeps dispatching.", "    recommended: false",
    "---", "", "# Decision 0057: Defer the current Action?", ""
  ].join("\n"), "utf8");

  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "deferral-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Deferral Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add deferral fixture"], { cwd: repo });

  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Exercise the deferral apply path.", goal: "Apply the answer.",
      status: "active", currentMilestone: "Deferral", nextAction: "Finish park-me.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: actions.map((action) => `demo/${action.id}`),
      order: actions.map((action) => `demo/${action.id}`),
      requestId: "fixture-order",
      apply: true
    });
  });

  return { workspace, repo, decisionId: "0057" };
}

function planFile(repo: string): string {
  return readFileSync(path.join(repo, "docs/plans/defer-plan.md"), "utf8");
}

function decisionFile(repo: string): string {
  return readFileSync(path.join(repo, "docs/decisions/0057-defer-park-me.md"), "utf8");
}

function projectFile(repo: string): string {
  return readFileSync(path.join(repo, "PROJECT.md"), "utf8");
}

describe("apply an answered Decision's consequence", () => {
  it("renders a machine-readable option effect and validates", () => {
    const { workspace, repo } = fixture();
    runDecisionNewCommand({
      workspace,
      project: "demo",
      slug: "future-defer",
      question: "Defer something else?",
      options: [
        { label: "Defer", consequence: "Parked.", recommended: true, effect: "defer" },
        { label: "Do it", consequence: "Dispatched." }
      ]
    });
    const content = readFileSync(path.join(repo, "docs/decisions/0058-future-defer.md"), "utf8");
    expect(content).toContain("    effect: defer");
    const validated = runDecisionValidateCommand({ workspace, project: "demo", id: "0058" });
    expect(validated.data.valid).toBe(true);
  });

  it("previews the parking and pointer move under --dry-run, writing nothing", () => {
    const { workspace, repo, decisionId } = fixture();
    const planBefore = planFile(repo);
    const projectBefore = projectFile(repo);
    const decisionBefore = decisionFile(repo);

    const result = runDecisionApproveCommand({
      workspace,
      project: "demo",
      id: decisionId,
      answer: "Defer until later",
      dryRun: true
    });

    expect(result.data.applied).toBe(false);
    expect(result.data.consequence).toMatchObject({
      kind: "defer",
      actionId: "park-me",
      actionStatusBefore: "open",
      actionStatusAfter: "deferred",
      pointerMoved: true,
      pointerBefore: "park-me",
      pointerAfter: "after"
    });
    expect(planFile(repo)).toBe(planBefore);
    expect(projectFile(repo)).toBe(projectBefore);
    expect(decisionFile(repo)).toBe(decisionBefore);
  });

  it("parks the Action and advances the pointer to the next eligible Action in the explicit queue", () => {
    const { workspace, repo, decisionId } = fixture();

    const result = runDecisionApproveCommand({
      workspace,
      project: "demo",
      id: decisionId,
      answer: "Defer until later",
      decided: "2026-09-18"
    });

    expect(result.data.applied).toBe(true);
    expect(result.data.receiptId).toBeTruthy();
    expect(decisionFile(repo)).toContain("status: approved");
    expect(decisionFile(repo)).toContain("answer: Defer until later");
    expect(planFile(repo)).toMatch(/^ {2}- id: park-me[\s\S]*?^ {4}status: deferred$/m);
    expect(projectFile(repo)).toContain("current_action: after");

    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "defer-plan");
    expect(plan).toMatchObject({ currentAction: "after" });
    // The deferral and its pointer move land in one recoverable commit.
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");

    const dispatch = resolveDispatch(repo, "demo");
    expect(dispatch.context?.action.id).toBe("after");
  });

  it("is idempotent: re-answering returns the recorded receipt with no duplicate effect", () => {
    const { workspace, repo, decisionId } = fixture();
    const first = runDecisionApproveCommand({ workspace, project: "demo", id: decisionId, answer: "Defer until later" });
    const afterFirst = planFile(repo);

    const replay = runDecisionApproveCommand({ workspace, project: "demo", id: decisionId, answer: "Defer until later" });

    expect(replay.data.applied).toBe(true);
    expect(replay.data.receiptId).toBe(first.data.receiptId);
    expect(replay.data.consequence).toEqual(first.data.consequence);
    expect(planFile(repo)).toBe(afterFirst);
    expect(projectFile(repo)).toContain("current_action: after");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });

  it("never commits under --dry-run when an unapplied deferral receipt exists", () => {
    const { workspace, repo, decisionId } = fixture();
    execFileSync("git", ["config", "--unset", "user.email"], { cwd: repo });
    execFileSync("git", ["config", "--unset", "user.name"], { cwd: repo });
    vi.stubEnv("GIT_CONFIG_GLOBAL", devNull);
    vi.stubEnv("GIT_CONFIG_SYSTEM", devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("GIT_AUTHOR_NAME", "");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "");
    vi.stubEnv("GIT_COMMITTER_NAME", "");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "");

    expect(() =>
      runDecisionApproveCommand({
        workspace, project: "demo", id: decisionId, answer: "Defer until later", requestId: "defer-dry-run"
      })
    ).toThrow(/could not be committed/);
    const dirtyAfterFailure = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    expect(dirtyAfterFailure).not.toBe("");

    // The dry run reports the recorded consequence and touches nothing, even
    // though the receipt is still unapplied (Issue #315).
    const preview = runDecisionApproveCommand({
      workspace, project: "demo", id: decisionId, answer: "Defer until later", requestId: "defer-dry-run", dryRun: true
    });

    expect(preview.data.applied).toBe(false);
    expect(preview.data.consequence?.actionId).toBe("park-me");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe(dirtyAfterFailure);

    vi.unstubAllEnvs();
  });

  it("refuses to apply a defer option when the recorded status is not approved", () => {
    const { workspace, repo, decisionId } = fixture();
    const planBefore = planFile(repo);
    const projectBefore = projectFile(repo);
    const decisionBefore = decisionFile(repo);

    expect(() =>
      runDecisionApproveCommand({
        workspace, project: "demo", id: decisionId, answer: "Defer until later", status: "open"
      })
    ).toThrow(/recorded status is not `approved`/);

    expect(planFile(repo)).toBe(planBefore);
    expect(projectFile(repo)).toBe(projectBefore);
    expect(decisionFile(repo)).toBe(decisionBefore);
    expect(resolveDispatch(repo, "demo").context?.action.id).toBe("park-me");
  });

  it("re-applies the deferral after the Action is revived instead of returning the stale receipt", () => {
    const { workspace, repo, decisionId } = fixture();
    const first = runDecisionApproveCommand({
      workspace, project: "demo", id: decisionId, answer: "Defer until later", decided: "2026-09-18"
    });
    expect(first.data.applied).toBe(true);

    // Revival: the Action returns to open at the head of the pointer and the
    // Decision is re-opened. A later re-approval must write a new deferral
    // rather than replay the first receipt (Issue #317).
    const revivedPlan = planFile(repo)
      .replace(/^current_action: after$/m, "current_action: park-me")
      .replace(
        /^ {2}- id: park-me[\s\S]*?^ {4}status: deferred$/m,
        (block) => block.replace(/^ {4}status: deferred$/m, "    status: open")
      );
    writeFileSync(path.join(repo, "docs/plans/defer-plan.md"), revivedPlan, "utf8");
    writeFileSync(
      path.join(repo, "PROJECT.md"),
      projectFile(repo).replace(/^current_action: after$/m, "current_action: park-me"),
      "utf8"
    );
    writeFileSync(path.join(repo, "docs/decisions/0057-defer-park-me.md"), [
      "---", "arcadia: v1", "type: decision", 'id: "0057"', "slug: defer-park-me", "project: demo",
      "status: open", "question: Defer the current Action?", "confidence: high", "plan: defer-plan",
      "action: park-me", "updated: 2026-09-18",
      "options:", "  - label: Defer until later", "    consequence: The Action stops dispatching.",
      "    recommended: true", "    effect: defer",
      "  - label: Keep it dispatchable", "    consequence: It keeps dispatching.", "    recommended: false",
      "---", "", "# Decision 0057: Defer the current Action?", ""
    ].join("\n"), "utf8");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "Revive the Action and re-open the Decision"], { cwd: repo });

    const second = runDecisionApproveCommand({
      workspace, project: "demo", id: decisionId, answer: "Defer until later", decided: "2026-09-19"
    });

    expect(second.data.applied).toBe(true);
    expect(second.data.receiptId).not.toBe(first.data.receiptId);
    expect(planFile(repo)).toMatch(/^ {2}- id: park-me[\s\S]*?^ {4}status: deferred$/m);
    expect(projectFile(repo)).toContain("current_action: after");
    expect(decisionFile(repo)).toContain("status: approved");
    expect(resolveDispatch(repo, "demo").context?.action.id).toBe("after");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
  });

  it("refuses when the Decision names an Action outside the active Plan, leaving the Decision open", () => {
    const { workspace, repo, decisionId } = fixture({ decisionAction: "ghost" });
    const decisionBefore = decisionFile(repo);

    expect(() =>
      runDecisionApproveCommand({ workspace, project: "demo", id: decisionId, answer: "Defer until later" })
    ).toThrow(/not in the Project's active Plan/);

    expect(decisionFile(repo)).toBe(decisionBefore);
    expect(planFile(repo)).toContain("status: open");
  });

  it("refuses when parking the current Action would leave no eligible successor", () => {
    const { workspace, repo, decisionId } = fixture({
      planActions: [
        { id: "done-first", status: "done" },
        { id: "park-me", status: "open" }
      ]
    });
    const planBefore = planFile(repo);
    const decisionBefore = decisionFile(repo);

    expect(() =>
      runDecisionApproveCommand({ workspace, project: "demo", id: decisionId, answer: "Defer until later" })
    ).toThrow(/no other eligible Action can take the pointer/i);

    expect(planFile(repo)).toBe(planBefore);
    expect(decisionFile(repo)).toBe(decisionBefore);
    expect(projectFile(repo)).toContain("current_action: park-me");
  });

  it("refuses to defer an Action that is already done, leaving every document untouched", () => {
    const { workspace, repo, decisionId } = fixture({
      planActions: [
        { id: "done-first", status: "done" },
        { id: "park-me", status: "done" },
        { id: "after", status: "open" }
      ]
    });
    const planBefore = planFile(repo);
    const projectBefore = projectFile(repo);
    const decisionBefore = decisionFile(repo);

    expect(() =>
      runDecisionApproveCommand({ workspace, project: "demo", id: decisionId, answer: "Defer until later" })
    ).toThrow(/already done/);

    expect(planFile(repo)).toBe(planBefore);
    expect(projectFile(repo)).toBe(projectBefore);
    expect(decisionFile(repo)).toBe(decisionBefore);
  });

  it("reports an approved Decision's parked Action as a dispatch blocker before the Plan record changes", () => {
    const { repo } = fixture({ decisionStatus: "approved" });
    const dispatch = resolveDispatch(repo, "demo");
    expect(dispatch.blockers.map((blocker) => blocker.message).join(" ")).toContain("deferred by Decision 0057");
  });

  it("reports a deferred current Action as a dispatch blocker", () => {
    const { repo } = fixture({
      planActions: [
        { id: "done-first", status: "done" },
        { id: "park-me", status: "deferred" },
        { id: "after", status: "open" }
      ]
    });

    const parked = resolveDispatch(repo, "demo");
    expect(parked.blockers.map((blocker) => blocker.message).join(" ")).toContain("deferred");
  });

  it("fails the command when the deferral commit fails, then retries the same transition after recovery", () => {
    const { workspace, repo, decisionId } = fixture();
    // Isolate Git identity so the commit fails exactly as it does on a host with
    // no user.name/user.email. The documents are written and the receipt records
    // that the commit failed; the command must not report a successful deferral.
    execFileSync("git", ["config", "--unset", "user.email"], { cwd: repo });
    execFileSync("git", ["config", "--unset", "user.name"], { cwd: repo });
    vi.stubEnv("GIT_CONFIG_GLOBAL", devNull);
    vi.stubEnv("GIT_CONFIG_SYSTEM", devNull);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("GIT_AUTHOR_NAME", "");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "");
    vi.stubEnv("GIT_COMMITTER_NAME", "");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "");

    expect(() =>
      runDecisionApproveCommand({
        workspace, project: "demo", id: decisionId, answer: "Defer until later", requestId: "defer-commit-fail"
      })
    ).toThrow(/could not be committed/);

    // Written but not committed: visible, and never reported as applied.
    expect(planFile(repo)).toMatch(/^ {2}- id: park-me[\s\S]*?^ {4}status: deferred$/m);
    expect(projectFile(repo)).toContain("current_action: after");

    // Recovery: the same request id retries exactly the commit it recorded, so a
    // retry cannot leave the pointer committed with an uncommitted deferral.
    vi.unstubAllEnvs();
    execFileSync("git", ["config", "user.email", "deferral-test@example.invalid"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Deferral Test"], { cwd: repo });
    const retry = runDecisionApproveCommand({
      workspace, project: "demo", id: decisionId, answer: "Defer until later", requestId: "defer-commit-fail"
    });
    expect(retry.data.applied).toBe(true);
    expect(retry.data.receiptId).toBeTruthy();
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");
    expect(projectFile(repo)).toContain("current_action: after");
  });

  it("excludes a deferred Action from the ready set", () => {
    const { repo } = fixture({
      planActions: [
        { id: "done-first", status: "done" },
        { id: "park-me", status: "deferred" },
        { id: "after", status: "open" }
      ]
    });

    const ready = resolveReadySet(repo, "demo");
    expect(ready.ready.map((entry) => entry.actionId)).not.toContain("park-me");
    expect(ready.ready.map((entry) => entry.actionId)).toContain("after");
  });
});
