import { describe, expect, it } from "vitest";
import type { Approval } from "./approvals";
import { buildFeed, feedSections } from "./moonlet-feed";
import type { NextStepsResponse } from "./next-steps-server";
import type { DashboardOutstandingPullRequest, DashboardOutstandingPullRequests } from "./types";

const approval = (over: Partial<Approval>): Approval => ({
  kind: "agent_ask", id: "a1", project: "arcadia", title: "Ask", detail: null, gateQuestion: null, createdAt: "2030-01-01T00:00:00Z",
  blocking: false, staleReason: null, todoKey: `${over.kind ?? "agent_ask"}:arcadia/${over.id ?? "a1"}`, href: `/todo/${over.kind ?? "agent_ask"}/arcadia/${over.id ?? "a1"}`, ...over
} as Approval);
const step = (id: string, title: string) => ({ id, order: 0, kind: "merge", title, click: "Merge", href: `https://github.com/pmark/arcadia/pull/${id}`, unblocks: "Unblocks the next Action", waitingFor: null }) as NextStepsResponse["steps"][number];
const pr = (number: number, updatedAt: string, readiness: DashboardOutstandingPullRequest["readiness"] = "ready") =>
  ({ repository: "pmark/arcadia", number, title: `PR ${number}`, url: `https://github.com/pmark/arcadia/pull/${number}`, updatedAt, readiness, readinessLabel: readiness, summary: "" }) as DashboardOutstandingPullRequest;

describe("moonlet feed", () => {
  it("orders your move, then waiting items with blocking Decisions first, then PRs newest first", () => {
    const now = step("1", "Merge #1");
    const items = buildFeed({
      nextSteps: { nowStep: now, steps: [now, step("2", "Merge #2")] } as NextStepsResponse,
      approvals: [
        approval({ id: "old", createdAt: "2030-01-01T00:00:00Z" }),
        approval({ kind: "decision", id: "0141", title: "Pick a layout", blocking: true, gateQuestion: "Which layout?" }),
        approval({ id: "gone", staleReason: "answered" })
      ],
      pullRequests: { pullRequests: [pr(5, "2030-01-01T00:00:00Z"), pr(6, "2030-01-02T00:00:00Z", "checks_failing")] } as DashboardOutstandingPullRequests
    });
    expect(items.map(i => i.key)).toEqual(["action:1", "action:2", "decision:decision:arcadia/0141", "agent_ask:agent_ask:arcadia/old", "pr:pmark/arcadia#6", "pr:pmark/arcadia#5"]);
    expect(items[0]).toMatchObject({ chip: "now", urgent: true, external: true });
    expect(items[2]).toMatchObject({ chip: "Decision · blocking", detail: "Which layout?", href: "/todo/decision/arcadia/0141" });
    expect(items[4].urgent).toBe(true);
    expect(feedSections(items).map(s => [s.section, s.items.length])).toEqual([["Your move", 2], ["Waiting on you", 2], ["Pull requests", 2]]);
  });

  it("is empty, not failing, while every source is still unread", () => {
    expect(buildFeed({ approvals: null, nextSteps: null, pullRequests: null })).toEqual([]);
  });
});
