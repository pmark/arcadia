import { missionPhase } from "./journey-fixture";
import type { JourneyPhase, PlanJourney } from "./journey-types";
import type { ConsoleCoreData } from "./production-console";
import type { FeedItem } from "./workspace-feed";

/**
 * The workspace sky as system status (docs/design/operator-presence.md, and
 * docs/design/relay/workspace-layers.md). The sol sky keeps the time of day;
 * this picks the weather drawn over it from read-only counts of the feed's
 * sources (./workspace-status.ts), plus production. The operator's own condition is separate
 * (./operator-presence.ts) and never changes the sky.
 *
 * Worst first: storm (something is blocking), static (a read failed or is too
 * old, so the picture may be stale), attention (something waits on the
 * operator), active (something is running), clear. Reading comes before any
 * read has landed, and it makes no claim.
 */
export type SkyId = "reading" | "clear" | "active" | "attention" | "storm" | "static";

/** What the weather layer draws. Colors are hex; alphas 0..1. */
export interface Weather {
  tint?: [string, number];
  haze?: [string, number];
  veil?: [string, number];
  dust?: number;
  wind?: number;
  rise?: number;
  clouds?: number;
}

export interface Sky {
  id: SkyId;
  /** The system's state in a word or two. */
  label: string;
  /** The weather that shows it. */
  weather: string;
}

export const SKIES: Record<SkyId, Sky & { draw: Weather }> = {
  reading: { id: "reading", label: "Reading", weather: "No reading yet", draw: {} },
  clear: { id: "clear", label: "All clear", weather: "Clear skies", draw: { tint: ["#8a6fd0", 0.04], dust: 10, wind: 0.15 } },
  active: { id: "active", label: "Work moving", weather: "Light wind", draw: { dust: 46, wind: 0.6 } },
  attention: { id: "attention", label: "Needs you", weather: "Warm haze", draw: { haze: ["#ffbf5a", 0.22], dust: 26, wind: 0.3, rise: 16 } },
  storm: { id: "storm", label: "Blocked", weather: "Dust storm", draw: { haze: ["#c8743f", 0.55], tint: ["#a5502a", 0.2], dust: 300, wind: 2.4 } },
  static: { id: "static", label: "Signal loss", weather: "Overcast", draw: { clouds: 0.7, veil: ["#2f3440", 0.24], dust: 6, wind: 0.2 } }
};

/** A calm sky only says "All clear" when production is On. Otherwise it claims no more than this. */
export const CALM_WITHOUT_PRODUCTION = "Nothing waiting";

export interface SkyReason {
  text: string;
  /** Where the operator can act on it, when there is such a place. */
  href?: string;
}

export interface SkyReading extends Sky {
  /** Why, one short phrase per cause, worst first. */
  reasons: SkyReason[];
  /** Production's state in words, shown beside the reading. Null until it has been read. */
  production: string | null;
}

/** The facts the sky needs from one production read. A field is null when that part of the read failed. */
export interface ProductionFacts {
  displayState: string | null;
  workerRunning: boolean | null;
  heartbeatFresh: boolean | null;
  liveSessions: number | null;
  stalledSessions: number | null;
}

export function productionFacts(core: ConsoleCoreData): ProductionFacts {
  const live = core.sessions?.active.filter(s => s.live) ?? null;
  return {
    displayState: core.production?.displayState ?? null,
    workerRunning: core.worker?.running ?? null,
    heartbeatFresh: core.worker?.heartbeat.fresh ?? null,
    liveSessions: live?.length ?? null,
    stalledSessions: live?.filter(s => s.observedStatus === "stalled").length ?? null
  };
}

/** What the sky needs to know about the operator's lists: how many of each, not the items themselves. */
export interface SkyCounts {
  blocking: number;
  yours: number;
  failing: number;
  others: number;
  prs: number;
}

export function skyCounts(items: FeedItem[]): SkyCounts {
  return {
    blocking: items.filter(i => i.section === "Waiting on you" && i.urgent).length,
    yours: items.filter(i => i.section === "Your move" || i.section === "Waiting on you").length,
    failing: items.filter(i => i.kind === "pr" && i.urgent).length,
    others: items.filter(i => i.section === "Waiting on others").length,
    prs: items.filter(i => i.kind === "pr").length
  };
}

export interface SkySources {
  counts: SkyCounts;
  /** Sources that could not be read, by name. */
  problems: string[];
  /** Sources whose last good read is too old to trust, by name. */
  stale?: string[];
  loading: boolean;
  /** Live missions. Sample missions are left out so a fixture never sets the sky. */
  missions?: PlanJourney[] | null;
  /** Null when the read failed; undefined until the first read lands. */
  production?: ProductionFacts | null;
  /** Back from being hidden with old data, and the new reads haven't landed yet. */
  resuming?: boolean;
}

const MOVING: JourneyPhase[] = ["launching", "driving", "repairing", "in-review"];
const FEED = "/workspace/feed";
const PRODUCTION = "/production";
const RECORDED_STATES = new Set(["active_building", "active_idle", "inactive_finishing", "inactive_idle"]);
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Maps a production read to its words and what it does to the sky. The heartbeat is the worker's, not a Session's. */
function readProduction(p: ProductionFacts | null | undefined) {
  if (p === undefined) return { words: null, unreadable: false, stalled: 0, silent: false, running: 0, on: false };
  const known = p && p.displayState !== null && RECORDED_STATES.has(p.displayState) && p.workerRunning !== null && p.liveSessions !== null;
  if (!p || !known) return { words: "Can't read production", unreadable: true, stalled: p?.stalledSessions ?? 0, silent: false, running: 0, on: false };
  const on = p.displayState === "active_building" || p.displayState === "active_idle";
  const finishing = p.displayState === "inactive_finishing";
  const silent = (on || finishing) && (!p.workerRunning || !p.heartbeatFresh);
  const stalled = p.stalledSessions ?? 0;
  const words = stalled ? `${count(stalled, "Session")} stalled`
    : silent ? "Worker not responding"
    : p.displayState === "active_building" ? "Production building"
    : p.displayState === "active_idle" ? "Production on, idle"
    : finishing ? "Production finishing"
    : "Production Off";
  const running = (p.liveSessions ?? 0) - stalled + (p.displayState === "active_building" || finishing ? 1 : 0);
  return { words, unreadable: false, stalled, silent, running, on };
}

export function readSky({ counts: { blocking, yours, failing, others, prs }, problems, stale = [], loading, missions, production, resuming = false }: SkySources): SkyReading {
  const phases = (missions ?? []).map(missionPhase);
  const blocked = phases.filter(p => p === "blocked").length;
  const moving = phases.filter(p => MOVING.includes(p)).length;
  const prod = readProduction(production);

  const reason = (when: unknown, text: string, href?: string): SkyReason | null => when ? { text, ...(href ? { href } : {}) } : null;
  const reasons = [
    reason(blocking, `${count(blocking, "blocking item")} for you`, FEED),
    reason(prod.stalled, `${count(prod.stalled, "Session")} stalled`, PRODUCTION),
    reason(prod.silent, "The production worker isn't responding", PRODUCTION),
    reason(blocked, `${count(blocked, "mission")} blocked`),
    reason(problems.length, `could not read ${problems.join(", ")}`),
    reason(prod.unreadable, "could not read production", PRODUCTION),
    reason(stale.length, `the last read of ${stale.join(", ")} is too old`),
    reason(yours - blocking > 0, `${count(yours - blocking, "item")} waiting on you`, FEED),
    reason(failing, `${count(failing, "pull request")} failing or blocked`, FEED),
    reason(moving, `${count(moving, "mission")} moving`),
    reason(others, `${count(others, "step")} waiting on others`, FEED),
    reason(prs - failing > 0, `${count(prs - failing, "pull request")} open`, FEED)
  ].filter((r): r is SkyReason => r !== null);

  // Open pull requests and steps waiting on others are reasons, not weather: only something running moves the sky.
  const id: SkyId = blocking || blocked || prod.stalled || prod.silent ? "storm"
    : problems.length || stale.length || prod.unreadable ? "static"
    : yours || failing ? "attention"
    : moving || prod.running > 0 ? "active"
    : "clear";
  // Until every read has landed, bad news can show but a calm sky makes no claim. Old data can't claim work is moving either.
  if ((loading && id === "clear") || (resuming && (id === "clear" || id === "active"))) return { ...sky("reading"), reasons: reasons.length ? reasons : [{ text: "reading your work" }], production: prod.words };
  const label = id === "clear" && !prod.on ? CALM_WITHOUT_PRODUCTION : SKIES[id].label;
  return { ...sky(id), label, reasons, production: prod.words };
}

function sky(id: SkyId): Sky { return { id, label: SKIES[id].label, weather: SKIES[id].weather }; }

/** How long better news has to hold before the sky shows it, about two reads of the fastest source. */
export const SKY_HOLD_MS = 30_000;
/** A source whose last good read is older than this no longer counts. Several polls of the slowest source. */
export const SKY_STALE_MS = 5 * 60_000;
/** After being hidden, how long new reads get to land before old data counts as Signal loss. */
export const SKY_RESUME_GRACE_MS = 30_000;

const WORSE: Record<SkyId, number> = { reading: 0, clear: 1, active: 2, attention: 3, static: 4, storm: 5 };

export interface SettledSky {
  shown: SkyReading;
  /** A better reading waiting out its hold, and when it was first seen. */
  pending: { id: SkyId; since: number } | null;
}

/**
 * Worse news shows at once. Better news has to hold, so a flicker can't briefly
 * clear the sky. A reading of the same status always takes the latest words.
 */
export function settleSky(state: SettledSky | null, next: SkyReading, now: number): SettledSky {
  // Dropping a calm claim to Reading is never held back: it claims less, not more.
  const claimsLess = next.id === "reading" && WORSE[state?.shown.id ?? "reading"] <= WORSE.active;
  if (!state || state.shown.id === "reading" || claimsLess || WORSE[next.id] >= WORSE[state.shown.id]) return { shown: next, pending: null };
  const pending = state.pending?.id === next.id ? state.pending : { id: next.id, since: now };
  return now - pending.since >= SKY_HOLD_MS ? { shown: next, pending: null } : { shown: state.shown, pending };
}

/**
 * Which sources have gone too long without a good read. Being hidden forgives nothing, because the data is still old.
 * Coming back gets a short grace for new reads to land, and the sky claims no calm meanwhile.
 */
export function readFreshness(lastGood: Record<string, number>, resumedAt: number, now: number): { stale: string[]; resuming: boolean } {
  const old = Object.entries(lastGood).filter(([, at]) => now - at > SKY_STALE_MS).map(([name]) => name);
  if (!old.length) return { stale: [], resuming: false };
  return now - resumedAt <= SKY_RESUME_GRACE_MS ? { stale: [], resuming: true } : { stale: old, resuming: false };
}
