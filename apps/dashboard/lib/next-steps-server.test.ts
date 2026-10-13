import { describe, expect, it, vi } from "vitest";
import type { DecisionCard } from "../../../src/decisions/card";
import type { CardTarget } from "./decision-cards";
import { loadNextSteps, queueFacts, type NextStepsReaders } from "./next-steps-server";
import type { DashboardOutstandingPullRequest } from "./types";
import type { WorkQueue, WorkQueueEntry } from "./work-queue-types";

const sha = (c: string) => c.repeat(40);

function inv(number: number, over: Partial<DashboardOutstandingPullRequest> = {}): DashboardOutstandingPullRequest {
  return {
    projectId: "p", projectName: "Arcadia", repositoryPath: "/x", repository: "pmark/arcadia", number, title: `PR ${number}`,
    url: `https://github.com/pmark/arcadia/pull/${number}`, state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN",
    headBranch: `b-${number}`, baseBranch: "main", author: "author", reviewDecision: "APPROVED", createdAt: null, updatedAt: null,
    checks: [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS", url: null }], readiness: "merge_ready", readinessLabel: "MERGE-READY",
    summary: "", briefing: null, ...over
  };
}

function entry(over: Partial<WorkQueueEntry>): WorkQueueEntry {
  return {
    id: "arcadia/a1", state: "ready", attentionKind: null, selected: false, projectId: "p", projectName: "Arcadia", projectSlug: "arcadia",
    planSlug: "plan", planPath: "/Users/x/arcadia/docs/plans/active-plan.md", actionId: "a1", actionTitle: "A1", responsibility: "agent",
    expectedArtifact: null, tokenImpact: null, tokenBudget: null, status: "ready", reason: "", nextAction: "", blockers: [], runId: null,
    decisionId: null, updatedAt: "", ...over
  };
}

function queue(entries: WorkQueueEntry[], nextActionKey: string | null): WorkQueue {
  return { generatedAt: "", revision: 1, ordered: entries, nextActionKey, unpositionedCount: 0, orderValid: true, undoReceipt: null, counts: { ready: 0, running: 0, flagged: 0, attention: 0 } };
}

/** gh stub: head sha by PR number (a-digit), one file per PR unless overridden. */
function gh(options: { fail?: number[]; files?: Record<number, Array<{ filename: string; previous_filename?: string | null }>>; total?: Record<number, number> } = {}): NextStepsReaders["runGh"] {
  return vi.fn(async (args: string[]) => {
    const number = Number(args.find((a) => /^\d+$/.test(a)) ?? /pulls\/(\d+)/.exec(args.join(" "))?.[1]);
    if (options.fail?.includes(number)) throw new Error("boom");
    if (args[0] === "pr" && args[1] === "view") {
      return JSON.stringify({ headRefOid: sha(String(number % 10)), reviews: [{ state: "APPROVED", author: { login: "rev" }, commit: { oid: sha(String(number % 10)) } }] });
    }
    if (args[0] === "api" && args[1] === "--paginate") {
      return JSON.stringify([options.files?.[number] ?? [{ filename: `src/f${number}.ts`, previous_filename: null }]]);
    }
    if (args[0] === "api") return JSON.stringify({ changed_files: options.total?.[number] ?? (options.files?.[number]?.length ?? 1) });
    if (args[0] === "pr" && args[1] === "checks") return JSON.stringify([{ name: "ci" }]);
    throw new Error(`unexpected gh ${args.join(" ")}`);
  });
}

function readers(over: Partial<NextStepsReaders> & { prs?: DashboardOutstandingPullRequest[] } = {}): NextStepsReaders {
  return {
    readInventory: async () => ({ pullRequests: over.prs ?? [], stale: false }),
    readQueue: async () => queue([], null),
    readCards: async () => ({ cards: [], targets: new Map() }),
    runGh: gh(),
    ...over
  };
}

describe("loadNextSteps", () => {
  it("orders a stack from gh facts and pins the head sha of the takeable step", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(12, { baseBranch: "b-11" }), inv(11, { baseBranch: "b-10" }), inv(10)] }));
    expect(r.steps.map((s) => s.id)).toEqual(["pr-10", "pr-11", "pr-12"]);
    expect(r.nowStep).toMatchObject({ id: "pr-10", click: "Merge #10 on GitHub", pinnedHeadSha: sha("0"), href: "https://github.com/pmark/arcadia/pull/10" });
    expect(r.unavailable).toEqual([]);
  });

  it("advances the pointer-touching PR ahead of an unrelated lower-numbered one using the queue's Plan path", async () => {
    const q = queue([entry({ expectedArtifact: "src/out.ts" })], "arcadia/a1");
    const runGh = gh({ files: { 8: [{ filename: "docs/plans/active-plan.md" }] } });
    const r = await loadNextSteps(readers({ prs: [inv(5), inv(8)], readQueue: async () => q, runGh }));
    expect(r.steps.map((s) => s.id)).toEqual(["pr-8", "pr-5"]);
  });

  it("makes a PR with a stale or unreadable gh read a visible wait, never a button", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(21), inv(22)], runGh: gh({ fail: [21] }) }));
    expect(r.steps.find((s) => s.id === "pr-21")).toMatchObject({ kind: "wait", waitCode: "unreadable", click: null });
    expect(r.nowStep?.id).toBe("pr-22");
  });

  it("treats a truncated file list as files_incomplete", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(31)], runGh: gh({ total: { 31: 400 } }) }));
    expect(r.steps).toEqual([]);
    const withOther = await loadNextSteps(readers({ prs: [inv(31), inv(32)], runGh: gh({ total: { 31: 400 } }) }));
    expect(withOther.steps.find((s) => s.id === "pr-31")?.waitCode).toBe("files_incomplete");
  });

  it("says production is moving only when every source was read", async () => {
    const quiet = await loadNextSteps(readers({ prs: [inv(40, { isDraft: true })] }));
    expect(quiet).toMatchObject({ moving: true, nowStep: null, steps: [], unavailable: [] });
    const blind = await loadNextSteps(readers({ readInventory: async () => { throw new Error("gh down"); } }));
    expect(blind.moving).toBe(false);
    expect(blind.unavailable).toEqual(["pull_requests"]);
  });

  it("counts pull requests of other repositories and does not read them", async () => {
    const runGh = gh();
    const r = await loadNextSteps(readers({ prs: [inv(50), inv(51, { repository: "pmark/other" })], runGh }));
    expect(r.otherRepositories).toBe(1);
    expect(r.steps.map((s) => s.id)).toEqual(["pr-50"]);
    expect(vi.mocked(runGh).mock.calls.some((call) => call[0].includes("51"))).toBe(false);
  });

  it("puts a Decision card that blocks the current Action ahead of an unrelated merge", async () => {
    const card: DecisionCard = {
      schema: "arcadia-decision-card-v1", id: "decision-arcadia-0007", kind: "decision", what: "Pick the model", verb: "answer",
      options: [{ id: "go", label: "Go", consequence: "Ships." }], evidence: [], pins: { stateHash: "a".repeat(64) }, expires: "2026-10-14T00:00:00Z", policy_match: null, receipt: null
    };
    const target: CardTarget = { kind: "decision", projectSlug: "arcadia", decisionId: "0007", labels: ["Go"], status: "open", updated: "x", optionsDigest: "d" };
    const q = queue([entry({}), entry({ id: "arcadia/a2", actionId: "a2", decisionId: "0007" })], "arcadia/a1");
    // The decision blocks queued a2, not current a1: rank 1, still ahead of an unrelated merge.
    const r = await loadNextSteps(readers({ prs: [inv(60)], readQueue: async () => q, readCards: async () => ({ cards: [card], targets: new Map([[card.id, target]]) }) }));
    expect(r.steps.map((s) => s.id)).toEqual(["card-decision-arcadia-0007", "pr-60"]);
    expect(r.nowStep?.unblocks).toContain("a2");
  });
});

describe("queueFacts", () => {
  it("resolves the current Action by the queue's next key and reduces the Plan path to its repository form", () => {
    const { facts } = queueFacts(queue([entry({}), entry({ id: "arcadia/a2", actionId: "a2", expectedArtifact: "src/x.ts", dependencies: ["src/y.ts"] })], "arcadia/a1"));
    expect(facts.currentActionId).toBe("a1");
    expect(facts.planPath).toBe("docs/plans/active-plan.md");
    expect(facts.queued).toEqual([{ actionId: "a2", expectedArtifact: "src/x.ts", dependencies: ["src/y.ts"] }]);
  });
});
