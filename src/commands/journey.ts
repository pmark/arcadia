import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { execFileSync } from "node:child_process";
import { deriveJourney, splitActionKey, type IntegrationLookup } from "../journey/derive.js";
import type { Journey, JourneyEvent } from "../journey/schema.js";

/**
 * `arcadia journey <project>/<action>`: one Action's rover journey (past,
 * now, ahead). A noun: it opens the workspace database read-only, makes no
 * model or network call and writes nothing. The dashboard's
 * `/journey/[project]/[action]` renders exactly this payload.
 */
export function runJourneyCommand(options: { actionKey: string; workspace?: string; now?: Date }): CommandSuccess<Journey> {
  try {
    splitActionKey(options.actionKey);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : String(error));
  }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db) => deriveJourney(db, options.actionKey, options.now ?? new Date(), { integration: gitIntegration }));
  return createSuccess({ command: "journey", workspace: workspacePath, data, warnings: data.warnings });
}

const GLYPH: Record<JourneyEvent["kind"], string> = { launch: "•", victory: "◆", cleared: "△", obstacle: "▲", gate: "○", now: "◉" };

export function renderJourneySuccess(response: CommandSuccess<Journey>): string[] {
  const journey = response.data;
  const lines = [`${journey.action.key}`, `Destination: ${journey.destination.label}${journey.destination.reached ? " (reached)" : ""}`, ""];
  for (const event of journey.events) lines.push(line(event));
  if (journey.now) lines.push(line(journey.now));
  if (journey.gate) lines.push(line(journey.gate));
  const { reviewAttempts, repairRounds } = journey.budget;
  lines.push("", `Budget: review attempts ${reviewAttempts.spent}/${reviewAttempts.limit}${reviewAttempts.inUse ? ` (+${reviewAttempts.inUse} live)` : ""}, repair rounds ${repairRounds.spent}/${repairRounds.limit}`);
  for (const branch of journey.ahead) lines.push(`Ahead${branch.likely ? "" : " (less likely)"}${branch.available ? "" : " [closed]"}: ${branch.label}`);
  return lines;
}

function line(event: JourneyEvent): string {
  const tag = event.class ? ` [${event.class}]` : "";
  return `${GLYPH[event.kind]} ${event.at.slice(0, 16).replace("T", " ")}  ${event.label}${tag} — ${event.detail}`;
}

/**
 * Read-only local Git: is `head` in the repository's local base branch, and
 * which first-parent commit brought it there? No fetch and no network: the
 * worker's base-branch sync keeps the local branch current.
 */
export const gitIntegration: IntegrationLookup = ({ repositoryPath, head, baseBranch }) => {
  const git = (args: string[]) => execFileSync("git", ["-C", repositoryPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
  const base = `refs/heads/${baseBranch}`;
  try {
    git(["merge-base", "--is-ancestor", head, base]);
  } catch {
    return null;
  }
  try {
    // The oldest first-parent commit of the base that descends from head is the one that landed it.
    const descendants = new Set(git(["rev-list", "--ancestry-path", `${head}..${base}`]).split("\n").filter(Boolean));
    let commit = head;
    for (const candidate of git(["rev-list", "--first-parent", base]).split("\n")) {
      if (!descendants.has(candidate)) break;
      commit = candidate;
    }
    return { commit, at: new Date(git(["log", "-1", "--format=%cI", commit])).toISOString() };
  } catch {
    return null;
  }
};
