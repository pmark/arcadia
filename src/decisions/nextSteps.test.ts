import { describe, expect, it } from "vitest";
import { buildNextSteps, safeText, type NextStepsCard, type NextStepsInput, type NextStepsPr, type NextStepsQueue } from "./nextSteps.js";

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
  queued: [{ actionId: "later-action", expectedArtifact: "src/later/feature.ts", dependencies: ["src/needed/dep.ts", "some-action-id"] }],
};

const ids = (r: ReturnType<typeof buildNextSteps>) => r.steps.map((s) => s.id);
const READ_EMPTY_QUEUE: NextStepsQueue = { currentActionId: null, planPath: null, queued: [] };
const run = (input: NextStepsInput) => buildNextSteps({ queue: READ_EMPTY_QUEUE, cards: [], ...input });

describe("stacked pull request order", () => {
  it("puts a stack's parents first and makes only the root takeable, whatever the input order", () => {
    const a = pr(10);
    const b = pr(11, { baseRef: "branch-10" });
    const c = pr(12, { baseRef: "branch-11" });
    const r = run({ prs: [c, a, b] });
    expect(ids(r)).toEqual(["pr-10", "pr-11", "pr-12"]);
    expect(r.nowStep?.id).toBe("pr-10");
    expect(r.nowStep?.click).toBe("Merge #10 on GitHub");
    expect(r.steps[1]).toMatchObject({ kind: "wait", waitCode: "parent_unmerged", waitingOn: "pr-10", click: null, href: null });
    expect(r.steps[2]).toMatchObject({ kind: "wait", waitingOn: "pr-11", click: null, href: null });
    expect(r.steps.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it("is deterministic and leaves frozen input untouched", () => {
    const input: NextStepsInput = {
      prs: [pr(3, { baseRef: "branch-2" }), pr(2), pr(1)].map((p) => Object.freeze({ ...p, files: Object.freeze([...p.files]), reviews: Object.freeze([...p.reviews]), checks: Object.freeze([...p.checks]), requiredChecks: Object.freeze([...p.requiredChecks]) })),
      queue: Object.freeze({ ...QUEUE, queued: Object.freeze([...QUEUE.queued]) }),
    };
    const first = JSON.stringify(run(input));
    expect(JSON.stringify(run(input))).toBe(first);
  });
});

describe("governance and queue ordering", () => {
  it("puts a pointer-advancing pull request ahead of an unrelated lower-numbered one", () => {
    const unrelated = pr(5);
    const pointer = pr(9, { files: [{ filename: "PROJECT.md" }], changedFiles: 1 });
    const r = run({ prs: [unrelated, pointer], queue: QUEUE });
    expect(ids(r)).toEqual(["pr-9", "pr-5"]);
    expect(r.nowStep?.id).toBe("pr-9");
    expect(r.nowStep?.unblocks).toContain("active-Plan pointer");
  });

  it("orders active-Plan and current-artifact pull requests before queued-action ones before unrelated ones", () => {
    const unrelated = pr(1);
    const queued = pr(2, { files: ["src/needed/dep.ts"] });
    const plan = pr(8, { files: ["docs/plans/active-plan.md"] });
    const artifact = pr(7, { files: ["apps/dashboard/components/next-steps.tsx"] });
    const r = run({ prs: [unrelated, queued, plan, artifact], queue: QUEUE });
    expect(ids(r)).toEqual(["pr-7", "pr-8", "pr-2", "pr-1"]);
    expect(r.steps[2].unblocks).toContain("later-action");
  });

  it("does not derive an unblock from an Action-id dependency", () => {
    const r = run({ prs: [pr(4, { files: ["some-action-id"] })], queue: QUEUE });
    expect(r.nowStep?.unblocks).toContain("no queued Action was derived");
  });

  it("orders two governance pull requests by stack order, then number", () => {
    const g2 = pr(21, { files: ["PROJECT.md"] });
    const g1 = pr(20, { files: ["docs/plans/active-plan.md"] });
    expect(ids(run({ prs: [g2, g1], queue: QUEUE }))).toEqual(["pr-20", "pr-21"]);
    const child = pr(19, { files: ["PROJECT.md"], baseRef: "branch-21" });
    expect(ids(run({ prs: [child, g2], queue: QUEUE }))).toEqual(["pr-21", "pr-19"]);
  });

  it("counts a rename out of PROJECT.md as touching it", () => {
    const moved = pr(30, { files: [{ filename: "docs/old-project.md", previous_filename: "PROJECT.md" }] });
    const r = run({ prs: [pr(2), moved], queue: QUEUE });
    expect(ids(r)[0]).toBe("pr-30");
    expect(r.nowStep?.authorityBoundaries).toContain("project_governance");
  });
});

describe("what makes a step wait", () => {
  it("shows a draft, a failing check and a pending check as waits with no click, naming the check", () => {
    const r = run({
      prs: [
        pr(40, { isDraft: true }),
        pr(41, { checks: [{ name: "ci", conclusion: "FAILURE" }] }),
        pr(42, { checks: [{ name: "ci", conclusion: null }] }),
        pr(43),
      ],
    });
    const by = Object.fromEntries(r.steps.map((s) => [s.id, s]));
    expect(by["pr-40"]).toMatchObject({ kind: "wait", waitCode: "draft", click: null, href: null });
    expect(by["pr-41"]).toMatchObject({ kind: "wait", waitCode: "check_failing" });
    expect(by["pr-41"].waitingFor).toContain("ci");
    expect(by["pr-42"]).toMatchObject({ kind: "wait", waitCode: "check_pending" });
    expect(r.nowStep?.id).toBe("pr-43");
  });

  it("the review is never a gate: no review, an old-head review or an author review is still a Merge click with a note", () => {
    const r = run({
      prs: [pr(50, { reviews: [] }), pr(51, { reviews: [{ verdict: "APPROVED", headSha: sha("e"), author: "r" }] }), pr(52, { reviews: [{ verdict: "APPROVED", headSha: sha("2"), author: "author" }] })],
    });
    expect(r.steps.every((s) => s.kind === "merge" && s.click !== null)).toBe(true);
    expect(r.steps.every((s) => s.reviewNote === "not_recorded")).toBe(true);
    expect(r.state).toBe("now");
  });

  it("refuses a stale head visibly against the earlier pinned sha", () => {
    const r = run({ prs: [pr(60), pr(61)], pinnedHeads: { 60: sha("a") } });
    const stale = r.steps.find((s) => s.id === "pr-60")!;
    expect(stale).toMatchObject({ kind: "wait", waitCode: "head_moved", click: null });
    expect(stale.reason).toContain("aaaaaaa");
    expect(r.nowStep?.id).toBe("pr-61");
    expect(r.nowStep?.pinnedHeadSha).toBe(sha("1"));
  });

  it("a head sha that is not hex is refused and never pinned", () => {
    const r = run({ prs: [pr(62, { headSha: "not-a-sha" })] });
    expect(r.state).toBe("waiting");
    const r2 = run({ prs: [pr(62, { headSha: "not-a-sha" }), pr(63)] });
    expect(r2.steps.find((s) => s.id === "pr-62")).toMatchObject({ waitCode: "bad_head_sha", pinnedHeadSha: null });
  });

  it("an incomplete file list is files_incomplete, never classified as no-boundary", () => {
    const r = run({ prs: [pr(70, { files: ["a.ts"], changedFiles: 3 }), pr(71, { changedFiles: null }), pr(72)] });
    expect(r.steps.find((s) => s.id === "pr-70")).toMatchObject({ kind: "wait", waitCode: "files_incomplete" });
    expect(r.steps.find((s) => s.id === "pr-71")).toMatchObject({ kind: "wait", waitCode: "files_incomplete" });
    expect(r.nowStep?.id).toBe("pr-72");
  });

  it("refuses a pull request whose facts the reader marked unreadable", () => {
    const r = run({ prs: [pr(75, { unreadable: "gh read failed" }), pr(76)] });
    expect(r.steps.find((s) => s.id === "pr-75")).toMatchObject({ kind: "wait", waitCode: "unreadable", click: null, href: null });
  });

  it("waits on a merge conflict", () => {
    const r = run({ prs: [pr(73, { mergeStateStatus: "DIRTY" }), pr(74)] });
    expect(r.steps.find((s) => s.id === "pr-73")?.waitCode).toBe("merge_conflict");
  });
});

describe("hostile structure", () => {
  it("handles a cycle without hanging and refuses its members", () => {
    const a = pr(80, { baseRef: "branch-81" });
    const b = pr(81, { baseRef: "branch-80" });
    const c = pr(82);
    const r = run({ prs: [a, b, c] });
    expect(r.steps.find((s) => s.id === "pr-80")?.waitCode).toBe("stack_cycle");
    expect(r.steps.find((s) => s.id === "pr-81")?.waitCode).toBe("stack_cycle");
    expect(r.nowStep?.id).toBe("pr-82");
    const self = run({ prs: [pr(83, { baseRef: "branch-83" })] });
    expect(self.state).toBe("waiting");
  });

  it("a base that is not an open PR's head is base_pr_missing; its child waits on it", () => {
    const orphan = pr(90, { baseRef: "closed-parent" });
    const child = pr(91, { baseRef: "branch-90" });
    const r = run({ prs: [child, orphan, pr(92)] });
    expect(r.steps.find((s) => s.id === "pr-90")?.waitCode).toBe("base_pr_missing");
    expect(r.steps.find((s) => s.id === "pr-91")).toMatchObject({ waitCode: "parent_unmerged", waitingOn: "pr-90" });
    expect(ids(r).indexOf("pr-90")).toBeLessThan(ids(r).indexOf("pr-91"));
  });

  it("duplicate pull request numbers produce one refused step, not a takeable one", () => {
    const r = run({ prs: [pr(100), pr(100, { title: "other" }), pr(101)] });
    expect(r.steps.filter((s) => s.id === "pr-100")).toHaveLength(1);
    expect(r.steps.find((s) => s.id === "pr-100")?.waitCode).toBe("duplicate_pr");
    expect(r.nowStep?.id).toBe("pr-101");
  });

  it("renders hostile titles as plain bounded text", () => {
    const title = "line1\nline2 \u202Eevil <script>alert(1)</script> " + "x".repeat(400);
    const r = run({ prs: [pr(110, { title })] });
    const shown = r.nowStep!.title;
    expect(shown).not.toMatch(/[\n\u202E]/);
    expect(shown.length).toBeLessThanOrEqual(120);
    expect(shown).toContain("<script>");
    expect(r.nowStep?.click).toBe("Merge #110 on GitHub");
    expect(safeText("a\u0000b\u2066c", 10)).toBe("a b c");
  });

  it("ignores unreadable input visibly", () => {
    const r = run({ prs: [pr(120), { number: "x" } as unknown as NextStepsPr, null as unknown as NextStepsPr] });
    expect(r.ignored).toBe(2);
    expect(r.nowStep?.id).toBe("pr-120");
  });
});

describe("cap, cards and the empty state", () => {
  it("caps the list with a hidden count but computes the now step over every pull request", () => {
    const drafts = Array.from({ length: 60 }, (_, i) => pr(200 + i, { isDraft: true }));
    const takeable = pr(500);
    const r = run({ prs: [...drafts, takeable], cap: 10 });
    expect(r.nowStep?.id).toBe("pr-500");
    expect(r.steps).toHaveLength(10);
    expect(r.total).toBe(61);
    // The now step is past the cap: it is shown separately, so it is not counted as hidden.
    expect(r.hidden).toBe(61 - 10 - 1);
    expect(r.state).toBe("now");
  });

  it("is state moving only for zero steps with every source read", () => {
    expect(run({ prs: [] })).toMatchObject({ state: "moving", nowStep: null, steps: [], total: 0, unavailable: [] });
  });

  it("orders an answer card that unblocks the current Action ahead of an unrelated merge", () => {
    const card: NextStepsCard = { id: "decision-arcadia-0100", verb: "answer", kind: "decision", what: "Choose the model", unblocksActionId: "todo-next-steps" };
    const other: NextStepsCard = { id: "script-restart", verb: "run", kind: "operator-script", what: "Restart services" };
    const r = run({ prs: [pr(400)], cards: [other, card], queue: QUEUE });
    expect(ids(r)).toEqual(["card-decision-arcadia-0100", "pr-400", "card-script-restart"]);
    expect(r.nowStep).toMatchObject({ kind: "answer", href: "#card-decision-arcadia-0100" });
    expect(r.nowStep?.click).toContain("Answer");
    expect(r.nowStep?.unblocks).toContain("todo-next-steps");
  });

  it("ignores merge and veto cards and duplicate card ids, counted", () => {
    const cards = [
      { id: "a", verb: "merge", kind: "pr", what: "x" },
      { id: "b", verb: "run", kind: "s", what: "y" },
      { id: "b", verb: "run", kind: "s", what: "y" },
    ] as NextStepsCard[];
    const r = run({ prs: [], cards });
    expect(r.ignored).toBe(2);
    expect(r.nowStep?.id).toBe("card-b");
  });
});
