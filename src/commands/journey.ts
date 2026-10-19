import { validationError } from "../cli/errors.js";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { execFileSync } from "node:child_process";
import type Database from "better-sqlite3";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProjectBySlug } from "../db/repositories.js";
import { discoverDocs } from "../docs/discover.js";
import type { PlanDoc, ProjectDoc } from "../docs/types.js";
import { projectRepositoryRoot } from "../scheduling/schedule.js";
import { deriveJourney, splitActionKey, type IntegrationLookup } from "../journey/derive.js";
import type { Journey, JourneyEvent } from "../journey/schema.js";

/**
 * `arcadia journey <project>/<action>`: one Action's rover journey (past,
 * now, ahead). A noun: it opens the workspace database read-only, makes no
 * model or network call and writes nothing. The dashboard's
 * `/journey/[project]/[action]` renders exactly this payload.
 *
 * `<project>/current` follows the Project's `current_action` pointer (or its
 * active Plan's), read from the checked-in documents the same way the
 * scheduler reads them, so one bookmark keeps following the active rover.
 */
export function runJourneyCommand(options: { actionKey: string; workspace?: string; now?: Date }): CommandSuccess<Journey> {
  try {
    splitActionKey(options.actionKey);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : String(error));
  }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db) => {
    const [project, action] = splitActionKey(options.actionKey);
    const actionKey = action === CURRENT ? `${getProjectBySlug(db, project)?.slug ?? project}/${currentActionOf(db, project)}` : options.actionKey;
    return deriveJourney(db, actionKey, options.now ?? new Date(), { integration: gitIntegration });
  });
  return createSuccess({ command: "journey", workspace: workspacePath, data, warnings: data.warnings });
}

/** The action segment that means "the Project's current Action" (so an Action literally named `current` is reachable only through the pointer). */
export const CURRENT = "current";

/** The Project's `current_action` pointer, or its active Plan's; read-only. */
export function currentActionOf(db: Database.Database, projectSlug: string): string {
  const project = getProjectBySlug(db, projectSlug);
  if (!project) throw validationError(`No Project "${projectSlug}" in this workspace.`);
  const root = projectRepositoryRoot(db, project);
  if (!root) throw validationError(`Project "${projectSlug}" has no usable repository path, so its current Action cannot be read.`);
  // The record's own slug: the lookup above ignores case, the documents do not.
  const slug = project.slug ?? projectSlug;
  const docs = discoverDocs(root).docs;
  const projectDoc = docs.find((doc): doc is ProjectDoc => doc.type === "project" && doc.slug === slug) ?? null;
  const plan = projectDoc?.activePlan
    ? docs.find((doc): doc is PlanDoc => doc.type === "plan" && doc.project === slug && doc.slug === projectDoc.activePlan) ?? null
    : null;
  const current = projectDoc?.currentAction ?? plan?.currentAction ?? null;
  if (!current) throw validationError(`Project "${projectSlug}" has no current Action.`);
  return current;
}

const GLYPH: Record<JourneyEvent["kind"], string> = { launch: "•", victory: "◆", cleared: "△", obstacle: "▲", gate: "○", now: "◉" };

export function renderJourneySuccess(response: CommandSuccess<Journey>): string[] {
  const journey = response.data;
  const lines = [
    `${journey.action.key}`,
    `Now: ${journey.activity.headline}${journey.activity.since ? ` (since ${journey.activity.since.slice(0, 16).replace("T", " ")} UTC)` : ""} — ${journey.activity.detail}`,
    `Destination: ${journey.destination.label}${journey.destination.reached ? " (reached)" : ""}`,
    ""
  ];
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
 * worker's base-branch sync keeps the local branch current. A squash or
 * rebase merge never makes the head an ancestor, so such an arrival is only
 * seen through the worker's own merge record. Returns null when the head is
 * not in the base branch; throws when Git itself cannot answer.
 */
export const gitIntegration: IntegrationLookup = ({ repositoryPath, head, baseBranch }) => {
  const git = (args: string[]) => execFileSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, maxBuffer: 64 * 1024 * 1024
  }).trim();
  const base = `refs/heads/${baseBranch}`;
  try {
    git(["merge-base", "--is-ancestor", head, base]);
  } catch (error) {
    // Exit 1 is Git's "not an ancestor"; anything else is Git failing to answer.
    if ((error as { status?: number }).status === 1) return null;
    throw new Error(`git merge-base in ${repositoryPath} failed: ${String((error as { stderr?: unknown }).stderr ?? error).trim()}`, { cause: error });
  }
  // The oldest first-parent commit of the base that descends from head is the
  // one that landed it. It is among head's descendants, so the walk is bounded
  // by their count rather than by the length of the base's history.
  const descendants = new Set(git(["rev-list", "--ancestry-path", `${head}..${base}`]).split("\n").filter(Boolean));
  let commit = head;
  for (const candidate of git(["rev-list", "--first-parent", `--max-count=${descendants.size + 1}`, base]).split("\n")) {
    if (!descendants.has(candidate)) break;
    commit = candidate;
  }
  return { commit, at: new Date(git(["log", "-1", "--format=%cI", commit])).toISOString() };
};
