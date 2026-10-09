import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAskMemo, recordAskCorrection } from "../src/ask/corrections.js";
import { runAskCommand } from "../src/commands/ask.js";
import { runReviewApproveCommand } from "../src/commands/review.js";
import { withDatabase } from "../src/db/connection.js";
import {
  archiveWorkItem,
  createProjectWithInitialWork,
  updateWorkItem,
  upsertProjectMetadata
} from "../src/db/repositories.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

/**
 * #1115 follow-ups to ask-corrections-stick (#1113): approving an Ask question makes exactly one Action however the
 * attempts interleave, fail or retry; a retry never reuses an Action the operator retired; a memo never turns an
 * unsafe intake into work; and the newest memo wins deterministically.
 *
 * `withDatabase` is wrapped so a test can run another command at a chosen point in the command under test, on the
 * connection that command itself uses.
 */
const hook = vi.hoisted(() => ({
  onPrepare: null as null | ((sql: string, db: Database.Database) => void)
}));

vi.mock("../src/db/connection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db/connection.js")>();
  return {
    ...actual,
    withDatabase: <T>(workspace: string, callback: (db: Database.Database) => T): T =>
      actual.withDatabase(workspace, (db) =>
        callback(
          new Proxy(db, {
            get(target, property) {
              if (property === "prepare") {
                return (sql: string) => {
                  hook.onPrepare?.(sql, target);
                  return target.prepare(sql);
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === "function" ? value.bind(target) : value;
            }
          })
        )
      )
  };
});

const roots: string[] = [];
const UNCLEAR_TEXT = "Sourdough starter notes for Sunday";
const UNSAFE_TEXT = "deploy the site to production";

afterEach(() => {
  hook.onPrepare = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspaceWithProject(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "arcadia-approval-claim-"));
  roots.push(workspace);
  initWorkspace(workspace);
  withDatabase(workspace, (db) => {
    const created = createProjectWithInitialWork(db, {
      name: "Arcadia",
      mission: "Fixture project.",
      goal: "Fixture goal.",
      status: "active",
      currentMilestone: "Fixture",
      nextAction: "Fixture next action.",
      workClassification: "agent"
    });
    upsertProjectMetadata(db, {
      projectId: created.project.id,
      aliases: ["Arcadia"],
      repoPath: workspace,
      validationCommands: ["node -e \"process.exit(0)\""]
    });
  });
  return workspace;
}

function count(workspace: string, table: string, where = "1 = 1"): number {
  return (withDatabase(workspace, (db) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get()) as { n: number }).n;
}

function row<T>(workspace: string, sql: string, ...params: unknown[]): T {
  return withDatabase(workspace, (db) => db.prepare(sql).get(...params)) as T;
}

/** An Ask the rules cannot place: it becomes a Clarify First question the operator approves into an Action. */
function openQuestion(workspace: string): string {
  const asked = runAskCommand({ workspace, request: UNCLEAR_TEXT });
  return asked.data.reviewItemId as string;
}

/** Makes the next attempt fail after its Action exists but before the Ask row and the link are written. */
function failBetweenCreationAndLink(workspace: string): () => void {
  withDatabase(workspace, (db) =>
    db.exec("CREATE TRIGGER no_ask_row BEFORE INSERT ON ask_requests BEGIN SELECT RAISE(ABORT, 'ask row refused'); END")
  );
  return () => withDatabase(workspace, (db) => db.exec("DROP TRIGGER no_ask_row"));
}

function approve(workspace: string, id: string) {
  return runReviewApproveCommand({ workspace, id, execute: false });
}

describe("approving an Ask question creates exactly one Action (#1115 items 1-2)", () => {
  it("a concurrent approval that decides the question first leaves the loser creating nothing", () => {
    const workspace = workspaceWithProject();
    const questionId = openQuestion(workspace);
    const actionsBefore = count(workspace, "work_items");
    let winner: ReturnType<typeof approve> | null = null;
    // The loser has already read the open question when the winner runs start to finish, just before the loser's
    // transaction that would make its Action.
    hook.onPrepare = (sql, db) => {
      if (db.inTransaction || !/skill_definitions/.test(sql)) return;
      hook.onPrepare = null;
      winner = approve(workspace, questionId);
    };

    expect(() => approve(workspace, questionId)).toThrow(/already decided/);

    expect(winner).not.toBeNull();
    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
    expect(count(workspace, "ask_requests", "work_item_id IS NOT NULL")).toBeGreaterThanOrEqual(1);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", questionId)).toEqual({ status: "approved" });
    expect(count(workspace, "review_items", "resolved_intent = 'ReviewExecutionPending'")).toBe(1);
    expect(count(workspace, "review_approval_claims")).toBe(0);
  });

  it("an approval still in flight holds the claim, so a second attempt creates nothing", () => {
    const workspace = workspaceWithProject();
    const questionId = openQuestion(workspace);
    const actionsBefore = count(workspace, "work_items");
    const restore = failBetweenCreationAndLink(workspace);
    expect(() => approve(workspace, questionId)).toThrow(/ask row refused/);
    restore();
    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
    // The first attempt is "still running": its lease is live and belongs to someone else.
    withDatabase(workspace, (db) =>
      db
        .prepare("UPDATE review_approval_claims SET owner = 'other-process', lease_expires_at = ? WHERE review_item_id = ?")
        .run(new Date(Date.now() + 60_000).toISOString(), questionId)
    );

    expect(() => approve(workspace, questionId)).toThrow(/in progress/);

    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
    expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", questionId)).toEqual({ status: "open" });
  });

  it("a failure between the Action and the link leaves one claimed Action that the retry resumes, not duplicates", () => {
    const workspace = workspaceWithProject();
    const questionId = openQuestion(workspace);
    const actionsBefore = count(workspace, "work_items");
    const asksBefore = count(workspace, "ask_requests");
    const restore = failBetweenCreationAndLink(workspace);

    expect(() => approve(workspace, questionId)).toThrow(/ask row refused/);

    // The Action, its plan and gates and the claim committed together; nothing else did.
    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
    expect(count(workspace, "ask_requests")).toBe(asksBefore);
    const claim = row<{ work_item_id: string; plan_id: string; lease_expires_at: string }>(
      workspace,
      "SELECT work_item_id, plan_id, lease_expires_at FROM review_approval_claims WHERE review_item_id = ?",
      questionId
    );
    expect(claim.lease_expires_at <= new Date().toISOString()).toBe(true);
    expect(row<{ status: string; resulting_ask_request_id: string | null }>(
      workspace,
      "SELECT status, resulting_ask_request_id FROM review_items WHERE id = ?",
      questionId
    )).toEqual({ status: "open", resulting_ask_request_id: null });

    restore();
    const retried = approve(workspace, questionId);

    expect(retried.data.item.status).toBe("approved");
    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
    expect(count(workspace, "ask_requests", `work_item_id = '${claim.work_item_id}'`)).toBe(1);
    expect(count(workspace, "execution_plans", `work_item_id = '${claim.work_item_id}'`)).toBe(1);
    expect(row<{ resulting_ask_request_id: string | null }>(
      workspace,
      "SELECT resulting_ask_request_id FROM review_items WHERE id = ?",
      questionId
    ).resulting_ask_request_id).toBeTruthy();
    expect(count(workspace, "review_approval_claims")).toBe(0);
  });

  it("a crashed attempt's expired lease is taken over, and still only one Action exists", () => {
    const workspace = workspaceWithProject();
    const questionId = openQuestion(workspace);
    const actionsBefore = count(workspace, "work_items");
    const restore = failBetweenCreationAndLink(workspace);
    expect(() => approve(workspace, questionId)).toThrow(/ask row refused/);
    restore();
    // The process died without releasing: the claim names another owner and its lease has simply run out.
    withDatabase(workspace, (db) =>
      db
        .prepare("UPDATE review_approval_claims SET owner = 'dead-process', lease_expires_at = ? WHERE review_item_id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), questionId)
    );

    expect(approve(workspace, questionId).data.item.status).toBe("approved");

    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
  });

  it("a failed attempt after the link is retried by reusing the linked Action", () => {
    const workspace = workspaceWithProject();
    const questionId = openQuestion(workspace);
    const actionsBefore = count(workspace, "work_items");
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER no_pending BEFORE INSERT ON review_items WHEN NEW.resolved_intent = 'ReviewExecutionPending' BEGIN SELECT RAISE(ABORT, 'pending refused'); END")
    );

    expect(() => approve(workspace, questionId)).toThrow(/pending refused/);
    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
    withDatabase(workspace, (db) => db.exec("DROP TRIGGER no_pending"));

    expect(approve(workspace, questionId).data.item.status).toBe("approved");
    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
    expect(count(workspace, "review_approval_claims")).toBe(0);
  });
});

describe("a retry never reuses an Action that was retired (#1115 item 3)", () => {
  const retire: Array<[string, RegExp, (db: Database.Database, workItemId: string, askId: string | null) => void]> = [
    ["archived", /archived/, (db, id) => void archiveWorkItem(db, id, "no longer wanted")],
    ["closed", /closed/, (db, id) => void updateWorkItem(db, id, { status: "done" })],
    ["deferred", /deferred/, (db, id) => void updateWorkItem(db, id, { status: "deferred" })]
  ];

  for (const [name, message, apply] of retire) {
    it(`refuses to resume a claimed Action that is ${name}, and creates no duplicate`, () => {
      const workspace = workspaceWithProject();
      const questionId = openQuestion(workspace);
      const actionsBefore = count(workspace, "work_items");
      const restore = failBetweenCreationAndLink(workspace);
      expect(() => approve(workspace, questionId)).toThrow(/ask row refused/);
      restore();
      const claim = row<{ work_item_id: string }>(workspace, "SELECT work_item_id FROM review_approval_claims WHERE review_item_id = ?", questionId);
      withDatabase(workspace, (db) => apply(db, claim.work_item_id, null));

      expect(() => approve(workspace, questionId)).toThrow(message);

      expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
      expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", questionId)).toEqual({ status: "open" });
      expect(count(workspace, "review_items", "resolved_intent = 'ReviewExecutionPending'")).toBe(0);
    });

    it(`refuses to reuse a linked Action that is ${name}, and creates no duplicate`, () => {
      const workspace = workspaceWithProject();
      const questionId = openQuestion(workspace);
      const actionsBefore = count(workspace, "work_items");
      withDatabase(workspace, (db) =>
        db.exec("CREATE TRIGGER no_pending BEFORE INSERT ON review_items WHEN NEW.resolved_intent = 'ReviewExecutionPending' BEGIN SELECT RAISE(ABORT, 'pending refused'); END")
      );
      expect(() => approve(workspace, questionId)).toThrow(/pending refused/);
      withDatabase(workspace, (db) => db.exec("DROP TRIGGER no_pending"));
      const linked = row<{ work_item_id: string; id: string }>(
        workspace,
        "SELECT ar.work_item_id, ar.id FROM review_items ri JOIN ask_requests ar ON ar.id = ri.resulting_ask_request_id WHERE ri.id = ?",
        questionId
      );
      withDatabase(workspace, (db) => apply(db, linked.work_item_id, linked.id));

      expect(() => approve(workspace, questionId)).toThrow(message);

      expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
      expect(row<{ status: string }>(workspace, "SELECT status FROM review_items WHERE id = ?", questionId)).toEqual({ status: "open" });
    });
  }

  it("refuses to reuse a linked Action whose Ask was superseded by `ask correct`", () => {
    const workspace = workspaceWithProject();
    const questionId = openQuestion(workspace);
    const actionsBefore = count(workspace, "work_items");
    withDatabase(workspace, (db) =>
      db.exec("CREATE TRIGGER no_pending BEFORE INSERT ON review_items WHEN NEW.resolved_intent = 'ReviewExecutionPending' BEGIN SELECT RAISE(ABORT, 'pending refused'); END")
    );
    expect(() => approve(workspace, questionId)).toThrow(/pending refused/);
    withDatabase(workspace, (db) => db.exec("DROP TRIGGER no_pending"));
    const linked = row<{ id: string }>(
      workspace,
      "SELECT resulting_ask_request_id AS id FROM review_items WHERE id = ?",
      questionId
    );
    withDatabase(workspace, (db) =>
      db
        .prepare(
          `INSERT INTO ask_supersessions (id, old_ask_request_id, new_ask_request_id, target_type, project_id, old_kind, old_record_id,
             new_kind, new_record_id, old_disposition, source, actor, created_at)
           VALUES ('sup_1', ?, 'ask_new', 'idea', NULL, 'work', NULL, 'idea', NULL, 'deferred', 'cli', NULL, ?)`
        )
        .run(linked.id, new Date().toISOString())
    );

    expect(() => approve(workspace, questionId)).toThrow(/superseded/);

    expect(count(workspace, "work_items")).toBe(actionsBefore + 1);
  });
});

describe("a memo never turns an unsafe intake into work (#1115 item 4)", () => {
  it("stands down for words that need review and are not safe to execute, though a missing field routes them to Clarify First", () => {
    const workspace = workspaceWithProject();
    const earlier = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    withDatabase(workspace, (db) =>
      recordAskCorrection(db, {
        askRequestId: earlier.data.ask?.id as string,
        text: UNSAFE_TEXT,
        predictedType: "unclear",
        correctedType: "work",
        correctedProject: null,
        source: "cli"
      })
    );
    // The memo exists, so only the stand-down keeps it from applying.
    withDatabase(workspace, (db) => expect(findAskMemo(db, UNSAFE_TEXT)).toMatchObject({ type: "work" }));
    const workQueueBefore = count(workspace, "work_items", "queue = 'work_queue'");
    const actionsBefore = count(workspace, "work_items");

    const repeat = runAskCommand({ workspace, request: UNSAFE_TEXT });

    expect(repeat.data.intake.reviewRequired).toBe(true);
    expect(repeat.data.intake.safeToExecute).toBe(false);
    expect(repeat.data.memo).toBeUndefined();
    expect(repeat.data.heard?.source).toBe("rule");
    expect(repeat.data.stewardship.recommendedExecutionPath).toBe("Clarify First");
    expect(repeat.data.workItem).toBeNull();
    expect(count(workspace, "work_items", "queue = 'work_queue'")).toBe(workQueueBefore);
    expect(count(workspace, "work_items")).toBe(actionsBefore);
  });
});

describe("findAskMemo ordering is deterministic (#1115 item 5)", () => {
  it("two corrections in the same millisecond: the one recorded last wins, whatever their ids sort as", () => {
    const workspace = workspaceWithProject();
    const earlier = runAskCommand({ workspace, request: UNCLEAR_TEXT });
    const askId = earlier.data.ask?.id as string;
    const at = "2026-10-09T10:00:00.000Z";
    withDatabase(workspace, (db) => {
      // The ids deliberately sort against insertion order: a tiebreak on id would pick `work` (inserted first).
      recordAskCorrection(db, { askRequestId: askId, text: UNCLEAR_TEXT, predictedType: "unclear", correctedType: "work", correctedProject: null, source: "cli", createdAt: at });
      recordAskCorrection(db, { askRequestId: askId, text: UNCLEAR_TEXT, predictedType: "work", correctedType: "idea", correctedProject: null, source: "cli", createdAt: at });
      db.prepare("UPDATE ask_corrections SET id = 'ac_zzz' WHERE corrected_type = 'work'").run();
      db.prepare("UPDATE ask_corrections SET id = 'ac_aaa' WHERE corrected_type = 'idea'").run();
      expect(findAskMemo(db, UNCLEAR_TEXT)).toMatchObject({ id: "ac_aaa", type: "idea" });
    });
  });
});
