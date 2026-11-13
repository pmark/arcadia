import { validationError } from "../cli/errors.js";

/**
 * The dependency order in which a Plan's Actions join the execution queue. Moved unchanged from
 * src/ask/settlement.ts so the START card contract (src/operatorActions/libraryContract.ts) computes the
 * exact segment that activation settlement queues (#2478).
 */
export function dependencyOrderedActionIds(actions: Array<{ id: string; dependencies: string[] }>): string[] {
  const ids = new Set(actions.map((action) => action.id));
  const remaining = [...actions];
  const ordered: string[] = [];
  const resolved = new Set<string>();
  while (remaining.length > 0) {
    const index = remaining.findIndex((action) => action.dependencies.every((dependency) => !ids.has(dependency) || resolved.has(dependency)));
    if (index < 0) {
      throw validationError("Agent Ask Plan Actions contain a dependency cycle.", { actions: remaining.map((action) => action.id) });
    }
    const [next] = remaining.splice(index, 1);
    ordered.push(next.id);
    resolved.add(next.id);
  }
  return ordered;
}
