import { existsSync } from "node:fs";

import { ArcadiaError, projectNotFound } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import { getProject, getProjectBySlug, getProjectMetadata, listProjects } from "../db/repositories.js";
import { resolveDispatch, resolveReadySet } from "../docs/dispatch.js";
import { discoverDocs } from "../docs/discover.js";
import { classifyOperatorItems, type OperatorGateItem } from "../docs/operatorGate.js";
import { listUnsettledAgentAskProposals } from "../ask/settlement.js";
import { resolveOperatorGate } from "../ask/operatorGate.js";

export const TODO_SCHEMA = "arcadia-todo-v1";
export const AGENT_ASK_CAVEAT =
  "Agent Asks are listed while unsettled, not verified as still live; stale filtering arrives in a later slice.";
/** Non-blocking items the default view shows before pointing at `--all`. */
export const TODO_OTHER_CAP = 5;

export interface TodoCommandOptions {
  /** Workspace path, or undefined to let Arcadia resolve it. */
  workspace?: string;
  /** Project id or slug; omitted means every Project. */
  project?: string;
  /** Show every non-blocking item instead of the oldest few. */
  all?: boolean;
  /** Injected for deterministic output in tests. */
  now?: Date;
  /** The checkout read when no workspace resolves. Defaults to the directory the operator stands in. */
  repoRoot?: string;
}

export interface TodoItem {
  /** `<kind>:<project>/<source-id>`: Decision ids are per Project, so the Project is part of the identity. Stable while the item is pending. */
  key: string;
  kind: "decision" | "agent_ask";
  /** The source's own words: a Decision's question or an Agent Ask's desired result. */
  title: string;
  project: string;
  blocking: boolean;
  /** A Decision's `updated` date (Decisions carry no creation time); an Agent Ask's creation time. */
  createdAt: string;
  /** The Decision's document path, or `agent_ask_proposals:<id>`. */
  sourceRef: string;
  /** The existing canonical command that answers it. Nothing here runs it. */
  answer: string;
}

export interface TodoCounts {
  blocking: number;
  other: number;
  /** Totals by kind across every item found, shown or not. */
  byKind: { decision: number; agent_ask: number };
  /** Non-blocking items left out of `items` because the cap applies. */
  hidden: number;
}

export interface TodoData {
  schema: typeof TODO_SCHEMA;
  asOf: { at: string; workspace: string | null };
  counts: TodoCounts;
  items: TodoItem[];
  /** One line per source this run could not read. Empty means every slice-1 source was read. */
  unavailable: string[];
}

function toItem(item: OperatorGateItem, blocking: boolean): TodoItem {
  return {
    key: `${item.kind}:${item.projectSlug || "unknown"}/${item.id}`,
    kind: item.kind,
    title: item.title,
    project: item.projectSlug,
    blocking,
    createdAt: item.timestamp,
    sourceRef: item.relativePath ?? `agent_ask_proposals:${item.id}`,
    answer: item.settleCommand
  };
}

/** Oldest first; the key breaks ties so the order never depends on source iteration. */
function byAge(a: TodoItem, b: TodoItem): number {
  return a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key);
}

/** The same classification `arcadia next` applies to one Project, over a repository and (optionally) a database. */
function gateForProject(
  db: Parameters<typeof resolveOperatorGate>[0]["db"],
  repoRoot: string,
  projectSlug: string
): { blocking: OperatorGateItem[]; alerts: OperatorGateItem[] } {
  const dispatch = resolveDispatch(repoRoot, projectSlug);
  const readySet = resolveReadySet(repoRoot, projectSlug);
  return resolveOperatorGate({
    db,
    repoRoot,
    projectSlug,
    selectedActionId: dispatch.context?.action.id ?? null,
    readySetCandidates: readySet.candidates
  });
}

function collect(gate: { blocking: OperatorGateItem[]; alerts: OperatorGateItem[] }): TodoItem[] {
  return [...gate.blocking.map((item) => toItem(item, true)), ...gate.alerts.map((item) => toItem(item, false))];
}

/** The remedy line for a workspace that could not be read, in the existing errors' own words where they have them. */
function workspaceRemedy(error: unknown): string {
  if (error instanceof ArcadiaError) {
    const remedy = error.details?.remedy;
    if (typeof remedy === "string" && remedy.length > 0) return remedy;
    if (error.code === "USAGE_ERROR") {
      return "pass --workspace <path>, set ARCADIA_WORKSPACE=<path> inline on this command, or run from inside an initialized workspace";
    }
    if (error.code === "WORKSPACE_NOT_FOUND") {
      return `no workspace at ${String(error.details?.workspace ?? "the given path")}; check --workspace or create it with arcadia init <path>`;
    }
    if (error.code === "DATABASE_NOT_INITIALIZED") {
      return `${String(error.details?.databasePath ?? "the workspace database")} is not initialized; run arcadia init <workspace>`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Everything the operator owes an answer on, as a derived view.
 *
 * Slice 1 reads two sources: open Decisions (checked-in documents) and
 * unsettled Agent Ask proposals (the workspace database, opened read-only).
 * Blocking versus alert is `arcadia next`'s own classification, reached
 * through the same `resolveOperatorGate`. Nothing is stored, nothing is
 * written, and no command is run: `answer` is text the operator can run.
 */
export function runTodoCommand(options: TodoCommandOptions): CommandSuccess<TodoData> {
  const at = (options.now ?? new Date()).toISOString();
  const unavailable: string[] = [];
  let items: TodoItem[] = [];
  let workspacePath: string | null = null;

  let resolved: string | null = null;
  try {
    resolved = resolveReadyWorkspace(options.workspace).workspacePath;
  } catch (error) {
    if (error instanceof ArcadiaError && error.code === "PROJECT_NOT_FOUND") throw error;
    unavailable.push(`workspace sources unavailable: ${workspaceRemedy(error)}`);
  }

  if (resolved) {
    try {
      items = readWithWorkspace(resolved, options, unavailable);
      workspacePath = resolved;
    } catch (error) {
      if (error instanceof ArcadiaError && error.code === "PROJECT_NOT_FOUND") throw error;
      // Never a silently partial list: the failure becomes a line, and the
      // Decisions in the checkout in hand are still read below.
      unavailable.push(`workspace sources unavailable: ${workspaceRemedy(error)}`);
      items = [];
    }
  }

  if (!workspacePath) {
    items = readDecisionsOnly(options.repoRoot ?? invocationRoot(), options.project, unavailable);
  }

  const blocking = items.filter((item) => item.blocking).sort(byAge);
  const other = items.filter((item) => !item.blocking).sort(byAge);
  const shownOther = options.all ? other : other.slice(0, TODO_OTHER_CAP);

  return createSuccess({
    command: "todo",
    workspace: workspacePath ?? undefined,
    data: {
      schema: TODO_SCHEMA,
      asOf: { at, workspace: workspacePath },
      counts: {
        blocking: blocking.length,
        other: other.length,
        byKind: {
          decision: items.filter((item) => item.kind === "decision").length,
          agent_ask: items.filter((item) => item.kind === "agent_ask").length
        },
        hidden: other.length - shownOther.length
      },
      items: [...blocking, ...shownOther],
      unavailable
    }
  });
}

function readWithWorkspace(workspacePath: string, options: TodoCommandOptions, unavailable: string[]): TodoItem[] {
  return withReadOnlyDatabase(workspacePath, (db) => {
    let projects = listProjects(db).filter((project) => project.status !== "completed");
    if (options.project) {
      const wanted = getProject(db, options.project) ?? getProjectBySlug(db, options.project);
      if (!wanted) throw projectNotFound(options.project);
      projects = [wanted];
    }

    const items: TodoItem[] = [];
    for (const project of projects) {
      const repoPath = getProjectMetadata(db, project.id)?.repo_path?.trim();
      if (!repoPath || !existsSync(repoPath)) {
        unavailable.push(
          `project sources unavailable: ${project.slug} has ${repoPath ? `no repository at ${repoPath}` : "no repo_path"}; ` +
            `its Decisions were not read (arcadia project metadata ${project.id} --repo-path <path>)`
        );
        // Agent Asks need no repository: classify them without Decisions.
        items.push(...collect(classifyAsksOnly(db, project.slug)));
        continue;
      }
      items.push(...collect(gateForProject(db, repoPath, project.slug)));
    }

    // Agent Asks naming a Project outside this list are still the operator's.
    // They cannot be blocking (no dispatch resolves for them), so they are
    // listed as alerts rather than dropped.
    if (!options.project) {
      const known = new Set(projects.map((project) => project.slug.toLowerCase()));
      const strays = new Set(
        listUnsettledAgentAskProposals(db)
          .map((row) => row.proposal.normalized.project)
          .filter((slug) => !known.has(slug.toLowerCase()))
      );
      for (const slug of strays) items.push(...collect(classifyAsksOnly(db, slug)));
    }
    return items;
  });
}

function classifyAsksOnly(db: Parameters<typeof listUnsettledAgentAskProposals>[0], projectSlug: string) {
  return classifyOperatorItems({
    projectSlug,
    selectedActionId: null,
    decisions: [],
    agentAsks: listUnsettledAgentAskProposals(db).map((row) => ({
      proposalId: row.id,
      requestId: row.requestId,
      projectSlug: row.proposal.normalized.project,
      desiredResult: row.proposal.normalized.desiredResult,
      actionIds: [],
      options: row.proposal.normalized.options ?? [],
      createdAt: row.createdAt
    }))
  });
}

/** With no workspace there is no Project list and no Agent Ask store: read the Decisions of the checkout in hand. */
function readDecisionsOnly(repoRoot: string, project: string | undefined, unavailable: string[]): TodoItem[] {
  let slugs: string[];
  try {
    slugs = [
      ...new Set(
        discoverDocs(repoRoot)
          .docs.filter((doc) => doc.type === "decision" && doc.status === "open")
          .map((doc) => (doc as { project: string }).project)
      )
    ];
  } catch (error) {
    unavailable.push(`repository sources unavailable: ${repoRoot}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const wanted = project?.toLowerCase();
  return slugs
    .filter((slug) => !wanted || slug.toLowerCase() === wanted)
    .flatMap((slug) => collect(gateForProject(null, repoRoot, slug)));
}

function describe(item: TodoItem): string[] {
  return [
    `${item.key} — ${item.title}`,
    `    project: ${item.project} · created: ${item.createdAt} · source: ${item.sourceRef}`,
    `    answer: ${item.answer}`
  ];
}

export function renderTodoSuccess(response: CommandSuccess<TodoData>): string[] {
  const { counts, items, unavailable, asOf } = response.data;
  const lines = [
    `Operator to-do: ${counts.blocking} blocking · ${counts.other} other` +
      ` (decisions ${counts.byKind.decision}, agent asks ${counts.byKind.agent_ask})` +
      ` (as of ${asOf.at}${asOf.workspace ? `, workspace ${asOf.workspace}` : ""})`
  ];

  const blocking = items.filter((item) => item.blocking);
  const other = items.filter((item) => !item.blocking);

  if (blocking.length > 0) {
    lines.push("", "Blocking:", ...blocking.flatMap((item) => describe(item).map((line) => `  ${line}`)));
  }
  if (other.length > 0) {
    lines.push("", "Other (oldest first):", ...other.flatMap((item) => describe(item).map((line) => `  ${line}`)));
  }
  if (counts.hidden > 0) {
    lines.push("", `${counts.hidden} more: --all`);
  }
  if (counts.byKind.agent_ask > 0) {
    lines.push("", AGENT_ASK_CAVEAT);
  }
  if (items.length === 0 && unavailable.length === 0) {
    lines.push("", "Nothing is waiting on you in the sources this slice reads (open Decisions, pending Agent Asks).");
  }
  if (unavailable.length > 0) {
    lines.push("", ...unavailable);
  }
  return lines;
}
