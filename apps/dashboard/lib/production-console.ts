/**
 * The Production console's view model: one place that turns what Arcadia
 * already records (the work queue, the schedule's ready-set batch, agent
 * Session rows and the production policy) into what the page renders.
 *
 * Pure functions only, so the page logic is testable without a browser or a
 * CLI. Nothing here decides anything Arcadia has not already decided: the
 * order is the work queue's, the concurrency grouping is the schedule's lanes
 * (one lane per repository, because the production policy allows one Session
 * lease per repository), and launchability is only a hint; the CLI's own
 * launch preview stays the authority and can still refuse.
 */
import type { ProductionStatusResponse, ScheduleBatch, ScheduleBatchStopKind } from "./arcadia-cli";
import type { DashboardAgentSession } from "./types";
import type { WorkQueue, WorkQueueEntry } from "./work-queue-types";

// ---------------------------------------------------------------------------
// Wire shapes (what /api/production-console returns)
// ---------------------------------------------------------------------------

export interface ConsoleQueueEntry {
  key: string;
  position: number;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
  planSlug: string | null;
  actionId: string;
  title: string;
  state: WorkQueueEntry["state"];
  attentionKind: string | null;
  pointerAuthorized: boolean;
  responsibility: string | null;
  status: string;
  reason: string;
  dependencies: string[];
  blocker: string | null;
  tokenImpact: string | null;
}

export interface ConsoleQueueData {
  revision: number;
  orderValid: boolean;
  unpositionedCount: number;
  nextActionKey: string | null;
  entries: ConsoleQueueEntry[];
}

export interface ConsoleStop {
  kind: ScheduleBatchStopKind;
  key: string;
  title: string;
  prompt: string;
  decisionId: string | null;
}

export interface ConsoleLaneData {
  laneId: string;
  label: string;
  projectSlugs: string[];
  sequenceAdvised: boolean;
  tokenPoints: number;
  /** Ready Actions in this lane, in the order they would run. */
  actions: Array<{ key: string; title: string; tokenImpact: string | null; model: string | null }>;
  stops: ConsoleStop[];
  boundary: ConsoleStop | null;
}

export interface ConsoleBatchData {
  tokenPoints: number;
  lanes: ConsoleLaneData[];
}

export interface ConsoleProduction {
  displayState: string;
  label: string;
  desiredState: "active" | "inactive" | null;
  revision: number | null;
  epoch: number | null;
  liveAdmissions: number;
  maxConcurrentSessions: number | null;
  providers: string[];
  escalations: Array<{ actionKey: string; message: string; remedy: string | null }>;
  /** Projects the production scope admits (the saved configuration while Off); null when unreadable. */
  scopeProjects: string[] | null;
  /** True when Off retained a configuration that On could replay. */
  canReactivate: boolean;
}

export interface ConsoleWorker {
  running: boolean;
  heartbeat: { timestamp: string | null; fresh: boolean; available: boolean };
}

export interface ConsoleCoreData {
  generatedAt: string;
  production: ConsoleProduction | null;
  productionError: string | null;
  worker: ConsoleWorker | null;
  sessions: { active: DashboardAgentSession[]; recent: DashboardAgentSession[] } | null;
  sessionsError: string | null;
  pause: PauseCapability;
}

export interface ConsoleQueuePart {
  generatedAt: string;
  queue: ConsoleQueueData | null;
  queueError: string | null;
  batch: ConsoleBatchData | null;
  batchError: string | null;
}

/**
 * No backend can pause a running provider process or hold every launch
 * without revoking the production grant, so both controls report themselves
 * unavailable and say why. Kept as data so the page and its tests agree.
 */
export interface PauseCapability {
  all: { available: false; reason: string };
  session: { available: false; reason: string };
}

export const PAUSE_CAPABILITY: PauseCapability = {
  all: {
    available: false,
    reason:
      "Not available yet: Arcadia has no launch hold that stops every new Session without revoking the production grant. " +
      "Turning production Off (above) stops new unattended admissions today; operator launches stay possible."
  },
  session: {
    available: false,
    reason:
      "Not available yet: Arcadia cannot pause a running provider process and resume it later. " +
      "Use Copy Reattach on the Mac to interrupt it by hand."
  }
};

// ---------------------------------------------------------------------------
// Server-side trimming: the work queue JSON is close to a megabyte, so only the
// fields the page renders cross the tailnet.
// ---------------------------------------------------------------------------

export function trimWorkQueue(queue: WorkQueue): ConsoleQueueData {
  const entries: ConsoleQueueEntry[] = [];
  queue.ordered.forEach((entry, index) => {
    if (!entry.actionId) return;
    entries.push({
      key: entry.orderKey ?? `${entry.projectSlug ?? entry.projectId ?? "?"}/${entry.actionId}`,
      position: index + 1,
      projectId: entry.projectId,
      projectSlug: entry.projectSlug,
      projectName: entry.projectName,
      planSlug: entry.planSlug,
      actionId: entry.actionId,
      title: entry.actionTitle ?? entry.actionId,
      state: entry.state,
      attentionKind: entry.attentionKind,
      pointerAuthorized: entry.pointerAuthorized === true,
      responsibility: entry.responsibility,
      status: entry.status,
      reason: entry.reason,
      dependencies: entry.dependencies ?? [],
      blocker: entry.blockers[0] ? `${entry.blockers[0].message} Fix: ${entry.blockers[0].remedy}` : null,
      tokenImpact: entry.tokenImpact
    });
  });
  return {
    revision: queue.revision,
    orderValid: queue.orderValid,
    unpositionedCount: queue.unpositionedCount,
    nextActionKey: queue.nextActionKey,
    entries
  };
}

export function trimBatch(batch: ScheduleBatch): ConsoleBatchData {
  const stop = (value: ScheduleBatch["lanes"][number]["stops"][number]): ConsoleStop => ({
    kind: value.kind,
    key: `${value.projectSlug}/${value.actionId}`,
    title: value.title,
    prompt: value.prompt,
    decisionId: value.decisionId
  });
  return {
    tokenPoints: batch.token.points,
    lanes: batch.lanes.map((lane) => ({
      laneId: lane.laneId,
      label: lane.laneLabel,
      projectSlugs: lane.projectSlugs,
      sequenceAdvised: lane.sequenceAdvised,
      tokenPoints: lane.token.points,
      actions: [...lane.actions]
        .sort((a, b) => a.position - b.position)
        .map((action) => ({
          key: `${action.projectSlug}/${action.actionId}`,
          title: action.title,
          tokenImpact: action.tokenImpact,
          model: action.recommendedModel
        })),
      stops: lane.stops.map(stop),
      boundary: lane.boundary ? stop(lane.boundary) : null
    }))
  };
}

export function summarizeProduction(status: ProductionStatusResponse): ConsoleProduction {
  const policy = status.read.policy;
  const scope = policy?.desiredState === "active" ? policy.scope : status.inactiveConfiguration?.scope ?? null;
  return {
    displayState: status.display.state,
    label: status.display.label,
    desiredState: policy?.desiredState ?? null,
    revision: policy?.revision ?? null,
    epoch: policy?.epoch ?? null,
    liveAdmissions: status.liveAdmissions,
    maxConcurrentSessions: scope?.maxConcurrentSessions ?? null,
    providers: scope?.providers ?? [],
    escalations: (status.operatorEscalations ?? []).map((escalation) => ({
      actionKey: escalation.actionKey,
      message: escalation.message,
      remedy: escalation.remedy
    })),
    canReactivate: status.inactiveConfiguration !== null,
    scopeProjects: scope?.projects ?? null
  };
}

// ---------------------------------------------------------------------------
// Client-side assembly: queue + batch + live Sessions -> rows, chips, waves
// ---------------------------------------------------------------------------

export type ActionChip =
  | "launching"
  | "running"
  | "stalled"
  | "ready"
  | "make_next"
  | "repo_busy"
  | "waiting"
  | "needs_you"
  | "blocked"
  | "not_ready";

export const CHIP_LABEL: Record<ActionChip, string> = {
  launching: "Launching",
  running: "Running",
  stalled: "Stalled",
  ready: "Ready",
  make_next: "Ready · make next first",
  repo_busy: "Ready · repo busy",
  waiting: "Waiting",
  needs_you: "Needs you",
  blocked: "External blocker",
  not_ready: "Not ready"
};

export interface ConsoleAction extends ConsoleQueueEntry {
  chip: ActionChip;
  /** One line saying why it is in this state; null when the chip says it all. */
  why: string | null;
  waitsOn: Array<{ key: string; title: string }>;
  laneLabel: string | null;
  /** 1-based: Actions with the same wave are in different repositories and may run side by side. */
  wave: number | null;
  sessionId: string | null;
  launch: { allowed: boolean; needsMakeNext: boolean; disabledReason: string | null };
}

export interface ConsoleWave {
  wave: number;
  actions: ConsoleAction[];
}

export interface AssembledQueue {
  actions: ConsoleAction[];
  /** Ready Actions grouped so each group holds at most one Action per repository. */
  waves: ConsoleWave[];
  lanes: Array<ConsoleLaneData & { busySessionId: string | null }>;
  counts: Record<ActionChip, number>;
}

const AGENT_RESPONSIBILITIES = new Set(["agent", "autonomous"]);

function sessionIsActive(session: DashboardAgentSession): boolean {
  return session.status === "prepared" || session.status === "running";
}

export function assembleQueue(
  queue: ConsoleQueueData,
  batch: ConsoleBatchData | null,
  activeSessions: DashboardAgentSession[]
): AssembledQueue {
  const byKey = new Map(queue.entries.map((entry) => [entry.key, entry]));
  const live = activeSessions.filter(sessionIsActive);

  const laneOfProject = new Map<string, ConsoleLaneData>();
  for (const lane of batch?.lanes ?? []) for (const slug of lane.projectSlugs) laneOfProject.set(slug, lane);

  // One lease per repository: a lane is busy while any of its Projects has a live Session.
  const busyLane = new Map<string, string>();
  for (const session of live) {
    const slug = queue.entries.find((entry) => entry.projectId === session.projectId)?.projectSlug ?? null;
    const lane = slug ? laneOfProject.get(slug) : undefined;
    if (lane && !busyLane.has(lane.laneId)) busyLane.set(lane.laneId, session.id);
  }

  const waveOf = new Map<string, number>();
  for (const lane of batch?.lanes ?? []) lane.actions.forEach((action, index) => waveOf.set(action.key, index + 1));

  const actions = queue.entries.map((entry): ConsoleAction => {
    const session = live.find((candidate) => candidate.projectId === entry.projectId && candidate.actionId === entry.actionId) ?? null;
    const lane = entry.projectSlug ? laneOfProject.get(entry.projectSlug) ?? null : null;
    const waitsOn = entry.dependencies.flatMap((dependency) => {
      const key = `${entry.projectSlug ?? "?"}/${dependency}`;
      const upstream = byKey.get(key);
      // Finished Actions leave the queue, so a dependency it no longer holds is met.
      return upstream && upstream.status !== "done" ? [{ key, title: upstream.title }] : [];
    });
    const chip = chipFor(entry, session, waitsOn.length > 0, lane ? busyLane.has(lane.laneId) : false);
    const agentOwned = AGENT_RESPONSIBILITIES.has(entry.responsibility ?? "");
    const launchable = (chip === "ready" || chip === "make_next") && agentOwned && Boolean(entry.projectId && entry.planSlug);
    return {
      ...entry,
      chip,
      why: whyFor(entry, chip, waitsOn, session),
      waitsOn,
      laneLabel: lane?.label ?? null,
      wave: waveOf.get(entry.key) ?? null,
      sessionId: session?.id ?? null,
      launch: {
        allowed: launchable,
        needsMakeNext: chip === "make_next",
        disabledReason: launchable ? null : launchDisabledReason(chip, agentOwned)
      }
    };
  });

  const actionByKey = new Map(actions.map((action) => [action.key, action]));
  const waveMap = new Map<number, ConsoleAction[]>();
  for (const lane of batch?.lanes ?? []) {
    lane.actions.forEach((laneAction, index) => {
      const action = actionByKey.get(laneAction.key);
      if (!action) return;
      const list = waveMap.get(index + 1) ?? [];
      list.push(action);
      waveMap.set(index + 1, list);
    });
  }
  const waves = [...waveMap.entries()].sort(([a], [b]) => a - b).map(([wave, list]) => ({ wave, actions: list }));

  const counts = Object.fromEntries(Object.keys(CHIP_LABEL).map((chip) => [chip, 0])) as Record<ActionChip, number>;
  for (const action of actions) counts[action.chip] += 1;

  return {
    actions,
    waves,
    lanes: (batch?.lanes ?? []).map((lane) => ({ ...lane, busySessionId: busyLane.get(lane.laneId) ?? null })),
    counts
  };
}

function chipFor(
  entry: ConsoleQueueEntry,
  session: DashboardAgentSession | null,
  waiting: boolean,
  laneBusy: boolean
): ActionChip {
  if (session) {
    if (session.status === "prepared") return "launching";
    return session.live && session.observedStatus === "stalled" ? "stalled" : "running";
  }
  if (entry.state === "running") return "running";
  if (entry.responsibility === "requires_review" || entry.attentionKind === "decision") return "needs_you";
  if (entry.responsibility === "blocked") return "blocked";
  if (entry.state === "ready" && !entry.blocker) {
    if (laneBusy) return "repo_busy";
    return entry.pointerAuthorized ? "ready" : "make_next";
  }
  return waiting ? "waiting" : "not_ready";
}

function whyFor(
  entry: ConsoleQueueEntry,
  chip: ActionChip,
  waitsOn: Array<{ title: string }>,
  session: DashboardAgentSession | null
): string | null {
  switch (chip) {
    case "launching":
    case "running":
    case "stalled":
      return session ? `Session ${session.id}` : entry.reason;
    case "ready":
      return null;
    case "make_next":
      return "Launching moves this Project's pointer to it first; you confirm that separately.";
    case "repo_busy":
      return "Another Session holds this repository; one Session per repository at a time.";
    case "waiting":
      return `Waits on ${waitsOn.map((upstream) => upstream.title).join("; ")}`;
    default:
      return entry.blocker ?? entry.reason;
  }
}

function launchDisabledReason(chip: ActionChip, agentOwned: boolean): string {
  if (chip === "launching" || chip === "running" || chip === "stalled") return "A Session is already working on this Action.";
  if (chip === "repo_busy") return "Another Session holds this repository.";
  if ((chip === "ready" || chip === "make_next") && !agentOwned) return "Not a coding-agent Action.";
  if (chip === "ready" || chip === "make_next") return "This Action has no Project or Plan to launch from.";
  return "Only ready Actions can launch.";
}

// ---------------------------------------------------------------------------
// Projects: one card per Project, built from the same assembled queue
// ---------------------------------------------------------------------------

export type ProjectChip = "running" | "next_up" | "ready" | "needs_you" | "repo_busy" | "waiting" | "blocked" | "nothing_ready";

export const PROJECT_CHIP_LABEL: Record<ProjectChip, string> = {
  running: "Running",
  next_up: "Next up",
  ready: "Ready",
  needs_you: "Needs you",
  repo_busy: "Repository busy",
  waiting: "Waiting",
  blocked: "Blocked",
  nothing_ready: "Nothing authorized"
};

export interface ProjectCard {
  slug: string;
  /** Arcadia's Project id, for the Project's own pages; null when the queue did not carry one. */
  projectId: string | null;
  name: string;
  /** The Project's earliest Action position in today's queue, which is what orders the cards. */
  firstPosition: number;
  /** Whether the production scope admits it; null when the scope could not be read. */
  inScope: boolean | null;
  chip: ProjectChip;
  reason: string | null;
  /** The Plan the Project's pointer is on, when its pointer Action is in the queue. */
  planSlug: string | null;
  planOpen: number;
  planReady: number;
  /** The running Action, or else the pointer Action: what production would pick now. */
  next: ConsoleAction | null;
  otherPlans: Array<{ slug: string; open: number }>;
  /** Escalations Arcadia recorded for this Project's Actions. */
  needs: Array<{ actionKey: string; message: string; remedy: string | null }>;
}

const RUNNING_CHIPS = new Set<ActionChip>(["running", "launching", "stalled"]);

/**
 * Groups the assembled queue by Project. Read-only: it orders cards by each
 * Project's earliest queue position (today's priority authority) and marks the
 * first ready, in-scope Project "Next up". Choosing Project order is pending
 * Decision 0115; nothing here changes what production runs.
 */
export function assembleProjects(assembled: AssembledQueue, production: ConsoleProduction | null): ProjectCard[] {
  const byProject = new Map<string, ConsoleAction[]>();
  for (const action of assembled.actions) {
    if (!action.projectSlug) continue;
    const list = byProject.get(action.projectSlug) ?? [];
    list.push(action);
    byProject.set(action.projectSlug, list);
  }
  const scope = production?.scopeProjects ? new Set(production.scopeProjects) : null;
  const cards = [...byProject.entries()].map(([slug, actions]): ProjectCard => {
    const running = actions.find((action) => RUNNING_CHIPS.has(action.chip)) ?? null;
    const pointer = actions.find((action) => action.pointerAuthorized) ?? null;
    const planSlug = (running ?? pointer)?.planSlug ?? null;
    const inPlan = planSlug ? actions.filter((action) => action.planSlug === planSlug) : [];
    const plans = new Map<string, number>();
    for (const action of actions) if (action.planSlug && action.planSlug !== planSlug) plans.set(action.planSlug, (plans.get(action.planSlug) ?? 0) + 1);
    const needs = (production?.escalations ?? []).filter((escalation) => escalation.actionKey.startsWith(`${slug}/`));
    const pointerNeedsYou = pointer !== null && (pointer.chip === "needs_you" || needs.some((escalation) => escalation.actionKey === pointer.key));
    const [chip, reason] = projectState(running, pointer, pointerNeedsYou);
    return {
      slug,
      projectId: actions.find((action) => action.projectId)?.projectId ?? null,
      name: actions[0].projectName ?? slug,
      firstPosition: Math.min(...actions.map((action) => action.position)),
      inScope: scope ? scope.has(slug) : null,
      chip,
      reason,
      planSlug,
      planOpen: inPlan.length,
      planReady: inPlan.filter((action) => action.state === "ready").length,
      next: running ?? pointer,
      otherPlans: [...plans.entries()].map(([plan, open]) => ({ slug: plan, open })),
      needs
    };
  });
  cards.sort((a, b) => a.firstPosition - b.firstPosition);
  const first = cards.find((card) => card.chip === "ready" && card.inScope !== false);
  if (first) first.chip = "next_up";
  return cards;
}

function projectState(running: ConsoleAction | null, pointer: ConsoleAction | null, pointerNeedsYou: boolean): [ProjectChip, string | null] {
  if (running) return ["running", running.why];
  if (!pointer) return ["nothing_ready", "No Action of this Project is authorized to run: its pointer Action is done, blocked or not chosen."];
  if (pointerNeedsYou) return ["needs_you", pointer.why];
  switch (pointer.chip) {
    case "ready":
    case "make_next":
      return ["ready", null];
    case "repo_busy":
      return ["repo_busy", pointer.why];
    case "waiting":
      return ["waiting", pointer.why];
    default:
      return ["blocked", pointer.why];
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionChip = "launching" | "running" | "stalled" | "unreconciled" | "exited" | "failed" | "pr_open" | "done";

export interface SessionSummary {
  chip: SessionChip;
  label: string;
  /** Seconds from start (or preparation) to exit, or to `now` while it runs. */
  elapsedSeconds: number | null;
  exitLine: string | null;
  logPath: string;
}

const OUTCOME_LABEL: Record<string, string> = {
  accepted_completion: "Accepted: the Action is done",
  successful_exit: "Exited cleanly; awaiting acceptance",
  incomplete_resumable: "Unfinished; resumable",
  needs_input: "Exited asking for input",
  failed_execution: "Failed",
  missing_evidence: "Exited without Run evidence"
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? outcome;
}

/** Workspace-relative, the same path `headless-observable-session-launch` writes (PR #1131). */
export function sessionLogPath(sessionId: string): string {
  return `.arcadia/sessions/${sessionId}.log`;
}

export function summarizeSession(session: DashboardAgentSession, now: Date): SessionSummary {
  const started = session.startedAt ?? session.preparedAt;
  const end = session.endedAt ?? null;
  const startMs = Date.parse(started);
  const endMs = end ? Date.parse(end) : sessionIsActive(session) && session.live ? now.getTime() : Number.NaN;
  const elapsedSeconds = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.floor((endMs - startMs) / 1000)) : null;
  const exitParts = [
    session.exitStatus !== undefined && session.exitStatus !== null ? `exit ${session.exitStatus}` : null,
    session.exitOutcome ? outcomeLabel(session.exitOutcome) : null
  ].filter(Boolean);
  const exitLine = exitParts.length > 0 ? exitParts.join(" · ") : null;
  return { ...sessionChip(session), elapsedSeconds, exitLine, logPath: sessionLogPath(session.id) };
}

function sessionChip(session: DashboardAgentSession): { chip: SessionChip; label: string } {
  if (session.status === "prepared") return { chip: "launching", label: "Launching" };
  if (session.status === "running") {
    if (!session.live) return { chip: "unreconciled", label: "Exited · not reconciled" };
    return session.observedStatus === "stalled" ? { chip: "stalled", label: "Stalled" } : { chip: "running", label: "Running" };
  }
  if (session.pullRequestUrl) return { chip: "pr_open", label: "PR opened" };
  if (session.exitOutcome === "accepted_completion") return { chip: "done", label: "Done" };
  if (session.status === "failed" || session.exitOutcome === "failed_execution") return { chip: "failed", label: "Failed" };
  return { chip: "exited", label: session.status === "needs_input" ? "Needs input" : "Exited" };
}

export function formatElapsed(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
}
