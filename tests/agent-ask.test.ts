import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ASK_INTENTS } from "../src/ask/agentAsk.js";
import { runAgentAskPreviewCommand } from "../src/commands/agentAsk.js";
import { withDatabase } from "../src/db/connection.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Agent Ask v1", () => {
  it("normalizes every supported Project-management contribution without Project writes", () => {
    const workspace = initializedWorkspace();
    for (const intent of AGENT_ASK_INTENTS) {
      const request = intent === "plan"
        ? `${strictAsk(`kind-${intent}`, intent)}actions:\n  - desired_result: Deliver the Plan Action\n    acceptance:\n      - Plan Action proof exists.\n    dependencies: []\n`
        : strictAsk(`kind-${intent}`, intent);
      const result = runAgentAskPreviewCommand({ workspace, request });
      expect(result.data.proposal.normalized.intent).toBe(intent);
      expect(result.data.proposal.effects[0]?.targetKind).toBe(intent === "auto" ? "interpretation" : intent);
      expect(result.data.projectWritesPerformed).toBe(0);
      expect(result.data.proposal.queueConsequence).toBe("none_until_accepted");
    }
    withDatabase(workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM work_items").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM review_items").get() as { count: number }).count).toBe(0);
    });
  });

  it("forces agent-authored Decisions open and separately requests apply acceptance", () => {
    const workspace = initializedWorkspace();
    const result = runAgentAskPreviewCommand({ workspace, request: `${strictAsk("decision-one", "decision")}requested_authority: apply_if_approved\n` });
    expect(result.data.proposal.effects[0]?.fields.status).toBe("open");
    expect(result.data.proposal.requiredDecisions).toContain("Accept the exact preview before apply.");
    expect(result.data.proposal.nonActions).toContain("Agent input grants no approval or execution authority.");
  });

  it("previews a Plan amendment, dependencies, and checked-in transition without applying it", () => {
    const workspace = initializedWorkspace();
    const request = `${strictAsk("plan-amendment", "plan").replace("dependencies: []", "dependencies:\n  - work/first")}target_ref: plan/existing\n`;
    const result = runAgentAskPreviewCommand({ workspace, request });
    expect(result.data.proposal.effects[0]).toMatchObject({ operation: "update", targetKind: "plan", targetRef: "plan/existing" });
    expect(result.data.proposal.normalized.dependencies).toEqual(["work/first"]);
    expect(result.data.proposal.managedDocumentTransition).toEqual({ required: true, status: "withheld_until_acceptance", authority: "checked_in_documents" });
    expect(result.data.proposal).toMatchObject({ unchanged: [], conflicts: [], refused: [] });
  });

  it("supports natural fallback only with an explicit id and keeps intent unknown", () => {
    const workspace = initializedWorkspace();
    const result = runAgentAskPreviewCommand({ workspace, request: "Make the release safer.", requestId: "natural-1" });
    expect(result.data.proposal.normalized).toMatchObject({ format: "natural", intent: "auto", project: "unknown" });
    expect(result.data.proposal.requiredDecisions).toContain("Confirm the proposed Arcadia structure after interpretation.");
    expect(() => runAgentAskPreviewCommand({ workspace, request: "No id" })).toThrow("requires --request-id");
  });

  it("refuses an unknown explicit Project before capture", () => {
    const workspace = initializedWorkspace();
    const request = strictAsk("missing-project", "action").replace("project: unknown", "project: not-a-project");
    expect(() => runAgentAskPreviewCommand({ workspace, request })).toThrow("destination Project was not found");
    withDatabase(workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM ask_capture_envelopes").get() as { count: number }).count).toBe(0);
    });
  });

  it("returns a byte-stable replay and refuses changed content under the same id", () => {
    const workspace = initializedWorkspace();
    const request = strictAsk("replay-1", "action");
    const first = runAgentAskPreviewCommand({ workspace, request });
    const replay = runAgentAskPreviewCommand({ workspace, request });
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.proposal).toEqual(first.data.proposal);
    expect(() => runAgentAskPreviewCommand({ workspace, request: request.replace("Deliver the result", "Deliver a changed result") }))
      .toThrow("already used with different content");
  });

  it("rejects unknown fields and authority claims before capture writes", () => {
    const workspace = initializedWorkspace();
    expect(() => runAgentAskPreviewCommand({ workspace, request: `${strictAsk("unsafe-1", "action")}approved: true\n` })).toThrow("unknown fields");
    expect(() => runAgentAskPreviewCommand({ workspace, request: `${strictAsk("unsafe-2", "action")}requested_authority: execute\n` })).toThrow("cannot claim");
    withDatabase(workspace, (db) => {
      expect((db.prepare("SELECT COUNT(*) AS count FROM ask_capture_envelopes").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM agent_ask_proposals").get() as { count: number }).count).toBe(0);
    });
  });

  it("rejects malformed strict YAML rather than treating it as natural input", () => {
    const workspace = initializedWorkspace();
    expect(() => runAgentAskPreviewCommand({ workspace, request: "agent_ask: v1\nrequest_id: [broken\n" })).toThrow("invalid YAML");
  });

  it("previews each structured Action and rejects speculative nested fields", () => {
    const workspace = initializedWorkspace();
    const request = `${strictAsk("multi-action", "action")}actions:\n  - desired_result: Build proof\n    acceptance:\n      - Proof exists\n    dependencies: []\n  - desired_result: Publish guide\n    acceptance:\n      - Guide exists\n    dependencies:\n      - build-proof\n`;
    const result = runAgentAskPreviewCommand({ workspace, request });
    expect(result.data.proposal.effects).toHaveLength(2);
    expect(result.data.proposal.normalized.actions.map((action) => action.desiredResult)).toEqual(["Build proof", "Publish guide"]);
    expect(result.data.preview.filter((line) => line.startsWith("Proposed effect"))).toHaveLength(2);
    expect(() => runAgentAskPreviewCommand({
      workspace,
      request: request.replace("    dependencies: []", "    dependencies: []\n    approved: true")
    })).toThrow("action contains unknown fields");
  });

  it("accepts Plan-shaped Actions with shared references and per-Action amendment targets", () => {
    const workspace = initializedWorkspace();
    const request = [
      "agent_ask: v1", "request_id: plan-shaped", "project: unknown", "intent: plan",
      "desired_result: Deliver the release", "acceptance: []", "dependencies: []",
      "references:", "  - docs/release.md", "target_ref: plan/release",
      "actions:",
      "  - desired_result: Build the release", "    acceptance:", "      - Build passes.",
      "    dependencies: []", "    references:", "      - src/release.ts",
      "  - target_ref: action/publish", "    desired_result: Publish the release",
      "    acceptance:", "      - Release is published.", "    dependencies:", "      - build-the-release",
      "    references: []", "requested_authority: apply_if_approved", ""
    ].join("\n");
    const result = runAgentAskPreviewCommand({ workspace, request });
    expect(result.data.proposal.normalized).toMatchObject({ intent: "plan", targetRef: "plan/release", references: ["docs/release.md"] });
    expect(result.data.proposal.normalized.actions).toEqual([
      {
        desiredResult: "Build the release", acceptance: ["Build passes."], dependencies: [],
        references: ["src/release.ts"], targetRef: null
      },
      {
        desiredResult: "Publish the release", acceptance: ["Release is published."],
        dependencies: ["build-the-release"], references: [], targetRef: "action/publish"
      }
    ]);
    expect(result.data.proposal.effects.map((effect) => effect.operation)).toEqual(["update", "update"]);
  });

  it("refuses an untargeted Plan without governed Actions", () => {
    const workspace = initializedWorkspace();
    expect(() => runAgentAskPreviewCommand({ workspace, request: strictAsk("empty-plan", "plan") }))
      .toThrow("requires at least one governed Action");
  });
});

function strictAsk(requestId: string, intent: string): string {
  return `agent_ask: v1\nrequest_id: ${requestId}\nproject: unknown\nintent: ${intent}\ndesired_result: Deliver the result\nrationale: It advances the Project\nacceptance:\n  - Observable proof exists\ndependencies: []\n`;
}

function initializedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-agent-ask-"));
  roots.push(workspace);
  initWorkspace(workspace);
  return workspace;
}
