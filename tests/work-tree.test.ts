import { describe, expect, it } from "vitest";
import type { WorkItemSummary } from "../src/domain/types.js";
import { orderByParent } from "../src/domain/workTree.js";

function workItem(id: string, parent: string | null = null): WorkItemSummary {
  return {
    id,
    project_id: null,
    milestone_id: null,
    title: id,
    raw_input: id,
    queue: "work_queue",
    work_classification: "agent",
    responsibility: "agent",
    next_action: `Do ${id}`,
    expected_artifact: null,
    status: "open",
    effort: null,
    clarification_status: null,
    gap_type: null,
    open_question: null,
    clarification_source: null,
    confidence: null,
    parent_work_item_id: parent,
    created_at: "2026-07-24T00:00:00.000Z",
    updated_at: "2026-07-24T00:00:00.000Z",
    project_name: null,
    milestone_title: null
  };
}

function shape(items: WorkItemSummary[]): Array<[string, number]> {
  return orderByParent(items).map((row) => [row.item.id, row.depth]);
}

describe("orderByParent", () => {
  it("places subtasks under their parent without reordering parents", () => {
    const items = [workItem("a"), workItem("b"), workItem("a1", "a"), workItem("a2", "a")];

    expect(shape(items)).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a2", 1],
      ["b", 0]
    ]);
  });

  it("keeps a child top-level when its parent is filtered out of this view", () => {
    // A queue listing only holds one queue; a child whose parent sits in another
    // queue must still appear rather than vanish.
    expect(shape([workItem("child", "elsewhere")])).toEqual([["child", 0]]);
  });

  it("nests deeper than one level", () => {
    const items = [workItem("a"), workItem("a1", "a"), workItem("a1a", "a1")];

    expect(shape(items)).toEqual([
      ["a", 0],
      ["a1", 1],
      ["a1a", 2]
    ]);
  });

  it("emits every row exactly once even if the data contains a cycle", () => {
    // The repository refuses to create these, but a hand-edited database must
    // not hang or silently drop work.
    const rows = orderByParent([workItem("x", "y"), workItem("y", "x")]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.item.id).sort()).toEqual(["x", "y"]);
  });

  it("returns an empty list unchanged", () => {
    expect(orderByParent([])).toEqual([]);
  });
});
