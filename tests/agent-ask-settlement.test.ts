import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentAskSettlementMessage } from "../apps/discord-bot/src/notifications/poller.js";
import {
  runAgentAskNotificationSentCommand,
  runAgentAskNotificationsCommand,
  runAgentAskPreviewCommand,
  runAgentAskSettleCommand
} from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { arrangeActionOrder, loadActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Agent Ask settlement", () => {
  it("previews and atomically accepts a canonical Action at an explicit queue position", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: actionAsk("ask-action-1") });
    const preview = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1
    });
    expect(preview.data.receipt).toMatchObject({
      applied: false,
      disposition: "accepted",
      queueActionKey: "demo/add-settlement-proof",
      queuePosition: 0,
      notificationStatus: "withheld_until_apply"
    });
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).not.toContain("add-settlement-proof");
    expect(() => runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1,
      apply: true
    })).toThrow(/does not match the current preview/);

    const applied = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1,
      preview: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(applied.data.receipt).toMatchObject({ applied: true, notificationStatus: "pending" });
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("id: add-settlement-proof");
    withDatabase(workspace, (db) => {
      expect([...loadActionOrder(db).positions]).toEqual([["demo/add-settlement-proof", 0], ["demo/existing", 1]]);
      expect(loadActionOrder(db).revision).toBe(2);
      expect((db.prepare("SELECT COUNT(*) AS count FROM work_items WHERE doc_ref = 'plan/demo-plan#add-settlement-proof'").get() as { count: number }).count).toBe(1);
    });
    const replay = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-action-1",
      disposition: "accepted",
      responsibility: "codex",
      top: true,
      revision: 1,
      preview: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(replay.data.receipt).toEqual(applied.data.receipt);

    const pending = runAgentAskNotificationsCommand({ workspace });
    expect(pending.data.notifications).toHaveLength(1);
    expect(agentAskSettlementMessage(pending.data.notifications[0]!)).toContain("Agent Ask settled: accepted");
    expect(agentAskSettlementMessage(pending.data.notifications[0]!)).toContain("Queue: demo/add-settlement-proof at position 1");
    runAgentAskNotificationSentCommand({ workspace, settlement: applied.data.receipt.id, messageId: "discord-ask-1" });
    expect(runAgentAskNotificationsCommand({ workspace }).data.notifications).toEqual([]);
  });

  it("settles rejection without Project or queue effects and queues a brief ping", () => {
    const { workspace, repo } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: actionAsk("ask-reject-1") });
    const before = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    const preview = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-reject-1",
      disposition: "rejected",
      revision: 1
    });
    const applied = runAgentAskSettleCommand({
      workspace,
      proposal: proposal.data.proposal.id,
      requestId: "settle-reject-1",
      disposition: "rejected",
      revision: 1,
      preview: preview.data.receipt.previewFingerprint,
      apply: true
    });
    expect(applied.data.receipt).toMatchObject({ disposition: "rejected", queueActionKey: null, notificationStatus: "pending" });
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toBe(before);
    expect(runAgentAskNotificationsCommand({ workspace }).data.notifications[0]).toMatchObject({
      disposition: "rejected",
      queueActionKey: null
    });
  });
});

function fixture(): { workspace: string; repo: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-settle-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc(), "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "ask-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Ask Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add Ask fixture"], { cwd: repo });
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Test Agent Ask settlement.", goal: "Settle work safely.",
      status: "active", currentMilestone: "Settlement", nextAction: "Keep going.", workClassification: "codex"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: ["demo/existing"], order: ["demo/existing"], requestId: "fixture-order", apply: true
    });
  });
  return { workspace, repo };
}

function actionAsk(requestId: string): string {
  return [
    "agent_ask: v1",
    `request_id: ${requestId}`,
    "project: demo",
    "intent: action",
    "desired_result: Add settlement proof",
    "rationale: It proves the loop",
    "acceptance:",
    "  - The settlement proof exists.",
    "dependencies: []",
    "requested_authority: apply_if_approved",
    ""
  ].join("\n");
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Settle work safely.", "milestone: Settlement", "active_plan: demo-plan", "current_action: existing",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

function planDoc(): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Settlement", "current_action: existing", "token_impact: medium",
    "token_budget: Deterministic settlement with one implementation pass.", "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:", "  - id: existing", "    title: Keep existing work", "    status: open",
    "    responsibility: codex", "    effort: session", "    next_action: Keep existing work moving.",
    "    expected_artifact: Existing proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Existing proof exists.", "    depends_on: []", "    decisions: []",
    "    references: []", "---", "", "# Demo plan", ""].join("\n");
}
