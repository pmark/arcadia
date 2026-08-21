import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase, withDatabase } from "../db/connection.js";
import { ATTENTION_WINDOW_DAYS, computeNowBrief } from "../northStar/compute.js";
import { loadNorthStar, NorthStarParseError, NORTH_STAR_FILENAME } from "../northStar/document.js";
import { collectNarrativeEvidence, createIntelligenceNowNarrator } from "../northStar/narrative.js";
import type { NowBrief } from "../northStar/types.js";

export interface NowCommandData extends NowBrief {}

/**
 * `arcadia now` — the one-screen answer to "how far am I from the thing that
 * matters, and what do I do about it in the next hour?".
 *
 * A noun: it reads state and writes nothing but the Intelligence job row its
 * own narrative produces. The dashboard's `/now` renders exactly this payload,
 * so the terminal and the phone can never disagree about the distance.
 */
export async function runNowCommand(options: {
  workspace: string;
  narrate?: boolean;
  windowDays?: number;
}): Promise<CommandSuccess<NowCommandData>> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const windowDays = options.windowDays ?? ATTENTION_WINDOW_DAYS;

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

  const brief = withDatabase(workspacePath, (db) => computeNowBrief(db, northStar, { windowDays }));
  brief.warnings.unshift(...loadWarnings);

  // The narrative is the only model-bearing step, and it is opt-in for a
  // reason: everything above is deterministic and instant, so a stalled or
  // absent Intelligence service degrades the screen rather than breaking it.
  if (options.narrate) {
    // Held open explicitly rather than through `withDatabase`, which closes on
    // the synchronous return and would pull the connection out from under the
    // Intelligence worker mid-poll.
    const db = openDatabase(workspacePath);
    try {
      const evidence = collectNarrativeEvidence(db, brief, windowDays);
      brief.reality =
        evidence.perProject.length === 0
          ? null
          : await createIntelligenceNowNarrator(db, workspacePath)(evidence);
    } catch (error) {
      brief.warnings.push(
        `Narrative unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      db.close();
    }
  }

  return createSuccess({ command: "now", workspace: workspacePath, data: brief });
}

export function renderNowSuccess(response: CommandSuccess<NowCommandData>): string[] {
  const brief = response.data;
  const lines: string[] = [];

  if (!brief.target.declared) {
    lines.push("No North Star declared.");
    lines.push("");
    lines.push(`Write ${NORTH_STAR_FILENAME} in the workspace with \`target\`, \`project\`, \`looks_like\`, and \`gates\`.`);
    lines.push("");
    lines.push(`DO THIS: ${brief.theOneThing.doThis}`);
    return lines;
  }

  lines.push(brief.target.text.toUpperCase());
  if (brief.target.looksLike) {
    lines.push(`Done when: ${brief.target.looksLike}`);
  }
  lines.push("");

  const { done, total, remaining } = brief.distance;
  lines.push(`${remaining} gate${remaining === 1 ? "" : "s"} away  ·  ${done}/${total} done  ${bar(brief.distance.fraction)}`);
  lines.push("");

  if (brief.reality) {
    lines.push(brief.reality.headline);
    lines.push(wrap(brief.reality.paragraph));
    lines.push("");
  }

  lines.push(wrap(brief.drift.line));
  lines.push("");

  lines.push("DO THIS NOW");
  lines.push(`  ${wrap(brief.theOneThing.doThis, 2)}`.trimEnd());
  lines.push(`  → ${brief.theOneThing.unlocks}`);

  if (brief.fifteenMinutes) {
    lines.push("");
    lines.push("Only got 15 minutes?");
    lines.push(`  ${wrap(brief.fifteenMinutes.doThis, 2)}`.trimEnd());
  }

  lines.push("");
  lines.push(`Where the last ${brief.attention.windowDays} days went:`);
  for (const slice of brief.attention.slices.filter((entry) => entry.commits > 0)) {
    const marker = slice.isTarget ? "★" : " ";
    lines.push(
      `  ${marker} ${slice.projectName.padEnd(22)} ${String(Math.round(slice.share * 100)).padStart(3)}%  ${"▇".repeat(Math.max(0, Math.round(slice.share * 24)))}`
    );
  }

  if (brief.owed.onTarget.length > 0) {
    lines.push("");
    lines.push(`Answers ${brief.target.projectName ?? "the target"} is waiting on:`);
    for (const decision of brief.owed.onTarget) {
      lines.push(`  ${decision.slug} — ${truncate(decision.question, 88)}`);
    }
  }

  lines.push("");
  lines.push("Gates:");
  for (const gate of brief.gates) {
    lines.push(`  ${gateMark(gate.status)} ${gate.title}`);
  }

  if (brief.warnings.length > 0) {
    lines.push("");
    for (const warning of brief.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  return lines;
}

function gateMark(status: string): string {
  switch (status) {
    case "done":
      return "[x]";
    case "in_progress":
      return "[~]";
    case "blocked":
      return "[!]";
    case "unknown":
      return "[?]";
    default:
      return "[ ]";
  }
}

function bar(fraction: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `${"▇".repeat(filled)}${"·".repeat(width - filled)}`;
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function wrap(text: string, indent = 0, width = 78): string {
  const pad = " ".repeat(indent);
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width - indent) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) {
    out.push(line);
  }
  return out.join(`\n${pad}`);
}
