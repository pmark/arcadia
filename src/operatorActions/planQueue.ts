import { discoverDocs } from "../docs/discover.js";
import type { ArcadiaDoc, PlanDoc } from "../docs/types.js";
import type { PlanQueueAction } from "./libraryContract.js";

/**
 * The activated Plan's Actions, read from its parsed document, for the activation queue check (#2478). Fails closed:
 * a Plan that cannot be found is never treated as an empty queue.
 */
export function planQueueFromDocs(docs: readonly ArcadiaDoc[], project: string, plan: string): PlanQueueAction[] {
  const doc = docs.find((candidate): candidate is PlanDoc => candidate.type === "plan" && candidate.slug === plan && candidate.project === project);
  if (!doc) throw new Error(`The activated Plan ${project}/${plan} is not readable, so its activation queue cannot be checked.`);
  return doc.actions.map((action) => ({ id: action.id, status: action.status, dependsOn: action.dependsOn }));
}

/** The activated Plan's queue read from the checkout at `repoRoot`. */
export function readPlanQueue(repoRoot: string, project: string, plan: string): PlanQueueAction[] {
  return planQueueFromDocs(discoverDocs(repoRoot).docs, project, plan);
}
