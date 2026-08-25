import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase } from "../db/connection.js";
import { computeNowBrief } from "../northStar/compute.js";
import { loadNorthStar, NorthStarParseError } from "../northStar/document.js";
import { computePathBrief, type PathBrief, type PathLeg } from "../northStar/path.js";

export interface PathCommandData extends PathBrief {}

/**
 * `arcadia path` — everything documented between today and the declared
 * target, in dependency order.
 *
 * A noun: it reads managed documents and the records derived from them, and
 * writes nothing. The dashboard's `/path` renders exactly this payload.
 */
export function runPathCommand(options: { workspace: string }): CommandSuccess<PathCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);

  let northStar = null;
  const loadWarnings: string[] = [];
  try {
    northStar = loadNorthStar(workspacePath);
  } catch (error) {
    if (error instanceof NorthStarParseError) {
      loadWarnings.push(error.message);
    } else {
      throw error;
    }
  }

  const data = withDatabase(workspacePath, (db) => {
    // Gate resolution already exists and is the thing the Now screen trusts;
    // recomputing it here would create a second answer to the same question.
    const brief = computeNowBrief(db, northStar, {});
    const path = computePathBrief(db, northStar, brief.gates);
    path.warnings.unshift(...loadWarnings);
    return path;
  });

  return createSuccess({ command: "path", workspace: workspacePath, data });
}

const MARK: Record<string, string> = {
  done: "[x]",
  in_progress: "[~]",
  blocked: "[!]",
  planned: "[ ]"
};

export function renderPathSuccess(response: CommandSuccess<PathCommandData>): string[] {
  const data = response.data;
  if (!data.target.declared) return data.warnings;

  const lines: string[] = [data.target.text.toUpperCase(), `Done when: ${data.target.looksLike}`, ""];
  lines.push(
    `${data.totals.remaining} step${data.totals.remaining === 1 ? "" : "s"} left across ${data.totals.gates} gates` +
      (data.totals.gaps > 0 ? `  ·  ${data.totals.gaps} unplanned` : "")
  );
  lines.push("");

  for (const leg of data.legs) {
    lines.push(...renderLeg(leg));
    lines.push("");
  }

  if (data.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of data.warnings) lines.push(`  ${warning}`);
  }
  return lines;
}

function renderLeg(leg: PathLeg): string[] {
  const head = `${MARK[leg.gateStatus] ?? "[ ]"} ${leg.gateTitle}`;
  const lines = [head];
  for (const node of leg.nodes) {
    if (node.kind === "gap") {
      lines.push(`      ??  ${node.detail}`);
      continue;
    }
    lines.push(`      ${MARK[node.state]} ${node.title}${node.projectName ? ` · ${node.projectName}` : ""}`);
  }
  return lines;
}
