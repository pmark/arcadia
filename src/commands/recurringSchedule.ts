import { readFileSync, statSync } from "node:fs";
import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { registerRecurringSchedule, recurringScheduleStatus, retryRecurringOccurrence, setRecurringScheduleEnabled, tickRecurringSchedules } from "../recurring/scheduler.js";

export interface RecurringCommandOptions { workspace: string; file?: string; id?: string; occurrence?: string; }
export type RecurringCommand = "register" | "recurring" | "enable" | "pause" | "tick" | "retry";
export function runRecurringScheduleCommand(command: RecurringCommand, options: RecurringCommandOptions): CommandSuccess<unknown> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = command === "recurring"
    ? withReadOnlyDatabase(workspacePath, (db) => recurringScheduleStatus(db))
    : withDatabase(workspacePath, (db) => {
      if (command === "register") {
        if (!options.file) throw validationError("Provide --file with a schedule JSON definition.");
        if (statSync(options.file).size > 65_536) throw validationError("Schedule file exceeds 64 KiB.");
        let definition: unknown;
        try { definition = JSON.parse(readFileSync(options.file, "utf8")); }
        catch { throw validationError("Schedule file must contain valid JSON."); }
        return registerRecurringSchedule(db, definition);
      }
      if (command === "tick") return { receipts: tickRecurringSchedules(db) };
      if (!options.id) throw validationError("Provide a recurring schedule id.");
      if (command === "retry") {
        if (!options.occurrence) throw validationError("Provide --occurrence YYYY-MM-DD.");
        retryRecurringOccurrence(db, options.id, options.occurrence);
        return { id: options.id, occurrence: options.occurrence, retryReady: true };
      }
      setRecurringScheduleEnabled(db, options.id, command === "enable");
      return { id: options.id, enabled: command === "enable" };
    });
  return createSuccess({ command: `schedule.${command}`, workspace: workspacePath, data });
}
export function renderRecurringScheduleSuccess(response: CommandSuccess<unknown>): string[] {
  return [JSON.stringify(response.data, null, 2)];
}
