import type { TodoData, TodoItem } from "../commands/todo.js";

/** Blocking items the packet lists before pointing at `arcadia todo`. */
export const OPERATOR_TODO_PACKET_CAP = 5;
const MAX_TITLE_CHARS = 80;
const MAX_REASON_CHARS = 120;
const MAX_ANSWER_CHARS = 120;

/** The one-line degradation the packet shows when the to-do data cannot be built. */
export function operatorTodoUnavailableLine(reason: string): string {
  const flat = reason.replace(/\s+/g, " ").trim() || "unknown error";
  return `to-do unavailable: ${flat.length > MAX_REASON_CHARS ? `${flat.slice(0, MAX_REASON_CHARS - 1)}…` : flat}`;
}

function isEscalation(item: TodoItem): boolean {
  return String(item.kind).startsWith("escalation:");
}

function clip(text: string, max: number = MAX_TITLE_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Packet lines for the operator to-do: counts, then each blocking item with the
 * command that answers it, escalations first so the packet says what stopped
 * production overnight. Pure; compact for a phone; capped with a pointer to
 * `arcadia todo`. When no source could be read it degrades to one line.
 */
export function formatOperatorTodoLines(todo: TodoData, cap: number = OPERATOR_TODO_PACKET_CAP): string[] {
  if (todo.unavailable.length > 0 && todo.items.length === 0 && todo.counts.blocking === 0 && todo.counts.other === 0) {
    // Without a workspace the Ask questions cannot be counted: say so rather than leave a zero to be read as "none".
    return [
      operatorTodoUnavailableLine(todo.unavailable[0] ?? "no source could be read"),
      ...(todo.askUnavailable ? ["Ask questions and Ask-origin tasks are unavailable"] : [])
    ];
  }

  const { counts } = todo;
  const lines = [`${counts.blocking} blocking · ${counts.other} other · ${counts.stale} stale`];

  const blocking = todo.items.filter((item) => item.blocking && !item.staleReason);
  // Stable partition: escalations first, source order (oldest first) within each group.
  const ordered = [...blocking.filter(isEscalation), ...blocking.filter((item) => !isEscalation(item))];
  for (const item of ordered.slice(0, cap)) {
    lines.push(`${isEscalation(item) ? "STOPPED: " : ""}${clip(item.title)} → ${clip(item.answer, MAX_ANSWER_CHARS)}`);
  }

  const unlisted = counts.blocking - Math.min(ordered.length, cap);
  if (unlisted > 0) lines.push(`${unlisted} more: arcadia todo`);
  // Ask questions are counted, not listed: the packet stays short and `arcadia todo` holds the answer commands.
  const asks = counts.askQuestions ?? 0;
  if (asks > 0) lines.push(`${asks} Ask question${asks === 1 ? "" : "s"} need one answer: arcadia todo`);
  if (todo.unavailable.length > 0) lines.push(`partial: ${todo.unavailable.length} source(s) unreadable`);
  return lines;
}
