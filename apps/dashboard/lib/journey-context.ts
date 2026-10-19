import type { Journey } from "./journey-types";
import type { PathBrief } from "./path-types";

/**
 * Where the rover's trip sits in the larger mission: the declared North Star
 * and its gates (the `/path` payload), the gate in progress, and whether this
 * Action is itself a step on that path. Pure, so the server and the browser
 * render the same thing.
 */
export interface MissionSummary {
  northStar: { text: string; looksLike: string; why: string } | null;
  progress: { gatesDone: number; gates: number; stepsDone: number; steps: number } | null;
  currentGate: string | null;
  onPath: { gateTitle: string; gateStatus: string } | null;
}

export function missionSummary(path: PathBrief | null, journey: Journey): MissionSummary {
  if (!path?.target.declared) return { northStar: null, progress: null, currentGate: null, onPath: null };
  const plan = journey.action.plan ?? journey.context?.plan?.slug ?? null;
  const ref = plan ? `plan/${plan}#${journey.action.id}` : null;
  const leg = ref
    ? path.legs.find((candidate) => candidate.actionRef === ref || candidate.nodes.some((node) => node.kind === "action" && node.docRef === ref)) ?? null
    : null;
  const { gates, gatesDone, steps, stepsDone } = path.totals;
  return {
    northStar: { text: path.target.text, looksLike: path.target.looksLike, why: path.target.why },
    progress: { gates, gatesDone, steps, stepsDone },
    currentGate: path.legs.find((candidate) => candidate.gateStatus === "in_progress")?.gateTitle ?? null,
    onPath: leg ? { gateTitle: leg.gateTitle, gateStatus: leg.gateStatus } : null
  };
}
