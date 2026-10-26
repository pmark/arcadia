import { missionPhase } from "./journey-fixture";
import type { JourneyPhase, PlanJourney } from "./journey-types";

/**
 * The rover fleet at a glance, for the workspace Journey button and panel.
 * Every mission is one rover; its group is what the operator needs to know
 * about it in one color: blocked, moving, waiting or arrived.
 */
export type FleetGroup = "blocked" | "moving" | "waiting" | "arrived";
export const FLEET_GROUPS: readonly FleetGroup[] = ["blocked", "moving", "waiting", "arrived"];
export const GROUP_LABEL: Record<FleetGroup, string> = { blocked: "blocked", moving: "moving", waiting: "waiting", arrived: "arrived" };

const GROUP_OF: Record<JourneyPhase, FleetGroup> = {
  blocked: "blocked", repairing: "moving", "in-review": "moving", driving: "moving", launching: "moving", waiting: "waiting", parked: "waiting", arrived: "arrived"
};

export interface Rover {
  id: string;
  journey: PlanJourney;
  phase: JourneyPhase;
  group: FleetGroup;
  /** The operator's move on this mission, if one is waiting. */
  yourMove: string | null;
}

export const missionId = (journey: PlanJourney) => `${journey.project}/${journey.plan.slug}`;

/** Rovers worst first (blocked, then ones waiting on the operator), each group in fixture order. */
export function fleet(missions: PlanJourney[]): Rover[] {
  const rovers = missions.map(journey => {
    const phase = missionPhase(journey);
    return { id: missionId(journey), journey, phase, group: GROUP_OF[phase], yourMove: journey.actions.find(a => a.journey.activity.yourMove)?.journey.activity.yourMove ?? null };
  });
  const rank = (r: Rover) => FLEET_GROUPS.indexOf(r.group) * 2 + (r.yourMove ? 0 : 1);
  return rovers.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(({ r }) => r);
}

export function fleetCounts(rovers: Rover[]): Record<FleetGroup, number> {
  const counts = { blocked: 0, moving: 0, waiting: 0, arrived: 0 };
  for (const r of rovers) counts[r.group] += 1;
  return counts;
}

/** "4 rovers: 1 blocked, 2 moving, 1 arrived", for labels that cannot rely on color. */
export function fleetPhrase(rovers: Rover[]): string {
  const counts = fleetCounts(rovers);
  const parts = FLEET_GROUPS.filter(g => counts[g]).map(g => `${counts[g]} ${GROUP_LABEL[g]}`);
  return `${rovers.length} ${rovers.length === 1 ? "rover" : "rovers"}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/** Rovers that need the operator: blocked, or with a move waiting. */
export const urgentRovers = (rovers: Rover[]) => rovers.filter(r => r.group === "blocked" || r.yourMove);

/** Which Journey screen is showing. The last one viewed comes back, so opening Journey never surprises. */
export type JourneyScreen = { kind: "fleet" } | { kind: "mission"; id: string };
export const JOURNEY_STORAGE_KEY = "arcadia.workspace.journey.v1";
const FLEET: JourneyScreen = { kind: "fleet" };

export function loadScreen(storage: Pick<Storage, "getItem"> | null, rovers: Rover[]): JourneyScreen {
  try {
    const raw = storage?.getItem(JOURNEY_STORAGE_KEY);
    if (!raw?.startsWith("mission:")) return FLEET;
    const id = raw.slice("mission:".length);
    // A mission that has since left the fleet falls back to the fleet rather than an empty screen.
    return rovers.some(r => r.id === id) ? { kind: "mission", id } : FLEET;
  } catch {
    return FLEET;
  }
}

export function saveScreen(storage: Pick<Storage, "setItem"> | null, screen: JourneyScreen): void {
  try { storage?.setItem(JOURNEY_STORAGE_KEY, screen.kind === "fleet" ? "fleet" : `mission:${screen.id}`); } catch { /* the screen is a convenience; losing it only means the fleet opens next time */ }
}
