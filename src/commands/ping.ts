import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import {
  listPendingOperatorPings,
  markOperatorPingSent,
  queueOperatorPing,
  type OperatorPing,
  type QueuedOperatorPing
} from "../ping/operatorPing.js";

export interface PingSendOptions {
  workspace: string;
  message: string;
  kind?: string;
  channel?: string;
  link?: string;
  todo?: string;
  agent?: string;
}

export function runPingSendCommand(options: PingSendOptions): CommandSuccess<QueuedOperatorPing> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const queued = withDatabase(workspacePath, (db) => queueOperatorPing(db, options));
  return createSuccess({ command: "ping.send", workspace: workspacePath, data: queued });
}

export function renderPingSendSuccess(response: CommandSuccess<QueuedOperatorPing>): string[] {
  const { ping, deduplicated, warnings } = response.data;
  const destination = ping.channel ? `channel "${ping.channel}"` : "the default channel";
  return [
    deduplicated
      ? `Ping ${ping.id} already queued for ${destination} within the last 10 minutes; not queued again.`
      : `Ping ${ping.id} queued for ${destination}. The Discord bot delivers it on its next poll.`,
    ...(warnings ?? []).map((warning) => `Warning: ${warning}`)
  ];
}

export function runPingPendingCommand(options: { workspace: string }): CommandSuccess<{ pings: OperatorPing[] }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const pings = withDatabase(workspacePath, (db) => listPendingOperatorPings(db));
  return createSuccess({ command: "ping.pending", workspace: workspacePath, data: { pings } });
}

export function renderPingPendingSuccess(response: CommandSuccess<{ pings: OperatorPing[] }>): string[] {
  if (response.data.pings.length === 0) return ["No operator pings are pending Discord delivery."];
  return response.data.pings.map((ping) =>
    `${ping.id} · ${ping.kind} · ${ping.channel ?? "default"}: ${ping.message}${ping.link ? ` ${ping.link}` : ""}`);
}

export function runPingSentCommand(options: {
  workspace: string;
  id: string;
  messageId: string;
}): CommandSuccess<{ pingId: string; messageId: string }> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  withDatabase(workspacePath, (db) => markOperatorPingSent(db, options.id, options.messageId));
  return createSuccess({
    command: "ping.sent",
    workspace: workspacePath,
    data: { pingId: options.id, messageId: options.messageId }
  });
}

export function renderPingSentSuccess(response: CommandSuccess<{ pingId: string; messageId: string }>): string[] {
  return [`Operator ping ${response.data.pingId} recorded as delivered (${response.data.messageId}).`];
}
