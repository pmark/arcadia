import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { evaluateTriggers, type TriggerReport } from "../docs/triggers.js";

export interface TriggersCommandOptions {
  /** The repository to read. Defaults to the working directory. */
  repo: string;
}

/**
 * Every deferral this repository declares, and what each one is doing now.
 *
 * `AGENTS.md` requires a deferral to name the condition that revives it, and
 * the continuation protocol says a firing trigger outranks `current_action`.
 * Until this command existed neither rule had anything to read: the conditions
 * were prose in plans and Decisions, remembered only if someone happened to
 * reread the document at the moment it mattered.
 *
 * A noun. It reads checked-in documents and reports; it never writes, needs no
 * workspace or database, and answers the same way in a fresh clone.
 */
export function runTriggersCommand(options: TriggersCommandOptions): CommandSuccess<TriggerReport> {
  return createSuccess({ command: "triggers", data: evaluateTriggers(options.repo) });
}

export function renderTriggersSuccess(response: CommandSuccess<TriggerReport>): string[] {
  const { triggers, counts, registry, repoRoot } = response.data;
  if (triggers.length === 0) {
    return [
      `No deferrals declared in ${repoRoot}.`,
      registry ? `Registry: ${registry}` : "No .arcadia/triggers.json registry; nothing to evaluate."
    ];
  }

  const lines = [
    `Triggers — ${counts.fired} fired, ${counts.waiting} waiting, ${counts.unevaluable} unevaluable, ${counts.untriggered} untriggered`,
    registry ? `Registry: ${registry}` : "No .arcadia/triggers.json registry; prose deferrals cannot be evaluated."
  ];

  // Fired first: it is the only state that asks for a decision right now.
  for (const state of ["fired", "waiting", "unevaluable", "untriggered"] as const) {
    const group = triggers.filter((trigger) => trigger.state === state);
    if (group.length === 0) continue;
    lines.push("", `${state.toUpperCase()} (${group.length})`);
    for (const trigger of group) {
      lines.push(`  ${trigger.id}${trigger.line ? "" : ""}`);
      if (trigger.watches) lines.push(`    Watches: ${trigger.watches}`);
      lines.push(`    Condition: ${trigger.condition}`);
      if (trigger.fires) lines.push(`    Revives: ${trigger.fires}`);
      lines.push(`    ${trigger.reason}`);
    }
  }

  if (counts.fired > 0) {
    lines.push("", "A fired trigger outranks the current Action. Resolve it before dispatching.");
  }
  return lines;
}
