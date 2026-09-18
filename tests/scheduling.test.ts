import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase, withReadOnlyDatabase } from "../src/db/connection.js";
import { getProjectBySlug, listActionableReviewItems, updateReviewItemStatus } from "../src/db/repositories.js";
import { loadActionOrder } from "../src/dispatch/order.js";
import { DISCOVERY_LIMITS, recordDiscovery } from "../src/scheduling/discovery.js";
import { projectScheduleToBoard, reconcileBoard, type BoardItem, type BoardStatus, type SchedulingBoard } from "../src/scheduling/github.js";
import { buildPortfolioSchedule, buildProjectSchedule, writeProjectOrder } from "../src/scheduling/schedule.js";
import { MAX_FAILED_RUNS_PER_MILESTONE, recordFailedRun, resumeProjectScheduling, runSchedulingPass } from "../src/scheduling/scheduler.js";
import { getSchedulingProject, listSchedulingLog, upsertSchedulingAction, upsertSchedulingProject } from "../src/scheduling/store.js";
import { gitIn as git, schedulingFixture, type ProjectSpec } from "./schedulingFixture.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(projects: ProjectSpec[]) {
  const created = schedulingFixture(projects);
  roots.push(created.root);
  return created;
}

function schedule(workspace: string, slug: string) {
  return withDatabase(workspace, (db) => buildProjectSchedule(db, getProjectBySlug(db, slug)!));
}

class FakeBoard implements SchedulingBoard {
  items: Array<BoardItem & { url: string }> = [];
  nextIssue = 100;
  nextItem = 1;
  calls: string[] = [];
  listItems(): BoardItem[] {
    return this.items.map(({ itemId, issueNumber, title, status }) => ({ itemId, issueNumber, title, status }));
  }
  createIssue(_input: { title: string; body: string }) {
    const number = this.nextIssue++;
    this.calls.push(`createIssue:${number}`);
    return { number, url: `https://github.com/example/repo/issues/${number}` };
  }
  addIssue(input: { number: number; url: string }) {
    const itemId = `ITEM_${this.nextItem++}`;
    this.items.push({ itemId, issueNumber: input.number, title: `#${input.number}`, status: null, url: input.url });
    this.calls.push(`addIssue:${input.number}`);
    return itemId;
  }
  setStatus(itemId: string, status: BoardStatus) {
    this.items.find((item) => item.itemId === itemId)!.status = status;
    this.calls.push(`setStatus:${itemId}:${status}`);
  }
  moveItem(itemId: string, afterItemId: string | null) {
    const item = this.items.find((entry) => entry.itemId === itemId)!;
    this.items = this.items.filter((entry) => entry.itemId !== itemId);
    const index = afterItemId ? this.items.findIndex((entry) => entry.itemId === afterItemId) + 1 : 0;
    this.items.splice(index, 0, item);
    this.calls.push(`moveItem:${itemId}:${afterItemId ?? "top"}`);
  }
  /** Simulate the operator dragging cards into this order (by issue number). */
  drag(issueNumbers: number[]) {
    const byNumber = new Map(this.items.map((item) => [item.issueNumber, item]));
    const dragged = issueNumbers.map((number) => byNumber.get(number)!);
    this.items = [...dragged, ...this.items.filter((item) => !issueNumbers.includes(item.issueNumber!))];
  }
  order(): number[] {
    return this.items.map((item) => item.issueNumber!);
  }
}

describe("project schedule", () => {
  it("derives status, tier and canonical order for the active Plan and selects the next runnable Action", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c" }, { id: "z", status: "done" }] }]);
    const result = schedule(fx.workspace, "alpha");
    expect(result.blockers).toEqual([]);
    expect(result.milestone).toBe("alpha milestone");
    expect(result.actions.map((action) => [action.actionId, action.status, action.schedulingClass])).toEqual([
      ["a", "ready", "planned"], ["b", "blocked", "planned"], ["c", "ready", "planned"], ["z", "done", "planned"]
    ]);
    expect(result.queue).toEqual(["alpha/a", "alpha/b", "alpha/c"]);
    expect(result.next).toBe("alpha/a");
    expect(result.currentAction).toBe("a");
  });

  it("scans Projects in the configured priority order and picks the first with runnable work", () => {
    const fx = fixture([
      { slug: "alpha", current: "a", actions: [{ id: "a" }] },
      { slug: "beta", current: "b", actions: [{ id: "b" }] }
    ]);
    withDatabase(fx.workspace, (db) => {
      upsertSchedulingProject(db, "beta", { priority: 1 });
      upsertSchedulingProject(db, "alpha", { priority: 2 });
    });
    const portfolio = withReadOnlyDatabase(fx.workspace, (db) => buildPortfolioSchedule(db));
    expect(portfolio.projects.map((project) => project.projectSlug)).toEqual(["beta", "alpha"]);
    expect(portfolio.selection).toEqual({ projectSlug: "beta", actionKey: "beta/b" });
  });

  it("writes one Project's order into the shared queue without disturbing another Project's slots", () => {
    const fx = fixture([
      { slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "c" }] },
      { slug: "beta", current: "b", actions: [{ id: "b" }] }
    ]);
    withDatabase(fx.workspace, (db) => {
      writeProjectOrder(db, "beta", ["beta/b"], { requestId: "w1", source: "arcadia", reason: "seed beta" });
      writeProjectOrder(db, "alpha", ["alpha/a", "alpha/c"], { requestId: "w2", source: "arcadia", reason: "seed alpha" });
      expect([...loadActionOrder(db).positions.keys()]).toEqual(["beta/b", "alpha/a", "alpha/c"]);
      const write = writeProjectOrder(db, "alpha", ["alpha/c", "alpha/a"], { requestId: "w3", source: "github_operator", reason: "operator moved c up" });
      expect(write.changed).toBe(true);
      expect([...loadActionOrder(db).positions.keys()]).toEqual(["beta/b", "alpha/c", "alpha/a"]);
      expect(loadActionOrder(db).revision).toBe(3);
      const unchanged = writeProjectOrder(db, "alpha", ["alpha/c", "alpha/a"], { requestId: "w4", source: "arcadia", reason: "noop" });
      expect(unchanged.changed).toBe(false);
      expect(loadActionOrder(db).revision).toBe(3);
    });
    const log = withReadOnlyDatabase(fx.workspace, (db) => listSchedulingLog(db, { projectSlug: "alpha" }));
    expect(log[0]?.source).toBe("github_operator");
    expect(log[0]?.previous).toEqual({ order: ["alpha/a", "alpha/c"], revision: 2 });
    expect(log[0]?.next).toEqual({ order: ["alpha/c", "alpha/a"], revision: 3 });
  });
});

describe("discovery", () => {
  it("records a blocker in the Plan, makes the origin depend on it, queues it first, commits and logs", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "c" }] }]);
    const headBefore = git(fx.repos.alpha!, ["rev-parse", "HEAD"]).trim();
    const result = withDatabase(fx.workspace, (db) => recordDiscovery(db, {
      originActionKey: "alpha/a",
      kind: "blocker",
      title: "Fix the broken migration",
      acceptance: ["The migration applies cleanly."],
      requestId: "disc-1"
    }));
    expect(result.outcome).toBe("queued");
    expect(result.actionKey).toBe("alpha/fix-the-broken-migration");
    expect(result.commitError).toBeNull();
    expect(git(fx.repos.alpha!, ["rev-parse", "HEAD"]).trim()).not.toBe(headBefore);
    expect(git(fx.repos.alpha!, ["status", "--porcelain"]).trim()).toBe("");
    const plan = readFileSync(path.join(fx.repos.alpha!, "docs/plans/alpha-plan.md"), "utf8");
    expect(plan).toContain("  - id: fix-the-broken-migration");
    expect(plan).toMatch(/- id: a\n[\s\S]*?depends_on: \[fix-the-broken-migration\]/);

    const after = schedule(fx.workspace, "alpha");
    expect(after.queue).toEqual(["alpha/fix-the-broken-migration", "alpha/a", "alpha/c"]);
    expect(after.actions.find((action) => action.actionId === "a")?.status).toBe("blocked");
    expect(after.actions.find((action) => action.actionId === "fix-the-broken-migration")).toMatchObject({ schedulingClass: "blocker", status: "ready", discoveredByActionKey: "alpha/a", discoveryDepth: 1 });
    expect(after.next).toBe("alpha/fix-the-broken-migration");

    // Replay returns the same receipt without writing again.
    const replay = withDatabase(fx.workspace, (db) => recordDiscovery(db, { originActionKey: "alpha/a", kind: "blocker", title: "Fix the broken migration", acceptance: ["x"], requestId: "disc-1" }));
    expect(replay).toEqual(result);
    const log = withReadOnlyDatabase(fx.workspace, (db) => listSchedulingLog(db, { projectSlug: "alpha" }));
    expect(log.some((entry) => entry.source === "coding_run" && entry.reason.includes("Blocker"))).toBe(true);
  });

  it("queues a corrective ahead of planned work, FIFO behind earlier correctives, without touching the current Action", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b" }, { id: "c" }] }]);
    withDatabase(fx.workspace, (db) => {
      recordDiscovery(db, { originActionKey: "alpha/a", kind: "corrective", title: "First corrective", acceptance: ["one"], requestId: "c-1" });
      recordDiscovery(db, { originActionKey: "alpha/a", kind: "corrective", title: "Second corrective", acceptance: ["two"], requestId: "c-2" });
    });
    const after = schedule(fx.workspace, "alpha");
    expect(after.queue).toEqual(["alpha/first-corrective", "alpha/second-corrective", "alpha/a", "alpha/b", "alpha/c"]);
    expect(after.currentAction).toBe("a");
    expect(after.actions.find((action) => action.actionId === "a")?.status).toBe("ready");
  });

  it("puts a follow-up in the backlog and leaves the queue alone", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b" }] }]);
    const before = schedule(fx.workspace, "alpha").queue;
    const result = withDatabase(fx.workspace, (db) => recordDiscovery(db, { originActionKey: "alpha/a", kind: "follow_up", title: "Tidy the docs later", acceptance: [], requestId: "f-1" }));
    expect(result.outcome).toBe("backlogged");
    const after = schedule(fx.workspace, "alpha");
    expect(after.queue).toEqual(before);
    expect(after.backlog).toEqual(["alpha/tidy-the-docs-later"]);
    expect(after.actions.find((action) => action.actionId === "tidy-the-docs-later")?.status).toBe("deferred");
  });

  it("stops at discovery depth 2 and opens a Decision instead of expanding further", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }] }]);
    const results = withDatabase(fx.workspace, (db) => {
      const first = recordDiscovery(db, { originActionKey: "alpha/a", kind: "blocker", title: "Depth one", acceptance: ["1"], requestId: "d-1" });
      const second = recordDiscovery(db, { originActionKey: first.actionKey!, kind: "blocker", title: "Depth two", acceptance: ["2"], requestId: "d-2" });
      const third = recordDiscovery(db, { originActionKey: second.actionKey!, kind: "blocker", title: "Depth three", acceptance: ["3"], requestId: "d-3" });
      return { first, second, third };
    });
    expect(results.second.outcome).toBe("queued");
    expect(results.third.outcome).toBe("needs_operator");
    expect(results.third.reason).toContain(`above the limit of ${DISCOVERY_LIMITS.maxDepth}`);
    expect(results.third.decisionId).not.toBeNull();
    const decisions = withReadOnlyDatabase(fx.workspace, (db) => listActionableReviewItems(db));
    expect(decisions.some((decision) => decision.id === results.third.decisionId)).toBe(true);
    expect(schedule(fx.workspace, "alpha").queue).toEqual(["alpha/depth-two", "alpha/depth-one", "alpha/a"]);
  });

  it("caps corrective descendants per root Action", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }] }]);
    const outcomes = withDatabase(fx.workspace, (db) =>
      Array.from({ length: DISCOVERY_LIMITS.maxCorrectiveDescendantsPerRoot + 1 }, (_, index) =>
        recordDiscovery(db, { originActionKey: "alpha/a", kind: "corrective", title: `Corrective ${index + 1}`, acceptance: ["x"], requestId: `r-${index}` }).outcome
      )
    );
    expect(outcomes).toEqual(["queued", "queued", "queued", "needs_operator"]);
  });

  it("caps discovered correctives per Milestone", () => {
    const actions = Array.from({ length: 4 }, (_, index) => ({ id: `root${index}` }));
    const fx = fixture([{ slug: "alpha", current: "root0", actions }]);
    const outcomes = withDatabase(fx.workspace, (db) =>
      Array.from({ length: DISCOVERY_LIMITS.maxCorrectivesPerMilestone + 1 }, (_, index) =>
        recordDiscovery(db, { originActionKey: `alpha/root${index % 4}`, kind: "corrective", title: `Milestone corrective ${index + 1}`, acceptance: ["x"], requestId: `m-${index}` }).outcome
      )
    );
    expect(outcomes.filter((outcome) => outcome === "queued")).toHaveLength(DISCOVERY_LIMITS.maxCorrectivesPerMilestone);
    expect(outcomes.at(-1)).toBe("needs_operator");
  });
});

describe("GitHub board projection and reconciliation", () => {
  it("creates one Issue and item per Action, sets statuses, orders queued cards, and records the projected revision", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c" }, { id: "z", status: "done" }] }]);
    const board = new FakeBoard();
    withDatabase(fx.workspace, (db) => {
      upsertSchedulingProject(db, "alpha", { githubOwner: "example", githubProjectNumber: 7, githubRepository: "example/repo" });
      const first = projectScheduleToBoard(db, buildProjectSchedule(db, getProjectBySlug(db, "alpha")!), board);
      expect(first.issuesCreated).toEqual(["alpha/a", "alpha/b", "alpha/c", "alpha/z"]);
      expect(first.statusChanges.map((change) => change.to)).toEqual(["Ready", "Blocked", "Ready", "Done"]);
      expect(board.items.map((item) => item.status)).toEqual(["Ready", "Blocked", "Ready", "Done"]);
      const again = projectScheduleToBoard(db, buildProjectSchedule(db, getProjectBySlug(db, "alpha")!), board);
      expect(again.changed).toBe(false);
      const record = buildProjectSchedule(db, getProjectBySlug(db, "alpha")!).record;
      expect(record.lastProjectedRevision).toBe(0);
      expect(record.lastProjectedOrder).toEqual(["alpha/a", "alpha/b", "alpha/c"]);
    });
  });

  it("reads an operator drag of two ordinary Ready cards back into the canonical queue and re-projects", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b" }, { id: "c" }] }]);
    const board = new FakeBoard();
    withDatabase(fx.workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      expect(board.order()).toEqual([100, 101, 102]);

      board.drag([102, 100, 101]); // operator moves c to the top
      const result = reconcileBoard(db, buildProjectSchedule(db, project), board, { requestId: "rec-1", rebuild: () => buildProjectSchedule(db, project) });
      expect(result.operatorMoved).toBe(true);
      expect(result.accepted).toBe(true);
      expect(result.normalized).toBe(false);
      expect(result.canonical).toEqual(["alpha/c", "alpha/a", "alpha/b"]);
      expect(buildProjectSchedule(db, project).queue).toEqual(["alpha/c", "alpha/a", "alpha/b"]);
      expect(buildProjectSchedule(db, project).next).toBe("alpha/c");
      expect(board.order()).toEqual([102, 100, 101]);
      expect(buildProjectSchedule(db, project).record.lastProjectedRevision).toBe(loadActionOrder(db).revision);

      // A second pass with no further drag is a no-op.
      const quiet = reconcileBoard(db, buildProjectSchedule(db, project), board, { requestId: "rec-2", rebuild: () => buildProjectSchedule(db, project) });
      expect(quiet.operatorMoved).toBe(false);
      expect(quiet.projection).toBeNull();
    });
    const log = withReadOnlyDatabase(fx.workspace, (db) => listSchedulingLog(db, { projectSlug: "alpha" }));
    expect(log.some((entry) => entry.source === "github_operator" && entry.reason.includes("moved alpha/c"))).toBe(true);
  });

  it("restores canonical order on the board when a drag breaks a dependency or a tier, and logs why without a Decision", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c" }] }]);
    const board = new FakeBoard();
    withDatabase(fx.workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      upsertSchedulingAction(db, "alpha/c", { schedulingClass: "corrective" });
      projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      expect(board.order()).toEqual([102, 100, 101]); // c (corrective) first

      board.drag([101, 100, 102]); // b above a (dependency) and planned above corrective
      const result = reconcileBoard(db, buildProjectSchedule(db, project), board, { requestId: "rec-3", rebuild: () => buildProjectSchedule(db, project) });
      expect(result.operatorMoved).toBe(true);
      expect(result.normalized).toBe(true);
      expect(result.canonical).toEqual(["alpha/c", "alpha/a", "alpha/b"]);
      expect(board.order()).toEqual([102, 100, 101]);
      expect(listActionableReviewItems(db)).toHaveLength(0);
    });
    const log = withReadOnlyDatabase(fx.workspace, (db) => listSchedulingLog(db, { projectSlug: "alpha" }));
    const normalization = log.find((entry) => entry.reason.startsWith("Board order normalized"));
    expect(normalization?.reason).toContain("alpha/b depends on alpha/a");
    expect(normalization?.reason).toContain("cannot move ahead of alpha/c (corrective)");
  });

  it("projects Arcadia-side queue changes (a discovered blocker) onto the board on the next pass", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b" }] }]);
    const board = new FakeBoard();
    withDatabase(fx.workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      recordDiscovery(db, { originActionKey: "alpha/a", kind: "blocker", title: "Unblock a", acceptance: ["done"], requestId: "gb-1" });
      const result = reconcileBoard(db, buildProjectSchedule(db, project), board, { requestId: "rec-4", rebuild: () => buildProjectSchedule(db, project) });
      expect(result.operatorMoved).toBe(false);
      expect(result.projection?.issuesCreated).toEqual(["alpha/unblock-a"]);
      expect(board.order()).toEqual([102, 100, 101]);
      expect(board.items.map((item) => item.status)).toEqual(["Ready", "Blocked", "Ready"]);
    });
  });
});

describe("scheduling pass", () => {
  it("moves the governed pointer to the canonical next Action and commits it, reconciling the board first", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b" }, { id: "c" }] }]);
    const board = new FakeBoard();
    withDatabase(fx.workspace, (db) => {
      upsertSchedulingProject(db, "alpha", { githubOwner: "example", githubProjectNumber: 7, githubRepository: "example/repo" });
      const first = runSchedulingPass(db, { boardFactory: () => board, now: new Date("2026-09-17T10:00:00.000Z") });
      expect(first.projects[0]?.pointer.moved).toBe(false);
      expect(first.selection).toEqual({ projectSlug: "alpha", actionKey: "alpha/a" });

      board.drag([102, 100, 101]);
      const second = runSchedulingPass(db, { boardFactory: () => board, now: new Date("2026-09-17T10:01:00.000Z") });
      expect(second.projects[0]?.reconcile?.accepted).toBe(true);
      expect(second.projects[0]?.pointer).toMatchObject({ moved: true, from: "a", to: "c" });
      expect(second.selection).toEqual({ projectSlug: "alpha", actionKey: "alpha/c" });
    });
    expect(readFileSync(path.join(fx.repos.alpha!, "PROJECT.md"), "utf8")).toContain("current_action: c");
    expect(git(fx.repos.alpha!, ["log", "-1", "--format=%s"]).trim()).toBe("chore(arcadia): point at c");
    expect(git(fx.repos.alpha!, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("confines a Project-scoped pass to that Project, leaving another Project's board and pointer untouched", () => {
    const fx = fixture([
      { slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b" }] },
      { slug: "beta", current: "b1", actions: [{ id: "b1" }, { id: "b2" }] }
    ]);
    const alphaBoard = new FakeBoard();
    const betaBoard = new FakeBoard();
    withDatabase(fx.workspace, (db) => {
      for (const slug of ["alpha", "beta"]) {
        upsertSchedulingProject(db, slug, { githubOwner: "example", githubProjectNumber: 7, githubRepository: "example/repo" });
      }
      const boards: Record<string, FakeBoard> = { alpha: alphaBoard, beta: betaBoard };
      const boardFactory = (schedule: { projectSlug: string }) => boards[schedule.projectSlug] ?? null;
      runSchedulingPass(db, { boardFactory, now: new Date("2026-09-18T10:00:00.000Z") });

      // Both Projects now want their pointer moved: each board is dragged so
      // the second Action leads.
      alphaBoard.drag([101, 100]);
      betaBoard.drag([101, 100]);

      const scoped = runSchedulingPass(db, { boardFactory, projectSlugs: ["alpha"], now: new Date("2026-09-18T10:01:00.000Z") });
      expect(scoped.projects.map((project) => project.projectSlug)).toEqual(["alpha"]);
      expect(scoped.projects[0]?.pointer).toMatchObject({ moved: true, from: "a", to: "b" });
    });
    // Alpha moved; beta was never read, reordered, or committed.
    expect(readFileSync(path.join(fx.repos.alpha!, "PROJECT.md"), "utf8")).toContain("current_action: b");
    expect(readFileSync(path.join(fx.repos.beta!, "PROJECT.md"), "utf8")).toContain("current_action: b1");
    expect(git(fx.repos.beta!, ["log", "-1", "--format=%s"]).trim()).toBe("initial");
    expect(betaBoard.order()).toEqual([101, 100]);
    const betaQueue = withReadOnlyDatabase(fx.workspace, (db) => buildProjectSchedule(db, getProjectBySlug(db, "beta")!).queue);
    expect(betaQueue).toEqual(["beta/b1", "beta/b2"]);
  });

  it("pauses a Project and opens a Decision when the failed-Run budget is exceeded, and resumes on operator say-so", () => {
    const fx = fixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }] }]);
    withDatabase(fx.workspace, (db) => {
      let last = recordFailedRun(db, "alpha", { reason: "boom", actionKey: "alpha/a" });
      for (let index = 1; index < MAX_FAILED_RUNS_PER_MILESTONE; index += 1) {
        last = recordFailedRun(db, "alpha", { reason: "boom", actionKey: "alpha/a" });
      }
      expect(last).toMatchObject({ failedRuns: MAX_FAILED_RUNS_PER_MILESTONE, paused: false, decisionId: null });
      const over = recordFailedRun(db, "alpha", { reason: "boom again", actionKey: "alpha/a" });
      expect(over.paused).toBe(true);
      expect(over.decisionId).not.toBeNull();
      const project = getProjectBySlug(db, "alpha")!;
      expect(buildProjectSchedule(db, project).next).toBeNull();
      expect(buildProjectSchedule(db, project).pausedReason).toContain("Failed-Run budget exceeded");
      expect(runSchedulingPass(db, { boardFactory: () => null }).selection).toBeNull();

      // Resume cannot stand in for the judgment the pause exists to force.
      expect(() => resumeProjectScheduling(db, "alpha", "Just keep going.")).toThrow(/still unanswered/);
      expect(buildProjectSchedule(db, project).pausedReason).toContain("Failed-Run budget exceeded");
      expect(getSchedulingProject(db, "alpha").pausedDecisionId).toBe(over.decisionId);

      // Answering it is what makes resuming possible.
      updateReviewItemStatus(db, over.decisionId!, { status: "approved", decisionNote: "Two more attempts approved." });
      resumeProjectScheduling(db, "alpha", "Decision answered: continue.");
      expect(buildProjectSchedule(db, project).next).toBe("alpha/a");
      expect(buildProjectSchedule(db, project).record.failedRuns).toBe(0);
      expect(getSchedulingProject(db, "alpha").pausedDecisionId).toBeNull();
    });
    const log = withReadOnlyDatabase(fx.workspace, (db) => listSchedulingLog(db, { projectSlug: "alpha", limit: 100 }));
    expect(log.some((entry) => entry.reason.includes("Milestone paused because the failed-Run budget was exceeded"))).toBe(true);
    expect(log[0]?.source).toBe("decision");
  });
});
