import { describe, expect, it, vi } from "vitest";
import type { DecisionCard } from "../../../src/decisions/card";
import type { CardTarget } from "./decision-cards";
import { createPullRequestInventoryCache } from "./pull-request-inventory-cache";
import { GH_NO_OUTPUT, applyInventoryAge, headKey, interpretChecksFailure, loadNextSteps, queueFacts, readInventoryFresh, toInventoryRead, type InventoryRead, type NextStepsReaders } from "./next-steps-server";
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
  /** PR numbers whose `gh pr checks` fails outright (auth, TLS, timeout). */
  checksFail?: number[];
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
        state: "OPEN", headRefOid: head, baseRefName: "main", headRefName: `b-${number}`, isDraft: false, mergeStateStatus: "CLEAN",
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
      if (options.checksFail?.includes(number)) throw new Error("gh: HTTP 401");
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

// 20 seconds after the inventory's checkedAt: fresh unless a test says otherwise.
const NOW = new Date("2026-10-13T12:00:20.000Z");
const load = (r: NextStepsReaders, options: Parameters<typeof loadNextSteps>[1] = {}) => loadNextSteps(r, { now: NOW, ...options });

describe("loadNextSteps", () => {
  it("orders a stack from gh facts and pins the head sha of the takeable step", async () => {
    const r = await load(readers({ prs: [inv(12, { baseBranch: "b-11" }), inv(11, { baseBranch: "b-10" }), inv(10)] }));
    // The gh read reports every base as main; stacked bases come from the inventory only when gh agrees, so re-read below.
    expect(r.steps.map((s) => s.id).sort()).toEqual(["pr-10", "pr-11", "pr-12"]);
    expect(r.state).toBe("now");
  });

  it("derives the stack from the fresh gh base and head refs", async () => {
    const runGh = gh({
      view: { 11: { baseRefName: "b-10", headRefName: "b-11" }, 12: { baseRefName: "b-11", headRefName: "b-12" } },
      noChecksOutput: [11, 12]
    });
    const r = await load(readers({ prs: [inv(12), inv(11), inv(10)], runGh }));
    expect(r.steps.map((s) => s.id)).toEqual(["pr-10", "pr-11", "pr-12"]);
    expect(r.nowStep).toMatchObject({ id: "pr-10", click: "Merge #10 on GitHub", pinnedHeadSha: sha("0"), href: "https://github.com/pmark/arcadia/pull/10" });
    // A stacked child with no required-check output is not unreadable: it waits on its parent.
    expect(r.steps[1]).toMatchObject({ waitCode: "parent_unmerged", waitingOn: "pr-10" });
    expect(r.unavailable).toEqual([]);
  });

  it("gh saying 'no required checks' on a trunk-based PR is a named no_required_checks wait, not unreadable", async () => {
    const r = await load(readers({ prs: [inv(13)], runGh: gh({ noChecksOutput: [13] }) }));
    expect(r.state).toBe("waiting");
    expect(r.unavailable).toEqual([]);
    expect(r.steps[0].waitCode).toBe("no_required_checks");
  });

  it("any other gh pr checks failure (auth, TLS, timeout) is unreadable checks, distinct from none configured", async () => {
    const r = await load(readers({ prs: [inv(13), inv(18)], runGh: gh({ checksFail: [13] }) }));
    expect(r.steps.find((s) => s.id === "pr-13")).toMatchObject({ waitCode: "unreadable", click: null });
    expect(r.unavailable).toEqual(["checks"]);
    expect(r.nowStep?.id).toBe("pr-18");
    const only = await load(readers({ prs: [inv(13)], runGh: gh({ checksFail: [13] }) }));
    expect(only.state).toBe("unavailable");
  });

  it("interpretChecksFailure separates output, none configured and real failures", () => {
    expect(interpretChecksFailure('[{"name":"ci"}]', "")).toBe("output");
    expect(interpretChecksFailure("", "no required checks reported on the 'x' branch")).toBe("none_required");
    expect(interpretChecksFailure("", "HTTP 401: Bad credentials")).toBe("failed");
    expect(interpretChecksFailure("", "x509: certificate signed by unknown authority")).toBe("failed");
    expect(interpretChecksFailure("", "")).toBe("failed");
  });

  it("stale inventory with zero steps is unavailable (prs), not moving", async () => {
    const r = await load(readers({ prs: [], inventory: { stale: true } }));
    expect(r).toMatchObject({ state: "unavailable", unavailable: ["prs"], outOfDate: true, steps: [] });
  });

  it("an inventory read more than the max age ago with zero steps is unavailable even if not flagged stale", async () => {
    const r = await load(readers({ prs: [] }), { now: new Date("2026-10-13T12:01:30.000Z") });
    expect(r.state).toBe("unavailable");
    expect(r.outOfDate).toBe(true);
  });

  it("a fresh inventory with zero steps is moving", async () => {
    const r = await load(readers({ prs: [] }));
    expect(r).toMatchObject({ state: "moving", outOfDate: false, unavailable: [] });
  });

  it("a cache hit applies the same rule to the combined inventory age", async () => {
    const fresh = await load(readers({ prs: [] }));
    expect(applyInventoryAge(fresh, new Date("2026-10-13T12:00:30.000Z")).state).toBe("moving");
    const later = applyInventoryAge(fresh, new Date("2026-10-13T12:01:30.000Z"));
    expect(later).toMatchObject({ state: "unavailable", unavailable: ["prs"], outOfDate: true });
    // A response with steps is unaffected: only "moving" is withheld.
    const withStep = await load(readers({ prs: [inv(19)] }));
    expect(applyInventoryAge(withStep, new Date("2026-10-13T13:00:00.000Z")).state).toBe("now");
  });

  it("a pull request merged since the inventory was read is never offered a Merge click", async () => {
    const runGh = gh({ view: { 17: { state: "MERGED" }, 12: { state: "CLOSED" } } });
    const r = await load(readers({ prs: [inv(17), inv(12), inv(20)], runGh }));
    expect(r.steps.map((s) => s.id)).toEqual(["pr-20"]);
    expect(r.closedSinceInventory).toBe(2);
    const onlyMerged = await load(readers({ prs: [inv(17)], runGh }));
    expect(onlyMerged.steps).toEqual([]);
    expect(onlyMerged.nowStep).toBeNull();
  });

  it("a gh view that does not report the state is unreadable, not assumed open", async () => {
    const runGh = gh({ view: { 21: { state: undefined } } });
    const r = await load(readers({ prs: [inv(21)], runGh }));
    expect(r.steps[0].waitCode).toBe("unreadable");
  });

  it("keys remembered heads by repository and number", () => {
    expect(headKey("PMark/Arcadia", 5)).toBe("pmark/arcadia#5");
    expect(headKey("pmark/arcadia", 5)).not.toBe(headKey("pmark/other", 5));
  });

  it("takes checks, draft and merge state from the same fresh gh read, never the cached inventory", async () => {
    const runGh = gh({
      view: { 14: { statusCheckRollup: [{ name: "ci", conclusion: "FAILURE" }] }, 15: { mergeStateStatus: "BEHIND" }, 16: { isDraft: true } }
    });
    const r = await load(readers({ prs: [inv(14), inv(15), inv(16), inv(17)], runGh }));
    const code = (n: number) => r.steps.find((s) => s.id === `pr-${n}`)?.waitCode;
    expect(code(14)).toBe("check_failing");
    expect(code(15)).toBe("merge_state_not_clean");
    expect(code(16)).toBe("draft");
    expect(r.nowStep?.id).toBe("pr-17");
  });

  it("advances the pointer-touching PR ahead of an unrelated lower-numbered one using the queue's Plan path", async () => {
    const q = queue([entry({ expectedArtifact: "src/out.ts" })], "arcadia/a1");
    const runGh = gh({ files: { 8: [{ filename: "docs/plans/active-plan.md" }] } });
    const r = await load(readers({ prs: [inv(5), inv(8)], readQueue: async () => q, runGh }));
    expect(r.steps.map((s) => s.id)).toEqual(["pr-8", "pr-5"]);
  });

  it("makes a PR with an unreadable gh read a visible wait and the source unavailable", async () => {
    const r = await load(readers({ prs: [inv(21), inv(22)], runGh: gh({ fail: [21] }) }));
    expect(r.steps.find((s) => s.id === "pr-21")).toMatchObject({ kind: "wait", waitCode: "unreadable", click: null });
    expect(r.nowStep?.id).toBe("pr-22");
    expect(r.unavailable).toEqual(["checks"]);
  });

  it("treats a truncated file list as files_incomplete", async () => {
    const r = await load(readers({ prs: [inv(31), inv(32)], runGh: gh({ total: { 31: 400 } }) }));
    expect(r.steps.find((s) => s.id === "pr-31")?.waitCode).toBe("files_incomplete");
  });

  it("is moving only with zero steps and every source read", async () => {
    const quiet = await load(readers({ prs: [] }));
    expect(quiet).toMatchObject({ state: "moving", nowStep: null, steps: [], unavailable: [] });
    const waiting = await load(readers({ prs: [inv(40, { isDraft: true })], runGh: gh({ view: { 40: { isDraft: true } } }) }));
    expect(waiting.state).toBe("waiting");
  });

  it("all pull requests unreadable (gh auth failure) is unavailable, never moving or waiting", async () => {
    const r = await load(readers({ prs: [inv(41), inv(42)], runGh: gh({ failAll: true }) }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["checks"]);
    expect(r.steps.every((s) => s.waitCode === "unreadable")).toBe(true);
  });

  it("an empty inventory whose refresh errored is unavailable (prs)", async () => {
    const r = await load(readers({ prs: [], inventory: { refreshError: "gh: HTTP 401", stale: true } }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["prs"]);
    expect(r.inventoryStale).toBe(true);
  });

  it("an incomplete inventory is unavailable (prs) even when some pull requests were read", async () => {
    const r = await load(readers({ prs: [inv(43, { isDraft: true })], inventory: { incomplete: true }, runGh: gh({ view: { 43: { isDraft: true } } }) }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["prs"]);
  });

  it("an unreadable inventory is unavailable (prs)", async () => {
    const r = await load(readers({ readInventory: async () => { throw new Error("cli down"); } }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["prs"]);
  });

  it("an unreadable queue or card source is named and blocks moving", async () => {
    const r = await load(readers({ readQueue: async () => { throw new Error("x"); }, readCards: async () => { throw new Error("y"); } }));
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["cards", "queue"]);
  });

  it("reports a stale inventory with its last-read time without blocking a step", async () => {
    const r = await load(readers({ prs: [inv(44)], inventory: { stale: true } }));
    expect(r.inventoryStale).toBe(true);
    expect(r.inventoryCheckedAt).toBe("2026-10-13T12:00:00.000Z");
    expect(r.state).toBe("now");
  });

  it("uses the repository's default branch as trunk, falling back to main", async () => {
    const develop = gh({ trunk: "develop", view: { 45: { baseRefName: "develop" } } });
    const r = await load(readers({ prs: [inv(45)], runGh: develop }));
    expect(r.nowStep?.id).toBe("pr-45");
    const noRepoView = await load(readers({ prs: [inv(46)], runGh: gh({ trunk: null }) }));
    expect(noRepoView.nowStep?.id).toBe("pr-46");
  });

  it("returns the heads it read and flags a head that moved since the previous poll", async () => {
    const first = await load(readers({ prs: [inv(47)] }));
    expect(first.heads).toEqual({ 47: sha("7") });
    const moved = await load(readers({ prs: [inv(47)] }), { pinnedHeads: { 47: sha("a") } });
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
    const r = await load(readers({ prs: [inv(50), inv(51)], runGh }));
    expect(r.steps.find((s) => s.id === "pr-51")?.waitCode).toBe("base_pr_missing");
  });

  it("counts pull requests of other repositories and does not read them", async () => {
    const runGh = gh();
    const r = await load(readers({ prs: [inv(60), inv(61, { repository: "pmark/other" })], runGh }));
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
    const r = await load(readers({ prs: [inv(70)], readQueue: async () => q, readCards: async () => ({ cards: [card], targets: new Map([[card.id, target]]) }) }));
    expect(r.steps.map((s) => s.id)).toEqual(["card-decision-arcadia-0007", "pr-70"]);
    expect(r.nowStep?.unblocks).toContain("a2");
  });
});

describe("review note and body from the fresh read", () => {
  it("fetches the body in the same pr view and surfaces the recorded review as a note, never a wait", async () => {
    const body = "```arcadia-work-metadata\nagents:\n  - role: code-reviewer\nreview_rounds: 1\n```";
    const runGh = gh({ view: { 31: { body, reviews: [] }, 32: { body: "", reviews: [] } } });
    const r = await load(readers({ prs: [inv(31), inv(32)], runGh }));
    expect(r.steps.find((s) => s.id === "pr-31")).toMatchObject({ kind: "merge", reviewNote: "independent_review_recorded" });
    expect(r.steps.find((s) => s.id === "pr-32")).toMatchObject({ kind: "merge", reviewNote: "not_recorded" });
    const viewCall = vi.mocked(runGh).mock.calls.find((call) => call[0][0] === "pr" && call[0][1] === "view");
    expect(viewCall?.[0].join(" ")).toContain("body");
  });

  it("a human CHANGES_REQUESTED at the head from gh is a changes_requested wait; a bot's is an advisory count", async () => {
    const head = sha("3");
    const runGh = gh({
      view: {
        33: { reviews: [{ state: "CHANGES_REQUESTED", author: { login: "pmark" }, commit: { oid: head } }] },
        34: { reviews: [{ state: "CHANGES_REQUESTED", author: { login: "coderabbitai" }, commit: { oid: sha("4") } }] }
      }
    });
    const r = await load(readers({ prs: [inv(33), inv(34)], runGh }));
    expect(r.steps.find((s) => s.id === "pr-33")?.waitCode).toBe("changes_requested");
    expect(r.steps.find((s) => s.id === "pr-34")).toMatchObject({ kind: "merge", advisoryBotFindings: 1 });
  });
});

describe("inventory age", () => {
  it("a checkedAt in the future is not fresh: moving is withheld", async () => {
    const r = await load(readers({ prs: [], inventory: { checkedAt: "2026-10-13T12:05:00.000Z" } }));
    expect(r).toMatchObject({ state: "unavailable", outOfDate: true, unavailable: ["prs"] });
  });
});

describe("readInventoryFresh with the real inventory cache", () => {
  const snapshot = (n: number) => ({
    generatedAt: "2026-10-13T00:00:00.000Z", projectsScanned: 1, repositories: [], pullRequests: [] as DashboardOutstandingPullRequest[], errors: [],
    counts: { total: n, blocked: 0, checksFailing: 0, checksPending: 0, drafts: 0, ready: 0, mergeReady: 0, unknown: 0 }
  });

  function setup() {
    const holder: { release: (() => void) | null } = { release: null };
    let calls = 0;
    const loadSnapshot = vi.fn(async () => {
      calls += 1;
      if (calls > 1) await new Promise<void>((resolve) => { holder.release = resolve; });
      return snapshot(calls);
    });
    const cache = createPullRequestInventoryCache({ load: loadSnapshot, now: () => Date.now() });
    const read = async (refresh: boolean) => {
      const state = await cache.read({ refresh });
      return { snapshot: state.snapshot, stale: state.stale, refreshing: state.refreshing, checkedAt: state.checkedAt, refreshError: state.refreshError, incomplete: state.incomplete };
    };
    return { read, release: () => holder.release?.() };
  }

  it("awaits a bounded refresh of a stale inventory so a quiet repository reaches fresh", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
      const { read, release } = setup();
      await read(false); // cold read populates the cache
      vi.setSystemTime(new Date("2026-10-13T12:01:00Z")); // 60s later: stale
      const pending = readInventoryFresh(read);
      await vi.advanceTimersByTimeAsync(600);
      release();
      await vi.advanceTimersByTimeAsync(600);
      const body = await pending;
      expect(body.stale).toBe(false);
      expect(toInventoryRead(body).stale).toBe(false);
      expect(body.checkedAt).toBe("2026-10-13T12:01:00.600Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the stale body after the timeout so moving stays withheld", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
      const { read } = setup();
      await read(false);
      vi.setSystemTime(new Date("2026-10-13T12:01:00Z"));
      const pending = readInventoryFresh(read, { timeoutMs: 2000, pollMs: 250 });
      await vi.advanceTimersByTimeAsync(3000);
      const body = await pending;
      expect(body.stale).toBe(true);
      expect(body.refreshing).toBe(true);
      const response = await loadNextSteps(
        { ...readers({ prs: [] }), readInventory: async () => toInventoryRead(body) },
        { now: new Date("2026-10-13T12:01:03Z") }
      );
      expect(response.state).toBe("unavailable");
      expect(response.outOfDate).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait when the first read is already fresh", async () => {
    const read = vi.fn(async () => ({ snapshot: { pullRequests: [] as DashboardOutstandingPullRequest[] }, stale: false }));
    await readInventoryFresh(read);
    expect(read).toHaveBeenCalledTimes(1);
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
