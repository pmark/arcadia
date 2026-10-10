import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Approval } from "../lib/approvals";
import { parseTodoPath, todoHrefOf, todoKeyOf } from "../lib/approvals";
import { TodoItemView, TodoListView, type TodoCommon } from "./todo-views";
import { TodoCard } from "./todo-card";

function row(kind: Approval["kind"], project: string, id: string, extra: Partial<Approval> = {}): Approval {
  return {
    kind, id, project, title: `A deliberately long title for ${kind} ${id} that must never be truncated`, detail: null, gateQuestion: null,
    options: kind === "decision" ? [{ label: "Go", consequence: "Ships it.", recommended: true }] : [],
    evidence: [], sourceEvidence: [], cost: "Deterministic", createdAt: "2026-10-01", readOnly: false, blocking: false,
    staleReason: null, answer: null, answerVia: [], origin: null,
    todoKey: todoKeyOf(kind, project, id), href: todoHrefOf(kind, project, id), requestId: kind === "agent_ask" ? `req-${id}` : null, aliases: kind === "agent_ask" ? [`req-${id}`] : kind === "decision" ? [`slug-${id}`] : [],
    acceptable: null, acceptWhy: null, buildPacket: false,
    ...extra
  };
}

const common: TodoCommon = { pendingId: null, onAct: () => undefined, message: null, error: null, note: null, hasLoaded: true };

describe("TodoListView", () => {
  const approvals = [
    row("agent_ask", "alpha", "p9", { blocking: true }),
    row("decision", "alpha", "0001"),
    row("agent_ask", "alpha", "p1"),
    row("review_item", "alpha", "r1", { readOnly: true, answer: "arcadia review approve r1" }),
    row("decision", "beta", "0007", { staleReason: "answered elsewhere" })
  ];
  const html = renderToStaticMarkup(<TodoListView {...common} approvals={approvals} expandedKey={null} onToggle={() => undefined} />);

  it("shows the blocking count, then groups in order, with stale collapsed", () => {
    expect(html).toContain("1 blocking · 4 waiting on you");
    const order = ["Blocking (1)", "Decisions (1)", "Agent Asks (1)", "Other (1)", "Stale (1)"].map((label) => html.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/<details class="mt-4"><summary[^>]*>Stale \(1\)/);
  });

  it("shows full titles, ids, anchors and deep links on every card", () => {
    expect(html).toContain("A deliberately long title for decision 0001 that must never be truncated");
    expect(html).toContain("Decision id");
    expect(html).toContain("req-p9");
    expect(html).toContain('id="todo-decision-alpha-0001"');
    expect(html).toContain('href="/todo/decision/alpha/0001"');
    expect(html).not.toMatch(/class="[^"]*\btruncate\b/);
  });

  it("offers Approve and Accept controls at touch size and no hardcoded recommendation", () => {
    expect(html).toContain("Approve");
    expect(html).toContain("Accept");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("Recommended: accept");
  });

  it("says so when nothing is waiting", () => {
    const empty = renderToStaticMarkup(<TodoListView {...common} approvals={[]} expandedKey={null} onToggle={() => undefined} />);
    expect(empty).toContain("Nothing is waiting on you.");
    expect(empty).toContain("0 blocking · 0 waiting on you");
  });
});

describe("TodoItemView", () => {
  const approvals = [row("decision", "alpha", "0001"), row("review_item", "alpha", "r1", { readOnly: true })];
  const view = (path: [string, string[]], extra: Partial<Parameters<typeof TodoItemView>[0]> = {}) =>
    renderToStaticMarkup(
      <TodoItemView {...common} target={parseTodoPath(path[0], path[1])} approvals={approvals} source="todo" {...extra} />
    );

  it("renders a pending item expanded with its action and a link back", () => {
    const html = view(["decision", ["alpha", "0001"]]);
    expect(html).toContain("Approve");
    expect(html).toContain('href="/todo"');
    expect(html).toContain("All to-dos");
    expect(html).not.toContain('aria-label="Done"');
  });

  it("resolves a Decision by doc slug and an Agent Ask by request id", () => {
    const withAsk = [...approvals, row("agent_ask", "alpha", "p1")];
    const bySlug = view(["decision", ["alpha", "slug-0001"]]);
    expect(bySlug).toContain("Approve");
    expect(bySlug).not.toContain('aria-label="Done"');
    const byRequest = renderToStaticMarkup(
      <TodoItemView {...common} target={parseTodoPath("agent_ask", ["alpha", "req-p1"])} approvals={withAsk} source="todo" />
    );
    expect(byRequest).toContain("Accept");
    expect(byRequest).not.toContain('aria-label="Done"');
    expect(view(["decision", ["beta", "slug-0001"]])).toContain('aria-label="Done"');
  });

  it("renders a review item by its review id", () => {
    const html = view(["review_item", ["alpha", "r1"]]);
    expect(html).toContain("Review item");
    expect(html).not.toContain('aria-label="Done"');
  });

  it("renders Done, not a 404, for an item no longer pending", () => {
    const html = view(["decision", ["alpha", "0042"]]);
    expect(html).toContain('aria-label="Done"');
    expect(html).toContain("0042");
    expect(html).toContain('href="/todo"');
    expect(html).not.toContain("Not found");
  });

  it("renders a clear not-found for a malformed link", () => {
    const html = view(["decision", ["alpha"]]);
    expect(html).toContain("Not found");
    expect(html).toContain('href="/todo"');
  });

  it("does not claim Done before the list loads or when it could not be read", () => {
    expect(view(["decision", ["alpha", "0042"]], { hasLoaded: false })).not.toContain('aria-label="Done"');
    expect(view(["decision", ["alpha", "0042"]], { hasLoaded: false, error: "boom" })).not.toContain('aria-label="Done"');
    expect(view(["review_item", ["alpha", "r9"]], { source: "fallback" })).not.toContain('aria-label="Done"');
  });
});

describe("TodoItemView never claims Done on an incomplete list", () => {
  const missing = parseTodoPath("decision", ["alpha", "0042"]);
  const render = (extra: Partial<TodoCommon> & { source?: "todo" | "fallback" | null }) =>
    renderToStaticMarkup(
      <TodoItemView {...common} onRetry={() => undefined} {...extra} target={missing} approvals={[]} source={extra.source === undefined ? "todo" : extra.source} />
    );

  it("shows Done only for a complete, error-free list", () => {
    expect(render({})).toContain('aria-label="Done"');
  });

  it.each([
    ["a note (loader failure)", { note: "Settle controls are unavailable (boom)" }, "Settle controls are unavailable"],
    ["an unavailable source", { note: "The to-do list could not read a source: review items: db locked" }, "db locked"],
    ["a poll error after a prior success", { hasLoaded: true, error: "fetch failed" }, "fetch failed"],
    ["the fallback list", { source: "fallback" as const }, "could not be read"]
  ])("shows State unknown with Retry and a link back for %s", (_name, extra, text) => {
    const html = render(extra);
    expect(html).not.toContain('aria-label="Done"');
    expect(html).toContain("State unknown");
    expect(html).toContain(text);
    expect(html).toContain("Retry");
    expect(html).toContain('href="/todo"');
  });

  it("prefers an exact todoKey match over an alias match", () => {
    const exact = row("decision", "alpha", "0001", { title: "EXACT" });
    const aliased = row("decision", "alpha", "0002", { title: "ALIASED", aliases: ["0001"] });
    const html = renderToStaticMarkup(
      <TodoItemView {...common} target={parseTodoPath("decision", ["alpha", "0001"])} approvals={[aliased, exact]} source="todo" />
    );
    expect(html).toContain("EXACT");
    expect(html).not.toContain("ALIASED");
  });
});

describe("deep-link path forms", () => {
  it("round-trips the Discord bot's encoding of a colon kind", () => {
    // apps/discord-bot/src/todoLinks.ts: encodeURIComponent on each segment.
    const url = ["escalation:auth", "alpha", "e 1"].map(encodeURIComponent).join("/");
    expect(url).toBe("escalation%3Aauth/alpha/e%201");
    const [kind, ...rest] = url.split("/");
    const parsed = parseTodoPath(kind, rest);
    expect(parsed).toMatchObject({ kind: "escalation:auth", project: "alpha", id: "e 1", todoKey: "escalation:auth:alpha/e 1" });
    expect(todoHrefOf("escalation:auth", "alpha", "e 1")).toBe(`/todo/${url}`);
    expect(parseTodoPath("escalation:a:b", ["alpha", "x"])).toBeNull();
  });

  it("decodes exactly once, so a literal percent in an id survives", () => {
    // Next keeps params percent-encoded, so an id "50%" arrives as "50%25".
    expect(parseTodoPath("review_item", ["alpha", "50%25"])?.id).toBe("50%");
    expect(parseTodoPath("review_item", ["alpha", encodeURIComponent("%41")])?.id).toBe("%41");
  });
});

describe("phone constraints", () => {
  const dir = new URL("./", import.meta.url);
  const sources = ["todo-card.tsx", "todo-views.tsx", "../hooks/use-approvals.ts", "../app/todo/page.tsx", "../app/todo/[kind]/[...id]/page.tsx"].map((file) =>
    readFileSync(new URL(file, dir), "utf8")
  );

  it("avoids secure-context-only APIs", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/randomUUID|navigator\.clipboard/);
    }
  });

  it("lists /todo first in the sidebar", () => {
    const sidebar = readFileSync(new URL("sidebar.tsx", dir), "utf8");
    expect(sidebar).toMatch(/const PRIMARY_NAV = \[\n\s+\{ href: "\/todo"/);
  });
});

describe("TodoCard build packets and Ask eligibility", () => {
  const render = (approval: Approval) =>
    renderToStaticMarkup(<TodoCard approval={approval} expanded={false} pendingId={null} onAct={() => undefined} />);

  it("gives a build packet Approve (no execute) and Reject buttons, not a terminal command", () => {
    const html = render(row("review_item", "alpha", "rv1", { buildPacket: true, origin: "CodexBuildPacketApproval" }));
    expect(html).toContain("Approve (no execute)");
    expect(html).toContain(">Reject<");
    expect(html).not.toContain("Read-only here");
  });

  it("disables Accept with the reason and makes Reject primary when accepting would not apply", () => {
    const html = render(row("agent_ask", "alpha", "p1", { acceptable: false, acceptWhy: "Agent Ask Project has no resolvable active managed Plan." }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Won(&#x27;|')t apply — Agent Ask Project has no resolvable active managed Plan\.<\/button>/);
    expect(html).not.toContain(">Accept<");
    expect(html).toContain(">Reject<");
  });

  it("keeps the normal Accept when eligibility is unknown or true", () => {
    expect(render(row("agent_ask", "alpha", "p1"))).toContain(">Accept<");
    expect(render(row("agent_ask", "alpha", "p1", { acceptable: true }))).toContain(">Accept<");
  });
});
