import { describe, expect, it } from "vitest";
import { ArcadiaCliError, clearAgentAskEligibilityCache, loadAgentAskEligibility } from "./arcadia-cli";
import { buildApprovals } from "./approvals";
import type { AgentAskPendingItem, OperatorTodoItem } from "./arcadia-cli";
import { requestFor } from "../hooks/use-approvals";

const packet: OperatorTodoItem = {
  key: "review_item:alpha/rv1", kind: "review_item", title: "Approve the immutable build packet", project: "alpha", blocking: false,
  createdAt: "2026-10-01T00:00:00Z", sourceRef: "review_items:rv1", origin: "CodexBuildPacketApproval", answer: "arcadia review show rv1"
};
const clarification: OperatorTodoItem = { ...packet, key: "review_item:alpha/rv2", origin: "ActionClarification", sourceRef: "review_items:rv2" };

function ask(id: string, createdAt: string): AgentAskPendingItem {
  return {
    proposalId: id, requestId: `req-${id}`, project: "alpha", intent: "action", desiredResult: `Ask ${id}`, rationale: null,
    requestedAuthority: "propose", gateQuestion: null, options: [], requiredDecisions: [], effects: [], createdAt
  };
}

describe("build packet to-do rows", () => {
  const list = buildApprovals({ asks: [], decisions: [], todo: { items: [packet, clarification], unavailable: [] } });
  const byId = (id: string) => list.approvals.find((a) => a.id === id)!;

  it("makes only a CodexBuildPacketApproval review item actionable", () => {
    expect(byId("rv1")).toMatchObject({ buildPacket: true, readOnly: false });
    expect(byId("rv2")).toMatchObject({ buildPacket: false, readOnly: true });
  });

  it("does not make a stale packet actionable", () => {
    const stale = buildApprovals({ asks: [], decisions: [], todo: { items: [{ ...packet, staleReason: "its work_item is done" }], unavailable: [] } });
    expect(stale.approvals[0]).toMatchObject({ buildPacket: false, readOnly: true });
  });

  it("approves through /api/review-action with noExecute, and rejects without it", () => {
    expect(requestFor(byId("rv1"), { label: "Approve", reviewAction: "approve" })).toEqual({
      url: "/api/review-action", body: { id: "rv1", action: "approve", noExecute: true }
    });
    expect(requestFor(byId("rv1"), { label: "Reject", reviewAction: "reject" })).toEqual({
      url: "/api/review-action", body: { id: "rv1", action: "reject" }
    });
  });
});

describe("Agent Ask accept eligibility", () => {
  it("annotates and sorts asks that would not apply below the actionable ones, and makes no claim for unevaluated ones", () => {
    const asks = [ask("p-blocked", "2026-10-09T00:00:00Z"), ask("p-ok", "2026-10-01T00:00:00Z"), ask("p-unknown", "2026-10-02T00:00:00Z")];
    const list = buildApprovals({
      asks, decisions: [], todo: { items: [], unavailable: [] },
      eligibility: new Map([["p-blocked", { acceptable: false, why: "no active Plan" }], ["p-ok", { acceptable: true, why: null }]])
    });
    expect(list.approvals.map((a) => [a.id, a.acceptable, a.acceptWhy])).toEqual([
      ["p-unknown", null, null],
      ["p-ok", true, null],
      ["p-blocked", false, "no active Plan"]
    ]);
  });

  it("reads eligibility from the dry-run preview: refusal is false with its reason, success is true, other failures unknown", async () => {
    clearAgentAskEligibilityCache();
    const calls: string[] = [];
    const result = await loadAgentAskEligibility([{ proposalId: "a" }, { proposalId: "b" }, { proposalId: "c" }], async (id) => {
      calls.push(id);
      if (id === "b") throw new ArcadiaCliError("VALIDATION_ERROR: Agent Ask Project has no resolvable active managed Plan.\nmore", 400);
      if (id === "c") throw new ArcadiaCliError("timed out", 500);
      return {};
    });
    expect(result.get("a")).toEqual({ acceptable: true, why: null });
    expect(result.get("b")).toEqual({ acceptable: false, why: "Agent Ask Project has no resolvable active managed Plan." });
    expect(result.has("c")).toBe(false);
  });

  it("caches within a poll and bounds how many previews run", async () => {
    clearAgentAskEligibilityCache();
    let count = 0;
    const preview = async () => { count += 1; return {}; };
    const ids = Array.from({ length: 30 }, (_, i) => ({ proposalId: `p${i}` }));
    const first = await loadAgentAskEligibility(ids, preview, () => 1_000);
    expect(first.size).toBe(20);
    expect(count).toBe(20);
    await loadAgentAskEligibility(ids, preview, () => 2_000);
    expect(count).toBe(20);
    await loadAgentAskEligibility(ids, preview, () => 1_000 + 16_000);
    expect(count).toBe(40);
  });
});
