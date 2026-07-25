import type { WorkItemSummary } from "./types.js";

export interface WorkTreeRow {
  item: WorkItemSummary;
  /** 0 for a top-level Action, 1 for its subtask, and so on. */
  depth: number;
}

/**
 * Order a flat list of Actions so subtasks follow their parent, without
 * inventing or hiding rows.
 *
 * A child is only indented when its parent is present in the same list. Queue
 * views are filtered — a parent in `work_queue` and its child in `blocked` are
 * legitimately separate — so a child whose parent is absent from this view
 * renders at top level rather than vanishing or dragging its parent into a
 * queue it isn't in.
 *
 * Input order is otherwise preserved, so whatever ordering the query chose
 * (recency, status) still governs siblings.
 */
export function orderByParent(items: WorkItemSummary[]): WorkTreeRow[] {
  const present = new Set(items.map((item) => item.id));
  const childrenByParent = new Map<string, WorkItemSummary[]>();
  const roots: WorkItemSummary[] = [];

  for (const item of items) {
    const parentId = item.parent_work_item_id;
    if (parentId && present.has(parentId) && parentId !== item.id) {
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.push(item);
      childrenByParent.set(parentId, siblings);
    } else {
      roots.push(item);
    }
  }

  const rows: WorkTreeRow[] = [];
  const emitted = new Set<string>();

  const emit = (item: WorkItemSummary, depth: number): void => {
    // The repository rejects parent cycles, but a listing must not hang even if
    // a database is edited by hand.
    if (emitted.has(item.id)) {
      return;
    }
    emitted.add(item.id);
    rows.push({ item, depth });
    for (const child of childrenByParent.get(item.id) ?? []) {
      emit(child, depth + 1);
    }
  };

  for (const root of roots) {
    emit(root, 0);
  }

  // Anything left unreachable (only possible via a hand-made cycle) still gets
  // shown rather than silently dropped.
  for (const item of items) {
    emit(item, 0);
  }

  return rows;
}
