import { missionPhase } from "./journey-fixture";
import type { JourneyPhase, PlanJourney } from "./journey-types";
import type { FeedItem } from "./workspace-feed";

/**
 * The workspace sky as system status (docs/design/operator-presence.md). The
 * sol sky keeps the time of day; this picks the weather drawn over it from the
 * same read-only sources as the feed. The operator's own condition is separate
 * (./operator-presence.ts) and never changes the sky.
 *
 * Worst first: storm (something is blocking), static (a read failed, so the
 * picture may be stale), attention (something waits on the operator), active
 * (work is moving without them), clear.
 */
export type SkyId = "clear" | "active" | "attention" | "storm" | "static";

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
  clear: { id: "clear", label: "All clear", weather: "Clear skies", draw: { tint: ["#8a6fd0", 0.04], dust: 10, wind: 0.15 } },
  active: { id: "active", label: "Work moving", weather: "Light wind", draw: { dust: 46, wind: 0.6 } },
  attention: { id: "attention", label: "Needs you", weather: "Warm haze", draw: { haze: ["#ffbf5a", 0.22], dust: 26, wind: 0.3, rise: 16 } },
  storm: { id: "storm", label: "Blocked", weather: "Dust storm", draw: { haze: ["#c8743f", 0.55], tint: ["#a5502a", 0.2], dust: 300, wind: 2.4 } },
  static: { id: "static", label: "Signal loss", weather: "Overcast", draw: { clouds: 0.7, veil: ["#2f3440", 0.24], dust: 6, wind: 0.2 } }
};

export interface SkyReading extends Sky {
  /** Why, one short phrase per cause, worst first. Empty when clear. */
  reasons: string[];
}

export interface SkySources {
  items: FeedItem[];
  /** Sources that could not be read, by name. */
  problems: string[];
  loading: boolean;
  /** Live missions. Sample missions are left out so a fixture never sets the sky. */
  missions?: PlanJourney[] | null;
}

const MOVING: JourneyPhase[] = ["launching", "driving", "repairing", "in-review"];
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function readSky({ items, problems, loading, missions }: SkySources): SkyReading {
  const phases = (missions ?? []).map(missionPhase);
  const blocking = items.filter(i => i.section === "Waiting on you" && i.urgent).length;
  const blocked = phases.filter(p => p === "blocked").length;
  const yours = items.filter(i => i.section === "Your move" || i.section === "Waiting on you").length;
  const failing = items.filter(i => i.kind === "pr" && i.urgent).length;
  const others = items.filter(i => i.section === "Waiting on others").length;
  const prs = items.filter(i => i.kind === "pr").length;
  const moving = phases.filter(p => MOVING.includes(p)).length;

  const reasons = [
    blocking && `${count(blocking, "blocking item")} for you`,
    blocked && `${count(blocked, "mission")} blocked`,
    problems.length && `could not read ${problems.join(", ")}`,
    yours - blocking > 0 && `${count(yours - blocking, "item")} waiting on you`,
    failing && `${count(failing, "pull request")} failing or blocked`,
    moving && `${count(moving, "mission")} moving`,
    others && `${count(others, "step")} waiting on others`,
    prs - failing > 0 && `${count(prs - failing, "pull request")} open`
  ].filter((r): r is string => Boolean(r));

  const id: SkyId = blocking || blocked ? "storm"
    : problems.length ? "static"
    : yours || failing ? "attention"
    : moving || others || prs ? "active"
    : "clear";
  // Until the first read lands the sky stays clear rather than guessing.
  if (loading && !items.length && !problems.length) return { id: "clear", label: "Reading", weather: SKIES.clear.weather, reasons: ["reading your work"] };
  return { id, label: SKIES[id].label, weather: SKIES[id].weather, reasons };
}
