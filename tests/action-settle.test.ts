import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runActionSettleCommand } from "../src/commands/actionSettle.js";
import { withDatabase } from "../src/db/connection.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { discoverDocs } from "../src/docs/discover.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("arcadia action settle", () => {
  it("previews the current Action without settling under --dry-run", () => {
    const { workspace, repo, head } = fixture();
    const result = runActionSettleCommand({ workspace, dryRun: true });

    expect(result.data.applied).toBe(false);
    expect(result.data.plan.actionId).toBe("first");
    expect(result.data.plan.candidateRevision).toBe(head);
    expect(result.data.plan.criteria.map((c) => c.criterion)).toEqual(["First proof exists."]);
    expect(result.data.plan.criteria.every((c) => c.status === "met")).toBe(true);
    expect(result.data.plan.previewFingerprint).toMatch(/^[0-9a-f]{16,}$/);
    // Dry run changes no managed document.
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("id: first");
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).not.toContain("status: done");
  });

  it("settles the current Action in one command and advances the pointer", () => {
    const { workspace, repo } = fixture();
    const result = runActionSettleCommand({ workspace });

    expect(result.data.applied).toBe(true);
    expect(result.data.nextActionKey).toBe("demo/second");

    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({
      currentAction: "second",
      actions: [
        expect.objectContaining({ id: "first", status: "done" }),
        expect.objectContaining({ id: "second", status: "open" })
      ]
    });
    const log = readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8");
    expect(log).toContain("Completed demo/first");
  });

  it("works after a --dry-run of identical content (replays the same proposal)", () => {
    const { workspace } = fixture();
    runActionSettleCommand({ workspace, dryRun: true });
    const applied = runActionSettleCommand({ workspace });
    expect(applied.data.applied).toBe(true);
  });

  it("carries an operator note onto every criterion's evidence", () => {
    const { workspace } = fixture();
    const result = runActionSettleCommand({ workspace, note: "Reviewed the diff and ran the suite.", dryRun: true });
    expect(result.data.plan.criteria.every((c) => c.note === "Reviewed the diff and ran the suite.")).toBe(true);
  });

  it("resolves the single active Project without --project", () => {
    const { workspace } = fixture();
    const result = runActionSettleCommand({ workspace, dryRun: true });
    expect(result.data.plan.projectSlug).toBe("demo");
  });

  it("refuses to settle an Action that is not the current one", () => {
    const { workspace } = fixture();
    expect(() => runActionSettleCommand({ workspace, action: "demo/second", dryRun: true })).toThrow(
      /not the current one/
    );
  });

  it("refuses when the pointer resolves no current Action", () => {
    const { workspace } = fixture({ noPointer: true });
    expect(() => runActionSettleCommand({ workspace, dryRun: true })).toThrow(/does not resolve a current Action/);
  });
});

function fixture(options: { noPointer?: boolean } = {}): { workspace: string; repo: string; head: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-action-settle-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(options), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc(options), "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "settle-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Settle Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repo });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Test action settle.", goal: "Complete work safely.",
      status: "active", currentMilestone: "Completion", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: ["demo/first", "demo/second"], order: ["demo/first", "demo/second"], requestId: "fixture-order", apply: true
    });
  });
  return { workspace, repo, head };
}

function projectDoc(options: { noPointer?: boolean }): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Complete work safely.", "milestone: Completion", "active_plan: demo-plan",
    ...(options.noPointer ? [] : ["current_action: first"]),
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

function planDoc(options: { noPointer?: boolean }): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Completion", ...(options.noPointer ? [] : ["current_action: first"]), "token_impact: medium",
    "token_budget: Deterministic completion with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first Action.",
    "    expected_artifact: First proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - First proof exists.", "    depends_on: []",
    "    decisions: []", "    references: []",
    "  - id: second", "    title: Second Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the second Action.",
    "    expected_artifact: Second proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second proof exists.",
    "    depends_on: []", "    decisions: []", "    references: []",
    "questions: []", "---", "", "# Demo plan", ""].join("\n");
}
