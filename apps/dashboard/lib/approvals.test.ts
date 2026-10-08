import { describe, expect, it } from "vitest";
import type { AgentAskPendingItem, OpenDecisionItem, OperatorTodoItem } from "./arcadia-cli";
import { buildApprovals, todoKeyOf } from "./approvals";

const options = [
  { label: "Approve it", consequence: "Ships the thing.", recommended: true },
  { label: "Hold", consequence: "Waits a week.", recommended: false }
];

function decision(id: string, project: string, updated: string): OpenDecisionItem {
  return {
    id, slug: `d-${id}`, projectId: project, projectSlug: project, question: `Question ${id}`, status: "open",
    gateQuestion: "Gate?", recommendation: "Do it.", options, relativePath: `docs/decisions/${id}.md`, updated
  };
}

function ask(id: string, project: string, createdAt: string): AgentAskPendingItem {
  return {
    proposalId: id, requestId: `req-${id}`, project, intent: "action", desiredResult: `Ask ${id}`, rationale: "Because.",
    requestedAuthority: "propose", gateQuestion: null, options, requiredDecisions: [], effects: ["Adds an Action."], createdAt
  };
}

function todo(kind: OperatorTodoItem["kind"], project: string, id: string, createdAt: string, extra: Partial<OperatorTodoItem> = {}): OperatorTodoItem {
  return {
    key: `${kind}:${project}/${id}`, kind, title: `Todo ${kind} ${id}`, project, blocking: false, createdAt,
    sourceRef: `ref:${id}`, answer: `arcadia answer ${id}`, ...extra
  };
}

describe("buildApprovals parity with the old loaders", () => {
  const decisions = [decision("0001", "alpha", "2026-10-01"), decision("0001", "beta", "2026-10-02")];
  const asks = [ask("p1", "alpha", "2026-10-03T00:00:00Z"), ask("p2", "beta", "2026-10-04T00:00:00Z")];

  it("keeps every Decision and Ask the old loaders returned, with options and controls, whatever the to-do list holds", () => {
    // The to-do list lists none of them (e.g. fixture Projects are counted, not listed).
    const list = buildApprovals({ asks, decisions, todo: { items: [], unavailable: [] } });
    const kept = list.approvals.filter((a) => !a.readOnly);
    expect(kept).toHaveLength(4);
    for (const d of decisions) {
      const row = kept.find((a) => a.kind === "decision" && a.id === d.id && a.project === d.projectSlug);
      expect(row?.options).toEqual(options);
      expect(row?.gateQuestion).toBe("Gate?");
      expect(row?.title).toBe(d.question);
    }
    for (const a of asks) {
      const row = kept.find((r) => r.kind === "agent_ask" && r.id === a.proposalId);
      expect(row?.options).toEqual(options);
      expect(row?.evidence).toEqual(["Adds an Action."]);
    }
  });

  it("shows a Decision id shared by two Projects as two rows", () => {
    const list = buildApprovals({ asks: [], decisions, todo: { items: [], unavailable: [] } });
    expect(list.approvals.map((a) => `${a.project}/${a.id}`).sort()).toEqual(["alpha/0001", "beta/0001"]);
  });

  it("marks matched rows blocking and stale from the to-do list without making them read-only", () => {
    const items = [
      todo("decision", "alpha", "0001", "2026-10-01", { blocking: true, answer: "arcadia decision approve 0001" }),
      todo("agent_ask", "alpha", "p1", "2026-10-03T00:00:00Z", { staleReason: "superseded" })
    ];
    const list = buildApprovals({ asks, decisions, todo: { items, unavailable: [] } });
    const d = list.approvals.find((a) => a.kind === "decision" && a.project === "alpha");
    const a = list.approvals.find((r) => r.id === "p1");
    expect(d).toMatchObject({ blocking: true, readOnly: false, answer: "arcadia decision approve 0001" });
    expect(a).toMatchObject({ staleReason: "superseded", readOnly: false });
    // Blocking first; the stale Ask sorts after the live ones despite being newer than alpha's Decision.
    expect(list.approvals[0]).toBe(d);
    expect(list.approvals[list.approvals.length - 1]).toBe(a);
    expect(list.note).toBeNull();
    expect(list.source).toBe("todo");
  });

  it("does not duplicate a to-do Decision or Ask that the loaders also returned", () => {
    const items = [todo("decision", "alpha", "0001", "2026-10-01"), todo("agent_ask", "beta", "p2", "2026-10-04T00:00:00Z")];
    const list = buildApprovals({ asks, decisions, todo: { items, unavailable: [] } });
    expect(list.approvals).toHaveLength(4);
    expect(todoKeyOf("decision", "alpha", "0001")).toBe(items[0].key);
  });
});

describe("buildApprovals read-only rows", () => {
  it("adds review items read-only with their answer command, and any other kind too", () => {
    const items = [
      todo("review_item", "alpha", "r1", "2026-10-05", { origin: "ActionClarification", answer: "arcadia review approve r1 --answer \"<answer>\" --clarify", answerVia: ["Discord: reply"] }),
      todo("future_kind" as OperatorTodoItem["kind"], "alpha", "f1", "2026-10-06")
    ];
    const list = buildApprovals({ asks: [], decisions: [], todo: { items, unavailable: [] } });
    expect(list.approvals).toHaveLength(2);
    const review = list.approvals.find((a) => a.kind === "review_item");
    expect(review).toMatchObject({
      readOnly: true, id: "r1", project: "alpha", origin: "ActionClarification", answerVia: ["Discord: reply"],
      answer: "arcadia review approve r1 --answer \"<answer>\" --clarify"
    });
    expect(list.approvals.every((a) => a.readOnly && a.options.length === 0)).toBe(true);
  });

  it("shows a to-do Decision the loaders did not return read-only rather than dropping it", () => {
    const list = buildApprovals({ asks: [], decisions: [], todo: { items: [todo("decision", "alpha", "0009", "2026-10-01")], unavailable: [] } });
    expect(list.approvals).toHaveLength(1);
    expect(list.approvals[0]).toMatchObject({ kind: "decision", readOnly: true, answer: "arcadia answer 0009" });
  });

  it("surfaces sources the to-do list could not read", () => {
    const list = buildApprovals({ asks: [], decisions: [], todo: { items: [], unavailable: ["review items: db locked"] } });
    expect(list.note).toContain("review items: db locked");
  });
});

describe("buildApprovals when the to-do call fails", () => {
  it("falls back to the old loaders with a visible note, never a silent empty list", () => {
    const list = buildApprovals({
      asks: [ask("p1", "alpha", "2026-10-03T00:00:00Z")],
      decisions: [decision("0001", "alpha", "2026-10-01")],
      todo: null,
      todoError: "WORKSPACE_NOT_FOUND: nope"
    });
    expect(list.source).toBe("fallback");
    expect(list.note).toContain("WORKSPACE_NOT_FOUND: nope");
    expect(list.note).toContain("Review items are missing");
    expect(list.approvals).toHaveLength(2);
    expect(list.approvals.every((a) => !a.readOnly)).toBe(true);
  });

  it("carries a note even when the fallback list is empty", () => {
    const list = buildApprovals({ asks: [], decisions: [], todo: null, todoError: "boom" });
    expect(list.approvals).toEqual([]);
    expect(list.note).toContain("boom");
  });

  it("keeps the to-do rows, read-only, when a loader failed", () => {
    const items = [todo("decision", "alpha", "0001", "2026-10-01"), todo("agent_ask", "alpha", "p1", "2026-10-03T00:00:00Z")];
    const list = buildApprovals({ asks: [ask("p1", "alpha", "2026-10-03T00:00:00Z")], decisions: null, todo: { items, unavailable: [] }, loadError: "decision list failed" });
    const d = list.approvals.find((a) => a.kind === "decision");
    const a = list.approvals.find((r) => r.kind === "agent_ask");
    expect(d?.readOnly).toBe(true);
    expect(a?.readOnly).toBe(false);
    expect(list.note).toContain("decision list failed");
  });
});

describe("buildApprovals uses the to-do list's gate details where the old loaders lack them", () => {
  const gate = {
    gateQuestion: "resists_reversal",
    options,
    evidence: [{ text: "docs/reports/x.json" }, { text: "Benchmarks done", status: "met", note: "see report" }]
  };

  it("a to-do-only Decision shows its options, gate question and evidence", () => {
    const list = buildApprovals({ asks: [], decisions: [], todo: { items: [todo("decision", "alpha", "0009", "2026-10-01", gate)], unavailable: [] } });
    expect(list.approvals[0]).toMatchObject({
      readOnly: true,
      gateQuestion: "resists_reversal",
      options,
      sourceEvidence: ["docs/reports/x.json", "Benchmarks done [met] — see report"],
      evidence: []
    });
  });

  it("fills only what a matched legacy row lacks and never overrides it", () => {
    const bare = { ...decision("0001", "alpha", "2026-10-01"), gateQuestion: null, options: [] };
    const filled = buildApprovals({ asks: [], decisions: [bare], todo: { items: [todo("decision", "alpha", "0001", "2026-10-01", gate)], unavailable: [] } });
    expect(filled.approvals[0]).toMatchObject({
      readOnly: false, gateQuestion: "resists_reversal", options,
      sourceEvidence: ["docs/reports/x.json", "Benchmarks done [met] — see report"], evidence: []
    });

    const full = buildApprovals({
      asks: [], decisions: [decision("0001", "alpha", "2026-10-01")],
      todo: { items: [todo("decision", "alpha", "0001", "2026-10-01", { ...gate, options: [options[1]] })], unavailable: [] }
    });
    expect(full.approvals[0]).toMatchObject({ gateQuestion: "Gate?", options });
  });

  it("never offers a read-only row a dashboard path it has no control for", () => {
    const item = todo("decision", "alpha", "0009", "2026-10-01", {
      answerVia: ["Dashboard: /runs, To-do section, Approve a Decision option", "Discord: reply to the requires-review notification"]
    });
    const list = buildApprovals({ asks: [], decisions: [], todo: { items: [item], unavailable: [] } });
    expect(list.approvals[0].answerVia).toEqual(["Discord: reply to the requires-review notification"]);
  });
});
