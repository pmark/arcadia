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
import { resolveDispatch, resolveReadySet, type ReadySetResolution } from "../docs/dispatch.js";
import { discoverDocs } from "../docs/discover.js";
import { listOperatorTasks, type OperatorTask } from "../docs/operatorTasks.js";
import { listOperatorEscalations, type OperatorEscalation } from "../production/tick.js";
import { actionDocRef, parseActionDocRef } from "../docs/types.js";
import type { ReviewItemSummary } from "../domain/types.js";
import { ACTION_CLARIFICATION_INTENT } from "./review.js";
import { classifyOperatorItems, type OperatorGateItem } from "../docs/operatorGate.js";
import { listUnsettledAgentAskProposals } from "../ask/settlement.js";
import { agentAskGateInput, resolveOperatorGate, targetedActionIds } from "../ask/operatorGate.js";

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

/** One option a Decision or Agent Ask records, exactly as stored. */
export interface TodoOption {
  label: string;
  consequence: string;
  /** True only where the source marks it recommended. */
  recommended: boolean;
}

/** One piece of evidence a Decision (`evidence`/`references` line) or Agent Ask (`evidence[]` entry) records. */
export interface TodoEvidence {
  text: string;
  /** Agent Ask evidence only: its recorded disposition (met, failed or skipped). */
  status?: string;
  note?: string;
}

export interface TodoItem {
  /** `<kind>:<project>/<source-id>`: Decision ids are per Project, so the Project is part of the identity. Stable while the item is pending. */
  key: string;
  kind: "decision" | "agent_ask" | "review_item" | "operator_task" | "clarify" | "plan_action" | `escalation:${string}`;
  /** The source's own words: a Decision's question, an Agent Ask's desired result, a review_item's decision_needed, an operator task's `asks`, an escalation's `message`, a work_item's `title` or a Plan Action's open question (else its title). */
  title: string;
  project: string;
  blocking: boolean;
  /** A Decision's `updated` date (Decisions carry no creation time); an Agent Ask's creation time. */
  createdAt: string;
  /** The Decision's document path, `agent_ask_proposals:<id>`, `review_items:<id>`, `.arcadia/operator-tasks.jsonl#<id>`, `production_operator_escalations:<action_key>`, `work_items:<id>` or `<plan path>#<action id>`. */
  sourceRef: string;
  /** review_item: the item's own `resolved_intent` (for example `ActionClarification`), which says what raised it. operator_task: its origin, `action:<id>` or `decision:<id>`. plan_action: why it waits, `question_open` or `requires_review`. */
  origin?: string;
  /** The existing canonical command that answers it. Nothing here runs it. */
  answer: string;
  /** Other existing ways to answer it (Discord reply, dashboard route), where one exists; never invented. A Decision or Agent Ask has no Discord path. */
  answerVia?: string[];
  /** decision and agent_ask only, as the source records it (Decision `gate_question`; Agent Ask `gate_question`); omitted when absent. */
  gateQuestion?: string;
  /** decision and agent_ask only: every option the source records, in its order, with its consequence; omitted when it records none. */
  options?: TodoOption[];
  /** decision and agent_ask only: evidence the source cites; omitted when it records none. */
  evidence?: TodoEvidence[];
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
  byKind: { decision: number; agent_ask: number; review_item: number; operator_task: number; escalation: number; clarify: number; plan_action: number };
  /** Live non-blocking items left out of `items` because the cap applies. */
  hidden: number;
  /** Items of fixture Projects, counted here instead of listed. */
  fixture: { projects: number; items: number };
  /** Items of Projects with no repo_path, counted here instead of listed: nothing about them can be checked against a repository. */
  noRepoPath: { projects: number; items: number };
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

/** The dashboard route that answers a Decision or Agent Ask: the /runs To-do section, which POSTs to /api/approvals. */
function dashboardAnswerVia(item: OperatorGateItem): string[] {
  return item.kind === "decision"
    ? [
        `Dashboard: /runs, To-do section, Approve a Decision option (POST /api/approvals {"kind":"decision","id":"${item.id}","project":"${item.projectSlug}","option":"<option label>"}; no option sends the recommended one)`
      ]
    : [
        `Dashboard: /runs, To-do section, Accept or Reject (POST /api/approvals {"kind":"agent_ask","id":"${item.id}","project":"${item.projectSlug}","disposition":"accepted"|"rejected"})`
      ];
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
    answer: item.settleCommand,
    answerVia: dashboardAnswerVia(item),
    ...(item.gateQuestion ? { gateQuestion: item.gateQuestion } : {}),
    ...(item.options.length > 0
      ? { options: item.options.map((option) => ({ label: option.label, consequence: option.consequence, recommended: option.recommended })) }
      : {}),
    ...(item.evidence.length > 0 ? { evidence: item.evidence } : {})
  };
}

/** Oldest first; the key breaks ties so the order never depends on source iteration. */
function byAge(a: TodoItem, b: TodoItem): number {
  return a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key);
}

const isEscalation = (item: TodoItem): boolean => item.kind.startsWith("escalation:");

/** Blocking order: production escalations first (a stalled loop outranks everything), then oldest first. */
function byEscalationsFirst(a: TodoItem, b: TodoItem): number {
  if (isEscalation(a) !== isEscalation(b)) return isEscalation(a) ? -1 : 1;
  return byAge(a, b);
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
  /** False in a Project-pause state (PROJECT.md or its active Plan is not `active`): Plan Actions are then not the operator's to unblock. */
  dispatching: boolean;
  /** Plan slug -> its `updated` date: a Plan Action carries no creation time of its own. */
  planUpdated: Map<string, string>;
}

function readProjectEvidence(repoRoot: string, projectSlug: string): ProjectEvidence {
  const wanted = projectSlug.toLowerCase();
  const docs = discoverDocs(repoRoot).docs;
  const actions: ProjectEvidence["actions"] = new Map();
  const planUpdated: ProjectEvidence["planUpdated"] = new Map();
  for (const doc of docs) {
    if (doc.type !== "plan" || doc.project.toLowerCase() !== wanted) continue;
    planUpdated.set(doc.slug, doc.updated);
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
  const projectDoc = docs.find((doc) => doc.type === "project" && doc.slug.toLowerCase() === wanted);
  const activePlan = projectDoc?.type === "project" && projectDoc.activePlan ? projectDoc.activePlan.toLowerCase() : null;
  const plan = docs.find((doc) => doc.type === "plan" && doc.project.toLowerCase() === wanted && doc.slug.toLowerCase() === activePlan);
  const dispatching = projectDoc?.type === "project" && projectDoc.status === "active" && plan?.type === "plan" && plan.status === "active";
  return { actions, decisionActions, decisionDocs, dispatching: Boolean(dispatching), planUpdated };
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

/** The selected Action and the Plan it lives in: `plan/<planSlug>#<actionId>` is its doc_ref. */
interface SelectedAction {
  planSlug: string;
  actionId: string;
}

/** The same classification `arcadia next` applies to one Project, over a repository and (optionally) a database. */
function gateForProject(
  db: Parameters<typeof resolveOperatorGate>[0]["db"],
  repoRoot: string,
  projectSlug: string
): {
  gate: { blocking: OperatorGateItem[]; alerts: OperatorGateItem[] };
  /** The Action the gate was resolved against, with its Plan; a review_item or ledger item linked to it is blocking. */
  selected: SelectedAction | null;
  /** The ready set the gate was resolved against: every unfinished Action's readiness, the way `arcadia next --ready` computes it. */
  readySet: ReadySetResolution;
  noProjectDoc: boolean;
} {
  const dispatch = resolveDispatch(repoRoot, projectSlug);
  const readySet = resolveReadySet(repoRoot, projectSlug);
  const selectedActionId = dispatch.context?.action.id ?? null;
  const selected = dispatch.context ? { planSlug: dispatch.context.activePlan, actionId: dispatch.context.action.id } : null;
  return {
    gate: resolveOperatorGate({
      db,
      repoRoot,
      projectSlug,
      selectedActionId,
      readySetCandidates: readySet.candidates
    }),
    selected,
    readySet,
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

/** True when a Plan-Action doc_ref (`plan/<plan>#<action>`) names the selected Action in the selected Plan; Action ids can repeat across Plans. */
function refNamesSelected(docRef: string | null | undefined, selected: SelectedAction | null): boolean {
  const parsed = docRef && selected ? parseActionDocRef(docRef.trim()) : null;
  return parsed !== null && selected !== null && parsed.planSlug === selected.planSlug && parsed.actionId === selected.actionId;
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
 * Blocking only when it is linked (by `plan/<plan>#<action>`, Plan included) to the Action the operator gate was resolved against.
 */
function reviewTodoItems(
  db: Parameters<typeof listActionableReviewItems>[0],
  rows: ReviewItemSummary[],
  projectSlug: string,
  evidence: ProjectEvidence | undefined,
  selected: SelectedAction | null
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

    const todo: TodoItem = {
      key: `review_item:${projectSlug || "unknown"}/${row.id}`,
      kind: "review_item",
      title: row.decision_needed,
      project: projectSlug,
      blocking: refNamesSelected(row.doc_ref, selected) || refNamesSelected(workItem?.doc_ref, selected),
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

/** The id of a listed (live) item of `kind`: the part of its key after `<project>/`. */
function listedIds(found: TodoItem[], kind: TodoItem["kind"]): Set<string> {
  return new Set(
    found.filter((item) => item.kind === kind && !item.staleReason).map((item) => item.key.slice(item.key.indexOf("/") + 1))
  );
}

/**
 * The Decision an escalation's own gate names: only the `operator_gate_pending` template
 * (`Launch of <key> is held by pending Decision <id>: <title>`, src/production/tick.ts), anchored at the start.
 * A Decision cited elsewhere (an Agent Ask title, a lapsed-grant "(Decision 0058)") is not the gate.
 */
function gateDecisionIdOf(message: string): string | null {
  const match = /^Launch of \S+ is held by pending Decision ([A-Za-z0-9][A-Za-z0-9_.-]*?):\s/.exec(message);
  return match ? match[1] : null;
}

/** Which Project a `production_operator_escalations.action_key` (`<project>/<action>`) belongs to; the rest is the Action. */
function splitActionKey(actionKey: string): { project: string; actionId: string } {
  const slash = actionKey.indexOf("/");
  return slash < 0 ? { project: "", actionId: actionKey } : { project: actionKey.slice(0, slash), actionId: actionKey.slice(slash + 1) };
}

/**
 * Production escalations of one Project, read-only: one item per Action (the table keys on it), kind
 * `escalation:<kind>`, title from `message`, answer from `remedy`, always blocking, created at `first_detected_at`.
 * An escalation whose message names a listed Decision of the Project is that Decision, shown once: the Decision
 * stays and is marked blocking, because the escalation row says the loop is held by it.
 */
function withEscalations(found: TodoItem[], rows: OperatorEscalation[], projectSlug: string): TodoItem[] {
  if (rows.length === 0) return found;
  const decisions = listedIds(found, "decision");
  const promoted = new Set<string>();
  const added: TodoItem[] = [];
  for (const row of rows) {
    const gate = gateDecisionIdOf(row.message);
    if (gate !== null && decisions.has(gate)) {
      promoted.add(`decision:${projectSlug || "unknown"}/${gate}`);
      continue;
    }
    added.push({
      key: `escalation:${row.kind}:${projectSlug || "unknown"}/${splitActionKey(row.actionKey).actionId}`,
      kind: `escalation:${row.kind}`,
      title: row.message,
      project: projectSlug,
      blocking: true,
      createdAt: row.firstDetectedAt,
      sourceRef: `production_operator_escalations:${row.actionKey}`,
      answer: row.remedy?.trim() || "arcadia production status"
    });
  }
  return [...found.map((item) => (promoted.has(item.key) ? { ...item, blocking: true } : item)), ...added];
}

/** A command-line argument, quoted only when it needs it. */
function shellArg(value: string): string {
  return /^[\w./@:+=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Waiting operator-task ledger items of one Project (`.arcadia/operator-tasks.jsonl`, repo-local). Each carries its
 * own `asks` as the title; the answer is `operator-task show` (look first), with `close --operator` and `decline` as the other
 * ways. Dedupe: a task whose origin is a listed Decision, or whose `reference` names a listed Decision
 * (`decision/<slug>`) or review_item (`review_items:<id>`), is shown by that item. Blocking only when its
 * origin is the Action the operator gate selected.
 */
function operatorTaskItems(
  repoRoot: string,
  projectSlug: string,
  found: TodoItem[],
  evidence: ProjectEvidence | undefined,
  selected: SelectedAction | null
): TodoItem[] {
  const decisions = listedIds(found, "decision");
  const reviews = listedIds(found, "review_item");
  const repo = shellArg(repoRoot);
  const represented = (task: OperatorTask): boolean => {
    if (task.origin.kind === "decision" && decisions.has(task.origin.id)) return true;
    const reference = task.reference?.trim() ?? "";
    const slug = decisionSlugOfRef(reference);
    const decision = slug ? evidence?.decisionDocs.get(slug) : undefined;
    if (decision && decisions.has(decision.id)) return true;
    return reviews.has(reference.replace(/^review_items?[:/]/, ""));
  };
  return listOperatorTasks(repoRoot, "waiting")
    .filter((task) => !represented(task))
    .map((task) => ({
      key: `operator_task:${projectSlug || "unknown"}/${task.id}`,
      kind: "operator_task" as const,
      title: task.asks,
      project: projectSlug,
      // A ledger origin is `{ kind, id }` with no Plan slug (OperatorTaskOrigin), so the Plan cannot be compared as
      // refNamesSelected does for doc_refs; the bare Action id against the selected Action is all the ledger carries.
      blocking: task.origin.kind === "action" && selected !== null && task.origin.id === selected.actionId,
      origin: `${task.origin.kind}:${task.origin.id}`,
      createdAt: task.raisedAt,
      sourceRef: `.arcadia/operator-tasks.jsonl#${task.id}`,
      // `show` first: `close --operator` is the operator's own attestation, never the first thing to copy.
      answer: `arcadia operator-task show ${task.id} --repo ${repo}`,
      answerVia: [
        `once done, the operator closes it: arcadia operator-task close ${task.id} --operator --repo ${repo}`,
        `or decline: arcadia operator-task decline ${task.id} --because "<reason>" --operator --repo ${repo}`
      ]
    }));
}

/** `plan/<plan>#<action>` for every Plan Action an open or deferred review_item names, through its own or its work item's `doc_ref`. */
function reviewedActionRefs(db: Parameters<typeof listActionableReviewItems>[0], rows: ReviewItemSummary[]): Set<string> {
  const refs = new Set<string>();
  for (const row of rows) {
    const workItem = row.work_item_id ? getWorkItem(db, row.work_item_id) : null;
    for (const ref of [row.doc_ref, workItem?.doc_ref]) {
      const parsed = ref ? parseActionDocRef(ref.trim()) : null;
      if (parsed) refs.add(actionDocRef(parsed.planSlug, parsed.actionId));
    }
  }
  return refs;
}

/**
 * Plan Actions of one Project that wait on the operator, read from the ready set `arcadia next --ready` uses
 * (`resolveReadySet`, so readiness is never reimplemented): an unfinished, not-ready Action whose own
 * `question_open` question is the operator's, or whose responsibility is `requires_review` with no unmet dependency
 * left in front of it. An Action parked by a deferral or an external block is not an operator step, and a Project in a
 * pause state (PROJECT.md or its active Plan not `active`) lists none. The one readiness blocker that names an operator
 * step, an unanswered required Decision, is always that Decision, so it yields no item of its own.
 * Dedupe: an Action is shown by the item that already represents it: an open Decision it requires or that names it
 * (`action:`), a listed review_item whose `doc_ref` (or its work item's) is the Action, or a waiting ledger task whose
 * origin is the Action. Blocking follows the selected-Action gate rule only: the item is the selected Action.
 */
function planActionItems(
  projectSlug: string,
  readySet: ReadySetResolution,
  evidence: ProjectEvidence | undefined,
  selected: SelectedAction | null,
  found: TodoItem[],
  reviewedRefs: Set<string>
): TodoItem[] {
  const planSlug = readySet.planSlug;
  const planPath = readySet.planPath;
  if (!evidence?.dispatching || !planSlug || !planPath) return [];
  const decisionOfAction = new Set([...evidence.decisionActions.values()].filter((id): id is string => id !== null));
  const taskOrigins = new Set(found.filter((item) => item.kind === "operator_task" && !item.staleReason).map((item) => item.origin));
  const items: TodoItem[] = [];
  for (const candidate of readySet.candidates) {
    if (candidate.ready) continue;
    const id = candidate.actionId;
    // A deferral or an external block parks the Action; nobody is asked anything.
    if (candidate.blockers.some((blocker) => blocker.field === `actions.${id}.status`)) continue;
    const questionOpen = candidate.operatorQuestion !== null;
    const requiresReview =
      candidate.responsibility === "requires_review" && !candidate.blockers.some((blocker) => blocker.field === `actions.${id}.depends_on`);
    if (!questionOpen && !requiresReview) continue;
    if (candidate.requiredDecisionId !== null && evidence.decisionActions.has(candidate.requiredDecisionId)) continue;
    if (decisionOfAction.has(id) || reviewedRefs.has(actionDocRef(planSlug, id)) || taskOrigins.has(`action:${id}`)) continue;
    const ref = actionDocRef(planSlug, id);
    const isSelected = selected !== null && selected.planSlug === planSlug && selected.actionId === id;
    items.push({
      key: `plan_action:${projectSlug || "unknown"}/${planSlug}#${id}`,
      kind: "plan_action",
      title: candidate.operatorQuestion ?? candidate.title,
      project: projectSlug,
      blocking: isSelected,
      origin: questionOpen ? "question_open" : "requires_review",
      createdAt: evidence.planUpdated.get(planSlug) ?? "",
      sourceRef: `${planPath}#${id}`,
      answer: "arcadia agent-ask preview --file <ask.yaml>",
      answerVia: [
        `an Agent Ask with target_ref ${ref} that ${questionOpen ? "records your answer, so the question is no longer open" : "completes the Action once you have done the step"} (docs/agent-guidance/agent-asks.md)`,
        ...(isSelected ? [`read it first: arcadia next --project ${projectSlug}`] : [])
      ]
    });
  }
  return items;
}

/**
 * Captured work_items of one Project that clarification has not reached: not done, `clarification_status`
 * `unclarified`, a `capture_id`, and no open or deferred review_item (that item would already be the question).
 * Always an alert: nothing about an unclarified capture gates the selected Action. The title is the work_item's own.
 */
function clarifyItems(db: Parameters<typeof listActionableReviewItems>[0], projectId: string, projectSlug: string): TodoItem[] {
  const rows = db
    .prepare(
      `SELECT wi.id, wi.title, wi.created_at
         FROM work_items wi
        WHERE wi.project_id = ?
          AND wi.status != 'done'
          AND wi.clarification_status = 'unclarified'
          AND wi.capture_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM review_items ri WHERE ri.work_item_id = wi.id AND ri.status IN ('open', 'deferred'))
        ORDER BY wi.created_at ASC, wi.id ASC`
    )
    .all(projectId) as Array<{ id: string; title: string; created_at: string }>;
  return rows.map((row) => ({
    key: `clarify:${projectSlug || "unknown"}/${row.id}`,
    kind: "clarify" as const,
    title: row.title,
    project: projectSlug,
    blocking: false,
    createdAt: row.created_at,
    sourceRef: `work_items:${row.id}`,
    answer: `arcadia clarify --work ${row.id} --apply`,
    answerVia: [`dry run first (writes nothing): arcadia clarify --work ${row.id}`]
  }));
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
 * It reads seven sources: open Decisions, waiting operator-task ledger items
 * and Plan Actions that wait on the operator (checked-in files, the latter
 * through the ready set `arcadia next --ready` uses), unsettled Agent Ask
 * proposals, open or deferred review_items, unclarified captured work_items
 * and production operator escalations (the workspace database, opened
 * read-only).
 * Blocking versus alert is `arcadia next`'s own classification, reached
 * through the same `resolveOperatorGate`; a review_item or ledger item is blocking only when
 * it is linked to the Action that gate was resolved against, and an escalation is always
 * blocking (its row says the production loop is stalled). Stale items (positive evidence only)
 * are hidden from the default view. Nothing is stored, nothing is written, and
 * no command is run: `answer` is text the operator can run.
 */
export function runTodoCommand(options: TodoCommandOptions): CommandSuccess<TodoData> {
  const at = (options.now ?? new Date()).toISOString();
  const unavailable: string[] = [];
  let items: TodoItem[] = [];
  let fixture: TodoCounts["fixture"] = { projects: 0, items: 0 };
  let noRepoPath: TodoCounts["noRepoPath"] = { projects: 0, items: 0 };
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
      noRepoPath = read.noRepoPath;
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
  const blocking = live.filter((item) => item.blocking).sort(byEscalationsFirst);
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
          review_item: live.filter((item) => item.kind === "review_item").length,
          operator_task: live.filter((item) => item.kind === "operator_task").length,
          escalation: live.filter(isEscalation).length,
          clarify: live.filter((item) => item.kind === "clarify").length,
          plan_action: live.filter((item) => item.kind === "plan_action").length
        },
        hidden: view === "stale" ? 0 : other.length - shownOther.length,
        fixture,
        noRepoPath
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
): { items: TodoItem[]; fixture: TodoCounts["fixture"]; noRepoPath: TodoCounts["noRepoPath"] } {
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

    const escalations = listOperatorEscalations(db);
    const escalationsOf = (slug: string): OperatorEscalation[] =>
      escalations.filter((row) => splitActionKey(row.actionKey).project.toLowerCase() === slug.toLowerCase());

    const items: TodoItem[] = [];
    const fixtureProjects = new Set<string>();
    let fixtureItems = 0;
    const noRepoProjects = new Set<string>();
    let noRepoItems = 0;
    // A blocking item (a stalled production loop, the selected Action's gate) is always listed, whatever the
    // Project; only the non-blocking items of a collapsed Project become a count.
    const take = (slug: string, collapse: false | "fixture" | "noRepoPath", found: TodoItem[]): void => {
      const collapsed = collapse ? found.filter((item) => !(item.blocking && !item.staleReason)) : [];
      items.push(...found.filter((item) => !collapsed.includes(item)));
      if (collapse === "fixture") {
        fixtureProjects.add(slug.toLowerCase());
        fixtureItems += collapsed.length;
      } else if (collapse === "noRepoPath") {
        noRepoProjects.add(slug.toLowerCase());
        noRepoItems += collapsed.length;
      }
    };

    for (const project of projects) {
      const repoPath = getProjectMetadata(db, project.id)?.repo_path?.trim();
      // A fixture Project, or one with no repo_path, is a count, not a list, and not a complaint either.
      const collapse: false | "fixture" | "noRepoPath" = isFixtureProject(project.slug, repoPath, roots) ? "fixture" : !repoPath ? "noRepoPath" : false;
      const note = (line: string): void => {
        if (!collapse) unavailable.push(line);
      };

      if (!repoPath || !existsSync(repoPath)) {
        note(
          `project sources unavailable: ${project.slug} has no repository at ${repoPath}; ` +
            `its Decisions and operator tasks were not read (arcadia project metadata ${project.id} --repo-path <path>)`
        );
        // Agent Asks, review_items, unclarified captures and escalations need no repository: list them without Decisions or Plan evidence.
        const found = [
          ...collect(classifyAsksOnly(proposals, project.slug), context),
          ...reviewTodoItems(db, reviewRowsOf(project.id), project.slug, undefined, null),
          ...clarifyItems(db, project.id, project.slug)
        ];
        take(project.slug, collapse, withEscalations(found, escalationsOf(project.slug), project.slug));
        continue;
      }

      // One Project's failure is its own line, never the other Projects' loss.
      let selected: SelectedAction | null = null;
      let readySet: ReadySetResolution | null = null;
      let found: TodoItem[];
      try {
        context.evidence.set(project.slug.toLowerCase(), readProjectEvidence(repoPath, project.slug));
        const resolvedGate = gateForProject(db, repoPath, project.slug);
        if (resolvedGate.noProjectDoc) {
          note(
            `project sources unavailable: ${project.slug} has no PROJECT.md under ${repoPath}; ` +
              `which item blocks dispatch was not worked out (add PROJECT.md or fix its repo_path)`
          );
        }
        selected = resolvedGate.selected;
        readySet = resolvedGate.readySet;
        found = collect(resolvedGate.gate, context);
      } catch (error) {
        note(`project sources unavailable: ${project.slug}: ${workspaceRemedy(error)}`);
        found = collect(classifyAsksOnly(proposals, project.slug), context);
      }
      // Never blocking when no gate was resolved; Plan evidence is used when it was read.
      const evidence = context.evidence.get(project.slug.toLowerCase());
      found.push(...reviewTodoItems(db, reviewRowsOf(project.id), project.slug, evidence, selected));
      try {
        found.push(...operatorTaskItems(repoPath, project.slug, found, evidence, selected));
      } catch (error) {
        note(`project sources unavailable: ${project.slug}: operator task ledger: ${workspaceRemedy(error)}`);
      }
      found.push(...clarifyItems(db, project.id, project.slug));
      if (readySet) {
        found.push(...planActionItems(project.slug, readySet, evidence, selected, found, reviewedActionRefs(db, reviewRowsOf(project.id))));
      }
      take(project.slug, collapse, withEscalations(found, escalationsOf(project.slug), project.slug));
    }

    // Agent Asks and escalations naming a Project outside this list are still the operator's.
    // They cannot be blocking by a gate (no dispatch resolves for them), so Asks are
    // listed as alerts rather than dropped; an escalation is blocking by its own row.
    if (!options.project) {
      const known = new Set(projects.map((project) => project.slug.toLowerCase()));
      const strays = new Set(
        proposals.map((row) => row.proposal.normalized.project).filter((slug) => !known.has(slug.toLowerCase()))
      );
      for (const slug of strays) {
        take(slug, isFixtureProject(slug, undefined, roots) ? "fixture" : false, collect(classifyAsksOnly(proposals, slug), context));
      }
      const strayEscalations = new Map<string, OperatorEscalation[]>();
      for (const row of escalations) {
        const slug = splitActionKey(row.actionKey).project;
        if (!known.has(slug.toLowerCase())) strayEscalations.set(slug, [...(strayEscalations.get(slug) ?? []), row]);
      }
      for (const [slug, rows] of strayEscalations) {
        take(slug || "unknown", isFixtureProject(slug, undefined, roots) ? "fixture" : false, withEscalations([], rows, slug || "unknown"));
      }
      // A review_item with no Project, or whose Project is completed or not listed, is still the operator's;
      // it has no gate to block, so it is an alert in the `unknown` bucket rather than dropped.
      const listedProjectIds = new Set(projects.map((project) => project.id));
      take(
        "unknown",
        false,
        reviewTodoItems(db, reviewRows.filter((row) => !row.project_id || !listedProjectIds.has(row.project_id)), "unknown", undefined, null)
      );
    }
    return {
      items,
      fixture: { projects: fixtureProjects.size, items: fixtureItems },
      noRepoPath: { projects: noRepoProjects.size, items: noRepoItems }
    };
  });
}

function classifyAsksOnly(proposals: UnsettledAsk[], projectSlug: string) {
  return classifyOperatorItems({
    projectSlug,
    selectedActionId: null,
    decisions: [],
    agentAsks: proposals.map((row) => agentAskGateInput(row, []))
  });
}

/** With no workspace there is no Project list and no Agent Ask store: read the Decisions of the checkout in hand. */
function readDecisionsOnly(repoRoot: string, project: string | undefined, unavailable: string[]): TodoItem[] {
  let slugs: string[];
  try {
    // Projects with an open Decision, and the checkout's own Project (its Plan Actions and ledger are repo-local too).
    const docs = discoverDocs(repoRoot).docs;
    slugs = [
      ...new Set([
        ...docs.filter((doc) => doc.type === "decision" && doc.status === "open").map((doc) => (doc as { project: string }).project),
        ...docs.filter((doc) => doc.type === "project").map((doc) => (doc as { slug: string }).slug)
      ])
    ];
  } catch (error) {
    unavailable.push(`repository sources unavailable: ${repoRoot}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const wanted = project?.toLowerCase();
  const context: StaleContext = { askFacts: new Map(), superseded: new Map(), evidence: new Map() };
  const items: TodoItem[] = [];
  const resolvedBySlug = new Map<string, ReturnType<typeof gateForProject>>();
  for (const slug of slugs.filter((candidate) => !wanted || candidate.toLowerCase() === wanted)) {
    try {
      context.evidence.set(slug.toLowerCase(), readProjectEvidence(repoRoot, slug));
      const resolved = gateForProject(null, repoRoot, slug);
      resolvedBySlug.set(slug.toLowerCase(), resolved);
      items.push(...collect(resolved.gate, context));
    } catch (error) {
      unavailable.push(`project sources unavailable: ${slug}: ${workspaceRemedy(error)}`);
    }
  }
  // The operator-task ledger is repo-local too: the checkout's own Project owns it.
  try {
    const projectDoc = discoverDocs(repoRoot).docs.find((doc) => doc.type === "project") as { slug: string } | undefined;
    if (projectDoc && (!wanted || projectDoc.slug.toLowerCase() === wanted)) {
      const slug = projectDoc.slug;
      const evidence = context.evidence.get(slug.toLowerCase()) ?? readProjectEvidence(repoRoot, slug);
      const mine = items.filter((item) => item.project.toLowerCase() === slug.toLowerCase());
      items.push(...operatorTaskItems(repoRoot, slug, mine, evidence, gateForProject(null, repoRoot, slug).selected));
    }
  } catch (error) {
    unavailable.push(`repository sources unavailable: ${repoRoot}: operator task ledger: ${workspaceRemedy(error)}`);
  }
  // Plan Actions last, so a Decision or ledger task already listed represents its Action. With no database there are
  // no review_items to dedupe against: that is part of what the workspace line says is unavailable.
  for (const [slug, resolved] of resolvedBySlug) {
    const mine = items.filter((item) => item.project.toLowerCase() === slug);
    items.push(...planActionItems(resolved.readySet.projectSlug ?? slug, resolved.readySet, context.evidence.get(slug), resolved.selected, mine, new Set()));
  }
  return items;
}

function describe(item: TodoItem): string[] {
  return [
    `${item.key} — ${item.title}`,
    `    project: ${item.project} · created: ${item.createdAt} · source: ${item.sourceRef}${item.origin ? ` · origin: ${item.origin}` : ""}`,
    ...(item.staleReason ? [`    stale: ${item.staleReason}`] : []),
    ...(item.gateQuestion ? [`    gate question: ${item.gateQuestion}`] : []),
    ...(item.options ?? []).map((option) => `    option${option.recommended ? " (recommended)" : ""}: ${option.label} — ${option.consequence}`),
    ...(item.evidence ?? []).map((entry) => `    evidence: ${entry.text}${entry.status ? ` [${entry.status}]` : ""}${entry.note ? ` — ${entry.note}` : ""}`),
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
      ` (decisions ${counts.byKind.decision}, agent asks ${counts.byKind.agent_ask}, review items ${counts.byKind.review_item}, operator tasks ${counts.byKind.operator_task}, escalations ${counts.byKind.escalation}, clarify ${counts.byKind.clarify}, plan actions ${counts.byKind.plan_action})` +
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
  if (counts.noRepoPath.projects > 0 || counts.noRepoPath.items > 0) {
    lines.push(
      "",
      `Projects with no repo_path collapsed: ${counts.noRepoPath.projects} Projects, ${counts.noRepoPath.items} items not listed (set one: arcadia project metadata <id> --repo-path <path>)`
    );
  }
  if (counts.byKind.agent_ask > 0) {
    lines.push("", AGENT_ASK_CAVEAT);
  }
  if (items.length === 0 && view === "stale") {
    lines.push("", "No item has positive evidence of being stale.");
  } else if (items.length === 0 && unavailable.length === 0) {
    lines.push("", "Nothing is waiting on you in the sources this view reads (open Decisions, pending Agent Asks, open and deferred review items, waiting operator tasks, production escalations, unclarified captures, Plan Actions waiting on you).");
  }
  if (unavailable.length > 0) {
    lines.push("", ...unavailable);
  }
  return lines;
}
