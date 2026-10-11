import { describe, expect, it } from "vitest";
import { ArcadiaCliError, clearAgentAskEligibilityCache, peekAgentAskEligibility, reviewActionArgs, settleAgentAskEligibility } from "./arcadia-cli";
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

  it("never waits: the first peek is empty, previews run in the background, the next peek has the verdicts", async () => {
    clearAgentAskEligibilityCache();
    const preview = async (id: string) => {
      if (id === "b") throw new ArcadiaCliError("VALIDATION_ERROR: Agent Ask Project has no resolvable active managed Plan.\nmore", 400);
      if (id === "c") throw new ArcadiaCliError("timed out", 500);
      return {};
    };
    const asks = [{ proposalId: "a" }, { proposalId: "b" }, { proposalId: "c" }];
    expect(peekAgentAskEligibility(asks, preview).size).toBe(0);
    await settleAgentAskEligibility();
    const result = peekAgentAskEligibility(asks, preview);
    expect(result.get("a")).toEqual({ acceptable: true, why: null });
    expect(result.get("b")).toEqual({ acceptable: false, why: "Agent Ask Project has no resolvable active managed Plan." });
    expect(result.has("c")).toBe(false);
  });

  it("shares in-flight previews, caches unknowns for 60s and successes for 15s, and bounds the batch", async () => {
    clearAgentAskEligibilityCache();
    const calls: string[] = [];
    let live = 0;
    let peak = 0;
    const preview = async (id: string) => {
      calls.push(id);
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 2));
      live -= 1;
      if (id === "p0") throw new ArcadiaCliError("timed out", 500);
      return {};
    };
    const ids = Array.from({ length: 30 }, (_, i) => ({ proposalId: `p${i}` }));
    peekAgentAskEligibility(ids, preview, () => 1_000);
    peekAgentAskEligibility(ids, preview, () => 1_000); // a second tab/poll while the first is in flight
    await settleAgentAskEligibility();
    expect(calls).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(2);
    peekAgentAskEligibility(ids, preview, () => 1_000 + 10_000);
    await settleAgentAskEligibility();
    expect(calls).toHaveLength(20);
    peekAgentAskEligibility(ids, preview, () => 1_000 + 16_000);
    await settleAgentAskEligibility();
    // 19 successes expired at 15s and re-ran; the unknown p0 stays cached until 60s.
    expect(calls).toHaveLength(39);
    peekAgentAskEligibility(ids, preview, () => 1_000 + 61_000);
    await settleAgentAskEligibility();
    expect(calls).toContain("p0");
    expect(calls.filter((id) => id === "p0")).toHaveLength(2);
  });
});

describe("reviewActionArgs", () => {
  it("appends --no-execute only to an approve that asks for it", () => {
    expect(reviewActionArgs({ id: "rv1", action: "approve", noExecute: true })).toEqual(["review", "approve", "rv1", "--no-execute"]);
    expect(reviewActionArgs({ id: "rv1", action: "approve" })).toEqual(["review", "approve", "rv1"]);
    expect(reviewActionArgs({ id: "rv1", action: "reject", noExecute: true })).toEqual(["review", "reject", "rv1"]);
  });
});
