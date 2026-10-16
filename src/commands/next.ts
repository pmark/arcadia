import { renderGuidanceRetrieval } from "../projects/agentGuidance.js";
import path from "node:path";

import { projectNotFound, validationError } from "../cli/errors.js";
import { invocationRoot } from "../cli/invocation.js";
import type { CommandSuccess } from "../cli/response.js";
import { createSuccess } from "../cli/response.js";
import { resolveReadyWorkspace } from "../cli/workspace.js";
import { withDatabase, withReadOnlyDatabase } from "../db/connection.js";
import { getProject, getProjectBySlug, getProjectMetadata, listBackBurnerItems, listProjects } from "../db/repositories.js";
import {
  isDispatchable,
  loadConstitution,
  resolveDispatch,
  resolveReadySet,
  type DispatchResolution,
  type ReadySetResolution
} from "../docs/dispatch.js";
import {
  listDispatchEvents,
  recordDispatchEvent,
  summarizeDispatchEvents,
  type DispatchEvent,
  type DispatchJournalSummary
} from "../docs/journal.js";
import { operatorGateBlockers, renderOperatorAlerts, type OperatorGateItem } from "../docs/operatorGate.js";
import type { PlanDoc } from "../docs/types.js";
import { discoverDocs } from "../docs/discover.js";
import { existingDirectory, parseWorktrees, tryGit } from "../git/worktrees.js";
import { canonicalPath, getActiveWorktreeReservation, hasWorktreeReservationTable, listActiveAgentSessions } from "../sessions/index.js";
import { resolveOperatorGate } from "../ask/operatorGate.js";

export interface NextCommandOptions {
  workspace: string;
  /** Project id or slug. Omitted means the single active Project, if there is one. */
  project?: string;
  /** Read-only caller orientation; never an assignment or an authority override. */
  repo?: string;
  /** Pins observation time for deterministic consumers. */
  now?: Date;
}

export interface NextCommandData extends DispatchResolution {
  dispatchable: boolean;
  projectId: string;
  repoRoot: string;
  firedBackBurnerCount?: number;
  /** Pending operator items scoped to this Project that are not blocking dispatch. */
  operatorAlerts: OperatorGateItem[];
  orientation?: CallerOrientation;
}

/**
 * Resolve the authoritative work pointer: the one action a dispatched agent
 * should advance.
 *
 * This is the continuation contract's startup procedure as a command. It exists
 * so "Get to work" has a single, checkable answer instead of being inferred
 * from commits, an ordered backlog, or whichever task looks easiest — the four
 * things the contract explicitly forbids reading priority from.
 */
export function runNextCommand(options: NextCommandOptions): CommandSuccess<NextCommandData> {
  const { response, projectSlug } = resolveNextCommand(options, withDatabase);
  const { data } = response;
  withDatabase(response.workspace!, (db) =>
    recordDispatchEvent(db, {
      command: "next",
      projectId: data.projectId,
      projectSlug,
      planSlug: data.context?.activePlan ?? null,
      actionId: data.context?.action.id ?? null,
      dispatchable: data.dispatchable,
      blockers: data.blockers,
      operatorQuestion: data.operatorQuestion
    })
  );
  return response;
}

/** Sandbox handoff: the same dispatch and operator gates, without host journal writes. */
export function runNextReadOnlyCommand(options: NextCommandOptions): CommandSuccess<NextCommandData> {
  return options.repo ? resolveCallerNext(options) : resolveNextCommand(options, withReadOnlyDatabase).response;
}

export interface CallerOrientation {
  source: "managed-documents+canonical-workspace";
  observedAt: string;
  repository: string;
  worktree: string;
  baseRevision: string | null;
  callerRevision: string | null;
  selected: DispatchResolution;
  assigned: { plan: string; action: string; claimId: string; generation: string | null } | null;
  session: { id: string; status: string } | null;
  ongoing: Array<{ source: "claim" | "session"; id: string; action: string | null; status: string }>;
  ongoingTotal: number;
  relatedPlans: Array<{ slug: string; status: string; source: string; updated: string }>;
  relatedPlanTotal: number;
  nextStep: string;
}

/** Observe one caller through existing dispatch/readiness and operator gates.
 * Only canonical reservation rows can bind the caller to an assigned Action.
 */
function resolveCallerNext(options: NextCommandOptions): CommandSuccess<NextCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const now = options.now ?? new Date();
  const worktree = canonicalPath(existingDirectory(options.repo!, "repository"));
  const listing = tryGit(worktree, ["worktree", "list", "--porcelain"]);
  const repository = listing ? parseWorktrees(listing)[0]?.path : null;
  if (!repository) throw validationError("Caller repository could not be resolved.", { remedy: "Run the brief inside a registered Project checkout." });
  const registered = withReadOnlyDatabase(workspacePath, db => resolveProjectAndRepo(db, options));
  const registeredListing = tryGit(registered.repoRoot, ["worktree", "list", "--porcelain"]);
  const registeredRepository = registeredListing ? parseWorktrees(registeredListing)[0]?.path : null;
  if (!registeredRepository || canonicalPath(repository) !== canonicalPath(registeredRepository)) {
    throw validationError("Caller repository does not match the registered Project repository.", { project: registered.project.slug });
  }
  const discovered = discoverDocs(worktree);
  const projects = discovered.docs.filter(doc => doc.type === "project");
  if (projects.length !== 1 || projects[0].slug !== registered.project.slug) {
    throw validationError("Caller Project is missing, ambiguous or different from the registered Project.");
  }
  const selected = resolveDispatch(worktree, registered.project.slug);
  const evidence = withReadOnlyDatabase(workspacePath, db => {
    const claim = getActiveWorktreeReservation(db, repository, worktree, now);
    const claims = hasWorktreeReservationTable(db) ? db.prepare(`SELECT id, project, action_id, worktree_path, expires_at
      FROM agent_worktree_reservations WHERE repository_path = ? ORDER BY created_at, id`)
      .all(canonicalPath(repository)) as Array<{ id: string; project: string | null; action_id: string | null; worktree_path: string; expires_at: string }> : [];
    const sessions = listActiveAgentSessions(db).filter(row => row.repository_path === canonicalPath(repository));
    return { claim, claims, sessions };
  });
  const refusal = (message: string) => ({ relativePath: "canonical-workspace", field: "claimed_action", message,
    remedy: "Resolve the existing ownership evidence through the governed claim path before continuing." });
  const claim = evidence.claim;
  let resolution = selected;
  let assigned: CallerOrientation["assigned"] = null;
  let ownershipBlocker: ReturnType<typeof refusal> | null = null;
  const ownRows = evidence.claims.filter(row => canonicalPath(row.worktree_path) === worktree);
  if (ownRows.length > 1) ownershipBlocker = refusal("Caller has conflicting reservation evidence.");
  else if (!claim && ownRows.length) ownershipBlocker = refusal("Caller reservation is stale; no current assignment was inferred.");
  else if (claim?.action_id) {
    const branch = tryGit(worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const plans = discovered.docs.filter((doc): doc is PlanDoc => doc.type === "plan" && doc.project === registered.project.slug
      && doc.actions.some(action => action.id === claim.action_id));
    if (!claim.claim_generation || claim.branch !== branch?.trim()) ownershipBlocker = refusal("Caller claim identity or branch fence does not match the candidate.");
    else if (claim.project !== registered.project.slug) ownershipBlocker = refusal("Caller claim belongs to another Project.");
    else if (plans.length !== 1) ownershipBlocker = refusal("Claimed Action is missing or ambiguous across Project Plans.");
    else {
      const plan = plans[0];
      assigned = { plan: plan.slug, action: claim.action_id, claimId: claim.id, generation: claim.claim_generation };
      resolution = resolveDispatch(worktree, registered.project.slug, { actionId: claim.action_id, planSlug: plan.slug });
    }
  }
  const actualSessions = evidence.sessions.filter(row => canonicalPath(row.worktree_path) === worktree);
  const actualSession = actualSessions.length === 1 ? actualSessions[0] : null;
  if (actualSessions.length > 1 || (actualSession && (!assigned || actualSession.project_slug !== registered.project.slug
    || actualSession.plan_slug !== assigned.plan || actualSession.action_id !== assigned.action))) {
    ownershipBlocker = refusal("Caller Session and claim evidence conflict.");
  }
  const readySet = resolveReadySet(worktree, registered.project.slug);
  const gate = withReadOnlyDatabase(workspacePath, db => resolveOperatorGate({ db, repoRoot: worktree,
    projectSlug: registered.project.slug, selectedActionId: resolution.context?.action.id ?? null, readySetCandidates: readySet.candidates }));
  const blockers = [...resolution.blockers, ...operatorGateBlockers(gate.blocking), ...(ownershipBlocker ? [ownershipBlocker] : [])];
  const dispatchable = isDispatchable({ ...resolution, blockers });
  const ongoing: CallerOrientation["ongoing"] = [
    ...evidence.sessions.filter(row => row.project_slug === registered.project.slug).map(row => ({ source: "session" as const,
      id: row.id, action: row.action_id, status: row.status })),
    ...evidence.claims.filter(row => row.project === registered.project.slug && row.expires_at > now.toISOString())
      .map(row => ({ source: "claim" as const, id: row.id, action: row.action_id, status: "reserved" }))
  ];
  const related = discovered.docs.filter((doc): doc is PlanDoc => doc.type === "plan" && doc.project === registered.project.slug
    && (doc.slug === assigned?.plan || doc.slug === selected.context?.activePlan)).map(doc => ({ slug: doc.slug,
      status: doc.status, source: doc.relativePath, updated: doc.updated })).sort((a, b) => a.slug.localeCompare(b.slug));
  const nextStep = blockers[0]?.remedy ?? (dispatchable ? (assigned ? "Continue the caller-owned Action within existing authority." : "Use the existing protected Go path to obtain an assignment before implementation.") : "Resolve the existing Action gate before continuing.");
  return createSuccess({ command: "next", workspace: workspacePath, data: { ...resolution, blockers, dispatchable,
    projectId: registered.project.id, repoRoot: worktree, operatorAlerts: gate.alerts,
    orientation: { source: "managed-documents+canonical-workspace", observedAt: now.toISOString(), repository: canonicalPath(repository),
      worktree, baseRevision: tryGit(repository, ["rev-parse", "HEAD"])?.trim() ?? null, callerRevision: tryGit(worktree, ["rev-parse", "HEAD"])?.trim() ?? null, selected, assigned, session: actualSession ? { id: actualSession.id, status: actualSession.status } : null,
      ongoing: ongoing.slice(0, 5), ongoingTotal: ongoing.length, relatedPlans: related.slice(0, 2), relatedPlanTotal: related.length, nextStep } } });
}

function resolveNextCommand(
  options: NextCommandOptions,
  readDatabase: typeof withDatabase
): { response: CommandSuccess<NextCommandData>; projectSlug: string } {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { project, repoRoot, firedBackBurnerCount } = readDatabase(workspacePath, (db) => {
    const resolved = resolveProjectAndRepo(db, options);
    return {
      ...resolved,
      firedBackBurnerCount: listBackBurnerItems(db, "opportunistic", { fired: true })
        .filter((item) => item.project_id === null || item.project_id === resolved.project.id).length
    };
  });

  const baseResolution = resolveDispatch(repoRoot, project.slug);
  const readySet = resolveReadySet(repoRoot, project.slug);
  const operatorGate = readDatabase(workspacePath, (db) =>
    resolveOperatorGate({
      db,
      repoRoot,
      projectSlug: project.slug,
      selectedActionId: baseResolution.context?.action.id ?? null,
      readySetCandidates: readySet.candidates
    })
  );

  const resolution: DispatchResolution = {
    ...baseResolution,
    blockers: [...baseResolution.blockers, ...operatorGateBlockers(operatorGate.blocking)]
  };
  const dispatchable = isDispatchable(resolution);

  return {
    projectSlug: project.slug,
    response: createSuccess({
      command: "next",
      workspace: workspacePath,
      data: {
        ...resolution,
        dispatchable,
        projectId: project.id,
        repoRoot,
        operatorAlerts: operatorGate.alerts,
        ...(firedBackBurnerCount > 0 ? { firedBackBurnerCount } : {})
      }
    })
  };
}

function pickSoleActiveProject(db: Parameters<typeof listProjects>[0]) {
  const active = listProjects(db).filter((project) => project.status === "active");
  return active.length === 1 ? active[0] : null;
}

/**
 * The Project whose repository contains the directory this was invoked from.
 *
 * Standing inside a Project's checkout is an unambiguous statement about which
 * Project is meant, and it is the answer an operator expects when they run
 * `arcadia next` from a project directory. Without this, four active Projects
 * means every such invocation is refused for ambiguity that only exists in the
 * database's view of the world.
 *
 * The containment test is deliberate rather than an equality check: agent
 * worktrees and subdirectories are still inside the Project, and a path that
 * merely shares a prefix with the repository root -- `/repo-backup` beside
 * `/repo` -- is not.
 */
function pickProjectContainingInvocation(db: Parameters<typeof listProjects>[0]) {
  const from = invocationRoot();
  const matches = listProjects(db)
    .filter((project) => project.status === "active")
    .map((project) => ({ project, repoPath: getProjectMetadata(db, project.id)?.repo_path?.trim() }))
    .filter((candidate): candidate is { project: typeof candidate.project; repoPath: string } => {
      if (!candidate.repoPath) return false;
      const root = path.resolve(candidate.repoPath);
      return from === root || from.startsWith(`${root}${path.sep}`);
    })
    // The most specific repository wins when one Project's checkout nests
    // inside another's.
    .sort((a, b) => b.repoPath.length - a.repoPath.length);

  return matches[0]?.project ?? null;
}

/**
 * The Project and repository both `next` and `next --ready` resolve from,
 * shared so the two commands can never disagree about which repository they
 * are reading documents from.
 */
function resolveProjectAndRepo(db: Parameters<typeof listProjects>[0], options: NextCommandOptions) {
  const resolved = options.project
    ? getProject(db, options.project) ?? getProjectBySlug(db, options.project)
    : pickProjectContainingInvocation(db) ?? pickSoleActiveProject(db);

  if (!resolved) {
    if (options.project) {
      throw projectNotFound(options.project);
    }
    // Say which of the two situations this is. "Pick one" is unhelpful advice
    // when the real problem is that nothing is active.
    const active = listProjects(db).filter((candidate) => candidate.status === "active");
    throw validationError(
      active.length === 0
        ? "No Project is active, so there is no current action. Set one active, or name it with --project."
        : "More than one Project is active and this was not run from inside any of their repositories, so there is no single current action. Name one with --project, or run this from a Project's checkout.",
      { active: active.map((candidate) => candidate.slug), all: listProjects(db).map((c) => c.slug) }
    );
  }

  const metadata = getProjectMetadata(db, resolved.id);
  const path = metadata?.repo_path?.trim();
  if (!path) {
    throw validationError("Project has no repo_path, so its documentation cannot be read.", {
      project: resolved.slug,
      remedy: `arcadia project metadata ${resolved.id} --repo-path <path>`
    });
  }

  return { project: resolved, repoRoot: path };
}

/**
 * Everything a dispatch brief says about one resolution, with no reference to
 * a workspace or a database.
 *
 * `next` and `docket` answer the same question from the same repository
 * documents and differ only in how they were pointed at the repository. Both
 * render through here so the two can never describe the same state
 * differently — a divergence an agent would have no way to detect.
 */
export interface DispatchRenderInput {
  context: DispatchResolution["context"];
  blockers: DispatchResolution["blockers"];
  operatorQuestion: DispatchResolution["operatorQuestion"];
  dispatchable: boolean;
  repoRoot: string;
  operatorAlerts?: OperatorGateItem[];
}

export function renderDispatchResolution(data: DispatchRenderInput): string[] {
  const { context, blockers, operatorQuestion, dispatchable, repoRoot, operatorAlerts } = data;

  if (!context) {
    return [
      "No current action could be resolved.",
      "",
      ...renderBlockers(blockers),
      "",
      "Repairing the control documentation is the immediate work.",
      ...(operatorAlerts && operatorAlerts.length > 0 ? ["", ...renderOperatorAlerts(operatorAlerts)] : [])
    ];
  }

  const { action } = context;
  const lines: string[] = [
    `Project: ${context.projectName} (${context.projectSlug}) — ${context.projectStatus}`,
    `Repository: ${repoRoot}`,
    `Active plan: ${context.activePlan} [${context.planStatus}] — ${context.planPath}`,
    `Token impact: ${context.planTokenImpact} — ${context.planTokenBudget}`,
    `Milestone: ${context.milestone ?? "none"}`,
    "",
    `Current action: ${action.id}`,
    `  ${action.title}`,
    `  Status: ${action.status} · Responsibility: ${action.responsibility}` +
      (action.effort ? ` · Effort: ${action.effort}` : "")
  ];

  if (action.clarification === "question_open") {
    lines.push(
      `  Clarification: question_open (${action.gapType ?? "no gap type"})`,
      `  Question: ${action.question ?? "(missing)"}`
    );
  } else {
    lines.push(`  Clarification: ${action.clarification ?? "not evaluated"}`);
    if (action.nextAction) {
      lines.push(`  Next action: ${action.nextAction}`);
    }
    if (action.source) {
      lines.push(`  Source: ${action.source}`);
    }
  }

  if (action.acceptanceCriteria.length > 0) {
    lines.push("  Acceptance criteria:");
    lines.push(...action.acceptanceCriteria.map((criterion) => `    - ${criterion}`));
  }

  if (action.references.length > 0) {
    lines.push("  References:");
    lines.push(...action.references.map((reference) => `    - ${reference}`));
  }

  if (context.requiredDecisions.length > 0) {
    lines.push("  Required decisions:");
    lines.push(
      ...context.requiredDecisions.map(
        (decision) => `    - ${decision.id} [${decision.status}] ${decision.question}`.trimEnd()
      )
    );
  }

  lines.push("", `Authorization: ${context.authorization}`);

  // The Constitution binds every action this brief dispatches, so it belongs
  // beside the authorization line rather than behind a link the agent has to
  // choose to follow. Printed whatever the outcome: repairing a blocker is
  // agent work under the same constraints as implementing an action. The
  // dispatch context carries only its fingerprint; this is the one place the
  // brief embeds the text, verified against that fingerprint.
  // Loaded unconditionally: a Constitution adopted after resolution must
  // refuse the brief, not be skipped because the pin said there was none.
  const constraints = loadConstitution(context.repoRoot, context.constitution);
  if (context.constitution) {
    lines.push("", `Standing constraints (CONSTITUTION.md, sha256 ${context.constitution.sha256.slice(0, 12)}) — these bind this action:`);
    lines.push(...constraints.map((line) => (line ? `  ${line}` : "")));
  }

  if (!blockers.some((blocker) => blocker.field === "guidance_delivery")) {
    lines.push(...renderGuidanceRetrieval(context.repoRoot, undefined, `${action.title} ${action.nextAction ?? ""} ${action.references.join(" ")}`));
  }

  if (blockers.length > 0) {
    lines.push("", "Blockers:", ...renderBlockers(blockers));
  }

  lines.push("");
  if (operatorQuestion) {
    // The contract's required return shape: one precise question, not a
    // request for direction.
    lines.push("This action is blocked on one question for the operator:", `  ${operatorQuestion}`);
  } else if (dispatchable) {
    lines.push("Dispatchable: a coding agent may begin this action now.");
  } else if (blockers.length > 0) {
    lines.push("Not dispatchable: repair the blockers above first.");
  } else {
    lines.push(`Not dispatchable: responsibility is "${action.responsibility}".`);
  }

  if (operatorAlerts && operatorAlerts.length > 0) {
    lines.push("", ...renderOperatorAlerts(operatorAlerts));
  }

  return lines;
}

export function renderNextSuccess(response: CommandSuccess<NextCommandData>): string[] {
  const lines = renderDispatchResolution(response.data);
  const orientation = response.data.orientation;
  if (orientation) lines.unshift(
    `Observed: ${orientation.observedAt} (${orientation.source})`,
    `Repository/base checkout: ${orientation.repository}`,
    `Base revision: ${orientation.baseRevision ?? "unavailable"}`,
    `Caller worktree: ${orientation.worktree} (${orientation.callerRevision ?? "revision unavailable"})`,
    `Selected: ${orientation.selected.context ? `${orientation.selected.context.activePlan}#${orientation.selected.context.action.id}` : "unresolved (see selected evidence)"}`,
    ...orientation.selected.blockers.slice(0, 3).map(blocker => `Selected gate: ${blocker.field}: ${blocker.message}`),
    `Assigned: ${orientation.assigned ? `${orientation.assigned.plan}#${orientation.assigned.action} (claim ${orientation.assigned.claimId})` : "none"}`,
    `Session: ${orientation.session ? `${orientation.session.id} [${orientation.session.status}] (stored observation)` : "no canonical active Session evidence"}`,
    `Ongoing ownership: ${orientation.ongoingTotal}; showing ${orientation.ongoing.length}`,
    ...orientation.ongoing.map(row => `  ${row.source} ${row.id}: ${row.action ?? "no Action"} [${row.status}]`),
    `Related Plans: ${orientation.relatedPlanTotal}; showing ${orientation.relatedPlans.length}`,
    ...orientation.relatedPlans.map(plan => `  ${plan.slug} [${plan.status}] — ${plan.source}, updated ${plan.updated}`),
    `Next permitted step/gate: ${orientation.nextStep}`, ""
  );
  appendFiredBackBurnerHint(lines, response.data.firedBackBurnerCount);
  return lines;
}

function appendFiredBackBurnerHint(lines: string[], count: number | undefined): void {
  if (!count) return;
  lines.push("", `Back Burner: ${count} fired condition${count === 1 ? "" : "s"}. See: arcadia back-burner list --fired yes`);
}

function renderBlockers(blockers: DispatchResolution["blockers"]): string[] {
  return blockers.flatMap((blocker) => [
    `  ! ${blocker.relativePath} [${blocker.field}]: ${blocker.message}`,
    `      ${blocker.remedy}`
  ]);
}

export interface NextReadyCommandData extends ReadySetResolution {
  projectId: string | null;
}

/**
 * List every Action in the active plan a coding agent could dispatch now,
 * instead of only refusing a bad pointer.
 *
 * Not journaled: unlike `next` and `work plan`, this reports a whole set of
 * Actions rather than resolving one dispatch attempt, and journalling every
 * Action it inspects on every invocation would swamp the dispatch journal's
 * actual purpose — tracking real dispatch attempts — with exploratory
 * queries that never tried to dispatch anything.
 */
export function runNextReadyCommand(options: NextCommandOptions): CommandSuccess<NextReadyCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const { project, repoRoot } = withDatabase(workspacePath, (db) => resolveProjectAndRepo(db, options));

  const resolution = resolveReadySet(repoRoot, project.slug);

  return createSuccess({
    command: "next.ready",
    workspace: workspacePath,
    data: { ...resolution, projectId: project.id }
  });
}

export function renderNextReadySuccess(response: CommandSuccess<NextReadyCommandData>): string[] {
  const { planSlug, planPath, blockers, ready, suggestedCurrentAction, nearest } = response.data;

  if (blockers.length > 0) {
    return [
      "No ready set could be computed.",
      "",
      ...renderBlockers(blockers),
      "",
      "Repairing the control documentation is the immediate work."
    ];
  }

  const lines = [`Active plan: ${planSlug} — ${planPath}`, ""];

  if (ready.length === 0) {
    lines.push("Ready set: empty. No unfinished Action is fully ready.");
    if (nearest) {
      lines.push(
        "",
        `Nearest to ready: ${nearest.actionId}`,
        `  ${nearest.title}`,
        `  Responsibility: ${nearest.responsibility}`
      );
      if (nearest.operatorQuestion) {
        lines.push(`  Open question: ${nearest.operatorQuestion}`);
      }
      if (nearest.blockers.length > 0) {
        lines.push("  Blockers:", ...renderBlockers(nearest.blockers));
      }
    }
    return lines;
  }

  lines.push(`Ready set (${ready.length}):`);
  for (const entry of ready) {
    const marker = entry.actionId === suggestedCurrentAction ? "*" : " ";
    lines.push(`  ${marker} ${entry.actionId} — ${entry.title} [${entry.responsibility}]`);
  }

  lines.push(
    "",
    suggestedCurrentAction
      ? `Suggested current_action: ${suggestedCurrentAction} (the operator still decides; nothing was written).`
      : "No suggestion could be made."
  );

  return lines;
}

export interface NextHistoryCommandData {
  events: DispatchEvent[];
  summary: DispatchJournalSummary;
}

/**
 * Read the dispatch journal.
 *
 * The control documents earn their overhead only if refusals are rare and for
 * good reasons. This is where that is checked: a field that blocks most
 * resolutions is either a rule worth relaxing or a habit worth fixing, and
 * nobody can tell which from memory.
 */
export function runNextHistoryCommand(options: {
  workspace: string;
  limit?: number;
}): CommandSuccess<NextHistoryCommandData> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const limit = options.limit ?? 20;

  const data = withDatabase(workspacePath, (db) => ({
    events: listDispatchEvents(db, limit),
    // Summarized over a wider window than is listed: the tally is about the
    // trend, and twenty rows is too few to see one.
    summary: summarizeDispatchEvents(db, Math.max(limit, 200))
  }));

  return createSuccess({ command: "next.history", workspace: workspacePath, data });
}

export function renderNextHistorySuccess(response: CommandSuccess<NextHistoryCommandData>): string[] {
  const { events, summary } = response.data;

  if (summary.total === 0) {
    return ["No dispatch resolutions recorded yet.", "", "Run `arcadia next` to start the journal."];
  }

  const lines = [
    `Dispatch resolutions: ${summary.total} · dispatchable ${summary.dispatchable} · blocked ${summary.blocked}`,
    ""
  ];

  if (summary.byField.length > 0) {
    lines.push("Blocked on:");
    for (const entry of summary.byField) {
      const share = Math.round((entry.resolutions / summary.total) * 100);
      lines.push(`  ${entry.field} — ${entry.resolutions} of ${summary.total} resolutions (${share}%)`);
    }
    lines.push("");
  }

  lines.push("Recent:");
  for (const event of events) {
    const verdict = event.operatorQuestion
      ? "question"
      : event.dispatchable
        ? "dispatchable"
        : `blocked (${event.blockerCount})`;
    const subject = [event.projectSlug, event.planSlug, event.actionId].filter(Boolean).join(" / ") || "unresolved";
    lines.push(`  ${event.occurredAt} ${event.command} ${subject} — ${verdict}`);
    if (event.blockerFields.length > 0) {
      lines.push(`      ${event.blockerFields.join(", ")}`);
    }
  }

  return lines;
}
