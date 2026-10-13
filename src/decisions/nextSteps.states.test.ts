import { describe, expect, it } from "vitest";
import { buildNextSteps, type NextStepsInput, type NextStepsPr, type NextStepsQueue } from "./nextSteps.js";

const sha = (c: string) => c.repeat(40);

function pr(number: number, over: Partial<NextStepsPr> = {}): NextStepsPr {
  const head = sha(String(number % 10));
  return {
    number,
    title: `PR ${number}`,
    headSha: head,
    baseRef: "main",
    headRef: `branch-${number}`,
    isDraft: false,
    files: [`src/feature${number}.ts`],
    changedFiles: 1,
    reviews: [{ verdict: "APPROVED", headSha: head, author: "reviewer" }],
    checks: [{ name: "ci", conclusion: "SUCCESS" }],
    requiredChecks: ["ci"],
    author: "author",
    mergeStateStatus: "CLEAN",
    ...over,
  };
}

const QUEUE: NextStepsQueue = {
  currentActionId: "todo-next-steps",
  currentExpectedArtifact: "apps/dashboard/components/next-steps.tsx",
  planPath: "docs/plans/active-plan.md",
  queued: [{ actionId: "later-action", expectedArtifact: "src/later/feature.ts", dependencies: ["src/needed/dep.ts"] }],
};

const run = (input: NextStepsInput) => buildNextSteps(input);
const ids = (r: ReturnType<typeof buildNextSteps>) => r.steps.map((s) => s.id);

describe("result states", () => {
  it("waiting: a required-check failure and a draft are both listed, never moving", () => {
    const r = run({ prs: [pr(1, { checks: [{ name: "ci", conclusion: "FAILURE" }] }), pr(2, { isDraft: true })] });
    expect(r.state).toBe("waiting");
    expect(r.nowStep).toBeNull();
    expect(ids(r)).toEqual(["pr-1", "pr-2"]);
    expect(r.waitingSummary).toContain("Nothing for you to click; waiting on required check ci");
    expect(r.steps.every((s) => s.click === null && s.href === null)).toBe(true);
  });

  it("waiting: a child whose parent merged but still names the parent's branch is base_pr_missing, not moving", () => {
    const r = run({ prs: [pr(10, { baseRef: "feature-parent-already-merged" })] });
    expect(r.state).toBe("waiting");
    expect(r.steps[0].waitCode).toBe("base_pr_missing");
  });

  it("a COMMENTED review beside an APPROVED one at the same head is a shown wait naming the review states", () => {
    const head = sha("3");
    const r = run({
      prs: [pr(3, { reviews: [{ verdict: "APPROVED", headSha: head, author: "rev1" }, { verdict: "COMMENTED", headSha: head, author: "rev2" }] })],
    });
    expect(r.state).toBe("waiting");
    expect(r.steps[0]).toMatchObject({ waitCode: "review_not_approved", click: null });
    expect(r.steps[0].reason).toContain("APPROVED by rev1");
    expect(r.steps[0].reason).toContain("COMMENTED by rev2");
  });

  it("unavailable: a named unread source with no takeable step is never moving or waiting", () => {
    const r = run({ prs: [], unavailable: ["prs"] });
    expect(r).toMatchObject({ state: "unavailable", unavailable: ["prs"], steps: [] });
    const unread = run({ prs: [pr(5, { unreadable: "gh read failed" })] });
    expect(unread.state).toBe("unavailable");
    expect(unread.unavailable).toEqual(["checks"]);
    expect(unread.steps[0].waitCode).toBe("unreadable");
  });

  it("now outranks unavailable: a takeable step is still offered, with the missing source named", () => {
    const r = run({ prs: [pr(6)], unavailable: ["queue"] });
    expect(r.state).toBe("now");
    expect(r.unavailable).toEqual(["queue"]);
  });
});

describe("priority inheritance", () => {
  it("orders a parent that unlocks a pointer-advancing child before unrelated pull requests and says why", () => {
    const parent = pr(10);
    const child = pr(20, { baseRef: "branch-10", files: ["PROJECT.md"] });
    const unrelated = pr(30, { files: ["src/needed/dep.ts"] });
    const r = run({ prs: [unrelated, child, parent], queue: QUEUE });
    expect(ids(r)).toEqual(["pr-10", "pr-20", "pr-30"]);
    expect(r.state).toBe("now");
    expect(r.nowStep?.id).toBe("pr-10");
    expect(r.nowStep?.unblocks).toBe("Merging #10 unlocks #20, which advances the active-Plan pointer.");
    expect(r.steps[1]).toMatchObject({ kind: "wait", waitingOn: "pr-10" });
  });

  it("inherits through a deeper chain", () => {
    const a = pr(10);
    const b = pr(11, { baseRef: "branch-10" });
    const c = pr(12, { baseRef: "branch-11", files: ["PROJECT.md"] });
    const r = run({ prs: [pr(5, { files: ["src/needed/dep.ts"] }), c, b, a], queue: QUEUE });
    expect(ids(r)).toEqual(["pr-10", "pr-11", "pr-12", "pr-5"]);
    expect(r.nowStep?.unblocks).toContain("unlocks #12");
  });
});

describe("higher-priority waiting is said next to the now step", () => {
  it("names a pointer-advancing pull request that is waiting on a check", () => {
    const waitingPointer = pr(1, { files: ["PROJECT.md"], checks: [{ name: "ci", conclusion: "FAILURE" }] });
    const r = run({ prs: [waitingPointer, pr(2)], queue: QUEUE });
    expect(r.nowStep?.id).toBe("pr-2");
    expect(r.waitingAhead).toHaveLength(1);
    expect(r.waitingAhead[0]).toContain("#1 advances the active-Plan pointer but is waiting on required check ci");
  });

  it("does not list the now step's own waiting child as ahead of it", () => {
    const r = run({ prs: [pr(10), pr(20, { baseRef: "branch-10", files: ["PROJECT.md"] })], queue: QUEUE });
    expect(r.waitingAhead).toEqual([]);
  });
});

describe("merge readiness", () => {
  it("only CLEAN and HAS_HOOKS are takeable; every other merge state is a named wait", () => {
    for (const state of ["BLOCKED", "BEHIND", "UNKNOWN", "DIRTY", "UNSTABLE", null]) {
      const r = run({ prs: [pr(7, { mergeStateStatus: state })] });
      expect(r.state, String(state)).toBe("waiting");
      expect(r.steps[0].click).toBeNull();
      expect(["merge_conflict", "merge_state_not_clean"]).toContain(r.steps[0].waitCode);
    }
    expect(run({ prs: [pr(7, { mergeStateStatus: "HAS_HOOKS" })] }).state).toBe("now");
    expect(run({ prs: [pr(7, { mergeStateStatus: "CLEAN" })] }).state).toBe("now");
    expect(run({ prs: [pr(7, { mergeStateStatus: "BEHIND" })] }).steps[0].reason).toContain("BEHIND");
  });

  it("a head that moved since the previous poll is head_moved", () => {
    const r = run({ prs: [pr(8)], pinnedHeads: { 8: sha("f") } });
    expect(r.steps[0].waitCode).toBe("head_moved");
  });
});

describe("trunk and forks", () => {
  it("uses the injected trunk: a PR based on it is a root, one based on main is not", () => {
    const r = run({ prs: [pr(1, { baseRef: "develop" }), pr(2, { baseRef: "main" })], trunk: "develop" });
    expect(r.nowStep?.id).toBe("pr-1");
    expect(r.steps.find((s) => s.id === "pr-2")?.waitCode).toBe("base_pr_missing");
  });

  it("never matches a fork's head branch as a stack parent", () => {
    const fork = pr(1, { headRef: "feature", headRepo: "someone/arcadia" });
    const child = pr(2, { baseRef: "feature" });
    const r = run({ prs: [fork, child], repo: "pmark/arcadia" });
    expect(r.steps.find((s) => s.id === "pr-2")?.waitCode).toBe("base_pr_missing");
    const own = pr(3, { headRef: "feature2", headRepo: "pmark/arcadia" });
    const kid = pr(4, { baseRef: "feature2" });
    expect(run({ prs: [own, kid], repo: "pmark/arcadia" }).steps.find((s) => s.id === "pr-4")?.waitCode).toBe("parent_unmerged");
  });
});
