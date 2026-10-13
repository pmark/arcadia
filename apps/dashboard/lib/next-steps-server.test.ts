import { describe, expect, it, vi } from "vitest";
import type { DecisionCard } from "../../../src/decisions/card";
import type { CardTarget } from "./decision-cards";
import { GH_NO_OUTPUT, loadNextSteps, queueFacts, type InventoryRead, type NextStepsReaders } from "./next-steps-server";
import type { DashboardOutstandingPullRequest } from "./types";
import type { WorkQueue, WorkQueueEntry } from "./work-queue-types";

const sha = (c: string) => c.repeat(40);

function inv(number: number, over: Partial<DashboardOutstandingPullRequest> = {}): DashboardOutstandingPullRequest {
  return {
    projectId: "p", projectName: "Arcadia", repositoryPath: "/x", repository: "pmark/arcadia", number, title: `PR ${number}`,
    url: `https://github.com/pmark/arcadia/pull/${number}`, state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN",
    headBranch: `b-${number}`, baseBranch: "main", author: "author", reviewDecision: "APPROVED", createdAt: null, updatedAt: null,
    // The cached inventory is deliberately all green: only the fresh gh read may decide readiness.
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

interface GhOptions {
  fail?: number[];
  failAll?: boolean;
  trunk?: string | null;
  files?: Record<number, Array<{ filename: string; previous_filename?: string | null }>>;
  total?: Record<number, number>;
  view?: Record<number, Record<string, unknown>>;
  /** PR numbers whose `gh pr checks --required` prints nothing. */
  noChecksOutput?: number[];
  required?: Record<number, string[]>;
}

/** gh stub: head sha by PR number (digit), one file and one approving review per PR unless overridden. */
function gh(options: GhOptions = {}): NextStepsReaders["runGh"] {
  return vi.fn(async (args: string[]) => {
    if (options.failAll) throw new Error("gh auth failure");
    if (args[0] === "repo" && args[1] === "view") {
      if (options.trunk === null) throw new Error("no repo view");
      return JSON.stringify({ defaultBranchRef: { name: options.trunk ?? "main" } });
    }
    const joined = args.join(" ");
    const number = Number(/(?:pr (?:view|checks) |pulls\/)(\d+)/.exec(joined)?.[1]);
    if (options.fail?.includes(number)) throw new Error("boom");
    if (args[0] === "pr" && args[1] === "view") {
      const head = sha(String(number % 10));
      return JSON.stringify({
        headRefOid: head, baseRefName: "main", headRefName: `b-${number}`, isDraft: false, mergeStateStatus: "CLEAN",
        headRepository: { name: "arcadia" }, headRepositoryOwner: { login: "pmark" },
        reviews: [{ state: "APPROVED", author: { login: "rev" }, commit: { oid: head } }],
        statusCheckRollup: [{ name: "ci", conclusion: "SUCCESS" }],
        ...options.view?.[number]
      });
    }
    if (args[0] === "api" && args[1] === "--paginate") {
      return JSON.stringify([options.files?.[number] ?? [{ filename: `src/f${number}.ts`, previous_filename: null }]]);
    }
    if (args[0] === "api") return JSON.stringify({ changed_files: options.total?.[number] ?? (options.files?.[number]?.length ?? 1) });
    if (args[0] === "pr" && args[1] === "checks") {
      if (options.noChecksOutput?.includes(number)) return GH_NO_OUTPUT;
      return JSON.stringify((options.required?.[number] ?? ["ci"]).map((name) => ({ name })));
    }
    throw new Error(`unexpected gh ${joined}`);
  });
}

const okInventory = (prs: DashboardOutstandingPullRequest[], over: Partial<InventoryRead> = {}): InventoryRead => ({
  pullRequests: prs, stale: false, checkedAt: "2026-10-13T12:00:00.000Z", refreshError: null, incomplete: false, ...over
});

function readers(over: Partial<NextStepsReaders> & { prs?: DashboardOutstandingPullRequest[]; inventory?: Partial<InventoryRead> } = {}): NextStepsReaders {
  const { prs, inventory, ...rest } = over;
  return {
    readInventory: async () => okInventory(prs ?? [], inventory),
    readQueue: async () => queue([], null),
    readCards: async () => ({ cards: [], targets: new Map() }),
    runGh: gh(),
    ...rest
  };
}

describe("loadNextSteps", () => {
  it("orders a stack from gh facts and pins the head sha of the takeable step", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(12, { baseBranch: "b-11" }), inv(11, { baseBranch: "b-10" }), inv(10)] }));
    // The gh read reports every base as main; stacked bases come from the inventory only when gh agrees, so re-read below.
    expect(r.steps.map((s) => s.id).sort()).toEqual(["pr-10", "pr-11", "pr-12"]);
    expect(r.state).toBe("now");
  });

  it("derives the stack from the fresh gh base and head refs", async () => {
    const runGh = gh({
      view: { 11: { baseRefName: "b-10", headRefName: "b-11" }, 12: { baseRefName: "b-11", headRefName: "b-12" } },
      noChecksOutput: [11, 12]
    });
    const r = await loadNextSteps(readers({ prs: [inv(12), inv(11), inv(10)], runGh }));
    expect(r.steps.map((s) => s.id)).toEqual(["pr-10", "pr-11", "pr-12"]);
    expect(r.nowStep).toMatchObject({ id: "pr-10", click: "Merge #10 on GitHub", pinnedHeadSha: sha("0"), href: "https://github.com/pmark/arcadia/pull/10" });
    // A stacked child with no required-check output is not unreadable: it waits on its parent.
    expect(r.steps[1]).toMatchObject({ waitCode: "parent_unmerged", waitingOn: "pr-10" });
    expect(r.unavailable).toEqual([]);
  });

  it("a no-output required-check read on a trunk-based PR is unreadable, not 'no required checks'", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(13)], runGh: gh({ noChecksOutput: [13] }) }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["checks"]);
    expect(r.steps[0].waitCode).toBe("unreadable");
  });

  it("takes checks, draft and merge state from the same fresh gh read, never the cached inventory", async () => {
    const runGh = gh({
      view: { 14: { statusCheckRollup: [{ name: "ci", conclusion: "FAILURE" }] }, 15: { mergeStateStatus: "BEHIND" }, 16: { isDraft: true } }
    });
    const r = await loadNextSteps(readers({ prs: [inv(14), inv(15), inv(16), inv(17)], runGh }));
    const code = (n: number) => r.steps.find((s) => s.id === `pr-${n}`)?.waitCode;
    expect(code(14)).toBe("check_failing");
    expect(code(15)).toBe("merge_state_not_clean");
    expect(code(16)).toBe("draft");
    expect(r.nowStep?.id).toBe("pr-17");
  });

  it("advances the pointer-touching PR ahead of an unrelated lower-numbered one using the queue's Plan path", async () => {
    const q = queue([entry({ expectedArtifact: "src/out.ts" })], "arcadia/a1");
    const runGh = gh({ files: { 8: [{ filename: "docs/plans/active-plan.md" }] } });
    const r = await loadNextSteps(readers({ prs: [inv(5), inv(8)], readQueue: async () => q, runGh }));
    expect(r.steps.map((s) => s.id)).toEqual(["pr-8", "pr-5"]);
  });

  it("makes a PR with an unreadable gh read a visible wait and the source unavailable", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(21), inv(22)], runGh: gh({ fail: [21] }) }));
    expect(r.steps.find((s) => s.id === "pr-21")).toMatchObject({ kind: "wait", waitCode: "unreadable", click: null });
    expect(r.nowStep?.id).toBe("pr-22");
    expect(r.unavailable).toEqual(["checks"]);
  });

  it("treats a truncated file list as files_incomplete", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(31), inv(32)], runGh: gh({ total: { 31: 400 } }) }));
    expect(r.steps.find((s) => s.id === "pr-31")?.waitCode).toBe("files_incomplete");
  });

  it("is moving only with zero steps and every source read", async () => {
    const quiet = await loadNextSteps(readers({ prs: [] }));
    expect(quiet).toMatchObject({ state: "moving", nowStep: null, steps: [], unavailable: [] });
    const waiting = await loadNextSteps(readers({ prs: [inv(40, { isDraft: true })], runGh: gh({ view: { 40: { isDraft: true } } }) }));
    expect(waiting.state).toBe("waiting");
  });

  it("all pull requests unreadable (gh auth failure) is unavailable, never moving or waiting", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(41), inv(42)], runGh: gh({ failAll: true }) }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["checks"]);
    expect(r.steps.every((s) => s.waitCode === "unreadable")).toBe(true);
  });

  it("an empty inventory whose refresh errored is unavailable (prs)", async () => {
    const r = await loadNextSteps(readers({ prs: [], inventory: { refreshError: "gh: HTTP 401", stale: true } }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["prs"]);
    expect(r.inventoryStale).toBe(true);
  });

  it("an incomplete inventory is unavailable (prs) even when some pull requests were read", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(43, { isDraft: true })], inventory: { incomplete: true }, runGh: gh({ view: { 43: { isDraft: true } } }) }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["prs"]);
  });

  it("an unreadable inventory is unavailable (prs)", async () => {
    const r = await loadNextSteps(readers({ readInventory: async () => { throw new Error("cli down"); } }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["prs"]);
  });

  it("an unreadable queue or card source is named and blocks moving", async () => {
    const r = await loadNextSteps(readers({ readQueue: async () => { throw new Error("x"); }, readCards: async () => { throw new Error("y"); } }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["cards", "queue"]);
  });

  it("reports a stale inventory with its last-read time without blocking a step", async () => {
    const r = await loadNextSteps(readers({ prs: [inv(44)], inventory: { stale: true } }));
    expect(r.inventoryStale).toBe(true);
    expect(r.inventoryCheckedAt).toBe("2026-10-13T12:00:00.000Z");
    expect(r.state).toBe("now");
  });

  it("uses the repository's default branch as trunk, falling back to main", async () => {
    const develop = gh({ trunk: "develop", view: { 45: { baseRefName: "develop" } } });
    const r = await loadNextSteps(readers({ prs: [inv(45)], runGh: develop }));
    expect(r.nowStep?.id).toBe("pr-45");
    const noRepoView = await loadNextSteps(readers({ prs: [inv(46)], runGh: gh({ trunk: null }) }));
    expect(noRepoView.nowStep?.id).toBe("pr-46");
  });

  it("returns the heads it read and flags a head that moved since the previous poll", async () => {
    const first = await loadNextSteps(readers({ prs: [inv(47)] }));
    expect(first.heads).toEqual({ 47: sha("7") });
    const moved = await loadNextSteps(readers({ prs: [inv(47)] }), { pinnedHeads: { 47: sha("a") } });
    expect(moved.steps[0].waitCode).toBe("head_moved");
  });

  it("matches stack parents on head repository + ref, so a fork branch is never a parent", async () => {
    const runGh = gh({
      view: {
        50: { headRefName: "feature", headRepository: { name: "arcadia" }, headRepositoryOwner: { login: "stranger" } },
        51: { baseRefName: "feature", headRefName: "b-51" }
      },
      noChecksOutput: [51]
    });
    const r = await loadNextSteps(readers({ prs: [inv(50), inv(51)], runGh }));
    expect(r.steps.find((s) => s.id === "pr-51")?.waitCode).toBe("base_pr_missing");
  });

  it("counts pull requests of other repositories and does not read them", async () => {
    const runGh = gh();
    const r = await loadNextSteps(readers({ prs: [inv(60), inv(61, { repository: "pmark/other" })], runGh }));
    expect(r.otherRepositories).toBe(1);
    expect(r.steps.map((s) => s.id)).toEqual(["pr-60"]);
    expect(vi.mocked(runGh).mock.calls.some((call) => call.join(" ").includes(" 61 "))).toBe(false);
  });

  it("puts a Decision card that blocks a queued Action ahead of an unrelated merge", async () => {
    const card: DecisionCard = {
      schema: "arcadia-decision-card-v1", id: "decision-arcadia-0007", kind: "decision", what: "Pick the model", verb: "answer",
      options: [{ id: "go", label: "Go", consequence: "Ships." }], evidence: [], pins: { stateHash: "a".repeat(64) }, expires: "2026-10-14T00:00:00Z", policy_match: null, receipt: null
    };
    const target: CardTarget = { kind: "decision", projectSlug: "arcadia", decisionId: "0007", labels: ["Go"], status: "open", updated: "x", optionsDigest: "d" };
    const q = queue([entry({}), entry({ id: "arcadia/a2", actionId: "a2", decisionId: "0007" })], "arcadia/a1");
    const r = await loadNextSteps(readers({ prs: [inv(70)], readQueue: async () => q, readCards: async () => ({ cards: [card], targets: new Map([[card.id, target]]) }) }));
    expect(r.steps.map((s) => s.id)).toEqual(["card-decision-arcadia-0007", "pr-70"]);
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
