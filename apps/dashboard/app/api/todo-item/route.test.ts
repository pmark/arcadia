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
import { GET as readAll } from "../approvals/route";
import { invalidateApprovalsCache } from "../../../lib/approvals-feed";

const success = <T>(data: T) => ({ ok: true, command: "x", workspace: "w", data, artifacts: [], warnings: [] });
const decision = (id: string, projectSlug = "alpha") => ({
  id, slug: `slug-${id}`, projectId: projectSlug, projectSlug, question: `Ship ${id}?`, status: "open",
  gateQuestion: null, recommendation: null, options: [{ label: "Go", consequence: "Ships.", recommended: true }], relativePath: `docs/decisions/${id}.md`, updated: "2026-10-01"
});
const asks = Array.from({ length: 200 }, (_, index) => ({
  proposalId: `p${index}`, requestId: `r${index}`, project: "alpha", intent: "action", desiredResult: `Ask ${index}`, rationale: "x".repeat(2000),
  requestedAuthority: "propose", gateQuestion: null, options: [], requiredDecisions: [], effects: [], createdAt: "2026-10-02T00:00:00Z"
}));

const url = (kind: string, project: string, id: string) => new Request(`http://localhost:3000/api/todo-item?kind=${encodeURIComponent(kind)}&project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`, { headers: { Host: "localhost:3000" } });

beforeEach(() => {
  invalidateApprovalsCache();
  vi.clearAllMocks();
  loaders.peekAgentAskEligibility.mockReturnValue(new Map());
  loaders.loadPendingAgentAsks.mockResolvedValue(success({ pending: asks }));
  loaders.loadOpenDecisions.mockResolvedValue(success({ decisions: [decision("0001"), decision("0001", "beta")] }));
  loaders.loadOperatorTodo.mockResolvedValue(success({ schema: "arcadia-todo-v1", view: "all", items: [], unavailable: [] }));
});

describe("GET /api/todo-item", () => {
  it("returns one row and the list's note and source, at a fraction of the list's size", async () => {
    const response = await GET(url("decision", "alpha", "0001"));
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.source).toBe("todo");
    expect(body.note).toBeNull();
    expect(body.approvals.map((row: { todoKey: string }) => row.todoKey)).toEqual(["decision:alpha/0001"]);
    const whole = await (await readAll()).text();
    expect(whole.length).toBeGreaterThan(400_000);
    expect(text.length).toBeLessThan(2_000);
  });

  it("is the same row the whole list holds", async () => {
    const one = (await (await GET(url("agent_ask", "alpha", "p7"))).json()) as { approvals: unknown[] };
    const all = (await (await readAll()).json()) as { approvals: Array<{ todoKey: string }> };
    expect(one.approvals).toEqual(all.approvals.filter((row) => row.todoKey === "agent_ask:alpha/p7"));
  });

  it("finds a row by its alias, as the page always has", async () => {
    const body = (await (await GET(url("decision", "alpha", "slug-0001"))).json()) as { approvals: Array<{ id: string; project: string }> };
    expect(body.approvals.map((row) => [row.project, row.id])).toEqual([["alpha", "0001"]]);
    const ask = (await (await GET(url("agent_ask", "alpha", "r3"))).json()) as { approvals: Array<{ id: string }> };
    expect(ask.approvals.map((row) => row.id)).toEqual(["p3"]);
  });

  it("returns no row for one that's gone, keeping what decides whether that means done", async () => {
    const complete = (await (await GET(url("decision", "alpha", "9999"))).json()) as Record<string, unknown>;
    expect(complete).toEqual({ approvals: [], note: null, source: "todo" });
    invalidateApprovalsCache();
    loaders.loadOperatorTodo.mockRejectedValue(new Error("todo down"));
    const partial = (await (await GET(url("decision", "alpha", "9999"))).json()) as { approvals: unknown[]; note: string; source: string };
    expect(partial.approvals).toEqual([]);
    expect(partial.source).toBe("fallback");
    expect(partial.note).toContain("todo down");
  });

  it("handles an id holding a slash and a kind holding a colon", async () => {
    const body = (await (await GET(url("escalation:auth", "alpha", "a/b"))).json()) as { approvals: unknown[] };
    expect(body.approvals).toEqual([]);
  });

  it.each([["", "alpha", "1"], ["Bad Kind", "alpha", "1"], ["decision", "", "1"], ["decision", "alpha", ""]])("refuses %j %j %j", async (kind, project, id) => {
    expect((await GET(url(kind, project, id))).status).toBe(400);
  });

  it("refuses a cross-origin read", async () => {
    const response = await GET(new Request("http://localhost:3000/api/todo-item?kind=decision&project=alpha&id=0001", { headers: { "sec-fetch-site": "cross-site" } }));
    expect(response.status).toBe(403);
    expect(loaders.loadOpenDecisions).not.toHaveBeenCalled();
  });

  it("reports a failed read", async () => {
    loaders.loadPendingAgentAsks.mockRejectedValue(new Error("asks down"));
    loaders.loadOperatorTodo.mockRejectedValue(new Error("todo down"));
    const response = await GET(url("decision", "alpha", "0001"));
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toContain("asks down");
  });
});
