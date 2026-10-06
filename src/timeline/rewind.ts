import { compareText, type AgentTool, type Confidence, type TimelineEvent, type WorkKind } from "./schema.js";

const CONFIDENCE_RANK: Record<Confidence, number> = { none: 0, low: 1, medium: 2, high: 3 };

/**
 * The point-in-time ("rewind") read model: the workspace as the stream says
 * it was at `asOf`. A pure fold over events at or before `asOf`, so a future
 * scrubbable view can call it once per frame. It knows only what the window
 * holds: widen `--since` to recover older state (a pointer last moved a week
 * ago is unknown in a one-day window), and a worktree removed since then left
 * only its commits behind.
 */

/** A worktree or Session counts as active when it showed activity this recently before `asOf`. */
export const ACTIVE_WITHIN_MS = 2 * 3_600_000;
/** The "what kind of work" lens looks back this far from `asOf`. */
export const LENS_WITHIN_MS = 3_600_000;

export interface ActiveWorktree {
  worktree: string;
  project: string | null;
  branch: string | null;
  action: string | null;
  tool: AgentTool;
  name: string | null;
  confidence: Confidence;
  lastActivity: string;
  lastWorkKind: WorkKind;
  lastSummary: string;
}

export interface ActiveSession {
  session: string;
  project: string | null;
  action: string | null;
  tool: AgentTool;
  name: string | null;
  since: string;
}

export interface ProjectState {
  project: string;
  pointer: { action: string; since: string; eventId: string } | null;
  activePlan: { plan: string; since: string } | null;
  lastEvent: { time: string; summary: string; workKind: WorkKind; tool: AgentTool };
  events: number;
}

export interface PointInTimeView {
  asOf: string;
  windowStart: string;
  projects: ProjectState[];
  activeSessions: ActiveSession[];
  activeWorktrees: ActiveWorktree[];
  production: { state: "active" | "off" | "unknown"; since: string | null };
  attention: Array<{ id: string; time: string; summary: string; project: string | null; decision: string | null }>;
  /** Events per tool per kind of work in the hour before `asOf`. */
  lens: Array<{ tool: AgentTool; workKind: WorkKind; events: number }>;
}

/** Kinds that show work happened in a worktree. "Git ran here" (git.worktree.touched) alone never makes one active. */
const WORKTREE_KINDS = new Set(["git.commit", "git.merge", "git.worktree.created", "git.worktree.integrated"]);
/** Signals that are not work, kept out of the kind-of-work lens. */
const NOT_WORK = new Set(["source_error", "source.truncated", "git.worktree.touched"]);

/** Folds the raw (pre-merge) events: sub-facts a merge would fold away still move the state. */
export function buildPointInTimeView(events: TimelineEvent[], asOf: Date, windowStart: Date): PointInTimeView {
  const cutoff = asOf.getTime();
  const past = events.filter((event) => new Date(event.time).getTime() <= cutoff).sort((a, b) => compareText(a.time, b.time) || compareText(a.id, b.id));

  const projects = new Map<string, ProjectState>();
  const sessions = new Map<string, ActiveSession>();
  const worktrees = new Map<string, ActiveWorktree>();
  let production: PointInTimeView["production"] = { state: "unknown", since: null };
  const attention: PointInTimeView["attention"] = [];
  const lens = new Map<string, { tool: AgentTool; workKind: WorkKind; events: number }>();

  for (const event of past) {
    const project = event.subjects.project ?? null;
    if (project && event.kind !== "source_error") {
      const state = projects.get(project) ?? { project, pointer: null, activePlan: null, lastEvent: { time: event.time, summary: event.summary, workKind: event.workKind, tool: event.actor.tool }, events: 0 };
      state.events += 1;
      state.lastEvent = { time: event.time, summary: event.summary, workKind: event.workKind, tool: event.actor.tool };
      if ((event.kind === "record.project.pointer_moved" || event.kind === "queue.pointer_moved") && event.subjects.action) {
        state.pointer = { action: event.subjects.action, since: event.time, eventId: event.id };
      }
      if (event.kind === "record.project.plan_activated" && event.subjects.plan) state.activePlan = { plan: event.subjects.plan, since: event.time };
      projects.set(project, state);
    }

    const session = event.subjects.session;
    if (session && event.kind === "session.started") {
      sessions.set(session, { session, project, action: event.subjects.action ?? null, tool: event.actor.tool, name: event.actor.name, since: event.time });
    } else if (session && (event.kind === "session.ended" || event.kind === "session.exit_recorded")) {
      sessions.delete(session);
    }

    if (event.subjects.worktree && WORKTREE_KINDS.has(event.kind)) {
      const prior = worktrees.get(event.subjects.worktree);
      // Tool, name and confidence travel together from one record, the most confident seen so far.
      const adopt = !prior || (event.actor.tool !== "unknown" && CONFIDENCE_RANK[event.actor.confidence] >= CONFIDENCE_RANK[prior.confidence]);
      const who = adopt ? event.actor : { tool: prior.tool, name: prior.name, confidence: prior.confidence };
      worktrees.set(event.subjects.worktree, {
        worktree: event.subjects.worktree,
        project,
        branch: event.subjects.branch ?? prior?.branch ?? null,
        action: event.subjects.action ?? prior?.action ?? null,
        tool: who.tool,
        name: who.name,
        confidence: who.confidence,
        lastActivity: event.time,
        lastWorkKind: event.workKind,
        lastSummary: event.summary
      });
    }

    if (event.kind === "production.policy.activate") production = { state: "active", since: event.time };
    if (event.kind === "production.policy.deactivate") production = { state: "off", since: event.time };

    if (event.attention) attention.push({ id: event.id, time: event.time, summary: event.summary, project, decision: event.subjects.decision ?? null });
    if (event.kind === "decision.review_item.decided" || event.kind === "record.decision.answered") {
      // A decided question no longer needs the operator at this moment.
      for (let index = attention.length - 1; index >= 0; index -= 1) if (attention[index].decision === event.subjects.decision) attention.splice(index, 1);
    }

    if (cutoff - new Date(event.time).getTime() <= LENS_WITHIN_MS && !NOT_WORK.has(event.kind)) {
      const key = `${event.actor.tool}|${event.workKind}`;
      const entry = lens.get(key) ?? { tool: event.actor.tool, workKind: event.workKind, events: 0 };
      entry.events += 1;
      lens.set(key, entry);
    }
  }

  return {
    asOf: asOf.toISOString(),
    windowStart: windowStart.toISOString(),
    projects: [...projects.values()].sort((a, b) => compareText(b.lastEvent.time, a.lastEvent.time)),
    activeSessions: [...sessions.values()].sort((a, b) => compareText(b.since, a.since)),
    activeWorktrees: [...worktrees.values()]
      .filter((worktree) => cutoff - new Date(worktree.lastActivity).getTime() <= ACTIVE_WITHIN_MS)
      .sort((a, b) => compareText(b.lastActivity, a.lastActivity)),
    production,
    attention: attention.slice(-10).reverse(),
    lens: [...lens.values()].sort((a, b) => b.events - a.events || compareText(a.tool, b.tool) || compareText(a.workKind, b.workKind))
  };
}
