import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { missionControlNodeNotFound, validationError } from "../cli/errors.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import {
  buildMissionControlNodeDetail,
  buildMissionControlOverview,
  type MissionControlNodeDetailData,
  type MissionControlOverviewData
} from "../dashboard/missionControl.js";
import { runOrientationReplyCommand, type OrientationReplyData } from "./orientation.js";
import { runProjectReplyCommand, type ProjectReplyData } from "./project.js";

export function runMissionControlOverviewCommand(options: {
  workspace: string;
}): CommandSuccess<MissionControlOverviewData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const overview = buildMissionControlOverview(db, workspacePath);
    return createSuccess({ command: "mission-control.overview", workspace: workspacePath, data: overview });
  } finally {
    db.close();
  }
}

export function runMissionControlNodeCommand(options: {
  workspace: string;
  nodeId: string;
}): CommandSuccess<MissionControlNodeDetailData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  try {
    const detail = buildMissionControlNodeDetail(db, workspacePath, options.nodeId);
    if (!detail) {
      throw missionControlNodeNotFound(options.nodeId);
    }
    return createSuccess({ command: "mission-control.node", workspace: workspacePath, data: detail });
  } finally {
    db.close();
  }
}

export type MissionControlReplyData =
  | ({ routedTo: "orientation" } & OrientationReplyData)
  | ({ routedTo: "project" } & ProjectReplyData);

/**
 * Dispatches a reply to the right interpreter based on the target node's
 * kind — the dashboard/graph UI calls this one entry point rather than
 * knowing which backend command owns which node kind.
 */
export async function runMissionControlReplyCommand(options: {
  workspace: string;
  nodeId: string;
  text: string;
  source?: "cli" | "dashboard";
}): Promise<CommandSuccess<MissionControlReplyData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  let kind: string | undefined;
  try {
    const detail = buildMissionControlNodeDetail(db, workspacePath, options.nodeId);
    if (!detail) {
      throw missionControlNodeNotFound(options.nodeId);
    }
    kind = detail.kind;
  } finally {
    db.close();
  }

  if (kind === "life_tower" || kind === "life_entry") {
    const response = await runOrientationReplyCommand({
      workspace: options.workspace,
      text: options.text,
      source: options.source === "dashboard" ? "discord" : "cli",
      // Only scope to a specific entry when the reply came from THAT entry's
      // own detail view — at the tower level (e.g. "add a new item") there is
      // no single entry to anchor to.
      focusedEntryId: kind === "life_entry" ? options.nodeId : undefined
    });
    return { ...response, data: { routedTo: "orientation", ...response.data } };
  }

  if (kind === "project") {
    const response = await runProjectReplyCommand({
      workspace: options.workspace,
      projectId: options.nodeId,
      text: options.text,
      source: options.source
    });
    return { ...response, data: { routedTo: "project", ...response.data } };
  }

  throw validationError(`Node "${options.nodeId}" (${kind}) does not have a context channel yet.`, {
    nodeId: options.nodeId,
    kind
  });
}

export function renderMissionControlOverviewSuccess(response: CommandSuccess<MissionControlOverviewData>): string[] {
  const lines = [response.data.headline];
  for (const tower of response.data.towers) {
    lines.push(`${tower.label}: ${tower.statusHeadline}`);
  }
  return lines;
}

export function renderMissionControlNodeSuccess(response: CommandSuccess<MissionControlNodeDetailData>): string[] {
  return [`${response.data.label} — ${response.data.status.headline}`];
}

export function renderMissionControlReplySuccess(response: CommandSuccess<MissionControlReplyData>): string[] {
  return [response.data.echo, `(routed to ${response.data.routedTo})`];
}
