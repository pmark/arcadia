import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { setDeclaredGateStatus, type GateStatusChange } from "../northStar/document.js";
import type { GateStatus } from "../northStar/types.js";

export interface GateCommandData extends GateStatusChange {}

/**
 * `arcadia gate complete` / `arcadia gate reopen` — mark one operator-owned
 * gate on the declared North Star.
 *
 * Two verbs rather than one toggle, because a command that flips whatever it
 * finds cannot be run twice safely and reads ambiguously in a Log. The screen
 * still presents it as a single tap; it just decides which verb it means.
 *
 * Reopen exists for the same reason the tap has to be cheap: a mark that
 * cannot be undone is a mark people hesitate over, and hesitation is exactly
 * the friction this removes.
 */
export function runGateStatusCommand(options: {
  workspace: string;
  gateId: string;
  status: GateStatus;
}): CommandSuccess<GateCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const change = setDeclaredGateStatus(workspacePath, options.gateId, options.status);
  return createSuccess({
    command: `gate.${options.status === "done" ? "complete" : "reopen"}`,
    workspace: workspacePath,
    data: change,
    artifacts: [change.path]
  });
}

export function renderGateSuccess(response: CommandSuccess<GateCommandData>): string[] {
  const { title, previous, next, changed } = response.data;

  if (!changed) {
    return [`"${title}" is already ${next}.`];
  }

  return [
    next === "done" ? `✅ ${title}` : `↩︎ ${title}`,
    `   ${previous} → ${next}`,
    "",
    "Run `arcadia now` to see the remaining distance."
  ];
}
