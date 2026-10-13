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

const READ_EMPTY_QUEUE: NextStepsQueue = { currentActionId: null, planPath: null, queued: [] };
const run = (input: NextStepsInput) => buildNextSteps({ queue: READ_EMPTY_QUEUE, cards: [], ...input });
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

  it("a COMMENTED review beside an APPROVED one is not a blocker: the PR stays takeable", () => {
    const head = sha("3");
    const r = run({
      prs: [pr(3, { reviews: [{ verdict: "APPROVED", headSha: head, author: "rev1" }, { verdict: "COMMENTED", headSha: head, author: "rev2" }] })],
    });
    expect(r.state).toBe("now");
    expect(r.nowStep?.click).toBe("Merge #3 on GitHub");
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
    for (const state of ["BLOCKED", "BEHIND", "UNKNOWN", "DIRTY", null]) {
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

describe("inheritance only from children that can become takeable", () => {
  const cases: Array<[string, Partial<NextStepsPr>, string]> = [
    ["draft", { isDraft: true }, "draft"],
    ["DIRTY (conflicted)", { mergeStateStatus: "DIRTY" }, "merge_conflict"],
    ["failing required check", { checks: [{ name: "ci", conclusion: "FAILURE" }] }, "check_failing"],
    ["human changes-requested", { reviews: [{ verdict: "CHANGES_REQUESTED", headSha: sha("0"), author: "human" }] }, "changes_requested"],
    ["unreadable", { unreadable: "gh read failed" }, "unreadable"],
  ];
  for (const [label, over, code] of cases) {
    it(`a ${label} child of a parent does not promote the parent, and shows its true blocker`, () => {
      const parent = pr(10);
      const child = pr(20, { baseRef: "branch-10", files: ["PROJECT.md"], ...over });
      const rank1 = pr(30, { files: ["src/needed/dep.ts"] });
      const r = run({ prs: [child, rank1, parent], queue: QUEUE });
      expect(r.nowStep?.id).toBe("pr-30");
      expect(ids(r).indexOf("pr-30")).toBeLessThan(ids(r).indexOf("pr-10"));
      const shown = r.steps.find((s) => s.id === "pr-20")!;
      expect(shown.waitCode).toBe(code);
      expect(shown.waitCode).not.toBe("parent_unmerged");
      expect(r.steps.find((s) => s.id === "pr-10")?.unblocks).not.toContain("unlocks");
    });
  }

  it("a child waiting only on its parent still promotes it, and does not name a stacked child's missing required checks", () => {
    const r = run({
      prs: [pr(10), pr(20, { baseRef: "branch-10", files: ["PROJECT.md"], requiredChecks: [] }), pr(30, { files: ["src/needed/dep.ts"] })],
      queue: QUEUE,
    });
    expect(r.nowStep?.id).toBe("pr-10");
    expect(r.steps.find((s) => s.id === "pr-20")?.waitCode).toBe("parent_unmerged");
  });

  it("names a child's real blocker in the now step's waiting-ahead text", () => {
    const r = run({ prs: [pr(10), pr(20, { baseRef: "branch-10", files: ["PROJECT.md"], isDraft: true })], queue: QUEUE });
    expect(r.nowStep?.id).toBe("pr-10");
    expect(r.waitingAhead[0]).toContain("#20 advances the active-Plan pointer but is waiting on the author marking it ready for review");
  });
});

describe("UNSTABLE, SKIPPED and NEUTRAL", () => {
  it("UNSTABLE with required checks green is takeable and the note names the failing non-required checks", () => {
    const r = run({
      prs: [pr(1, { mergeStateStatus: "UNSTABLE", checks: [{ name: "ci", conclusion: "SUCCESS" }, { name: "lint-extra", conclusion: "FAILURE" }] })],
    });
    expect(r.state).toBe("now");
    expect(r.nowStep?.click).toBe("Merge #1 on GitHub");
    expect(r.nowStep?.reason).toContain("a non-required check is failing: lint-extra");
  });

  it("UNSTABLE with a failing REQUIRED check stays a wait", () => {
    const r = run({ prs: [pr(1, { mergeStateStatus: "UNSTABLE", checks: [{ name: "ci", conclusion: "FAILURE" }] })] });
    expect(r.steps[0]).toMatchObject({ kind: "wait", waitCode: "check_failing" });
  });

  it("a SKIPPED or NEUTRAL required check counts as passing", () => {
    for (const conclusion of ["SKIPPED", "NEUTRAL"]) {
      const r = run({ prs: [pr(2, { checks: [{ name: "ci", conclusion }] })] });
      expect(r.state, conclusion).toBe("now");
    }
    expect(run({ prs: [pr(2, { checks: [{ name: "ci", conclusion: "CANCELLED" }] })] }).state).toBe("waiting");
  });

  it("BLOCKED, BEHIND and UNKNOWN name their true cause and what ends it", () => {
    const blocked = run({ prs: [pr(3, { mergeStateStatus: "BLOCKED" })] }).steps[0];
    expect(blocked.reason).toContain("branch-protection");
    expect(blocked.waitingFor).toContain("branch-protection requirement");
    const behind = run({ prs: [pr(4, { mergeStateStatus: "BEHIND" })] }).steps[0];
    expect(behind.reason).toContain("behind its base branch");
    expect(behind.waitingFor).toContain("updated with its base");
    const unknown = run({ prs: [pr(5, { mergeStateStatus: "UNKNOWN" })] }).steps[0];
    expect(unknown.waitingFor).toContain("resolves by itself");
    for (const s of [blocked, behind, unknown]) expect(s.waitingFor).not.toMatch(/^waiting on GitHub$/i);
  });
});

describe("invalid and absent inputs", () => {
  it("an invalid pull-request entry makes prs unavailable and carries the count, never moving", () => {
    const r = buildNextSteps({ prs: [{ number: "x" } as unknown as NextStepsPr], queue: { currentActionId: null, planPath: null, queued: [] }, cards: [] });
    expect(r.state).toBe("unavailable");
    expect(r.unavailable).toEqual(["prs"]);
    expect(r.invalidPrs).toBe(1);
  });

  it("an absent queue or cards input is an unread source, distinct from read-empty", () => {
    const empty = { currentActionId: null, planPath: null, queued: [] };
    expect(buildNextSteps({ prs: [], queue: empty, cards: [] }).state).toBe("moving");
    expect(buildNextSteps({ prs: [], cards: [] })).toMatchObject({ state: "unavailable", unavailable: ["queue"] });
    expect(buildNextSteps({ prs: [], queue: null, cards: [] })).toMatchObject({ state: "unavailable", unavailable: ["queue"] });
    expect(buildNextSteps({ prs: [], queue: empty })).toMatchObject({ state: "unavailable", unavailable: ["cards"] });
    expect(buildNextSteps({ prs: [] })).toMatchObject({ state: "unavailable", unavailable: ["cards", "queue"] });
  });
});

describe("the review is a note, not a gate", () => {
  const META = (rounds: number, role: string) =>
    "Body text\n\n```arcadia-work-metadata\nversion: 1\naction: plan#a\nsize: S\noperator_gate: none\nagents:\n  - role: implementer\n    provider: claude-code\n  - role: " +
    role +
    "\n    provider: claude-code\nreview_rounds: " +
    rounds +
    "\nci_pushes: 1\n```\n";

  it("a green CLEAN PR with no reviews at all is a Merge click with reviewNote not_recorded", () => {
    const r = run({ prs: [pr(1, { reviews: [], body: "no metadata here" })] });
    expect(r.state).toBe("now");
    expect(r.nowStep).toMatchObject({ kind: "merge", click: "Merge #1 on GitHub", reviewNote: "not_recorded", waitCode: null });
  });

  it("an arcadia-work-metadata block with review_rounds >= 1 and a code-reviewer is independent_review_recorded", () => {
    expect(run({ prs: [pr(1, { reviews: [], body: META(1, "code-reviewer") })] }).nowStep?.reviewNote).toBe("independent_review_recorded");
    expect(run({ prs: [pr(1, { reviews: [], body: META(0, "code-reviewer") })] }).nowStep?.reviewNote).toBe("not_recorded");
    expect(run({ prs: [pr(1, { reviews: [], body: META(2, "qa") })] }).nowStep?.reviewNote).toBe("not_recorded");
    expect(run({ prs: [pr(1, { reviews: [], body: null })] }).nowStep?.reviewNote).toBe("not_recorded");
  });

  it("a CodeRabbit CHANGES_REQUESTED is advisory: still takeable, counted in advisoryBotFindings", () => {
    const head = sha("1");
    const r = run({
      prs: [
        pr(1, {
          reviews: [
            { verdict: "CHANGES_REQUESTED", headSha: head, author: "coderabbitai" },
            { verdict: "CHANGES_REQUESTED", headSha: head, author: "some-app[bot]" },
          ],
        }),
      ],
    });
    expect(r.state).toBe("now");
    expect(r.nowStep?.advisoryBotFindings).toBe(2);
    expect(r.nowStep?.reviewNote).toBe("not_recorded");
  });

  it("a human CHANGES_REQUESTED at the head is a changes_requested wait with no click", () => {
    const head = sha("1");
    const r = run({ prs: [pr(1, { reviews: [{ verdict: "CHANGES_REQUESTED", headSha: head, author: "pmark" }], body: META(1, "code-reviewer") })] });
    expect(r.state).toBe("waiting");
    expect(r.steps[0]).toMatchObject({ kind: "wait", waitCode: "changes_requested", click: null, reviewNote: "changes_requested_by_human" });
    expect(r.steps[0].waitingFor).toContain("pmark");
  });

  it("the latest review per reviewer wins: COMMENTED then APPROVED, or CHANGES_REQUESTED then APPROVED, is takeable", () => {
    const head = sha("1");
    const approvedLast = run({
      prs: [pr(1, { reviews: [{ verdict: "CHANGES_REQUESTED", headSha: head, author: "pmark" }, { verdict: "APPROVED", headSha: head, author: "pmark" }] })],
    });
    expect(approvedLast.state).toBe("now");
    const commentedAfter = run({
      prs: [pr(1, { reviews: [{ verdict: "APPROVED", headSha: head, author: "pmark" }, { verdict: "COMMENTED", headSha: head, author: "pmark" }] })],
    });
    expect(commentedAfter.state).toBe("now");
    const changesLast = run({
      prs: [pr(1, { reviews: [{ verdict: "APPROVED", headSha: head, author: "pmark" }, { verdict: "CHANGES_REQUESTED", headSha: head, author: "pmark" }] })],
    });
    expect(changesLast.steps[0].waitCode).toBe("changes_requested");
  });

  it("a human's CHANGES_REQUESTED on an earlier head does not block the current head", () => {
    const r = run({ prs: [pr(1, { reviews: [{ verdict: "CHANGES_REQUESTED", headSha: sha("e"), author: "pmark" }] })] });
    expect(r.state).toBe("now");
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
