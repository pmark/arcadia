import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentAskContractCommand, runAgentAskPreviewCommand, runAgentAskSettleCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { discoverDocs } from "../src/docs/discover.js";
import { arrangeActionOrder, loadActionOrder } from "../src/dispatch/order.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Agent Ask complete", () => {
  it("lists complete in the published contract", () => {
    expect(runAgentAskContractCommand().data.intents).toContain("complete");
  });

  it("marks an Action done, advances the pointer to the next eligible Action, and appends a Log entry", () => {
    const { workspace, repo, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-first", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-first", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-first", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.applied).toBe(true);
    expect(applied.data.receipt.effects.join(" ")).toContain("Marked Action demo/first done");
    expect(applied.data.receipt.effects.join(" ")).toContain("Pointer: demo/second.");

    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({
      currentAction: "second",
      actions: [
        expect.objectContaining({ id: "first", status: "done" }),
        expect.objectContaining({ id: "second", status: "open" })
      ]
    });
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: "second" });
    const log = readFileSync(path.join(repo, "MISSION_LOG.md"), "utf8");
    expect(log).toContain("Completed demo/first");
    expect(log).toContain(head);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe("");

    const replay = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-first", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(replay.data.receipt).toEqual(applied.data.receipt);
  });

  it("marks the Plan complete when the finished Action was the last one open", () => {
    const { workspace, repo, head } = fixture({ secondDone: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-last", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-last", disposition: "accepted"
    });
    const applied = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-complete-last", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    });
    expect(applied.data.receipt.effects.join(" ")).toContain("Plan demo-plan is complete");
    const plan = discoverDocs(repo).docs.find((doc) => doc.type === "plan" && doc.slug === "demo-plan");
    expect(plan).toMatchObject({ status: "complete", currentAction: null });
    const project = discoverDocs(repo).docs.find((doc) => doc.type === "project");
    expect(project).toMatchObject({ currentAction: null });
  });

  it("refuses apply without --operator, without writing anything", () => {
    const { workspace, repo, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-no-operator", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-no-operator", disposition: "accepted"
    });
    const before = readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8");
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-no-operator", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true
    })).toThrow(/operator-only/);
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toBe(before);
  });

  it("refuses completion evidence that does not mark every criterion met", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-unmet", "first", head).replace("status: met", "status: failed");
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-unmet", disposition: "accepted"
    })).toThrow(/not every acceptance criterion is met/);
  });

  it("refuses evidence that skips a declared criterion", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-skip", "first", head).replace("status: met", "status: skipped");
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-skip", disposition: "accepted"
    })).toThrow(/not every acceptance criterion is met/);
  });

  it("refuses evidence that does not cover every declared criterion verbatim", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-partial", "first", head).replace('criterion: "First proof exists."', 'criterion: "Some other claim."');
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-partial", disposition: "accepted"
    })).toThrow(/must cover every declared acceptance criterion/);
  });

  it("refuses completion while a required review Decision is unresolved", () => {
    const { workspace, repo, head } = fixture({ withOpenDecision: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-review", "first", head) });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-review", disposition: "accepted"
    })).toThrow(/unresolved required review Decisions/);
    expect(readFileSync(path.join(repo, "docs/plans/demo-plan.md"), "utf8")).toContain("status: open");
  });

  it("refuses a stale Candidate revision", () => {
    const { workspace, head } = fixture();
    const request = completeAsk("complete-stale", "first", head).replace(head, "abadc0de".repeat(5));
    const proposal = runAgentAskPreviewCommand({ workspace, request });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale", disposition: "accepted"
    })).toThrow(/does not match the repository's current HEAD/);
  });

  it("refuses completing an Action that is already done", () => {
    const { workspace, head } = fixture({ firstDone: true });
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-done", "first", head) });
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-done", disposition: "accepted"
    })).toThrow(/already done/);
  });

  it("preserves settled documents when the fingerprint goes stale before apply", () => {
    const { workspace, repo, head } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: completeAsk("complete-stale-preview", "first", head) });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale-preview", disposition: "accepted"
    });
    const planPath = path.join(repo, "docs/plans/demo-plan.md");
    writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\n<!-- concurrent edit -->\n`, "utf8");
    expect(() => runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-stale-preview", disposition: "accepted",
      preview: preview.data.receipt.previewFingerprint, apply: true, operator: true
    })).toThrow(/current preview/);
    expect(readFileSync(planPath, "utf8")).not.toContain("status: done");
  });
});

function fixture(options: {
  secondDependsOnFirst?: boolean;
  secondDone?: boolean;
  firstDone?: boolean;
  withOpenDecision?: boolean;
} = {}): { workspace: string; repo: string; head: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-complete-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  if (options.withOpenDecision) mkdirSync(path.join(repo, "docs/decisions"), { recursive: true });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc(options), "utf8");
  if (options.withOpenDecision) {
    writeFileSync(path.join(repo, "docs/decisions/0001-review-first.md"), [
      "---", "arcadia: v1", "type: decision", 'id: "0001"', "slug: review-first", "project: demo",
      "status: open", "question: Does the independent review pass?", "confidence: high", "plan: demo-plan",
      "action: first", "updated: 2026-09-01", "---", "", "# Decision 0001: Does the independent review pass?", ""
    ].join("\n"), "utf8");
  }
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "ask-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Ask Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add Ask fixture"], { cwd: repo });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Test Agent Ask completion.", goal: "Complete work safely.",
      status: "active", currentMilestone: "Completion", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(db, {
      currentKeys: ["demo/first", "demo/second"], order: ["demo/first", "demo/second"], requestId: "fixture-order", apply: true
    });
  });
  return { workspace, repo, head };
}

function completeAsk(requestId: string, actionId: string, candidateRevision: string): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, "project: demo", "intent: complete",
    `target_ref: action/${actionId}`, "desired_result: Accept the completion evidence for the first Action",
    "rationale: Every declared criterion is met.", `candidate_revision: ${candidateRevision}`,
    "evidence:", '  - criterion: "First proof exists."', "    status: met", "    note: Verified by the operator.",
    "requested_authority: apply_if_approved", ""
  ].join("\n");
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Complete work safely.", "milestone: Completion", "active_plan: demo-plan", "current_action: first",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

function planDoc(options: {
  secondDependsOnFirst?: boolean;
  secondDone?: boolean;
  firstDone?: boolean;
  withOpenDecision?: boolean;
}): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Completion", "current_action: first", "token_impact: medium",
    "token_budget: Deterministic completion with one accepted evidence pass.",
    "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", `    status: ${options.firstDone ? "done" : "open"}`,
    "    responsibility: agent", "    effort: session", "    next_action: Finish the first Action.",
    "    expected_artifact: First proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - First proof exists.", "    depends_on: []",
    `    decisions: [${options.withOpenDecision ? "review-first" : ""}]`, "    references: []",
    "  - id: second", "    title: Second Action", `    status: ${options.secondDone ? "done" : "open"}`,
    "    responsibility: agent", "    effort: session", "    next_action: Finish the second Action.",
    "    expected_artifact: Second proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second proof exists.",
    `    depends_on: [${options.secondDependsOnFirst ? "first" : ""}]`, "    decisions: []", "    references: []",
    "questions: []", "---", "", "# Demo plan", ""].join("\n");
}
