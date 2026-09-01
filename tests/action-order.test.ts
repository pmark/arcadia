import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDatabase } from "../src/db/connection.js";
import { arrangeActionOrder, loadActionOrder, moveActionOrder, undoActionOrder } from "../src/dispatch/order.js";
import { initWorkspace } from "../src/workspace/initWorkspace.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "arcadia-action-order-"));
  temporary.push(root);
  initWorkspace(root);
  return root;
}

describe("approved Action order", () => {
  it("previews without mutation, then atomically persists every position", () => {
    const root = workspace();
    withDatabase(root, (db) => {
      const preview = moveActionOrder(db, {
        currentKeys: ["one/a", "one/b", "two/c"],
        move: "two/c",
        placement: "top",
        requestId: "preview-1"
      });
      expect(preview).toMatchObject({ applied: false, revisionBefore: 0, revisionAfter: 0 });
      expect(preview.after).toEqual(["two/c", "one/a", "one/b"]);
      expect(loadActionOrder(db)).toMatchObject({ revision: 0 });
      expect(loadActionOrder(db).positions.size).toBe(0);

      const applied = moveActionOrder(db, {
        currentKeys: ["one/a", "one/b", "two/c"],
        move: "two/c",
        placement: "top",
        requestId: "apply-1",
        expectedRevision: 0,
        apply: true
      });
      expect(applied).toMatchObject({ applied: true, revisionBefore: 0, revisionAfter: 1 });
      expect([...loadActionOrder(db).positions]).toEqual([["two/c", 0], ["one/a", 1], ["one/b", 2]]);
    });
  });

  it("replays the exact request and refuses changed or stale requests", () => {
    const root = workspace();
    withDatabase(root, (db) => {
      const first = moveActionOrder(db, {
        currentKeys: ["one/a", "one/b"],
        move: "one/b",
        placement: "top",
        requestId: "stable-request",
        expectedRevision: 0,
        apply: true
      });
      const replay = moveActionOrder(db, {
        currentKeys: ["one/b", "one/a"],
        move: "one/b",
        placement: "top",
        requestId: "stable-request",
        expectedRevision: 0,
        apply: true
      });
      expect(replay).toEqual(first);
      expect(() => moveActionOrder(db, {
        currentKeys: ["one/b", "one/a"],
        move: "one/a",
        placement: "top",
        requestId: "stable-request",
        apply: true
      })).toThrow(/different mutation/);
      expect(() => moveActionOrder(db, {
        currentKeys: ["one/b", "one/a"],
        move: "one/a",
        placement: "top",
        requestId: "stale-request",
        expectedRevision: 0,
        apply: true
      })).toThrow(/revision changed/);
      expect(loadActionOrder(db).revision).toBe(1);
    });
  });

  it("applies a complete batch and durably undoes its receipt", () => {
    const root = workspace();
    withDatabase(root, (db) => {
      const arranged = arrangeActionOrder(db, {
        currentKeys: ["one/a", "one/b", "two/c"],
        order: ["one/b", "two/c", "one/a"],
        requestId: "batch-1",
        expectedRevision: 0,
        apply: true
      });
      expect(arranged.after).toEqual(["one/b", "two/c", "one/a"]);
      expect(() => arrangeActionOrder(db, {
        currentKeys: arranged.after,
        order: ["one/a", "one/b"],
        requestId: "incomplete-batch",
        apply: true
      })).toThrow(/every active approved Action exactly once/);

      const undone = undoActionOrder(db, {
        currentKeys: arranged.after,
        receiptId: arranged.id,
        requestId: "undo-1",
        expectedRevision: 1,
        apply: true
      });
      expect(undone).toMatchObject({ applied: true, revisionBefore: 1, revisionAfter: 2 });
      expect(undone.after).toEqual(["one/a", "one/b", "two/c"]);
      expect([...loadActionOrder(db).positions]).toEqual([["one/a", 0], ["one/b", 1], ["two/c", 2]]);
      expect(() => undoActionOrder(db, {
        currentKeys: undone.after,
        receiptId: arranged.id,
        requestId: "stale-undo",
        apply: true
      })).toThrow(/undo is stale/);
    });
  });
});
