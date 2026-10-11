import { beforeEach, describe, expect, it, vi } from "vitest";

const loaders = vi.hoisted(() => ({
  loadPendingAgentAsks: vi.fn(),
  loadOpenDecisions: vi.fn(),
  loadOperatorTodo: vi.fn(),
  peekAgentAskEligibility: vi.fn()
}));

vi.mock("../../../lib/arcadia-cli", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/arcadia-cli")>("../../../lib/arcadia-cli");
  return { ...actual, ...loaders };
});

import { GET } from "./route";
import { invalidateApprovalsCache } from "../../../lib/approvals-feed";

const option = { label: "Approve it", consequence: "Ships.", recommended: true };
const success = <T>(data: T) => ({ ok: true, command: "x", workspace: "w", data, artifacts: [], warnings: [] });

const decision = {
  id: "0001", slug: "d", projectId: "alpha", projectSlug: "alpha", question: "Ship?", status: "open",
  gateQuestion: null, recommendation: null, options: [option], relativePath: "docs/decisions/0001.md", updated: "2026-10-01"
};
const ask = {
  proposalId: "p1", requestId: "r1", project: "alpha", intent: "action", desiredResult: "Do a thing", rationale: null,
  requestedAuthority: "propose", gateQuestion: null, options: [option], requiredDecisions: [], effects: [], createdAt: "2026-10-02T00:00:00Z"
};
const review = {
  key: "review_item:alpha/rv1", kind: "review_item", title: "Clarify X", project: "alpha", blocking: true,
  createdAt: "2026-10-03T00:00:00Z", sourceRef: "review_items:rv1", answer: "arcadia review show rv1"
};

beforeEach(() => {
  invalidateApprovalsCache();
  vi.clearAllMocks();
  loaders.peekAgentAskEligibility.mockReturnValue(new Map());
  loaders.loadPendingAgentAsks.mockResolvedValue(success({ pending: [ask] }));
  loaders.loadOpenDecisions.mockResolvedValue(success({ decisions: [decision] }));
  loaders.loadOperatorTodo.mockResolvedValue(success({ schema: "arcadia-todo-v1", view: "all", items: [review], unavailable: [] }));
});

describe("GET /api/approvals", () => {
  it("merges the to-do list with the Decisions and Asks, review items read-only", async () => {
    const body = await (await GET()).json();
    expect(body.source).toBe("todo");
    expect(body.note).toBeNull();
    expect(body.approvals.map((a: { kind: string; readOnly: boolean }) => [a.kind, a.readOnly])).toEqual([
      ["review_item", true],
      ["decision", false],
      ["agent_ask", false]
    ]);
    expect(loaders.loadOperatorTodo).toHaveBeenCalledTimes(1);
  });

  it("falls back to the old loaders with a visible note when the to-do call fails", async () => {
    loaders.loadOperatorTodo.mockRejectedValue(new Error("WORKSPACE_NOT_FOUND: nope"));
    const body = await (await GET()).json();
    expect(body.source).toBe("fallback");
    expect(body.note).toContain("WORKSPACE_NOT_FOUND: nope");
    expect(body.approvals).toHaveLength(2);
    expect(body.approvals.every((a: { readOnly: boolean }) => !a.readOnly)).toBe(true);
  });

  it("errors, rather than showing an empty list, when every source fails", async () => {
    loaders.loadOperatorTodo.mockRejectedValue(new Error("todo down"));
    loaders.loadOpenDecisions.mockRejectedValue(new Error("decision list down"));
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: "decision list down" });
  });

  it("keeps the Decision controls and shows the Ask read-only when todo succeeds but the Ask loader fails", async () => {
    loaders.loadPendingAgentAsks.mockRejectedValue(new Error("agent-ask pending down"));
    loaders.loadOperatorTodo.mockResolvedValue(success({
      schema: "arcadia-todo-v1", view: "all", unavailable: [],
      items: [
        review,
        { key: "agent_ask:alpha/p1", kind: "agent_ask", title: "Do a thing", project: "alpha", blocking: false, createdAt: "2026-10-02T00:00:00Z", sourceRef: "agent_ask_proposals:p1", answer: "arcadia agent-ask settle --proposal p1" },
        { key: "decision:alpha/0001", kind: "decision", title: "Ship?", project: "alpha", blocking: false, createdAt: "2026-10-01", sourceRef: "docs/decisions/0001.md", answer: "arcadia decision approve 0001" }
      ]
    }));
    const body = await (await GET()).json();
    expect(body.source).toBe("todo");
    expect(body.note).toContain("agent-ask pending down");
    const byKind = Object.fromEntries(body.approvals.map((a: { kind: string }) => [a.kind, a]));
    expect(byKind.decision).toMatchObject({ readOnly: false, options: [option] });
    expect(byKind.agent_ask).toMatchObject({ readOnly: true, answer: "arcadia agent-ask settle --proposal p1" });
    expect(body.approvals).toHaveLength(3);
  });

  it("marks an Ask whose accept would not apply, and lists it below the actionable rows", async () => {
    loaders.peekAgentAskEligibility.mockReturnValue(new Map([["p1", { acceptable: false, why: "no resolvable active managed Plan" }]]));
    const body = await (await GET()).json();
    const rows = body.approvals as Array<{ kind: string; acceptable: boolean | null; acceptWhy: string | null }>;
    expect(rows.at(-1)).toMatchObject({ kind: "agent_ask", acceptable: false, acceptWhy: "no resolvable active managed Plan" });
    expect(loaders.peekAgentAskEligibility).toHaveBeenCalledWith([expect.objectContaining({ proposalId: "p1" })]);
  });

  it("lists everything with no eligibility claim when nothing is cached yet", async () => {
    const body = await (await GET()).json();
    expect(body.approvals.find((a: { kind: string }) => a.kind === "agent_ask")).toMatchObject({ acceptable: null, acceptWhy: null });
  });

  it("serves repeat reads from the shared cache and rebuilds after an invalidation", async () => {
    await GET();
    await GET();
    expect(loaders.loadOperatorTodo).toHaveBeenCalledTimes(1);
    invalidateApprovalsCache();
    await GET();
    expect(loaders.loadOperatorTodo).toHaveBeenCalledTimes(2);
  });
});
