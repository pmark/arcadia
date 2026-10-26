import { deriveJourneyProgress } from "../journey/progress.js";
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
import { PLAN_JOURNEY_SCHEMA, type Journey, type JourneyContext, type JourneyEvent, type PlanJourney, type PlanJourneyAction } from "../journey/schema.js";

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
export function runJourneyCommand(options: { actionKey: string; workspace?: string; now?: Date }): CommandSuccess<Journey | PlanJourney> {
  const planKey = parsePlanKey(options.actionKey);
  if (planKey) return runPlanJourneyCommand({ ...options, project: planKey.project, plan: planKey.plan });
  try {
    splitActionKey(options.actionKey);
  } catch (error) {
    throw validationError(error instanceof Error ? error.message : String(error));
  }
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db) => {
    const [project, action] = splitActionKey(options.actionKey);
    const current = action === CURRENT;
    // `current` needs the documents; any other key reads them only for context, and does without when they cannot be read.
    let documents: ProjectDocuments | null = null;
    let contextWarning: string | null = null;
    try {
      documents = readProjectDocuments(db, project);
    } catch (error) {
      if (current) throw error;
      contextWarning = `No Project context: ${error instanceof Error ? error.message : String(error)}`;
    }
    const actionKey = current && documents ? `${documents.slug}/${currentActionIn(documents)}` : options.actionKey;
    const journey = deriveJourney(db, actionKey, options.now ?? new Date(), { integration: gitIntegration });
    journey.context = documents ? journeyContext(documents, journey.action.plan, journey.action.id) : null;
    if (contextWarning) journey.warnings.push(contextWarning);
    return journey;
  });
  return createSuccess({ command: "journey", workspace: workspacePath, data, warnings: data.warnings });
}

/** The action segment that means "the Project's current Action" (so an Action literally named `current` is reachable only through the pointer). */
export const CURRENT = "current";

/** `<project>/plan:<slug>` or `<project>/plan:current`: a whole Plan's journey rather than one Action's. */
function parsePlanKey(key: string): { project: string; plan: string } | null {
  const match = /^([^/\s]+)\/plan:([^/\s]+)$/.exec(key);
  return match ? { project: match[1], plan: match[2] } : null;
}

function runPlanJourneyCommand(options: { project: string; plan: string; workspace?: string; now?: Date }): CommandSuccess<PlanJourney> {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const data = withReadOnlyDatabase(workspacePath, (db) => derivePlanJourney(db, readProjectDocuments(db, options.project), options.plan, options.now ?? new Date()));
  return createSuccess({ command: "journey", workspace: workspacePath, data, warnings: data.warnings });
}

/** The Plan's Actions in Plan order, each summarised from its own journey. Read-only. */
export function derivePlanJourney(db: Database.Database, documents: ProjectDocuments, planSlug: string, now: Date): PlanJourney {
  const activeSlug = documents.project?.activePlan ?? null;
  const slug = planSlug === CURRENT ? activeSlug : planSlug;
  if (!slug) throw validationError(`Project "${documents.slug}" has no active Plan.`);
  const plan = documents.plans.find((candidate) => candidate.slug === slug);
  if (!plan) throw validationError(`No Plan "${slug}" in Project "${documents.slug}".`);
  let pointer: string | null = null;
  try {
    pointer = currentActionIn(documents);
  } catch {
    pointer = null;
  }
  const warnings: string[] = [];
  const actions: PlanJourneyAction[] = plan.actions.map((doc) => {
    const done = doc.status === "done";
    let journey: Journey | null = null;
    try {
      journey = deriveJourney(db, `${documents.slug}/${doc.id}`, now, done ? {} : { integration: gitIntegration });
    } catch (error) {
      warnings.push(`${doc.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (journey) for (const warning of journey.warnings) if (!/^No Session has run for /.test(warning)) warnings.push(`${doc.id}: ${warning}`);
    const events = journey?.events ?? [];
    const counts = {
      victories: events.filter((event) => event.kind === "victory").length,
      cleared: events.filter((event) => event.kind === "cleared").length,
      open: events.filter((event) => event.kind === "obstacle").length
    };
    // The Plan document says the Action is done: that outranks a journey still reading its Sessions.
    const activity = done && journey?.activity.phase !== "arrived"
      ? { phase: "arrived" as const, headline: "Done", since: journey?.destination.at ?? null, yourMove: null }
      : { phase: journey?.activity.phase ?? "parked", headline: journey?.activity.headline ?? "Not started", since: journey?.activity.since ?? null, yourMove: journey?.activity.yourMove ?? null };
    return {
      id: doc.id,
      title: doc.title,
      status: doc.status,
      current: doc.id === pointer,
      journey: { activity, destination: { reached: done || (journey?.destination.reached ?? false) }, counts }
    };
  });
  return {
    schema: PLAN_JOURNEY_SCHEMA,
    generatedAt: now.toISOString(),
    project: documents.slug,
    plan: { slug: plan.slug, milestone: plan.milestone ?? documents.project?.milestone ?? null, active: plan.slug === activeSlug },
    context: {
      project: documents.project ? { name: documents.project.name, goal: documents.project.goal, outcome: documents.project.outcome, milestone: documents.project.milestone } : null,
      plan: { slug: plan.slug, milestone: plan.milestone ?? documents.project?.milestone ?? null, active: plan.slug === activeSlug, position: null, total: plan.actions.length, done: plan.actions.filter((a) => a.status === "done").length },
      action: null
    },
    progress: deriveJourneyProgress(db, documents.slug, plan.slug, plan.actions.map(action => action.id), now),
    northStar: null,
    actions,
    warnings
  };
}

export function renderPlanJourneySuccess(response: CommandSuccess<PlanJourney>): string[] {
  const journey = response.data;
  const lines = [`${journey.project}/plan:${journey.plan.slug}${journey.plan.active ? " (active)" : ""}${journey.plan.milestone ? ` · ${journey.plan.milestone}` : ""}`];
  if (journey.progress) {
    for (const period of journey.progress.periods) {
      const w = period.current, previous = period.previous;
      lines.push(`Travel in ${period.days} elapsed days (UTC [${w.start}, ${w.end})): ${w.delivered} delivered (${w.deliveredPerDay.toFixed(2)}/day; previous ${previous.deliveredPerDay.toFixed(2)}/day), ${w.cleared} dated alert clears (${w.clearedPerDay.toFixed(2)}/day; previous ${previous.clearedPerDay.toFixed(2)}/day), ${w.failed} unaccepted exits.`);
      lines.push(`Session elapsed: ${w.sessionHours?.toFixed(2) ?? "unknown"} hours; occupied: ${w.occupiedHours?.toFixed(2) ?? "unknown"} hours. Active effort unknown. ${w.sessionsWithoutBounds} Sessions lack valid closed bounds (all history).`);
    }
    for (const period of journey.progress.periods) for (const [label, window] of [["current",period.current],["previous",period.previous]] as const) for (const group of window.services) {
      lines.push(`${period.days}d ${label} · ${group.service} · configured model ${group.configuredModel ?? "unknown"} · configured effort ${group.configuredEffort ?? "unknown"} · ${group.workType}: ${group.sessions} Sessions, ${group.closedSpans} closed spans, ${group.sessionHours?.toFixed(2) ?? "unknown"} elapsed hours, ${group.delivered} delivered heads, ${group.failed} unaccepted exits. Runtime model/effort unknown. Source agent_sessions: ${group.sessionIds.join(", ")}`);
    }
    lines.push(...journey.progress.limitations);
  }
  for (const action of journey.actions) {
    const { activity } = action.journey;
    const glyph = action.journey.destination.reached ? "◆" : activity.phase === "blocked" ? "▲" : action.current ? "◉" : "○";
    lines.push(`${glyph} ${action.id}${action.current ? " *" : ""}  ${activity.headline}${activity.yourMove ? `  — Your move: ${activity.yourMove}` : ""}`);
  }
  return lines;
}

/** A Project's checked-in documents, read the way the scheduler reads them; read-only. */
export interface ProjectDocuments {
  /** The Project record's own slug: the lookup ignores case, the documents do not. */
  slug: string;
  project: ProjectDoc | null;
  plans: PlanDoc[];
}

export function readProjectDocuments(db: Database.Database, projectSlug: string): ProjectDocuments {
  const project = getProjectBySlug(db, projectSlug);
  if (!project) throw validationError(`No Project "${projectSlug}" in this workspace.`);
  const root = projectRepositoryRoot(db, project);
  if (!root) throw validationError(`Project "${projectSlug}" has no usable repository path, so its documents cannot be read.`);
  const slug = project.slug ?? projectSlug;
  const docs = discoverDocs(root).docs;
  return {
    slug,
    project: docs.find((doc): doc is ProjectDoc => doc.type === "project" && doc.slug === slug) ?? null,
    plans: docs.filter((doc): doc is PlanDoc => doc.type === "plan" && doc.project === slug)
  };
}

/** The Project's `current_action` pointer, or its active Plan's. */
export function currentActionIn(documents: ProjectDocuments): string {
  const active = documents.plans.find((plan) => plan.slug === documents.project?.activePlan) ?? null;
  const current = documents.project?.currentAction ?? active?.currentAction ?? null;
  if (!current) throw validationError(`Project "${documents.slug}" has no current Action.`);
  return current;
}

export function currentActionOf(db: Database.Database, projectSlug: string): string {
  return currentActionIn(readProjectDocuments(db, projectSlug));
}

/**
 * Where the Action sits in its Project: the Project's goal, outcome and
 * milestone, and the Action's place in its Plan (the Plan the Sessions ran
 * under, else the Plan that holds it, else the active one).
 */
export function journeyContext(documents: ProjectDocuments, planSlug: string | null, actionId: string): JourneyContext {
  const project = documents.project;
  // The Plan the Sessions ran under; else the Plan holding the Action (the active one first); else the active Plan.
  const holds = (candidate: PlanDoc) => candidate.actions.some((action) => action.id === actionId);
  const activePlan = documents.plans.find((candidate) => candidate.slug === project?.activePlan) ?? null;
  const plan = (planSlug ? documents.plans.find((candidate) => candidate.slug === planSlug) : undefined)
    ?? (activePlan && holds(activePlan) ? activePlan : documents.plans.find(holds))
    ?? activePlan
    ?? null;
  const index = plan ? plan.actions.findIndex((action) => action.id === actionId) : -1;
  const action = plan && index >= 0 ? plan.actions[index] : null;
  return {
    project: project ? { name: project.name, goal: project.goal, outcome: project.outcome, milestone: project.milestone } : null,
    plan: plan
      ? {
          slug: plan.slug,
          milestone: action?.milestone ?? plan.milestone ?? project?.milestone ?? null,
          active: plan.slug === project?.activePlan,
          position: index >= 0 ? index + 1 : null,
          total: plan.actions.length,
          done: plan.actions.filter((candidate) => candidate.status === "done").length
        }
      : null,
    action: action ? { title: action.title, why: action.why, status: action.status } : null
  };
}

const GLYPH: Record<JourneyEvent["kind"], string> = { launch: "•", victory: "◆", cleared: "△", obstacle: "▲", gate: "○", now: "◉" };

export function renderJourneySuccess(response: CommandSuccess<Journey | PlanJourney>): string[] {
  if (response.data.schema === PLAN_JOURNEY_SCHEMA) return renderPlanJourneySuccess(response as CommandSuccess<PlanJourney>);
  const journey = (response as CommandSuccess<Journey>).data;
  const lines = [
    `${journey.action.key}`,
    `Now: ${journey.activity.headline}${journey.activity.since ? ` (since ${journey.activity.since.slice(0, 16).replace("T", " ")} UTC)` : ""} — ${journey.activity.detail}`,
    ...(journey.activity.yourMove ? [`Your move: ${journey.activity.yourMove}`] : []),
    ...(journey.run ? [`Run: Action ${journey.run.position} of ${journey.run.total}${journey.run.next ? ` · next ${journey.run.next}` : ""}`] : []),
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
