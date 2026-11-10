/** Dependency-free billing-variable helpers, so low-level modules (admission) can use them without loading the probes. */

/** True when any named variable is present with a non-blank value, whatever the case of its name. */
export function hasBillingVariable(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  const wanted = new Set(names);
  return Object.entries(env).some(([key, value]) => wanted.has(key.toUpperCase()) && typeof value === "string" && value.trim() !== "");
}
