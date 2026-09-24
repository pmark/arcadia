import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runAgentAskPendingCommand,
  runAgentAskPreviewCommand,
  runAgentAskSettleCommand
} from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { upsertProject, upsertProjectMetadata } from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(): { workspace: string; repo: string } {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-pending-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(repo, "docs/plans"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "pending-test@example.invalid"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Pending Test"], { cwd: repo });
  writeFileSync(path.join(repo, "PROJECT.md"), projectDoc(), "utf8");
  writeFileSync(path.join(repo, "docs/plans/demo-plan.md"), planDoc(), "utf8");
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "Add fixture"], { cwd: repo });
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const project = upsertProject(db, {
      name: "Demo", mission: "Exercise the pending-approvals queue.", goal: "Prove it lists and clears.",
      status: "active", currentMilestone: "Settlement", nextAction: "Keep going.", workClassification: "agent"
    });
    upsertProjectMetadata(db, { projectId: project.id, repoPath: repo });
  });
  return { workspace, repo };
}

function projectDoc(): string {
  return ["---", "arcadia: v1", "type: project", "slug: demo", "name: Demo", "status: active",
    "goal: Prove it lists and clears.", "milestone: Settlement", "active_plan: demo-plan", "current_action: existing",
    "updated: 2026-09-01", "---", "", "# Demo", ""].join("\n");
}

function planDoc(): string {
  return ["---", "arcadia: v1", "type: plan", "slug: demo-plan", "project: demo", "status: active",
    "milestone: Settlement", "current_action: existing", "token_impact: medium",
    "token_budget: Deterministic settlement with one implementation pass.", "recommended_model: gpt-5.6-sol",
    "updated: 2026-09-01", "actions:", "  - id: existing", "    title: Keep existing work", "    status: open",
    "    responsibility: agent", "    effort: session", "    next_action: Keep existing work moving.",
    "    expected_artifact: Existing proof", "    clarification: clarified", "    confidence: high",
    "    acceptance_criteria:", "      - Existing proof exists.", "    depends_on: []", "    decisions: []",
    "    references: []", "questions: []", "---", "", "# Demo plan", ""].join("\n");
}

function logAsk(requestId: string, project = "demo"): string {
  return [
    "agent_ask: v1", `request_id: ${requestId}`, `project: ${project}`, "intent: log",
    "desired_result: Record something worth keeping.", "rationale: Because a future reader will want it."
  ].join("\n");
}

describe("agent-ask pending", () => {
  it("lists a previewed, unsettled proposal from its stored record alone", () => {
    const { workspace } = fixture();
    runAgentAskPreviewCommand({ workspace, request: logAsk("pending-log-1") });

    const pending = runAgentAskPendingCommand({ workspace });

    expect(pending.data.pending).toHaveLength(1);
    expect(pending.data.pending[0]).toMatchObject({
      requestId: "pending-log-1",
      project: "demo",
      intent: "log",
      desiredResult: "Record something worth keeping.",
      rationale: "Because a future reader will want it."
    });
    expect(pending.data.pending[0].effects.length).toBeGreaterThan(0);
  });

  it("no longer lists a proposal once it has been settled", () => {
    const { workspace } = fixture();
    const proposal = runAgentAskPreviewCommand({ workspace, request: logAsk("pending-log-2") });
    const preview = runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-pending-log-2", disposition: "accepted"
    });
    runAgentAskSettleCommand({
      workspace, proposal: proposal.data.proposal.id, requestId: "settle-pending-log-2",
      disposition: "accepted", apply: true, preview: preview.data.receipt.previewFingerprint
    });

    const pending = runAgentAskPendingCommand({ workspace });

    expect(pending.data.pending).toEqual([]);
  });

  it("lists a proposal for a Project with no configured repository, since listing decodes the stored record without resolving one", () => {
    const { workspace } = fixture();
    withDatabase(workspace, (db) => upsertProject(db, {
      name: "Unconfigured", mission: "Has no repo_path.", status: "active",
      currentMilestone: "Initial", nextAction: "Start", workClassification: "agent"
    }));
    runAgentAskPreviewCommand({ workspace, request: logAsk("pending-log-unconfigured", "unconfigured") });

    const pending = runAgentAskPendingCommand({ workspace });

    expect(pending.data.pending).toHaveLength(1);
    expect(pending.data.pending[0]).toMatchObject({ requestId: "pending-log-unconfigured", project: "unconfigured" });
  });

  it("lists more than one pending proposal, oldest first", () => {
    const { workspace } = fixture();
    runAgentAskPreviewCommand({ workspace, request: logAsk("pending-log-first") });
    runAgentAskPreviewCommand({ workspace, request: logAsk("pending-log-second") });

    const pending = runAgentAskPendingCommand({ workspace });

    expect(pending.data.pending.map((item) => item.requestId)).toEqual(["pending-log-first", "pending-log-second"]);
  });
});
