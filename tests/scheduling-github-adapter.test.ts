import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { getProjectBySlug } from "../src/db/repositories.js";
import {
  BOARD_PUSHES,
  BOARD_PUSH_FIELD,
  BOARD_STATUSES,
  BOARD_STATUS_FIELD,
  createGitHubBoard,
  ensureBoardFields,
  projectScheduleToBoard,
  reconcileBoard,
  type CommandRunner
} from "../src/scheduling/github.js";
import { buildProjectSchedule } from "../src/scheduling/schedule.js";
import { getSchedulingProject, listSchedulingLog, upsertSchedulingAction, upsertSchedulingProject } from "../src/scheduling/store.js";
import { writeProjectOrder } from "../src/scheduling/schedule.js";
import { schedulingFixture } from "./schedulingFixture.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PROJECT_ID = "PVT_board1";
const FIELD_ID = "PVTSSF_status1";
const PUSH_FIELD_ID = "PVTSSF_push1";
const OPTION_IDS = new Map(BOARD_STATUSES.map((status, index) => [status, `opt_${index}`]));
const PUSH_OPTION_IDS = new Map(BOARD_PUSHES.map((push, index) => [push, `push_opt_${index}`]));

interface FakeItem {
  id: string;
  number: number;
  url: string;
  title: string;
  status: string | null;
  push: string | null;
}

/**
 * A `gh` stand-in: it answers the exact argument vectors the adapter builds
 * and records every call, so a test can assert both what the adapter reads
 * back and what it refrains from writing.
 */
class FakeGh {
  calls: string[][] = [];
  items: FakeItem[] = [];
  hasStatusField: boolean;
  hasPushField: boolean;
  nextIssue = 100;
  nextItem = 1;
  /** Fail this many `moveItem` mutations, to cut a projection in half. */
  failMovesAfter: number | null = null;
  movesSeen = 0;

  constructor(options: { hasStatusField?: boolean; hasPushField?: boolean } = {}) {
    this.hasStatusField = options.hasStatusField ?? true;
    this.hasPushField = options.hasPushField ?? true;
  }

  get runner(): CommandRunner {
    return (_cwd, command, args) => {
      this.calls.push([command, ...args]);
      return this.respond(args);
    };
  }

  /** Every call that changes anything on GitHub. */
  writeCalls(): string[][] {
    return this.calls.filter(([, ...args]) =>
      args.includes("field-create") || args.includes("item-edit") || args.includes("item-add") ||
      (args[0] === "issue" && args[1] === "create") ||
      args.some((value) => value.startsWith("query=mutation"))
    );
  }

  private respond(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    const ok = (stdout: string) => ({ ok: true, stdout, stderr: "" });
    if (args[0] === "project" && args[1] === "view") return ok(JSON.stringify({ id: PROJECT_ID, number: 7 }));
    if (args[0] === "project" && args[1] === "field-list") {
      const fields = [{ id: "PVTF_title", name: "Title", type: "ProjectV2Field" }];
      if (this.hasStatusField) {
        fields.push({
          id: FIELD_ID,
          name: BOARD_STATUS_FIELD,
          type: "ProjectV2SingleSelectField",
          options: BOARD_STATUSES.map((status) => ({ id: OPTION_IDS.get(status)!, name: status }))
        } as never);
      }
      if (this.hasPushField) {
        fields.push({
          id: PUSH_FIELD_ID,
          name: BOARD_PUSH_FIELD,
          type: "ProjectV2SingleSelectField",
          options: BOARD_PUSHES.map((push) => ({ id: PUSH_OPTION_IDS.get(push)!, name: push }))
        } as never);
      }
      return ok(JSON.stringify({ fields }));
    }
    if (args[0] === "project" && args[1] === "field-create") {
      const name = args[args.indexOf("--name") + 1];
      if (name === BOARD_PUSH_FIELD) this.hasPushField = true;
      else this.hasStatusField = true;
      return ok(JSON.stringify({ id: name === BOARD_PUSH_FIELD ? PUSH_FIELD_ID : FIELD_ID }));
    }
    if (args[0] === "issue" && args[1] === "create") {
      const number = this.nextIssue++;
      const title = args[args.indexOf("--title") + 1] ?? "";
      const url = `https://github.com/example/repo/issues/${number}`;
      this.items.push({ id: "", number, url, title, status: null, push: null });
      return ok(`${url}\n`);
    }
    if (args[0] === "project" && args[1] === "item-add") {
      const url = args[args.indexOf("--url") + 1] ?? "";
      const number = Number(url.split("/").pop());
      const existing = this.items.find((item) => item.url === url && item.id !== "");
      if (existing) return { ok: false, stdout: "", stderr: "GraphQL: Content already exists in this project (addProjectV2ItemById)" };
      const id = `PVTI_${this.nextItem++}`;
      const pending = this.items.find((item) => item.url === url && item.id === "");
      if (pending) pending.id = id;
      else this.items.push({ id, number, url, title: `#${number}`, status: null, push: null });
      return ok(JSON.stringify({ id }));
    }
    if (args[0] === "project" && args[1] === "item-edit") {
      const itemId = args[args.indexOf("--id") + 1];
      const fieldId = args[args.indexOf("--field-id") + 1];
      const optionId = args[args.indexOf("--single-select-option-id") + 1];
      const item = this.items.find((candidate) => candidate.id === itemId);
      if (item && fieldId === PUSH_FIELD_ID) {
        item.push = [...PUSH_OPTION_IDS.entries()].find(([, id]) => id === optionId)?.[0] ?? null;
      } else if (item) {
        item.status = [...OPTION_IDS.entries()].find(([, id]) => id === optionId)?.[0] ?? null;
      }
      return ok("{}");
    }
    if (args[0] === "api" && args[1] === "graphql") {
      const query = args.find((value) => value.startsWith("query="))!.slice("query=".length);
      if (query.startsWith("mutation")) {
        this.movesSeen += 1;
        if (this.failMovesAfter !== null && this.movesSeen > this.failMovesAfter) {
          return { ok: false, stdout: "", stderr: "API rate limit exceeded" };
        }
        const itemId = valueOf(args, "item");
        const afterId = valueOf(args, "after");
        const item = this.items.find((candidate) => candidate.id === itemId)!;
        this.items = this.items.filter((candidate) => candidate.id !== itemId);
        const index = afterId ? this.items.findIndex((candidate) => candidate.id === afterId) + 1 : 0;
        this.items.splice(index, 0, item);
        return ok("{}");
      }
      // The items query addresses both fields by their exact names.
      expect(valueOf(args, "status")).toBe(BOARD_STATUS_FIELD);
      expect(valueOf(args, "push")).toBe(BOARD_PUSH_FIELD);
      return ok(JSON.stringify({
        data: {
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: this.items.filter((item) => item.id !== "").map((item) => ({
                id: item.id,
                content: { number: item.number, url: item.url, title: item.title },
                fieldValueByName: item.status === null ? null : { name: item.status },
                push: this.hasPushField && item.push !== null ? { name: item.push } : null
              }))
            }
          }
        }
      }));
    }
    return { ok: false, stdout: "", stderr: `unexpected gh call: ${args.join(" ")}` };
  }
}

function valueOf(args: string[], name: string): string | null {
  const found = args.find((value) => value.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : null;
}

function boardConfig(cwd: string) {
  return { owner: "example", number: 7, repository: "example/repo", cwd };
}

function workspaceWithProject(): { workspace: string; cwd: string } {
  const fixture = schedulingFixture([{ slug: "alpha", current: "a", actions: [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c" }] }]);
  roots.push(fixture.root);
  withDatabase(fixture.workspace, (db) => {
    upsertSchedulingProject(db, "alpha", { githubOwner: "example", githubProjectNumber: 7, githubRepository: "example/repo" });
  });
  return { workspace: fixture.workspace, cwd: fixture.repos.alpha };
}

describe("gh-backed board", () => {
  it("reads the Arcadia status field by its exact name, so a healthy board needs no status writes on the second pass", () => {
    const { workspace, cwd } = workspaceWithProject();
    const gh = new FakeGh();
    withDatabase(workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      const board = createGitHubBoard(boardConfig(cwd), gh.runner);
      const first = projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      expect(first.issuesCreated).toHaveLength(3);
      expect(first.statusChanges.map((change) => change.to)).toEqual(["Ready", "Blocked", "Ready"]);
      expect(gh.items.map((item) => item.status)).toEqual(["Ready", "Blocked", "Ready"]);
      // `a` and `c` are ready and share the repository, so the lane is ordered
      // work; `b` waits on `a`. The push label is written by this same pass.
      expect(first.pushChanges.map((change) => change.to)).toEqual([
        "This push · sequence",
        "Not queued",
        "This push · sequence"
      ]);
      expect(gh.items.map((item) => item.push)).toEqual(["This push · sequence", "Not queued", "This push · sequence"]);

      // The second projection reads those same statuses back through
      // `fieldValueByName` and must therefore write nothing at all. Before the
      // adapter addressed the field by name it read every status as absent and
      // rewrote all of them on every single pass.
      const before = gh.writeCalls().length;
      const second = projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      expect(second.statusChanges).toEqual([]);
      expect(second.moves).toEqual([]);
      expect(second.changed).toBe(false);
      expect(gh.writeCalls()).toHaveLength(before);
    });
  });

  it("opens a board with no Arcadia push field and projects statuses without inventing one", () => {
    const { workspace, cwd } = workspaceWithProject();
    const gh = new FakeGh({ hasPushField: false });
    withDatabase(workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      const board = createGitHubBoard(boardConfig(cwd), gh.runner);
      expect(board.pushField).toBeNull();
      const result = projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      expect(result.statusChanges.map((change) => change.to)).toEqual(["Ready", "Blocked", "Ready"]);
      expect(result.pushChanges).toEqual([]);
      expect(gh.writeCalls().some(([, ...args]) => args.includes("field-create"))).toBe(false);
    });
  });

  it("refuses to open a board whose status field is missing instead of creating it", () => {
    const { cwd } = workspaceWithProject();
    const gh = new FakeGh({ hasStatusField: false });
    expect(() => createGitHubBoard(boardConfig(cwd), gh.runner)).toThrow(/has no "Arcadia status" field/);
    expect(gh.writeCalls()).toEqual([]);
    expect(gh.calls.some(([, ...args]) => args.includes("field-create"))).toBe(false);
  });

  it("makes no project view or field-list call when the caller supplies the cached identity", () => {
    const { cwd } = workspaceWithProject();
    const resolving = new FakeGh();
    const first = createGitHubBoard(boardConfig(cwd), resolving.runner);
    expect(resolving.calls.filter(([, ...args]) => args[1] === "view" || args[1] === "field-list")).toHaveLength(2);

    const cachedRun = new FakeGh();
    const second = createGitHubBoard(boardConfig(cwd), cachedRun.runner, first.identity);
    expect(cachedRun.calls).toEqual([]);
    expect(second.identity).toEqual(first.identity);

    // And the cached identity still drives real writes correctly.
    cachedRun.items.push({ id: "PVTI_1", number: 100, url: "https://github.com/example/repo/issues/100", title: "#100", status: null, push: null });
    second.setStatus("PVTI_1", "Ready");
    expect(cachedRun.items[0].status).toBe("Ready");
  });

  it("resumes a projection that failed mid-move instead of reading the half-moved board as an operator drag", () => {
    const { workspace, cwd } = workspaceWithProject();
    const gh = new FakeGh();
    withDatabase(workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      const board = createGitHubBoard(boardConfig(cwd), gh.runner);
      projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      expect(getSchedulingProject(db, "alpha").projectionInFlight).toBe(false);
      const settled = buildProjectSchedule(db, project).queue;
      expect(gh.items.map((item) => item.number)).toEqual([100, 101, 102]);

      // Arcadia reorders its own queue, then the board write dies partway.
      writeProjectOrder(db, "alpha", [settled[2], settled[0], settled[1]], {
        requestId: "arcadia-reorder",
        source: "arcadia",
        reason: "Operator reprioritized through advance queue."
      });
      gh.failMovesAfter = 0;
      expect(() => projectScheduleToBoard(db, buildProjectSchedule(db, project), board)).toThrow(/rate limit/);

      // The interrupted projection is recorded, and the stale projected order
      // is not treated as the truth the board should have matched.
      const record = getSchedulingProject(db, "alpha");
      expect(record.projectionInFlight).toBe(true);
      expect(record.lastProjectedOrder).toEqual(settled);

      gh.failMovesAfter = null;
      const queueBefore = buildProjectSchedule(db, project).queue;
      const result = reconcileBoard(db, buildProjectSchedule(db, project), board, {
        requestId: "resume-1",
        rebuild: () => buildProjectSchedule(db, project)
      });

      expect(result.resumedProjection).toBe(true);
      expect(result.operatorMoved).toBe(false);
      expect(result.accepted).toBe(false);
      // Arcadia's own order survived; nothing was attributed to the operator.
      expect(buildProjectSchedule(db, project).queue).toEqual(queueBefore);
      expect(listSchedulingLog(db, { projectSlug: "alpha", limit: 100 }).some((entry) => entry.source === "github_operator")).toBe(false);
      // And the board now actually holds the canonical order.
      expect(getSchedulingProject(db, "alpha").projectionInFlight).toBe(false);
      const keyByNumber = new Map(buildProjectSchedule(db, project).actions.map((action) => [action.githubIssueNumber, action.key]));
      expect(gh.items.map((item) => keyByNumber.get(item.number))).toEqual(queueBefore);
    });
  });

  it("reuses the existing item when GitHub refuses to add an Issue already on the board", () => {
    const { cwd } = workspaceWithProject();
    const gh = new FakeGh();
    const board = createGitHubBoard(boardConfig(cwd), gh.runner);
    gh.items.push({ id: "PVTI_1", number: 100, url: "https://github.com/example/repo/issues/100", title: "#100", status: null, push: null });

    const itemId = board.addIssue({ number: 100, url: "https://github.com/example/repo/issues/100" });

    expect(itemId).toBe("PVTI_1");
    // No duplicate item was created for the same issue number.
    expect(gh.items.filter((item) => item.number === 100)).toHaveLength(1);
  });

  it("keeps a recovered item's real status instead of overwriting it and reporting it as newly added", () => {
    const { workspace, cwd } = workspaceWithProject();
    const gh = new FakeGh();
    withDatabase(workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      const board = createGitHubBoard(boardConfig(cwd), gh.runner);
      const first = projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      expect(first.itemsAdded).toHaveLength(3);

      // Simulate the crash this recovery exists for: the item made it onto the
      // board (and already carries the right status) but the local id was
      // never persisted, so Arcadia believes the item does not exist yet.
      const actionKey = buildProjectSchedule(db, project).actions[0].key;
      upsertSchedulingAction(db, actionKey, { githubProjectItemId: null });

      const editsBefore = gh.calls.filter(([, ...args]) => args.includes("item-edit")).length;
      const second = projectScheduleToBoard(db, buildProjectSchedule(db, project), board);

      // The item was recovered (one item-add call, refused and resolved by
      // lookup), not newly added, and its already-correct status was read as-is
      // rather than reset to null and rewritten with a status-edit call.
      expect(second.itemsAdded).not.toContain(actionKey);
      expect(second.statusChanges).toEqual([]);
      expect(gh.calls.filter(([, ...args]) => args.includes("item-edit"))).toHaveLength(editsBefore);
    });
  });

  it("does not reuse another repository's item that happens to share the same issue number", () => {
    const { cwd } = workspaceWithProject();
    const gh = new FakeGh();
    const board = createGitHubBoard(boardConfig(cwd), gh.runner);
    // A Project can hold Issues from more than one repository, so a same-numbered
    // Issue elsewhere on the board must not be picked up by number alone.
    gh.items.push({ id: "PVTI_other_repo", number: 100, url: "https://github.com/example/other-repo/issues/100", title: "#100", status: null, push: null });
    // GitHub still refuses the add for our own already-existing item (below).
    gh.items.push({ id: "PVTI_1", number: 100, url: "https://github.com/example/repo/issues/100", title: "#100", status: null, push: null });

    const itemId = board.addIssue({ number: 100, url: "https://github.com/example/repo/issues/100" });

    expect(itemId).toBe("PVTI_1");
  });

  it("still fails when GitHub's item-add error is not the already-exists case", () => {
    const { cwd } = workspaceWithProject();
    const gh = new FakeGh();
    const failing = createGitHubBoard(boardConfig(cwd), (cwd2, command, args) => {
      if (args[0] === "project" && args[1] === "item-add") return { ok: false, stdout: "", stderr: "API rate limit exceeded" };
      return gh.runner(cwd2, command, args);
    });
    expect(() => failing.addIssue({ number: 101, url: "https://github.com/example/repo/issues/101" })).toThrow(/rate limit/);
  });

  it("re-projects a stale push label even though the queue revision has not moved", () => {
    const { workspace, cwd } = workspaceWithProject();
    const gh = new FakeGh();
    withDatabase(workspace, (db) => {
      const project = getProjectBySlug(db, "alpha")!;
      const board = createGitHubBoard(boardConfig(cwd), gh.runner);
      projectScheduleToBoard(db, buildProjectSchedule(db, project), board);
      // Left behind by an older computation: the queue is untouched, so only
      // the push label can be what makes this board stale.
      gh.items[0].push = "Next push";

      const reconcile = reconcileBoard(db, buildProjectSchedule(db, project), board, {
        requestId: "stale-push",
        rebuild: () => buildProjectSchedule(db, project)
      });

      expect(reconcile.projection?.pushChanges).toHaveLength(1);
      expect(gh.items[0].push).toBe("This push · sequence");
    });
  });

  it("creates both board fields only through the explicit link path, and is a no-op when they already exist", () => {
    const { cwd } = workspaceWithProject();
    const missing = new FakeGh({ hasStatusField: false, hasPushField: false });
    expect(ensureBoardFields(boardConfig(cwd), missing.runner)).toEqual({ statusCreated: true, pushCreated: true });
    expect(missing.calls.some(([, ...args]) => args.includes("field-create"))).toBe(true);
    expect(() => createGitHubBoard(boardConfig(cwd), missing.runner)).not.toThrow();

    const present = new FakeGh();
    expect(ensureBoardFields(boardConfig(cwd), present.runner)).toEqual({ statusCreated: false, pushCreated: false });
    expect(present.writeCalls()).toEqual([]);
  });
});
