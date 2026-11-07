import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import {
  listOperatorInteractions,
  recordOperatorInteraction,
  type OperatorInteractionRecord
} from "../operatorInteractions/store.js";

export interface OperatorInteractionRecordOptions {
  workspace: string;
  words: string;
  unlocked: string;
  required?: boolean;
  avoidable?: boolean;
  ref?: string;
  project?: string;
  at?: string;
  waitingSince?: string;
  agent?: string;
  now?: Date;
}

/** Append one operator interaction an agent acted on (the operator's words in chat). Never edits or removes one. */
export function runOperatorInteractionRecordCommand(
  options: OperatorInteractionRecordOptions
): CommandSuccess<{ interaction: OperatorInteractionRecord; created: boolean }> {
  if (Boolean(options.required) === Boolean(options.avoidable)) {
    throw validationError("Say exactly one of --required (only the operator's authority could do it) or --avoidable.", {});
  }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const result = recordOperatorInteraction(db, {
      words: options.words,
      unlocked: options.unlocked,
      necessity: options.required ? "required" : "avoidable",
      ref: options.ref ?? null,
      project: options.project ?? null,
      at: options.at,
      waitingSince: options.waitingSince ?? null,
      recordedBy: options.agent ?? null,
      ...(options.now ? { now: options.now } : {})
    });
    return createSuccess({ command: "operator-interaction.record", workspace: workspacePath, data: result });
  } finally {
    db.close();
  }
}

export function renderOperatorInteractionRecordSuccess(
  response: CommandSuccess<{ interaction: OperatorInteractionRecord; created: boolean }>
): string[] {
  const { interaction, created } = response.data;
  return [
    `${created ? "Recorded" : "Already recorded"} ${interaction.id} (${interaction.necessity}) at ${interaction.at}.`,
    `Words: "${interaction.words}"`,
    `Unlocked: ${interaction.unlocked}${interaction.ref ? ` (${interaction.ref})` : ""}`
  ];
}

export interface OperatorInteractionListOptions {
  workspace: string;
  since?: string;
  until?: string;
  now?: Date;
}

export function runOperatorInteractionListCommand(
  options: OperatorInteractionListOptions
): CommandSuccess<{ interactions: OperatorInteractionRecord[] }> {
  const now = options.now ?? new Date();
  const start = instant(options.since ?? new Date(now.getTime() - 7 * 86_400_000).toISOString(), "since");
  const end = instant(options.until ?? new Date(now.getTime() + 60_000).toISOString(), "until");
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    return createSuccess({
      command: "operator-interaction.list",
      workspace: workspacePath,
      data: { interactions: listOperatorInteractions(db, { start, end }) }
    });
  } finally {
    db.close();
  }
}

export function renderOperatorInteractionListSuccess(
  response: CommandSuccess<{ interactions: OperatorInteractionRecord[] }>
): string[] {
  const { interactions } = response.data;
  if (interactions.length === 0) return ["No recorded operator interactions in this range."];
  return interactions.map((item) =>
    `${item.at} · ${item.necessity} · "${item.words}" → ${item.unlocked}${item.ref ? ` (${item.ref})` : ""}`);
}

function instant(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw validationError(`--${field} must be a valid ISO-8601 instant.`, { [field]: value });
  return parsed.toISOString();
}
