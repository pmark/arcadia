import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";

export interface ActionOrderState {
  revision: number;
  positions: Map<string, number>;
}

export type ActionOrderOperation =
  | { kind: "move"; move: string; placement: "top" | "before" | "after"; anchor: string | null }
  | { kind: "arrange"; order: string[] }
  | { kind: "undo"; receiptId: string };

export interface ActionOrderReceipt {
  id: string;
  requestId: string;
  revisionBefore: number;
  revisionAfter: number;
  before: string[];
  after: string[];
  operation: ActionOrderOperation;
  applied: boolean;
  createdAt: string;
}

interface MutationInput {
  requestId: string;
  expectedRevision?: number;
  apply?: boolean;
}

export function loadActionOrder(db: Database.Database): ActionOrderState {
  try {
    const state = db.prepare("SELECT revision FROM action_queue_state WHERE id = 'portfolio'").get() as { revision: number } | undefined;
    const rows = db.prepare("SELECT action_key, position FROM action_queue_positions ORDER BY position, action_key").all() as Array<{ action_key: string; position: number }>;
    return { revision: state?.revision ?? 0, positions: new Map(rows.map((row) => [row.action_key, row.position])) };
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return { revision: 0, positions: new Map() };
    throw error;
  }
}

export function loadLatestApplicableActionOrderReceipt(
  db: Database.Database,
  revision: number
): ActionOrderReceipt | null {
  try {
    const row = db.prepare(`SELECT receipt_json FROM action_queue_receipts
      WHERE revision_after = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
      .get(revision) as { receipt_json: string } | undefined;
    return row ? JSON.parse(row.receipt_json) as ActionOrderReceipt : null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("no such table")) return null;
    throw error;
  }
}

export function moveActionOrder(db: Database.Database, input: MutationInput & {
  currentKeys: string[];
  move: string;
  placement: "top" | "before" | "after";
  anchor?: string;
}): ActionOrderReceipt {
  const operation: ActionOrderOperation = {
    kind: "move",
    move: input.move,
    placement: input.placement,
    anchor: input.anchor ?? null
  };
  const replay = replayReceipt(db, input.requestId, operation);
  if (replay) return replay;
  const state = validateMutation(db, input);
  const before = explicitOrder(input.currentKeys, state.positions);
  if (!before.includes(input.move)) throw validationError("Action queue move target was not found.", { move: input.move });
  if (input.placement !== "top" && (!input.anchor || !before.includes(input.anchor))) {
    throw validationError("Action queue anchor was not found.", { anchor: input.anchor ?? null });
  }
  if (input.anchor === input.move) throw validationError("Action queue item cannot be moved relative to itself.");
  const after = before.filter((key) => key !== input.move);
  const index = input.placement === "top" ? 0 : after.indexOf(input.anchor!) + (input.placement === "after" ? 1 : 0);
  after.splice(index, 0, input.move);
  return finishMutation(db, state, before, after, operation, input);
}

export function arrangeActionOrder(db: Database.Database, input: MutationInput & {
  currentKeys: string[];
  order: string[];
}): ActionOrderReceipt {
  const normalized = [...new Set(input.order)];
  const operation: ActionOrderOperation = { kind: "arrange", order: normalized };
  const replay = replayReceipt(db, input.requestId, operation);
  if (replay) return replay;
  const state = validateMutation(db, input);
  const before = explicitOrder(input.currentKeys, state.positions);
  if (normalized.length !== input.order.length || !sameMembers(before, normalized)) {
    throw validationError("Batch order must contain every active approved Action exactly once.", {
      expected: before,
      received: input.order
    });
  }
  return finishMutation(db, state, before, normalized, operation, input);
}

export function undoActionOrder(db: Database.Database, input: MutationInput & {
  currentKeys: string[];
  receiptId: string;
}): ActionOrderReceipt {
  const operation: ActionOrderOperation = { kind: "undo", receiptId: input.receiptId };
  const replay = replayReceipt(db, input.requestId, operation);
  if (replay) return replay;
  const state = validateMutation(db, input);
  const targetRow = db.prepare("SELECT receipt_json FROM action_queue_receipts WHERE id = ?").get(input.receiptId) as { receipt_json: string } | undefined;
  if (!targetRow) throw validationError("Action queue receipt was not found.", { receiptId: input.receiptId });
  const target = JSON.parse(targetRow.receipt_json) as ActionOrderReceipt;
  const before = explicitOrder(input.currentKeys, state.positions);
  if (!target.applied || target.revisionAfter !== state.revision || JSON.stringify(target.after) !== JSON.stringify(before)) {
    throw validationError("Action queue undo is stale; only the current applied order can be undone safely.", {
      receiptId: target.id,
      currentRevision: state.revision,
      receiptRevision: target.revisionAfter
    });
  }
  if (!sameMembers(before, target.before)) {
    throw validationError("Action membership changed after this receipt; refresh and arrange the current queue instead.");
  }
  return finishMutation(db, state, before, target.before, operation, input);
}

function validateMutation(db: Database.Database, input: MutationInput): ActionOrderState {
  const state = loadActionOrder(db);
  if (input.expectedRevision !== undefined && input.expectedRevision !== state.revision) {
    throw validationError("Action queue revision changed; refresh before reordering.", {
      expectedRevision: input.expectedRevision,
      actualRevision: state.revision
    });
  }
  return state;
}

function replayReceipt(db: Database.Database, requestId: string, operation: ActionOrderOperation): ActionOrderReceipt | null {
  const existing = db.prepare("SELECT receipt_json FROM action_queue_receipts WHERE request_id = ?").get(requestId) as { receipt_json: string } | undefined;
  if (!existing) return null;
  const receipt = JSON.parse(existing.receipt_json) as ActionOrderReceipt;
  if (JSON.stringify(receipt.operation) !== JSON.stringify(operation)) {
    throw validationError("Action queue request id was already used for a different mutation.", {
      requestId,
      originalOperation: receipt.operation,
      requestedOperation: operation
    });
  }
  return receipt;
}

function finishMutation(
  db: Database.Database,
  state: ActionOrderState,
  before: string[],
  after: string[],
  operation: ActionOrderOperation,
  input: MutationInput
): ActionOrderReceipt {
  const receipt: ActionOrderReceipt = {
    id: `qorder_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
    requestId: input.requestId,
    revisionBefore: state.revision,
    revisionAfter: input.apply ? state.revision + 1 : state.revision,
    before,
    after,
    operation,
    applied: input.apply === true,
    createdAt: new Date().toISOString()
  };
  if (!input.apply) return receipt;
  db.transaction(() => {
    db.prepare("DELETE FROM action_queue_positions").run();
    const insert = db.prepare("INSERT INTO action_queue_positions (action_key, position, created_at, updated_at) VALUES (?, ?, ?, ?)");
    after.forEach((key, position) => insert.run(key, position, receipt.createdAt, receipt.createdAt));
    db.prepare("UPDATE action_queue_state SET revision = ?, updated_at = ? WHERE id = 'portfolio'").run(receipt.revisionAfter, receipt.createdAt);
    db.prepare(`INSERT INTO action_queue_receipts
      (id, request_id, revision_before, revision_after, before_json, after_json, operation_json, receipt_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(receipt.id, receipt.requestId, receipt.revisionBefore, receipt.revisionAfter, JSON.stringify(before), JSON.stringify(after), JSON.stringify(receipt.operation), JSON.stringify(receipt), receipt.createdAt);
  })();
  return receipt;
}

function explicitOrder(currentKeys: string[], positions: Map<string, number>): string[] {
  return [...new Set(currentKeys)].sort((left, right) => {
    const leftPosition = positions.get(left);
    const rightPosition = positions.get(right);
    if (leftPosition !== undefined && rightPosition !== undefined) return leftPosition - rightPosition || left.localeCompare(right);
    if (leftPosition !== undefined) return -1;
    if (rightPosition !== undefined) return 1;
    return currentKeys.indexOf(left) - currentKeys.indexOf(right) || left.localeCompare(right);
  });
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key) => right.includes(key));
}
