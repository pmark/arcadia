import { describe, expect, it } from "vitest";
import type { TodoData, TodoItem } from "../src/commands/todo.js";
import { composePacket } from "../src/orientation/composer.js";
import {
  OPERATOR_TODO_PACKET_CAP,
  formatOperatorTodoLines,
  operatorTodoUnavailableLine
} from "../src/orientation/operatorTodoLines.js";

const now = new Date("2026-10-08T12:00:00Z");

function item(n: number, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    key: `decision:arcadia/${n}`,
    kind: "decision",
    title: `Decision ${n}`,
    project: "arcadia",
    blocking: true,
    createdAt: `2026-10-0${(n % 8) + 1}`,
    sourceRef: `docs/decisions/${n}.md`,
    answer: `arcadia decision approve ${n}`,
    ...overrides
  };
}

function todo(items: TodoItem[], overrides: Partial<TodoData> = {}, counts: Partial<TodoData["counts"]> = {}): TodoData {
  const blocking = items.filter((entry) => entry.blocking).length;
  return {
    schema: "arcadia-todo-v1",
    view: "default",
    asOf: { at: now.toISOString(), workspace: "ws", workspacePath: "/ws" },
    counts: {
      blocking,
      other: items.length - blocking,
      stale: 0,
      staleHidden: 0,
      byKind: { decision: items.length, agent_ask: 0 },
      hidden: 0,
      fixture: { projects: 0, items: 0 },
      ...counts
    },
    items,
    unavailable: [],
    ...overrides
  };
}

describe("operator to-do lines in the morning packet", () => {
  it("shows the counts and each blocking item with its answer command", () => {
    const lines = formatOperatorTodoLines(todo([item(1), item(2), item(3, { blocking: false })]));
    expect(lines[0]).toBe("2 blocking · 1 other · 0 stale");
    expect(lines).toContain("Decision 1 → arcadia decision approve 1");
    expect(lines).toContain("Decision 2 → arcadia decision approve 2");
    expect(lines.join("\n")).not.toContain("Decision 3");

    const { body } = composePacket([], now, { operatorTodoLines: lines });
    expect(body).toContain("**Operator to-do**");
    expect(body).toContain("- Decision 1 → arcadia decision approve 1");
  });

  it("shows counts only when nothing blocks", () => {
    const lines = formatOperatorTodoLines(todo([item(1, { blocking: false })]));
    expect(lines).toEqual(["0 blocking · 1 other · 0 stale"]);
  });

  it("lists escalation items first and says they stopped production", () => {
    const lines = formatOperatorTodoLines(
      todo([
        item(1),
        item(2),
        item(3, { kind: "escalation:production-stalled" as TodoItem["kind"], title: "Supervisor stopped overnight", answer: "arcadia escalation answer 3" })
      ])
    );
    expect(lines[1]).toBe("STOPPED: Supervisor stopped overnight → arcadia escalation answer 3");
    expect(lines[2]).toContain("Decision 1");
  });

  it("caps the listed blocking items and points at arcadia todo", () => {
    const many = Array.from({ length: 8 }, (_, index) => item(index + 1));
    const lines = formatOperatorTodoLines(todo(many));
    expect(lines.filter((line) => line.includes("→")).length).toBe(OPERATOR_TODO_PACKET_CAP);
    expect(lines).toContain("3 more: arcadia todo");
  });

  it("clips long titles for a phone", () => {
    const lines = formatOperatorTodoLines(todo([item(1, { title: "x".repeat(300) })]));
    expect(lines[1].length).toBeLessThan(160);
  });

  it("clips a long answer command so the section stays bounded", () => {
    const lines = formatOperatorTodoLines(todo([item(1, { answer: `arcadia ${"y".repeat(400)}` })]));
    const answer = lines[1].split(" → ")[1];
    expect(answer.length).toBe(120);
    expect(answer.endsWith("…")).toBe(true);
  });

  it("degrades to one line when no source could be read", () => {
    const lines = formatOperatorTodoLines(
      todo([], { unavailable: ["workspace sources unavailable: database locked"] })
    );
    expect(lines).toEqual(["to-do unavailable: workspace sources unavailable: database locked"]);
    const { body } = composePacket([], now, { operatorTodoLines: lines });
    expect(body).toContain("- to-do unavailable: workspace sources unavailable: database locked");
  });

  it("formats a thrown failure as the same degraded line", () => {
    expect(operatorTodoUnavailableLine("boom\n  stack")).toBe("to-do unavailable: boom stack");
  });

  it("keeps a partial read visible", () => {
    const lines = formatOperatorTodoLines(todo([item(1)], { unavailable: ["x"] }));
    expect(lines).toContain("partial: 1 source(s) unreadable");
  });

  it("leaves the packet unchanged when no to-do lines are supplied", () => {
    expect(composePacket([], now).body).not.toContain("Operator to-do");
  });
});
