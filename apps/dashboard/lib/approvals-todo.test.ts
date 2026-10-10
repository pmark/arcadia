import { describe, expect, it } from "vitest";
import type { AgentAskPendingItem, OpenDecisionItem, OperatorTodoItem } from "./arcadia-cli";
import { buildApprovals, parseTodoPath, todoKeyOf } from "./approvals";

const options = [{ label: "Approve it", consequence: "Ships the thing.", recommended: true }];

function decision(id: string, project: string, updated: string): OpenDecisionItem {
  return {
    id, slug: `d-${id}`, projectId: project, projectSlug: project, question: `Question ${id}`, status: "open",
    gateQuestion: "Gate?", recommendation: "Do it.", options, relativePath: `docs/decisions/${id}.md`, updated
  };
}

function ask(id: string, project: string, createdAt: string): AgentAskPendingItem {
  return {
    proposalId: id, requestId: `req-${id}`, project, intent: "action", desiredResult: `Ask ${id}`, rationale: "Because.",
    requestedAuthority: "propose", gateQuestion: null, options, requiredDecisions: [], effects: [], createdAt
  };
}

function todo(kind: OperatorTodoItem["kind"], project: string, id: string, createdAt: string, extra: Partial<OperatorTodoItem> = {}): OperatorTodoItem {
  return { key: `${kind}:${project}/${id}`, kind, title: `Todo ${kind} ${id}`, project, blocking: false, createdAt, sourceRef: `ref:${id}`, answer: "arcadia answer", ...extra };
}

describe("todoKey and href", () => {
  it("gives every row a todoKey and a /todo/<kind>/<project>/<id> deep link, for all kinds", () => {
    const items = [todo("review_item", "alpha", "r 1", "2026-10-05")];
    const list = buildApprovals({ asks: [ask("p1", "alpha", "2026-10-03T00:00:00Z")], decisions: [decision("0001", "alpha", "2026-10-01")], todo: { items, unavailable: [] } });
    const byKind = Object.fromEntries(list.approvals.map((a) => [a.kind, a]));
    expect(byKind.decision).toMatchObject({ todoKey: "decision:alpha/0001", href: "/todo/decision/alpha/0001" });
    expect(byKind.agent_ask).toMatchObject({ todoKey: "agent_ask:alpha/p1", href: "/todo/agent_ask/alpha/p1", requestId: "req-p1" });
    expect(byKind.review_item).toMatchObject({ todoKey: "review_item:alpha/r 1", href: "/todo/review_item/alpha/r%201" });
  });

  it("round-trips an href through parseTodoPath, including an id containing a slash", () => {
    expect(parseTodoPath("review_item", ["alpha", "a%2Fb"])).toMatchObject({ kind: "review_item", project: "alpha", id: "a/b", todoKey: "review_item:alpha/a/b" });
    expect(parseTodoPath("review_item", ["alpha", "a", "b"])?.todoKey).toBe("review_item:alpha/a/b");
    expect(parseTodoPath("decision", ["alpha", "0001"])?.todoKey).toBe(todoKeyOf("decision", "alpha", "0001"));
  });

  it("rejects malformed paths", () => {
    expect(parseTodoPath("Decision!", ["alpha", "1"])).toBeNull();
    expect(parseTodoPath("decision", ["alpha"])).toBeNull();
    expect(parseTodoPath("decision", [])).toBeNull();
    expect(parseTodoPath(undefined, ["a", "b"])).toBeNull();
  });
});

describe("order", () => {
  it("puts blocking first, then Decisions, then Asks, then others, with stale last", () => {
    const items = [
      todo("review_item", "alpha", "r1", "2026-10-09"),
      todo("agent_ask", "alpha", "p9", "2026-10-09T00:00:00Z", { blocking: true }),
      todo("decision", "alpha", "0007", "2026-10-01", { staleReason: "answered elsewhere" })
    ];
    const list = buildApprovals({
      asks: [ask("p1", "alpha", "2026-10-03T00:00:00Z"), ask("p9", "alpha", "2026-10-09T00:00:00Z")],
      decisions: [decision("0001", "alpha", "2026-10-01"), decision("0007", "alpha", "2026-10-01")],
      todo: { items, unavailable: [] }
    });
    expect(list.approvals.map((a) => a.todoKey)).toEqual([
      "agent_ask:alpha/p9",
      "decision:alpha/0001",
      "agent_ask:alpha/p1",
      "review_item:alpha/r1",
      "decision:alpha/0007"
    ]);
  });
});
