import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { ArcadiaError, projectNotFound } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withReadOnlyDatabase } from "../db/connection.js";
import {
  getProject,
  getProjectBySlug,
  getProjectMetadata,
  getWorkItem,
  listActionableReviewItems,
  listProjects
} from "../db/repositories.js";
import { resolveDispatch, resolveReadySet } from "../docs/dispatch.js";
import { discoverDocs } from "../docs/discover.js";
import { parseActionDocRef } from "../docs/types.js";
import type { ReviewItemSummary } from "../domain/types.js";
import { ACTION_CLARIFICATION_INTENT } from "./review.js";
import { classifyOperatorItems, type OperatorGateItem } from "../docs/operatorGate.js";
import { listUnsettledAgentAskProposals } from "../ask/settlement.js";
import { resolveOperatorGate, targetedActionIds } from "../ask/operatorGate.js";

type UnsettledAsk = ReturnType<typeof listUnsettledAgentAskProposals>[number];

export const TODO_SCHEMA = "arcadia-todo-v1";
export const AGENT_ASK_CAVEAT =
  "Agent Asks are listed while unsettled. Stale means positive evidence only (every targeted Action done in a Plan, or an explicit Supersedes line); an Ask without it is shown even if no longer wanted.";
/** Non-blocking items the default view shows before pointing at `--all`. */
export const TODO_OTHER_CAP = 5;

export interface TodoCommandOptions {
  /** Workspace path, or undefined to let Arcadia resolve it. */
  workspace?: string;
  /** Project id or slug; omitted means every Project. */
  project?: string;
  /** Show every non-blocking item and the stale ones instead of the first few. */
  all?: boolean;
  /** List only the stale items, each with the evidence that makes it stale. */
  stale?: boolean;
  /** Injected for deterministic output in tests. */
  now?: Date;
  /** The checkout read when no workspace resolves. Defaults to the directory the operator stands in. */
  repoRoot?: string;
  /** Directories whose Projects are fixtures. Defaults to the OS temp directory and ~/tmp; a test seam. */
  fixtureRoots?: string[];
}

export interface TodoItem {
  /** `<kind>:<project>/<source-id>`: Decision ids are per Project, so the Project is part of the identity. Stable while the item is pending. */
  key: string;
  kind: "decision" | "agent_ask" | "review_item";
  /** The source's own words: a Decision's question, an Agent Ask's desired result or a review_item's decision_needed. */
  title: string;
  project: string;
  blocking: boolean;
  /** A Decision's `updated` date (Decisions carry no creation time); an Agent Ask's creation time. */
  createdAt: string;
  /** The Decision's document path, `agent_ask_proposals:<id>` or `review_items:<id>`. */
  sourceRef: string;
  /** review_item only: the item's own `resolved_intent` (for example `ActionClarification`), which says what raised it. */
  origin?: string;
  /** The existing canonical command that answers it. Nothing here runs it. */
  answer: string;
  /** review_item only: other existing ways to answer it (Discord reply, Mission Control), where one exists. */
  answerVia?: string[];
  /** Present only when positive evidence says the item no longer waits on the operator. */
  staleReason?: string;
}

export interface TodoCounts {
  /** Live (not stale) blocking items. */
  blocking: number;
  /** Live non-blocking items. */
  other: number;
  /** Every stale item found, whichever view is shown. */
  stale: number;
  /** Stale items left out of `items` in this view. */
  staleHidden: number;
  /** Totals by kind across every live item found, shown or not. */
  byKind: { decision: number; agent_ask: number; review_item: number };
  /** Live non-blocking items left out of `items` because the cap applies. */
  hidden: number;
  /** Items of fixture Projects, counted here instead of listed. */
  fixture: { projects: number; items: number };
}

export interface TodoData {
  schema: typeof TODO_SCHEMA;
  view: "default" | "all" | "stale";
  /** `workspace` is the workspace's name (its directory name); `workspacePath` is where it lives. Both null when none resolved. */
  asOf: { at: string; workspace: string | null; workspacePath: string | null };
  counts: TodoCounts;
  items: TodoItem[];
  /** One line per source this run could not read. Empty means every source was read. */
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

/**
 * Non-blocking order: open Decisions first, newest first (a freshly raised question must not hide behind old
 * items), then every other item oldest first. The key breaks ties.
 */
function byDecisionsFirst(a: TodoItem, b: TodoItem): number {
  const aDecision = a.kind === "decision";
  if (aDecision !== (b.kind === "decision")) return aDecision ? -1 : 1;
  return aDecision ? b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key) : byAge(a, b);
}

/** What a Project's checked-in Plans and open Decisions say, read once per Project for staleness. */
interface ProjectEvidence {
  /** Action id -> its status across the Project's Plans. An id found unfinished anywhere is not done. */
  actions: Map<string, { done: boolean; plan: string }>;
  /** Open Decision id -> the Action it names, if any. */
  decisionActions: Map<string, string | null>;
  /** Every Decision document by slug (what a review_item's `decision/<slug>` doc_ref names), whatever its status. */
  decisionDocs: Map<string, { id: string; status: string }>;
}

function readProjectEvidence(repoRoot: string, projectSlug: string): ProjectEvidence {
  const wanted = projectSlug.toLowerCase();
  const docs = discoverDocs(repoRoot).docs;
  const actions: ProjectEvidence["actions"] = new Map();
  for (const doc of docs) {
    if (doc.type !== "plan" || doc.project.toLowerCase() !== wanted) continue;
    for (const action of doc.actions) {
      const prior = actions.get(action.id);
      const done = action.status === "done" && (prior?.done ?? true);
      actions.set(action.id, { done, plan: prior && !prior.done ? prior.plan : doc.slug });
    }
  }
  const decisionActions: ProjectEvidence["decisionActions"] = new Map();
  const decisionDocs: ProjectEvidence["decisionDocs"] = new Map();
  for (const doc of docs) {
    if (doc.type !== "decision" || doc.project.toLowerCase() !== wanted) continue;
    decisionDocs.set(doc.slug, { id: doc.id, status: doc.status });
    if (doc.status === "open") decisionActions.set(doc.id, doc.action);
  }
  return { actions, decisionActions, decisionDocs };
}

/** The Agent Ask facts staleness reads, taken from the stored proposal. */
interface AskFacts {
  intent: string;
  /** Actions reached through a target_ref. */
  targets: string[];
  /** Actions the Ask proposes to create (an `actions[].id` with no target_ref). */
  proposed: string[];
}

function askFactsOf(rows: UnsettledAsk[]): Map<string, AskFacts> {
  return new Map(
    rows.map((row) => {
      const normalized = row.proposal.normalized;
      return [
        row.id,
        {
          intent: normalized.intent,
          targets: targetedActionIds(normalized),
          proposed: normalized.actions.flatMap((action) => (action.id && !action.targetRef ? [action.id] : []))
        }
      ];
    })
  );
}

/** One stored proposal, settled or not, as supersession reads it. */
interface SupersessionSource {
  id: string;
  requestId: string;
  rationale: string | null;
  /** The settlement's disposition, or null while unsettled. */
  disposition: string | null;
}

/** Every stored proposal with its settlement disposition: a settled Ask's Supersedes line still counts. */
function listSupersessionSources(db: Parameters<typeof listUnsettledAgentAskProposals>[0]): SupersessionSource[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.request_id, p.proposal_json, s.disposition
         FROM agent_ask_proposals p
         LEFT JOIN agent_ask_settlements s ON s.proposal_id = p.id
         ORDER BY p.created_at ASC, p.id ASC`
    )
    .all() as Array<{ id: string; request_id: string; proposal_json: string; disposition: string | null }>;
  return rows.map((row) => {
    const proposal = JSON.parse(row.proposal_json) as { normalized?: { rationale?: string | null } };
    return { id: row.id, requestId: row.request_id, rationale: proposal.normalized?.rationale ?? null, disposition: row.disposition };
  });
}

/** A `Supersedes:` clause at a line start or after sentence punctuation, up to the end of that sentence or line. */
const SUPERSEDES = /(?:^|[.;]\s+)[ \t>*-]*Supersedes:[ \t]*([^\n]*?)(?:\.(?=\s|$)|$)/gim;

/**
 * Proposal id -> the proposal that explicitly supersedes it. Only a
 * `Supersedes: <proposal ids>` clause in an Ask's own stored rationale counts
 * (ids may be proposal ids or request ids), and only from an Ask that is
 * unsettled or settled `accepted`: a rejected Ask never hides another. Two
 * Asks that name each other cancel out.
 */
function supersessionsOf(rows: SupersessionSource[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of rows) {
    index.set(row.id, row.id);
    index.set(row.requestId, row.id);
  }
  const names = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.disposition !== null && row.disposition !== "accepted") continue;
    for (const match of (row.rationale ?? "").matchAll(SUPERSEDES)) {
      for (const token of match[1].split(/[\s,;]+/).filter(Boolean)) {
        const target = index.get(token);
        if (target && target !== row.id) names.set(row.id, (names.get(row.id) ?? new Set()).add(target));
      }
    }
  }
  const superseded = new Map<string, string>();
  for (const [superseder, targets] of names) {
    for (const target of targets) {
      if (names.get(target)?.has(superseder)) continue;
      if (!superseded.has(target)) superseded.set(target, superseder);
    }
  }
  return superseded;
}

interface StaleContext {
  askFacts: Map<string, AskFacts>;
  superseded: Map<string, string>;
  evidence: Map<string, ProjectEvidence>;
}

/** Positive evidence only: absence of evidence (an unknown Project, an absent Action) never makes an item stale. */
function staleReasonOf(item: OperatorGateItem, context: StaleContext): string | undefined {
  const evidence = context.evidence.get(item.projectSlug.toLowerCase());
  if (item.kind === "decision") {
    const actionId = evidence?.decisionActions.get(item.id);
    const state = actionId ? evidence?.actions.get(actionId) : undefined;
    return state?.done ? `its Action ${actionId} is done in plan ${state.plan}` : undefined;
  }
  const superseder = context.superseded.get(item.id);
  if (superseder) return `superseded by Agent Ask ${superseder} (explicit Supersedes line in its rationale)`;
  const facts = context.askFacts.get(item.id);
  if (!facts || !["complete", "split", "action"].includes(facts.intent) || facts.targets.length === 0 || !evidence) return undefined;
  // An Ask that also proposes new Actions is only stale once those exist in a Plan too.
  if (facts.proposed.some((id) => !evidence.actions.has(id))) return undefined;
  if (facts.targets.every((target) => evidence.actions.get(target)?.done)) {
    return `every Action it targets is done: ${facts.targets.join(", ")}`;
  }
  return undefined;
}

/** The same classification `arcadia next` applies to one Project, over a repository and (optionally) a database. */
function gateForProject(
  db: Parameters<typeof resolveOperatorGate>[0]["db"],
  repoRoot: string,
  projectSlug: string
): {
  gate: { blocking: OperatorGateItem[]; alerts: OperatorGateItem[] };
  /** The Action the gate was resolved against; a review_item linked to it is blocking. */
  selectedActionId: string | null;
  noProjectDoc: boolean;
} {
  const dispatch = resolveDispatch(repoRoot, projectSlug);
  const readySet = resolveReadySet(repoRoot, projectSlug);
  const selectedActionId = dispatch.context?.action.id ?? null;
  return {
    gate: resolveOperatorGate({
      db,
      repoRoot,
      projectSlug,
      selectedActionId,
      readySetCandidates: readySet.candidates
    }),
    selectedActionId,
    noProjectDoc: dispatch.blockers.some((blocker) => blocker.field === "type: project")
  };
}

function collect(gate: { blocking: OperatorGateItem[]; alerts: OperatorGateItem[] }, context: StaleContext): TodoItem[] {
  const build = (item: OperatorGateItem, blocking: boolean): TodoItem => {
    const todo = toItem(item, blocking);
    const staleReason = staleReasonOf(item, context);
    return staleReason ? { ...todo, staleReason } : todo;
  };
  return [...gate.blocking.map((item) => build(item, true)), ...gate.alerts.map((item) => build(item, false))];
}

/** The Action id a Plan-Action doc_ref (`plan/<plan>#<action>`) names, or null for any other shape. */
function actionIdOfRef(docRef: string | null | undefined): string | null {
  return docRef ? (parseActionDocRef(docRef.trim())?.actionId ?? null) : null;
}

/** `decision/<slug>` -> slug; null for any other doc_ref shape. */
function decisionSlugOfRef(docRef: string | null | undefined): string | null {
  const match = /^decision\/(.+)$/.exec(docRef?.trim() ?? "");
  return match ? match[1] : null;
}

function reviewAnswer(item: ReviewItemSummary): Pick<TodoItem, "answer" | "answerVia"> {
  if (item.resolved_intent === ACTION_CLARIFICATION_INTENT) {
    return {
      answer: `arcadia review approve ${item.id} --answer "<answer>" --clarify`,
      // These two re-clarify on their own, so they never take --clarify.
      answerVia: [
        "Discord: reply to the clarification notification with the answer",
        "Mission Control: open the item and choose Answer & continue"
      ]
    };
  }
  // Approving another kind can authorize a Run: inspect first, then approve, reject or defer by id.
  return { answer: `arcadia review show ${item.id}`, answerVia: [`then: arcadia review approve|reject|defer ${item.id}`] };
}

/**
 * Open and deferred review_items of one Project (agent-flagged ones wait on an agent, not the operator), as
 * to-do items. Dedupe: a review_item whose `doc_ref` names a listed (open) Decision is that Decision, shown once;
 * several on one work_item show one (a live item over a stale one, then the first listed: open before deferred, newest first).
 * Stale needs positive evidence: its work_item is done, or its `doc_ref` names an answered Decision.
 * Blocking only when it is linked to the Action the operator gate was resolved against.
 */
function reviewTodoItems(
  db: Parameters<typeof listActionableReviewItems>[0],
  rows: ReviewItemSummary[],
  projectSlug: string,
  evidence: ProjectEvidence | undefined,
  selectedActionId: string | null
): TodoItem[] {
  const built: TodoItem[] = [];
  const seenWork = new Map<string, number>();
  for (const row of rows) {
    const slug = decisionSlugOfRef(row.doc_ref);
    const decision = slug ? evidence?.decisionDocs.get(slug) : undefined;
    if (decision?.status === "open") continue;

    const workItem = row.work_item_id ? getWorkItem(db, row.work_item_id) : null;
    let staleReason: string | undefined;
    if (workItem?.status === "done") staleReason = `its work_item ${workItem.id} is done`;
    else if (decision && (decision.status === "approved" || decision.status === "rejected")) {
      staleReason = `its Decision ${decision.id} (${row.doc_ref}) is already ${decision.status}`;
    }

    const linked = [actionIdOfRef(row.doc_ref), actionIdOfRef(workItem?.doc_ref)];
    const todo: TodoItem = {
      key: `review_item:${projectSlug || "unknown"}/${row.id}`,
      kind: "review_item",
      title: row.decision_needed,
      project: projectSlug,
      blocking: selectedActionId !== null && linked.includes(selectedActionId),
      origin: row.resolved_intent,
      createdAt: row.created_at,
      sourceRef: `review_items:${row.id}`,
      ...reviewAnswer(row),
      ...(staleReason ? { staleReason } : {})
    };

    const workId = row.work_item_id;
    const prior = workId ? seenWork.get(workId) : undefined;
    if (prior === undefined) {
      if (workId) seenWork.set(workId, built.length);
      built.push(todo);
    } else if (built[prior].staleReason && !todo.staleReason) {
      built[prior] = todo;
    }
  }
  return built;
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

function canonical(target: string): string {
  const resolved = path.resolve(target);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function isUnder(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** A rehearsal or scratch Project: its slug says rehearsal, or its repository sits in the OS temp directory or ~/tmp. */
function isFixtureProject(slug: string, repoPath: string | undefined, roots: string[]): boolean {
  if (slug.toLowerCase().includes("rehearsal")) return true;
  if (!repoPath) return false;
  const candidates = [path.resolve(repoPath), canonical(repoPath)];
  const resolvedRoots = roots.flatMap((root) => [path.resolve(root), canonical(root)]);
  return candidates.some((candidate) => resolvedRoots.some((root) => isUnder(candidate, root)));
}

function defaultFixtureRoots(): string[] {
  return [tmpdir(), path.join(homedir(), "tmp")];
}

/**
 * Everything the operator owes an answer on, as a derived view.
 *
 * It reads three sources: open Decisions (checked-in documents), unsettled
 * Agent Ask proposals and open or deferred review_items (the workspace
 * database, opened read-only).
 * Blocking versus alert is `arcadia next`'s own classification, reached
 * through the same `resolveOperatorGate`; a review_item is blocking only when
 * it is linked to the Action that gate was resolved against. Stale items (positive evidence only)
 * are hidden from the default view. Nothing is stored, nothing is written, and
 * no command is run: `answer` is text the operator can run.
 */
export function runTodoCommand(options: TodoCommandOptions): CommandSuccess<TodoData> {
  const at = (options.now ?? new Date()).toISOString();
  const unavailable: string[] = [];
  let items: TodoItem[] = [];
  let fixture = { projects: 0, items: 0 };
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
      const read = readWithWorkspace(resolved, options, unavailable);
      items = read.items;
      fixture = read.fixture;
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

  const view: TodoData["view"] = options.stale ? "stale" : options.all ? "all" : "default";
  const live = items.filter((item) => !item.staleReason);
  const staleItems = items.filter((item) => item.staleReason).sort(byAge);
  const blocking = live.filter((item) => item.blocking).sort(byAge);
  const other = live.filter((item) => !item.blocking).sort(byDecisionsFirst);
  const shownOther = view === "default" ? other.slice(0, TODO_OTHER_CAP) : other;
  const shown =
    view === "stale" ? staleItems : view === "all" ? [...blocking, ...shownOther, ...staleItems] : [...blocking, ...shownOther];

  return createSuccess({
    command: "todo",
    workspace: workspacePath ?? undefined,
    data: {
      schema: TODO_SCHEMA,
      view,
      asOf: { at, workspace: workspacePath ? path.basename(workspacePath) : null, workspacePath },
      counts: {
        blocking: blocking.length,
        other: other.length,
        stale: staleItems.length,
        staleHidden: view === "default" ? staleItems.length : 0,
        byKind: {
          decision: live.filter((item) => item.kind === "decision").length,
          agent_ask: live.filter((item) => item.kind === "agent_ask").length,
          review_item: live.filter((item) => item.kind === "review_item").length
        },
        hidden: view === "stale" ? 0 : other.length - shownOther.length,
        fixture
      },
      items: shown,
      unavailable
    }
  });
}

function readWithWorkspace(
  workspacePath: string,
  options: TodoCommandOptions,
  unavailable: string[]
): { items: TodoItem[]; fixture: { projects: number; items: number } } {
  const roots = options.fixtureRoots ?? defaultFixtureRoots();
  return withReadOnlyDatabase(workspacePath, (db) => {
    let projects = listProjects(db).filter((project) => project.status !== "completed");
    if (options.project) {
      const wanted = getProject(db, options.project) ?? getProjectBySlug(db, options.project);
      if (!wanted) throw projectNotFound(options.project);
      projects = [wanted];
    }

    const proposals = listUnsettledAgentAskProposals(db);
    const reviewRows = listActionableReviewItems(db);
    const reviewRowsOf = (projectId: string): ReviewItemSummary[] => reviewRows.filter((row) => row.project_id === projectId);
    const context: StaleContext = {
      askFacts: askFactsOf(proposals),
      superseded: supersessionsOf(listSupersessionSources(db)),
      evidence: new Map()
    };

    const items: TodoItem[] = [];
    const fixtureProjects = new Set<string>();
    let fixtureItems = 0;
    const take = (slug: string, fixtureProject: boolean, found: TodoItem[]): void => {
      if (fixtureProject) {
        fixtureProjects.add(slug.toLowerCase());
        fixtureItems += found.length;
      } else {
        items.push(...found);
      }
    };

    for (const project of projects) {
      const repoPath = getProjectMetadata(db, project.id)?.repo_path?.trim();
      const fixtureProject = isFixtureProject(project.slug, repoPath, roots);
      // A fixture Project is a count, not a list, and not a complaint either.
      const note = (line: string): void => {
        if (!fixtureProject) unavailable.push(line);
      };

      if (!repoPath || !existsSync(repoPath)) {
        note(
          `project sources unavailable: ${project.slug} has ${repoPath ? `no repository at ${repoPath}` : "no repo_path"}; ` +
            `its Decisions were not read (arcadia project metadata ${project.id} --repo-path <path>)`
        );
        // Agent Asks and review_items need no repository: list them without Decisions or Plan evidence.
        take(project.slug, fixtureProject, collect(classifyAsksOnly(proposals, project.slug), context));
        take(project.slug, fixtureProject, reviewTodoItems(db, reviewRowsOf(project.id), project.slug, undefined, null));
        continue;
      }

      // One Project's failure is its own line, never the other Projects' loss.
      let selected: string | null = null;
      try {
        context.evidence.set(project.slug.toLowerCase(), readProjectEvidence(repoPath, project.slug));
        const { gate, selectedActionId, noProjectDoc } = gateForProject(db, repoPath, project.slug);
        if (noProjectDoc) {
          note(
            `project sources unavailable: ${project.slug} has no PROJECT.md under ${repoPath}; ` +
              `which item blocks dispatch was not worked out (add PROJECT.md or fix its repo_path)`
          );
        }
        selected = selectedActionId;
        take(project.slug, fixtureProject, collect(gate, context));
      } catch (error) {
        note(`project sources unavailable: ${project.slug}: ${workspaceRemedy(error)}`);
        take(project.slug, fixtureProject, collect(classifyAsksOnly(proposals, project.slug), context));
      }
      // Never blocking when no gate was resolved; Plan evidence is used when it was read.
      take(
        project.slug,
        fixtureProject,
        reviewTodoItems(db, reviewRowsOf(project.id), project.slug, context.evidence.get(project.slug.toLowerCase()), selected)
      );
    }

    // Agent Asks naming a Project outside this list are still the operator's.
    // They cannot be blocking (no dispatch resolves for them), so they are
    // listed as alerts rather than dropped.
    if (!options.project) {
      const known = new Set(projects.map((project) => project.slug.toLowerCase()));
      const strays = new Set(
        proposals.map((row) => row.proposal.normalized.project).filter((slug) => !known.has(slug.toLowerCase()))
      );
      for (const slug of strays) {
        take(slug, isFixtureProject(slug, undefined, roots), collect(classifyAsksOnly(proposals, slug), context));
      }
      // A review_item with no Project is still the operator's; it has no gate to block, so it is an alert.
      take("unknown", false, reviewTodoItems(db, reviewRows.filter((row) => !row.project_id), "unknown", undefined, null));
    }
    return { items, fixture: { projects: fixtureProjects.size, items: fixtureItems } };
  });
}

function classifyAsksOnly(proposals: UnsettledAsk[], projectSlug: string) {
  return classifyOperatorItems({
    projectSlug,
    selectedActionId: null,
    decisions: [],
    agentAsks: proposals.map((row) => ({
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
  const context: StaleContext = { askFacts: new Map(), superseded: new Map(), evidence: new Map() };
  const items: TodoItem[] = [];
  for (const slug of slugs.filter((candidate) => !wanted || candidate.toLowerCase() === wanted)) {
    try {
      context.evidence.set(slug.toLowerCase(), readProjectEvidence(repoRoot, slug));
      items.push(...collect(gateForProject(null, repoRoot, slug).gate, context));
    } catch (error) {
      unavailable.push(`project sources unavailable: ${slug}: ${workspaceRemedy(error)}`);
    }
  }
  return items;
}

function describe(item: TodoItem): string[] {
  return [
    `${item.key} — ${item.title}`,
    `    project: ${item.project} · created: ${item.createdAt} · source: ${item.sourceRef}${item.origin ? ` · origin: ${item.origin}` : ""}`,
    ...(item.staleReason ? [`    stale: ${item.staleReason}`] : []),
    `    answer: ${item.answer}`,
    ...(item.answerVia ?? []).map((via) => `    or ${via}`)
  ];
}

export function renderTodoSuccess(response: CommandSuccess<TodoData>): string[] {
  const { counts, items, unavailable, asOf, view } = response.data;
  const staleCount =
    view === "default" ? `stale hidden: ${counts.staleHidden}` : view === "all" ? `stale: ${counts.stale} (shown)` : `stale: ${counts.stale}`;
  const lines = [
    `Operator to-do: ${counts.blocking} blocking · ${counts.other} other · ${staleCount}` +
      ` (decisions ${counts.byKind.decision}, agent asks ${counts.byKind.agent_ask}, review items ${counts.byKind.review_item})` +
      ` (as of ${asOf.at}${asOf.workspace ? `, workspace ${asOf.workspace}` : ""})`
  ];

  const stale = items.filter((item) => item.staleReason);
  const blocking = items.filter((item) => item.blocking && !item.staleReason);
  const other = items.filter((item) => !item.blocking && !item.staleReason);

  if (blocking.length > 0) {
    lines.push("", "Blocking:", ...blocking.flatMap((item) => describe(item).map((line) => `  ${line}`)));
  }
  if (other.length > 0) {
    lines.push("", "Other (Decisions newest first, then oldest first):", ...other.flatMap((item) => describe(item).map((line) => `  ${line}`)));
  }
  if (stale.length > 0) {
    lines.push("", "Stale (positive evidence it no longer waits on you):", ...stale.flatMap((item) => describe(item).map((line) => `  ${line}`)));
  }
  if (counts.hidden > 0) {
    lines.push("", `${counts.hidden} more: --all`);
  }
  if (counts.staleHidden > 0) {
    lines.push("", `${counts.staleHidden} stale hidden: --stale lists them with the evidence`);
  }
  if (counts.fixture.projects > 0 || counts.fixture.items > 0) {
    lines.push(
      "",
      `Fixture Projects collapsed: ${counts.fixture.projects} Projects, ${counts.fixture.items} items not listed (rehearsal slug, or repository under a temp directory or ~/tmp)`
    );
  }
  if (counts.byKind.agent_ask > 0) {
    lines.push("", AGENT_ASK_CAVEAT);
  }
  if (items.length === 0 && view === "stale") {
    lines.push("", "No item has positive evidence of being stale.");
  } else if (items.length === 0 && unavailable.length === 0) {
    lines.push("", "Nothing is waiting on you in the sources this view reads (open Decisions, pending Agent Asks, open and deferred review items).");
  }
  if (unavailable.length > 0) {
    lines.push("", ...unavailable);
  }
  return lines;
}
