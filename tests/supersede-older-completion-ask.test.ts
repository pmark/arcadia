import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attemptAutoSettlePendingCompletion, AUTO_SETTLE_EVIDENCE_INCOMPLETE, AUTO_SETTLE_SETTLED } from "../src/ask/autoSettleBeforeDispatch.js";
import { resolveOperatorGate } from "../src/ask/operatorGate.js";
import { previewAgentAskRequest } from "../src/ask/preview.js";
import { listUnsettledAgentAskProposals } from "../src/ask/settlement.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { arrangeActionOrder } from "../src/dispatch/order.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const ACTION = { id: "first", acceptanceCriteria: ["First proof exists."] };
const GOOD = "First proof exists.";
const BAD = "A different criterion entirely.";

describe("supersedeOlderPendingCompletionAsks (Issue #2786)", () => {
  it("settles the newer clean completion Ask, records the older failing one as superseded with a receipt, and stops gating the Action", () => {
    const { repo, workspace, head } = fixture();
    const olderPath = writeDraft(repo, "complete-first-older", BAD, head);
    const newerPath = writeDraft(repo, "complete-first-newer", GOOD, head);

    const result = withDatabase(workspace, (db) => {
      previewAgentAskRequest(db, { request: readText(olderPath), sourcePath: olderPath });
      previewAgentAskRequest(db, { request: readText(newerPath), sourcePath: newerPath });
      expect(resolveOperatorGate({ db, repoRoot: repo, projectSlug: "demo", selectedActionId: "first" }).blocking).toHaveLength(2);
      const settled = attemptAutoSettlePendingCompletion(db, { repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION });
      const receipt = db.prepare("SELECT s.disposition, s.receipt_json FROM agent_ask_settlements s JOIN agent_ask_proposals p ON p.id = s.proposal_id WHERE p.request_id = 'complete-first-older'")
        .get() as { disposition: string; receipt_json: string } | undefined;
      return {
        settled,
        unsettled: listUnsettledAgentAskProposals(db),
        gate: resolveOperatorGate({ db, repoRoot: repo, projectSlug: "demo", selectedActionId: "first" }),
        receipt
      };
    });

    expect(result.settled).toMatchObject({ settled: true, reason: AUTO_SETTLE_SETTLED });
    expect(result.receipt?.disposition).toBe("rejected");
    expect(JSON.parse(result.receipt!.receipt_json).effects[0]).toContain("Superseded by completion Ask complete-first-newer");
    expect(result.unsettled).toEqual([]);
    expect(result.gate.blocking).toEqual([]);
  });

  it("control: a single pending complete Ask that fails criteria still gates the Action", () => {
    const { repo, workspace, head } = fixture();
    const only = writeDraft(repo, "complete-first-only", BAD, head);

    const result = withDatabase(workspace, (db) => {
      previewAgentAskRequest(db, { request: readText(only), sourcePath: only });
      const settled = attemptAutoSettlePendingCompletion(db, { repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION });
      return { settled, gate: resolveOperatorGate({ db, repoRoot: repo, projectSlug: "demo", selectedActionId: "first" }) };
    });

    expect(result.settled).toMatchObject({ settled: false, reason: AUTO_SETTLE_EVIDENCE_INCOMPLETE });
    expect(result.gate.blocking).toHaveLength(1);
  });

  it("never supersedes a Decision Ask or a non-completion Ask naming the Action", () => {
    const { repo, workspace, head } = fixture();
    const decisionish = path.join(repo, ".arcadia/asks/agent-ask-decision-first.yaml");
    writeFileSync(decisionish, `${JSON.stringify({
      agent_ask: "v1", request_id: "decision-first", project: "demo", intent: "decision", requested_authority: "propose",
      target_ref: "action/first", desired_result: "Decide whether the first Action may complete despite a failed criterion.",
      gate_question: "reasonable_disagreement",
      options: [
        { label: "Accept anyway", consequence: "Completes the Action despite the failed criterion.", recommended: true },
        { label: "Rework", consequence: "Keeps the Action open until the criterion is met." }
      ]
    })}\n`, "utf8");
    const proposal = path.join(repo, ".arcadia/asks/agent-ask-proposal-first.yaml");
    writeFileSync(proposal, `${JSON.stringify({
      agent_ask: "v1", request_id: "proposal-first", project: "demo", intent: "proposal", requested_authority: "propose",
      target_ref: "action/first", desired_result: "Consider reshaping the first Action."
    })}\n`, "utf8");
    const newer = writeDraft(repo, "complete-first-zzz-newer", GOOD, head);

    const pending = withDatabase(workspace, (db) => {
      previewAgentAskRequest(db, { request: readText(decisionish), sourcePath: decisionish });
      previewAgentAskRequest(db, { request: readText(proposal), sourcePath: proposal });
      previewAgentAskRequest(db, { request: readText(newer), sourcePath: newer });
      const settled = attemptAutoSettlePendingCompletion(db, { repoRoot: repo, projectSlug: "demo", activePlanSlug: "demo-plan", action: ACTION });
      expect(settled).toMatchObject({ settled: true, reason: AUTO_SETTLE_SETTLED });
      return listUnsettledAgentAskProposals(db).map((row) => row.requestId).sort();
    });

    expect(pending).toEqual(["decision-first", "proposal-first"]);
  });
});

function readText(file: string): string {
  return execFileSync("cat", [file], { encoding: "utf8" });
}

function writeDraft(repo: string, requestId: string, criterion: string, revision: string, extra: Record<string, unknown> = {}): string {
  const file = path.join(repo, `.arcadia/asks/agent-ask-${requestId}.yaml`);
  writeFileSync(file, `${JSON.stringify({
    agent_ask: "v1", request_id: requestId, project: "demo", intent: "complete",
    target_ref: "action/first", desired_result: "Accept the completion evidence for the first Action",
    rationale: "Evidence recorded.", candidate_revision: revision,
    evidence: [{ criterion, status: "met", note: "Verified by the agent." }],
    requested_authority: "apply_if_approved", ...extra
  })}\n`, "utf8");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", `Draft ${requestId}`], { cwd: repo });
  return file;
}

function fixture(): { repo: string; workspace: string; head: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-supersede-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  mkdirSync(path.join(repo, ".arcadia/asks/archive"), { recursive: true });
  writeFileSync(path.join(repo, ".arcadia/asks/archive/.gitkeep"), "", "utf8");
  writeFileSync(path.join(repo, "PROJECT.md"), ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Supersede stale completion Asks.", "milestone: Completion", "active_plan: demo-plan", "current_action: first",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n"), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Completion", "current_action: first", "token_impact: medium", "token_budget: Deterministic completion.",
    "recommended_model: gpt-5.6-sol", "updated: 2026-09-01", "actions:",
    "  - id: first", "    title: First Action", "    status: open", "    responsibility: agent", "    effort: session",
    "    next_action: Finish the first Action.", "    expected_artifact: First proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - First proof exists.", "    depends_on: []", "    decisions: []", "    references: []",
    "  - id: second", "    title: Second Action", "    status: open", "    responsibility: agent", "    effort: session",
    "    next_action: Finish the second Action.", "    expected_artifact: Second proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Second proof exists.", "    depends_on: []", "    decisions: []", "    references: []",
    "questions: []", "---", "", "# Demo plan", ""].join("\n"), "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "supersede-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Supersede Test"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add fixture"], { cwd: repo });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  initWorkspace(workspace);
  withDatabase(workspace, (database) => {
    const project = upsertProject(database, {
      name: "Demo", mission: "Test superseding.", goal: "No stale gate.", status: "active",
      currentMilestone: "Completion", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(database, { projectId: project.id, repoPath: repo });
    arrangeActionOrder(database, { currentKeys: ["demo/first", "demo/second"], order: ["demo/first", "demo/second"], requestId: "fixture-order", apply: true });
  });
  return { repo, workspace, head };
}
