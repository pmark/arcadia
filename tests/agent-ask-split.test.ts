import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskContractCommand, runAgentAskPreviewCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Agent Ask split", () => {
  it("lists split in the published contract", () => {
    expect(runAgentAskContractCommand().data.intents).toContain("split");
  });

  it("carries a split example built only from real envelope fields", () => {
    const { data } = runAgentAskContractCommand();
    for (const key of Object.keys(data.splitExample)) expect(data.fields.envelope).toContain(key);
    expect(data.splitExample.intent).toBe("split");
  });

  it("narrows the Action to its finished slice, marks it done, and queues the remainder immediately after it", () => {
    const { workspace, repo, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: splitAsk("split-first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-first", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-first", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).toContain("Narrowed Action demo/first to 1 of 2 declared criteria");
    expect(applied.data.receipt.effects.join(" ")).toContain("Created 1 remainder Action");
    expect(applied.data.receipt.effects.join(" ")).toContain("Queued the remainder immediately after demo/first");

    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({
      currentAction: "first-remainder",
      actions: [
        expect.objectContaining({ id: "first", status: "done", acceptanceCriteria: ["First slice done."] }),
        expect.objectContaining({ id: "second", status: "open" }),
        expect.objectContaining({ id: "first-remainder", status: "open", acceptanceCriteria: ["Second slice done."] })
      ]
    });
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: "first-remainder" });
    const log = readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8");
    expect(log).toContain("Split: narrowed to the finished slice");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");

    const replay = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-first", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(replay.data.receipt).toEqual(applied.data.receipt);
  });

  it("places the remainder right after the narrowed Action even when other Actions are queued between them", () => {
    const { workspace, repo, head } = fixture({ queueOrder: ["demo/second", "demo/first"] });
    const proposal = runAgentAskPreviewCommand({ workspace, request: splitAsk("split-order", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-order", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-order", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    // demo/second sits ahead of demo/first in the explicit queue, so it is
    // still the pointer's next stop; the remainder lands right after demo/first.
    expect(applied.data.receipt.effects.join(" ")).toContain("Pointer: demo/second.");
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: "second" });
  });

  it("refuses a narrowed acceptance list equal to the full declared criteria", () => {
    const { workspace, head } = fixture();
    const request = splitAsk("split-full", head).replace('acceptance:\n  - "First slice done."', 'acceptance:\n  - "First slice done."\n  - "Second slice done."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-full", disposition: "accepted"
    })).toThrow(/strict subset/);
  });

  it("refuses when a dropped criterion does not reappear in any remainder Action", () => {
    const { workspace, head } = fixture();
    const request = splitAsk("split-drop", head).replace('acceptance:\n      - "Second slice done."', 'acceptance:\n      - "Something else entirely."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-drop", disposition: "accepted"
    })).toThrow(/must reappear verbatim in a remainder Action/);
  });

  it("refuses evidence that does not cover the narrowed acceptance verbatim", () => {
    const { workspace, head } = fixture();
    const request = splitAsk("split-evidence", head).replace('criterion: "First slice done."', 'criterion: "Wrong criterion."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-evidence", disposition: "accepted"
    })).toThrow(/must cover every narrowed acceptance criterion/);
  });

  it("refuses evidence that does not mark the narrowed criterion met", () => {
    const { workspace, head } = fixture();
    const request = splitAsk("split-unmet", head).replace("status: met", "status: failed");
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-unmet", disposition: "accepted"
    })).toThrow(/not every narrowed acceptance criterion is met/);
  });

  it("refuses acceptance criteria not drawn verbatim from the Action's declared list", () => {
    const { workspace, head } = fixture();
    const request = splitAsk("split-invented", head)
      .replace('acceptance:\n  - "First slice done."', 'acceptance:\n  - "Invented criterion."')
      .replace('criterion: "First slice done."', 'criterion: "Invented criterion."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-split-invented", disposition: "accepted"
    })).toThrow(/drawn verbatim from the Action's declared acceptance criteria/);
  });
});

function fixture(options: { queueOrder?: string[] } = {}): { workspace: string; repo: string; head: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-split-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
  writeFileSync(path.join(repo, ".arcadia/asks/archive/.gitkeep"), "", "utf8");
  writeFileSync(path.join(repo, "PROJECT.md"), [
    "---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "mission: Test Agent Ask split.", "goal: Split work safely.", "active_plan: demo-plan",
    "current_action: first", "updated: 2026-09-01", "---", "", "# Demo", ""
  ].join("\n"), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), [
    "---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Split work", "current_action: first", "token_impact: medium",
    "token_budget: Deterministic split with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol", "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first Action.",
    "    expected_artifact: First proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - First slice done.", "      - Second slice done.",
    "    depends_on: []", "    decisions: []", "    references: []",
    "  - id: second", "    title: Second Action", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Finish the second Action.",
    "    expected_artifact: Second proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second proof exists.", "    depends_on: []", "    decisions: []", "    references: []",
    "questions: []", "---", "", "# Demo plan", ""
  ].join("\n"), "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "ask-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Ask Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add Ask fixture"], { cwd: repo });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Test Agent Ask split.", goal: "Split work safely.",
      status: "active", currentMilestone: "Split work", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: ["demo/first", "demo/second"],
      order: options.queueOrder ?? ["demo/first", "demo/second"],
      requestId: "fixture-order",
      apply: true
    });
  });
  return { workspace, repo, head };
}

function splitAsk(requestId: string, candidateRevision: string): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, "project: demo", "intent: split",
    "target_ref: action/first", "desired_result: Finish the first slice of the first Action",
    "rationale: The session could only finish half of the declared criteria.",
    `candidate_revision: ${candidateRevision}`,
    "acceptance:", '  - "First slice done."',
    "evidence:", '  - criterion: "First slice done."', "    status: met",
    "actions:",
    "  - id: first-remainder",
    '    desired_result: "Finish the second slice of the first Action"',
    "    acceptance:",
    '      - "Second slice done."'
  ].join("\n");
}
